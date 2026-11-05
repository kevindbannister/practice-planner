// The KPIs on the reporting centre: each is worked out from the client's monthly profit and loss and balance sheet for a period (a month,
// a financial quarter or a financial year to date), and set against a target. Profit measures that are a share of an annual figure
// (returns) are scaled up to a year so a month and a year can be compared.
import { PeriodKind, ReportData, RRow, addMonths, periodMonths } from "./reportData";
import { r2 } from "./xero";

export type KpiUnit = "money" | "percent" | "days" | "ratio";
export type KpiCategory = "Profitability" | "Activity" | "Efficiency" | "Liquidity" | "Gearing" | "Cash Flow" | "Growth";
export type KpiDef = {
  id: string; name: string; category: KpiCategory; unit: KpiUnit;
  /** a result below the target is the good side (days to be paid, debt) */
  lowerIsBetter?: boolean;
  /** the target for a month (amounts are multiplied by the months in the period); none for the ratios that don't scale */
  target: number;
  /** the target is per month, so a quarter or year has it added up */
  perMonth?: boolean;
  how: string;
};

export const KPI_DEFS: KpiDef[] = [
  { id: "revenue", name: "Total Revenue", category: "Profitability", unit: "money", target: 90000, perMonth: true, how: "Sales and other trading income for the period." },
  { id: "gpm", name: "Gross Profit Margin", category: "Profitability", unit: "percent", target: 35, how: "Gross profit as a share of revenue." },
  { id: "opm", name: "Operating Profit Margin", category: "Profitability", unit: "percent", target: 25, how: "Gross profit less expenses, as a share of revenue." },
  { id: "npm", name: "Net Profit Margin", category: "Profitability", unit: "percent", target: 15, how: "Net profit (including other income) as a share of revenue." },
  { id: "ardays", name: "Accounts Receivable Days", category: "Activity", unit: "days", target: 40, lowerIsBetter: true, how: "Debtors at the end of the period, over revenue, times the days in the period." },
  { id: "invdays", name: "Inventory Days", category: "Activity", unit: "days", target: 30, lowerIsBetter: true, how: "Stock at the end of the period, over cost of sales, times the days in the period." },
  { id: "apdays", name: "Accounts Payable Days", category: "Activity", unit: "days", target: 45, how: "Creditors at the end of the period, over cost of sales (or costs if there are none), times the days in the period." },
  { id: "roe", name: "Return on Equity", category: "Efficiency", unit: "percent", target: 15, how: "Net profit for the year (the period scaled up) over equity at the end." },
  { id: "roa", name: "Return on Assets", category: "Efficiency", unit: "percent", target: 10, how: "Net profit for the year (the period scaled up) over total assets at the end." },
  { id: "roce", name: "Return on Capital Employed", category: "Efficiency", unit: "percent", target: 12.5, how: "Operating profit for the year (the period scaled up) over total assets less current liabilities." },
  { id: "current", name: "Current Ratio", category: "Liquidity", unit: "ratio", target: 2, how: "Current assets and cash over current liabilities." },
  { id: "quick", name: "Quick Ratio", category: "Liquidity", unit: "ratio", target: 1, how: "Current assets less stock, plus cash, over current liabilities." },
  { id: "dte", name: "Debt to Equity", category: "Gearing", unit: "percent", target: 100, lowerIsBetter: true, how: "Loans, hire purchase, overdrafts, cards and long-term liabilities over equity." },
  { id: "dta", name: "Debt to Total Assets", category: "Gearing", unit: "percent", target: 50, lowerIsBetter: true, how: "The same debt over total assets." },
  { id: "cash", name: "Cash on Hand", category: "Cash Flow", unit: "money", target: 10000, how: "Bank and cash balances at the end of the period." },
  { id: "revg", name: "Revenue Growth", category: "Growth", unit: "percent", target: 5, how: "Revenue against the same months a year earlier." },
  { id: "gpg", name: "Gross Profit Growth", category: "Growth", unit: "percent", target: 5, how: "Gross profit against the same months a year earlier." },
  { id: "ebitg", name: "EBIT Growth", category: "Growth", unit: "percent", target: 5, how: "Operating profit against the same months a year earlier." },
];

export const CATEGORIES: KpiCategory[] = ["Profitability", "Activity", "Efficiency", "Liquidity", "Gearing", "Cash Flow", "Growth"];

