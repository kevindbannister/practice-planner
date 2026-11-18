// Corporation Tax in a company's first year. A company's first accounts start on the day it was incorporated and can run for up to
// 18 months, but a Corporation Tax return covers 12 months at most. So when the first accounts run past 12 months there are two
// Corporation Tax returns: the first 12 months from incorporation, then the rest up to the accounts' period end. (Only one accounts
// job is needed.) For example, incorporated 5 March 2025 with accounts to 31 March 2026: CT 5 March 2025 to 4 March 2026, and
// 5 March 2026 to 31 March 2026.
//
// Dates: both returns are due to be filed 12 months after the end of the period of account (the accounts), and the tax for each is
// due 9 months and 1 day after the end of that return's own period.
import type { Row } from "./schema";
import { addDays, addMonths } from "./planning";

export const CT_SERVICE = "CT600";
/** How a split job is marked (in its Source): "ct-split:1/2", "ct-split:2/2". */
const SPLIT = /^ct-split:(\d+)\/(\d+)/;
export const splitPart = (job: object): { n: number; of: number } | undefined => {
  const m = SPLIT.exec(String((job as Record<string, unknown>).Source || ""));
  return m ? { n: Number(m[1]), of: Number(m[2]) } : undefined;
};
/** A split job that isn't the last part: completing it doesn't roll forward, because the next part already exists. */
export const isEarlierPart = (job: object) => { const p = splitPart(job); return !!p && p.n < p.of; };

/** A date as yyyy-mm-dd from yyyy-mm-dd or dd/mm/yyyy; "" if it isn't one. */
export function isoDate(v: unknown): string {
  const s = String(v ?? "").trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : "";
}

/** The Corporation Tax periods inside a period of account: 12 months at a time, the last one shorter. */
export function ctPeriods(start: string, end: string): { start: string; end: string }[] {
  const out: { start: string; end: string }[] = [];
  let from = start;
  while (from <= end && out.length < 3) {
    const twelve = addDays(addMonths(from, 12, false), -1);
    const to = twelve < end ? twelve : end;
    out.push({ start: from, end: to });
    from = addDays(to, 1);
  }
  return out;
}

/** Is this period end the company's first accounts, and longer than 12 months? (First accounts run from incorporation, up to 18 months.) */
export function isLongFirstPeriod(incorporated: string, periodEnd: string): boolean {
  if (!incorporated || !periodEnd || periodEnd <= incorporated) return false;
  const twelve = addDays(addMonths(incorporated, 12, false), -1);
  const eighteen = addDays(addMonths(incorporated, 18, false), -1);
  return periodEnd > twelve && periodEnd <= eighteen;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const d = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
export const ctPaymentDate = (periodEnd: string) => addDays(addMonths(periodEnd, 9, false), 1);

/**
 * The changes that split one open Corporation Tax job covering a long first period: the job itself becomes the first 12 months, and a
 * new job is made for the rest. Undefined when there's nothing to do (not a CT job, already split, no incorporation date, or the
 * first accounts are 12 months or less).
 */
export function splitFirstYear(job: Row, client: Row | undefined, newKey: () => string): { patch: Row; create: Row[] } | undefined {
  if (String(job.ServiceKey || "") !== CT_SERVICE || splitPart(job)) return undefined;
  const inc = isoDate(client?.Incorporated);
  const pe = isoDate(job.PeriodEnd);
  if (!inc || !pe || !isLongFirstPeriod(inc, pe)) return undefined;
  const parts = ctPeriods(inc, pe);
  if (parts.length < 2) return undefined;
  const filing = addMonths(pe, 12, false); // both returns: 12 months after the end of the accounts
  const base = String(job.Title || "Corporation Tax").replace(/\s+[-–]\s+\d.*$/, "");
  const title = (p: { start: string; end: string }) => `${base} - ${d(p.start)} to ${d(p.end)}`;
  const note = (i: number) => [
    `First year: the accounts run from ${d(inc)} (incorporation) to ${d(pe)}, longer than 12 months, so there are ${parts.length} Corporation Tax returns. This is ${i + 1} of ${parts.length}: ${d(parts[i].start)} to ${d(parts[i].end)}.`,
    `Return due ${d(filing)} (12 months after the accounts' period end). Tax due ${d(ctPaymentDate(parts[i].end))} (9 months and a day after this return's period).`,
  ].join("\n");
  const mark = (i: number) => `ct-split:${i + 1}/${parts.length}`;
  const patch: Row = {
    Title: title(parts[0]), PeriodStart: parts[0].start, PeriodEnd: parts[0].end, Deadline: filing, DeadlineSource: "First year split", Source: mark(0),
    Notes: [note(0), String(job.Notes || "").trim()].filter(Boolean).join("\n\n"),
  };
  const create = parts.slice(1).map((p, k) => ({
    Key: newKey(), Title: title(p), ClientKey: job.ClientKey, ClientName: job.ClientName || "", ServiceKey: CT_SERVICE,
    PeriodStart: p.start, PeriodEnd: p.end, Deadline: filing, DeadlineSource: "First year split", StageNo: 1, StageName: job.StageNo === 1 ? job.StageName || "" : "",
    Status: "Open", Source: mark(k + 1), Owner: job.Owner || "", EstimateHours: job.EstimateHours, Notes: note(k + 1),
  } as Row));
  return { patch, create };
}
