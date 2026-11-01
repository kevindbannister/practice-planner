// Tests for the Adfin bridge, with Microsoft Graph and Adfin faked.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHandler, seal, unseal, keyFrom, allowed } = require("../adfin/index.js");

const NOW = Date.UTC(2026, 10, 1, 12, 0, 0);
const TENANT = "69bd0549-2696-4a31-b1ed-66ac01abacf1";
const CLIENT = "4ad0ec52-92a4-46d3-b1b0-7d3b0a4654a0";
const ENV = { ADFIN_CLIENT_ID: "adfin-id", ADFIN_CLIENT_SECRET: "adfin-secret" };
const KEY = keyFrom(ENV);
const ID = "69bd0549-2696-4a31-b1ed-66ac01abacf2";

function msToken() {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return [enc({ alg: "RS256" }), enc({ tid: TENANT, appid: CLIENT, aud: "00000003-0000-0000-c000-000000000000", exp: NOW / 1000 + 3600 }), "sig"].join(".");
}
function res(status, body, headers = {}) {
  const h = new Map(Object.entries(headers));
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => (body === undefined ? "" : JSON.stringify(body)), headers: { get: (k) => h.get(k) } };
}
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
  const h = createHandler({ fetch, env, now: () => NOW });
  const context = { bindingData: { action } };
  await h(context, { method, headers, query, body });
  let json = null;
  try { json = context.res.body ? JSON.parse(context.res.body) : null; } catch { json = null; }
  return { status: context.res.status, body: json, headers: context.res.headers, fetch, location: context.res.headers && context.res.headers.Location };
}
const live = (extra = {}) => seal(KEY, { k: "tok", env: "staging", at: "access-1", rt: "refresh-1", exp: NOW + 30 * 60 * 1000, n: 0, ...extra });
const adfinCalls = (r) => r.fetch.calls.filter((c) => c.url.includes("adfin.com"));

test("status says whether Adfin is set up, which Adfin it points at, and the address to register", async () => {
  const r = await call("status", { method: "GET", headers: { host: "kind-smoke.azurestaticapps.net" } });
  assert.deepEqual(r.body, { configured: true, environment: "staging", redirectUri: "https://kind-smoke.azurestaticapps.net/api/adfin/callback", fixed: false });
  assert.equal((await call("status", { method: "GET", env: {} })).body.configured, false);
  assert.equal((await call("status", { method: "GET", env: { ...ENV, ADFIN_ENV: "production" } })).body.environment, "production");
  assert.equal((await call("status", { method: "GET", env: { ...ENV, ADFIN_ENV: "whatever" } })).body.environment, "staging", "anything but production is staging");
});

test("everything but status and the callback needs the Microsoft sign-in and the Azure settings", async () => {
  assert.equal((await call("start", { headers: { host: "x" } })).status, 401);
  assert.equal((await call("call", { env: {} })).status, 503);
  assert.equal((await call("call", { method: "GET" })).status, 400);
  assert.equal((await call("nonsense")).status, 400);
});

test("start sends the person to Adfin's staging sign-in with a sealed state and the two scopes", async () => {
  const r = await call("start", { body: { origin: "https://pp.example.net" } });
  assert.equal(r.status, 200);
  const u = new URL(r.body.url);
  assert.equal(u.origin + u.pathname, "https://staging.adfin.com/auth/login");
  assert.equal(u.searchParams.get("client_id"), "adfin-id");
  assert.equal(u.searchParams.get("scope"), "invoices customers");
  assert.equal(u.searchParams.get("redirect_uri"), "https://pp.example.net/api/adfin/callback");
  assert.equal(unseal(KEY, u.searchParams.get("state")).k, "state");
  const p = await call("start", { env: { ...ENV, ADFIN_ENV: "production" }, body: { origin: "https://pp.example.net" } });
  assert.match(p.body.url, /^https:\/\/console\.adfin\.com\/auth\/login/);
});

