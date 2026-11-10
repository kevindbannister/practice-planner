// Planning sessions: a plan to spend some time on a job or task on a day. A session is not the job: one job has many sessions, and a session that
// doesn't happen stays on record (rescheduled, not completed...) while a new linked session carries the rest of the work. Every change is also written
// to an append-only event log, which is what Planning History shows and what undo works from: undo never deletes anything, it adds new events.
//
// The job's or task's own PlannedDate stays, as a copy of the date of its next active session, so everything that reads it (the board, Today,
// the calendar) carries on working. See `projectDate`.
//
// Pure rules only: nothing here reads or writes a list. The screens apply the `Plan` that these functions return.
import { Row } from "./schema";

export type SessionStatus = "planned" | "in_progress" | "completed" | "partial" | "not_completed" | "rescheduled" | "cancelled";
export const STATUS_LABEL: Record<SessionStatus, string> = {
  planned: "Planned", in_progress: "In progress", completed: "Completed", partial: "Partly completed", not_completed: "Not completed", rescheduled: "Rescheduled", cancelled: "Cancelled",
};
/** Sessions that still stand as future work. Everything else is history. */
export const ACTIVE: SessionStatus[] = ["planned", "in_progress"];
const STATUSES = Object.keys(STATUS_LABEL) as SessionStatus[];

export type Session = {
  key: string; kind: "job" | "task"; itemKey: string; clientKey: string; title: string; userKey: string;
  date: string; start: string; minutes: number; actualMinutes: number; status: SessionStatus; outcome: string;
  originalKey: string; replacedByKey: string; reason: string; notes: string; created: string; createdBy: string; updated: string; updatedBy: string; version: number;
};

const s = (v: unknown) => String(v ?? "").trim();
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export const readSession = (r: Row): Session => ({
  key: s(r.Key), kind: s(r.Kind) === "task" ? "task" : "job", itemKey: s(r.ItemKey), clientKey: s(r.ClientKey), title: s(r.Title), userKey: s(r.UserKey),
  date: s(r.PlannedDate).slice(0, 10), start: s(r.PlannedStart), minutes: Math.max(0, Math.round(num(r.PlannedMinutes))), actualMinutes: Math.max(0, Math.round(num(r.ActualMinutes))),
  status: (STATUSES as string[]).includes(s(r.Status)) ? (s(r.Status) as SessionStatus) : "planned", outcome: s(r.Outcome),
  originalKey: s(r.OriginalKey), replacedByKey: s(r.ReplacedByKey), reason: s(r.Reason), notes: s(r.Notes),
  created: s(r.Created), createdBy: s(r.CreatedBy), updated: s(r.Updated), updatedBy: s(r.UpdatedBy), version: Math.max(1, Math.round(num(r.Version)) || 1),
});
export const sessionRow = (x: Session, practiceId = ""): Row => ({
  Key: x.key, PracticeId: practiceId, Kind: x.kind, ItemKey: x.itemKey, ClientKey: x.clientKey, Title: x.title, UserKey: x.userKey, PlannedDate: x.date, PlannedStart: x.start,
  PlannedMinutes: x.minutes, ActualMinutes: x.actualMinutes, Status: x.status, Outcome: x.outcome, OriginalKey: x.originalKey, ReplacedByKey: x.replacedByKey, Reason: x.reason, Notes: x.notes,
  Created: x.created, CreatedBy: x.createdBy, Updated: x.updated, UpdatedBy: x.updatedBy, Version: x.version,
});

export const isActive = (x: { status: SessionStatus }) => ACTIVE.includes(x.status);

// ------------------------------------------------------------------ events

