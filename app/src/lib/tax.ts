// Personal tax: a Self Assessment return for one person and one tax year, and the tax computation worked out from it.
// The return is a set of sections (front page, each employment, each self-employment, property, interest, dividends,
// pensions, capital gains, reliefs...), laid out like the data input in IRIS Elements. The computation follows the order
// in the Income Tax Act 2007 (s.23): income by type, reliefs, personal allowance, tax by band in the order non-savings,
// savings, dividends, tax reducers, then Class 2 and 4 NIC, student loan, High Income Child Benefit Charge and Capital
// Gains Tax, less tax already paid, and the payments on account for the next year.
// It is a working computation for the accountant: it handles the common cases and says what it does not handle; the
// figures to file come from the return software.
import { Region, YearRates, ratesFor } from "./taxRates";
import { todayIso } from "./domain";

// ------------------------------------------------------------------ the return

export type Employment = {
  id: string; name: string; paye: string; director?: boolean; closeCompany?: boolean;
  pay: number; tax: number; tips?: number;
  benefits: { car?: number; fuel?: number; van?: number; vanFuel?: number; medical?: number; loans?: number; accommodation?: number; mileage?: number; other?: number };
  expenses: { travel?: number; fixed?: number; professional?: number; other?: number };
  studentLoanDeducted?: number; postgradDeducted?: number;
};
export type SelfEmployment = {
  id: string; name: string; description?: string; start?: string; end?: string;
  turnover: number; otherIncome?: number; expenses: number; disallowable?: number; capitalAllowances?: number; balancingCharges?: number;
  tradingAllowance?: boolean; transitionProfit?: number; lossesBf?: number; lossSideways?: number; cis?: number; taxDeducted?: number;
  /** each expense as the accounts show it (from IRIS's detailed summaries); `expenses` is their total */
  expenseItems?: ExpenseLine[];
};
export type Partnership = { id: string; name: string; utr?: string; profit: number; lossesBf?: number; transitionProfit?: number; savings?: number; dividends?: number; taxDeducted?: number; cis?: number };
/** The self-employment boxes on the SA103 form for expenses (11 to 19; box 20 is their total). */
export const EXPENSE_BOXES: { box: ExpenseBox; label: string }[] = [
  { box: "11", label: "Cost of goods sold / materials" }, { box: "12", label: "Motor and travel expenses" }, { box: "13", label: "Wages and staff costs" },
  { box: "14", label: "Rent, rates, power and insurance" }, { box: "15", label: "Repairs and maintenance" }, { box: "16", label: "Accountancy, legal and professional fees" },
  { box: "17", label: "Interest and financial charges" }, { box: "18", label: "Telephone, stationery and office expenses" }, { box: "19", label: "Other allowable expenses" },
];
export type ExpenseBox = "11" | "12" | "13" | "14" | "15" | "16" | "17" | "18" | "19";
/** One expense as the accounts show it, with the SA103 box it goes in (other if not given). */
export type ExpenseLine = { id: string; label: string; amount: number; box?: ExpenseBox };
export const expenseBoxOf = (x: ExpenseLine): ExpenseBox => x.box ?? "19";

export type Interest = { id: string; payer: string; accountNumber?: string; untaxed: number; net?: number; taxTaken?: number; foreign?: boolean; foreignTax?: number };
export type Dividend = { id: string; company: string; amount: number; foreign?: boolean; foreignTax?: number };
export type OtherPension = { id: string; payer: string; amount: number; tax: number };
export type Gain = { id: string; description: string; kind: "residential" | "shares" | "other" | "crypto"; date?: string; proceeds: number; cost: number; badr?: boolean; ir?: boolean };

/** Where a return has got to. Only a submitted return is final for bringing forward. */
export type ReturnState = "draft" | "final" | "submitted";
export const STATE_LABEL: Record<ReturnState, string> = { draft: "In progress", final: "Finalised, not submitted", submitted: "Submitted to HMRC" };
export type ReturnStatus = { state: ReturnState; date?: string; irmark?: string };

export type TaxReturn = {
  v: 1;
  status?: ReturnStatus;
  /** set when the return was brought in from another system (the files it came from) */ imported?: { from: string; on: string; files: string[] };
  /** set when the return was started from last year's */ broughtForward?: { from: number; on: string };
  front: { region: Region; dob?: string; overSpa?: boolean; utr?: string; nino?: string };
  employments: Employment[];
  selfEmployments: SelfEmployment[];
  partnerships: Partnership[];
  nic: { exempt?: boolean; voluntaryClass2?: boolean; class1Earnings?: number };
  interest: Interest[];
  dividends: Dividend[];
  otherDividends?: { stock?: number; bonus?: number; loansWrittenOff?: number };
  property?: {
    income: number; otherIncome?: number; premiums?: number;
    rates?: number; repairs?: number; finance: number; legal?: number; services?: number; travel?: number; other?: number;
    replacingItems?: number; capitalAllowances?: number; privateUse?: number; balancingCharges?: number;
    propertyAllowance?: boolean; rentARoom?: number; lossesBf?: number; financeBf?: number; taxTaken?: number;
  };
  pensions?: { state?: number; stateLumpSum?: number; stateLumpSumTax?: number; others: OtherPension[] };
  benefits?: { jsa?: number; esa?: number; incapacity?: number; incapacityTax?: number; carers?: number; bereavement?: number; other?: number };
  otherIncome?: { amount: number; taxTaken?: number; description?: string };
  foreign?: { property?: number; pensions?: number; other?: number; foreignTax?: number };
  gains: Gain[];
  gainsLossesBf?: number;
  reliefs: {
    pensionRas?: number; pensionGross?: number; giftAid?: number; giftAidCarriedBack?: number;
    eis?: number; seis?: number; vct?: number; loanInterest?: number; maintenance?: number;
  };
  allowances: { marriage?: "none" | "transfer" | "receive"; blind?: boolean };
  studentLoan: { plans: ("plan1" | "plan2" | "plan4" | "plan5")[]; postgrad?: boolean };
  childBenefit?: { amount?: number; children?: number; weeks?: number };
  winterFuel?: { amount?: number };
  /** charitable gifts of shares or land: deducted from income */
  charityGifts?: number;
  notes?: Record<string, string>;
  /** sections added by hand that may have nothing in them yet */
  added?: SectionKey[];
  payments: {
    /** the payments made to HMRC for this year, each with its date, amount and whether it has been paid. Until this is set, the
     * two payments on account are read from the fields below (see paymentLines). */
    lines?: PaymentLine[];
    /** HMRC account entries already brought in (so pasting the same account twice adds nothing) */
    imported?: string[];
    /** money HMRC has paid back or added as interest (repayment supplement): received, not part of the tax */
    credits?: { date: string; description: string; amount: number; key: string }[];
    poa1?: number; poa2?: number; priorLiability?: number; earlierYearInCode?: number; nextYearInCode?: number; propertyReturnTax?: number;
    /** the payments on account expected for this year, rolled forward from last year's return (or typed in) */ expectedPoa1?: number; expectedPoa2?: number;
    /** where the expected figures came from, e.g. "the 2024-25 return" */ expectedFrom?: string;
    /** different amounts were paid: poa1 and poa2 are what was actually paid */ paidDifferent?: boolean;
  };
};

