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
