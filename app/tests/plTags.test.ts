import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPl } from "../src/lib/plTags";

const m = (code: string, account: string, dest: string, balance: number) => ({ acct: { code, account }, dest, balance, swBalance: balance, jBalance: 0 }) as any;
const maps = [
  m("200", "Sales", "income/sales", -100000), m("210", "Consultancy fees", "income/fees", -20000), m("260", "Bank interest received", "income/interest", -500),
  m("300", "Purchases", "expenditure/cos", 40000), m("310", "Carriage", "expenditure/distribution", 2000),
  m("400", "Wages", "expenditure/employee", 30000), m("410", "Rent", "expenditure/premises", 12000), m("420", "Accountancy", "expenditure/accountancy", 1500),
  m("500", "Loan interest", "expenditure/interestpayable", 800), m("600", "Corporation tax", "taxation/current", 7000),
  m("720", "Plant - cost", "fixed/plant#cost", 30000), m("999", "Ignored", "ignore", 55),
];

test("the statement lines add up from the schedules' headings", () => {
  const { statement } = buildPl(maps);
  const v = Object.fromEntries(statement.map((l) => [l.key, l.amount]));
  assert.equal(v.turnover, 120000);
  assert.equal(v.costOfSales, 40000);
  assert.equal(v.grossProfit, 80000);
  assert.equal(v.distribution, 2000);
  assert.equal(v.admin, 43500);
  assert.equal(v.operatingProfit, 34500);
  assert.equal(v.interestReceivable, 500);
  assert.equal(v.interestPayable, 800);
  assert.equal(v.profitBeforeTax, 34200);
  assert.equal(v.tax, 7000);
  assert.equal(v.profit, 27200);
});

test("balance sheet and ignored accounts stay out; every cost has a detail line; elements are marked unchecked", () => {
  const { statement, detail, unplaced } = buildPl(maps);
  assert.equal(detail.length, 10);
  assert.ok(!detail.some((d) => d.code === "720" || d.code === "999"));
  assert.equal(unplaced.length, 0);
  assert.ok(statement.every((l) => l.verified === false && /^core:/.test(l.element)));
  const wages = detail.find((d) => d.code === "400")!;
  assert.equal(wages.element, "core:StaffCostsEmployeeBenefitsExpense");
  assert.equal(detail.find((d) => d.code === "410")!.needsElement, true);
});

test("a loss shows as a negative profit", () => {
  const { statement } = buildPl([m("200", "Sales", "income/sales", -1000), m("400", "Wages", "expenditure/employee", 3000)]);
  assert.equal(statement.find((l) => l.key === "profit")!.amount, -2000);
});
