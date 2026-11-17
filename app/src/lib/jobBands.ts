// The Home work tiles: which band each open job falls in (overdue, due very soon, due soon, OK, on hold), whose work it is, and who
// may see what. Nothing here touches SharePoint or the screen, so every rule can be tested on its own.
//
// "Very soon" and "due soon" are set per stage in Settings (a job counts as very soon when its deadline is within that many days
// of today while it is at that stage), because work at an early stage needs warning sooner than work at the final review.
// A tile also has a window in days: work due further off than the window is not counted. Overdue work always is.
import type { Row } from "./schema";
import { daysBetween, isOnHold } from "./domain";
import { Config, hasStaff, staffRole } from "./checklist";
import { stageAt } from "./waiting";

export type Band = "overdue" | "verySoon" | "soon" | "ok" | "hold";
export const BANDS: Band[] = ["overdue", "verySoon", "soon", "ok", "hold"];
export const BAND_LABEL: Record<Band, string> = { overdue: "Overdue", verySoon: "Due very soon", soon: "Due soon", ok: "OK", hold: "On hold" };
export type Counts = Record<Band, number>;
export const emptyCounts = (): Counts => ({ overdue: 0, verySoon: 0, soon: 0, ok: 0, hold: 0 });

export const DEFAULT_VERY_SOON = 3;
export const DEFAULT_SOON = 7;
export const DEFAULT_WINDOW = 14;

const num = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
};

/** The days before the deadline at which work at this stage counts as very soon and as due soon. */
export function thresholds(stage?: Row): { verySoon: number; soon: number } {
  const verySoon = num(stage?.VerySoonDays) ?? DEFAULT_VERY_SOON;
  const soon = Math.max(verySoon, num(stage?.SoonDays) ?? DEFAULT_SOON);
  return { verySoon, soon };
}

/**
 * The bands a job counts in. Held work always counts as on hold. With "ignore holdups" on that is all; with it off a held job is
 * also counted by its deadline. Work with no deadline, or due beyond the window, counts nowhere (overdue work always counts).
 */
export function bandsOf(job: Row, stage: Row | undefined, today: string, windowDays: number, ignoreHolds: boolean): Band[] {
  const out: Band[] = [];
  const held = isOnHold(job as { Status?: string });
  if (held) out.push("hold");
  if (held && ignoreHolds) return out;
  const deadline = String(job.Deadline || "");
  if (!deadline) return out;
  const days = daysBetween(today, deadline);
  if (days < 0) { out.push("overdue"); return out; }
  if (days > windowDays) return out;
  const t = thresholds(stage);
  out.push(days <= t.verySoon ? "verySoon" : days <= t.soon ? "soon" : "ok");
  return out;
}

/* ---------- whose work it is ---------- */

const same = (a: string, b: string) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** Who owns a job: the name set on it, else the client's manager, else the client's partner. */
export function ownerOf(job: Row, client?: Row): string {
  return String(job.Owner || client?.Manager || client?.Partner || "").trim();
}

/** Who does a stage of this client's work: set for the client, else the type of work's default. */
export function assigneeOf(clientStages: Row[], templates: Row[], clientKey: string, serviceKey: string, stageNo: number): string {
  const own = clientStages.find((s) => s.ClientKey === clientKey && s.ServiceKey === serviceKey && Number(s.StageNo) === stageNo);
  if (own && String(own.Who || "").trim()) return String(own.Who).trim();
  return String(stageAt(templates, stageNo)?.DefaultWho || "").trim();
}

/** A job is someone's work when they are assigned to its current stage or to one still to come. */
export function isAssignedTo(user: string, job: Row, templates: Row[], clientStages: Row[]): boolean {
  if (!user) return false;
  const current = Number(job.StageNo || 1);
  const numbers = templates.map((t) => Number(t.StageNo)).filter((n) => n >= current);
  if (!numbers.length) numbers.push(current);
  return numbers.some((n) => same(assigneeOf(clientStages, templates, String(job.ClientKey || ""), String(job.ServiceKey || ""), n), user));
}

/* ---------- who may see what ---------- */

/** "everyone": the whole practice. "jobs": the jobs this manager owns, plus anything assigned to them. "mine": assigned work. */
export type Scope = "everyone" | "jobs" | "mine";
export const SCOPE_LABEL: Record<Scope, string> = { everyone: "Everyone", jobs: "My jobs", mine: "My work" };
export type Access = { scopes: Scope[]; initial: Scope };

/**
 * What a person may look at. A partner sees everything; a manager sees the jobs they own; everyone else sees the work assigned to
 * them. With no staff set up (a one-person practice) everything is theirs.
 */
export function accessFor(cfg: Config, user: string): Access {
  if (!hasStaff(cfg)) return { scopes: ["everyone"], initial: "everyone" };
  const role = staffRole(cfg, user);
  if (role === "partner" || role === "owner") return { scopes: ["everyone", "mine"], initial: "everyone" };
  if (role === "manager") return { scopes: ["jobs", "mine"], initial: "jobs" };
  return { scopes: ["mine"], initial: "mine" };
}

export function inScope(scope: Scope, user: string, job: Row, client: Row | undefined, templates: Row[], clientStages: Row[]): boolean {
  if (scope === "everyone") return true;
  const assigned = isAssignedTo(user, job, templates, clientStages);
  if (scope === "mine") return assigned;
  return assigned || same(ownerOf(job, client), user);
}

/* ---------- counting ---------- */

/** Count jobs into bands. `stagesFor` gives the stage templates of a job's type of work. */
export function tally(jobs: Row[], stagesFor: (serviceKey: string) => Row[], today: string, windowDays: number, ignoreHolds: boolean): Counts {
  const c = emptyCounts();
  for (const j of jobs) {
    const stage = stageAt(stagesFor(String(j.ServiceKey || "")), Number(j.StageNo || 1));
    for (const b of bandsOf(j, stage, today, windowDays, ignoreHolds)) c[b] += 1;
  }
  return c;
}

/** The next given day of the year on or after today: the next 31 January is this year's until it has passed, then next year's. */
export function nextOn(today: string, month: number, day: number): string {
  const y = Number(today.slice(0, 4));
  const md = `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return `${y}-${md}` >= today.slice(0, 10) ? `${y}-${md}` : `${y + 1}-${md}`;
}
