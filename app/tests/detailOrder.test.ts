import assert from "node:assert/strict";
import { test } from "node:test";
import { DETAIL_HEADINGS, detailGroups, headingOrder } from "../src/lib/accounts";

const m = (code: string, account: string, iris: string, dest: string, balance: number) => ({ acct: { code, account }, iris, dest, balance, swBalance: balance, jBalance: 0 }) as any;
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
  assert.deepEqual(premises(), ["Insurance", "Rent"]);
  assert.deepEqual(premises({ items: "iris" }), ["Rent", "Insurance"]);
  assert.deepEqual(premises({ items: "code" }), ["Rent", "Insurance"]);
});
