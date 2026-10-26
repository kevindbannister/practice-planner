// Signing. Staff ask named people to sign a PDF; each signs in the portal; when the last has signed the
// server produces a sealed copy and an evidence certificate and files both in the document centre.
//
// The rules that matter:
//  - Only a person NAMED on the request can sign it. Being an administrator, a director or the
//    business's main contact gives no authority. They also need active portal access to that business.
//  - They sign the exact version staff chose; its SHA-256 is checked again at the moment of signing.
//  - Every signature records who, when, from where, what they saw and what they agreed to.
//  - Declining, cancelling and expiry stop the request; nothing is sealed.

const crypto = require("node:crypto");
const { newId } = require("./store.js");
const { sealDocument, evidenceCertificate } = require("./sealPdf.js");

class SignError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const CONSENT = "I confirm that I am the person named, that I have read this document, and that I intend to sign it electronically. I understand that my name, email address, network address, device details and the time will be recorded as evidence of my signing.";
const CONSENT_VERSION = 1;
const DAY = 24 * 3600 * 1000;
const iso = (ms) => new Date(ms).toISOString();
const text = (v, max = 200) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max);
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
/**
 * How many pixels of a canvas PNG have any ink (non-transparent). Handles what browsers produce
 * (8-bit RGBA, not interlaced); anything else is refused rather than guessed at.
 */
function inkedPixels(png) {
  const zlib = require("node:zlib");
  let off = 8, w = 0, h = 0, depth = 0, type = 0, inter = 0;
  const idat = [];
  while (off + 8 <= png.length) {
    const len = png.readUInt32BE(off), kind = png.toString("latin1", off + 4, off + 8), data = png.subarray(off + 8, off + 8 + len);
    if (kind === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; type = data[9]; inter = data[12]; }
    if (kind === "IDAT") idat.push(data);
    if (kind === "IEND") break;
    off += 12 + len;
  }
  if (depth !== 8 || type !== 6 || inter !== 0 || !w || !h || w * h > 4e6) return -1;
  let raw;
  try { raw = zlib.inflateSync(Buffer.concat(idat)); } catch { return -1; }
  const bpp = 4, stride = w * bpp;
  if (raw.length < (stride + 1) * h) return -1;
  let prev = Buffer.alloc(stride), n = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let add = 0;
      if (f === 1) add = a; else if (f === 2) add = b; else if (f === 3) add = (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      line[i] = (line[i] + add) & 255;
    }
    for (let x = 0; x < w; x++) if (line[x * bpp + 3] > 0) n++;
    prev = line;
  }
  return n;
}
const isPng = (b) => b.length > 8 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a;

const LABEL = {
  "signing.requested": "Signing requested by the practice", "signing.sent": "Signing invitation emailed", "signing.viewed": "Document opened by a signatory", "signing.signed": "Signed", "signing.declined": "Declined to sign",
  "signing.completed": "All signatures received", "signing.sealed": "Signed copy and certificate produced", "signing.cancelled": "Cancelled by the practice", "signing.reminded": "Reminder sent",
};

