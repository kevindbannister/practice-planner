// Reporting for tasks, client actions, dependencies, planning reliability and workload. Every figure says what kind of figure it is:
//   fact       - counted from records that exist (a task that was completed, a chase that was logged)
//   estimate   - hours people or templates estimated, or a figure derived from estimates
//   projection - what the current dates and dependencies imply will happen, if nothing changes
// A report never invents a date or a value. Where something can't be known (no deadline, no response yet) it is left out of the average and counted separately.
import { Row } from "../schema";
import { WorkTask } from "./model";
import { TaskEvent } from "./clientActions";
import { Dependency, DepEvent } from "./dependencies";
import { Item } from "./overview";
import { Session } from "../planSessions";
import { RISK_RANK } from "./risk";

export type Basis = "fact" | "estimate" | "projection";
export const BASIS_NOTE: Record<Basis, string> = { fact: "Counted from records", estimate: "Based on estimated hours", projection: "What current dates and dependencies imply" };
export type Metric = { key: string; label: string; value: number; unit: "count" | "hours" | "days" | "percent"; basis: Basis; note?: string; /** how many were left out because the figure couldn't be worked out */ unknown?: number };
export type Group = { key: string; title: string; metrics: Metric[]; rows?: { label: string; values: Record<string, number> }[] };
export type Period = { from: string; to: string };

const day = (x: string) => String(x || "").slice(0, 10);
const inP = (x: string, p: Period) => !!x && day(x) >= p.from && day(x) <= p.to;
const diffDays = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 86400000;
const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : 0);
const r1 = (n: number) => Math.round(n * 100) / 100;
const finished = (st: string) => st === "Done" || st === "Complete" || st === "Cancelled";
const M = (key: string, label: string, value: number, unit: Metric["unit"], basis: Basis, extra: Partial<Metric> = {}): Metric => ({ key, label, value, unit, basis, ...extra });

/** Practice tasks only: personal and private tasks are never in a practice report. */
export const reportable = (tasks: WorkTask[]) => tasks.filter((t) => t.area !== "personal" && t.privacy !== "private");

export function taskCompletion(tasks: WorkTask[], p: Period, today: string, userName: (k: string) => string = (k) => k): Group {
  const ts = reportable(tasks).filter((t) => t.ownerType === "user");
  const created = ts.filter((t) => inP(t.created, p)), done = ts.filter((t) => t.status === "Done" && inP(t.completedAt, p));
  const overdue = ts.filter((t) => !finished(t.status) && t.dueDate && day(t.dueDate) < today);
  const times = done.filter((t) => t.created && t.completedAt).map((t) => Math.max(0, diffDays(t.created, t.completedAt)));
  const onTime = done.filter((t) => t.dueDate); const late = onTime.filter((t) => day(t.completedAt) > day(t.dueDate));
  const by = (f: (t: WorkTask) => string) => { const m = new Map<string, { created: number; completed: number; overdue: number }>(); const g = (k: string) => m.get(k) || m.set(k, { created: 0, completed: 0, overdue: 0 }).get(k)!; created.forEach((t) => g(f(t)).created++); done.forEach((t) => g(f(t)).completed++); overdue.forEach((t) => g(f(t)).overdue++); return [...m.entries()].map(([label, values]) => ({ label: label || "Unassigned", values })).sort((a, b) => b.values.overdue - a.values.overdue || a.label.localeCompare(b.label)); };
  return { key: "tasks", title: "Task completion", metrics: [
    M("created", "Created", created.length, "count", "fact"), M("completed", "Completed", done.length, "count", "fact"), M("overdue", "Overdue now", overdue.length, "count", "fact"),
    M("avg_days", "Average time to complete", avg(times), "days", "fact", { unknown: done.length - times.length, note: "From created to completed" }),
    M("late_pct", "Completed after their due date", onTime.length ? Math.round((late.length / onTime.length) * 100) : 0, "percent", "fact", { note: "Of those with a due date" }),
  ], rows: by((t) => userName(t.owner)).map((r) => ({ ...r, label: r.label })) };
}
export function taskCompletionByArea(tasks: WorkTask[], p: Period): { label: string; completed: number; created: number }[] {
  const m = new Map<string, { label: string; completed: number; created: number }>(); const g = (k: string) => m.get(k) || m.set(k, { label: k, completed: 0, created: 0 }).get(k)!;
  for (const t of reportable(tasks).filter((x) => x.ownerType === "user")) { if (inP(t.created, p)) g(t.area || "practice").created++; if (t.status === "Done" && inP(t.completedAt, p)) g(t.area || "practice").completed++; }
  return [...m.values()].sort((a, b) => b.completed - a.completed);
}

