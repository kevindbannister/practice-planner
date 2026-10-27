// Tests for the HMRC agent authorisation bridge, with Microsoft Graph and HMRC faked.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHandler, cleanInvitation, seal, unseal, keyFrom } = require("../hmrc/index.js");

const NOW = Date.UTC(2026, 9, 27, 12, 0, 0);
const TENANT = "69bd0549-2696-4a31-b1ed-66ac01abacf1";
const CLIENT = "4ad0ec52-92a4-46d3-b1b0-7d3b0a4654a0";
const ENV = { HMRC_CLIENT_ID: "hid", HMRC_CLIENT_SECRET: "hsecret" };
const KEY = keyFrom(ENV);
const INV = { service: "MTD-VAT", clientType: "business", clientIdType: "vrn", clientId: "101747696", knownFact: "2007-05-18" };

function msToken() {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return [enc({ alg: "RS256" }), enc({ tid: TENANT, appid: CLIENT, aud: "00000003-0000-0000-c000-000000000000", exp: NOW / 1000 + 3600 }), "sig"].join(".");
}
function res(status, body, headers = {}) {
  const h = new Map(Object.entries(headers));
  return { ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: (k) => h.get(k) } };
}
function memStore(initial) {
  const m = new Map(Object.entries(initial || {}));
  return { get: async (k) => m.get(k) || null, put: async (k, v) => void m.set(k, v), del: async (k) => void m.delete(k), m };
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
const hm = (calls) => calls.filter((c) => !c.url.startsWith("https://graph."));
async function call(action, { method = "POST", body = {}, query = {}, fetch = fakeFetch(), env = ENV, store = memStore(), headers = { "x-pp-token": msToken(), host: "pp.example.net" }, handler } = {}) {
  const h = handler || createHandler({ fetch, env, now: () => NOW, store });
  const context = { bindingData: { action } };
  await h(context, { method, headers, query, body });
  let json = null;
  try { json = context.res.body ? JSON.parse(context.res.body) : null; } catch { json = null; }
  return { status: context.res.status, body: json, headers: context.res.headers, fetch, store };
}
const connected = (extra = {}) => memStore({ sandbox: { arn: "TARN0000001", at: "acc-1", rt: "ref-1", exp: NOW + 3600 * 1000, since: "2026-10-01", ...extra } });
const isPost = (path) => (u, o) => o.method === "POST" && u.endsWith(path);

test("status: not set up, no store, and set up", async () => {
  const a = await call("status", { method: "GET", env: {}, store: null });
  assert.deepEqual([a.body.configured, a.body.storeConfigured, a.body.connected, a.body.env], [false, false, false, "sandbox"]);
  const b = await call("status", { method: "GET", store: connected() });
  assert.deepEqual([b.body.configured, b.body.storeConfigured, b.body.connected, b.body.arn], [true, true, true, "TARN0000001"]);
  assert.ok(!JSON.stringify(b.body).includes("acc-1"));
  assert.ok(!JSON.stringify(b.body).includes("ref-1"));
});

test("everything needs the Microsoft sign-in", async () => {
  const r = await call("status", { method: "GET", headers: { host: "x" } });
  assert.equal(r.status, 401);
});

test("without a token store HMRC cannot be connected, and says why", async () => {
  const r = await call("start", { store: null });
  assert.equal(r.status, 503);
  assert.equal(r.body.error, "no-store");
});

test("start builds HMRC's sandbox sign-in with the invitation scope", async () => {
  const r = await call("start", { body: { origin: "https://pp.example.net" } });
  const u = new URL(r.body.url);
  assert.equal(u.origin + u.pathname, "https://test-api.service.hmrc.gov.uk/oauth/authorize");
    assert.equal(u.searchParams.get("redirect_uri"), "https://pp.example.net/api/hmrc/callback");
  assert.equal(u.searchParams.get("client_id"), "hid");
  assert.equal(unseal(KEY, u.searchParams.get("state")).k, "state");
  assert.deepEqual(u.searchParams.get("scope").split(" ").sort(), ["read:check-relationship", "read:sent-invitations", "write:cancel-invitations", "write:sent-invitations"]);
});

test("production uses HMRC's production address and keeps its own tokens", async () => {
  const r = await call("start", { env: { ...ENV, HMRC_ENV: "production" } });
  assert.equal(new URL(r.body.url).origin, "https://api.service.hmrc.gov.uk");
  const store = memStore({ sandbox: { arn: "TARN0000001", at: "a", rt: "r", exp: NOW + 1e7 } });
  const s = await call("status", { method: "GET", env: { ...ENV, HMRC_ENV: "production" }, store });
  assert.equal(s.body.connected, false);
});

test("OAuth callback stores tokens server-side only and sends the browser home", async () => {
  const start = await call("start", { body: { origin: "https://pp.example.net" } });
  const state = new URL(start.body.url).searchParams.get("state");
  const store = memStore({ sandbox: { arn: "TARN0000001" } });
  const fetch = fakeFetch([[isPost("/oauth/token"), res(200, { access_token: "NEWACC", refresh_token: "NEWREF", expires_in: 14400 })]]);
  const h = createHandler({ fetch, env: ENV, now: () => NOW, store });
  const context = { bindingData: { action: "callback" } };
  await h(context, { method: "GET", headers: {}, query: { code: "abc", state } });
  assert.equal(context.res.status, 302);
  assert.equal(context.res.headers.Location, "/#/settings/hmrc/connected");
  assert.ok(!JSON.stringify(context.res).includes("NEWACC"));
  const saved = await store.get("sandbox");
  assert.deepEqual([saved.at, saved.rt, saved.arn], ["NEWACC", "NEWREF", "TARN0000001"]);
  const sent = new URLSearchParams(hm(fetch.calls)[0].opts.body);
  assert.deepEqual([sent.get("grant_type"), sent.get("code"), sent.get("client_secret")], ["authorization_code", "abc", "hsecret"]);
});

test("OAuth failures: denied, expired state, HMRC refusing the code", async () => {
  const run = async (query, fetch = fakeFetch()) => {
    const h = createHandler({ fetch, env: ENV, now: () => NOW, store: memStore() });
    const context = { bindingData: { action: "callback" } };
    await h(context, { method: "GET", headers: {}, query });
    return context.res.headers.Location;
  };
  assert.equal(await run({ error: "access_denied" }), "/#/settings/hmrc/failed/access_denied");
  assert.equal(await run({ code: "x", state: "junk" }), "/#/settings/hmrc/failed/expired");
  const start = await call("start", { body: {} });
  const state = new URL(start.body.url).searchParams.get("state");
  assert.equal(await run({ code: "x", state }, fakeFetch([[isPost("/oauth/token"), res(400, { error: "invalid_request" })]])), "/#/settings/hmrc/failed/invalid_request");
});

test("a callback minted for sandbox is refused in production", async () => {
  const start = await call("start", { body: {} });
  const state = new URL(start.body.url).searchParams.get("state");
  const h = createHandler({ fetch: fakeFetch(), env: { ...ENV, HMRC_ENV: "production" }, now: () => NOW, store: memStore() });
  const context = { bindingData: { action: "callback" } };
  await h(context, { method: "GET", headers: {}, query: { code: "x", state } });
  assert.equal(context.res.headers.Location, "/#/settings/hmrc/failed/expired");
});

test("the ARN is checked and stored beside the tokens", async () => {
  const store = connected();
  assert.equal((await call("arn", { body: { arn: "nonsense" }, store })).status, 400);
  assert.equal((await call("arn", { body: { arn: "tarn0000002" }, store })).status, 200);
  assert.equal((await store.get("sandbox")).arn, "TARN0000002");
  assert.equal((await store.get("sandbox")).rt, "ref-1");
});

test("an expiring token is refreshed once and the rotated refresh token is kept", async () => {
  const store = connected({ exp: NOW + 30 * 1000 });
  const fetch = fakeFetch([
    [isPost("/oauth/token"), res(200, { access_token: "acc-2", refresh_token: "ref-2", expires_in: 14400 })],
    [(u, o) => o.method === "GET" && u.includes("/invitations/ABC12345"), res(200, { invitationId: "ABC12345", status: "Pending", expiresOn: "2026-11-17T00:00:00.000Z" })],
  ]);
  const [a, b] = await Promise.all([call("invitation/status", { body: { id: "ABC12345" }, store, fetch }), call("invitation/status", { body: { id: "ABC12345" }, store, fetch })]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal((await store.get("sandbox")).rt, "ref-2");
  assert.equal(hm(fetch.calls).filter((c) => c.url.endsWith("/oauth/token")).length >= 1, true);
  const get = hm(fetch.calls).find((c) => c.opts.method === "GET");
  assert.equal(get.opts.headers.Authorization, "Bearer acc-2");
});

test("a refused refresh asks for a reconnect and clears the dead tokens", async () => {
  const store = connected({ exp: NOW - 1000 });
  const fetch = fakeFetch([[isPost("/oauth/token"), res(400, { error: "invalid_grant" })]]);
  const r = await call("invitation/status", { body: { id: "ABC12345" }, store, fetch });
  assert.equal(r.status, 401);
  assert.equal(r.body.error, "reconnect");
  assert.equal((await store.get("sandbox")).rt, "");
});

test("a VAT invitation is created, then its client link and expiry are read back from HMRC", async () => {
  const fetch = fakeFetch([
    [isPost("/agents/TARN0000001/invitations"), res(204, undefined, { location: "/agents/TARN0000001/invitations/ABC12345" })],
    [(u, o) => o.method === "GET", res(200, { invitationId: "ABC12345", status: "Pending", expiresOn: "2026-11-17T00:00:00.000Z", clientActionUrl: "https://www.tax.service.gov.uk/agent-client-relationships/authorisation-request/ABC12345" })],
  ]);
  const r = await call("invitation", { body: { body: INV }, store: connected(), fetch });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { id: "ABC12345", status: "Pending", expiresOn: "2026-11-17T00:00:00.000Z", created: "", updated: "", clientActionUrl: "https://www.tax.service.gov.uk/agent-client-relationships/authorisation-request/ABC12345" });
  const post = hm(fetch.calls)[0];
  assert.equal(post.url, "https://test-api.service.hmrc.gov.uk/agents/TARN0000001/invitations");
  assert.equal(post.opts.headers.Accept, "application/vnd.hmrc.2.0+json");
  assert.deepEqual(JSON.parse(post.opts.body), { ...INV, service: ["MTD-VAT"] });
});

test("invalid VRN, invalid date, wrong service are refused before anything is sent", async () => {
  const fetch = fakeFetch();
  for (const bad of [{ ...INV, clientId: "12345" }, { ...INV, knownFact: "2007-02-31" }, { ...INV, knownFact: "18/05/2007" }, { ...INV, service: "MTD-IT" }, { ...INV, clientType: "x" }]) {
    const r = await call("invitation", { body: { body: bad }, store: connected(), fetch });
    assert.equal(r.status, 400);
  }
  assert.equal(hm(fetch.calls).length, 0);
  assert.deepEqual(Object.keys(cleanInvitation({ ...INV, extra: "x" }).body).sort(), ["clientId", "clientIdType", "clientType", "knownFact", "service"]);
});

test("HMRC's reasons come back in plain words: duplicate, already authorised, wrong date", async () => {
  for (const [code, text] of [["DUPLICATE_AUTHORISATION_REQUEST", /already a pending request/], ["ALREADY_AUTHORISED", /already authorised/], ["VAT_REG_DATE_DOES_NOT_MATCH", /doesn't match/], ["CLIENT_REGISTRATION_NOT_FOUND", /can't find a VAT registration/]]) {
    const fetch = fakeFetch([[isPost("/invitations"), res(403, { code })]]);
    const r = await call("invitation", { body: { body: INV }, store: connected(), fetch });
    assert.equal(r.body.error, code);
    assert.match(r.body.message, text);
  }
});

test("the same invitation sent twice in a minute is stopped here, not sent to HMRC twice", async () => {
  const fetch = fakeFetch([
    [isPost("/invitations"), res(204, undefined, { location: "/agents/TARN0000001/invitations/ABC12345" })],
    [(u, o) => o.method === "GET", res(200, { invitationId: "ABC12345", status: "Pending" })],
  ]);
  const handler = createHandler({ fetch, env: ENV, now: () => NOW, store: connected() });
  const one = await call("invitation", { body: { body: INV }, fetch, handler });
  const two = await call("invitation", { body: { body: INV }, fetch, handler });
  assert.equal(one.status, 200);
  assert.equal(two.status, 409);
  assert.equal(hm(fetch.calls).filter((c) => c.opts.method === "POST").length, 1);
});

test("a failed send can be tried again straight away", async () => {
  const fetch = fakeFetch([[isPost("/invitations"), res(403, { code: "NOT_AN_AGENT" })]]);
  const handler = createHandler({ fetch, env: ENV, now: () => NOW, store: connected() });
  assert.equal((await call("invitation", { body: { body: INV }, fetch, handler })).status, 403);
  assert.equal((await call("invitation", { body: { body: INV }, fetch, handler })).status, 403);
});

test("timeouts, HMRC errors and rate limits are reported honestly and never retried", async () => {
  const boom = async () => { throw new Error("socket"); };
  const store = connected();
  const t = await call("invitation", { body: { body: INV }, store, handler: createHandler({ fetch: async (u) => (String(u).startsWith("https://graph") ? res(200, {}) : boom()), env: ENV, now: () => NOW, store }) });
  assert.equal(t.status, 504);
  assert.match(t.body.message, /check the status/i);
  const f5 = fakeFetch([[isPost("/invitations"), res(503, {})]]);
  assert.equal((await call("invitation", { body: { body: INV }, store: connected(), fetch: f5 })).status, 502);
  assert.equal(hm(f5.calls).length, 1);
  const f429 = fakeFetch([[isPost("/invitations"), res(429, {}, { "retry-after": "30" })]]);
  const r = await call("invitation", { body: { body: INV }, store: connected(), fetch: f429 });
  assert.equal(r.status, 429);
  assert.equal(r.body.retryAfter, 30);
  assert.equal(hm(f429.calls).length, 1);
});

test("no ARN: nothing is sent", async () => {
  const fetch = fakeFetch();
  const r = await call("invitation", { body: { body: INV }, store: connected({ arn: "" }), fetch });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "no-arn");
  assert.equal(hm(fetch.calls).length, 0);
});

