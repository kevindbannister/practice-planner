// Advisory: the Freedom Plan, from Kevin's Advisory Hub workbook.
//
// Four steps, all worked out here and saved per client as one JSON plan:
//  1. Freedom Number: what the client's life costs (day to day, plus long-term plans such as paying
//     off a mortgage early), grossed up for personal tax and then for business tax, for five years.
//  2. Where you are now: what the business delivers (existing recurring income and up to five
//     products or services, recurring or one-off).
//  3. Levers: the same products with new numbers of sales, prices and variable costs, so you can
//     see how far changes move the profit.
//  4. Freedom Gap: the Freedom Number against what the business delivers now and with the levers.
//
// Where this differs from the workbook (and why):
//  - A recurring product's first year is built up month by month: each month's new sales keep paying,
//    so 10 new sales a month give 10 x (1+2+...+12) = 780 customer-months. The workbook calls that
//    "x78". Here it is a simulation, so later years carry everyone who has joined before (the
//    workbook added the same amount again each year), and a monthly churn can be set (default 0).
//  - The levers total counts every product, changed or not (the workbook's total counted only
//    the change for some products).
//  - Long-term plans add up all ten rows (the workbook's total stopped at five); housing rows
//    use their own monthly figures.
//  - Tax rates are entered as percentages (20% where the workbook had 0.8).

export const YEARS = 5;
export const PRODUCTS = 5;
export const LONG_ROWS = 10;
const SIM_MONTHS = YEARS * 12;

export type Item = { key: string; label: string; other?: boolean };
export type Group = { key: string; title: string; items: Item[] };

const items = (g: string, labels: string[], others: number): Item[] => [
  ...labels.map((label, i) => ({ key: `${g}.${i + 1}`, label })),
  ...Array.from({ length: others }, (_, i) => ({ key: `${g}.o${i + 1}`, label: `Other ${i + 1}`, other: true })),
];

/** The day-to-day living costs (the workbook's first sheet), in UK wording. */
export const LIVING: Group[] = [
  { key: "housing", title: "Housing", items: items("housing", ["Mortgage or rent", "Utilities (gas, electric, water)", "Home insurance", "Council tax", "Maintenance and repairs"], 2) },
  { key: "daily", title: "Daily living", items: items("daily", ["Groceries", "Dining out", "Internet and phone", "Streaming services"], 3) },
  { key: "transport", title: "Transport", items: items("transport", ["Car payments", "Fuel", "Car insurance", "Public transport"], 3) },
  { key: "health", title: "Health", items: items("health", ["Health insurance", "Out-of-pocket medical costs", "Fitness and wellbeing"], 4) },
  { key: "leisure", title: "Personal and leisure", items: items("leisure", ["Clothing", "Holidays", "Hobbies", "Gifts and donations"], 3) },
  { key: "occasions", title: "Special occasions and pets", items: items("occasions", ["Birthdays", "Pet food and supplies", "Vet and pet insurance"], 4) },
  { key: "education", title: "Education and development", items: items("education", ["Courses and workshops", "Books and materials"], 5) },
  { key: "misc", title: "Miscellaneous", items: items("misc", ["Emergency fund", "Savings and investments"], 5) },
];
export const LIVING_ITEMS: Item[] = LIVING.flatMap((g) => g.items);

export type Product = { name: string; kind: "recurring" | "oneoff"; sales: number; price: number; variable: number };
export type Lever = { sales: number; price: number; variable: number };
export type Range = { min: number; max: number; step: number };
export type LeverRanges = { sales: Range; price: Range; variable: Range };
export type LongTerm = { label: string; amount: number; years: number };

export type Plan = {
  v: 1;
  /** The client's reason, in their own words. */
  why: string;
  /** Monthly cost by living item key. */
  living: Record<string, number>;
  /** Names the client gave "Other" rows. */
  names: Record<string, string>;
  long: LongTerm[];
  /** Effective rates, in percent. */
  personalTax: number;
  businessTax: number;
  /** Cost of living rises by this much each year after the first (percent). */
  inflation: number;
  /** Percent of recurring customers lost each month. */
  churn: number;
  /** Existing recurring income, per month. */
  base: { revenue: number; costs: number };
  products: Product[];
  levers: Lever[];
  ranges: LeverRanges[];
};

export const DEFAULT_RANGES: LeverRanges = { sales: { min: 0, max: 50, step: 1 }, price: { min: 0, max: 10000, step: 100 }, variable: { min: 0, max: 5000, step: 100 } };

const LONG_LABELS = ["Repay the mortgage early", "Pay off debt", "Build an emergency fund", "Wedding fund"];

