// Tax planning: how an owner-managed company's profit should reach the people who own and run it. For each way of setting the
// directors' salaries it works out the company side (employer NI, Employment Allowance, corporation tax with marginal relief and
// associated companies) and each person's side (income tax on salary and dividends through the personal tax engine, with their
// other income, plus employee NI on the directors' annual earnings basis), with and without Employment Allowance.
// Dividends are shared by shareholding, as the law requires for one class of share. It suggests; it does not decide. The figures are
// planning estimates for the accountant to review, not advice to the client.
import { TaxReturn, compute, emptyReturn } from "./tax";
import { Region, ratesFor } from "./taxRates";

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r2 = (v: number) => Math.round(v * 100) / 100;
const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));

// ------------------------------------------------------------------ company-side rates (tax year ending in April of `year`)

export type CompanyRates = {
  year: number; lel: number; st: number; pt: number; uel: number; eeMain: number; eeUpper: number; er: number; ea: number;
  ct: { small: number; main: number; lower: number; upper: number; fraction: number };
};
const RATES: CompanyRates[] = [
  // 2025-26 and 2026-27: HMRC rates and thresholds for employers; GOV.UK Corporation Tax rates and allowances
  { year: 2026, lel: 6500, st: 5000, pt: 12570, uel: 50270, eeMain: 0.08, eeUpper: 0.02, er: 0.15, ea: 10500, ct: { small: 0.19, main: 0.25, lower: 50000, upper: 250000, fraction: 3 / 200 } },
  { year: 2027, lel: 6708, st: 5000, pt: 12570, uel: 50270, eeMain: 0.08, eeUpper: 0.02, er: 0.15, ea: 10500, ct: { small: 0.19, main: 0.25, lower: 50000, upper: 250000, fraction: 3 / 200 } },
];
export const PLAN_YEARS = RATES.map((r) => r.year);
export const companyRates = (year: number): CompanyRates => RATES.find((r) => r.year === year) || RATES[RATES.length - 1];

/** Corporation tax for a 12-month period, with the limits shared between the company and its associated companies. */
export function corporationTax(profit: number, year: number, associated = 0): number {
  const c = companyRates(year).ct, div = 1 + Math.max(0, Math.floor(associated));
  const lower = c.lower / div, upper = c.upper / div;
  if (profit <= 0) return 0;
  if (profit <= lower) return r2(profit * c.small);
  if (profit >= upper) return r2(profit * c.main);
  return r2(profit * c.main - c.fraction * (upper - profit));
}
/** Employee Class 1 NI on a director's pay for the year (annual earnings period). */
export function employeeNi(pay: number, year: number, overSpa = false): number {
  if (overSpa) return 0;
  const R = companyRates(year);
  return r2(Math.max(0, Math.min(pay, R.uel) - R.pt) * R.eeMain + Math.max(0, pay - R.uel) * R.eeUpper);
}
export const employerNi = (pay: number, year: number): number => { const R = companyRates(year); return r2(Math.max(0, pay - R.st) * R.er); };

// ------------------------------------------------------------------ the plan's inputs

export type Aim = "all" | "basic" | "amount";
export const AIMS: [Aim, string, string][] = [
  ["all", "Take all the profit", "Everything left after corporation tax is paid out as dividends."],
  ["basic", "Stay in the basic rate", "Dividends stop where the first person would start paying higher-rate tax; the rest stays in the company."],
  ["amount", "Take a set amount", "A total amount of dividends you choose; the rest stays in the company."],
];
export type OtherIncome = { nonSavings: number; savings: number; dividends: number; pensionNet: number; children: number };
export type Person = {
  id: string; name: string; clientKey: string; director: boolean; /** can be paid a salary (a director, or employed) */ salaried: boolean;
  sharesPct: number; region: Region; overSpa: boolean; hasContract: boolean; employerPension: number;
  /** "return": use the person's tax return for the year (lines from this company are left out); "typed": the figures below */
  source: "return" | "typed"; other: OtherIncome; customSalary: number;
};
export type PlanInput = {
  year: number; companyName: string; profit: number; reservesBf: number; associated: number;
  /** other employees (not in this plan) paid over the secondary threshold this year */
  staffAboveSt: number; /** employer NI on those other employees for the year */ staffErNi: number;
  /** Employment Allowance is being claimed by a connected company instead */ connectedClaims: boolean;
  aim: Aim; amount: number; people: Person[];
};
export const blankOther = (): OtherIncome => ({ nonSavings: 0, savings: 0, dividends: 0, pensionNet: 0, children: 0 });
export const newPerson = (id: string, o: Partial<Person> = {}): Person => ({
  id, name: "", clientKey: "", director: true, salaried: true, sharesPct: 0, region: "england", overSpa: false, hasContract: false, employerPension: 0,
  source: "typed", other: blankOther(), customSalary: 12570, ...o,
});
export const blankPlan = (year: number, companyName = ""): PlanInput => ({ year, companyName, profit: 0, reservesBf: 0, associated: 0, staffAboveSt: 0, staffErNi: 0, connectedClaims: false, aim: "all", amount: 0, people: [] });

