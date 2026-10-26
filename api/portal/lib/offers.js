// Proposal links. A prospect has no portal account, so a proposal can be offered to them through a
// secure, expiring link instead. Staff publish a frozen copy of the proposal from the planner; the
// server keeps it, shows it to whoever holds the link, and records their answer. The planner then
// collects the answer and records it against the proposal.
//
// The rules that matter:
//  - The link holds a random 256-bit token. Only a hash of it is kept, so a copy of the list
//    never gives anyone a working link. It is shown to staff once, when it is made.
//  - A link works only for the exact version published. Its content is fixed when it is made.
//  - It stops working at the end of the day the proposal is valid until, or when staff withdraw it.
//    Publishing the same version again withdraws the earlier link.
//  - An answer can only be given once. It records who (the name typed), when, from where, what
//    they were shown and what they agreed to.
//  - Accepting a proposal agrees the services and fees only. It does not complete identity checks
//    or an engagement letter, and the page says so.
//  - Nothing the link shows includes internal notes, other clients or anything not in the proposal.
//  - Only staff with authority to send proposals can make a link (checked here, not just on screen).

const crypto = require("node:crypto");
const { newId, StoreError } = require("./store.js");
const { ServiceError } = require("./service.js");

const COLL = "proposals";
const DAY = 24 * 3600 * 1000;
const CONSENT_VERSION = 1;
const CONSENT = "I confirm that I am authorised to accept this proposal for the person or business named, that I have read it, and that I accept the services and fees it sets out. I understand that my name, network address, device details and the time will be recorded, and that I will still need to complete identity checks and agree an engagement letter before work begins.";
const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const text = (v, max = 200) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max);
const iso = (ms) => new Date(ms).toISOString();
const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const MAX_CONTENT = 250000;

/** Roles allowed to send proposals, from the planner's staff list. With nobody listed, anyone signed in as staff. */
const SENDERS = ["manager", "partner", "owner"];
function mayPublish(rows, name) {
  const row = (rows || []).find((r) => r.Key === "checklist-config");
  let staff = [];
  try { const v = JSON.parse(String(row?.Value || "{}")); staff = Array.isArray(v.staff) ? v.staff : []; } catch { staff = []; }
  if (!staff.length) return true;
  const me = staff.find((s) => text(s.name).toLowerCase() === text(name).toLowerCase());
  return !!me && SENDERS.includes(me.role);
}

/** Only the document model's own block types, as plain text. Anything else is dropped. */
function cleanRuns(runs) {
  return (Array.isArray(runs) ? runs : []).slice(0, 200).map((r) => ({ t: text(r && r.t, 4000), ...(r && r.b ? { b: true } : {}), ...(r && r.i ? { i: true } : {}) })).filter((r) => r.t);
}
function cleanBlocks(blocks) {
  const out = [];
  for (const b of (Array.isArray(blocks) ? blocks : []).slice(0, 600)) {
    if (!b || typeof b !== "object") continue;
    if (b.type === "p") out.push({ type: "p", runs: cleanRuns(b.runs) });
    else if (b.type === "h") out.push({ type: "h", level: [1, 2, 3].includes(b.level) ? b.level : 2, runs: cleanRuns(b.runs) });
    else if (b.type === "list") out.push({ type: "list", ordered: !!b.ordered, items: (Array.isArray(b.items) ? b.items : []).slice(0, 100).map(cleanRuns) });
    else if (b.type === "table") out.push({ type: "table", header: !!b.header, rows: (Array.isArray(b.rows) ? b.rows : []).slice(0, 100).map((row) => (Array.isArray(row) ? row : []).slice(0, 12).map((c) => ({ runs: cleanRuns(c && c.runs), align: c && c.align === "right" ? "right" : undefined }))) });
    else if (b.type === "break") out.push({ type: "break" });
  }
  return out;
}

class OfferError extends ServiceError {}
const gone = (code, msg) => new OfferError(410, code, msg);
const notFound = () => new OfferError(404, "not-found", "This link isn't valid. Please check it, or ask the practice to send it again.");

