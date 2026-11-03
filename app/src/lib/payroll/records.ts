// Payroll records: the PAYE scheme (one per employer client), the people on it, the pay year (paydays set in advance and any planned
// amounts, such as a director's salary from an agreed tax plan), pay runs and the HMRC submissions queued for each payday.
// Pure logic: rows in, rows out. Saving is done by the screens.
import { Row } from "../schema";
import { Freq, Letter, Line, PERIODS, PersonSetup, Pension, Ytd, payLine, taxMonth, taxWeek, taxYearOf, zeroYtd } from "./engine";
import { FpsPerson, Scheme, buildEps, buildFps, personProblems, schemeProblems, taxMonthDates } from "./rti";

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v)).trim();
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const yes = (v: unknown) => v === true || /^(yes|true|1)$/i.test(str(v));
const json = <T,>(v: unknown, d: T): T => { try { const j = JSON.parse(str(v) || "null"); return j ?? d; } catch { return d; } };
const r2 = (v: number) => Math.round(v * 100) / 100 + 0;
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

// ------------------------------------------------------------------ scheme and people

export type SchemeRec = Scheme & { key: string; clientKey: string; freq: Freq; claimEA: boolean; smallEmployer: boolean; status: string };
export const readScheme = (r: Row): SchemeRec => ({
  key: str(r.Key), clientKey: str(r.ClientKey), name: str(r.Name), officeNo: str(r.OfficeNo), payeRef: str(r.PayeRef).toUpperCase(), aoRef: str(r.AORef).toUpperCase(), cotaxRef: str(r.COTAXRef),
  freq: (["M1", "W1", "W2", "W4"] as const).find((f) => f === str(r.Freq)) || "M1", claimEA: yes(r.ClaimEA), smallEmployer: yes(r.SmallEmployer), status: str(r.Status) || "active",
});

