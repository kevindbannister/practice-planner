// Tests for the server side of accounts filing. The gateway is faked. NOTHING here proves compatibility with the real Companies House gateway:
// the accounts message format has not been taken from the TIS, and the "spec" and "mapping" used below are invented for the tests.
const test = require("node:test");
const assert = require("node:assert/strict");
const F = require("../cosec/lib/accountsFiling.js");
const gw = require("../cosec/lib/gateway.js");
const lib = require("../shared/plannerlib.js");

const NS = { t: "urn:test-only", xhtml: "http://www.w3.org/1999/xhtml", ix: "http://www.xbrl.org/2013/inlineXBRL", xbrli: "http://www.xbrl.org/2003/instance", link: "http://www.xbrl.org/2003/linkbase", xlink: "http://www.w3.org/1999/xlink", iso4217: "http://www.xbrl.org/2003/iso4217" };
const money = ["calledUpNotPaid", "cash", "netAssets", "shareCapital", "profitAndLoss", "shareholdersFunds"];
const MAP = { id: "t", version: "t", accountsType: "dormant", entryPoint: "urn:test-only:e.xsd", namespaces: NS, identifierScheme: "urn:s", status: "verified", note: "",
  concepts: lib.DORMANT_2025.concepts.map((c) => ({ ...c, concept: `t:${c.field}`, status: "verified", type: money.includes(c.field) ? "monetary" : c.field === "averageEmployees" ? "integer" : ["balanceSheetDate", "periodStart", "periodEnd", "dateAuthorisation"].includes(c.field) ? "date" : c.field === "dormantStatus" ? "boolean" : "string",
    context: (["periodStart", "periodEnd", "dormantStatus", "averageEmployees", "profitAndLoss", "entityName", "companyNumber"].includes(c.field) || c.field.endsWith("Statement")) ? "duration-current" : "instant-current", unit: money.includes(c.field) ? "GBP" : c.field === "averageEmployees" ? "pure" : null, required: true })) };
const col = (asAt) => ({ asAt, calledUpNotPaid: 0, cash: 10000, liabilities: 0, netAssets: 10000, shareCapital: 10000, profitAndLoss: 0, shareholdersFunds: 10000 });
const snap = () => ({ schemaVersion: 1, type: "dormant", company: { name: "Acme Ltd", number: "01234567" }, period: { start: "2025-04-01", end: "2026-03-31", incorporated: "2024-03-10", first: false },
  current: col("2026-03-31"), comparative: col("2025-03-31"), classes: [{ cls: "Ordinary", shares: 100, nominalMicro: 1000000, calledUpPence: 10000, unpaidPence: 0 }], comparativeClasses: [], employees: { average: 0 },
  statements: { dormantThroughout: true, auditExemptS480: true, membersNoAuditS476: true, directorsResponsibilities: true, smallCompaniesRegime: true }, signing: { director: "Ann Able", date: "2026-06-01" }, confirmedBy: "K" });
const ENV = { CH_PRESENTER_ID: "PRES01", CH_PRESENTER_AUTH: "s3cret-code" };
const OK = "<GovTalkMessage xmlns=\"http://www.govtalk.gov.uk/CM/envelope\"><Header><MessageDetails><Class>Accounts</Class><Qualifier>acknowledgement</Qualifier><TransactionID>1</TransactionID></MessageDetails></Header><Body/></GovTalkMessage>";
const SPEC = (sent = []) => ({ verified: true, messageClass: "TESTONLY", source: "test", buildBody: (i) => { sent.push(i); return "<x/>"; } });
const sender = (res, calls = []) => async (_f, url, xml) => { calls.push({ url, xml }); if (res instanceof Error) throw res; return res; };
async function approved() { const store = F.memoryStore(); await F.recordApproval({ store, filingKey: "F1", snapshot: snap(), approvedBy: "Ann Able", approvedOn: "2026-06-01", user: "kev", now: 0 }); return store; }
const base = (store, o = {}) => ({ store, env: ENV, filingKey: "F1", mapping: MAP, user: "kev", spec: SPEC(), sender: sender({ ok: true, status: 200, text: OK }), ...o });
const rejects = async (p, code) => assert.rejects(p, (e) => e.code === code, `expected ${code}`);

