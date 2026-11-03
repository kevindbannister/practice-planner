// Payroll calculations for one person and one pay period: PAYE income tax by tax code (cumulative or week 1 / month 1),
// Class 1 National Insurance by category letter (per period for employees, on the year to date for directors on the annual
// basis), student and postgraduate loans, workplace pension, and the year-to-date figures the Full Payment Submission needs.
// Rates are tables per tax year; nothing here is a figure in the code paths. A tax year is named by the year it ends (2027 = 2026-27).
// Rounding follows HMRC's exact percentage method as specified for payroll software; every result should still be checked
// against HMRC's payroll test data for the year before filing live.
import { ratesFor } from "../taxRates";

export type Freq = "M1" | "W1" | "W2" | "W4";
export const PERIODS: Record<Freq, number> = { M1: 12, W1: 52, W2: 26, W4: 13 };
export const FREQ_LABEL: Record<Freq, string> = { M1: "Monthly", W1: "Weekly", W2: "Fortnightly", W4: "Four-weekly" };

type Th = { lel: number; pt: number; st: number; uel: number };
export type PayrollRates = {
  year: number;
  weekly: Th; monthly: Th; annual: Th;
  /** student and postgraduate loan thresholds: annual, monthly, weekly */
  loans: Record<"plan1" | "plan2" | "plan4" | "plan5" | "pgl", { annual: number; monthly: number; weekly: number }>;
  slRate: number; pglRate: number;
  /** auto-enrolment qualifying earnings */
  qe: { lower: { annual: number; monthly: number; weekly: number }; upper: { annual: number; monthly: number; weekly: number }; trigger: number };
  er: number; ea: number; smallEmployerComp: number;
  /** statutory pay: SSP weekly rate, the flat weekly rate for maternity, paternity, adoption, shared parental, bereavement and neonatal pay */
  ssp: number; family: number; largeRecovery: number;
};
const RATES: PayrollRates[] = [
  // HMRC "Rates and thresholds for employers 2026 to 2027"; The Pensions Regulator earnings thresholds 2026/27.
  {
    year: 2027,
    weekly: { lel: 129, pt: 242, st: 96, uel: 967 }, monthly: { lel: 559, pt: 1048, st: 417, uel: 4189 }, annual: { lel: 6708, pt: 12570, st: 5000, uel: 50270 },
    loans: {
      plan1: { annual: 26900, monthly: 2241.66, weekly: 517.30 }, plan2: { annual: 29385, monthly: 2448.75, weekly: 565.09 },
      plan4: { annual: 33795, monthly: 2816.25, weekly: 649.90 }, plan5: { annual: 25000, monthly: 2083.33, weekly: 480.76 }, pgl: { annual: 21000, monthly: 1750, weekly: 403.84 },
    },
    slRate: 0.09, pglRate: 0.06,
    qe: { lower: { annual: 6240, monthly: 520, weekly: 120 }, upper: { annual: 50270, monthly: 4189, weekly: 967 }, trigger: 10000 },
    er: 0.15, ea: 10500, smallEmployerComp: 0.09,
    ssp: 123.25, family: 194.32, largeRecovery: 0.92,
  },
];
export const PAYROLL_YEARS = RATES.map((r) => r.year);
export const payrollRates = (year: number): PayrollRates => RATES.find((r) => r.year === year) || RATES[RATES.length - 1];

const thFor = (R: PayrollRates, f: Freq): Th => f === "M1" ? R.monthly : f === "W1" ? R.weekly : f === "W2" ? scale(R.weekly, 2) : scale(R.weekly, 4);
const scale = (t: Th, n: number): Th => ({ lel: t.lel * n, pt: t.pt * n, st: t.st * n, uel: t.uel * n });
const r2 = (v: number) => Math.round(v * 100) / 100 + 0; // + 0 turns -0 into 0
/** Round to the nearest penny with an exact half penny rounded down, as HMRC specifies for NICs. */
export const halfDown = (v: number) => { const p = Math.round(v * 1e6) / 1e4; return Math.ceil(p - 0.5) / 100 + 0; };
const floor2 = (v: number) => Math.floor(Math.round(v * 1e6) / 1e4) / 100;
const ceil2 = (v: number) => Math.ceil(Math.round(v * 1e6) / 1e4) / 100;