export type EventType = "create" | "reschedule" | "complete" | "cancel" | "resize" | "reassign" | "split" | "ready" | "migrate" | "undo";
export const EVENT_LABEL: Record<EventType, string> = {
  create: "Planned", reschedule: "Rescheduled", complete: "Outcome recorded", cancel: "Cancelled", resize: "Hours changed", reassign: "Reassigned", split: "Split", ready: "Readiness changed", migrate: "Brought in from the old planner", undo: "Undone",
};
/** One thing that happened to one session. `previous` and `next` hold only the fields that changed (all of them, for a new session). */
export type PlanEvent = {
  key: string; batchKey: string; group: string; sessionKey: string; itemKey: string; type: EventType;
  previous: Record<string, unknown>; next: Record<string, unknown>; reason: string; result: "ok" | "failed" | "conflict"; relatedKey: string; created: string; createdBy: string;
};
const json = (v: string): Record<string, unknown> => { try { const o = JSON.parse(v); return o && typeof o === "object" ? o : {}; } catch { return {}; } };
export const readEvent = (r: Row): PlanEvent => ({
  key: s(r.Key), batchKey: s(r.BatchKey), group: s(r.Group), sessionKey: s(r.SessionKey), itemKey: s(r.ItemKey), type: (s(r.EventType) as EventType) || "create",
  previous: json(s(r.PreviousState)), next: json(s(r.NewState)), reason: s(r.Reason), result: (["ok", "failed", "conflict"].includes(s(r.Result)) ? s(r.Result) : "ok") as PlanEvent["result"],
  relatedKey: s(r.RelatedKey), created: s(r.Created), createdBy: s(r.CreatedBy),
});
export const eventRow = (e: PlanEvent, practiceId = ""): Row => ({
  Key: e.key, PracticeId: practiceId, BatchKey: e.batchKey, Group: e.group, SessionKey: e.sessionKey, ItemKey: e.itemKey, EventType: e.type,
  PreviousState: JSON.stringify(e.previous), NewState: JSON.stringify(e.next), Reason: e.reason, Result: e.result, RelatedKey: e.relatedKey, Created: e.created, CreatedBy: e.createdBy,
});

// ------------------------------------------------------------------ what a change is

/** The changes an action makes: sessions to add, sessions to change (with the version they were read at), and the events to log. */
export type Plan = {
  creates: Session[];
  patches: { key: string; patch: Partial<Session>; expectVersion: number }[];
  events: PlanEvent[];
  /** Why part of the action could not be done (and was left alone). */
  problems: string[];
};
export type Ctx = { now: string; user: string; newKey: (prefix: string) => string; batchKey?: string };

const empty = (): Plan => ({ creates: [], patches: [], events: [], problems: [] });
const FIELDS: (keyof Session)[] = ["date", "start", "minutes", "actualMinutes", "status", "outcome", "replacedByKey", "reason", "notes", "userKey"];
const pick = (x: Partial<Session>, keys: string[]) => Object.fromEntries(keys.map((k) => [k, (x as Record<string, unknown>)[k]]));

function event(c: Ctx, batch: string, group: string, x: Session, type: EventType, previous: Record<string, unknown>, next: Record<string, unknown>, reason = "", related = ""): PlanEvent {
  return { key: c.newKey("PE"), batchKey: batch, group, sessionKey: x.key, itemKey: x.itemKey, type, previous, next, reason: reason.trim(), result: "ok", relatedKey: related, created: c.now, createdBy: c.user };
}
const stamp = (c: Ctx) => ({ updated: c.now, updatedBy: c.user });

/** Applies a patch to a session as the next version, logging what changed. */
function change(plan: Plan, c: Ctx, batch: string, group: string, x: Session, patch: Partial<Session>, type: EventType, reason = "") {
  const keys = Object.keys(patch).filter((k) => (patch as Record<string, unknown>)[k] !== (x as Record<string, unknown>)[k]);
  if (!keys.length) return;
  const full: Partial<Session> = { ...patch, ...stamp(c), version: x.version + 1 };
  plan.patches.push({ key: x.key, patch: full, expectVersion: x.version });
  plan.events.push(event(c, batch, group, x, type, pick(x, keys), { ...pick(patch, keys), version: x.version + 1 }, reason));
}

export type NewSession = { kind: "job" | "task"; itemKey: string; clientKey?: string; title: string; userKey?: string; date: string; start?: string; minutes: number; notes?: string };

