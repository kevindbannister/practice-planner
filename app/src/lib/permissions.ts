// Who may do what with time, rates, billing and profitability. Roles are fixed bundles of permissions; the practice can change what a role holds
// (setting team.roles) and who has which role (setting team.members).
//
// A practice with no team set up is one person: they are the owner and may do everything, so nothing changes for a sole practitioner. Once people are
// listed, anyone not listed can only record their own time.
//
// HONEST LIMIT: this app talks to SharePoint straight from the browser, with each person's own sign-in. The rules below are enforced in the app's single
// data layer (`checkWrite`, called before every save and by every screen that reads), so they hold for everyone using the app, but a person with
// edit rights on the SharePoint lists themselves could bypass the app. To close that, give people only the SharePoint rights they need (see the Phase 7 notes).
import { Row } from "./schema";
import { Rate, readRates, RATE_SETTING } from "./rates";

const s = (v: unknown) => String(v ?? "").trim();

export type Action = "time.own" | "time.view_others" | "time.approve" | "time.edit_approved" | "rates.cost" | "rates.charge" | "profit.view" | "billing.manage" | "plan.others" | "team.manage";
export const ACTIONS: [Action, string][] = [
  ["time.own", "Record and change their own time"], ["time.view_others", "See other people's time"], ["time.approve", "Approve or return timesheets"], ["time.edit_approved", "Change time that has been approved"],
  ["rates.cost", "See and set cost rates"], ["rates.charge", "See and set charge-out rates"], ["profit.view", "See profitability"], ["billing.manage", "Bill, write off and write down time"],
  ["plan.others", "Plan work for other people"], ["team.manage", "Manage the team, roles and approval setting"],
];
export type Role = "owner" | "manager" | "staff" | "viewer";
export const ROLES: Role[] = ["owner", "manager", "staff", "viewer"];
export const ROLE_LABEL: Record<Role, string> = { owner: "Owner", manager: "Manager", staff: "Team member", viewer: "Read only" };
const ALL = ACTIONS.map(([a]) => a);
export const DEFAULT_ROLES: Record<Role, Action[]> = {
  owner: ALL,
  manager: ["time.own", "time.view_others", "time.approve", "rates.charge", "profit.view", "billing.manage", "plan.others"],
  staff: ["time.own"],
  viewer: [],
};
export type Member = { user: string; name: string; role: Role };
export type Team = { members: Member[]; roles: Record<Role, Action[]> };

export const TEAM_SETTING = "team.members", ROLES_SETTING = "team.roles", APPROVAL_SETTING = "timesheet.approval";
export const readMembers = (saved: unknown): Member[] => (Array.isArray(saved) ? saved : []).map((m) => ({ user: s((m as Member)?.user).toLowerCase(), name: s((m as Member)?.name), role: (ROLES as string[]).includes(s((m as Member)?.role)) ? (s((m as Member).role) as Role) : "staff" })).filter((m) => m.user);
export function readRoles(saved: unknown): Record<Role, Action[]> {
  const out = { ...DEFAULT_ROLES };
  if (saved && typeof saved === "object") for (const r of ROLES) { const v = (saved as Record<string, unknown>)[r]; if (Array.isArray(v)) out[r] = v.filter((a): a is Action => ALL.includes(a as Action)); }
  out.owner = ALL; // an owner can always do everything, so the practice can never lock itself out
  return out;
}
export const teamFrom = (settings: Row[]): Team => {
  const get = (k: string) => { const r = settings.find((x) => x.Key === k); try { return r?.Value ? JSON.parse(String(r.Value)) : undefined; } catch { return undefined; } };
  return { members: readMembers(get(TEAM_SETTING)), roles: readRoles(get(ROLES_SETTING)) };
};
export const approvalOn = (settings: Row[]): boolean => { const r = settings.find((x) => x.Key === APPROVAL_SETTING); try { return !!(r?.Value && JSON.parse(String(r.Value))?.on === true); } catch { return false; } };

/** Someone's role. No team set up: owner. A team set up: their listed role, or team member if they are not listed. */
export function roleOf(team: Team, user: string): Role {
  if (!team.members.length) return "owner";
  return team.members.find((m) => m.user === s(user).toLowerCase())?.role || "staff";
}
export const can = (team: Team, user: string, a: Action): boolean => team.roles[roleOf(team, user)].includes(a);
export const nameOf = (team: Team, user: string): string => team.members.find((m) => m.user === s(user).toLowerCase())?.name || user;

