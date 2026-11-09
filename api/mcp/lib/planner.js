// The planner's SharePoint lists, reached with the MCP server's own Microsoft Graph sign-in (its own app
// registration, limited to the planner's site; the secret lives in Azure settings). Rows are shaped the way the
// app shapes them (see app/src/lib/schema.ts toFields / fromFields).
const GRAPH = "https://graph.microsoft.com/v1.0";
const SITE_HOST = "insightinformation.sharepoint.com";
const SITE_PATH = "/sites/PracticePlanner";
const CACHE_MS = 20000;

class PlannerError extends Error {}

function createPlanner({ tenantId, clientId, clientSecret, fetch = globalThis.fetch, now = () => Date.now(), schema = require("./schema.json") }) {
  const defs = new Map(schema.lists.map((l) => [l.key, l]));
  let token = null, siteId = null;
  const listIds = new Map();
  const cache = new Map(); // list key -> { at, rows }

  async function bearer() {
    if (token && token.until > now() + 60000) return token.value;
    const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }).toString(),
    });
    if (!res.ok) throw new PlannerError("Couldn't sign in to Microsoft 365 (check the MCP app registration and its secret).");
    const b = await res.json();
    token = { value: b.access_token, until: now() + (Number(b.expires_in) || 3000) * 1000 };
    return token.value;
  }
  async function graph(path, opts = {}) {
    const res = await fetch(path.startsWith("http") ? path : GRAPH + path, { ...opts, headers: { Authorization: `Bearer ${await bearer()}`, "Content-Type": "application/json", ...(opts.headers || {}) } });
    if (res.status === 204) return null;
    if (res.status === 404) return undefined;
    if (!res.ok) throw new PlannerError(`SharePoint answered ${res.status}.`);
    return res.json();
  }
  async function site() {
    if (siteId) return siteId;
    const s = await graph(`/sites/${SITE_HOST}:${SITE_PATH}?$select=id`);
    if (!s) throw new PlannerError("The planner's SharePoint site wasn't found.");
    return (siteId = s.id);
  }
  async function listId(key) {
    if (listIds.has(key)) return listIds.get(key);
    const def = defs.get(key);
    if (!def) throw new PlannerError(`Unknown list ${key}.`);
    const sid = await site();
    let url = `/sites/${sid}/lists?$select=id,displayName&$top=200`;
    while (url) {
      const page = await graph(url);
      for (const l of page?.value || []) { const k = [...defs.values()].find((d) => d.displayName === l.displayName); if (k) listIds.set(k.key, l.id); }
      if (listIds.has(key)) return listIds.get(key);
      url = page?.["@odata.nextLink"] || "";
    }
    throw new PlannerError(`The list "${def.displayName}" doesn't exist yet. Open the planner once as staff so it is created.`);
  }
  const fromFields = (def, itemId, fields) => {
    const row = { _id: itemId };
    if (typeof fields.Title === "string") row.Title = fields.Title;
    for (const c of def.columns) {
      const v = fields[c.name];
      if (v === undefined || v === null || v === "") continue;
      row[c.name] = c.type === "number" ? Number(v) : c.type === "bool" ? Boolean(v) : String(v);
    }
    if (typeof fields.Modified === "string") row.Modified = fields.Modified;
    return row;
  };
  /** Values coerced to the column's type. An empty string or null clears the column. */
  function toFields(def, values) {
    const out = {};
    for (const [k, v] of Object.entries(values)) {
      if (k === "Title") { out.Title = v === null ? "" : String(v); continue; }
      const c = def.columns.find((x) => x.name === k);
      if (!c) throw new PlannerError(`${def.key} has no column ${k}.`);
      if (v === null || v === "") { out[k] = c.type === "number" ? null : c.type === "bool" ? false : ""; continue; }
      if (c.type === "number") { const n = typeof v === "number" ? v : Number(v); if (!Number.isFinite(n)) throw new PlannerError(`${k} must be a number.`); out[k] = n; }
      else if (c.type === "bool") { if (typeof v === "boolean") out[k] = v; else if (/^(true|false)$/i.test(String(v))) out[k] = /^true$/i.test(String(v)); else throw new PlannerError(`${k} must be true or false.`); }
      else out[k] = String(v);
    }
    return out;
  }
  async function rows(key, fresh = false) {
    const hit = cache.get(key);
    if (!fresh && hit && now() - hit.at < CACHE_MS) return hit.rows;
    const def = defs.get(key);
    const sid = await site(), lid = await listId(key);
    const out = [];
    let url = `/sites/${sid}/lists/${lid}/items?$expand=fields&$top=999`;
    while (url) {
      const page = await graph(url);
      for (const it of page?.value || []) out.push(fromFields(def, it.id, it.fields || {}));
      url = page?.["@odata.nextLink"] || "";
    }
    cache.set(key, { at: now(), rows: out });
    return out;
  }
  return {
    rows, toFields, token: bearer,
    async create(key, values) {
      const sid = await site(), lid = await listId(key);
      const res = await graph(`/sites/${sid}/lists/${lid}/items`, { method: "POST", body: JSON.stringify({ fields: toFields(defs.get(key), values) }) });
      cache.delete(key);
      return res?.id;
    },
    async patch(key, itemId, values) {
      const sid = await site(), lid = await listId(key);
      await graph(`/sites/${sid}/lists/${lid}/items/${encodeURIComponent(itemId)}/fields`, { method: "PATCH", body: JSON.stringify(toFields(defs.get(key), values)) });
      cache.delete(key);
    },
  };
}

module.exports = { createPlanner, PlannerError };
