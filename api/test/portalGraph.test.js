// The SharePoint-backed store, run against a fake Microsoft Graph.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createGraphStore, LISTS } = require("../portal/lib/graphStore.js");
const { bind } = require("../portal/lib/store.js");

function fakeGraph(lists = Object.values(LISTS)) {
  const items = new Map(lists.map((n) => [n, []]));
  const calls = [];
  let nextId = 1;
  const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const fn = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, method: opts.method || "GET", auth: opts.headers && opts.headers.Authorization });
    if (u.includes("login.microsoftonline.com")) return res(200, { access_token: "app-token", expires_in: 3600 });
    if (/\/sites\/[^/]+:\/sites\//.test(u)) return res(200, { id: "site-1" });
    if (/\/sites\/site-1\/lists\?/.test(u)) return res(200, { value: lists.map((n) => ({ id: `L:${n}`, displayName: n })).concat([{ id: "L:PP Clients", displayName: "PP Clients" }]) });
    const m = u.match(/lists\/L:([^/]+)\/items(?:\/(\d+))?(\/fields)?/);
    if (m) {
      const name = decodeURIComponent(m[1]);
      const rows = items.get(name) || (items.set(name, []), items.get(name));
      if ((opts.method || "GET") === "GET") return res(200, { value: rows });
      if (opts.method === "POST") {
        const row = { id: String(nextId++), fields: JSON.parse(opts.body).fields };
        rows.push(row);
        return res(201, row);
      }
      const row = rows.find((r) => r.id === m[2]);
      if (opts.method === "PATCH") { Object.assign(row.fields, JSON.parse(opts.body)); return res(200, row); }
      if (opts.method === "DELETE") { rows.splice(rows.indexOf(row), 1); return res(204); }
    }
    return res(404, {});
  };
  fn.calls = calls;
  fn.items = items;
  return fn;
}

const make = (fetch) => createGraphStore({ tenantId: "t", clientId: "c", clientSecret: "s", siteHost: "h.sharepoint.com", sitePath: "/sites/PP", fetch, now: () => 1e12 });

test("records round-trip through SharePoint list items, using the server's own token", async () => {
  const f = fakeGraph();
  const store = bind(make(f), "p1");
  await store.insert("users", { id: "u1", email: "a@b.co", status: "active" });
  const got = await store.get("users", "u1");
  assert.equal(got.email, "a@b.co");
  assert.equal(got.rev, 1);
  const row = f.items.get("PP Portal Users")[0];
  assert.equal(row.fields.Key, "u1");
  assert.equal(row.fields.PracticeId, "p1");
  assert.equal(row.fields.Ref1, "a@b.co");
  assert.ok(f.calls.filter((c) => c.auth).every((c) => c.auth === "Bearer app-token"));
  const up = await store.update("users", "u1", { status: "suspended" }, 1);
  assert.equal(up.rev, 2);
  assert.equal(JSON.parse(f.items.get("PP Portal Users")[0].fields.Json).status, "suspended");
  await assert.rejects(() => store.update("users", "u1", { status: "x" }, 1), { code: "conflict" });
  await assert.rejects(() => store.insert("users", { id: "u1" }), { code: "exists" });
  await store.remove("users", "u1");
  assert.equal(await store.get("users", "u1"), null);
});

test("another practice's rows in the same list are invisible and untouchable", async () => {
  const f = fakeGraph();
  const raw = make(f);
  await bind(raw, "p1").insert("users", { id: "u1", email: "one@x.co" });
  const p2 = bind(raw, "p2");
  assert.deepEqual(await p2.list("users"), []);
  assert.equal(await p2.get("users", "u1"), null);
  await assert.rejects(() => p2.update("users", "u1", { email: "x" }), { code: "missing" });
  await p2.remove("users", "u1");
  assert.equal(f.items.get("PP Portal Users").length, 1);
});

test("a missing list says how to fix it; a hand-mangled row is ignored, not served", async () => {
  const f = fakeGraph(["PP Portal Users"]);
  const store = bind(make(f), "p1");
  await assert.rejects(() => store.list("access"), /doesn't exist yet/);
  f.items.get("PP Portal Users").push({ id: "99", fields: { Key: "u9", PracticeId: "p1", Json: "{not json" } });
  assert.deepEqual(await store.list("users"), []);
});

test("the planner's own client list can be read (read-only) with the same sign-in", async () => {
  const f = fakeGraph();
  f.items.set("PP Clients", [{ id: "5", fields: { Key: "c1", Title: "Acme" } }]);
  const rows = await make(f).readPlanner("PP Clients");
  assert.deepEqual(rows, [{ id: "5", Key: "c1", Title: "Acme" }]);
});
