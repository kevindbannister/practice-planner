// Identity documents: who can see them, how they are checked, and how renewals repeat.
const test = require("node:test");
const assert = require("node:assert/strict");
const { setup, NOW } = require("./portalKit.js");
const { addMonths } = require("../portal/lib/identity.js");

const ANN = { sub: "s-ann", email: "ann@example.com", name: "Ann Example" }; // administrator, Acme
const BEN = { sub: "s-ben", email: "ben@example.com", name: "Ben Other" }; // standard, Acme
const CAL = { sub: "s-cal", email: "cal@example.com", name: "Cal Elsewhere" }; // Bolt only
const DAY = 24 * 3600 * 1000;

const jpg = (tag = "passport photo") => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`JFIF ${tag}`)]);
const b64 = (b) => b.toString("base64");

async function world(opts) {
  const h = setup(opts);
  const inv = (u, level, key = "c-acme") => h.staff("POST", "invite", { email: u.email, name: u.name, businesses: [{ clientKey: key, level }] });
  await inv(ANN, "administrator"); await inv(BEN, "standard"); await inv(CAL, "administrator", "c-bolt");
  const ids = {};
  for (const u of [ANN, BEN, CAL]) ids[u.sub] = (await h.asUser(u)).body.user.id;
  const as = (u, path, o = {}) => h.call("default", o.method || "GET", path, { headers: { "x-portal-token": h.token({ ...u, iat: h.state.now / 1000 - 60, exp: h.state.now / 1000 + 3600 }) }, body: o.body });
  const mine = async (u) => (await as(u, "identity")).body.items;
  const ask = async (o = {}) => h.staff("POST", "identity-request", { userId: ids["s-ann"], kind: "passport", businesses: ["c-acme"], autoRenew: true, ...o });
  const upload = (u, id, o = {}) => as(u, `identity/${id}/upload`, { method: "POST", body: { fileName: "passport.jpg", content: b64(jpg()), ...o } });
  const view = (id, which = "upload", by = "Kevin") => h.call("default", "POST", "admin/identity-download", { headers: { "x-staff": by }, body: { id, which } });
  const accept = (id, o = {}, by = "Kevin", email = "") => h.call("default", "POST", "admin/identity-accept", { headers: { "x-staff": by, "x-staff-email": email }, body: { id, expiryDate: "2027-09-15", confirmed: true, ...o } });
  const items = async () => (await h.call("default", "GET", "admin/identity", { headers: { "x-staff": "Kevin" }, query: {} })).body.items;
  const sweep = async () => (await h.staff("POST", "identity-sweep", {})).body;
  const goTo = (date) => { h.state.now = Date.parse(date + "T09:00:00Z"); };
  // The whole cycle: asked, sent, looked at, accepted.
  const settle = async (o = {}) => {
    const item = (await ask(o.ask)).body.item;
    await upload(ANN, item.id, o.upload);
    await view(item.id);
    const r = await accept(item.id, o.accept);
    return { item, accepted: r };
  };
  return { h, ids, as, mine, ask, upload, view, accept, items, sweep, goTo, settle };
}

test("calendar months: 15 Sep 2027 gives 15 Aug 2027, and short months are clamped", () => {
  assert.equal(addMonths("2027-09-15", -1), "2027-08-15");
  assert.equal(addMonths("2027-03-31", -1), "2027-02-28");
  assert.equal(addMonths("2028-03-31", -1), "2028-02-29");
  assert.equal(addMonths("2027-01-15", -1), "2026-12-15");
  assert.equal(addMonths("2026-10-31", 6), "2027-04-30");
});

test("a request reaches only that person; nobody else at the business, administrators included, can see or touch it", async () => {
  const { h, ask, mine, upload, as } = await world();
  const it = (await ask()).body.item;
  assert.equal(it.status, "needed");
  assert.equal((await mine(ANN)).length, 1);
  assert.deepEqual(await mine(BEN), [], "a standard user at the same business");
  assert.deepEqual(await mine(CAL), []);
  assert.equal((await upload(BEN, it.id)).status, 404);
  assert.equal((await upload(CAL, it.id)).status, 404);
  assert.equal((await upload(BEN, it.id)).body.error, (await upload(BEN, "idr-nope")).body.error, "same answer as for something that doesn't exist");
  // No business route leaks them either.
  for (const p of ["business/c-acme", "documents/c-acme", "me"]) assert.ok(!JSON.stringify((await as(BEN, p)).body).includes("assport"), p);
  assert.ok(h);
});