/** Per client: the targets changed from the standard, and the KPIs switched off. */
export type KpiSettings = { targets?: Record<string, number>; off?: string[] };

export type KpiResult = { def: KpiDef; value?: number; target: number; /** result less target, in the result's own unit */ gap?: number; onTrack?: boolean; note?: string };

const sumRows = (rows: RRow[], months: string[], all: string[]) => r2(rows.reduce((a, r) => a + months.reduce((b, m) => b + (r.amounts[all.indexOf(m)] || 0), 0), 0));
const endOf = (rows: RRow[], month: string, all: string[]) => r2(rows.reduce((a, r) => a + (r.amounts[all.indexOf(month)] || 0), 0));
const daysIn = (months: string[]) => months.reduce((n, m) => n + new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate(), 0);

const DEBT = /loan|hire purchase|\bhp\b|overdraft|credit card|finance|mortgage|bounce back|cbils|director'?s? (loan|current)/i;

/** The figures a period is made of. */
export function figuresFor(d: Pick<ReportData, "months" | "pl" | "bsMonths" | "bs">, months: string[]) {
  const pl = (g: string) => d.pl.filter((r) => r.group === g);
  const sum = (g: string, ms = months) => sumRows(pl(g), ms, d.months);
  const last = months[months.length - 1];
  const bs = (g: string) => d.bs.filter((r) => r.group === g);
  const at = (rows: RRow[]) => (d.bs.length ? endOf(rows, last, d.bsMonths) : undefined);
  const match = (g: string, re: RegExp) => bs(g).filter((r) => re.test(r.name));
  const revenue = sum("income"), cos = sum("cos"), expenses = sum("expense"), other = sum("other");
  const gross = r2(revenue - cos), operating = r2(gross - expenses), net = r2(operating + other);
  const bank = at(bs("bank")), curAssets = at(bs("curAsset")), fixed = at(bs("fixed")), curLiab = at(bs("curLiab")), ltLiab = at(bs("ltLiab")), equity = at(bs("equity"));
  const stock = at(match("curAsset", /stock|inventory/i)), debtors = at(match("curAsset", /debtor|receivable/i)), creditors = at(match("curLiab", /creditor|payable/i));
  const debt = d.bs.length ? r2(endOf([...bs("curLiab").filter((r) => DEBT.test(r.name)), ...bs("ltLiab")], last, d.bsMonths)) : undefined;
  const assets = d.bs.length ? r2((bank || 0) + (curAssets || 0) + (fixed || 0)) : undefined;
  return { revenue, cos, expenses, other, gross, operating, net, bank, curAssets, fixed, curLiab, ltLiab, equity, stock, debtors, creditors, debt, assets, days: daysIn(months) };
}

/** Every KPI for a period, with its target and whether it is met. */
export function computeKpis(d: Pick<ReportData, "months" | "pl" | "bsMonths" | "bs">, kind: PeriodKind, anchor: string, endMonth: number, settings: KpiSettings = {}): KpiResult[] {
  const months = periodMonths(kind, anchor, endMonth);
  const f = figuresFor(d, months);
  const before = figuresFor(d, months.map((m) => addMonths(m, -12)));
  const year = 12 / months.length;
  const growth = (a: number, b: number) => (b ? ((a - b) / Math.abs(b)) * 100 : undefined);
  const div = (a?: number, b?: number) => (a === undefined || b === undefined || b === 0 ? undefined : a / b);
  const pc = (v?: number) => (v === undefined ? undefined : r2(v * 100));
  const values: Record<string, number | undefined> = {
    revenue: f.revenue,
    gpm: pc(div(f.gross, f.revenue)),
    opm: pc(div(f.operating, f.revenue)),
    npm: pc(div(f.net, f.revenue)),
    ardays: f.debtors === undefined || !f.revenue ? undefined : r2((f.debtors / f.revenue) * f.days),
    invdays: f.stock === undefined || !f.cos ? undefined : r2((f.stock / f.cos) * f.days),
    apdays: f.creditors === undefined ? undefined : f.cos || f.expenses ? r2((f.creditors / (f.cos || f.expenses)) * f.days) : undefined,
    roe: pc(div(f.net * year, f.equity)),
    roa: pc(div(f.net * year, f.assets)),
    roce: f.assets === undefined || f.curLiab === undefined ? undefined : pc(div(f.operating * year, f.assets - f.curLiab)),
    current: f.curLiab === undefined ? undefined : r2(div((f.curAssets || 0) + (f.bank || 0), f.curLiab) ?? NaN),
    quick: f.curLiab === undefined ? undefined : r2(div((f.curAssets || 0) - (f.stock || 0) + (f.bank || 0), f.curLiab) ?? NaN),
    dte: pc(div(f.debt, f.equity)),
    dta: pc(div(f.debt, f.assets)),
    cash: f.bank,
    revg: growth(f.revenue, before.revenue),
    gpg: growth(f.gross, before.gross),
    ebitg: growth(f.operating, before.operating),
  };
  const off = new Set(settings.off || []);
  return KPI_DEFS.filter((k) => !off.has(k.id)).map((def) => {
    const raw = values[def.id];
    const value = raw === undefined || Number.isNaN(raw) ? undefined : r2(raw);
    const base = settings.targets?.[def.id] ?? def.target;
    const target = def.perMonth ? r2(base * months.length) : base;
    const gap = value === undefined ? undefined : r2(value - target);
    const onTrack = value === undefined ? undefined : def.lowerIsBetter ? value <= target : value >= target;
    return { def, value: value === undefined ? undefined : value, target, gap, onTrack, note: value === undefined && d.bs.length === 0 && /ardays|invdays|apdays|roe|roa|roce|current|quick|dte|dta|cash/.test(def.id) ? "Needs the balance sheet" : undefined };
  });
}

