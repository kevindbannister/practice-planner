// The analysis screens on the reporting centre that work from the monthly figures: the cash flow waterfall, the growth trail, the trend
// measures and the goalseek model. Each takes the client's ReportData and a period and returns plain numbers for the screen to draw.
import { PeriodKind, ReportData, RRow, addMonths, periodMonths } from "./reportData";
import { creditorDays, debtorDays, figuresFor } from "./kpis";
import { r2 } from "./xero";

type Src = Pick<ReportData, "months" | "pl" | "bsMonths" | "bs">;

const sumPl = (rows: RRow[], months: string[], all: string[]) => r2(rows.reduce((a, r) => a + months.reduce((b, m) => b + (r.amounts[all.indexOf(m)] || 0), 0), 0));
const bal = (rows: RRow[], month: string, all: string[]): number | undefined => { const i = all.indexOf(month); return i < 0 ? undefined : r2(rows.reduce((a, r) => a + (r.amounts[i] || 0), 0)); };

const DEPN = /deprec/i, AMORT = /amortis|amortiz/i, INTEREST = /interest/i, TAX = /corporation tax|income tax|^tax\b|taxation/i;
const DEBT = /loan|hire purchase|\bhp\b|overdraft|credit card|finance|mortgage|bounce back|cbils|director'?s? (loan|current)/i;

// ------------------------------------------------------------------ cash flow

export type CfLine = { label: string; amount: number; tag: "ADD" | "LESS"; gapBefore?: boolean };
export type CfTotal = { label: string; amount: number };
export type CashFlow = {
  lines: CfLine[]; /** a subtotal shown after the line at this position */ totals: { after: number; total: CfTotal }[];
  operating: number; free: number; net: number;
  /** what the movements in the balance sheet and the profit and loss don't account for: should be small */ unexplained: number; /** true when it is big enough to question */ unexplainedBig: boolean;
  cash: { open: number; close: number }; debt: { open: number; close: number };
};

