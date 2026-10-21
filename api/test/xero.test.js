// Tests for the Xero bridge, with Microsoft Graph and Xero faked.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHandler, seal, unseal, keyFrom, queryString } = require("../xero/index.js");

const NOW = Date.UTC(2026, 9, 21, 12, 0, 0);
const TENANT = "69bd0549-2696-4a31-b1ed-66ac01abacf1";
const CLIENT = "4ad0ec52-92a4-46d3-b1b0-7d3b0a4654a0";
const ORG = "2ae32d9e-4711-4201-9f2a-ac80e5318359";
const ENV = { XERO_CLIENT_ID: "xero-id", XERO_CLIENT_SECRET: "xero-secret" };
const KEY = keyFrom(ENV);

function msToken() {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return [enc({ alg: "RS256" }), enc({ tid: TENANT, appid: CLIENT, aud: "00000003-0000-0000-c000-000000000000", exp: NOW / 1000 + 3600 }), "sig"].join(".");
}

function res(status, body, headers = {}) {
  const h = new Map(Object.entries(headers));
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => (body === undefined ? "" : JSON.stringify(body)), headers: { get: (k) => h.get(k) } };
}

/** A fake fetch: routes are [test(url, opts) -> response] tried in order; every call is recorded. */
function fakeFetch(routes = []) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, opts });
    if (u.startsWith("https://graph.microsoft.com/")) return res(200, { id: "me" });
    for (const [match, answer] of routes) if (match(u, opts)) return typeof answer === "function" ? answer(u, opts) : answer;
    return res(500, { error: "no route" });
  };
  fn.calls = calls;
  return fn;
}

async function call(action, { method = "POST", body = {}, query = {}, fetch = fakeFetch(), env = ENV, headers = { "x-pp-token": msToken(), host: "pp.example.net" } } = {}) {
  const waits = [];
  const h = createHandler({ fetch, env, now: () => NOW, wait: async (ms) => void waits.push(ms) });
  const context = { bindingData: { action } };
  await h(context, { method, headers, query, body });
  let json = null;
  try {
    json = context.res.body ? JSON.parse(context.res.body) : null;
  } catch {
    json = null;
  }
  return { status: context.res.status, body: json, headers: context.res.headers, fetch, waits };
}

const live = (extra = {}) => seal(KEY, { k: "tok", at: "access-1", rt: "refresh-1", exp: NOW + 20 * 60 * 1000, sc: "openid accounting.settings.read", ...extra });

test("sealing round-trips and refuses tampering", () => {
  const s = seal(KEY, { a: 1 });
  assert.deepEqual(unseal(KEY, s), { a: 1 });
  const bad = s.slice(0, -2) + (s.endsWith("A") ? "BB" : "AA");
  assert.equal(unseal(KEY, bad), null);
  assert.equal(unseal(keyFrom({ XERO_CLIENT_SECRET: "other" }), s), null);
});

