import test from "node:test";
import assert from "node:assert/strict";
import { compute, emptyReturn, newId, TaxReturn } from "../src/lib/tax";
import { yearOf } from "../src/lib/taxRates";

const ret = (f: (r: TaxReturn) => void) => { const r = emptyReturn(); f(r); return r; };
const job = (pay: number, tax = 0) => ({ id: newId(), name: "Employer", paye: "123/A", pay, tax, benefits: {}, expenses: {} });

test("basic rate employee: tax matches PAYE, nothing to pay", () => {
  const c = compute(ret((r) => { r.employments.push(job(50000, 7486)); }), 2026);
  assert.equal(c.taxable, 37430); assert.equal(c.incomeTax, 7486); assert.equal(c.balancing, 0); assert.equal(c.poaNext, 0);
});

test("salary at the allowance plus dividends (2025-26)", () => {
  const c = compute(ret((r) => { r.employments.push(job(12570)); r.dividends.push({ id: "d", company: "Co", amount: 41270 }); }), 2026);
  // 500 at 0%, 37,200 at 8.75% = 3,255, 3,570 at 33.75% = 1,204.875 (pence rounding)
  assert.equal(c.incomeTax, 4459.87);
  assert.equal(c.poaNext, 2229.93); // the figure IRIS Elements shows for this case
});

test("2026-27 dividend rates are higher", () => {
  const c = compute(ret((r) => { r.employments.push(job(12570)); r.dividends.push({ id: "d", company: "Co", amount: 10500 }); }), 2027);
  assert.equal(c.incomeTax, 1075); // 10,000 at 10.75%
});

test("personal allowance taper over £100,000", () => {
  const c = compute(ret((r) => { r.employments.push(job(110000)); }), 2026);
  assert.equal(c.personalAllowance, 7570); assert.equal(c.incomeTax, 7540 + 25892);
});

test("Scottish rates on earnings (2025-26)", () => {
  const c = compute(ret((r) => { r.front.region = "scotland"; r.employments.push(job(50000)); }), 2026);
  assert.equal(c.incomeTax, 9013.8);
});

test("savings: starting rate and Personal Savings Allowance", () => {
  assert.equal(compute(ret((r) => { r.employments.push(job(20000)); r.interest.push({ id: "i", payer: "Bank", untaxed: 3000 }); }), 2026).incomeTax, 1886);
  assert.equal(compute(ret((r) => { r.employments.push(job(14000)); r.interest.push({ id: "i", payer: "Bank", untaxed: 6000 }); }), 2026).incomeTax, 572);
});

test("self-employed: Class 4 at 6% and payments on account", () => {
  const c = compute(ret((r) => { r.selfEmployments.push({ id: "s", name: "Shop", turnover: 50000, expenses: 20000 }); }), 2026);
  assert.equal(c.class4, 1045.8); assert.equal(c.class2, 0); assert.equal(c.incomeTax, 3486);
  assert.equal(c.poaNext, p(3486 + 1045.8) / 2);
  const old = compute(ret((r) => { r.selfEmployments.push({ id: "s", name: "Shop", turnover: 50000, expenses: 20000 }); }), 2024);
  assert.equal(old.class4, 1568.7); assert.equal(old.class2, 179.4);
});
const p = (x: number) => Math.round(x * 100) / 100;

test("trading allowance, losses brought forward and voluntary Class 2", () => {
  const c = compute(ret((r) => { r.selfEmployments.push({ id: "s", name: "Side", turnover: 3000, expenses: 0, tradingAllowance: true }); r.nic.voluntaryClass2 = true; }), 2026);
  assert.equal(c.income.nonSavings, 2000); assert.equal(c.class2, 182);
  const l = compute(ret((r) => { r.selfEmployments.push({ id: "s", name: "Shop", turnover: 30000, expenses: 10000, lossesBf: 5000 }); }), 2026);
  assert.equal(l.income.nonSavings, 15000);
});

test("property: finance costs give 20% relief", () => {
  const c = compute(ret((r) => { r.employments.push(job(30000)); r.property = { income: 14000, finance: 4000, repairs: 0, rates: 4000 }; }), 2026);
  // property profit 10,000 (finance costs not deducted); tax 27,430 at 20% = 5,486 less 800
  assert.equal(c.incomeTax, 4686);
  const allow = compute(ret((r) => { r.property = { income: 800, finance: 0, propertyAllowance: true }; }), 2026);
  assert.equal(allow.income.total, 0);
});

test("Gift Aid and pension contributions extend the basic rate band", () => {
  const c = compute(ret((r) => { r.employments.push(job(60000)); r.reliefs.pensionRas = 4000; }), 2026);
  // basic band 37,700 + 5,000 = 42,700; taxable 47,430: 42,700 at 20% + 4,730 at 40%
  assert.equal(c.incomeTax, 8540 + 1892);
});

test("High Income Child Benefit Charge: 1% per £200 over £60,000", () => {
  const c = compute(ret((r) => { r.employments.push(job(70000)); r.childBenefit = { amount: 2000 }; }), 2026);
  assert.equal(c.hicbc, 1000);
  const old = compute(ret((r) => { r.employments.push(job(55000)); r.childBenefit = { amount: 2000 }; }), 2024);
  assert.equal(old.hicbc, 1000); // 2023-24: 1% per £100 over £50,000
});

