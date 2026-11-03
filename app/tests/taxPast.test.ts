import test from "node:test";
import assert from "node:assert/strict";
import { compute, emptyReturn, newId, TaxReturn } from "../src/lib/tax";
import { YEARS } from "../src/lib/taxRates";

const ret = (f: (r: TaxReturn) => void) => { const r = emptyReturn(); f(r); return r; };
const job = (pay: number, tax = 0) => ({ id: newId(), name: "Employer", paye: "123/A", pay, tax, benefits: {}, expenses: {} });

test("past years 2019-20 to 2022-23 are there", () => {
  assert.deepEqual(YEARS.map((y) => y.year).slice(0, 4), [2020, 2021, 2022, 2023]);
});

test("2020-21 director: salary and dividends match the IRIS SA302", () => {
  // pay 9,480, dividends 40,520: allowance 12,500, 2,000 at nil, 35,500 at 7.5% = 2,662.50; payments on account 1,331.25 each
  const c = compute(ret((r) => { r.employments.push(job(9480)); r.dividends.push({ id: "d", company: "Co", amount: 40520 }); }), 2021);
  assert.equal(c.incomeTax, 2662.5);
  assert.equal(c.poaNext, 1331.25);
});

test("additional rate starts at £150,000 before 2023-24", () => {
  const c = compute(ret((r) => { r.employments.push(job(200000)); }), 2023);
  // no allowance; 37,700 at 20%, 112,300 at 40%, 50,000 at 45%
  assert.equal(c.incomeTax, 7540 + 44920 + 22500);
});

test("Class 2 from the Small Profits Threshold to 2021-22, from the Lower Profits Limit in 2022-23", () => {
  const se = (r: TaxReturn) => r.selfEmployments.push({ id: "s", name: "Trade", turnover: 9000, expenses: 0 });
  assert.equal(compute(ret(se), 2022).class2, 158.6); // 3.05 x 52
  assert.equal(compute(ret(se), 2023).class2, 0); // under 11,908: treated as paid
});

test("2022-23 Class 4 at 9.73%", () => {
  const c = compute(ret((r) => r.selfEmployments.push({ id: "s", name: "Trade", turnover: 31908, expenses: 0 })), 2023);
  assert.equal(c.class4, 1946); // 20,000 x 9.73%
});

import { bringForward, hasSection } from "../src/lib/tax";

test("bring forward keeps the people and claims, clears the figures and carries losses", () => {
  const prev = ret((r) => {
    r.front = { region: "scotland", utr: "1234567890", nino: "AB123456C", dob: "1970-01-01" };
    r.employments.push({ ...job(30000, 3486), director: true });
    r.selfEmployments.push({ id: "s", name: "Roofing", turnover: 10000, expenses: 14000 }, { id: "x", name: "Old trade", turnover: 1000, expenses: 0, end: "2021-01-31" });
    r.dividends.push({ id: "d", company: "Co Ltd", amount: 20000 });
    r.property = { income: 5000, finance: 9000, rates: 1000 };
    r.gains.push({ id: "g", description: "Shares", kind: "shares", proceeds: 1000, cost: 5000 });
    r.reliefs.giftAid = 100;
    r.studentLoan.plans.push("plan2");
    r.payments.poa1 = 500;
  });
  const b = bringForward(prev, 2021, "2026-11-03");
  assert.equal(b.front.utr, "1234567890"); assert.equal(b.front.region, "scotland");
  assert.equal(b.employments.length, 1); assert.equal(b.employments[0].pay, 0); assert.equal(b.employments[0].director, true);
  assert.notEqual(b.employments[0].id, prev.employments[0].id);
  assert.equal(b.selfEmployments.length, 1, "the ceased trade is left out");
  assert.equal(b.selfEmployments[0].lossesBf, 4000);
  assert.equal(b.dividends[0].amount, 0); assert.equal(b.dividends[0].company, "Co Ltd");
  assert.equal(b.property?.income, 0); assert.equal(b.property?.lossesBf, undefined);
  assert.ok((b.property?.financeBf || 0) > 0, "unused finance costs carried");
  assert.equal(b.gainsLossesBf, 4000);
  assert.ok(hasSection(b, "giftAid"), "gift aid stays on as a section"); assert.equal(b.reliefs.giftAid, undefined);
  assert.deepEqual(b.studentLoan.plans, ["plan2"]);
  assert.deepEqual(b.payments, {});
  assert.deepEqual(b.status, { state: "draft" }); assert.deepEqual(b.broughtForward, { from: 2021, on: "2026-11-03" });
});
