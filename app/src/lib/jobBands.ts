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

export type Band = "overdue" | "verySoon" | "soon" | "ok" | "notYet" | "hold";
export const BANDS: Band[] = ["overdue", "verySoon", "soon", "ok", "notYet", "hold"];
export const BAND_LABEL: Record<Band, string> = { overdue: "Overdue", verySoon: "Due very soon", soon: "Due soon", ok: "OK", notYet: "Not ready yet", hold: "On hold" };
export type Counts = Record<Band, number>;
export const emptyCounts = (): Counts => ({ overdue: 0, verySoon: 0, soon: 0, ok: 0, notYet: 0, hold: 0 });
/** The bands on show: On hold only when held work is included. */
export const bandsShown = (includeHolds: boolean): Band[] => (includeHolds ? BANDS : BANDS.filter((b) => b !== "hold"));

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

/* ---------- when work can start ---------- */

/**
 * When a type of work can be started. "period": once its period has ended (the day after the job's period end), which suits VAT,
 * accounts and tax returns. "days": a set number of days before the deadline, which suits payroll, where the month's run can't be
 * done until just before pay day. "any": whenever. Set for each type of work in Settings, Types of work.
 */
export type StartRule = { kind: "any" | "period" | "days"; days?: number };
export const START_KEY = "work-start";
export const DEFAULT_START_DAYS = 7;
const BUILT_IN_START: Record<string, StartRule> = { PAYROLL: { kind: "days", days: DEFAULT_START_DAYS } };

export function readStartRules(raw: unknown): Record<string, StartRule> {
  const out: Record<string, StartRule> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
    if (o.kind === "any" || o.kind === "period") out[k] = { kind: o.kind };
    else if (o.kind === "days") out[k] = { kind: "days", days: num(o.days) ?? DEFAULT_START_DAYS };
  }
  return out;
}
export const startRuleFor = (rules: Record<string, StartRule>, serviceKey: string): StartRule =>
  rules[serviceKey] || BUILT_IN_START[serviceKey] || { kind: "period" };

const shift = (iso: string, n: number) => { const t = new Date(`${iso.slice(0, 10)}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

/** The first day the job's work can be done, or undefined when it can be done now (or there is nothing to go on). */
export function readyOn(job: Row, rule: StartRule): string | undefined {
  if (rule.kind === "period") { const pe = String(job.PeriodEnd || ""); return /^\d{4}-\d{2}-\d{2}/.test(pe) ? shift(pe, 1) : undefined; }
  if (rule.kind === "days") { const d = String(job.Deadline || ""); return /^\d{4}-\d{2}-\d{2}/.test(d) ? shift(d, -(rule.days ?? DEFAULT_START_DAYS)) : undefined; }
  return undefined;
}
export const notReady = (job: Row, rule: StartRule, today: string): boolean => { const d = readyOn(job, rule); return !!d && today.slice(0, 10) < d; };

/**
 * The bands a job counts in. Held work counts only as on hold, and only when held work is included. Work with no deadline, or due
 * beyond the window, counts nowhere (overdue work always counts). Work that can't be started yet counts as not ready, however far
 * off its deadline is, so it stays in view without looking like something to be doing now.
 */
export function bandsOf(job: Row, stage: Row | undefined, today: string, windowDays: number, includeHolds: boolean, rule: StartRule = { kind: "any" }): Band[] {
  if (isOnHold(job as { Status?: string })) return includeHolds ? ["hold"] : [];
  const deadline = String(job.Deadline || "");
  if (!deadline) return [];
  const days = daysBetween(today, deadline);
  if (days < 0) return ["overdue"];
  // work that can't be started yet sits in its own band whatever the window, so the next payroll run is always in view
  if (notReady(job, rule, today)) return ["notYet"];
  if (days > windowDays) return [];
  const t = thresholds(stage);
  return [days <= t.verySoon ? "verySoon" : days <= t.soon ? "soon" : "ok"];
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
export function tally(jobs: Row[], stagesFor: (serviceKey: string) => Row[], today: string, windowDays: number, includeHolds: boolean, ruleFor: (serviceKey: string) => StartRule = () => ({ kind: "any" })): Counts {
  const c = emptyCounts();
  for (const j of jobs) {
    const k = String(j.ServiceKey || "");
    const stage = stageAt(stagesFor(k), Number(j.StageNo || 1));
    for (const b of bandsOf(j, stage, today, windowDays, includeHolds, ruleFor(k))) c[b] += 1;
  }
  return c;
}

/** The next given day of the year on or after today: the next 31 January is this year's until it has passed, then next year's. */
export function nextOn(today: string, month: number, day: number): string {
  const y = Number(today.slice(0, 4));
  const md = `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return `${y}-${md}` >= today.slice(0, 10) ? `${y}-${md}` : `${y + 1}-${md}`;
}

/* ---------- from a Home count to the jobs behind it ---------- */

/** What a number on Home's Work by type counted: the type of work ("" for all of it), the band, and the settings it used. */
export type BandQuery = { type: string; band: Band; days: number; holds: boolean; scope: Scope };

/** The Deadlines address that lists the jobs behind a number on Home. */
export function bandLink(q: BandQuery): string {
  const p = new URLSearchParams({ band: q.band, days: String(q.days), scope: q.scope });
  if (q.type) p.set("type", q.type);
  if (q.holds) p.set("holds", "1");
  return `#/plan/deadlines?${p.toString()}`;
}

export function readBandQuery(p: URLSearchParams): BandQuery | undefined {
  const band = p.get("band") as Band;
  if (!BANDS.includes(band)) return undefined;
  const days = Math.max(0, Math.floor(Number(p.get("days"))));
  const scope = p.get("scope");
  return {
    type: p.get("type") || "", band, days: Number.isFinite(days) ? days : DEFAULT_WINDOW, holds: p.get("holds") === "1",
    scope: scope === "jobs" || scope === "mine" ? scope : "everyone",
  };
}

/** The jobs a Home count is made of, worked out exactly as Home counts them, so the list always matches the number. */
export function jobsForBand(q: BandQuery, o: {
  jobs: Row[]; user: string; today: string; clientOf: (clientKey: string) => Row | undefined; stagesFor: (serviceKey: string) => Row[];
  clientStages: Row[]; ruleFor: (serviceKey: string) => StartRule;
}): Row[] {
  return o.jobs.filter((j) => {
    const k = String(j.ServiceKey || "");
    if (q.type && k !== q.type) return false;
    const stages = o.stagesFor(k);
    if (!inScope(q.scope, o.user, j, o.clientOf(String(j.ClientKey || "")), stages, o.clientStages)) return false;
    return bandsOf(j, stageAt(stages, Number(j.StageNo || 1)), o.today, q.days, q.holds, o.ruleFor(k)).includes(q.band);
  });
}
