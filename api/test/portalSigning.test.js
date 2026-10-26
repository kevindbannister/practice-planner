// Signing: who may sign, in what order, what is recorded, and what comes out.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PDFDocument } = require("pdf-lib");
const { setup } = require("./portalKit.js");

const ANN = { sub: "s-ann", email: "ann@example.com", name: "Ann Example" }; // administrator
const BEN = { sub: "s-ben", email: "ben@example.com", name: "Ben Other" }; // standard
const SAM = { sub: "s-sam", email: "sam@example.com", name: "Sam Signs" }; // signatory level
const RIA = { sub: "s-ria", email: "ria@example.com", name: "Ria Limited" }; // restricted
const CAL = { sub: "s-cal", email: "cal@example.com", name: "Cal Elsewhere" }; // Bolt only

async function pdfBytes(text = "Engagement letter") {
  const d = await PDFDocument.create();
  d.addPage([400, 300]).drawText(text);
  return Buffer.from(await d.save());
}
const b64 = (b) => b.toString("base64");
// A real PNG (a few dozen bytes of pixels is enough to count as "drawn")
function png(ink = true) {
  const zlib = require("node:zlib");
  const w = 60, h = 20;
  const raw = Buffer.concat(Array.from({ length: h }, (_, y) => Buffer.concat([Buffer.from([y % 5 === 0 ? 2 : 0]), Buffer.from(Array.from({ length: w * 4 }, (_, i) => (ink && i % 4 === 3 ? 255 : 0)))])));
  const crc = (b) => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } let x = 0xffffffff; for (const v of b) x = t[(x ^ v) & 255] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

async function world(opts) {
  const h = setup(opts);
  const inv = (u, level, key = "c-acme") => h.staff("POST", "invite", { email: u.email, name: u.name, businesses: [{ clientKey: key, level }] });
  await inv(ANN, "administrator"); await inv(BEN, "standard"); await inv(SAM, "signatory"); await inv(RIA, "restricted"); await inv(CAL, "administrator", "c-bolt");
  const ids = {};
  for (const u of [ANN, BEN, SAM, RIA, CAL]) ids[u.sub] = (await h.asUser(u)).body.user.id;
  const doc = (await h.staff("POST", "documents-add", { clientKey: "c-acme", title: "Engagement letter", fileName: "letter.pdf", content: b64(await pdfBytes()), publish: false })).body.document;
  const create = (o = {}) => h.staff("POST", "signing-create", { clientKey: "c-acme", docId: doc.id, signatoryIds: [ids["s-ann"]], ...o });
  const sg = (u, p, o = {}) => h.call("default", o.method || "POST", `signing/${o.biz || "c-acme"}/${p}`, { headers: { "x-portal-token": h.token({ ...u, iat: h.state.now / 1000 - 60, exp: h.state.now / 1000 + 3600 }), "user-agent": "TestBrowser/1.0", "x-forwarded-for": "203.0.113.7" }, body: o.body || {} });
  const list = async (u, biz = "c-acme") => (await h.call("default", "GET", `signing/${biz}`, { headers: { "x-portal-token": h.token(u) } }));
  const typed = (name = "Ann Example") => ({ mode: "typed", typedName: name, consent: true });
  return { h, ids, doc, create, sg, list, typed };
}

function pdfText(buf) {
  const f = path.join(os.tmpdir(), `t-${crypto.randomBytes(4).toString("hex")}.pdf`);
  fs.writeFileSync(f, buf);
  try { return execFileSync("pdftotext", [f, "-"], { encoding: "utf8" }); } catch { return null; } finally { fs.unlinkSync(f); }
}