function blank(c: Ctx, i: NewSession, extra: Partial<Session> = {}): Session {
  return {
    key: c.newKey("PS"), kind: i.kind, itemKey: i.itemKey, clientKey: i.clientKey || "", title: i.title, userKey: i.userKey || c.user, date: i.date, start: i.start || "",
    minutes: Math.max(0, Math.round(i.minutes)), actualMinutes: 0, status: "planned", outcome: "", originalKey: "", replacedByKey: "", reason: "", notes: i.notes || "",
    created: c.now, createdBy: c.user, updated: c.now, updatedBy: c.user, version: 1, ...extra,
  };
}

/** Plans one or more sessions for a job or task (a six hour job can be given four of them). One batch, so one undo. */
export function createSessions(list: NewSession[], c: Ctx): Plan {
  const plan = empty();
  const batch = c.batchKey || c.newKey("PB");
  for (const i of list) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(i.date) || !(i.minutes > 0)) { plan.problems.push(`${i.title}: a date and a length of time are needed.`); continue; }
    const x = blank(c, i);
    plan.creates.push(x);
    plan.events.push(event(c, batch, x.key, x, "create", {}, sessionRow(x) as Record<string, unknown>));
  }
  return plan;
}

/**
 * The session didn't (all) happen where planned. The original stays, with what actually happened on it, and a new linked session takes the rest.
 * `actualMinutes` is the time really spent on the day (0 if none). `remainingMinutes` defaults to what was planned less that time, never less than 15 minutes
 * or what the user says: a revised estimate is the user's to give, so it is not simply taken off.
 */
export function reschedule(x: Session, i: { toDate: string; actualMinutes?: number; remainingMinutes?: number; reason: string; start?: string }, c: Ctx): Plan {
  const plan = empty();
  if (!isActive(x)) { plan.problems.push(`${x.title}: that session is already ${STATUS_LABEL[x.status].toLowerCase()}.`); return plan; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.toDate)) { plan.problems.push(`${x.title}: choose the new day.`); return plan; }
  const actual = Math.max(0, Math.round(i.actualMinutes ?? x.actualMinutes));
  const rest = Math.max(0, Math.round(i.remainingMinutes ?? Math.max(15, x.minutes - actual)));
  if (!(rest > 0)) { plan.problems.push(`${x.title}: say how much work is left.`); return plan; }
  const batch = c.batchKey || c.newKey("PB");
  const next = blank(c, { kind: x.kind, itemKey: x.itemKey, clientKey: x.clientKey, title: x.title, userKey: x.userKey, date: i.toDate, start: i.start, minutes: rest }, { originalKey: x.originalKey || x.key, reason: i.reason.trim() });
  change(plan, c, batch, x.key, x, { status: actual > 0 ? "partial" : "rescheduled", actualMinutes: actual, replacedByKey: next.key, reason: i.reason.trim(), outcome: actual > 0 ? "Partly done, the rest moved to " + i.toDate : "Moved to " + i.toDate }, "reschedule", i.reason);
  plan.creates.push(next);
  plan.events.push(event(c, batch, x.key, next, "create", {}, sessionRow(next) as Record<string, unknown>, i.reason, x.key));
  return plan;
}

/** Records how a session went without moving anything (finished, partly done and left, not done and left, or not needed). */
export function conclude(x: Session, i: { outcome: "completed" | "partial" | "not_completed" | "cancelled"; actualMinutes?: number; reason?: string; note?: string }, c: Ctx): Plan {
  const plan = empty();
  if (!isActive(x)) { plan.problems.push(`${x.title}: that session is already ${STATUS_LABEL[x.status].toLowerCase()}.`); return plan; }
  const batch = c.batchKey || c.newKey("PB");
  const actual = Math.max(0, Math.round(i.actualMinutes ?? x.actualMinutes));
  change(plan, c, batch, x.key, x, { status: i.outcome, actualMinutes: actual, reason: (i.reason || "").trim(), outcome: (i.note || "").trim() }, i.outcome === "cancelled" ? "cancel" : "complete", i.reason || i.note || "");
  return plan;
}

/** A different length of time for a session that is still to happen. */
export function resize(x: Session, minutes: number, c: Ctx, reason = ""): Plan {
  const plan = empty();
  if (!isActive(x)) { plan.problems.push(`${x.title}: that session is history and can't be changed.`); return plan; }
  if (!(minutes > 0)) { plan.problems.push(`${x.title}: a length of time is needed.`); return plan; }
  change(plan, c, c.batchKey || c.newKey("PB"), x.key, x, { minutes: Math.round(minutes) }, "resize", reason);
  return plan;
}

