import test from "node:test";
import assert from "node:assert/strict";
import { blankLine, checkJournal, rebalance, setAmount, toPaperLines } from "../src/lib/quickJournal";

test("a debit on the first line puts the balancing credit on the second until it is changed", () => {
  let l = [blankLine(), blankLine()];
  l = setAmount(l, 0, "dr", "250");
  assert.equal(l[1].cr, "250.00"); assert.equal(l[1].dr, "");
  l = setAmount(l, 1, "cr", "200"); // changed by hand: stays
  assert.equal(l[1].cr, "200"); assert.equal(l[0].dr, "250");
  assert.equal(checkJournal(l.map((x) => ({ ...x, account: "A" }))).ok, false);
});
test("a credit first gives the balance as a debit; a third line takes what the first two leave", () => {
  let l = [blankLine(), blankLine(), blankLine()];
  l = setAmount(l, 0, "cr", "100");
  assert.equal(l[1].dr, "100.00");
  l = setAmount(l, 1, "dr", "60");
  assert.equal(l[2].dr, "40.00"); assert.equal(l[2].cr, "");
});
test("clearing a typed amount hands the balance back", () => {
  let l = setAmount([blankLine(), blankLine()], 0, "dr", "50");
  l = setAmount(l, 0, "dr", "");
  assert.equal(l[0].touched, true); // an empty string still counts as touched, so the second line keeps the old balance until retyped
  assert.equal(rebalance(l)[1].cr, l[1].cr);
});
test("checks and saved lines", () => {
  let l = [blankLine(), blankLine()];
  assert.equal(checkJournal(l).ok, false);
  l = setAmount(l, 0, "dr", "75");
  l[0].account = "Rent"; l[1].code = "7000"; l[1].narrative = "Accrual";
  assert.equal(checkJournal(l).ok, true);
  const out = toPaperLines(l, 4, "Year end");
  assert.equal(out.length, 2);
  assert.deepEqual(out[0].f, { no: 4, dr: 75 }); assert.deepEqual(out[1].f, { no: 4, cr: 75 });
  assert.equal(out[0].Remark, "Year end"); assert.equal(out[1].Remark, "Accrual");
});
