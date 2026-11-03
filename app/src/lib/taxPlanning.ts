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

export type Aim = "all" | "basic" | "amount" | "target";
export const AIMS: [Aim, string, string][] = [
  ["all", "Take all the profit", "Everything left after corporation tax is paid out as dividends."],
  ["basic", "Stay in the basic rate", "Dividends stop where the first person would start paying higher-rate tax; the rest stays in the company."],
  ["amount", "Take a set amount", "A total amount of dividends you choose; the rest stays in the company."],
  ["target", "Take home a set amount each", "Each person says how much cash they want after tax; dividends are worked out to give it (a credit on their loan account is used first, tax-free)."],
];
export const S455_RATE = 0.3575; // loans to participators made from 6 April 2026
export const BIK_LOAN_LIMIT = 10000; // a director's loan over this is a taxable benefit at the official rate
export const DEFAULT_OFFICIAL_RATE = 3.75; // per cent; HMRC reviews it each quarter
export type OtherIncome = { nonSavings: number; savings: number; dividends: number; pensionNet: number; children: number };
export type Person = {
  id: string; name: string; clientKey: string; director: boolean; /** can be paid a salary (a director, or employed) */ salaried: boolean;
  sharesPct: number; region: Region; overSpa: boolean; hasContract: boolean; employerPension: number;
  /** "return": use the person's tax return for the year (lines from this company are left out); "typed": the figures below */
  source: "return" | "typed"; other: OtherIncome; customSalary: number;
  /** the class of share they hold; with different classes ("alphabet shares") each class can be paid a different dividend */
  shareClass: string;
  /** cash wanted from the company for the year after tax (aim "target") */ targetTakeHome: number;
  /** cash equivalent of benefits in kind from the company (car, medical and so on) */ bik: number;
  /** director's loan account at the year end: positive = the company owes them, negative = they owe the company (overdrawn) */ loanBalance: number;
  marriage: "none" | "transfer" | "receive";
};
export type PlanInput = {
  year: number; companyName: string; profit: number; reservesBf: number; associated: number;
  /** other employees (not in this plan) paid over the secondary threshold this year */
  staffAboveSt: number; /** employer NI on those other employees for the year */ staffErNi: number;
  /** Employment Allowance is being claimed by a connected company instead */ connectedClaims: boolean;
  aim: Aim; amount: number; people: Person[];
  /** "same": one dividend rate on every share; "classes": each share class can be paid differently (alphabet shares) */
  dividendSplit: "same" | "classes";
  /** HMRC's official rate of interest, per cent, for loan benefits */ officialRate: number;
};
export const blankOther = (): OtherIncome => ({ nonSavings: 0, savings: 0, dividends: 0, pensionNet: 0, children: 0 });
export const newPerson = (id: string, o: Partial<Person> = {}): Person => ({
  id, name: "", clientKey: "", director: true, salaried: true, sharesPct: 0, region: "england", overSpa: false, hasContract: false, employerPension: 0,
  source: "typed", other: blankOther(), customSalary: 12570, shareClass: "Ordinary", targetTakeHome: 0, bik: 0, loanBalance: 0, marriage: "none", ...o,
});
export const blankPlan = (year: number, companyName = ""): PlanInput => ({ year, companyName, profit: 0, reservesBf: 0, associated: 0, staffAboveSt: 0, staffErNi: 0, connectedClaims: false, aim: "all", amount: 0, people: [], dividendSplit: "same", officialRate: DEFAULT_OFFICIAL_RATE });

