// Planning rules: working week, hours per job, capacity per day, and how a completed
// job rolls forward into the next period.
import { Job } from "./domain";
import { Row } from "./schema";

/** Hours of work per weekday (1 = Monday … 5 = Friday). */
export type Hours = Record<"1" | "2" | "3" | "4" | "5", number>;

export type PlannerSettings = { hours: Hours; tightDays: number };

/** 9:00 to 17:30 with an hour for lunch. */
export const DEFAULT_SETTINGS: PlannerSettings = {
  hours: { "1": 7.5, "2": 7.5, "3": 7.5, "4": 7.5, "5": 7.5 },
  tightDays: 21,
};

/** Starting estimates per type of work until changed in Settings. */
export const DEFAULT_HOURS: Record<string, number> = {
  SA100: 2, SA800: 2, ACCS_LTD: 6, ACCS_LLP: 6, CT600: 1.5, CS01: 0.5, VAT: 1.5, PAYROLL: 1,
  MGMT_ACCOUNTS: 2, BOOKKEEPING: 2, CIS: 0.5, MYS: 2, ONBOARDING: 1, SOFTWARE: 0.25, CGT: 2,
  SE_ACCOUNTS: 3, CHARITY_ACCOUNTS: 4, TASK: 1,
};

export function readSettings(rows: Row[]): PlannerSettings {
  const out: PlannerSettings = { hours: { ...DEFAULT_SETTINGS.hours }, tightDays: DEFAULT_SETTINGS.tightDays };
  for (const r of rows) {
    try {
      const v = JSON.parse(String(r.Value ?? ""));
      if (r.Key === "hours" && v && typeof v === "object") Object.assign(out.hours, v);
      if (r.Key === "tightDays" && typeof v === "number") out.tightDays = v;
    } catch {
      /* ignore a malformed setting */
    }
  }
  return out;
}

/** The hours a job takes from your week: its own estimate, else the job type's default. */
export function jobHours(job: { EstimateHours?: number; ServiceKey?: string }, services: Row[]): number {
  if (job.EstimateHours && job.EstimateHours > 0) return job.EstimateHours;
  const svc = services.find((s) => s.Key === job.ServiceKey);
  const d = (svc?.DefaultHours as number) || DEFAULT_HOURS[job.ServiceKey || ""] || 1;
  return d;
}

// ---------- dates ----------

