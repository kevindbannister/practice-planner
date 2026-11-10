// Time and performance reports. Pure functions over the entries, the planned sessions and the jobs; the screens pick the dates and who may see what.
//
// DENOMINATORS (so a percentage always means the same thing):
//   Utilisation        = recorded time ÷ capacity (working hours in the period, from the day-type settings; days off count nothing).
//   Billable utilisation = billable time ÷ capacity.
//   Billable share     = billable time ÷ recorded time.
//   Realisation        = value billed (net of write-downs) ÷ value at charge rate, for time that has been billed or written off.
//   Estimating accuracy = actual hours ÷ estimated hours for finished jobs with both.
// Time not recorded is shown as "not accounted for" and is never counted as unproductive. Money is pence, net of VAT.
import { Rec, Ctx, chargeValue, billableByTime, rateContext, inFixedFee } from "./timeBilling";
import { Billable, billableOf, entryMinutes } from "./timesheet";
import { resolveRate, valueOf } from "./rates";
import { Session, PlanEvent, historical } from "./planSessions";

export type JobRef = { key: string; title: string; clientKey: string; serviceKey: string; feePence: number; estimateHours: number; done: boolean; doneOn: string };

// ------------------------------------------------------------------ exports

/** Spreadsheet programs run text that starts with = + - @ as a formula: a cell like that is prefixed with ' so exported text stays text. Numbers are left alone. */
export const safeCell = (v: unknown): string | number => (typeof v === "number" ? v : /^[=+\-@\t\r]/.test(String(v ?? "")) ? `'${v}` : String(v ?? ""));
export const toCsv = (rows: unknown[][]): string => rows.map((r) => r.map((v) => { const x = String(safeCell(v)); return /[",\r\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; }).join(",")).join("\r\n");
export const pounds = (p: number) => (p / 100).toFixed(2);
export const hoursText = (m: number) => (m / 60).toFixed(2);

const within = (e: Rec, from: string, to: string) => e.workDate >= from && e.workDate <= to && !!e.ended;

// ------------------------------------------------------------------ my time

export type MyTime = { days: { date: string; minutes: number }[]; total: number; byType: Record<Billable, number>; byClient: { clientKey: string; minutes: number }[]; byJob: { jobKey: string; minutes: number }[]; unapproved: number };
export function myTime(recs: Rec[], user: string, from: string, to: string, c: Ctx): MyTime {
  const mine = recs.filter((e) => e.by.toLowerCase() === user.toLowerCase() && within(e, from, to));
  const byDay = new Map<string, number>(), cl = new Map<string, number>(), jb = new Map<string, number>();
  const byType: Record<Billable, number> = { billable: 0, nonbillable: 0, internal: 0 };
  let total = 0, unapproved = 0;
  for (const e of mine) {
    const m = entryMinutes(e, c.now);
    total += m; byDay.set(e.workDate, (byDay.get(e.workDate) || 0) + m); byType[billableOf(e, c.activities)] += m;
    if (e.clientKey) cl.set(e.clientKey, (cl.get(e.clientKey) || 0) + m);
    if (e.jobKey) jb.set(e.jobKey, (jb.get(e.jobKey) || 0) + m);
    if (e.approval !== "approved") unapproved += m;
  }
  const top = <T,>(m: Map<string, number>, f: (k: string, v: number) => T) => [...m].sort((a, b) => b[1] - a[1]).map(([k, v]) => f(k, v));
  return { days: [...byDay].sort().map(([date, minutes]) => ({ date, minutes })), total, byType, byClient: top(cl, (clientKey, minutes) => ({ clientKey, minutes })), byJob: top(jb, (jobKey, minutes) => ({ jobKey, minutes })), unapproved };
}

// ------------------------------------------------------------------ planned against actual

export type PvA = { sessionKey: string; itemKey: string; title: string; clientKey: string; date: string; status: string; plannedMinutes: number; actualMinutes: number; varianceMinutes: number };
export type PvASummary = { rows: PvA[]; planned: number; actual: number; completedShare: number | null; unplannedMinutes: number };
/** What was planned (from the sessions as they stood, kept permanently) against what was recorded on that item that day. Time on a job on a day with no session is "unplanned". */
export function plannedVsActual(sessions: Session[], recs: Rec[], from: string, to: string, c: Ctx, user = ""): PvASummary {
  const list = historical(sessions, from, to).filter((x) => !user || x.userKey.toLowerCase() === user.toLowerCase() || !x.userKey);
  const used = new Set<string>();
  const rows: PvA[] = list.map((x) => {
    const mine = recs.filter((e) => within(e, from, to) && e.workDate === x.date && (x.kind === "job" ? e.jobKey === x.itemKey : e.taskKey === x.itemKey) && (!user || e.by.toLowerCase() === user.toLowerCase()));
    const linked = recs.filter((e) => e.sessionKey === x.key);
    const take = linked.length ? linked : mine;
    take.forEach((e) => used.add(e.key));
    const actual = take.reduce((t, e) => t + entryMinutes(e, c.now), 0);
    return { sessionKey: x.key, itemKey: x.itemKey, title: x.title, clientKey: x.clientKey, date: x.date, status: x.status, plannedMinutes: x.minutes, actualMinutes: actual, varianceMinutes: actual - x.minutes };
  });
  const unplanned = recs.filter((e) => within(e, from, to) && !used.has(e.key) && (e.jobKey || e.taskKey) && (!user || e.by.toLowerCase() === user.toLowerCase())).reduce((t, e) => t + entryMinutes(e, c.now), 0);
  const done = list.filter((x) => x.status === "completed").length;
  return { rows, planned: rows.reduce((t, r) => t + r.plannedMinutes, 0), actual: rows.reduce((t, r) => t + r.actualMinutes, 0), completedShare: list.length ? Math.round((done / list.length) * 100) : null, unplannedMinutes: unplanned };
}

// ------------------------------------------------------------------ rescheduling

export type Resched = { moves: number; minutesMoved: number; reasons: { reason: string; count: number }[]; repeated: { itemKey: string; title: string; moves: number }[]; byJob: { itemKey: string; title: string; moves: number; minutes: number }[] };
/** How often planned work was moved. A move is a session replaced by a later one (it is in history as rescheduled). Reasons are the ones people gave; "no reason given" is counted too. `repeatAt` moves or more marks a job as repeatedly delayed. */
export function reschedulingReport(sessions: Session[], events: PlanEvent[], from: string, to: string, repeatAt = 3): Resched {
  const moved = sessions.filter((x) => x.status === "rescheduled" && x.date >= from && x.date <= to);
  const reasons = new Map<string, number>(), by = new Map<string, { title: string; moves: number; minutes: number }>();
  for (const x of moved) {
    const r = x.reason || events.find((e) => e.sessionKey === x.key && e.type === "reschedule" && e.reason)?.reason || "No reason given";
    reasons.set(r, (reasons.get(r) || 0) + 1);
    const j = by.get(x.itemKey) || { title: x.title, moves: 0, minutes: 0 };
    j.moves++; j.minutes += x.minutes; by.set(x.itemKey, j);
  }
  const byJob = [...by].map(([itemKey, v]) => ({ itemKey, ...v })).sort((a, b) => b.moves - a.moves || a.title.localeCompare(b.title));
  return { moves: moved.length, minutesMoved: moved.reduce((t, x) => t + x.minutes, 0), reasons: [...reasons].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count), repeated: byJob.filter((j) => j.moves >= repeatAt).map((j) => ({ itemKey: j.itemKey, title: j.title, moves: j.moves })), byJob };
}

// ------------------------------------------------------------------ utilisation

export type Utilisation = { user: string; capacity: number; recorded: number; billable: number; nonbillable: number; internal: number; unaccounted: number; utilisationPct: number | null; billablePct: number | null; billableShare: number | null };
/** `capacity(date)` is the working minutes for that day (0 for a day off). Per person; people with no entries still appear if listed in `users`. */
export function utilisation(recs: Rec[], users: string[], from: string, to: string, capacity: (date: string, user: string) => number, c: Ctx): Utilisation[] {
  const days: string[] = [];
  for (let d = new Date(`${from}T12:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) days.push(d.toISOString().slice(0, 10));
  return users.map((user) => {
    const cap = days.reduce((t, d) => t + capacity(d, user), 0);
    const t = { billable: 0, nonbillable: 0, internal: 0 };
    for (const e of recs) if (e.by.toLowerCase() === user.toLowerCase() && within(e, from, to)) t[billableOf(e, c.activities)] += entryMinutes(e, c.now);
    const recorded = t.billable + t.nonbillable + t.internal;
    return { user, capacity: cap, recorded, ...t, unaccounted: Math.max(0, cap - recorded), utilisationPct: cap > 0 ? Math.round((recorded / cap) * 1000) / 10 : null, billablePct: cap > 0 ? Math.round((t.billable / cap) * 1000) / 10 : null, billableShare: recorded > 0 ? Math.round((t.billable / recorded) * 1000) / 10 : null };
  });
}

// ------------------------------------------------------------------ profitability

export type Group = "client" | "service" | "job" | "user" | "month";
export type Profit = { key: string; minutes: number; billableMinutes: number; feePence: number; timeValuePence: number; billedPence: number; costPence: number; contributionPence: number; marginPct: number | null; effectivePencePerHour: number | null; missingCost: number; missingRate: number };
/** Profit by client, service, job, person or month. Revenue is the fixed fee of jobs completed in the period, plus time-based value (net of write-downs and write-offs) for time done in it; cost is the labour cost of all time in it. Time with no cost rate adds nothing to cost and is counted as `missingCost` so the figure is never quietly flattering. */
export function profitability(recs: Rec[], jobs: JobRef[], group: Group, from: string, to: string, c: Ctx): Profit[] {
  const by = new Map<string, Profit>();
  const get = (k: string) => { if (!by.has(k)) by.set(k, { key: k, minutes: 0, billableMinutes: 0, feePence: 0, timeValuePence: 0, billedPence: 0, costPence: 0, contributionPence: 0, marginPct: null, effectivePencePerHour: null, missingCost: 0, missingRate: 0 }); return by.get(k)!; };
  const jobOf = new Map(jobs.map((j) => [j.key, j]));
  const keyOf = (e: Rec) => { const j = jobOf.get(e.jobKey); return group === "client" ? e.clientKey || j?.clientKey || "" : group === "service" ? j?.serviceKey || "" : group === "job" ? e.jobKey : group === "user" ? e.by : e.workDate.slice(0, 7); };
  for (const e of recs) {
    if (!within(e, from, to)) continue;
    const g = get(keyOf(e)), m = entryMinutes(e, c.now), ctx = rateContext(e, c), cost = resolveRate(c.rates, "cost", ctx);
    g.minutes += m;
    if (cost) g.costPence += valueOf(m, cost.pence); else g.missingCost++;
    if (billableByTime(e, c)) { const v = chargeValue(e, c); g.billableMinutes += m; g.timeValuePence += v.pence; if (e.bill === "billed") g.billedPence += v.pence; if (v.missingRate) g.missingRate++; }
    else if (inFixedFee(e, c.jobs)) g.billableMinutes += billableOf(e, c.activities) === "billable" ? m : 0;
  }
  for (const j of jobs) if (j.done && j.doneOn >= from && j.doneOn <= to && j.feePence > 0) {
    const k = group === "client" ? j.clientKey : group === "service" ? j.serviceKey : group === "job" ? j.key : group === "month" ? j.doneOn.slice(0, 7) : "";
    if (group === "user") continue; // a fixed fee is the practice's, not one person's
    get(k).feePence += j.feePence;
  }
  for (const g of by.values()) {
    const revenue = g.feePence + g.timeValuePence;
    g.contributionPence = revenue - g.costPence;
    g.marginPct = revenue > 0 ? Math.round((g.contributionPence / revenue) * 1000) / 10 : null;
    g.effectivePencePerHour = g.minutes > 0 && revenue > 0 ? Math.round((revenue * 60) / g.minutes) : null;
  }
  return [...by.values()].sort((a, b) => b.contributionPence - a.contributionPence);
}

// ------------------------------------------------------------------ estimating accuracy

export type Accuracy = { key: string; title: string; clientKey: string; serviceKey: string; estimate: number; actual: number; varianceHours: number; ratioPct: number };
/** Finished jobs with an estimate and some recorded time: how far off the estimate was. Over 100% means it took longer than estimated. */
export function estimatingAccuracy(recs: Rec[], jobs: JobRef[], from: string, to: string, c: Ctx): { rows: Accuracy[]; overall: number | null } {
  const rows: Accuracy[] = [];
  for (const j of jobs) {
    if (!j.done || !(j.estimateHours > 0) || j.doneOn < from || j.doneOn > to) continue;
    const actual = recs.filter((e) => e.jobKey === j.key && e.ended).reduce((t, e) => t + entryMinutes(e, c.now), 0) / 60;
    if (!(actual > 0)) continue;
    rows.push({ key: j.key, title: j.title, clientKey: j.clientKey, serviceKey: j.serviceKey, estimate: j.estimateHours, actual: Math.round(actual * 100) / 100, varianceHours: Math.round((actual - j.estimateHours) * 100) / 100, ratioPct: Math.round((actual / j.estimateHours) * 100) });
  }
  const est = rows.reduce((t, r) => t + r.estimate, 0), act = rows.reduce((t, r) => t + r.actual, 0);
  return { rows: rows.sort((a, b) => b.varianceHours - a.varianceHours), overall: est > 0 ? Math.round((act / est) * 100) : null };
}
