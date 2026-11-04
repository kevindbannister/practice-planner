// Tests for the shared HMRC filing bridge: secrets, GovTalk, the environment gate and the handler, with Microsoft Graph and HMRC faked.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const gt = require("../filing/lib/govtalk.js");
const { createSecrets } = require("../filing/lib/secrets.js");
const { envGate } = require("../filing/lib/gate.js");
const { createHandler } = require("../filing/index.js");

const NOW = Date.UTC(2026, 10, 28, 7, 0, 0);
const TENANT = "69bd0549-2696-4a31-b1ed-66ac01abacf1";
const CLIENT = "4ad0ec52-92a4-46d3-b1b0-7d3b0a4654a0";
const token = () => { const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url"); return [enc({ alg: "RS256" }), enc({ tid: TENANT, appid: CLIENT, aud: "00000003-0000-0000-c000-000000000000", exp: NOW / 1000 + 3600 }), "sig"].join("."); };
const ENV = { FILING_VENDOR_ID: "1234", FILING_SENDER_ID: "AGENT01", FILING_PASSWORD: "p&ss<word" };
const BODY = '<IRenvelope xmlns="http://example.test/ns"><IRheader><Keys><Key Type="UTR">1234567890</Key></Keys><IRmark Type="generic">IRMARK</IRmark></IRheader><Return>x</Return></IRenvelope>';
const FAKE = { service: "SA100", messageClass: "TEST-CLASS", keys: (k) => [{ type: "UTR", value: k.utr || "0000000000" }], check: (b) => (b.includes("<IRenvelope") ? "" : "Not a test return.") };
const msg = (q, extra = "") => `<?xml version="1.0"?><GovTalkMessage xmlns="http://www.govtalk.gov.uk/CM/envelope"><EnvelopeVersion>2.0</EnvelopeVersion><Header><MessageDetails><Class>TEST-CLASS</Class><Qualifier>${q}</Qualifier><Function>submit</Function><CorrelationID>ABC123DEF</CorrelationID>${q === "acknowledgement" ? '<ResponseEndPoint PollInterval="2">https://test-transaction-engine.tax.service.gov.uk/poll</ResponseEndPoint>' : ""}<GatewayTimestamp>2026-11-28T07:00:01</GatewayTimestamp></MessageDetails></Header><GovTalkDetails><Keys/></GovTalkDetails><Body>${extra}</Body></GovTalkMessage>`;
function fakeFetch(answers = []) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, body: String(opts.body || "") });
    if (u.startsWith("https://graph.microsoft.com/")) return { ok: true, status: 200, json: async () => ({ id: "me" }) };
    return { ok: true, status: 200, text: async () => answers.shift() || msg("response") };
  };
  fn.calls = calls;
  return fn;
}
const withAdapter = (fn) => async () => { gt.registerAdapter(FAKE); try { await fn(); } finally { gt._adapters.delete("SA100"); } };
async function call(h, p, { method = "POST", body = {}, headers = { "x-pp-token": token() } } = {}) {
  const ctx = { bindingData: { path: p } };
  await h(ctx, { method, headers, body });
  return { status: ctx.res.status, body: JSON.parse(ctx.res.body) };
}

// ------------------------------------------------------------- secrets