export function parseIso(iso: string): Date {
  return new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
}
export function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function addDays(iso: string, n: number): string {
  const d = parseIso(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toIso(d);
}
function lastDay(y: number, m0: number): number {
  return new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
}
export function isMonthEnd(iso: string): boolean {
  const d = parseIso(iso);
  return d.getUTCDate() === lastDay(d.getUTCFullYear(), d.getUTCMonth());
}
/** Add months; a month-end date stays at month end (28 Feb → 31 Mar). */
export function addMonths(iso: string, n: number, keepMonthEnd = isMonthEnd(iso)): string {
  const d = parseIso(iso);
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + n;
  const ty = y + Math.floor(m / 12), tm = ((m % 12) + 12) % 12;
  const day = keepMonthEnd ? lastDay(ty, tm) : Math.min(d.getUTCDate(), lastDay(ty, tm));
  return toIso(new Date(Date.UTC(ty, tm, day)));
}
/** 1 = Monday … 7 = Sunday */
export function weekday(iso: string): number {
  return ((parseIso(iso).getUTCDay() + 6) % 7) + 1;
}
export function mondayOf(iso: string): string {
  return addDays(iso, 1 - weekday(iso));
}
/** Move a Saturday or Sunday back to the Friday before. */
export function workingDay(iso: string): string {
  const w = weekday(iso);
  return w > 5 ? addDays(iso, 5 - w) : iso;
}

// ---------- repeat rules ----------

/**
 * How a type of work repeats and when it's due. Stored on each row of the Services list
 * and edited in Settings; types without a saved rule use the built-in one below.
 *   repeatMonths  0 = one-off, 1 = monthly, 3 = quarterly, 12 = yearly
 *   deadline      "after": period end + months + days
 *                 "fixed": the next given day and month after the period end (e.g. 31 Jan)
 *                 "gap":   same gap between period end and deadline as last time
 *   keepMonthEnd  a period ending on the last day of a month stays at month end
 */
export type Rule = {
  repeatMonths: number;
  deadline: "after" | "fixed" | "gap";
  months: number;
  days: number;
  fixed?: string; // "MM-DD"
  keepMonthEnd: boolean;
};

const after = (repeatMonths: number, months: number, days = 0, keepMonthEnd = true): Rule =>
  ({ repeatMonths, deadline: "after", months, days, keepMonthEnd });
const gap = (repeatMonths: number): Rule => ({ repeatMonths, deadline: "gap", months: 0, days: 0, keepMonthEnd: true });

export const BUILT_IN_RULES: Record<string, Rule> = {
  ACCS_LTD: after(12, 9),
  ACCS_LLP: after(12, 9),
  CT600: after(12, 12),
  CS01: after(12, 0, 14, false),
  SA100: { repeatMonths: 12, deadline: "fixed", months: 0, days: 0, fixed: "01-31", keepMonthEnd: false },
  SA800: { repeatMonths: 12, deadline: "fixed", months: 0, days: 0, fixed: "01-31", keepMonthEnd: false },
  VAT: after(3, 1, 7),
  PAYROLL: gap(1), MGMT_ACCOUNTS: gap(1), BOOKKEEPING: gap(1), CIS: gap(1), MYS: gap(1),
  SOFTWARE: gap(12),
};
const ONE_OFF: Rule = { repeatMonths: 0, deadline: "gap", months: 0, days: 0, keepMonthEnd: true };

/** The rule for a type of work: what's saved in Settings, else the built-in one. */
export function ruleFor(serviceKey: string | undefined, services: Row[] = []): Rule {
  const row = services.find((s) => s.Key === serviceKey);
  if (row && row.RepeatMonths !== undefined && row.RepeatMonths !== null) {
    return {
      repeatMonths: Number(row.RepeatMonths) || 0,
      deadline: (["after", "fixed", "gap"].includes(row.DeadlineMode as string) ? row.DeadlineMode : "after") as Rule["deadline"],
      months: Number(row.DeadlineMonths) || 0,
      days: Number(row.DeadlineDays) || 0,
      fixed: (row.DeadlineFixed as string) || undefined,
      keepMonthEnd: row.KeepMonthEnd !== false,
    };
  }
  return BUILT_IN_RULES[serviceKey || ""] || ONE_OFF;
}

/** The rule's fields as they're saved on a Services row. */
export function ruleFields(r: Rule): Row {
  return {
    RepeatMonths: r.repeatMonths, DeadlineMode: r.deadline, DeadlineMonths: r.months, DeadlineDays: r.days,
    DeadlineFixed: r.fixed || "", KeepMonthEnd: r.keepMonthEnd,
  };
}

/** Plain-English description, e.g. "Yearly · due 9 months after period end". */
export function describeRule(r: Rule): string {
  const every = { 0: "One-off", 1: "Monthly", 3: "Quarterly", 6: "Every 6 months", 12: "Yearly" }[r.repeatMonths] ||
    `Every ${r.repeatMonths} months`;
  let due: string;
  if (r.deadline === "fixed" && r.fixed) {
    const [m, d] = r.fixed.split("-").map(Number);
    due = `due ${d} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m - 1]} after period end`;
  } else if (r.deadline === "gap") {
    due = "due the same time after period end as last time";
  } else {
    const parts = [r.months ? `${r.months} month${r.months === 1 ? "" : "s"}` : "", r.days ? `${r.days} day${r.days === 1 ? "" : "s"}` : ""].filter(Boolean);
    due = parts.length ? `due ${parts.join(" and ")} after period end` : "due on the period end";
  }
  return `${every} · ${due}`;
}

/** Deadline for a period end under a rule. `previousGap` (days) is used by "gap" rules. */
export function deadlineByRule(r: Rule, periodEnd: string, previousGap = 0): string {
  if (r.deadline === "fixed" && r.fixed) {
    const year = parseIso(periodEnd).getUTCFullYear();
    let d = `${year}-${r.fixed}`;
    if (d <= periodEnd) d = `${year + 1}-${r.fixed}`;
    return d;
  }
  if (r.deadline === "gap") return addDays(periodEnd, previousGap);
  return addDays(addMonths(periodEnd, r.months, r.keepMonthEnd && isMonthEnd(periodEnd)), r.days);
}

export type NextPeriod = { PeriodEnd: string; Deadline: string; rule: string };

/** Next period and deadline under a rule, or null if the work doesn't repeat. */
export function nextPeriod(r: Rule, periodEnd?: string, deadline?: string): NextPeriod | null {
  if (!r.repeatMonths || !periodEnd) return null;
  const pe = addMonths(periodEnd, r.repeatMonths, r.keepMonthEnd && isMonthEnd(periodEnd));
  const previousGap = deadline ? Math.round((parseIso(deadline).getTime() - parseIso(periodEnd).getTime()) / 86400000) : 0;
  return { PeriodEnd: pe, Deadline: deadlineByRule(r, pe, previousGap), rule: describeRule(r) };
}

/** The next job to create when one is completed, or null for one-off work. */
export function rollForward(job: Job, r: Rule, completedOn: string, newKey: string): Row | null {
  const next = nextPeriod(r, job.PeriodEnd, job.Deadline);
  if (!next) return null;
  // dates like "when the records came in" move on by the same amount as the period
  const shift = (iso?: string) => (iso ? addMonths(iso, r.repeatMonths, false) : undefined);
  const slot = shift(job.PlannedDate || completedOn);
  return {
    Key: newKey,
    Title: job.Title,
    ClientKey: job.ClientKey,
    ClientName: job.ClientName,
    ServiceKey: job.ServiceKey,
    PeriodEnd: next.PeriodEnd,
    Deadline: next.Deadline,
    DeadlineSource: "Calculated",
    StageNo: 1,
    RecordsExpected: shift(job.RecordsReceived as string | undefined),
    SuggestedSlot: slot && slot <= next.Deadline ? workingDay(slot) : undefined,
    EstimateHours: (job.ActualHours as number) || job.EstimateHours,
    LastCompleted: completedOn,
    Status: "Open",
    Source: "Rolled forward",
    Fee: job.Fee,
    FeePeriod: job.FeePeriod,
  };
}

export function newKey(prefix: string): string {
  return prefix + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
}

/** A sensible deadline for a new job, from its type's rule and period end. */
export function deadlineFor(r: Rule, periodEnd: string): string {
  return deadlineByRule(r, periodEnd, 0);
}
