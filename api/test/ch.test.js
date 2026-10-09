// Tests for the Companies House bridge, with Microsoft Graph and Companies House faked.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHandler } = require("../ch/index.js");

const NOW = Date.UTC(2026, 9, 9, 12, 0, 0);
const TENANT = "69bd0549-2696-4a31-b1ed-66ac01abacf1";
const CLIENT = "4ad0ec52-92a4-46d3-b1b0-7d3b0a4654a0";

function token(claims = {}) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return [
    enc({ alg: "RS256", typ: "JWT" }),
    enc({ tid: TENANT, appid: CLIENT, aud: "00000003-0000-0000-c000-000000000000", exp: NOW / 1000 + 3600, ...claims }),
    "signature",
  ].join(".");
}

function fakeFetch({ graphOk = true, ch = { status: 200, body: { company_name: "ACME LTD" } } } = {}) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, headers: opts.headers || {} });
    if (u.startsWith("https://graph.microsoft.com/")) {
      return { ok: graphOk, status: graphOk ? 200 : 401, json: async () => ({ id: "me" }), headers: new Map() };
    }
    const headers = new Map(Object.entries(ch.headers || {}));
    return { ok: ch.status === 200, status: ch.status, json: async () => ch.body, headers: { get: (k) => headers.get(k) } };
  };
  fn.calls = calls;
  return fn;
}

async function call({ path = "company/01234567", tok = token(), env = { CH_API_KEY: "secret-key" }, fetch = fakeFetch(), query = {}, handler } = {}) {
  const h = handler || createHandler({ fetch, env, now: () => NOW });
  const context = { bindingData: { path } };
  await h(context, { headers: tok ? { "x-pp-token": tok } : {}, query, params: { path } });
  return { status: context.res.status, body: JSON.parse(context.res.body), headers: context.res.headers, fetch };
}

test("passes a company profile through, adding the key", async () => {
  const r = await call({ path: "company/oc340377" });
  assert.equal(r.status, 200);
  assert.equal(r.body.company_name, "ACME LTD");
  const ch = r.fetch.calls.find((c) => c.url.startsWith("https://api.company-information"));
  assert.equal(ch.url, "https://api.company-information.service.gov.uk/company/OC340377");
  assert.equal(ch.headers.Authorization, "Basic " + Buffer.from("secret-key:").toString("base64"));
});

test("allows officers and PSC lookups with paging, nothing else", async () => {
  const ok = await call({ path: "company/01234567/officers", query: { items_per_page: "100", other: "x" } });
  assert.equal(ok.status, 200);
  const ch = ok.fetch.calls.find((c) => c.url.includes("company-information"));
  assert.equal(ch.url, "https://api.company-information.service.gov.uk/company/01234567/officers?items_per_page=100");
  assert.equal((await call({ path: "company/01234567/persons-with-significant-control" })).status, 200);
  for (const bad of ["search/companies", "company/123", "company/01234567/charges", "company/../../x", "https://evil.example/x"]) {
    assert.equal((await call({ path: bad })).status, 400, bad);
  }
});

test("says when the key hasn't been added", async () => {
  const r = await call({ env: {} });
  assert.equal(r.status, 503);
  assert.equal(r.body.error, "not-configured");
});

test("refuses calls without a valid sign-in from this tenant and app", async () => {
  assert.equal((await call({ tok: "" })).status, 401);
  assert.equal((await call({ tok: "not-a-token" })).status, 401);
  assert.equal((await call({ tok: token({ tid: "someone-else" }) })).status, 401);
  assert.equal((await call({ tok: token({ appid: "another-app" }) })).status, 401);
  assert.equal((await call({ tok: token({ aud: "api://other" }) })).status, 401);
  assert.equal((await call({ tok: token({ exp: NOW / 1000 - 1 }) })).status, 401);
  // claims look right but Microsoft rejects the token (forged or revoked)
  assert.equal((await call({ fetch: fakeFetch({ graphOk: false }) })).status, 401);
});

test("accepts the token in the Authorization header too", async () => {
  const fetch = fakeFetch();
  const h = createHandler({ fetch, env: { CH_API_KEY: "k" }, now: () => NOW });
  const context = { bindingData: { path: "company/01234567" } };
  await h(context, { headers: { authorization: `Bearer ${token()}` }, query: {} });
  assert.equal(context.res.status, 200);
});

test("checks a sign-in with Microsoft once, then remembers it for a while", async () => {
  const fetch = fakeFetch();
  const handler = createHandler({ fetch, env: { CH_API_KEY: "k" }, now: () => NOW });
  await call({ handler, fetch });
  await call({ handler, fetch });
  assert.equal(fetch.calls.filter((c) => c.url.startsWith("https://graph")).length, 1);
});

test("explains Companies House errors", async () => {
  assert.equal((await call({ fetch: fakeFetch({ ch: { status: 404 } }) })).body.error, "not-found");
  const slow = await call({ fetch: fakeFetch({ ch: { status: 429, headers: { "retry-after": "30" } } }) });
  assert.equal(slow.status, 429);
  assert.equal(slow.headers["Retry-After"], "30");
  const key = await call({ fetch: fakeFetch({ ch: { status: 401 } }) });
  assert.equal(key.status, 502);
  assert.equal(key.body.error, "key-rejected");
  assert.equal((await call({ fetch: fakeFetch({ ch: { status: 500 } }) })).body.error, "upstream");
});

test("never sends the key back to the browser", async () => {
  for (const ch of [{ status: 200, body: {} }, { status: 401 }, { status: 500 }]) {
    const r = await call({ fetch: fakeFetch({ ch }) });
    assert.ok(!JSON.stringify(r).includes("secret-key"));
  }
});
