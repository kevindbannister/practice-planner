// Everything the time, billing and reports screens share: the entries (only those the signed-in person may see), rates, the team and what they may do.
import { useMemo } from "react";
import { readSetting, useData } from "./data";
import { useCalendar } from "./Calendar";
import { dayHours } from "../lib/dayTypes";
import { weekday } from "../lib/planning";
import { Rate, RATE_SETTING, poundsToPence, readRates } from "../lib/rates";
import { Ctx, JobInfo, Rec, readRec } from "../lib/timeBilling";
import { Action, Team, approvalOn, can, nameOf, roleOf, teamFrom, visibleUsers } from "../lib/permissions";
import { JobRef } from "../lib/timeReports";
import { activitiesFrom, readEntry } from "../lib/timesheet";
import { readSession } from "../lib/planSessions";

export function useTimeFinance() {
  const { data, user, settings } = useData();
  const cal = useCalendar();
  const me = user || "";
  const team = useMemo<Team>(() => teamFrom(data.settings), [data.settings]);
  const may = (a: Action) => can(team, me, a);
  const rates = useMemo<Rate[]>(() => readRates(readSetting<unknown>(data.settings, RATE_SETTING)), [data.settings]);
  const activities = useMemo(() => activitiesFrom(readSetting<unknown>(data.settings, "timesheet.activities")), [data.settings]);
  const all = useMemo<Rec[]>(() => data.jobTime.map((r) => readRec(r, readEntry(r))), [data.jobTime]);
  const people = useMemo(() => [...new Set([...all.map((e) => e.by).filter(Boolean), ...team.members.map((m) => m.user), me].filter(Boolean))].sort(), [all, team, me]);
  const shown = useMemo(() => visibleUsers(team, me, people).map((u) => u.toLowerCase()), [team, me, people]);
  const recs = useMemo(() => all.filter((e) => shown.includes(e.by.toLowerCase())), [all, shown]);
  const jobs = useMemo(() => new Map<string, JobInfo>(data.jobs.map((j) => [String(j.Key), { key: String(j.Key), clientKey: String(j.ClientKey || ""), serviceKey: String(j.ServiceKey || ""), fixedFeePence: poundsToPence(Number(j.Fee) || 0), title: String(j.Title || "") }])), [data.jobs]);
  const refs = useMemo<JobRef[]>(() => data.jobs.map((j) => ({ key: String(j.Key), title: String(j.Title || ""), clientKey: String(j.ClientKey || ""), serviceKey: String(j.ServiceKey || ""), feePence: poundsToPence(Number(j.Fee) || 0), estimateHours: Number(j.EstimateHours) || 0, done: !!j.CompletedDate, doneOn: String(j.CompletedDate || "").slice(0, 10) })), [data.jobs]);
  const ctx = useMemo<Ctx>(() => ({ rates, activities, jobs, now: new Date(), roleOf: (u) => roleOf(team, u) }), [rates, activities, jobs, team, data.jobTime]); // eslint-disable-line react-hooks/exhaustive-deps
  const sessions = useMemo(() => data.planSessions.map(readSession), [data.planSessions]);
  const capacity = (d: string) => (weekday(d) > 5 ? 0 : Math.round(cal.capacityFor(d, dayHours(d, settings).total) * 60));
  const client = (k: string) => data.clients.find((c) => c.Key === k)?.Title || (k ? k : "—");
  const service = (k: string) => data.services.find((s) => s.Key === k)?.Title || k || "—";
  const who = (u: string) => nameOf(team, u);
  return { data, me, team, may, rates, activities, all, recs, people, shown, jobs, refs, ctx, sessions, capacity, client, service, who, approval: approvalOn(data.settings), jobTitle: (k: string) => jobs.get(k)?.title || (k ? k : "—") };
}
export type TimeFinance = ReturnType<typeof useTimeFinance>;

import { useCallback, useState } from "react";
import { newKey } from "../lib/planning";
import { Change, timeEventRow } from "../lib/timeBilling";
import { Denied } from "../lib/permissions";

/** Applies a billing or approval change: the entries' new state, then the log lines. Shows what went wrong in `note` (problems that stopped part of it, or a refused save). */
export function useApply() {
  const { data, user, updateMany, createMany } = useData();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; bad?: boolean }>();
  const run = useCallback(async (make: (mk: { user: string; now: Date; newKey: (p: string) => string }) => Change, done = "Done.") => {
    setBusy(true); setNote(undefined);
    try {
      const ch = make({ user: user || "", now: new Date(), newKey });
      const rows = ch.patches.map((p) => ({ row: data.jobTime.find((r) => r.Key === p.key)!, patch: p.patch })).filter((x) => x.row);
      if (rows.length) { await updateMany("JobTime", rows); await createMany("TimeEvents", ch.events.map((e) => timeEventRow(e))); }
      setNote(ch.problems.length ? { text: `${rows.length ? `${rows.length} done. ` : "Nothing was changed. "}${ch.problems.slice(0, 3).join(" ")}`, bad: !rows.length } : { text: rows.length ? done : "Nothing to change." });
    } catch (e) { setNote({ text: e instanceof Denied ? e.message : "That didn't save. Try again.", bad: true }); } finally { setBusy(false); }
  }, [data.jobTime, user, updateMany, createMany]);
  return { run, busy, note };
}