function createSigning({ audit, mailer, notices = null, files, docs, auditKey, now = () => Date.now(), practiceId, practiceName = "Your accountant", notifyEmail = "", portalUrl = "" }) {
  const ev = (store, e) => audit.record(store, e);
  const safeSend = async (m) => { try { await mailer.send(m); return true; } catch { return false; } };
  const imgPath = (r, s) => `${practiceId}/${r.clientKey}/signing/${r.id}/${s.id}.png`;

  /** A request's real state: it expires by itself once its date has passed. */
  const state = (r) => (r.status === "out" && r.expiresAt && Date.parse(r.expiresAt) < now() ? "expired" : r.status);
  /** Whose turn it is: signed/declined are final; in an ordered request only the lowest unsigned order may sign. */
  function turn(r, s) {
    if (s.status !== "waiting") return s.status;
    if (state(r) !== "out") return "closed";
    if (!r.sequential) return "pending";
    const lowest = Math.min(...r.signatories.filter((x) => x.status === "waiting").map((x) => x.order));
    return s.order === lowest ? "pending" : "waiting";
  }

  const staffView = (r) => ({
    id: r.id, ref: r.ref, clientKey: r.clientKey, docId: r.docId, version: r.version, title: r.title, status: state(r), sequential: r.sequential, createdAt: r.createdAt, createdByName: r.createdByName, expiresAt: r.expiresAt, message: r.message, completedAt: r.completedAt || "",
    sealedDocId: r.sealedDocId || "", certDocId: r.certDocId || "", remindedAt: r.remindedAt || "", declineReason: r.declineReason || "", sha256: r.sha256, sealedSha256: r.sealedSha256 || "",
    signatories: r.signatories.map((s) => ({ id: s.id, userId: s.userId, name: s.name, email: s.email, order: s.order, status: turn(r, s), signedAt: s.evidence ? s.evidence.at : "", viewedAt: s.viewedAt || "" })),
  });

  /** What a signer sees: their own line in full, others' names and progress only. */
  const signerView = (r, user) => {
    const me = r.signatories.find((s) => s.userId === user.id);
    return {
      id: r.id, title: r.title, status: state(r), message: r.message, createdAt: r.createdAt, expiresAt: r.expiresAt, requestedBy: practiceName, completedAt: r.completedAt || "", sequential: r.sequential,
      you: { status: turn(r, me), signedAt: me.evidence ? me.evidence.at : "", declined: me.status === "declined" },
      others: r.signatories.filter((s) => s !== me).map((s) => ({ name: s.name, order: s.order, status: turn(r, s) })),
      sealedDocId: r.status === "completed" ? r.sealedDocId : "", certDocId: r.status === "completed" ? r.certDocId : "",
      consent: CONSENT,
    };
  };

  async function mineFor(store, access, user, id) {
    const r = await store.get("signing", text(id, 60));
    // Not found and not-named look the same.
    if (!r || r.clientKey !== access.clientKey || !r.signatories.some((s) => s.userId === user.id)) throw new SignError(404, "not-found", "Not found");
    return r;
  }

  // ------------------------------------------------------------------ staff
  async function create(store, staff, { clientKey, docId, version, title, signatoryIds, sequential, message, expiresInDays }) {
    const { doc, version: v, bytes } = await docs.readVersion(store, docId, version);
    if (doc.clientKey !== text(clientKey, 60)) throw new SignError(400, "bad-document", "That document belongs to a different client");
    if (v.ext !== "pdf") throw new SignError(400, "not-pdf", "Only PDF documents can be sent for signing");
    if (doc.generated || doc.origin !== "practice") throw new SignError(400, "bad-document", "Choose a document from the practice");
    try { await require("pdf-lib").PDFDocument.load(bytes, { updateMetadata: false }); } catch { throw new SignError(400, "bad-pdf", "That PDF can't be opened for signing (it may be password protected)"); }
    const ids = [...new Set(Array.isArray(signatoryIds) ? signatoryIds : [])].slice(0, 10);
    if (!ids.length) throw new SignError(400, "no-signatory", "Choose at least one person to sign");
    const signatories = [];
    for (const [i, uid] of ids.entries()) {
      const a = (await store.find("access", (x) => x.userId === uid && x.clientKey === doc.clientKey && x.status === "active"))[0];
      const u = a && (await store.get("users", uid));
      if (!u || u.status !== "active") throw new SignError(400, "bad-signatory", "Every signatory needs active portal access to this business");
      signatories.push({ id: newId("sg-"), userId: uid, name: u.name || u.email, email: u.email, order: sequential ? i + 1 : 1, status: "waiting" });
    }
    const t = iso(now());
    const days = Math.min(Math.max(Number(expiresInDays) || 30, 1), 365);
    const r = await store.insert("signing", { id: newId("sig-"), ref: "SIG-" + crypto.randomBytes(4).toString("hex").toUpperCase(), clientKey: doc.clientKey, docId: doc.id, version: v.n, sha256: v.sha256, title: text(title, 120) || doc.title, signatories, sequential: Boolean(sequential), status: "out", createdAt: t, createdBy: "staff", createdByName: staff.name, expiresAt: iso(now() + days * DAY), message: text(message, 500) });
    await ev(store, { type: "signing.requested", source: "staff", actor: staff.name, clientKey: r.clientKey, recordId: r.id, meta: { ref: r.ref, docId: doc.id, version: v.n, sha256: v.sha256, signatories: signatories.map((s) => s.name) } });
    await notifyTurn(store, r);
    return staffView(r);
  }

  /** Email whoever may sign now. The email never names the document. */
  async function notifyTurn(store, r, { reminder = false } = {}) {
    let n = 0;
    for (const s of r.signatories) {
      if (turn(r, s) !== "pending") continue;
      if (notices) await notices.create(store, { userId: s.userId, clientKey: r.clientKey, text: "A document is waiting for your signature", link: "signing" });
      if (await safeSend({ to: s.email, subject: `${practiceName}: ${reminder ? "reminder, " : ""}a document is waiting for your signature`, text: `Hello ${s.name},\n\n${practiceName} has asked you to sign a document in your secure portal.\n\nSign in to read and sign it${portalUrl ? `: ${portalUrl}` : "."}\n` })) n++;
    }
    if (n) await ev(store, { type: reminder ? "signing.reminded" : "signing.sent", source: "system", actor: practiceName, clientKey: r.clientKey, recordId: r.id, meta: { count: n } });
    return n;
  }

  async function staffList(store, clientKey) {
    return (await store.find("signing", (r) => r.clientKey === clientKey)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map(staffView);
  }
  const staffGet = async (store, id) => {
    const r = await store.get("signing", text(id, 60));
    if (!r) throw new SignError(404, "not-found", "Not found");
    return r;
  };

  async function cancel(store, staff, id) {
    const r = await staffGet(store, id);
    if (state(r) !== "out") throw new SignError(409, "closed", "That request is no longer open");
    const u = await store.update("signing", r.id, { status: "cancelled", cancelledAt: iso(now()), cancelledBy: staff.name }, r.rev);
    await ev(store, { type: "signing.cancelled", source: "staff", actor: staff.name, clientKey: r.clientKey, recordId: r.id });
    return staffView(u);
  }

  async function remind(store, staff, id) {
    const r = await staffGet(store, id);
    if (state(r) !== "out") throw new SignError(409, "closed", "That request is no longer open");
    const n = await notifyTurn(store, r, { reminder: true });
    const u = await store.update("signing", r.id, { remindedAt: iso(now()), reminders: (r.reminders || 0) + 1 }, r.rev);
    return { ...staffView(u), reminded: n };
  }

  /** Is the signed copy on file still exactly what was sealed? */
  async function verify(store, id) {
    const r = await staffGet(store, id);
    if (r.status !== "completed") throw new SignError(409, "not-complete", "That request hasn't been completed");
    const checks = [];
    for (const [what, docId, expect] of [["Signed copy", r.sealedDocId, r.sealedSha256], ["Certificate", r.certDocId, r.certSha256]]) {
      let ok = false;
      try { ok = sha((await docs.readVersion(store, docId, 1)).bytes) === expect; } catch { ok = false; }
      checks.push({ what, ok });
    }
    try { checks.push({ what: "Original document", ok: sha((await docs.readVersion(store, r.docId, r.version)).bytes) === r.sha256 }); } catch { checks.push({ what: "Original document", ok: false }); }
    const macOk = r.sealMac === sealMac(r);
    checks.push({ what: "Signing record", ok: macOk });
    return { ok: checks.every((c) => c.ok), checks };
  }
  const sealMac = (r) => crypto.createHmac("sha256", auditKey).update(JSON.stringify([r.id, r.sha256, r.sealedSha256, r.certSha256, r.signatories.map((s) => [s.userId, s.evidence && s.evidence.at, s.evidence && s.evidence.docSha256])])).digest("hex");

  // ------------------------------------------------------------------ the signer
  async function listForSigner(store, access, user) {
    return (await store.find("signing", (r) => r.clientKey === access.clientKey && r.signatories.some((s) => s.userId === user.id))).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map((r) => signerView(r, user));
  }

  async function openDocument(store, access, user, id, ctx) {
    const r = await mineFor(store, access, user, id);
    const me = r.signatories.find((s) => s.userId === user.id);
    // After completion the signer reads the signed copy through the document centre; here, the original.
    const { bytes, version } = await docs.readVersion(store, r.docId, r.version);
    if (sha(bytes) !== r.sha256) throw new SignError(409, "changed", "This document has changed since it was sent. Please ask us to send it again.");
    if (!me.viewedAt) {
      await store.update("signing", r.id, { signatories: r.signatories.map((s) => (s === me || s.id === me.id ? { ...s, viewedAt: iso(now()) } : s)) }, r.rev);
      await ev(store, { type: "signing.viewed", source: "portal", userId: user.id, actor: user.email, clientKey: r.clientKey, recordId: r.id, meta: { ref: r.ref } });
    }
    return { fileName: version.fileName, mime: "application/pdf", size: bytes.length, content: bytes.toString("base64") };
  }

  async function sign(store, access, user, id, { mode, typedName, image, consent }, ctx = {}) {
    const r0 = await mineFor(store, access, user, id);
    const me0 = r0.signatories.find((s) => s.userId === user.id);
    const st = state(r0);
    if (st === "expired") throw new SignError(409, "expired", "This request has expired. Please ask us to send it again.");
    if (st !== "out") throw new SignError(409, "closed", "This request is no longer open for signing");
    if (me0.status === "signed") throw new SignError(409, "already", "You have already signed this document");
    if (turn(r0, me0) !== "pending") throw new SignError(409, "not-your-turn", "It isn't your turn to sign yet");
    if (consent !== true) throw new SignError(400, "consent", "Please tick the box to confirm you agree to sign electronically");
    // Re-check the document is still exactly what was sent.
    const { bytes: orig } = await docs.readVersion(store, r0.docId, r0.version);
    if (sha(orig) !== r0.sha256) throw new SignError(409, "changed", "This document has changed since it was sent. Please ask us to send it again.");
    let png = null;
    const name = text(typedName, 80);
    if (mode === "drawn") {
      const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(image || ""));
      png = m ? Buffer.from(m[1], "base64") : null;
      if (!png || !isPng(png) || png.length > 300 * 1024) throw new SignError(400, "bad-signature", "That drawn signature couldn't be used. Please draw it again, or type your name instead.");
      const ink = inkedPixels(png);
      if (ink < 0) throw new SignError(400, "bad-signature", "That drawn signature couldn't be used. Please draw it again, or type your name instead.");
      if (ink < 40) throw new SignError(400, "blank", "Please draw your signature first");
    } else if (mode === "typed") {
      if (name.length < 2) throw new SignError(400, "bad-signature", "Please type your full name");
    } else throw new SignError(400, "bad-signature", "Choose how to sign");
    const at = iso(now());
    const evidence = { at, mode, typedName: mode === "typed" ? name : "", imageSha256: png ? sha(png) : "", ip: text(ctx.ip, 60), ua: text(ctx.ua, 300), docSha256: r0.sha256, consent: CONSENT, consentVersion: CONSENT_VERSION, mfa: Boolean(user.mfa), emailVerified: user.email, userId: user.id };
    if (png) await files.put(imgPath(r0, me0), png, "image/png");
    // Optimistic concurrency: if two people sign at the same moment, one retries against the fresh record.
    let r = await store.update("signing", r0.id, { signatories: r0.signatories.map((s) => (s.id === me0.id ? { ...s, status: "signed", evidence } : s)) }, r0.rev);
    await ev(store, { type: "signing.signed", source: "portal", userId: user.id, actor: user.email, clientKey: r.clientKey, recordId: r.id, meta: { ref: r.ref, mode, sha256: r.sha256, mfa: evidence.mfa, ip: evidence.ip } });
    if (r.signatories.every((s) => s.status === "signed")) r = await complete(store, r);
    else await notifyTurn(store, r);
    return signerView(r, user);
  }

  async function decline(store, access, user, id, { reason }) {
    const r = await mineFor(store, access, user, id);
    const me = r.signatories.find((s) => s.userId === user.id);
    if (state(r) !== "out" || me.status !== "waiting") throw new SignError(409, "closed", "This request is no longer open");
    const u = await store.update("signing", r.id, { status: "declined", declineReason: text(reason, 500), declinedBy: me.name, declinedAt: iso(now()), signatories: r.signatories.map((s) => (s.id === me.id ? { ...s, status: "declined" } : s)) }, r.rev);
    await ev(store, { type: "signing.declined", source: "portal", userId: user.id, actor: user.email, clientKey: r.clientKey, recordId: r.id, meta: { ref: r.ref, reason: text(reason, 300) } });
    if (notifyEmail) await safeSend({ to: notifyEmail, subject: "Portal: a signature was declined", text: `${me.name} declined to sign a document${u.declineReason ? `:\n\n${u.declineReason}` : "."}\n\nSee it in xproflow under the client's Portal tab.` });
    return signerView(u, user);
  }

  /** Last signature in: produce the signed copy and certificate and file them in the document centre. */
  async function complete(store, r) {
    const completedAt = iso(now());
    await ev(store, { type: "signing.completed", source: "system", actor: practiceName, clientKey: r.clientKey, recordId: r.id, meta: { ref: r.ref } });
    const { bytes: orig } = await docs.readVersion(store, r.docId, r.version);
    const signers = [];
    for (const s of r.signatories.slice().sort((a, b) => a.order - b.order)) {
      signers.push({ name: s.name, email: s.email, order: s.order, at: Date.parse(s.evidence.at), mode: s.evidence.mode, typedName: s.evidence.typedName, image: s.evidence.mode === "drawn" ? await files.get(imgPath(r, s)) : null, evidence: s.evidence });
    }
    const sealed = await sealDocument({ original: orig, title: r.title, ref: r.ref, originalSha256: r.sha256, signers, practiceName });
    const sealedSha256 = sha(sealed);
    const events = (await store.audit()).filter((e) => e.recordId === r.id && LABEL[e.type]).sort((a, b) => (a.at < b.at ? -1 : 1)).map((e) => ({ at: e.at, label: `${LABEL[e.type]}${e.type === "signing.signed" || e.type === "signing.viewed" ? ` (${e.actor})` : ""}` }));
    events.push({ at: completedAt, label: LABEL["signing.completed"] });
    const cert = await evidenceCertificate({ req: { ...r, completedAt }, ref: r.ref, practiceName, sealedSha256, signers, events, consentText: CONSENT });
    const ids = r.signatories.map((s) => s.userId);
    const base = r.title.replace(/[^\p{L}\p{N} ._()-]/gu, "").trim().slice(0, 60) || "Document";
    const sealedDoc = await docs.addGenerated(store, { clientKey: r.clientKey, title: `${r.title} (signed)`, fileName: `${base} - signed.pdf`, bytes: sealed, assignedTo: ids, note: `Signed copy. Reference ${r.ref}.` });
    const certDoc = await docs.addGenerated(store, { clientKey: r.clientKey, title: `${r.title} (certificate of signing)`, fileName: `${base} - certificate.pdf`, bytes: cert, assignedTo: ids, note: `Evidence of how this was signed. Reference ${r.ref}.` });
    const done = { ...r, status: "completed", completedAt, sealedDocId: sealedDoc.id, certDocId: certDoc.id, sealedSha256, certSha256: sha(cert) };
    done.sealMac = sealMac(done);
    const u = await store.update("signing", r.id, { status: "completed", completedAt, sealedDocId: sealedDoc.id, certDocId: certDoc.id, sealedSha256, certSha256: done.certSha256, sealMac: done.sealMac }, r.rev);
    await ev(store, { type: "signing.sealed", source: "system", actor: practiceName, clientKey: r.clientKey, recordId: r.id, meta: { ref: r.ref, originalSha256: r.sha256, sealedSha256, certificateSha256: done.certSha256 } });
    for (const s of r.signatories) await safeSend({ to: s.email, subject: `${practiceName}: your signed document is ready`, text: `Hello ${s.name},\n\nEveryone has signed. The signed copy and its certificate are in your secure portal${portalUrl ? `: ${portalUrl}` : "."}\n` });
    if (notifyEmail) await safeSend({ to: notifyEmail, subject: "Portal: a document was signed by everyone", text: `Reference ${r.ref} is complete. The signed copy and certificate are with the client's documents.` });
    return u;
  }

  /** For the practice's Portal overview: things to act on. */
  async function attention(store, reader) {
    const clients = new Map((await reader.clients()).map((c) => [c.Key, c]));
    const name = (r) => clients.get(r.clientKey)?.Title || r.clientKey;
    const out = [];
    for (const r of await store.list("signing")) {
      if (r.status === "declined") out.push({ kind: "signing", at: r.declinedAt, text: `${r.declinedBy} declined to sign "${r.title}" for ${name(r)}${r.declineReason ? `: ${r.declineReason}` : "."}`, link: `#/clients/${encodeURIComponent(r.clientKey)}/portal`, clientKey: r.clientKey });
      else if (state(r) === "expired") out.push({ kind: "signing", at: r.expiresAt, text: `Signing request "${r.title}" for ${name(r)} expired before everyone signed.`, link: `#/clients/${encodeURIComponent(r.clientKey)}/portal`, clientKey: r.clientKey });
    }
    return out;
  }

  /** Open requests and who still has to sign them now, for the reminder engine. */
  async function waiting(store) {
    return (await store.list("signing")).filter((r) => state(r) === "out").map((r) => ({
      itemId: r.id, clientKey: r.clientKey, title: r.title, since: [r.createdAt, ...r.signatories.map((s) => (s.evidence ? s.evidence.at : ""))].sort().pop(),
      recipients: r.signatories.filter((s) => turn(r, s) === "pending").map((s) => ({ userId: s.userId, email: s.email, name: s.name })),
    }));
  }

  /** Open requests whose current signers haven't signed, for the reminder engine. */
  async function overdue(store, olderThanMs) {
    return (await store.list("signing")).filter((r) => state(r) === "out" && now() - Date.parse(r.remindedAt || r.createdAt) >= olderThanMs);
  }

  return { waiting, create, staffList, cancel, remind, verify, listForSigner, openDocument, sign, decline, attention, overdue, CONSENT, SignError };
}

module.exports = { createSigning, SignError, CONSENT };