export function readPlan(v: unknown, year: number, companyName = ""): PlanInput {
  let j: any = v;
  if (typeof v === "string") { try { j = JSON.parse(v); } catch { j = null; } }
  if (!j || typeof j !== "object") return blankPlan(year, companyName);
  const b = blankPlan(num(j.year) || year, str(j.companyName) || companyName);
  return {
    ...b, profit: num(j.profit), reservesBf: num(j.reservesBf), associated: Math.max(0, Math.floor(num(j.associated))), staffAboveSt: Math.max(0, Math.floor(num(j.staffAboveSt))), staffErNi: Math.max(0, num(j.staffErNi)),
    connectedClaims: !!j.connectedClaims, aim: (["all", "basic", "amount"] as const).find((a) => a === j.aim) || "all", amount: Math.max(0, num(j.amount)),
    people: Array.isArray(j.people) ? j.people.slice(0, 20).map((p: any, i: number) => newPerson(str(p.id) || `p${i + 1}`, {
      name: str(p.name), clientKey: str(p.clientKey), director: p.director !== false, salaried: p.salaried !== false, sharesPct: Math.max(0, Math.min(100, num(p.sharesPct))),
      region: (["england", "scotland", "wales"] as const).find((x) => x === p.region) || "england", overSpa: !!p.overSpa, hasContract: !!p.hasContract, employerPension: Math.max(0, num(p.employerPension)),
      source: p.source === "return" ? "return" : "typed", customSalary: Math.max(0, num(p.customSalary)),
      other: { nonSavings: Math.max(0, num(p.other?.nonSavings)), savings: Math.max(0, num(p.other?.savings)), dividends: Math.max(0, num(p.other?.dividends)), pensionNet: Math.max(0, num(p.other?.pensionNet)), children: Math.max(0, Math.floor(num(p.other?.children))) },
    })) : [],
  };
}

/** Problems that stop the figures meaning anything. */
export function planProblems(p: PlanInput): string[] {
  const out: string[] = [];
  if (!p.people.length) out.push("Add the directors and shareholders.");
  const pct = p.people.reduce((a, x) => a + x.sharesPct, 0);
  if (pct > 100.0001) out.push(`The shareholdings add up to ${r2(pct)}%, more than 100%.`);
  if (p.people.length && pct <= 0) out.push("Give each shareholder's percentage of the shares.");
  if (p.profit < 0) out.push("Profit can't be negative here. Use 0 for a loss.");
  return out;
}

// ------------------------------------------------------------------ one person's personal tax

/** The person's return without this company's salary and dividends: their other income for the year. */
export function baseReturn(person: Person, saved: TaxReturn | undefined, companyName: string): { r: TaxReturn; removed: string[] } {
  const removed: string[] = [];
  if (person.source === "return" && saved) {
    const match = (s: string) => !!companyName.trim() && s.toLowerCase().includes(companyName.trim().toLowerCase().replace(/\s+(ltd|limited)\.?$/, ""));
    const r: TaxReturn = JSON.parse(JSON.stringify(saved));
    r.employments = r.employments.filter((e) => { const m = match(e.name); if (m) removed.push(`Employment: ${e.name}`); return !m; });
    r.dividends = r.dividends.filter((d) => { const m = match(d.company); if (m) removed.push(`Dividends: ${d.company}`); return !m; });
    r.front = { ...r.front, region: person.region, overSpa: person.overSpa };
    return { r, removed };
  }
  const r = emptyReturn();
  r.front = { region: person.region, overSpa: person.overSpa };
  const o = person.other;
  if (o.nonSavings) r.employments.push({ id: "other", name: "Other income", paye: "", pay: o.nonSavings, tax: 0, benefits: {}, expenses: {} });
  if (o.savings) r.interest.push({ id: "int", payer: "Savings", untaxed: o.savings });
  if (o.dividends) r.dividends.push({ id: "div", company: "Other dividends", amount: o.dividends });
  if (o.pensionNet) r.reliefs.pensionRas = o.pensionNet;
  if (o.children) r.childBenefit = { children: o.children };
  return { r, removed };
}
const personalTax = (r: TaxReturn, year: number) => { const c = compute(r, year); return { tax: c.incomeTax + c.hicbc + c.studentLoan, income: c.income.total, adjustedNet: c.income.adjustedNet, pa: c.personalAllowance, hicbc: c.hicbc }; };
function withCompany(base: TaxReturn, company: string, salary: number, dividends: number): TaxReturn {
  const r: TaxReturn = { ...base, employments: [...base.employments], dividends: [...base.dividends] };
  if (salary > 0) r.employments.push({ id: "plan-salary", name: company || "This company", paye: "", director: true, closeCompany: true, pay: salary, tax: 0, benefits: {}, expenses: {} });
  if (dividends > 0) r.dividends.push({ id: "plan-div", company: company || "This company", amount: dividends });
  return r;
}

