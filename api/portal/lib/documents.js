// The document centre. Staff publish documents to a business; clients upload to it. A document is
// only visible to the client once staff have explicitly published it. Files are never linked to
// directly: every download goes through the server, which checks who is asking each time.
//
// A document has versions (the file itself is never overwritten), a category, optionally a list of
// people it is assigned to (those people only, plus administrators), and optionally needs a
// client's approval. Identity documents are NOT handled here: they have their own stricter module.

const { newId } = require("./store.js");
const { checkUpload } = require("./uploads.js");
const { canSee } = require("./rules.js");

class DocError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const CATEGORIES = ["Accounts", "Tax returns", "VAT", "Payroll", "Bookkeeping", "Statutory", "Letters and agreements", "From you", "Other"];
const iso = (ms) => new Date(ms).toISOString();
const text = (v, max = 200) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max);

function createDocuments({ audit, mailer, files, scanner = null, now = () => Date.now(), practiceId, practiceName = "Your accountant", notifyEmail = "", maxBytes }) {
  const ev = (store, e) => audit.record(store, e);
  const safeSend = async (m) => { try { await mailer.send(m); return true; } catch { return false; } };
  const folder = (clientKey, id) => `${practiceId}/${clientKey}/${id}`;

  const decode = (b64) => {
    const s = String(b64 || "");
    if (!/^[A-Za-z0-9+/=\s]+$/.test(s)) throw new DocError(400, "bad-file", "That file couldn't be read");
    return Buffer.from(s, "base64");
  };

  /** Check the file, scan it if a scanner is plugged in, and store it. Returns the version record. */
  async function storeVersion(store, doc, n, { fileName, content }, by) {
    const bytes = decode(content);
    const chk = checkUpload({ fileName, bytes, maxBytes });
    if (!chk.ok) throw new DocError(400, "bad-file", chk.error);
    let scan = "format-checked";
    if (scanner) {
      const r = await scanner(bytes, chk);
      if (!r || !r.ok) {
        await ev(store, { type: "document.refused", source: by.source, userId: by.userId, actor: by.actor, clientKey: doc.clientKey, recordId: doc.id, meta: { reason: "scan", fileName: chk.name } });
        throw new DocError(400, "scan-failed", "That file didn't pass our security check, so it wasn't saved.");
      }
      scan = "scanned";
    }
    const path = `${folder(doc.clientKey, doc.id)}/v${n}-${chk.name}`;
    await files.put(path, bytes, chk.mime);
    return { n, fileName: chk.name, ext: chk.ext, mime: chk.mime, size: chk.size, sha256: chk.sha256, path, at: iso(now()), by: by.name, byKind: by.source === "portal" ? "client" : "staff", scan };
  }

  const versionOut = (v) => ({ n: v.n, fileName: v.fileName, ext: v.ext, size: v.size, at: v.at, by: v.by, byKind: v.byKind, sha256: v.sha256 });
  const current = (d) => d.versions[d.versions.length - 1];

  /** What a client sees. Nothing staff-only (no storage path, no internal note). */
  const forClient = (d) => ({
    id: d.id, title: d.title, category: d.category, status: d.status, createdAt: d.createdAt, updatedAt: d.updatedAt, from: d.origin,
    needsApproval: Boolean(d.requiresApproval), approval: d.approval ? { status: d.approval.status, at: d.approval.at, by: d.approval.by, note: d.approval.note || "" } : null,
    message: d.message || "", assigned: Boolean(d.assignedTo && d.assignedTo.length), previewable: ["pdf", "png", "jpg", "jpeg"].includes(current(d).ext), versions: d.versions.map(versionOut), size: current(d).size, ext: current(d).ext,
  });
  const forStaff = (d, names = new Map()) => ({ ...forClient(d), clientKey: d.clientKey, published: Boolean(d.published), publishedAt: d.publishedAt || "", assignedTo: d.assignedTo || [], assignedNames: (d.assignedTo || []).map((u) => names.get(u) || u), locked: Boolean(d.locked), internalNote: d.internalNote || "", uploadedBy: d.uploadedByName || "", scan: current(d).scan });

  const visibleTo = (access, user, d) => d.published && d.status !== "archived" && d.status !== "withdrawn" && canSee(access, "documents.view", user.id, d);

  // ------------------------------------------------------------------ client side
  async function listForClient(store, access, user, q = {}) {
    const all = (await store.find("documents", (d) => d.clientKey === access.clientKey)).filter((d) => visibleTo(access, user, d));
    const term = text(q.q, 80).toLowerCase();
    return all
      .filter((d) => (!q.category || d.category === q.category) && (!term || `${d.title} ${current(d).fileName} ${d.category}`.toLowerCase().includes(term)) && (!q.status || d.status === q.status))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).map(forClient);
  }

  async function mine(store, access, user, id) {
    const d = await store.get("documents", text(id, 60));
    if (!d || d.clientKey !== access.clientKey || !visibleTo(access, user, d)) throw new DocError(404, "not-found", "Not found");
    return d;
  }

  /** The file, as base64 in JSON, so the browser can show or save it without any public file address. */
  async function download(store, access, user, id, n, { source = "portal", staff = null } = {}) {
    const d = staff ? await store.get("documents", text(id, 60)) : await mine(store, access, user, id);
    if (!d || (staff && d.clientKey !== staff.clientKey && staff.clientKey)) throw new DocError(404, "not-found", "Not found");
    const v = d.versions.find((x) => x.n === Number(n || current(d).n));
    if (!v) throw new DocError(404, "not-found", "Not found");
    const bytes = await files.get(v.path);
    if (!bytes) throw new DocError(404, "missing-file", "That file can't be found. Please let us know.");
    await ev(store, { type: "document.downloaded", source, userId: user ? user.id : "", actor: staff ? staff.name : user.email, clientKey: d.clientKey, recordId: d.id, meta: { version: v.n, fileName: v.fileName } });
    return { fileName: v.fileName, mime: v.mime, size: v.size, content: bytes.toString("base64") };
  }

  async function upload(store, access, user, { title, category, content, fileName, message, replaces }) {
    let d;
    const by = { source: "portal", userId: user.id, actor: user.email, name: user.name || user.email };
    if (replaces) {
      d = await mine(store, access, user, replaces);
      if (d.uploadedBy !== user.id) throw new DocError(403, "not-yours", "You can only replace a document that you uploaded");
      const v = await storeVersion(store, d, current(d).n + 1, { fileName, content }, by);
      d = await store.update("documents", d.id, { versions: [...d.versions, v], updatedAt: iso(now()), status: "received", approval: null, seenByStaff: false }, d.rev);
    } else {
      const id = newId("doc-");
      const draft = { id, clientKey: access.clientKey };
      const v = await storeVersion(store, draft, 1, { fileName, content }, by);
      const t = iso(now());
      // A restricted person's upload is theirs and administrators'; others' uploads are for the whole business.
      d = await store.insert("documents", { id, clientKey: access.clientKey, title: text(title, 120) || v.fileName.replace(/\.[^.]+$/, ""), category: CATEGORIES.includes(category) ? category : "From you", origin: "client", published: true, publishedAt: t, status: "received", createdAt: t, updatedAt: t, uploadedBy: user.id, uploadedByName: user.name || user.email, assignedTo: access.level === "restricted" ? [user.id] : [], message: text(message, 500), versions: [v], requiresApproval: false });
    }
    await ev(store, { type: replaces ? "document.version-uploaded" : "document.uploaded", source: "portal", userId: user.id, actor: user.email, clientKey: d.clientKey, recordId: d.id, meta: { version: current(d).n, fileName: current(d).fileName, size: current(d).size, sha256: current(d).sha256, scan: current(d).scan } });
    if (notifyEmail) await safeSend({ to: notifyEmail, subject: "Portal: a client uploaded a document", text: `${user.name || user.email} uploaded "${d.title}".\n\nYou'll find it in xproflow under the client's Portal tab.` });
    return forClient(d);
  }

  async function approve(store, access, user, id, { decision, note }) {
    const d = await mine(store, access, user, id);
    if (!d.requiresApproval) throw new DocError(400, "no-approval", "This document doesn't need approving");
    if (!["approved", "declined"].includes(decision)) throw new DocError(400, "bad-decision", "Please choose approve or decline");
    if (d.approval && d.approval.status === "approved" && d.approval.version === current(d).n) throw new DocError(409, "decided", "This has already been approved");
    const approval = { status: decision, at: iso(now()), by: user.name || user.email, byUser: user.id, note: text(note, 500), version: current(d).n, sha256: current(d).sha256 };
    const u = await store.update("documents", d.id, { approval, status: decision, updatedAt: approval.at }, d.rev);
    await ev(store, { type: decision === "approved" ? "document.approved" : "document.declined", source: "portal", userId: user.id, actor: user.email, clientKey: d.clientKey, recordId: d.id, meta: { version: approval.version, sha256: approval.sha256, note: approval.note } });
    if (notifyEmail) await safeSend({ to: notifyEmail, subject: `Portal: "${d.title}" ${decision}`, text: `${approval.by} ${decision} "${d.title}"${approval.note ? `:\n\n${approval.note}` : "."}` });
    return forClient(u);
  }

  // ------------------------------------------------------------------ staff side
  async function staffList(store, clientKey) {
    const users = new Map((await store.list("users")).map((u) => [u.id, u.name || u.email]));
    return (await store.find("documents", (d) => d.clientKey === clientKey)).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).map((d) => forStaff(d, users));
  }

  async function peopleToTell(store, d) {
    const access = await store.find("access", (a) => a.clientKey === d.clientKey && a.status === "active");
    const users = new Map((await store.list("users")).map((u) => [u.id, u]));
    return access.filter((a) => canSee(a, "documents.view", a.userId, d)).map((a) => users.get(a.userId)).filter((u) => u && u.status === "active" && u.email);
  }

  async function notifyPublished(store, d, portalUrl) {
    let n = 0;
    for (const u of await peopleToTell(store, d)) {
      // The email says a document is waiting. It never carries the document or its title.
      if (await safeSend({ to: u.email, subject: `${practiceName}: a new document is waiting for you`, text: `Hello ${u.name || ""},\n\n${practiceName} has shared a document with you in your secure portal.${d.requiresApproval ? " It needs your approval." : ""}\n\nSign in to see it${portalUrl ? `: ${portalUrl}` : "."}\n` })) n++;
    }
    return n;
  }

  /** Staff add a document. `publish` false keeps it as a draft nobody on the client side can see. */
  async function staffAdd(store, staff, { clientKey, title, category, content, fileName, publish, assignedTo, requiresApproval, message, internalNote, notify }, portalUrl = "") {
    if (!text(clientKey, 60)) throw new DocError(400, "bad-client", "Choose a client");
    const id = newId("doc-");
    const by = { source: "staff", actor: staff.name, name: staff.name };
    const v = await storeVersion(store, { id, clientKey }, 1, { fileName, content }, by);
    const t = iso(now());
    const ids = await validAssignees(store, clientKey, assignedTo);
    let d = await store.insert("documents", { id, clientKey, title: text(title, 120) || v.fileName.replace(/\.[^.]+$/, ""), category: CATEGORIES.includes(category) ? category : "Other", origin: "practice", published: false, status: "draft", createdAt: t, updatedAt: t, uploadedByName: staff.name, assignedTo: ids, message: text(message, 500), internalNote: text(internalNote, 500), versions: [v], requiresApproval: Boolean(requiresApproval) });
    await ev(store, { type: "document.added", source: "staff", actor: staff.name, clientKey, recordId: id, meta: { fileName: v.fileName, size: v.size, sha256: v.sha256, scan: v.scan } });
    if (publish) d = (await publishDoc(store, staff, d, notify !== false, portalUrl)).doc;
    return forStaff(d);
  }

  async function validAssignees(store, clientKey, list) {
    const out = [];
    for (const uid of Array.isArray(list) ? list.slice(0, 50) : []) {
      const a = (await store.find("access", (x) => x.userId === uid && x.clientKey === clientKey && x.status === "active"))[0];
      if (!a) throw new DocError(400, "bad-assignee", "That person doesn't have portal access to this business");
      out.push(uid);
    }
    return out;
  }

  async function publishDoc(store, staff, d, notify, portalUrl) {
    const t = iso(now());
    const u = await store.update("documents", d.id, { published: true, publishedAt: t, status: d.requiresApproval ? "awaiting-approval" : "published", updatedAt: t }, d.rev);
    await ev(store, { type: "document.published", source: "staff", actor: staff.name, clientKey: d.clientKey, recordId: d.id, meta: { version: current(u).n, assigned: (u.assignedTo || []).length, needsApproval: Boolean(u.requiresApproval) } });
    const told = notify ? await notifyPublished(store, u, portalUrl) : 0;
    return { doc: u, told };
  }

  const staffDoc = async (store, id) => {
    const d = await store.get("documents", text(id, 60));
    if (!d) throw new DocError(404, "not-found", "Not found");
    return d;
  };

  async function staffPublish(store, staff, id, { notify, assignedTo, requiresApproval } = {}, portalUrl = "") {
    let d = await staffDoc(store, id);
    if (d.origin !== "practice") throw new DocError(400, "not-practice", "Only documents from the practice are published");
    if (assignedTo !== undefined || requiresApproval !== undefined) {
      d = await store.update("documents", d.id, { ...(assignedTo !== undefined ? { assignedTo: await validAssignees(store, d.clientKey, assignedTo) } : {}), ...(requiresApproval !== undefined ? { requiresApproval: Boolean(requiresApproval) } : {}) }, d.rev);
    }
    const r = await publishDoc(store, staff, d, notify !== false, portalUrl);
    return { ...forStaff(r.doc), told: r.told };
  }

  const lockedCheck = (d) => { if (d.locked) throw new DocError(409, "locked", "This is a signed record and can't be changed"); };

  async function staffUnpublish(store, staff, id) {
    const d = await staffDoc(store, id);
    lockedCheck(d);
    const u = await store.update("documents", d.id, { published: false, status: "draft", updatedAt: iso(now()) }, d.rev);
    await ev(store, { type: "document.unpublished", source: "staff", actor: staff.name, clientKey: d.clientKey, recordId: d.id });
    return forStaff(u);
  }

  async function staffArchive(store, staff, id) {
    const d = await staffDoc(store, id);
    const u = await store.update("documents", d.id, { status: "archived", archivedAt: iso(now()), updatedAt: iso(now()) }, d.rev);
    await ev(store, { type: "document.archived", source: "staff", actor: staff.name, clientKey: d.clientKey, recordId: d.id });
    return forStaff(u);
  }

  async function staffNewVersion(store, staff, id, { content, fileName, notify }, portalUrl = "") {
    const d = await staffDoc(store, id);
    lockedCheck(d);
    if (d.origin !== "practice") throw new DocError(400, "not-practice", "Only documents from the practice can be replaced here");
    const v = await storeVersion(store, d, current(d).n + 1, { fileName, content }, { source: "staff", actor: staff.name, name: staff.name });
    const u = await store.update("documents", d.id, { versions: [...d.versions, v], updatedAt: iso(now()), approval: null, status: d.published ? (d.requiresApproval ? "awaiting-approval" : "published") : "draft" }, d.rev);
    await ev(store, { type: "document.version-added", source: "staff", actor: staff.name, clientKey: d.clientKey, recordId: d.id, meta: { version: v.n, fileName: v.fileName, sha256: v.sha256 } });
    if (u.published && notify) await notifyPublished(store, u, portalUrl);
    return forStaff(u);
  }

  async function staffEdit(store, staff, id, { title, category, assignedTo, internalNote }) {
    const d = await staffDoc(store, id);
    if (d.locked && (assignedTo !== undefined || title !== undefined)) lockedCheck(d);
    const patch = { updatedAt: iso(now()) };
    if (title !== undefined) patch.title = text(title, 120) || d.title;
    if (category !== undefined && CATEGORIES.includes(category)) patch.category = category;
    if (assignedTo !== undefined) patch.assignedTo = await validAssignees(store, d.clientKey, assignedTo);
    if (internalNote !== undefined) patch.internalNote = text(internalNote, 500);
    const u = await store.update("documents", d.id, patch, d.rev);
    await ev(store, { type: "document.edited", source: "staff", actor: staff.name, clientKey: d.clientKey, recordId: d.id, meta: { fields: Object.keys(patch).filter((k) => k !== "updatedAt") } });
    return forStaff(u);
  }

  async function staffDownload(store, staff, id, n) {
    const d = await staffDoc(store, id);
    return download(store, null, null, d.id, n, { source: "staff", staff: { name: staff.name, clientKey: d.clientKey } });
  }

  async function attention(store, reader) {
    const clients = new Map((await reader.clients()).map((c) => [c.Key, c]));
    return (await store.list("documents")).filter((d) => d.origin === "client" && !d.seenByStaff && d.status !== "archived").map((d) => ({ kind: "document", at: d.updatedAt, text: `${d.uploadedByName} uploaded "${d.title}" for ${clients.get(d.clientKey)?.Title || d.clientKey}.`, link: `#/clients/${encodeURIComponent(d.clientKey)}`, clientKey: d.clientKey, id: d.id }));
  }

  async function markSeen(store, staff, id) {
    const d = await staffDoc(store, id);
    if (d.seenByStaff && d.seenVersion === current(d).n) return forStaff(d);
    const u = await store.update("documents", d.id, { seenByStaff: true, seenVersion: current(d).n }, d.rev);
    return forStaff(u);
  }

  /** The stored bytes of one version, for server-side use (signing). No audit: the caller records its own event. */
  async function readVersion(store, id, n) {
    const d = await store.get("documents", text(id, 60));
    if (!d) throw new DocError(404, "not-found", "Not found");
    const v = d.versions.find((x) => x.n === Number(n || current(d).n));
    const bytes = v && (await files.get(v.path));
    if (!bytes) throw new DocError(404, "missing-file", "That file can't be found");
    return { doc: d, version: v, bytes };
  }

  /** A document the server made itself (a signed copy, a certificate). Published, assigned, and locked against edits. */
  async function addGenerated(store, { clientKey, title, category = "Letters and agreements", fileName, bytes, assignedTo = [], note = "" }) {
    const id = newId("doc-");
    const v = await storeVersion(store, { id, clientKey }, 1, { fileName, content: Buffer.from(bytes).toString("base64") }, { source: "system", actor: "XProFlow", name: practiceName });
    const t = iso(now());
    const d = await store.insert("documents", { id, clientKey, title: text(title, 120), category, origin: "practice", published: true, publishedAt: t, status: "published", createdAt: t, updatedAt: t, uploadedByName: practiceName, assignedTo, message: text(note, 500), internalNote: "", versions: [v], requiresApproval: false, locked: true, generated: true });
    await ev(store, { type: "document.generated", source: "system", actor: "XProFlow", clientKey, recordId: id, meta: { fileName: v.fileName, sha256: v.sha256 } });
    return d;
  }

  return { readVersion, addGenerated, listForClient, download, upload, approve, staffList, staffAdd, staffPublish, staffUnpublish, staffArchive, staffNewVersion, staffEdit, staffDownload, attention, markSeen, CATEGORIES, DocError };
}

module.exports = { createDocuments, DocError, CATEGORIES };