// ------------------------------------------------------------------ tax codes

export type Code = { raw: string; regime: "" | "S" | "C"; kind: "L" | "K" | "BR" | "D0" | "D1" | "D2" | "0T" | "NT"; number: number; nonCum: boolean; fps: string };
/** Read a tax code: an S or C prefix (Scottish or Welsh rates), the code, and W1, M1 or X for week 1 / month 1. Null if it isn't one. */
export function parseCode(input: string): Code | null {
  let s = String(input || "").toUpperCase().replace(/\s+/g, "");
  let nonCum = false;
  const nc = s.match(/(W1|M1|X)$/);
  if (nc && !/^\d+X$/.test(s) && s.length > nc[1].length) { nonCum = true; s = s.slice(0, -nc[1].length); }
  let regime: Code["regime"] = "";
  if (/^[SC](BR|D\d|0T|NT|K\d|\d)/.test(s)) { regime = s[0] as "S" | "C"; s = s.slice(1); }
  let m: RegExpMatchArray | null;
  if (s === "BR" || s === "0T" || s === "NT" || s === "D0" || s === "D1" || (s === "D2" && regime === "S")) return { raw: input, regime, kind: s as Code["kind"], number: 0, nonCum, fps: s };
  if ((m = s.match(/^(\d{1,6})([LMNPTY])$/))) return { raw: input, regime, kind: "L", number: Number(m[1]), nonCum, fps: `${Number(m[1])}${m[2]}` };
  if ((m = s.match(/^K(\d{1,6})$/)) && Number(m[1]) > 0) return { raw: input, regime, kind: "K", number: Number(m[1]), nonCum, fps: `K${Number(m[1])}` };
  return null;
}

/** Tax to date and for the period. `payToDate` is taxable pay for the year so far including this period (cumulative), or this period's pay (non-cumulative). */
export function taxFor(code: Code, freq: Freq, period: number, payToDate: number, taxPaidBefore: number, payThisPeriod: number, year: number) {
  const P = PERIODS[freq], k = code.nonCum ? 1 : period;
  const R = ratesFor(year);
  const bands = code.regime === "S" ? R.scotland : R.uk;
  const pay = code.nonCum ? payThisPeriod : payToDate;
  const adj = code.kind === "L" || code.kind === "K" ? ceil2((code.number * 10 + 9) / P) * k : 0;
  let taxToDate = 0;
  if (code.kind === "NT") taxToDate = 0;
  else if (code.kind === "BR") taxToDate = floor2(Math.floor(Math.max(0, pay)) * (code.regime === "S" ? bands[1].rate : bands[0].rate));
  else if (code.kind === "D0" || code.kind === "D1" || code.kind === "D2") {
    const idx = code.regime === "S" ? { D0: 3, D1: 4, D2: 5 }[code.kind] : { D0: 1, D1: 2, D2: 2 }[code.kind];
    taxToDate = floor2(Math.floor(Math.max(0, pay)) * bands[Math.min(idx, bands.length - 1)].rate);
  } else {
    const taxable = Math.floor(Math.max(0, code.kind === "K" ? pay + adj : pay - adj));
    let left = taxable, lower = 0, t = 0;
    for (const b of bands) {
      if (left <= 0) break;
      const upTo = b.upTo === Infinity ? Infinity : Math.ceil(b.upTo * k / P);
      const take = Math.min(left, Math.max(0, upTo - lower));
      t += take * b.rate; left -= take; lower = upTo;
    }
    taxToDate = floor2(t);
  }
  let tax = code.nonCum ? taxToDate : r2(taxToDate - taxPaidBefore);
  // the overriding limit: tax taken in a period can't be more than half that period's pay (it bites on K codes)
  if (code.kind === "K" && tax > 0) tax = Math.min(tax, floor2(Math.max(0, payThisPeriod) * 0.5));
  return { tax: r2(tax), adjustment: adj };
}

// ------------------------------------------------------------------ National Insurance

