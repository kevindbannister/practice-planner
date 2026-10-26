// Cross-cutting checks from the specification's test list: what no portal user may ever see,
// isolation between practices across every module, audit accuracy over a whole journey, and GDPR.
const test = require("node:test");
const assert = require("node:assert/strict");
const { PDFDocument } = require("pdf-lib");
const { setup, CLIENTS } = require("./portalKit.js");

const ANN = { sub: "s-ann", email: "ann@example.com", name: "Ann Example" }; // administrator
const BEN = { sub: "s-ben", email: "ben@example.com", name: "Ben Other" }; // standard
const RIA = { sub: "s-ria", email: "ria@example.com", name: "Ria Limited" }; // restricted
const SAM = { sub: "s-sam", email: "sam@example.com", name: "Sam Signs" }; // signatory
const b64 = (b) => b.toString("base64");
const pdf = async (t = "letter") => { const d = await PDFDocument.create(); d.addPage([300, 200]).drawText(t); return Buffer.from(await d.save()); };

async function world(opts) {
  const h = setup(opts);
  const inv = (u, level, key = "c-acme") => h.staff("POST", "invite", { email: u.email, name: u.name, businesses: [{ clientKey: key, level }] });
  await inv(ANN, "administrator"); await inv(BEN, "standard"); await inv(RIA, "restricted"); await inv(SAM, "signatory");
  const ids = {};
  for (const u of [ANN, BEN, RIA, SAM]) ids[u.sub] = (await h.asUser(u)).body.user.id;
  const as = (u, path, o = {}) => h.call(o.pid || "default", o.method || "GET", path, { headers: { "x-portal-token": h.token({ ...u, iat: h.state.now / 1000 - 60, exp: h.state.now / 1000 + 3600 }) }, body: o.body, query: o.query });
  return { h, ids, as };
}

// Everything internal that the test client carries (see portalKit CLIENTS) plus what staff type into internal-only boxes.
const INTERNAL = ["1234567890", "0987654321", "QQ123456C", "AUTH99", "Slow payer", "4800", "Kevin", "Sam", "Red", "2025-01-01", "9 Secret Lane", "1970-01-01", "internal bolt note", "STAFF-ONLY-NOTE", "Partner", "Manager", "XamaStatus", "AnnualFees", "internalNote", "storagePath", "sha256sum-internal"];
const clean = (s) => INTERNAL.filter((w) => !["Kevin", "Sam", "Red", "Partner", "Manager"].includes(w)).filter((w) => s.includes(w));

test("scenario 20: no portal screen, for any level, carries internal job, fee, staff or note information", async () => {
  const { h, as, ids } = await world();
  // staff create everything that has an internal side
  await h.staff("POST", "documents-add", { clientKey: "c-acme", title: "Accounts", category: "Accounts", fileName: "a.pdf", content: b64(await pdf()), publish: true, internalNote: "STAFF-ONLY-NOTE do not tell client", notify: false });
  await h.staff("POST", "requests-create", { clientKey: "c-acme", title: "Bank statements", details: "please" });
  await h.staff("POST", "messages-start", { clientKey: "c-acme", subject: "Hello", text: "Hi there" });
  await h.staff("POST", "identity-request", { userId: ids["s-ann"], kind: "passport", businesses: ["c-acme"] });
  const routes = ["me", "business/c-acme", "changes/c-acme", "documents/c-acme", "signing/c-acme", "identity", "requests/c-acme", "messages/c-acme", "notices/c-acme", "official/c-acme", "config"];
  let seen = 0;
  for (const u of [ANN, BEN, RIA, SAM]) for (const r of routes) {
    const res = await as(u, r);
    if (res.status === 200) { seen++; const leaked = clean(JSON.stringify(res.body)); assert.deepEqual(leaked, [], `${u.name} on ${r} leaked ${leaked}`); }
  }
  assert.ok(seen > 20, "enough screens were actually checked");
  assert.ok(!JSON.stringify((await as(ANN, "business/c-acme")).body).match(/job|task|allocation|working paper|status/i), "no job, task, allocation or working-paper words in the business view");
});

