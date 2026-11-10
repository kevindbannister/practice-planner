// The reporting centre's figures: each client's profit and loss and balance sheet by month, read from Xero once and kept on OneDrive
// (so opening a report doesn't wait on Xero, and the working papers can use the same figures). Everything on the screens is worked out
// from these months: a quarter or a year is the months added together, and a balance is the month end.
import { XAccount, XeroApi, XeroError, parseAccounts, parseProfitAndLoss, r2 } from "./xero";

export type RRow = { code: string; name: string; group: string; amounts: number[]; /** the budget for each month (profit and loss rows only), where Xero has one */ budget?: number[] };
/** Months are "YYYY-MM". `pl` amounts line up with `months`, `bs` amounts with `bsMonths` (the balance at each month end). */
export type ReportData = { v: 3; at: string; tenantId: string; tenantName: string; months: string[]; pl: RRow[]; bsMonths: string[]; bs: RRow[]; notes: string[]; /** the name of the Xero budget the figures came from */ budgetName?: string };

export const REPORT_FOLDER = "Practice Planner Xero";
export const reportItem = (clientKey: string) => `/me/drive/root:/${encodeURIComponent(REPORT_FOLDER)}/${encodeURIComponent(clientKey)}/${encodeURIComponent("reporting.json")}`;

// ------------------------------------------------------------------ months