export type Letter = "A" | "B" | "C" | "H" | "J" | "M" | "V" | "Z";
export const LETTERS: Record<Letter, { label: string; eeMain: number; eeUpper: number; erRelief: boolean }> = {
  A: { label: "A: standard", eeMain: 0.08, eeUpper: 0.02, erRelief: false },
  B: { label: "B: married woman's reduced rate", eeMain: 0.0185, eeUpper: 0.02, erRelief: false },
  C: { label: "C: over State Pension age", eeMain: 0, eeUpper: 0, erRelief: false },
  H: { label: "H: apprentice under 25", eeMain: 0.08, eeUpper: 0.02, erRelief: true },
  J: { label: "J: deferred", eeMain: 0.02, eeUpper: 0.02, erRelief: false },
  M: { label: "M: under 21", eeMain: 0.08, eeUpper: 0.02, erRelief: true },
  V: { label: "V: veteran (first year)", eeMain: 0.08, eeUpper: 0.02, erRelief: true },
  Z: { label: "Z: under 21, deferred", eeMain: 0.02, eeUpper: 0.02, erRelief: true },
};
export type NiBands = { atLel: number; lelToPt: number; ptToUel: number };
export type NiResult = { ee: number; er: number; bands: NiBands };

/** NI on earnings against a set of thresholds (one period, or the year so far for a director). */
export function niOn(letter: Letter, pay: number, t: Th, erRate: number): NiResult {
  const L = LETTERS[letter] || LETTERS.A;
  const e = Math.max(0, pay);
  const ee = halfDown(Math.max(0, Math.min(e, t.uel) - t.pt) * L.eeMain + Math.max(0, e - t.uel) * L.eeUpper);
  const er = halfDown((L.erRelief ? Math.max(0, e - t.uel) : Math.max(0, e - t.st)) * erRate);
  return { ee, er, bands: { atLel: e >= t.lel ? Math.floor(t.lel) : 0, lelToPt: e > t.lel ? r2(Math.min(e, t.pt) - t.lel) : 0, ptToUel: e > t.pt ? r2(Math.min(e, t.uel) - t.pt) : 0 } };
}
/** Annual thresholds for a director's earnings period: the whole year, or pro rata from the tax week they were appointed. */
export function directorThresholds(year: number, apptWeek = 0): Th {
  const R = payrollRates(year);
  if (!apptWeek || apptWeek <= 1) return R.annual;
  const weeks = Math.max(1, 53 - apptWeek);
  return { lel: Math.ceil(R.weekly.lel * weeks), pt: Math.ceil(R.weekly.pt * weeks), st: Math.ceil(R.weekly.st * weeks), uel: Math.ceil(R.weekly.uel * weeks) };
}
/** The tax week (1 to 53) a date falls in: week 1 starts on 6 April. */
export function taxWeek(iso: string, year: number): number {
  const start = Date.UTC(year - 1, 3, 6), d = Date.parse(`${iso}T00:00:00Z`);
  return Math.min(53, Math.max(1, Math.floor((d - start) / (7 * 86400000)) + 1));
}
/** The tax month (1 to 12) a date falls in: month 1 runs 6 April to 5 May. */
export function taxMonth(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number); void y;
  const mm = d >= 6 ? m : m - 1;
  return ((mm - 4 + 12) % 12) + 1;
}
/** The tax year (by the year it ends) a date falls in. */
export const taxYearOf = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return m > 4 || (m === 4 && d >= 6) ? y + 1 : y; };

// ------------------------------------------------------------------ one person's pay for a period

