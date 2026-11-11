// The client work overview and the practice heatmaps. Everything is counted from the underlying records, so a job with five planned sessions is still one job,
// and jobs and tasks are always counted apart. Actual hours come only from timesheet entries (never from a task being ticked off). Planned hours are shown two
// ways: what is currently planned (sessions still to happen; moved or finished ones are not capacity) and what was planned as it stood (history).
import { Row } from "../schema";
import { Assessment, Readiness, World, assess } from "./readiness";
import { RISK_RANK, RiskCategory, Risk, Facts } from "./risk";
import { readTask } from "./model";

const s = (v: unknown) => (v == null ? "" : String(v).trim());
export type State = "ready" | "in_progress" | "waiting" | "blocked" | "done";
export type Item = {
  kind: "job" | "task"; key: string; clientKey: string; title: string; serviceKey: string; owner: string; ownerType: string; status: string; due: string; completedOn: string;
  remaining: number; held: number; state: State; partly: boolean; waitingClient: boolean; overdue: boolean; risk: RiskCategory; readiness: Readiness; groups: string[]; importance: string;
};
const finishedJob = (st: string) => st === "Complete" || st === "Done";

export type Source = {
  jobs: Row[]; tasks: Row[]; world: World; risks: Map<string, Risk>; facts: Map<string, Facts>; today: string; user: string;
  /** the person a job is looked after by (the client's manager or partner) */ ownerOfJob: (clientKey: string) => string;
  groupsOf: (clientKey: string) => string[]; importanceOf: (clientKey: string) => string;
  /** hours already recorded against a job (from the timesheet entries): used only to tell whether work has begun */ hoursOnJob: (jobKey: string) => number;
};

/** One entry per job and per task. Private and personal tasks never appear in practice-wide counts, whoever is looking. */
export function buildItems(i: Source): Item[] {
  const out: Item[] = [];
  for (const j of i.jobs) {
    const key = s(j.Key), st = s(j.Status); if (st === "Cancelled") continue;
    const clientKey = s(j.ClientKey), a = assess("job", key, i.world), f = i.facts.get(key), r = i.risks.get(key);
    const done = finishedJob(st), hold = st === "On hold", holdKind = s(j.HoldKind).toLowerCase();
    const due = s(j.Deadline).slice(0, 10);
    const state: State = done ? "done" : a.readiness === "blocked" ? "blocked" : hold ? "waiting" : (i.hoursOnJob(key) > 0 || Number(j.StageNo) > 1) ? "in_progress" : "ready";
    out.push({ kind: "job", key, clientKey, title: s(j.Title), serviceKey: s(j.ServiceKey), owner: i.ownerOfJob(clientKey), ownerType: "user", status: st, due, completedOn: s(j.CompletedDate).slice(0, 10), remaining: done ? 0 : f?.remaining ?? 0, held: done ? 0 : r?.held ?? 0, state, partly: a.readiness === "partly_ready", waitingClient: state === "waiting" && holdKind.includes("client"), overdue: !done && !!due && due < i.today, risk: done ? "on_track" : r?.category || "on_track", readiness: a.readiness, groups: i.groupsOf(clientKey), importance: i.importanceOf(clientKey) });
  }
  for (const row of i.tasks) {
    const t = readTask(row); if (t.status === "Cancelled") continue;
    if (t.area === "personal" || t.privacy === "private") continue;
    const a: Assessment = assess("task", t.key, i.world), done = t.status === "Done" || t.status === "Complete";
    const state: State = done ? "done" : a.readiness === "blocked" ? "blocked" : a.readiness === "waiting" || a.readiness === "on_hold" ? "waiting" : t.status === "In progress" ? "in_progress" : "ready";
    const rem = ((t.remainingMinutes ?? t.estimateMinutes) || 0) / 60;
    out.push({ kind: "task", key: t.key, clientKey: t.clientKey, title: t.title, serviceKey: "", owner: t.ownerType === "user" ? t.owner : "", ownerType: t.ownerType, status: t.status, due: t.dueDate.slice(0, 10), completedOn: t.completedAt.slice(0, 10), remaining: done ? 0 : Math.round(rem * 100) / 100, held: state === "blocked" ? Math.round(rem * 100) / 100 : 0, state, partly: false, waitingClient: state === "waiting" && t.ownerType === "contact", overdue: !done && !!t.dueDate && t.dueDate.slice(0, 10) < i.today, risk: "on_track", readiness: a.readiness, groups: i.groupsOf(t.clientKey), importance: i.importanceOf(t.clientKey) });
  }
  return out;
}

