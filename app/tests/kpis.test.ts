import assert from "node:assert/strict";
import { test } from "node:test";
import { KPI_DEFS, computeKpis, formatKpi, wheelLayout } from "../src/lib/kpis";

const months = ["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
const flat = (v: number) => months.map(() => v);
const d = {
  months,
  pl: [
    { code: "200", name: "Sales", group: "income", amounts: flat(100000) },
    { code: "310", name: "Purchases", group: "cos", amounts: flat(60000) },
    { code: "400", name: "Rent", group: "expense", amounts: flat(15000) },
    { code: "270", name: "Interest", group: "other", amounts: flat(0) },
  ],
  bsMonths: months,
  bs: [
    { code: "610", name: "Trade Debtors", group: "curAsset", amounts: flat(200000) },
    { code: "630", name: "Stock", group: "curAsset", amounts: flat(60000) },
    { code: "090", name: "Bank", group: "bank", amounts: flat(30000) },
    { code: "700", name: "Fixed assets", group: "fixed", amounts: flat(110000) },
    { code: "800", name: "Trade Creditors", group: "curLiab", amounts: flat(90000) },
    { code: "820", name: "Bank loan", group: "curLiab", amounts: flat(20000) },
    { code: "900", name: "Long term loan", group: "ltLiab", amounts: flat(80000) },
    { code: "960", name: "Retained earnings", group: "equity", amounts: flat(210000) },
  ],
};
const k = (res: ReturnType<typeof computeKpis>, id: string) => res.find((x) => x.def.id === id)!;

test("a month's profit measures, days and ratios are worked out from the figures", () => {
  const r = computeKpis(d, "month", "2026-09", 9);
  assert.equal(k(r, "revenue").value, 100000);
  assert.equal(k(r, "gpm").value, 40);
  assert.equal(k(r, "opm").value, 25);
  assert.equal(k(r, "ardays").value, 60); // 200,000 over 100,000 a month, 30 days
  assert.equal(k(r, "invdays").value, 30);
  assert.equal(k(r, "apdays").value, 45);
  assert.equal(k(r, "current").value, 2.64); // (200,000 + 60,000 + 30,000) over (90,000 + 20,000)
  assert.equal(k(r, "quick").value, 2.09); // without the stock
});

test("the target for an amount is added up over a quarter or a year; ratios are not", () => {
  const q = computeKpis(d, "quarter", "2026-09", 9, { targets: { revenue: 90000 } });
  assert.equal(k(q, "revenue").value, 300000);
  assert.equal(k(q, "revenue").target, 270000);
  assert.equal(k(q, "gpm").target, 35);
  assert.equal(k(q, "revenue").onTrack, true);
});

test("a lower-is-better KPI is on track when at or under its target", () => {
  const r = computeKpis(d, "month", "2026-09", 9);
  assert.equal(k(r, "ardays").onTrack, false); // 60 days against 40
  assert.equal(k(r, "apdays").onTrack, true); // 45 against 45, higher is fine
  assert.equal(k(r, "dta").onTrack, true);
});

test("returns are scaled to a year, and growth compares with the same months last year", () => {
  const r = computeKpis(d, "month", "2026-09", 9);
  assert.equal(k(r, "roe").value, 142.86); // 25,000 a month is 300,000 a year, over 210,000 of equity
  assert.equal(k(r, "revg").value, 0);
});

test("settings change a target and switch a KPI off", () => {
  const r = computeKpis(d, "month", "2026-09", 9, { targets: { gpm: 45 }, off: ["cash"] });
  assert.equal(k(r, "gpm").target, 45);
  assert.equal(k(r, "gpm").onTrack, false);
  assert.ok(!r.some((x) => x.def.id === "cash"));
});

test("with no balance sheet the balance KPIs have no result and say why", () => {
  const r = computeKpis({ ...d, bs: [] }, "month", "2026-09", 9);
  assert.equal(k(r, "ardays").value, undefined);
  assert.equal(k(r, "ardays").note, "Needs the balance sheet");
  assert.equal(k(r, "gpm").value, 40);
});

test("figures show in their own units", () => {
  assert.equal(formatKpi("money", 1234.5), "£1,235");
  assert.equal(formatKpi("percent", 12.345), "12.35%");
  assert.equal(formatKpi("days", 44.6), "45 days");
  assert.equal(formatKpi("ratio", 0.58), "0.58:1");
  assert.equal(formatKpi("money", undefined), "–");
});

test("wheelLayout puts every KPI on the circle with a gap after each category", () => {
  const res = KPI_DEFS.map((def, i) => ({ def, target: 1, hasTarget: true, value: i % 3 === 0 ? undefined : 2, onTrack: i % 3 === 0 ? undefined : i % 2 === 0 }));
  const { items, groups } = wheelLayout(res);
  assert.equal(items.length, KPI_DEFS.length);
  assert.equal(groups.length, 7);
  assert.ok(items.every((x) => x.angle > 0 && x.angle < 360));
  const step = 360 / (KPI_DEFS.length + 7);
  const a = items.filter((x) => x.category === "Profitability");
  const next = items.find((x) => x.category === "Activity")!;
  assert.ok(Math.abs(next.angle - a[a.length - 1].angle - 2 * step) < 1e-9);
  assert.equal(items[0].status, "none");
  assert.equal(items[1].status, "off");
  assert.equal(items[2].status, "on");
  assert.equal(wheelLayout([]).items.length, 0);
});

test("wheelLayout by result puts off-track first in one arc; by importance groups High, Medium, Low", () => {
  const res = KPI_DEFS.map((def, i) => ({ def, target: 1, value: 2, onTrack: i % 2 === 0 }));
  const r = wheelLayout(res, "result");
  assert.equal(r.groups.length, 0);
  assert.ok(r.items.slice(0, 9).every((x) => x.status === "off") && r.items.slice(9).every((x) => x.status === "on"));
  const imp = wheelLayout(res, "importance");
  assert.deepEqual(imp.groups.map((g) => g.category), ["High", "Medium", "Low"]);
  assert.equal(imp.items.length, KPI_DEFS.length);
});

import { alertWording, importanceOf, triggeredAlerts } from "../src/lib/kpis";
test("importance falls back to the standard and can be overridden", () => {
  assert.equal(importanceOf("revenue"), "High");
  assert.equal(importanceOf("revenue", { importance: { revenue: "Critical" } }), "Critical");
  assert.equal(importanceOf("unknown"), "Medium");
  const res = KPI_DEFS.map((def) => ({ def, target: 1, value: 2, onTrack: true }));
  const g = wheelLayout(res, "importance", { revenue: "Critical" });
  assert.deepEqual(g.groups.map((x) => x.category), ["Critical", "High", "Medium", "Low"]);
});
test("alerts fire on the wrong side of the threshold, scaled for amounts", () => {
  const rev = KPI_DEFS.find((k) => k.id === "revenue")!, ar = KPI_DEFS.find((k) => k.id === "ardays")!, gpm = KPI_DEFS.find((k) => k.id === "gpm")!;
  const res = [
    { def: rev, target: 270000, hasTarget: true, months: 3, value: 200000, onTrack: false },   // a quarter: target 90,000 a month
    { def: ar, target: 40, hasTarget: true, months: 3, value: 55, onTrack: false },
    { def: gpm, target: 35, hasTarget: true, months: 3, value: 40, onTrack: true },
  ];
  const s = { alerts: { revenue: { on: true, threshold: 80000 }, ardays: { on: true }, gpm: { on: true, threshold: 45 } } };
  const t = triggeredAlerts(res, s);
  assert.deepEqual(t.map((x) => x.def.id), ["revenue", "ardays", "gpm"]);
  assert.equal(t[0].threshold, 240000); // 80,000 a month over three months
  assert.equal(t[1].threshold, 40);     // no threshold set: the target
  assert.deepEqual(triggeredAlerts(res, { alerts: { gpm: { on: true, threshold: 30 }, ardays: { on: false } } }), []);
  assert.equal(alertWording(ar), "Accounts Receivable Days exceeds");
  assert.equal(alertWording(gpm), "Gross Profit Margin is less than");
});

test("the money KPIs have no target until one is set, so they are neither on nor off track and raise no alert", () => {
  const r = computeKpis(d, "month", "2026-09", 9);
  assert.equal(k(r, "revenue").hasTarget, false);
  assert.equal(k(r, "revenue").onTrack, undefined);
  assert.equal(k(r, "cash").onTrack, undefined);
  assert.equal(k(r, "gpm").hasTarget, true);
  assert.deepEqual(triggeredAlerts(r, { alerts: { revenue: { on: true }, cash: { on: true } } }), []);
  const set = computeKpis(d, "month", "2026-09", 9, { targets: { cash: 1 } });
  assert.equal(k(set, "cash").hasTarget, true);
  assert.equal(k(set, "cash").onTrack, true);
});

test("debtor days compare debtors with revenue plus VAT when the client has a VAT account", () => {
  const month = ["2026-09"];
  const mk = (vatAccount: boolean) => ({
    months: month, bsMonths: month,
    pl: [{ code: "200", name: "Sales", group: "income", amounts: [10000] }],
    bs: [{ code: "610", name: "Accounts Receivable", group: "curAsset", amounts: [12000] }, ...(vatAccount ? [{ code: "820", name: "VAT", group: "curLiab", amounts: [500] }] : [])],
  });
  const days = (x: ReturnType<typeof mk>) => computeKpis(x, "month", "2026-09", 9).find((r) => r.def.id === "ardays")!.value;
  assert.equal(days(mk(false)), 36);  // 12,000 over 10,000 for 30 days
  assert.equal(days(mk(true)), 30);   // 12,000 over 12,000 (10,000 plus 20% VAT)
});

test("a snapshot keeps the headline figures for the practice-wide view", async () => {
  const { snapshotOf } = await import("../src/lib/kpis");
  const mk = (id: string, value?: number) => ({ def: { id }, value }) as never;
  const s = snapshotOf([mk("revenue", 1000), mk("gpm", 41.5), mk("roe", 12), mk("cash", undefined), mk("npm", NaN)], "2026-11-10T09:00:00Z", "2026-10");
  assert.deepEqual(s, { at: "2026-11-10T09:00:00Z", month: "2026-10", k: { revenue: 1000, gpm: 41.5 } });
});