// ------------------------------------------------------------------ one option

export type PersonResult = {
  id: string; name: string; salary: number; dividends: number; employerPension: number;
  incomeTax: number; employeeNi: number; employerNi: number; takeHome: number; totalIncome: number; adjustedNet: number; personalAllowance: number; warnings: string[];
};
export type Outcome = {
  salaries: Record<string, number>; people: PersonResult[];
  company: { profit: number; salaries: number; employerNiGross: number; eaUsed: number; employerNi: number; pensions: number; taxable: number; ct: number; afterTax: number; dividends: number; dividendsToOthers: number; retained: number };
  eaClaimed: boolean; takeHome: number; totalTax: number; value: number; warnings: string[];
};
export type Ctx = { bases: Map<string, TaxReturn>; baseTax: Map<string, number> };
export function context(p: PlanInput, saved: (person: Person) => TaxReturn | undefined): Ctx & { removed: Map<string, string[]> } {
  const bases = new Map<string, TaxReturn>(), baseTax = new Map<string, number>(), removed = new Map<string, string[]>();
  for (const x of p.people) { const b = baseReturn(x, saved(x), p.companyName); bases.set(x.id, b.r); removed.set(x.id, b.removed); baseTax.set(x.id, personalTax(b.r, p.year).tax); }
  return { bases, baseTax, removed };
}

/** Employment Allowance can be claimed when at least two people are paid over the secondary threshold (a company whose only such employee is one director can't), and no connected company claims it. */
export function eaEligible(p: PlanInput, salaries: Record<string, number>): boolean {
  if (p.connectedClaims) return false;
  const st = companyRates(p.year).st;
  return p.people.filter((x) => x.salaried && (salaries[x.id] || 0) > st).length + p.staffAboveSt >= 2;
}

function company(p: PlanInput, salaries: Record<string, number>, ea: boolean) {
  const R = companyRates(p.year);
  const paid = p.people.filter((x) => x.salaried);
  const salTotal = paid.reduce((a, x) => a + (salaries[x.id] || 0), 0);
  const erGross = r2(paid.reduce((a, x) => a + employerNi(salaries[x.id] || 0, p.year), 0));
  const eaLeft = ea ? Math.max(0, R.ea - p.staffErNi) : 0;
  const eaUsed = r2(Math.min(eaLeft, erGross));
  const er = r2(erGross - eaUsed);
  const pensions = p.people.reduce((a, x) => a + x.employerPension, 0);
  const taxable = r2(p.profit - salTotal - er - pensions);
  const ct = corporationTax(taxable, p.year, p.associated);
  return { salTotal, erGross, eaUsed, er, pensions, taxable, ct, afterTax: r2(taxable - ct) };
}

function personFigures(p: PlanInput, ctx: Ctx, x: Person, salary: number, dividends: number) {
  const t = personalTax(withCompany(ctx.bases.get(x.id)!, p.companyName, salary, dividends), p.year);
  const incomeTax = r2(t.tax - (ctx.baseTax.get(x.id) || 0));
  const ni = employeeNi(salary, p.year, x.overSpa);
  return { t, incomeTax, ni, takeHome: r2(salary + dividends - incomeTax - ni) };
}

