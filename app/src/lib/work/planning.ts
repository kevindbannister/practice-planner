// How the planner, the timesheet and the reminders see dependencies. Pure rules over records the app already holds: nothing here creates a planned session, moves
// one, sends anything or touches a deadline. Whoever calls these decides what to save, and the user confirms it.
import { Row } from "../schema";
import { Assessment, World, assess } from "./readiness";
import { Dependency, DepEvent } from "./dependencies";
import { WorkTask } from "./model";
import { TaskEvent, chaseHistory, MIN_DAYS_BETWEEN_PORTAL_REMINDERS } from "./clientActions";

const s = (v: unknown) => (v == null ? "" : String(v).trim());
const day = (x: string) => s(x).slice(0, 10);
const addD = (x: string, n: number) => new Date(new Date(`${x}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86400000);
const finished = (st: string) => st === "Done" || st === "Complete" || st === "Cancelled";

// ---------------------------------------------------------------- the planner
export type Plannable = { blocked?: string; actionableHours?: number; partial?: boolean; hours: number; clientOwned?: boolean };
/** What the planner may do with a piece of work. Fully blocked work is never offered as something to do (it is listed with its reason instead). A partly ready job is
 *  offered for the hours that can actually be done now, and says so. Work that sits with the client or an outside party is never internal capacity. */
export function plannable(a: Assessment, hours: number, actionable: number | undefined, task?: WorkTask): Plannable {
  if (task && task.ownerType !== "user") return { hours: 0, clientOwned: true, blocked: "With the client or an outside party" };
  if (a.readiness === "blocked") return { hours, blocked: `Blocked: ${a.reasons[0] || "something it needs isn't done"}` };
  if (a.readiness === "partly_ready" && actionable != null && actionable > 0 && actionable < hours - 1e-9) return { hours: actionable, actionableHours: actionable, partial: true };
  return { hours };
}
export const partlyNote = (hours: number, full: number) => `Available part only (${hours}h of ${full}h)`;

/** Blocked work whose deadline is near is what the user most needs to see, so the planner lists it rather than leaving it out. */
export function blockedWithDeadline(blocked: { key: string; deadline?: string; reason: string }[], today: string, withinDays: number): typeof blocked {
  return blocked.filter((b) => b.deadline && b.deadline <= addD(today, withinDays)).sort((a, b) => (a.deadline || "").localeCompare(b.deadline || ""));
}

// ---------------------------------------------------------------- newly unblocked work
export type Unblocked = { kind: "task" | "job"; key: string; title: string; clientKey: string; owner: string; since: string; because: string };
/** Work that became ready because a prerequisite was satisfied (or overridden) in the last `days`, and is not yet done. It is surfaced to whoever owns it; nothing is planned for them. */
export function newlyUnblocked(world: World, events: DepEvent[], now: string, days: number, ownerOf: (kind: "task" | "job", key: string) => string): Unblocked[] {
  const since = new Date(new Date(now).getTime() - days * 86400000).toISOString();
  const byDep = new Map(world.deps.map((d) => [d.key, d]));
  const out = new Map<string, Unblocked>();
  for (const e of events) {
    if ((e.type !== "satisfy" && e.type !== "override") || e.at < since) continue;
    const dep = byDep.get(e.dependencyKey); if (!dep) continue;
    const kind = dep.dependent.kind === "job" ? "job" : "task"; const key = dep.dependent.key;
    const t = kind === "task" ? world.tasks.get(key) : undefined, j = kind === "job" ? world.jobs.get(key) : undefined;
    if (!t && !j) continue; if (t && finished(t.status)) continue; if (j && (j.status === "Complete" || j.status === "Cancelled")) continue;
    const a = assess(kind, key, world); if (a.readiness !== "ready" && a.readiness !== "partly_ready") continue;
    const prior = out.get(`${kind}:${key}`); if (prior && prior.since >= e.at) continue;
    const pre = dep.prerequisite.kind === "job" ? world.jobs.get(dep.prerequisite.key)?.title : world.tasks.get(dep.prerequisite.key)?.title;
    out.set(`${kind}:${key}`, { kind, key, title: (t?.title || j?.title) as string, clientKey: (t?.clientKey || j?.clientKey || "") as string, owner: ownerOf(kind, key), since: e.at, because: `${pre || "A prerequisite"} ${e.type === "override" ? "was overridden" : "is done"}` });
  }
  return [...out.values()].sort((a, b) => b.since.localeCompare(a.since));
}

// ---------------------------------------------------------------- the timesheet
export type TimeTarget = { allowed: boolean; reason?: string; chase?: boolean; practiceTime: boolean };
/** Time goes into the existing timesheet only. A task the client owns uses no staff time, except the time an internal person spends chasing it (recorded as chase time). */
export function timeRule(t: WorkTask, forChasing = false): TimeTarget {
  if (t.area === "personal" || t.privacy === "private") return { allowed: true, practiceTime: false, reason: "Personal: kept out of practice time reports." };
  if (t.ownerType !== "user") return forChasing ? { allowed: true, chase: true, practiceTime: true } : { allowed: false, practiceTime: false, reason: "The client does this one, so it uses none of your time. Record chasing it as chase time." };
  return { allowed: true, practiceTime: true };
}
/** Hours that should count as internal capacity needed: not client-owned work, not personal tasks. */
export const usesCapacity = (t: WorkTask) => t.ownerType === "user" && t.area !== "personal" && t.privacy !== "private";

// ---------------------------------------------------------------- reminders
export type ReminderKind = "task_due" | "client_action" | "dependency_followup" | "overdue" | "newly_unblocked";
export const REMINDER_LABEL: Record<ReminderKind, string> = { task_due: "Task due", client_action: "Client action", dependency_followup: "Dependency follow-up", overdue: "Overdue", newly_unblocked: "Newly unblocked" };
export type Reminder = { key: string; kind: ReminderKind; taskKey?: string; clientKey: string; title: string; detail: string; priority: "high" | "medium" | "low"; due: string; /** what the person can do; sending still needs their confirmation */ suggest: "log_call" | "log_email" | "send_reminder" | "change_follow_up" | "escalate" | "plan" | "open" };
export type ReminderSettings = { dueSoonDays: number; clientCadenceDays: number; escalateAfter: number; maxPerTask: number };
export const DEFAULT_REMINDERS: ReminderSettings = { dueSoonDays: 1, clientCadenceDays: MIN_DAYS_BETWEEN_PORTAL_REMINDERS, escalateAfter: 3, maxPerTask: 6 };

/** Reminders worth showing today. Quiet by design: a client action is only suggested again after the cadence has passed since the last chase, and after `escalateAfter`
 *  chases with no answer the suggestion becomes "escalate" instead of another reminder. Private and personal tasks are never in here. */
export function reminders(i: { tasks: WorkTask[]; events: TaskEvent[]; deps: Dependency[]; world: World; today: string; settings?: ReminderSettings; names: (clientKey: string) => string }): Reminder[] {
  const st = i.settings || DEFAULT_REMINDERS, out: Reminder[] = [];
  const open = i.tasks.filter((t) => !finished(t.status) && t.area !== "personal" && t.privacy !== "private");
  for (const t of open) {
    const who = i.names(t.clientKey), due = day(t.dueDate), follow = day(t.followUpDate);
    if (t.ownerType !== "user") {
      if (!["Requested", "In progress", "Needs more", "Submitted"].includes(t.status) || t.status === "Submitted") continue;
      const hist = chaseHistory(i.events, t.key), last = hist[0] ? day(hist[0].at) : "", count = hist.filter((h) => h.type !== "escalated" && h.type !== "chase-note").length;
      if (hist.some((h) => h.type === "escalated")) continue;
      const wanted = (due && due <= addD(i.today, st.dueSoonDays)) || (follow && follow <= i.today); if (!wanted) continue;
      if (last && daysBetween(last, i.today) < st.clientCadenceDays) continue;
      if (follow && follow > i.today) continue;
      const late = due && due < i.today;
      if (count >= st.escalateAfter) out.push({ key: `rem:esc:${t.key}`, kind: "client_action", taskKey: t.key, clientKey: t.clientKey, title: `${who}: ${t.title}`, detail: `Chased ${count} times with no answer. Consider escalating.`, priority: "high", due, suggest: "escalate" });
      else if (count < st.maxPerTask) out.push({ key: `rem:ca:${t.key}`, kind: "client_action", taskKey: t.key, clientKey: t.clientKey, title: `${who}: ${t.title}`, detail: `${late ? `Overdue since ${due}` : due ? `Due ${due}` : "Follow-up date reached"}${last ? `, last chased ${last}` : ", not chased yet"}.`, priority: late ? "high" : "medium", due, suggest: last ? "send_reminder" : "log_call" });
      continue;
    }
    if (due && due < i.today) out.push({ key: `rem:od:${t.key}`, kind: "overdue", taskKey: t.key, clientKey: t.clientKey, title: t.title, detail: `Overdue since ${due}.`, priority: "high", due, suggest: "open" });
    else if (due && due <= addD(i.today, st.dueSoonDays)) out.push({ key: `rem:due:${t.key}`, kind: "task_due", taskKey: t.key, clientKey: t.clientKey, title: t.title, detail: due === i.today ? "Due today." : "Due soon.", priority: "medium", due, suggest: "plan" });
  }
  // a dependency whose prerequisite was expected by a date that has passed, and still isn't met
  for (const d of i.deps) {
    if (d.status !== "active") continue;
    const exp = day(d.expectedCompletion); if (!exp || exp >= i.today) continue;
    const dep = d.dependent.kind === "task" ? i.world.tasks.get(d.dependent.key) : undefined, job = d.dependent.kind === "job" ? i.world.jobs.get(d.dependent.key) : undefined;
    const title = dep?.title || job?.title; if (!title) continue; if (dep && (finished(dep.status) || dep.area === "personal" || dep.privacy === "private")) continue;
    const pre = d.prerequisite.kind === "job" ? i.world.jobs.get(d.prerequisite.key)?.title : i.world.tasks.get(d.prerequisite.key)?.title;
    out.push({ key: `rem:dep:${d.key}`, kind: "dependency_followup", taskKey: dep?.key, clientKey: dep?.clientKey || job?.clientKey || "", title: `${title} is waiting`, detail: `${pre || "A prerequisite"} was expected by ${exp}.`, priority: "medium", due: exp, suggest: "change_follow_up" });
  }
  return out.sort((a, b) => (a.priority === b.priority ? a.due.localeCompare(b.due) : a.priority === "high" ? -1 : 1));
}
export const unblockedReminders = (u: Unblocked[], names: (k: string) => string): Reminder[] => u.map((x) => ({ key: `rem:ub:${x.kind}:${x.key}`, kind: "newly_unblocked", taskKey: x.kind === "task" ? x.key : undefined, clientKey: x.clientKey, title: `${names(x.clientKey) ? names(x.clientKey) + ": " : ""}${x.title} can start`, detail: `${x.because}.`, priority: "medium", due: "", suggest: "plan" }));

/** Time can only be recorded against a client-owned task as chase time: the "Chasing records" activity (or any activity named chase). Returns the reason time is refused. */
export const isChaseActivity = (activityKey: string) => /chas/.test(s(activityKey).toLowerCase());
export function timeRefusal(t: WorkTask | undefined, activityKey: string): string | undefined {
  if (!t) return undefined;
  const r = timeRule(t, isChaseActivity(activityKey));
  return r.allowed ? undefined : r.reason;
}