export function emptyPlan(): Plan {
  return {
    v: 1,
    why: "",
    living: {},
    names: {},
    long: Array.from({ length: LONG_ROWS }, (_, i) => ({ label: LONG_LABELS[i] || "Other plan", amount: 0, years: 1 })),
    personalTax: 20,
    businessTax: 25,
    inflation: 0,
    churn: 0,
    base: { revenue: 0, costs: 0 },
    products: Array.from({ length: PRODUCTS }, (_, i) => ({ name: `Product / Service ${i + 1}`, kind: i < 3 ? "recurring" : "oneoff", sales: 0, price: 0, variable: 0 })),
    levers: Array.from({ length: PRODUCTS }, () => ({ sales: 0, price: 0, variable: 0 })),
    ranges: Array.from({ length: PRODUCTS }, () => ({ sales: { ...DEFAULT_RANGES.sales }, price: { ...DEFAULT_RANGES.price }, variable: { ...DEFAULT_RANGES.variable } })),
  };
}

const num = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER, fallback = 0): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Reads a saved plan (JSON text or an object) and fills anything missing or wrong with sensible values. */
export function readPlan(raw: unknown): Plan {
  let o: Record<string, unknown> = {};
  if (typeof raw === "string") {
    try { o = rec(JSON.parse(raw)); } catch { o = {}; }
  } else o = rec(raw);
  const d = emptyPlan();
  const living: Record<string, number> = {};
  for (const [k, v] of Object.entries(rec(o.living))) if (LIVING_ITEMS.some((i) => i.key === k)) living[k] = num(v);
  const names: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec(o.names))) if (LIVING_ITEMS.some((i) => i.key === k && i.other) && str(v)) names[k] = str(v);
  const longIn = Array.isArray(o.long) ? o.long : [];
  const prodIn = Array.isArray(o.products) ? o.products : [];
  const levIn = Array.isArray(o.levers) ? o.levers : [];
  const rngIn = Array.isArray(o.ranges) ? o.ranges : [];
  const range = (v: unknown, base: Range): Range => {
    const r = rec(v);
    const min = num(r.min, 0, 1e9, base.min);
    const max = Math.max(min + 1, num(r.max, 0, 1e9, base.max));
    return { min, max, step: num(r.step, 0.01, max - min, base.step) };
  };
  const products: Product[] = d.products.map((p, i) => {
    const x = rec(prodIn[i]);
    return { name: str(x.name, p.name) || p.name, kind: x.kind === "oneoff" ? "oneoff" : x.kind === "recurring" ? "recurring" : p.kind, sales: num(x.sales), price: num(x.price), variable: num(x.variable) };
  });
  // levers start at today's numbers when they have never been set
  const levers: Lever[] = products.map((p, i) => {
    const x = rec(levIn[i]);
    return { sales: num(x.sales, 0, 1e9, p.sales), price: num(x.price, 0, 1e9, p.price), variable: num(x.variable, 0, 1e9, p.variable) };
  });
  return {
    v: 1,
    why: str(o.why),
    living,
    names,
    long: d.long.map((l, i) => {
      const x = rec(longIn[i]);
      return { label: str(x.label, l.label) || l.label, amount: num(x.amount), years: Math.max(1, Math.round(num(x.years, 1, 60, 1))) };
    }),
    personalTax: num(o.personalTax, 0, 90, d.personalTax),
    businessTax: num(o.businessTax, 0, 90, d.businessTax),
    inflation: num(o.inflation, 0, 50, 0),
    churn: num(o.churn, 0, 100, 0),
    base: { revenue: num(rec(o.base).revenue), costs: num(rec(o.base).costs) },
    products,
    levers,
    ranges: d.ranges.map((r, i) => {
      const x = rec(rngIn[i]);
      return { sales: range(x.sales, r.sales), price: range(x.price, r.price), variable: range(x.variable, r.variable) };
    }),
  };
}

export const writePlan = (p: Plan): string => JSON.stringify(p);

export const r2 = (n: number) => Math.round(n * 100) / 100;
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

// ---- 1. the Freedom Number ----

export const livingMonthly = (p: Plan): number => sum(LIVING_ITEMS.map((i) => p.living[i.key] || 0));
export const livingYearly = (p: Plan): number => livingMonthly(p) * 12;
export const groupMonthly = (p: Plan, g: Group): number => sum(g.items.map((i) => p.living[i.key] || 0));