function createOffers({ audit, mailer, now = () => Date.now(), practiceName = "Your accountant", notifyEmail = "" }) {
  const ev = (store, e) => audit.record(store, { source: "portal", ...e });
  const expiry = (l) => Date.parse(`${l.validUntil}T23:59:59.999Z`);
  const statusOf = (l) => (l.status === "open" && now() > expiry(l) ? "expired" : l.status);
  const today = () => iso(now()).slice(0, 10);

  async function byToken(store, token) {
    const t = String(token || "");
    if (!/^[A-Za-z0-9_-]{43}$/.test(t)) return null;
    const h = sha(t);
    const all = await store.find(COLL, (l) => l.tokenHash === h);
    return all[0] || null;
  }

  async function sendQuiet(m) {
    try { if (mailer && mailer.configured !== false) await mailer.send(m); } catch { /* the answer is recorded either way */ }
  }

  return {
    CONSENT, CONSENT_VERSION,

    /** Staff make a link for one version of a proposal. Returns the token once. */
    async publish(store, staff, b) {
      const proposalKey = text(b.proposalKey, 80), ref = text(b.ref, 40), title = text(b.title, 200);
      const version = Math.floor(Number(b.version));
      if (!proposalKey || !ref || !(version >= 1)) throw new OfferError(400, "invalid", "Which proposal and version?");
      if (!title) throw new OfferError(400, "invalid", "The proposal needs a title.");
      const recipientName = text(b.recipientName, 120);
      const recipientEmail = text(b.recipientEmail, 254).toLowerCase();
      if (!recipientName) throw new OfferError(400, "invalid", "Who is it for?");
      if (!EMAIL.test(recipientEmail)) throw new OfferError(400, "bad-email", "That doesn't look like an email address");
      const validUntil = text(b.validUntil, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(validUntil) || Number.isNaN(Date.parse(validUntil))) throw new OfferError(400, "invalid", "Say how long the proposal is valid for.");
      if (validUntil < today()) throw new OfferError(400, "invalid", "That date has already passed.");
      if (Date.parse(validUntil) > now() + 400 * DAY) throw new OfferError(400, "invalid", "A proposal link can last at most a year.");
      const bodyHash = text(b.bodyHash, 64).toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(bodyHash)) throw new OfferError(400, "invalid", "The proposal wasn't sealed.");
      const blocks = cleanBlocks(b.content && b.content.blocks);
      if (!blocks.length) throw new OfferError(400, "invalid", "There's nothing to show.");
      if (JSON.stringify(blocks).length > MAX_CONTENT) throw new OfferError(400, "too-big", "That proposal is too long to put behind a link.");
      const optional = (Array.isArray(b.optional) ? b.optional : []).slice(0, 20).map((o) => ({ id: text(o && o.id, 60), label: text(o && o.label, 200), price: text(o && o.price, 80) })).filter((o) => o.id && o.label);
      // one live link per version: the earlier one is withdrawn
      for (const old of await store.find(COLL, (l) => l.proposalKey === proposalKey && l.version === version && l.status === "open")) {
        await store.update(COLL, old.id, { status: "revoked", revokedAt: iso(now()), revokedBy: staff.name });
      }
      const token = crypto.randomBytes(32).toString("base64url");
      const link = await store.insert(COLL, {
        id: newId("pl-"), tokenHash: sha(token), proposalKey, ref, version, title, recipientName, recipientEmail, validUntil, bodyHash, blocks, optional,
        practiceName: text(b.practiceName, 120) || practiceName, status: "open", createdAt: iso(now()), createdBy: staff.name, viewedAt: "", decision: null, pulled: false,
      });
      await ev(store, { type: "proposal.link-created", actor: staff.name, source: "staff", recordId: link.id, meta: { ref, version, validUntil, to: recipientEmail } });
      return { id: link.id, token, expiresAt: iso(expiry(link)) };
    },

    /** What a person with the link sees. */
    async view(store, token) {
      const l = await byToken(store, token);
      if (!l) throw notFound();
      const s = statusOf(l);
      const base = { practiceName: l.practiceName, title: l.title, ref: l.ref, recipientName: l.recipientName, validUntil: l.validUntil };
      if (s === "revoked") throw gone("withdrawn", "This proposal has been withdrawn. Please contact the practice.");
      if (s === "expired") throw gone("expired", "This proposal has expired. Please contact the practice for an up-to-date one.");
      if (s === "accepted" || s === "declined") return { ...base, status: s, answeredAt: l.decision?.at || "" };
      if (!l.viewedAt) {
        await store.update(COLL, l.id, { viewedAt: iso(now()) });
        await ev(store, { type: "proposal.link-viewed", recordId: l.id, meta: { ref: l.ref, version: l.version } });
      }
      return { ...base, status: "open", blocks: l.blocks, optional: l.optional, consent: CONSENT, consentVersion: CONSENT_VERSION };
    },

    /** Their answer: accept (with their name and consent) or decline. Once only. */
    async decide(store, token, b, meta = {}) {
      const l = await byToken(store, token);
      if (!l) throw notFound();
      const s = statusOf(l);
      if (s === "revoked") throw gone("withdrawn", "This proposal has been withdrawn. Please contact the practice.");
      if (s === "expired") throw gone("expired", "This proposal has expired. Please contact the practice for an up-to-date one.");
      if (s !== "open") throw new OfferError(409, "answered", "This proposal has already been answered.");
      const decision = b.decision === "decline" ? "decline" : b.decision === "accept" ? "accept" : "";
      if (!decision) throw new OfferError(400, "invalid", "Please choose to accept or decline.");
      const name = text(b.name, 120);
      let optional = [];
      let reason = "";
      if (decision === "accept") {
        if (name.length < 2) throw new OfferError(400, "name", "Please type your full name to accept.");
        if (b.consent !== true) throw new OfferError(400, "consent", "Please tick the box to confirm.");
        const allowed = new Set(l.optional.map((o) => o.id));
        optional = [...new Set((Array.isArray(b.optional) ? b.optional : []).map((x) => text(x, 60)))].filter((x) => allowed.has(x));
      } else reason = text(b.reason, 500);
      const record = { decision, name, optional, reason, at: iso(now()), ip: text(meta.ip, 60), ua: text(meta.ua, 200), consentVersion: CONSENT_VERSION, consentText: decision === "accept" ? CONSENT : "", bodyHash: l.bodyHash };
      try {
        await store.update(COLL, l.id, { status: decision === "accept" ? "accepted" : "declined", decision: record }, l.rev);
      } catch (e) {
        if (e instanceof StoreError && e.code === "conflict") throw new OfferError(409, "answered", "This proposal has already been answered.");
        throw e;
      }
      await ev(store, { type: decision === "accept" ? "proposal.accepted" : "proposal.declined", actor: name, recordId: l.id, meta: { ref: l.ref, version: l.version, ip: record.ip } });
      if (notifyEmail) await sendQuiet({ to: notifyEmail, subject: `Proposal ${l.ref} ${decision === "accept" ? "accepted" : "declined"}`, text: `${decision === "accept" ? `${name} accepted` : `${l.recipientName} declined`} proposal ${l.ref} (version ${l.version}). Open the planner and choose Check for replies on the proposal to record it.` });
      if (decision === "accept") await sendQuiet({ to: l.recipientEmail, subject: `Thank you: ${l.title}`, text: `Hello ${name},\n\nThank you for accepting our proposal (${l.ref}). We'll be in touch shortly about the next steps, which include our identity checks and the engagement letter.\n\n${l.practiceName}` });
      return { ok: true, status: decision === "accept" ? "accepted" : "declined", at: record.at };
    },

    /** Answers the planner hasn't yet recorded. */
    async results(store) {
      return (await store.find(COLL, (l) => (l.status === "accepted" || l.status === "declined") && !l.pulled)).map((l) => ({
        id: l.id, proposalKey: l.proposalKey, ref: l.ref, version: l.version, bodyHash: l.bodyHash, ...l.decision,
      }));
    },
    async acknowledge(store, staff, ids) {
      let n = 0;
      for (const id of (Array.isArray(ids) ? ids : []).map(String)) {
        const l = await store.get(COLL, id);
        if (l && !l.pulled && (l.status === "accepted" || l.status === "declined")) { await store.update(COLL, id, { pulled: true, pulledBy: staff.name, pulledAt: iso(now()) }); n++; }
      }
      return { acknowledged: n };
    },
    /** Links for a proposal (never the token), so staff can see what's out there. */
    async linksFor(store, proposalKey) {
      return (await store.find(COLL, (l) => l.proposalKey === String(proposalKey))).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map((l) => ({
        id: l.id, version: l.version, status: statusOf(l), createdAt: l.createdAt, createdBy: l.createdBy, expiresAt: iso(expiry(l)), viewedAt: l.viewedAt, to: l.recipientEmail, answeredAt: l.decision?.at || "",
      }));
    },
    async revoke(store, staff, id) {
      const l = await store.get(COLL, String(id));
      if (!l) throw notFound();
      if (l.status !== "open") throw new OfferError(409, "closed", "That link is no longer open.");
      await store.update(COLL, l.id, { status: "revoked", revokedAt: iso(now()), revokedBy: staff.name });
      await ev(store, { type: "proposal.link-revoked", actor: staff.name, source: "staff", recordId: l.id, meta: { ref: l.ref } });
      return { ok: true };
    },
    mayPublish,
  };
}

module.exports = { createOffers, OfferError, mayPublish };
