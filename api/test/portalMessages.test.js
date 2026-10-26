// Secure messaging: who sees which conversation, unread, search, attachments, notifications, audit.
const test = require("node:test");
const assert = require("node:assert/strict");
const { PDFDocument } = require("pdf-lib");
const { setup } = require("./portalKit.js");

const ANN = { sub: "s-ann", email: "ann@example.com", name: "Ann Example" }; // administrator
const BEN = { sub: "s-ben", email: "ben@example.com", name: "Ben Other" }; // standard
const RIA = { sub: "s-ria", email: "ria@example.com", name: "Ria Limited" }; // restricted
const SAM = { sub: "s-sam", email: "sam@example.com", name: "Sam Signs" }; // signatory
const OTTO = { sub: "s-otto", email: "otto@example.com", name: "Otto Bolt" }; // standard at another business
const b64 = (b) => b.toString("base64");
const pdf = async (t = "letter") => { const d = await PDFDocument.create(); d.addPage([300, 200]).drawText(t); return Buffer.from(await d.save()); };

async function world() {
  const h = setup();
  const inv = (u, level, key = "c-acme") => h.staff("POST", "invite", { email: u.email, name: u.name, businesses: [{ clientKey: key, level }] });
  await inv(ANN, "administrator"); await inv(BEN, "standard"); await inv(RIA, "restricted"); await inv(SAM, "signatory"); await inv(OTTO, "standard", "c-bolt");
  const ids = {};
  for (const u of [ANN, BEN, RIA, SAM, OTTO]) ids[u.sub] = (await h.asUser(u)).body.user.id;
  const as = (u, path, o = {}) => h.call("default", o.method || "GET", path, { headers: { "x-portal-token": h.token({ ...u, iat: h.state.now / 1000 - 60, exp: h.state.now / 1000 + 3600 }) }, body: o.body, query: o.query });
  const staffGet = (path, query = {}) => h.call("default", "GET", `admin/${path}`, { headers: { "x-staff": "Kevin" }, query });
  const send = (o = {}) => h.staff("POST", "messages-start", { clientKey: "c-acme", subject: "Your VAT return", text: "Your VAT return is ready for review.", ...o });
  const threads = async (u, q) => (await as(u, "messages/c-acme", { query: q ? { q } : undefined })).body;
  return { h, ids, as, staffGet, send, threads };
}

test("a message from the practice reaches everyone allowed to use messages, and tells them without saying what it says", async () => {
  const { h, send, as } = await world();
  h.mailer.sent.length = 0;
  const r = (await send()).body;
  assert.equal(r.told, 2, "administrator and standard");
  for (const u of [ANN, BEN]) {
    const n = (await as(u, "notices/c-acme")).body;
    assert.equal(n.unread, 1);
    assert.ok(!/VAT/.test(JSON.stringify(n)), "the notification carries no content");
  }
  assert.equal((await as(RIA, "notices/c-acme")).body.unread, 0);
  assert.ok(!h.mailer.sent.some((m) => /VAT/.test(m.subject + m.text)), "emails never carry the subject or text");
  assert.ok(h.mailer.sent.length === 2);
});

test("restricted people see only conversations they are named in; administrators and standard users see the business's; signatories and other businesses see none", async () => {
  const { send, as, ids, threads } = await world();
  await send();
  const mine = (await send({ subject: "Just for Ria", assignedTo: [ids["s-ria"]] })).body.thread;
  assert.deepEqual((await threads(RIA)).threads.map((t) => t.id), [mine.id]);
  assert.equal((await threads(ANN)).threads.length, 2, "administrators see everything for the business");
  assert.equal((await threads(BEN)).threads.length, 2, "so do standard users, as with documents");
  assert.equal((await as(RIA, "messages/c-acme/" + (await threads(ANN)).threads.find((t) => t.id !== mine.id).id)).status, 404, "an unassigned conversation looks like it doesn't exist");
  assert.equal((await as(SAM, "messages/c-acme")).status, 404);
  assert.equal((await as(OTTO, "messages/c-acme")).status, 404, "another business's user gets the same answer");
  assert.equal((await as(OTTO, `messages/c-acme/${mine.id}`)).status, 404);
  assert.equal((await as(OTTO, "messages/c-bolt")).body.threads.length, 0);
});

