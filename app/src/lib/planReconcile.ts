// The end of day picture, the dates changed outside the review, and the suggested sessions for work that has none yet. Pure rules; the screens apply
// what these return through lib/planSessions.ts, so everything done here is in the planning history and can be undone.
import { ACTIVE, Ctx, Plan, Session, committedMinutes, conclude, createSessions, isActive, reschedule } from "./planSessions";
import { Entry, entryMinutes } from "./timesheet";
import { Row } from "./schema";

// ------------------------------------------------------------------ the day, as planned and as it went

export type DayReview = {
  date: string;
  /** Sessions that were planned for the day, whatever has happened to them since (a moved one still counts as what was planned that day). */
  planned: Session[];
  plannedMinutes: number;
  recordedMinutes: number;
  /** Time recorded on the day against a session planned for that day. */
  onPlanMinutes: number;
  /** Time recorded on the day that no session planned for that day accounts for: calls, correspondence, other work. Not a failing. */
  unplannedMinutes: number;
  unplanned: Entry[];
  /** Planned for the day with no time recorded against them. */
  noTime: Session[];
  completed: number; partial: number; notDone: number; stillOpen: number;
  /** Capacity not yet accounted for by recorded time (never negative; not idle time). */
  unaccountedMinutes: number;
};

export function dayReview(sessions: Session[], entries: Entry[], date: string, capacityHours: number, now: Date): DayReview {
  const planned = sessions.filter((x) => x.date === date && !(x.status === "cancelled" && x.outcome === "Undone"));
  const keys = new Set(planned.map((x) => x.key));
  const mine = entries.filter((e) => e.workDate === date);
  const mins = (e: Entry) => entryMinutes(e, now);
  const onPlan = mine.filter((e) => e.sessionKey && keys.has(e.sessionKey));
  const unplanned = mine.filter((e) => !(e.sessionKey && keys.has(e.sessionKey)));
  const recorded = mine.reduce((t, e) => t + mins(e), 0);
  const withTime = new Set(entries.filter((e) => e.sessionKey).map((e) => e.sessionKey));
  return {
    date, planned, plannedMinutes: planned.reduce((t, x) => t + x.minutes, 0), recordedMinutes: recorded,
    onPlanMinutes: onPlan.reduce((t, e) => t + mins(e), 0), unplannedMinutes: unplanned.reduce((t, e) => t + mins(e), 0), unplanned,
    noTime: planned.filter((x) => isActive(x) && !withTime.has(x.key) && !x.actualMinutes),
    completed: planned.filter((x) => x.status === "completed").length,
    partial: planned.filter((x) => x.status === "partial").length,
    notDone: planned.filter((x) => x.status === "not_completed" || x.status === "rescheduled").length,
    stillOpen: planned.filter((x) => ACTIVE.includes(x.status)).length,
    unaccountedMinutes: Math.max(0, Math.round(capacityHours * 60) - recorded),
  };
}

// ------------------------------------------------------------------ dates changed outside the review

export type Drift =
  | { kind: "moved"; itemKey: string; title: string; session: Session; to: string }
  | { kind: "taken-off"; itemKey: string; title: string; session: Session }
  | { kind: "ambiguous"; itemKey: string; title: string; why: string };

const done = (r: Row) => ["Complete", "Done", "Cancelled"].includes(String(r.Status || ""));
const dateOf = (r: Row) => String(r.PlannedDate || "").slice(0, 10);

/**
 * Items whose own planned date no longer matches their sessions: a card dragged on the board, "Add to today", or a date edited in an editor. A single live
 * session on another day was moved; a live session on an item that has been taken off the planner was dropped. An item with several live sessions can't be
 * matched to one of them, so it is listed and left for the user. Items with no sessions at all are brought in (lib/planSessions.ts `migrateLegacy`).
 */
