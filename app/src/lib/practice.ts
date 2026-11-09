// The practice at a glance: one read-only summary of how the whole firm is doing, built from what the app already holds.
// Work and deadlines, capacity, who carries what, where the money comes from, which clients earn least for the time spent,
// compliance gaps and growth. Nothing here changes data; every figure points back to the screen with the detail.
import { position } from "./amlAssessment";
import { Client, Job, Task, daysBetween, isOnHold, isOpen, jobState, waitingOn } from "./domain";
import { feeReviewsDue, readFeeLine, revenue } from "./fees";
import { forecast } from "./forecast";
import { liveLinkFor, readLink } from "./billing";
import { readTime } from "./jobTime";
import { addDays } from "./planning";
import { isBusinessTask } from "./projects";
import { STATUTORY } from "./plannerChecks";
import { salesReport } from "./reports";
import { Row } from "./schema";

const str = (v: unknown): string => (v === undefined || v === null ? "" : String(v));
const r2 = (n: number) => Math.round(n * 100) / 100;

export const DEFAULT_TARGET_RATE = 75; // pounds an hour a client's fees should come to against recorded time
export const MIN_RATED_HOURS = 5; // below this the recorded time says too little to rate a client
export const PRACTICE_RATE_KEY = "practice.targetRate";
export const readTargetRate = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) && n > 0 && n <= 1000 ? n : DEFAULT_TARGET_RATE; };

export type PracticeInput = {
  clients: Row[]; jobs: Row[]; tasks: Row[]; services: Row[]; clientServices: Row[]; charges: Row[]; costs: Row[]; time: Row[]; billingLinks: Row[];
  amlAssessments: Row[]; onboardings: Row[]; leads: Row[]; opps: Row[]; proposals: Row[]; versions: Row[];
  capacity: (iso: string) => number; today: string; targetRate: number;
};

export type OverdueJob = { key: string; clientKey: string; title: string; days: number; deadline: string };
export type DeadlineMonth = { key: string; total: number; statutory: number };
export type OwnerLoad = { owner: string; clients: number; arr: number; open: number; overdue: number };
export type RateRow = { clientKey: string; arr: number; hours: number; rate: number; below: boolean };
export type PracticeView = {
  clients: { active: number; byKind: { kind: string; count: number }[] };
  work: { open: number; overdue: number; tight: number; onTrack: number; waiting: number; held: number; oldest: OverdueJob[]; deadlines: DeadlineMonth[] };
  capacity: { lateHours: number; months: { key: string; due: number; capacity: number; pct: number }[]; next3Due: number; next3Capacity: number; next3Pct: number; peak?: { key: string; pct: number } };
  team: OwnerLoad[];
  money: {
    arr: number; mrr: number; oneOff: number; heldArr: number; top5Pct: number; top: { clientKey: string; arr: number; pct: number }[]; byService: { serviceKey: string; arr: number; clients: number }[];
    reviewsDue: number; noFee: { clientKey: string; openJobs: number }[]; billing: { lines: number; active: number; draft: number; none: number };
  };
  profit: { rows: RateRow[]; practiceRate?: number; target: number; rated: number; withFees: number; trackedHours: number };
  compliance: { amlNone: string[]; amlOverdue: string[]; amlSoon: string[]; noLetter: string[]; gaps: number };
  growth: { openOpps: number; openValue: number; wonRecent: number; wonRecentValue: number; acceptedRecurring: number };
};