const pad = (n: number) => String(n).padStart(2, "0");
export const addMonths = (ym: string, n: number): string => {
  const t = Number(ym.slice(0, 4)) * 12 + (Number(ym.slice(5, 7)) - 1) + n;
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
};
export const monthRange = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let m = from; m <= to && out.length < 600; m = addMonths(m, 1)) out.push(m);
  return out;
};
export const firstDay = (ym: string) => `${ym}-01`;
export const lastDayOf = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).toISOString().slice(0, 10);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthLabel = (ym: string) => `${MON[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`;
export const monthLong = (ym: string) => `${MON[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

/** The last month that is over (Xero's books for the current month are still changing). */
export const lastCompleteMonth = (today: string) => addMonths(today.slice(0, 7), -1);

// ------------------------------------------------------------------ reading from Xero

/** Xero's balance sheet: each account with its balance in each column (the date asked for, then the months before it). */
export function parseBalanceSheet(report: any, accounts: XAccount[]): { rows: RRow[]; columns: number } {
  const r = report?.Reports?.[0] || report;
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const rows: RRow[] = [];
  let columns = 0;
  const groupOf = (title: string, parent: string): string => {
    const t = `${title}`.toLowerCase();
    if (/bank/.test(t)) return "bank";
    if (/non.?current liab|long.?term liab|liabilities.*more than/.test(t)) return "ltLiab";
    if (/current liab/.test(t)) return "curLiab";
    if (/fixed asset|non.?current asset/.test(t)) return "fixed";
    if (/current asset/.test(t)) return "curAsset";
    if (/equity|capital|reserves/.test(t)) return "equity";
    if (/liabilit/.test(t)) return /liabilit/.test(parent) ? "curLiab" : "curLiab";
    if (/asset/.test(t)) return "curAsset";
    return parent || "curAsset";
  };
  const walk = (list: any[], parent: string) => {
    for (const row of list || []) {
      if (row.RowType === "Header") columns = Math.max(columns, (row.Cells || []).length - 1);
      else if (row.RowType === "Section") walk(row.Rows, row.Title ? groupOf(row.Title, parent) : parent);
      else if (row.RowType === "Row") {
        const cells = (row.Cells || []).map((c: any) => String(c.Value ?? ""));
        const label = (cells[0] || "").trim();
        if (!label) continue;
        const id = String((row.Cells?.[0]?.Attributes || []).find((x: any) => /account/i.test(String(x.Id)))?.Value || "");
        const acct = byId.get(id);
        const m = label.match(/^(.*)\s+\(([^()]+)\)\s*$/);
        const nums = cells.slice(1).map((v: string) => Number(String(v).replace(/[,£\s]/g, "").replace(/^\((.*)\)$/, "-$1")) || 0);
        rows.push({ code: acct?.code ?? (m ? m[2].trim() : ""), name: acct?.name || (m ? m[1].trim() : label), group: parent || "curAsset", amounts: nums });
      }
    }
  };
  walk(r?.Rows || [], "");
  return { rows, columns };
}

/** Xero lists the months newest first (the date asked for, then the months before it); this checks that from the column headings. */
export function columnsNewestFirst(labels: string[]): boolean {
  const t = labels.map((l) => Date.parse(`${l} UTC`)).filter((n) => !Number.isNaN(n));
  if (t.length < 2) return true;
  return t[0] > t[t.length - 1];
}

const fit = (a: number[], n: number): number[] => (a.length === n ? a : a.length > n ? a.slice(a.length - n) : [...Array(n - a.length).fill(0), ...a]);

const keyOf = (r: { code: string; name: string }) => `${r.code}|${r.name}`;

/** Xero's budget (one budget read with its lines): the amount for each account and month, lined up with `months`. Accounts are matched by id or code. */
export function parseBudget(json: any, accounts: XAccount[], months: string[]): { name: string; rows: { code: string; name: string; group: RRow["group"]; amounts: number[] }[] } | undefined {
  const b = json?.Budgets?.[0];
  if (!b || !Array.isArray(b.BudgetLines)) return undefined;
  const byId = new Map(accounts.map((a) => [a.id, a])), byCode = new Map(accounts.map((a) => [String(a.code).toLowerCase(), a]));
  const rows: { code: string; name: string; group: RRow["group"]; amounts: number[] }[] = [];
  for (const l of b.BudgetLines) {
    const a = byId.get(String(l.AccountID || "")) || byCode.get(String(l.AccountCode || "").toLowerCase());
    if (!a || !(a.cls === "REVENUE" || a.cls === "EXPENSE")) continue; // the budget can also hold balance sheet accounts: only profit and loss is used
    const amounts = Array(months.length).fill(0);
    for (const x of l.BudgetBalances || []) {
      const i = months.indexOf(String(x.Period || "").slice(0, 7));
      if (i >= 0) amounts[i] = r2(Number(x.Amount) || 0);
    }
    if (amounts.some((v) => v)) rows.push({ code: a.code, name: a.name, group: a.type === "OTHERINCOME" ? "other" : a.type === "DIRECTCOSTS" ? "cos" : a.cls === "REVENUE" ? "income" : "expense", amounts });
  }
  return { name: String(b.Description || "Budget"), rows };
}

/** Read the last `back` months (ending at `endMonth`) for one Xero organisation. */
export async function readReportData(api: XeroApi, t: { tenantId: string; tenantName: string }, endMonth: string, back = 36, say: (m: string) => void = () => undefined): Promise<ReportData> {
  const id = t.tenantId;
  const notes: string[] = [];
  say("Reading the chart of accounts…");
  const accounts = parseAccounts(await api.get(id, "accounting", "Accounts"));
  const months = monthRange(addMonths(endMonth, -(back - 1)), endMonth);

  // profit and loss, a year at a time: the dates asked for are ONE month (Xero makes every column that long), and it adds the 11 months before it, newest first
  const plMap = new Map<string, RRow>();
  const SUBTOTAL = /^(gross profit|net profit|operating profit|net income|total\b.*)$/i;
  for (let i = 0; i < months.length; i += 12) {
    const chunk = months.slice(i, i + 12);
    say(`Reading the profit and loss, ${monthLong(chunk[0])} to ${monthLong(chunk[chunk.length - 1])}…`);
    const json = await api.get(id, "accounting", "Reports/ProfitAndLoss", { fromDate: firstDay(chunk[chunk.length - 1]), toDate: lastDayOf(chunk[chunk.length - 1]), periods: chunk.length - 1, timeframe: "MONTH", standardLayout: true });
    const pl = parseProfitAndLoss(json, accounts);
    const newestFirst = columnsNewestFirst(pl.months);
    for (const row of pl.rows) {
      if (!row.code && SUBTOTAL.test(row.name.trim())) continue; // Xero's own subtotals are worked out here instead
      const k = keyOf(row);
      const have = plMap.get(k) || { code: row.code, name: row.name, group: row.section, amounts: Array(months.length).fill(0) };
      const cols = newestFirst ? [...row.amounts].reverse() : row.amounts; // now oldest first
      fit(cols, chunk.length).forEach((v, j) => (have.amounts[i + j] = r2(v)));
      plMap.set(k, have);
    }
  }

  // the budget, if the connection was given the permission and the organisation has one: each month's amount goes on its account's row
  let budgetName: string | undefined;
  try {
    const list: any = await api.get(id, "accounting", "Budgets");
    const all: any[] = (list?.Budgets || []).filter((b: any) => b?.BudgetID);
    const pick = [...all].sort((a, b) => (a.Type === "OVERALL" ? 0 : 1) - (b.Type === "OVERALL" ? 0 : 1) || String(b.UpdatedDateUTC || "").localeCompare(String(a.UpdatedDateUTC || "")))[0];
    if (pick) {
      say("Reading the budget…");
      const full: any = await api.get(id, "accounting", `Budgets/${pick.BudgetID}`, { DateFrom: firstDay(months[0]), DateTo: lastDayOf(months[months.length - 1]) });
      const bud = parseBudget(full, accounts, months);
      if (bud && bud.rows.length) {
        budgetName = bud.name;
        for (const r of bud.rows) {
          const k = keyOf(r);
          const have: RRow = plMap.get(k) || { code: r.code, name: r.name, group: r.group, amounts: Array(months.length).fill(0) };
          have.budget = r.amounts;
          plMap.set(k, have);
        }
      } else notes.push("Xero has a budget, but it has no profit and loss figures for these months.");
    }
  } catch (e) {
    // no permission yet, or no budgets module: the reports just have no budget column
    if (!["scope", "forbidden", "not-found"].includes(String((e as { code?: string })?.code))) notes.push("The budget couldn't be read from Xero.");
  }

  // balance sheet: the month end balances, newest first from each date asked for
  const bsMap = new Map<string, RRow>();
  let bsOk = true;
  let bsFrom = months.length; // the earliest month the balance sheet was read for
  for (let i = months.length; i > 0 && bsOk; i -= 12) {
    const upto = i - 1, from = Math.max(0, i - 12);
    say(`Reading the balance sheet, ${monthLong(months[from])} to ${monthLong(months[upto])}…`);
    try {
      const json = await api.get(id, "accounting", "Reports/BalanceSheet", { date: lastDayOf(months[upto]), periods: Math.min(11, upto - from), timeframe: "MONTH", standardLayout: true });
      const bs = parseBalanceSheet(json, accounts);
      const n = upto - from + 1;
      bsFrom = Math.min(bsFrom, from);
      for (const row of bs.rows) {
        const k = keyOf(row);
        const have = bsMap.get(k) || { code: row.code, name: row.name, group: row.group, amounts: Array(months.length).fill(0) };
        const newestFirst = row.amounts.slice(0, n);
        newestFirst.forEach((v, j) => { if (upto - j >= 0) have.amounts[upto - j] = r2(v); });
        bsMap.set(k, have);
      }
    } catch (e) {
      bsOk = false;
      notes.push(e instanceof XeroError ? `The balance sheet couldn't be read (${e.message})` : "The balance sheet couldn't be read from Xero.");
    }
  }
  // an older year that couldn't be read doesn't throw away the newer ones: the balance sheet is kept for the months that were read
  const bsMonths = bsFrom < months.length ? months.slice(bsFrom) : [];
  const bsRows = bsMonths.length ? [...bsMap.values()].map((r) => ({ ...r, amounts: r.amounts.slice(bsFrom) })) : [];
  if (!bsOk && bsMonths.length) notes.push(`The balance sheet was only read back to ${monthLong(bsMonths[0])}; the earlier months couldn't be read.`);
  const off = balanceProblem(bsMonths, bsRows);
  if (off) notes.push(off);
  return { v: 3, at: new Date().toISOString(), tenantId: id, tenantName: t.tenantName, months, pl: [...plMap.values()], bsMonths, bs: bsRows, notes, ...(budgetName ? { budgetName } : {}) };
}

