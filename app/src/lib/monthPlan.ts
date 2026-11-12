// The month calendar of the plan: for each day, what is planned on it, how many hours that is against the hours available, and what is due. Pure, so it can be tested.
import { addDays, mondayOf } from "./planning";

export type MonthItem = { key: string; kind: "job" | "task"; title: string; client: string; serviceKey?: string; hours: number; planned: string; deadline: string; statutory: boolean; held: boolean; done: boolean; doneOn: string };
export type Cell = { date: string; inMonth: boolean; today: boolean; weekend: boolean; planned: MonthItem[]; due: MonthItem[]; done: MonthItem[]; plannedHours: number; capacity: number; over: boolean };
export type Show = "all" | "statutory" | "other";

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
export function buildMonth(key: string, items: MonthItem[], capacityOn: (date: string) => number, today: string, show: Show = "all"): { weeks: Cell[][]; totals: { planned: number; capacity: number; due: number; unplanned: number } } {
  const keep = (i: MonthItem) => show === "all" || (show === "statutory") === i.statutory;
  const live = items.filter((i) => keep(i) && !i.held);
  const by = (f: (i: MonthItem) => string, list: MonthItem[]) => { const m = new Map<string, MonthItem[]>(); for (const i of list) { const d = f(i); if (!d) continue; (m.get(d) || m.set(d, []).get(d)!).push(i); } return m; };
  const planned = by((i) => i.planned, live.filter((i) => !i.done)), due = by((i) => i.deadline, live.filter((i) => !i.done)), done = by((i) => i.doneOn, live.filter((i) => i.done));
  const weeks = weeksOf(key).map((w) => w.map((date): Cell => {
    const p = (planned.get(date) || []).sort((a, b) => b.hours - a.hours || a.client.localeCompare(b.client)); const cap = capacityOn(date); const hrs = Math.round(p.reduce((t, i) => t + i.hours, 0) * 100) / 100;
    return { date, inMonth: monthKey(date) === key, today: date === today, weekend: dow(date) >= 5, planned: p, due: due.get(date) || [], done: done.get(date) || [], plannedHours: hrs, capacity: cap, over: hrs > cap + 1e-9 };
  }));
  const inMonth = weeks.flat().filter((c) => c.inMonth);
  const dueItems = inMonth.flatMap((c) => c.due);
  return { weeks, totals: { planned: Math.round(inMonth.reduce((t, c) => t + c.plannedHours, 0) * 100) / 100, capacity: Math.round(inMonth.reduce((t, c) => t + c.capacity, 0) * 100) / 100, due: dueItems.length, unplanned: dueItems.filter((i) => !i.planned).length } };
}
