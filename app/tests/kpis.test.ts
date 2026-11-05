import assert from "node:assert/strict";
import { test } from "node:test";
import { computeKpis, formatKpi } from "../src/lib/kpis";

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
  const q = computeKpis(d, "quarter", "2026-09", 9);
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
