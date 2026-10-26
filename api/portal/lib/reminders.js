// The central reminder engine. One place decides who gets nudged about what, how often, and when to
// stop, for: documents waiting to be signed, information requests nobody has answered, documents
// waiting for approval, and questions the practice asked that haven't been answered. (Identity
// renewals keep their own dated schedule, which this engine runs and reports.)
//
// Principles:
//  - Each reminder kind has a policy: first reminder after N days, then every N days, up to a maximum.
//    The practice can change these; the defaults are deliberately gentle.
//  - Several things due for the same person at the same time go out as ONE email, and nothing is sent
//    outside 07:00-19:00 UK time.
//  - Any single reminder can be paused, cancelled or rescheduled; everything can be paused at once.
//  - Reminders stop by themselves when the thing is done. Every one sent is recorded in the audit trail
//    and against the item.
//  - Emails say there is something waiting. They never name a document or carry its contents.
//  - "Run now" on the staff screen ignores the sending hours (someone chose to run it) but never a pause.
//  - Running it more often than needed is harmless: it only acts on what is due.

const { newId } = require("./store.js");
const { canSee } = require("./rules.js");

const DAY = 24 * 3600 * 1000;
const iso = (ms) => new Date(ms).toISOString();

const KINDS = {
  signing: { label: "Documents waiting to be signed", what: "a document to sign", defaults: { enabled: true, firstAfterDays: 3, repeatEveryDays: 3, max: 5 } },
  request: { label: "Information requests", what: "a request for information", defaults: { enabled: true, firstAfterDays: 3, repeatEveryDays: 5, max: 4 } },
  approval: { label: "Documents waiting for approval", what: "a document to approve", defaults: { enabled: true, firstAfterDays: 3, repeatEveryDays: 5, max: 4 } },
  change: { label: "Questions we asked about requested changes", what: "a question about your requested changes", defaults: { enabled: true, firstAfterDays: 3, repeatEveryDays: 5, max: 3 } },
};
const clamp = (n, lo, hi, d) => (Number.isFinite(Number(n)) ? Math.min(Math.max(Math.round(Number(n)), lo), hi) : d);

/** Is it between 07:00 and 19:00 in the UK right now? */
function inSendingHours(ms) {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Europe/London" }).format(new Date(ms)));
  return h >= 7 && h < 19;
}

class ReminderError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function createReminders({ audit, mailer, now = () => Date.now(), practiceName = "Your accountant", portalUrl = "", signing, requests, identity, changes }) {
  const ev = (store, e) => audit.record(store, e);
  const safeSend = async (m) => { try { await mailer.send(m); return true; } catch { return false; } };

  async function settings(store) {
    const s = (await store.get("reminders", "settings")) || { id: "settings", paused: false, quiet: true, kinds: {}, lastSweepAt: "", lastResult: null };
    const kinds = {};
    for (const [k, def] of Object.entries(KINDS)) kinds[k] = { ...def.defaults, ...(s.kinds && s.kinds[k]) };
    return { ...s, kinds };
  }
  async function saveSettings(store, patch) {
    const cur = (await store.get("reminders", "settings")) || null;
    if (!cur) return store.insert("reminders", { id: "settings", paused: false, quiet: true, kinds: {}, lastSweepAt: "", lastResult: null, ...patch });
    return store.update("reminders", "settings", patch, cur.rev);
  }

  /** What is outstanding, per kind: { itemId, clientKey, title, since, recipients[] }. */
  async function collect(store) {
    const out = { signing: await signing.waiting(store) };
    out.request = [];
    for (const r of await requests.outstanding(store)) {
      const last = [...r.thread].reverse().find((t) => t.from === "staff");
      out.request.push({ itemId: r.id, clientKey: r.clientKey, title: r.title, since: last ? last.at : r.createdAt, due: r.dueDate || "", recipients: (await requests.recipients(store, r)).map((u) => ({ userId: u.id, email: u.email, name: u.name })) });
    }
    out.approval = [];
    const users = new Map((await store.list("users")).map((u) => [u.id, u]));
    for (const d of await store.list("documents")) {
      if (d.status !== "awaiting-approval" || !d.published) continue;
      const access = await store.find("access", (a) => a.clientKey === d.clientKey && a.status === "active");
      out.approval.push({ itemId: d.id, clientKey: d.clientKey, title: d.title, since: d.updatedAt, recipients: access.filter((a) => canSee(a, "documents.approve", a.userId, d)).map((a) => users.get(a.userId)).filter((u) => u && u.status === "active" && u.email).map((u) => ({ userId: u.id, email: u.email, name: u.name })) });
    }
    out.change = [];
    for (const c of await store.list("changes")) {
      if (c.status !== "clarification") continue;
      const last = [...c.thread].reverse().find((t) => t.from === "staff");
      const u = users.get(c.requestedBy);
      if (last && u && u.status === "active") out.change.push({ itemId: c.id, clientKey: c.clientKey, title: "Requested changes", since: last.at, recipients: [{ userId: u.id, email: u.email, name: u.name }] });
    }
    return out;
  }