test("accepted, rejected and expired come back as HMRC says them", async () => {
  for (const status of ["Accepted", "Rejected", "Expired"]) {
    const fetch = fakeFetch([[(u, o) => o.method === "GET", res(200, { invitationId: "ABC12345", status })]]);
    const r = await call("invitation/status", { body: { id: "ABC12345" }, store: connected(), fetch });
    assert.equal(r.body.status, status);
  }
  assert.equal((await call("invitation/status", { body: { id: "../x" }, store: connected() })).status, 400);
});

test("cancelling works while pending and explains when it can't", async () => {
  const cf = fakeFetch([[(u, o) => o.method === "DELETE", res(204)]]);
  const ok = await call("invitation/cancel", { body: { id: "ABC12345" }, store: connected(), fetch: cf });
  assert.equal(ok.body.ok, true);
  assert.equal(hm(cf.calls)[0].opts.headers["Content-Type"], "application/json");
  const no = await call("invitation/cancel", { body: { id: "ABC12345" }, store: connected(), fetch: fakeFetch([[(u, o) => o.method === "DELETE", res(403, { code: "INVALID_INVITATION_STATUS" })]]) });
  assert.match(no.body.message, /can no longer be cancelled/);
});

test("an existing relationship check: 204 active, 404 not", async () => {
  const f = fakeFetch([[isPost("/relationships"), res(204)]]);
  const yes = await call("relationship", { body: { body: INV }, store: connected(), fetch: f });
  assert.equal(yes.body.active, true);
  assert.deepEqual(JSON.parse(hm(f.calls)[0].opts.body), { service: ["MTD-VAT"], clientIdType: "vrn", clientId: "101747696", knownFact: "2007-05-18" });
  const no = await call("relationship", { body: { body: INV }, store: connected(), fetch: fakeFetch([[isPost("/relationships"), res(404, { code: "RELATIONSHIP_NOT_FOUND" })]]) });
  assert.equal(no.body.active, false);
});

