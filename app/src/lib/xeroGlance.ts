// The at-a-glance numbers for one Xero organisation over any date range: the profit and loss, the
// balances at the end date, a month-by-month trend, and the transactions behind any account. Figures
// are read live from Xero and kept for a short time, so moving between ranges is quick.
import { addYears } from "./engagements";
import { XAccount, LedgerLine, PL, TbLine, XeroApi, XeroError, parseAccounts, parseProfitAndLoss, parseTrialBalance, rebuildLedger, readDocuments, r2 } from "./xero";
import { acctKey, yearEnds } from "./papers";

// ------------------------------------------------------------------ dates

export const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
export const shiftYear = (iso: string, n: number) => addYears(iso, n);

export type Range = { key: string; label: string; from: string; to: string };

/** Date ranges to pick from: calendar ones, and the financial years when the year end is known. */
export function rangesFor(today: string, yearEnd?: string): Range[] {
  const y = today.slice(0, 4), m = Number(today.slice(5, 7));
  const monthStart = `${y}-${String(m).padStart(2, "0")}-01`;
  const lastMonthEnd = addDays(monthStart, -1);
  const qStart = `${y}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;
  const out: Range[] = [
    { key: "month", label: "This month", from: monthStart, to: today },
    { key: "last-month", label: "Last month", from: `${lastMonthEnd.slice(0, 8)}01`, to: lastMonthEnd },
    { key: "quarter", label: "This quarter", from: qStart, to: today },
    { key: "last-12", label: "Last 12 months", from: addDays(today, -364), to: today },
  ];
  // the financial years: the year ends that have passed, most recent first (yearEnds gives the next one too)
  const ends = yearEnd ? yearEnds(yearEnd, today, 3) : [];
  const passed = ends.filter((d) => d <= today).sort((a, b) => (a < b ? 1 : -1));
  if (passed.length >= 3) {
    out.push({ key: "ytd", label: "Year to date", from: addDays(passed[0], 1), to: today });
    out.push({ key: "last-fy", label: "Last financial year", from: addDays(passed[1], 1), to: passed[0] });
    out.push({ key: "prior-fy", label: "The year before", from: addDays(passed[2], 1), to: passed[1] });
  }
  return out;
}

// ------------------------------------------------------------------ the figures

export type Balance = { key: string; code: string; name: string; group: "cash" | "debtors" | "creditors"; amount: number };
export type Trend = { label: string; sales: number; profit: number };
export type Glance = {
  from: string; to: string; days: number; accounts: XAccount[]; pl: PL;
  sales: number; costOfSales: number; grossProfit: number; overheads: number; otherIncome: number; netProfit: number;
  cash: number; debtors: number; creditors: number; debtorDays?: number;
  balances: Balance[]; trend: Trend[];
};

/** Each profit and loss account's amount for the range, shown positive for income and cost. */
const sumOf = (pl: PL, section: PL["rows"][number]["section"], i = 0) => r2(pl.rows.filter((r) => r.section === section).reduce((a, r) => a + (r.amounts[i] || 0), 0));

function totalsFrom(pl: PL, i = 0) {
  const sales = sumOf(pl, "income", i), costOfSales = sumOf(pl, "cos", i), overheads = sumOf(pl, "expense", i), otherIncome = sumOf(pl, "other", i);
  const grossProfit = r2(sales - costOfSales);
  return { sales, costOfSales, grossProfit, overheads, otherIncome, netProfit: r2(grossProfit + otherIncome - overheads) };
}

/** Read the figures for a range from Xero. Monthly columns are added when the range is up to two years. */
export async function readGlance(api: XeroApi, id: string, from: string, to: string): Promise<Glance> {
  const accounts = parseAccounts(await api.get(id, "accounting", "Accounts"));
  const pl = parseProfitAndLoss(await api.get(id, "accounting", "Reports/ProfitAndLoss", { fromDate: from, toDate: to, standardLayout: true }), accounts);
  const days = daysBetween(from, to);
  let trend: Trend[] = [];
  if (days <= 740) {
    const mpl = parseProfitAndLoss(await api.get(id, "accounting", "Reports/ProfitAndLoss", { fromDate: from, toDate: to, standardLayout: true, timeframe: "MONTH" }), accounts);
    trend = mpl.months.map((label, i) => {
      const t = totalsFrom(mpl, i);
      return { label, sales: t.sales, profit: t.netProfit };
    });
  }
  const tb: TbLine[] = parseTrialBalance(await api.get(id, "accounting", "Reports/TrialBalance", { date: to }), accounts);
  const bal = (code: string) => {
    const l = tb.find((x) => x.Code === code);
    return l ? r2((l.f.dr || 0) - (l.f.cr || 0)) : 0;
  };
  const balances: Balance[] = [];
  for (const a of accounts) {
    const group = a.type === "BANK" ? "cash" : a.sys === "DEBTORS" ? "debtors" : a.sys === "CREDITORS" ? "creditors" : undefined;
    if (!group) continue;
    const raw = bal(a.code);
    const amount = group === "creditors" ? -raw : raw;
    balances.push({ key: a.key, code: a.code, name: a.name, group, amount });
  }
  const sumGroup = (g: Balance["group"]) => r2(balances.filter((b) => b.group === g).reduce((x, b) => x + b.amount, 0));
  const t = totalsFrom(pl);
  const debtors = sumGroup("debtors"), creditors = sumGroup("creditors"), cash = sumGroup("cash");
  return {
    from, to, days, accounts, pl, ...t, cash, debtors, creditors,
    debtorDays: debtors > 0 && t.sales > 0 ? Math.round((debtors / t.sales) * days) : undefined,
    balances, trend,
  };
}

// ------------------------------------------------------------------ transactions behind an account

export type Txns = { lines: LedgerLine[]; gaps: string[]; why: string };

/** Every transaction in the range (from the documents Xero keeps), before they're split by account. */
export async function readTransactions(api: XeroApi, id: string, accounts: XAccount[], from: string, to: string): Promise<Txns> {
  const r = await readDocuments(api, id, from, to);
  if (r.invoicesMissing) throw new XeroError("scope", r.why || "This Xero connection can't read invoices and bills, so the transactions can't be shown.");
  return { lines: rebuildLedger(r.docs, accounts, from, to), gaps: r.gaps, why: r.why };
}

/** The account key the transactions use, for a profit and loss row. */
export const keyOfPl = (code: string, name: string) => acctKey(code, name);

// ------------------------------------------------------------------ a short cache, so moving between ranges is quick

const TTL = 15 * 60 * 1000;
const cache = new Map<string, { at: number; value: unknown }>();
export function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.value as T);
  return load().then((value) => {
    cache.set(key, { at: Date.now(), value });
    return value;
  });
}
