// Tests for the Xama bridge, with Microsoft Graph and Xama faked.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHandler, cleanPath } = require("../xama/index.js");

const NOW = Date.UTC(2026, 9, 26, 12, 0, 0);
const TENANT = "69bd0549-2696-4a31-b1ed-66ac01abacf1";
const CLIENT = "4ad0ec52-92a4-46d3-b1b0-7d3b0a4654a0";
const ENV = { XAMA_CLIENT_ID: "abcd1234", XAMA_CLIENT_SECRET: "s3cret", XAMA_TOKEN_URL: "https://auth.xama.test/oauth/token", XAMA_API_BASE: "https://api.xama.test/v1/", XAMA_AUDIENCE: "https://aud.test" };

function msToken() {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return [enc({ alg: "RS256" }), enc({ tid: TENANT, appid: CLIENT, aud: "00000003-0000-0000-c000-000000000000", exp: NOW / 1000 + 3600 }), "sig"].join(".");
}
function res(status, body) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => text, headers: { get: () => null } };
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
const TOKEN_OK = [(u) => u.includes("/oauth/token"), res(200, { access_token: "AT-1", expires_in: 3600, scope: "aml.read" })];
async function call(action, { method = "POST", body = {}, fetch = fakeFetch([TOKEN_OK]), env = ENV, headers = { "x-pp-token": msToken() }, h } = {}) {
  const handler = h || createHandler({ fetch, env, now: () => NOW });
  const context = { bindingData: { action } };
  await handler(context, { method, headers, body });
  return { status: context.res.status, body: JSON.parse(context.res.body), fetch };
}

test("status shows what is set up and never the secret", async () => {
  const r = await call("status", { method: "GET", headers: {} });
  assert.equal(r.status, 200);
  assert.equal(r.body.configured, true);
  assert.equal(r.body.clientIdEnding, "1234");
  assert.equal(r.body.tokenHost, "auth.xama.test");
  assert.ok(!JSON.stringify(r.body).includes("s3cret"));
  const none = await call("status", { method: "GET", headers: {}, env: {} });
  assert.equal(none.body.configured, false);
  assert.deepEqual(none.body.missing, ["XAMA_CLIENT_ID", "XAMA_CLIENT_SECRET"]);
  // Xama's published addresses are the defaults
  assert.equal(none.body.tokenHost, "auth-proxy.xamatech.com");
  assert.equal(none.body.apiBase, "https://xamahub.xamatech.com/api/");
  assert.equal(none.body.audience, "https://api.xamatech.com");
});

test("status refuses http addresses", async () => {
  const r = await call("status", { method: "GET", headers: {}, env: { ...ENV, XAMA_TOKEN_URL: "http://auth.xama.test/t" } });
  assert.deepEqual(r.body.missing, ["XAMA_TOKEN_URL (must start with https://)"]);
});

test("test and call need the Microsoft sign-in", async () => {
  assert.equal((await call("test", { headers: {} })).status, 401);
  assert.equal((await call("call", { headers: {}, body: { path: "clients" } })).status, 401);
});

test("test signs in the way Xama documents (JSON body with audience) and reports the token", async () => {
  const r = await call("test");
  assert.equal(r.body.ok, true);
  assert.match(r.body.steps[0].message, /accepted/);
  const t = r.fetch.calls.find((c) => c.url.includes("/oauth/token"));
  assert.equal(t.opts.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(t.opts.body), { client_id: "abcd1234", client_secret: "s3cret", audience: "https://aud.test", grant_type: "client_credentials" });
  assert.ok(!t.opts.headers.Authorization);
  assert.ok(!JSON.stringify(r.body).includes("AT-1"));
});

test("basic style sends credentials in the Authorization header", async () => {
  const r = await call("test", { env: { ...ENV, XAMA_AUTH_STYLE: "basic" } });
  const t = r.fetch.calls.find((c) => c.url.includes("/oauth/token"));
  assert.equal(t.opts.headers.Authorization, "Basic " + Buffer.from("abcd1234:s3cret").toString("base64"));
  assert.match(t.opts.body, /grant_type=client_credentials/);
});

test("token lifetime comes from the exp claim when Xama gives no expires_in", async () => {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const jwt = `${enc({ alg: "RS256" })}.${enc({ exp: NOW / 1000 + 7200 })}.sig`;
  const r = await call("test", { fetch: fakeFetch([[(u) => u.includes("/oauth/token"), res(200, { access_token: jwt, token_type: "Bearer" })]]) });
  assert.match(r.body.steps[0].message, /120 minutes/);
});