/** The cash flow for a period, worked from the profit and loss and the change in each balance sheet group. Undefined without a balance sheet. */
export function cashFlow(d: Src, kind: PeriodKind, anchor: string, endMonth: number): CashFlow | undefined {
  const months = periodMonths(kind, anchor, endMonth);
  const open = addMonths(months[0], -1), close = months[months.length - 1];
  if (!d.bs.length || d.bsMonths.indexOf(open) < 0 || d.bsMonths.indexOf(close) < 0) return undefined;
  const pl = (g: string) => d.pl.filter((r) => r.group === g);
  const exp = pl("expense"), oth = pl("other");
  const s = (rows: RRow[]) => sumPl(rows, months, d.months);
  const revenue = s(pl("income")), cos = s(pl("cos"));
  const depn = s(exp.filter((r) => DEPN.test(r.name))), amort = s(exp.filter((r) => AMORT.test(r.name) && !DEPN.test(r.name)));
  const intExp = s(exp.filter((r) => INTEREST.test(r.name))), tax = s(exp.filter((r) => TAX.test(r.name) && !INTEREST.test(r.name)));
  const intInc = s(oth.filter((r) => INTEREST.test(r.name))), otherInc = r2(s(oth) - intInc);
  const expenses = r2(s(exp) - depn - amort - intExp - tax);

  const g = (name: string) => d.bs.filter((r) => r.group === name);
  const change = (rows: RRow[]) => r2((bal(rows, close, d.bsMonths) || 0) - (bal(rows, open, d.bsMonths) || 0));
  const not = (rows: RRow[], ...res: RegExp[]) => rows.filter((r) => !res.some((x) => x.test(r.name)));
  const only = (rows: RRow[], re: RegExp) => rows.filter((r) => re.test(r.name));
  const cur = g("curLiab"), ca = g("curAsset"), fx = g("fixed"), lt = g("ltLiab"), eq = g("equity");
  const AP = /creditor|payable/i, AR = /debtor|receivable/i, STOCK = /stock|inventory/i, WIP = /work in progress|\bwip\b/i;
  const INTANG = /intangible|goodwill|software|patent|trademark/i, INVEST = /investment/i;
  const earnings = /earnings|retained|profit and loss|profit & loss/i, DIV = /dividend/i;

  const dAP = change(only(cur, AP)), dOcl = change(not(cur, AP, DEBT));
  const dAR = change(only(ca, AR)), dStock = change(only(ca, STOCK)), dWip = change(only(ca, WIP)), dOca = change(not(ca, AR, STOCK, WIP));
  const dIntang = change(only(fx, INTANG)), dInvest = change(only(fx, INVEST)), dTang = change(not(fx, INTANG, INVEST));
  const dOnc = change(not(lt, DEBT));
  const dDiv = change(only(eq, DIV)), dEq = change(not(eq, earnings, DIV));
  const cashOpen = bal(g("bank"), open, d.bsMonths) || 0, cashClose = bal(g("bank"), close, d.bsMonths) || 0;
  const debtRows = [...only(cur, DEBT), ...only(lt, DEBT)];
  const debtOpen = bal(debtRows, open, d.bsMonths) || 0, debtClose = bal(debtRows, close, d.bsMonths) || 0;
  const net = r2(cashClose - cashOpen - (debtClose - debtOpen));

  const lines: CfLine[] = [
    { label: "Revenue", amount: revenue, tag: "ADD" },
    { label: "Cost of Sales", amount: -cos, tag: "LESS" },
    { label: "Expenses", amount: -expenses, tag: "LESS" },
    { label: "Other Income", amount: otherInc, tag: "ADD" },
    { label: "Tax (charge for the period)", amount: -tax, tag: "LESS" },
    { label: "Change in Accounts Payable", amount: dAP, tag: "ADD", gapBefore: true },
    { label: "Change in Other Current Liabilities", amount: dOcl, tag: "ADD" },
    { label: "Change in Accounts Receivable", amount: -dAR, tag: "LESS", gapBefore: true },
    { label: "Change in Inventory", amount: -dStock, tag: "LESS" },
    { label: "Change in Work In Progress", amount: -dWip, tag: "LESS" },
    { label: "Change in Other Current Assets", amount: -dOca, tag: "LESS" },
  ].map((l): CfLine => ({ ...(l as CfLine), amount: r2(l.amount) }));
  const operating = r2(lines.reduce((a, l) => a + l.amount, 0));
  const inv: CfLine[] = [
    { label: "Change in Fixed Assets (ex. Depn & Amortisation)", amount: r2(-(dTang + depn)), tag: "LESS" },
    { label: "Change in Intangible Assets", amount: r2(-(dIntang + amort)), tag: "LESS" },
    { label: "Change in Investments or Other Non-Current Assets", amount: r2(-dInvest), tag: "LESS" },
  ];
  const free = r2(operating + inv.reduce((a, l) => a + l.amount, 0));
  const fin: CfLine[] = [
    { label: "Net Interest", amount: r2(intInc - intExp), tag: "LESS" },
    { label: "Change in Other Non-Current Liabilities", amount: dOnc, tag: "ADD" },
    { label: "Dividends", amount: dDiv, tag: "LESS", gapBefore: true },
    { label: "Change in Retained Earnings and Other Equity", amount: dEq, tag: "ADD" },
  ];
  const before = r2(free + fin.reduce((a, l) => a + l.amount, 0));
  const adjust: CfLine = { label: "Unexplained difference", amount: r2(net - before), tag: "LESS" };
  const all = [...lines, ...inv, ...fin, adjust];
  return {
    lines: all, operating, free, net, unexplained: adjust.amount, unexplainedBig: Math.abs(adjust.amount) > Math.max(100, Math.abs(revenue) * 0.01),
    totals: [
      { after: lines.length - 1, total: { label: "OPERATING CASH FLOW", amount: operating } },
      { after: lines.length + inv.length - 1, total: { label: "FREE CASH FLOW", amount: free } },
      { after: all.length - 1, total: { label: "NET CASH FLOW", amount: net } },
    ],
    cash: { open: cashOpen, close: cashClose }, debt: { open: debtOpen, close: debtClose },
  };
}

// ------------------------------------------------------------------ trend and growth measures

export type MeasureUnit = "money" | "percent" | "days" | "ratio";
export type Measure = { id: string; label: string; unit: MeasureUnit; balance?: boolean; /** -1 when less is better (costs): a fall is shown as favourable */ dir?: -1; get: (f: ReturnType<typeof figuresFor>) => number | undefined };
const pct = (a: number, b: number) => (b ? r2((a / b) * 100) : undefined);

