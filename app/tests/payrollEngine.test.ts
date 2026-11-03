import test from "node:test";
import assert from "node:assert/strict";
import * as e from "../src/lib/payroll/engine.ts";

const Y = 2027;
const emp = (o: Partial<e.PersonSetup> = {}): e.PersonSetup => ({ taxCode: "1257L", niLetter: "A", pension: { kind: "none", eePct: 0, erPct: 0, basis: "qualifying" }, ...o });
const ok = (l: ReturnType<typeof e.payLine>) => { assert.ok(!("error" in l), JSON.stringify(l)); return l as e.Line; };

test("tax codes are read with their prefix and week 1 / month 1 marker", () => {
  assert.deepEqual([e.parseCode("1257L")!.kind, e.parseCode("1257L")!.number, e.parseCode("1257L")!.nonCum], ["L", 1257, false]);
  assert.equal(e.parseCode("S1257L")!.regime, "S");
  assert.equal(e.parseCode("C1257L")!.regime, "C");
  assert.equal(e.parseCode("1257L M1")!.nonCum, true);
  assert.equal(e.parseCode("1257L X")!.nonCum, true);
  assert.equal(e.parseCode("1257LW1")!.nonCum, true);
  assert.equal(e.parseCode("K475")!.kind, "K");
  assert.equal(e.parseCode("SD2")!.kind, "D2");
  assert.equal(e.parseCode("D2"), null);
  assert.equal(e.parseCode("BR")!.fps, "BR");
  assert.equal(e.parseCode("0T M1")!.kind, "0T");
  assert.equal(e.parseCode("NT")!.kind, "NT");
  assert.equal(e.parseCode("hello"), null);
});

test("an employee on £2,500 a month, 1257L, category A", () => {
  const m1 = ok(e.payLine(emp(), { basic: 2500 }, "M1", 1, e.zeroYtd(), Y));
  assert.equal(m1.tax, 290.2);
  assert.equal(m1.ee, 116.16);
  assert.equal(m1.er, 312.45);
  assert.equal(m1.net, 2093.64);
  assert.deepEqual(m1.bands, { atLel: 559, lelToPt: 489, ptToUel: 1452 });
  const m2 = ok(e.payLine(emp(), { basic: 2500 }, "M1", 2, m1.ytd, Y));
  assert.equal(m2.tax, 290.4);
  assert.equal(m2.ytd.tax, 580.6);
});

test("week 1 / month 1 taxes each period on its own", () => {
  const ytd = { ...e.zeroYtd(), taxablePay: 10000, tax: 0 };
  const l = ok(e.payLine(emp({ taxCode: "1257L M1" }), { basic: 2500 }, "M1", 6, ytd, Y));
  assert.equal(l.tax, 290.2);
});

test("Scottish rates", () => {
  const l = ok(e.payLine(emp({ taxCode: "S1257L" }), { basic: 2500 }, "M1", 1, e.zeroYtd(), Y));
  assert.equal(l.tax, 287.27);
});

test("K codes add to pay and are limited to half the period's pay", () => {
  const l = ok(e.payLine(emp({ taxCode: "K500" }), { basic: 1000 }, "M1", 1, e.zeroYtd(), Y));
  assert.equal(l.tax, 283.4);
  const capped = ok(e.payLine(emp({ taxCode: "K5000" }), { basic: 600 }, "M1", 1, e.zeroYtd(), Y));
  assert.equal(capped.tax, 300);
});

test("BR, D0, NT and 0T", () => {
  assert.equal(ok(e.payLine(emp({ taxCode: "BR" }), { basic: 1000 }, "M1", 1, e.zeroYtd(), Y)).tax, 200);
  assert.equal(ok(e.payLine(emp({ taxCode: "D0" }), { basic: 1000 }, "M1", 1, e.zeroYtd(), Y)).tax, 400);
  assert.equal(ok(e.payLine(emp({ taxCode: "NT" }), { basic: 1000 }, "M1", 1, e.zeroYtd(), Y)).tax, 0);
  assert.equal(ok(e.payLine(emp({ taxCode: "0T" }), { basic: 1000 }, "M1", 1, e.zeroYtd(), Y)).tax, 200);
});

