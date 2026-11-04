import assert from "node:assert/strict";
import { test } from "node:test";
import { DETAIL_HEADINGS, detailGroups } from "../src/lib/accounts";

const m = (code: string, account: string, iris: string, dest: string, balance: number) => ({ acct: { code, account }, iris, irisName: account === "Rent" ? "Other operating leases - rent" : account === "Insurance" ? "Insurance" : account, dest, balance, swBalance: balance, jBalance: 0 }) as any;
const maps = [
  m("410", "Rent", "905/2", "expenditure/premises", 12000), m("400", "Wages", "905/1", "expenditure/employee", 30000),
  m("430", "Insurance", "905/9", "expenditure/premises", 900), m("420", "Accountancy", "905/5", "expenditure/accountancy", 1500),
];
const titles = (o?: any) => detailGroups(maps, o).expenses.map((g) => g.title);

test("expenses are one list in IRIS number order, whatever the headings the accounts were mapped to", () => {
  const g = detailGroups(maps, undefined, true).expenses;
  assert.equal(g.length, 1);
  assert.deepEqual(g[0].items.map((x) => x.iris), ["905/1", "905/2", "905/5", "905/9"]);
  assert.equal(g[0].total, 44400);
});
test("a line is in the list once, however many accounts or headings it came from", () => {
  const two = [m("1", "Post", "264", "expenditure/office", 11), m("2", "Courier", "264", "expenditure/distribution", 5), m("3", "Phone", "263", "expenditure/office", 3)];
  const items = detailGroups(two, undefined, true).expenses[0].items;
  assert.deepEqual(items.map((x) => [x.iris, x.amount]), [["263", 3], ["264", 16]]);
});
test("A to Z is available", () => {
  const items = detailGroups(maps, { items: "name" }, true).expenses[0].items.map((x) => x.label);
  assert.deepEqual(items, [...items].sort((a, b) => a.localeCompare(b)));
});
test("the detailed profit and loss is by IRIS line: accounts on one code are added, one with no code says so", () => {
  const two = [m("1", "Rent A", "905/2", "expenditure/premises", 100), m("2", "Rent B", "905/2", "expenditure/premises", 50), m("3", "Odd", "", "expenditure/premises", 5)];
  const items = detailGroups(two).expenses[0].items;
  assert.equal(items.length, 2);
  assert.equal(items.find((x) => x.iris === "905/2")!.amount, 150);
  assert.ok(items.some((x) => x.label === "Odd (no IRIS code)"));
});

import { IRIS_BUILT_IN } from "../src/lib/tbMap";
import { detailLines } from "../src/lib/accounts";
test("dragged IRIS line order is followed in the report, lines not in it go after", () => {
  const three = [m("1", "A", "905/2", "expenditure/premises", 1), m("2", "B", "905/9", "expenditure/premises", 1), m("3", "C", "905/5", "expenditure/premises", 1)];
  const labels = (o: any) => detailGroups(three, o).expenses[0].items.map((x) => x.iris);
  assert.deepEqual(labels({ lines: ["905/9", "905/2"] }), ["905/9", "905/2", "905/5"]);
});
test("every profit and loss line on the chart is offered under a heading, and the dragged order applies to them", () => {
  const all = detailLines(IRIS_BUILT_IN);
  assert.ok(all.length > 30);
  assert.ok(all.every((l) => DETAIL_HEADINGS.some((h) => h.key === l.heading)));
  assert.ok(!all.some((l) => /^5\d\d|^7\d\d|^9\d\d/.test(l.code)));
  const codes = all.map((l) => l.code).reverse();
  assert.deepEqual(detailLines(IRIS_BUILT_IN, { lines: codes }).map((l) => l.code), codes);
});

import { irisRangeDest } from "../src/lib/tbMap";
test("IRIS codes sit under the right heading whatever the wording of their name", () => {
  assert.equal(irisRangeDest("254/5*1", "Directors' social security", 1), "expenditure/directors");
  assert.equal(irisRangeDest("254/5*2", "Directors' social security", 1), "expenditure/directors");
  assert.equal(irisRangeDest("256", "Social security", 1), "expenditure/employee");
  assert.equal(irisRangeDest("227", "Other operating leases - rent", 1), "expenditure/premises");
  assert.equal(irisRangeDest("234", "Repairs to Property", 1), "expenditure/premises");
  assert.equal(irisRangeDest("426", "Hire purchase", 1), "expenditure/interestpayable");
});
