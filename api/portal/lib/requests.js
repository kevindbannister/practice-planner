// Information requests. The practice asks a business for something (figures, a document, an answer);
// people at the business answer in writing and can attach files, which go into the document centre
// like any other upload. Each request is for one business, and may be limited to named people.
// Nothing here carries staff-only notes: there is nowhere to store them.

const { newId } = require("./store.js");
const { canSee } = require("./rules.js");

class RequestError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const iso = (ms) => new Date(ms).toISOString();
const text = (v, max = 1000) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;

function createRequests({ audit, mailer, docs, notices, now = () => Date.now(), practiceName = "Your accountant", notifyEmail = "", portalUrl = "" }) {
  const ev = (store, e) => audit.record(store, e);
  const safeSend = async (m) => { try { await mailer.send(m); return true; } catch { return false; } };

  const view = (r) => ({ id: r.id, title: r.title, details: r.details, dueDate: r.dueDate || "", status: r.status, createdAt: r.createdAt, assigned: Boolean(r.assignedTo && r.assignedTo.length), thread: r.thread.map((t) => ({ at: t.at, from: t.from, name: t.name, text: t.text, docs: t.docs || [] })), completedAt: r.completedAt || "" });
  const staffView = (r, names = new Map()) => ({ ...view(r), clientKey: r.clientKey, assignedTo: r.assignedTo || [], assignedNames: (r.assignedTo || []).map((u) => names.get(u) || u), createdByName: r.createdByName, lastReminderAt: r.lastReminderAt || "" });

  const visible = (access, user, r) => r.status !== "cancelled" && canSee(access, "requests.respond", user.id, r);

  async function listForClient(store, access, user) {
    return (await store.find("requests", (r) => r.clientKey === access.clientKey && visible(access, user, r))).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map(view);
  }
  async function mine(store, access, user, id) {
    const r = await store.get("requests", text(id, 60));
    if (!r || r.clientKey !== access.clientKey || !visible(access, user, r)) throw new RequestError(404, "not-found", "Not found");
    return r;
  }

  /** An answer from the client: some words and/or files. `attach` uploads each file through the document centre. */
  async function respond(store, access, user, id, { text: message, files = [] }, attach) {
    const r = await mine(store, access, user, id);
    if (r.status === "complete") throw new RequestError(409, "closed", "This request has been completed. Send us a message if there's more to add.");
    const words = text(message, 2000);
    const list = Array.isArray(files) ? files.slice(0, 5) : [];
    if (!words && !list.length) throw new RequestError(400, "empty", "Write an answer or attach a file");
    const attached = [];
    for (const f of list) {
      const d = await attach(f, r);
      attached.push({ id: d.id, title: d.title });
    }
    const t = iso(now());
    const u = await store.update("requests", r.id, { status: "responded", thread: [...r.thread, { at: t, from: "client", userId: user.id, name: user.name || user.email, text: words, docs: attached }], respondedAt: t }, r.rev);
    await ev(store, { type: "request.responded", source: "portal", userId: user.id, actor: user.email, clientKey: r.clientKey, recordId: r.id, meta: { files: attached.length } });
    if (notifyEmail) await safeSend({ to: notifyEmail, subject: "Portal: a client answered a request", text: `${user.name || user.email} answered "${r.title}".\n\nSee it in xproflow under the client's Portal tab.` });
    return view(u);
  }

  // ---------------------------------------------------------------- staff
  async function recipients(store, r) {
    const access = await store.find("access", (a) => a.clientKey === r.clientKey && a.status === "active");
    const users = new Map((await store.list("users")).map((u) => [u.id, u]));
    return access.filter((a) => canSee(a, "requests.respond", a.userId, r)).map((a) => users.get(a.userId)).filter((u) => u && u.status === "active" && u.email);
  }

  async function create(store, staff, { clientKey, title, details, dueDate, assignedTo, notify }) {
    const key = text(clientKey, 60);
    if (!key) throw new RequestError(400, "bad-client", "Choose a client");
    if (!text(title, 120)) throw new RequestError(400, "title", "Say what you need");
    if (dueDate && !isDate(dueDate)) throw new RequestError(400, "bad-date", "The due date should be a real date");
    const ids = [];
    for (const uid of Array.isArray(assignedTo) ? assignedTo.slice(0, 50) : []) {
      const a = (await store.find("access", (x) => x.userId === uid && x.clientKey === key && x.status === "active"))[0];
      if (!a) throw new RequestError(400, "bad-assignee", "That person doesn't have portal access to this business");
      ids.push(uid);
    }
    const t = iso(now());
    const r = await store.insert("requests", { id: newId("rq-"), clientKey: key, title: text(title, 120), details: text(details, 2000), dueDate: dueDate || "", assignedTo: ids, status: "open", createdAt: t, createdByName: staff.name, thread: [] });
    await ev(store, { type: "request.created", source: "staff", actor: staff.name, clientKey: key, recordId: r.id, meta: { assigned: ids.length, due: r.dueDate } });
    let told = 0;
    if (notify !== false) {
      for (const u of await recipients(store, r)) {
        await notices.create(store, { userId: u.id, clientKey: key, text: "We need some information from you", link: "requests" });
        if (await safeSend({ to: u.email, subject: `${practiceName}: we need some information from you`, text: `Hello ${u.name || ""},\n\n${practiceName} has asked for some information in your secure portal.\n\nSign in to see what is needed${portalUrl ? `: ${portalUrl}` : "."}\n` })) told++;
      }
    }
    return { ...staffView(r), told };
  }

  async function list(store, clientKey) {
    const users = new Map((await store.list("users")).map((u) => [u.id, u.name || u.email]));
    return (await store.find("requests", (r) => !clientKey || r.clientKey === clientKey)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map((r) => staffView(r, users));
  }
  const get = async (store, id) => {
    const r = await store.get("requests", text(id, 60));
    if (!r) throw new RequestError(404, "not-found", "Not found");
    return r;
  };

  /** Staff write back: ask for more (reopens it) or just add a note the client will see. */
  async function reply(store, staff, id, { text: message, reopen }) {
    const r = await get(store, id);
    if (r.status === "cancelled") throw new RequestError(409, "closed", "That request was cancelled");
    const words = text(message, 2000);
    if (!words) throw new RequestError(400, "empty", "Write your message first");
    const u = await store.update("requests", r.id, { status: reopen === false ? r.status : "open", thread: [...r.thread, { at: iso(now()), from: "staff", name: staff.name, text: words }] }, r.rev);
    await ev(store, { type: "request.staff-reply", source: "staff", actor: staff.name, clientKey: r.clientKey, recordId: r.id });
    for (const x of await recipients(store, u)) {
      await notices.create(store, { userId: x.id, clientKey: r.clientKey, text: "We've replied to a request", link: "requests" });
      await safeSend({ to: x.email, subject: `${practiceName}: an update on a request`, text: `Hello ${x.name || ""},\n\nThere's an update on one of your requests in your secure portal${portalUrl ? `: ${portalUrl}` : "."}\n` });
    }
    return staffView(u);
  }

  async function setStatus(store, staff, id, status) {
    const r = await get(store, id);
    const patch = status === "complete" ? { status, completedAt: iso(now()) } : { status };
    const u = await store.update("requests", r.id, patch, r.rev);
    await ev(store, { type: status === "complete" ? "request.completed" : "request.cancelled", source: "staff", actor: staff.name, clientKey: r.clientKey, recordId: r.id });
    return staffView(u);
  }

  /** Requests waiting on the practice (answered) for the overview. */
  async function attention(store, reader) {
    const clients = new Map((await reader.clients()).map((c) => [c.Key, c]));
    return (await store.list("requests")).filter((r) => r.status === "responded").map((r) => ({ kind: "request", at: r.respondedAt || r.createdAt, text: `${[...r.thread].reverse().find((t) => t.from === "client")?.name || "A client"} answered "${r.title}" for ${clients.get(r.clientKey)?.Title || r.clientKey}.`, link: `#/clients/${encodeURIComponent(r.clientKey)}/portal`, clientKey: r.clientKey }));
  }

  /** Open requests with no answer yet, for the reminder engine. */
  async function outstanding(store) {
    return (await store.list("requests")).filter((r) => r.status === "open");
  }

  return { listForClient, respond, create, list, reply, setStatus, attention, outstanding, recipients, RequestError };
}

module.exports = { createRequests, RequestError };
