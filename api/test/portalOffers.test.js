const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { setup } = require("./portalKit.js");

const block = [{ type: "h", level: 1, runs: [{ t: "Fee proposal" }] }, { type: "p", runs: [{ t: "Accounts, £100 a month", b: true }] }, { type: "bogus", x: 1 }];
const good = (o = {}) => ({ proposalKey: "p1", ref: "PR-001", version: 2, title: "Fee proposal", recipientName: "Jo Prospect", recipientEmail: "jo@prospect.test", validUntil: "2026-11-20", bodyHash: "a".repeat(64), content: { blocks: block }, optional: [{ id: "payroll", label: "Payroll", price: "£20 a month" }], ...o });
const make = async (h, o) => { const r = await h.staff("POST", "proposal-publish", good(o)); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };
const pub = (h, token, method = "GET", body) => h.call("default", method, `accept/${token}`, { body });

test("publishing returns a token once and stores only its hash", async () => {
  const h = setup();
  const r = await make(h);
  assert.match(r.token, /^[A-Za-z0-9_-]{43}$/);
  const stored = JSON.stringify(await h.raw.list("default", "proposals"));
  assert.ok(stored.includes("tokenHash"));
  assert.ok(!stored.includes(r.token));
  assert.ok(stored.includes(crypto.createHash("sha256").update(r.token).digest("hex")));
});

test("the link shows the proposal, drops unknown block types, and notes the first view", async () => {
  const h = setup();
  const { token } = await make(h);
  const v = await pub(h, token);
  assert.equal(v.status, 200);
  assert.equal(v.body.status, "open");
  assert.equal(v.body.blocks.length, 2);
  assert.ok(v.body.consent.includes("identity checks"));
  const links = await h.call("default", "GET", "admin/proposal-links", { headers: { "x-staff": "Kevin" }, query: { proposalKey: "p1" } });
  assert.equal(links.status, 200);
  assert.equal(links.body.links.length, 1);
  assert.ok(links.body.links[0].viewedAt);
  assert.equal(JSON.stringify(links.body).includes(token), false);
});

test("a bad or unknown token is a 404 and nothing leaks", async () => {
  const h = setup();
  await make(h);
  assert.equal((await pub(h, "nope")).status, 404);
  assert.equal((await pub(h, "A".repeat(43))).status, 404);
});

test("accepting needs a name and the consent box, records evidence once, and tells the practice", async () => {
  const h = setup();
  const { token } = await make(h);
  assert.equal((await pub(h, token, "POST", { decision: "accept", name: "J", consent: true })).status, 400);
  assert.equal((await pub(h, token, "POST", { decision: "accept", name: "Jo Prospect", consent: false })).status, 400);
  const ok = await pub(h, token, "POST", { decision: "accept", name: "Jo Prospect", consent: true, optional: ["payroll", "evil"] });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.status, "accepted");
  assert.equal((await pub(h, token, "POST", { decision: "decline" })).status, 409);
  const res = (await h.call("default", "GET", "admin/proposal-results", { headers: { "x-staff": "Kevin" } })).body.results;
  assert.equal(res.length, 1);
  assert.equal(res[0].name, "Jo Prospect");
  assert.deepEqual(res[0].optional, ["payroll"]);
  assert.equal(res[0].ip, "9.9.9.9");
  assert.equal(res[0].bodyHash, "a".repeat(64));
  assert.ok(res[0].consentText.length > 20);
  assert.ok(h.mailer.sent.some((m) => m.to === "practice@bannister.test"));
  assert.ok(h.mailer.sent.some((m) => m.to === "jo@prospect.test"));
  const again = await pub(h, token);
  assert.equal(again.body.status, "accepted");
  assert.equal(again.body.blocks, undefined);
});

test("declining records a reason and needs no name", async () => {
  const h = setup();
  const { token } = await make(h);
  const r = await pub(h, token, "POST", { decision: "decline", reason: "too dear" });
  assert.equal(r.body.status, "declined");
  const res = (await h.call("default", "GET", "admin/proposal-results", { headers: { "x-staff": "Kevin" } })).body.results;
  assert.equal(res[0].reason, "too dear");
});

test("acknowledging removes answers from the queue", async () => {
  const h = setup();
  const { token } = await make(h);
  await pub(h, token, "POST", { decision: "decline" });
  const res = (await h.call("default", "GET", "admin/proposal-results", { headers: { "x-staff": "Kevin" } })).body.results;
  assert.equal((await h.staff("POST", "proposal-ack", { ids: [res[0].id] })).body.acknowledged, 1);
  assert.equal((await h.call("default", "GET", "admin/proposal-results", { headers: { "x-staff": "Kevin" } })).body.results.length, 0);
});

test("a link stops working after its date", async () => {
  const h = setup();
  const { token } = await make(h);
  h.state.now = Date.UTC(2026, 10, 21, 9, 0, 0);
  const v = await pub(h, token);
  assert.equal(v.status, 410);
  assert.equal(v.body.code, "expired");
  assert.equal((await pub(h, token, "POST", { decision: "accept", name: "Jo Prospect", consent: true })).status, 410);
});

test("withdrawing a link, or publishing the version again, kills the old link", async () => {
  const h = setup();
  const a = await make(h);
  const b = await make(h);
  assert.equal((await pub(h, a.token)).status, 410);
  assert.equal((await pub(h, b.token)).status, 200);
  assert.equal((await h.staff("POST", "proposal-revoke", { id: b.id })).status, 200);
  const v = await pub(h, b.token);
  assert.equal(v.status, 410);
  assert.equal(v.body.code, "withdrawn");
});

test("bad publish requests are refused", async () => {
  const h = setup();
  for (const o of [{ recipientEmail: "nope" }, { validUntil: "2026-01-01" }, { validUntil: "2028-01-01" }, { bodyHash: "x" }, { content: { blocks: [] } }, { version: 0 }]) {
    assert.equal((await h.staff("POST", "proposal-publish", good(o))).status, 400, JSON.stringify(o));
  }
});

test("publishing needs staff sign-in, and only managers and above when the planner has a staff list", async () => {
  const h = setup();
  assert.equal((await h.call("default", "POST", "admin/proposal-publish", { body: good() })).status, 401);
  const cfg = { staff: [{ name: "Kevin", role: "preparer" }, { name: "Sam", role: "manager" }] };
  const rows = [{ Key: "checklist-config", Value: JSON.stringify(cfg) }];
  const h2 = setup({ settings: rows });
  assert.equal((await h2.staff("POST", "proposal-publish", good())).status, 403); // Kevin is a preparer
  const sam = await h2.call("default", "POST", "admin/proposal-publish", { body: good(), headers: { "x-staff": "Sam" } });
  assert.equal(sam.status, 200);
  const { mayPublish } = require("../portal/lib/offers.js");
  assert.equal(mayPublish(rows, "Kevin"), false);
  assert.equal(mayPublish(rows, "Sam"), true);
  assert.equal(mayPublish(rows, "Stranger"), false);
  assert.equal(mayPublish([], "Anyone"), true);
});

test("a link belongs to its practice", async () => {
  const h = setup({ practices: ["one", "two"] });
  const r = await h.call("one", "POST", "admin/proposal-publish", { body: good(), headers: { "x-staff": "Kevin" } });
  assert.equal(r.status, 200);
  assert.equal((await h.call("two", "GET", `accept/${r.body.token}`)).status, 404);
  assert.equal((await h.call("one", "GET", `accept/${r.body.token}`)).status, 200);
});