/** A payment to or from HMRC on this year's return. Only a payment that has been ticked as paid counts against the tax. */
export type PaymentLine = {
  id: string;
  kind: "poa1" | "poa2" | "other";
  label: string;
  /** the date it is due, or the date it was paid once ticked (change it if it was paid on another day) */
  date: string;
  /** the amount due (or paid) */
  amount?: number;
  paid?: boolean;
  /** late payment interest or penalty on this payment: paid to HMRC, but not part of the tax */
  late?: number;
  /** the HMRC account line this came from (so removing it lets that line be brought in again) */
  hmrcKey?: string;
  /** the whole payment this line is part of: when and how much HMRC received. A payment can be allocated across years, so this
   * line may be only part of it. */
  source?: { date: string; amount: number };
};

export const emptyReturn = (): TaxReturn => ({
  v: 1, front: { region: "england" }, employments: [], selfEmployments: [], partnerships: [], nic: {}, interest: [], dividends: [], gains: [],
  reliefs: {}, allowances: {}, studentLoan: { plans: [] }, payments: {},
});

export const newId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ------------------------------------------------------------------ the sections (as IRIS Elements groups them)

export type SectionKey = "front" | "employment" | "selfEmployment" | "partnership" | "nic" | "interest" | "dividends" | "otherDividends" | "property"
  | "pensions" | "benefits" | "otherIncome" | "foreign" | "gains" | "pensionContributions" | "giftAid" | "investments" | "otherReliefs"
  | "marriage" | "blind" | "studentLoan" | "childBenefit" | "winterFuel" | "payments";
export type SectionDef = { key: SectionKey; title: string; tab: "UK income" | "Foreign income" | "Allowances" | "Reliefs" | "Miscellaneous"; group: string; multi?: boolean; always?: boolean };
export const SECTIONS: SectionDef[] = [
  { key: "front", title: "Front page details", tab: "Miscellaneous", group: "Return", always: true },
  { key: "employment", title: "Employment", tab: "UK income", group: "Other non-savings", multi: true },
  { key: "selfEmployment", title: "Self-employment", tab: "UK income", group: "Trade, profession or vocation", multi: true },
  { key: "partnership", title: "Partnership", tab: "UK income", group: "Trade, profession or vocation", multi: true },
  { key: "nic", title: "Class 2 and Class 4 NIC", tab: "UK income", group: "Trade, profession or vocation" },
  { key: "interest", title: "Interest from UK banks, etc.", tab: "UK income", group: "Savings and dividends" },
  { key: "dividends", title: "Dividends from UK companies", tab: "UK income", group: "Savings and dividends" },
  { key: "otherDividends", title: "Other dividends, stock dividends and loans written off", tab: "UK income", group: "Savings and dividends" },
  { key: "property", title: "Income from UK property", tab: "UK income", group: "Other non-savings" },
  { key: "pensions", title: "State and other UK pensions", tab: "UK income", group: "Other non-savings" },
  { key: "benefits", title: "State benefits", tab: "UK income", group: "Other non-savings" },
  { key: "otherIncome", title: "Other income", tab: "UK income", group: "Other non-savings" },
  { key: "gains", title: "Capital gains", tab: "UK income", group: "Gains" },
  { key: "foreign", title: "Foreign income", tab: "Foreign income", group: "Foreign" },
  { key: "marriage", title: "Marriage Allowance", tab: "Allowances", group: "Allowances" },
  { key: "blind", title: "Blind Person's Allowance", tab: "Allowances", group: "Allowances" },
  { key: "pensionContributions", title: "Pension contributions", tab: "Reliefs", group: "Reliefs" },
  { key: "giftAid", title: "Gift Aid", tab: "Reliefs", group: "Reliefs" },
  { key: "investments", title: "EIS, SEIS and VCT", tab: "Reliefs", group: "Reliefs" },
  { key: "otherReliefs", title: "Other reliefs (loan interest, gifts of shares or land to charity)", tab: "Reliefs", group: "Reliefs" },
  { key: "studentLoan", title: "Student loan", tab: "Miscellaneous", group: "Miscellaneous" },
  { key: "childBenefit", title: "High Income Child Benefit Charge", tab: "Miscellaneous", group: "Miscellaneous" },
  { key: "winterFuel", title: "Winter Fuel Payment charge", tab: "Miscellaneous", group: "Miscellaneous" },
  { key: "payments", title: "Payments, coding and payments on account", tab: "Miscellaneous", group: "Miscellaneous" },
];
/** Sections in IRIS's list that this computation does not work out yet: shown so the gap is visible. */
export const NOT_YET: { title: string; tab: SectionDef["tab"] }[] = [
  { title: "Lloyd's underwriters", tab: "UK income" }, { title: "Employment lump sums", tab: "UK income" }, { title: "Share schemes", tab: "UK income" },
  { title: "Minister of religion", tab: "UK income" }, { title: "Members of parliament", tab: "UK income" }, { title: "Interest from gilts and accrued income", tab: "UK income" },
  { title: "Life assurance gains", tab: "UK income" }, { title: "Income from trusts, settlements and estates", tab: "UK income" },
  { title: "Foreign Tax Credit Relief in full (country by country)", tab: "Foreign income" }, { title: "Residence and remittance (FIG regime)", tab: "Foreign income" },
  { title: "Married Couple's Allowance", tab: "Allowances" }, { title: "Annual allowance charge on pensions", tab: "Reliefs" },
];

/** Whether a section has anything in it (so the menu shows it as added). */
export function hasSection(r: TaxReturn, k: SectionKey): boolean {
  if (r.added?.includes(k) && !SECTIONS.find((s) => s.key === k)?.multi) return true;
  switch (k) {
    case "front": return true;
    case "employment": return r.employments.length > 0;
    case "selfEmployment": return r.selfEmployments.length > 0;
    case "partnership": return r.partnerships.length > 0;
    case "nic": return r.selfEmployments.length > 0 || r.partnerships.length > 0 || !!r.nic.voluntaryClass2 || !!r.nic.exempt;
    case "interest": return r.interest.length > 0;
    case "dividends": return r.dividends.length > 0;
    case "otherDividends": return !!r.otherDividends;
    case "property": return !!r.property;
    case "pensions": return !!r.pensions;
    case "benefits": return !!r.benefits;
    case "otherIncome": return !!r.otherIncome;
    case "foreign": return !!r.foreign;
    case "gains": return r.gains.length > 0 || !!r.gainsLossesBf;
    case "marriage": return !!r.allowances.marriage && r.allowances.marriage !== "none";
    case "blind": return !!r.allowances.blind;
    case "pensionContributions": return !!(r.reliefs.pensionRas || r.reliefs.pensionGross);
    case "giftAid": return !!(r.reliefs.giftAid || r.reliefs.giftAidCarriedBack);
    case "investments": return !!(r.reliefs.eis || r.reliefs.seis || r.reliefs.vct);
    case "otherReliefs": return !!(r.reliefs.loanInterest || r.reliefs.maintenance || r.charityGifts);
    case "studentLoan": return r.studentLoan.plans.length > 0 || !!r.studentLoan.postgrad;
    case "childBenefit": return !!r.childBenefit;
    case "winterFuel": return !!r.winterFuel;
    case "payments": return !!(r.payments.lines?.length || r.payments.poa1 || r.payments.poa2 || r.payments.expectedPoa1 || r.payments.expectedPoa2 || r.payments.priorLiability || r.payments.earlierYearInCode || r.payments.propertyReturnTax);
  }
}