test("the real spec and mapping are unverified, so nothing can ever be sent today", async () => {
  assert.equal(F.ACCOUNTS_SPEC.verified, false);
  const store = await approved();
  await rejects(F.submitAccounts({ store, env: ENV, filingKey: "F1", user: "k" }), "ixbrl-unavailable");
  await rejects(F.submitAccounts({ ...base(store), spec: undefined }), "spec-not-verified");
});
test("no storage, no approval, tampered approval, invalid accounts: all refuse before sending", async () => {
  await rejects(F.submitAccounts({ ...base(null) }), "storage-not-configured");
  await rejects(F.submitAccounts(base(F.memoryStore())), "not-approved");
  const store = await approved(); const a = await store.get("approval#F1"); a.snapshot.current.cash = 99999; await store.put("approval#F1", a);
  await rejects(F.submitAccounts(base(store)), "tampered");
  const bad = snap(); bad.current.cash += 1;
  await rejects(F.recordApproval({ store: F.memoryStore(), filingKey: "F2", snapshot: bad, approvedBy: "A", approvedOn: "2026-06-01", user: "k", now: 0 }), "invalid-accounts");
  await rejects(F.recordApproval({ store: F.memoryStore(), filingKey: "F2", snapshot: snap(), approvedBy: "", approvedOn: "", user: "k", now: 0 }), "not-approved");
});
test("a good submission records the attempt first, sends once, and is only acknowledged, not accepted", async () => {
  const store = await approved(), calls = [], sent = [];
  const r = await F.submitAccounts(base(store, { sender: sender({ ok: true, status: 200, text: OK }, calls), spec: SPEC(sent) }));
  assert.equal(r.status, "acknowledged"); assert.equal(r.test, true); assert.equal(calls.length, 1); assert.equal(calls[0].url, F.TEST_URL);
  assert.ok(sent[0].ixbrl.includes("ix:nonFraction")); assert.equal(sent[0].test, true);
  const [a] = await store.list("attempt#F1#"); assert.equal(a.status, "acknowledged"); assert.deepEqual(a.history.map((h) => h.status), ["submitting", "acknowledged"]);
});
test("double submission: a second call, a concurrent call, and a retry after a timeout are all refused", async () => {
  const store = await approved(), calls = [];
  await F.submitAccounts(base(store, { sender: sender({ ok: true, status: 200, text: OK }, calls) }));
  await rejects(F.submitAccounts(base(store, { sender: sender({ ok: true, status: 200, text: OK }, calls) })), "already-submitted");
  assert.equal(calls.length, 1);
  const s2 = await approved(), c2 = []; // timeout
  await rejects(F.submitAccounts(base(s2, { sender: sender(new Error("timeout"), c2) })), "outcome-unknown");
  assert.equal((await s2.list("attempt#F1#"))[0].status, "unknown");
  await rejects(F.submitAccounts(base(s2, { sender: sender({ ok: true, status: 200, text: OK }, c2) })), "already-submitted");
  assert.equal(c2.length, 1, "never resent after an uncertain outcome");
  const s3 = await approved(), c3 = []; // two at once
  const both = await Promise.allSettled([F.submitAccounts(base(s3, { sender: sender({ ok: true, status: 200, text: OK }, c3) })), F.submitAccounts(base(s3, { sender: sender({ ok: true, status: 200, text: OK }, c3) }))]);
  assert.equal(both.filter((x) => x.status === "fulfilled").length, 1); assert.equal(c3.length, 1);
});
test("an HTTP error is an unknown outcome; a refusal is failed and a new attempt is then allowed", async () => {
  const s = await approved();
  await rejects(F.submitAccounts(base(s, { sender: sender({ ok: false, status: 502, text: "" }) })), "outcome-unknown");
  assert.equal((await s.list("attempt#F1#"))[0].status, "unknown");
  const s2 = await approved();
  const refusal = OK.replace("acknowledgement", "error").replace("<Body/>", "<GovTalkDetails><GovTalkErrors><Error><Text>Authentication failure</Text></Error></GovTalkErrors></GovTalkDetails><Body/>");
  await rejects(F.submitAccounts(base(s2, { sender: sender({ ok: true, status: 200, text: refusal }) })), "refused");
  assert.equal((await s2.list("attempt#F1#"))[0].status, "failed");
  const again = await F.submitAccounts(base(s2)); assert.equal(again.attempt, 2);
  assert.equal((await s2.list("attempt#F1#")).length, 2, "the first attempt is kept");
});
test("status: pending then accepted; acknowledgement and unknown words never mean accepted; accepted can't be undone silently", async () => {
  const store = await approved(); const r = await F.submitAccounts(base(store)); const key = (await store.list("attempt#F1#"))[0].key;
  const reply = (code) => `<GovTalkMessage xmlns="http://www.govtalk.gov.uk/CM/envelope"><Body><StatusCode>${code}</StatusCode></Body></GovTalkMessage>`;
  assert.equal((await F.applyStatus({ store, attemptKey: key, reply: reply("PENDING") })).status, "pending");
  assert.equal((await F.applyStatus({ store, attemptKey: key, reply: reply("SOMETHING") })).changed, false);
  assert.equal((await F.applyStatus({ store, attemptKey: key, reply: OK })).changed, false, "an acknowledgement is not acceptance");
  assert.equal((await F.applyStatus({ store, attemptKey: key, reply: "not xml" })).changed, false);
  assert.equal((await F.applyStatus({ store, attemptKey: key, reply: reply("ACCEPT") })).status, "accepted");
  await rejects(F.applyStatus({ store, attemptKey: key, reply: reply("REJECT") }), "conflict");
  assert.equal(r.number.length > 5, true);
});
test("a rejection is stored with its reason and the attempt is kept", async () => {
  const store = await approved(); await F.submitAccounts(base(store)); const key = (await store.list("attempt#F1#"))[0].key;
  const rep = `<GovTalkMessage xmlns="http://www.govtalk.gov.uk/CM/envelope"><Body><StatusCode>REJECT</StatusCode><Description>Balance sheet date missing</Description></Body></GovTalkMessage>`;
  const out = await F.applyStatus({ store, attemptKey: key, reply: rep }); assert.equal(out.status, "rejected");
  const a = await store.get(key); assert.equal(a.detail, "Balance sheet date missing"); assert.ok(a.history.length >= 3);
});
test("environment: test by default; a changed URL, a missing flag or missing evidence can never reach live", () => {
  assert.deepEqual([F.route(ENV, "dormant").ok, F.route(ENV, "dormant").test], [true, true]);
  assert.equal(F.route({ ...ENV, CH_GATEWAY_URL: "https://elsewhere.example/gw" }, "dormant").ok, false);
  assert.equal(F.route({ CH_PRESENTER_ID: "x" }, "dormant").ok, false);
  const live = { ...ENV, CH_GATEWAY_LIVE: "1" };
  assert.equal(F.route(live, "dormant").ok, false);
  assert.equal(F.route({ ...live, CH_LIVE_ACCOUNTS: "dormant" }, "dormant").ok, false, "needs the test evidence too");
  assert.equal(F.route({ ...live, CH_ACCOUNTS_TEST_EVIDENCE: "ref" }, "dormant").ok, false, "needs the type listed");
  const ok = F.route({ ...live, CH_LIVE_ACCOUNTS: "dormant", CH_ACCOUNTS_TEST_EVIDENCE: "CH test sign-off 2026-12-01" }, "dormant"); assert.deepEqual([ok.ok, ok.test], [true, false]);
});
test("secrets are redacted from anything stored or shown", () => {
  const msg = `<Authentication><Method>CHMD5</Method><Value>${F.md5("s3cret-code")}</Value></Authentication> failed for s3cret-code`;
  const out = F.redact(msg, ["s3cret-code"]); assert.ok(!out.includes("s3cret-code") && !out.includes(F.md5("s3cret-code")));
  assert.ok(!F.redact("<Authentication><Value>abcdef</Value></Authentication>").includes("abcdef"));
});
test("replies are read safely: no DOCTYPE or entity tricks", () => {
  const r = F.parseReply('<!DOCTYPE x [<!ENTITY y SYSTEM "file:///etc/passwd">]><a>&y;</a>'); assert.equal(r.readable, false);
  assert.equal(F.parseReply(OK).qualifier, "acknowledgement");
});
test("the existing envelope now carries the test flag Companies House requires for test submissions", () => {
  const x = gw.envelope({ cls: "C", number: "1", presenter: { id: "P", auth: "a" }, test: true, body: "<B/>" });
  assert.ok(x.includes("<GatewayTest>1</GatewayTest>")); assert.ok(!gw.envelope({ cls: "C", number: "1", presenter: { id: "P", auth: "a" }, test: false, body: "<B/>" }).includes("GatewayTest"));
});