export function readPlan(v: unknown, year: number, companyName = ""): PlanInput {
  let j: any = v;
  if (typeof v === "string") { try { j = JSON.parse(v); } catch { j = null; } }
  if (!j || typeof j !== "object") return blankPlan(year, companyName);
  const b = blankPlan(num(j.year) || year, str(j.companyName) || companyName);
  return {
    ...b, profit: num(j.profit), reservesBf: num(j.reservesBf), associated: Math.max(0, Math.floor(num(j.associated))), staffAboveSt: Math.max(0, Math.floor(num(j.staffAboveSt))), staffErNi: Math.max(0, num(j.staffErNi)),
    connectedClaims: !!j.connectedClaims, aim: (["all", "basic", "amount", "target"] as const).find((a) => a === j.aim) || "all", dividendSplit: j.dividendSplit === "classes" ? "classes" : "same", officialRate: num(j.officialRate) > 0 && num(j.officialRate) < 20 ? num(j.officialRate) : DEFAULT_OFFICIAL_RATE, amount: Math.max(0, num(j.amount)),
    people: Array.isArray(j.people) ? j.people.slice(0, 20).map((p: any, i: number) => newPerson(str(p.id) || `p${i + 1}`, {
      name: str(p.name), clientKey: str(p.clientKey), director: p.director !== false, salaried: p.salaried !== false, sharesPct: Math.max(0, Math.min(100, num(p.sharesPct))),
      region: (["england", "scotland", "wales"] as const).find((x) => x === p.region) || "england", overSpa: !!p.overSpa, hasContract: !!p.hasContract, employerPension: Math.max(0, num(p.employerPension)),
      source: p.source === "return" ? "return" : "typed", customSalary: Math.max(0, num(p.customSalary)),
      shareClass: str(p.shareClass) || "Ordinary", targetTakeHome: Math.max(0, num(p.targetTakeHome)), bik: Math.max(0, num(p.bik)), loanBalance: num(p.loanBalance),
      marriage: p.marriage === "transfer" || p.marriage === "receive" ? p.marriage : "none",
      other: { nonSavings: Math.max(0, num(p.other?.nonSavings)), savings: Math.max(0, num(p.other?.savings)), dividends: Math.max(0, num(p.other?.dividends)), pensionNet: Math.max(0, num(p.other?.pensionNet)), children: Math.max(0, Math.floor(num(p.other?.children))) },
    })) : [],
  };
}

/** Problems that stop the figures meaning anything. */
export function planProblems(p: PlanInput): string[] {
  const out: string[] = [];
  if (!p.people.length) out.push("Add the directors and shareholders.");
  const pct = p.people.reduce((a, x) => a + x.sharesPct, 0);
  if (p.dividendSplit !== "classes" && pct > 100.0001) out.push(`The shareholdings add up to ${r2(pct)}%, more than 100%.`);
  if (p.people.length && pct <= 0) out.push("Give each shareholder's percentage of the shares.");
  if (p.profit < 0) out.push("Profit can't be negative here. Use 0 for a loss.");
  if (p.dividendSplit === "classes") {
    const byClass = new Map<string, number>();
    for (const x of p.people) byClass.set(x.shareClass, (byClass.get(x.shareClass) || 0) + x.sharesPct);
    for (const [c, v] of byClass) if (v > 100.0001) out.push(`The ${c} shares add up to ${r2(v)}%, more than 100%.`);
  }
  if (p.aim === "target" && !p.people.some((x) => x.targetTakeHome > 0)) out.push("Give the take-home each person wants.");
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
    if (person.marriage !== "none") r.allowances = { ...r.allowances, marriage: person.marriage };
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
  if (person.marriage !== "none") r.allowances = { ...r.allowances, marriage: person.marriage };
  return { r, removed };
}
const personalTax = (r: TaxReturn, year: number) => { const c = compute(r, year); return { tax: c.incomeTax + c.hicbc + c.studentLoan, income: c.income.total, adjustedNet: c.income.adjustedNet, pa: c.personalAllowance, hicbc: c.hicbc }; };
function withCompany(base: TaxReturn, company: string, salary: number, dividends: number, bik = 0): TaxReturn {
  const r: TaxReturn = { ...base, employments: [...base.employments], dividends: [...base.dividends] };
  if (salary > 0 || bik > 0) r.employments.push({ id: "plan-salary", name: company || "This company", paye: "", director: true, closeCompany: true, pay: salary, tax: 0, benefits: bik > 0 ? { other: bik } : {}, expenses: {} });
  if (dividends > 0) r.dividends.push({ id: "plan-div", company: company || "This company", amount: dividends });
  return r;
}