test("scenarios 18 and 19: another business, and another practice, get 'not found' from every module", async () => {
  const h = setup({ practices: ["one", "two"] });
  await h.staff("POST", "invite", { email: ANN.email, name: ANN.name, businesses: [{ clientKey: "c-acme", level: "administrator" }] }, "one");
  await h.staff("POST", "invite", { email: BEN.email, name: BEN.name, businesses: [{ clientKey: "c-bolt", level: "administrator" }] }, "one");
  const as = (u, pid, path, o = {}) => h.call(pid, o.method || "GET", path, { headers: { "x-portal-token": h.token({ ...u, iat: h.state.now / 1000 - 60, exp: h.state.now / 1000 + 3600 }) }, body: o.body });
  await as(ANN, "one", "me"); await as(BEN, "one", "me");
  const doc = (await h.staff("POST", "documents-add", { clientKey: "c-acme", title: "Private", category: "Accounts", fileName: "a.pdf", content: b64(await pdf()), publish: true, notify: false }, "one")).body.document;
  const rq = (await h.staff("POST", "requests-create", { clientKey: "c-acme", title: "Need", notify: false }, "one")).body.request;
  const th = (await h.staff("POST", "messages-start", { clientKey: "c-acme", subject: "S", text: "t", notify: false }, "one")).body.thread;
  // Ben administers a different business at the same practice
  for (const p of ["documents/c-acme", "signing/c-acme", "requests/c-acme", "messages/c-acme", "notices/c-acme", "changes/c-acme", "business/c-acme", "official/c-acme", `messages/c-acme/${th.id}`]) assert.equal((await as(BEN, "one", p)).status, 404, `Ben on ${p}`);
  assert.equal((await as(BEN, "one", `documents/c-acme/${doc.id}/download`, { method: "POST", body: {} })).status, 404);
  assert.equal((await as(BEN, "one", `requests/c-acme/${rq.id}/respond`, { method: "POST", body: { text: "x" } })).status, 404);
  assert.equal((await as(BEN, "one", `messages/c-acme/${th.id}`, { method: "POST", body: { text: "x" } })).status, 404);
  // The same person in another practice sees nothing of practice one
  for (const p of ["documents/c-acme", "requests/c-acme", "messages/c-acme", "business/c-acme"]) assert.equal((await as(ANN, "two", p)).status, 404, `practice two on ${p}`);
  assert.equal((await h.staff("GET", "documents?clientKey=c-acme", undefined, "two")).status === 200 ? (await h.call("two", "GET", "admin/documents", { headers: { "x-staff": "K" }, query: { clientKey: "c-acme" } })).body.documents.length : 0, 0, "practice two's staff list nothing of practice one");
  assert.equal((await h.call("two", "GET", "admin/messages", { headers: { "x-staff": "K" }, query: { clientKey: "c-acme" } })).body.threads.length, 0);
  assert.equal((await h.call("two", "GET", "admin/requests", { headers: { "x-staff": "K" }, query: { clientKey: "c-acme" } })).body.requests.length, 0);
  assert.equal((await h.call("two", "GET", "admin/messages", { headers: { "x-staff": "K" }, query: { id: th.id } })).status, 404, "nor can they open a thread by id");
});

test("scenario 16: the audit trail records a whole journey accurately, with the right people and records", async () => {
  const { h, as, ids } = await world();
  const doc = (await h.staff("POST", "documents-add", { clientKey: "c-acme", title: "Letter", category: "Letters and agreements", fileName: "l.pdf", content: b64(await pdf()), publish: true, notify: false })).body.document;
  await as(ANN, `documents/c-acme/${doc.id}/download`, { method: "POST", body: {} });
  const th = (await as(ANN, "messages/c-acme", { method: "POST", body: { subject: "Q", text: "Secret question" } })).body.thread;
  await h.staff("POST", "identity-request", { userId: ids["s-ann"], kind: "passport", businesses: ["c-acme"] });
  const sr = await h.staff("POST", "signing-create", { clientKey: "c-acme", docId: doc.id, signatoryIds: [ids["s-ann"]] });
  assert.equal(sr.status, 200, JSON.stringify(sr.body));
  await h.staff("POST", "signing-cancel", { id: sr.body.request.id });
  const ev = (await h.call("default", "GET", "admin/events", { headers: { "x-staff": "Kevin" }, query: { limit: "200" } })).body.events;
  const types = new Set(ev.map((e) => e.type));
  for (const t of ["invitation.issued", "account.activated", "access.granted", "document.added", "document.published", "document.downloaded", "message.thread-started", "identity.requested", "signing.requested", "signing.cancelled"]) assert.ok(types.has(t), `${t} is recorded; have ${[...types].join(", ")}`);
  const dl = ev.find((e) => e.type === "document.downloaded");
  assert.equal(dl.recordId, doc.id); assert.equal(dl.clientKey, "c-acme"); assert.equal(dl.userId, ids["s-ann"]); assert.equal(dl.source, "portal");
  assert.ok(dl.at && dl.id, "each event has an id and a time");
  assert.ok(!JSON.stringify(ev).includes("Secret question"), "no message contents in the audit trail");
  assert.equal(th.subject, "Q");
});

