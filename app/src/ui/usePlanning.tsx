// Planning sessions on screen: reads the two lists, and applies a Plan from lib/planSessions.ts to them (checking each session is still as it was read,
// writing the sessions, then the history, then each item's own planned date so the board and Today carry on working).
import { useCallback, useMemo } from "react";
import { todayIso } from "../lib/domain";
import { jobHours, newKey } from "../lib/planning";
import { Ctx, EventType, Plan, PlanEvent, Session, eventRow, migrateLegacy, readEvent, readSession, sessionRow, undoBatch } from "../lib/planSessions";
import { writesFor } from "../lib/planApply";
import { Row } from "../lib/schema";
import { useData } from "./data";

export type Applied = { done: boolean; problems: string[]; skipped: number; batchKey?: string };

export function usePlanning() {
  const { data, store, user, update, createMany, refreshList } = useData();
  const sessions = useMemo(() => data.planSessions.map(readSession), [data.planSessions]);
  const events = useMemo(() => data.planEvents.map(readEvent), [data.planEvents]);
  const ready = store.hasList("PlanSessions") && store.hasList("PlanEvents");
  const ctx = useCallback((): Ctx => ({ now: new Date().toISOString(), user: user || "", newKey }), [user]);

  const apply = useCallback(async (plan: Plan): Promise<Applied> => {
    if (!plan.creates.length && !plan.patches.length) return { done: false, problems: plan.problems, skipped: 0 };
    const fresh = (await store.readAll("PlanSessions")).map(readSession);
    const planned = new Map<string, string>([...data.jobs, ...data.tasks].map((r) => [String(r.Key), String(r.PlannedDate || "")]));
    const w = writesFor(plan, fresh, planned, todayIso());
    if (!w.creates.length && !w.patches.length) { await refreshList("PlanSessions"); return { done: false, problems: [...plan.problems, ...w.skipped.map((s) => `Nothing was changed: ${s.why}.`)], skipped: w.skipped.length }; }
    const pid = String(data.planSessions[0]?.PracticeId || "");
    // the sessions first, then the history of them: a history line is never written for a change that wasn't
    const rows = await store.readAll("PlanSessions");
    for (const p of w.patches) {
      const row = rows.find((r) => r.Key === p.key);
      if (row) await update("PlanSessions", row, sessionPatch(p.patch));
    }
    if (w.creates.length) await createMany("PlanSessions", w.creates.map((x) => sessionRow(x, pid)));
    if (w.events.length) await createMany("PlanEvents", w.events.map((e) => eventRow(e, pid)));
    // the item's own planned date follows its next live session
    for (const d of w.dates) {
      const row = (d.kind === "job" ? data.jobs : data.tasks).find((r) => r.Key === d.itemKey);
      if (row) await update(d.kind === "job" ? "Jobs" : "Tasks", row, { PlannedDate: d.date, DayOrder: "", StartTime: "" });
    }
    await refreshList("PlanSessions");
    return { done: true, problems: plan.problems, skipped: w.skipped.length, batchKey: w.events[0]?.batchKey };
  }, [store, data.jobs, data.tasks, data.planSessions, update, createMany, refreshList]);

  const undo = useCallback(async (batchKey: string): Promise<Applied & { notes: string[] }> => {
    const [s, e] = await Promise.all([store.readAll("PlanSessions"), store.readAll("PlanEvents")]);
    const u = undoBatch(batchKey, e.map(readEvent), s.map(readSession), ctx());
    if (u.alreadyUndone) return { done: false, problems: ["That has already been undone."], skipped: 0, notes: [] };
    const r = await apply(u);
    return { ...r, problems: [...u.problems, ...r.problems], skipped: u.skipped.length + r.skipped, notes: u.skipped.map((x) => x.why) };
  }, [store, apply, ctx]);

  /** Items with a planned date and no session yet, for the one-off bring-in. */
  const legacy = useMemo(() => migrateLegacy({ jobs: data.jobs, tasks: data.tasks, sessions, hoursOf: (k, r) => (k === "job" ? jobHours(r as never, data.services) : Number(r.EstimateHours) || 1), now: new Date().toISOString(), user: user || "" }), [data.jobs, data.tasks, data.services, sessions, user]);
  const bringIn = useCallback(async () => {
    const m = legacy;
    if (!m.rows.length) return m.report;
    const pid = String(data.planSessions[0]?.PracticeId || "");
    await createMany("PlanSessions", m.rows.map((x) => sessionRow(x, pid)));
    await createMany("PlanEvents", m.events.map((e) => eventRow(e, pid)));
    await refreshList("PlanSessions");
    return m.report;
  }, [legacy, data.planSessions, createMany, refreshList]);

  return { ready, sessions, events, ctx, apply, undo, legacy, bringIn };
}

const sessionPatch = (p: Partial<Session>): Row => {
  const m: Record<string, string> = { date: "PlannedDate", start: "PlannedStart", minutes: "PlannedMinutes", actualMinutes: "ActualMinutes", status: "Status", outcome: "Outcome", replacedByKey: "ReplacedByKey", reason: "Reason", notes: "Notes", userKey: "UserKey", updated: "Updated", updatedBy: "UpdatedBy", version: "Version" };
  const out: Row = {};
  for (const [k, v] of Object.entries(p)) if (m[k]) out[m[k]] = v as string | number;
  return out;
};
export type { Plan, PlanEvent, EventType };