// ------------------------------------------------------------------ one option

export type PersonResult = {
  id: string; name: string; salary: number; dividends: number; employerPension: number; bik: number; loanCash: number; target: number;
  incomeTax: number; employeeNi: number; employerNi: number; takeHome: number; totalIncome: number; adjustedNet: number; personalAllowance: number; warnings: string[];
};
export type Outcome = {
  salaries: Record<string, number>; people: PersonResult[];
  company: { profit: number; salaries: number; employerNiGross: number; eaUsed: number; employerNi: number; pensions: number; class1A: number; taxable: number; ct: number; afterTax: number; dividends: number; dividendsToOthers: number; retained: number; s455: number; loansRepaid: number };
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
/** Benefits in kind for a person: their own benefits plus an overdrawn loan over £10,000 at the official rate. */
export const bikOf = (p: PlanInput, x: Person) => r2(x.bik + (-x.loanBalance > BIK_LOAN_LIMIT ? -x.loanBalance * p.officialRate / 100 : 0));

function company(p: PlanInput, salaries: Record<string, number>, ea: boolean) {
  const R = companyRates(p.year);
  const paid = p.people.filter((x) => x.salaried);
  const salTotal = paid.reduce((a, x) => a + (salaries[x.id] || 0), 0);
  const erGross = r2(paid.reduce((a, x) => a + employerNi(salaries[x.id] || 0, p.year), 0));
  const eaLeft = ea ? Math.max(0, R.ea - p.staffErNi) : 0;
  const eaUsed = r2(Math.min(eaLeft, erGross));
  const er = r2(erGross - eaUsed);
  const pensions = p.people.reduce((a, x) => a + x.employerPension, 0);
  const class1A = r2(p.people.reduce((a, x) => a + bikOf(p, x), 0) * R.er);
  const taxable = r2(p.profit - salTotal - er - pensions - class1A);
  const ct = corporationTax(taxable, p.year, p.associated);
  return { salTotal, erGross, eaUsed, er, pensions, class1A, taxable, ct, afterTax: r2(taxable - ct) };
}

function personFigures(p: PlanInput, ctx: Ctx, x: Person, salary: number, dividends: number) {
  const t = personalTax(withCompany(ctx.bases.get(x.id)!, p.companyName, salary, dividends, bikOf(p, x)), p.year);
  const incomeTax = r2(t.tax - (ctx.baseTax.get(x.id) || 0));
  const ni = employeeNi(salary, p.year, x.overSpa);
  return { t, incomeTax, ni, takeHome: r2(salary + dividends - incomeTax - ni) };
}
const incomeWith = (p: PlanInput, ctx: Ctx, x: Person, salary: number, d: number) => personalTax(withCompany(ctx.bases.get(x.id)!, p.companyName, salary, d, bikOf(p, x)), p.year).income;
/** The largest dividend that keeps a person's income under a limit (their basic rate band, or £100,000). */
function fillTo(p: PlanInput, ctx: Ctx, x: Person, salary: number, limit: number, max: number): number {
  if (max <= 0 || incomeWith(p, ctx, x, salary, 0) >= limit) return 0;
  if (incomeWith(p, ctx, x, salary, max) <= limit) return max;
  let lo = 0, hi = max;
  for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (incomeWith(p, ctx, x, salary, mid) <= limit) lo = mid; else hi = mid; }
  return Math.floor(lo);
}
/** The dividend a person needs for their cash target, after their salary and any loan repaid to them. */
function forTarget(p: PlanInput, ctx: Ctx, x: Person, salary: number, loanCash: number): number {
  const need = (d: number) => personFigures(p, ctx, x, salary, d).takeHome + loanCash;
  if (x.targetTakeHome <= 0 || need(0) >= x.targetTakeHome) return 0;
  let lo = 0, hi = Math.max(1000, x.targetTakeHome * 3);
  while (need(hi) < x.targetTakeHome && hi < 1e8) hi *= 2;
  for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (need(mid) >= x.targetTakeHome) hi = mid; else lo = mid; }
  return Math.ceil(hi);
}