export function drift(jobs: Row[], tasks: Row[], sessions: Session[]): Drift[] {
  const out: Drift[] = [];
  for (const r of [...jobs, ...tasks]) {
    const key = String(r.Key || "");
    if (!key || done(r)) continue;
    const live = sessions.filter((x) => x.itemKey === key && isActive(x));
    if (!live.length) continue; // nothing to compare with
    const date = dateOf(r), title = String(r.Title || "");
    if (live.some((x) => x.date === date)) continue; // still one of them
    if (live.length > 1) { out.push({ kind: "ambiguous", itemKey: key, title, why: date ? `now planned for ${date}, but it has ${live.length} sessions` : `taken off the planner, but it has ${live.length} sessions` }); continue; }
    out.push(date ? { kind: "moved", itemKey: key, title, session: live[0], to: date } : { kind: "taken-off", itemKey: key, title, session: live[0] });
  }
  return out;
}

/** Records those changes as moves and cancellations: one batch (so one undo), each in its own group, the original sessions kept. */
export function recordDrift(list: Drift[], c: Ctx): Plan {
  const plan: Plan = { creates: [], patches: [], events: [], problems: [] };
  const batch = c.batchKey || c.newKey("PB");
  for (const d of list) {
    if (d.kind === "ambiguous") { plan.problems.push(`${d.title}: ${d.why}.`); continue; }
    const p = d.kind === "moved"
      ? reschedule(d.session, { toDate: d.to, reason: "Moved on the planner" }, { ...c, batchKey: batch })
      : conclude(d.session, { outcome: "cancelled", reason: "Taken off the planner" }, { ...c, batchKey: batch });
    plan.creates.push(...p.creates); plan.patches.push(...p.patches); plan.events.push(...p.events); plan.problems.push(...p.problems);
  }
  return plan;
}

// ------------------------------------------------------------------ suggested sessions for work that has none

export type Suggestion = { date: string; minutes: number };
export const MIN_SESSION = 30;
export const MAX_SESSION = 180;

/**
 * Spreads the work still to be planned over the days ahead: each client day's free time (its capacity less sessions already standing) is used from the
 * earliest, in sessions of between 30 minutes and 3 hours, and no later than the deadline if it can be helped. Only what can be done now is offered. Never
 * touches a session that exists: this only proposes new ones, for the user to accept or not. If it can't all be placed, `short` says by how much.
 */
export function suggest(i: { minutes: number; from: string; deadline?: string; days: number; capacity: (date: string) => number; sessions: Session[]; userKey?: string }): { sessions: Suggestion[]; short: number; lateBy: number } {
  const out: Suggestion[] = [];
  let left = Math.max(0, Math.round(i.minutes));
  const at = (d: string, k: number) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + k); return t.toISOString().slice(0, 10); };
  const place = (limit?: string) => {
    for (let k = 0; k < i.days && left > 0; k++) {
      const d = at(i.from, k);
      if (limit && d > limit) break;
      const free = Math.round(i.capacity(d) * 60) - committedMinutes(i.sessions, d, i.userKey) - out.filter((o) => o.date === d).reduce((t, o) => t + o.minutes, 0);
      if (free < MIN_SESSION) continue;
      const m = Math.min(free, MAX_SESSION, left);
      if (m < MIN_SESSION && left > m) continue; // a sliver isn't worth a session unless it is all that's left
      out.push({ date: d, minutes: m }); left -= m;
    }
  };
  place(i.deadline);
  const lateStart = left;
  if (left > 0) place(); // past the deadline: still offered, and said to be late
  const placedLate = lateStart - left;
  return { sessions: out.sort((a, b) => a.date.localeCompare(b.date)), short: left, lateBy: i.deadline ? placedLate : 0 };
}

/** Accepting a suggestion makes real sessions, in one batch. */
export function acceptSuggestion(item: { kind: "job" | "task"; itemKey: string; clientKey: string; title: string }, s: Suggestion[], c: Ctx): Plan {
  return createSessions(s.map((x) => ({ ...item, date: x.date, minutes: x.minutes })), c);
}
