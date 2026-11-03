import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import * as rec from "../src/lib/payroll/records.ts";

const Y = 2027;
let n = 0;
const O = { actor: "Kevin", now: "2026-11-03T10:00:00.000Z", pid: "default", newKey: (p: string) => `${p}${++n}` };
const schemeRow = { Key: "S1", ClientKey: "C1", Name: "Example Trading Ltd", OfficeNo: "123", PayeRef: "AB45678", AORef: "123PA00045678", Freq: "M1", ClaimEA: "yes", Status: "active" };
const alexRow = { Key: "P1", SchemeKey: "S1", First: "Alex", Last: "Example", NINO: "AB123456C", DOB: "1980-05-01", Gender: "M", Address: "1 High Street\nLeeds", Postcode: "LS1 1AA", PayId: "001", Director: "yes", NicMethod: "AN", TaxCode: "1257L", NiLetter: "A", PayBasis: "plan", Status: "active" };
const samRow = { Key: "P2", SchemeKey: "S1", First: "Sam", Last: "Example", NINO: "AB654321D", DOB: "1985-02-03", Gender: "F", Address: "1 High Street", Postcode: "LS1 1AA", PayId: "002", Director: "yes", NicMethod: "AN", TaxCode: "1257L", NiLetter: "A", PayBasis: "plan", Status: "active" };
const s = rec.readScheme(schemeRow);
const people = [rec.readPerson(alexRow), rec.readPerson(samRow)];

test("usual paydays: a fixed day moved back off weekends, always inside its tax month", () => {
  const days = rec.defaultPaydays(Y, "M1", { kind: "day", day: 28 });
  assert.equal(days.length, 12);
  assert.equal(days[0], "2026-04-28");
  assert.equal(days[10], "2027-02-26"); // 28 Feb 2027 is a Sunday
  assert.deepEqual(rec.paydayProblems(Y, "M1", days), []);
  const last = rec.defaultPaydays(Y, "M1", { kind: "last-working" });
  assert.equal(last[11], "2027-03-31");
  assert.ok(rec.paydayProblems(Y, "M1", ["2026-05-10", ...Array(11).fill("")]).length === 1);
  assert.equal(rec.defaultPaydays(Y, "W1", { kind: "day", weekday: 5 }).length, 52);
});

test("a tax plan becomes monthly amounts: spread or all at the year end", () => {
  const y = { ...rec.readYear(undefined, "S1", Y, "M1"), paydays: rec.defaultPaydays(Y, "M1", { kind: "day", day: 28 }) };
  const spread = rec.planAmounts([{ personKey: "P1", annual: 12570 }], y, "spread");
  assert.equal(spread.P1.length, 12);
  assert.equal(spread.P1[0], 1047.5);
  assert.equal(Math.round(spread.P1.reduce((a: number, v) => a + (v || 0), 0) * 100) / 100, 12570);
  const end = rec.planAmounts([{ personKey: "P1", annual: 12570 }], y, "yearEnd");
  assert.deepEqual(end.P1.slice(0, 11), Array(11).fill(0));
  assert.equal(end.P1[11], 12570);
});

test("the year view works out every month in advance", () => {
  const y = { ...rec.readYear(undefined, "S1", Y, "M1"), paydays: rec.defaultPaydays(Y, "M1", { kind: "day", day: 28 }) };
  y.amounts = rec.planAmounts([{ personKey: "P1", annual: 12570 }, { personKey: "P2", annual: 12570 }], y, "spread");
  const v = rec.yearView(s, people, y, []);
  assert.equal(v.periods.length, 12);
  assert.equal(v.periods[11].lines[0].line.ytd.er, 1135.5);
  assert.equal(v.periods.every((p) => !p.nil), true);
});

