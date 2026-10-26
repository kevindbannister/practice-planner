// Information requests, in-portal notifications and the central reminder engine.
const test = require("node:test");
const assert = require("node:assert/strict");
const { PDFDocument } = require("pdf-lib");
const { setup } = require("./portalKit.js");

const ANN = { sub: "s-ann", email: "ann@example.com", name: "Ann Example" }; // administrator
const BEN = { sub: "s-ben", email: "ben@example.com", name: "Ben Other" }; // standard
const RIA = { sub: "s-ria", email: "ria@example.com", name: "Ria Limited" }; // restricted
const SAM = { sub: "s-sam", email: "sam@example.com", name: "Sam Signs" }; // signatory
const DAY = 24 * 3600 * 1000;
const b64 = (b) => b.toString("base64");
const pdf = async (t = "letter") => { const d = await PDFDocument.create(); d.addPage([300, 200]).drawText(t); return Buffer.from(await d.save()); };

async function world(opts) {
  const h = setup(opts);
  const inv = (u, level, key = "c-acme") => h.staff("POST", "invite", { email: u.email, name: u.name, businesses: [{ clientKey: key, level }] });
  await inv(ANN, "administrator"); await inv(BEN, "standard"); await inv(RIA, "restricted"); await inv(SAM, "signatory");
  const ids = {};
  for (const u of [ANN, BEN, RIA, SAM]) ids[u.sub] = (await h.asUser(u)).body.user.id;
  const as = (u, path, o = {}) => h.call("default", o.method || "GET", path, { headers: { "x-portal-token": h.token({ ...u, iat: h.state.now / 1000 - 60, exp: h.state.now / 1000 + 3600 }) }, body: o.body, query: o.query });
  const ask = (o = {}) => h.staff("POST", "requests-create", { clientKey: "c-acme", title: "Last year's bank statements", details: "All accounts please", ...o });
  const notices = async (u, biz = "c-acme") => (await as(u, `notices/${biz}`)).body;
  const run = async () => (await h.staff("POST", "reminders-run", {})).body;
  const overview = async () => (await h.call("default", "GET", "admin/reminders", { headers: { "x-staff": "Kevin" } })).body;
  const advance = (days) => { h.state.now += days * DAY; };
  const mails = (re) => h.mailer.sent.filter((m) => re.test(m.subject));
  return { h, ids, as, ask, notices, run, overview, advance, mails };
}

// ------------------------------------------------------------------------ information requests
test("a request goes to everyone who may answer, as a notification and an email that doesn't carry the title", async () => {
  const { h, ask, notices, mails } = await world();
  h.mailer.sent.length = 0;
  const r = (await ask()).body.request;
  assert.equal(r.told, 2, "administrator and standard");
  assert.equal((await notices(ANN)).unread, 1);
  assert.equal((await notices(BEN)).unread, 1);
  assert.equal((await notices(RIA)).unread, 0, "restricted people only get what is assigned to them");
  assert.equal((await notices(SAM)).unread, 0);
  assert.ok(!mails(/information/).some((m) => /bank statements/.test(m.subject + m.text)));
});

test("a request limited to named people is seen, answered and notified only for them", async () => {
  const { h, ask, as, ids, notices } = await world();
  const r = (await ask({ assignedTo: [ids["s-ria"]] })).body.request;
  const seen = async (u) => (await as(u, "requests/c-acme")).body.requests.map((x) => x.id);
  assert.deepEqual(await seen(RIA), [r.id]);
  assert.deepEqual(await seen(ANN), [r.id], "administrators see everything for the business");
  assert.equal((await notices(RIA)).unread, 1);
  assert.equal((await ask({ title: "Another", assignedTo: [ids["s-ann"]] })).status, 200);
  assert.equal((await seen(RIA)).length, 1, "Ria doesn't see the one for Ann");
  assert.equal((await as(SAM, "requests/c-acme")).status, 404, "signatory level has no requests");
  assert.equal((await h.staff("POST", "requests-create", { clientKey: "c-acme", title: "x", assignedTo: ["nobody"] })).status, 400);
});