export function formatKpi(unit: KpiUnit, v?: number): string {
  if (v === undefined) return "–";
  if (unit === "money") return `${v < 0 ? "-" : ""}£${Math.abs(Math.round(v)).toLocaleString("en-GB")}`;
  if (unit === "percent") return `${v.toLocaleString("en-GB", { maximumFractionDigits: 2 })}%`;
  if (unit === "days") return `${Math.round(v)} days`;
  return `${v.toFixed(2)}:1`;
}

// ------------------------------------------------------------------ the explorer wheel

export type Importance = "High" | "Medium" | "Low";
export const IMPORTANCE: Record<string, Importance> = {
  revenue: "High", gpm: "High", npm: "High", cash: "High", current: "High", revg: "High",
  opm: "Medium", ardays: "Medium", apdays: "Medium", roe: "Medium", roce: "Medium", quick: "Medium", dte: "Medium", gpg: "Medium", ebitg: "Medium",
  invdays: "Low", roa: "Low", dta: "Low",
};
export type Grouping = "perspective" | "result" | "importance";
export type WheelItem = { id: string; name: string; category: string; angle: number; status: "on" | "off" | "none" };
export type WheelGroup = { category: string; angle: number };

/** Where each KPI sits round the wheel (degrees clockwise from the top, 0 to 360): by perspective or importance in groups with a gap
 *  between them, or by result in one arc across the top with the off-track ones first. */
export function wheelLayout(results: KpiResult[], by: Grouping = "perspective"): { items: WheelItem[]; groups: WheelGroup[] } {
  const status = (x: KpiResult): WheelItem["status"] => (x.onTrack === undefined ? "none" : x.onTrack ? "on" : "off");
  const norm = (a: number) => ((a % 360) + 360) % 360;
  if (by === "result") {
    const order = { off: 0, none: 1, on: 2 } as const;
    const list = [...results].sort((a, b) => order[status(a)] - order[status(b)]);
    const n = list.length;
    return { items: list.map((x, i) => ({ id: x.def.id, name: x.def.name, category: "", angle: norm(-105 + ((i + 0.5) / n) * 210), status: status(x) })), groups: [] };
  }
  const key = (x: KpiResult): string => (by === "importance" ? IMPORTANCE[x.def.id] || "Medium" : x.def.category);
  const names: string[] = by === "importance" ? ["High", "Medium", "Low"] : CATEGORIES;
  const cats = names.filter((c) => results.some((x) => key(x) === c));
  const slots = results.length + cats.length; // one empty slot after each group
  const step = slots ? 360 / slots : 0;
  const items: WheelItem[] = [], groups: WheelGroup[] = [];
  let slot = 0;
  for (const c of cats) {
    const start = slot;
    for (const x of results.filter((r) => key(r) === c)) {
      items.push({ id: x.def.id, name: x.def.name, category: c, angle: slot * step + step / 2, status: status(x) });
      slot++;
    }
    groups.push({ category: c, angle: ((start + slot - 1) / 2) * step + step / 2 });
    slot++;
  }
  return { items, groups };
}
