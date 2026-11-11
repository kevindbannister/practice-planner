// The records behind the work overview, built once from what is loaded. Read-only.
import { useMemo } from "react";
import { importanceOf } from "../lib/domain";
import { Row } from "../lib/schema";
import { entryMinutes, readEntry } from "../lib/timesheet";
import { Entry, Item, Session, buildItems } from "../lib/work/overview";
import { useData, useIndex } from "./data";
import { useRisk } from "./riskKit";
import { usePlanning } from "./usePlanning";

export function useWorkItems() {
  const { data, user } = useData(); const idx = useIndex(); const risk = useRisk(); const planning = usePlanning();
  return useMemo(() => {
    const hours = new Map<string, number>(), entries: Entry[] = [], now = new Date();
    for (const r of data.jobTime as Row[]) {
      const e = readEntry(r); if (!e.ended) continue;
      if (e.jobKey) hours.set(e.jobKey, (hours.get(e.jobKey) || 0) + e.hours);
      const job = e.jobKey ? (data.jobs as Row[]).find((j) => j.Key === e.jobKey) : undefined;
      entries.push({ clientKey: e.clientKey || String(job?.ClientKey || ""), user: e.by, date: e.workDate, minutes: entryMinutes(e, now) });
    }
    const manager = (ck: string) => String(idx.clientByKey.get(ck)?.Manager || idx.clientByKey.get(ck)?.Partner || "");
    const items = buildItems({
      jobs: data.jobs as Row[], tasks: data.tasks as Row[], world: risk.world, risks: risk.risks, facts: risk.facts, today: risk.today, user: user || "", ownerOfJob: manager,
      groupsOf: (ck) => (data.members as Row[]).filter((m) => m.MemberKey === ck).map((m) => String(m.GroupKey)), importanceOf: (ck) => importanceOf(idx.clientByKey.get(ck) || {}), hoursOnJob: (k) => hours.get(k) || 0,
    });
    const sessions: Session[] = planning.sessions.map((s) => ({ itemKey: s.itemKey, clientKey: s.clientKey, userKey: s.userKey, date: s.date, minutes: s.minutes, status: s.status }));
    return { items, entries, sessions, today: risk.today, clientName: (ck: string) => String(idx.clientByKey.get(ck)?.Title || ck) };
  }, [data.jobs, data.tasks, data.jobTime, data.members, risk, idx, planning.sessions, user]);
}
export type { Item };
