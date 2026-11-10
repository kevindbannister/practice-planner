// How far a job or task has got, kept apart from how long it has taken. Time recorded is a fact; what is left is the user's own estimate, so a job
// that runs over its budget is not thereby finished, and a revised estimate is never overwritten by subtracting the time recorded.
// Readiness (ready, partly ready, waiting, on hold, complete) is separate from the workflow stage, and decides how much of what is left can
// be planned now: work that is blocked takes no capacity until it can really be done.
import { Row } from "./schema";
import { round2 } from "./jobTime";

export type Readiness = "ready" | "partly" | "waiting" | "hold" | "complete";
export const READINESS_LABEL: Record<Readiness, string> = { ready: "Ready", partly: "Partly ready", waiting: "Waiting", hold: "On hold", complete: "Complete" };

const num = (v: unknown): number | undefined => (v === "" || v === null || v === undefined || !Number.isFinite(Number(v)) ? undefined : Number(v));
const DONE = new Set(["Complete", "Done"]);

/** What the user has said is left, in hours, or undefined when they haven't (so the estimate less the time recorded is used). */
export const remainingSet = (r: Row): number | undefined => { const v = num(r.RemainingHours); return v !== undefined && v >= 0 ? v : undefined; };

export function readinessOf(r: Row, remaining: number): Readiness {
  const status = String(r.Status || "");
  if (DONE.has(status)) return "complete";
  if (status === "On hold") return String(r.HoldKind || "") ? "waiting" : "hold";
  const ready = num(r.ReadyHours);
  if (ready !== undefined && ready >= 0 && ready < remaining) return ready === 0 ? "waiting" : "partly";
  return "ready";
}

export type Progress = {
  readiness: Readiness;
  /** The original estimate, never rewritten. */
  estimate: number;
  /** Time recorded so far (facts from the time entries). */
  actual: number;
  /** What is left: the user's figure if given, else the estimate less the time recorded (never below nothing). */
  remaining: number;
  remainingIsOwn: boolean;
  /** Time recorded plus what is left: the current view of the whole job. Only differs from the estimate when the user has revised it. */
  revisedTotal: number;
  /** Hours in sessions still to happen. */
  plannedAhead: number;
  /** What is left and not yet given a session. */
  unscheduled: number;
  /** Of what is left, how much can be done now, and how much is waiting on someone. */
  actionable: number;
  blocked: number;
  /** Unscheduled work that can be done now: what the planner may offer to fill days with. */
  toPlan: number;
  /** Over the estimate and not finished: not a reason to call it done, but a prompt to say how much is left. */
  overBudget: boolean;
  needsRemaining: boolean;
};

export function progress(r: Row, i: { estimate: number; actual: number; plannedAhead: number }): Progress {
  const own = remainingSet(r);
  const estimate = round2(i.estimate), actual = round2(i.actual);
  const remaining = round2(own ?? Math.max(0, estimate - actual));
  const readiness = readinessOf(r, remaining);
  const ready = num(r.ReadyHours);
  const actionable = round2(readiness === "ready" ? remaining : readiness === "partly" ? Math.min(ready ?? 0, remaining) : 0);
  const blocked = round2(remaining - actionable);
  const plannedAhead = round2(i.plannedAhead);
  const open = readiness !== "complete";
  return {
    readiness, estimate, actual, remaining, remainingIsOwn: own !== undefined, revisedTotal: round2(actual + remaining), plannedAhead,
    unscheduled: round2(Math.max(0, remaining - plannedAhead)), actionable, blocked, toPlan: round2(Math.max(0, actionable - plannedAhead)),
    overBudget: open && estimate > 0 && actual > estimate, needsRemaining: open && own === undefined && estimate > 0 && actual >= estimate,
  };
}

/** What to save when the user gives the work left, what can be done now, and what the rest waits for. Blank clears it back to the estimate. */
export function progressPatch(i: { remaining: string; ready: string; note: string }): { patch?: Row; error?: string } {
  const read = (t: string): number | undefined | null => { if (!t.trim()) return undefined; const v = Number(t.replace(/h$/i, "").trim()); return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null; };
  const rem = read(i.remaining), rdy = read(i.ready);
  if (rem === null) return { error: "Work left: a number of hours like 2 or 1.5." };
  if (rdy === null) return { error: "Can be done now: a number of hours like 1 or 0.5." };
  if (rem !== undefined && rdy !== undefined && rdy > rem) return { error: "More can't be done now than is left." };
  return { patch: { RemainingHours: rem ?? "", ReadyHours: rdy ?? "", ReadyNote: i.note.trim() } };
}
