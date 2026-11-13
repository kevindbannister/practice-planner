// Change of accounting reference date: AA01 for a company, LL AA01 for an LLP. Pure logic, no screens.
//
// This is something a person starts when a client wants a different year end. It is never assumed, and it has nothing to do with preparing
// accounts (that is Working Papers and Accounts Production). The rules here are the ones Companies House's guidance gives:
//   - the current period or the one immediately before it can be changed;
//   - an extension can't take a period past 18 months from its start (except in administration);
//   - a company can extend only once in five years, unless one of the listed exceptions applies;
//   - a shortening has no such limit today, but Companies House's guidance should be checked before relying on that;
//   - a change to the previous period has to be made before that period's accounts deadline.
// The planner can't know a company's history before it was added, so the five-year question is asked, never guessed.

export type ArdWhich = "current" | "previous";
export type ArdDirection = "shorten" | "extend";
export const WHICH_LABEL: Record<ArdWhich, string> = { current: "The current accounting period", previous: "The previous accounting period" };
/** Why a second extension inside five years can still be allowed. The form's own guidance has the exact wording. */
export const EXTENSION_REASONS: [string, string][] = [
  ["align", "To line up with a parent or subsidiary undertaking"],
  ["administration", "The company is in administration"],
  ["direction", "The Secretary of State has directed it"],
];

export type ArdInput = {
  which: ArdWhich;
  /** The period being changed, as it stands now. */
  periodStart: string; periodEnd: string;
  /** The date that period will now end. */
  newEnd: string;
  /** For an extension: has the company already extended a period in the last five years? Left out until someone answers. */
  extendedWithinFiveYears?: boolean | null;
  extensionReason?: string;
};

