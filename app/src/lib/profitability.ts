// Reporting › Profitability: the breakeven picture for a period. Cost of sales is treated as the cost that moves with sales (so much per £1 of
// revenue) and the expenses as fixed; the breakeven point is the revenue at which the two together are covered.
import { PeriodKind, ReportData, RRow, periodMonths } from "./reportData";
import { figuresFor } from "./kpis";
import { r2 } from "./xero";

export type Breakeven = {
  revenue: number; cos: number; expenses: number; totalCosts: number; gross: number; operating: number; net: number;
  variablePerPound: number; fixed: number;
  /** revenue at which profit is nil; undefined when each £1 of sales costs £1 or more */
  breakeven?: number; marginOfSafety?: number; marginPct?: number;
  topRevenue: { name: string; amount: number }[]; topCosts: { name: string; amount: number }[];
};

const top = (rows: RRow[], months: string[], all: string[]) =>
  rows.map((r) => ({ name: r.name, amount: r2(months.reduce((a, m) => a + (r.amounts[all.indexOf(m)] || 0), 0)) })).filter((x) => x.amount).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).slice(0, 10);

export function breakeven(d: Pick<ReportData, "months" | "pl" | "bsMonths" | "bs">, kind: PeriodKind, anchor: string, endMonth: number): Breakeven {
  const months = periodMonths(kind, anchor, endMonth);
  const f = figuresFor(d, months);
  const variablePerPound = f.revenue ? f.cos / f.revenue : 0;
  const fixed = f.expenses;
  const breakeven = variablePerPound < 1 && f.revenue > 0 ? r2(fixed / (1 - variablePerPound)) : undefined;
  const marginOfSafety = breakeven === undefined ? undefined : r2(f.revenue - breakeven);
  return {
    revenue: f.revenue, cos: f.cos, expenses: f.expenses, totalCosts: r2(f.cos + f.expenses), gross: f.gross, operating: f.operating, net: f.net,
    variablePerPound, fixed, breakeven, marginOfSafety, marginPct: marginOfSafety === undefined || !f.revenue ? undefined : r2((marginOfSafety / f.revenue) * 100),
    topRevenue: top(d.pl.filter((r) => r.group === "income"), months, d.months),
    topCosts: top(d.pl.filter((r) => r.group === "cos" || r.group === "expense"), months, d.months),
  };
}