test("approving a run queues the FPS for payday, and the Employment Allowance claim with the first", () => {
  const y = { ...rec.readYear(undefined, "S1", Y, "M1"), paydays: rec.defaultPaydays(Y, "M1", { kind: "day", day: 28 }) };
  y.amounts = rec.planAmounts([{ personKey: "P1", annual: 12570 }, { personKey: "P2", annual: 12570 }], y, "spread");
  assert.ok("error" in rec.approveRun(s, people, y, [], [], 2, true, O)); // month 1 first
  assert.ok("error" in rec.approveRun(s, people, y, [], [], 1, false, O));
  const q = rec.approveRun(s, people, y, [], [], 1, true, O) as rec.Queued;
  assert.equal(q.submissions.length, 2);
  assert.equal(q.submissions[0].Kind, "FPS");
  assert.equal(q.submissions[0].SendOn, "2026-04-28");
  assert.equal(q.submissions[0].Status, "queued");
  assert.match(String(q.submissions[0].Body), /<MonthNo>1<\/MonthNo>/);
  assert.match(String(q.submissions[1].Body), /<EmpAllceInd>yes<\/EmpAllceInd>/);
  // validate the queued FPS against HMRC's schema where xmllint is available
  try { execFileSync("xmllint", ["--version"], { stdio: "ignore" }); } catch { return; }
  const tmp = `${process.env.TMPDIR || "/tmp"}/fps-${Date.now()}.xml`;
  writeFileSync(tmp, String(q.submissions[0].Body));
  execFileSync("xmllint", ["--noout", "--schema", `${import.meta.dirname}/rti/FullPaymentSubmission-2027-v1-0.xsd`, tmp], { stdio: "pipe" });
});

test("the next run carries on from the saved year to date", () => {
  const y = { ...rec.readYear(undefined, "S1", Y, "M1"), paydays: rec.defaultPaydays(Y, "M1", { kind: "day", day: 28 }) };
  y.amounts = rec.planAmounts([{ personKey: "P1", annual: 36000 }], y, "spread");
  const one = [people[0]];
  const q1 = rec.approveRun(s, one, y, [], [], 1, true, O) as rec.Queued;
  const runs = [rec.readRun(q1.runRow!)];
  const v = rec.yearView(s, one, y, runs);
  assert.equal(v.periods[1].lines[0].line.ytd.gross, 6000);
  const q2 = rec.approveRun(s, one, y, runs, q1.submissions, 2, true, O) as rec.Queued;
  assert.equal(q2.submissions.length, 1); // allowance already claimed
});

test("year-end salary: nil EPS for the empty months, final flag on the last FPS", () => {
  const y = { ...rec.readYear(undefined, "S1", Y, "M1"), paydays: rec.defaultPaydays(Y, "M1", { kind: "day", day: 28 }) };
  y.amounts = rec.planAmounts([{ personKey: "P1", annual: 12570 }], y, "yearEnd");
  const one = [people[0]];
  const nil = rec.queueNilEps(s, one, y, [], [], true, O) as rec.Queued;
  assert.equal(nil.submissions.length, 11);
  assert.equal(nil.submissions[0].SendOn, "2026-05-06");
  assert.match(String(nil.submissions[0].Body), /<NoPaymentForPeriod>yes<\/NoPaymentForPeriod>/);
  assert.ok("error" in rec.queueNilEps(s, one, y, [], nil.submissions, true, O));
  const run = rec.approveRun(s, one, y, [], nil.submissions, 12, true, O) as rec.Queued;
  assert.match(String(run.submissions[0].Body), /<FinalSubmission><ForYear>yes<\/ForYear><\/FinalSubmission>/);
  assert.match(String(run.submissions[0].Body), /<TaxDeductedOrRefunded>0.00<\/TaxDeductedOrRefunded>/);
});

test("missing details stop approval", () => {
  const y = { ...rec.readYear(undefined, "S1", Y, "M1"), paydays: rec.defaultPaydays(Y, "M1", { kind: "day", day: 28 }) };
  y.amounts = { P1: Array(12).fill(1000) };
  const bad = [rec.readPerson({ ...alexRow, Gender: "", DOB: "" })];
  const r = rec.approveRun(s, bad, y, [], [], 1, true, O);
  assert.ok("error" in r && /date of birth/.test(r.error));
  assert.ok("error" in rec.approveRun(rec.readScheme({ ...schemeRow, AORef: "x" }), people, y, [], [], 1, true, O));
});

