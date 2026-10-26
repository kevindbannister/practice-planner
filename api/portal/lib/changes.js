// Client-requested changes to business details. The client proposes; nothing is overwritten until a
// member of staff has seen the old and proposed values side by side and approved each change. The
// whole conversation (request, questions, answers, decisions) is kept and audited.
//
// Approving a change updates the client's record in the planner. It does NOT file anything with
// Companies House or HMRC: items that need a statutory filing say so, to staff and to the client.

const { newId } = require("./store.js");
const { BY_KEY, cleanValue, meta } = require("./editable.js");

class ChangeError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const OPEN = ["pending", "clarification"];
const iso = (ms) => new Date(ms).toISOString();
const text = (v, max = 1000) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max);

function createChanges({ audit, mailer, now = () => Date.now(), practiceName = "Your accountant", notifyEmail = "" }) {
  const ev = (store, e) => audit.record(store, e);
  const safeSend = async (m) => { try { await mailer.send(m); return true; } catch { return false; } };

  /** What the client sees of a request. Never anything staff wrote only for themselves (none is stored). */
  const forClient = (c) => ({ id: c.id, clientKey: c.clientKey, createdAt: c.createdAt, status: c.status, outcome: c.outcome || "", decidedAt: c.decidedAt || "", requestedByName: c.requestedByName, note: c.note || "",
    items: c.items.map((i) => ({ key: i.key, label: i.label, old: i.old, new: i.new, decision: i.decision, note: i.note || "", statutory: i.statutory || "" })), thread: c.thread });

  async function create(store, reader, user, access, { items, note }) {
    const row = (await reader.clients()).find((c) => c.Key === access.clientKey);
    if (!row) throw new ChangeError(404, "not-found", "Not found");
    const open = await store.find("changes", (c) => c.clientKey === access.clientKey && OPEN.includes(c.status));
    const made = [];
    for (const it of Array.isArray(items) ? items.slice(0, 20) : []) {
      const f = BY_KEY[String(it && it.key)];
      if (!f) throw new ChangeError(400, "bad-field", "That isn't something that can be changed here");
      if (made.some((m) => m.key === f.key)) continue;
      const cleaned = cleanValue(f, it.value);
      if (!cleaned.ok) throw new ChangeError(400, "bad-value", cleaned.error);
      const old = f.column ? String(row[f.column] ?? "").trim() : "";
      if (f.column && cleaned.value === old) continue; // nothing actually changes
      if (!cleaned.value && !f.column) continue;
      if (open.some((c) => c.items.some((x) => x.key === f.key && !x.decision))) throw new ChangeError(409, "already-waiting", `A change to "${f.label}" is already waiting for ${practiceName} to look at`);
      made.push({ key: f.key, label: f.label, old, new: cleaned.value, statutory: f.statutory || "", noted: !f.column, decision: "", note: "" });
    }
    if (!made.length) throw new ChangeError(400, "no-change", "Nothing has changed from what we already hold");
    const t = iso(now());
    const c = await store.insert("changes", { id: newId("chg-"), clientKey: access.clientKey, requestedBy: user.id, requestedByName: user.name || user.email, requestedByEmail: user.email, createdAt: t, status: "pending", items: made, note: text(note, 500), thread: [], outcome: "" });
    await ev(store, { type: "change.requested", source: "portal", userId: user.id, actor: user.email, clientKey: access.clientKey, recordId: c.id, meta: { fields: made.map((m) => m.key) } });
    if (notifyEmail) await safeSend({ to: notifyEmail, subject: `Portal: change requested for ${row.Title}`, text: `${c.requestedByName} has asked to change: ${made.map((m) => m.label).join(", ")}.\n\nReview it in xproflow under Portal › Changes.` });
    return forClient(c);
  }

  async function listForClient(store, clientKey) {
    return (await store.find("changes", (c) => c.clientKey === clientKey)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map(forClient);
  }

  async function mine(store, user, clientKey, id) {
    const c = await store.get("changes", id);
    if (!c || c.clientKey !== clientKey) throw new ChangeError(404, "not-found", "Not found");
    return c;
  }

  async function reply(store, user, clientKey, id, message) {
    const c = await mine(store, user, clientKey, id);
    if (c.status !== "clarification") throw new ChangeError(409, "not-asked", "There's no question waiting for an answer");
    const body = text(message, 1000);
    if (!body) throw new ChangeError(400, "empty", "Please write your answer");
    const u = await store.update("changes", c.id, { status: "pending", thread: [...c.thread, { at: iso(now()), from: "client", name: user.name || user.email, text: body }] }, c.rev);
    await ev(store, { type: "change.client-replied", source: "portal", userId: user.id, actor: user.email, clientKey, recordId: c.id });
    return forClient(u);
  }

  async function cancel(store, user, clientKey, id) {
    const c = await mine(store, user, clientKey, id);
    if (!OPEN.includes(c.status)) throw new ChangeError(409, "closed", "That request has already been dealt with");
    const u = await store.update("changes", c.id, { status: "decided", outcome: "withdrawn", decidedAt: iso(now()), decidedBy: user.email, items: c.items.map((i) => ({ ...i, decision: i.decision || "withdrawn" })) }, c.rev);
    await ev(store, { type: "change.withdrawn", source: "portal", userId: user.id, actor: user.email, clientKey, recordId: c.id });
    return forClient(u);
  }

  // ------------------------------------------------------------ staff

  async function staffList(store, reader, { status } = {}) {
    const clients = new Map((await reader.clients()).map((c) => [c.Key, c]));
    const all = (await store.list("changes")).filter((c) => !status || (status === "open" ? OPEN.includes(c.status) : c.status === status));
    return all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map((c) => {
      const row = clients.get(c.clientKey) || {};
      return { ...forClient(c), clientName: String(row.Title || c.clientKey), requestedByEmail: c.requestedByEmail,
        // what the record says now, in case it changed since the request was made
        items: c.items.map((i) => ({ ...forClient(c).items.find((x) => x.key === i.key), noted: i.noted, current: BY_KEY[i.key]?.column ? String(row[BY_KEY[i.key].column] ?? "").trim() : "" })) };
    });
  }

  async function ask(store, staff, id, message) {
    const c = await store.get("changes", id);
    if (!c) throw new ChangeError(404, "not-found", "Not found");
    if (!OPEN.includes(c.status)) throw new ChangeError(409, "closed", "That request has already been dealt with");
    const body = text(message, 1000);
    if (!body) throw new ChangeError(400, "empty", "Write your question first");
    const u = await store.update("changes", c.id, { status: "clarification", thread: [...c.thread, { at: iso(now()), from: "staff", name: staff, text: body }] }, c.rev);
    await ev(store, { type: "change.clarification-asked", source: "staff", actor: staff, userId: c.requestedBy, clientKey: c.clientKey, recordId: c.id });
    await safeSend({ to: c.requestedByEmail, subject: `${practiceName}: a question about your requested changes`, text: `We have a question about the changes you asked for:\n\n${body}\n\nPlease sign in to the portal to answer.\n\n${practiceName}` });
    return { ok: true, status: u.status };
  }

  /** decisions: [{ key, decision: "approved" | "rejected", note }]. Every open item must get one. */
  async function decide(store, reader, staff, id, decisions) {
    const c = await store.get("changes", id);
    if (!c) throw new ChangeError(404, "not-found", "Not found");
    if (!OPEN.includes(c.status)) throw new ChangeError(409, "closed", "That request has already been dealt with");
    const byKey = new Map((Array.isArray(decisions) ? decisions : []).map((d) => [String(d.key), d]));
    const items = c.items.map((i) => {
      const d = byKey.get(i.key);
      if (!d || !["approved", "rejected"].includes(d.decision)) throw new ChangeError(400, "undecided", `Choose approve or reject for "${i.label}"`);
      return { ...i, decision: d.decision, note: text(d.note, 300) };
    });
    // Apply the approved record changes first: if the planner can't be updated, nothing is marked decided.
    const patch = {};
    for (const i of items) if (i.decision === "approved" && !i.noted) patch[BY_KEY[i.key].column] = i.new;
    if (Object.keys(patch).length) await reader.updateClient(c.clientKey, patch);
    const approved = items.filter((i) => i.decision === "approved").length;
    const outcome = approved === items.length ? "approved" : approved === 0 ? "rejected" : "partly approved";
    const u = await store.update("changes", c.id, { status: "decided", outcome, items, decidedAt: iso(now()), decidedBy: staff }, c.rev);
    for (const i of items) {
      await ev(store, { type: i.decision === "approved" ? "change.approved" : "change.rejected", source: "staff", actor: staff, userId: c.requestedBy, clientKey: c.clientKey, recordId: c.id, meta: { field: i.key } });
    }
    if (Object.keys(patch).length) await ev(store, { type: "change.applied", source: "staff", actor: staff, clientKey: c.clientKey, recordId: c.id, meta: { columns: Object.keys(patch) } });
    const filing = items.filter((i) => i.decision === "approved" && i.statutory);
    const lines = items.map((i) => `• ${i.label}: ${i.decision === "approved" ? "approved" : "not approved"}${i.note ? ` (${i.note})` : ""}`).join("\n");
    await safeSend({
      to: c.requestedByEmail, subject: `${practiceName}: your requested changes`,
      text: `We've looked at the changes you asked for:\n\n${lines}\n\n${filing.length ? `Some of these (${filing.map((i) => i.label).join(", ")}) also need to be filed with ${[...new Set(filing.map((i) => i.statutory))].join(" and ")}. Approving them here updates our records only; it doesn't change anything at ${[...new Set(filing.map((i) => i.statutory))].join(" or ")}. We'll be in touch about that.\n\n` : ""}${practiceName}`,
    });
    return { ok: true, outcome, applied: Object.keys(patch), statutory: filing.map((i) => ({ field: i.label, body: i.statutory })), request: forClient(u) };
  }

  async function attention(store, reader) {
    const clients = new Map((await reader.clients()).map((c) => [c.Key, c]));
    const open = (await store.list("changes")).filter((c) => c.status === "pending");
    return open.map((c) => ({ kind: "change", at: c.createdAt, text: `${c.requestedByName} asked to change ${c.items.map((i) => i.label.toLowerCase()).join(", ")} for ${clients.get(c.clientKey)?.Title || c.clientKey}.`, link: "#/portal/changes", clientKey: c.clientKey }));
  }

  return { create, listForClient, reply, cancel, staffList, ask, decide, attention, meta, ChangeError };
}

module.exports = { createChanges, ChangeError };
