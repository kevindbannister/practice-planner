// Real Time Information: the Full Payment Submission (FPS) and Employer Payment Summary (EPS) for HMRC, to the 2026-27 RTI schemas
// (namespaces .../FullPaymentSubmission/26-27/1 and .../EmployerPaymentSummary/26-27/1; the XSDs are in tests/rti and every message
// built here is validated against them in the tests).
// The XML is written already in canonical form (no whitespace between elements, attributes in order, no empty-element shorthand),
// so the IRmark, a SHA-1 hash of the canonical GovTalk Body without the IRmark element, can be worked out from the text. The
// server adds the GovTalk envelope and the agent's sign-in, works out the IRmark and sends it; nothing secret is in here.
import type { Freq, Line, Letter, StatKind } from "./engine";

export const ENVELOPE_NS = "http://www.govtalk.gov.uk/CM/envelope";
export const FPS_NS = "http://www.govtalk.gov.uk/taxation/PAYE/RTI/FullPaymentSubmission/26-27/1";
export const EPS_NS = "http://www.govtalk.gov.uk/taxation/PAYE/RTI/EmployerPaymentSummary/26-27/1";
export const RTI_YEARS = [2027];
export const CLASS = { FPS: "HMRC-PAYE-RTI-FPS", EPS: "HMRC-PAYE-RTI-EPS" } as const;
export const IRMARK_PLACEHOLDER = "IRMARK";

// ------------------------------------------------------------------ canonical XML

const escText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r/g, "&#xD;");
const escAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;").replace(/\t/g, "&#x9;").replace(/\n/g, "&#xA;").replace(/\r/g, "&#xD;");
type Kid = string | null | undefined | false;
/** One element: text is escaped, a list of children is joined. Attributes come out sorted, as canonical XML needs. */
export function el(name: string, content: Kid | Kid[], attrs: Record<string, string | undefined> = {}): string {
  const a = Object.keys(attrs).filter((k) => attrs[k] !== undefined && attrs[k] !== "").sort().map((k) => ` ${k}="${escAttr(String(attrs[k]))}"`).join("");
  const inner = Array.isArray(content) ? content.filter(Boolean).join("") : content ? escText(String(content)) : "";
  return `<${name}${a}>${inner}</${name}>`;
}
const raw = (name: string, inner: Kid[], attrs: Record<string, string | undefined> = {}) => el(name, inner, attrs);
/** Money as HMRC writes it: two decimals, never "-0.00". */
export const money = (v: number) => { const r = Math.round(v * 100) / 100; return (r < 0 ? "-" : "") + Math.abs(r).toFixed(2); };
export const whole = (v: number) => `${Math.trunc(v) < 0 ? "-" : ""}${Math.abs(Math.trunc(v))}.00`;
const opt = (name: string, v: number | undefined) => (v ? el(name, money(v)) : null);

/** The text the IRmark is worked out from: the GovTalk Body in canonical form, without the IRmark element. */
export function irmarkInput(irEnvelope: string): string {
  return `<Body xmlns="${ENVELOPE_NS}">${irEnvelope.replace(/<IRmark Type="generic">[^<]*<\/IRmark>/, "")}</Body>`;
}
export const withIrmark = (irEnvelope: string, mark: string) => irEnvelope.replace(`<IRmark Type="generic">${IRMARK_PLACEHOLDER}</IRmark>`, `<IRmark Type="generic">${mark}</IRmark>`);

// ------------------------------------------------------------------ the employer

export type Scheme = { officeNo: string; payeRef: string; aoRef: string; cotaxRef?: string; name: string };
/** Problems with the employer's references that HMRC would reject. */
export function schemeProblems(s: Scheme): string[] {
  const out: string[] = [];
  if (!/^\d{3}$/.test(s.officeNo)) out.push("The tax office number is the three digits before the slash in the PAYE reference.");
  if (!/^[A-Za-z0-9]{1,10}$/.test(s.payeRef)) out.push("The PAYE reference is the letters and numbers after the slash.");
  if (!/^\d{3}P[A-Z]\d{7}[0-9X]$/.test(s.aoRef)) out.push("The Accounts Office reference looks like 123PA00012345.");
  if (s.cotaxRef && !/^\d{10}$/.test(s.cotaxRef)) out.push("The company's UTR is ten digits.");
  return out;
}
export const relatedYear = (year: number) => `${String(year - 1).slice(2)}-${String(year).slice(2)}`;
const header = (s: Scheme, year: number) => raw("IRheader", [
  raw("Keys", [el("Key", s.officeNo, { Type: "TaxOfficeNumber" }), el("Key", s.payeRef.toUpperCase(), { Type: "TaxOfficeReference" })]),
  el("PeriodEnd", `${year}-04-05`),
  el("DefaultCurrency", "GBP"),
  el("IRmark", IRMARK_PLACEHOLDER, { Type: "generic" }),
  el("Sender", "Agent"),
]);
const empRefs = (s: Scheme, cotax = true) => raw("EmpRefs", [el("OfficeNo", s.officeNo), el("PayeRef", s.payeRef.toUpperCase()), el("AORef", s.aoRef.toUpperCase()), cotax && s.cotaxRef ? el("COTAXRef", s.cotaxRef) : null]);