test("a run that hasn't gone to HMRC can be cancelled; one that has can't", () => {
  const run = rec.readRun({ Key: "R1", SchemeKey: "S1", TaxYear: Y, Period: 1, Status: "approved", Lines: "[]" });
  assert.ok(!("error" in rec.cancelRun(run, { Key: "X", Status: "queued" }, true)));
  assert.ok("error" in rec.cancelRun(run, { Key: "X", Status: "accepted" }, true));
});

test("moving from FreshPay part-way through the year: earlier months stay there, the year to date carries on", () => {
  const y = { ...rec.readYear({ StartPeriod: 8 }, "S1", Y, "M1"), paydays: rec.defaultPaydays(Y, "M1", { kind: "day", day: 28 }) };
  y.amounts = { P1: Array(12).fill(3000) };
  const moved = [rec.readPerson({ ...alexRow, PayId: "X1", OldPayId: "FP-17", OpeningYtd: JSON.stringify({ year: Y, gross: 21000, taxablePay: 21000, tax: 2733.4, niEarnings: 21000, ee: 674.4, er: 2400, atLel: 6708, lelToPt: 5862, ptToUel: 8430 }) })];
  const v = rec.yearView(s, moved, y, []);
  assert.equal(v.periods[6].elsewhere, true);
  assert.equal(v.periods[6].nil, false);
  assert.equal(v.periods[7].lines[0].line.ytd.gross, 24000);
  assert.ok("error" in rec.approveRun(s, moved, y, [], [], 7, true, O));
  const q = rec.approveRun(s, moved, y, [], [], 8, true, O) as rec.Queued;
  assert.equal(q.submissions.length, 1); // no Employment Allowance EPS: the old software claimed it for the year
  assert.match(String(q.submissions[0].Body), /<PayIdChgd><PayrollIdChangedIndicator>yes<\/PayrollIdChangedIndicator><OldPayrollId>FP-17<\/OldPayrollId><\/PayIdChgd>/);
  assert.match(String(q.submissions[0].Body), /<GrossEarningsForNICsYTD>24000.00<\/GrossEarningsForNICsYTD>/);
  const nil = rec.queueNilEps(s, moved, { ...y, amounts: { P1: [...Array(11).fill(3000), 0] } }, [], [], true, O) as rec.Queued;
  assert.equal(nil.submissions.length, 1); // only month 12; months before 8 were the old software's
  try { execFileSync("xmllint", ["--version"], { stdio: "ignore" }); } catch { return; }
  const tmp = `${process.env.TMPDIR || "/tmp"}/fps-move-${Date.now()}.xml`;
  writeFileSync(tmp, String(q.submissions[0].Body));
  execFileSync("xmllint", ["--noout", "--schema", `${import.meta.dirname}/rti/FullPaymentSubmission-2027-v1-0.xsd`, tmp], { stdio: "pipe" });
});

const validFps = (xml: string, xsd = "FullPaymentSubmission-2027-v1-0.xsd") => {
  try { execFileSync("xmllint", ["--version"], { stdio: "ignore" }); } catch { return; }
  const tmp = `${process.env.TMPDIR || "/tmp"}/rti-${Date.now()}-${Math.random().toString(36).slice(2)}.xml`;
  writeFileSync(tmp, xml);
  execFileSync("xmllint", ["--noout", "--schema", `${import.meta.dirname}/rti/${xsd}`, tmp], { stdio: "pipe" });
};
const yearWith = (amounts: Record<string, (number | null)[]>, extras = {}) => ({ ...rec.readYear(undefined, "S1", Y, "M1"), paydays: rec.defaultPaydays(Y, "M1", { kind: "day", day: 28 }), amounts, extras });