export const MEASURES: Measure[] = [
  { id: "revenue", label: "Revenue", unit: "money", get: (f) => f.revenue },
  { id: "cos", label: "Cost of Sales", unit: "money", dir: -1, get: (f) => f.cos },
  { id: "gross", label: "Gross Profit", unit: "money", get: (f) => f.gross },
  { id: "expenses", label: "Expenses", unit: "money", dir: -1, get: (f) => f.expenses },
  { id: "invest", label: "Total Operating Investment", unit: "money", dir: -1, get: (f) => r2(f.cos + f.expenses) },
  { id: "operating", label: "EBIT (Operating Profit)", unit: "money", get: (f) => f.operating },
  { id: "net", label: "Net Profit", unit: "money", get: (f) => f.net },
  { id: "cash", label: "Cash on Hand", unit: "money", balance: true, get: (f) => f.bank },
  { id: "debtors", label: "Debtors", unit: "money", balance: true, dir: -1, get: (f) => f.debtors },
  { id: "creditors", label: "Creditors", unit: "money", balance: true, get: (f) => f.creditors },
  { id: "stock", label: "Stock", unit: "money", balance: true, get: (f) => f.stock },
  { id: "equity", label: "Equity", unit: "money", balance: true, get: (f) => f.equity },
  { id: "gpm", label: "Gross Profit Margin", unit: "percent", get: (f) => pct(f.gross, f.revenue) },
  { id: "opm", label: "Operating Profit Margin", unit: "percent", get: (f) => pct(f.operating, f.revenue) },
  { id: "npm", label: "Net Profit Margin", unit: "percent", get: (f) => pct(f.net, f.revenue) },
  { id: "wcAssets", label: "Current Assets (with cash)", unit: "money", balance: true, get: (f) => (f.curAssets === undefined ? undefined : r2(f.curAssets + (f.bank || 0))) },
  { id: "wcLiab", label: "Current Liabilities", unit: "money", balance: true, dir: -1, get: (f) => f.curLiab },
  { id: "nwc", label: "Net Working Capital", unit: "money", balance: true, get: (f) => (f.curAssets === undefined || f.curLiab === undefined ? undefined : r2(f.curAssets + (f.bank || 0) - f.curLiab)) },
  { id: "currentRatio", label: "Current Ratio", unit: "ratio", balance: true, get: (f) => (f.curAssets === undefined || !f.curLiab ? undefined : r2((f.curAssets + (f.bank || 0)) / f.curLiab)) },
  { id: "ardays", label: "Debtor Days", unit: "days", balance: true, dir: -1, get: (f) => debtorDays(f) },
  { id: "apdays", label: "Creditor Days", unit: "days", balance: true, get: (f) => creditorDays(f) },
];
export const measureById = (id: string) => MEASURES.find((m) => m.id === id);

export const PREDEFINED: { name: string; ids: string[] }[] = [
  { name: "Revenue and profit", ids: ["revenue", "gross", "operating"] },
  { name: "Margins", ids: ["gpm", "opm", "npm"] },
  { name: "Costs", ids: ["cos", "expenses"] },
  { name: "Cash and creditors", ids: ["cash", "creditors", "debtors"] },
];

/** One value per month for a measure. Balance measures need the balance sheet; without it they are blank. */
export function monthlySeries(d: Src, id: string): { month: string; value?: number }[] {
  const m = measureById(id);
  if (!m) return [];
  return d.months.map((month) => {
    if (m.balance && !d.bs.length) return { month };
    const v = m.get(figuresFor(d, [month]));
    return { month, value: v === undefined || Number.isNaN(v) ? undefined : v };
  });
}

/** The months the Trend chart shows: the 13 up to the one picked, a financial year, or everything up to it. */
export function trendRange(months: string[], upTo: string, show: string, endMonth: number): string[] {
  const upto = months.filter((m) => m <= upTo);
  if (show === "all") return upto;
  if (show === "13") return upto.slice(-13);
  const fy = Number(show); // the year the financial year ends in
  return upto.filter((m) => {
    const y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7));
    return (mo > endMonth ? y + 1 : y) === fy;
  });
}