test("Capital Gains Tax: exempt amount, basic band at 18%, rest at 24%", () => {
  const c = compute(ret((r) => { r.employments.push(job(42570)); r.gains.push({ id: "g", description: "Shares", kind: "shares", proceeds: 30000, cost: 10000 }); }), 2026);
  assert.equal(c.cgt, 3618);
  const badr = compute(ret((r) => { r.employments.push(job(42570)); r.gains.push({ id: "g", description: "Business", kind: "shares", proceeds: 103000, cost: 0, badr: true }); }), 2026);
  assert.equal(badr.cgt, 14000);
  const early = compute(ret((r) => { r.employments.push(job(42570)); r.gains.push({ id: "g", description: "Shares", kind: "shares", proceeds: 23000, cost: 0, date: "2024-06-01" }); }), 2025);
  assert.equal(early.cgt, 7700 * 0.1 + 12300 * 0.2);
});

test("student loan through self assessment", () => {
  const c = compute(ret((r) => { r.selfEmployments.push({ id: "s", name: "Shop", turnover: 40000, expenses: 0 }); r.studentLoan.plans = ["plan2"]; }), 2026);
  assert.equal(c.studentLoan, Math.floor((40000 - 28470) * 0.09));
});

test("marriage allowance and tax years", () => {
  const give = compute(ret((r) => { r.employments.push(job(20000)); r.allowances.marriage = "transfer"; }), 2026);
  assert.equal(give.personalAllowance, 11310);
  const get = compute(ret((r) => { r.employments.push(job(20000)); r.allowances.marriage = "receive"; }), 2026);
  assert.equal(get.incomeTax, 1486 - 252);
  assert.equal(yearOf("2025-04-05"), 2025); assert.equal(yearOf("2025-04-06"), 2026);
});

test("Winter Fuel Payment charge from 2025-26, gifts of shares, and tax collected in a code", () => {
  const c = compute(ret((r) => { r.pensions = { state: 12000, others: [{ id: "o", payer: "Scheme", amount: 30000, tax: 0 }] }; r.winterFuel = { amount: 300 }; }), 2026);
  assert.ok(c.blocks.some((b) => b.rows.some((x) => /Winter Fuel/.test(x.label))));
  const low = compute(ret((r) => { r.pensions = { state: 12000, others: [] }; r.winterFuel = { amount: 300 }; }), 2026);
  assert.equal(low.incomeTax, 0);
  const gift = compute(ret((r) => { r.employments.push(job(30000)); r.charityGifts = 5000; }), 2026);
  assert.equal(gift.incomeTax, (30000 - 5000 - 12570) * 0.2);
  const coded = compute(ret((r) => { r.employments.push(job(30000, 3886)); r.payments.earlierYearInCode = 400; }), 2026);
  assert.equal(coded.balancing, 0); // the extra £400 PAYE was last year's tax, not a repayment
  assert.equal(compute(ret((r) => { r.employments.push(job(30000, 3886)); }), 2026).balancing, -400);
});

test("payments on account: rolled forward from last year, and only ticked payments count against the tax", async () => {
  const { emptyReturn, compute, rollForward, paymentLines, outstandingPayments } = await import("../src/lib/tax.ts");
  const last = emptyReturn();
  last.selfEmployments.push({ id: "s", name: "Shop", turnover: 60000, expenses: 20000 });
  const rf = rollForward(last, 2026);
  const c = compute(last, 2026);
  assert.equal(rf.expectedPoa1, c.poaNext); assert.ok(rf.expectedPoa1 > 0);
  const now = emptyReturn();
  now.selfEmployments.push({ id: "s", name: "Shop", turnover: 60000, expenses: 20000 });
  now.payments = { expectedPoa1: rf.expectedPoa1, expectedPoa2: rf.expectedPoa2, expectedFrom: "the 2025-26 return" };
  // the two payments are there to be paid, but nothing is taken off until they're ticked
  const lines = paymentLines(now, 2027);
  assert.deepEqual(lines.map((l) => [l.kind, l.date, l.paid, l.amount]), [["poa1", "2027-01-31", false, rf.expectedPoa1], ["poa2", "2027-07-31", false, rf.expectedPoa2]]);
  assert.equal(compute(now, 2027).poaPaid, 0);
  assert.equal(outstandingPayments(now, 2027, "2027-02-10").total, rf.expectedPoa1 + rf.expectedPoa2);
  assert.equal(outstandingPayments(now, 2027, "2027-02-10").lines[0].overdue, true);
  // tick the first, paid on a different day: it counts, and the second is still outstanding
  now.payments.lines = lines.map((l) => (l.kind === "poa1" ? { ...l, paid: true, date: "2027-02-03" } : l));
  const part = compute(now, 2027);
  assert.equal(part.poaPaid, rf.expectedPoa1);
  assert.equal(outstandingPayments(now, 2027, "2027-02-10").total, rf.expectedPoa2);
  assert.ok(part.blocks.find((b) => b.title === "Summary")!.rows.some((r) => /paid 3 Feb 2027/.test(r.label)));
  // a late payment's increase is paid to HMRC but isn't tax
  now.payments.lines = now.payments.lines!.map((l) => (l.kind === "poa2" ? { ...l, paid: true, late: 75 } : l));
  const late = compute(now, 2027);
  assert.equal(late.lateInterest, 75);
  assert.equal(late.balancing, p2(part.balancing - rf.expectedPoa2));
  // old returns with only the amounts paid: the amounts are read as paid
  assert.deepEqual(paymentLines({ ...emptyReturn(), payments: { poa1: 300, poa2: 200 } }, 2027).map((l) => [l.paid, l.amount]), [[true, 300], [true, 200]]);
});
const p2 = (v: number) => Math.round(v * 100) / 100;