/** Each long-term plan is spread evenly over its years. Years beyond the fifth are summed in `later`. */
export function longTerm(p: Plan): { rows: number[][]; years: number[]; later: number; total: number } {
  const rows = p.long.map((l) => {
    const years = Math.max(1, Math.round(l.years));
    const each = l.amount > 0 ? l.amount / years : 0;
    return Array.from({ length: YEARS }, (_, n) => (n + 1 <= years ? each : 0));
  });
  const later = sum(p.long.map((l) => {
    const years = Math.max(1, Math.round(l.years));
    return l.amount > 0 && years > YEARS ? l.amount - (YEARS * l.amount) / years : 0;
  }));
  const years = Array.from({ length: YEARS }, (_, n) => sum(rows.map((r) => r[n])));
  return { rows, years, later, total: sum(p.long.map((l) => Math.max(0, l.amount))) };
}

export type Need = { spend: number; personalTax: number; personal: number; businessTax: number; business: number };

/** Spending grossed up for personal tax (what the client must draw) and then business tax (what the business must earn before tax). */
export function grossUp(spend: number, personalTax: number, businessTax: number): Need {
  const personal = spend / (1 - personalTax / 100);
  const business = personal / (1 - businessTax / 100);
  return { spend, personalTax: personal - spend, personal, businessTax: business - personal, business };
}

export function freedomNumber(p: Plan): { years: Need[]; later: Need; total: Need } {
  const lt = longTerm(p);
  const years = Array.from({ length: YEARS }, (_, n) => grossUp(livingYearly(p) * Math.pow(1 + p.inflation / 100, n) + lt.years[n], p.personalTax, p.businessTax));
  const later = grossUp(lt.later, p.personalTax, p.businessTax);
  const all = [...years, later];
  const total: Need = { spend: sum(all.map((y) => y.spend)), personalTax: sum(all.map((y) => y.personalTax)), personal: sum(all.map((y) => y.personal)), businessTax: sum(all.map((y) => y.businessTax)), business: sum(all.map((y) => y.business)) };
  return { years, later, total };
}

// ---- 2 and 3. what the business delivers ----

export type Position = { base: number; products: { name: string; kind: Product["kind"]; years: number[] }[]; years: number[]; total: number };

/**
 * Profit by year for the products with the given numbers. A recurring product's customers build up
 * month by month (less churn); a one-off product sells the same each month.
 */
export function position(p: Plan, values: Lever[]): Position {
  const churn = p.churn / 100;
  const base = (p.base.revenue - p.base.costs) * 12;
  const products = p.products.map((prod, i) => {
    const v = values[i] || { sales: 0, price: 0, variable: 0 };
    const each = v.price - v.variable;
    const years = Array.from({ length: YEARS }, () => 0);
    let customers = 0;
    for (let m = 0; m < SIM_MONTHS; m++) {
      customers = prod.kind === "recurring" ? customers * (1 - churn) + v.sales : v.sales;
      years[Math.floor(m / 12)] += customers * each;
    }
    return { name: prod.name, kind: prod.kind, years };
  });
  const years = Array.from({ length: YEARS }, (_, n) => base + sum(products.map((x) => x.years[n])));
  return { base, products, years, total: sum(years) };
}

export const positionNow = (p: Plan): Position => position(p, p.products);
export const positionLevers = (p: Plan): Position => position(p, p.levers);

/** How far a lever is from today's number. */
export function change(current: number, now: number): { add: number; pct?: number } {
  return { add: now - current, pct: current ? (now - current) / current : undefined };
}

export const clampTo = (value: number, r: Range): number => {
  const stepped = r.step > 0 ? r.min + Math.round((value - r.min) / r.step) * r.step : value;
  return Math.min(r.max, Math.max(r.min, Math.round(stepped * 100) / 100));
};

// ---- 4. the Freedom Gap ----

export type GapYear = { need: number; now: number; levers: number; shortNow: number; shortLevers: number; metNow?: number; metLevers?: number };

/** Shortfall is the need less what is delivered; a negative shortfall is an excess. */
export function gap(p: Plan): { years: GapYear[]; later: number; total: GapYear; need: ReturnType<typeof freedomNumber>; now: Position; levers: Position } {
  const need = freedomNumber(p);
  const now = positionNow(p);
  const levers = positionLevers(p);
  const row = (n: number, a: number, b: number): GapYear => ({ need: n, now: a, levers: b, shortNow: n - a, shortLevers: n - b, metNow: n > 0 ? a / n : undefined, metLevers: n > 0 ? b / n : undefined });
  const years = need.years.map((y, i) => row(y.business, now.years[i], levers.years[i]));
  const needTotal = sum(years.map((y) => y.need));
  return { years, later: need.later.business, total: row(needTotal, now.total, levers.total), need, now, levers };
}
