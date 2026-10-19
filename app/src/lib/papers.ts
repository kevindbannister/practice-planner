// Working papers, laid out like the Excel working paper: the sections down the side (job
// information, accounts, queries, then the lead schedules), each lead schedule made of detail
// schedules whose lines add up to a total with last year beside it, and a Prepared / Reviewed
// sign-off on every section. Each company and year end has its own paper.
import { Row } from "./schema";

export type PaperStatus = "todo" | "doing" | "done" | "na";
export const STATUS_LABEL: Record<PaperStatus, string> = { todo: "Not started", doing: "In progress", done: "Done", na: "Not needed" };

export type Sub = { key: string; title: string; after?: boolean }; // after: due after more than a year
/** check: status and notes. queries: a list of notes with the answer back and a tick. lead: schedules of lines with totals. */
export type Section = { key: string; title: string; group: string; kind: "check" | "queries" | "lead"; subs?: Sub[] };

const s = (key: string, title: string, group: string, kind: Section["kind"], subs?: Sub[]): Section => ({ key, title, group, kind, subs });
const one = (title: string): Sub[] => [{ key: "main", title }];

export const SECTIONS: Section[] = [
  s("info", "Information", "Job", "check"),
  s("budget", "Budget", "Job", "check"),
  s("disclosure", "Disclosure checklist", "Job", "check"),
  s("draft-accounts", "Draft accounts", "Accounts", "check"),
  s("review-accounts", "Post review accounts", "Accounts", "check"),
  s("final-accounts", "Final accounts", "Accounts", "check"),
  s("draft-tax", "Draft tax computation", "Accounts", "check"),
  s("review-tax", "Post review tax computation", "Accounts", "check"),
  s("final-tax", "Final tax computation", "Accounts", "check"),
  s("queries", "Queries for principal", "Notes", "queries"),
  s("review-notes", "Review notes", "Notes", "queries"),
  s("client-notes", "Client notes", "Notes", "check"),
  s("goodwill", "Goodwill and intangibles", "Lead schedules", "lead", one("Goodwill and intangibles")),
  s("fixed", "Fixed assets", "Lead schedules", "lead", [
    { key: "freehold", title: "Freehold property" }, { key: "motor", title: "Motor vehicles" }, { key: "fixtures", title: "Fixtures and fittings" },
    { key: "plant", title: "Plant and machinery" }, { key: "computer", title: "Computer equipment" },
  ]),
  s("investments", "Investments", "Lead schedules", "lead", one("Investments")),
  s("stock", "Stock and work in progress", "Lead schedules", "lead", [{ key: "stock", title: "Stock" }, { key: "wip", title: "Work in progress" }]),
  s("debtors", "Debtors and prepayments", "Lead schedules", "lead", [
    { key: "trade", title: "Trade debtors" }, { key: "prepayments", title: "Prepayments" }, { key: "accrued", title: "Accrued income" }, { key: "other", title: "Other debtors" },
  ]),
  s("bank", "Bank balances and cash", "Lead schedules", "lead", [
    { key: "current", title: "Current account" }, { key: "deposit", title: "Deposit account" }, { key: "eur", title: "EUR account" },
    { key: "usd", title: "USD account" }, { key: "cash", title: "Cash in hand" },
  ]),
  s("creditors", "Creditors and accruals", "Lead schedules", "lead", [
    { key: "trade", title: "Trade creditors" }, { key: "accruals", title: "Accruals" }, { key: "dla", title: "Directors' current account" },
    { key: "ssot", title: "Social security and other taxes" }, { key: "tax", title: "Taxation" }, { key: "other", title: "Other creditors" },
    { key: "hp", title: "Hire purchase", after: true }, { key: "loan", title: "Bank loan", after: true },
  ]),
  s("loans", "Long term loans", "Lead schedules", "lead", one("Long term loans")),
  s("capital", "Capital and reserves", "Lead schedules", "lead", [{ key: "capital", title: "Share capital" }, { key: "reserves", title: "Reserves" }]),
  s("statutory", "Statutory lead schedule", "Lead schedules", "check"),
  s("income", "Income", "Lead schedules", "lead", [{ key: "sales", title: "Sales" }, { key: "interest", title: "Interest received" }, { key: "other", title: "Other income" }]),
  s("expenditure", "Expenditure", "Lead schedules", "lead", one("Expenditure")),
];

export const GROUPS = [...new Set(SECTIONS.map((x) => x.group))];

// ------------------------------------------------------------------ periods

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

/** The year end a year before this one ("2026-03-31" → "2025-03-31"). */
export function priorPeriod(period: string): string {
  const y = Number(period.slice(0, 4)), mo = Number(period.slice(5, 7)), da = Number(period.slice(8, 10));
  const monthEnd = da >= lastDay(y, mo);
  return `${y - 1}-${pad(mo)}-${pad(monthEnd ? lastDay(y - 1, mo) : Math.min(da, lastDay(y - 1, mo)))}`;
}

// ------------------------------------------------------------------ status and sign-off

export type SectionState = { status: PaperStatus; note: string; preparedBy: string; preparedOn: string; reviewedBy: string; reviewedOn: string; row?: Row };

