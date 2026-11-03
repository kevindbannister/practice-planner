// Reading a filled-in Self Assessment return that IRIS Elements prints ("Tax Return for the year ended 5 April 20xx", with the
// IRmark on every page). The pages are HMRC's own forms (SA100 and its supplementary pages) with the figures typed into the
// boxes. formMap.mjs finds each box on the page and what is written in it; this turns those boxes into a TaxReturn.
//
// Boxes are matched by the form, the section heading and the start of the box's label, never by number, because HMRC renumbers
// boxes between years (the same way sa100.ts fills the form). Pages the app doesn't read yet (self-employment, property,
// capital gains, foreign, additional information) are named in `notRead` so nothing is dropped without saying so.
import { Employment, TaxReturn, emptyReturn, newId } from "./tax";

export type ReadBox = { id: string; n?: string; section?: string; label: string; fields: { kind: string; sub?: string; value?: string }[] };
export type ReadPage = { form: string; no: number; boxes: ReadBox[] };
export type FormRead = {
  ret: TaxReturn;
  /** the figures on the return's own Tax calculation summary (SA110) */
  theirs: { totalTax?: number; poaNext?: number };
  /** parts of the return that are present but not read yet, in words */
  notRead: string[];
  warnings: string[];
  /** what the return says about how many employment pages there are */
  employmentPages?: number;
  pages: string[];
};

const val = (b?: ReadBox) => b?.fields.map((f) => f.value || "").find(Boolean) || "";
const amt = (b?: ReadBox) => { const x = Number(val(b)); return Number.isFinite(x) ? x : 0; };
const ticked = (b?: ReadBox, sub?: string) => !!b?.fields.some((f) => (sub ? f.sub === sub : true) && f.value === "X");
const some = (...xs: number[]) => xs.some((x) => Math.abs(x) >= 0.005);

/** The supplementary pages by their footer code, for naming what isn't read yet. */
const SUPPLEMENTARY: Record<string, string> = {
  SE: "Self-employment (short)", SES: "Self-employment (short)", SEF: "Self-employment (full)", SEFull: "Self-employment (full)", UKP: "UK property", UKPF: "UK property",
  F: "Foreign", CG: "Capital gains summary", Ai: "Additional information", AI: "Additional information", P: "Partnership", PE: "Partnership",
};