test("what the client sees carries no storage path, hash, internal note or staff name", async () => {
  const { ask, mine, upload, view, accept } = await world();
  const it = (await ask({ note: "chase" })).body.item;
  await upload(ANN, it.id);
  await view(it.id);
  await accept(it.id, { note: "original seen at office" });
  const s = JSON.stringify(await mine(ANN));
  assert.ok(!/path|sha256|original seen|Kevin|practiceId|userId/i.test(s), s);
});

test("uploads are checked: only PDF, JPG or PNG, real files, real dates, only when asked for, only once", async () => {
  const { ask, upload, mine } = await world();
  const it = (await ask()).body.item;
  assert.equal((await upload(ANN, it.id, { fileName: "id.docx", content: b64(Buffer.from("PK")) })).status, 400);
  assert.equal((await upload(ANN, it.id, { fileName: "id.jpg", content: b64(Buffer.from("MZ not an image")) })).status, 400);
  assert.equal((await upload(ANN, it.id, { expiryDate: "2027-02-30" })).status, 400, "not a real date");
  assert.equal((await upload(ANN, it.id, { expiryDate: "next year" })).status, 400);
  assert.equal((await upload(ANN, it.id)).status, 200);
  assert.equal((await upload(ANN, it.id)).status, 409, "a second upload while one is waiting");
  assert.equal((await mine(ANN))[0].status, "received");
});

test("identity files are encrypted at rest and only come back to staff as the original, logged each time", async () => {
  const { h, ask, upload, view } = await world();
  const it = (await ask()).body.item;
  const original = jpg("SECRET-PASSPORT-IMAGE");
  await upload(ANN, it.id, { content: b64(original) });
  const stored = [...h.raw.files.files.entries()].find(([k]) => k.includes("/identity/"));
  assert.ok(stored, "stored under identity/");
  assert.ok(!stored[1].includes("SECRET-PASSPORT-IMAGE"), "ciphertext, not the image");
  assert.equal(stored[1].subarray(0, 4).toString(), "XPF1");
  const r = await view(it.id);
  assert.equal(Buffer.from(r.body.content, "base64").equals(original), true);
  // A flipped bit in storage is detected, not returned.
  const tampered = Buffer.from(stored[1]); tampered[tampered.length - 1] ^= 1;
  h.raw.files.files.set(stored[0], tampered);
  assert.equal((await view(it.id)).status, 500);
  const ev = (await h.staff("GET", "events")).body.events;
  assert.equal(ev.filter((e) => e.type === "identity.viewed").length, 1);
  assert.ok(!JSON.stringify(ev).includes("SECRET-PASSPORT"));
});

test("accepting needs the document opened first, a confirmation, an expiry date (or 'none') and an authorised person", async () => {
  const { ask, upload, view, accept } = await world();
  const it = (await ask()).body.item;
  await upload(ANN, it.id);
  assert.equal((await accept(it.id)).body.code, "view-first");
  await view(it.id, "upload", "Someone Else");
  assert.equal((await accept(it.id, {})).body.code, "view-first", "a different person viewed it");
  await view(it.id);
  assert.equal((await accept(it.id, { confirmed: false })).body.code, "confirm");
  assert.equal((await accept(it.id, { expiryDate: "" })).body.code, "expiry");
  assert.equal((await accept(it.id, { expiryDate: "2020-01-01" })).body.code, "expired");
  assert.equal((await accept(it.id, { issueDate: "2030-01-01" })).body.code, "bad-date");
  assert.equal((await accept(it.id)).status, 200);
});

test("only the named verifiers can accept or reject when the practice lists them", async () => {
  const h = await world({ env: { PORTAL_ID_VERIFIERS: "sam@bannister.test, Kate Admin" } });
  const it = (await h.ask()).body.item;
  await h.upload(ANN, it.id);
  await h.view(it.id, "upload", "Kevin");
  assert.equal((await h.accept(it.id, {}, "Kevin", "kevin@bannister.test")).status, 403);
  const rej = await h.h.call("default", "POST", "admin/identity-reject", { headers: { "x-staff": "Kevin" }, body: { id: it.id, reason: "blurry" } });
  assert.equal(rej.status, 403);
  await h.view(it.id, "upload", "Sam Staff");
  assert.equal((await h.accept(it.id, {}, "Sam Staff", "sam@bannister.test")).status, 200, "by email");
});

