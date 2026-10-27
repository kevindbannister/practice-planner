// Tests for the Co Sec filing bridge, with Microsoft Graph and the Companies House gateway faked.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { createHandler } = require("../cosec/index.js");
const { envelope, parseReply, md5 } = require("../cosec/lib/gateway.js");

const NOW = Date.UTC(2026, 9, 27, 9, 0, 0);
const TENANT = "69bd0549-2696-4a31-b1ed-66ac01abacf1";
const CLIENT = "4ad0ec52-92a4-46d3-b1b0-7d3b0a4654a0";
const token = () => {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return [enc({ alg: "RS256" }), enc({ tid: TENANT, appid: CLIENT, aud: "00000003-0000-0000-c000-000000000000", exp: NOW / 1000 + 3600 }), "sig"].join(".");
};
const ENV = { CH_PRESENTER_ID: "PRES01", CH_PRESENTER_AUTH: "s3cret-code", CH_FILING_SUBMIT_ENABLED: "1" };
const company = { number: "01234567", name: "Acme Ltd", authCode: "ABC123" };
const payload = { address: { premises: "25", line1: "Market Road", town: "London", postcode: "N1 9GU", country: "England" } };

function fakeFetch({ gateway = "<GovTalkMessage><Header><MessageDetails><Qualifier>acknowledgement</Qualifier></MessageDetails></Header></GovTalkMessage>", gatewayStatus = 200 } = {}) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, body: opts.body });
    if (u.startsWith("https://graph.microsoft.com/")) return { ok: true, status: 200, json: async () => ({ id: "me" }) };
    return { ok: gatewayStatus === 200, status: gatewayStatus, text: async () => (typeof gateway === "function" ? gateway(opts.body) : gateway) };
  };
  fn.calls = calls;
  return fn;
}
async function call({ action, method = "POST", body = {}, env = ENV, fetch = fakeFetch(), tok = token() } = {}) {
  const h = createHandler({ fetch, env, now: () => NOW });
  const context = { bindingData: { action } };
  await h(context, { method, headers: tok ? { "x-pp-token": tok } : {}, body, params: { action } });
  return { status: context.res.status, body: JSON.parse(context.res.body), fetch };
}
const gatewayCalls = (f) => f.calls.filter((c) => c.url.includes("companieshouse"));

test("only a signed-in user can use filing", async () => {
  const r = await call({ action: "info", method: "GET", tok: "" });
  assert.equal(r.status, 401);
  assert.equal(gatewayCalls(r.fetch).length, 0);
});

test("info says whether filing is set up and that it is in test mode by default", async () => {
  const r = await call({ action: "info", method: "GET" });
  assert.equal(r.status, 200);
  assert.deepEqual({ configured: r.body.configured, test: r.body.test }, { configured: true, test: true });
  const none = await call({ action: "info", method: "GET", env: {} });
  assert.deepEqual(none.body.missing, ["CH_PRESENTER_ID", "CH_PRESENTER_AUTH"]);
  assert.equal(none.body.configured, false);
});

test("a submission goes to the TEST gateway with the presenter's ID and a hash of the code, never the code", async () => {
  const f = fakeFetch();
  const r = await call({ action: "submit", body: { form: "AD01", payload, company }, fetch: f });
  assert.equal(r.status, 200);
  assert.equal(r.body.test, true);
  assert.match(r.body.gatewayRef, /^\d+$/);
  const [c] = gatewayCalls(f);
  assert.equal(c.url, "https://xmlgw.companieshouse.gov.uk/v1-0/xmlgw/Gateway");
  assert.ok(c.body.includes("<SenderID>PRES01</SenderID>"));
  assert.ok(c.body.includes(`<Value>${crypto.createHash("md5").update("s3cret-code").digest("hex")}</Value>`));
  assert.ok(!c.body.includes("s3cret-code"), "the presenter code is not sent");
  assert.ok(c.body.includes("<Test>1</Test>"));
  assert.ok(c.body.includes("<CompanyNumber>01234567</CompanyNumber>") && c.body.includes("N1 9GU"));
  assert.ok(c.body.includes(`<TransactionID>${r.body.gatewayRef}</TransactionID>`));
});

test("not set up, unsupported forms and incomplete drafts are refused before anything is sent", async () => {
  const f = fakeFetch();
  assert.equal((await call({ action: "submit", body: { form: "AD01", payload, company }, env: {}, fetch: f })).body.error, "not-configured");
  assert.equal((await call({ action: "submit", body: { form: "TM01", payload, company }, fetch: f })).body.error, "unsupported");
  const noPostcode = await call({ action: "submit", body: { form: "AD01", payload: { address: { line1: "x", town: "y", country: "England" } }, company }, fetch: f });
  assert.equal(noPostcode.body.error, "incomplete");
  assert.match(noPostcode.body.message, /postcode/);
  assert.equal((await call({ action: "submit", body: { form: "AD01", payload, company: { number: "01234567", name: "A", authCode: "" } }, fetch: f })).body.error, "incomplete");
  assert.equal(gatewayCalls(f).length, 0);
});

