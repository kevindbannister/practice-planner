// Migration dry run and backfill for the unified task model. The old Tasks keep their keys, clients, projects, planned dates and checklists, and are read
// through `readTask`, so nothing has to be rewritten for them to keep working. This reports what is there and what an optional backfill would write.
// The backfill only fills blank new columns (Area, Version), never changes anything already set, and has an exact undo.
import { Row } from "../schema";
import { areaOf, readTask } from "./model";
import { readSubtasks } from "../subtasks";

export type Finding = { code: string; severity: "error" | "warning" | "info"; message: string; keys: string[] };
export type Report = { tasks: number; legacy: number; byArea: Record<string, number>; subtaskItems: number; findings: Finding[]; meetingActionsNotTasks: number; backfill: { key: string; patch: Row }[] };

export function planMigration(tasks: Row[], known: { clients: Set<string>; projects: Set<string>; jobs: Set<string> }, meetings: Row[] = []): Report {
  const findings: Finding[] = [];
  const add = (severity: Finding["severity"], code: string, message: string, keys: string[]) => keys.length && findings.push({ severity, code, message: `${keys.length} ${message}`, keys: keys.slice(0, 50) });
  const byArea: Record<string, number> = {};
  const seen = new Map<string, number>(), dups: string[] = [];
  const backfill: Report["backfill"] = [];
  let legacy = 0, subtaskItems = 0;
  const both: string[] = [], orphanClient: string[] = [], orphanProject: string[] = [], orphanJob: string[] = [], noTitle: string[] = [], badParent: string[] = [];
  const keys = new Set(tasks.map((r) => String(r.Key || "")));
  for (const r of tasks) {
    const key = String(r.Key || ""), t = readTask(r);
    seen.set(key, (seen.get(key) || 0) + 1); if (seen.get(key) === 2) dups.push(key);
    byArea[t.area] = (byArea[t.area] || 0) + 1;
    subtaskItems += readSubtasks(r.Subtasks).length;
    if (t.legacy) legacy++;
    if (t.projectKey && t.clientKey) both.push(key);
    if (t.clientKey && !known.clients.has(t.clientKey)) orphanClient.push(key);
    if (t.projectKey && !known.projects.has(t.projectKey)) orphanProject.push(key);
    if (t.jobKey && !known.jobs.has(t.jobKey)) orphanJob.push(key);
    if (!String(r.Title || "").trim()) noTitle.push(key);
    if (t.parentKey && (!keys.has(t.parentKey) || t.parentKey === key)) badParent.push(key);
    const patch: Row = {};
    if (!String(r.Area || "").trim()) patch.Area = areaOf(r);
    if (!String(r.Version || "").trim()) patch.Version = 1;
    if (Object.keys(patch).length) backfill.push({ key, patch });
  }
  add("error", "duplicate-key", "tasks share a key with another task.", dups);
  add("error", "orphan-parent", "tasks name a parent task that doesn't exist (or themselves).", badParent);
  add("warning", "orphan-client", "tasks name a client that no longer exists.", orphanClient);
  add("warning", "orphan-project", "tasks name a project that no longer exists.", orphanProject);
  add("warning", "orphan-job", "tasks name a job that no longer exists.", orphanJob);
  add("warning", "client-and-project", "tasks belong to both a client and a business project. They are treated as project tasks; check they are right.", both);
  add("info", "no-title", "tasks have no title and show their type instead.", noTitle);
  const meetingActions = meetings.reduce((n, m) => { try { const a = JSON.parse(String(m.Actions || "[]")); return n + (Array.isArray(a) ? a.filter((x: { taskKey?: string }) => x && !x.taskKey).length : 0); } catch { return n; } }, 0);
  if (subtaskItems) findings.push({ code: "subtasks-kept", severity: "info", message: `${subtaskItems} checklist items stay as lightweight checklists. None are turned into separate tasks automatically.`, keys: [] });
  return { tasks: tasks.length, legacy, byArea, subtaskItems, findings, meetingActionsNotTasks: meetingActions, backfill };
}

/** The exact undo of a backfill: the same keys with the columns it set cleared again. Only valid for rows still holding the values the backfill wrote. */
export function rollbackFor(report: Report, current: Row[]): { key: string; patch: Row }[] {
  const by = new Map(current.map((r) => [String(r.Key), r]));
  return report.backfill.flatMap((b) => {
    const r = by.get(b.key); if (!r) return [];
    const patch: Row = {};
    for (const [col, v] of Object.entries(b.patch)) if (String(r[col] ?? "") === String(v)) patch[col] = "";
    return Object.keys(patch).length ? [{ key: b.key, patch }] : [];
  });
}