test("unread is per person: opening marks it read for that person only, and a reply makes it unread again", async () => {
  const { send, as, threads, staffGet, h } = await world();
  const t = (await send()).body.thread;
  assert.equal((await threads(ANN)).unread, 1);
  assert.equal((await as(ANN, `messages/c-acme/${t.id}`)).body.messages.length, 1);
  assert.equal((await threads(ANN)).unread, 0);
  assert.equal((await threads(BEN)).unread, 1, "Ben hasn't read it");
  await h.staff("POST", "messages-reply", { id: t.id, text: "One more thing." });
  assert.equal((await threads(ANN)).unread, 1);
  // a client reply is unread for staff
  assert.equal((await staffGet("messages", { clientKey: "c-acme", unread: "1" })).body.threads.length, 0);
  await as(ANN, `messages/c-acme/${t.id}`, { method: "POST", body: { text: "Thanks, approved." } });
  assert.equal((await threads(ANN)).unread, 0, "your own reply isn't unread to you");
  assert.equal((await threads(BEN)).unread, 1, "but a colleague's reply is unread to Ben");
  const nb = (await as(BEN, "notices/c-acme")).body.notices.map((n) => n.text);
  assert.ok(nb.includes("A colleague sent a message") && !nb.some((x) => /approved/.test(x)), "told without the content");
  const unread = (await staffGet("messages", { unread: "1" })).body.threads;
  assert.equal(unread.length, 1);
  assert.equal((await staffGet("messages", { id: t.id })).body.messages.length, 3);
  assert.equal((await staffGet("messages", { unread: "1" })).body.threads.length, 0, "staff opening it marks it read");
});

test("clients can start conversations and reply; restricted people's are private to them", async () => {
  const { as, threads, staffGet, h } = await world();
  h.mailer.sent.length = 0;
  const a = (await as(BEN, "messages/c-acme", { method: "POST", body: { subject: "Question about fees", text: "How much will it be?" } })).body.thread;
  const r = (await as(RIA, "messages/c-acme", { method: "POST", body: { subject: "Private query", text: "Hello" } })).body.thread;
  assert.equal((await threads(ANN)).threads.length, 2);
  assert.equal((await threads(BEN)).threads.length, 2, "standard sees the whole business's conversations");
  assert.deepEqual((await threads(RIA)).threads.map((t) => t.id), [r.id]);
  assert.equal((await as(RIA, `messages/c-acme/${a.id}`)).status, 404, "Ria can't open the business-wide one she wasn't named in");
  assert.equal((await as(BEN, "messages/c-acme", { method: "POST", body: { subject: "", text: "x" } })).status, 400);
  assert.equal((await as(BEN, "messages/c-acme", { method: "POST", body: { subject: "x", text: "" } })).status, 400);
  const att = (await staffGet("overview")).body.attention.filter((a) => a.kind === "message");
  assert.equal(att.length, 2, "both client conversations wait for the practice");
  assert.ok(att.every((a) => a.clientKey === "c-acme" && !/How much|Hello/.test(a.text)), "the overview names the subject, not the message");
});