test("one named person signs: a sealed copy and an evidence certificate are filed and the signer can read both", async () => {
  const { h, create, sg, typed, list } = await world();
  const r = (await create()).body.request;
  assert.equal(r.status, "out");
  const s = await sg(ANN, `${r.id}/sign`, { body: typed() });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.equal(s.body.request.status, "completed");
  const staff = (await h.call("default", "GET", "admin/signing", { headers: { "x-staff": "Kevin" }, query: { clientKey: "c-acme" } })).body.requests[0];
  assert.ok(staff.sealedDocId && staff.certDocId);
  // The signer downloads them from the document centre like any other document.
  const get = async (id) => Buffer.from((await h.asUser(ANN, `documents/c-acme/${id}/download`, "default", { method: "POST", body: {} })).body.content, "base64");
  const sealed = await get(staff.sealedDocId), cert = await get(staff.certDocId);
  assert.equal((await PDFDocument.load(sealed)).getPageCount(), 2, "original page + signature page");
  assert.equal(crypto.createHash("sha256").update(sealed).digest("hex"), staff.sealedSha256);
  const t1 = pdfText(sealed), t2 = pdfText(cert);
  if (t1) {
    assert.match(t1, /Signature page/);
    assert.match(t1, /Ann Example/);
    assert.match(t2, /Certificate of electronic signing/);
    assert.match(t2, /203\.0\.113\.7/);
    assert.match(t2, /TestBrowser\/1\.0/);
    assert.match(t2, new RegExp(staff.sha256.slice(0, 20)));
    assert.match(t2, /not a "qualified"|not digitally certified/);
  }
  const mine = (await list(ANN)).body.requests[0];
  assert.equal(mine.sealedDocId, staff.sealedDocId);
});

test("an administrator who isn't named can't sign, open or decline, and doesn't even see the request", async () => {
  const { create, sg, typed, list, ids } = await world();
  const r = (await create({ signatoryIds: [ids["s-ben"]] })).body.request;
  assert.deepEqual((await list(ANN)).body.requests, []);
  for (const [p, body] of [[`${r.id}/sign`, typed()], [`${r.id}/document`, {}], [`${r.id}/decline`, { reason: "x" }]]) {
    assert.equal((await sg(ANN, p, { body })).status, 404, p);
  }
  // ...and the answer is the same as for a request that doesn't exist.
  const nothing = await sg(ANN, "sig-nope/sign", { body: typed() });
  assert.deepEqual((await sg(ANN, `${r.id}/sign`, { body: typed() })).body, nothing.body);
});

test("a signatory-level person sees only what they're named on, can read it and sign it", async () => {
  const { create, sg, typed, list, ids, h } = await world();
  const mine = (await create({ signatoryIds: [ids["s-sam"]] })).body.request;
  await create({ signatoryIds: [ids["s-ben"]] });
  const seen = (await list(SAM)).body.requests;
  assert.equal(seen.length, 1);
  assert.equal(seen[0].id, mine.id);
  const doc = await sg(SAM, `${mine.id}/document`);
  assert.equal(doc.status, 200);
  assert.match(Buffer.from(doc.body.content, "base64").toString("latin1"), /^%PDF/);
  assert.equal((await sg(SAM, `${mine.id}/sign`, { body: typed("Sam Signs") })).status, 200);
  assert.ok(h);
});

test("somebody from another business can't touch the request, even with the id", async () => {
  const { create, sg, typed, list, ids } = await world();
  const r = (await create()).body.request;
  assert.equal((await sg(CAL, `${r.id}/sign`, { biz: "c-bolt", body: typed("Cal") })).status, 404);
  assert.equal((await sg(CAL, `${r.id}/sign`, { biz: "c-acme", body: typed("Cal") })).status, 404);
  assert.equal((await list(CAL, "c-acme")).status, 404);
  assert.ok(ids);
});