/** Another person does it. */
export function reassign(x: Session, userKey: string, c: Ctx): Plan {
  const plan = empty();
  if (!isActive(x)) { plan.problems.push(`${x.title}: that session is history and can't be changed.`); return plan; }
  change(plan, c, c.batchKey || c.newKey("PB"), x.key, x, { userKey }, "reassign");
  return plan;
}

/** Splits a session still to happen into several, on the same or other days. The parts must add up to what was planned (or be more: that is a bigger plan). */
export function split(x: Session, parts: { date: string; minutes: number }[], c: Ctx, reason = ""): Plan {
  const plan = empty();
  if (!isActive(x)) { plan.problems.push(`${x.title}: that session is history and can't be split.`); return plan; }
  const good = parts.filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.date) && p.minutes > 0);
  if (good.length < 2) { plan.problems.push(`${x.title}: a split needs at least two parts, each with a day and a length of time.`); return plan; }
  const batch = c.batchKey || c.newKey("PB");
  const [first, ...more] = good;
  change(plan, c, batch, x.key, x, { date: first.date, minutes: Math.round(first.minutes) }, "split", reason);
  for (const p of more) {
    const n = blank(c, { kind: x.kind, itemKey: x.itemKey, clientKey: x.clientKey, title: x.title, userKey: x.userKey, date: p.date, minutes: p.minutes }, { originalKey: x.originalKey || x.key, reason: reason.trim() });
    plan.creates.push(n);
    plan.events.push(event(c, batch, x.key, n, "create", {}, sessionRow(n) as Record<string, unknown>, reason, x.key));
  }
  return plan;
}

/** Moves many sessions on one day at once (the end of day review). Each is its own group, so each can be undone, or fail to be, alone. */
export function rescheduleMany(list: Session[], i: { toDate: string; reason: string }, c: Ctx): Plan {
  const plan = empty();
  const batch = c.batchKey || c.newKey("PB");
  for (const x of list) {
    const p = reschedule(x, { toDate: i.toDate, reason: i.reason }, { ...c, batchKey: batch });
    plan.creates.push(...p.creates); plan.patches.push(...p.patches); plan.events.push(...p.events); plan.problems.push(...p.problems);
  }
  return plan;
}

// ------------------------------------------------------------------ applying a plan (the screens write to lists; this does the same in memory, for tests and for the migration check)

export function applyPlan(sessions: Session[], plan: Plan): { sessions: Session[]; conflicts: string[] } {
  const out = sessions.map((x) => ({ ...x }));
  const conflicts: string[] = [];
  for (const x of plan.creates) if (!out.some((o) => o.key === x.key)) out.push({ ...x });
  for (const p of plan.patches) {
    const at = out.findIndex((o) => o.key === p.key);
    if (at < 0 || out[at].version !== p.expectVersion) { conflicts.push(p.key); continue; }
    out[at] = { ...out[at], ...p.patch };
  }
  return { sessions: out, conflicts };
}

// ------------------------------------------------------------------ undo

export type UndoResult = Plan & { undone: string[]; skipped: { group: string; why: string }[]; alreadyUndone: boolean };

/** Which events have been undone: an undo event names the one it reverses. */
const reversed = (events: PlanEvent[]) => new Set(events.filter((e) => e.type === "undo" && e.result === "ok").map((e) => e.relatedKey));

/**
 * Undoes a batch, group by group (a group is one session's change with whatever it created). A group is put back only if nothing has touched
 * its sessions since: otherwise it is left and the reason given, rather than overwriting the newer edit. Nothing is deleted: a session
 * the action created is cancelled, a changed one has its earlier values written back, and each step is logged as a new "undo" event.
 * Asking again for a batch already undone does nothing.
 */
