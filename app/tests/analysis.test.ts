import assert from "node:assert/strict";
import { test } from "node:test";
import { GoalBase, NO_CHANGE, cashFlow, contributions, goalValue, growthTrail, monthlySeries, soloChange, trendRange, financialYears } from "../src/lib/analysis";

const row = (group: string, name: string, amounts: number[]) => ({ code: "", group, name, amounts });
const months = ["2026-01", "2026-02", "2026-03"];
const d = {
  months, bsMonths: months,
  pl: [row("income", "Sales", [100, 200, 300]), row("cos", "Materials", [40, 60, 90]), row("expense", "Rent", [10, 10, 10]), row("expense", "Depreciation", [0, 5, 5]), row("expense", "Loan interest", [0, 2, 2]), row("other", "Bank interest received", [0, 0, 1])],
  bs: [
    row("bank", "Current account", [100, 150, 260]), row("curAsset", "Trade debtors", [50, 80, 100]), row("curAsset", "Stock", [20, 20, 30]),
    row("fixed", "Equipment", [100, 105, 100]), row("curLiab", "Trade creditors", [30, 40, 50]), row("curLiab", "VAT", [10, 12, 15]), row("curLiab", "Bank loan", [60, 58, 56]),
    row("equity", "Share capital", [100, 100, 100]),
  ],
};

test("cash flow: the lines add up to the change in cash less the change in debt", () => {
  const c = cashFlow(d as never, "month", "2026-03", 12)!;
  assert.ok(c);
  assert.equal(c.net, 110 - -2); // cash up 110, debt down 2
  assert.equal(Math.round(c.lines.reduce((a, l) => a + l.amount, 0) * 100), Math.round(c.net * 100));
  const get = (l: string) => c.lines.find((x) => x.label === l)!.amount;
  assert.equal(get("Revenue"), 300); assert.equal(get("Cost of Sales"), -90); assert.equal(get("Expenses"), -10);
  assert.equal(get("Change in Accounts Receivable"), -20); assert.equal(get("Change in Inventory"), -10); assert.equal(get("Change in Accounts Payable"), 10);
  assert.equal(get("Net Interest (after tax)"), -1);
  assert.equal(c.cash.open, 150); assert.equal(c.debt.close, 56);
  assert.equal(c.totals.length, 3);
});
test("cash flow: needs the balance sheet and the month before", () => {
  assert.equal(cashFlow({ ...d, bs: [] } as never, "month", "2026-03", 12), undefined);
  assert.equal(cashFlow(d as never, "month", "2026-01", 12), undefined);
});
test("trend: series, margins and ranges", () => {
  const s = monthlySeries(d as never, "revenue"); assert.deepEqual(s.map((x) => x.value), [100, 200, 300]);
  assert.equal(monthlySeries(d as never, "gpm")[0].value, 60);
  assert.equal(monthlySeries({ ...d, bs: [] } as never, "cash")[0].value, undefined);
  const ms = ["2025-01", "2025-06", "2025-07", "2025-12", "2026-01"];
  assert.deepEqual(trendRange(ms, "2026-01", "13", 6), ms);
  assert.deepEqual(trendRange(ms, "2026-01", "2025", 6), ["2025-01", "2025-06"]);
  assert.deepEqual(trendRange(ms, "2025-12", "all", 6), ["2025-01", "2025-06", "2025-07", "2025-12"]);
  assert.deepEqual(financialYears(ms, 6), [2025, 2026]);
});
test("growth trail pairs the two measures by month", () => {
  const t = growthTrail(d as never, "invest", "operating", "2026-02", "2026-03");
  assert.deepEqual(t, [{ month: "2026-02", x: 77, y: 123 }, { month: "2026-03", x: 107, y: 193 }]);
});
const base: GoalBase = { revenue: 1000, cos: 500, varExp: 50, fixedExp: 300, other: 0 };
test("goalseek: a solo change reaches the goal and levers add up to the metric", () => {
  const start = goalValue(base, "opm", NO_CHANGE)!; assert.equal(start, 15);
  for (const lever of ["price", "volume", "cos", "fixed", "varExp"] as const) {
    const x = soloChange(base, "opm", 18, lever)!;
    assert.ok(x !== undefined, lever);
    assert.ok(Math.abs(goalValue(base, "opm", { ...NO_CHANGE, [lever]: x })! - 18) < 1e-6, lever);
  }
  assert.ok(soloChange(base, "opm", 18, "price")! > 0 && soloChange(base, "opm", 18, "fixed")! < 0);
  const l = { ...NO_CHANGE, price: 0.02, fixed: -0.05 };
  const sum = contributions(base, "opm", l).reduce((a, c) => a + c.delta, 0);
  assert.ok(Math.abs(start + sum - goalValue(base, "opm", l)!) < 1e-9);
  assert.equal(soloChange({ ...base, fixedExp: 0 }, "opm", 20, "volume"), undefined); // volume can't lift a margin with no fixed costs
});
