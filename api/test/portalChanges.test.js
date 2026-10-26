// Client-requested changes to business details, and the approval workflow.
const test = require("node:test");
const assert = require("node:assert/strict");
const { setup } = require("./portalKit.js");

const ANN = { sub: "s-ann", email: "ann@example.com", name: "Ann Example" };
const BEN = { sub: "s-ben", email: "ben@example.com", name: "Ben Other" };

async function world() {
  const h = setup();
  await h.staff("POST", "invite", { email: ANN.email, name: ANN.name, businesses: [{ clientKey: "c-acme", level: "administrator" }, { clientKey: "c-bolt", level: "standard" }] });
  await h.staff("POST", "invite", { email: BEN.email, name: BEN.name, businesses: [{ clientKey: "c-acme", level: "standard" }] });
  await h.asUser(ANN);
  await h.asUser(BEN);
  const propose = (items, note, who = ANN, key = "c-acme") => h.asUser(who, `changes/${key}`, "default", { method: "POST", body: { items, note } });
  const staffGet = (q = "") => h.call("default", "GET", "admin/changes", { headers: { "x-staff": "Kevin" }, query: q ? { status: q } : {} });
  return { h, propose, staffGet };
}
const acme = (h) => h.rows.find((r) => r.Key === "c-acme");

test("a client proposes changes; the record isn't touched and the old values are taken from our record, not from the client", async () => {
  const { h, propose, staffGet } = await world();
  const before = acme(h).Phone;
  const r = await propose([{ key: "phone", value: "0200 999", old: "FORGED" }, { key: "tradingName", value: "Acme Trading" }], "New number");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const req = r.body.request;
  assert.equal(req.status, "pending");
  assert.equal(req.items.find((i) => i.key === "phone").old, before);
  assert.equal(req.items.find((i) => i.key === "phone").new, "0200 999");
  assert.equal(acme(h).Phone, before);
  assert.equal(acme(h).TradingName, undefined);
  const list = (await staffGet("open")).body.requests;
  assert.equal(list.length, 1);
  assert.equal(list[0].clientName, "Acme Widgets Ltd");
});

test("only administrators can propose; other levels and other businesses are refused as 'not found'", async () => {
  const { h, propose } = await world();
  assert.equal((await propose([{ key: "phone", value: "1" }], "", BEN)).status, 404); // standard
  assert.equal((await propose([{ key: "phone", value: "1" }], "", ANN, "c-bolt")).status, 404); // standard there
  assert.equal((await propose([{ key: "phone", value: "1" }], "", ANN, "c-cove")).status, 404); // no access
  assert.equal((await h.asUser(BEN, "changes/c-acme")).status, 404);
});

test("bad proposals are refused: unknown field, nothing changed, bad email, too long, already waiting", async () => {
  const { h, propose } = await world();
  assert.equal((await propose([{ key: "UTR", value: "123" }])).status, 400);
  assert.equal((await propose([{ key: "Notes", value: "x" }])).status, 400);
  assert.equal((await propose([{ key: "phone", value: acme(h).Phone }])).body.code, "no-change");
  assert.equal((await propose([])).body.code, "no-change");
  assert.equal((await propose([{ key: "email", value: "not an email" }])).body.code, "bad-value");
  assert.equal((await propose([{ key: "phone", value: "9".repeat(100) }])).body.code, "bad-value");
  assert.equal((await propose([{ key: "phone", value: "0300" }])).status, 200);
  assert.equal((await propose([{ key: "phone", value: "0400" }])).body.code, "already-waiting");
  assert.equal((await propose([{ key: "email", value: "new@acme.test" }])).status, 200); // a different field is fine
});

test("control characters are stripped from proposed values", async () => {
  const { propose } = await world();
  const r = await propose([{ key: "tradingName", value: "Acme\u0000 \u0007Trading\nLtd" }]);
  assert.equal(r.body.request.items[0].new, "Acme Trading Ltd");
});