/** How the dividends fall to each person. One class: by shareholding. Different classes: each person's lower bands are filled first. */
function allocate(p: PlanInput, ctx: Ctx, salaries: Record<string, number>, avail: number, loanCash: Record<string, number>): { each: Record<string, number>; total: number; others: number } {
  const R = ratesFor(p.year);
  const basicLimit = R.personalAllowance + R.uk[0].upTo;
  const holders = p.people.filter((x) => x.sharesPct > 0);
  const sal = (x: Person) => (x.salaried ? salaries[x.id] || 0 : 0);
  const each: Record<string, number> = Object.fromEntries(p.people.map((x) => [x.id, 0]));
  const pool = p.aim === "amount" ? Math.min(p.amount, avail + Math.max(0, p.reservesBf)) : avail;
  if (p.dividendSplit !== "classes") {
    const inPlan = Math.min(100, holders.reduce((a, x) => a + x.sharesPct, 0));
    let total: number;
    if (p.aim === "basic") {
      // the largest total that keeps everyone in the plan out of higher-rate tax
      const ok = (t: number) => holders.every((x) => incomeWith(p, ctx, x, sal(x), t * x.sharesPct / 100) <= basicLimit);
      if (ok(avail)) total = avail; else if (!ok(0)) total = 0; else { let lo = 0, hi = avail; for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (ok(m)) lo = m; else hi = m; } total = Math.floor(lo); }
    } else if (p.aim === "target") total = holders.reduce((a, x) => Math.max(a, forTarget(p, ctx, x, sal(x), loanCash[x.id] || 0) / (x.sharesPct / 100)), 0);
    else total = pool;
    total = Math.max(0, Math.floor(total));
    for (const x of holders) each[x.id] = r2(total * x.sharesPct / 100);
    return { each, total, others: r2(total * (100 - inPlan) / 100) };
  }
  // different classes: each person is paid through their own class
  if (p.aim === "target") { for (const x of holders) each[x.id] = forTarget(p, ctx, x, sal(x), loanCash[x.id] || 0); }
  else if (p.aim === "basic") { let left = avail; for (const x of holders) { const d = fillTo(p, ctx, x, sal(x), basicLimit, left); each[x.id] = d; left -= d; } }
  else {
    // fill everyone's basic rate band, then up to £100,000, then share what is left by shareholding
    let left = Math.max(0, pool);
    for (const limit of [basicLimit, R.taperFrom]) {
      const want = holders.map((x) => ({ x, d: Math.max(0, fillTo(p, ctx, x, sal(x), limit, left + each[x.id]) - each[x.id]) }));
      const sum = want.reduce((a, w) => a + w.d, 0);
      const scale = sum > left ? left / sum : 1;
      for (const w of want) { const d = Math.floor(w.d * scale); each[w.x.id] += d; left -= d; }
      if (left <= 0) break;
    }
    if (left > 0) { const w = holders.reduce((a, x) => a + x.sharesPct, 0) || 1; for (const x of holders) each[x.id] += Math.floor(left * x.sharesPct / w); }
  }
  const total = Math.floor(Object.values(each).reduce((a, v) => a + v, 0));
  return { each, total, others: 0 };
}