export type PersonRec = {
  key: string; schemeKey: string; personClientKey: string; title: string; first: string; middle: string; last: string; nino: string; dob: string; gender: "M" | "F" | "";
  address: string[]; postcode: string; payId: string; startDate: string; startDec: "A" | "B" | "C" | ""; leavingDate: string;
  director: boolean; nicMethod: "AN" | "AL"; appointedOn: string; taxCode: string; niLetter: Letter; studentPlan: "" | "plan1" | "plan2" | "plan4" | "plan5"; postgrad: boolean;
  pension: Pension; hours: "A" | "B" | "C" | "D" | "E"; basis: "salary" | "hourly" | "plan"; annualSalary: number; hourlyRate: number; usualHours: number; status: string;
  /** figures for the year so far from the previous payroll software, for the year they belong to */ opening: { year: number; ytd: Ytd } | null; oldPayId: string;
};
export const readPerson = (r: Row): PersonRec => {
  const p = json<Partial<Pension>>(r.Pension, {});
  return {
    key: str(r.Key), schemeKey: str(r.SchemeKey), personClientKey: str(r.PersonClientKey), title: str(r.Title), first: str(r.First), middle: str(r.Middle), last: str(r.Last),
    nino: str(r.NINO).toUpperCase().replace(/\s/g, ""), dob: str(r.DOB), gender: str(r.Gender) === "F" ? "F" : str(r.Gender) === "M" ? "M" : "",
    address: str(r.Address).split(/\r?\n/).map((x) => x.trim()).filter(Boolean).slice(0, 4), postcode: str(r.Postcode).toUpperCase(), payId: str(r.PayId),
    startDate: str(r.StartDate), startDec: (["A", "B", "C"] as const).find((x) => x === str(r.StartDec)) || "", leavingDate: str(r.LeavingDate),
    director: yes(r.Director), nicMethod: str(r.NicMethod) === "AL" ? "AL" : "AN", appointedOn: str(r.AppointedOn), taxCode: str(r.TaxCode) || "1257L",
    niLetter: (["A", "B", "C", "H", "J", "M", "V", "Z"] as const).find((x) => x === str(r.NiLetter)) || "A",
    studentPlan: (["plan1", "plan2", "plan4", "plan5"] as const).find((x) => x === str(r.StudentPlan)) || "", postgrad: yes(r.Postgrad),
    pension: { kind: p.kind === "netpay" || p.kind === "ras" ? p.kind : "none", eePct: num(p.eePct), erPct: num(p.erPct), basis: p.basis === "total" ? "total" : "qualifying" },
    hours: (["A", "B", "C", "D", "E"] as const).find((x) => x === str(r.Hours)) || (yes(r.Director) ? "E" : "D"),
    basis: str(r.PayBasis) === "hourly" ? "hourly" : str(r.PayBasis) === "plan" ? "plan" : "salary",
    annualSalary: num(r.AnnualSalary), hourlyRate: num(r.HourlyRate), usualHours: num(r.UsualHours), status: str(r.Status) || "active",
    opening: readOpening(r.OpeningYtd), oldPayId: str(r.OldPayId),
  };
};
/** Year-to-date figures brought in from the previous software (FreshPay or other). */
export function readOpening(v: unknown): { year: number; ytd: Ytd } | null {
  const j = json<Record<string, unknown> | null>(v, null);
  if (!j || !num(j.year)) return null;
  const y = zeroYtd();
  for (const k of ["gross", "taxablePay", "tax", "niEarnings", "ee", "er", "atLel", "lelToPt", "ptToUel", "sl", "pgl", "eePension", "eePensionRas", "erPension", "net"] as const) y[k] = num(j[k]);
  if (!y.gross) y.gross = y.niEarnings || y.taxablePay;
  return { year: num(j.year), ytd: y };
}
const openingFor = (p: PersonRec, year: number): Ytd => (p.opening && p.opening.year === year ? p.opening.ytd : zeroYtd());
export const fullName = (p: PersonRec) => [p.first, p.middle, p.last].filter(Boolean).join(" ") || "Unnamed";
/** The tax week a director was appointed, if it was in this tax year (otherwise the whole year counts). */
export const apptWeekOf = (p: PersonRec, year: number) => (p.director && isDate(p.appointedOn) && taxYearOf(p.appointedOn) === year ? taxWeek(p.appointedOn, year) : 1);
export const setupOf = (p: PersonRec, year: number): PersonSetup => ({
  taxCode: p.taxCode, niLetter: p.niLetter, director: p.director ? { method: p.nicMethod, apptWeek: apptWeekOf(p, year) } : undefined,
  studentPlan: p.studentPlan, postgrad: p.postgrad, pension: p.pension,
});
export const isActive = (p: PersonRec, year: number) => p.status !== "removed" && (!p.leavingDate || taxYearOf(p.leavingDate) >= year);
export function fpsPersonOf(p: PersonRec, year: number, starter: boolean, leaving: boolean, firstHere = false): FpsPerson {
  return {
    oldPayId: firstHere && p.oldPayId ? p.oldPayId : undefined,
    nino: p.nino, title: p.title, first: p.first, middle: p.middle, last: p.last, birthDate: p.dob, gender: (p.gender || "M") as "M" | "F", address: p.address, postcode: p.postcode,
    payId: p.payId, letter: p.niLetter, hours: p.hours, studentPlan: p.studentPlan, postgrad: p.postgrad,
    director: p.director ? { method: p.nicMethod, apptWeek: apptWeekOf(p, year) } : undefined,
    starter: starter && isDate(p.startDate) ? { startDate: p.startDate, declaration: p.startDec || "A", studentLoan: !!p.studentPlan, postgrad: p.postgrad } : undefined,
    leavingDate: leaving ? p.leavingDate : undefined,
  };
}
export function personMissing(p: PersonRec, year: number): string[] {
  const fp = fpsPersonOf(p, year, false, false);
  const out = personProblems({ ...fp, gender: (p.gender || "X") as "M" });
  if (p.startDate && taxYearOf(p.startDate) === year && !p.startDec && !p.director) out.push(`${fullName(p)}: choose the starter declaration (A, B or C) or record their P45.`);
  return out;
}

// ------------------------------------------------------------------ the pay year: paydays and amounts