test("body (form) style sends credentials in the form", async () => {
  const r = await call("test", { env: { ...ENV, XAMA_AUTH_STYLE: "body", XAMA_SCOPE: "aml.read" } });
  const t = r.fetch.calls.find((c) => c.url.includes("/oauth/token"));
  assert.ok(!t.opts.headers.Authorization);
  assert.match(t.opts.body, /client_id=abcd1234/);
  assert.match(t.opts.body, /client_secret=s3cret/);
  assert.match(t.opts.body, /scope=aml.read/);
  assert.match(t.opts.body, /audience=/);
});

test("a refused sign-in is explained, with no secret in the answer", async () => {
  const f = fakeFetch([[(u) => u.includes("/oauth/token"), res(401, { error: "invalid_client", error_description: "bad" })]]);
  const r = await call("test", { fetch: f });
  assert.equal(r.body.ok, false);
  assert.match(r.body.steps[0].message, /invalid_client|bad/);
  assert.match(r.body.steps[0].message, /Open API settings/);
  assert.ok(!JSON.stringify(r.body).includes("s3cret"));
});

test("test can read one path and show an excerpt without tokens", async () => {
  const f = fakeFetch([TOKEN_OK, [(u) => u.startsWith("https://api.xama.test/v1/clients"), res(200, { items: [{ name: "A", access_token: "leak" }] })]]);
  const r = await call("test", { fetch: f, body: { path: "/clients" } });
  assert.equal(r.body.ok, true);
  assert.equal(r.body.steps[1].status, 200);
  assert.ok(!r.body.steps[1].sample.includes("leak"));
  const g = f.calls.find((c) => c.url.startsWith("https://api.xama.test/v1/clients"));
  assert.equal(g.opts.headers.Authorization, "Bearer AT-1");
  assert.equal(g.opts.method, undefined); // GET only
});

