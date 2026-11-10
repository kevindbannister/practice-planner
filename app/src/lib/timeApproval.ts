// Timesheet approval. It is OFF unless the practice turns it on (setting timesheet.approval {on:true}); with it off, time is simply recorded and
// nothing here applies. With it on, a person SUBMITS a week; a reviewer APPROVES it or RETURNS it with a note. Approved time is locked: it can't be edited
// or deleted unless the person has the "change approved time" permission, and a change then puts it back to SUBMITTED so it must be approved again.
// A reviewer can't approve their own time unless they are the owner and no one else can. Every step is written to the time log with who and when.
import { Row } from "./schema";
import { Rec, Change, TimeEvent, TimeEventType, TIME_EVENT_LABEL } from "./timeBilling";
import { entryMinutes } from "./timesheet";

const s = (v: unknown) => String(v ?? "").trim();
type Mk = { user: string; now: Date; newKey: (p: string) => string; batch?: string };
export const APPROVAL_LABEL: Record<string, string> = { "": "Draft", submitted: "Submitted", approved: "Approved", returned: "Returned" };

const ev = (m: Mk, batch: string, e: Rec, type: TimeEventType, previous: Record<string, unknown>, next: Record<string, unknown>, reason = ""): TimeEvent => ({ key: m.newKey("TE"), batchKey: batch, entryKey: e.key, type, previous, next, reason, created: m.now.toISOString(), createdBy: m.user });

/** Submit a person's finished time (draft or returned) for approval. Running timers can't be submitted. */
export function submit(entries: Rec[], m: Mk): Change {
  const out: Change = { patches: [], events: [], problems: [] };
  const batch = m.batch || m.newKey("TA");
  for (const e of entries) {
    if (!e.ended) { out.problems.push(`${e.key}: still running.`); continue; }
    if (e.approval === "submitted" || e.approval === "approved") continue;
    out.patches.push({ key: e.key, patch: { ApprovalStatus: "submitted", ReviewNote: "", Version: e.version + 1 } });
    out.events.push(ev(m, batch, e, "submit", { approval: e.approval }, { approval: "submitted" }));
  }
  return out;
}
/** Approve submitted time. You can't approve your own unless `selfOk` (an owner with no one else to ask). */
export function approve(entries: Rec[], m: Mk, selfOk: boolean, note = ""): Change {
  const out: Change = { patches: [], events: [], problems: [] };
  const batch = m.batch || m.newKey("TA");
  for (const e of entries) {
    if (e.approval !== "submitted") { out.problems.push(`${e.key}: not waiting for approval.`); continue; }
    if (e.by.toLowerCase() === m.user.toLowerCase() && !selfOk) { out.problems.push(`${e.key}: you can't approve your own time.`); continue; }
    out.patches.push({ key: e.key, patch: { ApprovalStatus: "approved", ReviewedBy: m.user, ReviewedAt: m.now.toISOString(), ReviewNote: s(note), Version: e.version + 1 } });
    out.events.push(ev(m, batch, e, "approve", { approval: "submitted" }, { approval: "approved" }, s(note)));
  }
  return out;
}
/** Send submitted time back with a note saying what to fix (a note is needed). */
export function returnTime(entries: Rec[], note: string, m: Mk): Change {
  const out: Change = { patches: [], events: [], problems: [] };
  if (!s(note)) { out.problems.push("Say what needs fixing."); return out; }
  const batch = m.batch || m.newKey("TA");
  for (const e of entries) {
    if (e.approval !== "submitted") { out.problems.push(`${e.key}: not waiting for approval.`); continue; }
    out.patches.push({ key: e.key, patch: { ApprovalStatus: "returned", ReviewedBy: m.user, ReviewedAt: m.now.toISOString(), ReviewNote: s(note), Version: e.version + 1 } });
    out.events.push(ev(m, batch, e, "return", { approval: "submitted" }, { approval: "returned" }, s(note)));
  }
  return out;
}
/** Reopen approved time (needs a reason): it goes back to draft, the original approval stays in the log. */
export function reopen(entries: Rec[], reason: string, m: Mk): Change {
  const out: Change = { patches: [], events: [], problems: [] };
  if (!s(reason)) { out.problems.push("Say why it is being reopened."); return out; }
  const batch = m.batch || m.newKey("TA");
  for (const e of entries) {
    if (e.approval !== "approved") { out.problems.push(`${e.key}: not approved.`); continue; }
    if (e.bill === "billed") { out.problems.push(`${e.key}: already billed, so it can't be reopened.`); continue; }
    out.patches.push({ key: e.key, patch: { ApprovalStatus: "", ReviewNote: s(reason), Version: e.version + 1 } });
    out.events.push(ev(m, batch, e, "reopen", { approval: "approved", reviewedBy: e.reviewedBy }, { approval: "" }, s(reason)));
  }
  return out;
}
/** The log line for a change to approved time by someone allowed to (the change itself is made by the caller; the entry then needs approving again). */
export function correction(e: Rec, change: Record<string, unknown>, reason: string, m: Mk): { patch: Row; event: TimeEvent; problem?: string } {
  if (!s(reason)) return { patch: {}, event: ev(m, m.newKey("TA"), e, "correct", {}, {}), problem: "Say why approved time is being changed." };
  return { patch: { ...change, ApprovalStatus: "submitted", ReviewNote: `Changed after approval: ${s(reason)}`, Version: e.version + 1 },
    event: ev(m, m.newKey("TA"), e, "correct", { approval: "approved", minutes: Math.round(e.hours * 60) }, { approval: "submitted", ...change }, s(reason)) };
}
/** Time waiting to be approved, by person. */
export function waiting(recs: Rec[]): { user: string; minutes: number; entries: Rec[] }[] {
  const by = new Map<string, Rec[]>();
  for (const e of recs) if (e.approval === "submitted") by.set(e.by, [...(by.get(e.by) || []), e]);
  return [...by].map(([user, entries]) => ({ user, entries, minutes: entries.reduce((t, e) => t + entryMinutes(e, new Date()), 0) })).sort((a, b) => a.user.localeCompare(b.user));
}
export { TIME_EVENT_LABEL };
