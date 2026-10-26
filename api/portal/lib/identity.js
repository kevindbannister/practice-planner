// Identity documents and renewals. These belong to a PERSON, not to a business: only that person and
// the practice can see them, however much access other people at the same business have. There is
// deliberately no business in the portal route and no way for an administrator to look.
//
// Accepting a document records that a named member of staff looked at it and accepted it. It does NOT
// by itself complete the practice's legally required (AML) identity verification; the screens say so.
//
// Files are encrypted before they are stored (AES-256-GCM), so the people who administer the file
// store can't read them without the key. Losing the key makes them unreadable.

const crypto = require("node:crypto");
const { newId } = require("./store.js");
const { checkUpload } = require("./uploads.js");

class IdError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const KINDS = { passport: "Passport", "driving-licence": "Driving licence", "national-id": "National identity card", "proof-of-address": "Proof of residential address", custom: "Other document" };
const ID_TYPES = ["pdf", "jpg", "jpeg", "png"];
const MAGIC = Buffer.from("XPF1");
const DAY = 24 * 3600 * 1000;
const iso = (ms) => new Date(ms).toISOString();
const text = (v, max = 200) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && !Number.isNaN(Date.parse(s + "T00:00:00Z")) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;
const today = (ms) => iso(ms).slice(0, 10);

/** Calendar-month arithmetic on YYYY-MM-DD, clamped to the end of a short month (31 Mar - 1 month = 28/29 Feb). */
function addMonths(date, n) {
  const [y, m, d] = date.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  const ny = Math.floor(t / 12), nm = t % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}
const addDays = (date, n) => iso(Date.parse(date + "T00:00:00Z") + n * DAY).slice(0, 10);