/** Which person's time someone may see: all of it, or only their own. */
export const visibleUsers = (team: Team, user: string, all: string[]): string[] => (can(team, user, "time.view_others") ? all : all.filter((u) => u.toLowerCase() === s(user).toLowerCase()));

// ------------------------------------------------------------------ the data-layer check

const BILLING_FIELDS = ["BillingStatus", "ChargePence", "WriteDownPence", "InvoiceRef", "BilledAt"];
const APPROVAL_FIELDS = ["ApprovalStatus", "ReviewedBy", "ReviewedAt", "ReviewNote"];
const ALWAYS_OK = ["Version"];
/** Thrown by the data layer when a save isn't allowed; its message is written to be shown to the person. */
export class Denied extends Error { constructor(m: string) { super(m); this.name = "Denied"; } }
export type Ctx = { user: string; team: Team; approvalOn: boolean };

/** Why a save is not allowed, or "" if it is. Called before every change to the time list and to the settings that govern it. */
export function checkWrite(op: "create" | "update" | "remove", list: string, row: Row, patch: Row | undefined, c: Ctx): string {
  const mine = (r: Row) => s(r.CreatedBy).toLowerCase() === s(c.user).toLowerCase();
  if (list === "Settings") {
    const key = s(row.Key);
    if ([TEAM_SETTING, ROLES_SETTING, APPROVAL_SETTING].includes(key) && !can(c.team, c.user, "team.manage")) return "Only an owner can change the team, roles or approval setting.";
    if (key === RATE_SETTING) {
      const before = readRates(safe(s(op === "update" ? row.Value : ""))), after = readRates(safe(s((patch || row).Value)));
      const diff = changedKinds(before, after);
      if (diff.has("cost") && !can(c.team, c.user, "rates.cost")) return "You can't change cost rates.";
      if (diff.has("charge") && !can(c.team, c.user, "rates.charge")) return "You can't change charge-out rates.";
    }
    return "";
  }
  if (list === "TimeEvents" && op !== "create") return "The time log can't be changed.";
  if (list !== "JobTime") return "";
  if (op === "create") return mine(row) || can(c.team, c.user, "time.view_others") || !s(row.CreatedBy) ? (can(c.team, c.user, "time.own") ? "" : "You can't record time.") : "You can only record your own time.";
  if (!mine(row) && !can(c.team, c.user, "time.view_others")) return "That is someone else's time.";
  if (!can(c.team, c.user, "time.own") && !can(c.team, c.user, "time.view_others")) return "You can't change time.";
  const fields = Object.keys(patch || {}).filter((k) => !ALWAYS_OK.includes(k));
  if (fields.some((k) => BILLING_FIELDS.includes(k)) && !can(c.team, c.user, "billing.manage")) return "You can't bill, write off or write down time.";
  if (patch && fields.some((k) => APPROVAL_FIELDS.includes(k))) {
    const next = s(patch.ApprovalStatus);
    const ownSubmit = (next === "submitted" || next === "") && mine(row);
    if (!ownSubmit && !can(c.team, c.user, "time.approve")) return "You can't approve or return timesheets.";
  }
  const locked = c.approvalOn && s(row.ApprovalStatus) === "approved";
  const touchesTime = op === "remove" || fields.some((k) => !BILLING_FIELDS.includes(k) && !APPROVAL_FIELDS.includes(k));
  if (locked && touchesTime && !can(c.team, c.user, "time.edit_approved")) return "That time has been approved, so it is locked. Ask for it to be reopened.";
  return "";
}
function safe(v: string): unknown { try { return v ? JSON.parse(v) : undefined; } catch { return undefined; } }
function changedKinds(a: Rate[], b: Rate[]): Set<string> {
  const out = new Set<string>();
  const sig = (r: Rate) => JSON.stringify([r.kind, r.pence, r.from, r.to, r.userKey, r.role, r.serviceKey, r.activityKey, r.clientKey, r.jobKey]);
  for (const kind of ["charge", "cost"]) {
    const x = a.filter((r) => r.kind === kind).map(sig).sort().join("|"), y = b.filter((r) => r.kind === kind).map(sig).sort().join("|");
    if (x !== y) out.add(kind);
  }
  return out;
}