// ---------------------------------------------------------------- counts
export type Counts = { todo: number; inProgress: number; waitingClient: number; blocked: number; overdue: number; ready: number; completed: number; open: number };
const zero = (): Counts => ({ todo: 0, inProgress: 0, waitingClient: 0, blocked: 0, overdue: 0, ready: 0, completed: 0, open: 0 });
/** Each indicator is its own count over the same records; they overlap by design (an overdue job can also be blocked), and none of them adds a job twice. "Completed" is within the period. */
export function counts(items: Item[], period?: { from: string; to: string }): { jobs: Counts; tasks: Counts } {
  const out = { jobs: zero(), tasks: zero() };
  for (const it of items) {
    const c = it.kind === "job" ? out.jobs : out.tasks;
    if (it.state === "done") { if (!period || (it.completedOn && it.completedOn >= period.from && it.completedOn <= period.to)) c.completed++; continue; }
    c.open++;
    if (it.state !== "in_progress") c.todo++;
    if (it.state === "in_progress") c.inProgress++;
    if (it.waitingClient) c.waitingClient++;
    if (it.state === "blocked") c.blocked++;
    if (it.overdue) c.overdue++;
    if (it.state === "ready" || it.state === "in_progress") c.ready++;
  }
  return out;
}

// ---------------------------------------------------------------- the practice heatmap
export type Column = "ready" | "in_progress" | "waiting" | "blocked" | "overdue" | "at_risk";
export const COLUMNS: Column[] = ["ready", "in_progress", "waiting", "blocked", "overdue", "at_risk"];
export const COLUMN_LABEL: Record<Column, string> = { ready: "Ready", in_progress: "In progress", waiting: "Waiting", blocked: "Blocked", overdue: "Overdue", at_risk: "At risk" };
export const inColumn = (it: Item, c: Column): boolean => {
  if (it.state === "done") return false;
  switch (c) { case "ready": return it.state === "ready"; case "in_progress": return it.state === "in_progress"; case "waiting": return it.state === "waiting"; case "blocked": return it.state === "blocked"; case "overdue": return it.overdue; case "at_risk": return RISK_RANK[it.risk] >= RISK_RANK.at_risk && it.risk !== "overdue"; }
};
export type Filter = { user?: string; service?: string; group?: string; period?: { from: string; to: string } };
export function filterItems(items: Item[], f: Filter): Item[] {
  return items.filter((it) => (!f.user || it.owner.toLowerCase() === f.user.toLowerCase())
    && (!f.service || (it.kind === "job" && it.serviceKey === f.service))
    && (!f.group || it.groups.includes(f.group))
    && (!f.period || it.state === "done" || !it.due || (it.due >= f.period.from && it.due <= f.period.to)));
}
export type Cell = { jobs: Item[]; tasks: Item[] };
export type HeatRow = { clientKey: string; cells: Record<Column, Cell>; hours: number; worstRisk: RiskCategory; overdue: number; blocked: number; importance: string };
const IMP: Record<string, number> = { key: 0, normal: 1, low: 2 };
export type Sort = "risk" | "overdue" | "blocked" | "hours" | "importance" | "name";
export function heatmap(items: Item[], nameOf: (clientKey: string) => string, sort: Sort = "risk"): HeatRow[] {
  const by = new Map<string, Item[]>(); for (const it of items) if (it.state !== "done" && it.clientKey) by.set(it.clientKey, [...(by.get(it.clientKey) || []), it]);
  const rows: HeatRow[] = [...by].map(([clientKey, list]) => {
    const cells = {} as Record<Column, Cell>;
    for (const c of COLUMNS) { const m = list.filter((x) => inColumn(x, c)); cells[c] = { jobs: m.filter((x) => x.kind === "job"), tasks: m.filter((x) => x.kind === "task") }; }
    return { clientKey, cells, hours: Math.round(list.reduce((a, x) => a + x.remaining, 0) * 100) / 100, worstRisk: list.reduce<RiskCategory>((w, x) => (RISK_RANK[x.risk] > RISK_RANK[w] ? x.risk : w), "on_track"), overdue: list.filter((x) => x.overdue).length, blocked: list.filter((x) => x.state === "blocked").length, importance: list[0].importance };
  });
  const cmp: Record<Sort, (a: HeatRow, b: HeatRow) => number> = {
    risk: (a, b) => RISK_RANK[b.worstRisk] - RISK_RANK[a.worstRisk] || b.overdue - a.overdue, overdue: (a, b) => b.overdue - a.overdue, blocked: (a, b) => b.blocked - a.blocked, hours: (a, b) => b.hours - a.hours,
    importance: (a, b) => (IMP[a.importance] ?? 1) - (IMP[b.importance] ?? 1), name: () => 0,
  };
  return rows.sort((a, b) => (sort === "name" ? 0 : cmp[sort](a, b)) || nameOf(a.clientKey).localeCompare(nameOf(b.clientKey)));
}
export const drill = (row: HeatRow, c: Column): Item[] => [...row.cells[c].jobs, ...row.cells[c].tasks].sort((a, b) => (a.due || "9").localeCompare(b.due || "9"));
export const cellText = (c: Cell): string => [c.jobs.length ? `${c.jobs.length} job${c.jobs.length === 1 ? "" : "s"}` : "", c.tasks.length ? `${c.tasks.length} task${c.tasks.length === 1 ? "" : "s"}` : ""].filter(Boolean).join(", ");

