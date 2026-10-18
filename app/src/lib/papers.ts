// Working papers: the checklist of sections behind a company's accounts for a year. Each company
// and year end has its own copy of the list, with a status and a note against each section.
// The sections themselves are yours to change (Papers › Edit sections).
import { Row } from "./schema";

export type PaperItem = { key: string; title: string };
export type PaperStatus = "todo" | "doing" | "done" | "na";

export const STATUS_LABEL: Record<PaperStatus, string> = { todo: "Not started", doing: "In progress", done: "Done", na: "Not needed" };

export const DEFAULT_ITEMS: PaperItem[] = [
  "Trial balance and lead schedules",
  "Bank reconciliations",
  "Debtors",
  "Creditors",
  "Fixed assets and depreciation",
  "Stock and work in progress",
  "Accruals and prepayments",
  "VAT reconciliation",
  "Payroll, PAYE and NIC",
  "Directors' loan account",
  "Dividends",
  "Loans, leases and hire purchase",
  "Corporation tax computation",
  "Analytical review",
  "Post year end events and going concern",
  "Accounts disclosures checklist",
  "Queries for the client",
  "Review notes",
].map((title, i) => ({ key: `P${String(i + 1).padStart(2, "0")}`, title }));

const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** A company's year ends from "MM-DD": the most recent ones on or before `today`, newest first, and the next to come. */
export function yearEnds(yearEnd: string | undefined, today: string, back = 3): string[] {
  const m = /^(\d{2})-(\d{2})$/.exec(yearEnd || "");
  if (!m) return [];
  const mo = Number(m[1]), da = Number(m[2]);
  // a year end on the last day of its month stays the last day, leap years included
  const monthEnd = da >= lastDay(2001, mo);
  const on = (y: number) => `${y}-${pad(mo)}-${pad(monthEnd ? lastDay(y, mo) : Math.min(da, lastDay(y, mo)))}`;
  const y = Number(today.slice(0, 4));
  const all = [on(y + 1), on(y), on(y - 1), on(y - 2), on(y - 3), on(y - 4)].sort((a, b) => b.localeCompare(a));
  const past = all.filter((d) => d <= today);
  const next = all.filter((d) => d > today).slice(-1);
  return [...next, ...past.slice(0, back)];
}

/** The status of a section for one company and period. */
export function statusOf(rows: Row[], clientKey: string, period: string, itemKey: string): { status: PaperStatus; note: string; row?: Row } {
  const row = rows.find((r) => r.ClientKey === clientKey && r.PeriodEnd === period && r.ItemKey === itemKey);
  const s = String(row?.Status || "todo");
  return { status: (s in STATUS_LABEL ? s : "todo") as PaperStatus, note: String(row?.Note || ""), row };
}

/** How far on a paper is: sections finished (or not needed) out of all of them. */
export function progress(items: PaperItem[], rows: Row[], clientKey: string, period: string): { done: number; started: number; total: number } {
  let done = 0, started = 0;
  for (const it of items) {
    const { status } = statusOf(rows, clientKey, period, it.key);
    if (status === "done" || status === "na") done++;
    else if (status === "doing") started++;
  }
  return { done, started, total: items.length };
}

/** Read the saved sections (a JSON list) or fall back to the standard ones. */
export function readItems(value: unknown): PaperItem[] {
  if (!Array.isArray(value)) return DEFAULT_ITEMS;
  const out = value.filter((x): x is PaperItem => !!x && typeof x.key === "string" && typeof x.title === "string" && !!x.title.trim());
  return out.length ? out : DEFAULT_ITEMS;
}