export function stateOf(rows: Row[], clientKey: string, period: string, sectionKey: string): SectionState {
  const row = rows.find((r) => r.ClientKey === clientKey && r.PeriodEnd === period && r.ItemKey === sectionKey);
  const st = String(row?.Status || "todo");
  return {
    status: (st in STATUS_LABEL ? st : "todo") as PaperStatus, note: String(row?.Note || ""),
    preparedBy: String(row?.PreparedBy || ""), preparedOn: String(row?.PreparedOn || ""),
    reviewedBy: String(row?.ReviewedBy || ""), reviewedOn: String(row?.ReviewedOn || ""), row,
  };
}

/** How far on a paper is: sections finished (or not needed) out of all of them. */
export function progress(clientKey: string, period: string, rows: Row[]): { done: number; started: number; total: number } {
  let done = 0, started = 0;
  for (const sec of SECTIONS) {
    const { status } = stateOf(rows, clientKey, period, sec.key);
    if (status === "done" || status === "na") done++;
    else if (status === "doing") started++;
  }
  return { done, started, total: SECTIONS.length };
}

// ------------------------------------------------------------------ lines and totals

export type Line = { Key: string; Code: string; Detail: string; Amount: number | undefined; Remark: string; Done: boolean; Seq: number; row: Row };

export function linesFor(rows: Row[], clientKey: string, period: string, sectionKey: string, subKey: string): Line[] {
  return rows
    .filter((r) => r.ClientKey === clientKey && r.PeriodEnd === period && r.SectionKey === sectionKey && (r.SubKey || "main") === subKey)
    .map((r) => ({
      Key: String(r.Key), Code: String(r.Code || ""), Detail: String(r.Detail || ""), Amount: r.Amount === undefined || r.Amount === "" || r.Amount === null ? undefined : Number(r.Amount),
      Remark: String(r.Remark || ""), Done: r.Done === true || r.Done === "true", Seq: Number(r.Seq) || 0, row: r,
    }))
    .sort((a, b) => a.Seq - b.Seq || a.Detail.localeCompare(b.Detail));
}

const round2 = (n: number) => Math.round(n * 100) / 100;
export const total = (lines: { Amount?: number }[]) => round2(lines.reduce((t, l) => t + (Number.isFinite(l.Amount) ? (l.Amount as number) : 0), 0));

/** Amounts are typed freely: "£1,234.50", "(200)" for minus, "-5". Empty is no figure. */
export function parseAmount(text: string): number | undefined {
  const t = text.replace(/[£,\s]/g, "");
  if (!t) return undefined;
  const neg = /^\(.*\)$/.test(t) || t.startsWith("-");
  const n = Number(t.replace(/[()\-]/g, ""));
  return Number.isFinite(n) ? round2(neg ? -n : n) : undefined;
}

export function money(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return "";
  const t = Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `(${t})` : t;
}

/** Last year's figure for the same detail line, if there was one. */
export function priorFor(rows: Row[], clientKey: string, period: string, sectionKey: string, subKey: string, detail: string): number | undefined {
  const prior = priorPeriod(period);
  const want = detail.trim().toLowerCase();
  if (!want) return undefined;
  const hit = linesFor(rows, clientKey, prior, sectionKey, subKey).find((l) => l.Detail.trim().toLowerCase() === want);
  return hit?.Amount;
}

/** Last year's lines that this year doesn't have yet, so you can carry the list forward. */
export function carryForward(rows: Row[], clientKey: string, period: string, sectionKey: string, subKey: string): Line[] {
  const have = new Set(linesFor(rows, clientKey, period, sectionKey, subKey).map((l) => l.Detail.trim().toLowerCase()));
  return linesFor(rows, clientKey, priorPeriod(period), sectionKey, subKey).filter((l) => l.Detail.trim() && !have.has(l.Detail.trim().toLowerCase()));
}

/** The totals of a lead schedule's detail schedules, this year and last. */
export function leadTotals(sec: Section, rows: Row[], clientKey: string, period: string): { sub: Sub; now: number; before: number }[] {
  return (sec.subs || []).map((sub) => ({
    sub,
    now: total(linesFor(rows, clientKey, period, sec.key, sub.key)),
    before: total(linesFor(rows, clientKey, priorPeriod(period), sec.key, sub.key)),
  }));
}

/** Pasted rows from Excel: "detail <tab> amount" or "code <tab> detail <tab> amount", one per line. */
export function parsePasted(text: string): { Code: string; Detail: string; Amount: number | undefined }[] {
  const out: { Code: string; Detail: string; Amount: number | undefined }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const cells = raw.includes("\t") ? raw.split("\t") : raw.split(/\s{2,}|,(?=[^,]*$)/);
    const clean = cells.map((c) => c.trim());
    const last = clean[clean.length - 1];
    const amount = clean.length > 1 ? parseAmount(last) : undefined;
    const rest = amount !== undefined || last === "" ? clean.slice(0, -1) : clean;
    const [a, b] = rest.length >= 2 ? [rest[0], rest.slice(1).join(" ")] : ["", rest[0] || ""];
    if (!b) continue;
    out.push({ Code: a, Detail: b, Amount: amount });
  }
  return out;
}