export type Pension = { kind: "none" | "netpay" | "ras"; eePct: number; erPct: number; basis: "qualifying" | "total" };
export type PersonSetup = {
  taxCode: string; niLetter: Letter;
  director?: { method: "AN" | "AL"; apptWeek: number };
  studentPlan?: "plan1" | "plan2" | "plan4" | "plan5" | ""; postgrad?: boolean;
  pension: Pension;
};
export type PayElements = {
  basic: number; bonus?: number; otherTaxable?: number; statutory?: Partial<Record<StatKind, number>>; nonTaxable?: number; deductions?: number;
  /** cash equivalent of benefits taxed through the payroll this period: taxable, not cash, no Class 1 NI */ benefits?: number;
  /** employee pension contributions handed back (an opt-out within the month): taxable if they were taken under net pay */ pensionRefund?: number;
  /** leave the pension out this period (not enrolled, or opted out) */ noPension?: boolean;
};
export type StatKind = "ssp" | "smp" | "spp" | "sap" | "shpp" | "spbp" | "sncp";
export type Ytd = {
  gross: number; taxablePay: number; tax: number; niEarnings: number; ee: number; er: number; atLel: number; lelToPt: number; ptToUel: number;
  sl: number; pgl: number; eePension: number; eePensionRas: number; erPension: number; net: number; stat: Record<StatKind, number>; benefits: number;
};
export const zeroYtd = (): Ytd => ({ gross: 0, taxablePay: 0, tax: 0, niEarnings: 0, ee: 0, er: 0, atLel: 0, lelToPt: 0, ptToUel: 0, sl: 0, pgl: 0, eePension: 0, eePensionRas: 0, erPension: 0, net: 0, stat: { ssp: 0, smp: 0, spp: 0, sap: 0, shpp: 0, spbp: 0, sncp: 0 }, benefits: 0 });

export type Line = {
  period: number; gross: number; statutory: number; taxablePay: number; tax: number; ee: number; er: number; niEarnings: number; bands: NiBands;
  sl: number; pgl: number; eePension: number; eePensionRas: number; erPension: number; nonTaxable: number; deductions: number; net: number;
  payAfterStatDedns: number; code: Code; ytd: Ytd; warnings: string[]; benefits: number;
  /** court and council orders taken from net pay this period */ orders?: { id: string; label: string; amount: number; fee: number; shortfall: number }[];
};

export function pensionFor(p: Pension, pay: number, freq: Freq, year: number): { ee: number; er: number } {
  if (p.kind === "none") return { ee: 0, er: 0 };
  const R = payrollRates(year);
  const key = freq === "M1" ? "monthly" : "weekly";
  const mult = freq === "W2" ? 2 : freq === "W4" ? 4 : 1;
  const base = p.basis === "total" ? pay : Math.max(0, Math.min(pay, R.qe.upper[key] * mult) - R.qe.lower[key] * mult);
  return { ee: r2(base * p.eePct / 100), er: r2(base * p.erPct / 100) };
}