// ------------------------------------------------------------------ the computation

export type Row = { label: string; amount?: number; rate?: number; strong?: boolean; sub?: boolean; note?: string };
export type Block = { title: string; rows: Row[]; total?: { label: string; amount: number } };
export type Computation = {
  year: number; blocks: Block[]; warnings: string[];
  income: { nonSavings: number; savings: number; dividends: number; total: number; net: number; adjustedNet: number };
  personalAllowance: number; taxable: number;
  incomeTax: number; class2: number; class4: number; studentLoan: number; hicbc: number; cgt: number;
  /** carried to next year: unused capital losses and unused residential finance costs */ carried: { capitalLosses: number; financeCosts: number };
  totalLiability: number; deducted: number; poaPaid: number; lateInterest: number; balancing: number;
  poaNext: number; due: { date: string; label: string; amount: number }[];
};

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const pounds = (v: number) => Math.floor(Math.max(0, v)); // HMRC rounds income down to whole pounds
const p2 = (v: number) => Math.round(v * 100) / 100;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
/** Tax rounded down to the penny (HMRC's calculation rounds each band's tax down). */
const down = (v: number) => Math.floor(Math.round(v * 1000) / 10) / 100;

/** Tax on an amount sliced into bands, starting part-way up (already used). Returns the tax and the slices. */
function slice(amount: number, from: number, bands: { upTo: number; rate: number; name: string }[]): { tax: number; parts: { name: string; amount: number; rate: number }[] } {
  const parts: { name: string; amount: number; rate: number }[] = [];
  let left = amount, at = from, lower = 0;
  for (const b of bands) {
    if (left <= 0) break;
    const room = Math.max(0, b.upTo - Math.max(at, lower));
    const take = Math.min(left, room);
    if (take > 0) { parts.push({ name: b.name, amount: take, rate: b.rate }); left -= take; at += take; }
    lower = b.upTo;
  }
  return { tax: p2(sum(parts.map((x) => down(x.amount * x.rate)))), parts };
}

export function employmentIncome(e: Employment) {
  const ben = sum(Object.values(e.benefits || {}).map(n)), exp = sum(Object.values(e.expenses || {}).map(n));
  return Math.max(0, n(e.pay) + n(e.tips) + ben - exp);
}
export function tradeProfit(s: SelfEmployment) {
  const income = n(s.turnover) + n(s.otherIncome);
  const adjusted = s.tradingAllowance ? income - Math.min(income, 1000) : income - n(s.expenses) + n(s.disallowable) - n(s.capitalAllowances) + n(s.balancingCharges);
  const withTransition = adjusted + n(s.transitionProfit);
  const lossUsed = withTransition > 0 ? Math.min(withTransition, n(s.lossesBf)) : 0;
  return { adjusted, profit: Math.max(0, withTransition - lossUsed), loss: withTransition < 0 ? -withTransition : 0, lossUsed, lossCf: n(s.lossesBf) - lossUsed + (withTransition < 0 ? -withTransition - n(s.lossSideways) : 0) };
}
export function propertyProfit(r: TaxReturn) {
  const p = r.property;
  if (!p) return { profit: 0, finance: 0, loss: 0, lossCf: 0, income: 0 };
  const income = n(p.income) + n(p.otherIncome) + n(p.premiums);
  const expenses = n(p.rates) + n(p.repairs) + n(p.legal) + n(p.services) + n(p.travel) + n(p.other) + n(p.replacingItems) + n(p.capitalAllowances) - n(p.privateUse) - n(p.balancingCharges);
  const adjusted = p.propertyAllowance ? income - Math.min(income, 1000) : income - expenses;
  const lossUsed = adjusted > 0 ? Math.min(adjusted, n(p.lossesBf)) : 0;
  return { income, profit: Math.max(0, adjusted - lossUsed), finance: p.propertyAllowance ? 0 : n(p.finance), loss: adjusted < 0 ? -adjusted : 0, lossCf: n(p.lossesBf) - lossUsed + (adjusted < 0 ? -adjusted : 0) };
}

/** Taking reliefs or allowances off income in the order non-savings, savings, dividends. */
/** Personal allowance is deducted in the way that gives the greatest reduction in tax (ITA 2007 s.25): after non-savings
 * income, it comes off savings above the starting-rate band, then dividends, and zero-rate savings last. */
function takeOffAllowance(amount: number, pots: { ns: number; sv: number; dv: number }, startingBand: number) {
  let left = amount;
  const out = { ...pots };
  const fromNs = Math.min(out.ns, left); out.ns -= fromNs; left -= fromNs;
  const zeroRate = Math.min(out.sv, Math.max(0, startingBand - out.ns));
  const fromSavings = Math.min(out.sv - zeroRate, left); out.sv -= fromSavings; left -= fromSavings;
  const fromDividends = Math.min(out.dv, left); out.dv -= fromDividends; left -= fromDividends;
  const fromZero = Math.min(out.sv, left); out.sv -= fromZero; left -= fromZero;
  return { pots: out, used: amount - left };
}

function takeOff(amount: number, pots: { ns: number; sv: number; dv: number }) {
  let left = amount;
  const out = { ...pots };
  for (const k of ["ns", "sv", "dv"] as const) { const t = Math.min(out[k], left); out[k] -= t; left -= t; }
  return { pots: out, used: amount - left };
}