export function undoBatch(batchKey: string, events: PlanEvent[], sessions: Session[], c: Ctx): UndoResult {
  const plan: UndoResult = { ...empty(), undone: [], skipped: [], alreadyUndone: false };
  const done = reversed(events);
  const mine = events.filter((e) => e.batchKey === batchKey && e.type !== "undo" && e.result === "ok");
  if (!mine.length) { plan.problems.push("Nothing to undo there."); return plan; }
  if (mine.every((e) => done.has(e.key))) { plan.alreadyUndone = true; return plan; }
  const undoBatchKey = c.newKey("PB");
  const groups = new Map<string, PlanEvent[]>();
  for (const e of mine.filter((e) => !done.has(e.key))) groups.set(e.group, [...(groups.get(e.group) || []), e]);
  for (const [group, list] of groups) {
    // every session in the group must still be as the action left it
    let why = "";
    for (const e of list) {
      const now = sessions.find((x) => x.key === e.sessionKey);
      const wasVersion = Number(e.next.version ?? (e.previous && Object.keys(e.previous).length ? NaN : 1));
      if (!now) { why = "a session it changed is no longer there"; break; }
      if (Number.isFinite(wasVersion) && now.version !== wasVersion) { why = `${now.title} on ${now.date} has been changed since`; break; }
    }
    if (why) { plan.skipped.push({ group, why }); continue; }
    for (const e of list.slice().reverse()) {
      const now = sessions.find((x) => x.key === e.sessionKey)!;
      const before = plan.events.length;
      if (Object.keys(e.previous).length === 0) {
        // it was created by the action: it is cancelled, not removed
        change(plan, c, undoBatchKey, group, now, { status: "cancelled", reason: "Undone", outcome: "Undone" }, "undo", "Undone");
      } else {
        const back = Object.fromEntries(Object.entries(e.previous).filter(([k]) => (FIELDS as string[]).includes(k))) as Partial<Session>;
        change(plan, c, undoBatchKey, group, now, back, "undo", "Undone");
      }
      // the event just made points at the one it reverses
      if (plan.events.length === before) {
        // it was already as it was: still logged, so that the original is known to have been reversed
        plan.events.push(event(c, undoBatchKey, group, now, "undo", {}, {}, "Undone"));
      }
      plan.events[plan.events.length - 1].relatedKey = e.key;
      plan.undone.push(e.key);
      // later steps of the same group read this session's new version
      const p = plan.patches[plan.patches.length - 1];
      if (p && plan.patches.length > 0 && plan.events.length > before && plan.patches[plan.patches.length - 1].key === now.key) { const at = sessions.findIndex((x) => x.key === p.key); if (at >= 0) sessions = sessions.map((x, j) => (j === at ? { ...x, ...p.patch } : x)); }
    }
  }
  return plan;
}

/** Whether a batch can still be undone, for showing the button. */
export function undoable(batchKey: string, events: PlanEvent[]): boolean {
  const done = reversed(events);
  return events.some((e) => e.batchKey === batchKey && e.type !== "undo" && e.result === "ok" && !done.has(e.key));
}

// ------------------------------------------------------------------ what the planner shows

/** The date a job or task's own PlannedDate should hold: that of its next active session (or the earliest if all are past), else nothing. */
export function projectDate(sessions: Session[], itemKey: string, today: string): string {
  const mine = sessions.filter((x) => x.itemKey === itemKey && isActive(x)).map((x) => x.date).sort();
  return mine.find((d) => d >= today) || mine[0] || "";
}

/** Minutes committed on a day: sessions still standing only. A rescheduled original is history and never counts, so the work is not counted twice. */
export const committedMinutes = (sessions: Session[], date: string, userKey?: string): number =>
  sessions.filter((x) => x.date === date && isActive(x) && (!userKey || x.userKey === userKey)).reduce((t, x) => t + x.minutes, 0);

/** Future work already planned for an item, in minutes. */
export const plannedAhead = (sessions: Session[], itemKey: string, today: string): number =>
  sessions.filter((x) => x.itemKey === itemKey && isActive(x) && x.date >= today).reduce((t, x) => t + x.minutes, 0);

/** Sessions on or before today that are still marked planned: the ones to review at the end of the day. */
export const toReview = (sessions: Session[], today: string, userKey?: string): Session[] =>
  sessions.filter((x) => isActive(x) && x.date <= today && (!userKey || x.userKey === userKey)).sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));

