// Bringing in a past Self Assessment return from another system's PDFs. IRIS Elements prints two that between them hold the
// figures: the tax calculation ("SA302 (Substitute)": income totals, tax, payments on account made and due) and the detailed
// summaries ("Schedules": each employment with its PAYE reference, each dividend-paying company, interest payers and so on).
// Either can be given alone; with both, the summaries give the detail and the calculation fills gaps and is used to check the
// result. Reads the text lines of each page (pdfText.pdfPageText).
// IRIS can also print the whole return in one PDF: the filled-in SA100 and its supplementary pages (read box by box, see
// taxReturnRead.ts), followed by the calculation and the summaries. The return is then the base, the summaries add the
// company names and the pence, and the calculation fills what the return's pages can't give yet.
import { Employment, TaxReturn, compute, emptyReturn, newId } from "./tax";
import { ReadPage, readFormPages } from "./taxReturnRead";

/** `forms` are the pages of HMRC's forms found in the PDF, with what is written in each box (formMap.mjs). */
export type ImportFile = { name: string; pages: string[][]; forms?: ReadPage[] };
export type ImportResult = {
  ret: TaxReturn;
  year?: number;
  utr?: string;
  name?: string;
  /** the IRmark on a return that was prepared for HMRC */
  irmark?: string;
  /** set when the files say which tax region the person is in (Scotland, Wales, or England and Northern Ireland) */
  regionFound?: boolean;
  /** the figures the other system worked out, to compare with ours */
  theirs: { totalTax?: number; balancing?: number; poaNext?: number; incomeTax?: number };
  /** what was read, in words, for the person to check */
  found: string[];
  warnings: string[];
  kinds: ("calculation" | "summaries" | "return")[];
  /** parts of a full return that are in the PDF but not read yet (self-employment, property...) */
  notRead: string[];
};

const money = (s: string): number | undefined => {
  const m = s.match(/\(?-?£\s?(-?[\d,]+(?:\.\d{1,2})?)\)?/);
  if (!m) return undefined;
  const v = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(v) ? (m[0].startsWith("(") || m[0].includes("-") ? -Math.abs(v) : v) : undefined;
};
// IRIS prints the amounts with a £ sign in some layouts and without in others (2.dp numbers only, so shares held and dates aren't taken)
const LOOSE = /(?<![\d.,/])\(?-?\d[\d,]*\.\d{2}\)?(?![\d.])/g;
const looseMoney = (s: string): number | undefined => { const m = s.match(/(\()?(-)?([\d,]+\.\d{2})\)?\s*$/); return m ? (m[1] || m[2] ? -1 : 1) * Number(m[3].replace(/,/g, "")) : undefined; };
const allMoney = (s: string) => {
  const a = [...s.matchAll(/\(?-?£\s?[\d,]+(?:\.\d{1,2})?\)?/g)].map((m) => money(m[0])!).filter((v) => v !== undefined);
  if (a.length) return a;
  return [...s.matchAll(LOOSE)].map((m) => { const t = m[0]; const v = Number(t.replace(/[(),-]/g, "")); return t.startsWith("(") || t.includes("-") ? -v : v; });
};
const withoutMoney = (s: string) => s.replace(/\(?-?£\s?[\d,]+(?:\.\d{1,2})?\)?/g, " ").replace(LOOSE, " ").replace(/(^|\s)£(?=\s|$)/g, " ").replace(/\s+/g, " ").trim();
const has = (s: string, re: RegExp) => re.test(s);

/** The tax year (as the app names it: the year it ends in) a page is for. */
export function yearIn(lines: string[]): number | undefined {
  for (const l of lines) {
    let m = l.match(/year ended 5 April (\d{4})/i);
    if (m) return Number(m[1]);
    m = l.match(/(?:Tax calculation for|tax year|for the year)\s+(\d{4})[-–\/](\d{2,4})/i);
    if (m) return Number(m[1]) + 1;
    m = l.match(/6 April (\d{4}) to 5 April (\d{4})/i);
    if (m) return Number(m[2]);
    m = l.match(/Tax Return (\d{4})\b/);
    if (m) return Number(m[1]);
  }
  return undefined;
}