const str = (v: unknown): string => (v === undefined || v === null ? "" : String(v).trim());
export const isoOk = (d: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
export const addDays = (d: string, n: number): string => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
/** Months later, on the same day, or the last day of the month when the start was a month end (or the day doesn't exist). */
export function addMonths(d: string, n: number): string {
  const t = new Date(`${d}T00:00:00Z`);
  const day = t.getUTCDate(); const monthEnd = day === lastDay(t.getUTCFullYear(), t.getUTCMonth());
  t.setUTCDate(1); t.setUTCMonth(t.getUTCMonth() + n);
  const last = lastDay(t.getUTCFullYear(), t.getUTCMonth());
  t.setUTCDate(monthEnd ? last : Math.min(day, last));
  return t.toISOString().slice(0, 10);
}
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "2027-06-30" -> "30 June": the accounting reference date as Companies House and the client record show it. */
export const dayMonth = (iso: string): string => (isoOk(iso) ? `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}` : "");
export const dmy = (iso: string): string => (isoOk(iso) ? iso.split("-").reverse().join("/") : "");

/** The form for this kind of company. LLPs have their own form. */
export const ardForm = (kind: "limited" | "llp"): "AA01" | "LLAA01" => (kind === "llp" ? "LLAA01" : "AA01");
export const isArdForm = (form: string): boolean => form === "AA01" || form === "LLAA01";

export const direction = (i: Pick<ArdInput, "periodEnd" | "newEnd">): ArdDirection => (i.newEnd > i.periodEnd ? "extend" : "shorten");
/** The latest date a period starting on this day can be extended to: the day before its 18-month anniversary. */
export const latestExtension = (periodStart: string): string => addDays(addMonths(periodStart, 18), -1);

/**
 * What stops this change being filed. Each line is a plain thing to put right. Nothing here needs today's date, so the same
 * answer holds whenever it is read.
 */
export function ardIssues(i: Partial<ArdInput>): string[] {
  const out: string[] = [];
  const start = str(i.periodStart), end = str(i.periodEnd), now = str(i.newEnd);
  if (i.which !== "current" && i.which !== "previous") out.push("Which period is being changed (the current one or the previous one)");
  if (!isoOk(start)) out.push("The date the period being changed started");
  if (!isoOk(end)) out.push("The date the period being changed currently ends");
  if (!isoOk(now)) out.push("The date the period will now end");
  if (out.length) return out;
  if (start > end) out.push("The period can't start after it ends");
  if (now === end) out.push("The new date is the same as the current one");
  if (now <= start) out.push("The new period end has to be after the period's start");
  if (out.length) return out;
  if (direction({ periodEnd: end, newEnd: now }) === "extend") {
    const reason = str(i.extensionReason);
    if (now > latestExtension(start) && reason !== "administration") out.push(`A period can't be extended beyond 18 months from its start (the latest date is ${dmy(latestExtension(start))}), unless the company is in administration`);
    if (i.extendedWithinFiveYears !== true && i.extendedWithinFiveYears !== false) out.push("Whether the company has already extended an accounting period in the last five years");
    else if (i.extendedWithinFiveYears === true && !EXTENSION_REASONS.some(([k]) => k === reason)) out.push("Why a second extension within five years is allowed");
  }
  return out;
}

/** Things to read before filing. None of them stops the filing. `today` is the day it is being prepared. */
export function ardAdvice(i: ArdInput, today: string): string[] {
  const out: string[] = [];
  if (ardIssues(i).length) return out;
  const dir = direction(i);
  const due = ardDeadline(i, today);
  if (dir === "shorten") out.push(`Shortening the period makes the accounts due on the later of nine months after the new period end and three months after Companies House receives the form: about ${dmy(due)}. Check Companies House's current guidance for any limit on shortening.`);
  else out.push(`Extending the period makes the accounts due nine months after the new period end: about ${dmy(due)}.`);
  out.push("Companies House works out the actual deadline when it accepts the form. The first accounts of a new company follow their own rule, so check those on Companies House.");
  if (i.which === "previous" && today > addMonths(i.periodEnd, 9)) out.push(`The usual deadline for that period's accounts (nine months after ${dmy(i.periodEnd)}) has passed. Companies House won't accept a change to a previous period once its deadline has gone, so check this before preparing the form.`);
  out.push("A different year end also changes the corporation tax accounting period and the dates HMRC works to. Update the planner's jobs once the change is accepted.");
  return out;
}

/** About when the accounts will be due after this change. `filedOn` matters only for a shortening. */
export function ardDeadline(i: Pick<ArdInput, "periodEnd" | "newEnd">, filedOn: string): string {
  const nine = addMonths(i.newEnd, 9);
  if (direction(i) === "extend") return nine;
  const three = addMonths(filedOn, 3);
  return three > nine ? three : nine;
}

/** The period dates to start from, taken from what Companies House last showed and the incorporation date. Blank when not known. */
export function ardPrefill(accountsTo: string | undefined, incorporated: string | undefined): { periodStart: string; periodEnd: string } {
  const end = str(accountsTo).slice(0, 10);
  if (!isoOk(end)) return { periodStart: "", periodEnd: "" };
  const inc = str(incorporated).slice(0, 10);
  const start = addDays(addMonths(end, -12), 1);
  return { periodStart: isoOk(inc) && inc > start ? inc : start, periodEnd: end };
}

/** What is kept on the filing, so the draft can be reviewed and checked again later. */
export function ardPayload(i: ArdInput): Record<string, unknown> {
  return {
    which: i.which, periodStart: i.periodStart, periodEnd: i.periodEnd, newPeriodEnd: i.newEnd, newDate: dayMonth(i.newEnd), direction: direction(i),
    ...(direction(i) === "extend" ? { extendedWithinFiveYears: i.extendedWithinFiveYears ?? null, extensionReason: str(i.extensionReason) } : {}),
  };
}
/** Read the filing's payload back as an input. A draft made by editing the client's year end has no dates, and `structured` is false. */
export function ardFromPayload(p: Record<string, any>): { structured: boolean; input: Partial<ArdInput> } {
  const structured = !!str(p.periodEnd) || !!str(p.newPeriodEnd);
  return { structured, input: { which: p.which, periodStart: str(p.periodStart), periodEnd: str(p.periodEnd), newEnd: str(p.newPeriodEnd), extendedWithinFiveYears: p.extendedWithinFiveYears, extensionReason: str(p.extensionReason) } };
}
/** What stops a filing's payload being approved. A draft with no period dates only needs the new date, as it always did. */
export function ardPayloadIssues(p: Record<string, any>): string[] {
  const { structured, input } = ardFromPayload(p);
  if (!structured) return str(p.newDate) ? [] : ["The new accounting reference date"];
  return ardIssues(input);
}
