// The SA100 tax return as HMRC prints it, filled in from a return. HMRC's blank form for each year is kept in
// public/forms/sa100/SA100-<year>.pdf with a map of where every box is (SA100-<year>.json, made by tools/sa100-map.mjs).
// Boxes are matched here by their page, section heading and label, not their number, because HMRC renumbers boxes between
// years; each box also says which section of the return it comes from, so clicking it on screen can open that section.
import { Computation, SectionKey, TaxReturn, employmentIncome } from "./tax";

export type BoxField = { kind: "money" | "tick" | "text" | "date"; rect: [number, number, number, number]; cells?: [number, number][]; dec?: number; sub?: string };
export type Box = { id: string; n: string; section?: string; label: string; fields: BoxField[] };
export type FormPage = { index: number; tr: number; w: number; h: number; boxes: Box[] };
export type FormMap = { year: number; pages: FormPage[] };

/** The years HMRC's form is held for; a later year uses the newest form until HMRC publishes its own. */
export const FORM_YEARS = [2020, 2021, 2022, 2023, 2024, 2025, 2026];
export function formYearFor(year: number, have: number[] = FORM_YEARS): number | undefined {
  if (have.includes(year)) return year;
  const older = have.filter((y) => y < year);
  return older.length ? Math.max(...older) : undefined;
}
export const formUrl = (year: number) => `/forms/sa100/SA100-${year}.pdf`;
export const mapUrl = (year: number) => `/forms/sa100/SA100-${year}.json`;

export type Context = {
  name: string;
  address: string;
  phone?: string;
  agent?: { name?: string; phone?: string; address?: string; ref?: string };
};

/** What goes in one box: a value for each of its fields (in the map's order), the section it comes from, and a line for the hover. */
export type Filled = { values: (string | undefined)[]; section: SectionKey; itemId?: string; title: string };

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
/** HMRC: whole pounds, income rounded down, tax paid and expenses rounded up. Blank when nothing. */
const pounds = (v: number | undefined, up = false) => { const x = n(v); if (Math.abs(x) < 0.005) return undefined; const p = up ? Math.ceil(Math.abs(x) - 1e-9) : Math.floor(Math.abs(x) + 1e-9); return p ? `${x < 0 ? "-" : ""}${p}` : undefined; };
const X = (on: boolean | undefined) => (on ? "X" : undefined);
const dmy = (iso?: string) => { const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? [m[3], m[2], m[1]] : [undefined, undefined, undefined]; };
const yesNo = (fields: BoxField[], yes: boolean, count?: number) => {
  // fields in order; Yes/No pairs repeat on TR2 box 9, where the second pair is "more pages" (left blank)
  let pair = 0;
  return fields.map((f) => {
    if (f.sub === "Yes") return pair === 0 ? X(yes) : undefined;
    if (f.sub === "No") { const v = pair === 0 ? X(!yes) : undefined; pair++; return v; }
    if (f.sub === "Number") return yes && count ? String(count) : undefined;
    return undefined;
  });
};

type Rule = { tr: number; section?: RegExp; label: RegExp; sec: SectionKey; title?: string; value?: (r: TaxReturn, f: BoxField[]) => (string | undefined)[] | string | undefined };