test("answering: words and files; files land in the document centre; the practice is alerted; staff can ask for more or finish", async () => {
  const { h, ask, as, ids } = await world();
  const r = (await ask()).body.request;
  const empty = await as(ANN, `requests/c-acme/${r.id}/respond`, { method: "POST", body: { text: "  " } });
  assert.equal(empty.status, 400);
  const ok = await as(ANN, `requests/c-acme/${r.id}/respond`, { method: "POST", body: { text: "Here you go", files: [{ fileName: "jan.pdf", content: b64(await pdf("jan")) }, { fileName: "feb.pdf", content: b64(await pdf("feb")) }] } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.request.status, "responded");
  assert.equal(ok.body.request.thread[0].docs.length, 2);
  const docs = (await as(ANN, "documents/c-acme")).body.documents;
  assert.equal(docs.filter((d) => /bank statements/.test(d.title)).length, 2);
  assert.ok((await h.staff("GET", "overview")).body.attention.some((a) => a.kind === "request" && /Ann Example answered/.test(a.text)));
  // A bad attachment refuses the whole answer rather than half-saving it.
  const r2 = (await ask({ title: "Second" })).body.request;
  const bad = await as(ANN, `requests/c-acme/${r2.id}/respond`, { method: "POST", body: { text: "x", files: [{ fileName: "x.pdf", content: b64(Buffer.from("not a pdf")) }] } });
  assert.equal(bad.status, 400);
  assert.equal((await as(ANN, "requests/c-acme")).body.requests.find((x) => x.id === r2.id).status, "open");
  // Staff ask for more, then finish.
  const more = await h.staff("POST", "requests-reply", { id: r.id, text: "Can you add March?" });
  assert.equal(more.body.request.status, "open");
  assert.equal((await h.staff("POST", "requests-complete", { id: r.id })).body.request.status, "complete");
  assert.equal((await as(ANN, `requests/c-acme/${r.id}/respond`, { method: "POST", body: { text: "more" } })).status, 409);
  assert.ok(ids);
});

test("a request is only for its own business; outsiders, other businesses and cancelled requests are invisible", async () => {
  const { h, ask, as } = await world();
  await h.staff("POST", "invite", { email: "cal@example.com", name: "Cal", businesses: [{ clientKey: "c-bolt", level: "administrator" }] });
  const CAL = { sub: "s-cal", email: "cal@example.com", name: "Cal" };
  await h.asUser(CAL);
  const r = (await ask()).body.request;
  assert.equal((await as(CAL, "requests/c-acme")).status, 404);
  assert.equal((await as(CAL, `requests/c-bolt/${r.id}/respond`, { method: "POST", body: { text: "x" } })).status, 404);
  assert.equal((await as(BEN, `requests/c-acme/${r.id}/respond`, { method: "POST", body: { text: "mine" } })).status, 200);
  const r3 = (await ask({ title: "Cancelled one" })).body.request;
  await h.staff("POST", "requests-cancel", { id: r3.id });
  assert.ok(!(await as(ANN, "requests/c-acme")).body.requests.some((x) => x.id === r3.id));
});

// ------------------------------------------------------------------------ notifications
test("notifications are private, can be marked read, and carry no document names", async () => {
  const { h, notices, as, ask } = await world();
  const d = (await h.staff("POST", "documents-add", { clientKey: "c-acme", title: "Secret Merger Plan", fileName: "m.pdf", content: b64(await pdf()), publish: true, notify: true })).body.document;
  await ask();
  const mine = await notices(ANN);
  assert.equal(mine.notices.length, 2);
  assert.ok(!JSON.stringify(mine).includes("Merger"));
  assert.equal((await as(ANN, "notices/c-acme/read", { method: "POST", body: { ids: [mine.notices[0].id] } })).body.unread, 1);
  assert.equal((await as(ANN, "notices/c-acme/read", { method: "POST", body: {} })).body.unread, 0);
  assert.equal((await notices(BEN)).unread, 2, "Ann reading hers doesn't touch Ben's");
  assert.equal((await as(ANN, "notices/c-bolt")).status, 404);
  assert.ok(d);
});

// ------------------------------------------------------------------------ the reminder engine
async function signingWorld(w) {
  const { h, ids } = w;
  const doc = (await h.staff("POST", "documents-add", { clientKey: "c-acme", title: "Engagement letter", fileName: "l.pdf", content: b64(await pdf()), publish: false })).body.document;
  const r = (await h.staff("POST", "signing-create", { clientKey: "c-acme", docId: doc.id, signatoryIds: [ids["s-ann"], ids["s-sam"]], sequential: true, expiresInDays: 90 })).body.request;
  h.mailer.sent.length = 0;
  return r;
}

test("an unsigned document: nothing for 3 days, then a reminder to whoever is due, repeating every 3 days up to 5", async () => {
  const w = await world();
  await signingWorld(w);
  const { h, run, advance, mails } = w;
  advance(2); assert.equal((await run()).sent, 0);
  advance(1); assert.equal((await run()).sent, 1);
  assert.deepEqual(mails(/reminder/).map((m) => m.to), ["ann@example.com"], "only the person whose turn it is");
  assert.equal((await run()).sent, 0, "running again changes nothing");
  for (let i = 0; i < 4; i++) { advance(3); assert.equal((await run()).sent, 1, `reminder ${i + 2}`); }
  advance(3); assert.equal((await run()).sent, 0, "stops at the maximum");
  assert.ok(!mails(/reminder/).some((m) => /Engagement letter/.test(m.subject + m.text)));
});

test("reminders stop by themselves once the thing is done", async () => {
  const w = await world();
  const r = await signingWorld(w);
  const { h, run, advance } = w;
  await h.asUser(ANN, `signing/c-acme/${r.id}/sign`, "default", { method: "POST", body: { mode: "typed", typedName: "Ann Example", consent: true } });
  h.mailer.sent.length = 0;
  advance(3); await run();
  // Ann signed, so it is Sam's turn: his clock starts when Ann signed, not when it was sent.
  assert.deepEqual(h.mailer.sent.filter((m) => /reminder/.test(m.subject)).map((m) => m.to), ["sam@example.com"]);
  await h.staff("POST", "signing-cancel", { id: r.id });
  h.mailer.sent.length = 0;
  advance(30); assert.equal((await run()).sent, 0);
});

test("several things due for one person go out as one email", async () => {
  const w = await world();
  await signingWorld(w);
  const { h, ask, run, advance, mails } = w;
  await ask({ title: "Bank statements" }); await ask({ title: "VAT workings" });
  h.mailer.sent.length = 0;
  advance(3);
  const r = await run();
  assert.equal(r.items, 3, "the signing and the two requests");
  const toAnn = mails(/reminder/).filter((m) => m.to === "ann@example.com");
  assert.equal(toAnn.length, 1, "one email to Ann, not three");
  assert.match(toAnn[0].text, /a document to sign/);
  assert.match(toAnn[0].text, /a request for information/);
  assert.ok(!/Bank statements|VAT workings/.test(toAnn[0].text));
});

test("the scheduled sweep sends nothing outside 07:00 to 19:00 UK time and catches up when it next runs; 'run now' is a deliberate exception", async () => {
  const w = await world({ env: { PORTAL_SWEEP_KEY: "k" } });
  await signingWorld(w);
  const { h, advance } = w;
  const sweep = async () => (await h.call("default", "POST", "system/sweep", { headers: { "x-sweep-key": "k" } })).body;
  advance(3);
  h.state.now = Date.UTC(2026, 10, 2, 22, 0, 0); // 22:00 UK on 2 Nov
  const night = await sweep();
  assert.equal(night.sent, 0);
  assert.equal(night.skipped, "outside sending hours");
  h.state.now = Date.UTC(2026, 10, 3, 8, 0, 0);
  assert.equal((await sweep()).sent, 1);
  // Staff pressing "Run now" at night does send.
  const w2 = await world();
  await signingWorld(w2);
  w2.advance(3); w2.h.state.now = Date.UTC(2026, 10, 2, 22, 0, 0);
  assert.equal((await w2.run()).sent, 1);
});

test("the practice can pause everything, pause one reminder, cancel one, or move one to a date", async () => {
  const w = await world();
  const r = await signingWorld(w);
  const { h, run, advance, overview } = w;
  advance(3);
  await h.staff("POST", "reminders-settings", { paused: true });
  assert.equal((await run()).sent, 0);
  assert.equal((await run()).skipped, "paused");
  await h.staff("POST", "reminders-settings", { paused: false });
  const key = `signing:${r.id}`;
  await h.staff("POST", "reminders-item", { key, paused: true });
  assert.equal((await run()).sent, 0);
  assert.equal((await overview()).items.find((i) => i.key === key).paused, true);
  await h.staff("POST", "reminders-item", { key, paused: false });
  const later = new Date(h.state.now + 5 * DAY).toISOString();
  await h.staff("POST", "reminders-item", { key, nextAt: later });
  assert.equal((await run()).sent, 0, "rescheduled for later");
  assert.equal((await overview()).items.find((i) => i.key === key).nextDue, later);
  advance(5); assert.equal((await run()).sent, 1, "then it goes");
  await h.staff("POST", "reminders-item", { key, cancelled: true });
  advance(30); assert.equal((await run()).sent, 0);
  const ev = (await h.staff("GET", "events")).body.events.map((e) => e.type);
  for (const t of ["reminder.sent", "reminder.paused", "reminder.resumed", "reminder.rescheduled", "reminder.cancelled", "reminder.settings"]) assert.ok(ev.includes(t), t);
});

test("each kind has its own policy that the practice can change, within sensible limits", async () => {
  const w = await world();
  await w.ask();
  const { h, run, advance, overview } = w;
  await h.staff("POST", "reminders-settings", { kinds: { request: { firstAfterDays: 1, repeatEveryDays: 2, max: 2 }, signing: { enabled: false } } });
  const o = await overview();
  assert.equal(o.kinds.request.firstAfterDays, 1);
  assert.equal(o.kinds.signing.enabled, false);
  advance(1); assert.equal((await run()).sent, 1);
  advance(2); assert.equal((await run()).sent, 1);
  advance(2); assert.equal((await run()).sent, 0, "max of 2");
  await h.staff("POST", "reminders-settings", { kinds: { request: { firstAfterDays: 9999, repeatEveryDays: -4, max: 500 } } });
  const k = (await overview()).kinds.request;
  assert.deepEqual([k.firstAfterDays, k.repeatEveryDays, k.max], [90, 1, 20]);
});

test("unanswered questions about requested changes and documents waiting for approval are chased too", async () => {
  const w = await world();
  const { h, as, run, advance, mails } = w;
  const ch = await as(ANN, "changes/c-acme", { method: "POST", body: { items: [{ key: "phone", value: "0200 111" }], note: "" } });
  await h.staff("POST", "changes-ask", { id: ch.body.request.id, text: "Is that the main line?" });
  await h.staff("POST", "documents-add", { clientKey: "c-acme", title: "Accounts", fileName: "a.pdf", content: b64(await pdf()), publish: true, notify: false, requiresApproval: true });
  h.mailer.sent.length = 0;
  advance(3);
  const r = await run();
  assert.equal(r.items, 2);
  const toAnn = mails(/reminder/).filter((m) => m.to === "ann@example.com")[0];
  assert.match(toAnn.text, /question about your requested changes/);
  assert.match(toAnn.text, /a document to approve/);
  assert.deepEqual(mails(/reminder/).map((m) => m.to).sort(), ["ann@example.com", "ben@example.com"], "Ben can approve documents but didn't ask the change");
});

test("the engine also runs the identity renewals, and the overview shows what was last done", async () => {
  const w = await world();
  const { h, ids, run, advance, overview } = w;
  const it = (await h.staff("POST", "identity-request", { userId: ids["s-ann"], kind: "passport", autoRenew: true })).body.item;
  await h.asUser(ANN, `identity/${it.id}/upload`, "default", { method: "POST", body: { fileName: "p.jpg", content: b64(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from("x")])) } });
  await h.call("default", "POST", "admin/identity-download", { headers: { "x-staff": "Kevin" }, body: { id: it.id } });
  const expiry = new Date(h.state.now + 40 * DAY).toISOString().slice(0, 10);
  await h.call("default", "POST", "admin/identity-accept", { headers: { "x-staff": "Kevin" }, body: { id: it.id, expiryDate: expiry, confirmed: true } });
  assert.equal((await run()).identity.requested, 0);
  advance(11);
  assert.equal((await run()).identity.requested, 1, "a calendar month before expiry");
  const o = await overview();
  assert.ok(o.lastSweepAt);
  assert.equal(o.lastResult.identity.requested, 1);
});