test("status says whether the app is set up, and the redirect address to register", async () => {
  const r = await call("status", { method: "GET", headers: { host: "kind-smoke.azurestaticapps.net" } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { configured: true, redirectUri: "https://kind-smoke.azurestaticapps.net/api/xero/callback" });
  const n = await call("status", { method: "GET", env: {} });
  assert.equal(n.body.configured, false);
});

test("start needs the Microsoft sign-in and asks Xero for offline access plus the chosen scopes", async () => {
  const no = await call("start", { headers: { host: "x" }, body: { scopes: ["accounting.settings.read"] } });
  assert.equal(no.status, 401);
  const r = await call("start", { body: { scopes: ["accounting.settings.read", "bad scope!", "accountdata.transactions.read"] } });
  assert.equal(r.status, 200);
  const u = new URL(r.body.url);
  assert.equal(u.origin + u.pathname, "https://login.xero.com/identity/connect/authorize");
  assert.equal(u.searchParams.get("client_id"), "xero-id");
  assert.equal(u.searchParams.get("redirect_uri"), "https://pp.example.net/api/xero/callback");
  assert.deepEqual(u.searchParams.get("scope").split(" "), ["offline_access", "openid", "profile", "email", "accounting.settings.read", "accountdata.transactions.read"]);
  assert.equal(unseal(KEY, u.searchParams.get("state")).k, "state");
});

test("the callback swaps the code for tokens and hands the app a sealed copy", async () => {
  const state = seal(KEY, { k: "state", exp: NOW + 60000, n: "1" });
  const fetch = fakeFetch([[(u) => u === "https://identity.xero.com/connect/token", res(200, { access_token: "A", refresh_token: "R", expires_in: 1800, scope: "openid offline_access" })]]);
  const r = await call("callback", { method: "GET", query: { code: "the-code", state }, fetch, headers: { host: "pp.example.net" } });
  assert.equal(r.status, 302);
  const m = r.headers.Location.match(/^\/#\/settings\/xero\/connected\/(.+)$/);
  assert.ok(m);
  const tok = unseal(KEY, m[1]);
  assert.equal(tok.at, "A");
  assert.equal(tok.rt, "R");
  assert.equal(tok.exp, NOW + 1800 * 1000);
  const sent = fetch.calls.find((c) => c.url.includes("/connect/token"));
  assert.match(sent.opts.headers.Authorization, /^Basic /);
  assert.equal(new URLSearchParams(sent.opts.body).get("redirect_uri"), "https://pp.example.net/api/xero/callback");
  // an old or forged state is refused, and Xero's own errors are passed on
  const old = await call("callback", { method: "GET", query: { code: "c", state: seal(KEY, { k: "state", exp: NOW - 1 }) } });
  assert.equal(old.headers.Location, "/#/settings/xero/failed/expired");
  const denied = await call("callback", { method: "GET", query: { error: "invalid_scope" } });
  assert.equal(denied.headers.Location, "/#/settings/xero/failed/invalid_scope");
});

test("a call reads one allowed path with the tenant header", async () => {
  const fetch = fakeFetch([[(u) => u.startsWith("https://api.xero.com/api.xro/2.0/Reports/TrialBalance"), res(200, { Reports: [{ ReportName: "Trial Balance" }] })]]);
  const r = await call("call", { fetch, body: { sealed: live(), tenantId: ORG, api: "accounting", path: "Reports/TrialBalance", query: { date: "2026-04-30" } } });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.Reports[0].ReportName, "Trial Balance");
  assert.equal(r.body.sealed, undefined); // nothing refreshed
  const x = fetch.calls.find((c) => c.url.includes("TrialBalance"));
  assert.equal(x.url, "https://api.xero.com/api.xro/2.0/Reports/TrialBalance?date=2026-04-30");
  assert.equal(x.opts.headers["Xero-Tenant-Id"], ORG);
  assert.equal(x.opts.headers.Accept, "application/json");
  // writing, or paths off the list, are refused
  const bad = await call("call", { body: { sealed: live(), tenantId: ORG, api: "accounting", path: "Invoices/../Users" } });
  assert.equal(bad.status, 400);
  const noOrg = await call("call", { body: { sealed: live(), tenantId: "nope", api: "accounting", path: "Accounts" } });
  assert.equal(noOrg.status, 400);
});

test("an expired access token is renewed first and the new sealed copy comes back", async () => {
  const fetch = fakeFetch([
    [(u) => u.includes("/connect/token"), res(200, { access_token: "A2", refresh_token: "R2", expires_in: 1800 })],
    [(u, o) => u.includes("account-transactions") && o.headers.Authorization === "Bearer A2", res(200, { lines: [], pagination: null })],
  ]);
  const r = await call("call", { fetch, body: { sealed: live({ exp: NOW - 1000 }), tenantId: ORG, api: "accountdata", path: "account-transactions", query: { accountingBasis: "ACCRUAL", startDate: "2025-05-01", endDate: "2026-04-30", accountIds: ["a", "b"] } } });
  assert.equal(r.status, 200);
  const tok = unseal(KEY, r.body.sealed);
  assert.equal(tok.at, "A2");
  assert.equal(tok.rt, "R2");
  assert.match(fetch.calls.find((c) => c.url.includes("account-transactions")).url, /accountIds=a&accountIds=b/);
});

test("a lapsed refresh token asks for a new connection", async () => {
  const fetch = fakeFetch([[(u) => u.includes("/connect/token"), res(400, { error: "invalid_grant" })]]);
  const r = await call("call", { fetch, body: { sealed: live({ exp: NOW - 1 }), tenantId: ORG, api: "accounting", path: "Accounts" } });
  assert.equal(r.status, 401);
  assert.equal(r.body.error, "reconnect");
});

test("Xero's rate limit is waited out when short, and passed back when long", async () => {
  let n = 0;
  const fetch = fakeFetch([[(u) => u.includes("/Accounts"), () => (n++ === 0 ? res(429, {}, { "Retry-After": "3" }) : res(200, { Accounts: [] }))]]);
  const r = await call("call", { fetch, body: { sealed: live(), tenantId: ORG, api: "accounting", path: "Accounts" } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.waits, [3000]);
  const long = await call("call", { fetch: fakeFetch([[(u) => u.includes("/Accounts"), res(429, {}, { "Retry-After": "60" })]]), body: { sealed: live(), tenantId: ORG, api: "accounting", path: "Accounts" } });
  assert.equal(long.status, 429);
  assert.equal(long.body.retryAfter, 60);
});

test("a missing scope is explained", async () => {
  const fetch = fakeFetch([[(u) => u.includes("accountdata"), res(401, { Title: "Unauthorized", Detail: "AuthorizationUnsuccessful" }, { "WWW-Authenticate": 'Bearer error="insufficient_scope"' })]]);
  const r = await call("call", { fetch, body: { sealed: live(), tenantId: ORG, api: "accountdata", path: "account-balances", query: { date: "2026-04-30", accountingBasis: "ACCRUAL" } } });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, "scope");
});

test("connections lists the organisations", async () => {
  const fetch = fakeFetch([[(u) => u === "https://api.xero.com/connections", res(200, [{ id: "c1", tenantId: ORG, tenantName: "Kent Stove", tenantType: "ORGANISATION", createdDateUtc: "2026-10-21T10:00:00" }])]]);
  const r = await call("connections", { fetch, body: { sealed: live() } });
  assert.equal(r.status, 200);
  assert.equal(r.body.tenants[0].tenantName, "Kent Stove");
  const none = await call("connections", { body: { sealed: "rubbish-rubbish-rubbish-rubbish-rubbish-rubbish" } });
  assert.equal(none.status, 401);
});

test("query strings keep repeats and drop odd keys", () => {
  assert.equal(queryString({ where: 'Status=="AUTHORISED"', page: 2, "bad key": "x", ids: ["1", "2"], empty: "" }), "?where=Status%3D%3D%22AUTHORISED%22&page=2&ids=1&ids=2");
});