export function compute(r: TaxReturn, year: number): Computation {
  const R: YearRates = ratesFor(year);
  const warnings: string[] = [];
  const blocks: Block[] = [];

  // ---- income by type
  const emp = r.employments.map((e) => ({ e, income: employmentIncome(e) }));
  const trades = r.selfEmployments.map((s) => ({ s, ...tradeProfit(s) }));
  const parts = r.partnerships.map((x) => { const pr = n(x.profit) + n(x.transitionProfit); const used = pr > 0 ? Math.min(pr, n(x.lossesBf)) : 0; return { x, profit: Math.max(0, pr - used), loss: pr < 0 ? -pr : 0 }; });
  const prop = propertyProfit(r);
  const pens = r.pensions ? n(r.pensions.state) + n(r.pensions.stateLumpSum) + sum(r.pensions.others.map((o) => n(o.amount))) : 0;
  const ben = r.benefits ? n(r.benefits.jsa) + n(r.benefits.esa) + n(r.benefits.incapacity) + n(r.benefits.carers) + n(r.benefits.bereavement) + n(r.benefits.other) : 0;
  const other = n(r.otherIncome?.amount);
  const foreignNs = r.foreign ? n(r.foreign.property) + n(r.foreign.pensions) + n(r.foreign.other) : 0;

  const empTotal = sum(emp.map((x) => x.income)), tradeTotal = sum(trades.map((x) => x.profit)), partTotal = sum(parts.map((x) => x.profit));
  const nonSavings = pounds(empTotal) + pounds(tradeTotal) + pounds(partTotal) + pounds(prop.profit) + pounds(pens) + pounds(ben) + pounds(other) + pounds(foreignNs);
  const interestGross = (i: Interest) => n(i.untaxed) + n(i.net) + n(i.taxTaken);
  const savings = pounds(sum(r.interest.map(interestGross)) + sum(r.partnerships.map((x) => n(x.savings))));
  const otherDiv = r.otherDividends ? n(r.otherDividends.stock) + n(r.otherDividends.bonus) + n(r.otherDividends.loansWrittenOff) : 0;
  const dividends = pounds(sum(r.dividends.map((d) => n(d.amount))) + sum(r.partnerships.map((x) => n(x.dividends))) + otherDiv);
  const total = nonSavings + savings + dividends;

  const incRows: Row[] = [];
  emp.forEach(({ e, income }) => incRows.push({ label: `Employment: ${e.name || "employer"}`, amount: pounds(income) }));
  trades.forEach(({ s, profit, loss }) => incRows.push({ label: `Self-employment: ${s.name || "business"}`, amount: pounds(profit), note: loss ? `Loss of £${pounds(loss).toLocaleString("en-GB")}` : undefined }));
  parts.forEach(({ x, profit }) => incRows.push({ label: `Partnership: ${x.name || "partnership"}`, amount: pounds(profit) }));
  if (r.property) incRows.push({ label: "UK property", amount: pounds(prop.profit), note: prop.loss ? `Loss of £${pounds(prop.loss).toLocaleString("en-GB")} carried forward` : undefined });
  if (pens) incRows.push({ label: "Pensions", amount: pounds(pens) });
  if (ben) incRows.push({ label: "Taxable state benefits", amount: pounds(ben) });
  if (other) incRows.push({ label: "Other income", amount: pounds(other) });
  if (foreignNs) incRows.push({ label: "Foreign income (non-savings)", amount: pounds(foreignNs) });
  if (savings) incRows.push({ label: "Savings interest (gross)", amount: savings });
  if (dividends) incRows.push({ label: "Dividends", amount: dividends });
  blocks.push({ title: "Income", rows: incRows, total: { label: "Total income", amount: total } });

  // ---- reliefs deducted from total income (step 2)
  const sideways = sum(r.selfEmployments.map((s) => Math.min(n(s.lossSideways), tradeProfit(s).loss)));
  const grossPension = n(r.reliefs.pensionGross); // personal contributions not made under relief at source
  const deductions = pounds(sideways + n(r.reliefs.loanInterest) + grossPension + n(r.charityGifts));
  let pots = { ns: nonSavings, sv: savings, dv: dividends };
  ({ pots } = takeOff(deductions, pots));
  const net = Math.max(0, total - deductions);
  const relRows: Row[] = [];
  if (sideways) relRows.push({ label: "Trading loss set against other income", amount: -pounds(sideways) });
  if (n(r.reliefs.loanInterest)) relRows.push({ label: "Qualifying loan interest", amount: -pounds(n(r.reliefs.loanInterest)) });
  if (n(r.charityGifts)) relRows.push({ label: "Gifts of shares or land to charity", amount: -pounds(n(r.charityGifts)) });
  if (grossPension) relRows.push({ label: "Pension contributions (gross, not relief at source)", amount: -pounds(grossPension) });
  if (relRows.length) blocks.push({ title: "Reliefs", rows: relRows, total: { label: "Net income", amount: net } });
  if (sideways + n(r.reliefs.loanInterest) > Math.max(50000, total * 0.25)) warnings.push("Reliefs against total income may be capped at the greater of £50,000 and 25% of adjusted total income: check the cap.");

  // ---- personal allowance
  const giftAidGross = p2((n(r.reliefs.giftAid) - n(r.reliefs.giftAidCarriedBack)) / 0.8);
  const rasGross = p2(n(r.reliefs.pensionRas) / 0.8);
  const extension = Math.max(0, giftAidGross) + rasGross;
  const adjustedNet = Math.max(0, net - extension);
  let pa = R.personalAllowance;
  const taper = Math.max(0, Math.floor((adjustedNet - R.taperFrom) / 2));
  pa = Math.max(0, pa - taper);
  if (r.allowances.marriage === "transfer") pa = Math.max(0, pa - R.marriageAllowance);
  const blind = r.allowances.blind ? R.blindAllowance : 0;
  const allowances = pa + blind;
  ({ pots } = takeOffAllowance(allowances, pots, R.savingsStartingBand));
  const taxable = pots.ns + pots.sv + pots.dv;
  const paRows: Row[] = [{ label: "Personal Allowance", amount: R.personalAllowance }];
  if (taper) paRows.push({ label: "Reduced: income over £100,000", amount: -Math.min(taper, R.personalAllowance), sub: true });
  if (r.allowances.marriage === "transfer") paRows.push({ label: "Marriage Allowance transferred to spouse or civil partner", amount: -R.marriageAllowance, sub: true });
  if (blind) paRows.push({ label: "Blind Person's Allowance", amount: blind });
  blocks.push({ title: "Allowances", rows: paRows, total: { label: "Taxable income", amount: taxable } });

  // ---- tax by band
  const ext = (bands: typeof R.uk, fromIndex: number) => bands.map((b, i) => (i >= fromIndex && Number.isFinite(b.upTo) ? { ...b, upTo: b.upTo + extension } : b));
  const ukBands = ext(R.uk, 0);
  const scot = r.front.region === "scotland";
  const nsBands = scot ? ext(R.scotland, 1) : ukBands;
  const ns = slice(pots.ns, 0, nsBands);
  const taxRows: Row[] = ns.parts.map((x) => ({ label: `${scot ? "Scottish " : ""}${x.name}: £${x.amount.toLocaleString("en-GB")}`, rate: x.rate, amount: down(x.amount * x.rate) }));
  // savings and dividends sit on top of non-savings in the UK bands (Scottish rates are for non-savings income only)
  const basicLimit = ukBands[0].upTo, higherLimit = ukBands[1].upTo;
  let used = pots.ns;
  const startBand = Math.max(0, R.savingsStartingBand - pots.ns);
  const higherRateTaxpayer = taxable > basicLimit, additionalRateTaxpayer = taxable > higherLimit;
  const psa = additionalRateTaxpayer ? 0 : higherRateTaxpayer ? R.psaHigher : R.psaBasic;
  let sv = pots.sv;
  const zeroStart = Math.min(sv, startBand); sv -= zeroStart;
  const zeroPsa = Math.min(sv, psa); sv -= zeroPsa;
  if (zeroStart) taxRows.push({ label: `Starting rate for savings: £${zeroStart.toLocaleString("en-GB")}`, rate: 0, amount: 0 });
  if (zeroPsa) taxRows.push({ label: `Personal Savings Allowance: £${zeroPsa.toLocaleString("en-GB")}`, rate: 0, amount: 0 });
  used += zeroStart + zeroPsa;
  const svTax = slice(sv, used, ukBands);
  svTax.parts.forEach((x) => taxRows.push({ label: `Savings at ${x.name.toLowerCase()}: £${x.amount.toLocaleString("en-GB")}`, rate: x.rate, amount: down(x.amount * x.rate) }));
  used += sv;
  let dv = pots.dv;
  const zeroDiv = Math.min(dv, R.dividendAllowance); dv -= zeroDiv;
  if (zeroDiv) taxRows.push({ label: `Dividend allowance: £${zeroDiv.toLocaleString("en-GB")}`, rate: 0, amount: 0 });
  used += zeroDiv;
  const divBands = ukBands.map((b, i) => ({ ...b, rate: R.dividendRates[i], name: ["Dividend ordinary rate", "Dividend upper rate", "Dividend additional rate"][i] }));
  const dvTax = slice(dv, used, divBands);
  dvTax.parts.forEach((x) => taxRows.push({ label: `${x.name}: £${x.amount.toLocaleString("en-GB")}`, rate: x.rate, amount: down(x.amount * x.rate) }));
  used += dv;
  const gross = p2(ns.tax + svTax.tax + dvTax.tax);

  // ---- tax reducers (limited to the tax)
  const reducers: Row[] = [];
  let taxLeft = gross;
  const reduce = (label: string, amount: number) => { const t = p2(Math.min(taxLeft, Math.max(0, amount))); if (t > 0) { reducers.push({ label, amount: -t }); taxLeft = p2(taxLeft - t); } };
  reduce("EIS relief", n(r.reliefs.eis) * R.eis);
  reduce("SEIS relief", n(r.reliefs.seis) * R.seis);
  reduce("VCT relief", n(r.reliefs.vct) * R.vct);
  if (n(r.reliefs.maintenance)) warnings.push("Maintenance payments relief only applies where one party was born before 6 April 1935: not included.");
  // residential finance costs: 20% of the lowest of the costs, the property profits, and adjusted total income above the allowance
  const financeAll = prop.finance + n(r.property?.financeBf);
  const adjTotal = pots.ns; // adjusted total income: income other than savings and dividends, above the allowances
  const financeBase = Math.min(financeAll, prop.profit, adjTotal);
  const financeCf = p2(Math.max(0, financeAll - Math.max(0, financeBase)));
  let capitalLossCf = n(r.gainsLossesBf);
  reduce("Residential finance costs relief (20%)", financeBase * 0.2);
  if (r.allowances.marriage === "receive") reduce("Marriage Allowance received", R.marriageAllowance * 0.2);
  const incomeTax0 = taxLeft;

  // ---- High Income Child Benefit Charge (an income tax charge)
  const cb = r.childBenefit ? (n(r.childBenefit.amount) || (r.childBenefit.children ? p2((R.childBenefit.eldest + R.childBenefit.other * Math.max(0, n(r.childBenefit.children) - 1)) * (n(r.childBenefit.weeks) || 52)) : 0)) : 0;
  const hicbcPc = Math.min(100, Math.max(0, Math.floor((adjustedNet - R.hicbc.from) / R.hicbc.per1pc)));
  const hicbc = cb ? p2(Math.floor((cb * hicbcPc) / 100)) : 0;

  // ---- foreign tax credit (simplified: up to the UK tax on the foreign income at the rate it was taxed)
  const foreignTax = sum(r.interest.map((i) => n(i.foreignTax))) + sum(r.dividends.map((d) => n(d.foreignTax))) + n(r.foreign?.foreignTax);
  let ftcr = 0;
  if (foreignTax) {
    const marginal = (rows: { rate: number }[]) => (rows.length ? rows[rows.length - 1].rate : 0);
    const fDiv = sum(r.dividends.filter((d) => d.foreign).map((d) => n(d.amount))), fInt = sum(r.interest.filter((i) => i.foreign).map(interestGross));
    const limit = fDiv * marginal(dvTax.parts) + fInt * marginal(svTax.parts) + foreignNs * marginal(ns.parts);
    ftcr = p2(Math.min(foreignTax, limit, incomeTax0));
    warnings.push("Foreign tax credit relief is worked out simply (up to UK tax at the top rate on that income). Check it country by country.");
  }
  // Winter Fuel Payment charge (from 2025-26): paid back in full when total income is over £35,000
  const wfp = year >= 2026 && r.winterFuel && n(r.winterFuel.amount) && total > 35000 ? p2(n(r.winterFuel.amount)) : 0;
  if (r.winterFuel && year < 2026) warnings.push("The Winter Fuel Payment charge starts in 2025-26.");
  const incomeTax = p2(incomeTax0 - ftcr + hicbc + wfp);
  if (reducers.length || ftcr) taxRows.push({ label: "Income tax on taxable income", amount: gross, strong: true });
  const taxBlock: Block = { title: "Income tax", rows: [...taxRows, ...reducers, ...(ftcr ? [{ label: "Foreign tax credit relief", amount: -ftcr }] : []), ...(hicbc ? [{ label: `High Income Child Benefit Charge (${hicbcPc}% of £${cb.toLocaleString("en-GB")})`, amount: hicbc }] : []), ...(wfp ? [{ label: "Winter Fuel Payment charge (income over £35,000)", amount: wfp }] : [])], total: { label: "Income tax due", amount: incomeTax } };
  blocks.push(taxBlock);

  // ---- Class 2 and Class 4 NIC
  const nicProfits = pounds(tradeTotal + partTotal);
  let class2 = 0, class4 = 0;
  const nicRows: Row[] = [];
  if (r.selfEmployments.length || r.partnerships.length) {
    if (r.nic.exempt || r.front.overSpa) nicRows.push({ label: "Exempt from Class 4 (over State Pension age at 6 April, or non-resident)", amount: 0 });
    else {
      const main = Math.max(0, Math.min(nicProfits, R.class4Upper) - R.class4Lower), add = Math.max(0, nicProfits - R.class4Upper);
      class4 = p2(main * R.class4Main + add * R.class4Additional);
      if (main) nicRows.push({ label: `Class 4 on £${main.toLocaleString("en-GB")}`, rate: R.class4Main, amount: p2(main * R.class4Main) });
      if (add) nicRows.push({ label: `Class 4 on £${add.toLocaleString("en-GB")}`, rate: R.class4Additional, amount: p2(add * R.class4Additional) });
      if (n(r.nic.class1Earnings) > 0 && class4) warnings.push("Also employed: the annual maximum for Class 1 and Class 4 together may cap Class 4. Check it if earnings are high.");
    }
    if (R.class2Compulsory) {
      if (nicProfits >= (R.class2From ?? R.class4Lower)) class2 = p2(R.class2Weekly * 52);
      else if (r.nic.voluntaryClass2) class2 = p2(R.class2Weekly * 52);
    } else if (nicProfits < R.smallProfitsThreshold && r.nic.voluntaryClass2) class2 = p2(R.class2Weekly * 52);
    if (class2) nicRows.push({ label: `Class 2 at £${R.class2Weekly.toFixed(2)} a week${R.class2Compulsory && nicProfits >= (R.class2From ?? R.class4Lower) ? "" : " (voluntary)"}`, amount: class2 });
    else if (nicProfits >= R.smallProfitsThreshold && !R.class2Compulsory) nicRows.push({ label: "Class 2: profits over the Small Profits Threshold, so treated as paid", amount: 0 });
    blocks.push({ title: "National Insurance", rows: nicRows, total: { label: "Class 2 and Class 4", amount: p2(class2 + class4) } });
  } else if (r.nic.voluntaryClass2) {
    class2 = p2(R.class2Weekly * 52);
    blocks.push({ title: "National Insurance", rows: [{ label: "Voluntary Class 2", amount: class2 }], total: { label: "Class 2", amount: class2 } });
  }

  // ---- student loan
  let studentLoan = 0;
  if (r.studentLoan.plans.length || r.studentLoan.postgrad) {
    const earned = pounds(empTotal) + nicProfits;
    const unearned = total - pounds(empTotal) - pounds(tradeTotal) - pounds(partTotal);
    const slIncome = earned + (unearned > 2000 ? unearned : 0);
    const thresholds = r.studentLoan.plans.map((p) => R.studentLoan[p]).filter((t): t is number => typeof t === "number");
    if (r.studentLoan.plans.includes("plan5") && !R.studentLoan.plan5) warnings.push("Plan 5 repayments start in 2026-27.");
    const slRows: Row[] = [];
    if (thresholds.length) {
      const t = Math.min(...thresholds);
      const due = Math.floor(Math.max(0, slIncome - t) * 0.09);
      const paid = sum(r.employments.map((e) => n(e.studentLoanDeducted)));
      studentLoan += Math.max(0, due - paid);
      slRows.push({ label: `9% of income over £${t.toLocaleString("en-GB")}`, amount: due });
      if (paid) slRows.push({ label: "Deducted through PAYE", amount: -paid });
    }
    if (r.studentLoan.postgrad) {
      const due = Math.floor(Math.max(0, slIncome - R.studentLoan.postgrad) * 0.06);
      const paid = sum(r.employments.map((e) => n(e.postgradDeducted)));
      studentLoan += Math.max(0, due - paid);
      slRows.push({ label: `Postgraduate loan: 6% of income over £${R.studentLoan.postgrad.toLocaleString("en-GB")}`, amount: due });
      if (paid) slRows.push({ label: "Deducted through PAYE", amount: -paid });
    }
    blocks.push({ title: "Student loan", rows: slRows, total: { label: "Student loan repayment due", amount: studentLoan } });
  }

  // ---- Capital Gains Tax
  let cgt = 0;
  if (r.gains.length || r.gainsLossesBf) {
    const rows: Row[] = [];
    const g = r.gains.map((x) => ({ x, gain: n(x.proceeds) - n(x.cost) }));
    const lossesInYear = sum(g.filter((y) => y.gain < 0).map((y) => -y.gain));
    const early = (x: Gain) => !!R.cgt.early && x.kind !== "residential" && !!x.date && x.date < "2024-10-30";
    // buckets, highest rate first, so losses and the exempt amount go where they save most
    const rateOf = (x: Gain, higher: boolean) => (x.badr || x.ir ? R.cgt.badr : x.kind === "residential" ? (higher ? R.cgt.resHigher : R.cgt.resBasic) : early(x) ? (higher ? R.cgt.early!.higher : R.cgt.early!.basic) : higher ? R.cgt.higher : R.cgt.basic);
    const pos = g.filter((y) => y.gain > 0).sort((a, b) => rateOf(b.x, true) - rateOf(a.x, true));
    let losses = lossesInYear, lossesBf = n(r.gainsLossesBf);
    const gainsTotal = sum(pos.map((y) => y.gain));
    rows.push({ label: "Gains in the year", amount: gainsTotal });
    if (lossesInYear) rows.push({ label: "Losses in the year", amount: -lossesInYear });
    // losses in the year are set off in full; losses brought forward only down to the exempt amount
    const net1 = Math.max(0, gainsTotal - losses);
    const bfUsed = Math.min(lossesBf, Math.max(0, net1 - R.cgt.exempt));
    if (bfUsed) rows.push({ label: "Losses brought forward used", amount: -bfUsed });
    let reduceBy = Math.min(gainsTotal, losses) + bfUsed + R.cgt.exempt;
    rows.push({ label: "Annual exempt amount", amount: -Math.min(R.cgt.exempt, Math.max(0, net1 - bfUsed)) });
    const charged = pos.map((y) => { const t = Math.min(y.gain, reduceBy); reduceBy -= t; return { ...y, left: y.gain - t }; }).filter((y) => y.left > 0);
    let basicLeft = Math.max(0, basicLimit - (pots.ns + pots.sv + pots.dv));
    // BADR and Investors' Relief gains use the basic band first
    const ordered = [...charged.filter((y) => y.x.badr || y.x.ir), ...charged.filter((y) => !(y.x.badr || y.x.ir))];
    for (const y of ordered) {
      const inBasic = Math.min(basicLeft, y.left), above = y.left - inBasic;
      basicLeft -= inBasic;
      if (y.x.badr || y.x.ir) { const t = p2(y.left * R.cgt.badr); cgt += t; rows.push({ label: `${y.x.description || "Gain"} (${y.x.badr ? "Business Asset Disposal Relief" : "Investors' Relief"}): £${y.left.toLocaleString("en-GB")}`, rate: R.cgt.badr, amount: t }); continue; }
      if (inBasic) { const rate = rateOf(y.x, false), t = p2(inBasic * rate); cgt += t; rows.push({ label: `${y.x.description || "Gain"}: £${inBasic.toLocaleString("en-GB")}`, rate, amount: t }); }
      if (above) { const rate = rateOf(y.x, true), t = p2(above * rate); cgt += t; rows.push({ label: `${y.x.description || "Gain"}: £${above.toLocaleString("en-GB")}`, rate, amount: t }); }
    }
    cgt = p2(cgt);
    const lossCf = lossesBf - bfUsed + Math.max(0, losses - gainsTotal);
    capitalLossCf = lossCf;
    if (lossCf) rows.push({ label: `Losses to carry forward: £${pounds(lossCf).toLocaleString("en-GB")}`, note: "" });
    if (r.gains.some((x) => x.kind === "residential") && !n(r.payments.propertyReturnTax)) warnings.push("UK residential property: enter any tax paid on a 60-day property return under Payments.");
    blocks.push({ title: "Capital Gains Tax", rows, total: { label: "Capital Gains Tax due", amount: cgt } });
  }

  // ---- tax already paid
  const paye = sum(r.employments.map((e) => n(e.tax)));
  const atSource = p2(paye + sum(r.interest.map((i) => n(i.taxTaken))) + sum(r.selfEmployments.map((s) => n(s.cis) + n(s.taxDeducted))) + sum(r.partnerships.map((x) => n(x.taxDeducted) + n(x.cis)))
    + sum(r.pensions?.others.map((o) => n(o.tax)) || []) + n(r.pensions?.stateLumpSumTax) + n(r.benefits?.incapacityTax) + n(r.otherIncome?.taxTaken) + n(r.property?.taxTaken) - n(r.payments.earlierYearInCode));
  const propertyReturn = n(r.payments.propertyReturnTax);
  const totalLiability = p2(incomeTax + class2 + class4 + studentLoan + cgt);
  // only the payments ticked as paid count: the summary is what has actually been paid
  const lines = paymentLines(r, year);
  const madeLines = lines.filter((l) => l.paid);
  const poaPaid = p2(sum(madeLines.map((l) => n(l.amount))));
  const latePaid = p2(sum(madeLines.map((l) => n(l.late))));
  const balancing = p2(totalLiability - atSource - poaPaid - propertyReturn);
  const sumRows: Row[] = [
    { label: "Income tax", amount: incomeTax }, ...(class2 + class4 ? [{ label: "Class 2 and Class 4 NIC", amount: p2(class2 + class4) }] : []),
    ...(studentLoan ? [{ label: "Student loan", amount: studentLoan }] : []), ...(cgt ? [{ label: "Capital Gains Tax", amount: cgt }] : []),
    { label: "Total tax due", amount: totalLiability, strong: true },
    ...(atSource ? [{ label: "Tax deducted at source (PAYE, CIS, interest, pensions)", amount: -atSource }] : []),
    ...madeLines.filter((l) => n(l.amount)).map((l) => ({ label: `${l.label} · paid ${fmtPaidDate(l.date)}`, amount: -n(l.amount) })),
    ...(propertyReturn ? [{ label: "Paid on UK property disposal returns", amount: -propertyReturn }] : []),
    ...(latePaid ? [{ label: "Late payment interest and penalties paid (not part of the tax)", amount: latePaid, note: "Paid to HMRC with the payments above; not taken off the balance" }] : []),
    ...(n(r.payments.nextYearInCode) ? [{ label: `To be collected through next year's tax code: £${n(r.payments.nextYearInCode).toLocaleString("en-GB")}`, note: "Not taken off the balance" }] : []),
  ];
  blocks.push({ title: "Summary", rows: sumRows, total: { label: balancing >= 0 ? "Balance to pay" : "Repayment due", amount: Math.abs(balancing) } });

  // ---- payments on account for the next year
  const relevant = p2(incomeTax + class4 - atSource);
  const sourceShare = incomeTax + class4 > 0 ? atSource / (incomeTax + class4) : 1;
  const needed = relevant >= R.poaThreshold && sourceShare < R.poaSourcePc;
  const poaNext = needed ? down(relevant / 2) : 0;
  const y = year;
  const due = [
    { date: `${y + 1}-01-31`, label: `Balancing payment for ${R.label}`, amount: Math.max(0, balancing) },
    ...(needed ? [{ date: `${y + 1}-01-31`, label: `First payment on account for ${y}-${String(y + 1).slice(2)}`, amount: poaNext }, { date: `${y + 1}-07-31`, label: `Second payment on account for ${y}-${String(y + 1).slice(2)}`, amount: poaNext }] : []),
  ];
  blocks.push({ title: "Payments", rows: [
    { label: needed ? "Payments on account needed for next year" : relevant < R.poaThreshold ? "No payments on account: under £1,000 due by self assessment" : "No payments on account: 80% or more paid at source", amount: needed ? poaNext : undefined, note: needed ? "Each of two payments (31 January and 31 July)" : undefined },
    ...due.map((d) => ({ label: `${d.label}, due ${new Date(`${d.date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}`, amount: d.amount })),
  ] });
  if (n(r.payments.priorLiability) && needed) {
    const reduceTo = p2(Math.min(poaNext, n(r.payments.priorLiability) / 2));
    if (reduceTo < poaNext) warnings.push("Next year's payments on account could be reduced if income is expected to fall.");
  }

  if (r.front.region === "wales") warnings.push("Welsh rates are the same as England's for this year (10p in each band goes to Wales).");
  if (trades.some((t) => t.s.transitionProfit) && year > 2029) warnings.push("Transition profit spreading ended with 2027-28: check the transition profit entered.");
  if (r.reliefs.pensionGross || r.reliefs.pensionRas) warnings.push("Pension annual allowance and tapering are not checked: check the annual allowance if contributions are high.");

  return {
    year, blocks, warnings,
    income: { nonSavings, savings, dividends, total, net, adjustedNet: p2(adjustedNet) },
    personalAllowance: allowances, taxable, incomeTax, class2, class4, studentLoan, hicbc, cgt, totalLiability, deducted: atSource, poaPaid, lateInterest: latePaid, balancing, poaNext, due,
    carried: { capitalLosses: p2(capitalLossCf), financeCosts: financeCf },
  };
}

// ------------------------------------------------------------------ reading saved data

/** The payments for a year's return. Returns saved before the list existed have their two payments on account read from the old
 * fields: paid when different amounts were paid (as on an imported return) or the return was submitted, otherwise still to pay. */
export function paymentLines(r: TaxReturn, year: number): PaymentLine[] {
  const p = r.payments;
  if (p.lines) return p.lines;
  const expected = n(p.expectedPoa1) + n(p.expectedPoa2);
  const actual = n(p.poa1) + n(p.poa2);
  const paid = p.paidDifferent || (!expected && actual > 0) || r.status?.state === "submitted";
  const pick = (exp: number | undefined, act: number | undefined) => (paid && (p.paidDifferent || !expected) ? act : exp);
  return [
    { id: "poa1", kind: "poa1", label: "First payment on account", date: `${year}-01-31`, amount: pick(p.expectedPoa1, p.poa1), paid: !!paid && (!!p.paidDifferent || !!expected || actual > 0) },
    { id: "poa2", kind: "poa2", label: "Second payment on account", date: `${year}-07-31`, amount: pick(p.expectedPoa2, p.poa2), paid: !!paid && (!!p.paidDifferent || !!expected || actual > 0) },
  ];
}
/** The payment lines as they stand when first opened: the two payments on account, to be paid (the rolled-forward amounts). */
export function defaultPaymentLines(year: number, expectedPoa1?: number, expectedPoa2?: number): PaymentLine[] {
  return [
    { id: "poa1", kind: "poa1", label: "First payment on account", date: `${year}-01-31`, amount: expectedPoa1, paid: false },
    { id: "poa2", kind: "poa2", label: "Second payment on account", date: `${year}-07-31`, amount: expectedPoa2, paid: false },
  ];
}
/** The amount of the payments ticked as paid, and the late payment increases paid with them. */
export function paidTotals(lines: PaymentLine[]): { paid: number; late: number } {
  const made = lines.filter((l) => l.paid);
  return { paid: p2(sum(made.map((l) => n(l.amount)))), late: p2(sum(made.map((l) => n(l.late)))) };
}
/** What is still to pay on this year's return: each unticked line with any late increase, and whether it is past its date. */
export function outstandingPayments(r: TaxReturn, year: number, today = todayIso()): { lines: (PaymentLine & { overdue: boolean; owed: number })[]; total: number } {
  // a payment with no amount yet (an expected payment not entered, say) isn't counted as owed
  const lines = paymentLines(r, year).filter((l) => !l.paid && (n(l.amount) || n(l.late))).map((l) => ({ ...l, overdue: l.date < today, owed: p2(n(l.amount) + n(l.late)) }));
  lines.sort((a, b) => a.date.localeCompare(b.date));
  return { lines, total: p2(sum(lines.map((l) => l.owed))) };
}

const fmtPaidDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** Next year's expected payments on account from this year's return, ready to roll forward. */
export function rollForward(prev: TaxReturn, prevYear: number): { expectedPoa1: number; expectedPoa2: number; liability: number } {
  const c = compute(prev, prevYear);
  return { expectedPoa1: c.poaNext, expectedPoa2: c.poaNext, liability: Math.round((c.incomeTax + c.class4 - c.deducted) * 100) / 100 };
}

/** A new return started from last year's: the same people, employers, businesses, payers and claims, with every figure cleared,
 * and the losses and reliefs that carry forward worked out from last year (trading and property losses, unused finance costs,
 * capital losses). Payments on account roll forward separately (rollForward). Businesses that ceased last year are left out. */
export function bringForward(prev: TaxReturn, prevYear: number, on = new Date().toISOString().slice(0, 10)): TaxReturn {
  const c = compute(prev, prevYear);
  const r = emptyReturn();
  const fresh = <T extends { id: string }>(x: T, keep: Partial<T>) => ({ ...keep, id: newId() } as T);
  r.front = { ...prev.front };
  r.employments = prev.employments.map((e) => fresh(e, { name: e.name, paye: e.paye, director: e.director, closeCompany: e.closeCompany, pay: 0, tax: 0, benefits: {}, expenses: {} }));
  r.selfEmployments = prev.selfEmployments.filter((s) => !s.end).map((s) => {
    const t = tradeProfit(s);
    return fresh(s, { name: s.name, description: s.description, turnover: 0, expenses: 0, tradingAllowance: s.tradingAllowance, lossesBf: t.lossCf > 0 ? t.lossCf : undefined });
  });
  r.partnerships = prev.partnerships.map((x) => {
    const left = n(x.lossesBf) - Math.min(n(x.lossesBf), Math.max(0, x.profit)) + (x.profit < 0 ? -x.profit : 0);
    return fresh(x, { name: x.name, utr: x.utr, profit: 0, lossesBf: left > 0 ? left : undefined });
  });
  r.nic = { exempt: prev.nic.exempt, voluntaryClass2: prev.nic.voluntaryClass2 };
  r.interest = prev.interest.map((i) => fresh(i, { payer: i.payer, untaxed: 0, foreign: i.foreign }));
  r.dividends = prev.dividends.map((d) => fresh(d, { company: d.company, amount: 0, foreign: d.foreign }));
  if (prev.otherDividends) r.otherDividends = {};
  if (prev.property) {
    const pp = propertyProfit(prev);
    r.property = { income: 0, finance: 0, propertyAllowance: prev.property.propertyAllowance, lossesBf: pp.lossCf > 0 ? pp.lossCf : undefined, financeBf: c.carried.financeCosts > 0 ? c.carried.financeCosts : undefined };
  }
  if (prev.pensions) r.pensions = { others: prev.pensions.others.map((o) => fresh(o, { payer: o.payer, amount: 0, tax: 0 })) };
  if (prev.benefits) r.benefits = {};
  if (prev.otherIncome) r.otherIncome = { amount: 0, description: prev.otherIncome.description };
  if (prev.foreign) r.foreign = {};
  if (c.carried.capitalLosses > 0) r.gainsLossesBf = c.carried.capitalLosses;
  r.allowances = { ...prev.allowances };
  r.studentLoan = { plans: [...prev.studentLoan.plans], postgrad: prev.studentLoan.postgrad };
  if (prev.childBenefit) r.childBenefit = { children: prev.childBenefit.children };
  if (prev.winterFuel) r.winterFuel = {};
  // sections that were on last year's return stay on, even with nothing in them yet
  r.added = [...new Set([...(prev.added || []), ...SECTIONS.filter((s) => !s.multi && s.key !== "front" && s.key !== "payments" && hasSection(prev, s.key)).map((s) => s.key)])];
  r.status = { state: "draft" };
  r.broughtForward = { from: prevYear, on };
  return r;
}

export function readReturn(raw: unknown): TaxReturn {
  const o = raw && typeof raw === "object" ? (raw as Partial<TaxReturn>) : {};
  const e = emptyReturn();
  return {
    ...e, ...o, v: 1,
    front: { ...e.front, ...(o.front || {}) },
    employments: Array.isArray(o.employments) ? o.employments.map((x) => ({ ...x, benefits: x.benefits || {}, expenses: x.expenses || {} })) : [],
    selfEmployments: Array.isArray(o.selfEmployments) ? o.selfEmployments : [],
    partnerships: Array.isArray(o.partnerships) ? o.partnerships : [],
    interest: Array.isArray(o.interest) ? o.interest : [], dividends: Array.isArray(o.dividends) ? o.dividends : [], gains: Array.isArray(o.gains) ? o.gains : [],
    nic: { ...(o.nic || {}) }, reliefs: { ...(o.reliefs || {}) }, allowances: { ...(o.allowances || {}) },
    studentLoan: { plans: o.studentLoan?.plans || [], postgrad: o.studentLoan?.postgrad }, payments: { ...(o.payments || {}) },
    pensions: o.pensions ? { ...o.pensions, others: o.pensions.others || [] } : undefined,
    added: Array.isArray(o.added) ? o.added : [],
  };
}
