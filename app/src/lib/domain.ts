// Shapes of the planner's records and the rules that read them: days to deadline,
// tight/overdue flags, gaps in a client's record, and display helpers.
import { DEFAULT_TIGHT_DAYS } from "../config";
import { Row } from "./schema";

export type Client = Row & {
  Key: string; Title: string; Kind?: string; CompanyNumber?: string; YearEnd?: string; Email?: string;
  Mobile?: string; LogoUrl?: string; XamaStatus?: string; LoEStatus?: string; AnnualFees?: number;
};
export type Job = Row & {
  Key: string; Title: string; ClientKey: string; ServiceKey?: string; PeriodEnd?: string; StageNo?: number;
  StageName?: string; PlannedDate?: string; Deadline?: string; Priority?: string; EstimateHours?: number;
  CHDeadline?: string; SuggestedSlot?: string; DeadlineSource?: string; RecordsReceived?: string;
  Status?: string; ClientName?: string; ActualHours?: number; CompletedDate?: string; Notes?: string;
};
export type Task = Row & {
  Key: string; Title: string; ClientKey?: string; GroupKey?: string; Type?: string; PlannedDate?: string;
  EstimateHours?: number; DueDate?: string; Status?: string; CompletedDate?: string; Notes?: string;
};

export const isOpen = (j: { Status?: string }) => j.Status !== "Complete" && j.Status !== "Done" && j.Status !== "Cancelled";

// ------------------------------------------------------------------ on hold
// A job or task on hold is still open and tracked, but it's off the planning board and out of
// the late/unplanned alerts until you take it off hold. Statutory deadlines don't pause, so
// it comes back to your attention when its deadline gets close or its "look again" date arrives.

export const ON_HOLD = "On hold";
export const HOLD_WARN_DAYS = 14;
type Holdable = { Status?: string; HoldReason?: unknown; HoldUntil?: unknown; HeldOn?: unknown; Notes?: unknown };

export const isOnHold = (j: { Status?: string }) => j.Status === ON_HOLD;

/** Why something on hold needs a look now, or null. `deadline` is the job's deadline or task's due date. */
export function holdAlert(item: Holdable, deadline: string | undefined, today: string): { level: "red" | "amber"; text: string } | null {
  if (!isOnHold(item)) return null;
  if (deadline && deadline < today) return { level: "red", text: `On hold and past its deadline (${fmtDate(deadline)})` };
  if (deadline && daysBetween(today, deadline) <= HOLD_WARN_DAYS) {
    const n = daysBetween(today, deadline);
    return { level: "amber", text: `On hold, but due ${n === 0 ? "today" : `in ${n} day${n === 1 ? "" : "s"}`}` };
  }
  const until = item.HoldUntil as string | undefined;
  if (until && until <= today) return { level: "amber", text: `On hold: time to look again (from ${fmtDate(until)})` };
  return null;
}

/** Fields to save when putting something on hold. It comes off the board. */
export function holdPatch(reason: string, until: string, today: string): Row {
  return { Status: ON_HOLD, HoldReason: reason.trim(), HoldUntil: until, HeldOn: today, PlannedDate: "" };
}

/** Fields to save when taking something off hold; the hold is noted in its Notes for the record. */
export function resumePatch(item: Holdable, today: string): Row {
  const from = item.HeldOn ? fmtDate(item.HeldOn as string) : "";
  const line = `On hold${from ? ` ${from} to ${fmtDate(today)}` : ` until ${fmtDate(today)}`}${item.HoldReason ? `: ${item.HoldReason}` : ""}`;
  const notes = item.Notes ? `${String(item.Notes).trimEnd()}\n${line}` : line;
  return { Status: "Open", HoldReason: "", HoldUntil: "", HeldOn: "", Notes: notes };
}

export function todayIso(now = new Date()): string {
  const y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, "0"), d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Whole days from `from` to `to` (both ISO dates). */
export function daysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "31 Oct 2026"; set `year: false` for "31 Oct", `weekday: true` for "Tue 13 Oct". */
export function fmtDate(iso?: string, opts: { year?: boolean; weekday?: boolean } = {}): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const wd = opts.weekday ? DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] + " " : "";
  return `${wd}${d} ${MONTHS[m - 1]}${opts.year === false ? "" : " " + y}`;
}

