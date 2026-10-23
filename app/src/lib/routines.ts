// Routine work: things you do every week or month (Monday bookkeeping, a monthly payroll
// check, a weekly look at the business). A routine is a template; for each week the planner
// offers the tasks that are missing, and you add them with one button. A task made from a
// routine remembers which routine and day it came from, so nothing is ever added twice.
import { addDays, mondayOf, parseIso, toIso, weekday } from "./planning";
import { Row } from "./schema";

export type Routine = {
  id: string;
  title: string;
  every: "week" | "month";
  /** 1 = Monday … 5 = Friday, for weekly routines. */
  weekday: number;
  /** 1–28, for monthly routines. A weekend moves to the Monday after. */
  monthDay: number;
  hours: number;
  /** A client (client work), or a business project (business work), or neither. */
  clientKey?: string;
  projectKey?: string;
  active: boolean;
};

export const newRoutine = (id: string): Routine => ({ id, title: "", every: "week", weekday: 1, monthDay: 1, hours: 1, active: true });

const clamp = (n: unknown, lo: number, hi: number, fallback: number) => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
};

/** Routines as saved in Settings, tidied; anything unusable is dropped. */
export function readRoutines(saved: unknown): Routine[] {
  if (!Array.isArray(saved)) return [];
  const out: Routine[] = [];
  for (const r of saved as Partial<Routine>[]) {
    if (!r || typeof r.id !== "string" || typeof r.title !== "string" || !r.title.trim()) continue;
    out.push({
      id: r.id, title: r.title.trim(), every: r.every === "month" ? "month" : "week",
      weekday: clamp(r.weekday, 1, 5, 1), monthDay: clamp(r.monthDay, 1, 28, 1),
      hours: Number(r.hours) > 0 ? Math.min(24, Number(r.hours)) : 1,
      clientKey: r.clientKey || undefined, projectKey: r.projectKey || undefined, active: r.active !== false,
    });
  }
  return out;
}

/** The days a routine falls on between two dates, inclusive. */
export function occurrences(r: Routine, from: string, to: string): string[] {
  const out: string[] = [];
  if (r.every === "week") {
    for (let m = mondayOf(from); m <= to; m = addDays(m, 7)) {
      const d = addDays(m, r.weekday - 1);
      if (d >= from && d <= to) out.push(d);
    }
    return out;
  }
  const start = parseIso(from);
  for (let y = start.getUTCFullYear(), m = start.getUTCMonth(); ; m++) {
    const first = toIso(new Date(Date.UTC(y, m, r.monthDay)));
    let d = first;
    while (weekday(d) > 5) d = addDays(d, 1);
    if (first > to) break;
    if (d >= from && d <= to) out.push(d);
    if (m > start.getUTCMonth() + 14) break;
  }
  return out;
}

export type Due = { routine: Routine; date: string };

/** Routine tasks not yet on the planner for the days from `from` to `to`. */
export function dueRoutines(routines: Routine[], tasks: Row[], from: string, to: string): Due[] {
  const have = new Set(tasks.filter((t) => t.RoutineKey).map((t) => `${t.RoutineKey}|${t.RoutineDate}`));
  const out: Due[] = [];
  for (const r of routines) {
    if (!r.active) continue;
    for (const date of occurrences(r, from, to)) if (!have.has(`${r.id}|${date}`)) out.push({ routine: r, date });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.routine.title.localeCompare(b.routine.title));
}

/** The task to create for one occurrence. */
export function routineTask(due: Due, key: string, clientName?: string): Row {
  const { routine: r, date } = due;
  return {
    Key: key, Title: r.title, ClientKey: r.clientKey || "", ProjectKey: r.projectKey || "", PlannedDate: date,
    EstimateHours: r.hours, Status: "Open", Type: "Routine", RoutineKey: r.id, RoutineDate: date,
    ...(clientName ? { ClientName: clientName } : {}),
  };
}

export const describeRoutine = (r: Routine): string => {
  const days = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
  return r.every === "week" ? `Every ${days[r.weekday]}` : `Monthly, on the ${r.monthDay}${["th", "st", "nd", "rd"][r.monthDay % 10 > 3 || [11, 12, 13].includes(r.monthDay) ? 0 : r.monthDay % 10]}`;
};
