// Secure messaging between the practice and a business's portal users.
//
// A conversation ("thread") belongs to one business. Administrators and standard users see all of the
// business's conversations (the same rule as documents and requests); restricted users see only the
// conversations they are named in, and conversations they start are private to them and the practice.
// Signatories have no messages. Anyone outside the business gets the same "not found" as for a
// conversation that doesn't exist.
//
// There is nowhere in a thread to put a staff-only note, so none can be shown. Attachments are real
// documents in the document centre (same type/size/content checks), listed here by title only.
// Emails and notifications say that a message is waiting, never what it says.
//
// Storage: one collection, `messages`, holding thread records (kind "thread") and message records
// (kind "message", with threadId).

const { newId } = require("./store.js");
const { canSee } = require("./rules.js");

class MessageError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const iso = (ms) => new Date(ms).toISOString();
const text = (v, max = 1000) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max);

function createMessages({ audit, mailer, notices, now = () => Date.now(), practiceName = "Your accountant", notifyEmail = "", portalUrl = "" }) {
  const ev = (store, e) => audit.record(store, e);
  const safeSend = async (m) => { try { await mailer.send(m); return true; } catch { return false; } };

  const threadView = (t, extra = {}) => ({ id: t.id, subject: t.subject, createdAt: t.createdAt, lastAt: t.lastAt, lastFrom: t.lastFrom, preview: t.preview || "", started: t.createdBy.side, startedBy: t.createdBy.name, count: t.count || 0, ...extra });
  const msgView = (m) => ({ id: m.id, at: m.at, from: m.from, name: m.name, text: m.text, docs: m.docs || [] });
  // Unread is counted in messages, not timestamps, so two messages in the same instant can't hide each other.
  const isUnreadForClient = (t, userId) => t.lastBy !== userId && (t.count || 0) > (t.readBy?.[userId] || 0);
  const isUnreadForStaff = (t) => t.lastFrom === "client" && (t.count || 0) > (t.staffRead || 0);

  const threads = (store, clientKey) => store.find("messages", (m) => m.kind === "thread" && (!clientKey || m.clientKey === clientKey));
  const messagesOf = async (store, id) => (await store.find("messages", (m) => m.kind === "message" && m.threadId === id)).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  async function mine(store, access, user, id) {
    const t = await store.get("messages", text(id, 60));
    if (!t || t.kind !== "thread" || t.clientKey !== access.clientKey || !canSee(access, "messages.use", user.id, t)) throw new MessageError(404, "not-found", "Not found");
    return t;
  }

  async function add(store, t, { from, userId = "", name, words, docs }) {
    const at = iso(now());
    const m = await store.insert("messages", { id: newId("ms-"), kind: "message", threadId: t.id, clientKey: t.clientKey, at, from, userId, name, text: words, docs });
    const count = (t.count || 0) + 1;
    const patch = { lastAt: at, lastFrom: from, lastBy: userId, preview: words.slice(0, 80), count };
    if (from === "client") patch.readBy = { ...(t.readBy || {}), [userId]: count };
    else patch.staffRead = count;
    const u = await store.update("messages", t.id, patch, t.rev);
    return { thread: u, message: m };
  }

  async function attachAll(files, attach, t) {
    const list = Array.isArray(files) ? files.slice(0, 5) : [];
    const out = [];
    for (const f of list) {
      const d = await attach(f, t);
      out.push({ id: d.id, title: d.title });
    }
    return out;
  }

  // ---------------------------------------------------------------- the client side
  async function listForClient(store, access, user, { q = "" } = {}) {
    let all = (await threads(store, access.clientKey)).filter((t) => canSee(access, "messages.use", user.id, t));
    const needle = text(q, 80).toLowerCase();
    if (needle) {
      const hit = new Set();
      for (const m of await store.find("messages", (x) => x.kind === "message" && x.clientKey === access.clientKey && String(x.text).toLowerCase().includes(needle))) hit.add(m.threadId);
      all = all.filter((t) => hit.has(t.id) || t.subject.toLowerCase().includes(needle));
    }
    all.sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
    return { threads: all.map((t) => threadView(t, { unread: isUnreadForClient(t, user.id) })), unread: all.filter((t) => isUnreadForClient(t, user.id)).length };
  }

  /** Opening a conversation marks it read for this person only. */
  async function open(store, access, user, id) {
    let t = await mine(store, access, user, id);
    if (isUnreadForClient(t, user.id)) t = await store.update("messages", t.id, { readBy: { ...(t.readBy || {}), [user.id]: t.count } }, t.rev);
    return { thread: threadView(t, { unread: false }), messages: (await messagesOf(store, t.id)).map(msgView) };
  }

  async function start(store, access, user, { subject, text: body, files }, attach) {
    const words = text(body, 4000);
    const subj = text(subject, 120);
    if (!subj) throw new MessageError(400, "subject", "Give your message a subject");
    const list = Array.isArray(files) ? files : [];
    if (!words && !list.length) throw new MessageError(400, "empty", "Write a message first");
    const at = iso(now());
    // A restricted person's conversation is theirs (and the practice's); anyone else's is for the business.
    const t = await store.insert("messages", { id: newId("th-"), kind: "thread", clientKey: access.clientKey, subject: subj, assignedTo: access.level === "restricted" ? [user.id] : [], createdAt: at, createdBy: { side: "client", userId: user.id, name: user.name || user.email }, lastAt: at, lastFrom: "client", lastBy: user.id, preview: "", count: 0, readBy: {}, staffRead: 0 });
    const docs = await attachAll(list, attach, t);
    const r = await add(store, t, { from: "client", userId: user.id, name: user.name || user.email, words: words || "(attachment)", docs });
    await ev(store, { type: "message.thread-started", source: "portal", userId: user.id, actor: user.email, clientKey: t.clientKey, recordId: t.id, meta: { files: docs.length } });
    await tellStaff(user);
    await tellColleagues(store, r.thread, user);
    return { thread: threadView(r.thread, { unread: false }), messages: [msgView(r.message)] };
  }

  async function replyClient(store, access, user, id, { text: body, files }, attach) {
    const t = await mine(store, access, user, id);
    const words = text(body, 4000);
    const list = Array.isArray(files) ? files : [];
    if (!words && !list.length) throw new MessageError(400, "empty", "Write a message first");
    const docs = await attachAll(list, attach, t);
    const r = await add(store, t, { from: "client", userId: user.id, name: user.name || user.email, words: words || "(attachment)", docs });
    await ev(store, { type: "message.sent", source: "portal", userId: user.id, actor: user.email, clientKey: t.clientKey, recordId: t.id, meta: { files: docs.length, chars: words.length } });
    await tellStaff(user);
    await tellColleagues(store, r.thread, user);
    return { thread: threadView(r.thread, { unread: false }), messages: (await messagesOf(store, t.id)).map(msgView) };
  }
  /** Colleagues at the business are told in the portal (not by email) that someone else wrote. */
  async function tellColleagues(store, t, user) {
    for (const u of await recipients(store, t)) if (u.id !== user.id) await notices.create(store, { userId: u.id, clientKey: t.clientKey, text: "A colleague sent a message", link: "messages" });
  }
  const tellStaff = (user) => (notifyEmail ? safeSend({ to: notifyEmail, subject: "Portal: a client sent a message", text: `${user.name || user.email} sent a message.\n\nRead and reply in xproflow under the client's Portal tab.` }) : null);

  // ---------------------------------------------------------------- the practice side
  async function recipients(store, t) {
    const access = await store.find("access", (a) => a.clientKey === t.clientKey && a.status === "active");
    const users = new Map((await store.list("users")).map((u) => [u.id, u]));
    return access.filter((a) => canSee(a, "messages.use", a.userId, t)).map((a) => users.get(a.userId)).filter((u) => u && u.status === "active" && u.email);
  }
  async function tellClients(store, t) {
    let told = 0;
    for (const u of await recipients(store, t)) {
      await notices.create(store, { userId: u.id, clientKey: t.clientKey, text: `New message from ${practiceName}`, link: "messages" });
      if (await safeSend({ to: u.email, subject: `${practiceName}: you have a new message`, text: `Hello ${u.name || ""},\n\nYou have a new message in your secure portal${portalUrl ? `: ${portalUrl}` : "."}\n\nFor your security the message itself isn't included in this email.\n` })) told++;
    }
    return told;
  }
  async function validAssignees(store, clientKey, list) {
    const out = [];
    for (const uid of Array.isArray(list) ? list.slice(0, 50) : []) {
      const a = (await store.find("access", (x) => x.userId === uid && x.clientKey === clientKey && x.status === "active"))[0];
      if (!a) throw new MessageError(400, "bad-assignee", "That person doesn't have portal access to this business");
      out.push(uid);
    }
    return out;
  }

  async function staffList(store, { clientKey = "", q = "", unread = false } = {}) {
    let all = await threads(store, clientKey);
    const needle = text(q, 80).toLowerCase();
    if (needle) {
      const hit = new Set();
      for (const m of await store.find("messages", (x) => x.kind === "message" && (!clientKey || x.clientKey === clientKey) && String(x.text).toLowerCase().includes(needle))) hit.add(m.threadId);
      all = all.filter((t) => hit.has(t.id) || t.subject.toLowerCase().includes(needle));
    }
    if (unread) all = all.filter(isUnreadForStaff);
    const users = new Map((await store.list("users")).map((u) => [u.id, u.name || u.email]));
    all.sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
    return all.map((t) => ({ ...threadView(t, { unread: isUnreadForStaff(t) }), clientKey: t.clientKey, assignedTo: t.assignedTo || [], assignedNames: (t.assignedTo || []).map((u) => users.get(u) || u) }));
  }

  async function staffOpen(store, id) {
    let t = await store.get("messages", text(id, 60));
    if (!t || t.kind !== "thread") throw new MessageError(404, "not-found", "Not found");
    if (isUnreadForStaff(t)) t = await store.update("messages", t.id, { staffRead: t.count }, t.rev);
    return { thread: { ...threadView(t, { unread: false }), clientKey: t.clientKey, assignedTo: t.assignedTo || [] }, messages: (await messagesOf(store, t.id)).map(msgView) };
  }

  async function staffStart(store, staff, { clientKey, subject, text: body, assignedTo, notify, files }, attach) {
    const key = text(clientKey, 60);
    if (!key) throw new MessageError(400, "bad-client", "Choose a client");
    const subj = text(subject, 120);
    const words = text(body, 4000);
    if (!subj) throw new MessageError(400, "subject", "Give the message a subject");
    const list = Array.isArray(files) ? files : [];
    if (!words && !list.length) throw new MessageError(400, "empty", "Write a message first");
    const ids = await validAssignees(store, key, assignedTo);
    const at = iso(now());
    const docs = await attachAll(list, attach, { subject: subj, clientKey: key, assignedTo: ids });
    const t = await store.insert("messages", { id: newId("th-"), kind: "thread", clientKey: key, subject: subj, assignedTo: ids, createdAt: at, createdBy: { side: "staff", name: staff.name }, lastAt: at, lastFrom: "staff", lastBy: "", preview: "", count: 0, readBy: {}, staffRead: 0 });
    const r = await add(store, t, { from: "staff", name: staff.name, words: words || "(attachment)", docs });
    await ev(store, { type: "message.thread-started", source: "staff", actor: staff.name, clientKey: key, recordId: t.id, meta: { files: docs.length, assigned: ids.length } });
    const told = notify === false ? 0 : await tellClients(store, r.thread);
    return { thread: threadView(r.thread, { unread: false }), messages: [msgView(r.message)], told };
  }

  async function staffReply(store, staff, id, { text: body, notify, files }, attach) {
    const t = await store.get("messages", text(id, 60));
    if (!t || t.kind !== "thread") throw new MessageError(404, "not-found", "Not found");
    const words = text(body, 4000);
    const list = Array.isArray(files) ? files : [];
    if (!words && !list.length) throw new MessageError(400, "empty", "Write a message first");
    const docs = await attachAll(list, (f, th) => attach(f, th), t);
    const r = await add(store, t, { from: "staff", name: staff.name, words: words || "(attachment)", docs });
    await ev(store, { type: "message.sent", source: "staff", actor: staff.name, clientKey: t.clientKey, recordId: t.id, meta: { files: docs.length, chars: words.length } });
    const told = notify === false ? 0 : await tellClients(store, r.thread);
    return { thread: threadView(r.thread, { unread: false }), messages: (await messagesOf(store, t.id)).map(msgView), told };
  }

  /** Conversations waiting for the practice's reply, for the overview. */
  async function attention(store, reader) {
    const clients = new Map((await reader.clients()).map((c) => [c.Key, c]));
    return (await threads(store)).filter(isUnreadForStaff).map((t) => ({ kind: "message", at: t.lastAt, text: `New message from ${clients.get(t.clientKey)?.Title || t.clientKey}: "${t.subject}".`, link: `#/clients/${encodeURIComponent(t.clientKey)}/portal`, clientKey: t.clientKey }));
  }

  return { listForClient, open, start, replyClient, staffList, staffOpen, staffStart, staffReply, attention, MessageError };
}

module.exports = { createMessages, MessageError };
