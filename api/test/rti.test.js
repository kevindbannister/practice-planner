// Tests for the RTI filing bridge, with Microsoft Graph, HMRC's Transaction Engine and the SharePoint list faked.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { createHandler } = require("../rti/index.js");
const gt = require("../rti/lib/govtalk.js");

const NOW = Date.UTC(2026, 10, 28, 7, 0, 0);
const TENANT = "69bd0549-2696-4a31-b1ed-66ac01abacf1";
const CLIENT = "4ad0ec52-92a4-46d3-b1b0-7d3b0a4654a0";
const token = () => { const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url"); return [enc({ alg: "RS256" }), enc({ tid: TENANT, appid: CLIENT, aud: "00000003-0000-0000-c000-000000000000", exp: NOW / 1000 + 3600 }), "sig"].join("."); };
const ENV = { RTI_SENDER_ID: "AGENT01", RTI_PASSWORD: "p&ss<word", RTI_VENDOR_ID: "1234", RTI_SWEEP_KEY: "k" };
const BODY = '<IRenvelope xmlns="http://www.govtalk.gov.uk/taxation/PAYE/RTI/EmployerPaymentSummary/26-27/1"><IRheader><Keys><Key Type="TaxOfficeNumber">123</Key><Key Type="TaxOfficeReference">AB45678</Key></Keys><PeriodEnd>2027-04-05</PeriodEnd><DefaultCurrency>GBP</DefaultCurrency><IRmark Type="generic">IRMARK</IRmark><Sender>Agent</Sender></IRheader><EmployerPaymentSummary><EmpRefs><OfficeNo>123</OfficeNo><PayeRef>AB45678</PayeRef><AORef>123PA00045678</AORef></EmpRefs><NoPaymentForPeriod>yes</NoPaymentForPeriod><NoPaymentDates><From>2026-06-06</From><To>2026-07-05</To></NoPaymentDates><RelatedTaxYear>26-27</RelatedTaxYear></EmployerPaymentSummary></IRenvelope>';
const msg = (q, extra = "") => `<?xml version="1.0"?><GovTalkMessage xmlns="http://www.govtalk.gov.uk/CM/envelope"><EnvelopeVersion>2.0</EnvelopeVersion><Header><MessageDetails><Class>HMRC-PAYE-RTI-EPS</Class><Qualifier>${q}</Qualifier><Function>submit</Function><CorrelationID>ABC123DEF</CorrelationID>${q === "acknowledgement" ? '<ResponseEndPoint PollInterval="2">https://test-transaction-engine.tax.service.gov.uk/poll</ResponseEndPoint>' : ""}<GatewayTimestamp>2026-11-28T07:00:01</GatewayTimestamp></MessageDetails></Header><GovTalkDetails><Keys/></GovTalkDetails><Body>${extra}</Body></GovTalkMessage>`;

function fakeFetch(answers) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, body: String(opts.body || "") });
    if (u.startsWith("https://graph.microsoft.com/")) return { ok: true, status: 200, json: async () => ({ id: "me" }) };
    const a = answers.shift() || msg("response");
    return { ok: true, status: 200, text: async () => a };
  };
  fn.calls = calls;
  return fn;
}
async function call(h, p, { method = "POST", body = {}, headers = { "x-pp-token": token() } } = {}) {
  const ctx = { bindingData: { path: p } };
  await h(ctx, { method, headers, body });
  return { status: ctx.res.status, body: JSON.parse(ctx.res.body) };
}

test("the IRmark is SHA-1 of the canonical Body without the IRmark element", () => {
  const want = crypto.createHash("sha1").update(`<Body xmlns="http://www.govtalk.gov.uk/CM/envelope">${BODY.replace('<IRmark Type="generic">IRMARK</IRmark>', "")}</Body>`).digest("base64");
  assert.equal(gt.irmark(BODY), want);
});

test("the envelope carries the agent's sign-in, the PAYE keys, the vendor and test flag, and is valid against HMRC's envelope schema", () => {
  const s = gt.settings(ENV);
  const xml = gt.envelope({ cls: "HMRC-PAYE-RTI-EPS", qualifier: "request", fn: "submit", s, keys: { officeNo: "123", payeRef: "AB45678" }, body: BODY, withSender: true });
  assert.match(xml, /<SenderID>AGENT01<\/SenderID>/);
  assert.match(xml, /<Value>p&amp;ss&lt;word<\/Value>/);
  assert.match(xml, /<GatewayTest>1<\/GatewayTest>/);
  assert.match(xml, /<URI>1234<\/URI>/);
  try { execFileSync("xmllint", ["--version"], { stdio: "ignore" }); } catch { return; }
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gt-")), "m.xml");
  fs.writeFileSync(f, xml);
  // the envelope schema imports XML Signature from the web; leave that one choice out so it compiles offline
  const xsd = fs.readFileSync(path.join(__dirname, "../../app/tests/rti/envelope-v2-0-HMRC.xsd"), "utf8").replace(/<xsd:import namespace="http:\/\/www.w3.org\/2000\/09\/xmldsig#"[^>]*\/>/, "").replace(/<xsd:element minOccurs="1" maxOccurs="1" ref="dsig:Signature"\/>/, "");
  const x = path.join(path.dirname(f), "env.xsd"); fs.writeFileSync(x, xsd);
  execFileSync("xmllint", ["--noout", "--schema", x, f], { stdio: "pipe" });
});

