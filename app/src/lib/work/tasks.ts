// Everyday task handling on the one task model: the Inbox, triage, the client task list (filters and groups), parent and child tasks, bulk edits and undo.
// Pure rules over rows. Every change is a patch that bumps Version, and refuses (never overwrites) when the task has changed since it was read.
import { parseRule, formatRule } from "./recurrence";
import { Row } from "../schema";
import { Area, Priority, WorkTask, canMove, isDone, isFinished, readTask } from "./model";

const s = (v: unknown) => (v == null ? "" : String(v).trim());
const day = (iso: string) => iso.slice(0, 10);

// ---------------------------------------------------------------- the Inbox
/** Open, unclassified, top-level tasks, newest first. A child task is never in the Inbox: it sits under its parent. */
export function inbox(rows: Row[]): WorkTask[] {
  return rows.map(readTask).filter((t) => t.area === "inbox" && !isFinished(t.status) && !t.parentKey).sort((a, b) => b.created.localeCompare(a.created) || b.key.localeCompare(a.key));
}

// ---------------------------------------------------------------- filters and groups for a client (or any list)
export type Filter = "outstanding" | "ours" | "client" | "waiting" | "blocked" | "overdue" | "completed";
export const FILTERS: [Filter, string][] = [["outstanding", "All outstanding"], ["ours", "Our actions"], ["client", "Client actions"], ["waiting", "Waiting"], ["blocked", "Blocked"], ["overdue", "Overdue"], ["completed", "Completed"]];
const external = (t: WorkTask) => t.ownerType !== "user";
export const isWaiting = (t: WorkTask) => !isFinished(t.status) && (t.status === "On hold" || !!t.waitingSince || (external(t) && ["Requested", "In progress", "Needs more"].includes(t.status)));
/** `blocked` is the set of task keys the dependency engine (a later phase) says cannot progress. Until it exists, only an explicit reason blocks a task. */
export const isBlocked = (t: WorkTask, blocked: ReadonlySet<string> = new Set()) => !isFinished(t.status) && (!!t.blockedReason || blocked.has(t.key));
export const isOverdue = (t: WorkTask, today: string) => !isFinished(t.status) && !!t.dueDate && t.dueDate < today;

export function filterTasks(list: WorkTask[], f: Filter, today: string, blocked: ReadonlySet<string> = new Set()): WorkTask[] {
  const open = (t: WorkTask) => !isFinished(t.status);
  switch (f) {
    case "outstanding": return list.filter(open);
    case "ours": return list.filter((t) => open(t) && !external(t));
    case "client": return list.filter((t) => open(t) && external(t));
    case "waiting": return list.filter(isWaiting);
    case "blocked": return list.filter((t) => isBlocked(t, blocked));
    case "overdue": return list.filter((t) => isOverdue(t, today));
    case "completed": return list.filter((t) => isDone(t.status));
  }
}
/** Counts for the filter chips. Each task is counted once per filter it meets; the same task appears under several, which is why these don't add up to the total. */
export const filterCounts = (list: WorkTask[], today: string, blocked?: ReadonlySet<string>): Record<Filter, number> =>
  Object.fromEntries(FILTERS.map(([f]) => [f, filterTasks(list, f, today, blocked).length])) as Record<Filter, number>;

const PRI = { high: 0, medium: 1, low: 2, "": 3 } as const;
/** Overdue first, then by due date (undated last), then priority, then oldest. */
export const sortTasks = (list: WorkTask[]): WorkTask[] => [...list].sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999") || PRI[a.priority] - PRI[b.priority] || a.created.localeCompare(b.created) || a.key.localeCompare(b.key));

