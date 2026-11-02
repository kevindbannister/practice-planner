import test from "node:test";
import assert from "node:assert/strict";
import { accountsFigures, Mapping } from "../src/lib/tbMap";
import { detailGroups } from "../src/lib/accounts";
import { balanceItems, bridge, draft, dueDates, gbp, headline, readReview, spend } from "../src/lib/clientReview";

const m = (dest: string, balance: number, account = dest): Mapping => ({ acct: { key: account, code: account, account, iris: "", type: "", tbDr: 0, tbCr: 0, jDr: 0, jCr: 0, dr: 0, cr: 0, inTb: true, lines: [] }, balance, swBalance: balance, jBalance: 0, iris: "", irisName: "", dest, saved: false, why: "" } as Mapping);
const year = (sales: number, cos: number, rent: number, wages: number, tax: number) => [
  m("income/sales", -sales, "Sales"), m("expenditure/cos", cos, "Materials"), m("expenditure/premises", rent, "Rent"), m("expenditure/employee", wages, "Wages"), m("taxation/current", tax, "CT"),
  m("bank/current", 20000, "Bank"), m("capital/reserves", -20000, "Reserves"),
];
const now = year(100000, 30000, 6000, 20000, 8000), before = year(80000, 28000, 5000, 20000, 5000);

test("the bridge adds up from last year's profit to this year's", () => {
  const f = accountsFigures(now), p = accountsFigures(before);
  const b = bridge(f, p, detailGroups(now).expenses, detailGroups(before).expenses)!;
  assert.equal(b.start, 27000); assert.equal(b.end, 44000);
  assert.equal(b.start + b.steps.reduce((a, s) => a + s.amount, 0), b.end);
  assert.ok(b.steps.some((s) => s.label === "Premises costs" && s.amount === -1000));
  assert.equal(bridge(f, undefined), undefined);
});
test("headline, spending and balance items", () => {
  const f = accountsFigures(now), p = accountsFigures(before);
  const h = headline(f, p);
  assert.equal(h[0].change, 20000); assert.equal(h[0].pct, 25);
  const d = detailGroups(now), pd = detailGroups(before);
  const s = spend(f, d.expenses, d.costs, pd.expenses, pd.costs);
  assert.equal(s[0].title, "Cost of sales"); assert.equal(s.reduce((a, x) => a + x.share, 0) >= 99, true);
  assert.equal(balanceItems(f, p).owns.find((x) => x.label === "Cash at bank")!.now, 20000);
});
test("drafted wording uses the figures; due dates", () => {
  const f = accountsFigures(now), p = accountsFigures(before);
  assert.match(draft("headline", f, p), /Turnover rose £20,000 \(25%\) to £100,000/);
  assert.match(draft("movement", f, p, detailGroups(now).expenses, detailGroups(before).expenses), /increased by £17,000/);
  assert.match(draft("tax", f, p, undefined, undefined, undefined, undefined, "2026-10-31"), /payable by 1 August 2027/);
  assert.equal(gbp(-1234.4), "-£1,234");
  const d = dueDates("2026-10-31"); assert.equal(d.tax, "2027-08-01"); assert.equal(d.accounts, "2027-07-31"); assert.equal(d.ct600, "2027-10-31");
  assert.match(draft("headline", f, undefined), /profit before tax of £44,000\./);
});
test("the saved review reads back safely", () => {
  const r = readReview({ notes: { headline: "Hi", bad: 3 }, next: { sign: true, x: "yes" }, meeting: "Agreed", client: true });
  assert.deepEqual(r.notes, { headline: "Hi" }); assert.deepEqual(r.next, { sign: true, x: false }); assert.equal(r.client, true);
  assert.deepEqual(readReview({}), { notes: {}, next: {}, meeting: "", date: "", client: false });
});
