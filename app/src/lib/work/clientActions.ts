// Client actions and meeting actions. A client action is an ordinary task whose owner is the client (or another outside party) and whose internal owner
// chases it. It can be shared with the client through the portal as an information request: the portal request carries the client's side (the words and
// files they send back), the task carries ours (status, verification, chasing, history). Nothing is sent to a client from here: every send is a plan the
// person confirms on screen. Nothing the client does can finish a task: only the practice's own check can.
import { Row } from "../schema";
import { WorkTask, isFinished, readTask } from "./model";

const s = (v: unknown) => (v == null ? "" : String(v).trim());
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`)) / 86400000);

// ---------------------------------------------------------------- history (append-only)
export type TaskEventType = "status" | "owner" | "responsible" | "shared" | "client-submitted" | "verified" | "corrections" | "reopened" | "chase-call" | "chase-email" | "chase-note" | "chase-portal" | "escalated" | "follow-up";
export type TaskEvent = { key: string; taskKey: string; type: TaskEventType; at: string; by: string; before: string; after: string; reason: string };
export const taskEventRow = (e: TaskEvent, practiceId = ""): Row => ({ Key: e.key, PracticeId: practiceId, TaskKey: e.taskKey, EventType: e.type, Created: e.at, CreatedBy: e.by, Before: e.before, After: e.after, Reason: e.reason });
export const readTaskEvent = (r: Row): TaskEvent => ({ key: s(r.Key), taskKey: s(r.TaskKey), type: s(r.EventType) as TaskEventType, at: s(r.Created), by: s(r.CreatedBy), before: s(r.Before), after: s(r.After), reason: s(r.Reason) });
export const historyOf = (events: Row[], taskKey: string): TaskEvent[] => events.map(readTaskEvent).filter((e) => e.taskKey === taskKey).sort((a, b) => b.at.localeCompare(a.at) || b.key.localeCompare(a.key));
export const EVENT_LABEL: Record<TaskEventType, string> = { status: "Status changed", owner: "Owner changed", responsible: "Responsible party changed", shared: "Shared with the client", "client-submitted": "Client submitted", verified: "Checked and accepted", corrections: "Corrections asked for", reopened: "Reopened", "chase-call": "Chased by phone", "chase-email": "Chased by email", "chase-note": "Note added", "chase-portal": "Reminder sent through the portal", escalated: "Escalated", "follow-up": "Follow-up date changed" };

type Ctx = { user: string; now: string; key: () => string };
const ev = (c: Ctx, taskKey: string, type: TaskEventType, before = "", after = "", reason = ""): TaskEvent => ({ key: c.key(), taskKey, type, at: c.now, by: c.user, before, after, reason });

/** The history entries a change produces. Called with the patch from lib/work/tasks `changeTask` and the row before it. */
export function eventsForChange(row: Row, patch: Row, c: Ctx): TaskEvent[] {
  const key = s(row.Key), out: TaskEvent[] = [];
  const diff = (col: string) => patch[col] !== undefined && s(patch[col]) !== s(row[col]);
  if (diff("Status")) out.push(ev(c, key, "status", s(row.Status), s(patch.Status)));
  if (diff("AssignedUser")) out.push(ev(c, key, "owner", s(row.AssignedUser), s(patch.AssignedUser)));
  if (diff("OwnerType") || diff("AssignedContact")) out.push(ev(c, key, "responsible", `${s(row.OwnerType) || "user"} ${s(row.AssignedContact)}`.trim(), `${s(patch.OwnerType ?? row.OwnerType) || "user"} ${s(patch.AssignedContact ?? row.AssignedContact)}`.trim()));
  if (diff("FollowUpDate")) out.push(ev(c, key, "follow-up", s(row.FollowUpDate).slice(0, 10), s(patch.FollowUpDate).slice(0, 10)));
  return out;
}

// ---------------------------------------------------------------- the portal link
export type PortalReq = { id: string; status: "open" | "responded" | "complete" | "cancelled"; thread: { at: string; from: "client" | "staff"; name?: string; text: string; docs?: { id: string; title: string }[] }[]; dueDate?: string };

/** The request to create in the portal for a client action. `people` are the portal users the client action is for (empty = everyone with access). The caller must show it and get a yes first. */
export function shareDraft(t: WorkTask, people: string[]): { clientKey: string; title: string; details: string; dueDate: string; assignedTo: string[] } | { error: string } {
  if (t.ownerType === "user") return { error: "Only an action for the client or another outside party can be shared." };
  if (!t.clientKey) return { error: "Choose the client first." };
  if (t.privacy === "private" || t.area === "personal") return { error: "A private task can't be shared." };
  return { clientKey: t.clientKey, title: t.title.slice(0, 120), details: t.description.slice(0, 2000), dueDate: t.dueDate, assignedTo: people };
}
export const afterShare = (row: Row, requestId: string, c: Ctx): { patch: Row; event: TaskEvent } => {
  const status = s(row.Status);
  return { patch: { PortalRequestId: requestId, Status: status === "Not requested" || status === "Open" ? "Requested" : status, Version: (Number(row.Version) || 0) + 1, Updated: c.now }, event: ev(c, s(row.Key), "shared", "", requestId) };
};

export type Sync = { patches: { key: string; patch: Row; event: TaskEvent }[]; notes: { key: string; message: string }[] };
/** What the portal says has happened to linked tasks. The only thing applied automatically is the plain fact that the client has submitted something. Everything that would
 *  finish or cancel a task is only suggested: the practice has to check it. */
export function portalSync(rows: Row[], reqs: PortalReq[], c: Ctx): Sync {
  const by = new Map(reqs.map((r) => [r.id, r])), out: Sync = { patches: [], notes: [] };
  for (const row of rows) {
    const id = s(row.PortalRequestId); if (!id) continue;
    const t = readTask(row), r = by.get(id);
    if (isFinished(t.status)) continue;
    if (!r) { out.notes.push({ key: t.key, message: "The portal request for this action can't be found. It may have been removed." }); continue; }
    const last = [...r.thread].reverse().find((x) => x.from === "client");
    if (r.status === "responded" && ["Requested", "In progress", "Needs more", "Not requested"].includes(t.status)) {
      const files = last?.docs?.length ? `${last.docs.length} file${last.docs.length === 1 ? "" : "s"}` : "";
      out.patches.push({ key: t.key, patch: { Status: "Submitted", Version: t.version + 1, Updated: c.now }, event: ev(c, t.key, "client-submitted", t.status, "Submitted", [last?.text.slice(0, 200), files].filter(Boolean).join(" · ")) });
    } else if (r.status === "open" && (t.status === "Submitted" || t.status === "Under review") && r.thread.at(-1)?.from === "staff") {
      out.notes.push({ key: t.key, message: "We've asked the client for more in the portal. Set the action to More information required." });
    } else if (r.status === "complete") out.notes.push({ key: t.key, message: "This request was completed in the portal. Check it, then mark the action Done." });
    else if (r.status === "cancelled") out.notes.push({ key: t.key, message: "This request was cancelled in the portal. Cancel the action too, or share it again." });
  }
  return out;
}

// ---------------------------------------------------------------- checking what the client sent
export type VerifyAction = "review" | "accept" | "corrections" | "reopen";
export type Portal = { op: "none" | "complete" | "reply-reopen" | "reply"; text?: string };
/** Accept, ask for corrections, reopen or start a review. Returns the task change, the history entry and what to tell the portal (the caller does that only after the person confirms). */
export function verifyPlan(row: Row, action: VerifyAction, c: Ctx, note = ""): { patch: Row; event: TaskEvent; portal: Portal } | { error: string } {
  const t = readTask(row);
  if (t.ownerType === "user") return { error: "Only an action for the client or an outside party needs checking." };
  const bump = (p: Row): Row => ({ ...p, Version: t.version + 1, Updated: c.now });
  if (action === "review") {
    if (t.status !== "Submitted") return { error: "Only something the client has submitted can be put under review." };
    return { patch: bump({ Status: "Under review" }), event: ev(c, t.key, "status", t.status, "Under review"), portal: { op: "none" } };
  }
  if (action === "accept") {
    if (t.status !== "Submitted" && t.status !== "Under review") return { error: "Only something the client has submitted can be accepted." };
    return { patch: bump({ Status: "Done", CompletedDate: c.now, CompletedBy: c.user, BlockedReason: "" }), event: ev(c, t.key, "verified", t.status, "Done", note), portal: t.privacy === "shared" && s(row.PortalRequestId) ? { op: "complete" } : { op: "none" } };
  }
  if (action === "corrections") {
    if (t.status !== "Submitted" && t.status !== "Under review") return { error: "Only something the client has submitted can be sent back." };
    if (!note.trim()) return { error: "Say what needs correcting. The client will read it." };
    return { patch: bump({ Status: "Needs more" }), event: ev(c, t.key, "corrections", t.status, "Needs more", note.trim()), portal: s(row.PortalRequestId) ? { op: "reply-reopen", text: note.trim() } : { op: "none" } };
  }
  if (t.status !== "Done" && t.status !== "Cancelled") return { error: "Only a finished action can be reopened." };
  if (!note.trim() && t.status === "Done") return { error: "Say why you're reopening it." };
  return { patch: bump({ Status: "Requested", CompletedDate: "", CompletedBy: "" }), event: ev(c, t.key, "reopened", t.status, "Requested", note.trim()), portal: s(row.PortalRequestId) && note.trim() ? { op: "reply-reopen", text: note.trim() } : { op: "none" } };
}

/** A task counts as properly satisfied for dependency purposes only when it is Done AND, for anything an outside party supplies, the practice's own check is on record. */
export const isVerified = (t: WorkTask, events: TaskEvent[]): boolean => (t.status === "Done" || t.status === "Complete") && (t.ownerType === "user" || events.some((e) => e.taskKey === t.key && e.type === "verified"));

// ---------------------------------------------------------------- chasing
export type ChaseKind = "call" | "email" | "note" | "portal" | "escalate";
export const MIN_DAYS_BETWEEN_PORTAL_REMINDERS = 3;
export const chaseHistory = (events: TaskEvent[], taskKey: string) => events.filter((e) => e.taskKey === taskKey && (e.type.startsWith("chase-") || e.type === "escalated")).sort((a, b) => b.at.localeCompare(a.at));

/** Record a chase. A portal reminder is refused if one went out within the last few days, so a client isn't pestered. Recording a call or email never sends anything. */
export function chasePlan(row: Row, kind: ChaseKind, c: Ctx, o: { note?: string; followUp?: string; events?: TaskEvent[] } = {}): { patch?: Row; event: TaskEvent; portal: Portal } | { error: string } {
  const t = readTask(row);
  if (t.ownerType === "user") return { error: "Only an action for the client or an outside party can be chased." };
  if (isFinished(t.status)) return { error: "That action is finished." };
  if (o.followUp && !/^\d{4}-\d{2}-\d{2}$/.test(o.followUp)) return { error: "That isn't a valid follow-up date." };
  if (kind === "note" && !s(o.note)) return { error: "Write the note first." };
  if (kind === "portal") {
    if (!s(row.PortalRequestId)) return { error: "Share this action through the portal first." };
    const last = chaseHistory(o.events || [], t.key).find((e) => e.type === "chase-portal");
    if (last && dayDiff(last.at, c.now) < MIN_DAYS_BETWEEN_PORTAL_REMINDERS) return { error: `A reminder went out ${dayDiff(last.at, c.now) || "less than a"} day${dayDiff(last.at, c.now) === 1 ? "" : "s"} ago. Wait a little before sending another.` };
  }
  const type: TaskEventType = kind === "call" ? "chase-call" : kind === "email" ? "chase-email" : kind === "portal" ? "chase-portal" : kind === "escalate" ? "escalated" : "chase-note";
  const patch: Row | undefined = o.followUp ? { FollowUpDate: o.followUp, Version: t.version + 1, Updated: c.now } : undefined;
  const text = s(o.note) || (kind === "portal" ? `Reminder: "${t.title}" is still outstanding${t.dueDate ? ` (due ${t.dueDate})` : ""}.` : "");
  return { patch, event: ev(c, t.key, type, "", o.followUp || "", s(o.note)), portal: kind === "portal" ? { op: "reply", text } : { op: "none" } };
}

// ---------------------------------------------------------------- Action Centre
export type Item = { key: string; clientKey: string; title: string; detail: string; priority: "high" | "medium" | "low"; due: string; taskKey: string };
export function clientActionItems(rows: Row[], names: (clientKey: string) => string, today: string): Item[] {
  const out: Item[] = [];
  for (const r of rows) {
    const t = readTask(r);
    if (t.ownerType === "user" || isFinished(t.status) || t.privacy === "private" || !t.clientKey) continue;
    const nm = names(t.clientKey), add = (suffix: string, title: string, detail: string, priority: Item["priority"], due = t.dueDate) => out.push({ key: `ca:${t.key}:${suffix}`, clientKey: t.clientKey, title: `${nm}: ${title}`, detail, priority, due, taskKey: t.key });
    if (t.status === "Submitted") add("verify", `check what the client sent for "${t.title}"`, "The client says this is done. It only counts once you have checked it.", "medium");
    else if (t.status === "Under review") add("review", `finish checking "${t.title}"`, "Under review.", "low");
    else if (t.dueDate && t.dueDate < today) add("chase", `chase "${t.title}"`, `Was due ${t.dueDate}${t.responsible ? ` from ${t.responsible}` : ""}. Call, email or send a reminder.`, "high");
    if (t.followUpDate && t.followUpDate <= today && t.status !== "Submitted") add("follow", `follow up "${t.title}"`, `Follow-up date ${t.followUpDate}.`, t.followUpDate < today ? "medium" : "low", t.followUpDate);
  }
  return out;
}

// ---------------------------------------------------------------- meeting actions
export type MeetingAction = { text: string; who: string; due: string; taskKey?: string; done?: boolean };
const hash = (x: string) => { let h = 5381; for (let i = 0; i < x.length; i++) h = ((h << 5) + h + x.charCodeAt(i)) >>> 0; return h.toString(36); };
const ownerFor = (who: string): "user" | "contact" | "external" => (/^(me|us|we|practice|accountant|i)$/i.test(who.trim()) || !who.trim() ? "user" : /^(client|director|customer|owner)/i.test(who.trim()) ? "contact" : "external");

/** A task row for a meeting action. The capture key ties it to this action in this meeting, so converting twice can't make two. Nothing client-facing is sent. */
export function meetingActionTask(a: MeetingAction, m: { key: string; clientKey: string; title: string }, i: number, c: { user: string; now: string; taskKey: string }): Row | { error: string } {
  const text = a.text.replace(/\s+/g, " ").trim();
  if (!text) return { error: "That action is empty." };
  if (a.due && !/^\d{4}-\d{2}-\d{2}$/.test(a.due)) return { error: `"${text.slice(0, 30)}" has a date that isn't valid.` };
  const ot = ownerFor(a.who);
  return { Key: c.taskKey, Title: text.slice(0, 250), Area: m.clientKey ? "client" : "inbox", ClientKey: m.clientKey, MeetingKey: m.key, Status: ot === "user" ? "Open" : "Not requested", OwnerType: ot, AssignedUser: c.user, AssignedContact: ot === "user" ? "" : a.who.trim(),
    DueDate: a.due || "", Description: `From the meeting: ${m.title}`, CreatedBy: c.user, Created: c.now, Updated: c.now, Version: 1, PrivacyLevel: "shared", CaptureKey: `mtg:${m.key}:${i}:${hash(text.toLowerCase())}` };
}