/** The largest total dividend that keeps every person in the plan out of higher-rate tax. */
function basicRateDividend(p: PlanInput, ctx: Ctx, salaries: Record<string, number>, max: number): number {
  const shares = p.people.reduce((a, x) => a + x.sharesPct, 0);
  if (shares <= 0 || max <= 0) return 0;
  const R = ratesFor(p.year);
  const limit = R.personalAllowance + R.uk[0].upTo;
  const ok = (d: number) => p.people.every((x) => !x.sharesPct || personalTax(withCompany(ctx.bases.get(x.id)!, p.companyName, x.salaried ? salaries[x.id] || 0 : 0, d * x.sharesPct / 100), p.year).income <= limit);
  if (ok(max)) return max;
  let lo = 0, hi = max;
  if (!ok(0)) return 0;
  for (let i = 0; i < 22; i++) { const mid = (lo + hi) / 2; if (ok(mid)) lo = mid; else hi = mid; }
  return Math.floor(lo);
}

export function evaluate(p: PlanInput, ctx: Ctx, salariesIn: Record<string, number>, ea: boolean): Outcome {
  const R = companyRates(p.year);
  const salaries: Record<string, number> = {};
  for (const x of p.people) salaries[x.id] = x.salaried ? Math.max(0, Math.round(salariesIn[x.id] || 0)) : 0;
  const co = company(p, salaries, ea);
  const avail = Math.max(0, co.afterTax);
  const inPlanPct = Math.min(100, p.people.reduce((a, x) => a + x.sharesPct, 0));
  let total = p.aim === "all" ? avail : p.aim === "amount" ? Math.min(p.amount, avail + Math.max(0, p.reservesBf)) : basicRateDividend(p, ctx, salaries, avail);
  total = Math.max(0, Math.floor(total));
  const people: PersonResult[] = p.people.map((x) => {
    const salary = salaries[x.id], dividends = r2(total * x.sharesPct / 100);
    const f = personFigures(p, ctx, x, salary, dividends);
    const w: string[] = [];
    if (f.t.adjustedNet > 100000) w.push(f.t.adjustedNet > 125140 ? "Income over £125,140: no personal allowance." : "Income over £100,000: the personal allowance is being reduced.");
    if (f.t.hicbc > 0) w.push(`High Income Child Benefit Charge of £${Math.round(f.t.hicbc).toLocaleString("en-GB")}.`);
    if (x.salaried && x.director && salary < R.lel) w.push(`Salary under £${R.lel.toLocaleString("en-GB")}: this year won't count towards their State Pension through this job.`);
    if (x.salaried && !x.director && salary > 0) w.push("Salary for someone who is not a director needs a real job at a rate the work justifies.");
    if (x.hasContract && salary > 0) w.push("Has an employment contract: check minimum wage against the hours worked.");
    return { id: x.id, name: x.name || "Unnamed", salary, dividends, employerPension: x.employerPension, incomeTax: f.incomeTax, employeeNi: f.ni, employerNi: employerNi(salary, p.year), takeHome: f.takeHome, totalIncome: f.t.income, adjustedNet: f.t.adjustedNet, personalAllowance: f.t.pa, warnings: w };
  });
  const dividendsToOthers = r2(total * (100 - inPlanPct) / 100);
  const retained = r2(co.afterTax - total);
  const takeHome = r2(people.reduce((a, x) => a + x.takeHome, 0));
  const totalTax = r2(co.er + co.ct + people.reduce((a, x) => a + x.incomeTax + x.employeeNi, 0));
  const warnings: string[] = [];
  if (co.taxable < 0) warnings.push("Salaries and employer NI are more than the profit: the company would make a loss.");
  if (total > Math.max(0, co.afterTax) + Math.max(0, p.reservesBf)) warnings.push("Dividends are more than the profits available: check distributable reserves.");
  else if (p.aim === "amount" && total > Math.max(0, co.afterTax)) warnings.push("Part of the dividends comes from profits kept from earlier years. Check the reserves in the latest accounts.");
  if (ea && !eaEligible(p, salaries)) warnings.push("Employment Allowance isn't available on these salaries: fewer than two people are paid over £5,000.");
  if (inPlanPct < 100 && total > 0) warnings.push(`${r2(100 - inPlanPct)}% of the shares are held by people not in this plan; they receive £${Math.round(dividendsToOthers).toLocaleString("en-GB")} of the dividends.`);
  return {
    salaries, people, eaClaimed: ea && co.eaUsed > 0,
    company: { profit: p.profit, salaries: co.salTotal, employerNiGross: co.erGross, eaUsed: co.eaUsed, employerNi: co.er, pensions: co.pensions, taxable: co.taxable, ct: co.ct, afterTax: co.afterTax, dividends: total, dividendsToOthers, retained },
    takeHome, totalTax, value: r2(takeHome + retained), warnings,
  };
}