const HEADINGS: [RegExp, string][] = [
  [/^UK Dividends/i, "dividends"], [/^Foreign dividends/i, "foreignDividends"], [/^(UK )?(Bank|Building society|Savings)?\s*interest/i, "interest"], [/^Interest from UK/i, "interest"],
  [/^Employment income:?/i, "employment"], [/^Pension contributions|^Payments to registered pension/i, "pensionPaid"], [/^State Pension/i, "statePension"], [/^Pensions?\b|^UK pensions/i, "pensions"],
  [/^(Self[- ]employment|Trading income|Business)\b/i, "trade"], [/^Partnership/i, "partnership"], [/^(UK )?(land and )?property/i, "property"],
  [/^Gift Aid/i, "giftAid"], [/^Other income/i, "otherIncome"],
];

/** Read IRIS's calculation and summaries into a return. `names` are known company names, to complete names IRIS cuts short. */
export function readImport(files: ImportFile[], names: string[] = []): ImportResult {
  const r = emptyReturn();
  const res: ImportResult = { ret: r, theirs: {}, found: [], warnings: [], kinds: [], notRead: [] };
  let fr: ReturnType<typeof readFormPages> | undefined;
  let readCalc = "", readSummaries = "";
  const complete = (cut: string) => {
    const t = cut.trim();
    const hit = [...names, ...r.dividends.map((d) => d.company)].find((n) => n.toUpperCase().startsWith(t.toUpperCase()) && n.length >= t.length);
    return hit || t;
  };
  const calc: Record<string, number> = {};
  let poa1: number | undefined, poa2: number | undefined;

  for (const f of files) {
    const lines = f.pages.flat().map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
    const y = yearIn(lines);
    if (y && res.year && y !== res.year) res.warnings.push(`${f.name} is for ${y - 1}-${String(y).slice(2)}, not ${res.year - 1}-${String(res.year).slice(2)}: check the files are for the same year.`);
    res.year ||= y;
    for (const l of lines) {
      const m = l.match(/^(.*?)\s*UTR:?\s*(\d{5}\s?\d{5})\b/);
      if (m) { res.utr ||= m[2].replace(/\s/g, ""); res.name ||= m[1].trim() || undefined; }
      const ir = l.match(/IRmark:\s*([A-Z0-9]{20,})/);
      if (ir) res.irmark ||= ir[1];
      const rg = l.match(/\(UK TAXPAYER\s*-\s*([^)]*)\)/i);
      if (rg) { r.front.region = /SCOT/i.test(rg[1]) ? "scotland" : /WALES|WELSH/i.test(rg[1]) ? "wales" : "england"; res.regionFound = true; }
      const ni = l.match(/^NINO\s+([A-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D])\b/);
      if (ni) r.front.nino ||= ni[1].replace(/\s/g, "");
    }
    if (f.forms?.length && !fr) { fr = readFormPages(f.forms); res.kinds.push("return"); }
    // the calculation and schedules are IRIS's own pages: the pages of HMRC's form in the same PDF (printed words like "Taxed UK
    // interest", and the figures already read from their boxes) must not be read as schedule lines
    const body = f.pages.filter((pg) => !pg.some((l) => /^SA1\d\d\b|^IRmark:/.test(l.trim()))).flat().map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
    let isCalc = body.some((l) => /Tax calculation for|SA302|How I have worked out your Income Tax/i.test(l));
    let isSummaries = body.some((l) => /Detailed summaries/i.test(l));
    // the same pages given twice (the whole pack and then its calculation again) would double every figure: the first is kept
    if (isCalc && readCalc) { res.warnings.push(`${f.name} repeats the tax calculation already read from ${readCalc}, so it was ignored.`); isCalc = false; }
    if (isSummaries && readSummaries) { res.warnings.push(`${f.name} repeats the detailed summaries already read from ${readSummaries}, so they were ignored.`); isSummaries = false; }
    if (isCalc) readCalc = f.name;
    if (isSummaries) readSummaries = f.name;
    const seenBefore = !isCalc && !isSummaries && body.length > 0 && !!(readCalc || readSummaries) && body.some((l) => /Tax calculation for|Detailed summaries/i.test(l));
    if (isCalc) {
      res.kinds.push("calculation");
      for (const l of body) {
        // the "Summary of tax payable" page has no £ signs
        const tl = l.replace(/\s*\(?-?[\d,]+\.\d{2}\)?\s*$/, "").trim().toLowerCase(), lv = looseMoney(l);
        if (lv !== undefined) {
          if (tl === "total tax due" && calc.totalTax === undefined) calc.totalTax = lv;
          if (/^payment on account made .*\bjanuary\b/.test(tl)) poa1 = Math.abs(lv);
          if (/^payment on account made .*\bjuly\b/.test(tl)) poa2 = Math.abs(lv);
          if (/^first payment on account for \d{4}[-–]\d{2}$/.test(tl) && calc.poaNext === undefined) calc.poaNext = lv;
        }
        const v = money(l);
        if (v === undefined) continue;
        const t = withoutMoney(l).toLowerCase();
        const key = (re: RegExp, k: string) => { if (re.test(t) && calc[k] === undefined) calc[k] = v; };
        key(/^pay from all employments/, "pay");
        key(/^dividends from uk companies/, "dividends");
        key(/^(interest from uk banks|taxed uk interest|untaxed uk interest|interest)/, "interest");
        key(/^foreign dividends/, "foreignDividends");
        key(/^(profit from self-employment|self[- ]employment|profit from trade)/, "trade");
        key(/^(share of partnership|partnership)/, "partnership");
        key(/^(profit from uk land and property|uk property|property income)/, "property");
        key(/^state pension\b/, "statePension");
        key(/^(pensions \(other than state pension\)|other pensions|pensions)/, "pensions");
        key(/^(other income|other taxable income)/, "otherIncome");
        key(/^(tax taken off pay|minus tax deducted|tax deducted from pay|uk tax taken off pay)/, "payTax");
        key(/^income tax (due after allowances and reliefs|charged)/, "incomeTax");
        key(/^total tax due/, "totalTax");
        key(/^balancing payment due/, "balancing");
        key(/^(repayment due|amount to be repaid)/, "repayment");
        key(/^payment on account due 31st january|^first payment on account due/, "poaNext");
        if (/^1st payment on account made/.test(t)) poa1 = Math.abs(v);
        if (/^2nd payment on account made/.test(t)) poa2 = Math.abs(v);
      }
    }
    if (isSummaries) {
      res.kinds.push("summaries");
      let sec = "", cur: Employment | undefined, tradeName = "", trade: { profit?: number } | undefined;
      for (const l of body) {
        const plain = withoutMoney(l);
        const head = HEADINGS.find(([re]) => re.test(plain));
        if (head && !/^Total\b/i.test(plain)) {
          sec = head[1];
          if (sec === "employment") {
            const name = complete(plain.replace(/^Employment income:?\s*/i, ""));
            cur = { id: newId(), name, paye: "", pay: 0, tax: 0, benefits: {}, expenses: {} };
            r.employments.push(cur);
          }
          if (sec === "trade") { tradeName = plain.replace(/^(Self[- ]employment|Trading income|Business):?\s*/i, "") || "Trade"; trade = {}; }
          continue;
        }
        if (/^Shares Date|^held paid|^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/.test(plain) || /Detailed summaries|UTR:/.test(l)) continue;
        const amounts = allMoney(l);
        const v = amounts[amounts.length - 1];
        const isTotal = /^Total\b|\bTotal$|Net taxable income/i.test(plain);
        if (sec === "employment" && cur) {
          const ref = l.match(/PAYE reference:?\s*([0-9]{3}\s*\/\s*[A-Z0-9]+)/i);
          if (ref) { cur.paye = ref[1].replace(/\s/g, "").toUpperCase(); continue; }
          if (v === undefined) continue;
          if (/^Gross pay|^Pay\b|^Salary/i.test(plain)) cur.pay = v;
          else if (/tax (deducted|taken off)|^Tax\b/i.test(plain)) cur.tax = Math.abs(v);
          else if (/^Tips/i.test(plain)) cur.tips = v;
          else if (/benefit/i.test(plain) && !isTotal) cur.benefits.other = (cur.benefits.other || 0) + v;
          else if (/expense/i.test(plain) && !isTotal) cur.expenses.other = (cur.expenses.other || 0) + Math.abs(v);
          continue;
        }
        if (v === undefined || isTotal) continue;
        if (sec === "dividends" || sec === "foreignDividends") {
          const company = plain.replace(/\s+\d[\d,]*$/, "").replace(/\s+\d{2}\/\d{2}\/\d{4}$/, "").replace(/\s+\d[\d,]*$/, "").trim();
          r.dividends.push({ id: newId(), company: complete(company), amount: v, foreign: sec === "foreignDividends" || undefined });
        } else if (sec === "interest") {
          r.interest.push({ id: newId(), payer: plain.replace(/\s+(gross|net|untaxed|taxed)$/i, "").trim() || "Interest", untaxed: v });
        } else if (sec === "pensions") {
          (r.pensions ||= { others: [] }).others.push({ id: newId(), payer: plain || "Pension", amount: v, tax: 0 });
        } else if (sec === "statePension") {
          (r.pensions ||= { others: [] }).state = v;
        } else if (sec === "trade" && trade) {
          if (/profit|net/i.test(plain)) trade.profit = v;
          if (trade.profit !== undefined && !r.selfEmployments.some((s) => s.name === tradeName)) r.selfEmployments.push({ id: newId(), name: tradeName, turnover: trade.profit, expenses: 0 });
        } else if (sec === "property") {
          if (/profit|net/i.test(plain)) r.property = { income: v, finance: 0 };
        } else if (sec === "giftAid") {
          r.reliefs.giftAid = (r.reliefs.giftAid || 0) + v;
        } else if (sec === "pensionPaid") {
          r.reliefs.pensionRas = (r.reliefs.pensionRas || 0) + v;
        } else if (sec === "otherIncome") {
          r.otherIncome = { amount: (r.otherIncome?.amount || 0) + v, description: r.otherIncome?.description || plain };
        }
      }
    }
    if (!isCalc && !isSummaries && !f.forms?.length && !seenBefore) res.warnings.push(`${f.name} doesn't look like an IRIS tax calculation or detailed summaries, so nothing was read from it.`);
  }

  // a full return is the base: its figures are what was filed. The summaries give the names and the pence where they agree
  if (fr) {
    const front = { ...r.front }, merged = mergeDetail(fr.ret, r);
    for (const k of Object.keys(r)) delete (r as Record<string, unknown>)[k];
    Object.assign(r, merged);
    r.front = { ...fr.ret.front, ...front, dob: fr.ret.front.dob };
    res.notRead = fr.notRead;
    res.warnings.push(...fr.warnings);
    if (fr.theirs.totalTax !== undefined) calc.totalTax = fr.theirs.totalTax;
    if (fr.theirs.poaNext !== undefined && calc.poaNext === undefined) calc.poaNext = fr.theirs.poaNext;
  }
  // the calculation fills anything the summaries didn't give
  const fill = (cond: boolean, act: () => void) => { if (cond) act(); };
  fill(calc.pay !== undefined && !r.employments.length, () => r.employments.push({ id: newId(), name: "Employment (from the calculation)", paye: "", pay: calc.pay, tax: calc.payTax || 0, benefits: {}, expenses: {} }));
  fill(calc.payTax !== undefined && r.employments.length === 1 && !r.employments[0].tax, () => { r.employments[0].tax = Math.abs(calc.payTax); });
  fill(calc.dividends !== undefined && !r.dividends.some((d) => !d.foreign), () => r.dividends.push({ id: newId(), company: "UK dividends (from the calculation)", amount: calc.dividends }));
  fill(calc.foreignDividends !== undefined && !r.dividends.some((d) => d.foreign), () => r.dividends.push({ id: newId(), company: "Foreign dividends", amount: calc.foreignDividends, foreign: true }));
  fill(calc.interest !== undefined && !r.interest.length, () => r.interest.push({ id: newId(), payer: "UK interest (from the calculation)", untaxed: calc.interest }));
  fill(calc.trade !== undefined && !r.selfEmployments.length, () => r.selfEmployments.push({ id: newId(), name: "Self-employment (profit from the calculation)", turnover: calc.trade, expenses: 0 }));
  fill(calc.partnership !== undefined && !r.partnerships.length, () => r.partnerships.push({ id: newId(), name: "Partnership", profit: calc.partnership }));
  fill(calc.property !== undefined && !r.property, () => { r.property = { income: calc.property, finance: 0 }; });
  fill(calc.statePension !== undefined && !r.pensions?.state, () => { (r.pensions ||= { others: [] }).state = calc.statePension; });
  fill(calc.pensions !== undefined && !r.pensions?.others.length, () => { (r.pensions ||= { others: [] }).others.push({ id: newId(), payer: "Pensions (from the calculation)", amount: calc.pensions, tax: 0 }); });
  fill(calc.otherIncome !== undefined && !r.otherIncome, () => { r.otherIncome = { amount: calc.otherIncome, description: "Other income (from the calculation)" }; });
  if (poa1 !== undefined || poa2 !== undefined) { r.payments.poa1 = poa1; r.payments.poa2 = poa2; r.payments.paidDifferent = true; }
  if (res.utr) r.front.utr = res.utr;
  res.theirs = { totalTax: calc.totalTax, incomeTax: calc.incomeTax, balancing: calc.balancing !== undefined ? calc.balancing : calc.repayment !== undefined ? -Math.abs(calc.repayment) : undefined, poaNext: calc.poaNext };

  // what was read
  for (const e of r.employments) res.found.push(`Employment: ${e.name}${e.paye ? ` (${e.paye})` : ""}, pay £${e.pay.toLocaleString("en-GB", { minimumFractionDigits: 2 })}${e.tax ? `, tax £${e.tax.toLocaleString("en-GB", { minimumFractionDigits: 2 })}` : ""}`);
  for (const d of r.dividends) res.found.push(`Dividends: ${d.company} £${d.amount.toLocaleString("en-GB", { minimumFractionDigits: 2 })}`);
  for (const i of r.interest) res.found.push(`Interest: ${i.payer} £${i.untaxed.toLocaleString("en-GB", { minimumFractionDigits: 2 })}`);
  for (const s of r.selfEmployments) res.found.push(`Self-employment: ${s.name}, profit £${s.turnover.toLocaleString("en-GB", { minimumFractionDigits: 2 })} (entered as turnover with no expenses)`);
  for (const p of r.partnerships) res.found.push(`Partnership: ${p.name}, share £${p.profit.toLocaleString("en-GB", { minimumFractionDigits: 2 })}`);
  if (r.property) res.found.push(`UK property profit £${r.property.income.toLocaleString("en-GB", { minimumFractionDigits: 2 })} (entered as rents with no expenses)`);
  if (r.pensions?.state) res.found.push(`State Pension £${r.pensions.state.toLocaleString("en-GB", { minimumFractionDigits: 2 })}`);
  for (const o of r.pensions?.others || []) res.found.push(`Pension: ${o.payer} £${o.amount.toLocaleString("en-GB", { minimumFractionDigits: 2 })}`);
  if (r.otherIncome) res.found.push(`Other income £${r.otherIncome.amount.toLocaleString("en-GB", { minimumFractionDigits: 2 })}`);
  if (r.reliefs.giftAid) res.found.push(`Gift Aid £${r.reliefs.giftAid.toLocaleString("en-GB", { minimumFractionDigits: 2 })}`);
  if (r.reliefs.pensionRas) res.found.push(`Pension contributions £${r.reliefs.pensionRas.toLocaleString("en-GB", { minimumFractionDigits: 2 })}`);
  if (poa1 !== undefined || poa2 !== undefined) res.found.push(`Payments on account made: £${(poa1 || 0).toLocaleString("en-GB", { minimumFractionDigits: 2 })} and £${(poa2 || 0).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`);
  if (r.benefits) res.found.push(`State benefits: £${sumOf(Object.values(r.benefits).map((v) => v || 0)).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`);
  if (r.childBenefit?.amount) res.found.push(`Child Benefit received £${r.childBenefit.amount.toLocaleString("en-GB", { minimumFractionDigits: 2 })}`);
  // pages the form reader can't read are covered when the schedules gave that income (as a profit, without the detail)
  const covered: Record<string, boolean> = { "Self-employment": r.selfEmployments.length > 0, Partnership: r.partnerships.length > 0, "UK property": !!r.property };
  const open = res.notRead.filter((n) => !covered[n]);
  res.notRead = open;
  if (open.length) res.warnings.push(`This return also has ${open.join(", ")} pages, which can't be read yet. Check the figures against IRIS's calculation and add what's missing by hand.`);
  if (fr && (r.selfEmployments.length || r.partnerships.length || r.property)) res.warnings.push("Self-employment, partnership and property income come from IRIS's schedules as a profit only: the turnover and expenses behind it aren't read yet.");
  if (!res.year) res.warnings.push("The tax year couldn't be found in the files.");
  if (!r.employments.length && !r.dividends.length && !r.interest.length && !r.selfEmployments.length && !r.property && !r.pensions && !r.partnerships.length) res.warnings.push("No income was found in the files.");
  return res;
}