/** How the meeting's actions are getting on, from the linked tasks themselves (not from a tick box on the meeting). */
export function meetingProgress(actions: MeetingAction[], tasks: Row[]): { agreed: number; done: number; outstanding: number; unlinked: number } {
  const by = new Map(tasks.map((r) => [s(r.Key), readTask(r)])), live = actions.filter((a) => a.text.trim());
  let done = 0, unlinked = 0;
  for (const a of live) { const t = a.taskKey ? by.get(a.taskKey) : undefined; if (!t) { unlinked++; if (a.done) done++; } else if (t.status === "Done" || t.status === "Complete") done++; else if (t.status === "Cancelled") done++; }
  return { agreed: live.length, done, outstanding: live.length - done, unlinked };
}

/** Suggestions from meeting notes. Lines that look like an action: "Action:", "To do:", "AP:", "[ ]", "will send", "needs to", "to chase". The person reviews every one; none is created automatically. */
export function suggestFromNotes(notes: string): { text: string; who: string }[] {
  const out: { text: string; who: string }[] = [], seen = new Set<string>();
  for (const raw of notes.split(/\r?\n/)) {
    const line = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim(); if (line.length < 6) continue;
    let text = "", who = "";
    const m = /^(?:action(?:s)?|to ?do|todo|ap|next step)s?\s*[:\-]\s*(.+)$/i.exec(line) || /^\[\s?\]\s*(.+)$/.exec(line);
    if (m) text = m[1];
    else { const w = /^(client|director|[A-Z][a-z]+)\s+(?:will|to|needs to|must|should)\s+(.{4,})$/.exec(line); if (w) { who = w[1]; text = `${w[2]}`; } }
    text = text.replace(/\s+/g, " ").replace(/[.;]+$/, "").trim(); if (!text) continue;
    const wm = /^(client|director|me|i|we)\s*[:\-]\s*(.+)$/i.exec(text); if (wm) { who = wm[1]; text = wm[2]; }
    const k = text.toLowerCase(); if (seen.has(k)) continue; seen.add(k);
    out.push({ text: text[0].toUpperCase() + text.slice(1), who: /^(i|we)$/i.test(who) ? "Me" : who });
  }
  return out;
}
