// Server-checked, sealed AML approvals and the morning digest, with SharePoint and the mailbox faked.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHandler } = require("../approve/index.js");
const digest = require("../digest/index.js");

const NOW = Date.UTC(2026, 10, 9, 9, 0, 0);
const TENANT = "69bd0549-2696-4a31-b1ed-66ac01abacf1";
const CLIENT = "4ad0ec52-92a4-46d3-b1b0-7d3b0a4654a0";
const ENV = { APPROVAL_SEAL_KEY: "k".repeat(40), PORTAL_GRAPH_TENANT_ID: "t", PORTAL_GRAPH_CLIENT_ID: "c", PORTAL_GRAPH_CLIENT_SECRET: "s", PORTAL_MAIL_FROM: "practice@example.com", DIGEST_KEY: "d".repeat(32), PLANNER_URL: "https://planner.example" };
const token = (name) => { const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url"); return [enc({ alg: "RS256" }), enc({ tid: TENANT, appid: CLIENT, aud: "00000003-0000-0000-c000-000000000000", exp: NOW / 1000 + 3600, name }), "sig"].join("."); };
const fetch = async () => ({ ok: true, status: 200, json: async () => ({ id: "me" }) });

function fakePlanner(lists) {
  let n = 1000;
  for (const rows of Object.values(lists)) for (const r of rows) r._id = r._id || String(n++);
  const writes = [];
  return {
    writes, lists,
    async rows(k) { return (lists[k] || []).map((r) => ({ ...r })); },
    async create(k, v) { writes.push(["create", k, v]); (lists[k] = lists[k] || []).push({ ...v, _id: String(n++) }); return "x"; },
    async patch(k, id, v) { writes.push(["patch", k, v]); const r = (lists[k] || []).find((x) => x._id === id); Object.assign(r, v); },
    async token() { return "AT"; },
  };
}
const staff = (cfg) => ({ Key: "checklist-config", Value: JSON.stringify(cfg) });
function world() {
  const answers = {};
  return {
    Clients: [{ Key: "C1", Title: "Solo Trader", Kind: "Individual", Manager: "Ann Lee", XamaAmlCheck: "done|2026-11-01|0|0" }],
    AmlAssessments: [{ Key: "A1", ClientKey: "C1", Status: "inprogress", Risk: "low", RiskBasis: "Low risk sole trader", Owners: "[]", Checks: JSON.stringify([{ id: "1", kind: "Identity verified", result: "pass", by: "Ann", at: "2026-11-01", note: "" }]), Evidence: "[]", Factors: JSON.stringify(answers), Pep: JSON.stringify({ status: "no", people: [] }), DdLevel: "standard", PreparedBy: "Ann Lee", Created: "2026-11-01" }],
    Settings: [staff({ staff: [{ name: "Ann Lee", role: "manager", email: "ann@example.com" }, { name: "Bob Ray", role: "partner", email: "bob@example.com" }], independentReview: true })],
    AmlRecords: [], Onboardings: [], Jobs: [{ Key: "J1", ClientKey: "C1", Title: "Tax return", Deadline: "2026-11-05", Status: "Not started" }],
  };
}
async function call(h, action, { name = "Bob Ray", body = {}, headers } = {}) {
  const context = { bindingData: { action } };
  await h(context, { method: action === "status" ? "GET" : "POST", headers: headers || { "x-pp-token": token(name) }, body });
  return { status: context.res.status, body: JSON.parse(context.res.body) };
}

test("approval runs the planner's own rules on the server, takes the approver from the sign-in, and seals the record", async () => {
  const p = fakePlanner(world());
  const h = createHandler({ fetch, env: ENV, now: () => NOW, planner: p });
  // the risk assessment questions aren't answered, so the same rule as the screen refuses it
  const refused = await call(h, "aml", { body: { key: "A1" } });
  assert.equal(refused.status, 409); assert.match(refused.body.message, /risk assessment questions/i);
  assert.equal(p.writes.length, 0);
  // not configured
  const off = createHandler({ fetch, env: { ...ENV, APPROVAL_SEAL_KEY: "" }, now: () => NOW, planner: p });
  assert.equal((await call(off, "aml", { body: { key: "A1" } })).status, 503);
  assert.deepEqual((await call(off, "status")).body, { configured: false, missing: ["APPROVAL_SEAL_KEY"] });
  // not signed in
  assert.equal((await call(h, "aml", { headers: {}, body: { key: "A1" } })).status, 401);
});

test("verify: sealed approvals pass, changed ones are caught, unsealed ones say so", async () => {
  const w = world();
  w.AmlAssessments = [{ Key: "A2", ClientKey: "C1", Status: "approved", Risk: "low", ApprovedBy: "Bob Ray", ApprovedAt: "2026-11-02T10:00:00Z" }, { Key: "A3", ClientKey: "C1", Status: "approved", Risk: "low" }];
  const lib = require("../shared/plannerlib.js");
  const crypto = require("node:crypto");
  w.AmlAssessments[0].Seal = crypto.createHmac("sha256", ENV.APPROVAL_SEAL_KEY).update(lib.sealPayload(w.AmlAssessments[0])).digest("base64url");
  const p = fakePlanner(w);
  const h = createHandler({ fetch, env: ENV, now: () => NOW, planner: p });
  assert.deepEqual((await call(h, "verify")).body.results, { A2: "sealed", A3: "unsealed" });
  p.lists.AmlAssessments[0].Risk = "high";
  assert.deepEqual((await call(h, "verify")).body.results, { A2: "changed", A3: "unsealed" });
  // a short review moving the review date on doesn't break the seal
  p.lists.AmlAssessments[0].Risk = "low"; p.lists.AmlAssessments[0].ReviewDate = "2029-01-01";
  assert.equal((await call(h, "verify")).body.results.A2, "sealed");
});

test("digest: each person gets their own clients' work; managers also get AML; runs once a day, weekdays, only when on", async () => {
  const w = world();
  w.Settings.push({ Key: "digest.settings", Value: JSON.stringify({ enabled: true }) });
  const p = fakePlanner(w);
  const sent = [];
  const mailer = { async send(m) { sent.push(m); } };
  const h = digest.createHandler({ fetch, env: ENV, now: () => NOW, planner: p, mailer });
  const run = (key = ENV.DIGEST_KEY) => call(h, "run", { headers: { "x-digest-key": key } });
  assert.equal((await run("wrong")).status, 401);
  const r = await run();
  assert.equal(r.status, 200); assert.equal(r.body.sent, 2);
  const ann = sent.find((m) => m.to === "ann@example.com");
  assert.match(ann.text, /Overdue work \(1\)/); assert.match(ann.text, /Solo Trader: Tax return/); assert.match(ann.text, /AML assessments in progress/);
  assert.match(ann.text, /https:\/\/planner\.example/);
  assert.equal((await run()).body.skipped, "already-sent");
  const sat = digest.createHandler({ fetch, env: ENV, now: () => Date.UTC(2026, 10, 14, 9), planner: fakePlanner(world()), mailer });
  const w2 = world(); w2.Settings.push({ Key: "digest.settings", Value: JSON.stringify({ enabled: false }) });
  const off = digest.createHandler({ fetch, env: ENV, now: () => NOW, planner: fakePlanner(w2), mailer });
  assert.equal((await call(off, "run", { headers: { "x-digest-key": ENV.DIGEST_KEY } })).body.skipped, "off");
  const w3 = world(); w3.Settings.push({ Key: "digest.settings", Value: JSON.stringify({ enabled: true }) });
  const weekend = digest.createHandler({ fetch, env: ENV, now: () => Date.UTC(2026, 10, 14, 9), planner: fakePlanner(w3), mailer });
  assert.equal((await call(weekend, "run", { headers: { "x-digest-key": ENV.DIGEST_KEY } })).body.skipped, "weekend");
  // preview and test need a sign-in; test goes to the signed-in person only
  const pv = await call(h, "preview", { name: "Ann Lee" });
  assert.equal(pv.body.digests.length, 2);
  sent.length = 0;
  const t = await call(h, "test", { name: "Ann Lee" });
  assert.equal(t.body.to, "ann@example.com"); assert.equal(sent.length, 1); assert.match(sent[0].subject, /\(test\)/);
  void sat;
});

test("digest recipients: staff with an email; with no staff list, the fallback address gets everything", () => {
  assert.deepEqual(digest.recipients([staff({ staff: [{ name: "A", role: "preparer", email: "a@x.co" }, { name: "B", role: "manager" }] })]).map((x) => x.email), ["a@x.co"]);
  const r = digest.recipients([{ Key: "digest.settings", Value: JSON.stringify({ fallbackTo: "me@x.co" }) }]);
  assert.equal(r[0].email, "me@x.co"); assert.equal(r[0].everything, true);
  assert.deepEqual(digest.recipients([]), []);
});

test("a passed approval is written with the approver from the sign-in and a seal over the approved record", async () => {
  const real = require("../shared/plannerlib.js");
  let seen;
  const lib = { ...real, approveAml: (i) => { seen = i; const row = i.assessments[0]; return { patches: [{ list: "AmlAssessments", row, patch: { Status: "approved", ApprovedBy: i.user, ApprovedAt: i.now } }, { list: "Clients", row: i.clients[0], patch: { AMLReview: "2029-11-09" } }], creates: [], log: [{ Key: "L1", Action: "aml-approved" }], activities: [] }; } };
  const p = fakePlanner(world());
  const h = createHandler({ fetch, env: ENV, now: () => NOW, planner: p, lib });
  const r = await call(h, "aml", { body: { key: "A1" } });
  assert.equal(r.status, 200); assert.equal(r.body.by, "Bob Ray");
  assert.equal(seen.user, "Bob Ray"); assert.equal(seen.today, "2026-11-09");
  const a = p.lists.AmlAssessments[0];
  assert.equal(a.Status, "approved"); assert.equal(a.ApprovedBy, "Bob Ray"); assert.ok(a.Seal);
  assert.deepEqual((await call(h, "verify")).body.results, { A1: "sealed" });
  assert.ok(p.writes.some(([w, k]) => w === "create" && k === "SalesLog"));
});

test("a Co Sec filing's approval goes through the same rules and is sealed; later status changes keep the seal, edits to the details don't", async () => {
  const real = require("../shared/plannerlib.js");
  const lib = { ...real, approveCosec: (i) => { const tx = i.lists.CoSecTransactions[0]; return { patches: [{ list: "CoSecTransactions", row: tx, patch: { Status: "approved", ApprovedBy: i.user, ApprovedAt: i.now } }], creates: [], log: [], activities: [] }; } };
  const w = world(); w.CoSecTransactions = [{ Key: "T1", ClientKey: "C1", Form: "AD01", Status: "draft", Payload: "{\"address\":\"1 High St\"}", EditedBy: "Ann Lee" }];
  const p = fakePlanner(w);
  const h = createHandler({ fetch, env: ENV, now: () => NOW, planner: p, lib });
  const r = await call(h, "cosec", { body: { key: "T1" } });
  assert.equal(r.status, 200); assert.equal(p.lists.CoSecTransactions[0].ApprovedBy, "Bob Ray"); assert.ok(p.lists.CoSecTransactions[0].Seal);
  assert.equal((await call(h, "verify")).body.cosec.T1, "sealed");
  p.lists.CoSecTransactions[0].Status = "submitted";
  assert.equal((await call(h, "verify")).body.cosec.T1, "sealed");
  p.lists.CoSecTransactions[0].Payload = "{\"address\":\"9 Other Rd\"}";
  assert.equal((await call(h, "verify")).body.cosec.T1, "changed");
  // the real rules refuse a filing that isn't ready (the planner's own check)
  const p2 = fakePlanner({ ...world(), CoSecTransactions: [{ Key: "T2", ClientKey: "C1", Form: "AP01", Status: "draft", Payload: "{}", EditedBy: "Ann Lee" }] });
  const h2 = createHandler({ fetch, env: ENV, now: () => NOW, planner: p2 });
  const refused = await call(h2, "cosec", { body: { key: "T2" } });
  assert.equal(refused.status, 409);
});