test("ordered signing: only the next person is emailed and may sign; the next is emailed when it is their turn", async () => {
  const { h, create, sg, typed, ids } = await world();
  h.mailer.sent.length = 0;
  const r = (await create({ sequential: true, signatoryIds: [ids["s-ann"], ids["s-ben"]], message: "Please sign" })).body.request;
  const to = () => h.mailer.sent.filter((m) => /waiting for your signature/.test(m.subject)).map((m) => m.to);
  assert.deepEqual(to(), ["ann@example.com"]);
  const early = await sg(BEN, `${r.id}/sign`, { body: typed("Ben Other") });
  assert.equal(early.status, 409);
  assert.equal(early.body.code, "not-your-turn");
  assert.equal((await sg(ANN, `${r.id}/sign`, { body: typed() })).body.request.status, "out");
  assert.deepEqual(to(), ["ann@example.com", "ben@example.com"]);
  const last = await sg(BEN, `${r.id}/sign`, { body: typed("Ben Other") });
  assert.equal(last.body.request.status, "completed");
  assert.ok(!h.mailer.sent.some((m) => /Engagement letter/.test(m.subject + m.text)), "no email names the document");
});

test("the signer sees other signatories' names and progress only, never their email or evidence", async () => {
  const { create, sg, typed, ids } = await world();
  const r = (await create({ signatoryIds: [ids["s-ann"], ids["s-ben"]] })).body.request;
  await sg(BEN, `${r.id}/sign`, { body: typed("Ben Other") });
  const view = JSON.stringify((await sg(ANN, `${r.id}/sign`, { body: typed() })).body);
  assert.ok(!/ben@example|203\.0\.113|TestBrowser|sha256|imageSha|"evidence"|"ip"/i.test(view), view);
  assert.match(view, /Ben Other/);
});

