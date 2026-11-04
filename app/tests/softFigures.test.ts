import assert from "node:assert/strict";
import { test } from "node:test";
import { softFigures } from "../src/lib/paperRecon";

test("typing a debit with no journals stores it as the software debit", () => {
  assert.deepEqual(softFigures({ jDr: 0, jCr: 0, dr: 100, cr: 0 }, "dr", 250), { dr: 250, cr: 0 });
});
test("journals are taken off so the final figure comes out as typed", () => {
  // a journal debits this account 40: to finish at 250 the software must say 210
  assert.deepEqual(softFigures({ jDr: 40, jCr: 0, dr: 140, cr: 0 }, "dr", 250), { dr: 210, cr: 0 });
  // a journal credits it 300: to finish at a debit of 250 the software must say 550
  assert.deepEqual(softFigures({ jDr: 0, jCr: 300, dr: 0, cr: 0 }, "dr", 250), { dr: 550, cr: 0 });
});
test("typing a credit makes the balance a credit", () => {
  assert.deepEqual(softFigures({ jDr: 0, jCr: 0, dr: 100, cr: 0 }, "cr", 80), { dr: 0, cr: 80 });
});
test("clearing a column leaves what is in the other, and a new account has no journals", () => {
  assert.deepEqual(softFigures({ jDr: 0, jCr: 0, dr: 0, cr: 90 }, "dr", undefined), { dr: 0, cr: 90 });
  assert.deepEqual(softFigures(undefined, "cr", 12.5), { dr: 0, cr: 12.5 });
});