test("accepting records who and when, stores the expiry and sets the next renewal one calendar month earlier", async () => {
  const { settle, items, mine, h } = await world();
  const { accepted } = await settle();
  const it = accepted.body.item;
  assert.equal(it.status, "accepted");
  assert.equal(it.current.verifiedBy, "Kevin");
  assert.equal(it.current.expiryDate, "2027-09-15");
  assert.equal(it.nextRenewal, "2027-08-15");
  assert.equal((await mine(ANN))[0].nextRenewal, "2027-08-15");
  assert.equal((await items())[0].businesses[0].name, "Acme Widgets Ltd");
  assert.ok(h);
});

test("automatic renewal: a request is made on 15 Aug, once, and the cycle repeats from the new expiry", async () => {
  const { h, settle, sweep, mine, upload, view, accept, items, goTo } = await world();
  const { item } = await settle();
  h.mailer.sent.length = 0;
  goTo("2027-08-14");
  assert.deepEqual(await sweep(), { requested: 0, reminded: 0 }, "the day before: nothing");
  goTo("2027-08-15");
  assert.deepEqual(await sweep(), { requested: 1, reminded: 0 });
  assert.deepEqual(await sweep(), { requested: 0, reminded: 0 }, "no duplicate");
  assert.equal((await mine(ANN))[0].status, "needed");
  assert.equal((await mine(ANN))[0].request.reason, "renewal");
  assert.ok(h.mailer.sent.some((m) => m.to === "ann@example.com" && /need a document/.test(m.subject)));
  assert.ok(!h.mailer.sent.some((m) => /passport/i.test(m.subject + m.text)), "the email names no document");
  // The replacement arrives and is accepted: the old one goes to history and the next date is recalculated.
  await upload(ANN, item.id, { content: b64(jpg("new")) });
  await view(item.id);
  const r = await accept(item.id, { expiryDate: "2037-09-15" });
  assert.equal(r.body.item.nextRenewal, "2037-08-15");
  assert.equal(r.body.item.history.length, 1);
  assert.equal(r.body.item.history[0].decision, "replaced");
  assert.equal(r.body.item.history[0].expiryDate, "2027-09-15");
  goTo("2037-08-14");
  assert.deepEqual(await sweep(), { requested: 0, reminded: 0 });
  goTo("2037-08-15");
  assert.equal((await sweep()).requested, 1, "and again ten years on");
  assert.equal((await items())[0].status, "needed");
});

test("renewal switched off: nothing is requested automatically, though an expiry alert still shows", async () => {
  const { settle, sweep, goTo, h } = await world();
  await settle({ ask: { autoRenew: false } });
  goTo("2027-08-20");
  assert.equal((await sweep()).requested, 0);
  goTo("2027-09-20");
  assert.equal((await sweep()).requested, 0);
  const att = (await h.staff("GET", "overview")).body.attention.filter((a) => a.kind === "identity");
  assert.ok(att.some((a) => /expired on 2027-09-15 and has not been replaced/.test(a.text)));
});

test("no expiry date: the practice's review interval decides when to ask again", async () => {
  const { settle, sweep, goTo, h } = await world();
  goTo("2026-10-26");
  await settle({ ask: { kind: "proof-of-address", autoRenew: false, reviewMonths: 12 }, accept: { expiryDate: "", noExpiry: true } });
  goTo("2027-10-25");
  assert.equal((await sweep()).requested, 0);
  goTo("2027-10-26");
  assert.equal((await sweep()).requested, 1);
  assert.ok(h);
});

test("reminders: after 7 and 14 days and shortly before expiry, each once, never when paused, done or cancelled", async () => {
  const { h, settle, sweep, goTo, items, upload, view, accept } = await world();
  const { item } = await settle();
  goTo("2027-08-15"); await sweep();
  h.mailer.sent.length = 0;
  goTo("2027-08-21"); assert.equal((await sweep()).reminded, 0);
  goTo("2027-08-22"); assert.equal((await sweep()).reminded, 1);
  assert.equal((await sweep()).reminded, 0, "not again the same day");
  goTo("2027-08-29"); assert.equal((await sweep()).reminded, 1, "second reminder");
  goTo("2027-09-07"); assert.equal((await sweep()).reminded, 0);
  goTo("2027-09-08"); assert.equal((await sweep()).reminded, 1, "before expiry");
  goTo("2027-09-10"); assert.equal((await sweep()).reminded, 0, "nothing further");
  assert.equal(h.mailer.sent.filter((m) => /reminder/.test(m.subject)).length, 3);
  // Paused: no reminder even when one is due.
  await h.staff("POST", "identity-edit", { id: item.id, paused: true });
  const again = (await items())[0];
  assert.equal(again.paused, true);
  goTo("2027-09-12"); assert.equal((await sweep()).reminded, 0);
  // Completed: stops.
  await h.staff("POST", "identity-edit", { id: item.id, paused: false });
  await upload(ANN, item.id); await view(item.id); await accept(item.id, { expiryDate: "2037-09-15" });
  goTo("2027-10-30"); assert.deepEqual(await sweep(), { requested: 0, reminded: 0 });
  assert.ok(ANN);
});

