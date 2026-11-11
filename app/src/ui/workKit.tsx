// Reminders, newly unblocked work and the report groups, built once from what is loaded. Read-only: nothing here saves, sends or plans anything.
import { useMemo } from "react";
import { Row } from "../lib/schema";
import { readTaskEvent } from "../lib/work/clientActions";
import { readDependency, readDepEvent } from "../lib/work/dependencies";
import { readTask } from "../lib/work/model";
import { newlyUnblocked, reminders, unblockedReminders } from "../lib/work/planning";
import { useData, useIndex } from "./data";
import { useRisk } from "./riskKit";

export function useWorkSignals() {
  const { data, user } = useData(); const idx = useIndex(); const risk = useRisk();
  return useMemo(() => {
    const tasks = (data.tasks as Row[]).map(readTask), events = (data.taskEvents as Row[]).map(readTaskEvent);
    const deps = (data.dependencies as Row[]).map(readDependency), depEvents = (data.dependencyEvents as Row[]).map(readDepEvent);
    const names = (ck: string) => String(idx.clientByKey.get(ck)?.Title || "");
    const manager = (ck: string) => String(idx.clientByKey.get(ck)?.Manager || idx.clientByKey.get(ck)?.Partner || "");
    const ownerOf = (kind: "task" | "job", key: string) => (kind === "task" ? risk.world.tasks.get(key)?.owner : manager(risk.world.jobs.get(key)?.clientKey || "")) || "";
    const unblocked = newlyUnblocked(risk.world, depEvents, new Date().toISOString(), 3, ownerOf);
    const mine = (o: string) => !o || o === user;
    const list = [...reminders({ tasks, events, deps, world: risk.world, today: risk.today, names }), ...unblockedReminders(unblocked.filter((u) => mine(u.owner)), names)];
    return { reminders: list, unblocked, tasks, events, deps, depEvents, names };
  }, [data.tasks, data.taskEvents, data.dependencies, data.dependencyEvents, risk, idx, user]);
}
