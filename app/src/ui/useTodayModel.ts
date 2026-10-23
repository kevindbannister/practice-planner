// The model Today and the Week view share: open work as the Today rules see it, the client hours
// each day offers (after meetings and the day's type), and the clashes between them.
import { useMemo } from "react";
import { Job, Task, holdLabel, importanceOf, isOnHold, todayIso } from "../lib/domain";
import { weekday } from "../lib/planning";
import { dayHours, typeOn } from "../lib/dayTypes";
import { Work, TodayInput } from "../lib/today";
import { isBusinessTask } from "../lib/projects";
import { waitingForRecords } from "../lib/chase";
import { inFinalise, planHours, waitingForClient } from "../lib/waiting";
import { Row } from "../lib/schema";
import { useData, useIndex } from "./data";
import { useCalendar } from "./Calendar";

export function useTodayModel(): { today: string; work: Work[]; dh: ReturnType<typeof dayHours>; capacity: TodayInput["capacity"]; input: TodayInput } {
  const { data, settings } = useData();
  const idx = useIndex();
  const cal = useCalendar();
  const today = todayIso();
  const work = useMemo((): Work[] => {
    const name = (k?: string) => (k && idx.clientByKey.get(k)?.Title) || "";
    const imp = (k?: string) => (k && idx.clientByKey.get(k) ? importanceOf(idx.clientByKey.get(k)!) : "normal");
    const held = (r: Record<string, unknown>) => { const h = isOnHold(r as { Status?: string }); return { held: h, chaseOn: h ? (r.HoldUntil as string) || undefined : undefined, heldLabel: h ? holdLabel(r as { Status?: string }) : undefined }; };
    return [
      ...idx.openJobs.map((j: Job): Work => ({
        key: j.Key, kind: "job", title: j.Title, client: name(j.ClientKey) || (j.ClientName as string) || "",
        hours: planHours(j, data.services), deadline: j.Deadline, planned: j.PlannedDate, urgent: j.Priority === "urgent",
        importance: imp(j.ClientKey), business: false, ...held(j),
        blocked: waitingForClient(j, idx.stagesByService.get(j.ServiceKey || "") || []) || (!inFinalise(j) && waitingForRecords(j, data.services, data.stageTemplates)),
      })),
      ...idx.openTasks.map((t: Task): Work => {
        const proj = isBusinessTask(t) ? data.projects.find((p) => p.Key === t.ProjectKey) : undefined;
        return {
          key: t.Key, kind: "task", title: t.Title, client: proj ? "" : name(t.ClientKey), hours: t.EstimateHours || 1,
          deadline: t.DueDate, planned: t.PlannedDate, urgent: false, importance: imp(t.ClientKey), business: isBusinessTask(t),
          blocked: false, projectTitle: proj ? String(proj.Title) : isBusinessTask(t) ? "a business project" : undefined, ...held(t),
        };
      }),
    ];
  }, [idx, data.services, data.projects, data.stageTemplates]);

  const dh = dayHours(today, settings);
  const capacity = (d: string, asType?: string) => {
    if (weekday(d) > 5) return 0;
    const s = asType ? { ...settings, overrides: { ...settings.overrides, [d]: asType } } : settings;
    return cal.capacityFor(d, dayHours(d, s).client);
  };
  const input: TodayInput = {
    today, work,
    day: { client: weekday(today) <= 5 ? capacity(today) : 0, business: dh.business, typeName: dh.type.name },
    capacity,
    dayType: (d) => { const ty = typeOn(d, settings); return { key: ty.key, name: ty.name, business: dayHours(d, settings).business }; },
  };
  return { today, work, dh, capacity, input };
}

