// The month calendar of the plan: for each day, what is planned on it, how many hours that is against the hours available, and what is due. Pure, so it can be tested.
import { addDays, mondayOf } from "./planning";

export type MonthItem = { key: string; kind: "job" | "task"; title: string; client: string; serviceKey?: string; hours: number; planned: string; deadline: string; statutory: boolean; held: boolean; done: boolean; doneOn: string; /** the end of the period a job is for, if it has one */ period?: string };
export type Cell = { date: string; inMonth: boolean; today: boolean; weekend: boolean; planned: MonthItem[]; due: MonthItem[]; done: MonthItem[]; plannedHours: number; capacity: number; over: boolean };
export type Show = "all" | "statutory" | "other";

/** `count` whole weeks (Monday first) from the Monday on or before `from`: the days of a rolling view. */
export const rollingWeeks = (from: string, count = 6): string[][] => { const start = mondayOf(from); return Array.from({ length: count }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d))); };
export const monthKey = (iso: string) => iso.slice(0, 7);
export const shiftMonth = (key: string, by: number) => { const d = new Date(`${key}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + by); return d.toISOString().slice(0, 7); };
const dow = (iso: string) => (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0

/** The weeks (Monday first) that cover the month, 5 or 6 of them. */
export function weeksOf(key: string): string[][] {
  const first = `${key}-01`; const last = shiftMonth(key, 1) + "-01";
  const out: string[][] = []; let start = mondayOf(first);
  while (start < last) { out.push(Array.from({ length: 7 }, (_, i) => addDays(start, i))); start = addDays(start, 7); }
  return out;
}

/** Held (on hold) work is off the plan. Planned work shows on its planned day, finished work on the day it was finished, due dates on the day they fall.
 *  Capacity is the hours available that day for client and business work together; a day with none (a weekend, a day off) has capacity 0. */
export function buildMonth(key: string, items: MonthItem[], capacityOn: (date: string) => number, today: string, show: Show = "all", weeksOverride?: string[][]): { weeks: Cell[][]; totals: { planned: number; capacity: number; due: number; unplanned: number } } {
  const keep = (i: MonthItem) => show === "all" || (show === "statutory") === i.statutory;
  const live = items.filter((i) => keep(i) && !i.held);
  const by = (f: (i: MonthItem) => string, list: MonthItem[]) => { const m = new Map<string, MonthItem[]>(); for (const i of list) { const d = f(i); if (!d) continue; (m.get(d) || m.set(d, []).get(d)!).push(i); } return m; };
  const planned = by((i) => i.planned, live.filter((i) => !i.done)), due = by((i) => i.deadline, live.filter((i) => !i.done)), done = by((i) => i.doneOn, live.filter((i) => i.done));
  const weeks = (weeksOverride || weeksOf(key)).map((w) => w.map((date): Cell => {
    const p = (planned.get(date) || []).sort((a, b) => b.hours - a.hours || a.client.localeCompare(b.client)); const cap = capacityOn(date); const hrs = Math.round(p.reduce((t, i) => t + i.hours, 0) * 100) / 100;
    return { date, inMonth: weeksOverride ? true : monthKey(date) === key, today: date === today, weekend: dow(date) >= 5, planned: p, due: due.get(date) || [], done: done.get(date) || [], plannedHours: hrs, capacity: cap, over: hrs > cap + 1e-9 };
  }));
  const inMonth = weeks.flat().filter((c) => c.inMonth);
  const dueItems = inMonth.flatMap((c) => c.due);
  return { weeks, totals: { planned: Math.round(inMonth.reduce((t, c) => t + c.plannedHours, 0) * 100) / 100, capacity: Math.round(inMonth.reduce((t, c) => t + c.capacity, 0) * 100) / 100, due: dueItems.length, unplanned: dueItems.filter((i) => !i.planned).length } };
}

export type DueFilter = "all" | "overdue" | "30" | "90" | "none";
export type UnplannedFilter = { due?: DueFilter; type?: string; client?: string };
/** The kind of work an item is, for filtering: tasks together, jobs by service. */
export const typeOf = (i: MonthItem): string => (i.kind === "task" ? "TASK" : i.serviceKey || "OTHER");
const gap = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);

/** Work with no planned day yet (not held, not finished), earliest deadline first, then the ones with no deadline. Follows the same statutory / other filter as the calendar, and can be narrowed by when it is due, what kind of work it is and which client. */
export function unplannedOf(items: MonthItem[], show: Show = "all", search = "", f: UnplannedFilter = {}, today = ""): MonthItem[] {
  const q = search.trim().toLowerCase();
  const dueOk = (i: MonthItem) => {
    switch (f.due) {
      case "overdue": return !!i.deadline && !!today && i.deadline < today;
      case "30": return !!i.deadline && !!today && gap(i.deadline, today) <= 30;
      case "90": return !!i.deadline && !!today && gap(i.deadline, today) <= 90;
      case "none": return !i.deadline;
      default: return true;
    }
  };
  return items.filter((i) => !i.planned && !i.done && !i.held && (show === "all" || (show === "statutory") === i.statutory) && (!q || `${i.client} ${i.title}`.toLowerCase().includes(q)) && dueOk(i) && (!f.type || typeOf(i) === f.type) && (!f.client || i.client === f.client))
    .sort((a, b) => (a.deadline || "9999").localeCompare(b.deadline || "9999") || a.client.localeCompare(b.client));
}
