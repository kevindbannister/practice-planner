// Opening balances: the position at the start of the year is last year's closing balance sheet.
// For a company's first set of papers it comes from last year's trial balance in the accounting
// software (read from a spreadsheet or CSV); after that it flows from the previous year's working
// papers. Last year's profit and loss accounts and dividends are rolled into reserves.
import { toAmount } from "./bankStatement";
import { DEST_BY_KEY, Mapping } from "./tbMap";

const r2 = (n: number) => Math.round(n * 100) / 100;
const norm = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

export type TbImportLine = { Code: string; Detail: string; dr: number; cr: number; dest?: string; iris?: string };

/**
 * Reads a trial balance from the rows of a sheet: a heading row with an account name and Debit and
 * Credit columns (or a single signed Balance), an optional code column, then one account a row.
 */
export function parseTbRows(rows: string[][]): { lines: TbImportLine[]; problems: string[] } {
  const problems: string[] = [];
  let h = -1;
  const col: { code?: number; name?: number; dr?: number; cr?: number; bal?: number } = {};
  for (let i = 0; i < Math.min(rows.length, 20) && h < 0; i++) {
    const c: typeof col = {};
    rows[i].forEach((raw, j) => {
      const t = norm(String(raw ?? ""));
      if (/^(name|account|account name|description|detail|details|nominal name)$/.test(t) && c.name === undefined) c.name = j;
      else if (/^(code|account code|n c|nominal|nominal code|a c)$/.test(t) && c.code === undefined) c.code = j;
      else if (/^(debit|debits|dr|debit gbp)$/.test(t) && c.dr === undefined) c.dr = j;
      else if (/^(credit|credits|cr|credit gbp)$/.test(t) && c.cr === undefined) c.cr = j;
      else if (/^(balance|amount|closing balance|net)$/.test(t) && c.bal === undefined) c.bal = j;
    });
    if (c.name !== undefined && ((c.dr !== undefined && c.cr !== undefined) || c.bal !== undefined)) { h = i; Object.assign(col, c); }
  }
  if (h < 0) return { lines: [], problems: ["No trial balance found: it needs a heading row with the account name and Debit and Credit columns."] };
  const lines: TbImportLine[] = [];
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i];
    const name = String(r[col.name!] ?? "").trim();
    if (!name || /^(total|totals|difference)\b/i.test(name)) continue;
    let dr = 0, cr = 0;
    if (col.dr !== undefined && col.cr !== undefined) {
      dr = Math.abs(toAmount(String(r[col.dr] ?? "")) || 0);
      cr = Math.abs(toAmount(String(r[col.cr] ?? "")) || 0);
    } else {
      const b = toAmount(String(r[col.bal!] ?? "")) || 0;
      if (b >= 0) dr = b; else cr = -b;
    }
    if (!dr && !cr) continue;
    lines.push({ Code: col.code !== undefined ? String(r[col.code] ?? "").trim() : "", Detail: name, dr: r2(dr), cr: r2(cr) });
  }
  if (!lines.length) problems.push("The trial balance has no accounts with figures in it.");
  const diff = r2(lines.reduce((a, l) => a + l.dr - l.cr, 0));
  if (diff) problems.push(`The trial balance doesn't balance: debits and credits differ by ${Math.abs(diff).toFixed(2)}.`);
  return { lines, problems };
}

/**
 * Where an account goes, for trial balances laid out as the accounts are ("Turnover - Sales",
 * "Creditors less than 1 year - Corporation tax"): the heading before the first dash says what kind of
 * account it is. Undefined for anything else, so the usual name rules apply.
 */
