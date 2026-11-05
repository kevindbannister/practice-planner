import assert from "node:assert/strict";
import { test } from "node:test";
import { breakeven } from "../src/lib/profitability";

const row = (group: string, name: string, amounts: number[]) => ({ group, name, amounts } as never);
test("breakeven: costs of sales vary with revenue, expenses are fixed", () => {
  const d = { months: ["2026-01", "2026-02"], bsMonths: [], bs: [], pl: [row("income", "Sales", [500, 500]), row("cos", "Materials", [200, 200]), row("expense", "Rent", [100, 100])] };
  const b = breakeven(d as never, "year", "2026-02", 2);
  assert.equal(b.revenue, 1000); assert.equal(b.totalCosts, 600); assert.equal(b.operating, 400);
  assert.equal(b.variablePerPound, 0.4); assert.equal(b.fixed, 200);
  assert.equal(b.breakeven, 333.33); assert.equal(b.marginOfSafety, 666.67);
  assert.equal(b.topCosts[0].name, "Materials");
});
test("breakeven: none when sales don't cover their own cost", () => {
  const d = { months: ["2026-01"], bsMonths: [], bs: [], pl: [row("income", "Sales", [100]), row("cos", "Materials", [120])] };
  assert.equal(breakeven(d as never, "month", "2026-01", 12).breakeven, undefined);
});