const sumOf = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const near = (a: number, b: number) => Math.abs(a - b) < 1;
/** A return read from the form's boxes (whole pounds) with the summaries' detail: the exact pence and the names of companies,
 * where the summaries agree with the form to within a pound. Anything the summaries have that the form doesn't is added. */
function mergeDetail(base: TaxReturn, s: TaxReturn): TaxReturn {
  const out: TaxReturn = { ...base };
  const same = (a: Employment, b: Employment) => (a.paye && b.paye ? a.paye === b.paye : a.name.trim().toLowerCase() === b.name.trim().toLowerCase());
  out.employments = base.employments.map((e) => { const m = s.employments.find((x) => same(e, x)); return m && near(m.pay, e.pay) ? { ...e, pay: m.pay, name: e.name || m.name, paye: e.paye || m.paye } : e; });
  for (const m of s.employments) if (!out.employments.some((e) => same(e, m))) out.employments.push(m);
  const ukBox = base.dividends.find((d) => d.company.startsWith("UK dividends")), ukS = s.dividends.filter((d) => !d.foreign);
  if (ukBox && ukS.length && near(sumOf(ukS.map((d) => d.amount)), ukBox.amount)) out.dividends = [...ukS, ...base.dividends.filter((d) => d !== ukBox)];
  else if (!ukBox && ukS.length) out.dividends = [...ukS, ...base.dividends];
  const intBox = base.interest.find((i) => i.payer.startsWith("Untaxed UK interest")), intS = s.interest.filter((i) => !i.foreign);
  if (intBox && intS.length && near(sumOf(intS.map((i) => i.untaxed)), intBox.untaxed)) out.interest = [...intS, ...base.interest.filter((i) => i !== intBox)];
  else if (!intBox && intS.length) out.interest = [...intS, ...base.interest];
  // the schedules list every kind of income, so whatever the form pages couldn't give comes from them
  if (!out.selfEmployments.length && s.selfEmployments.length) out.selfEmployments = s.selfEmployments;
  if (!out.partnerships.length && s.partnerships.length) out.partnerships = s.partnerships;
  if (!out.property && s.property) out.property = s.property;
  if (!out.pensions && s.pensions) out.pensions = s.pensions;
  if (!out.otherIncome && s.otherIncome) out.otherIncome = s.otherIncome;
  out.reliefs = { ...s.reliefs, ...Object.fromEntries(Object.entries(base.reliefs).filter(([, v]) => v)) };
  return out;
}

/** Our computation of the imported return against the other system's: matching when the total tax agrees to the penny. */
export function checkImport(res: ImportResult): { ours: number; theirs?: number; matches?: boolean; poaOurs: number } {
  const c = compute(res.ret, res.year || 2026);
  const theirs = res.theirs.totalTax;
  return { ours: c.totalLiability, theirs, matches: theirs === undefined ? undefined : Math.abs(theirs - c.totalLiability) < 0.01, poaOurs: c.poaNext };
}