test("the API actions refuse today and never take XML or an auth code from the browser", async () => {
  const crypto = require("node:crypto"); void crypto;
  const { createHandler } = require("../cosec/index.js");
  const NOW = Date.UTC(2026, 9, 27, 9, 0, 0), enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const tok = [enc({ alg: "RS256" }), enc({ tid: "69bd0549-2696-4a31-b1ed-66ac01abacf1", appid: "4ad0ec52-92a4-46d3-b1b0-7d3b0a4654a0", aud: "00000003-0000-0000-c000-000000000000", exp: NOW / 1000 + 3600 }), "sig"].join(".");
  const outbound = [];
  const fetch = async (u) => { outbound.push(String(u)); return { ok: true, status: 200, json: async () => ({ id: "me" }), text: async () => "" }; };
  const call = async (action, method, body) => { const h = createHandler({ fetch, env: ENV, now: () => NOW }); const ctx = { bindingData: { action } }; await h(ctx, { method, headers: { "x-pp-token": tok }, body, params: { action } }); return { status: ctx.res.status, body: JSON.parse(ctx.res.body) }; };
  const i = await call("accounts-info", "GET", {}); assert.equal(i.status, 200); assert.equal(i.body.available, false); assert.equal(i.body.reason, "storage-not-configured");
  const r = await call("accounts-submit", "POST", { filingKey: "F1", xml: "<evil/>", authCode: "x" });
  assert.equal(r.status, 503); assert.equal(r.body.error, "storage-not-configured");
  assert.equal((await call("accounts-submit", "POST", { filingKey: "../x" })).status, 400);
  assert.equal(outbound.filter((u) => u.includes("companieshouse")).length, 0, "nothing reaches Companies House");
});

test("the Phase 6 test runner refuses live use and refuses while the spec is unverified", async () => {
  const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
  const { main } = require("../tools/accounts-test-run.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ev-")), file = path.join(dir, "s.json"); fs.writeFileSync(file, JSON.stringify(snap()));
  const env = { ...ENV, CH_TEST_EVIDENCE_DIR: path.join(dir, "ev") };
  assert.equal((await main([file], { ...env, CH_GATEWAY_LIVE: "1" })).code, 2);
  assert.equal((await main([], env)).code, 2);
  const r = await main([file], env); assert.equal(r.code, 1); assert.match(r.message, /ixbrl-unavailable|spec-not-verified/);
  assert.ok(!r.message.includes("s3cret-code"));
});