/** Operational view: what still stands, in date order. Historical view: what was planned on each day and what happened, whatever has happened to it since. */
export const operational = (sessions: Session[], from: string, to: string) => sessions.filter((x) => isActive(x) && x.date >= from && x.date <= to).sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
export const historical = (sessions: Session[], from: string, to: string) => sessions.filter((x) => x.date >= from && x.date <= to).sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || a.created.localeCompare(b.created));

/** The chain of sessions an item's work has passed through: the first, then each one it was moved to. */
export function chainOf(sessions: Session[], key: string): Session[] {
  const by = new Map(sessions.map((x) => [x.key, x]));
  let head = by.get(key);
  const seen = new Set<string>();
  while (head && head.originalKey && by.has(head.originalKey) && !seen.has(head.key)) { seen.add(head.key); head = by.get(head.originalKey); }
  const out: Session[] = [];
  while (head && !out.includes(head)) { out.push(head); head = head.replacedByKey ? by.get(head.replacedByKey) : undefined; }
  return out;
}

/** "Rescheduled to Tue 3 Nov" under a historical session. */
export function movedTo(x: Session, sessions: Session[]): Session | undefined {
  return x.replacedByKey ? sessions.find((y) => y.key === x.replacedByKey) : undefined;
}

// ------------------------------------------------------------------ bringing in what the old planner holds

export type MigrationReport = { migrated: number; skippedHasSessions: number; skippedDone: number; skippedNoDate: number; rejected: { key: string; why: string }[]; minutes: number };

/**
 * Turns a job or task that has a planned date, and no session yet, into one planned session of its estimate. Safe to run again: an item that already has a session
 * is skipped, and the key of each new session is fixed by the item and date. No history is invented: nothing says it was ever moved, so nothing is shown as moved.
 */
export function migrateLegacy(i: { jobs: Row[]; tasks: Row[]; sessions: Session[]; hoursOf: (kind: "job" | "task", row: Row) => number; now: string; user: string }): { rows: Session[]; events: PlanEvent[]; report: MigrationReport } {
  const report: MigrationReport = { migrated: 0, skippedHasSessions: 0, skippedDone: 0, skippedNoDate: 0, rejected: [], minutes: 0 };
  const have = new Set(i.sessions.map((x) => x.itemKey));
  const rows: Session[] = [], events: PlanEvent[] = [];
  const batch = `MIG-${i.now.slice(0, 10)}`;
  for (const [kind, list] of [["job", i.jobs], ["task", i.tasks]] as const) {
    for (const r of list) {
      const key = s(r.Key), status = s(r.Status);
      if (!key) continue;
      if (["Complete", "Done", "Cancelled"].includes(status)) { report.skippedDone++; continue; }
      const date = s(r.PlannedDate).slice(0, 10);
      if (!date) { report.skippedNoDate++; continue; }
      if (have.has(key)) { report.skippedHasSessions++; continue; }
      const hours = i.hoursOf(kind, r);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !(hours > 0)) { report.rejected.push({ key, why: !(hours > 0) ? "no estimate to plan" : "the date isn't a date" }); continue; }
      const minutes = Math.round(hours * 60);
      const k = `PS-${kind}-${key}-${date}`;
      const x: Session = { key: k, kind, itemKey: key, clientKey: s(r.ClientKey), title: s(r.Title), userKey: i.user, date, start: s(r.StartTime), minutes, actualMinutes: 0, status: "planned", outcome: "", originalKey: "", replacedByKey: "", reason: "", notes: "", created: i.now, createdBy: i.user, updated: i.now, updatedBy: i.user, version: 1 };
      rows.push(x);
      events.push({ key: `PE-${k}`, batchKey: batch, group: k, sessionKey: k, itemKey: key, type: "migrate", previous: {}, next: { date, minutes }, reason: "Brought in from the planned date", result: "ok", relatedKey: "", created: i.now, createdBy: i.user });
      report.migrated++; report.minutes += minutes;
    }
  }
  return { rows, events, report };
}
