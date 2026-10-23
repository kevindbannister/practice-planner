// The chat assistant, planner side. It builds the snapshot the AI is given (nothing else leaves
// the app), and turns each action the AI proposes into plain changes to the planner that can be
// shown, approved and undone. The AI never writes anything itself.
import { Client, Job, Task, fmtDate, holdPatch, resumePatch, isOpen, isOnHold } from "./domain";
import { newKey } from "./planning";
import { Row } from "./schema";
import { PlannerSettings } from "./planning";
import { buildToday } from "./today";
import type { TodayInput } from "./today";

export type AssistAction =
  | { type: "create_task"; title: string; client?: string; project?: string; planned?: string; due?: string; hours?: number }
  | { type: "plan"; item: string; date: string }
  | { type: "set_waiting"; item: string; on: string; until: string; reason?: string }
  | { type: "resume"; item: string }
  | { type: "set_day_type"; date: string; dayType: string }
  | { type: "log_time"; item: string; hours: number }
  | { type: "set_urgent"; item: string; urgent: boolean };

export type Op =
  | { op: "update"; list: "Jobs" | "Tasks"; key: string; patch: Row }
  | { op: "create"; list: "Tasks"; row: Row }
  | { op: "remove"; list: "Tasks"; key: string }
  | { op: "dayType"; date: string; type?: string };

export type Plan = { label: string; ops: Op[]; undo: Op[] } | { error: string };

export type Snapshot = {
  clients: Client[];
  jobs: Job[];
  tasks: Task[];
  projects: Row[];
  settings: PlannerSettings;
  today: string;
};

// ------------------------------------------------------------------ what the AI is shown

export type Privacy = { names: boolean };
export const DEFAULT_PRIVACY: Privacy = { names: true };

const WAIT_KINDS = ["Client", "HMRC", "Companies House", "Someone else"];
/** Most open items sent with a question. */
export const CONTEXT_LIMIT = 200;

/** The snapshot sent with each question: open work, the plan for today and the kinds of day. Names are left out if switched off. */
export function buildContext(s: Snapshot, privacy: Privacy, todayInput?: TodayInput): Record<string, unknown> {
  const byKey = new Map(s.clients.map((c) => [c.Key, c]));
  const used = new Set<string>();
  const client = (k?: string) => {
    if (!k) return undefined;
    used.add(k);
    return k;
  };
  const fin = (r: Row) => String(r.CompletedDate || "");
  // your own tasks always go in (they're what you're most likely to talk about), then jobs by deadline
  const dl = (r: Row) => String(r.Deadline || r.DueDate || "9999");
  const byDl = (a: { r: Row }, b: { r: Row }) => dl(a.r).localeCompare(dl(b.r));
  const tasks = s.tasks.filter(isOpen).map((t) => ({ k: "task", r: t as Row })).sort(byDl).slice(0, CONTEXT_LIMIT);
  const jobs = s.jobs.filter(isOpen).map((j) => ({ k: "job", r: j as Row })).sort(byDl).slice(0, Math.max(0, CONTEXT_LIMIT - tasks.length));
  const work = [...jobs, ...tasks].map(({ k, r }) => ({
    key: r.Key, kind: k, title: r.Title, client: client(r.ClientKey as string), project: r.ProjectKey || undefined,
    deadline: r.Deadline || r.DueDate || undefined, planned: r.PlannedDate || undefined, hours: r.EstimateHours || undefined,
    status: r.Status === "On hold" ? `${r.HoldKind ? `waiting on ${r.HoldKind}` : "on hold"}${r.HoldUntil ? ` until ${r.HoldUntil}` : ""}` : undefined,
    urgent: r.Priority === "urgent" || undefined,
  }));
  const recent = [...s.jobs, ...s.tasks]
    .filter((r) => (r.Status === "Complete" || r.Status === "Done") && fin(r) >= addDaysIso(s.today, -7))
    .slice(0, 30)
    .map((r) => ({ key: r.Key, title: r.Title, client: client(r.ClientKey as string), done: fin(r), hours: r.ActualHours || undefined }));
  const clients = [...used].map((k) => ({ key: k, ...(privacy.names ? { name: byKey.get(k)?.Title } : {}) }));
  const plan = todayInput
    ? (() => {
        const t = buildToday(todayInput);
        return {
          summary: t.headline,
          lines: [...t.lines, ...t.suggested].map((l) => ({ key: l.key, why: l.reasons.join("; ") })),
          conflicts: t.conflicts.map((c) => c.text),
        };
      })()
    : undefined;
  return {
    today: s.today,
    weekday: fmtDate(s.today, { weekday: true }).split(" ")[0],
    todayKind: s.settings.dayTypes.find((d) => d.key === (s.settings.overrides[s.today] ?? s.settings.week[String(new Date(`${s.today}T00:00:00Z`).getUTCDay())]))?.key,
    dayTypes: s.settings.dayTypes.map((d) => ({ key: d.key, name: d.name })),
    plan, work, recentlyFinished: recent, clients,
    projects: s.projects.filter((p) => p.Status !== "Done").map((p) => ({ key: p.Key, title: p.Title })),
  };
}