test("a cancelled request gets no reminders; a person with a revoked login gets none either", async () => {
  const { h, settle, sweep, goTo, ids } = await world();
  const { item } = await settle();
  goTo("2027-08-15"); await sweep();
  await h.staff("POST", "identity-cancel", { id: item.id });
  h.mailer.sent.length = 0;
  goTo("2027-09-01"); assert.deepEqual(await sweep(), { requested: 0, reminded: 0 });
  // New cycle, then the person's login is revoked.
  const second = (await h.staff("POST", "identity-request", { userId: ids["s-ann"], kind: "driving-licence", businesses: [], autoRenew: false })).body.item;
  await h.staff("POST", "revoke", { userId: ids["s-ann"] });
  goTo("2027-09-30"); assert.equal((await sweep()).reminded, 0);
  assert.ok(second);
});

test("an open request can't be duplicated; a valid accepted document isn't asked for again unless forced", async () => {
  const { h, ask, settle, ids } = await world();
  const first = (await ask()).body.item;
  assert.equal((await ask()).body.code, "already-asked");
  await settle.call(null).catch(() => {});
  assert.ok(first);
  const w = await world();
  await w.settle();
  const dup = await w.ask({ businesses: ["c-acme"] });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.code, "already-valid");
  assert.match(dup.body.error, /can be used for all of their businesses/);
  const forced = await w.ask({ force: true });
  assert.equal(forced.status, 200);
  assert.equal(forced.body.item.request.reason, "renewal");
  assert.ok(h && ids);
});

test("one valid passport is reused for another of the person's businesses instead of asking again", async () => {
  const { h, ids, settle, mine } = await world();
  await h.staff("POST", "invite", { email: ANN.email, name: ANN.name, businesses: [{ clientKey: "c-bolt", level: "standard" }] });
  await settle({ ask: { businesses: ["c-acme"] } });
  const r = await h.staff("POST", "identity-request", { userId: ids["s-ann"], kind: "passport", businesses: ["c-bolt"] });
  assert.equal(r.body.code, "already-valid");
  const it = (await h.call("default", "GET", "admin/identity", { headers: { "x-staff": "Kevin" }, query: {} })).body.items[0];
  assert.deepEqual(it.businesses.map((b) => b.clientKey).sort(), ["c-acme", "c-bolt"]);
  assert.equal((await mine(ANN))[0].businesses.length, 2);
});

test("rejecting reopens the request with the reason, keeps the rejected document in history and lets them send another", async () => {
  const { h, ask, upload, view, accept, mine, items } = await world();
  const it = (await ask()).body.item;
  await upload(ANN, it.id); await view(it.id);
  const noReason = await h.staff("POST", "identity-reject", { id: it.id, reason: "  " });
  assert.equal(noReason.status, 400);
  h.mailer.sent.length = 0;
  const r = await h.staff("POST", "identity-reject", { id: it.id, reason: "The photo is too blurry to read" });
  assert.equal(r.status, 200);
  assert.ok(h.mailer.sent.some((m) => m.to === "ann@example.com" && /another document/.test(m.subject)));
  const m = (await mine(ANN))[0];
  assert.equal(m.status, "rejected");
  assert.equal(m.request.rejectedReason, "The photo is too blurry to read");
  assert.equal(m.canUpload, true);
  assert.equal((await upload(ANN, it.id, { content: b64(jpg("clear")) })).status, 200);
  await view(it.id);
  assert.equal((await accept(it.id)).status, 200);
  const staff = (await items())[0];
  assert.deepEqual(staff.history.map((x) => x.decision), ["rejected"]);
  assert.equal(staff.history[0].note, "The photo is too blurry to read");
});