// ------------------------------------------------------------------ FPS

export type FpsPerson = {
  nino: string; title?: string; first: string; middle?: string; last: string; birthDate: string; gender: "M" | "F";
  address: string[]; postcode: string; payId: string; letter: Letter;
  director?: { method: "AN" | "AL"; apptWeek?: number };
  starter?: { startDate: string; declaration: "A" | "B" | "C"; studentLoan?: boolean; postgrad?: boolean };
  leavingDate?: string; hours: "A" | "B" | "C" | "D" | "E"; studentPlan?: "plan1" | "plan2" | "plan4" | "plan5" | ""; postgrad?: boolean;
  /** the payroll ID the previous software used, sent once when moving software so HMRC doesn't see a new job */ oldPayId?: string;
};
const PLAN_CODE: Record<string, string> = { plan1: "01", plan2: "02", plan4: "04", plan5: "05" };
const STAT_FIELD: [StatKind, string][] = [["smp", "SMPYTD"], ["spp", "SPPYTD"], ["sap", "SAPYTD"], ["shpp", "ShPPYTD"], ["spbp", "SPBPYTD"], ["sncp", "SNCPYTD"]];
const nameText = (s: string) => s.trim().replace(/\s+/g, " ");

/** Problems with one person's details that the FPS schema or HMRC's rules would reject. */
export function personProblems(p: FpsPerson): string[] {
  const out: string[] = [];
  const who = `${p.first} ${p.last}`.trim() || "Someone";
  if (p.nino && !/^[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z][0-9]{6}[A-D ]$/.test(p.nino.toUpperCase().replace(/\s/g, ""))) out.push(`${who}: the National Insurance number doesn't look right.`);
  if (!p.first.trim() || !/^[A-Za-z]/.test(p.first.trim())) out.push(`${who}: add a first name.`);
  if (!p.last.trim() || !/^[A-Za-z]/.test(p.last.trim())) out.push(`${who}: add a surname.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.birthDate)) out.push(`${who}: add a date of birth.`);
  if (p.gender !== "M" && p.gender !== "F") out.push(`${who}: HMRC needs the gender as recorded on their NI record (M or F).`);
  if (!p.nino && (!p.address.filter(Boolean).length || !p.postcode)) out.push(`${who}: without an NI number HMRC needs the address and postcode.`);
  if (!p.payId) out.push(`${who}: add a payroll ID.`);
  return out;
}

export type FpsInput = { scheme: Scheme; year: number; freq: Freq; period: number; payday: string; people: { person: FpsPerson; line: Line }[]; final?: boolean; lateReason?: string };
export function buildFps(i: FpsInput): string {
  const employees = i.people.map(({ person: p, line: l }) => {
    const nino = p.nino.toUpperCase().replace(/\s/g, "");
    const details = raw("EmployeeDetails", [
      nino ? el("NINO", nino) : null,
      raw("Name", [p.title ? el("Ttl", nameText(p.title)) : null, el("Fore", nameText(p.first)), p.middle ? el("Fore", nameText(p.middle)) : null, el("Sur", nameText(p.last))]),
      p.address.filter(Boolean).length || p.postcode ? raw("Address", [...p.address.filter(Boolean).slice(0, 4).map((x) => el("Line", nameText(x))), el("UKPostcode", p.postcode.toUpperCase().trim())]) : null,
      el("BirthDate", p.birthDate),
      el("Gender", p.gender),
    ]);
    const y = l.ytd;
    const stat = STAT_FIELD.map(([k, f]) => (y.stat[k] ? el(f, money(y.stat[k])) : null));
    const plan = p.studentPlan ? PLAN_CODE[p.studentPlan] : "";
    const employment = raw("Employment", [
      p.director ? el("DirectorsNIC", p.director.method) : null,
      p.director?.apptWeek && p.director.apptWeek > 1 ? el("TaxWkOfApptOfDirector", String(p.director.apptWeek)) : null,
      p.starter ? raw("Starter", [el("StartDate", p.starter.startDate), el("StartDec", p.starter.declaration), p.starter.studentLoan ? el("StudentLoan", "yes") : null, p.starter.postgrad ? el("PostgradLoan", "yes") : null]) : null,
      el("PayId", p.payId),
      p.oldPayId && p.oldPayId !== p.payId ? raw("PayIdChgd", [el("PayrollIdChangedIndicator", "yes"), el("OldPayrollId", p.oldPayId)]) : null,
      p.leavingDate ? el("LeavingDate", p.leavingDate) : null,
      raw("FiguresToDate", [
        el("TaxablePay", money(y.taxablePay)), el("TotalTax", money(y.tax)),
        plan ? el("StudentLoansTD", whole(y.sl)) : null, p.postgrad ? el("PostgradLoansTD", whole(y.pgl)) : null,
        opt("EmpeePenContribnsPaidYTD", y.eePension), opt("EmpeePenContribnsNotPaidYTD", y.eePensionRas),
      ]),
      raw("Payment", [
        el("PayFreq", i.freq), el("PmtDate", i.payday), i.lateReason ? el("LateReason", i.lateReason) : null,
        i.freq === "M1" ? el("MonthNo", String(i.period)) : el("WeekNo", String(i.period)),
        el("PeriodsCovered", "1"),
        p.leavingDate && p.leavingDate < i.payday ? el("PmtAfterLeaving", "yes") : null,
        el("HoursWorked", p.hours),
        el("TaxCode", l.code.fps, { BasisNonCumulative: l.code.nonCum ? "yes" : undefined, TaxRegime: l.code.regime || undefined }),
        el("TaxablePay", money(l.taxablePay)),
        opt("NonTaxOrNICPmt", l.nonTaxable),
        opt("DednsFromNetPay", l.eePensionRas + l.deductions),
        el("PayAfterStatDedns", money(l.payAfterStatDedns)),
        opt("EmpeePenContribnsPaid", l.eePension),
        opt("EmpeePenContribnsNotPaid", l.eePensionRas),
        plan && l.sl ? el("StudentLoanRecovered", whole(l.sl), { PlanType: plan }) : null,
        p.postgrad && l.pgl ? el("PostgradLoanRecovered", whole(l.pgl)) : null,
        el("TaxDeductedOrRefunded", money(l.tax)),
        ...stat,
      ]),
      raw("NIlettersAndValues", [
        el("NIletter", p.letter),
        el("GrossEarningsForNICsInPd", money(l.niEarnings)), el("GrossEarningsForNICsYTD", money(y.niEarnings)),
        el("AtLELYTD", whole(y.atLel)), el("LELtoPTYTD", money(y.lelToPt)), el("PTtoUELYTD", money(y.ptToUel)),
        el("TotalEmpNICInPd", money(l.ee + l.er)), el("TotalEmpNICYTD", money(y.ee + y.er)),
        el("EmpeeContribnsInPd", money(l.ee)), el("EmpeeContribnsYTD", money(y.ee)),
      ]),
    ]);
    return raw("Employee", [details, employment]);
  });
  return raw("IRenvelope", [
    header(i.scheme, i.year),
    raw("FullPaymentSubmission", [empRefs(i.scheme), el("RelatedTaxYear", relatedYear(i.year)), ...employees, i.final ? raw("FinalSubmission", [el("ForYear", "yes")]) : null]),
  ], { xmlns: FPS_NS });
}

// ------------------------------------------------------------------ EPS

export type EpsInput = {
  scheme: Scheme; year: number;
  /** a tax month (1 to 12) in which nobody was paid */
  noPaymentMonth?: number;
  /** claim (true) or stop claiming (false) Employment Allowance */
  employmentAllowance?: boolean;
  recoverable?: { month: number; smp?: number; spp?: number; sap?: number; shpp?: number; spbp?: number; sncp?: number; compSmp?: number; compSpp?: number; compSap?: number; compShpp?: number; compSpbp?: number; compSncp?: number };
  final?: boolean;
};
/** The first and last day of a tax month (month 1 = 6 April to 5 May). */
export function taxMonthDates(year: number, month: number): { from: string; to: string } {
  const startMonth = ((month + 2) % 12) + 1; // 1 -> April (4)
  const fromYear = month <= 9 ? year - 1 : year;
  const toMonth = (startMonth % 12) + 1, toYear = startMonth === 12 ? fromYear + 1 : fromYear;
  const pad = (n: number) => String(n).padStart(2, "0");
  return { from: `${fromYear}-${pad(startMonth)}-06`, to: `${toYear}-${pad(toMonth)}-05` };
}
export function buildEps(i: EpsInput): string {
  const nil = i.noPaymentMonth ? taxMonthDates(i.year, i.noPaymentMonth) : null;
  const r = i.recoverable;
  const rec = r ? raw("RecoverableAmountsYTD", [
    el("TaxMonth", String(r.month)),
    opt("SMPRecovered", r.smp), opt("SPPRecovered", r.spp), opt("SAPRecovered", r.sap), opt("ShPPRecovered", r.shpp), opt("SPBPRecovered", r.spbp), opt("SNCPRecovered", r.sncp),
    opt("NICCompensationOnSMP", r.compSmp), opt("NICCompensationOnSPP", r.compSpp), opt("NICCompensationOnSAP", r.compSap), opt("NICCompensationOnShPP", r.compShpp), opt("NICCompensationOnSPBP", r.compSpbp), opt("NICCompensationOnSNCP", r.compSncp),
  ]) : null;
  return raw("IRenvelope", [
    header(i.scheme, i.year),
    raw("EmployerPaymentSummary", [
      empRefs(i.scheme),
      nil ? el("NoPaymentForPeriod", "yes") : null,
      nil ? raw("NoPaymentDates", [el("From", nil.from), el("To", nil.to)]) : null,
      i.employmentAllowance === undefined ? null : el("EmpAllceInd", i.employmentAllowance ? "yes" : "no"),
      rec,
      el("RelatedTaxYear", relatedYear(i.year)),
      i.final ? raw("FinalSubmission", [el("ForYear", "yes")]) : null,
    ]),
  ], { xmlns: EPS_NS });
}