/** A note when the balance sheet doesn't balance in the latest month (assets less liabilities should equal equity): usually an account that has landed in the wrong group. */
export function balanceProblem(bsMonths: string[], bs: RRow[]): string | undefined {
  if (!bs.length || !bsMonths.length) return undefined;
  const i = bsMonths.length - 1;
  const tot = (gs: string[]) => r2(bs.filter((r) => gs.includes(r.group)).reduce((a, r) => a + (r.amounts[i] || 0), 0));
  const net = r2(tot(["bank", "curAsset", "fixed"]) - tot(["curLiab", "ltLiab"])), equity = tot(["equity"]);
  const gap = r2(net - equity);
  return Math.abs(gap) > 1 ? `The balance sheet for ${monthLong(bsMonths[i])} doesn't balance: assets less liabilities are £${Math.round(net).toLocaleString("en-GB")} but equity is £${Math.round(equity).toLocaleString("en-GB")}, a difference of £${Math.abs(Math.round(gap)).toLocaleString("en-GB")}. An account may be in the wrong group, so check the balance sheet and KPIs against Xero.` : undefined;
}

// ------------------------------------------------------------------ periods and columns

export type PeriodKind = "month" | "quarter" | "year";
export type Compare = "none" | "prior" | "lastYear" | "months";
export type Col = { key: string; label: string; months: string[]; total?: boolean; /** worked from the budget instead of the actual figures */ src?: "budget" };