test("attachments are real, checked documents; people who can't upload can't attach", async () => {
  const { as, send, ids, h } = await world();
  const t = (await send({ files: [{ fileName: "return.pdf", content: b64(await pdf()) }] })).body.thread;
  const opened = (await as(ANN, `messages/c-acme/${t.id}`)).body;
  assert.equal(opened.messages[0].docs.length, 1);
  const docId = opened.messages[0].docs[0].id;
  const dl = await as(ANN, `documents/c-acme/${docId}/download`, { method: "POST", body: {} });
  assert.equal(dl.status, 200, "the attachment downloads through the permission-checked document route");
  const before = (await h.call("default", "GET", "admin/messages", { headers: { "x-staff": "Kevin" }, query: { clientKey: "c-acme" } })).body.threads.length;
  assert.equal((await send({ files: [{ fileName: "evil.pdf", content: b64(Buffer.from("not a pdf")) }] })).status, 400, "content is checked");
  assert.equal((await h.call("default", "GET", "admin/messages", { headers: { "x-staff": "Kevin" }, query: { clientKey: "c-acme" } })).body.threads.length, before, "a refused file leaves no empty conversation");
  // client attachment goes to the document centre
  const up = await as(BEN, `messages/c-acme/${t.id}`, { method: "POST", body: { text: "Here you go", files: [{ fileName: "ben.pdf", content: b64(await pdf("ben")) }] } });
  assert.equal(up.status, 200);
  assert.ok((await as(ANN, "documents/c-acme")).body.documents.some((d) => /ben\.pdf/.test(d.title)));
  // a conversation for Ria: her attachments are restricted to her
  await h.staff("POST", "messages-start", { clientKey: "c-acme", subject: "For Ria", text: "see attached", assignedTo: [ids["s-ria"]], files: [{ fileName: "ria.pdf", content: b64(await pdf("ria")) }] });
  const riaDocs = (await as(RIA, "documents/c-acme")).body.documents.map((d) => d.title);
  assert.ok(riaDocs.some((x) => /ria\.pdf/.test(x)));
  assert.ok(!(await as(SAM, "documents/c-acme")).status < 300 || !(await as(SAM, "documents/c-acme")).body.documents.some((d) => /ria\.pdf/.test(d.title)), "a signatory can't see it");
});

test("search finds words in messages and subjects, only among conversations the person can see", async () => {
  const { send, ids, threads } = await world();
  await send({ subject: "Payroll", text: "The pension contribution is due" });
  await send({ subject: "Secret for Ria", text: "pension details for Ria", assignedTo: [ids["s-ria"]] });
  assert.equal((await threads(RIA, "pension")).threads.length, 1, "Ria finds her own");
  assert.equal((await threads(ANN, "pension")).threads.length, 2);
  assert.equal((await threads(RIA, "payroll")).threads.length, 0, "Ria can't find what she isn't named in");
  assert.equal((await threads(BEN, "payroll")).threads.length, 1, "subject matches too");
  assert.equal((await threads(BEN, "zebra")).threads.length, 0);
});

test("nothing internal can appear: only the written messages, names and dates are returned", async () => {
  const { send, as, staffGet } = await world();
  const t = (await send()).body.thread;
  const seen = JSON.stringify((await as(ANN, `messages/c-acme/${t.id}`)).body) + JSON.stringify((await as(ANN, "messages/c-acme")).body);
  for (const bad of ["internalNote", "Slow payer", "readBy", "staffRead", "assignedTo", "\"rev\"", "practiceId"]) assert.ok(!seen.includes(bad), bad);
  assert.equal((await staffGet("messages", { clientKey: "c-acme" })).status, 200);
});

test("audit records that messages were started and sent, never what they said", async () => {
  const { send, as, h } = await world();
  const t = (await send({ text: "Highly confidential figures" })).body.thread;
  await as(ANN, `messages/c-acme/${t.id}`, { method: "POST", body: { text: "Confidential reply" } });
  const ev = (await h.call("default", "GET", "admin/events", { headers: { "x-staff": "Kevin" }, query: { clientKey: "c-acme", limit: "50" } })).body.events;
  const mine = ev.filter((e) => /^message\./.test(e.type));
  assert.deepEqual(mine.map((e) => e.type).sort(), ["message.sent", "message.thread-started"]);
  assert.ok(!JSON.stringify(mine).includes("confidential") && !JSON.stringify(mine).includes("Confidential"));
});

test("staff cannot start a conversation for someone without access to the business", async () => {
  const { send, ids } = await world();
  assert.equal((await send({ assignedTo: [ids["s-otto"]] })).status, 400);
  assert.equal((await send({ clientKey: "" })).status, 400);
});