export type PayYear = { key: string; schemeKey: string; year: number; paydays: string[]; amounts: Record<string, (number | null)[]>; source: string; pattern: string; status: string;
  /** the first period run here; earlier periods were run and reported by the previous software */ startPeriod: number };
export const readYear = (r: Row | undefined, schemeKey: string, year: number, freq: Freq): PayYear => {
  const n = PERIODS[freq];
  const paydays = json<string[]>(r?.Paydays, []);
  return {
    key: str(r?.Key), schemeKey, year, paydays: Array.from({ length: n }, (_, i) => (isDate(str(paydays[i])) ? str(paydays[i]) : "")),
    amounts: json<Record<string, (number | null)[]>>(r?.Amounts, {}), source: str(r?.Source), pattern: str(r?.Pattern), status: str(r?.Status),
    startPeriod: Math.min(n, Math.max(1, num(r?.StartPeriod) || 1)),
  };
};
const iso = (d: Date) => d.toISOString().slice(0, 10);
/** Usual paydays for a year: a fixed day of the month (moved back to the Friday before a weekend), or the last working day. Weekly: a weekday. */
export function defaultPaydays(year: number, freq: Freq, rule: { kind: "day" | "last-working"; day?: number; weekday?: number }): string[] {
  const out: string[] = [];
  if (freq === "M1") {
    for (let m = 1; m <= 12; m++) {
      const { from } = taxMonthDates(year, m);
      const calYear = Number(from.slice(0, 4)), calMonth = Number(from.slice(5, 7));
      const last = new Date(Date.UTC(calYear, calMonth, 0)).getUTCDate();
      let d = new Date(Date.UTC(calYear, calMonth - 1, rule.kind === "last-working" ? last : Math.min(Math.max(6, rule.day || 28), last)));
      while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d = new Date(d.getTime() - 86400000);
      if (iso(d) < from) d = new Date(Date.parse(`${from}T00:00:00Z`));
      out.push(iso(d));
    }
    return out;
  }
  const step = freq === "W1" ? 7 : freq === "W2" ? 14 : 28;
  let d = new Date(Date.UTC(year - 1, 3, 6));
  while (d.getUTCDay() !== (rule.weekday ?? 5)) d = new Date(d.getTime() + 86400000);
  for (let i = 0; i < PERIODS[freq]; i++) { out.push(iso(d)); d = new Date(d.getTime() + step * 86400000); }
  return out;
}
/** A payday must fall in its own pay period, in this tax year. */
export function paydayProblems(year: number, freq: Freq, paydays: string[]): string[] {
  const out: string[] = [];
  paydays.forEach((d, i) => {
    if (!d) return;
    if (taxYearOf(d) !== year) out.push(`Period ${i + 1}: ${d} isn't in this tax year.`);
    else if (freq === "M1" && taxMonth(d) !== i + 1) out.push(`Month ${i + 1}: ${d} falls in tax month ${taxMonth(d)}. Each payday must be in its own tax month (6th to 5th).`);
  });
  return out;
}
/** What a person is paid in each period: the planned amount if there is one, otherwise their usual salary or hours. */
export function amountsFor(p: PersonRec, y: PayYear, freq: Freq): (number | null)[] {
  const n = PERIODS[freq];
  const plan = y.amounts[p.key] || [];
  const usual = p.basis === "salary" ? r2(p.annualSalary / n) : p.basis === "hourly" ? r2(p.hourlyRate * p.usualHours) : 0;
  return Array.from({ length: n }, (_, i) => {
    if (!y.paydays[i] || i + 1 < y.startPeriod) return null;
    if (p.startDate && y.paydays[i] < p.startDate) return null;
    if (p.leavingDate && y.paydays[i] > p.leavingDate) return null;
    const planned = plan[i];
    if (planned !== undefined && planned !== null && Number.isFinite(Number(planned))) return Number(planned) > 0 ? r2(Number(planned)) : null;
    return usual > 0 ? usual : null;
  });
}

// ------------------------------------------------------------------ runs