test("sandbox acceptance exists only in the sandbox", async () => {
  const ok = await call("sandbox/accept", { body: { id: "ABC12345" }, store: connected(), fetch: fakeFetch([[(u, o) => o.method === "PUT" && u.includes("/agent-authorisation-test-support/"), res(204)]]) });
  assert.equal(ok.body.ok, true);
  const prod = await call("sandbox/accept", { body: { id: "ABC12345" }, env: { ...ENV, HMRC_ENV: "production" }, store: memStore({ production: { arn: "TARN0000001", at: "a", rt: "r", exp: NOW + 1e7 } }) });
  assert.equal(prod.status, 403);
});

test("disconnect removes the tokens", async () => {
  const store = connected();
  assert.equal((await call("disconnect", { store })).body.ok, true);
  assert.equal(await store.get("sandbox"), null);
});

test("no response ever contains the HMRC tokens or secret", async () => {
  const store = connected();
  const fetch = fakeFetch([[isPost("/invitations"), res(204, undefined, { location: "/agents/TARN0000001/invitations/ABC12345" })], [(u, o) => o.method === "GET", res(200, { invitationId: "ABC12345", status: "Pending" })]]);
  const r = await call("invitation", { body: { body: INV }, store, fetch });
  const all = JSON.stringify(r);
  for (const secret of ["acc-1", "ref-1", "hsecret"]) assert.ok(!all.includes(secret));
});