function createIdentity({ audit, mailer, notices = null, files, scanner = null, secret, now = () => Date.now(), practiceId, practiceName = "Your accountant", notifyEmail = "", portalUrl = "", verifiers = [], reminderDays = [7, 14], beforeExpiryDays = 7, maxBytes }) {
  if (!secret) throw new Error("A key is needed for identity files");
  const key = Buffer.from(crypto.hkdfSync("sha256", Buffer.from(secret), Buffer.alloc(0), "xproflow identity files v1", 32));
  const ev = (store, e) => audit.record(store, e);
  const safeSend = async (m) => { try { await mailer.send(m); return true; } catch { return false; } };

  const seal = (bytes) => {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv("aes-256-gcm", key, iv);
    const enc = Buffer.concat([c.update(bytes), c.final()]);
    return Buffer.concat([MAGIC, iv, c.getAuthTag(), enc]);
  };
  const unseal = (blob) => {
    if (!blob || blob.length < 32 || !blob.subarray(0, 4).equals(MAGIC)) throw new IdError(500, "bad-file", "That file can't be read");
    const d = crypto.createDecipheriv("aes-256-gcm", key, blob.subarray(4, 16));
    d.setAuthTag(blob.subarray(16, 32));
    try { return Buffer.concat([d.update(blob.subarray(32)), d.final()]); } catch { throw new IdError(500, "bad-file", "That file failed its integrity check"); }
  };
  const folder = (r) => `${practiceId}/identity/${r.userId}/${r.id}`;

  const kindName = (r) => (r.kind === "custom" ? r.label || KINDS.custom : KINDS[r.kind]);
  const expired = (r) => Boolean(r.current && r.current.expiryDate && r.current.expiryDate < today(now()));

  /** Where a requirement stands, in words a client and staff can both use. */
  function statusOf(r) {
    if (r.cancelled) return "cancelled";
    if (r.request && r.request.upload) return "received";
    if (r.request) return r.request.reason === "rejected" ? "rejected" : "needed";
    if (expired(r)) return "expired";
    return r.current ? "accepted" : "none";
  }

  /** The next time a replacement should be asked for, or "" when there is no such rule. */
  function nextRenewal(r) {
    if (!r.current || !r.renewal) return "";
    if (r.current.expiryDate) return r.renewal.auto ? addMonths(r.current.expiryDate, -1) : "";
    if (r.renewal.reviewMonths) return addMonths(r.current.verifiedAt.slice(0, 10), r.renewal.reviewMonths);
    return "";
  }

  // -------------------------------------------------------------------------- views
  const clientView = (r, businessNames) => ({
    id: r.id, kind: r.kind, title: kindName(r), status: statusOf(r), businesses: businessNames,
    request: r.request ? { requestedAt: r.request.requestedAt, reason: r.request.reason, note: r.request.note || "", rejectedReason: r.request.reason === "rejected" ? r.request.rejectedReason || "" : "", uploaded: Boolean(r.request.upload), uploadedAt: r.request.upload ? r.request.upload.receivedAt : "" } : null,
    current: r.current ? { expiryDate: r.current.expiryDate || "", acceptedAt: r.current.verifiedAt.slice(0, 10) } : null,
    nextRenewal: r.cancelled ? "" : nextRenewal(r),
    canUpload: Boolean(r.request && !r.cancelled),
  });

  const staffView = (r, people, clients) => ({
    id: r.id, userId: r.userId, person: (people.get(r.userId) || {}).name || "", email: (people.get(r.userId) || {}).email || "", kind: r.kind, title: kindName(r), status: statusOf(r), createdAt: r.createdAt, createdByName: r.createdByName,
    businesses: (r.businesses || []).map((k) => ({ clientKey: k, name: (clients.get(k) || {}).Title || k })), renewal: r.renewal, nextRenewal: r.cancelled ? "" : nextRenewal(r), paused: Boolean(r.paused),
    request: r.request ? { requestedAt: r.request.requestedAt, requestedBy: r.request.requestedBy, reason: r.request.reason, note: r.request.note || "", rejectedReason: r.request.rejectedReason || "", remindersSent: (r.request.reminders || []).length,
      upload: r.request.upload ? { fileName: r.request.upload.fileName, size: r.request.upload.size, receivedAt: r.request.upload.receivedAt, declaredIssue: r.request.upload.issueDate || "", declaredExpiry: r.request.upload.expiryDate || "", viewedBy: r.request.upload.viewedBy || [], scan: r.request.upload.scan } : null } : null,
    current: r.current ? { fileName: r.current.fileName, issueDate: r.current.issueDate || "", expiryDate: r.current.expiryDate || "", receivedAt: r.current.receivedAt, verifiedBy: r.current.verifiedBy, verifiedAt: r.current.verifiedAt, note: r.current.note || "" } : null,
    history: (r.history || []).map((h) => ({ n: h.n, fileName: h.fileName, receivedAt: h.receivedAt, issueDate: h.issueDate || "", expiryDate: h.expiryDate || "", decision: h.decision, decidedBy: h.decidedBy, decidedAt: h.decidedAt, note: h.note || "" })),
    cancelled: Boolean(r.cancelled),
  });

  const peopleMap = async (store) => new Map((await store.list("users")).map((u) => [u.id, u]));
  const clientsMap = async (reader) => new Map((await reader.clients()).map((c) => [c.Key, c]));

  // -------------------------------------------------------------------------- the person
  async function listMine(store, reader, user) {
    const clients = await clientsMap(reader);
    const access = (await store.find("access", (a) => a.userId === user.id && a.status === "active")).map((a) => a.clientKey);
    return (await store.find("identity", (r) => r.userId === user.id && !r.cancelled)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      // Only businesses this person can still see are named to them.
      .map((r) => clientView(r, (r.businesses || []).filter((k) => access.includes(k)).map((k) => (clients.get(k) || {}).Title || k)));
  }

  /** For the portal's "me" call: do they have anything here, and does any of it need them? */
  async function summaryFor(store, user) {
    const mine = await store.find("identity", (r) => r.userId === user.id && !r.cancelled);
    return { any: mine.length > 0, open: mine.filter((r) => r.request && !r.request.upload).length };
  }

  async function upload(store, user, id, { fileName, content, issueDate, expiryDate }) {
    const r = await store.get("identity", text(id, 60));
    // Someone else's request, a cancelled one, and one that doesn't exist all look the same.
    if (!r || r.userId !== user.id || r.cancelled) throw new IdError(404, "not-found", "Not found");
    if (!r.request) throw new IdError(409, "not-requested", "There's nothing to upload for this right now");
    if (r.request.upload) throw new IdError(409, "already-sent", "You've already sent this one. We'll let you know if we need anything else.");
    const s = String(content || "");
    if (!/^[A-Za-z0-9+/=\s]+$/.test(s)) throw new IdError(400, "bad-file", "That file couldn't be read");
    const bytes = Buffer.from(s, "base64");
    const chk = checkUpload({ fileName, bytes, maxBytes });
    if (!chk.ok) throw new IdError(400, "bad-file", chk.error);
    if (!ID_TYPES.includes(chk.ext)) throw new IdError(400, "bad-file", "Please send a PDF, JPG or PNG");
    const decl = (v, label) => { if (!v) return ""; if (!isDate(v)) throw new IdError(400, "bad-date", `${label} should be a real date`); return v; };
    const issue = decl(issueDate, "The issue date"), expiry = decl(expiryDate, "The expiry date");
    if (scanner) {
      const x = await scanner(bytes, chk);
      if (!x || !x.ok) {
        await ev(store, { type: "identity.refused", source: "portal", userId: user.id, actor: user.email, recordId: r.id, meta: { reason: "scan" } });
        throw new IdError(400, "scan-failed", "That file didn't pass our security check, so it wasn't saved.");
      }
    }
    const path = `${folder(r)}/${(r.history || []).length + 1}-${crypto.randomBytes(4).toString("hex")}.${chk.ext}`;
    await files.put(path, seal(bytes), "application/octet-stream");
    const up = { fileName: chk.name, ext: chk.ext, mime: chk.mime, size: chk.size, sha256: chk.sha256, path, receivedAt: iso(now()), issueDate: issue, expiryDate: expiry, viewedBy: [], scan: scanner ? "scanned" : "format-checked" };
    const u = await store.update("identity", r.id, { request: { ...r.request, upload: up } }, r.rev);
    await ev(store, { type: "identity.uploaded", source: "portal", userId: user.id, actor: user.email, recordId: r.id, meta: { kind: r.kind, size: chk.size, sha256: chk.sha256 } });
    if (notifyEmail) await safeSend({ to: notifyEmail, subject: "Portal: an identity document needs checking", text: `${user.name || user.email} sent a document.\n\nOpen xproflow, Portal, Identity, to check it.` });
    return clientView(u, []);
  }

  // -------------------------------------------------------------------------- the practice
  async function list(store, reader, { userId } = {}) {
    const [people, clients] = [await peopleMap(store), await clientsMap(reader)];
    return (await store.find("identity", (r) => !userId || r.userId === userId)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map((r) => staffView(r, people, clients));
  }
  const get = async (store, id) => {
    const r = await store.get("identity", text(id, 60));
    if (!r) throw new IdError(404, "not-found", "Not found");
    return r;
  };
  const mayVerify = (staff) => {
    if (!verifiers.length) return true;
    const who = [staff.name, staff.email].filter(Boolean).map((s) => String(s).toLowerCase());
    return verifiers.some((v) => who.includes(v));
  };

  async function askClient(store, r, user, { staffName, by, reason, note }) {
    const t = iso(now());
    const u = await store.update("identity", r.id, { request: { id: newId("idq-"), requestedAt: t, requestedBy: by, reason, note: text(note, 500), reminders: [] }, cancelled: false }, r.rev);
    await ev(store, { type: reason === "renewal" ? "identity.renewal-requested" : "identity.requested", source: by === "auto" ? "system" : "staff", actor: staffName, userId: user.id, recordId: r.id, meta: { kind: r.kind, reason } });
    if (notices) await notices.create(store, { userId: user.id, clientKey: "", text: reason === "renewal" ? "A document of yours is due to expire. We need a new one" : "We need a document from you", link: "identity" });
    // The email asks them to sign in; it carries nothing about the document.
    await safeSend({ to: user.email, subject: `${practiceName}: we need a document from you`, text: `Hello ${user.name || ""},\n\n${practiceName} has asked you for a document ${reason === "renewal" ? "to replace one that is due to expire" : ""}in your secure portal.\n\nSign in to see what is needed${portalUrl ? `: ${portalUrl}` : "."}\n` });
    return u;
  }

  async function request(store, reader, staff, { userId, kind, label, businesses, autoRenew, reviewMonths, force, note }) {
    const user = await store.get("users", text(userId, 60));
    if (!user || user.status !== "active") throw new IdError(400, "bad-person", "That person doesn't have an active portal login");
    if (!KINDS[kind]) throw new IdError(400, "bad-kind", "Choose a type of document");
    if (kind === "custom" && !text(label, 80)) throw new IdError(400, "label", "Say what the document is");
    const access = (await store.find("access", (a) => a.userId === user.id && a.status === "active")).map((a) => a.clientKey);
    const biz = [...new Set((Array.isArray(businesses) ? businesses : []).map((k) => text(k, 60)))].filter(Boolean);
    if (biz.some((k) => !access.includes(k))) throw new IdError(400, "bad-business", "That person doesn't have portal access to one of those businesses");
    const same = (await store.find("identity", (r) => r.userId === user.id && r.kind === kind && !r.cancelled && (kind !== "custom" || (r.label || "").toLowerCase() === text(label, 80).toLowerCase())))[0];
    if (same) {
      if (same.request) throw new IdError(409, "already-asked", "That document has already been asked for");
      if (same.current && !expired(same) && !force) {
        const adds = biz.filter((k) => !(same.businesses || []).includes(k));
        if (adds.length) await store.update("identity", same.id, { businesses: [...(same.businesses || []), ...adds] }, same.rev);
        throw new IdError(409, "already-valid", `${user.name || user.email} already has an accepted ${kindName(same).toLowerCase()}${same.current.expiryDate ? ` (expires ${same.current.expiryDate})` : ""}. It can be used for all of their businesses${adds.length ? ", and the extra business has been added to it" : ""}. Choose "ask again anyway" only if you need a new one.`);
      }
    }
    const months = Number(reviewMonths) > 0 ? Math.min(Number(reviewMonths), 120) : 0;
    const base = same || (await store.insert("identity", { id: newId("idr-"), userId: user.id, kind, label: kind === "custom" ? text(label, 80) : "", businesses: biz, renewal: { auto: Boolean(autoRenew), reviewMonths: months }, createdAt: iso(now()), createdByName: staff.name, current: null, history: [], request: null, paused: false, cancelled: false }));
    const u = await askClient(store, same ? await store.update("identity", same.id, { businesses: [...new Set([...(same.businesses || []), ...biz])], renewal: { auto: Boolean(autoRenew), reviewMonths: months } }, same.rev) : base, user, { staffName: staff.name, by: "staff", reason: same && same.current ? "renewal" : "new", note });
    return staffView(u, await peopleMap(store), await clientsMap(reader));
  }

  /** Staff open the file. It is logged each time, and checking it is required before it can be accepted. */
  async function download(store, staff, id, which = "upload") {
    const r = await get(store, id);
    const src = which === "current" ? r.current : which === "upload" ? r.request && r.request.upload : (r.history || []).find((h) => String(h.n) === String(which));
    if (!src) throw new IdError(404, "not-found", "Not found");
    const bytes = unseal(await files.get(src.path));
    if (which === "upload" && !src.viewedBy.includes(staff.name)) await store.update("identity", r.id, { request: { ...r.request, upload: { ...src, viewedBy: [...src.viewedBy, staff.name] } } }, r.rev);
    await ev(store, { type: "identity.viewed", source: "staff", actor: staff.name, userId: r.userId, recordId: r.id, meta: { which: String(which), fileName: src.fileName } });
    return { fileName: src.fileName, mime: src.mime, size: bytes.length, content: bytes.toString("base64") };
  }

  async function accept(store, reader, staff, id, { issueDate, expiryDate, noExpiry, note, confirmed }) {
    if (!mayVerify(staff)) throw new IdError(403, "not-authorised", "You aren't one of the people authorised to accept identity documents");
    const r = await get(store, id);
    const up = r.request && r.request.upload;
    if (!up) throw new IdError(409, "nothing", "There's no uploaded document waiting to be checked");
    if (!up.viewedBy.includes(staff.name)) throw new IdError(409, "view-first", "Open the document and check it before accepting it");
    if (confirmed !== true) throw new IdError(400, "confirm", "Please confirm that you have checked the document");
    const issue = issueDate || "", expiry = expiryDate || "";
    for (const [v, l] of [[issue, "issue"], [expiry, "expiry"]]) if (v && !isDate(v)) throw new IdError(400, "bad-date", `The ${l} date should be a real date`);
    if (!expiry && noExpiry !== true) throw new IdError(400, "expiry", "Enter the expiry date, or say that it has none");
    if (expiry && issue && expiry < issue) throw new IdError(400, "bad-date", "The expiry date is before the issue date");
    if (expiry && expiry < today(now())) throw new IdError(400, "expired", "That document has already expired, so it can't be accepted. Reject it and ask for a current one.");
    const t = iso(now());
    const previous = r.current ? [{ n: (r.history || []).length + 1, ...r.current, decision: "replaced", decidedBy: r.current.verifiedBy, decidedAt: r.current.verifiedAt, replacedAt: t }] : [];
    const current = { fileName: up.fileName, ext: up.ext, mime: up.mime, size: up.size, sha256: up.sha256, path: up.path, receivedAt: up.receivedAt, issueDate: issue, expiryDate: expiry, verifiedBy: staff.name, verifiedAt: t, note: text(note, 500) };
    const u = await store.update("identity", r.id, { current, history: [...(r.history || []), ...previous], request: null, autoSkip: "" }, r.rev);
    await ev(store, { type: "identity.accepted", source: "staff", actor: staff.name, userId: r.userId, recordId: r.id, meta: { kind: r.kind, expiry: expiry || "none", next: nextRenewal(u) } });
    const user = await store.get("users", r.userId);
    if (user) await safeSend({ to: user.email, subject: `${practiceName}: we've received your document`, text: `Hello ${user.name || ""},\n\nThank you. We've checked the document you sent and don't need anything else for now.\n` });
    return staffView(u, await peopleMap(store), await clientsMap(reader));
  }

  async function reject(store, reader, staff, id, { reason }) {
    if (!mayVerify(staff)) throw new IdError(403, "not-authorised", "You aren't one of the people authorised to check identity documents");
    const r = await get(store, id);
    const up = r.request && r.request.upload;
    if (!up) throw new IdError(409, "nothing", "There's no uploaded document waiting to be checked");
    if (!text(reason, 300)) throw new IdError(400, "reason", "Tell the client what's wrong so they can send another");
    const t = iso(now());
    const rejected = { n: (r.history || []).length + 1, fileName: up.fileName, path: up.path, sha256: up.sha256, receivedAt: up.receivedAt, issueDate: up.issueDate, expiryDate: up.expiryDate, decision: "rejected", decidedBy: staff.name, decidedAt: t, note: text(reason, 300) };
    // The request stays open so they can upload another; reminders start again from now.
    const u = await store.update("identity", r.id, { history: [...(r.history || []), rejected], request: { id: newId("idq-"), requestedAt: t, requestedBy: staff.name, reason: "rejected", rejectedReason: text(reason, 300), note: "", reminders: [] } }, r.rev);
    await ev(store, { type: "identity.rejected", source: "staff", actor: staff.name, userId: r.userId, recordId: r.id, meta: { kind: r.kind, reason: text(reason, 300) } });
    const user = await store.get("users", r.userId);
    if (user) await safeSend({ to: user.email, subject: `${practiceName}: we need another document from you`, text: `Hello ${user.name || ""},\n\nWe couldn't accept the document you sent. Please sign in to see why and to send another${portalUrl ? `: ${portalUrl}` : "."}\n` });
    return staffView(u, await peopleMap(store), await clientsMap(reader));
  }

  async function edit(store, reader, staff, id, { businesses, autoRenew, reviewMonths, paused }) {
    const r = await get(store, id);
    const patch = {};
    if (businesses !== undefined) {
      const access = (await store.find("access", (a) => a.userId === r.userId && a.status === "active")).map((a) => a.clientKey);
      const biz = [...new Set((Array.isArray(businesses) ? businesses : []).map((k) => text(k, 60)))].filter(Boolean);
      if (biz.some((k) => !access.includes(k))) throw new IdError(400, "bad-business", "That person doesn't have portal access to one of those businesses");
      patch.businesses = biz;
    }
    if (autoRenew !== undefined || reviewMonths !== undefined) patch.renewal = { auto: autoRenew !== undefined ? Boolean(autoRenew) : r.renewal.auto, reviewMonths: reviewMonths !== undefined ? Math.max(0, Math.min(Number(reviewMonths) || 0, 120)) : r.renewal.reviewMonths };
    if (paused !== undefined) patch.paused = Boolean(paused);
    const u = await store.update("identity", r.id, patch, r.rev);
    await ev(store, { type: "identity.edited", source: "staff", actor: staff.name, userId: r.userId, recordId: r.id, meta: { fields: Object.keys(patch), ...(patch.paused !== undefined ? { paused: patch.paused } : {}) } });
    return staffView(u, await peopleMap(store), await clientsMap(reader));
  }

  /** Stop asking: cancels an open request, or drops the requirement altogether when there is none. */
  async function cancel(store, reader, staff, id) {
    const r = await get(store, id);
    // Cancelling a renewal means "not this time": the automatic rule stays quiet until a replacement is accepted.
    const patch = r.request ? { request: null, ...(r.current ? { autoSkip: r.current.sha256 } : {}) } : { cancelled: true };
    const u = await store.update("identity", r.id, patch, r.rev);
    await ev(store, { type: "identity.cancelled", source: "staff", actor: staff.name, userId: r.userId, recordId: r.id, meta: { kind: r.kind, what: r.request ? "request" : "requirement" } });
    return staffView(u, await peopleMap(store), await clientsMap(reader));
  }

  // -------------------------------------------------------------------------- the scheduled part
  /**
   * Run the date-driven rules. Safe to run as often as you like: it only acts when something is due and
   * never twice for the same thing. Returns what it did.
   *   1. Auto-renew: a new request the calendar month before expiry (or at the end of the review interval).
   *   2. Reminders on open requests: after each configured number of days, and shortly before expiry.
   */
  async function sweep(store, reader) {
    const done = { requested: 0, reminded: 0 };
    const day = today(now());
    const users = await peopleMap(store);
    for (const r of await store.list("identity")) {
      const user = users.get(r.userId);
      if (!user || user.status !== "active" || r.cancelled) continue;
      if (!r.request && r.current && r.renewal && !r.paused && r.autoSkip !== r.current.sha256) {
        const due = nextRenewal(r);
        if (due && due <= day && (r.renewal.auto || (!r.current.expiryDate && r.renewal.reviewMonths))) {
          await askClient(store, r, user, { staffName: practiceName, by: "auto", reason: "renewal", note: "" });
          done.requested++;
          continue;
        }
      }
      if (r.request && !r.request.upload && !r.paused) {
        const sent = r.request.reminders || [];
        const asked = today(Date.parse(r.request.requestedAt));
        const dueKinds = [];
        reminderDays.forEach((d, i) => { if (!sent.some((x) => x.kind === `after-${d}`) && day >= addDays(asked, d) && (i === 0 || sent.some((x) => x.kind === `after-${reminderDays[i - 1]}`))) dueKinds.push(`after-${d}`); });
        if (r.current && r.current.expiryDate && !sent.some((x) => x.kind === "before-expiry") && day >= addDays(r.current.expiryDate, -beforeExpiryDays) && day <= r.current.expiryDate) dueKinds.push("before-expiry");
        // One email per sweep per person is enough, even if several reminders came due together.
        if (dueKinds.length) {
          const t = iso(now());
          const u = await store.update("identity", r.id, { request: { ...r.request, reminders: [...sent, ...dueKinds.map((k) => ({ kind: k, at: t }))] } }, r.rev);
          await safeSend({ to: user.email, subject: `${practiceName}: reminder, we still need a document from you`, text: `Hello ${user.name || ""},\n\nWe're still waiting for a document in your secure portal.\n\nSign in to send it${portalUrl ? `: ${portalUrl}` : "."}\n` });
          await ev(store, { type: "identity.reminded", source: "system", actor: practiceName, userId: r.userId, recordId: u.id, meta: { kinds: dueKinds } });
          done.reminded++;
        }
      }
    }
    return done;
  }

  /** Things for the practice to look at. */
  async function attention(store, reader) {
    const users = await peopleMap(store);
    const out = [];
    for (const r of await store.list("identity")) {
      if (r.cancelled) continue;
      const who = (users.get(r.userId) || {}).name || "A client";
      const link = "#/portal/identity";
      if (r.request && r.request.upload) out.push({ kind: "identity", at: r.request.upload.receivedAt, text: `${who} sent a ${kindName(r).toLowerCase()} to check.`, link, userId: r.userId });
      else if (expired(r)) out.push({ kind: "identity", at: r.current.expiryDate + "T00:00:00.000Z", text: `${who}'s ${kindName(r).toLowerCase()} expired on ${r.current.expiryDate} and has not been replaced.`, link, userId: r.userId });
    }
    return out;
  }

  return { listMine, summaryFor, upload, list, request, download, accept, reject, edit, cancel, sweep, attention, addMonths, nextRenewal, KINDS, IdError };
}

module.exports = { createIdentity, IdError, addMonths, KINDS };