test("going live needs both the switch and the form cleared; otherwise nothing is filed for real", async () => {
  const f = fakeFetch();
  const blocked = await call({ action: "submit", body: { form: "AD01", payload, company }, env: { ...ENV, CH_GATEWAY_LIVE: "1" }, fetch: f });
  assert.equal(blocked.body.error, "not-cleared");
  assert.equal(gatewayCalls(f).length, 0);
  const live = await call({ action: "submit", body: { form: "AD01", payload, company }, env: { ...ENV, CH_GATEWAY_LIVE: "1", CH_LIVE_FORMS: "ad01" }, fetch: f });
  assert.equal(live.body.test, false);
  assert.ok(!gatewayCalls(f)[0].body.includes("<Test>1</Test>"));
});

test("a refusal from the gateway comes back as a plain message", async () => {
  const f = fakeFetch({ gateway: "<GovTalkMessage><Header><MessageDetails><Qualifier>error</Qualifier></MessageDetails></Header><GovTalkDetails><GovTalkErrors><Error><RaisedBy>CH</RaisedBy><Number>502</Number><Type>fatal</Type><Text>Authentication failure</Text></Error></GovTalkErrors></GovTalkDetails></GovTalkMessage>" });
  const r = await call({ action: "submit", body: { form: "AD01", payload, company }, fetch: f });
  assert.equal(r.status, 400);
  assert.match(r.body.message, /Authentication failure/);
  const down = await call({ action: "submit", body: { form: "AD01", payload, company }, fetch: fakeFetch({ gatewayStatus: 503 }) });
  assert.equal(down.status, 502);
});

test("status maps the gateway's answer to pending, accepted or rejected", async () => {
  const reply = (code, extra = "") => `<GovTalkMessage><Header><MessageDetails><Qualifier>response</Qualifier></MessageDetails></Header><Body><SubmissionStatus><StatusCode>${code}</StatusCode>${extra}</SubmissionStatus></Body></GovTalkMessage>`;
  assert.equal((await call({ action: "status", body: { gatewayRef: "123456", test: true }, fetch: fakeFetch({ gateway: reply("PENDING") }) })).body.status, "pending");
  const acc = await call({ action: "status", body: { gatewayRef: "123456", test: true }, fetch: fakeFetch({ gateway: reply("ACCEPTED", "<Reference>CH-99</Reference>") }) });
  assert.deepEqual({ s: acc.body.status, r: acc.body.chRef }, { s: "accepted", r: "CH-99" });
  const rej = await call({ action: "status", body: { gatewayRef: "123456", test: true }, fetch: fakeFetch({ gateway: reply("REJECTED", "<Reject>Postcode not recognised</Reject>") }) });
  assert.deepEqual({ s: rej.body.status, r: rej.body.reason }, { s: "rejected", r: "Postcode not recognised" });
  assert.equal((await call({ action: "status", body: { gatewayRef: "abc", test: true } })).status, 400);
});

test("the envelope escapes what it is given", () => {
  const xml = envelope({ cls: "X", number: "1", presenter: { id: "P<&>", auth: "a", email: "" }, test: false, body: "<B/>" });
  assert.ok(xml.includes("P&lt;&amp;&gt;"));
  assert.equal(md5("a"), "0cc175b9c0f1b6a831c399e269772661");
  assert.deepEqual(parseReply("<x><Qualifier>Response</Qualifier></x>").errors, []);
});

test("status lookup requires the original environment and retains TEST flag after live is enabled", async () => {
  const f = fakeFetch({ gateway: "<GovTalkMessage><Body><StatusCode>PENDING</StatusCode></Body></GovTalkMessage>" });
  const env = { ...ENV, CH_GATEWAY_LIVE: "1", CH_LIVE_FORMS: "AD01" };
  const missing = await call({ action: "status", body: { gatewayRef: "123" }, fetch: f, env });
  assert.equal(missing.status, 400);
  assert.equal(gatewayCalls(f).length, 0);
  const r = await call({ action: "status", body: { gatewayRef: "123", test: true }, fetch: f, env });
  assert.equal(r.status, 200);
  assert.ok(gatewayCalls(f)[0].body.includes("<Test>1</Test>"));
  const notLive = await call({ action: "status", body: { gatewayRef: "123", test: false }, env: ENV, fetch: f });
  assert.equal(notLive.status, 400);
});

test("all gateway submissions remain disabled by default on the live app", async () => {
  const f = fakeFetch();
  const env = { CH_PRESENTER_ID: ENV.CH_PRESENTER_ID, CH_PRESENTER_AUTH: ENV.CH_PRESENTER_AUTH, CH_GATEWAY_LIVE: "1", CH_LIVE_FORMS: "AD01" };
  const r = await call({ action: "submit", body: { form: "AD01", payload, company }, env, fetch: f });
  assert.equal(r.status, 503);
  assert.equal(r.body.error, "filing-disabled");
  assert.equal(gatewayCalls(f).length, 0);
  const info = await call({ action: "info", method: "GET", env, fetch: f });
  assert.equal(info.body.submissionEnabled, false);
});
