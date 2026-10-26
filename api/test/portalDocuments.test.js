// The document centre: publishing, uploads and what each person may see and download.
const test = require("node:test");
const assert = require("node:assert/strict");
const { setup } = require("./portalKit.js");
const { checkUpload } = require("../portal/lib/uploads.js");

const ANN = { sub: "s-ann", email: "ann@example.com", name: "Ann Example" }; // administrator, Acme
const BEN = { sub: "s-ben", email: "ben@example.com", name: "Ben Other" }; // standard, Acme
const RIA = { sub: "s-ria", email: "ria@example.com", name: "Ria Limited" }; // restricted, Acme
const SAM = { sub: "s-sam", email: "sam@example.com", name: "Sam Signs" }; // signatory, Acme
const CAL = { sub: "s-cal", email: "cal@example.com", name: "Cal Elsewhere" }; // administrator, Bolt only

const pdf = (text = "hello") => Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n% ${text}\ntrailer<<>>\n%%EOF`);
const b64 = (b) => b.toString("base64");

async function world(opts) {
  const h = setup(opts);
  const inv = (u, level, key = "c-acme") => h.staff("POST", "invite", { email: u.email, name: u.name, businesses: [{ clientKey: key, level }] });
  await inv(ANN, "administrator"); await inv(BEN, "standard"); await inv(RIA, "restricted"); await inv(SAM, "signatory"); await inv(CAL, "administrator", "c-bolt");
  const ids = {};
  for (const u of [ANN, BEN, RIA, SAM, CAL]) ids[u.sub] = (await h.asUser(u)).body.user.id;
  const as = (u, path, o) => h.asUser(u, `documents/${path}`, "default", o);
  const add = async (extra = {}) => (await h.staff("POST", "documents-add", { clientKey: "c-acme", title: "Year end accounts", category: "Accounts", fileName: "accounts.pdf", content: b64(pdf("accounts")), publish: true, notify: false, ...extra })).body.document;
  const list = async (u, key = "c-acme", query = "") => (await h.call("default", "GET", `documents/${key}`, { headers: { "x-portal-token": h.token(u) }, query: Object.fromEntries(new URLSearchParams(query)) })).body;
  const names = async (u, key = "c-acme") => ((await list(u, key)).documents || []).map((d) => d.title);
  return { h, ids, as, add, list, names };
}

test("a draft is invisible to clients until staff publish it; publishing emails a notice with no title in it", async () => {
  const { h, add, names, ids } = await world();
  const d = await add({ publish: false, title: "Secret draft title" });
  assert.equal(d.published, false);
  assert.deepEqual(await names(ANN), []);
  h.mailer.sent.length = 0;
  const r = await h.staff("POST", "documents-publish", { id: d.id });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(await names(ANN), ["Secret draft title"]);
  const mails = h.mailer.sent.filter((m) => /new document/.test(m.subject));
  assert.ok(mails.length >= 2, "administrators and standard users are told");
  assert.ok(!mails.some((m) => /Secret draft title/.test(m.subject + m.text)), "the email never carries the title");
  assert.ok(!mails.some((m) => ["ria@example.com", "sam@example.com", "cal@example.com"].includes(m.to)), "unassigned people aren't told");
  assert.ok(ids);
});

test("download returns exactly what was stored and is audited; staff downloads are audited too", async () => {
  const { h, add, as } = await world();
  const bytes = pdf("exact");
  const d = await add({ content: b64(bytes) });
  const r = await as(ANN, `c-acme/${d.id}/download`, { method: "POST", body: {} });
  assert.equal(r.status, 200);
  assert.equal(Buffer.from(r.body.content, "base64").equals(bytes), true);
  assert.equal(r.body.fileName, "accounts.pdf");
  await h.staff("POST", "documents-download", { id: d.id });
  const events = (await h.staff("GET", "events")).body.events.map((e) => e.type);
  assert.ok(events.includes("document.published"));
  assert.equal(events.filter((t) => t === "document.downloaded").length, 2);
});

test("the client never sees storage paths, internal notes or the file store layout", async () => {
  const { add, list } = await world();
  await add({ internalNote: "client is dodgy about this one" });
  const s = JSON.stringify(await list(ANN));
  assert.ok(!/dodgy|internalNote|path|practiceId|default\/c-acme/.test(s), s);
});

test("files that aren't what they claim are refused", () => {
  const ok = (fileName, bytes) => checkUpload({ fileName, bytes });
  assert.equal(ok("a.pdf", pdf()).ok, true);
  assert.equal(ok("a.pdf", Buffer.from("MZ\x90\x00 program")).ok, false, "a program renamed to .pdf");
  assert.equal(ok("a.html", Buffer.from("<html><script>x</script>")).ok, false);
  assert.equal(ok("a.svg", Buffer.from("<svg onload=x>")).ok, false);
  assert.equal(ok("a.exe", Buffer.from("MZ")).ok, false);
  assert.equal(ok("a.pdf.exe", pdf()).ok, false);
  assert.equal(ok("a.exe.pdf", pdf()).ok, false, "double extension");
  assert.equal(ok("noext", pdf()).ok, false);
  assert.equal(ok("a.pdf", Buffer.alloc(0)).ok, false);
  assert.equal(ok("a.pdf", Buffer.concat([pdf(), Buffer.from("/JavaScript (app.alert(1))")])).ok, false, "PDF with script");
  assert.equal(ok("a.pdf", Buffer.concat([pdf(), Buffer.from("/Launch /Win")])).ok, false);
  assert.equal(ok("a.docx", Buffer.from("PK\x03\x04 not really")).ok, false, "zip without office parts");
  const macro = Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.alloc(26), Buffer.from("[Content_Types].xml word/document.xml word/vbaProject.bin")]);
  assert.equal(ok("a.docx", macro).ok, false, "macro-enabled");
  const docx = Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.alloc(26), Buffer.from("[Content_Types].xml word/document.xml")]);
  assert.equal(ok("a.docx", docx).ok, true);
  assert.equal(checkUpload({ fileName: "big.pdf", bytes: Buffer.concat([pdf(), Buffer.alloc(2048)]), maxBytes: 1024 }).ok, false);
  assert.equal(ok("../../etc/passwd.pdf", pdf()).name, "passwd.pdf", "folders in the name are dropped");
  assert.equal(ok("a.png", Buffer.from("89504e470d0a1a0a", "hex").length === 8 ? Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(4)]) : null).ok, true);
});

test("a refused or bad upload stores nothing", async () => {
  const { h, as } = await world();
  const r = await as(ANN, "c-acme", { method: "POST", body: { fileName: "x.pdf", content: b64(Buffer.from("not a pdf")) } });
  assert.equal(r.status, 400);
  assert.equal(h.raw.files.files.size, 0);
  const r2 = await as(ANN, "c-acme", { method: "POST", body: { fileName: "x.pdf", content: "!!!not base64!!!" } });
  assert.equal(r2.status, 400);
});

test("a scanner plugged in can refuse a file, and that is recorded", async () => {
  const { createHandler } = require("../portal/index.js");
  const kit = setup();
  // Re-build a handler sharing the kit's store but with a scanner that rejects everything.
  const h = kit;
  const scanning = createHandler({
    env: { PORTAL_PRACTICE_ID: "default", PORTAL_AUDIT_KEY: "audit-secret", PORTAL_IDP_ISSUER: "x", PORTAL_IDP_CLIENT_ID: "x", PORTAL_IDP_JWKS_URL: "x" },
    store: h.raw, mailer: h.mailer, now: () => h.state.now, reader: { clients: async () => h.rows, updateClient: async () => {} },
    staffAuth: async () => ({ name: "Kevin" }), scanner: async () => ({ ok: false }),
  });
  const res = await scanning({ bindingData: { path: "admin/documents-add" } }, { method: "POST", headers: {}, body: { clientKey: "c-acme", fileName: "a.pdf", content: b64(pdf()) }, query: {} });
  assert.equal(res.status, 400);
  assert.equal(h.raw.files.files.size, 0);
  const ev = (await h.staff("GET", "events")).body.events.map((e) => e.type);
  assert.ok(ev.includes("document.refused"));
});

test("administrators and standard users see everything published; restricted and signatory only what's assigned to them", async () => {
  const { add, names, ids } = await world();
  await add({ title: "For everyone" });
  await add({ title: "Just Ria", assignedTo: [ids["s-ria"]] });
  await add({ title: "Just Sam", assignedTo: [ids["s-sam"]] });
  assert.deepEqual((await names(ANN)).sort(), ["For everyone", "Just Ria", "Just Sam"]);
  assert.deepEqual((await names(BEN)).sort(), ["For everyone", "Just Ria", "Just Sam"]);
  assert.deepEqual(await names(RIA), ["Just Ria"]);
  assert.deepEqual(await names(SAM), ["Just Sam"]);
});

test("a person can't fetch a document that isn't theirs, by id, and gets the same answer as for one that doesn't exist", async () => {
  const { add, as, ids } = await world();
  const forSam = await add({ title: "Just Sam", assignedTo: [ids["s-sam"]] });
  const forAll = await add({ title: "Everyone" });
  const missing = await as(RIA, `c-acme/doc-nope/download`, { method: "POST", body: {} });
  const hidden = await as(RIA, `c-acme/${forSam.id}/download`, { method: "POST", body: {} });
  assert.equal(hidden.status, 404);
  assert.deepEqual(hidden.body, missing.body);
  // Cal has access to Bolt only: Acme's documents are out of reach, by listing and by id.
  assert.equal((await as(CAL, "c-acme")).status, 404);
  assert.equal((await as(CAL, `c-acme/${forAll.id}/download`, { method: "POST", body: {} })).status, 404);
  // ...and a document of Acme can't be fetched by presenting it under Bolt.
  assert.equal((await as(CAL, `c-bolt/${forAll.id}/download`, { method: "POST", body: {} })).status, 404);
});

test("drafts, unpublished and archived documents can't be downloaded even with the id", async () => {
  const { h, add, as } = await world();
  const d = await add({ publish: false });
  assert.equal((await as(ANN, `c-acme/${d.id}/download`, { method: "POST", body: {} })).status, 404);
  await h.staff("POST", "documents-publish", { id: d.id, notify: false });
  assert.equal((await as(ANN, `c-acme/${d.id}/download`, { method: "POST", body: {} })).status, 200);
  await h.staff("POST", "documents-unpublish", { id: d.id });
  assert.equal((await as(ANN, `c-acme/${d.id}/download`, { method: "POST", body: {} })).status, 404);
  await h.staff("POST", "documents-publish", { id: d.id, notify: false });
  await h.staff("POST", "documents-archive", { id: d.id });
  assert.equal((await as(ANN, `c-acme/${d.id}/download`, { method: "POST", body: {} })).status, 404);
});

test("assigning a document to someone without access to the business is refused", async () => {
  const { h, ids } = await world();
  const r = await h.staff("POST", "documents-add", { clientKey: "c-acme", fileName: "a.pdf", content: b64(pdf()), assignedTo: [ids["s-cal"]] });
  assert.equal(r.status, 400);
});

test("client uploads: standard users share with the business; restricted users' uploads stay with them and administrators", async () => {
  const { as, names } = await world();
  const up = (u, title) => as(u, "c-acme", { method: "POST", body: { title, fileName: "bank.pdf", content: b64(pdf(title)) } });
  assert.equal((await up(BEN, "Ben's bank statement")).status, 200);
  assert.equal((await up(RIA, "Ria's payslip")).status, 200);
  assert.deepEqual((await names(ANN)).sort(), ["Ben's bank statement", "Ria's payslip"]);
  assert.deepEqual((await names(BEN)).sort(), ["Ben's bank statement", "Ria's payslip"]);
  assert.deepEqual(await names(RIA), ["Ria's payslip"]);
  // A signatory can't upload at all.
  assert.equal((await up(SAM, "x")).status, 404);
});

test("uploads reach staff: an attention item, an alert email, and an audit event with the file's hash", async () => {
  const { h, as } = await world();
  h.mailer.sent.length = 0;
  await as(BEN, "c-acme", { method: "POST", body: { title: "Bank", fileName: "bank.pdf", content: b64(pdf("bank")) } });
  const ov = (await h.staff("GET", "overview")).body;
  assert.ok(ov.attention.some((a) => a.kind === "document" && /Ben Other uploaded/.test(a.text)));
  assert.ok(h.mailer.sent.some((m) => m.to === "practice@bannister.test" && /uploaded a document/.test(m.subject)));
  const e = (await h.staff("GET", "events")).body.events.find((x) => x.type === "document.uploaded");
  assert.match(e.meta.sha256, /^[0-9a-f]{64}$/);
  const list = (await h.staff("GET", "documents", undefined)).status;
  assert.ok(list);
  const docs = (await h.call("default", "GET", "admin/documents", { headers: { "x-staff": "Kevin" }, query: { clientKey: "c-acme" } })).body.documents;
  await h.staff("POST", "documents-seen", { id: docs[0].id });
  assert.equal((await h.staff("GET", "overview")).body.attention.filter((a) => a.kind === "document").length, 0);
});

test("people can replace only their own uploads, and each version stays downloadable", async () => {
  const { as } = await world();
  const first = (await as(BEN, "c-acme", { method: "POST", body: { title: "Bank", fileName: "bank.pdf", content: b64(pdf("v1")) } })).body.document;
  assert.equal((await as(ANN, "c-acme", { method: "POST", body: { replaces: first.id, fileName: "bank.pdf", content: b64(pdf("hijack")) } })).status, 403);
  const second = (await as(BEN, "c-acme", { method: "POST", body: { replaces: first.id, fileName: "bank2.pdf", content: b64(pdf("v2")) } })).body.document;
  assert.equal(second.versions.length, 2);
  const v1 = await as(ANN, `c-acme/${first.id}/download`, { method: "POST", body: { version: 1 } });
  const v2 = await as(ANN, `c-acme/${first.id}/download`, { method: "POST", body: {} });
  assert.match(Buffer.from(v1.body.content, "base64").toString(), /v1/);
  assert.match(Buffer.from(v2.body.content, "base64").toString(), /v2/);
});

test("approval: records who, when and which exact version; a new version needs approving again", async () => {
  const { h, add, as, ids } = await world();
  const d = await add({ requiresApproval: true, assignedTo: [ids["s-ria"]] });
  assert.equal(d.status, "awaiting-approval");
  assert.equal((await as(SAM, `c-acme/${d.id}/approve`, { method: "POST", body: { decision: "approved" } })).status, 404, "not assigned to Sam");
  assert.equal((await as(RIA, `c-acme/${d.id}/approve`, { method: "POST", body: { decision: "maybe" } })).status, 400);
  const r = await as(RIA, `c-acme/${d.id}/approve`, { method: "POST", body: { decision: "approved", note: "Looks right" } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.document.status, "approved");
  assert.equal(r.body.document.approval.by, "Ria Limited");
  assert.equal((await as(RIA, `c-acme/${d.id}/approve`, { method: "POST", body: { decision: "approved" } })).status, 409, "no double approval");
  const ev = (await h.staff("GET", "events")).body.events.find((e) => e.type === "document.approved");
  assert.match(ev.meta.sha256, /^[0-9a-f]{64}$/);
  const nv = await h.staff("POST", "documents-version", { id: d.id, fileName: "accounts v2.pdf", content: b64(pdf("changed")), notify: false });
  assert.equal(nv.body.document.status, "awaiting-approval");
  assert.equal(nv.body.document.approval, null);
});

test("a document that doesn't need approving can't be 'approved'", async () => {
  const { add, as } = await world();
  const d = await add();
  assert.equal((await as(ANN, `c-acme/${d.id}/approve`, { method: "POST", body: { decision: "approved" } })).status, 400);
});

test("search and category filters work and stay within what the person may see", async () => {
  const { add, list, ids } = await world();
  await add({ title: "VAT return Q1", category: "VAT" });
  await add({ title: "Payroll June", category: "Payroll" });
  await add({ title: "Ria VAT note", category: "VAT", assignedTo: [ids["s-ria"]] });
  assert.deepEqual((await list(ANN, "c-acme", "category=VAT")).documents.map((d) => d.title).sort(), ["Ria VAT note", "VAT return Q1"]);
  assert.deepEqual((await list(ANN, "c-acme", "q=payroll")).documents.map((d) => d.title), ["Payroll June"]);
  assert.deepEqual((await list(RIA, "c-acme", "q=vat")).documents.map((d) => d.title), ["Ria VAT note"]);
});

test("one practice can't reach another practice's files", async () => {
  const kit = setup({ practices: ["pa", "pb"] });
  const inv = await kit.staff("POST", "invite", { email: ANN.email, name: ANN.name, businesses: [{ clientKey: "c-acme", level: "administrator" }] }, "pa");
  assert.equal(inv.status, 200);
  await kit.asUser(ANN, "me", "pa");
  const add = await kit.staff("POST", "documents-add", { clientKey: "c-acme", fileName: "a.pdf", content: b64(pdf("pa-secret")), publish: true, notify: false }, "pa");
  const id = add.body.document.id;
  // Practice B's staff can't read or change practice A's document, and its files are stored apart.
  assert.equal((await kit.staff("POST", "documents-download", { id }, "pb")).status, 404);
  assert.equal((await kit.staff("POST", "documents-archive", { id }, "pb")).status, 404);
  assert.ok([...kit.raw.files.files.keys()].every((k) => k.startsWith("pa/")));
});

test("audit events never contain file contents", async () => {
  const { h, add } = await world();
  await add({ content: b64(pdf("TOPSECRETCONTENT")) });
  const all = JSON.stringify((await h.staff("GET", "events")).body.events);
  assert.ok(!all.includes("TOPSECRETCONTENT") && !all.includes(b64(pdf("TOPSECRETCONTENT")).slice(0, 40)));
});
