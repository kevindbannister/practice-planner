import test from "node:test";
import assert from "node:assert/strict";
import * as ae from "../src/lib/payroll/autoEnrol.ts";
import * as od from "../src/lib/payroll/orders.ts";

const Y = 2027;
test("auto-enrolment: eligible, non-eligible, entitled, directors, postponement", () => {
  const base = { dob: "1990-01-01", payday: "2026-11-28", freq: "M1" as const, year: Y, director: false, hasContract: true, otherContracts: true, status: "assess" as const };
  assert.equal(ae.assess({ ...base, earnings: 2000 }).action, "enrol");
  assert.equal(ae.assess({ ...base, earnings: 700 }).category, "non-eligible");
  assert.equal(ae.assess({ ...base, earnings: 400 }).category, "entitled");
  assert.equal(ae.assess({ ...base, earnings: 2000, dob: "2006-01-01" }).category, "non-eligible"); // aged 20
  assert.equal(ae.assess({ ...base, earnings: 2000, director: true, hasContract: false }).category, "exempt");
  assert.equal(ae.assess({ ...base, earnings: 2000, status: "postponed", postponeUntil: "2026-12-31" }).action, "none");
  assert.equal(ae.assess({ ...base, earnings: 2000, status: "enrolled" }).action, "none");
});
test("State Pension age and age on payday", () => {
  assert.equal(ae.statePensionAgeDate("1955-05-01"), "2021-05-01");
  assert.equal(ae.statePensionAgeDate("1965-05-01"), "2032-05-01");
  assert.equal(ae.ageOn("1990-11-29", "2026-11-28"), 35);
});
test("pension is taken only once enrolled, and stops on an opt-out; a refund is due within a month", () => {
  assert.equal(ae.pensionApplies("", "", "", "2026-11-28"), true);
  assert.equal(ae.pensionApplies("assess", "", "", "2026-11-28"), false);
  assert.equal(ae.pensionApplies("enrolled", "2026-12-01", "", "2026-11-28"), false);
  assert.equal(ae.pensionApplies("opted-out", "2026-10-01", "2026-10-20", "2026-11-28"), false);
  assert.equal(ae.optOutRefundable("2026-10-01", "2026-10-25"), true);
  assert.equal(ae.optOutRefundable("2026-10-01", "2026-11-25"), false);
});
test("council tax attachment (England) by the table", () => {
  assert.equal(od.councilTaxDeduction(1000, "M1"), 120);
  assert.equal(od.councilTaxDeduction(250, "M1"), 0);
  assert.equal(od.councilTaxDeduction(2500, "M1"), 583.4);
  assert.equal(od.councilTaxDeduction(300, "W1"), 36);
});
test("attachment orders: protected earnings, arrears carried, fee, cap", () => {
  const o = od.readOrders(JSON.stringify([{ id: "a", kind: "aeo", normal: 200, protected: 1200, carryArrears: true, fee: true, start: "2026-04-01", cap: 1000 }]));
  const r1 = od.applyOrders(o, 1300, "M1", "2026-11-28", {});
  assert.deepEqual(r1[0], { id: "a", label: "Attachment of earnings order (court)", amount: 100, fee: 0, shortfall: 100 });
  const r2 = od.applyOrders(o, 2000, "M1", "2026-12-28", { a: { arrears: 100, collected: 100 } });
  assert.equal(r2[0].amount, 300); assert.equal(r2[0].fee, 1);
  const r3 = od.applyOrders(o, 2000, "M1", "2027-01-28", { a: { arrears: 0, collected: 950 } });
  assert.equal(r3[0].amount, 50);
  assert.equal(od.applyOrders(o, 2000, "M1", "2026-03-01", {}).length, 0);
});