test("the scheduled trigger runs the sweep with the shared key, and refuses everything else", async () => {
  const w = await world({ env: { PORTAL_SWEEP_KEY: "sweep-secret" } });
  await signingWorld(w);
  const { h, advance } = w;
  advance(3);
  const post = (key) => h.call("default", "POST", "system/sweep", { headers: key === undefined ? {} : { "x-sweep-key": key } });
  assert.equal((await post()).status, 401);
  assert.equal((await post("wrong")).status, 401);
  assert.equal((await post("sweep-secret ")).status, 401, "not even a trailing space");
  const ok = await post("sweep-secret");
  assert.equal(ok.status, 200);
  assert.equal(ok.body.sent, 1);
  assert.notEqual((await h.call("default", "GET", "system/sweep", { headers: { "x-sweep-key": "sweep-secret" } })).status, 200, "POST only");
  const unset = setup();
  assert.equal((await unset.call("default", "POST", "system/sweep", { headers: { "x-sweep-key": "anything" } })).status, 503, "no key configured means it is off");
});

test("a practice's sweep only touches its own items", async () => {
  const kit = setup({ practices: ["pa", "pb"], env: { PORTAL_SWEEP_KEY: "k" } });
  await kit.staff("POST", "invite", { email: ANN.email, name: ANN.name, businesses: [{ clientKey: "c-acme", level: "administrator" }] }, "pa");
  await kit.asUser(ANN, "me", "pa");
  await kit.staff("POST", "requests-create", { clientKey: "c-acme", title: "Pa's request" }, "pa");
  kit.state.now += 4 * DAY;
  kit.mailer.sent.length = 0;
  const b = await kit.call("pb", "POST", "system/sweep", { headers: { "x-sweep-key": "k" } });
  assert.equal(b.body.sent, 0);
  assert.equal(kit.mailer.sent.filter((m) => /reminder/.test(m.subject)).length, 0);
  const a = await kit.call("pa", "POST", "system/sweep", { headers: { "x-sweep-key": "k" } });
  assert.equal(a.body.sent, 1);
});