test("live mode drops the test flag and uses the live endpoint", () => {
  const s = gt.settings({ ...ENV, RTI_LIVE: "1" });
  assert.equal(s.endpoints.submit, "https://transaction-engine.tax.service.gov.uk/submission");
  assert.ok(!gt.envelope({ cls: "x", qualifier: "poll", fn: "submit", s }).includes("GatewayTest"));
});

test("not signed in, not set up, or not an RTI body is refused", async () => {
  assert.equal((await call(createHandler({ fetch: fakeFetch([]), env: ENV, now: () => NOW }), "send", { headers: {} })).status, 401);
  assert.equal((await call(createHandler({ fetch: fakeFetch([]), env: {}, now: () => NOW }), "send", { body: { kind: "EPS", officeNo: "123", payeRef: "AB45678", body: BODY } })).status, 503);
  assert.equal((await call(createHandler({ fetch: fakeFetch([]), env: ENV, now: () => NOW }), "send", { body: { kind: "EPS", officeNo: "123", payeRef: "AB45678", body: "<x/>" } })).status, 400);
  assert.equal((await call(createHandler({ fetch: fakeFetch([]), env: ENV, now: () => NOW }), "send", { body: { kind: "FPS", officeNo: "123", payeRef: "AB45678", body: BODY } })).status, 400);
});

test("send: acknowledged, polled, accepted, then tidied up", async () => {
  const f = fakeFetch([msg("acknowledgement"), msg("response", "<SuccessResponse><Message>Thank you for your submission</Message></SuccessResponse>"), msg("response")]);
  const r = await call(createHandler({ fetch: f, env: ENV, now: () => NOW, sleep: async () => {} }), "send", { body: { kind: "EPS", officeNo: "123", payeRef: "ab45678", body: BODY } });
  assert.equal(r.body.state, "accepted");
  assert.equal(r.body.correlationId, "ABC123DEF");
  assert.equal(r.body.receipt, "Thank you for your submission");
  const sent = f.calls.filter((c) => c.url.includes("transaction-engine"));
  assert.ok(sent[0].body.includes(`<IRmark Type="generic">${gt.irmark(BODY)}</IRmark>`));
  assert.ok(sent[0].body.includes("<Key Type=\"TaxOfficeReference\">AB45678</Key>"));
  assert.ok(sent[1].body.includes("<Qualifier>poll</Qualifier>"));
  assert.ok(sent[2].body.includes("<Function>delete</Function>"));
});

test("send: HMRC's errors come back to the planner", async () => {
  const err = `<ErrorResponse><Error><RaisedBy>ChRIS</RaisedBy><Number>1046</Number><Type>business</Type><Text>Authentication Failure</Text><Location></Location></Error></ErrorResponse>`;
  const r = await call(createHandler({ fetch: fakeFetch([msg("error", err)]), env: ENV, now: () => NOW }), "send", { body: { kind: "EPS", officeNo: "123", payeRef: "AB45678", body: BODY } });
  assert.equal(r.body.state, "rejected");
  assert.deepEqual(r.body.errors[0], { number: "1046", text: "Authentication Failure", location: "", raisedBy: "ChRIS" });
});

test("poll only goes to HMRC's own address", async () => {
  const f = fakeFetch([msg("acknowledgement")]);
  await call(createHandler({ fetch: f, env: ENV, now: () => NOW }), "poll", { body: { kind: "EPS", correlationId: "ABC123", pollUrl: "https://evil.example.com/poll" } });
  assert.ok(f.calls.some((c) => c.url === "https://test-transaction-engine.tax.service.gov.uk/poll"));
  assert.ok(!f.calls.some((c) => c.url.includes("evil")));
});

test("the scheduled run sends what is due today, checks what is pending, and needs the key", async () => {
  const rows = [
    { id: "1", f: { Status: "queued", Kind: "EPS", SendOn: "2026-11-28", OfficeNo: "123", PayeRef: "AB45678", Body: BODY, Attempts: 0 } },
    { id: "2", f: { Status: "pending", Kind: "EPS", CorrelationID: "ABC123DEF", PollUrl: "https://test-transaction-engine.tax.service.gov.uk/poll" } },
  ];
  const patched = [];
  const list = { due: async (today) => { assert.equal(today, "2026-11-28"); return rows; }, patch: async (id, f) => { patched.push({ id, ...f }); } };
  const h = createHandler({ fetch: fakeFetch([msg("acknowledgement"), msg("response"), msg("response")]), env: ENV, now: () => NOW, list });
  assert.equal((await call(h, "system/due", { headers: { "x-sweep-key": "wrong" } })).status, 401);
  const r = await call(h, "system/due", { headers: { "x-sweep-key": "k" } });
  assert.equal(r.body.checked, 2);
  assert.deepEqual(r.body.done.map((d) => d.state), ["pending", "accepted"]);
  assert.equal(patched.find((p) => p.id === "1" && p.Status === "pending").CorrelationID, "ABC123DEF");
});

test("the scheduled run gives up on a submission after repeated failures", async () => {
  const list = { due: async () => [{ id: "9", f: { Status: "queued", Kind: "EPS", SendOn: "2026-11-01", OfficeNo: "123", PayeRef: "AB45678", Body: BODY, Attempts: 4 } }], patch: async (id, f) => { list.last = f; } };
  const f = async (url) => { if (String(url).includes("graph")) return { ok: true, status: 200, json: async () => ({}) }; throw new Error("down"); };
  const r = await call(createHandler({ fetch: f, env: ENV, now: () => NOW, list }), "system/due", { headers: { "x-sweep-key": "k" } });
  assert.equal(r.body.done[0].state, "failed");
});
