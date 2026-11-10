// Works out what to write when a planning Plan is applied to the lists as they are now: which parts still apply (a session someone else changed in the
// meantime is left alone, with its whole group), and what each item's own PlannedDate should become. Pure, so it can be tested without a list.
import { Plan, PlanEvent, Session, applyPlan, projectDate } from "./planSessions";

export type Writes = {
  creates: Session[];
  patches: { key: string; patch: Partial<Session> }[];
  events: PlanEvent[];
  /** Items whose PlannedDate should now be this (only where it differs from what it holds). */
  dates: { kind: "job" | "task"; itemKey: string; date: string }[];
  /** Groups left out because their sessions had changed since the plan was made. */
  skipped: { group: string; why: string }[];
};

export function writesFor(plan: Plan, fresh: Session[], planned: Map<string, string>, today: string): Writes {
  // a group is the event's group; a created session belongs to the group of its create event
  const groupOf = new Map<string, string>();
  for (const e of plan.events) groupOf.set(e.sessionKey, e.group);
  const stale = new Set<string>();
  for (const p of plan.patches) {
    const now = fresh.find((x) => x.key === p.key);
    if (!now || now.version !== p.expectVersion) stale.add(groupOf.get(p.key) || p.key);
  }
  const keep = (group: string | undefined) => !stale.has(group || "");
  const creates = plan.creates.filter((x) => keep(groupOf.get(x.key)) && !fresh.some((f) => f.key === x.key));
  const patches = plan.patches.filter((p) => keep(groupOf.get(p.key))).map(({ key, patch }) => ({ key, patch }));
  const events = plan.events.filter((e) => keep(e.group));
  const next = applyPlan(fresh, { ...plan, creates, patches: plan.patches.filter((p) => keep(groupOf.get(p.key))), events });
  const dates: Writes["dates"] = [];
  const items = new Map<string, "job" | "task">();
  for (const x of [...creates, ...fresh.filter((f) => patches.some((p) => p.key === f.key))]) items.set(x.itemKey, x.kind);
  for (const [itemKey, kind] of items) {
    const date = projectDate(next.sessions, itemKey, today);
    if ((planned.get(itemKey) || "") !== date) dates.push({ kind, itemKey, date });
  }
  return { creates, patches, events, dates, skipped: [...stale].map((group) => ({ group, why: "it was changed by someone or something else since you looked, so it was left as it is" })) };
}
