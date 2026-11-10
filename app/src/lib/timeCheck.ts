// Data check and reconciliation for time, planning and billing. It only reads: it reports what it finds and what bringing in the old typed hours WOULD do
// (a dry run), and changes nothing. Run it before and after the migration and whenever the numbers look wrong.
import { Rec } from "./timeBilling";
import { Session } from "./planSessions";
import { londonDate, entryMinutes } from "./timesheet";

export type Severity = "error" | "warning" | "info";
export type Issue = { severity: Severity; code: string; message: string; keys: string[] };
export type Known = { jobs: Set<string>; tasks: Set<string>; clients: Set<string> };
export type Legacy = { kind: "job" | "task"; key: string; title: string; actual: number };
export type CheckResult = { issues: Issue[]; counts: { entries: number; sessions: number }; reconciliation: Reconciliation };
export type Reconciliation = { rows: { kind: "job" | "task"; key: string; title: string; typedHours: number; recordedHours: number; gapHours: number; wouldImport: boolean }[]; typedTotal: number; recordedTotal: number; wouldImportHours: number };

const r2 = (x: number) => Math.round(x * 100) / 100;

export function checkTime(recs: Rec[], sessions: Session[], known: Known, legacy: Legacy[], now: Date, approvalOn: boolean): CheckResult {
  const issues: Issue[] = [];
  const add = (severity: Severity, code: string, message: string, keys: string[]) => keys.length && issues.push({ severity, code, message: `${keys.length} ${message}`, keys: keys.slice(0, 50) });

  const seen = new Map<string, string>(), dupKeys: string[] = [];
  for (const e of recs) { if (seen.has(e.key)) dupKeys.push(e.key); seen.set(e.key, e.key); }
  add("error", "duplicate-key", "time entries share a key with another.", dupKeys);

  add("error", "orphan-job", "time entries are for a job that no longer exists.", recs.filter((e) => e.jobKey && !known.jobs.has(e.jobKey)).map((e) => e.key));
  add("error", "orphan-task", "time entries are for a task that no longer exists.", recs.filter((e) => e.taskKey && !known.tasks.has(e.taskKey)).map((e) => e.key));
  add("warning", "orphan-client", "time entries name a client that no longer exists.", recs.filter((e) => e.clientKey && !known.clients.has(e.clientKey)).map((e) => e.key));
  add("error", "bad-length", "finished time entries have no length or a negative one.", recs.filter((e) => e.ended && !(e.hours > 0)).map((e) => e.key));
  add("error", "bad-date", "time entries have no valid work date.", recs.filter((e) => !/^\d{4}-\d{2}-\d{2}$/.test(e.workDate)).map((e) => e.key));
  add("warning", "date-mismatch", "timed entries sit on a different day from when they started.", recs.filter((e) => e.started && e.workDate && londonDate(e.started) !== e.workDate).map((e) => e.key));
  add("warning", "long-day", "days where one person has more than 16 hours recorded.", longDays(recs, now));
  add("warning", "forgotten-timer", "timers have been running over 12 hours.", recs.filter((e) => !e.ended && e.started && now.getTime() - Date.parse(e.started) > 12 * 3600000).map((e) => e.key));
  const dupWork = new Map<string, string[]>();
  for (const e of recs) if (e.ended) { const k = [e.by, e.jobKey, e.taskKey, e.workDate, e.started, e.hours].join("|"); dupWork.set(k, [...(dupWork.get(k) || []), e.key]); }
  add("warning", "possible-duplicate", "time entries look like copies of another (same person, work, day, start and length).", [...dupWork.values()].filter((l) => l.length > 1).flatMap((l) => l.slice(1)));

  add("error", "billed-no-invoice", "billed entries have no invoice reference.", recs.filter((e) => e.bill === "billed" && !e.invoiceRef).map((e) => e.key));
  add("warning", "billed-not-approved", "billed entries are not approved (they may have been billed before approval was turned on).", approvalOn ? recs.filter((e) => e.bill === "billed" && e.approval !== "approved").map((e) => e.key) : []);
  add("warning", "pending-stale", "entries have been waiting on an invoice for over 30 days.", recs.filter((e) => e.bill === "pending" && e.created && now.getTime() - Date.parse(e.created) > 30 * 86400000).map((e) => e.key));
  add("error", "approved-no-reviewer", "approved entries have no reviewer recorded.", recs.filter((e) => e.approval === "approved" && !e.reviewedBy).map((e) => e.key));
  add("warning", "writedown-without-status", "entries carry a write-down but are not marked written down or billed.", recs.filter((e) => e.writeDown > 0 && !["written_down", "billed", "pending"].includes(e.bill)).map((e) => e.key));

  const sKeys = new Set(sessions.map((x) => x.key));
  add("error", "session-orphan-item", "planned sessions are for a job or task that no longer exists.", sessions.filter((x) => !(x.kind === "job" ? known.jobs : known.tasks).has(x.itemKey)).map((x) => x.key));
  add("error", "session-broken-chain", "planned sessions point to a replacement or original that is missing.", sessions.filter((x) => (x.replacedByKey && !sKeys.has(x.replacedByKey)) || (x.originalKey && !sKeys.has(x.originalKey))).map((x) => x.key));
  add("warning", "entry-session-missing", "time entries are linked to a planned session that does not exist.", recs.filter((e) => e.sessionKey && !sKeys.has(e.sessionKey)).map((e) => e.key));
  const linked = new Map<string, number>();
  for (const e of recs) if (e.sessionKey && e.ended) linked.set(e.sessionKey, (linked.get(e.sessionKey) || 0) + entryMinutes(e, now));
  add("warning", "session-minutes-differ", "sessions record a different actual time from the entries linked to them.", sessions.filter((x) => linked.has(x.key) && Math.abs((linked.get(x.key) || 0) - x.actualMinutes) > 1).map((x) => x.key));

  // reconciliation: the hours typed onto jobs/tasks before time recording, against what the entries now hold (the dry run of the bring-in)
  const rows = legacy.map((l) => {
    const rec = r2(recs.filter((e) => (l.kind === "job" ? e.jobKey === l.key : e.taskKey === l.key) && e.ended).reduce((t, e) => t + e.hours, 0));
    const gap = r2(l.actual - rec);
    return { kind: l.kind, key: l.key, title: l.title, typedHours: r2(l.actual), recordedHours: rec, gapHours: gap, wouldImport: gap >= 0.05 };
  });
  add("info", "legacy-gap", "jobs or tasks have typed hours not yet in the time records (bringing them in adds them).", rows.filter((r) => r.wouldImport).map((r) => r.key));
  add("warning", "legacy-over", "jobs or tasks have more time recorded than the hours typed on them.", rows.filter((r) => r.gapHours < -0.05).map((r) => r.key));
  return { issues: issues.sort((a, b) => ({ error: 0, warning: 1, info: 2 })[a.severity] - ({ error: 0, warning: 1, info: 2 })[b.severity]), counts: { entries: recs.length, sessions: sessions.length },
    reconciliation: { rows, typedTotal: r2(rows.reduce((t, r) => t + r.typedHours, 0)), recordedTotal: r2(rows.reduce((t, r) => t + r.recordedHours, 0)), wouldImportHours: r2(rows.filter((r) => r.wouldImport).reduce((t, r) => t + r.gapHours, 0)) } };
}
function longDays(recs: Rec[], now: Date): string[] {
  const by = new Map<string, { m: number; keys: string[] }>();
  for (const e of recs) { if (!e.ended) continue; const k = `${e.by}|${e.workDate}`, x = by.get(k) || { m: 0, keys: [] }; x.m += entryMinutes(e, now); x.keys.push(e.key); by.set(k, x); }
  return [...by.values()].filter((x) => x.m > 16 * 60).flatMap((x) => x.keys.slice(0, 1));
}