export function practiceView(i: PracticeInput): PracticeView {
  const today = i.today;
  const clients = (i.clients as Client[]).filter((c) => str(c.Status) !== "Archived");
  const activeKeys = new Set(clients.map((c) => str(c.Key)));
  const jobs = (i.jobs as Job[]).filter((j) => isOpen(j) && activeKeys.has(str(j.ClientKey)));

  // ---- work and deadlines
  let overdue = 0, tight = 0, onTrack = 0, waiting = 0, held = 0;
  const late: OverdueJob[] = [];
  for (const j of jobs) {
    if (isOnHold(j)) { held++; if (waitingOn(j)) waiting++; continue; }
    const st = jobState(j, today);
    if (st.state === "overdue") { overdue++; late.push({ key: str(j.Key), clientKey: str(j.ClientKey), title: str(j.Title), days: -(st.days ?? 0), deadline: str(j.Deadline) }); }
    else if (st.state === "tight") tight++; else onTrack++;
  }
  const months: DeadlineMonth[] = [];
  for (let n = 0, d = `${today.slice(0, 7)}-01`; n < 6; n++, d = addDays(d.slice(0, 7) + "-28", 5).slice(0, 7) + "-01") months.push({ key: d.slice(0, 7), total: 0, statutory: 0 });
  for (const j of jobs) { const m = months.find((x) => x.key === str(j.Deadline).slice(0, 7)); if (m) { m.total++; if (STATUTORY[str(j.ServiceKey)]) m.statutory++; } }

  // ---- capacity
  const f = forecast((i.jobs as Job[]).filter((j) => activeKeys.has(str(j.ClientKey))), (i.tasks as Task[]).filter((t) => !isBusinessTask(t)), i.services, i.capacity, today, 6);
  const capMonths = f.months.map((m) => ({ key: m.key, due: r2(m.due), capacity: r2(m.capacity), pct: m.capacity > 0 ? Math.round((m.due / m.capacity) * 100) : m.due > 0 ? 999 : 0 }));
  const n3 = capMonths.slice(0, 3);
  const next3Due = r2(n3.reduce((a, m) => a + m.due, 0)), next3Capacity = r2(n3.reduce((a, m) => a + m.capacity, 0));
  const peak = [...capMonths].sort((a, b) => b.pct - a.pct)[0];

  // ---- money
  const schedule = i.clientServices.filter((r) => activeKeys.has(str(r.ClientKey)));
  const rev = revenue(schedule, i.charges.filter((r) => activeKeys.has(str(r.ClientKey))), i.costs);
  const topArr = rev.byClient.filter((c) => c.arr > 0).sort((a, b) => b.arr - a.arr);
  const top5 = topArr.slice(0, 5);
  const lines = schedule.map(readFeeLine);
  const covered = new Set<string>([...lines.filter((l) => l.status === "active" || l.status === "included" || l.status === "held").map((l) => l.clientKey), ...i.charges.filter((r) => str(r.Status) === "agreed").map((r) => str(r.ClientKey))]);
  const openBy = new Map<string, number>();
  for (const j of jobs) openBy.set(str(j.ClientKey), (openBy.get(str(j.ClientKey)) || 0) + 1);
  const noFee = [...openBy.entries()].filter(([k]) => !covered.has(k) && !(Number((clients.find((c) => str(c.Key) === k) as Client | undefined)?.AnnualFees) > 0)).map(([clientKey, openJobs]) => ({ clientKey, openJobs })).sort((a, b) => b.openJobs - a.openJobs);
  const recurring = schedule.map((r) => ({ r, l: readFeeLine(r) })).filter((x) => x.l.status === "active" && !x.l.oneOff && x.l.fee > 0);
  const states = recurring.map((x) => { const row = liveLinkFor(i.billingLinks, x.l.key); return row ? readLink(row).status : "none"; });

  // ---- who carries what (the manager, else the partner)
  const owner = (c: Row) => str(c.Manager) || str(c.Partner) || "(no manager or partner)";
  const team = new Map<string, OwnerLoad>();
  for (const c of clients) { const o = owner(c); const e = team.get(o) || { owner: o, clients: 0, arr: 0, open: 0, overdue: 0 }; e.clients++; e.arr += rev.byClient.find((b) => b.clientKey === str(c.Key))?.arr || 0; team.set(o, e); }
  for (const j of jobs) { const c = clients.find((x) => str(x.Key) === str(j.ClientKey)); if (!c || isOnHold(j)) continue; const e = team.get(owner(c))!; e.open++; if (jobState(j, today).state === "overdue") e.overdue++; }

  // ---- fees against recorded time, last 12 months
  const since = addDays(today, -365);
  const hours = new Map<string, number>();
  for (const t of i.time.map(readTime)) if (t.ended && t.started.slice(0, 10) >= since && activeKeys.has(t.clientKey)) hours.set(t.clientKey, (hours.get(t.clientKey) || 0) + t.hours);
  const withFees = rev.byClient.filter((c) => c.arr > 0);
  const rows: RateRow[] = withFees.filter((c) => (hours.get(c.clientKey) || 0) >= MIN_RATED_HOURS).map((c) => { const h = hours.get(c.clientKey)!; const rate = c.arr / h; return { clientKey: c.clientKey, arr: c.arr, hours: r2(h), rate: r2(rate), below: rate < i.targetRate }; }).sort((a, b) => a.rate - b.rate);
  const rArr = rows.reduce((a, x) => a + x.arr, 0), rHours = rows.reduce((a, x) => a + x.hours, 0);

  // ---- compliance
  const amlNone: string[] = [], amlOverdue: string[] = [], amlSoon: string[] = [], noLetter: string[] = [];
  for (const c of clients) {
    const p = position(c, i.amlAssessments, i.onboardings, today);
    if (p.state === "none" || p.state === "declined" || p.state === "stopped") amlNone.push(str(c.Key)); else if (p.state === "overdue") amlOverdue.push(str(c.Key)); else if (p.state === "soon") amlSoon.push(str(c.Key));
    if (str(c.LoEStatus) !== "Finalised") noLetter.push(str(c.Key));
  }

  // ---- growth
  const rep = salesReport({ leads: i.leads as any, opps: i.opps as any, proposals: i.proposals, versions: i.versions, onboardings: i.onboardings, from: addDays(today, -90), to: today });
  const kinds = new Map<string, number>();
  for (const c of clients) kinds.set(str(c.Kind) || "Other", (kinds.get(str(c.Kind) || "Other") || 0) + 1);

  return {
    clients: { active: clients.length, byKind: [...kinds.entries()].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count) },
    work: { open: jobs.length, overdue, tight, onTrack, waiting, held, oldest: late.sort((a, b) => b.days - a.days).slice(0, 8), deadlines: months },
    capacity: { lateHours: r2(f.lateHours), months: capMonths, next3Due, next3Capacity, next3Pct: next3Capacity > 0 ? Math.round((next3Due / next3Capacity) * 100) : 0, peak: peak && peak.pct > 0 ? { key: peak.key, pct: peak.pct } : undefined },
    team: [...team.values()].map((t) => ({ ...t, arr: r2(t.arr) })).sort((a, b) => b.arr - a.arr),
    money: {
      arr: rev.arr, mrr: rev.mrr, oneOff: rev.oneOff, heldArr: rev.heldArr,
      top5Pct: rev.arr > 0 ? Math.round((top5.reduce((a, c) => a + c.arr, 0) / rev.arr) * 100) : 0,
      top: top5.map((c) => ({ clientKey: c.clientKey, arr: c.arr, pct: rev.arr > 0 ? Math.round((c.arr / rev.arr) * 100) : 0 })),
      byService: rev.byService.filter((s) => s.arr > 0).slice(0, 6).map((s) => ({ serviceKey: s.serviceKey, arr: s.arr, clients: s.clients })),
      reviewsDue: feeReviewsDue(schedule, today, 30).length, noFee: noFee.slice(0, 8),
      billing: { lines: recurring.length, active: states.filter((s) => s === "active").length, draft: states.filter((s) => s === "draft").length, none: states.filter((s) => s === "none").length },
    },
    profit: { rows, practiceRate: rHours > 0 ? r2(rArr / rHours) : undefined, target: i.targetRate, rated: rows.length, withFees: withFees.length, trackedHours: r2(rHours) },
    compliance: { amlNone, amlOverdue, amlSoon, noLetter, gaps: new Set([...amlNone, ...amlOverdue]).size },
    growth: { openOpps: rep.opps.open, openValue: rep.opps.openValue, wonRecent: rep.opps.won, wonRecentValue: rep.opps.wonValue, acceptedRecurring: rep.acceptedValue.recurring },
  };
}

/** "2026-11" as "Nov 2026". */
export const monthLabel = (key: string) => new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
export const daysUntil = (from: string, to: string) => daysBetween(from, to);
