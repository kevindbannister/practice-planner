// Time worked on a job, stage by stage. A stage can have a budget (the practice's default for the type of work, or a figure
// set for one client); time comes from a start/stop timer or is typed in. Only one timer runs at a time, so starting one
// elsewhere stops the first. Time on the job is a total across its stages and can be used when the job is finished.
import { Row } from "./schema";

const s = (v: unknown) => String(v ?? "").trim();
const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
export const round2 = (h: number) => Math.round(h * 100) / 100;

export type TimeEntry = { key: string; jobKey: string; clientKey: string; stageNo: number; stageName: string; started: string; ended: string; hours: number; kind: "timer" | "manual"; note: string; by: string };
export const readTime = (r: Row): TimeEntry => ({
  key: s(r.Key), jobKey: s(r.JobKey), clientKey: s(r.ClientKey), stageNo: n(r.StageNo), stageName: s(r.StageName), started: s(r.Started), ended: s(r.Ended), hours: n(r.Hours),
  kind: s(r.Kind) === "manual" ? "manual" : "timer", note: s(r.Note), by: s(r.CreatedBy),
});

/** The timer that is running now, if any (there is only ever one). */
export const runningTimer = (entries: TimeEntry[]): TimeEntry | undefined => entries.filter((e) => e.kind === "timer" && e.started && !e.ended).sort((a, b) => b.started.localeCompare(a.started))[0];

export const elapsedHours = (e: TimeEntry, now: Date): number => Math.max(0, (now.getTime() - Date.parse(e.started)) / 3600000);
/** 1:05:09 for the running clock. */
export function clock(hours: number): string {
  const t = Math.max(0, Math.round(hours * 3600));
  const p = (x: number) => String(x).padStart(2, "0");
  return `${Math.floor(t / 3600)}:${p(Math.floor((t % 3600) / 60))}:${p(t % 60)}`;
}
/** 2h 15m, 45m, 0m. */
export function lengthText(hours: number): string {
  const m = Math.round(hours * 60);
  return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`;
}

export function startRow(job: Row, stageNo: number, stageName: string, user: string, now: Date, newKey: (p: string) => string): Row {
  return { Key: newKey("JT"), PracticeId: "", JobKey: s(job.Key), ClientKey: s(job.ClientKey), StageNo: stageNo, StageName: stageName, Started: now.toISOString(), Ended: "", Hours: 0, Kind: "timer", Note: "", CreatedBy: user, Created: now.toISOString() };
}
/** Stopping closes the entry. A timer left running for more than a working day is capped at 12 hours, as it was almost certainly forgotten. */
export function stopPatch(e: TimeEntry, now: Date): Row {
  const h = Math.min(12, elapsedHours(e, now));
  return { Ended: now.toISOString(), Hours: Math.max(0.01, round2(h)) };
}
export function manualRow(job: Row, stageNo: number, stageName: string, hours: number, note: string, user: string, now: Date, newKey: (p: string) => string): Row {
  return { Key: newKey("JT"), PracticeId: "", JobKey: s(job.Key), ClientKey: s(job.ClientKey), StageNo: stageNo, StageName: stageName, Started: "", Ended: now.toISOString(), Hours: round2(hours), Kind: "manual", Note: note.trim(), CreatedBy: user, Created: now.toISOString() };
}

/** Budget hours for each stage of a job: the client's own figure where one is set, otherwise the practice's default for that stage. */
export function budgets(templates: Row[], clientStages: Row[]): Map<number, number> {
  const mine = new Map(clientStages.map((c) => [n(c.StageNo), n(c.BudgetHours)]));
  const out = new Map<number, number>();
  for (const t of templates) {
    const no = n(t.StageNo);
    const own = mine.get(no) || 0;
    out.set(no, own > 0 ? own : n(t.DefaultBudget));
  }
  return out;
}

export type StageTime = { stageNo: number; name: string; budget: number; actual: number; status: "none" | "ok" | "near" | "over" };
export type JobTimeSummary = { stages: StageTime[]; budget: number; actual: number; status: StageTime["status"]; /** time on stages the job doesn't have (stages were changed) */ other: number };

const statusOf = (budget: number, actual: number): StageTime["status"] => (budget <= 0 ? "none" : actual > budget ? "over" : actual >= budget * 0.8 ? "near" : "ok");

/** Budget against time worked, per stage and overall. A running timer counts up to now. */
export function summarise(templates: Row[], clientStages: Row[], entries: TimeEntry[], jobKey: string, now: Date): JobTimeSummary {
  const b = budgets(templates, clientStages);
  const mine = entries.filter((e) => e.jobKey === jobKey);
  const by = new Map<number, number>();
  for (const e of mine) by.set(e.stageNo, (by.get(e.stageNo) || 0) + (e.ended ? e.hours : e.kind === "timer" && e.started ? elapsedHours(e, now) : 0));
  const stages = templates.slice().sort((x, y) => n(x.StageNo) - n(y.StageNo)).map((t) => {
    const no = n(t.StageNo), budget = b.get(no) || 0, actual = round2(by.get(no) || 0);
    return { stageNo: no, name: s(t.Title), budget, actual, status: statusOf(budget, actual) };
  });
  const known = new Set(stages.map((x) => x.stageNo));
  const other = round2([...by].filter(([no]) => !known.has(no)).reduce((t, [, h]) => t + h, 0));
  const budget = stages.reduce((t, x) => t + x.budget, 0), actual = round2(stages.reduce((t, x) => t + x.actual, 0) + other);
  return { stages, budget, actual, status: statusOf(budget, actual), other };
}

/** Total hours recorded on a job (finished entries only), for filling in the time when it is completed. */
export const trackedHours = (entries: TimeEntry[], jobKey: string): number => round2(entries.filter((e) => e.jobKey === jobKey && e.ended).reduce((t, e) => t + e.hours, 0));