export function clientActions(tasks: WorkTask[], events: TaskEvent[], p: Period, today: string): Group {
  const cs = reportable(tasks).filter((t) => t.ownerType !== "user"), open = cs.filter((t) => !finished(t.status));
  const overdue = open.filter((t) => t.dueDate && day(t.dueDate) < today), awaiting = open.filter((t) => t.status === "Submitted");
  // response time: from the request being shared to the client submitting (both recorded as history, so this is a fact; actions without both are left out)
  const first = (k: string, type: string) => events.filter((e) => e.taskKey === k && e.type === type).sort((a, b) => a.at.localeCompare(b.at))[0];
  const answered = cs.map((t) => ({ s: first(t.key, "shared"), r: first(t.key, "client-submitted") })).filter((x) => x.s && x.r && inP(x.r.at, p));
  const asked = cs.filter((t) => first(t.key, "shared") && first(t.key, "client-submitted") == null && !finished(t.status)).length;
  const chases = events.filter((e) => (e.type.startsWith("chase-") || e.type === "escalated") && inP(e.at, p));
  const reminders = chases.filter((e) => e.type === "chase-portal" || e.type === "chase-email");
  return { key: "client", title: "Client actions", metrics: [
    M("outstanding", "Outstanding", open.length, "count", "fact"), M("overdue", "Overdue", overdue.length, "count", "fact"), M("awaiting", "Awaiting our check", awaiting.length, "count", "fact", { note: "Submitted by the client, not yet accepted" }),
    M("response", "Average response time", avg(answered.map((x) => Math.max(0, diffDays(x.s.at, x.r.at)))), "days", "fact", { unknown: asked, note: "Shared to submitted; those still unanswered are counted separately" }),
    M("reminders", "Reminders sent", reminders.length, "count", "fact"), M("chases", "Chases logged (all kinds)", chases.length, "count", "fact"), M("escalated", "Escalated", chases.filter((e) => e.type === "escalated").length, "count", "fact"),
  ] };
}

export type DepInput = { deps: Dependency[]; depEvents: DepEvent[]; items: Item[]; titleOf: (kind: "task" | "job", key: string) => string };
export function dependencies(i: DepInput, p: Period): Group {
  const blocked = i.items.filter((x) => x.state === "blocked");
  const blockedJobs = blocked.filter((x) => x.kind === "job");
  const hours = blocked.reduce((t, x) => t + x.held, 0);
  const atRisk = i.items.filter((x) => x.kind === "job" && x.state !== "done" && (x.state === "blocked" || x.partly) && RISK_RANK[x.risk] >= RISK_RANK.at_risk);
  // how long a dependency took to be met
  const created = new Map(i.depEvents.filter((e) => e.type === "create").map((e) => [e.dependencyKey, e.at]));
  const waits = i.depEvents.filter((e) => e.type === "satisfy" && inP(e.at, p) && created.has(e.dependencyKey)).map((e) => Math.max(0, diffDays(created.get(e.dependencyKey)!, e.at)));
  // a prerequisite that is holding up several pieces of work
  const per = new Map<string, number>(); for (const d of i.deps) if (d.status === "active") per.set(`${d.prerequisite.kind}:${d.prerequisite.key}`, (per.get(`${d.prerequisite.kind}:${d.prerequisite.key}`) || 0) + 1);
  const heavy = [...per.entries()].filter(([, n]) => n >= 2).map(([k, n]) => { const [kind, key] = k.split(":"); return { label: i.titleOf(kind as "task" | "job", key), values: { holding_up: n } }; }).sort((a, b) => b.values.holding_up - a.values.holding_up);
  const reopened = new Map<string, number>(); for (const e of i.depEvents) if (e.type === "reopen" && inP(e.at, p)) reopened.set(e.dependencyKey, (reopened.get(e.dependencyKey) || 0) + 1);
  return { key: "deps", title: "Dependencies", metrics: [
    M("blocked_jobs", "Jobs blocked", blockedJobs.length, "count", "fact"), M("blocked_hours", "Hours held back", r1(hours), "hours", "estimate", { note: "Remaining estimated hours of blocked work" }),
    M("avg_wait", "Average wait to be met", avg(waits), "days", "fact", { note: "From the dependency being set up to being met" }),
    M("at_risk", "Deadlines at risk because of a dependency", atRisk.length, "count", "projection", { note: "Blocked or partly blocked jobs now at risk or worse" }),
    M("recurring", "Prerequisites holding up two or more", heavy.length, "count", "fact"), M("reopened", "Dependencies reopened", reopened.size, "count", "fact"),
  ], rows: heavy.slice(0, 10) };
}

