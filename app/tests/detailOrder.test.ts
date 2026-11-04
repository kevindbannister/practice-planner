import assert from "node:assert/strict";
import { test } from "node:test";
import { DETAIL_HEADINGS, detailGroups, headingOrder } from "../src/lib/accounts";

const m = (code: string, account: string, iris: string, dest: string, balance: number) => ({ acct: { code, account }, iris, irisName: account === "Rent" ? "Other operating leases - rent" : account === "Insurance" ? "Insurance" : account, dest, balance, swBalance: balance, jBalance: 0 }) as any;
const maps = [
  m("410", "Rent", "905/2", "expenditure/premises", 12000), m("400", "Wages", "905/1", "expenditure/employee", 30000),
  m("430", "Insurance", "905/9", "expenditure/premises", 900), m("420", "Accountancy", "905/5", "expenditure/accountancy", 1500),
];
const titles = (o?: any) => detailGroups(maps, o).expenses.map((g) => g.title);

test("headings keep the standard order until one is saved", () => {
  const std = titles();
  assert.deepEqual(std, DETAIL_HEADINGS.filter((h) => ["expenditure/employee", "expenditure/premises", "expenditure/accountancy"].includes(h.key)).map((h) => h.title));
});
test("a saved heading order is followed, and a new heading goes to the end", () => {
  const o = { groups: ["expenditure/accountancy", "expenditure/premises"] };
  assert.deepEqual(titles(o), ["Accountancy", "Premises costs", "Employee costs"]);
  assert.equal(headingOrder(["nonsense", "expenditure/premises"])[0], "expenditure/premises");
  assert.equal(headingOrder().length, DETAIL_HEADINGS.length);
});
test("accounts under a heading go by name, IRIS code or the software's code", () => {
  const premises = (o?: any) => detailGroups(maps, o).expenses.find((g) => g.key === "expenditure/premises")!.items.map((x) => x.label);
  assert.deepEqual(premises(), ["Insurance", "Other operating leases - rent"]);
  assert.deepEqual(premises({ items: "iris" }), ["Other operating leases - rent", "Insurance"]);
  assert.deepEqual(premises({ items: "code" }), ["Other operating leases - rent", "Insurance"]);
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
