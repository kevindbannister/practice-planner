// Months ahead: for each month, the hours of work due against the hours you have. It counts
// open jobs and tasks by their deadline, and also the jobs that will exist by then: each
// recurring job is rolled forward by its type's rule (next quarter's VAT, next month's payroll).
import { Job, Task, isOnHold, isOpen } from "./domain";
import { Hours, addDays, jobHours, nextPeriod, parseIso, ruleFor, toIso } from "./planning";
import { Row } from "./schema";

export type ForecastItem = {
  key: string;
  kind: "job" | "task" | "expected";
  clientKey?: string;
  title: string;
  serviceKey?: string;
  periodEnd?: string;
  deadline: string;
  hours: number;
  planned?: string;
  held?: boolean;
};

export type Month = {
  key: string; // "2026-10"
  start: string;
  end: string;
  capacity: number; // working hours left in the month
  items: ForecastItem[];
  due: number; // all hours due this month (not counting on hold)
  planned: number; // of which already planned
  expected: number; // of which from jobs not created yet
  cumulativeDue: number;
  cumulativeCapacity: number;
};

export const monthKey = (iso: string) => iso.slice(0, 7);

function monthEnd(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return toIso(new Date(Date.UTC(y, m, 0)));
}

/** Working hours from `from` to `to` inclusive, using your hours per weekday. */
export function capacityBetween(from: string, to: string, hours: Hours): number {
  let total = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const wd = parseIso(d).getUTCDay();
    if (wd >= 1 && wd <= 5) total += hours[String(wd) as keyof Hours] || 0;
  }
  return total;
}

/** Future periods of a recurring job, up to `until`, as expected work. */
export function expectedAfter(job: Job, services: Row[], until: string): ForecastItem[] {
  const rule = ruleFor(job.ServiceKey, services);
  const out: ForecastItem[] = [];
  let pe = job.PeriodEnd;
  let dl = job.Deadline;
  for (let i = 0; i < 40 && pe && dl; i++) {
    const next = nextPeriod(rule, pe, dl);
    if (!next || next.Deadline > until) break;
    out.push({
      key: `${job.Key}+${i + 1}`, kind: "expected", clientKey: job.ClientKey, title: job.Title, serviceKey: job.ServiceKey,
      periodEnd: next.PeriodEnd, deadline: next.Deadline, hours: jobHours({ ServiceKey: job.ServiceKey, EstimateHours: (job.ActualHours as number) || job.EstimateHours }, services),
    });
    pe = next.PeriodEnd;
    dl = next.Deadline;
  }
  return out;
}

export type Forecast = { late: ForecastItem[]; lateHours: number; months: Month[] };

export function forecast(jobs: Job[], tasks: Task[], services: Row[], hours: Hours, today: string, count = 12): Forecast {
  const firstKey = monthKey(today);
  const keys: string[] = [];
  for (let i = 0, d = `${firstKey}-01`; i < count; i++) {
    keys.push(monthKey(d));
    d = addDays(monthEnd(monthKey(d)), 1);
  }
  const until = monthEnd(keys[keys.length - 1]);

  const items: ForecastItem[] = [];
  for (const j of jobs) {
    if (!isOpen(j)) continue;
    if (j.Deadline) {
      items.push({
        key: j.Key, kind: "job", clientKey: j.ClientKey, title: j.Title, serviceKey: j.ServiceKey, periodEnd: j.PeriodEnd,
        deadline: j.Deadline, hours: jobHours(j, services), planned: j.PlannedDate, held: isOnHold(j),
      });
    }
    items.push(...expectedAfter(j, services, until));
  }
  for (const t of tasks) {
    if (!isOpen(t) || !t.DueDate) continue;
    items.push({ key: t.Key, kind: "task", clientKey: t.ClientKey, title: t.Title, deadline: t.DueDate, hours: t.EstimateHours || 1, planned: t.PlannedDate, held: isOnHold(t) });
  }

  const late = items.filter((i) => i.deadline < today && i.kind !== "expected").sort((a, b) => a.deadline.localeCompare(b.deadline));
  const lateHours = late.filter((i) => !i.held).reduce((t, i) => t + i.hours, 0);
  let cumDue = lateHours;
  let cumCap = 0;
  const months = keys.map((key) => {
    const start = key === firstKey ? today : `${key}-01`;
    const end = monthEnd(key);
    const these = items
      .filter((i) => i.deadline >= start && i.deadline <= end)
      .sort((a, b) => a.deadline.localeCompare(b.deadline));
    const counted = these.filter((i) => !i.held);
    const due = counted.reduce((t, i) => t + i.hours, 0);
    const capacity = capacityBetween(start, end, hours);
    cumDue += due;
    cumCap += capacity;
    return {
      key, start, end, capacity, items: these, due,
      planned: counted.filter((i) => i.planned).reduce((t, i) => t + i.hours, 0),
      expected: counted.filter((i) => i.kind === "expected").reduce((t, i) => t + i.hours, 0),
      cumulativeDue: cumDue, cumulativeCapacity: cumCap,
    };
  });
  return { late, lateHours, months };
}
