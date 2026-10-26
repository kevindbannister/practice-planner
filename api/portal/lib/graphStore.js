// The portal's store on SharePoint lists, reached with the server's own Microsoft Graph sign-in
// (an app registration with access to the planner's site only; its secret lives in Azure
// settings and never reaches a browser). The lists themselves are created by the planner app
// the first time staff open it (see app/src/lib/schema.ts, "Portal" lists).
//
// Each record is one list item: Key (the id), PracticeId, Ref1 and Ref2 (handy to look at in
// SharePoint), Rev (for change checks) and Json (the record).

const { StoreError } = require("./store.js");

// collection -> list name. Keep in step with app/src/lib/schema.ts (a test checks this).
const LISTS = {
  users: "PP Portal Users",
  access: "PP Portal Access",
  audit: "PP Portal Audit",
  invites: "PP Portal Invites",
  documents: "PP Portal Documents",
  signing: "PP Portal Signing",
  identity: "PP Portal Identity",
  requests: "PP Portal Requests",
  messages: "PP Portal Messages",
  changes: "PP Portal Changes",
  notices: "PP Portal Notices",
  reminders: "PP Portal Reminders",
};

const GRAPH = "https://graph.microsoft.com/v1.0";
const REF = { users: ["email", "status"], access: ["userId", "clientKey"], audit: ["type", "clientKey"], documents: ["clientKey", "category"], signing: ["clientKey", "status"], identity: ["userId", "status"], requests: ["clientKey", "status"], messages: ["clientKey", "threadId"], changes: ["clientKey", "status"], notices: ["userId", "clientKey"], reminders: ["clientKey", "kind"], invites: ["email", "status"] };