/** The financial year a month falls in, as its first and last month; `endMonth` is the month the year ends (1 to 12). */
export function yearOf(ym: string, endMonth: number): { first: string; last: string } {
  const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7));
  const lastYear = m <= endMonth ? y : y + 1;
  const last = `${lastYear}-${pad(endMonth)}`;
  return { first: addMonths(last, -11), last };
}
// a year that ends in December is the calendar year ("FY 2026"); any other spans two ("FY 25/26")
const fyLabel = (last: string) => (last.slice(5, 7) === "12" ? `FY ${last.slice(0, 4)}` : `FY ${String(Number(last.slice(0, 4)) - 1).slice(2)}/${last.slice(2, 4)}`);

/** The months the period covers: the month, its financial quarter (up to the month picked), or the financial year (up to the month picked). */
export function periodMonths(kind: PeriodKind, anchor: string, endMonth: number): string[] {
  if (kind === "month") return [anchor];
  const { first } = yearOf(anchor, endMonth);
  const idx = monthRange(first, anchor).length - 1;
  if (kind === "year") return monthRange(first, anchor);
  const qFirst = addMonths(first, Math.floor(idx / 3) * 3);
  return monthRange(qFirst, anchor);
}

const labelFor = (kind: PeriodKind, months: string[], endMonth: number, full: boolean): string => {
  if (kind === "month") return monthLabel(months[0]);
  const last = months[months.length - 1];
  if (kind === "quarter") return months.length === 3 ? `${monthLabel(months[0])} – ${monthLabel(last)}` : months.length === 1 ? `${monthLabel(last)} (quarter to date)` : `${monthLabel(months[0])} – ${monthLabel(last)} (to date)`;
  return `${fyLabel(yearOf(last, endMonth).last)}${full && months.length === 12 ? "" : " YTD"}`;
};