export function readFormPages(pages: ReadPage[]): FormRead {
  const r = emptyReturn();
  const out: FormRead = { ret: r, theirs: {}, notRead: [], warnings: [], pages: [...new Set(pages.map((p) => `${p.form}${p.no}`))] };
  const find = (form: string, label: RegExp, section?: RegExp, no?: number) =>
    pages.filter((p) => p.form === form && (no === undefined || p.no === no)).flatMap((p) => p.boxes).find((b) => label.test(b.label) && (!section || section.test(b.section || "")));
  const tr = (label: RegExp, section?: RegExp) => find("TR", label, section);

  // ---- SA100 front: date of birth (three groups of cells)
  const dob = tr(/date of birth/i);
  if (dob) { const d = dob.fields.map((f) => f.value || "").join("").replace(/\D/g, ""); if (d.length === 8) r.front.dob = `${d.slice(4)}-${d.slice(2, 4)}-${d.slice(0, 2)}`; }

  // ---- which supplementary pages the return says it has
  // (box 9 has a second Yes/No pair, "do you need more pages", which says nothing about this question)
  const asked = (label: RegExp) => tr(label)?.fields.find((f) => f.sub === "Yes")?.value === "X";
  const flags: [RegExp, string][] = [
    [/^Self-employment/, "Self-employment"], [/^Partnership/, "Partnership"], [/^UK property/, "UK property"], [/^Foreign/, "Foreign"], [/^Trusts/, "Trusts"],
    [/^Capital gains/i, "Capital gains summary"], [/^Residence/, "Residence and remittance"], [/^Additional information/, "Additional information"],
  ];
  for (const [re, name] of flags) if (asked(re)) out.notRead.push(name);
  const emp = tr(/^Employment/);
  if (emp) { const n = Number(emp.fields.find((f) => f.sub === "Number")?.value); if (n > 0) out.employmentPages = n; }
  for (const p of pages) { const name = SUPPLEMENTARY[p.form]; if (name && !out.notRead.includes(name)) out.notRead.push(name); }

  // ---- SA100 income (TR3 on the form)
  const taxedInt = amt(tr(/^Taxed UK interest/));
  if (taxedInt) r.interest.push({ id: newId(), payer: "Taxed UK interest (from the return)", untaxed: 0, net: taxedInt, taxTaken: Math.round(taxedInt * 25) / 100 });
  const untaxedInt = amt(tr(/^Untaxed UK interest/));
  if (untaxedInt) r.interest.push({ id: newId(), payer: "Untaxed UK interest (from the return)", untaxed: untaxedInt });
  const foreignInt = amt(tr(/^Untaxed foreign interest/));
  if (foreignInt) r.interest.push({ id: newId(), payer: "Foreign interest (from the return)", untaxed: foreignInt, foreign: true });
  const ukDiv = amt(tr(/^Dividends from UK companies/));
  if (ukDiv) r.dividends.push({ id: newId(), company: "UK dividends (from the return)", amount: ukDiv });
  const otherDiv = amt(tr(/^Other dividends/));
  if (otherDiv) r.dividends.push({ id: newId(), company: "Other dividends (from the return)", amount: otherDiv });
  const fDiv = amt(tr(/^Foreign dividends/));
  if (fDiv) r.dividends.push({ id: newId(), company: "Foreign dividends (from the return)", amount: fDiv, foreign: true, foreignTax: amt(tr(/^Tax taken off foreign dividends/)) || undefined });

  const state = amt(tr(/^State Pension\b(?! lump)/)), lump = amt(tr(/^State Pension lump sum/)), lumpTax = amt(tr(/^Tax taken off box 9\b/));
  const pens = amt(tr(/^Pensions \(other than State Pension\)/)), pensTax = amt(tr(/^Tax taken off box 11\b/));
  if (some(state, lump, lumpTax, pens, pensTax)) {
    r.pensions = { others: [] };
    if (state) r.pensions.state = state;
    if (lump) r.pensions.stateLumpSum = lump;
    if (lumpTax) r.pensions.stateLumpSumTax = lumpTax;
    if (pens || pensTax) r.pensions.others.push({ id: newId(), payer: "Pensions (from the return)", amount: pens, tax: pensTax });
  }
  const incap = amt(tr(/^Taxable Incapacity Benefit/)), incapTax = amt(tr(/^Tax taken off Incapacity/)), jsa = amt(tr(/^Jobseeker/)), otherBen = amt(tr(/^Total of any other taxable State Pensions/));
  if (some(incap, incapTax, jsa, otherBen)) r.benefits = { incapacity: incap || undefined, incapacityTax: incapTax || undefined, jsa: jsa || undefined, other: otherBen || undefined };
  const oi = amt(tr(/^Other taxable income/)), oiExp = amt(tr(/^Total amount of allowable expenses/)), oiTax = amt(tr(/^Any tax taken off box 17/)), preOwned = amt(tr(/^Benefit from pre-owned/));
  if (some(oi, preOwned)) {
    const desc = val(tr(/^Description of income/));
    r.otherIncome = { amount: oi - oiExp + preOwned, taxTaken: oiTax || undefined, description: desc || undefined };
    if (oiExp) out.warnings.push(`Other income has £${oiExp.toLocaleString("en-GB")} of expenses: they are taken off the amount, since this return has no separate box for them.`);
  }

  // ---- reliefs and charitable giving
  const ras = amt(tr(/^Payments to registered pension schemes where basic/)), gross = amt(tr(/^Payments to a retirement annuity/));
  if (ras) r.reliefs.pensionRas = ras;
  if (gross) r.reliefs.pensionGross = gross;
  if (some(amt(tr(/^Payments to your employer/)), amt(tr(/^Payments to an overseas pension/)))) out.warnings.push("The return has pension payments to an employer's scheme or an overseas scheme, which this version doesn't carry.");
  const gift = amt(tr(/^Gift Aid payments made in the year(?!.*but treated)(?!.*non-UK)/)), giftBack = amt(tr(/^Gift Aid payments made in the year.*but treated/));
  if (gift) r.reliefs.giftAid = gift;
  if (giftBack) r.reliefs.giftAidCarriedBack = giftBack;
  const gifted = amt(tr(/qualifying shares or securities gifted/i)) + amt(tr(/qualifying land and buildings gifted/i));
  if (gifted) r.charityGifts = gifted;
  if (ticked(tr(/registered blind/i))) r.allowances.blind = true;

  // ---- student loan, child benefit
  const slDeducted = amt(tr(/deducted Student Loan/i, /Student Loan/i)), pgDeducted = amt(tr(/deducted Postgraduate/i, /Student Loan/i));
  if (ticked(tr(/notification from Student Loans/i, /Student Loan/i))) out.warnings.push("The return says a student loan repayment is due, but doesn't say which plan: set the plan on the Student loan section.");
  const cb = amt(tr(/total amount of Child Benefit/i, /Child Benefit/i)), kids = Number(val(tr(/number of children/i, /Child Benefit/i))) || 0;
  if (cb || kids) r.childBenefit = { amount: cb || undefined, children: kids || undefined };
  // (the spouse's name is what shows a transfer: the 2021 to 2023 forms have a stray printed "2021" over the National Insurance cells)
  if (val(tr(/first name/i, /Marriage Allowance/i)) || val(tr(/last name/i, /Marriage Allowance/i))) out.warnings.push("The return has a Marriage Allowance transfer, which this version doesn't read: add it on the Marriage Allowance section.");
  if (ticked(tr(/provisional figures/i))) out.warnings.push("The return was marked as containing provisional figures.");

  // ---- Employment pages (SA102), one employment per page
  for (const p of pages.filter((x) => x.form === "E" && x.no === 1)) {
    const b = (re: RegExp) => p.boxes.find((x) => re.test(x.label));
    const e: Employment = { id: newId(), name: val(b(/^Your employer.s name/)), paye: "", pay: amt(b(/^Pay from this employment/)), tax: amt(b(/^UK tax taken off pay/)), benefits: {}, expenses: {} };
    const ref = b(/^PAYE tax reference/);
    if (ref) e.paye = ref.fields.map((f) => f.value || "").filter(Boolean).join("/").toUpperCase();
    const tips = amt(b(/^Tips and other payments/));
    if (tips) e.tips = tips;
    if (ticked(b(/^If you were a company director/))) e.director = true;
    if (ticked(b(/close company/))) e.closeCompany = true;
    const ben = (re: RegExp, k: keyof Employment["benefits"]) => { const v = amt(b(re)); if (v) e.benefits[k] = (e.benefits[k] || 0) + v; };
    ben(/^Company cars and vans/, "car"); ben(/^Fuel for company cars/, "fuel"); ben(/^Private medical/, "medical"); ben(/^Vouchers, credit cards/, "mileage");
    ben(/^Goods and other assets/, "other"); ben(/^Accommodation provided/, "accommodation"); ben(/^Other benefits/, "loans"); ben(/^Expenses payments received/, "other");
    const exp = (re: RegExp, k: keyof Employment["expenses"]) => { const v = amt(b(re)); if (v) e.expenses[k] = (e.expenses[k] || 0) + v; };
    exp(/^Business travel/, "travel"); exp(/^Fixed deductions/, "fixed"); exp(/^Professional fees/, "professional"); exp(/^Other expenses and capital allowances/, "other");
    r.employments.push(e);
  }
  if (r.employments.length) {
    if (slDeducted) r.employments[0].studentLoanDeducted = slDeducted;
    if (pgDeducted) r.employments[0].postgradDeducted = pgDeducted;
  }
  if (out.employmentPages !== undefined && out.employmentPages !== r.employments.length) out.warnings.push(`The return says ${out.employmentPages} employment page${out.employmentPages === 1 ? "" : "s"} but ${r.employments.length} ${r.employments.length === 1 ? "was" : "were"} found.`);

  // ---- the return's own tax calculation summary (SA110)
  const total = find("TC", /due before any payments on account/i);
  if (total && val(total)) out.theirs.totalTax = amt(total);
  const poa = find("TC", /^Your first payment on account/i);
  if (poa && val(poa)) out.theirs.poaNext = amt(poa);
  return out;
}