function createGraphStore({ tenantId, clientId, clientSecret, siteHost, sitePath, fetch = globalThis.fetch, now = () => Date.now() }) {
  let token = null; // { value, until }
  let siteId = null;
  const listIds = new Map();

  async function bearer() {
    if (token && token.until > now() + 60000) return token.value;
    const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }).toString(),
    });
    if (!res.ok) throw new StoreError("unavailable", "The portal can't reach its data right now");
    const b = await res.json();
    token = { value: b.access_token, until: now() + (Number(b.expires_in) || 3000) * 1000 };
    return token.value;
  }

  async function graph(path, opts = {}) {
    const res = await fetch(path.startsWith("http") ? path : GRAPH + path, {
      ...opts,
      headers: { Authorization: `Bearer ${await bearer()}`, "Content-Type": "application/json", ...(opts.headers || {}) },
    });
    if (res.status === 204) return null;
    if (res.status === 404) return undefined;
    if (!res.ok) throw new StoreError("unavailable", `The portal's data store answered ${res.status}`);
    return res.json();
  }

  async function site() {
    if (siteId) return siteId;
    const s = await graph(`/sites/${siteHost}:${sitePath}?$select=id`);
    if (!s) throw new StoreError("unavailable", "The planner's SharePoint site wasn't found");
    siteId = s.id;
    return siteId;
  }

  async function listId(coll) {
    if (listIds.has(coll)) return listIds.get(coll);
    const name = LISTS[coll];
    if (!name) throw new StoreError("invalid", `Unknown collection ${coll}`);
    const sid = await site();
    let url = `/sites/${sid}/lists?$select=id,displayName&$top=200`;
    while (url) {
      const page = await graph(url);
      const hit = (page?.value || []).find((l) => l.displayName === name);
      if (hit) {
        listIds.set(coll, hit.id);
        return hit.id;
      }
      url = page?.["@odata.nextLink"] || "";
    }
    throw new StoreError("unavailable", `The list "${name}" doesn't exist yet. Open the planner once as staff so it is created.`);
  }

  async function items(coll) {
    const sid = await site();
    const lid = await listId(coll);
    const out = [];
    let url = `/sites/${sid}/lists/${lid}/items?$expand=fields($select=Key,PracticeId,Rev,Json)&$top=999`;
    while (url) {
      const page = await graph(url);
      for (const it of page?.value || []) {
        try {
          const doc = JSON.parse(it.fields?.Json || "null");
          if (doc && it.fields?.Key) out.push({ itemId: it.id, doc });
        } catch {
          /* a row someone edited by hand into nonsense is ignored, not served */
        }
      }
      url = page?.["@odata.nextLink"] || "";
    }
    return out;
  }

  const fieldsFor = (coll, doc) => {
    const [a, b] = REF[coll] || [];
    return { Title: String(doc.id).slice(0, 250), Key: doc.id, PracticeId: doc.practiceId, Rev: String(doc.rev || 1), Ref1: String((a && doc[a]) || "").slice(0, 250), Ref2: String((b && doc[b]) || "").slice(0, 250), Json: JSON.stringify(doc) };
  };

  async function find(pid, coll, id) {
    return (await items(coll)).find((x) => x.doc.id === id && x.doc.practiceId === pid) || null;
  }

  return {
    kind: "sharepoint",
    LISTS,
    token: bearer,
    async list(pid, coll) {
      return (await items(coll)).map((x) => x.doc).filter((d) => d.practiceId === pid);
    },
    async get(pid, coll, id) {
      return (await find(pid, coll, id))?.doc || null;
    },
    async insert(pid, coll, doc) {
      if (!doc.id) throw new StoreError("invalid", "A record needs an id");
      if (await find(pid, coll, doc.id)) throw new StoreError("exists", "Already exists");
      const full = { ...doc, practiceId: pid, rev: 1 };
      const sid = await site();
      const lid = await listId(coll);
      await graph(`/sites/${sid}/lists/${lid}/items`, { method: "POST", body: JSON.stringify({ fields: fieldsFor(coll, full) }) });
      return full;
    },
    async update(pid, coll, id, patch, expectedRev) {
      const cur = await find(pid, coll, id);
      if (!cur) throw new StoreError("missing", "Not found");
      if (expectedRev !== undefined && cur.doc.rev !== expectedRev) throw new StoreError("conflict", "Changed by someone else");
      const next = { ...cur.doc, ...patch, id, practiceId: pid, rev: cur.doc.rev + 1 };
      const sid = await site();
      const lid = await listId(coll);
      await graph(`/sites/${sid}/lists/${lid}/items/${cur.itemId}/fields`, { method: "PATCH", body: JSON.stringify(fieldsFor(coll, next)) });
      return next;
    },
    async remove(pid, coll, id) {
      const cur = await find(pid, coll, id);
      if (!cur) return;
      const sid = await site();
      const lid = await listId(coll);
      await graph(`/sites/${sid}/lists/${lid}/items/${cur.itemId}`, { method: "DELETE" });
    },
    async append(pid, coll, doc) {
      return this.insert(pid, coll, doc);
    },
    /** Rows of one of the planner's own lists (clients, contacts), read-only, by list display name. */
    async readPlanner(displayName) {
      const sid = await site();
      let lid = listIds.get(`planner:${displayName}`);
      if (!lid) {
        let url = `/sites/${sid}/lists?$select=id,displayName&$top=200`;
        while (url && !lid) {
          const page = await graph(url);
          lid = (page?.value || []).find((l) => l.displayName === displayName)?.id;
          url = page?.["@odata.nextLink"] || "";
        }
        if (!lid) throw new StoreError("unavailable", `The list "${displayName}" wasn't found`);
        listIds.set(`planner:${displayName}`, lid);
      }
      const out = [];
      let url = `/sites/${sid}/lists/${lid}/items?$expand=fields&$top=999`;
      while (url) {
        const page = await graph(url);
        for (const it of page?.value || []) out.push({ id: it.id, ...(it.fields || {}) });
        url = page?.["@odata.nextLink"] || "";
      }
      return out;
    },
  };
}

module.exports = { createGraphStore, LISTS };