test("a director on the annual basis at £12,570 a year pays no employee NI and £1,135.50 employer NI", () => {
  const s = emp({ director: { method: "AN", apptWeek: 1 } });
  const lines = e.projectYear(s, Array(12).fill(1047.5), "M1", Y);
  const last = lines[11]!;
  assert.equal(last.ytd.ee, 0);
  assert.equal(last.ytd.er, 1135.5);
  assert.equal(last.ytd.tax, 0);
  assert.equal(lines[3]!.er, 0); // year to date still under £5,000
});

test("a director on the annual basis above the threshold pays NI only once the year's pay passes it", () => {
  const s = emp({ director: { method: "AN", apptWeek: 1 } });
  const lines = e.projectYear(s, Array(12).fill(3000), "M1", Y);
  assert.equal(lines[3]!.ee, 0);
  assert.equal(lines[4]!.ee, 194.4);
  assert.equal(lines[11]!.ytd.ee, Math.round((36000 - 12570) * 0.08 * 100) / 100);
});

test("all the salary at the year end: no tax on £12,570 with a cumulative code", () => {
  const s = emp({ director: { method: "AN", apptWeek: 1 } });
  const lines = e.projectYear(s, [...Array(11).fill(null), 12570], "M1", Y);
  assert.equal(lines[11]!.tax, 0);
  assert.equal(lines[11]!.ee, 0);
  assert.equal(lines[11]!.er, 1135.5);
  assert.equal(lines.filter(Boolean).length, 1);
  const m1 = e.projectYear({ ...s, taxCode: "1257L M1" }, [...Array(11).fill(null), 12570], "M1", Y);
  assert.ok(m1[11]!.tax > 3000);
});

test("a director appointed part-way through the year gets pro-rata thresholds", () => {
  const t = e.directorThresholds(Y, 27);
  assert.equal(t.pt, Math.ceil(242 * 26));
  assert.equal(e.directorThresholds(Y, 1).pt, 12570);
});

test("an alternative-method director is checked on the annual basis at the year end", () => {
  const s = emp({ director: { method: "AL", apptWeek: 1 } });
  const amounts = [...Array(11).fill(500), 30000];
  const lines = e.projectYear(s, amounts, "M1", Y);
  const annualEe = Math.round((35500 - 12570) * 0.08 * 100) / 100;
  assert.equal(lines[11]!.ytd.ee, annualEe);
});

test("student and postgraduate loans", () => {
  const l = ok(e.payLine(emp({ studentPlan: "plan2", postgrad: true }), { basic: 3000 }, "M1", 1, e.zeroYtd(), Y));
  assert.equal(l.sl, 49);
  assert.equal(l.pgl, 75);
});

test("pension: net pay arrangement reduces taxable pay, relief at source comes off net pay at 80%", () => {
  const np = ok(e.payLine(emp({ pension: { kind: "netpay", eePct: 5, erPct: 3, basis: "qualifying" } }), { basic: 2500 }, "M1", 1, e.zeroYtd(), Y));
  assert.equal(np.eePension, 99);
  assert.equal(np.taxablePay, 2401);
  assert.equal(np.erPension, 59.4);
  const ras = ok(e.payLine(emp({ pension: { kind: "ras", eePct: 5, erPct: 3, basis: "qualifying" } }), { basic: 2500 }, "M1", 1, e.zeroYtd(), Y));
  assert.equal(ras.eePensionRas, 79.2);
  assert.equal(ras.taxablePay, 2500);
});

test("under-21s have no employer NI up to the upper threshold", () => {
  const l = ok(e.payLine(emp({ niLetter: "M" }), { basic: 2500 }, "M1", 1, e.zeroYtd(), Y));
  assert.equal(l.er, 0);
  assert.equal(l.ee, 116.16);
});

test("tax weeks and months", () => {
  assert.equal(e.taxMonth("2026-04-06"), 1);
  assert.equal(e.taxMonth("2026-05-05"), 1);
  assert.equal(e.taxMonth("2026-05-06"), 2);
  assert.equal(e.taxMonth("2027-03-31"), 12);
  assert.equal(e.taxMonth("2027-04-05"), 12);
  assert.equal(e.taxWeek("2026-04-06", Y), 1);
  assert.equal(e.taxWeek("2026-04-13", Y), 2);
  assert.equal(e.taxYearOf("2027-04-05"), 2027);
  assert.equal(e.taxYearOf("2027-04-06"), 2028);
});

test("half pennies round down for NI", () => {
  assert.equal(e.halfDown(1.005), 1);
  assert.equal(e.halfDown(1.0051), 1.01);
});