export function planningReliability(sessions: Session[], p: Period, today: string, entries?: { minutes: number }[]): Group {
  const inPeriod = sessions.filter((s) => inP(s.date, p) && s.date <= today && s.status !== "cancelled");
  const due = inPeriod.filter((s) => s.status !== "planned" && s.status !== "in_progress" || s.date < today);
  const completed = inPeriod.filter((s) => s.status === "completed" || s.status === "partial"), moved = inPeriod.filter((s) => s.status === "rescheduled");
  const missed = inPeriod.filter((s) => s.status === "not_completed" || ((s.status === "planned" || s.status === "in_progress") && s.date < today));
  const plannedMin = inPeriod.reduce((t, s) => t + s.minutes, 0), doneMin = completed.reduce((t, s) => t + (s.actualMinutes || s.minutes), 0);
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
  return { key: "planning", title: "Planning reliability", metrics: [
    M("planned", "Sessions that were due", inPeriod.length, "count", "fact", { note: "Moved sessions count on their original day" }),
    M("completed_pct", "Completed as planned", pct(completed.length, inPeriod.length), "percent", "fact"), M("rescheduled", "Rescheduled", moved.length, "count", "fact"), M("missed", "Missed", missed.length, "count", "fact", { note: "Not done and not moved" }),
    M("hours_planned", "Hours planned", r1(plannedMin / 60), "hours", "estimate"), M("hours_done", "Hours of planned work completed", r1(doneMin / 60), "hours", "fact", { note: "Actual time recorded on completed sessions" }),
  ] };
}

export type LoadInput = { items: Item[]; sessions: Session[]; capacityPerDay: (d: string) => number; days: string[]; today: string; clientName: (k: string) => string; userName: (k: string) => string; service?: (i: Item) => string };
export function workload(i: LoadInput): Group {
  const open = i.items.filter((x) => x.state !== "done");
  const ready = open.filter((x) => x.state === "ready" || x.state === "in_progress").reduce((t, x) => t + Math.max(0, x.remaining - x.held), 0);
  const active = i.sessions.filter((s) => (s.status === "planned" || s.status === "in_progress") && s.date >= i.today);
  const planned = active.reduce((t, s) => t + s.minutes, 0) / 60;
  const cap = i.days.filter((d) => d >= i.today).reduce((t, d) => t + i.capacityPerDay(d), 0);
  const plannedItems = new Set(active.map((s) => s.itemKey));
  const unscheduled = open.filter((x) => x.ownerType === "user" && x.state !== "blocked" && !plannedItems.has(x.key)).reduce((t, x) => t + Math.max(0, x.remaining - x.held), 0);
  const byUser = new Map<string, { planned: number; capacity: number }>(); for (const s of active) { const g = byUser.get(s.userKey) || { planned: 0, capacity: 0 }; g.planned += s.minutes / 60; byUser.set(s.userKey, g); }
  const byClient = new Map<string, { ready: number; blocked: number }>(); for (const x of open) { const g = byClient.get(x.clientKey) || { ready: 0, blocked: 0 }; g.ready += Math.max(0, x.remaining - x.held); g.blocked += x.held; byClient.set(x.clientKey, g); }
  const bySvc = new Map<string, number>(); if (i.service) for (const x of open) { const k = i.service(x); if (k) bySvc.set(k, (bySvc.get(k) || 0) + x.remaining); }
  return { key: "workload", title: "Workload", metrics: [
    M("ready", "Ready to do", r1(ready), "hours", "estimate", { note: "Remaining estimated hours that nothing is holding up" }), M("planned", "Planned ahead", r1(planned), "hours", "fact", { note: "Sessions still to happen" }),
    M("unscheduled", "Ready but not planned", r1(unscheduled), "hours", "estimate"), M("capacity", "Capacity in this period", r1(cap), "hours", "fact", { note: "Practice-wide, from working days and hours" }),
    M("headroom", "Capacity left after planning", r1(cap - planned), "hours", "projection", { note: "Capacity minus sessions already planned" }),
  ], rows: [
    ...[...byUser.entries()].map(([k, v]) => ({ label: `Planned: ${i.userName(k)}`, values: { hours: r1(v.planned) } })),
    ...[...byClient.entries()].sort((a, b) => b[1].ready - a[1].ready).slice(0, 15).map(([k, v]) => ({ label: `Client: ${i.clientName(k)}`, values: { ready: r1(v.ready), blocked: r1(v.blocked) } })),
    ...[...bySvc.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: `Service: ${k}`, values: { remaining: r1(v) } })),
  ] };
}