  const keyOf = (kind, id) => `${kind}:${id}`;
  /** When the next reminder for this item is due (ms), or null if none will be. */
  function nextDue(item, policy, st, global) {
    if (global || !policy.enabled || (st && (st.cancelled || st.paused))) return null;
    const sent = (st && st.sent) || [];
    if (policy.max && sent.length >= policy.max) return null;
    if (st && st.nextAt) return Date.parse(st.nextAt);
    return sent.length === 0 ? Date.parse(item.since) + policy.firstAfterDays * DAY : Date.parse(sent[sent.length - 1].at) + policy.repeatEveryDays * DAY;
  }

  async function states(store) {
    return new Map((await store.find("reminders", (x) => x.id !== "settings")).map((x) => [x.id, x]));
  }

  /** Run everything that is due. Returns what was done. */
  async function sweep(store, reader, { force = false } = {}) {
    const cfg = await settings(store);
    const t = now();
    const result = { sent: 0, items: 0, people: 0, skipped: "", identity: { requested: 0, reminded: 0 } };
    if (cfg.paused) result.skipped = "paused";
    else if (cfg.quiet && !inSendingHours(t) && !force) result.skipped = "outside sending hours";
    else {
      const due = new Map(); // email -> { name, kinds: Set, items: [] }
      const all = await collect(store);
      const st = await states(store);
      for (const [kind, items] of Object.entries(all)) {
        for (const item of items) {
          const key = keyOf(kind, item.itemId);
          const s = st.get(key);
          const when = nextDue(item, cfg.kinds[kind], s, false);
          if (when === null || when > t || !item.recipients.length) continue;
          for (const r of item.recipients) {
            const e = due.get(r.email) || { name: r.name, userId: r.userId, kinds: new Set(), items: [] };
            e.kinds.add(kind);
            e.items.push({ kind, key, item });
            due.set(r.email, e);
          }
        }
      }
      const marked = new Set();
      for (const [email, e] of due) {
        const lines = [...e.kinds].map((k) => `- ${KINDS[k].what}`).join("\n");
        const ok = await safeSend({ to: email, subject: `${practiceName}: ${e.items.length === 1 ? "a reminder" : "reminders"}, something is waiting for you`, text: `Hello ${e.name || ""},\n\nThis is a friendly reminder. In your secure portal you have:\n\n${lines}\n\nSign in to deal with ${e.items.length === 1 ? "it" : "them"}${portalUrl ? `: ${portalUrl}` : "."}\n\n${practiceName}\n` });
        if (!ok) continue;
        result.people++;
        for (const x of e.items) marked.add(x.key + "|" + x.kind + "|" + x.item.itemId + "|" + x.item.clientKey);
      }
      // Record each item once, however many people were emailed about it.
      for (const m of marked) {
        const [key, kind, itemId, clientKey] = m.split("|");
        const cur = st.get(key);
        const sent = [...((cur && cur.sent) || []), { at: iso(t) }];
        if (cur) await store.update("reminders", key, { sent, nextAt: "" }, cur.rev);
        else await store.insert("reminders", { id: key, kind, itemId, clientKey, paused: false, cancelled: false, sent, nextAt: "" });
        await ev(store, { type: "reminder.sent", source: "system", actor: practiceName, clientKey, recordId: itemId, meta: { kind, number: sent.length } });
        result.sent++;
      }
      result.items = marked.size;
      result.identity = await identity.sweep(store, reader);
    }
    await saveSettings(store, { lastSweepAt: iso(t), lastResult: result });
    if (result.sent || result.identity.requested || result.identity.reminded) await ev(store, { type: "reminder.sweep", source: "system", actor: practiceName, meta: { sent: result.sent, people: result.people, identityRequested: result.identity.requested, identityReminded: result.identity.reminded } });
    return result;
  }