test("the callback swaps the code for a sealed connection and sends the browser back to the app", async () => {
  const state = seal(KEY, { k: "state", exp: NOW + 60000, r: "https://pp.example.net/api/adfin/callback" });
  const fetch = fakeFetch([[(u) => u === "https://api.staging.adfin.com/api/oauth2/token", res(200, { access_token: "a", refresh_token: "r", expires_in: 3600, token_type: "Bearer" })]]);
  const r = await call("callback", { method: "GET", headers: {}, query: { code: "abc", state }, fetch });
  assert.match(r.location, /^\/#\/settings\/adfin\/connected\//);
  const t = unseal(KEY, r.location.split("/").pop());
  assert.equal(t.rt, "r"); assert.equal(t.env, "staging"); assert.equal(t.n, 0);
  const sent = new URLSearchParams(adfinCalls(r)[0].opts.body);
  assert.equal(sent.get("grant_type"), "authorization_code"); assert.equal(sent.get("code"), "abc"); assert.equal(sent.get("redirect_uri"), "https://pp.example.net/api/adfin/callback"); assert.equal(sent.get("client_secret"), "adfin-secret");
  // a forged, expired or error callback gets nowhere
  assert.match((await call("callback", { method: "GET", headers: {}, query: { code: "abc", state: "junk" }, fetch })).location, /failed\/expired/);
  assert.match((await call("callback", { method: "GET", headers: {}, query: { code: "abc", state: seal(KEY, { k: "state", exp: NOW - 1 }) }, fetch })).location, /failed\/expired/);
  assert.match((await call("callback", { method: "GET", headers: {}, query: { error: "access_denied" }, fetch })).location, /failed\/access_denied/);
});

test("a live connection is used as it is, with no new sealed copy", async () => {
  const fetch = fakeFetch([[(u) => u.includes("/customers"), res(200, { customers: [] })]]);
  const r = await call("call", { body: { sealed: live(), method: "GET", path: "customers", query: { page: 1 } }, fetch });
  assert.equal(r.status, 200); assert.equal(r.body.sealed, undefined);
  assert.equal(adfinCalls(r)[0].url, "https://api.staging.adfin.com/api/customers?page=1");
  assert.equal(adfinCalls(r)[0].opts.headers.Authorization, "Bearer access-1");
});

test("an expiring connection is refreshed, the new refresh token is sealed and the count goes up", async () => {
  const fetch = fakeFetch([
    [(u) => u.endsWith("/oauth2/token"), res(200, { access_token: "access-2", refresh_token: "refresh-2", expires_in: 3600 })],
    [(u) => u.includes("/customers"), res(200, { customers: [{ id: ID }] })],
  ]);
  const r = await call("call", { body: { sealed: live({ exp: NOW + 60000 }), method: "GET", path: "customers" }, fetch });
  assert.equal(r.status, 200);
  const t = unseal(KEY, r.body.sealed);
  assert.equal(t.rt, "refresh-2"); assert.equal(t.n, 1);
  const refresh = new URLSearchParams(adfinCalls(r)[0].opts.body);
  assert.equal(refresh.get("grant_type"), "refresh_token"); assert.equal(refresh.get("refresh_token"), "refresh-1");
  assert.equal(adfinCalls(r)[1].opts.headers.Authorization, "Bearer access-2");
});

test("a refresh Adfin refuses means connect again; a refresh with no new refresh token is not trusted", async () => {
  const gone = fakeFetch([[(u) => u.endsWith("/oauth2/token"), res(401, { error: "INVALID_REFRESH_TOKEN" })]]);
  const r = await call("call", { body: { sealed: live({ exp: 0 }), method: "GET", path: "customers" }, fetch: gone });
  assert.equal(r.status, 401); assert.equal(r.body.error, "reconnect");
  const odd = fakeFetch([[(u) => u.endsWith("/oauth2/token"), res(200, { access_token: "x" })]]);
  assert.equal((await call("call", { body: { sealed: live({ exp: 0 }), method: "GET", path: "customers" }, fetch: odd })).status, 502);
  assert.equal((await call("call", { body: { sealed: "junk", method: "GET", path: "customers" } })).body.error, "reconnect");
});

test("a connection made for staging is refused when the server is set to production", async () => {
  const r = await call("call", { env: { ...ENV, ADFIN_ENV: "production" }, body: { sealed: live(), method: "GET", path: "customers" } });
  assert.equal(r.status, 401); assert.match(r.body.message, /staging/);
});

test("refresh keeps the connection alive by forcing a renewal", async () => {
  const fetch = fakeFetch([[(u) => u.endsWith("/oauth2/token"), res(200, { access_token: "access-2", refresh_token: "refresh-2", expires_in: 3600 })]]);
  const r = await call("refresh", { body: { sealed: live() }, fetch });
  assert.equal(r.status, 200); assert.equal(unseal(KEY, r.body.sealed).rt, "refresh-2"); assert.equal(r.body.expiresIn, 3600);
  assert.equal(adfinCalls(r).length, 1, "one refresh, not two");
});

test("the app may only ask for what is on the list: no deletes, voids or mandate changes", () => {
  const yes = [["GET", "customers"], ["GET", `customers/${ID}`], ["GET", "customers/directdebitmandates"], ["GET", `schedules/invoices/${ID}`], ["POST", "customers"], ["POST", "schedules/invoices"], ["POST", "payment_requests"], ["PUT", `customers/${ID}/directdebitmandates`], ["PUT", `schedules/invoices/${ID}`], ["PUT", `schedules/invoices/${ID}:activate`], ["PUT", `schedules/invoices/${ID}:cancel`]];
  const no = [["DELETE", `schedules/invoices/${ID}`], ["DELETE", `payments/${ID}`], ["PUT", `customers/directdebitmandates/${ID}:cancel`], ["PUT", `customers/directdebitmandates/${ID}:reinstate`], ["PUT", `invoices/${ID}:void`], ["PUT", `invoices/${ID}:mark-as-paid`], ["POST", "payments:import"], ["POST", "oauth2/token"], ["GET", "apps/x/webhooks"], ["GET", "customers/../apps"], ["PUT", "schedules/invoices/x:activate"], ["GET", `customers/${ID}/extra`]];
  for (const [m, p] of yes) assert.ok(allowed(m, p), `${m} ${p}`);
  for (const [m, p] of no) assert.ok(!allowed(m, p), `${m} ${p}`);
});

test("a write is sent as JSON, and Adfin's refusals come back in plain words", async () => {
  const fetch = fakeFetch([[(u, o) => o.method === "POST" && u.endsWith("/schedules/invoices"), res(422, { message: "startDate must include milliseconds" })]]);
  const r = await call("call", { body: { sealed: live(), method: "POST", path: "schedules/invoices", body: { cadence: {} } }, fetch });
  assert.equal(r.status, 422); assert.match(r.body.message, /milliseconds/);
  const sent = adfinCalls(r)[0].opts;
  assert.equal(sent.headers["Content-Type"], "application/json"); assert.equal(sent.body, '{"cadence":{}}');
  const no = await call("call", { body: { sealed: live(), method: "DELETE", path: `schedules/invoices/${ID}` } });
  assert.equal(no.status, 400); assert.equal(adfinCalls(no).length, 0, "nothing reaches Adfin");
  const ok = fakeFetch([[(u) => u.includes("/customers"), res(201, { id: ID })]]);
  assert.equal((await call("call", { body: { sealed: live(), method: "POST", path: "customers", body: { name: "Acme" } }, fetch: ok })).body.data.id, ID);
  for (const [status, err] of [[401, "reconnect"], [403, "forbidden"], [404, "not-found"], [429, "rate-limited"], [500, "upstream"]]) {
    const f = fakeFetch([[(u) => u.includes("/customers"), res(status, {})]]);
    assert.equal((await call("call", { body: { sealed: live(), method: "GET", path: "customers" }, fetch: f })).body.error, err);
  }
});

test("disconnect revokes the refresh token and never fails the app's own forgetting", async () => {
  const fetch = fakeFetch([[(u) => u.endsWith("/oauth2/revoke"), res(200, {})]]);
  const r = await call("disconnect", { body: { sealed: live() }, fetch });
  assert.equal(r.status, 200); assert.equal(new URLSearchParams(adfinCalls(r)[0].opts.body).get("token"), "refresh-1");
  const down = createHandler({ fetch: async (u) => { if (String(u).includes("graph")) return res(200, {}); throw new Error("down"); }, env: ENV, now: () => NOW });
  const context = { bindingData: { action: "disconnect" } };
  await down(context, { method: "POST", headers: { "x-pp-token": msToken() }, body: { sealed: live() } });
  assert.equal(context.res.status, 200);
});