test("the practice is alerted when a document is waiting to be checked, and when one has expired without a replacement", async () => {
  const { h, ask, upload, goTo, settle, view, accept } = await world();
  const it = (await ask()).body.item;
  await upload(ANN, it.id);
  const att = async () => (await h.staff("GET", "overview")).body.attention.filter((a) => a.kind === "identity").map((a) => a.text);
  assert.ok((await att()).some((t) => /Ann Example sent a passport to check/.test(t)));
  await view(it.id); await accept(it.id, { expiryDate: "2027-09-15" });
  assert.deepEqual(await att(), []);
  goTo("2027-09-16");
  assert.ok((await att()).some((t) => /expired on 2027-09-15 and has not been replaced/.test(t)));
  assert.ok(settle);
});

test("the portal's 'me' answer says whether there is anything under Identity, without naming it", async () => {
  const { as, ask, ids } = await world();
  assert.deepEqual((await as(ANN, "me")).body.identity, { any: false, open: 0 });
  await ask();
  assert.deepEqual((await as(ANN, "me")).body.identity, { any: true, open: 1 });
  assert.deepEqual((await as(BEN, "me")).body.identity, { any: false, open: 0 });
  assert.ok(ids);
});

test("requests only go to people with a login and only for businesses they can actually see", async () => {
  const { h, ids } = await world();
  assert.equal((await h.staff("POST", "identity-request", { userId: "nobody", kind: "passport" })).status, 400);
  assert.equal((await h.staff("POST", "identity-request", { userId: ids["s-ann"], kind: "passport", businesses: ["c-bolt"] })).status, 400);
  assert.equal((await h.staff("POST", "identity-request", { userId: ids["s-ann"], kind: "selfie" })).status, 400);
  assert.equal((await h.staff("POST", "identity-request", { userId: ids["s-ann"], kind: "custom" })).status, 400, "a custom document needs a name");
  assert.equal((await h.staff("POST", "identity-request", { userId: ids["s-ann"], kind: "custom", label: "Letter from employer" })).status, 200);
});

test("another practice can't see, open, accept or sweep this practice's identity documents", async () => {
  const kit = setup({ practices: ["pa", "pb"] });
  await kit.staff("POST", "invite", { email: ANN.email, name: ANN.name, businesses: [{ clientKey: "c-acme", level: "administrator" }] }, "pa");
  const uid = (await kit.asUser(ANN, "me", "pa")).body.user.id;
  const it = (await kit.staff("POST", "identity-request", { userId: uid, kind: "passport" }, "pa")).body.item;
  assert.equal((await kit.staff("POST", "identity-download", { id: it.id }, "pb")).status, 404);
  assert.equal((await kit.staff("POST", "identity-cancel", { id: it.id }, "pb")).status, 404);
  assert.equal((await kit.call("pb", "GET", "admin/identity", { headers: { "x-staff": "K" }, query: {} })).body.items.length, 0);
  assert.deepEqual((await kit.staff("POST", "identity-sweep", {}, "pb")).body, { requested: 0, reminded: 0 });
});

test("a scanner plugged in can refuse an identity file, and nothing is stored", async () => {
  const { createHandler } = require("../portal/index.js");
  const w = await world();
  const it = (await w.ask()).body.item;
  const scanning = createHandler({ env: { PORTAL_PRACTICE_ID: "default", PORTAL_AUDIT_KEY: "audit-secret", PORTAL_IDP_ISSUER: "x", PORTAL_IDP_CLIENT_ID: "x", PORTAL_IDP_JWKS_URL: "x" }, store: w.h.raw, mailer: w.h.mailer, now: () => w.h.state.now, reader: { clients: async () => w.h.rows, updateClient: async () => {} }, staffAuth: async () => ({ name: "K" }), scanner: async () => ({ ok: false }), verifier: { verify: async () => ({ ok: true, claims: { sub: "s-ann", email: ANN.email, name: ANN.name, iat: w.h.state.now / 1000 - 5 } }) } });
  const res = await scanning({ bindingData: { path: `identity/${it.id}/upload` } }, { method: "POST", headers: { "x-portal-token": "t" }, body: { fileName: "p.jpg", content: b64(jpg()) }, query: {} });
  assert.equal(res.status, 400, res.body);
  assert.equal([...w.h.raw.files.files.keys()].filter((k) => k.includes("/identity/")).length, 0);
});