test("statutory maternity pay in a period: on the FPS year to date, and claimed back on an EPS", () => {
  const emp = [rec.readPerson({ ...samRow, Director: "no", PayBasis: "salary", AnnualSalary: 30000, Hours: "D" })];
  const y = yearWith({}, { P2: { "1": { smp: 1080 } } });
  const q = rec.approveRun({ ...s, smallEmployer: true }, emp, y, [], [{ SchemeKey: "S1", TaxYear: Y, Kind: "EPS", Summary: "Employment Allowance claim for the year", Status: "queued" }], 1, true, O) as rec.Queued;
  assert.match(String(q.submissions[0].Body), /<SMPYTD>1080.00<\/SMPYTD>/);
  const eps = q.submissions.find((x) => String(x.Summary).startsWith("Statutory pay recovery"))!;
  assert.match(String(eps.Body), /<SMPRecovered>1080.00<\/SMPRecovered><NICCompensationOnSMP>97.20<\/NICCompensationOnSMP>/);
  validFps(String(q.submissions[0].Body));
  validFps(String(eps.Body), "EmployerPaymentSummary-2027-v1-0.xsd");
});

test("benefits taxed through the payroll appear on the FPS", () => {
  const p1 = [rec.readPerson({ ...alexRow, Benefits: JSON.stringify([{ year: Y, label: "Car", annual: 3600 }]) })];
  const q = rec.approveRun(s, p1, yearWith({ P1: Array(12).fill(3000) }), [], [], 1, true, O) as rec.Queued;
  assert.match(String(q.submissions[0].Body), /<BenefitsTaxedViaPayroll>300.00<\/BenefitsTaxedViaPayroll>/);
  assert.match(String(q.submissions[0].Body), /<BenefitsTaxedViaPayrollYTD>300.00<\/BenefitsTaxedViaPayrollYTD>/);
  validFps(String(q.submissions[0].Body));
});

test("auto-enrolment: no pension until enrolled; an opt-out within the month gets the contributions back", () => {
  const pen = JSON.stringify({ kind: "netpay", eePct: 5, erPct: 3, basis: "qualifying" });
  const assessing = [rec.readPerson({ ...samRow, Director: "no", PayBasis: "salary", AnnualSalary: 30000, Pension: pen, AeStatus: "assess" })];
  const v1 = rec.yearView(s, assessing, yearWith({}), []);
  assert.equal(v1.periods[0].lines[0].line.eePension, 0);
  const rep = rec.aeReport(s, assessing, v1.periods, Y);
  assert.equal(rep[0].action, "enrol");
  const enrolled = [rec.readPerson({ ...samRow, Director: "no", PayBasis: "salary", AnnualSalary: 30000, Pension: pen, AeStatus: "opted-out", AeDate: "2026-04-28", AeOptOut: "2026-05-20" })];
  const v2 = rec.yearView(s, enrolled, yearWith({}), []);
  assert.ok(v2.periods[0].lines[0].line.eePension > 0);
  assert.equal(v2.periods[1].lines[0].line.eePension, -v2.periods[0].lines[0].line.eePension);
  assert.equal(v2.periods[2].lines[0].line.eePension, 0);
});

test("an attachment of earnings order comes off net pay, carrying arrears", () => {
  const orders = JSON.stringify([{ id: "a", kind: "aeo", ref: "K12", normal: 300, protected: 1700, carryArrears: true, fee: true, start: "2026-04-01" }]);
  const p = [rec.readPerson({ ...samRow, Director: "no", PayBasis: "salary", AnnualSalary: 24000, Orders: orders })];
  const v = rec.yearView(s, p, yearWith({}, { P2: { "2": { bonus: 1000 } } }), []);
  const m1 = v.periods[0].lines[0].line, m2 = v.periods[1].lines[0].line;
  assert.ok(m1.orders![0].amount < 300 && m1.orders![0].shortfall > 0);
  assert.equal(m2.orders![0].amount, Math.round((300 + m1.orders![0].shortfall) * 100) / 100);
  assert.equal(m2.orders![0].fee, 1);
  assert.equal(m1.net, Math.round((m1.payAfterStatDedns - m1.orders![0].amount - m1.orders![0].fee) * 100) / 100);
});