function rules(r: TaxReturn, c: Computation, ctx: Context): Rule[] {
  const ukInt = r.interest.filter((i) => !i.foreign), fInt = r.interest.filter((i) => i.foreign);
  const ukDiv = r.dividends.filter((d) => !d.foreign), fDiv = r.dividends.filter((d) => d.foreign);
  const fIntTotal = sum(fInt.map((i) => n(i.untaxed))), fDivTotal = sum(fDiv.map((d) => n(d.amount)));
  const b = r.benefits || {};
  const cb = r.childBenefit;
  const additional = !!(r.otherDividends && (r.otherDividends.stock || r.otherDividends.bonus || r.otherDividends.loansWrittenOff)) || !!(r.reliefs.eis || r.reliefs.seis || r.reliefs.vct || r.reliefs.loanInterest || r.reliefs.maintenance);
  const foreign = !!r.foreign && !!(r.foreign.property || r.foreign.pensions || r.foreign.other) || fIntTotal > 2000 || fDivTotal > 500;
  const supplementary = r.employments.length + r.selfEmployments.length + r.partnerships.length > 0 || !!r.property || foreign || r.gains.length > 0 || additional;
  return [
    // TR1: the front, and personal details
    { tr: 1, label: /^UTR$/, sec: "front", title: "UTR", value: () => (r.front.utr ? r.front.utr.replace(/\s/g, "").replace(/^(\d{5})(\d{5})$/, "$1 $2") : undefined) },
    { tr: 1, label: /^NINO$/, sec: "front", title: "National Insurance number", value: () => r.front.nino?.toUpperCase() },
    { tr: 1, label: /^Ref$/, sec: "front", title: "Employer reference" },
    { tr: 1, label: /^Name$/, sec: "front", title: "Name and address", value: () => [ctx.name, ...ctx.address.split(/\n|,\s*/).map((x) => x.trim()).filter(Boolean)].join("\n") },
    { tr: 1, label: /date of birth/i, sec: "front", title: "Date of birth", value: () => dmy(r.front.dob) },
    { tr: 1, label: /name and address/i, sec: "front", title: "Change of name or address" },
    { tr: 1, label: /phone number/i, sec: "front", title: "Phone number", value: (_r, f) => (ctx.phone ? [ctx.phone.replace(/\s/g, "")] : f.map(() => undefined)) },
    { tr: 1, label: /National Insurance number/i, sec: "front", title: "National Insurance number (if not shown above)" },
    // TR2: which supplementary pages
    { tr: 2, label: /^Employment/, sec: "employment", title: "Employment pages", value: (_r, f) => yesNo(f, r.employments.length > 0, r.employments.length) },
    { tr: 2, label: /^Self-employment/, sec: "selfEmployment", title: "Self-employment pages", value: (_r, f) => yesNo(f, r.selfEmployments.length > 0, r.selfEmployments.length) },
    { tr: 2, label: /^Partnership/, sec: "partnership", title: "Partnership pages", value: (_r, f) => yesNo(f, r.partnerships.length > 0, r.partnerships.length) },
    { tr: 2, label: /^UK property/, sec: "property", title: "UK property pages", value: (_r, f) => yesNo(f, !!r.property) },
    { tr: 2, label: /^Foreign/, sec: "foreign", title: "Foreign pages", value: (_r, f) => yesNo(f, foreign) },
    { tr: 2, label: /^Trusts/, sec: "otherIncome", title: "Trusts pages", value: (_r, f) => yesNo(f, false) },
    { tr: 2, label: /^Capital Gains/, sec: "gains", title: "Capital Gains Tax summary", value: (_r, f) => { const v = yesNo(f, r.gains.length > 0); return f.map((x, i) => (x.sub ? v[i] : X(r.gains.length > 0))); } },
    { tr: 2, label: /^Residence/, sec: "foreign", title: "Residence pages", value: (_r, f) => yesNo(f, false) },
    { tr: 2, label: /^Additional information/, sec: "otherReliefs", title: "Additional information pages", value: (_r, f) => yesNo(f, additional) },
    // TR3: income
    { tr: 3, label: /^Taxed UK interest/, sec: "interest", title: "Taxed UK interest (net)", value: () => pounds(sum(ukInt.map((i) => n(i.net)))) },
    { tr: 3, label: /^Untaxed UK interest/, sec: "interest", title: "Untaxed UK interest", value: () => pounds(sum(ukInt.map((i) => n(i.untaxed)))) },
    { tr: 3, label: /^Untaxed foreign interest/, sec: "interest", title: "Untaxed foreign interest", value: () => (fIntTotal <= 2000 ? pounds(fIntTotal) : undefined) },
    { tr: 3, label: /^Dividends from UK companies/, sec: "dividends", title: "Dividends from UK companies", value: () => pounds(sum(ukDiv.map((d) => n(d.amount)))) },
    { tr: 3, label: /^Other dividends/, sec: "dividends", title: "Other dividends (unit trusts, OEICs)" },
    { tr: 3, label: /^Foreign dividends/, sec: "dividends", title: "Foreign dividends", value: () => (fDivTotal <= 500 ? pounds(fDivTotal) : undefined) },
    { tr: 3, label: /^Tax taken off foreign dividends/, sec: "dividends", title: "Tax taken off foreign dividends", value: () => (fDivTotal <= 500 ? pounds(sum(fDiv.map((d) => n(d.foreignTax))), true) : undefined) },
    { tr: 3, label: /^State Pension lump sum/, sec: "pensions", title: "State Pension lump sum", value: () => pounds(r.pensions?.stateLumpSum) },
    { tr: 3, label: /^State Pension/, sec: "pensions", title: "State Pension", value: () => pounds(r.pensions?.state) },
    { tr: 3, label: /^Tax taken off box 9/, sec: "pensions", title: "Tax taken off the State Pension lump sum", value: () => pounds(r.pensions?.stateLumpSumTax, true) },
    { tr: 3, label: /^Pensions \(other than State Pension\)/, sec: "pensions", title: "Other pensions and annuities", value: () => pounds(sum((r.pensions?.others || []).map((o) => n(o.amount)))) },
    { tr: 3, label: /^Tax taken off box 11/, sec: "pensions", title: "Tax taken off other pensions", value: () => pounds(sum((r.pensions?.others || []).map((o) => n(o.tax))), true) },
    { tr: 3, label: /^Taxable Incapacity Benefit/, sec: "benefits", title: "Incapacity Benefit and ESA", value: () => pounds(n(b.incapacity) + n(b.esa)) },
    { tr: 3, label: /^Tax taken off Incapacity/, sec: "benefits", title: "Tax taken off Incapacity Benefit", value: () => pounds(b.incapacityTax, true) },
    { tr: 3, label: /^Jobseeker/, sec: "benefits", title: "Jobseeker's Allowance", value: () => pounds(b.jsa) },
    { tr: 3, label: /^Total of any other taxable State Pensions/, sec: "benefits", title: "Other taxable benefits", value: () => pounds(n(b.carers) + n(b.bereavement) + n(b.other)) },
    { tr: 3, label: /^Other taxable income/, sec: "otherIncome", title: "Other taxable income", value: () => pounds(r.otherIncome?.amount) },
    { tr: 3, label: /^Total amount of allowable expenses/, sec: "otherIncome", title: "Expenses against other income" },
    { tr: 3, label: /^Any tax taken off box 17/, sec: "otherIncome", title: "Tax taken off other income", value: () => pounds(r.otherIncome?.taxTaken, true) },
    { tr: 3, label: /^Benefit from pre-owned/, sec: "otherIncome", title: "Pre-owned assets" },
    { tr: 3, label: /^Description of income/, sec: "otherIncome", title: "Description of other income", value: () => r.otherIncome?.description },
    // TR4: reliefs
    { tr: 4, label: /^Payments to registered pension schemes where basic/, sec: "pensionContributions", title: "Pension payments (relief at source)", value: () => pounds(r.reliefs.pensionRas, true) },
    { tr: 4, label: /one-off.*box 1\b/i, sec: "pensionContributions", title: "One-off pension payments" },
    { tr: 4, label: /^Payments to a retirement annuity/, sec: "pensionContributions", title: "Pension payments made gross", value: () => pounds(r.reliefs.pensionGross, true) },
    { tr: 4, label: /^Payments to your employer|^Payments to an overseas pension/, sec: "pensionContributions", title: "Other pension payments" },
    { tr: 4, label: /^Gift Aid payments made in the year to 5 April \d{4} but treated/, sec: "giftAid", title: "Gift Aid carried back to last year", value: () => pounds(r.reliefs.giftAidCarriedBack, true) },
    { tr: 4, label: /^Gift Aid payments made after/, sec: "giftAid", title: "Gift Aid made after the year, carried back" },
    { tr: 4, label: /^Gift Aid payments made in the year/, sec: "giftAid", title: "Gift Aid payments", value: () => pounds(r.reliefs.giftAid, true) },
    { tr: 4, label: /one-off.*box 5\b/i, sec: "giftAid", title: "One-off Gift Aid payments" },
    { tr: 4, label: /qualifying shares or securities gifted/i, sec: "otherReliefs", title: "Shares given to charity", value: () => pounds(r.charityGifts, true) },
    { tr: 4, label: /land and buildings gifted|gifted to non-UK charities|non-UK charities/i, sec: "otherReliefs", title: "Other gifts to charity" },
    { tr: 4, label: /registered blind/i, sec: "blind", title: "Blind Person's Allowance", value: () => X(r.allowances.blind) },
    { tr: 4, label: /local authority or other register/i, sec: "blind", title: "Register of blind people" },
    { tr: 4, label: /surplus allowance/i, sec: "blind", title: "Transfer of surplus Blind Person's Allowance" },
    // TR5: student loans, child benefit, winter fuel, marriage allowance
    { tr: 5, section: /Student Loan/i, label: /notification from Student Loans/i, sec: "studentLoan", title: "Student loan repayments due", value: () => X(r.studentLoan.plans.length > 0 || !!r.studentLoan.postgrad) },
    { tr: 5, section: /Student Loan/i, label: /deducted Student Loan/i, sec: "studentLoan", title: "Student loan deducted by employers", value: () => pounds(sum(r.employments.map((e) => n(e.studentLoanDeducted))), true) },
    { tr: 5, section: /Student Loan/i, label: /deducted Postgraduate/i, sec: "studentLoan", title: "Postgraduate loan deducted by employers", value: () => pounds(sum(r.employments.map((e) => n(e.postgradDeducted))), true) },
    { tr: 5, section: /Child Benefit/i, label: /total amount of Child Benefit/i, sec: "childBenefit", title: "Child Benefit received", value: () => (cb ? pounds(n(cb.amount) || undefined) : undefined) },
    { tr: 5, section: /Child Benefit/i, label: /number of children/i, sec: "childBenefit", title: "Number of children", value: () => (cb?.children ? String(cb.children) : undefined) },
    { tr: 5, section: /Child Benefit/i, label: /stopped getting/i, sec: "childBenefit", title: "Date Child Benefit stopped" },
    { tr: 5, section: /Winter Fuel/i, label: /./, sec: "winterFuel", title: "Winter Fuel Payment", value: () => pounds(r.winterFuel?.amount) },
    { tr: 5, section: /coronavirus/i, label: /./, sec: "otherIncome", title: "Coronavirus support payments incorrectly claimed" },
    { tr: 5, section: /Marriage Allowance/i, label: /./, sec: "marriage", title: "Marriage Allowance transfer" },
    // TR6 and TR7: finishing, repayments and the agent
    { tr: 6, label: /refunded or set off/i, sec: "payments", title: "Tax refunded or set off" },
    { tr: 6, label: /owe less than £3,000|owe tax on savings/i, sec: "payments", title: "Collecting tax through the tax code" },
    { tr: 6, label: /./, sec: "front", title: "Repayment details" },
    { tr: 7, label: /adviser’s name|adviser's name/i, sec: "front", title: "Tax adviser's name", value: () => ctx.agent?.name },
    { tr: 7, label: /^Their phone number/i, sec: "front", title: "Tax adviser's phone", value: (_r, f) => (ctx.agent?.phone ? [ctx.agent.phone.replace(/\s/g, "")] : f.map(() => undefined)) },
    { tr: 7, label: /first line of their address/i, sec: "front", title: "Tax adviser's address", value: () => ctx.agent?.address },
    { tr: 7, label: /reference your adviser uses/i, sec: "front", title: "Your reference", value: () => ctx.agent?.ref },
    { tr: 7, label: /./, sec: "front", title: "Any other information" },
    // TR8: signing
    { tr: 8, label: /supplementary pages/i, sec: "front", title: "Supplementary pages enclosed", value: () => X(supplementary) },
    { tr: 8, label: /./, sec: "front", title: "Declaration" },
  ];
}

/** Every box on the form that the return speaks to, with what goes in it. Boxes not matched are left out (not clickable). */
export function fillForm(map: FormMap, r: TaxReturn, c: Computation, ctx: Context): Map<string, Filled> {
  const out = new Map<string, Filled>();
  const list = rules(r, c, ctx);
  for (const page of map.pages) {
    for (const box of page.boxes) {
      const rule = list.find((x) => x.tr === page.tr && (!x.section || x.section.test(box.section || "")) && x.label.test(box.label));
      if (!rule) continue;
      const raw = rule.value ? rule.value(r, box.fields) : undefined;
      const values = Array.isArray(raw) ? box.fields.map((_f, i) => raw[i]) : box.fields.map((_f, i) => (i === 0 ? raw : undefined));
      out.set(box.id, { values, section: rule.sec, title: rule.title || box.label });
    }
  }
  // the employment total is on the Employment pages, not the SA100, but say so on the TR2 box
  const emp = [...out.values()].find((f) => f.section === "employment");
  if (emp && r.employments.length) emp.title += `: ${r.employments.map((e) => `${e.name || "employer"} £${Math.floor(employmentIncome(e)).toLocaleString("en-GB")}`).join(", ")}`;
  return out;
}

/** Where to put each character of a value in a field: one per cell (pounds right-aligned to the decimal point), or one line of text. */
export function layout(f: BoxField, value: string | undefined): { x: number; text: string; align: "center" | "left" }[] {
  if (!value) return [];
  const [x0, , x1] = f.rect;
  if (f.kind === "tick") return [{ x: (x0 + x1) / 2, text: value, align: "center" }];
  const cells = f.cells?.map(([a, b]) => ({ a, b })) || [];
  if (f.kind === "money") {
    // the first cell holds the £ sign; pounds go in the cells before the decimal point, right-aligned
    const before = cells.filter((c) => (f.dec ? c.b <= f.dec + 0.5 : true)).slice(1);
    const chars = value.split("");
    const out: { x: number; text: string; align: "center" | "left" }[] = [];
    for (let i = 0; i < chars.length; i++) {
      const cell = before[before.length - chars.length + i];
      if (cell) out.push({ x: (cell.a + cell.b) / 2, text: chars[i], align: "center" });
      else out.push({ x: (before[0]?.a ?? x0) - (chars.length - i) * 8, text: chars[i], align: "center" });
    }
    return out;
  }
  if (cells.length > 1) return value.split("").slice(0, cells.length).map((ch, i) => ({ x: (cells[i].a + cells[i].b) / 2, text: ch, align: "center" }));
  return [{ x: x0 + 3, text: value, align: "left" }];
}

/** The blank form with each filled box written into it, as a PDF to download. */
export async function fillPdf(bytes: Uint8Array, map: FormMap, filled: Map<string, Filled>): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const src = await PDFDocument.load(bytes.slice(), { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, map.pages.map((p) => p.index - 1));
  const font = await out.embedFont(StandardFonts.Helvetica);
  const ink = rgb(0.1, 0.22, 0.6);
  map.pages.forEach((p, i) => {
    const page = out.addPage(pages[i]);
    for (const b of p.boxes) {
      const f = filled.get(b.id);
      if (!f) continue;
      b.fields.forEach((fld, j) => {
        const h = fld.rect[3] - fld.rect[1];
        for (const ch of layout(fld, f.values[j])) {
          if (ch.align === "center") {
            const size = Math.min(11, h * 0.7);
            page.drawText(ch.text, { x: ch.x - font.widthOfTextAtSize(ch.text, size) / 2, y: fld.rect[1] + (h - size * 0.72) / 2, size, font, color: ink });
          } else {
            ch.text.split("\n").forEach((line, li) => page.drawText(line, { x: ch.x, y: fld.rect[3] - 10 - li * 11, size: 9, font, color: ink }));
          }
        }
      });
    }
  });
  return out.save();
}