test("GDPR: a person's data can be exported, with identity files described but not included", async () => {
  const { h, as, ids } = await world();
  await as(ANN, "messages/c-acme", { method: "POST", body: { subject: "Hello", text: "My own words" } });
  await h.staff("POST", "identity-request", { userId: ids["s-ann"], kind: "passport", businesses: ["c-acme"] });
  const r = await h.call("default", "GET", "admin/gdpr-export", { headers: { "x-staff": "Kevin" }, query: { userId: ids["s-ann"] } });
  assert.equal(r.status, 200);
  assert.equal(r.body.person.email, "ann@example.com");
  assert.equal(r.body.messagesWritten[0].text, "My own words");
  assert.equal(r.body.identityDocuments.length, 1);
  assert.equal(r.body.access[0].level, "administrator");
  assert.equal((await h.call("default", "GET", "admin/gdpr-export", { query: { userId: ids["s-ann"] } })).status, 401);
});

test("GDPR: erasing a person removes what the practice need not keep, anonymises the rest and keeps the audit trail", async () => {
  const { h, as, ids } = await world();
  // identity file, a message, a request answer, an upload and a notification
  const idr = (await h.staff("POST", "identity-request", { userId: ids["s-ann"], kind: "passport", businesses: ["c-acme"] })).body.item;
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1), Buffer.from([0xff, 0xd9])]);
  const up = await as(ANN, `identity/${idr.id}/upload`, { method: "POST", body: { fileName: "p.jpg", content: b64(jpg), expiryDate: "2030-01-01" } });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  const stored = () => [...(h.raw.files?.map?.keys?.() || [])];
  await as(ANN, "messages/c-acme", { method: "POST", body: { subject: "Hello", text: "Ann's message" } });
  const rq = (await h.staff("POST", "requests-create", { clientKey: "c-acme", title: "Need" })).body.request;
  await as(ANN, `requests/c-acme/${rq.id}/respond`, { method: "POST", body: { text: "Here" } });
  await as(ANN, "documents/c-acme", { method: "POST", body: { title: "Ann's upload", fileName: "u.pdf", content: b64(await pdf("u")) } });
  assert.equal((await as(ANN, "notices/c-acme")).status, 200);

  const no = await h.staff("POST", "gdpr-erase", { userId: ids["s-ann"], confirm: "wrong@example.com" });
  assert.equal(no.status, 400, "needs the email typed to confirm");
  const r = await h.staff("POST", "gdpr-erase", { userId: ids["s-ann"], confirm: "ANN@example.com" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.erased.identity, 1); assert.ok(r.body.erased.files >= 1); assert.equal(r.body.erased.messages, 1); assert.equal(r.body.erased.uploads, 1);
  // she can no longer get anything
  const me = await as(ANN, "me");
  assert.ok(me.status !== 200 || me.body.businesses.length === 0, "no access any more");
  assert.equal((await as(ANN, "messages/c-acme")).status, 404);
  // the practice's side: names gone, content kept for the business
  const thread = (await h.call("default", "GET", "admin/messages", { headers: { "x-staff": "K" }, query: { clientKey: "c-acme" } })).body.threads[0];
  const opened = (await h.call("default", "GET", "admin/messages", { headers: { "x-staff": "K" }, query: { id: thread.id } })).body;
  assert.equal(opened.messages[0].name, "Former user");
  assert.equal(opened.thread.startedBy === "Ann Example", false);
  const reqs = (await h.call("default", "GET", "admin/requests", { headers: { "x-staff": "K" }, query: { clientKey: "c-acme" } })).body.requests;
  assert.equal(reqs[0].thread[0].name, "Former user");
  const docs = (await h.call("default", "GET", "admin/documents", { headers: { "x-staff": "K" }, query: { clientKey: "c-acme" } })).body.documents;
  assert.equal(docs.find((d) => d.title === "Ann's upload").uploadedBy, "Former user");
  assert.equal((await h.call("default", "GET", "admin/identity", { headers: { "x-staff": "K" }, query: { userId: ids["s-ann"] } })).body.items.length, 0, "identity records are gone");
  const people = (await h.call("default", "GET", "admin/overview", { headers: { "x-staff": "K" } })).body.users;
  const gone = people.find((p) => p.id === ids["s-ann"]);
  assert.ok(!JSON.stringify(gone).includes("ann@example.com") && !JSON.stringify(gone).includes("Ann Example"), "no name or email left on the account");
  // audit survives, and says what was erased without personal detail
  const ev = (await h.call("default", "GET", "admin/events", { headers: { "x-staff": "K" }, query: { limit: "300" } })).body.events;
  assert.ok(ev.some((e) => e.type === "gdpr.erased" && e.meta.identity === 1), "erasure is audited");
  assert.ok(ev.some((e) => e.userId === ids["s-ann"] && e.type !== "gdpr.erased"), "earlier audit events are kept");
  assert.equal((await h.staff("POST", "gdpr-erase", { userId: ids["s-ann"], confirm: "x" })).status, 409, "can't erase twice");
  // others are untouched
  assert.equal((await as(BEN, "messages/c-acme")).body.threads.length, 1);
});