export type RunLine = { personKey: string; name: string; line: Line };
export type RunRec = { key: string; schemeKey: string; year: number; period: number; payday: string; status: string; lines: RunLine[]; submissionKey: string; approvedBy: string; approvedAt: string };
export const readRun = (r: Row): RunRec => ({ key: str(r.Key), schemeKey: str(r.SchemeKey), year: num(r.TaxYear), period: num(r.Period), payday: str(r.Payday), status: str(r.Status), lines: json<RunLine[]>(r.Lines, []), submissionKey: str(r.SubmissionKey), approvedBy: str(r.ApprovedBy), approvedAt: str(r.ApprovedAt) });
const liveRun = (r: RunRec) => r.status !== "cancelled";

/** Year-to-date before a period for a person: from the last run saved before it. */
export function ytdBefore(runs: RunRec[], personKey: string, period: number): Ytd {
  const prior = runs.filter((r) => liveRun(r) && r.period < period).sort((a, b) => b.period - a.period);
  for (const r of prior) { const l = r.lines.find((x) => x.personKey === personKey); if (l) return l.line.ytd; }
  return zeroYtd();
}

export type PeriodView = { period: number; payday: string; run?: RunRec; lines: RunLine[]; nil: boolean; /** run and reported by the previous software */ elsewhere: boolean; totals: { gross: number; tax: number; ee: number; er: number; net: number; sl: number; pension: number; due: number } };
/** The whole year: saved runs as they are, the rest worked out in advance from the paydays and amounts. */
export function yearView(s: SchemeRec, people: PersonRec[], y: PayYear, runs: RunRec[]): { periods: PeriodView[]; errors: string[] } {
  const n = PERIODS[s.freq], errors: string[] = [];
  const mine = runs.filter((r) => r.schemeKey === s.key && r.year === y.year && liveRun(r));
  const active = people.filter((p) => isActive(p, y.year));
  const ytd = new Map<string, Ytd>(active.map((p) => [p.key, openingFor(p, y.year)]));
  const amounts = new Map(active.map((p) => [p.key, amountsFor(p, y, s.freq)]));
  const periods: PeriodView[] = [];
  for (let i = 1; i <= n; i++) {
    const run = mine.find((r) => r.period === i);
    let lines: RunLine[] = [];
    if (run) lines = run.lines;
    else {
      for (const p of active) {
        const a = amounts.get(p.key)![i - 1];
        if (!a) continue;
        const l = payLine(setupOf(p, y.year), { basic: a }, s.freq, i, ytd.get(p.key) || zeroYtd(), y.year);
        if ("error" in l) { if (!errors.includes(`${fullName(p)}: ${l.error}`)) errors.push(`${fullName(p)}: ${l.error}`); continue; }
        lines.push({ personKey: p.key, name: fullName(p), line: l });
      }
    }
    for (const l of lines) ytd.set(l.personKey, l.line.ytd);
    const t = lines.reduce((a, { line: l }) => ({ gross: a.gross + l.gross, tax: a.tax + l.tax, ee: a.ee + l.ee, er: a.er + l.er, net: a.net + l.net, sl: a.sl + l.sl + l.pgl, pension: a.pension + l.eePension + l.eePensionRas + l.erPension }), { gross: 0, tax: 0, ee: 0, er: 0, net: 0, sl: 0, pension: 0 });
    const totals = { gross: r2(t.gross), tax: r2(t.tax), ee: r2(t.ee), er: r2(t.er), net: r2(t.net), sl: r2(t.sl), pension: r2(t.pension), due: r2(t.tax + t.ee + t.er + t.sl) };
    const elsewhere = i < y.startPeriod && !run;
    periods.push({ period: i, payday: run?.payday || y.paydays[i - 1], run, lines, nil: !lines.length && !elsewhere, elsewhere, totals });
  }
  return { periods, errors };
}
/** The last period of the year anyone is paid in (its FPS is marked final); 0 if nobody is paid at all. */
export const lastPaidPeriod = (v: PeriodView[]) => v.filter((p) => !p.nil).reduce((a, p) => Math.max(a, p.period), 0);

// ------------------------------------------------------------------ approving a run and queuing what goes to HMRC