test("consent is required, typed names need a name, drawn signatures must be real images", async () => {
  const { create, sg } = await world();
  const r = (await create()).body.request;
  const bad = async (body, code) => { const x = await sg(ANN, `${r.id}/sign`, { body }); assert.equal(x.status, 400, JSON.stringify(x.body)); assert.equal(x.body.code, code); };
  await bad({ mode: "typed", typedName: "Ann", consent: false }, "consent");
  await bad({ mode: "typed", typedName: "A", consent: true }, "bad-signature");
  await bad({ mode: "scribble", consent: true }, "bad-signature");
  await bad({ mode: "drawn", image: "data:image/png;base64,AAAA", consent: true }, "bad-signature");
  await bad({ mode: "drawn", image: "data:text/html;base64,PHNjcmlwdD4=", consent: true }, "bad-signature");
  await bad({ mode: "drawn", image: "data:image/png;base64," + png(false).toString("base64"), consent: true }, "blank");
  const ok = await sg(ANN, `${r.id}/sign`, { body: { mode: "drawn", image: "data:image/png;base64," + png().toString("base64"), consent: true } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.request.status, "completed");
});

test("evidence records the time, network address, device, sign-in strength and the exact document fingerprint", async () => {
  const { h, create, sg, typed, doc } = await world();
  const r = (await create()).body.request;
  await sg(ANN, `${r.id}/sign`, { body: typed() });
  const rec = (await h.raw.list("default", "signing"))[0];
  const e = rec.signatories[0].evidence;
  assert.equal(e.ip, "203.0.113.7");
  assert.equal(e.ua, "TestBrowser/1.0");
  assert.equal(e.at, new Date(h.state.now).toISOString());
  assert.equal(e.docSha256, rec.sha256);
  assert.equal(e.emailVerified, "ann@example.com");
  assert.match(e.consent, /intend to sign it electronically/);
  const ev = (await h.staff("GET", "events")).body.events.map((x) => x.type);
  for (const t of ["signing.requested", "signing.signed", "signing.completed", "signing.sealed", "document.generated"]) assert.ok(ev.includes(t), t);
  assert.ok(doc);
});

test("you can't sign twice, or after a cancel, or after it expires; a decline stops everything", async () => {
  const { h, create, sg, typed, ids } = await world();
  const a = (await create()).body.request;
  await sg(ANN, `${a.id}/sign`, { body: typed() });
  assert.equal((await sg(ANN, `${a.id}/sign`, { body: typed() })).status, 409);
  const b = (await create()).body.request;
  assert.equal((await h.staff("POST", "signing-cancel", { id: b.id })).status, 200);
  assert.equal((await sg(ANN, `${b.id}/sign`, { body: typed() })).body.code, "closed");
  const c = (await create({ expiresInDays: 2 })).body.request;
  h.state.now += 3 * 24 * 3600 * 1000;
  assert.equal((await sg(ANN, `${c.id}/sign`, { body: typed() })).body.code, "expired");
  h.state.now -= 3 * 24 * 3600 * 1000;
  const d = (await create({ signatoryIds: [ids["s-ann"], ids["s-ben"]] })).body.request;
  assert.equal((await sg(BEN, `${d.id}/decline`, { body: { reason: "Figures are wrong" } })).status, 200);
  assert.equal((await sg(ANN, `${d.id}/sign`, { body: typed() })).status, 409);
  const att = (await h.staff("GET", "overview")).body.attention.filter((x) => x.kind === "signing");
  assert.ok(att.some((x) => /Ben Other declined to sign/.test(x.text) && /Figures are wrong/.test(x.text)));
});

test("if the stored document is altered after the request, signing is refused", async () => {
  const { h, create, sg, typed } = await world();
  const r = (await create()).body.request;
  const key = [...h.raw.files.files.keys()].find((k) => k.endsWith("letter.pdf"));
  h.raw.files.files.set(key, await pdfBytes("A different letter"));
  const x = await sg(ANN, `${r.id}/sign`, { body: typed() });
  assert.equal(x.status, 409);
  assert.equal(x.body.code, "changed");
  assert.equal((await sg(ANN, `${r.id}/document`)).status, 409);
});

test("verify: a completed signing checks out, and any later change to the signed files or the record is caught", async () => {
  const { h, create, sg, typed } = await world();
  const r = (await create()).body.request;
  assert.equal((await h.staff("POST", "signing-verify", { id: r.id })).status, 409, "not complete yet");
  await sg(ANN, `${r.id}/sign`, { body: typed() });
  assert.equal((await h.staff("POST", "signing-verify", { id: r.id })).body.ok, true);
  const sealedKey = [...h.raw.files.files.keys()].find((k) => /signed\.pdf$/.test(k));
  const original = h.raw.files.files.get(sealedKey);
  h.raw.files.files.set(sealedKey, Buffer.concat([original, Buffer.from("\n% tampered")]));
  const bad = (await h.staff("POST", "signing-verify", { id: r.id })).body;
  assert.equal(bad.ok, false);
  assert.equal(bad.checks.find((c) => c.what === "Signed copy").ok, false);
  h.raw.files.files.set(sealedKey, original);
  const rec = (await h.raw.list("default", "signing"))[0];
  await h.raw.update("default", "signing", rec.id, { signatories: rec.signatories.map((s) => ({ ...s, userId: "someone-else" })) });
  assert.equal((await h.staff("POST", "signing-verify", { id: r.id })).body.checks.find((c) => c.what === "Signing record").ok, false);
});

test("what can be sent for signing: PDFs from the practice for this client, to people who have active access", async () => {
  const { h, create, doc, ids } = await world();
  assert.equal((await create({ signatoryIds: [] })).status, 400);
  assert.equal((await create({ signatoryIds: [ids["s-cal"]] })).status, 400, "no access to this business");
  assert.equal((await create({ clientKey: "c-bolt" })).status, 400, "document belongs to another client");
  const txt = (await h.staff("POST", "documents-add", { clientKey: "c-acme", fileName: "n.txt", content: b64(Buffer.from("hello")), publish: false })).body.document;
  assert.equal((await h.staff("POST", "signing-create", { clientKey: "c-acme", docId: txt.id, signatoryIds: [ids["s-ann"]] })).status, 400, "not a PDF");
  await h.staff("POST", "revoke", { userId: ids["s-ben"] });
  assert.equal((await create({ signatoryIds: [ids["s-ben"]] })).status, 400, "revoked person");
  assert.ok(doc);
});

test("signed copies and certificates are locked: staff can't replace, unpublish or retitle them", async () => {
  const { h, create, sg, typed } = await world();
  const r = (await create()).body.request;
  await sg(ANN, `${r.id}/sign`, { body: typed() });
  const staff = (await h.call("default", "GET", "admin/signing", { headers: { "x-staff": "Kevin" }, query: { clientKey: "c-acme" } })).body.requests[0];
  assert.equal((await h.staff("POST", "documents-unpublish", { id: staff.sealedDocId })).status, 409);
  assert.equal((await h.staff("POST", "documents-version", { id: staff.sealedDocId, fileName: "x.pdf", content: b64(await pdfBytes("fake")) })).status, 409);
  assert.equal((await h.staff("POST", "documents-edit", { id: staff.sealedDocId, title: "Renamed" })).status, 409);
  // and a generated document can't be sent for signing in its own right
  assert.equal((await h.staff("POST", "signing-create", { clientKey: "c-acme", docId: staff.sealedDocId, signatoryIds: [staff.signatories[0].userId] })).status, 400);
});

test("two people signing at the same moment: both signatures are kept and exactly one sealed copy is made", async () => {
  const { h, create, sg, typed, ids } = await world();
  const r = (await create({ signatoryIds: [ids["s-ann"], ids["s-ben"]] })).body.request;
  const go = async (u, name) => { for (let i = 0; i < 4; i++) { const x = await sg(u, `${r.id}/sign`, { body: typed(name) }); if (x.status !== 409 || x.body.code !== "conflict") return x; } };
  const [a, b] = await Promise.all([go(ANN, "Ann Example"), go(BEN, "Ben Other")]);
  assert.ok([a, b].every((x) => x.status === 200), JSON.stringify([a.body, b.body]));
  const rec = (await h.raw.list("default", "signing"))[0];
  assert.equal(rec.status, "completed");
  assert.ok(rec.signatories.every((s) => s.status === "signed"));
  assert.equal((await h.raw.list("default", "documents")).filter((d) => d.generated).length, 2);
});

test("a reminder emails only whoever is due to sign and is recorded; closed requests can't be reminded", async () => {
  const { h, create, sg, typed, ids } = await world();
  const r = (await create({ sequential: true, signatoryIds: [ids["s-ann"], ids["s-ben"]] })).body.request;
  h.mailer.sent.length = 0;
  const x = await h.staff("POST", "signing-remind", { id: r.id });
  assert.equal(x.body.request.reminded, 1);
  assert.deepEqual(h.mailer.sent.map((m) => m.to), ["ann@example.com"]);
  assert.match(h.mailer.sent[0].subject, /reminder/);
  assert.ok((await h.staff("GET", "events")).body.events.some((e) => e.type === "signing.reminded"));
  await h.staff("POST", "signing-cancel", { id: r.id });
  assert.equal((await h.staff("POST", "signing-remind", { id: r.id })).status, 409);
  assert.ok(sg && typed);
});

test("another practice's staff can't see, cancel or verify this practice's requests", async () => {
  const kit = setup({ practices: ["pa", "pb"] });
  await kit.staff("POST", "invite", { email: ANN.email, name: ANN.name, businesses: [{ clientKey: "c-acme", level: "administrator" }] }, "pa");
  const uid = (await kit.asUser(ANN, "me", "pa")).body.user.id;
  const doc = (await kit.staff("POST", "documents-add", { clientKey: "c-acme", fileName: "l.pdf", content: b64(await pdfBytes()), publish: false }, "pa")).body.document;
  const r = (await kit.staff("POST", "signing-create", { clientKey: "c-acme", docId: doc.id, signatoryIds: [uid] }, "pa")).body.request;
  assert.equal((await kit.staff("POST", "signing-cancel", { id: r.id }, "pb")).status, 404);
  assert.equal((await kit.staff("POST", "signing-remind", { id: r.id }, "pb")).status, 404);
  assert.equal((await kit.staff("POST", "signing-verify", { id: r.id }, "pb")).status, 404);
  assert.equal((await kit.call("pb", "GET", "admin/signing", { headers: { "x-staff": "K" }, query: { clientKey: "c-acme" } })).body.requests.length, 0);
});
