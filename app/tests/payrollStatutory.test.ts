import test from "node:test";
import assert from "node:assert/strict";
import * as st from "../src/lib/payroll/statutory.ts";

const Y = 2027;
test("average weekly earnings", () => {
  assert.equal(st.averageWeekly(5200, "M1", 2), 600);
  assert.equal(st.averageWeekly(4000, "W1", 8), 500);
});
test("SSP from day one at the lower of £123.25 or 80% of earnings, as HMRC's table rounds", () => {
  assert.equal(st.sspFor(Y, 500, 5, 2).amount, 49.3);
  assert.equal(st.sspFor(Y, 500, 7, 2).amount, 35.22);
  assert.equal(st.sspFor(Y, 500, 7, 3).amount, 52.83);
  assert.equal(st.sspFor(Y, 100, 5, 5).amount, 80); // 80% of £100 is under the flat rate
  const end = st.sspFor(Y, 500, 5, 10, 135);
  assert.equal(end.days, 5);
  assert.ok(end.warning);
});
test("SMP: six weeks at 90%, then the lower of £194.32 or 90%", () => {
  assert.equal(st.familyWeekly(Y, "smp", 600, 1), 540);
  assert.equal(st.familyWeekly(Y, "smp", 600, 7), 194.32);
  assert.equal(st.familyWeekly(Y, "smp", 150, 7), 135);
  assert.equal(st.familyWeekly(Y, "smp", 600, 40), 0);
  assert.equal(st.familyFor(Y, "smp", 600, "2026-06-01", 39, "2026-06-01", "2026-06-14"), 1080);
  assert.equal(st.familyFor(Y, "smp", 100, "2026-06-01", 39, "2026-06-01", "2026-06-14"), 0); // under the lower earnings limit
  assert.equal(st.familyFor(Y, "spp", 600, "2026-06-01", 2, "2026-06-01", "2026-06-30"), 388.64);
});
test("recovery: 92%, or 100% plus 9% for a small employer; SSP never", () => {
  assert.deepEqual(st.recovery(Y, { smp: 1000, ssp: 200 }, false), { smp: 920 });
  assert.deepEqual(st.recovery(Y, { smp: 1000 }, true), { smp: 1000, compSmp: 90 });
});