export type Queued = { runRow?: Row; submissions: Row[] };
export type Ctx = { actor: string; now: string; pid: string; newKey: (p: string) => string };

const submission = (s: SchemeRec, o: Ctx, kind: "FPS" | "EPS", year: number, period: number, sendOn: string, body: string, summary: string, runKey = ""): Row => ({
  Key: o.newKey("RTI"), PracticeId: o.pid, SchemeKey: s.key, ClientKey: s.clientKey, Kind: kind, TaxYear: year, Period: period, SendOn: sendOn, Status: "queued",
  OfficeNo: s.officeNo, PayeRef: s.payeRef, Body: body, Summary: summary, IRmark: "", CorrelationID: "", PollUrl: "", Response: "", Errors: "", Attempts: 0, SubmittedAt: "", AnsweredAt: "", Live: "", RunKey: runKey, Created: o.now, CreatedBy: o.actor,
});

/** Approve a period: save its lines and queue the FPS for its payday (and the Employment Allowance claim with the first one, if claimed). */
export function approveRun(s: SchemeRec, people: PersonRec[], y: PayYear, runs: RunRec[], subs: Row[], period: number, can: boolean, o: Ctx): Queued | { error: string } {
  if (!can) return { error: "Only a manager or partner can approve payroll." };
  const sp = schemeProblems(s); if (sp.length) return { error: sp.join(" ") };
  const view = yearView(s, people, y, runs);
  if (view.errors.length) return { error: view.errors.join(" ") };
  const pv = view.periods[period - 1];
  if (!pv) return { error: "That period doesn't exist." };
  if (pv.run) return { error: "This period has already been approved." };
  if (!pv.payday) return { error: "Set a payday for this period first." };
  if (pv.nil) return { error: "Nobody is paid this period. Queue a nil EPS instead." };
  if (period < y.startPeriod) return { error: `Periods before ${y.startPeriod} were run in the previous software.` };
  const earlier = view.periods.filter((p) => p.period < period && !p.nil && !p.run && !p.elsewhere);
  if (earlier.length) return { error: `Approve period ${earlier[0].period} first.` };
  const byKey = new Map(people.map((p) => [p.key, p]));
  const problems = pv.lines.flatMap((l) => personMissing(byKey.get(l.personKey)!, y.year));
  if (problems.length) return { error: problems.join(" ") };
  const mineRuns = runs.filter((r) => r.schemeKey === s.key && r.year === y.year && liveRun(r));
  const reported = new Set(mineRuns.flatMap((r) => r.lines.map((l) => l.personKey)));
  const fpsPeople = pv.lines.map((l) => {
    const p = byKey.get(l.personKey)!;
    const starter = !reported.has(p.key) && !!p.startDate && taxYearOf(p.startDate) === y.year;
    const leaving = !!p.leavingDate && p.leavingDate <= (view.periods[period]?.payday || "9999-12-31") && taxYearOf(p.leavingDate) === y.year;
    return { person: fpsPersonOf(p, y.year, starter && !(p.opening && p.opening.year === y.year), leaving, !reported.has(p.key)), line: l.line };
  });
  const final = period === lastPaidPeriod(view.periods) && view.periods.slice(period).every((p) => p.nil);
  const body = buildFps({ scheme: s, year: y.year, freq: s.freq, period, payday: pv.payday, people: fpsPeople, final });
  const runKey = o.newKey("RUN");
  const fps = submission(s, o, "FPS", y.year, period, pv.payday, body, `Period ${period}, paid ${pv.payday}: ${pv.lines.length} ${pv.lines.length === 1 ? "person" : "people"}, gross £${pv.totals.gross.toFixed(2)}${final ? " (final for the year)" : ""}`, runKey);
  const out: Row[] = [fps];
  const firstPaid = !mineRuns.length && y.startPeriod <= 1;
  if (firstPaid && s.claimEA && !subs.some((x) => str(x.SchemeKey) === s.key && num(x.TaxYear) === y.year && str(x.Kind) === "EPS" && str(x.Summary).startsWith("Employment Allowance") && str(x.Status) !== "cancelled")) {
    out.push(submission(s, o, "EPS", y.year, period, pv.payday, buildEps({ scheme: s, year: y.year, employmentAllowance: true }), "Employment Allowance claim for the year"));
  }
  return {
    runRow: { Key: runKey, PracticeId: o.pid, SchemeKey: s.key, TaxYear: y.year, Period: period, Payday: pv.payday, Status: "approved", Lines: JSON.stringify(pv.lines), Totals: JSON.stringify(pv.totals), SubmissionKey: fps.Key, ApprovedBy: o.actor, ApprovedAt: o.now, Created: o.now, Updated: o.now },
    submissions: out,
  };
}