  // ---------------------------------------------------------------- staff
  async function overview(store, reader) {
    const cfg = await settings(store);
    const clients = new Map((await reader.clients()).map((c) => [c.Key, c]));
    const st = await states(store);
    const items = [];
    for (const [kind, list] of Object.entries(await collect(store))) {
      for (const item of list) {
        const key = keyOf(kind, item.itemId);
        const s = st.get(key);
        const when = nextDue(item, cfg.kinds[kind], s, cfg.paused);
        items.push({ key, kind, kindLabel: KINDS[kind].label, title: item.title, clientKey: item.clientKey, client: (clients.get(item.clientKey) || {}).Title || item.clientKey, since: item.since, recipients: item.recipients.map((r) => r.name || r.email), sentCount: ((s && s.sent) || []).length, lastSentAt: s && s.sent && s.sent.length ? s.sent[s.sent.length - 1].at : "",
          nextDue: when === null ? "" : iso(when), paused: Boolean(s && s.paused), cancelled: Boolean(s && s.cancelled), exhausted: Boolean(cfg.kinds[kind].max && ((s && s.sent) || []).length >= cfg.kinds[kind].max) });
      }
    }
    items.sort((a, b) => (a.nextDue || "9") < (b.nextDue || "9") ? -1 : 1);
    return { paused: cfg.paused, quiet: cfg.quiet, kinds: Object.fromEntries(Object.entries(KINDS).map(([k, d]) => [k, { label: d.label, ...cfg.kinds[k] }])), lastSweepAt: cfg.lastSweepAt, lastResult: cfg.lastResult, items, identityNote: "Identity renewals run on their own schedule (set when you ask for the document) and are run by this engine." };
  }

  async function updateSettings(store, staff, { paused, quiet, kinds }) {
    const cur = await settings(store);
    const patch = {};
    if (paused !== undefined) patch.paused = Boolean(paused);
    if (quiet !== undefined) patch.quiet = Boolean(quiet);
    if (kinds && typeof kinds === "object") {
      patch.kinds = { ...((await store.get("reminders", "settings")) || {}).kinds };
      for (const [k, v] of Object.entries(kinds)) {
        if (!KINDS[k] || !v) continue;
        patch.kinds[k] = { enabled: v.enabled !== undefined ? Boolean(v.enabled) : cur.kinds[k].enabled, firstAfterDays: clamp(v.firstAfterDays, 1, 90, cur.kinds[k].firstAfterDays), repeatEveryDays: clamp(v.repeatEveryDays, 1, 90, cur.kinds[k].repeatEveryDays), max: clamp(v.max, 1, 20, cur.kinds[k].max) };
      }
    }
    await saveSettings(store, patch);
    await ev(store, { type: "reminder.settings", source: "staff", actor: staff.name, meta: { paused: patch.paused, quiet: patch.quiet, kinds: patch.kinds ? Object.keys(kinds) : undefined } });
    return settings(store);
  }

  /** Pause, resume, cancel or reschedule the reminders for one item. */
  async function setItem(store, staff, key, { paused, cancelled, nextAt }) {
    const [kind, ...rest] = String(key || "").split(":");
    const itemId = rest.join(":");
    if (!KINDS[kind] || !itemId) throw new ReminderError(400, "bad-key", "That reminder isn't recognised");
    const open = (await collect(store))[kind].find((i) => i.itemId === itemId);
    if (!open) throw new ReminderError(404, "not-found", "That item isn't waiting any more");
    const cur = (await store.get("reminders", key)) || (await store.insert("reminders", { id: key, kind, itemId, clientKey: open.clientKey, paused: false, cancelled: false, sent: [], nextAt: "" }));
    const patch = {};
    if (paused !== undefined) patch.paused = Boolean(paused);
    if (cancelled !== undefined) patch.cancelled = Boolean(cancelled);
    if (nextAt !== undefined) {
      if (nextAt && (Number.isNaN(Date.parse(nextAt)) || Date.parse(nextAt) < now() - DAY)) throw new ReminderError(400, "bad-date", "Choose a date in the future");
      patch.nextAt = nextAt ? iso(Date.parse(nextAt)) : "";
    }
    await store.update("reminders", key, patch, cur.rev);
    const what = patch.cancelled ? "cancelled" : patch.paused === true ? "paused" : patch.paused === false ? "resumed" : "rescheduled";
    await ev(store, { type: `reminder.${what}`, source: "staff", actor: staff.name, clientKey: open.clientKey, recordId: itemId, meta: { kind, ...(patch.nextAt ? { next: patch.nextAt } : {}) } });
    return { ok: true };
  }

  return { sweep, overview, updateSettings, setItem, settings, KINDS, ReminderError };
}

module.exports = { createReminders, ReminderError, KINDS, inSendingHours };