export type GroupBy = "none" | "status" | "responsible" | "job" | "due" | "priority";
export type Group = { key: string; label: string; tasks: WorkTask[] };
const dueBucket = (t: WorkTask, today: string) => (!t.dueDate ? ["9", "No due date"] : t.dueDate < today ? ["0", "Overdue"] : t.dueDate === today ? ["1", "Today"] : t.dueDate <= addDays(today, 7) ? ["2", "This week"] : ["3", "Later"]);
function addDays(iso: string, n: number) { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

export function groupTasks(list: WorkTask[], by: GroupBy, i: { today: string; jobTitle?: (k: string) => string; responsibleLabel?: (t: WorkTask) => string }): Group[] {
  if (by === "none") return [{ key: "all", label: "", tasks: sortTasks(list) }];
  const m = new Map<string, Group>(); const order = new Map<string, string>();
  for (const t of list) {
    let k: string, label: string, ord: string;
    if (by === "status") { k = label = t.status; ord = `${isFinished(t.status) ? "9" : "0"}${label}`; }
    else if (by === "responsible") { label = i.responsibleLabel ? i.responsibleLabel(t) : t.ownerType === "user" ? "Us" : t.responsible || "Client"; k = label; ord = `${t.ownerType === "user" ? "0" : "1"}${label}`; }
    else if (by === "job") { k = t.jobKey || "-"; label = t.jobKey ? (i.jobTitle?.(t.jobKey) || t.jobKey) : "No job"; ord = `${t.jobKey ? "0" : "9"}${label}`; }
    else if (by === "due") { [ord, label] = dueBucket(t, i.today); k = label; }
    else { k = label = t.priority ? t.priority[0].toUpperCase() + t.priority.slice(1) : "No priority"; ord = String(PRI[t.priority]); }
    if (!m.has(k)) { m.set(k, { key: k, label, tasks: [] }); order.set(k, ord); }
    m.get(k)!.tasks.push(t);
  }
  return [...m.values()].sort((a, b) => order.get(a.key)!.localeCompare(order.get(b.key)!)).map((g) => ({ ...g, tasks: sortTasks(g.tasks) }));
}

// ---------------------------------------------------------------- parents and children
export const MAX_DEPTH = 3;
export const childrenOf = (rows: Row[], key: string): WorkTask[] => rows.map(readTask).filter((t) => t.parentKey === key);
export const openChildren = (rows: Row[], key: string): WorkTask[] => childrenOf(rows, key).filter((t) => !isFinished(t.status));
export const childProgress = (rows: Row[], key: string): { done: number; total: number } => { const c = childrenOf(rows, key).filter((t) => t.status !== "Cancelled"); return { done: c.filter((t) => isDone(t.status)).length, total: c.length }; };
const depthOf = (by: Map<string, WorkTask>, key: string): number => { let d = 1, k = by.get(key)?.parentKey; const seen = new Set([key]); while (k && by.has(k) && !seen.has(k)) { seen.add(k); d++; k = by.get(k)!.parentKey; } return d; };
const height = (rows: WorkTask[], key: string): number => { const kids = rows.filter((t) => t.parentKey === key); return 1 + (kids.length ? Math.max(...kids.map((k) => height(rows, k.key))) : 0); };

/** May `key` be made a child of `parentKey` (or have no parent, with ""). Returns reasons it may not. */
export function parentProblems(rows: Row[], key: string, parentKey: string): string[] {
  if (!parentKey) return [];
  const all = rows.map(readTask), by = new Map(all.map((t) => [t.key, t]));
  const me = by.get(key), p = by.get(parentKey);
  if (!me) return ["That task doesn't exist."];
  if (!p) return ["The parent task doesn't exist."];
  if (key === parentKey) return ["A task can't be its own parent."];
  for (let k = p.parentKey, n = 0; k && n < 50; k = by.get(k)?.parentKey || "", n++) if (k === key) return ["That would make a task a child of its own child."];
  if (isFinished(p.status)) return ["The parent is already finished. Reopen it first."];
  if (me.clientKey && p.clientKey && me.clientKey !== p.clientKey) return ["A task and its parent must belong to the same client."];
  if (depthOf(by, parentKey) + height(all, key) > MAX_DEPTH) return [`Tasks can only be ${MAX_DEPTH} levels deep.`];
  return [];
}

// ---------------------------------------------------------------- changes
export type Spec = {
  client?: string | null; project?: string | null; job?: string | null; parent?: string | null; area?: Area; owner?: string; ownerType?: "user" | "contact" | "external"; responsible?: string;
  due?: string | null; target?: string | null; followUp?: string | null; priority?: Priority; status?: string; title?: string; description?: string; blockedReason?: string; tags?: string[]; estimateMinutes?: number | null; repeat?: string | null;
};
export type Ctx = { user: string; now: string };
export type Change = { key: string; patch: Row; before: Row; error?: undefined } | { key: string; error: string };

const COLS: Record<keyof Spec, string> = { client: "ClientKey", project: "ProjectKey", job: "JobKey", parent: "ParentTaskKey", area: "Area", owner: "AssignedUser", ownerType: "OwnerType", responsible: "AssignedContact", due: "DueDate", target: "InternalTargetDate", followUp: "FollowUpDate", priority: "Priority", status: "Status", title: "Title", description: "Description", blockedReason: "BlockedReason", tags: "Tags", estimateMinutes: "EstimateMinutes" , repeat: "RecurrenceRule"};

/** Work out the patch for one task. `rows` is every task (needed to check parents and open children). `expected` is the Version the screen was showing. `force` allows finishing a task with open children. */
export function changeTask(rows: Row[], key: string, spec: Spec, ctx: Ctx, opts: { expected?: number; force?: boolean } = {}): Change {
  const row = rows.find((r) => s(r.Key) === key);
  if (!row) return { key, error: "That task no longer exists." };
  const t = readTask(row);
  if (opts.expected !== undefined && t.version !== opts.expected) return { key, error: "Someone else changed this task. Reload and try again." };
  const patch: Row = {};
  const set = (k: keyof Spec, v: unknown) => { patch[COLS[k]] = (v == null ? "" : v) as string | number | boolean; };
  if (spec.title !== undefined) { const title = spec.title.replace(/\s+/g, " ").trim(); if (!title) return { key, error: "A task needs a title." }; set("title", title); }
  if (spec.description !== undefined) set("description", spec.description);
  if (spec.client !== undefined) { set("client", spec.client); if (spec.area === undefined && spec.client && t.area === "inbox") set("area", "client"); if (!spec.client && t.area === "client" && !t.projectKey) set("area", "inbox"); }
  if (spec.project !== undefined) { set("project", spec.project); if (spec.area === undefined && spec.project) set("area", "project"); if (!spec.project && t.area === "project") set("area", t.clientKey || spec.client ? "client" : "inbox"); }
  if (spec.area !== undefined) { set("area", spec.area); if (spec.area === "personal") patch.PrivacyLevel = "private"; }
  if (spec.job !== undefined) set("job", spec.job);
  if (spec.owner !== undefined) set("owner", spec.owner);
  if (spec.ownerType !== undefined) set("ownerType", spec.ownerType);
  if (spec.responsible !== undefined) set("responsible", spec.responsible);
  for (const k of ["due", "target", "followUp"] as const) if (spec[k] !== undefined) { const v = spec[k]; if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return { key, error: "That isn't a valid date." }; set(k, v); }
  if (spec.priority !== undefined) set("priority", spec.priority);
  if (spec.blockedReason !== undefined) set("blockedReason", spec.blockedReason.trim());
  if (spec.tags !== undefined) set("tags", spec.tags.map((x) => x.trim()).filter(Boolean).join(", "));
  if (spec.estimateMinutes !== undefined) set("estimateMinutes", spec.estimateMinutes);
  if (spec.repeat !== undefined) { if (spec.repeat) { const r = parseRule(spec.repeat); if ("error" in r) return { key, error: r.error }; set("repeat", formatRule(r)); } else set("repeat", ""); }
  if (spec.parent !== undefined) { const bad = parentProblems(rows, key, spec.parent || ""); if (bad.length) return { key, error: bad[0] }; set("parent", spec.parent); }
  const newType = spec.ownerType ?? t.ownerType;
  if (spec.ownerType !== undefined && spec.ownerType !== t.ownerType && spec.status === undefined && !isFinished(t.status)) {
    if (spec.ownerType !== "user" && t.ownerType === "user" && (t.status === "Open" || t.status === "On hold")) patch.Status = "Not requested";
    if (spec.ownerType === "user" && t.ownerType !== "user") patch.Status = "Open";
  }
  if (spec.status !== undefined && spec.status !== t.status && newType !== "user" && !canMove(t.status, spec.status, newType)) return { key, error: `A client action can't go from "${t.status}" to "${spec.status}" directly.` };
  if (spec.status !== undefined && spec.status !== t.status) {
    if (isDone(spec.status)) {
      const kids = openChildren(rows, key);
      if (kids.length && !opts.force) return { key, error: `${kids.length} smaller task${kids.length === 1 ? " is" : "s are"} still open under this one.` };
      patch.Status = spec.status; patch.CompletedDate = ctx.now; patch.CompletedBy = ctx.user;
    } else { patch.Status = spec.status; if (isFinished(t.status) || t.completedAt) { patch.CompletedDate = ""; patch.CompletedBy = ""; } if (spec.status === "Cancelled") patch.CompletedDate = ""; }
  }
  if (!Object.keys(patch).length) return { key, error: "Nothing to change." };
  patch.Version = t.version + 1; patch.Updated = ctx.now;
  const before: Row = {}; for (const c of Object.keys(patch)) before[c] = row[c] ?? "";
  return { key, patch, before };
}

export const complete = (rows: Row[], key: string, ctx: Ctx, opts?: { expected?: number; force?: boolean }) => changeTask(rows, key, { status: "Done" }, ctx, opts);
export const reopen = (rows: Row[], key: string, ctx: Ctx, opts?: { expected?: number }) => changeTask(rows, key, { status: "Open" }, ctx, opts);
/** "Delete" in the Inbox means cancel: the task is kept, out of the way, and can be brought back. Nothing is erased. */
export const archive = (rows: Row[], key: string, ctx: Ctx, opts?: { expected?: number }) => changeTask(rows, key, { status: "Cancelled" }, ctx, opts);

export type Bulk = { changes: Extract<Change, { patch: Row }>[]; skipped: { key: string; error: string }[] };
/** One spec applied to many tasks. Each is checked on its own, so one failure never stops the rest, and the skipped ones are reported with reasons. */
export function bulkChange(rows: Row[], keys: string[], spec: Spec, ctx: Ctx, opts: { force?: boolean } = {}): Bulk {
  const out: Bulk = { changes: [], skipped: [] };
  for (const key of [...new Set(keys)]) { const c = changeTask(rows, key, spec, ctx, { force: opts.force }); if ("error" in c && c.error) out.skipped.push({ key, error: c.error }); else out.changes.push(c as Extract<Change, { patch: Row }>); }
  return out;
}

/** The patch that puts a change back. It only applies while the task is still at the version the change produced; if anyone has changed it since, it is refused rather than overwriting their work. */
export function undoChange(current: Row[], change: { key: string; patch: Row; before: Row }, ctx: Ctx): { key: string; patch?: Row; error?: string } {
  const row = current.find((r) => s(r.Key) === change.key);
  if (!row) return { key: change.key, error: "That task no longer exists." };
  if (readTask(row).version !== Number(change.patch.Version)) return { key: change.key, error: "It has been changed since, so it wasn't put back." };
  const patch: Row = { ...change.before, Version: Number(change.patch.Version) + 1, Updated: ctx.now };
  return { key: change.key, patch };
}
export { day };