export function evaluate(p: PlanInput, ctx: Ctx, salariesIn: Record<string, number>, ea: boolean): Outcome {
  const R = companyRates(p.year);
  const salaries: Record<string, number> = {};
  for (const x of p.people) salaries[x.id] = x.salaried ? Math.max(0, Math.round(salariesIn[x.id] || 0)) : 0;
  const co = company(p, salaries, ea);
  const avail = Math.max(0, co.afterTax);
  // a credit on the loan account is paid back first when people want a set amount of cash: it is tax-free
  const loanCash: Record<string, number> = {};
  for (const x of p.people) {
    if (p.aim !== "target" || x.loanBalance <= 0 || x.targetTakeHome <= 0) { loanCash[x.id] = 0; continue; }
    const salaryNet = personFigures(p, ctx, x, salaries[x.id], 0).takeHome;
    loanCash[x.id] = r2(Math.min(x.loanBalance, Math.max(0, x.targetTakeHome - salaryNet)));
  }
  const div = allocate(p, ctx, salaries, avail, loanCash);
  const people: PersonResult[] = p.people.map((x) => {
    const salary = salaries[x.id], dividends = div.each[x.id] || 0;
    const f = personFigures(p, ctx, x, salary, dividends);
    const w: string[] = [];
    if (f.t.adjustedNet > 100000) w.push(f.t.adjustedNet > 125140 ? "Income over £125,140: no personal allowance." : "Income over £100,000: the personal allowance is being reduced.");
    if (f.t.hicbc > 0) w.push(`High Income Child Benefit Charge of £${Math.round(f.t.hicbc).toLocaleString("en-GB")}.`);
    if (x.salaried && x.director && salary < R.lel) w.push(`Salary under £${R.lel.toLocaleString("en-GB")}: this year won't count towards their State Pension through this job.`);
    if (x.salaried && !x.director && salary > 0) w.push("Salary for someone who is not a director needs a real job at a rate the work justifies.");
    if (x.hasContract && salary > 0) w.push("Has an employment contract: check minimum wage against the hours worked.");
    if (-x.loanBalance > 0) w.push(`Overdrawn loan account of £${Math.round(-x.loanBalance).toLocaleString("en-GB")}: s455 tax of £${Math.round(-x.loanBalance * S455_RATE).toLocaleString("en-GB")} unless repaid within 9 months of the year end${-x.loanBalance > BIK_LOAN_LIMIT ? "; over £10,000 it is also a taxable benefit" : ""}.`);
    if (x.employerPension > 60000) w.push("Employer pension over £60,000: check the annual allowance and any carry forward.");
    if (x.marriage === "transfer" && f.t.income > ratesFor(p.year).personalAllowance) w.push("Marriage Allowance can only be transferred by someone whose income is under the personal allowance.");
    const takeHome = r2(f.takeHome + loanCash[x.id]);
    if (p.aim === "target" && x.targetTakeHome > 0 && takeHome + 1 < x.targetTakeHome) w.push(`Short of the £${Math.round(x.targetTakeHome).toLocaleString("en-GB")} wanted.`);
    return { id: x.id, name: x.name || "Unnamed", salary, dividends, employerPension: x.employerPension, bik: bikOf(p, x), loanCash: loanCash[x.id], target: x.targetTakeHome, incomeTax: f.incomeTax, employeeNi: f.ni, employerNi: employerNi(salary, p.year), takeHome, totalIncome: f.t.income, adjustedNet: f.t.adjustedNet, personalAllowance: f.t.pa, warnings: w };
  });
  const total = div.total; // includes any paid to holders outside the plan
  const retained = r2(co.afterTax - total);
  const takeHome = r2(people.reduce((a, x) => a + x.takeHome, 0));
  const loansRepaid = r2(people.reduce((a, x) => a + x.loanCash, 0));
  const s455 = r2(p.people.reduce((a, x) => a + Math.max(0, -x.loanBalance), 0) * S455_RATE);
  const totalTax = r2(co.er + co.class1A + co.ct + people.reduce((a, x) => a + x.incomeTax + x.employeeNi, 0));
  const warnings: string[] = [];
  if (co.taxable < 0) warnings.push("Salaries and employer costs are more than the profit: the company would make a loss.");
  if (total > Math.max(0, co.afterTax) + Math.max(0, p.reservesBf)) warnings.push(p.aim === "target" ? "Not enough profit to pay these amounts: the dividends needed are more than the profits available." : "Dividends are more than the profits available: check distributable reserves.");
  else if (total > Math.max(0, co.afterTax)) warnings.push("Part of the dividends comes from profits kept from earlier years. Check the reserves in the latest accounts.");
  if (ea && !eaEligible(p, salaries)) warnings.push("Employment Allowance isn't available on these salaries: fewer than two people are paid over £5,000.");
  if (div.others > 0) warnings.push(`Some shares are held by people not in this plan; they receive £${Math.round(div.others).toLocaleString("en-GB")} of the dividends.`);
  if (p.dividendSplit === "classes") warnings.push("Different dividends for different classes must be allowed by the articles and the share rights, and should have a commercial reason. Check before declaring.");
  if (s455 > 0) warnings.push(`s455 tax of £${Math.round(s455).toLocaleString("en-GB")} on overdrawn loan accounts (repaid by HMRC once the loans are cleared).`);
  if (loansRepaid > 0) warnings.push(`£${Math.round(loansRepaid).toLocaleString("en-GB")} is repaid from directors' loan accounts: tax-free cash, but it reduces the company's cash, not its profit.`);
  const pensions = p.people.reduce((a, x) => a + x.employerPension, 0);
  return {
    salaries, people, eaClaimed: ea && co.eaUsed > 0,
    company: { profit: p.profit, salaries: co.salTotal, employerNiGross: co.erGross, eaUsed: co.eaUsed, employerNi: co.er, pensions: co.pensions, class1A: co.class1A, taxable: co.taxable, ct: co.ct, afterTax: co.afterTax, dividends: total, dividendsToOthers: div.others, retained, s455, loansRepaid },
    takeHome, totalTax, value: r2(takeHome - loansRepaid + retained + pensions), warnings,
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
export function startingPeople(directors: { name: string; clientKey: string }[], holdings: { name: string; key: string; number: number; cls?: string }[], newId: () => string): Person[] {
  const classes = [...new Set(holdings.map((h) => h.cls || "Ordinary"))];
  const totalOf = (c: string) => holdings.filter((h) => (h.cls || "Ordinary") === c).reduce((a, h) => a + h.number, 0);
  const people: Person[] = [];
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  for (const d of directors) people.push(newPerson(newId(), { name: d.name, clientKey: d.clientKey, source: d.clientKey ? "return" : "typed" }));
  for (const h of holdings) {
    const cls = h.cls || "Ordinary";
    const pct = totalOf(cls) ? r2(h.number / totalOf(cls) * 100) : 0;
    const hit = people.find((x) => (h.key && x.clientKey === h.key) || norm(x.name) === norm(h.name));
    if (hit && (hit.sharesPct === 0 || hit.shareClass === cls)) { hit.sharesPct = r2(hit.sharesPct + pct); hit.shareClass = cls; }
    else if (!hit) people.push(newPerson(newId(), { name: h.name, clientKey: h.key, director: false, salaried: false, sharesPct: pct, shareClass: cls, customSalary: 0, source: h.key ? "return" : "typed" }));
  }
  return people;
}
/** Different share classes held by different people: dividends can be set per class. */
export const hasAlphabetShares = (holdings: { cls?: string; number: number }[]) => new Set(holdings.filter((h) => h.number > 0).map((h) => h.cls || "Ordinary")).size > 1;

/** The salaries in an agreed plan, person by person, for setting up the payroll. */
export function chosenSalaries(inputs: unknown, chosen: string, year: number, saved: (person: Person) => import("./tax").TaxReturn | undefined): { person: Person; salary: number }[] {
  const p = readPlan(inputs, year);
  if (planProblems(p).length) return [];
  const opts = assess(p, context(p, saved));
  const pick = opts.find((o) => o.key === chosen) || recommended(opts);
  if (!pick) return [];
  return p.people.filter((x) => x.salaried).map((x) => ({ person: x, salary: pick.salaries[x.id] || 0 }));
}
