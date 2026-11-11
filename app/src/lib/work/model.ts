// The one task model. A "task" is any individual action: a five-minute personal reminder, a small client action, a meeting action, a project task or an
// action the CLIENT must do. It is NOT an accounting job (a formal deliverable with a workflow), though a task can point at a job and depend on one.
//
// Nothing here replaces the existing Tasks list. New fields are optional columns on it. Old rows keep their keys and are read through `readTask`,
// which works out the new fields from the old ones (no data has to be rewritten for old tasks to work). Pure rules; no I/O.
import { Row } from "../schema";

const s = (v: unknown) => (v == null ? "" : String(v).trim());
const n = (v: unknown) => { const x = typeof v === "number" ? v : parseFloat(s(v)); return Number.isFinite(x) ? x : undefined; };

export type Area = "client" | "practice" | "project" | "personal" | "inbox";
export const AREAS: Area[] = ["client", "practice", "project", "personal", "inbox"];
export const AREA_LABEL: Record<Area, string> = { client: "Client work", practice: "Practice administration", project: "Business projects", personal: "Personal", inbox: "Inbox" };

/** Who must do the work. `user` is someone in the practice, `contact` a contact at the client, `external` anyone else (solicitor, HMRC, another accountant). */
export type OwnerType = "user" | "contact" | "external";
export const OWNER_TYPES: OwnerType[] = ["user", "contact", "external"];

/** One central status model. `Open`, `Done`, `Cancelled` and `On hold` are what the app already stores, so old rows are valid as they are.
 *  The client-action statuses only apply to tasks the client or an outside party must do (ownerType contact or external). */
export type Status = "Open" | "In progress" | "On hold" | "Done" | "Cancelled" | "Not requested" | "Requested" | "Submitted" | "Under review" | "Needs more" | "Complete";
export const CORE_STATUSES: Status[] = ["Open", "In progress", "On hold", "Done", "Cancelled"];
export const EXTERNAL_STATUSES: Status[] = ["Not requested", "Requested", "In progress", "Submitted", "Under review", "Needs more", "Done", "Cancelled"];
export const STATUS_LABEL: Record<string, string> = { "Not requested": "Not requested", Requested: "Requested", Submitted: "Submitted by client", "Under review": "Under review", "Needs more": "More information required", Complete: "Done" };
export const statusLabel = (st: string) => STATUS_LABEL[st] || st;

/** Statuses that mean the work is finished. "Submitted" and "Under review" are NOT finished: an external party saying it is done does not satisfy anything until
 *  the practice verifies it (see dependencies.ts, `verificationRequired`). */
export const isFinished = (st: string) => st === "Done" || st === "Complete" || st === "Cancelled";
export const isDone = (st: string) => st === "Done" || st === "Complete";

/** Allowed moves between statuses. Anything can be reopened from Done or Cancelled, but only by an explicit reopen (which is logged). */
export function canMove(from: string, to: string, ownerType: OwnerType): boolean {
  if (from === to) return true;
  const ok = ownerType === "user" ? CORE_STATUSES : EXTERNAL_STATUSES;
  if (!ok.includes(to as Status)) return false;
  // a person doing their own work can go from anywhere to anything in their list; an external action follows the request/verify path
  if (ownerType === "user") return true;
  const next: Record<string, string[]> = {
    "Not requested": ["Requested", "Cancelled"], Requested: ["In progress", "Submitted", "Cancelled"], "In progress": ["Submitted", "Cancelled"],
    Submitted: ["Under review", "Done", "Needs more", "Cancelled"], "Under review": ["Done", "Needs more", "Cancelled"], "Needs more": ["Requested", "In progress", "Submitted", "Cancelled"],
    Done: ["Requested", "Under review"], Cancelled: ["Not requested", "Requested"],
  };
  return (next[from] || []).includes(to);
}

export type Priority = "high" | "medium" | "low" | "";
export const PRIORITIES: Priority[] = ["high", "medium", "low"];
export type Privacy = "shared" | "private";

export type WorkTask = {
  key: string; title: string; description: string; area: Area;
  parentKey: string; clientKey: string; jobKey: string; projectKey: string; meetingKey: string;
  ownerType: OwnerType; /** the internal person accountable. For an external task this is the person who chases it. */ owner: string;
  /** who must actually do it, when not the owner: a client contact's key, or free text for an external party. */ responsible: string;
  createdBy: string; created: string; updated: string;
  status: string; priority: Priority;
  /** The separate dates. Statutory deadlines live on the job; a task has its own due date and an internal target. Planned work is in PlanSessions, never here. */
  dueDate: string; internalTarget: string; clientAgreed: string; legacyPlanned: string;
  estimateMinutes?: number; remainingMinutes?: number; completedAt: string; completedBy: string;
  blockedReason: string; waitingSince: string; followUpDate: string; recurrence: string;
  privacy: Privacy; tags: string[]; version: number;
  /** Set on creation from a quick-add, a bulk paste or an offline queue, so a retried submission is recognised and not created twice. */
  captureKey: string;
  /** True when this row was read from an old task that never had the new fields, so the screens can tell. */
  legacy: boolean;
};

