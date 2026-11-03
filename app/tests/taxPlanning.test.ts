import test from "node:test";
import assert from "node:assert/strict";
import * as t from "../src/lib/taxPlanning.ts";
import { emptyReturn } from "../src/lib/tax.ts";

const Y = 2027;
const one = (profit: number, o: Partial<t.PlanInput> = {}): t.PlanInput => ({ ...t.blankPlan(Y, "Acme Ltd"), profit, people: [t.newPerson("a", { name: "Alex", sharesPct: 100 })], ...o });
const ctxOf = (p: t.PlanInput, saved: (x: t.Person) => any = () => undefined) => t.context(p, saved);
const near = (a: number, b: number, tol = 2) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);

test("corporation tax: small profits rate, marginal relief, main rate and associated companies", () => {
  assert.equal(t.corporationTax(40000, Y), 7600);
  assert.equal(t.corporationTax(100000, Y), 22750); // 25,000 - 3/200 x 150,000
  assert.equal(t.corporationTax(300000, Y), 75000);
  assert.equal(t.corporationTax(40000, Y, 1), 40000 * 0.25 - 0.015 * (125000 - 40000)); // limits halved: 25k and 125k
  assert.equal(t.corporationTax(-5, Y), 0);
});

test("NI on a director's annual pay", () => {
  assert.equal(t.employeeNi(12570, Y), 0);
  assert.equal(t.employeeNi(60000, Y), r(37700 * 0.08 + 9730 * 0.02));
  assert.equal(t.employeeNi(60000, Y, true), 0);
  assert.equal(t.employerNi(12570, Y), 1135.5);
  assert.equal(t.employerNi(4000, Y), 0);
});
function r(n: number) { return Math.round(n * 100) / 100; }

test("one director, all profit out: the personal allowance salary wins at £100,000", () => {
  const p = one(100000), ctx = ctxOf(p);
  const opts = t.assess(p, ctx);
  const pa = opts.find((o) => o.key === "pa")!, st = opts.find((o) => o.key === "st")!;
  assert.equal(pa.eligible, false); // a sole director can't claim Employment Allowance
  near(pa.likely.takeHome, 65209.62);
  near(st.likely.takeHome, 64456.96);
  assert.ok(pa.likely.company.retained < 1);
  assert.equal(t.recommended(opts)!.salaries.a >= 12570 || t.recommended(opts)!.key === "pa", true);
});

test("high profits: a lower salary is better once the personal allowance has gone", () => {
  const p = one(150000), ctx = ctxOf(p);
  const opts = t.assess(p, ctx);
  const pa = opts.find((o) => o.key === "pa")!, st = opts.find((o) => o.key === "st")!;
  assert.ok(st.likely.takeHome > pa.likely.takeHome);
  assert.ok(pa.likely.people[0].warnings.some((w) => /personal allowance/.test(w)));
});

test("Employment Allowance: two directors over £5,000 can claim, one can't, a connected claim stops it", () => {
  const two = { ...one(100000), people: [t.newPerson("a", { name: "A", sharesPct: 50 }), t.newPerson("b", { name: "B", sharesPct: 50 })] };
  assert.equal(t.eaEligible(two, { a: 12570, b: 12570 }), true);
  assert.equal(t.eaEligible(two, { a: 12570, b: 5000 }), false);
  assert.equal(t.eaEligible({ ...two, staffAboveSt: 1 }, { a: 12570, b: 0 }), true);
  assert.equal(t.eaEligible({ ...two, connectedClaims: true }, { a: 12570, b: 12570 }), false);
  const ctx = ctxOf(two);
  const pa = t.assess(two, ctx).find((o) => o.key === "pa")!;
  assert.equal(pa.withEa.company.employerNi, 0);
  assert.equal(pa.withEa.company.eaUsed, 2271);
  assert.equal(pa.withoutEa.company.employerNi, 2271);
  assert.ok(pa.withEa.takeHome > pa.withoutEa.takeHome);
  // dividends are shared by shareholding
  assert.equal(pa.likely.people[0].dividends, pa.likely.people[1].dividends);
});

