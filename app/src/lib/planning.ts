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

// ---------- roll-forward ----------

const MONTHLY = new Set(["PAYROLL", "MGMT_ACCOUNTS", "BOOKKEEPING", "CIS", "MYS"]);
const ONE_OFF = new Set(["ONBOARDING", "CGT", "NCSU", "DS01", "STRIKE_OFF", "TASK", "PAE"]);

export type NextPeriod = { PeriodEnd: string; Deadline: string; rule: string };

/** Next period and deadline for a job type, or null if the work doesn't recur. */
export function nextPeriod(service: string, periodEnd?: string, deadline?: string): NextPeriod | null {
  if (ONE_OFF.has(service) || !periodEnd) return null;
  switch (service) {
    case "ACCS_LTD":
    case "ACCS_LLP": {
      const pe = addMonths(periodEnd, 12);
      return { PeriodEnd: pe, Deadline: addMonths(pe, 9), rule: "Year end + 9 months" };
    }
    case "CT600": {
      const pe = addMonths(periodEnd, 12);
      return { PeriodEnd: pe, Deadline: addMonths(pe, 12), rule: "Year end + 12 months" };
    }
    case "CS01": {
      const pe = addMonths(periodEnd, 12, false);
      return { PeriodEnd: pe, Deadline: addDays(pe, 14), rule: "Made-up date + 14 days" };
    }
    case "SA100":
    case "SA800": {
      const year = parseIso(periodEnd).getUTCFullYear() + 1;
      return { PeriodEnd: `${year}-04-05`, Deadline: `${year + 1}-01-31`, rule: "31 January after the tax year" };
    }
    case "VAT": {
      const pe = addMonths(periodEnd, 3);
      return { PeriodEnd: pe, Deadline: addDays(addMonths(pe, 1), 7), rule: "Quarter end + 1 month + 7 days" };
    }
    case "SOFTWARE": {
      const pe = addMonths(periodEnd, 12);
      return { PeriodEnd: pe, Deadline: deadline ? addMonths(deadline, 12) : pe, rule: "Renews yearly" };
    }
    default: {
      if (!MONTHLY.has(service)) {
        // annual by default for anything else that recurs
        const pe = addMonths(periodEnd, 12);
        return { PeriodEnd: pe, Deadline: deadline ? addMonths(deadline, 12) : pe, rule: "Same time next year" };
      }
      const pe = addMonths(periodEnd, 1);
      const gap = deadline ? Math.round((parseIso(deadline).getTime() - parseIso(periodEnd).getTime()) / 86400000) : 0;
      return { PeriodEnd: pe, Deadline: addDays(pe, gap), rule: "Monthly" };
    }
  }
}

/** The next job to create when one is completed, or null for one-off work. */
export function rollForward(job: Job, completedOn: string, newKey: string): Row | null {
  const next = nextPeriod(job.ServiceKey || "", job.PeriodEnd, job.Deadline);
  if (!next) return null;
  const yearly = !MONTHLY.has(job.ServiceKey || "") && job.ServiceKey !== "VAT";
  const shift = (iso?: string) => {
    if (!iso) return undefined;
    return yearly ? addMonths(iso, 12, false) : addDays(iso, Math.round((parseIso(next.PeriodEnd).getTime() - parseIso(job.PeriodEnd!).getTime()) / 86400000));
  };
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

/** A sensible deadline for a new job, from its type and period end. */
export function deadlineFor(service: string, periodEnd: string): string {
  switch (service) {
    case "ACCS_LTD":
    case "ACCS_LLP":
      return addMonths(periodEnd, 9);
    case "CT600":
      return addMonths(periodEnd, 12);
    case "CS01":
      return addDays(periodEnd, 14);
    case "SA100":
    case "SA800":
      return `${parseIso(periodEnd).getUTCFullYear() + 1}-01-31`;
    case "VAT":
      return addDays(addMonths(periodEnd, 1), 7);
    default:
      return periodEnd;
  }
}
