// The numbers behind the report components: key numbers, rule-based observations, series charts by month, quarter or year, and the top accounts.
// Pure functions of the client's monthly figures and a period, so they can be tested and drawn the same way on screen and when published.
import { figuresFor } from "./kpis";
import { Measure, measureById } from "./analysis";
import { Fmt, Freq, Op, Operand, TopGroup, When } from "./reportBuilder";
import { FINANCE_COST, PeriodKind, ReportData, addMonths, monthLabel, periodCols, periodMonths } from "./reportData";
import { r2 } from "./xero";

type Src = Pick<ReportData, "months" | "pl" | "bsMonths" | "bs">;

/** The months of the period itself, the one before it, or the same one a year earlier. */
export function periodMonthsFor(kind: PeriodKind, anchor: string, endMonth: number, when: When): string[] {
  if (when === "this") return periodMonths(kind, anchor, endMonth);
  return periodCols(kind, anchor, endMonth, when)[1]?.months || [];
}

/** A measure for some months: profit and loss measures add up, balance measures are the balance at the end, margins are worked from the sums. */
export function measureValue(d: Src, measureId: string, months: string[]): number | undefined {
  const m = measureById(measureId) as Measure | undefined;
  if (!m || !months.length || (m.balance && !d.bs.length)) return undefined;
  const v = m.get(figuresFor(d, months));
  return v === undefined || Number.isNaN(v) ? undefined : v;
}

const OPS: Record<Op, (a: number, b: number) => boolean> = { gt: (a, b) => a > b, lt: (a, b) => a < b, gte: (a, b) => a >= b, lte: (a, b) => a <= b, eq: (a, b) => Math.abs(a - b) < 0.005 };
export const OP_LABEL: Record<Op, string> = { gt: "greater than", lt: "less than", gte: "greater than or equal to", lte: "less than or equal to", eq: "equal to" };
export const WHEN_LABEL: Record<When, string> = { this: "This period", prior: "Last period", lastYear: "Same period last year" };

export type RuleResult = { ok?: boolean; left?: number; right?: number };
export function evalRule(d: Src, kind: PeriodKind, anchor: string, endMonth: number, left: { measure: string; when: When }, op: Op, right: Operand): RuleResult {
  const l = measureValue(d, left.measure, periodMonthsFor(kind, anchor, endMonth, left.when));
  const rv = "value" in right ? right.value : measureValue(d, right.measure, periodMonthsFor(kind, anchor, endMonth, right.when));
  return { ok: l === undefined || rv === undefined ? undefined : OPS[op](l, rv), left: l, right: rv };
}

/** The periods of a series chart, oldest first, each the months it adds up: the latest first, then back by month, financial quarter or year. */
export function buckets(freq: Freq, anchor: string, endMonth: number, count: number, available: string[]): { label: string; months: string[] }[] {
  const out: { label: string; months: string[] }[] = [];
  let a = anchor;
  for (let i = 0; i < count && a >= (available[0] || a); i++) {
    const ms = freq === "month" ? [a] : periodMonths(freq === "quarter" ? "quarter" : "year", a, endMonth);
    const last = ms[ms.length - 1];
    let label = monthLabel(last);
    if (freq === "quarter") label = `${monthLabel(ms[0]).slice(0, 3)}–${monthLabel(last)}`;
    if (freq === "year") {
      const y = Number(last.slice(0, 4)), fy = Number(last.slice(5, 7)) > endMonth ? y + 1 : y;
      label = endMonth === 12 ? String(fy) : `${String(fy - 1).slice(2)}/${String(fy).slice(2)}`;
      if (Number(last.slice(5, 7)) !== endMonth) label += " YTD";
    }
    out.unshift({ label, months: ms.filter((m) => available.includes(m)) });
    a = addMonths(ms[0], -1);
  }
  return out;
}

export type TopRow = { name: string; amount: number };
export const TOP_GROUPS: [TopGroup, string][] = [["income", "Revenue"], ["cos", "Cost of Sales"], ["expense", "Expenses"], ["other", "Other Income"], ["bank", "Cash & Equivalents"], ["curAsset", "Current Assets"], ["fixed", "Fixed Assets"], ["curLiab", "Current Liabilities"], ["ltLiab", "Non-current Liabilities"], ["equity", "Equity"]];
export function topAccounts(d: Src, group: TopGroup, months: string[], n: number, order: "top" | "bottom", hideNil: boolean): TopRow[] {
  const pl = ["income", "cos", "expense", "other"].includes(group);
  const rows = (pl ? d.pl : d.bs).filter((r) => r.group === group).map((r) => {
    const amount = pl ? months.reduce((a, m) => a + (r.amounts[d.months.indexOf(m)] || 0), 0) : (months.length ? r.amounts[d.bsMonths.indexOf(months[months.length - 1])] || 0 : 0);
    return { name: r.name, amount: r2(amount) };
  }).filter((r) => !hideNil || r.amount !== 0);
  rows.sort((a, b) => (order === "top" ? b.amount - a.amount : a.amount - b.amount) || a.name.localeCompare(b.name));
  return rows.slice(0, Math.max(1, n));
}