test("403 and 404 get plain explanations", async () => {
  const f = fakeFetch([TOKEN_OK, [(u) => u.includes("forbidden"), res(403, { e: 1 })], [(u) => u.includes("missing"), res(404, "nope")]]);
  assert.match((await call("test", { fetch: f, body: { path: "forbidden" } })).body.steps[1].message, /refused/);
  assert.match((await call("test", { fetch: f, body: { path: "missing" } })).body.steps[1].message, /doesn't have that path/);
});

test("paths that could escape or smuggle anything are refused", () => {
  for (const bad of ["../x", "a/../b", "https://evil.test/x", "//evil.test/x", "a b", "a?b=1", "", "a#b", "a\\b"]) assert.equal(cleanPath(bad), null, bad);
  assert.equal(cleanPath("/clients/123/aml-checks"), "clients/123/aml-checks");
});

test("call returns data, passes a query, and the token is reused", async () => {
  const f = fakeFetch([TOKEN_OK, [(u) => u.startsWith("https://api.xama.test/v1/clients"), res(200, [{ id: 1 }])]]);
  const h = createHandler({ fetch: f, env: ENV, now: () => NOW });
  const a = await call("call", { h, fetch: f, body: { path: "clients", query: { search: "A&B Ltd", bad: { x: 1 } } } });
  assert.deepEqual(a.body.data, [{ id: 1 }]);
  assert.ok(f.calls.some((c) => c.url === "https://api.xama.test/v1/clients?search=A%26B%20Ltd"));
  await call("call", { h, fetch: f, body: { path: "clients" } });
  assert.equal(f.calls.filter((c) => c.url.includes("/oauth/token")).length, 1);
});

test("a 401 from the API renews the token once", async () => {
  let n = 0;
  const f = fakeFetch([[(u) => u.includes("/oauth/token"), () => res(200, { access_token: "AT-" + ++n, expires_in: 3600 })], [(u, o) => u.includes("/clients") && o.headers.Authorization === "Bearer AT-1", res(401, {})], [(u) => u.includes("/clients"), res(200, { ok: true })]]);
  const r = await call("call", { fetch: f, body: { path: "clients" } });
  assert.deepEqual(r.body.data, { ok: true });
});

test("call says plainly when Xama refuses or isn't set up", async () => {
  const f = fakeFetch([TOKEN_OK, [(u) => u.includes("/clients"), res(500, "boom")]]);
  const r = await call("call", { fetch: f, body: { path: "clients" } });
  assert.equal(r.body.error, "xama");
  const n = await call("call", { env: {}, body: { path: "clients" } });
  assert.equal(n.body.error, "not-configured");
});

// ---------------------------------------------------------------- writing

const ACC = "clients/firm-1/accounts";
const ONB = `${ACC}/acc-1/contacts/con-1/reports/onboarding`;
const AML = `${ACC}/acc-1/contacts/con-1/reports/aml`;

test("writing is limited to creating a client, asking for ID verification, and an AML check", async () => {
  const f = fakeFetch([TOKEN_OK, [(u) => u.startsWith("https://api.xama.test/v1/"), res(201, { id: "acc-9" })]]);
  const create = await call("write", { fetch: f, body: { method: "POST", path: ACC, body: { name: "A", type: "COMPANY" } } });
  assert.deepEqual(create.body.data, { id: "acc-9" });
  const sent = f.calls.find((c) => c.url === "https://api.xama.test/v1/" + ACC);
  assert.equal(sent.opts.method, "POST");
  assert.equal(sent.opts.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(sent.opts.body), { name: "A", type: "COMPANY" });
  assert.equal(sent.opts.headers.Authorization, "Bearer AT-1");
  assert.ok((await call("write", { fetch: f, body: { method: "PUT", path: ONB, body: { config: {} } } })).body.data);
  assert.ok((await call("write", { fetch: f, body: { method: "PUT", path: AML, body: { config: {} } } })).body.data);
});

test("everything else is refused, and nothing is sent", async () => {
  const f = fakeFetch([TOKEN_OK, [() => true, res(200, {})]]);
  const bad = [
    ["DELETE", `${ACC}/acc-1`], ["PATCH", `${ACC}/acc-1`], ["PUT", `${ACC}/acc-1`], ["POST", `${ACC}/acc-1/contacts`],
    ["GET", ACC], ["POST", ONB], ["PUT", ACC], ["POST", "clients/firm-1/subscriptions"], ["POST", "clients/firm-1/accounts/../x"], ["POST", "https://evil.test/x"],
  ];
  for (const [method, path] of bad) {
    const r = await call("write", { fetch: f, body: { method, path, body: { a: 1 } } });
    assert.equal(r.status, 400, `${method} ${path}`);
    assert.equal(r.body.error, "not-allowed");
  }
  assert.equal(f.calls.filter((c) => c.url.startsWith("https://api.xama.test/")).length, 0);
});

test("writing needs the sign-in, a body, and can be switched off", async () => {
  assert.equal((await call("write", { headers: {}, body: { method: "POST", path: ACC, body: { a: 1 } } })).status, 401);
  assert.equal((await call("write", { body: { method: "POST", path: ACC } })).body.error, "bad-body");
  assert.equal((await call("write", { body: { method: "POST", path: ACC, body: [1] } })).body.error, "bad-body");
  assert.equal((await call("write", { body: { method: "POST", path: ACC, body: { x: "y".repeat(9000) } } })).body.error, "bad-body");
  const off = await call("write", { env: { ...ENV, XAMA_READONLY: "1" }, body: { method: "POST", path: ACC, body: { a: 1 } } });
  assert.equal(off.body.error, "read-only");
});

test("Xama's refusals are explained, with its own detail", async () => {
  const f402 = fakeFetch([TOKEN_OK, [(u) => u.includes("/accounts"), res(402, { title: "Payment Required", detail: "feature missing" })]]);
  const a = await call("write", { fetch: f402, body: { method: "POST", path: ACC, body: { a: 1 } } });
  assert.equal(a.body.status, 402);
  assert.match(a.body.message, /plan doesn't have/);
  assert.match(a.body.message, /feature missing/);
  const f409 = fakeFetch([TOKEN_OK, [(u) => u.includes("/accounts"), res(409, {})]]);
  assert.match((await call("write", { fetch: f409, body: { method: "POST", path: ACC, body: { a: 1 } } })).body.message, /already exists/);
});

test("a 204 with no body counts as done", async () => {
  const f = fakeFetch([TOKEN_OK, [(u) => u.includes("/reports/aml"), { ok: true, status: 204, json: async () => { throw new Error("none"); }, text: async () => "", headers: { get: () => null } }]]);
  const r = await call("write", { fetch: f, body: { method: "PUT", path: AML, body: { config: {} } } });
  assert.deepEqual(r.body.data, {});
});

test("reads can use Xama's q:type style filters", async () => {
  const f = fakeFetch([TOKEN_OK, [(u) => u.includes("mail-templates"), res(200, { items: [] })]]);
  await call("call", { fetch: f, body: { path: "clients/firm-1/mail-templates", query: { "q:type": "ONBOARDING", "q:status": "ACTIVE" } } });
  assert.ok(f.calls.some((c) => c.url.endsWith("mail-templates?q%3Atype=ONBOARDING&q%3Astatus=ACTIVE")));
});
