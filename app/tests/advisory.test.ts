import { test } from "node:test";
import assert from "node:assert/strict";
import { LIVING_ITEMS, change, clampTo, emptyPlan, freedomNumber, gap, grossUp, livingMonthly, livingYearly, longTerm, position, positionLevers, positionNow, readPlan, writePlan } from "../src/lib/advisory.ts";

const close = (a: number, b: number, eps = 0.005) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`);

// the numbers in Kevin's workbook: Product 1 recurring, 10 new sales a month at 29 with no variable cost; Product 4 one-off, 1 sale at 100 less 50
const workbook = () => {
  const p = emptyPlan();
  p.products[0] = { name: "Product / Service 1", kind: "recurring", sales: 10, price: 29, variable: 0 };
  p.products[3] = { name: "Product / Service 4", kind: "oneoff", sales: 1, price: 100, variable: 50 };
  p.levers = p.products.map((x) => ({ sales: x.sales, price: x.price, variable: x.variable }));
  return p;
};

test("recurring first year builds up month by month, as the workbook's x78 does", () => {
  const p = workbook();
  const now = positionNow(p);
  close(now.products[0].years[0], 22620); // 10 x 78 x 29
  close(now.products[3].years[0], 600); // 1 x 50 x 12
  close(now.years[0], 23220); // the workbook's "Initial 12 months profits"
});

test("the levers scenario from the workbook: 2 sales at 500 less 300 gives 31,200 in the first year", () => {
  const p = workbook();
  p.levers[0] = { sales: 2, price: 500, variable: 300 };
  const lv = positionLevers(p);
  close(lv.products[0].years[0], 31200); // 2 x 78 x 200
  // the unchanged one-off product still counts (the workbook's total dropped it)
  close(lv.years[0], 31800);
});

test("later years carry everyone who joined earlier", () => {
  const p = workbook();
  p.levers[0] = { sales: 2, price: 500, variable: 300 };
  const lv = positionLevers(p);
  close(lv.products[0].years[1], 2 * 200 * (13 + 24) * 6); // customers 13..24, 2 new a month, 200 each
  assert.ok(lv.products[0].years[1] > lv.products[0].years[0] * 2);
});

test("churn: a customer base that loses everyone each month behaves like a one-off product", () => {
  const p = workbook();
  p.churn = 100;
  close(positionNow(p).products[0].years[0], 10 * 29 * 12);
});

test("existing recurring income is flat across the years", () => {
  const p = emptyPlan();
  p.base = { revenue: 5000, costs: 3500 };
  const now = positionNow(p);
  assert.deepEqual(now.years, [18000, 18000, 18000, 18000, 18000]);
  assert.equal(now.base, 18000);
});

test("a freedom number grosses up for personal and then business tax", () => {
  const n = grossUp(24000, 20, 25);
  close(n.personal, 30000); // 24,000 / 0.8, as the workbook's reverse tax rate
  close(n.business, 40000); // 30,000 / 0.75
  close(n.personalTax, 6000);
  close(n.businessTax, 10000);
});

test("living costs add up monthly and yearly; rows the workbook pointed at the wrong cells now count their own", () => {
  const p = emptyPlan();
  p.living["housing.1"] = 1200;
  p.living["housing.o1"] = 100; // workbook D12 read B10 instead of B12
  p.living["housing.o2"] = 50; // workbook D13 read B11 instead of B13
  p.living["daily.1"] = 400;
  close(livingMonthly(p), 1750);
  close(livingYearly(p), 21000);
});

test("long-term plans are spread over their years and the total counts all ten rows", () => {
  const p = emptyPlan();
  p.long[0] = { label: "Mortgage", amount: 60000, years: 3 };
  p.long[1] = { label: "Debt", amount: 70000, years: 7 };
  p.long[9] = { label: "Last row", amount: 1000, years: 1 }; // the workbook's total stopped before this row
  const lt = longTerm(p);
  close(lt.years[0], 20000 + 10000 + 1000);
  close(lt.years[2], 20000 + 10000);
  close(lt.years[3], 10000);
  close(lt.years[4], 10000);
  close(lt.later, 20000); // years 6 and 7 of the debt
  close(lt.total, 131000);
  // nothing is lost between the five years and what comes after
  close(lt.years.reduce((a, b) => a + b, 0) + lt.later, lt.total);
});

test("the freedom number follows living costs, long-term plans and inflation", () => {
  const p = emptyPlan();
  p.living["housing.1"] = 2000;
  p.inflation = 3;
  p.long[0] = { label: "Mortgage", amount: 30000, years: 2 };
  const f = freedomNumber(p);
  close(f.years[0].spend, 24000 + 15000);
  close(f.years[1].spend, 24000 * 1.03 + 15000);
  close(f.years[2].spend, 24000 * 1.03 * 1.03);
  close(f.years[0].business, (39000 / 0.8) / 0.75);
  close(f.later.spend, 0);
});

test("the gap compares the freedom number with what the business delivers now and with the levers", () => {
  const p = workbook();
  p.living["housing.1"] = 3000;
  p.levers[0] = { sales: 2, price: 500, variable: 300 };
  const g = gap(p);
  const need = (36000 / 0.8) / 0.75;
  close(g.years[0].need, need);
  close(g.years[0].now, 23220);
  close(g.years[0].shortNow, need - 23220);
  close(g.years[0].metNow!, 23220 / need);
  assert.ok(g.years[0].levers > g.years[0].now);
  assert.ok(g.total.shortLevers < g.total.shortNow);
  // a surplus shows as a negative shortfall
  const rich = workbook();
  const gr = gap(rich);
  assert.ok(gr.years[0].shortNow < 0);
  assert.equal(gr.years[0].metNow, undefined); // no freedom number entered yet, so no percentage
});

test("change shows how far a lever has moved", () => {
  assert.deepEqual(change(10, 2), { add: -8, pct: -0.8 }); // the workbook's -8 and -80%
  assert.equal(change(0, 5).pct, undefined);
  close(change(29, 500).pct!, 16.24137931, 1e-6);
});

test("sliders snap to their step and stay in range", () => {
  const price = { min: 0, max: 10000, step: 100 };
  assert.equal(clampTo(471, price), 500);
  assert.equal(clampTo(-20, price), 0);
  assert.equal(clampTo(99999, price), 10000);
  assert.equal(clampTo(7.4, { min: 0, max: 50, step: 1 }), 7);
});

test("a saved plan reads back the same, and bad data is replaced with sensible values", () => {
  const p = workbook();
  p.why = "Mortgage gone by 55 and every Friday off";
  p.living["daily.1"] = 450;
  p.names["housing.o1"] = "Boat mooring";
  p.levers[0] = { sales: 2, price: 500, variable: 300 };
  const again = readPlan(writePlan(p));
  assert.deepEqual(again, p);

  const bad = readPlan('{"living":{"nope":5,"daily.1":-4},"personalTax":400,"products":[{"sales":"x","kind":"weird"}],"long":"no"}');
  assert.equal(bad.living["nope"], undefined);
  assert.equal(bad.living["daily.1"], 0);
  assert.equal(bad.personalTax, 90);
  assert.equal(bad.products.length, 5);
  assert.equal(bad.products[0].kind, "recurring");
  assert.equal(bad.long.length, 10);
  assert.equal(readPlan("not json").products.length, 5);
  assert.equal(readPlan(null).personalTax, 20);
});

test("levers start at today's numbers until they have been set", () => {
  const p = readPlan(JSON.stringify({ products: [{ name: "Fitting", kind: "oneoff", sales: 4, price: 300, variable: 120 }] }));
  assert.deepEqual(p.levers[0], { sales: 4, price: 300, variable: 120 });
});

test("every living item has a unique key", () => {
  const keys = LIVING_ITEMS.map((i) => i.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(position(emptyPlan(), emptyPlan().levers).total === 0);
});