// ---------------------------------------------------------------- the workload heatmap
export type Metric = "open_tasks" | "remaining" | "planned" | "planned_history" | "actual" | "blocked" | "overdue";
export const METRICS: { key: Metric; label: string; unit: "count" | "hours"; note: string }[] = [
  { key: "open_tasks", label: "Open tasks", unit: "count", note: "Tasks (not jobs) still open, by the day they are due." },
  { key: "remaining", label: "Remaining estimated hours", unit: "hours", note: "Hours left on open jobs and tasks, by the day they are due." },
  { key: "planned", label: "Planned hours (current)", unit: "hours", note: "Sessions still to happen. Moved, finished and cancelled sessions are not counted: they are no longer capacity." },
  { key: "planned_history", label: "Planned hours (as it stood)", unit: "hours", note: "Every session on the day it was planned for, including ones later moved or finished, for comparing plan with what happened. A moved session appears on both days." },
  { key: "actual", label: "Actual recorded hours", unit: "hours", note: "From timesheet entries only. A task being ticked off records no time." },
  { key: "blocked", label: "Blocked hours", unit: "hours", note: "Hours held behind an unmet dependency, by the day the work is due." },
  { key: "overdue", label: "Overdue hours", unit: "hours", note: "Hours left on work already past its date, by the date it was due." },
];
export type Mode = "day" | "week" | "month";
export type Col = { key: string; label: string; from: string; to: string; special?: "earlier" | "later" | "none" };
const addD = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
export const mondayOf = (iso: string) => { const d = new Date(`${iso}T00:00:00Z`); return addD(iso, -((d.getUTCDay() + 6) % 7)); };
const addMonth = (iso: string, n: number) => { const d = new Date(`${iso.slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };
export function columns(mode: Mode, anchor: string, count: number): Col[] {
  const out: Col[] = [];
  if (mode === "day") { let d = anchor, n = 0; while (n < count) { const wd = new Date(`${d}T00:00:00Z`).getUTCDay(); if (wd !== 0 && wd !== 6) { out.push({ key: d, label: d.slice(5), from: d, to: d }); n++; } d = addD(d, 1); } }
  else if (mode === "week") { const m = mondayOf(anchor); for (let i = 0; i < count; i++) { const f = addD(m, i * 7); out.push({ key: f, label: `w/c ${f.slice(5)}`, from: f, to: addD(f, 6) }); } }
  else for (let i = 0; i < count; i++) { const f = addMonth(anchor, i); out.push({ key: f, label: f.slice(0, 7), from: f, to: addD(addMonth(f, 1), -1) }); }
  return out;
}
export type Session = { itemKey: string; clientKey: string; userKey: string; date: string; minutes: number; status: string };
export type Entry = { clientKey: string; user: string; date: string; minutes: number };
export type Heat = { cols: Col[]; rows: { key: string; cells: number[]; total: number }[]; max: number; unit: "count" | "hours"; note: string };
const ACTIVE = new Set(["planned", "in_progress"]);

export function workload(i: { metric: Metric; rowBy: "client" | "user"; items: Item[]; sessions: Session[]; entries: Entry[]; cols: Col[]; today: string }): Heat {
  const m = METRICS.find((x) => x.key === i.metric)!, byDue = ["open_tasks", "remaining", "blocked", "overdue"].includes(i.metric);
  const first = i.cols[0].from, last = i.cols[i.cols.length - 1].to;
  const cols: Col[] = byDue ? [{ key: "earlier", label: "Earlier", from: "", to: "", special: "earlier" }, ...i.cols, { key: "later", label: "Later", from: "", to: "", special: "later" }, { key: "none", label: "No date", from: "", to: "", special: "none" }] : i.cols;
  const idx = (d: string): number => { if (byDue) { if (!d) return cols.length - 1; if (d < first) return 0; if (d > last) return cols.length - 2; return 1 + i.cols.findIndex((c) => d >= c.from && d <= c.to); } return i.cols.findIndex((c) => d >= c.from && d <= c.to); };
  const rows = new Map<string, number[]>();
  const add = (row: string, d: string, v: number) => { if (!v) return; const x = idx(d); if (x < 0) return; const r = rows.get(row || "(none)") || cols.map(() => 0); r[x] += v; rows.set(row || "(none)", r); };
  const rowOf = (x: { clientKey: string; owner: string }) => (i.rowBy === "client" ? x.clientKey : x.owner);
  if (byDue) for (const it of i.items) {
    if (it.state === "done") continue;
    if (i.metric === "open_tasks") { if (it.kind === "task") add(rowOf(it), it.due, 1); }
    else if (i.metric === "remaining") add(rowOf(it), it.due, it.remaining);
    else if (i.metric === "blocked") add(rowOf(it), it.due, it.held);
    else if (it.overdue) add(rowOf(it), it.due, it.remaining);
  } else if (i.metric === "planned" || i.metric === "planned_history") {
    for (const x of i.sessions) { if (i.metric === "planned" ? !ACTIVE.has(x.status) : x.status === "cancelled") continue; add(i.rowBy === "client" ? x.clientKey : x.userKey, x.date, x.minutes / 60); }
  } else for (const e of i.entries) add(i.rowBy === "client" ? e.clientKey : e.user, e.date, e.minutes / 60);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const out = [...rows].map(([key, cells]) => ({ key, cells: cells.map(r2), total: r2(cells.reduce((a, b) => a + b, 0)) })).sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
  return { cols, rows: out, max: Math.max(0, ...out.flatMap((r) => r.cells)), unit: m.unit, note: m.note };
}
