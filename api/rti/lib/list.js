// The "PP RTI Submissions" SharePoint list, reached with the server's own Microsoft Graph sign-in (the portal's app registration).
// The planner queues a submission there with the day it should go (the payday); the scheduled run sends what is due and writes back
// what HMRC said. Columns are created by the planner (app/src/lib/schema.ts, RtiSubmissions).
const GRAPH = "https://graph.microsoft.com/v1.0";
const LIST = "PP RTI Submissions";

function createList({ tenantId, clientId, clientSecret, siteHost, sitePath, fetch = globalThis.fetch, now = () => Date.now() }) {
  let token = null, siteId = null, listId = null;
  async function bearer() {
    if (token && token.until > now() + 60000) return token.value;
    const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }).toString(),
    });
    if (!res.ok) throw new Error("Can't sign in to SharePoint.");
    const b = await res.json();
    token = { value: b.access_token, until: now() + (Number(b.expires_in) || 3000) * 1000 };
    return token.value;
  }
  async function graph(path, opts = {}) {
    const res = await fetch(path.startsWith("http") ? path : GRAPH + path, { ...opts, headers: { Authorization: `Bearer ${await bearer()}`, "Content-Type": "application/json", Prefer: "HonorNonIndexedQueriesWarningMayFailRandomly", ...(opts.headers || {}) } });
    if (res.status === 204) return null;
    if (!res.ok) throw new Error(`SharePoint answered ${res.status}.`);
    return res.json();
  }
  async function ids() {
    if (!siteId) siteId = (await graph(`/sites/${siteHost}:${sitePath}?$select=id`)).id;
    if (!listId) {
      let url = `/sites/${siteId}/lists?$select=id,displayName&$top=200`;
      while (url && !listId) { const page = await graph(url); listId = (page.value || []).find((l) => l.displayName === LIST)?.id || null; url = page["@odata.nextLink"] || ""; }
      if (!listId) throw new Error(`The list "${LIST}" doesn't exist yet. Open the planner's Payroll page once so it is created.`);
    }
    return { siteId, listId };
  }
  /** Submissions waiting to go (queued, SendOn today or earlier) or waiting for HMRC's answer (pending). */
  async function due(today) {
    const { siteId: s, listId: l } = await ids();
    const out = [];
    let url = `/sites/${s}/lists/${l}/items?$expand=fields&$top=200&$filter=fields/Status eq 'queued' or fields/Status eq 'pending'`;
    while (url) {
      const page = await graph(url);
      for (const it of page.value || []) { const f = it.fields || {}; if (f.Status === "pending" || String(f.SendOn || "") <= today) out.push({ id: it.id, f }); }
      url = page["@odata.nextLink"] || "";
    }
    return out;
  }
  async function patch(id, fields) { const { siteId: s, listId: l } = await ids(); await graph(`/sites/${s}/lists/${l}/items/${id}/fields`, { method: "PATCH", body: JSON.stringify(fields) }); }
  return { due, patch };
}
module.exports = { createList, LIST };