/** The columns for a report: the period, and what it is set beside. "months" is every month of the financial year with a total. */
export function periodCols(kind: PeriodKind, anchor: string, endMonth: number, compare: Compare): Col[] {
  const cur = periodMonths(kind, anchor, endMonth);
  const n = cur.length;
  const shift = (ms: string[], by: number) => ms.map((m) => addMonths(m, by));
  const isFull = (kindOf: PeriodKind, ms: string[]) => kindOf !== "year" || ms.length === 12;
  const main: Col = { key: "cur", label: labelFor(kind, cur, endMonth, isFull(kind, cur)), months: cur };
  if (compare === "months") {
    const { first, last } = yearOf(anchor, endMonth);
    const all = monthRange(first, last);
    return [...all.map((m): Col => ({ key: m, label: monthLabel(m), months: m <= anchor ? [m] : [] })), { key: "total", label: m_total(anchor, first, endMonth), months: monthRange(first, anchor), total: true }];
  }
  if (compare === "prior") {
    const prev = kind === "year" ? shift(cur, -12) : kind === "quarter" ? shift(cur, -3) : shift(cur, -n); // a part quarter is set beside the same part of the quarter before
    return [main, { key: "prior", label: labelFor(kind, prev, endMonth, true), months: prev }];
  }
  if (compare === "lastYear") {
    const prev = shift(cur, -12);
    return [main, { key: "lastYear", label: labelFor(kind, prev, endMonth, true), months: prev }];
  }
  return [main];
}
const m_total = (anchor: string, first: string, endMonth: number) => (anchor === yearOf(anchor, endMonth).last ? "Total" : "Total to date");

// ------------------------------------------------------------------ statements

export type StRow = {
  label: string; kind: "head" | "line" | "sub" | "total"; vals: (number | undefined)[]; code?: string;
  /** a percentage worked out from the column's own totals (never added up or averaged) */ pct?: boolean;
  /** 1 when more is better (income, profit, assets), -1 when less is (costs, liabilities): for favourable and unfavourable variances */ dir?: 1 | -1;
};
/** "standard" is Revenue, Cost of Sales, Expenses, Other Income; "management" is the management accounts layout, with margins and finance costs shown on their own. */
export type Layout = "standard" | "management";

const sum = (row: RRow, months: string[], all: string[], src?: "budget"): number => { const a = src === "budget" ? row.budget || [] : row.amounts; return r2(months.reduce((t, m) => t + (a[all.indexOf(m)] || 0), 0)); };
const colVal = (rows: RRow[], c: Col, all: string[]): number | undefined => (c.months.length ? r2(rows.reduce((a, r) => a + sum(r, c.months, all, c.src), 0)) : undefined);
const lastIn = (row: RRow, c: Col, all: string[]): number | undefined => {
  if (!c.months.length) return undefined;
  const at = all.indexOf(c.months[c.months.length - 1]);
  return at < 0 ? undefined : row.amounts[at] || 0;
};
const minus = (a: (number | undefined)[], b: (number | undefined)[]) => a.map((v, i) => (v === undefined || b[i] === undefined ? undefined : r2(v - (b[i] as number))));
const plus = (a: (number | undefined)[], b: (number | undefined)[]) => a.map((v, i) => (v === undefined || b[i] === undefined ? undefined : r2(v + (b[i] as number))));

export type Detail = "summary" | "detailed";

/** The profit and loss for the columns: revenue, cost of sales, gross profit, expenses, operating profit, other income and net profit. */
export function plStatement(d: Pick<ReportData, "months" | "pl">, cols: Col[], detail: Detail, layout: Layout = "standard"): StRow[] {
  if (layout === "management") return plManagement(d, cols, detail);
  const out: StRow[] = [];
  const section = (title: string, key: string): (number | undefined)[] => {
    const rows = d.pl.filter((r) => r.group === key).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }) || a.name.localeCompare(b.name));
    const totals = cols.map((c) => colVal(rows, c, d.months));
    out.push({ label: title, kind: detail === "detailed" ? "head" : "line", vals: detail === "detailed" ? [] : totals });
    if (detail === "detailed") {
      for (const r of rows) out.push({ label: r.name, code: r.code, kind: "line", vals: cols.map((c) => (c.months.length ? sum(r, c.months, d.months, c.src) : undefined)) });
      out.push({ label: `Total ${title.toLowerCase()}`, kind: "sub", vals: totals });
    }
    return totals;
  };
  const rev = section("Revenue", "income");
  const cos = section("Cost of Sales", "cos");
  const gp = minus(rev, cos);
  out.push({ label: "Gross Profit", kind: "total", vals: gp });
  const exp = section("Expenses", "expense");
  const op = minus(gp, exp);
  out.push({ label: "Operating Profit", kind: "total", vals: op });
  const oth = section("Other Income", "other");
  out.push({ label: "Net Profit", kind: "total", vals: plus(op, oth) });
  return out;
}