export function statutoryDest(name: string): { dest: string; iris?: string } | undefined {
  const parts = name.split(/\s+-\s+/);
  if (parts.length < 2) return undefined;
  const head = norm(parts[0]), n = norm(name);
  if (/^(turnover|sales|revenue)$/.test(head)) return { dest: "income/sales", iris: "1" };
  if (/^(interest receivable|other interest receivable|interest receivable and similar income)$/.test(head)) return { dest: "income/interest", iris: "130" };
  if (/^(other operating income|other income)$/.test(head)) return { dest: "income/other" };
  if (/^cost of sales$/.test(head)) return { dest: "expenditure/cos" };
  if (/^(administrative expenses|distribution costs|selling and distribution|other operating charges|establishment)$/.test(head)) {
    if (/accountancy|accounting fees/.test(n)) return { dest: "expenditure/accountancy", iris: "285" };
    if (/directors? (salar|remuneration)/.test(n)) return { dest: "expenditure/tb", iris: "254/1*1" };
    return { dest: "expenditure/tb" };
  }
  if (/^interest payable/.test(head)) return { dest: "expenditure/tb", iris: "414" };
  if (/^(taxation|tax on profit|tax on profit on ordinary activities|tax)$/.test(head)) return /deferred/.test(n) ? { dest: "taxation/deferred", iris: "450" } : { dest: "taxation/current", iris: "442" };
  if (/^debtors/.test(head)) {
    if (/prepay|accrued income/.test(n)) return { dest: "debtors/prepayments", iris: "614" };
    if (/trade debtors/.test(n)) return { dest: "debtors/trade", iris: "586" };
    return { dest: "debtors/other", iris: "594" };
  }
  if (/^(cash|cash at bank and in hand|bank)$/.test(head)) return { dest: "bank/current", iris: "692" };
  if (/^creditors/.test(head)) {
    const after = /more than (one|1)|after (one|1)|due after/.test(head);
    if (/corporation tax/.test(n)) return { dest: "creditors/tax", iris: "747" };
    if (/directors? (loan|current)/.test(n)) return { dest: "creditors/dla", iris: "727/1*1" };
    if (/accrual/.test(n)) return { dest: "creditors/accruals", iris: "786" };
    if (/trade creditors/.test(n)) return { dest: "creditors/trade", iris: "737" };
    if (/vat|paye|social security|national insurance|taxation and social/.test(n)) return { dest: "creditors/ssot", iris: "755" };
    if (/hire purchase|finance lease/.test(n)) return { dest: after ? "creditors/hp#after" : "creditors/hp", iris: "909" };
    if (/loan/.test(n)) return { dest: after ? "creditors/loan#after" : "creditors/loan" };
    return { dest: "creditors/other" };
  }
  if (/^(share capital|called up share capital)$/.test(head)) return { dest: "capital/shares", iris: "966/1" };
  if (/^(profit and loss account|profit and loss reserve|retained earnings|reserves)$/.test(head)) {
    if (/dividend/.test(n)) return { dest: "capital/dividends", iris: "471/1" };
    return { dest: "capital/reserves", iris: "968/1" };
  }
  if (/^stock/.test(head)) return { dest: "stock/stock", iris: "569" };
  return undefined;
}

/** Whether a place in the papers is a profit and loss account (closed into reserves at the year end). */
export const isProfitAndLoss = (dest: string) => /^(income|expenditure|taxation)\//.test(dest) || dest === "capital/dividends";

export type OpeningAcct = { Code: string; Detail: string; balance: number; iris: string; dest: string };
export type RollForward = { accounts: OpeningAcct[]; result: number; dividends: number; toReserves: number };

/**
 * Last year's mapped final trial balance rolled forward: balance sheet accounts come across as they
 * are; the profit and loss accounts (and dividends) are added to reserves. A debit is positive.
 */
export function rollForward(maps: Mapping[]): RollForward {
  const accounts: OpeningAcct[] = [];
  let pl = 0, dividends = 0, result = 0;
  for (const m of maps) {
    if (m.dest === "ignore" || !DEST_BY_KEY.has(m.dest)) continue;
    if (isProfitAndLoss(m.dest)) {
      pl = r2(pl + m.balance);
      if (m.dest === "capital/dividends") dividends = r2(dividends + m.balance);
      else result = r2(result - m.balance);
    } else if (m.balance) accounts.push({ Code: m.acct.code, Detail: m.acct.account, balance: m.balance, iris: m.iris, dest: m.dest });
  }
  if (pl) {
    const res = accounts.find((a) => a.dest === "capital/reserves");
    if (res) res.balance = r2(res.balance + pl);
    else accounts.push({ Code: "", Detail: "Profit and loss account - Brought forward", balance: pl, iris: "968/1", dest: "capital/reserves" });
  }
  return { accounts: accounts.filter((a) => a.balance), result, dividends, toReserves: r2(-pl) };
}