/** A figure for the screen: £ with commas, or in thousands when rounded, with pence on request. */
export function fmtValue(unit: Measure["unit"], v: number | undefined, f: Fmt = {}): string {
  if (v === undefined) return "–";
  if (unit === "percent") return `${v.toLocaleString("en-GB", { maximumFractionDigits: 2 })}%`;
  if (unit === "days") return `${Math.round(v)} days`;
  if (unit === "ratio") return `${v.toFixed(2)}:1`;
  const sym = f.symbol === false ? "" : "£", sign = v < 0 ? "-" : "", a = Math.abs(v);
  if (f.rounded) return a >= 1e6 ? `${sign}${sym}${+(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `${sign}${sym}${+(a / 1e3).toFixed(1)}K` : `${sign}${sym}${Math.round(a)}`;
  return `${sign}${sym}${a.toLocaleString("en-GB", f.decimals ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 0 })}`;
}

export type KeyData = { value?: number; compare?: number; changePct?: number; spark: (number | undefined)[]; label: string };
export function keyData(d: Src, measureId: string, kind: PeriodKind, anchor: string, endMonth: number, compare: "none" | "prior" | "lastYear"): KeyData {
  const value = measureValue(d, measureId, periodMonths(kind, anchor, endMonth));
  const cmp = compare === "none" ? undefined : measureValue(d, measureId, periodMonthsFor(kind, anchor, endMonth, compare));
  const spark = d.months.filter((m) => m <= anchor).slice(-13).map((m) => measureValue(d, measureId, [m]));
  return { value, compare: cmp, changePct: value !== undefined && cmp ? r2(((value - cmp) / Math.abs(cmp)) * 100) : undefined, spark, label: measureById(measureId)?.label || measureId };
}

/** Which columns a table shows: its own list, or the one its older "compare" setting stands for. */
export function tableCols(b: { cols?: string[]; compare: "none" | "prior" | "lastYear" | "months" }): string[] {
  if (b.cols?.length) return b.cols;
  return b.compare === "none" ? ["this"] : b.compare === "months" ? ["months"] : b.compare === "prior" ? ["this", "prior", "var", "varPct"] : ["this", "lastYear", "var", "varPct"];
}

/** The accounts in a group that moved most between two periods, biggest change first, keeping only changes of more than `amount` (£) and `pct` (%) –
 *  an account that was nil before counts as a 100% change. */
export type Movement = { name: string; code: string; now: number; before: number; change: number; pct?: number };
export function movements(d: Src, group: TopGroup, now: string[], before: string[], n: number, amount: number, pct: number): Movement[] {
  const pl = ["income", "cos", "expense", "other"].includes(group);
  if (!pl || !now.length || !before.length) return [];
  const total = (r: Src["pl"][number], ms: string[]) => r2(ms.reduce((a, m) => a + (r.amounts[d.months.indexOf(m)] || 0), 0));
  return d.pl.filter((r) => r.group === group && before.every((m) => d.months.includes(m)))
    .map((r) => { const a = total(r, now), b = total(r, before), change = r2(a - b); return { name: r.name, code: r.code, now: a, before: b, change, pct: b ? r2((change / Math.abs(b)) * 100) : undefined }; })
    .filter((x) => Math.abs(x.change) > amount && (x.pct === undefined ? x.change !== 0 : Math.abs(x.pct) > pct))
    .sort((x, y) => Math.abs(y.change) - Math.abs(x.change) || x.name.localeCompare(y.name))
    .slice(0, Math.max(1, n));
}

/** For a stacked chart by account: the `n` biggest accounts in a group over the chart's periods, each period's amount, and the rest as "Other". */
export function splitSeries(d: Src, group: TopGroup, periods: { months: string[] }[], n = 5): { labels: string[]; series: (number | undefined)[][] } {
  // expenses are the overheads: interest and finance charges are left to finance costs, as in the management profit and loss
  const rows = d.pl.filter((r) => r.group === group && !(group === "expense" && FINANCE_COST.test(r.name)));
  const val = (r: Src["pl"][number], ms: string[]) => (ms.length ? r2(ms.reduce((a, m) => a + (r.amounts[d.months.indexOf(m)] || 0), 0)) : undefined);
  const all = periods.flatMap((p) => p.months);
  const ranked = rows.map((r) => ({ r, t: val(r, all) || 0 })).filter((x) => x.t !== 0).sort((a, b) => b.t - a.t);
  const top = ranked.slice(0, n), rest = ranked.slice(n);
  const labels = top.map((x) => x.r.name), series = top.map((x) => periods.map((p) => val(x.r, p.months)));
  if (rest.length) { labels.push("Other"); series.push(periods.map((p) => (p.months.length ? r2(rest.reduce((a, x) => a + (val(x.r, p.months) || 0), 0)) : undefined))); }
  return { labels, series };
}
