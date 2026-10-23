// Time actually spent: how long finished jobs and tasks took. Not a timesheet: when you finish
// something you say how long it took (or leave it), and anything finished with no time shows up
// later as something to catch up on. The times give the planner real figures to learn from.
import { Job, Task, fmtDate } from "./domain";
import { addDays, jobHours } from "./planning";
import { Row } from "./schema";

/** The usual lengths of a piece of work, offered as one-tap choices. */
export const QUICK_HOURS = [0.25, 0.5, 1, 1.5, 2, 3, 4, 6, 7.5];

const round2 = (h: number) => Math.round(h * 100) / 100;
const valid = (h: number) => (Number.isFinite(h) && h > 0 && h <= 24 ? round2(h) : undefined);

/**
 * Hours from what you type: "1.5", "1:30", "1h30", "1h 30m", "2 hours", "90m", "45 mins".
 * A bare number is hours. Returns undefined for anything else (and for nothing, or more than a day).
 */
export function parseDuration(text: string): number | undefined {
  const t = text.trim().toLowerCase().replace(/,/g, ".");
  if (!t) return undefined;
  let m = /^(\d*\.?\d+)$/.exec(t);
  if (m) return valid(Number(m[1]));
  m = /^(\d+):(\d{1,2})$/.exec(t);
  if (m) return Number(m[2]) < 60 ? valid(Number(m[1]) + Number(m[2]) / 60) : undefined;
  m = /^(\d*\.?\d+)\s*h(?:rs?|ours?)?\s*(?:and\s*)?(?:(\d+)\s*(?:m(?:ins?|inutes?)?)?)?$/.exec(t);
  if (m) return Number(m[2] ?? 0) < 60 ? valid(Number(m[1]) + Number(m[2] ?? 0) / 60) : undefined;
  m = /^(\d+)\s*m(?:ins?|inutes?)?$/.exec(t);
  if (m) return valid(Number(m[1]) / 60);
  return undefined;
}

/** The hours as text for the box: 1.5, 0.25. */
export const hoursText = (h?: number): string => (h && h > 0 ? String(round2(h)) : "");

export type Finished = {
  kind: "job" | "task";
  key: string;
  row: Job | Task;
  title: string;
  clientKey?: string;
  /** The day it was finished. */
  done: string;
  /** What it was expected to take, to offer as a quick choice. */
  estimate: number;
};

const hasTime = (r: Row) => Number(r.ActualHours) > 0;
const skipped = (r: Row) => !!r.TimeSkipped;

/** Finished jobs and tasks with no time logged (and not marked "don't know"), newest first. */
export function finishedWithoutTime(jobs: Job[], tasks: Task[], services: Row[], opts: { since?: string; until?: string } = {}): Finished[] {
  const inRange = (d: string) => (!opts.since || d >= opts.since) && (!opts.until || d <= opts.until);
  const out: Finished[] = [];
  for (const j of jobs) {
    const done = String(j.CompletedDate || "");
    if (j.Status !== "Complete" || !done || hasTime(j) || skipped(j) || !inRange(done)) continue;
    out.push({ kind: "job", key: j.Key, row: j, title: j.Title, clientKey: j.ClientKey, done, estimate: jobHours(j, services) });
  }
  for (const t of tasks) {
    const done = String(t.CompletedDate || "");
    if (t.Status !== "Done" || !done || hasTime(t) || skipped(t) || !inRange(done)) continue;
    out.push({ kind: "task", key: t.Key, row: t, title: t.Title, clientKey: t.ClientKey, done, estimate: Number(t.EstimateHours) || 0 });
  }
  return out.sort((a, b) => b.done.localeCompare(a.done) || a.title.localeCompare(b.title));
}

/** How far back the catch-up prompt on Home looks. */
export const CATCH_UP_DAYS = 14;

/** "Yesterday you finished 3 things with no time logged", or the wider version. */
export function timeGapText(list: Finished[], today: string): string {
  const n = list.length;
  const things = `${n} ${n === 1 ? "thing" : "things"}`;
  if (!n) return "";
  const yesterday = addDays(today, -1);
  if (list.every((f) => f.done === yesterday)) return `Yesterday you finished ${things} with no time logged.`;
  if (list.every((f) => f.done === today)) return `Today you've finished ${things} with no time logged.`;
  const oldest = list[list.length - 1].done;
  return `You finished ${things} since ${fmtDate(oldest, { weekday: true, year: false })} with no time logged.`;
}

/** What to save when logging time (clears any earlier "don't know"). */
export const timePatch = (hours: number): Row => ({ ActualHours: hours, TimeSkipped: "" });
/** What to save when you can't say how long it took: it stops being asked about. */
export const timeSkipPatch = (): Row => ({ TimeSkipped: "yes" });