// ------------------------------------------------------------------ the options

export type OptionKey = "none" | "st" | "lel" | "pa" | "best" | "custom";
export const OPTION_LABEL: Record<OptionKey, string> = { none: "No salary", st: "NI threshold (£5,000)", lel: "Lower earnings limit", pa: "Personal allowance (£12,570)", best: "Best found", custom: "Your own figures" };
export type OptionResult = { key: OptionKey; label: string; salaries: Record<string, number>; eligible: boolean; withEa: Outcome; withoutEa: Outcome; likely: Outcome };

const fixed = (p: PlanInput, amount: number): Record<string, number> => Object.fromEntries(p.people.map((x) => [x.id, x.salaried ? amount : 0]));
/** Salary steps tried for each person when looking for the best. */
export function candidates(year: number): number[] {
  const R = companyRates(year);
  const out = new Set<number>([0, R.st, R.lel, R.pt]);
  for (let s = 15000; s <= 50000; s += 2500) out.add(s);
  for (let s = 55000; s <= 125000; s += 5000) out.add(s);
  out.add(R.uel); out.add(100000);
  return [...out].sort((a, b) => a - b);
}
/** The salaries that leave the most for the people and the company together, searched with everyone on the same salary, then one person at a time. */
export function bestSalaries(p: PlanInput, ctx: Ctx, mode: "ea" | "noea" | "likely"): Record<string, number> {
  const steps = candidates(p.year);
  const score = (s: Record<string, number>) => evaluate(p, ctx, s, mode === "ea" ? true : mode === "noea" ? false : eaEligible(p, s)).value;
  let cur = fixed(p, companyRates(p.year).pt), best = score(cur);
  // everyone on the same salary first, then each person in turn
  for (const s of steps) { const next = fixed(p, s), v = score(next); if (v > best + 0.005) { best = v; cur = next; } }
  for (let round = 0; round < 4; round++) {
    let moved = false;
    for (const x of p.people.filter((y) => y.salaried)) {
      for (const s of steps) {
        if (s === cur[x.id]) continue;
        const next = { ...cur, [x.id]: s }, v = score(next);
        if (v > best + 0.005) { best = v; cur = next; moved = true; }
      }
    }
    if (!moved) break;
  }
  return cur;
}

export function assess(p: PlanInput, ctx: Ctx): OptionResult[] {
  const R = companyRates(p.year);
  const sets: [OptionKey, Record<string, number>][] = [
    ["none", fixed(p, 0)], ["st", fixed(p, R.st)], ["lel", fixed(p, R.lel)], ["pa", fixed(p, R.pt)],
    ["best", bestSalaries(p, ctx, "likely")],
    ["custom", Object.fromEntries(p.people.map((x) => [x.id, x.salaried ? x.customSalary : 0]))],
  ];
  return sets.map(([key, salaries]) => {
    const withEa = evaluate(p, ctx, salaries, true), withoutEa = evaluate(p, ctx, salaries, false), eligible = eaEligible(p, salaries);
    return { key, label: key === "lel" ? `Lower earnings limit (£${R.lel.toLocaleString("en-GB")})` : OPTION_LABEL[key], salaries, eligible, withEa, withoutEa, likely: eligible ? withEa : withoutEa };
  });
}
/** The option that leaves the most in total on the likely Employment Allowance position. */
export const recommended = (opts: OptionResult[]): OptionResult | undefined => [...opts].filter((o) => o.key !== "custom").sort((a, b) => b.likely.value - a.likely.value)[0];

/** People and shareholdings to start from: active directors from the officers register, holdings from the share ledger. */
export function startingPeople(directors: { name: string; clientKey: string }[], holdings: { name: string; key: string; number: number }[], newId: () => string): Person[] {
  const totalShares = holdings.reduce((a, h) => a + h.number, 0);
  const people: Person[] = [];
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  for (const d of directors) people.push(newPerson(newId(), { name: d.name, clientKey: d.clientKey, source: d.clientKey ? "return" : "typed" }));
  for (const h of holdings) {
    const pct = totalShares ? r2(h.number / totalShares * 100) : 0;
    const hit = people.find((x) => (h.key && x.clientKey === h.key) || norm(x.name) === norm(h.name));
    if (hit) hit.sharesPct = r2(hit.sharesPct + pct);
    else people.push(newPerson(newId(), { name: h.name, clientKey: h.key, director: false, salaried: false, sharesPct: pct, customSalary: 0, source: h.key ? "return" : "typed" }));
  }
  return people;
}