export function fmtMoney(v?: number): string {
  if (v === undefined || v === null || Number.isNaN(v)) return "";
  return "£" + v.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtHours(h?: number): string {
  if (!h) return "";
  const whole = Math.floor(h), mins = Math.round((h - whole) * 60);
  return mins ? `${whole}h ${mins}m` : `${whole}h`;
}

export type JobState = "overdue" | "tight" | "ok" | "none";

let tightDaysSetting = DEFAULT_TIGHT_DAYS;
/** Set from the Settings list once loaded. */
export function setTightDays(days: number): void {
  tightDaysSetting = days;
}

/** How a job stands against its deadline. Tight = due within the threshold. */
export function jobState(job: Job, today: string, tightDays = tightDaysSetting): { state: JobState; days?: number } {
  if (!job.Deadline) return { state: "none" };
  const days = daysBetween(today, job.Deadline);
  if (days < 0) return { state: "overdue", days };
  const ref = job.PlannedDate ? daysBetween(job.PlannedDate, job.Deadline) : days;
  if (ref <= tightDays) return { state: "tight", days };
  return { state: "ok", days };
}

export function deadlineLabel(days?: number): string {
  if (days === undefined) return "";
  if (days < 0) return `${-days} day${days === -1 ? "" : "s"} late`;
  if (days === 0) return "due today";
  return `${days} day${days === 1 ? "" : "s"}`;
}

export function initials(name: string): string {
  const words = name
    .replace(/[^A-Za-z .&]/g, "")
    .split(/[ .&]+/)
    .filter((w) => w && !["Ltd", "Limited", "LLP", "and", "The"].includes(w));
  return ((words[0]?.[0] || "") + (words[1]?.[0] || "")).toUpperCase();
}

const BADGES = [
  ["#E7EEF9", "#163A73"], ["#E4F1E6", "#2E6A3E"], ["#EFE9F6", "#4B2E7A"], ["#E0EFEF", "#1E5B5B"], ["#ECEAE4", "#3E454D"],
];
export function badgeColours(key: string): [string, string] {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return BADGES[h % BADGES.length] as [string, string];
}

export const KIND_LABEL: Record<string, string> = {
  Ltd: "Limited company", LLP: "LLP", Individual: "Individual", Partnership: "Partnership", Trust: "Trust",
};

/** What's missing from a client's record, given the work they have. */
export function recordGaps(c: Client, services: Set<string>): string[] {
  const gaps: string[] = [];
  const company = c.Kind === "Ltd" || c.Kind === "LLP";
  if (company && !c.CompanyNumber) gaps.push("Company number");
  if (c.Kind === "Ltd" && !c.CHAuthCode) gaps.push("Companies House auth code");
  if (c.Kind === "Ltd" && !c.CTUTR) gaps.push("Corporation tax UTR");
  if (services.has("SA100") && !c.UTR) gaps.push("Self Assessment UTR");
  if (services.has("SA100") && !c.NINumber) gaps.push("NI number");
  if (services.has("VAT") && !c.VATNumber) gaps.push("VAT number");
  if (services.has("PAYROLL") && !c.PAYERef) gaps.push("PAYE reference");
  if (!c.Email && !c.Mobile) gaps.push("Email or mobile");
  return gaps;
}

export function amlLabel(status?: string): { text: string; warn: boolean } {
  switch ((status || "").toLowerCase()) {
    case "in progress":
      return { text: "In progress", warn: true };
    case "no assessment":
      return { text: "No assessment", warn: true };
    case "":
    case "not linked":
      return { text: "Not linked to Xama", warn: true };
    default:
      return { text: status as string, warn: false };
  }
}

export function loeLabel(status?: string): { text: string; warn: boolean } {
  if (status === "Finalised") return { text: "Signed", warn: false };
  if (status === "Active") return { text: "Sent, not signed", warn: true };
  return { text: "None on file", warn: true };
}

export function contactName(c: Client): string {
  return [c.ContactPreferred || c.ContactFirst, c.ContactLast].filter(Boolean).join(" ");
}