/** Finance costs: interest and finance charges, which the management layout takes out of overheads and shows below operating profit. */
export const FINANCE_COST = /interest|finance (charge|cost)|hire purchase charge|loan charge/i;
const ratio = (a: (number | undefined)[], b: (number | undefined)[]) => a.map((v, i) => (v === undefined || !b[i] ? undefined : r2((v / (b[i] as number)) * 100)));
const byCode = (a: RRow, b: RRow) => a.code.localeCompare(b.code, undefined, { numeric: true }) || a.name.localeCompare(b.name);

/** The management accounts profit and loss: revenue, cost of sales, gross profit and margin, overheads, operating profit, finance costs, other income,
 *  net profit and margin. Margins are worked from each column's own totals. Net profit is the same as the standard layout's. */
function plManagement(d: Pick<ReportData, "months" | "pl">, cols: Col[], detail: Detail): StRow[] {
  const out: StRow[] = [];
  const part = (title: string, rows: RRow[], dir: 1 | -1, always = true): (number | undefined)[] => {
    rows = [...rows].sort(byCode);
    const totals = cols.map((c) => colVal(rows, c, d.months));
    if (!always && !totals.some((v) => v)) return totals.map((v) => (v === undefined ? undefined : 0));
    if (detail === "detailed" && rows.length) {
      out.push({ label: title, kind: "head", vals: [], dir });
      for (const r of rows) out.push({ label: r.name, code: r.code, kind: "line", dir, vals: cols.map((c) => (c.months.length ? sum(r, c.months, d.months, c.src) : undefined)) });
      out.push({ label: `Total ${title.toLowerCase()}`, kind: "sub", vals: totals, dir });
    } else out.push({ label: title, kind: "line", vals: totals, dir });
    return totals;
  };
  const of = (g: string) => d.pl.filter((r) => r.group === g);
  const rev = part("Revenue", of("income"), 1);
  const cos = part("Cost of sales", of("cos"), -1);
  const gp = minus(rev, cos);
  out.push({ label: "Gross profit", kind: "total", vals: gp, dir: 1 });
  out.push({ label: "Gross margin %", kind: "line", vals: ratio(gp, rev), pct: true, dir: 1 });
  const over = part("Overheads", of("expense").filter((r) => !FINANCE_COST.test(r.name)), -1);
  const op = minus(gp, over);
  out.push({ label: "Operating profit", kind: "total", vals: op, dir: 1 });
  const fin = part("Finance costs", of("expense").filter((r) => FINANCE_COST.test(r.name)), -1);
  const oth = part("Other income", of("other"), 1, false);
  const net = plus(minus(op, fin), oth);
  out.push({ label: "Net profit", kind: "total", vals: net, dir: 1 });
  out.push({ label: "Net margin %", kind: "line", vals: ratio(net, rev), pct: true, dir: 1 });
  return out;
}

/** Trade debtors on the management balance sheet (other debtors, prepayments and the like are "other current assets"). */
export const TRADE_DEBTORS = /accounts receivable|trade debtors?|trade receivables?|^debtors$/i;
const STOCK = /stock|inventory|work in progress|\bwip\b/i;

/** The management accounts balance sheet: balances at the end of each column (not movements), liabilities shown as negatives so the columns add down to
 *  net assets, which equal capital and reserves. */