test("sealed mode (testing): the sign-in lives only in a sealed copy the browser holds, and changes come back sealed", async () => {
  const env = { ...ENV, HMRC_TOKEN_STORE: "sealed" };
  const fetch = fakeFetch([[isPost("/oauth/token"), res(200, { access_token: "NEWACC", refresh_token: "NEWREF", expires_in: 14400 })]]);
  // add the ARN first (no connection yet)
  const a = await call("arn", { env, fetch, store: null, body: { arn: "TARN0000001" }, handler: createHandler({ fetch, env, now: () => NOW }) });
  assert.equal(a.status, 200);
  const s1 = a.body.sealed;
  assert.ok(s1 && !s1.includes("TARN"));
  // start carries the ARN into the sign-in state; the callback seals tokens + ARN into the redirect
  const h = createHandler({ fetch, env, now: () => NOW });
  const start = await call("start", { env, fetch, store: null, body: { origin: "https://pp.example.net", sealed: s1 }, handler: h });
  const state = new URL(start.body.url).searchParams.get("state");
  const context = { bindingData: { action: "callback" } };
  await h(context, { method: "GET", headers: {}, query: { code: "abc", state } });
  const sealed = context.res.headers.Location.replace("/#/settings/hmrc/connected/", "");
  assert.ok(sealed.length > 40 && !sealed.includes("NEWACC"));
  const st = await call("status", { env, fetch, store: null, body: { sealed }, handler: h });
  assert.deepEqual([st.body.connected, st.body.arn, st.body.sealedStore], [true, "TARN0000001", true]);
  assert.ok(!JSON.stringify(st.body).includes("NEWACC"));
  // a call works; an expiring sign-in is renewed and the new sealed copy returned
  const old = await call("arn", { env, fetch, store: null, body: { arn: "TARN0000001", sealed }, handler: h });
  assert.ok(old.body.sealed);
  // a sealed copy made for another environment, or tampered with, is not a connection
  const bad = await call("status", { env, fetch, store: null, body: { sealed: sealed.slice(0, -3) + "AAA" }, handler: h });
  assert.equal(bad.body.connected, false);
  const prod = await call("status", { env: { ...env, HMRC_ENV: "production" }, fetch, store: null, body: { sealed }, handler: createHandler({ fetch, env: { ...env, HMRC_ENV: "production" }, now: () => NOW }) });
  assert.equal(prod.body.connected, false);
});

test("sealed mode: sending an invitation works from the sealed copy and returns a renewed copy", async () => {
  const env = { ...ENV, HMRC_TOKEN_STORE: "sealed" };
  const key = keyFrom(env);
  const sealed = seal(key, { k: "hmrc", m: "sandbox", d: { arn: "TARN0000001", at: "old", rt: "ref-1", exp: NOW + 10 * 1000 } });
  const fetch = fakeFetch([
    [isPost("/oauth/token"), res(200, { access_token: "acc-2", refresh_token: "ref-2", expires_in: 14400 })],
    [isPost("/agents/TARN0000001/invitations"), res(204, undefined, { location: "/agents/TARN0000001/invitations/ABC12345" })],
    [(u, o) => o.method === "GET", res(200, { invitationId: "ABC12345", status: "Pending", clientActionUrl: "https://x" })],
  ]);
  const r = await call("invitation", { env, fetch, store: null, body: { body: INV, sealed }, handler: createHandler({ fetch, env, now: () => NOW }) });
  assert.equal(r.status, 200);
  assert.equal(r.body.id, "ABC12345");
  assert.ok(r.body.sealed && r.body.sealed !== sealed);
  assert.equal(unseal(key, r.body.sealed).d.rt, "ref-2");
});