export function payLine(s: PersonSetup, el: PayElements, freq: Freq, period: number, before: Ytd, year: number): Line | { error: string } {
  const code = parseCode(s.taxCode);
  if (!code) return { error: `"${s.taxCode}" isn't a tax code the payroll understands.` };
  const R = payrollRates(year);
  const warnings: string[] = [];
  const stat = el.statutory || {};
  const statutory = r2(Object.values(stat).reduce((a: number, v) => a + (Number(v) || 0), 0));
  const gross = r2((el.basic || 0) + (el.bonus || 0) + (el.otherTaxable || 0) + statutory);
  const pen = el.noPension ? { ee: 0, er: 0 } : pensionFor(s.pension, gross, freq, year);
  const refund = r2(el.pensionRefund || 0);
  const netpayEe = s.pension.kind === "netpay" ? r2(pen.ee - refund) : 0;
  const rasEe = s.pension.kind === "ras" ? r2(pen.ee * 0.8 - refund) : 0;
  const benefits = r2(el.benefits || 0);
  const taxablePay = r2(gross - netpayEe + benefits);
  const t = taxFor(code, freq, period, r2(before.taxablePay + taxablePay), before.tax, taxablePay, year);
  // with benefits taxed through the payroll, tax can't be more than half the cash pay (the overriding limit)
  if (benefits > 0 && t.tax > 0) { const cap = floor2(Math.max(0, gross - netpayEe) * 0.5); if (t.tax > cap) { t.tax = cap; warnings.push("Tax limited to half of this period's cash pay (benefits taxed through the payroll)."); } }

  // NI: directors on the annual basis work on the year so far; everyone else (and AL directors in-year) per period
  let ni: NiResult, niYtdBands: NiBands;
  const niEarnings = gross;
  if (s.director?.method === "AN") {
    const th = directorThresholds(year, s.director.apptWeek);
    const toDate = niOn(s.niLetter, before.niEarnings + niEarnings, th, R.er);
    ni = { ee: r2(toDate.ee - before.ee), er: r2(toDate.er - before.er), bands: { atLel: r2(toDate.bands.atLel - before.atLel), lelToPt: r2(toDate.bands.lelToPt - before.lelToPt), ptToUel: r2(toDate.bands.ptToUel - before.ptToUel) } };
    niYtdBands = toDate.bands;
  } else {
    ni = niOn(s.niLetter, niEarnings, thFor(R, freq), R.er);
    niYtdBands = { atLel: before.atLel + ni.bands.atLel, lelToPt: r2(before.lelToPt + ni.bands.lelToPt), ptToUel: r2(before.ptToUel + ni.bands.ptToUel) };
    // a director on the alternative method is checked on the annual basis in the last period of the year
    if (s.director?.method === "AL" && period === PERIODS[freq]) {
      const annual = niOn(s.niLetter, before.niEarnings + niEarnings, directorThresholds(year, s.director.apptWeek), R.er);
      const eeDue = r2(annual.ee - before.ee), erDue = r2(annual.er - before.er);
      if (eeDue > ni.ee || erDue > ni.er) { ni = { ee: Math.max(ni.ee, eeDue), er: Math.max(ni.er, erDue), bands: ni.bands }; warnings.push("Year-end check on the annual basis: more NI is due this period."); }
    }
  }

  // loans: on this period's earnings, whole pounds, rounded down
  const loanKey = freq === "M1" ? "monthly" : "weekly", loanMult = freq === "W2" ? 2 : freq === "W4" ? 4 : 1;
  const sl = s.studentPlan ? Math.max(0, Math.floor((niEarnings - R.loans[s.studentPlan][loanKey] * loanMult) * R.slRate)) : 0;
  const pgl = s.postgrad ? Math.max(0, Math.floor((niEarnings - R.loans.pgl[loanKey] * loanMult) * R.pglRate)) : 0;

  const nonTaxable = r2(el.nonTaxable || 0), deductions = r2(el.deductions || 0);
  const payAfterStatDedns = r2(taxablePay - benefits - t.tax - ni.ee - sl - pgl);
  const net = r2(payAfterStatDedns - rasEe - deductions + nonTaxable);
  if (net < 0) warnings.push("Net pay is negative.");
  if (code.kind === "K" && t.tax > 0 && t.tax === floor2(taxablePay * 0.5)) warnings.push("Tax limited to half of this period's pay (K code).");

  const ytd: Ytd = {
    gross: r2(before.gross + gross), taxablePay: r2(before.taxablePay + taxablePay), tax: r2(before.tax + t.tax), niEarnings: r2(before.niEarnings + niEarnings),
    ee: r2(before.ee + ni.ee), er: r2(before.er + ni.er), atLel: niYtdBands.atLel, lelToPt: niYtdBands.lelToPt, ptToUel: niYtdBands.ptToUel,
    sl: before.sl + sl, pgl: before.pgl + pgl, eePension: r2(before.eePension + netpayEe), eePensionRas: r2(before.eePensionRas + rasEe), erPension: r2(before.erPension + pen.er), net: r2(before.net + net),
    stat: Object.fromEntries((Object.keys(before.stat) as StatKind[]).map((k) => [k, r2(before.stat[k] + (Number(stat[k]) || 0))])) as Record<StatKind, number>,
    benefits: r2((before.benefits || 0) + benefits),
  };
  return { period, gross, statutory, taxablePay, tax: t.tax, ee: ni.ee, er: ni.er, niEarnings, bands: ni.bands, sl, pgl, eePension: netpayEe, eePensionRas: rasEe, erPension: pen.er, nonTaxable, deductions, net, payAfterStatDedns, code, ytd, warnings, benefits };
}

/** A whole year in advance: each period's pay worked out in turn from the one before. Periods with no pay are skipped (no FPS). */
export function projectYear(s: PersonSetup, amounts: (number | null)[], freq: Freq, year: number, start: Ytd = zeroYtd()): (Line | null)[] {
  const out: (Line | null)[] = [];
  let ytd = start;
  amounts.forEach((a, i) => {
    if (a === null || a === undefined || !(a > 0)) { out.push(null); return; }
    const l = payLine(s, { basic: a }, freq, i + 1, ytd, year);
    if ("error" in l) { out.push(null); return; }
    out.push(l); ytd = l.ytd;
  });
  return out;
}