function bsManagement(d: Pick<ReportData, "bsMonths" | "bs">, cols: Col[], detail: Detail): StRow[] {
  const out: StRow[] = [];
  // a column whose month the balance sheet wasn't read for is blank, not nil
  const at = (rows: RRow[], sign: 1 | -1) => cols.map((c): number | undefined => (c.months.length && d.bsMonths.includes(c.months[c.months.length - 1]) ? r2(sign * rows.reduce((a, r) => a + (lastIn(r, c, d.bsMonths) || 0), 0)) : undefined));
  const part = (title: string, rows: RRow[], sign: 1 | -1, dir: 1 | -1) => {
    rows = [...rows].sort(byCode);
    const t = at(rows, sign);
    if (detail === "detailed" && rows.length > 1) {
      out.push({ label: title, kind: "head", vals: [], dir });
      for (const r of rows) out.push({ label: r.name, code: r.code, kind: "line", dir, vals: cols.map((c) => { const v = lastIn(r, c, d.bsMonths); return v === undefined ? undefined : r2(sign * v); }) });
      out.push({ label: `Total ${title.toLowerCase()}`, kind: "sub", vals: t, dir });
    } else out.push({ label: title, kind: "line", vals: t, dir });
    return t;
  };
  const g = (k: string) => d.bs.filter((r) => r.group === k);
  const cur = g("curAsset"), stockRows = cur.filter((r) => STOCK.test(r.name)), debtorRows = cur.filter((r) => !STOCK.test(r.name) && TRADE_DEBTORS.test(r.name));
  const fixed = part("Fixed assets", g("fixed"), 1, 1);
  const stock = part("Stock", stockRows, 1, 1);
  const debtors = part("Trade debtors", debtorRows, 1, 1);
  const cash = part("Cash", g("bank"), 1, 1);
  const other = part("Other current assets", cur.filter((r) => !stockRows.includes(r) && !debtorRows.includes(r)), 1, 1);
  const cl = part("Current liabilities", g("curLiab"), -1, 1);
  const nca = plus(plus(plus(plus(stock, debtors), cash), other), cl);
  out.push({ label: "Net current assets", kind: "sub", vals: nca, dir: 1 });
  const lt = part("Long-term liabilities", g("ltLiab"), -1, 1);
  out.push({ label: "Net assets", kind: "total", vals: plus(plus(fixed, nca), lt), dir: 1 });
  const eq = at(g("equity"), 1);
  if (detail === "detailed") part("Capital and reserves", g("equity"), 1, 1);
  else out.push({ label: "Capital and reserves", kind: "total", vals: eq, dir: 1 });
  return out;
}

/** The balance at the end of the previous financial year, as a column beside the period. */
export function yearEndCol(anchor: string, endMonth: number): Col {
  const m = addMonths(yearOf(anchor, endMonth).first, -1);
  return { key: "yearEnd", label: `Year end ${monthLabel(m)}`, months: [m] };
}

/** The balance sheet at the end of each column's period. */
export function bsStatement(d: Pick<ReportData, "bsMonths" | "bs">, cols: Col[], detail: Detail, layout: Layout = "standard"): StRow[] {
  if (layout === "management") return bsManagement(d, cols, detail);
  const out: StRow[] = [];
  const total = (rows: RRow[]) => cols.map((c): number | undefined => (c.months.length ? r2(rows.reduce((a, r) => a + (lastIn(r, c, d.bsMonths) || 0), 0)) : undefined));
  const block = (title: string, key: string): (number | undefined)[] => {
    const rows = d.bs.filter((r) => r.group === key).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }) || a.name.localeCompare(b.name));
    const t = total(rows);
    if (detail === "detailed") {
      out.push({ label: title, kind: "head", vals: [] });
      for (const r of rows) out.push({ label: r.name, code: r.code, kind: "line", vals: cols.map((c) => lastIn(r, c, d.bsMonths)) });
      out.push({ label: `Total ${title.toLowerCase()}`, kind: "sub", vals: t });
    } else out.push({ label: title, kind: "line", vals: t });
    return t;
  };
  const fixed = block("Fixed Assets", "fixed");
  const stock = block("Current Assets", "curAsset");
  const bank = block("Cash & Equivalents", "bank");
  const assets = plus(plus(fixed, stock), bank);
  out.push({ label: "Total Assets", kind: "total", vals: assets });
  const cur = block("Current Liabilities", "curLiab");
  const lt = block("Non-current Liabilities", "ltLiab");
  const liab = plus(cur, lt);
  out.push({ label: "Total Liabilities", kind: "total", vals: liab });
  out.push({ label: "Net Assets", kind: "total", vals: minus(assets, liab) });
  block("Equity", "equity");
  return out;
}