export function financialYears(months: string[], endMonth: number): number[] {
  const ys = new Set(months.map((m) => (Number(m.slice(5, 7)) > endMonth ? Number(m.slice(0, 4)) + 1 : Number(m.slice(0, 4)))));
  return [...ys].sort();
}

export type Trail = { month: string; x?: number; y?: number };
export function growthTrail(d: Src, xId: string, yId: string, from: string, to: string): Trail[] {
  const xs = monthlySeries(d, xId), ys = monthlySeries(d, yId);
  return d.months.filter((m) => m >= from && m <= to).map((month) => ({ month, x: xs.find((s) => s.month === month)?.value, y: ys.find((s) => s.month === month)?.value }));
}

// ------------------------------------------------------------------ goalseek

export type GoalBase = { revenue: number; cos: number; varExp: number; fixedExp: number; other: number };
export type Levers = { price: number; volume: number; cos: number; fixed: number; varExp: number };
export const NO_CHANGE: Levers = { price: 0, volume: 0, cos: 0, fixed: 0, varExp: 0 };
export type GoalMetric = "opm" | "gpm" | "npm" | "operating";
export const GOAL_METRICS: [GoalMetric, string, "percent" | "money"][] = [["opm", "Profitability Ratio", "percent"], ["gpm", "Gross Profit Margin", "percent"], ["npm", "Net Profit Margin", "percent"], ["operating", "Operating Profit", "money"]];
export const LEVERS: [keyof Levers, string][] = [["price", "Price"], ["volume", "Volume"], ["cos", "Variable COS"], ["fixed", "Fixed Expenses"], ["varExp", "Variable Expenses"]];
const VAR_EXP = /commission|bank charge|merchant|card (fee|charge)|postage|carriage|freight|delivery|packaging|subcontract|sub-contract|courier/i;

export function goalBase(d: Src, kind: PeriodKind, anchor: string, endMonth: number): GoalBase {
  const months = periodMonths(kind, anchor, endMonth);
  const f = figuresFor(d, months);
  const exp = d.pl.filter((r) => r.group === "expense");
  const varExp = sumPl(exp.filter((r) => VAR_EXP.test(r.name)), months, d.months);
  return { revenue: f.revenue, cos: f.cos, varExp, fixedExp: r2(f.expenses - varExp), other: f.other };
}

/** The metric with the levers applied: price and volume move revenue, volume also moves the variable costs, the others are as named. */
export function goalValue(b: GoalBase, m: GoalMetric, l: Levers): number | undefined {
  const rev = b.revenue * (1 + l.price) * (1 + l.volume);
  const cos = b.cos * (1 + l.cos) * (1 + l.volume), ve = b.varExp * (1 + l.varExp) * (1 + l.volume), fe = b.fixedExp * (1 + l.fixed);
  const gross = rev - cos, op = gross - ve - fe;
  if (m === "operating") return op;
  if (!rev) return undefined;
  return ((m === "gpm" ? gross : m === "npm" ? op + b.other : op) / rev) * 100;
}

/** The change in one lever, on its own, that reaches the goal; undefined when it can't. */
export function soloChange(b: GoalBase, m: GoalMetric, goal: number, lever: keyof Levers): number | undefined {
  const at = (x: number) => goalValue(b, m, { ...NO_CHANGE, [lever]: x });
  let lo = -0.999, hi = 50;
  const a = at(lo), z = at(hi), start = at(0);
  if (a === undefined || z === undefined || start === undefined) return undefined;
  if (Math.abs(start - goal) < 1e-9) return 0;
  if (Math.abs(z - a) < 1e-12 || goal < Math.min(a, z) || goal > Math.max(a, z)) return undefined;
  const up = z > a;
  for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2, v = at(mid) as number; if (v < goal === up) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

/** How much each lever, applied in turn, adds to the metric. */
export function contributions(b: GoalBase, m: GoalMetric, l: Levers): { lever: keyof Levers; delta: number }[] {
  const cur: Levers = { ...NO_CHANGE };
  let prev = goalValue(b, m, cur) ?? 0;
  return LEVERS.map(([k]) => { cur[k] = l[k]; const v = goalValue(b, m, cur) ?? prev; const delta = v - prev; prev = v; return { lever: k, delta }; });
}