/** Work out the area for a task. An explicit Area wins. Otherwise: a project task is a project task, a task with a client is client work, and anything else is in the inbox. */
export function areaOf(r: Row): Area {
  const a = s(r.Area) as Area;
  if (AREAS.includes(a)) return a;
  if (s(r.ProjectKey)) return "project";
  if (s(r.ClientKey)) return "client";
  return "inbox";
}

export function readTask(r: Row): WorkTask {
  const area = areaOf(r);
  const ot = s(r.OwnerType) as OwnerType;
  const hours = n(r.EstimateHours), rem = n(r.RemainingHours);
  const estMin = n(r.EstimateMinutes) ?? (hours !== undefined ? Math.round(hours * 60) : undefined);
  const remMin = n(r.RemainingMinutes) ?? (rem !== undefined ? Math.round(rem * 60) : undefined);
  const pr = s(r.Priority).toLowerCase();
  return {
    key: s(r.Key), title: s(r.Title) || s(r.Type) || "(untitled)", description: s(r.Description) || s(r.Notes), area,
    parentKey: s(r.ParentTaskKey), clientKey: s(r.ClientKey), jobKey: s(r.JobKey), projectKey: s(r.ProjectKey), meetingKey: s(r.MeetingKey),
    ownerType: OWNER_TYPES.includes(ot) ? ot : "user", owner: s(r.AssignedUser) || s(r.InternalOwner), responsible: s(r.AssignedContact) || s(r.ExternalParty),
    createdBy: s(r.CreatedBy), created: s(r.Created), updated: s(r.Updated),
    status: s(r.Status) || "Open", priority: pr === "high" || pr === "medium" || pr === "low" ? pr : "",
    dueDate: s(r.DueDate).slice(0, 10), internalTarget: s(r.InternalTargetDate).slice(0, 10), clientAgreed: s(r.ClientAgreedDate).slice(0, 10), legacyPlanned: s(r.PlannedDate).slice(0, 10),
    estimateMinutes: estMin, remainingMinutes: remMin, completedAt: s(r.CompletedDate), completedBy: s(r.CompletedBy),
    blockedReason: s(r.BlockedReason), waitingSince: s(r.WaitingSince).slice(0, 10), followUpDate: s(r.FollowUpDate).slice(0, 10), recurrence: s(r.RecurrenceRule),
    privacy: area === "personal" || s(r.PrivacyLevel) === "private" ? "private" : "shared",
    tags: s(r.Tags).split(",").map((x) => x.trim()).filter(Boolean), version: n(r.Version) ?? 0, captureKey: s(r.CaptureKey),
    legacy: !s(r.Area) && !s(r.Version),
  };
}

export type Capture = { title: string; clientKey?: string; projectKey?: string; meetingKey?: string; jobKey?: string; parentKey?: string; area?: Area; due?: string; captureKey?: string };

/** Creating a task needs a title and nothing else. With no context it goes to the Inbox. Personal tasks are private and have the creator as owner. */
export function newTaskRow(i: Capture, ctx: { user: string; now: string; key: string }): { row?: Row; error?: string } {
  const title = i.title.replace(/\s+/g, " ").trim();
  if (!title) return { error: "A task needs a title." };
  if (title.length > 300) return { error: "That title is too long (300 characters at most)." };
  const area: Area = i.area || (i.projectKey ? "project" : i.clientKey ? "client" : "inbox");
  return { row: {
    Key: ctx.key, Title: title, Area: area, Status: "Open", OwnerType: "user", AssignedUser: ctx.user, CreatedBy: ctx.user, Created: ctx.now, Updated: ctx.now, Version: 1,
    ClientKey: i.clientKey || "", ProjectKey: i.projectKey || "", MeetingKey: i.meetingKey || "", JobKey: i.jobKey || "", ParentTaskKey: i.parentKey || "",
    DueDate: i.due || "", PrivacyLevel: area === "personal" ? "private" : "shared", CaptureKey: i.captureKey || "",
  } };
}

/** Break pasted text into task titles: one per line, bullets and numbers stripped, blanks and exact repeats dropped. */
export function splitBulk(text: string): string[] {
  const seen = new Set<string>(), out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.replace(/^\s*(?:[-*••]|\d+[.)])\s*/, "").replace(/\s+/g, " ").trim();
    const k = t.toLowerCase();
    if (!t || seen.has(k)) continue;
    seen.add(k); out.push(t);
  }
  return out;
}

/** A stable key for one line in one bulk submission. Retrying the same paste gives the same keys, so rows already created are recognised and skipped. */
export function bulkCaptureKeys(batchId: string, titles: string[]): string[] {
  return titles.map((t, i) => `${batchId}:${i}:${t.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 40)}`);
}
/** Which of these captures still need creating, given the keys already on stored tasks. */
export const notYetCreated = (keys: string[], existing: Iterable<string>): number[] => { const have = new Set(existing); return keys.map((k, i) => (have.has(k) ? -1 : i)).filter((i) => i >= 0); };