test("staff approve some and reject others: only approved values reach the record; the outcome and emails say so", async () => {
  const { h, propose, staffGet } = await world();
  const { request } = (await propose([{ key: "phone", value: "0200 999" }, { key: "email", value: "new@acme.test" }, { key: "registeredOffice", value: "2 Low Rd\nLeeds" }, { key: "directors", value: "Add Cara Dee as director" }])).body;
  const unfinished = await h.staff("POST", "changes-decide", { id: request.id, decisions: [{ key: "phone", decision: "approved" }] });
  assert.equal(unfinished.status, 400); // every item needs a decision
  const mailsBefore = h.mailer.sent.length;
  const r = await h.staff("POST", "changes-decide", { id: request.id, decisions: [
    { key: "phone", decision: "approved" }, { key: "email", decision: "rejected", note: "Please use the main office address" },
    { key: "registeredOffice", decision: "approved" }, { key: "directors", decision: "approved" },
  ] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.outcome, "partly approved");
  assert.equal(acme(h).Phone, "0200 999");
  assert.equal(acme(h).Email, "office@acme.test"); // rejected: untouched
  assert.equal(acme(h).RegisteredOffice, "2 Low Rd\nLeeds");
  assert.deepEqual(r.body.statutory.map((s) => s.field).sort(), ["Directors or officers", "Registered office"]);
  assert.equal(Object.keys(acme(h)).includes("directors"), false); // noted only, no column
  const mail = h.mailer.sent.slice(mailsBefore).find((m) => m.to === ANN.email);
  assert.match(mail.text, /Phone|Telephone: approved/);
  assert.match(mail.text, /Business email: not approved \(Please use the main office address\)/);
  assert.match(mail.text, /doesn't change anything at Companies House/);
  assert.equal((await h.staff("POST", "changes-decide", { id: request.id, decisions: [] })).status, 409); // already done
  assert.equal((await staffGet("open")).body.requests.length, 0);
});

test("the client sees the outcome, can't change it, and can't touch other people's requests", async () => {
  const { h, propose } = await world();
  const { request } = (await propose([{ key: "phone", value: "0200 999" }])).body;
  await h.staff("POST", "changes-decide", { id: request.id, decisions: [{ key: "phone", decision: "approved" }] });
  const list = (await h.asUser(ANN, "changes/c-acme")).body.requests;
  assert.equal(list[0].outcome, "approved");
  assert.equal(list[0].items[0].decision, "approved");
  assert.equal((await h.asUser(ANN, `changes/c-acme/${request.id}/cancel`, "default", { method: "POST", body: {} })).body.code, "closed");
  // a request id from one business can't be reached through another
  const other = (await h.asUser(ANN, "changes/c-bolt", "default", { method: "POST", body: { items: [{ key: "phone", value: "1" }] } }));
  assert.equal(other.status, 404);
  assert.equal((await h.asUser(ANN, `changes/c-bolt/${request.id}/cancel`, "default", { method: "POST", body: {} })).status, 404);
});

test("clarification: staff ask, the client is emailed and answers, the request goes back to staff", async () => {
  const { h, propose, staffGet } = await world();
  const { request } = (await propose([{ key: "website", value: "acme.example" }])).body;
  assert.equal((await h.asUser(ANN, `changes/c-acme/${request.id}/reply`, "default", { method: "POST", body: { text: "hi" } })).body.code, "not-asked");
  assert.equal((await h.staff("POST", "changes-ask", { id: request.id, text: "Is that the new site address?" })).status, 200);
  assert.equal(h.mailer.sent.at(-1).to, ANN.email);
  const waiting = (await h.asUser(ANN, "changes/c-acme")).body.requests[0];
  assert.equal(waiting.status, "clarification");
  assert.equal(waiting.thread[0].from, "staff");
  assert.equal((await h.asUser(ANN, `changes/c-acme/${request.id}/reply`, "default", { method: "POST", body: { text: "  " } })).status, 400);
  const back = await h.asUser(ANN, `changes/c-acme/${request.id}/reply`, "default", { method: "POST", body: { text: "Yes, it is" } });
  assert.equal(back.body.request.status, "pending");
  assert.equal(back.body.request.thread.length, 2);
  assert.equal((await staffGet("open")).body.requests[0].thread[1].text, "Yes, it is");
});

test("a client can withdraw a request that's still open", async () => {
  const { h, propose } = await world();
  const before = acme(h).Phone;
  const { request } = (await propose([{ key: "phone", value: "0200 999" }])).body;
  const r = await h.asUser(ANN, `changes/c-acme/${request.id}/cancel`, "default", { method: "POST", body: {} });
  assert.equal(r.body.request.outcome, "withdrawn");
  assert.equal(acme(h).Phone, before);
  assert.equal((await propose([{ key: "phone", value: "0200 999" }])).status, 200); // can ask again
});

test("staff see what the record says now, so a change made in the meantime is visible", async () => {
  const { h, propose, staffGet } = await world();
  await propose([{ key: "phone", value: "0200 999" }]);
  acme(h).Phone = "0777 changed by staff";
  const item = (await staffGet("open")).body.requests[0].items[0];
  assert.notEqual(item.old, item.current);
  assert.equal(item.current, "0777 changed by staff");
});

test("everything is in the audit trail, and the Portal overview lists what's waiting", async () => {
  const { h, propose } = await world();
  const { request } = (await propose([{ key: "phone", value: "0200 999" }, { key: "email", value: "x@acme.test" }])).body;
  assert.equal((await h.staff("GET", "overview")).body.attention.length, 1);
  assert.match((await h.staff("GET", "overview")).body.attention[0].text, /Ann Example asked to change telephone, business email for Acme Widgets Ltd/);
  await h.staff("POST", "changes-ask", { id: request.id, text: "Why?" });
  assert.equal((await h.staff("GET", "overview")).body.attention.length, 0); // waiting on the client now
  await h.asUser(ANN, `changes/c-acme/${request.id}/reply`, "default", { method: "POST", body: { text: "Because" } });
  await h.staff("POST", "changes-decide", { id: request.id, decisions: [{ key: "phone", decision: "approved" }, { key: "email", decision: "rejected" }] });
  const types = (await h.staff("GET", "events")).body.events.map((e) => e.type);
  for (const t of ["change.requested", "change.clarification-asked", "change.client-replied", "change.approved", "change.rejected", "change.applied"]) assert.ok(types.includes(t), `missing ${t}`);
  assert.equal(h.mailer.sent.some((m) => m.to === "practice@bannister.test" && /change requested/.test(m.subject)), true);
});

test("Companies House information is public data only, kept apart, and needs the right level", async () => {
  const { h } = await world();
  const r = await h.asUser(ANN, "official/c-acme");
  assert.equal(r.status, 200);
  const o = r.body.official;
  assert.equal(o.name, "ACME WIDGETS LIMITED");
  assert.deepEqual(o.officers.map((x) => x.name), ["EXAMPLE, Ann"]); // resigned officers left out
  assert.deepEqual(o.pscs[0].control, ["ownership of shares 75 to 100 percent"]);
  assert.equal(o.accountingReferenceDate, "31/03");
  const raw = JSON.stringify(r.body);
  for (const secret of ["Secret Lane", "1970", "British", "Baker", "date_of_birth", "nationality"]) assert.equal(raw.includes(secret), false, `${secret} leaked`);
  await h.staff("POST", "invite", { email: "res@example.com", name: "R", businesses: [{ clientKey: "c-acme", level: "restricted" }] });
  assert.equal((await h.asUser({ sub: "s-res", email: "res@example.com" }, "official/c-acme")).status, 404);
  assert.equal((await h.asUser(ANN, "official/c-bolt")).body.official, null); // standard may look; Companies House has nothing for this fixture
});