test("settings secrets: status says what is set and never shows a value", async () => {
  const s = createSecrets({ env: { ...ENV, FILING_PASSWORD: "" } });
  const st = await s.status();
  assert.equal(st.provider, "settings");
  assert.deepEqual(st.set, { FILING_VENDOR_ID: true, FILING_SENDER_ID: true, FILING_PASSWORD: false });
  assert.equal(JSON.stringify(st).includes("AGENT01"), false);
  await assert.rejects(() => s.get("PATH"), /isn't a filing secret/);
});

test("key vault with a service principal: signs in once, reads secrets by their dashed names, caches them", async () => {
  const calls = [];
  const fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    if (String(url).startsWith("https://login.microsoftonline.com/")) return { ok: true, json: async () => ({ access_token: "T", expires_in: 3600 }) };
    if (String(url).includes("FILING-PASSWORD")) return { ok: true, status: 200, json: async () => ({ value: "pw" }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const s = createSecrets({ env: { FILING_KV_VAULT: "myvault", FILING_KV_TENANT_ID: "t", FILING_KV_CLIENT_ID: "c", FILING_KV_CLIENT_SECRET: "x" }, fetch, now: () => NOW });
  assert.equal(s.provider, "keyvault");
  assert.equal(await s.get("FILING_PASSWORD"), "pw");
  assert.equal(await s.get("FILING_PASSWORD"), "pw");
  assert.equal(await s.get("FILING_SENDER_ID"), "");
  assert.equal(calls.filter((c) => c.url.includes("login.microsoftonline.com")).length, 1);
  assert.equal(calls.filter((c) => c.url.includes("FILING-PASSWORD")).length, 1);
  const read = calls.find((c) => c.url.includes("FILING-PASSWORD"));
  assert.match(read.url, /^https:\/\/myvault\.vault\.azure\.net\/secrets\/FILING-PASSWORD\?api-version=/);
  assert.equal(read.opts.headers.Authorization, "Bearer T");
  const st = await s.status();
  assert.equal(st.signIn, "service principal"); assert.deepEqual(st.set, { FILING_VENDOR_ID: false, FILING_SENDER_ID: false, FILING_PASSWORD: true });
});

test("key vault with a managed identity uses the identity endpoint", async () => {
  const urls = [];
  const fetch = async (url, opts = {}) => { urls.push([String(url), opts.headers]); return String(url).startsWith("http://identity") ? { ok: true, json: async () => ({ access_token: "M", expires_in: 3600 }) } : { ok: true, status: 200, json: async () => ({ value: "v" }) }; };
  const s = createSecrets({ env: { FILING_KV_VAULT: "v1", IDENTITY_ENDPOINT: "http://identity/msi", IDENTITY_HEADER: "hdr" }, fetch, now: () => NOW });
  assert.equal(await s.get("FILING_VENDOR_ID"), "v");
  assert.match(urls[0][0], /resource=https%3A%2F%2Fvault\.azure\.net/);
  assert.equal(urls[0][1]["X-IDENTITY-HEADER"], "hdr");
  assert.equal((await s.status()).signIn, "managed identity");
});

test("a key vault that won't sign in is reported, not hidden", async () => {
  const s = createSecrets({ env: { FILING_KV_VAULT: "v", FILING_KV_TENANT_ID: "t", FILING_KV_CLIENT_ID: "c", FILING_KV_CLIENT_SECRET: "x" }, fetch: async () => ({ ok: false, status: 401, json: async () => ({}) }) });
  await assert.rejects(() => s.get("FILING_PASSWORD"), /wouldn't sign in/);
  const st = await s.status();
  assert.match(st.error, /wouldn't sign in/); assert.equal(st.set.FILING_PASSWORD, false);
});

// ------------------------------------------------------------- the gate

test("the environment gate: mock always, test needs HMRC's credentials, live is off by default", () => {
  const none = { vendorIdSet: false, testCredentialsSet: false, liveEnabled: false, liveApprovedBy: "" };
  assert.equal(envGate("mock", none).ok, true);
  assert.match(envGate("ets", none).reason, /vendor ID/);
  assert.match(envGate("ets", { ...none, vendorIdSet: true }).reason, /test credentials/);
  assert.equal(envGate("ets", { ...none, vendorIdSet: true, testCredentialsSet: true }).ok, true);
  assert.match(envGate("live", { ...none, vendorIdSet: true, testCredentialsSet: true }).reason, /switched off/);
  assert.match(envGate("live", { ...none, vendorIdSet: true, liveEnabled: true }).reason, /named person/);
  assert.equal(envGate("live", { vendorIdSet: true, testCredentialsSet: true, liveEnabled: true, liveApprovedBy: "Kevin" }).ok, true);
  assert.equal(envGate("nope", none).ok, false);
});

// ------------------------------------------------------------- GovTalk

test("the IRmark is SHA-1 of the canonical Body without the IRmark element", () => {
  const want = crypto.createHash("sha1").update(`<Body xmlns="http://www.govtalk.gov.uk/CM/envelope">${BODY.replace('<IRmark Type="generic">IRMARK</IRmark>', "")}</Body>`).digest("base64");
  assert.equal(gt.irmark(BODY), want);
  assert.equal(gt.irmark(BODY.replace("IRMARK", "something else")), want);
});

test("a body that isn't in canonical form is caught before it is hashed", () => {
  assert.deepEqual(gt.canonicalProblems(BODY), []);
  assert.match(gt.canonicalProblems(`<?xml version="1.0"?>${BODY}`)[0], /declaration/);
  assert.match(gt.canonicalProblems(BODY.replace("<Return>", "\n  <Return>"))[0], /whitespace/);
  assert.match(gt.canonicalProblems(BODY.replace("<Return>x</Return>", "<Return/>"))[0], /empty element/);
  assert.match(gt.canonicalProblems(BODY.replace("<Return>", "<!--hi--><Return>"))[0], /comment/);
});

test("with no adapter registered every service is blocked, and says why", async () => {
  for (const service of ["SA100", "SA800", "CT600"]) {
    const a = gt.adapterFor(service);
    assert.equal(a.adapter, null); assert.match(a.blocked, /isn't built/);
    await assert.rejects(() => gt.send({ fetch: fakeFetch(), secrets: createSecrets({ env: ENV }), service, mode: "ets", body: BODY }), (e) => e.code === "blocked");
    assert.throws(() => gt.mockSend({ service, body: BODY }), (e) => e.code === "blocked");
  }
});

test("send wraps the body in the envelope with the sender's sign-in, the IRmark, and GatewayTest only on the test service", withAdapter(async () => {
  const f = fakeFetch([msg("response", "<Done/>")]);
  const r = await gt.send({ fetch: f, secrets: createSecrets({ env: ENV }), service: "SA100", mode: "ets", body: BODY, keysFor: { utr: "1234567890" } });
  assert.equal(r.state, "accepted"); assert.equal(r.outcome, "hmrc"); assert.equal(r.env, "ets");
  const sent = f.calls[0];
  assert.equal(sent.url, "https://test-transaction-engine.tax.service.gov.uk/submission");
  assert.match(sent.body, /<Class>TEST-CLASS<\/Class>/); assert.match(sent.body, /<GatewayTest>1<\/GatewayTest>/);
  assert.match(sent.body, /<Key Type="UTR">1234567890<\/Key>/);
  assert.match(sent.body, /<Value>p&amp;ss&lt;word<\/Value>/);
  assert.match(sent.body, /<URI>1234<\/URI>/);
  assert.ok(sent.body.includes(`<IRmark Type="generic">${gt.irmark(BODY)}</IRmark>`));
  assert.equal(r.irmark, gt.irmark(BODY));
  const live = fakeFetch([msg("response")]);
  await gt.send({ fetch: live, secrets: createSecrets({ env: ENV }), service: "SA100", mode: "live", body: BODY });
  assert.equal(live.calls[0].url, "https://transaction-engine.tax.service.gov.uk/submission");
  assert.equal(live.calls[0].body.includes("GatewayTest"), false);
}));

test("send refuses what isn't ready: missing secrets, bad bodies, no IRmark", withAdapter(async () => {
  const s = (env) => createSecrets({ env });
  await assert.rejects(() => gt.send({ fetch: fakeFetch(), secrets: s({}), service: "SA100", mode: "ets", body: BODY }), (e) => e.code === "not-configured" && /vendor ID/.test(e.message));
  await assert.rejects(() => gt.send({ fetch: fakeFetch(), secrets: s(ENV), service: "SA100", mode: "ets", body: `\n${BODY}` }), (e) => e.code === "bad-request");
  await assert.rejects(() => gt.send({ fetch: fakeFetch(), secrets: s(ENV), service: "SA100", mode: "ets", body: BODY.replace(/<IRmark[^]*?<\/IRmark>/, "") }), (e) => /no IRmark/.test(e.message));
  await assert.rejects(() => gt.send({ fetch: fakeFetch(), secrets: s(ENV), service: "SA100", mode: "nope", body: BODY }), (e) => e.code === "bad-request");
  await assert.rejects(() => gt.send({ fetch: fakeFetch(), secrets: s(ENV), service: "SA100", mode: "ets", body: "<Other>" + "x".repeat(60) + "</Other>" }), (e) => /Not a test return/.test(e.message));
}));

test("HMRC's answers are read as accepted, rejected with its error numbers, or pending with where to poll", withAdapter(async () => {
  const sec = createSecrets({ env: ENV });
  const err = msg("error").replace("<GovTalkDetails><Keys/></GovTalkDetails>", "<GovTalkDetails><Keys/><GovTalkErrors><Error><RaisedBy>HMRC</RaisedBy><Number>1046</Number><Type>business</Type><Text>Invalid &amp; wrong</Text><Location>/a/b</Location></Error></GovTalkErrors></GovTalkDetails>");
  const rej = await gt.send({ fetch: fakeFetch([err]), secrets: sec, service: "SA100", mode: "ets", body: BODY });
  assert.equal(rej.state, "rejected"); assert.deepEqual(rej.errors, [{ number: "1046", text: "Invalid & wrong", location: "/a/b" }]);
  const pend = await gt.send({ fetch: fakeFetch([msg("acknowledgement")]), secrets: sec, service: "SA100", mode: "ets", body: BODY });
  assert.equal(pend.state, "pending"); assert.equal(pend.correlationId, "ABC123DEF"); assert.equal(pend.interval, 2);
  assert.equal(pend.pollUrl, "https://test-transaction-engine.tax.service.gov.uk/poll");
}));

test("polling asks the standard address, ignores a poll URL on another host, and tidies up after an answer", withAdapter(async () => {
  const f = fakeFetch([msg("response"), msg("response")]);
  const r = await gt.poll({ fetch: f, secrets: createSecrets({ env: ENV }), service: "SA100", mode: "ets", correlationId: "ABC123DEF", pollUrl: "https://evil.example/poll" });
  assert.equal(r.state, "accepted");
  assert.equal(f.calls[0].url, "https://test-transaction-engine.tax.service.gov.uk/poll");
  assert.match(f.calls[0].body, /<Qualifier>poll<\/Qualifier>/);
  assert.match(f.calls[1].body, /<Function>delete<\/Function>/);
  await assert.rejects(() => gt.poll({ fetch: f, secrets: createSecrets({ env: ENV }), service: "SA100", mode: "ets", correlationId: "not hex!" }), (e) => e.code === "bad-request");
}));

test("a mock run is labelled mock, repeatable, and can be made to reject", withAdapter(async () => {
  const a = gt.mockSend({ service: "SA100", body: BODY }), b = gt.mockSend({ service: "SA100", body: BODY });
  assert.equal(a.state, "accepted"); assert.equal(a.outcome, "mock"); assert.equal(a.env, "mock"); assert.match(a.receipt, /nothing was sent to HMRC/);
  assert.equal(a.correlationId, b.correlationId);
  const rej = gt.mockSend({ service: "SA100", body: BODY.replace("<Return>x", "<Return>MOCK_REJECT") });
  assert.equal(rej.state, "rejected"); assert.equal(rej.outcome, "mock"); assert.ok(rej.errors.length);
}));

// ------------------------------------------------------------- the handler

test("the handler needs a sign-in and says what is set up and what is blocked", async () => {
  const h = createHandler({ fetch: fakeFetch(), env: {}, now: () => NOW });
  assert.equal((await call(h, "info", { method: "GET", headers: {} })).status, 401);
  const info = await call(h, "info", { method: "GET" });
  assert.equal(info.status, 200);
  assert.equal(info.body.environments.mock.ok, true);
  assert.equal(info.body.environments.ets.ok, false); assert.equal(info.body.environments.live.ok, false);
  assert.equal(info.body.liveEnabled, false);
  assert.equal(info.body.services.SA100.adapter, false); assert.match(info.body.services.SA100.reason, /RIM artefacts/);
  assert.equal(JSON.stringify(info.body).includes("p&ss"), false);
});

test("send is refused without confirmation, for unknown services, and while live or the test service isn't available", withAdapter(async () => {
  const h = createHandler({ fetch: fakeFetch(), env: {}, now: () => NOW });
  const send = (b) => call(h, "send", { body: b });
  assert.equal((await send({ service: "SA100", env: "mock", body: BODY })).status, 400);
  assert.equal((await send({ service: "SA100", env: "mock", body: BODY, confirm: "yes" })).status, 400);
  assert.equal((await send({ service: "VAT", env: "mock", body: BODY, confirm: true })).status, 400);
  assert.equal((await send({ service: "SA100", env: "nope", body: BODY, confirm: true })).status, 400);
  const live = await send({ service: "SA100", env: "live", body: BODY, confirm: true });
  assert.equal(live.status, 409); assert.match(live.body.message, /switched off|vendor ID/);
  const ets = await send({ service: "SA100", env: "ets", body: BODY, confirm: true });
  assert.equal(ets.status, 409); assert.match(ets.body.message, /vendor ID/);
  const ok = await send({ service: "SA100", env: "mock", body: BODY, confirm: true });
  assert.equal(ok.status, 200); assert.equal(ok.body.outcome, "mock");
}));

test("live filing needs to be switched on, approved by name and have the vendor ID, and then it goes to HMRC's live address", withAdapter(async () => {
  const f = fakeFetch([msg("response")]);
  const base = { ...ENV, FILING_LIVE_ENABLED: "1" };
  const off = createHandler({ fetch: f, env: base, now: () => NOW });
  assert.equal((await call(off, "send", { body: { service: "SA100", env: "live", body: BODY, confirm: true } })).body.message, "Live filing hasn't been approved by a named person.");
  const on = createHandler({ fetch: f, env: { ...base, FILING_LIVE_APPROVED_BY: "Kevin" }, now: () => NOW });
  const r = await call(on, "send", { body: { service: "SA100", env: "live", body: BODY, confirm: true } });
  assert.equal(r.status, 200); assert.equal(r.body.state, "accepted"); assert.equal(r.body.env, "live");
  assert.ok(f.calls.some((c) => c.url === "https://transaction-engine.tax.service.gov.uk/submission"));
}));

test("without an adapter even a mock send is blocked (409), because there is no XML to check", async () => {
  const h = createHandler({ fetch: fakeFetch(), env: {}, now: () => NOW });
  const r = await call(h, "send", { body: { service: "SA100", env: "mock", body: BODY, confirm: true } });
  assert.equal(r.status, 409); assert.match(r.body.message, /adapter isn't built/);
});

test("poll isn't available for a mock run", withAdapter(async () => {
  const h = createHandler({ fetch: fakeFetch(), env: {}, now: () => NOW });
  assert.equal((await call(h, "poll", { body: { service: "SA100", env: "mock", correlationId: "ABC" } })).status, 400);
}));
