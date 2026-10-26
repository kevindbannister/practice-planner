// Subject access and erasure for portal users.
//
// export: everything the portal holds about one person, as data they (or the practice, on their
// behalf) can be given. Identity files are described, not included.
// erase: removes what the portal holds about the person that the practice has no duty to keep.
//   Removed: the login's name, email and links to the identity provider; all access; identity
//   documents and their stored files; notifications.
//   Anonymised ("Former user"): their name on messages, request answers and uploads, so the
//   business's records still make sense.
//   Kept on purpose: the audit trail (it is tamper-evident and holds ids, not contents), sealed
//   signed copies and their certificates (legal records the business also owns), and the documents
//   they uploaded for the business.
// The practice decides when to erase (see docs/client-portal.md for the suggested retention).

class GdprError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const FORMER = "Former user";
function collectPaths(o, out = []) {
  if (Array.isArray(o)) o.forEach((x) => collectPaths(x, out));
  else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) (k === "path" && typeof v === "string" ? out.push(v) : collectPaths(v, out));
  return out;
}

function createGdpr({ audit, files, now = () => Date.now() }) {
  const iso = () => new Date(now()).toISOString();

  async function user(store, id) {
    const u = await store.get("users", String(id || ""));
    if (!u) throw new GdprError(404, "not-found", "Not found");
    return u;
  }

  async function exportFor(store, staff, userId) {
    const u = await user(store, userId);
    const access = await store.find("access", (a) => a.userId === u.id);
    const identity = (await store.find("identity", (r) => r.userId === u.id)).map((r) => ({ kind: r.kind, status: r.status, createdAt: r.createdAt, expiry: r.current?.expiryDate || "", acceptedAt: r.current?.verifiedAt || "", files: collectPaths(r).length }));
    const written = (await store.find("messages", (m) => m.kind === "message" && m.userId === u.id)).map((m) => ({ at: m.at, clientKey: m.clientKey, text: m.text }));
    const notices = (await store.find("notices", (n) => n.userId === u.id)).map((n) => ({ at: n.at, text: n.text }));
    const requests = [];
    for (const r of await store.list("requests")) for (const t of r.thread || []) if (t.userId === u.id) requests.push({ at: t.at, clientKey: r.clientKey, request: r.title, text: t.text });
    const uploads = (await store.find("documents", (d) => d.uploadedBy === u.id)).map((d) => ({ at: d.createdAt, clientKey: d.clientKey, title: d.title }));
    const events = (await store.find("audit", (e) => e.userId === u.id)).map((e) => ({ at: e.at, type: e.type, clientKey: e.clientKey || "", source: e.source }));
    await audit.record(store, { type: "gdpr.exported", source: "staff", actor: staff.name, userId: u.id });
    return { exportedAt: iso(), person: { name: u.name, email: u.email, status: u.status, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt || "" }, access: access.map((a) => ({ clientKey: a.clientKey, level: a.level, status: a.status, grantedAt: a.grantedAt })), identityDocuments: identity, messagesWritten: written, requestAnswers: requests, documentsUploaded: uploads, notifications: notices, activity: events, notIncluded: "Identity document files are not included here: they are held encrypted and can be shown to the person on request. Sealed signed copies are records of the business." };
  }

  async function erase(store, staff, userId, { confirm } = {}) {
    const u = await user(store, userId);
    if (u.status === "erased") throw new GdprError(409, "already", "This person has already been erased");
    if (String(confirm || "").trim().toLowerCase() !== String(u.email).toLowerCase()) throw new GdprError(400, "confirm", "Type the person's email address to confirm");
    const counts = { access: 0, identity: 0, files: 0, notices: 0, messages: 0, answers: 0, uploads: 0 };
    for (const a of await store.find("access", (x) => x.userId === u.id && x.status === "active")) { await store.update("access", a.id, { status: "revoked", revokedAt: iso(), revokedBy: staff.name }); counts.access++; }
    for (const r of await store.find("identity", (x) => x.userId === u.id)) {
      for (const p of new Set(collectPaths(r))) { try { await files.remove(p); counts.files++; } catch { /* already gone */ } }
      await store.remove("identity", r.id);
      counts.identity++;
    }
    for (const n of await store.find("notices", (x) => x.userId === u.id)) { await store.remove("notices", n.id); counts.notices++; }
    for (const m of await store.find("messages", (x) => x.kind === "message" && x.userId === u.id)) { await store.update("messages", m.id, { name: FORMER, userId: "" }); counts.messages++; }
    for (const t of await store.find("messages", (x) => x.kind === "thread" && (x.createdBy?.userId === u.id || (x.readBy && u.id in x.readBy) || (x.assignedTo || []).includes(u.id)))) {
      const readBy = { ...(t.readBy || {}) }; delete readBy[u.id];
      await store.update("messages", t.id, { readBy, assignedTo: (t.assignedTo || []).filter((x) => x !== u.id), createdBy: t.createdBy?.userId === u.id ? { ...t.createdBy, userId: "", name: FORMER } : t.createdBy, lastBy: t.lastBy === u.id ? "" : t.lastBy });
    }
    for (const r of await store.list("requests")) {
      if ((r.thread || []).some((t) => t.userId === u.id) || (r.assignedTo || []).includes(u.id)) {
        await store.update("requests", r.id, { thread: r.thread.map((t) => (t.userId === u.id ? { ...t, name: FORMER, userId: "" } : t)), assignedTo: (r.assignedTo || []).filter((x) => x !== u.id) });
        counts.answers++;
      }
    }
    for (const d of await store.find("documents", (x) => x.uploadedBy === u.id)) { await store.update("documents", d.id, { uploadedByName: FORMER, uploadedBy: "", versions: d.versions.map((v) => (v.byKind === "client" ? { ...v, by: FORMER } : v)) }); counts.uploads++; }
    await store.update("users", u.id, { status: "erased", name: "", email: `erased-${u.id}@erased.invalid`, subjectId: "", personKey: "", personKind: "", erasedAt: iso(), erasedBy: staff.name, sessionsEndedAt: iso(), mfa: false });
    await audit.record(store, { type: "gdpr.erased", source: "staff", actor: staff.name, userId: u.id, meta: counts });
    return counts;
  }

  return { exportFor, erase, GdprError };
}

module.exports = { createGdpr, GdprError };