function addDaysIso(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Put real names where the AI wrote client keys, when names were kept from it. */
export function withNames(text: string, clients: Client[]): string {
  let out = text;
  for (const c of clients) if (c.Key && out.includes(c.Key)) out = out.split(c.Key).join(c.Title);
  return out;
}

// ------------------------------------------------------------------ turning actions into changes

const rowOf = (s: Snapshot, key: string): { list: "Jobs" | "Tasks"; row: Row } | undefined => {
  const j = s.jobs.find((x) => x.Key === key);
  if (j) return { list: "Jobs", row: j };
  const t = s.tasks.find((x) => x.Key === key);
  return t ? { list: "Tasks", row: t } : undefined;
};
const nameOf = (s: Snapshot, r: Row) => {
  const c = s.clients.find((x) => x.Key === r.ClientKey);
  return `${c ? `${c.Title}: ` : ""}${r.Title}`;
};
const before = (row: Row, patch: Row): Row => Object.fromEntries(Object.keys(patch).map((k) => [k, row[k] ?? ""]));
const dayName = (d: string) => fmtDate(d, { weekday: true, year: false });

/** Undo for changes about to be applied, read from the planner as it is now (not when the AI answered). */
export function freshUndo(plan: { ops: Op[]; undo: Op[] }, s: Snapshot): Op[] {
  return plan.ops.map((o, i) => {
    if (o.op === "update") {
      const row = (o.list === "Jobs" ? s.jobs : s.tasks).find((r) => r.Key === o.key);
      return row ? { ...o, patch: before(row, o.patch) } : plan.undo[i];
    }
    if (o.op === "dayType") return { op: "dayType", date: o.date, type: s.settings.overrides[o.date] };
    return plan.undo[i];
  });
}

/** What one proposed action would do: a label for the card, the changes, and how to undo them. */
export function toPlan(a: AssistAction, s: Snapshot, makeKey: (prefix: string) => string = newKey): Plan {
  const item = "item" in a ? rowOf(s, a.item) : undefined;
  const upd = (patch: Row, label: string): Plan =>
    item ? { label, ops: [{ op: "update", list: item.list, key: item.row.Key as string, patch }], undo: [{ op: "update", list: item.list, key: item.row.Key as string, patch: before(item.row, patch) }] } : { error: "That item isn't on the planner any more." };

  switch (a.type) {
    case "create_task": {
      const client = a.client ? s.clients.find((c) => c.Key === a.client) : undefined;
      const project = a.project ? s.projects.find((p) => p.Key === a.project) : undefined;
      if (a.client && !client) return { error: "I couldn't find that client." };
      if (a.project && !project) return { error: "I couldn't find that business project." };
      const key = makeKey("T");
      const row: Row = {
        Key: key, Title: a.title, ClientKey: client?.Key || "", ClientName: client?.Title || "", ProjectKey: project?.Key || "",
        PlannedDate: a.planned || "", DueDate: a.due || "", EstimateHours: a.hours || 1, Status: "Open", Type: "Task",
        Notes: "Added by the assistant.",
      };
      const parts = [client?.Title, project ? String(project.Title) : "", a.planned ? `planned ${dayName(a.planned)}` : "", a.due ? `due ${dayName(a.due)}` : ""].filter(Boolean);
      return { label: `New task: ${a.title}${parts.length ? ` (${parts.join(", ")})` : ""}`, ops: [{ op: "create", list: "Tasks", row }], undo: [{ op: "remove", list: "Tasks", key }] };
    }
    case "plan":
      return item ? upd({ PlannedDate: a.date, DayOrder: "", StartTime: "" }, `Plan ${nameOf(s, item.row)} for ${dayName(a.date)}`) : { error: "That item isn't on the planner any more." };
    case "set_waiting":
      if (!item) return { error: "That item isn't on the planner any more." };
      if (!WAIT_KINDS.includes(a.on)) return { error: "I don't know who it's waiting on." };
      return upd({ ...holdPatch(a.reason || `Waiting on ${a.on}`, a.until, s.today, a.on) }, `${nameOf(s, item.row)}: waiting on ${a.on}, chase ${dayName(a.until)}`);
    case "resume":
      if (!item) return { error: "That item isn't on the planner any more." };
      if (!isOnHold(item.row as { Status?: string })) return { error: "That item isn't on hold." };
      return upd(resumePatch(item.row as never, s.today), `${nameOf(s, item.row)}: take off hold`);
    case "set_day_type": {
      const type = s.settings.dayTypes.find((d) => d.key === a.dayType);
      if (!type) return { error: "I don't know that kind of day." };
      // only that one day is touched, so undoing it can't wipe a change made to another day since
      return { label: `${dayName(a.date)} becomes a ${type.name.toLowerCase()}`, ops: [{ op: "dayType", date: a.date, type: a.dayType }], undo: [{ op: "dayType", date: a.date, type: s.settings.overrides[a.date] }] };
    }
    case "log_time":
      if (!item) return { error: "That item isn't on the planner any more." };
      return upd({ ActualHours: a.hours, TimeSkipped: "" }, `Log ${a.hours}h on ${nameOf(s, item.row)}`);
    case "set_urgent":
      if (!item) return { error: "That item isn't on the planner any more." };
      if (item.list !== "Jobs") return { error: "Only jobs can be marked urgent." };
      return upd({ Priority: a.urgent ? "urgent" : "" }, a.urgent ? `Mark ${nameOf(s, item.row)} as urgent` : `Clear urgent on ${nameOf(s, item.row)}`);
  }
}

/** Keep only actions with the right shape (the server checks too; this is for answers from elsewhere). */
export function validActions(list: unknown): AssistAction[] {
  return (Array.isArray(list) ? list : []).filter((a) => a && typeof a === "object" && typeof (a as { type?: unknown }).type === "string") as AssistAction[];
}

export type LogEntry = { at: string; asked: string; reply: string; applied: string[]; undone?: string[]; names: boolean };
export const LOG_LIMIT = 100;
export const addLog = (log: LogEntry[], e: LogEntry): LogEntry[] => [e, ...log].slice(0, LOG_LIMIT);