/** Nil EPS for every month nobody is paid, each to go on the 6th after its tax month ends; ones already queued are left alone. */
export function queueNilEps(s: SchemeRec, people: PersonRec[], y: PayYear, runs: RunRec[], subs: Row[], can: boolean, o: Ctx): Queued | { error: string } {
  if (!can) return { error: "Only a manager or partner can queue submissions." };
  if (s.freq !== "M1") return { error: "Nil EPS are worked out by tax month; this payroll isn't monthly." };
  const sp = schemeProblems(s); if (sp.length) return { error: sp.join(" ") };
  const view = yearView(s, people, y, runs);
  const last = lastPaidPeriod(view.periods);
  const have = new Set(subs.filter((x) => str(x.SchemeKey) === s.key && num(x.TaxYear) === y.year && str(x.Kind) === "EPS" && str(x.Summary).startsWith("Nil EPS") && str(x.Status) !== "cancelled").map((x) => num(x.Period)));
  const out: Row[] = [];
  for (const p of view.periods) {
    if (!p.nil || p.elsewhere || have.has(p.period)) continue;
    const { to } = taxMonthDates(y.year, p.period);
    const sendOn = iso(new Date(Date.parse(`${to}T00:00:00Z`) + 86400000));
    const final = p.period === 12 && last < 12;
    out.push(submission(s, o, "EPS", y.year, p.period, sendOn, buildEps({ scheme: s, year: y.year, noPaymentMonth: p.period, final }), `Nil EPS for tax month ${p.period}${final ? " (final for the year)" : ""}`));
  }
  if (!out.length) return { error: "Every month without pay already has a nil EPS queued." };
  return { submissions: out };
}

/** Undo an approval that hasn't gone to HMRC yet. */
export function cancelRun(run: RunRec, sub: Row | undefined, can: boolean): { patches: { list: "PayRuns" | "RtiSubmissions"; row: Row; patch: Row }[] } | { error: string } {
  if (!can) return { error: "Only a manager or partner can do that." };
  if (sub && !["queued", "failed", "rejected"].includes(str(sub.Status))) return { error: "This has already been sent to HMRC. Correct it in the next period's FPS instead." };
  return { patches: [...(sub ? [{ list: "RtiSubmissions" as const, row: sub, patch: { Status: "cancelled" } }] : []), { list: "PayRuns", row: { Key: run.key } as Row, patch: { Status: "cancelled" } }] };
}

// ------------------------------------------------------------------ building the year from an agreed tax plan

/** Monthly amounts for each director from their planned annual salary: spread over the paydays, or all in the last month. */
export function planAmounts(salaries: { personKey: string; annual: number }[], y: PayYear, pattern: "spread" | "yearEnd"): Record<string, (number | null)[]> {
  const n = y.paydays.length;
  const out: Record<string, (number | null)[]> = {};
  for (const s of salaries) {
    if (pattern === "yearEnd") { out[s.personKey] = Array.from({ length: n }, (_, i) => (i === n - 1 ? r2(s.annual) : 0)); continue; }
    const paid = y.paydays.map((d, i) => (d ? i : -1)).filter((i) => i >= 0);
    const each = paid.length ? Math.floor(s.annual / paid.length * 100) / 100 : 0;
    const arr: (number | null)[] = Array.from({ length: n }, () => 0);
    paid.forEach((i, k) => { arr[i] = k === paid.length - 1 ? r2(s.annual - each * (paid.length - 1)) : each; });
    out[s.personKey] = arr;
  }
  return out;
}
