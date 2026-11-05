import assert from "node:assert/strict";
import { test } from "node:test";
import { buckets, evalRule, fmtValue, keyData, measureValue, periodMonthsFor, tableCols, topAccounts } from "../src/lib/reportComponents";

const row = (group: string, name: string, amounts: number[]) => ({ code: "", group, name, amounts });
const months = Array.from({ length: 24 }, (_, i) => { const t = 2024 * 12 + 10 + i; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; }); // 2024-11 .. 2026-10
const d = {
  months, bsMonths: months,
  pl: [row("income", "Sales", months.map((_, i) => 100 + i)), row("income", "Other sales", months.map(() => 10)), row("cos", "Materials", months.map(() => 40)), row("expense", "Rent", months.map(() => 20)), row("expense", "Wages", months.map(() => 30)), row("expense", "Nothing", months.map(() => 0))],
  bs: [row("bank", "Bank", months.map((_, i) => 1000 + i))],
};

test("period months for this, last and last year", () => {
  assert.deepEqual(periodMonthsFor("month", "2026-10", 3, "this"), ["2026-10"]);
  assert.deepEqual(periodMonthsFor("month", "2026-10", 3, "prior"), ["2026-09"]);
  assert.deepEqual(periodMonthsFor("month", "2026-10", 3, "lastYear"), ["2025-10"]);
});
test("measure values add up, take balances at the end and work margins from sums", () => {
  assert.equal(measureValue(d as never, "revenue", ["2026-09", "2026-10"]), (100 + 22 + 10) + (100 + 23 + 10));
  assert.equal(measureValue(d as never, "cash", ["2026-09", "2026-10"]), 1023);
  assert.equal(measureValue({ ...d, bs: [] } as never, "cash", ["2026-10"]), undefined);
  assert.equal(measureValue(d as never, "gpm", ["2026-10"]), Math.round(((133 - 40) / 133) * 10000) / 100);
});
test("a rule compares two figures, or a figure and a number", () => {
  const r = evalRule(d as never, "month", "2026-10", 3, { measure: "revenue", when: "this" }, "gt", { measure: "revenue", when: "lastYear" });
  assert.equal(r.ok, true); assert.equal(r.left, 133); assert.equal(r.right, 121);
  assert.equal(evalRule(d as never, "month", "2026-10", 3, { measure: "revenue", when: "this" }, "lt", { value: 100 }).ok, false);
  assert.equal(evalRule(d as never, "month", "2026-10", 3, { measure: "cash", when: "this" }, "gt", { value: 1 }).ok, true);
  assert.equal(evalRule({ ...d, bs: [] } as never, "month", "2026-10", 3, { measure: "cash", when: "this" }, "gt", { value: 1 }).ok, undefined);
});
test("series periods: months, financial quarters and years, oldest first", () => {
  const m = buckets("month", "2026-10", 3, 3, months);
  assert.deepEqual(m.map((x) => x.label), ["Aug 26", "Sep 26", "Oct 26"]);
  const q = buckets("quarter", "2026-10", 3, 3, months);
  assert.equal(q.length, 3); assert.deepEqual(q[2].months, ["2026-10"]); // the quarter to date: Oct is the first month of the quarter Oct–Dec
  assert.deepEqual(q[1].months, ["2026-07", "2026-08", "2026-09"]);
  const y = buckets("year", "2026-10", 3, 2, months);
  assert.deepEqual(y.map((x) => x.label), ["25/26", "26/27 YTD"]);
  assert.deepEqual(y[1].months, ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
  assert.equal(y[0].months.length, 12);
});
test("top accounts: biggest first, nil hidden, bottom reverses", () => {
  const ms = ["2026-10"];
  assert.deepEqual(topAccounts(d as never, "expense", ms, 10, "top", true).map((x) => x.name), ["Wages", "Rent"]);
  assert.equal(topAccounts(d as never, "expense", ms, 10, "top", false).length, 3);
  assert.equal(topAccounts(d as never, "expense", ms, 1, "bottom", false)[0].name, "Nothing");
  assert.deepEqual(topAccounts(d as never, "bank", ms, 5, "top", true), [{ name: "Bank", amount: 1023 }]);
});
test("figures format", () => {
  assert.equal(fmtValue("money", 105780), "£105,780");
  assert.equal(fmtValue("money", 105780, { rounded: true }), "£105.8K");
  assert.equal(fmtValue("money", -1234.5, { decimals: true, symbol: false }), "-1,234.50");
  assert.equal(fmtValue("percent", 12.345), "12.35%");
  assert.equal(fmtValue("money", undefined), "–");
});
test("key number with comparison and sparkline; table columns", () => {
  const k = keyData(d as never, "revenue", "month", "2026-10", 3, "lastYear");
  assert.equal(k.value, 133); assert.equal(k.compare, 121); assert.equal(k.changePct, 9.92); assert.equal(k.spark.length, 13);
  assert.deepEqual(tableCols({ compare: "none" }), ["this"]);
  assert.deepEqual(tableCols({ compare: "prior" }), ["this", "prior", "var", "varPct"]);
  assert.deepEqual(tableCols({ compare: "none", cols: ["this", "pctRev"] }), ["this", "pctRev"]);
});