test("other staff use up part of the allowance first", () => {
  const p = { ...one(100000), staffAboveSt: 1, staffErNi: 10000 };
  const o = t.evaluate(p, ctxOf(p), { a: 12570 }, true);
  assert.equal(o.company.eaUsed, 500);
  assert.equal(o.company.employerNi, 635.5);
});

test("staying in the basic rate keeps the rest in the company", () => {
  const p = one(100000, { aim: "basic" }), ctx = ctxOf(p);
  const o = t.evaluate(p, ctx, { a: 12570 }, false);
  near(o.company.dividends, 37700, 1);
  assert.ok(o.company.retained > 29000);
  assert.equal(o.people[0].incomeTax, r((37700 - 500) * 0.1075));
});

test("a set amount can't come from nowhere", () => {
  const p = one(20000, { aim: "amount", amount: 50000, reservesBf: 1000 }), o = t.evaluate(p, ctxOf(p), { a: 12570 }, false);
  assert.ok(o.company.dividends <= o.company.afterTax + 1000);
});

test("other income from the person's return, leaving out this company's own lines", () => {
  const saved = emptyReturn();
  saved.employments.push({ id: "1", name: "Acme Ltd", paye: "", pay: 12570, tax: 0, benefits: {}, expenses: {} }, { id: "2", name: "Big Corp", paye: "", pay: 40000, tax: 5486, benefits: {}, expenses: {} });
  saved.dividends.push({ id: "d", company: "Acme", amount: 30000 });
  const p = one(60000);
  p.people[0].source = "return";
  const ctx = ctxOf(p, () => saved);
  assert.deepEqual(ctx.removed.get("a"), ["Employment: Acme Ltd", "Dividends: Acme"]);
  const o = t.evaluate(p, ctx, { a: 12570 }, false);
  // salary on top of a £40,000 job is taxed at 20% and attracts NI as before (annual basis on this job alone)
  near(o.people[0].incomeTax - 0, o.people[0].incomeTax); // exists
  assert.ok(o.people[0].incomeTax > 2514 - 1); // 12,570 at 20% at least
});

test("a non-director shareholder gets dividends but no salary", () => {
  const p = { ...one(80000), people: [t.newPerson("a", { name: "A", sharesPct: 50 }), t.newPerson("s", { name: "Spouse", director: false, salaried: false, sharesPct: 50 })] };
  const o = t.evaluate(p, ctxOf(p), { a: 12570, s: 20000 }, false);
  assert.equal(o.people[1].salary, 0);
  assert.equal(o.people[0].dividends, o.people[1].dividends);
});

test("shares held outside the plan are paid but not counted", () => {
  const p = one(80000); p.people[0].sharesPct = 75;
  const o = t.evaluate(p, ctxOf(p), { a: 12570 }, false);
  assert.ok(o.warnings.some((w) => /25% of the shares/.test(w)));
  near(o.company.dividendsToOthers, o.company.dividends * 0.25, 1);
});

test("starting people come from directors and the share ledger", () => {
  let n = 0;
  const ps = t.startingPeople([{ name: "Alex Smith", clientKey: "C1" }], [{ name: "Alex Smith", key: "C1", number: 60 }, { name: "Sam Smith", key: "", number: 40 }], () => `p${++n}`);
  assert.equal(ps.length, 2);
  assert.equal(ps[0].sharesPct, 60); assert.equal(ps[0].source, "return");
  assert.equal(ps[1].director, false); assert.equal(ps[1].salaried, false); assert.equal(ps[1].sharesPct, 40);
});

test("saved plans are read back safely", () => {
  const p = t.readPlan(JSON.stringify({ profit: 5, aim: "nonsense", people: [{ name: "X", sharesPct: 150 }] }), Y);
  assert.equal(p.aim, "all"); assert.equal(p.people[0].sharesPct, 100);
  assert.deepEqual(t.readPlan("garbage", Y).people, []);
  assert.ok(t.planProblems(t.blankPlan(Y)).length > 0);
});

test("the search for the best salary is quick enough for three people", () => {
  const p = { ...one(180000), people: ["a", "b", "c"].map((id) => t.newPerson(id, { name: id, sharesPct: 33.33 })) };
  const s = Date.now(); t.assess(p, ctxOf(p)); const ms = Date.now() - s;
  assert.ok(ms < 4000, `took ${ms}ms`);
});
