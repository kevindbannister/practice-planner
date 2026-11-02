import test from "node:test";
import assert from "node:assert/strict";
import { accountsFigures, Mapping } from "../src/lib/tbMap";
import { detailGroups } from "../src/lib/accounts";
import { bindDeck, figureChecks, measure, options } from "../src/lib/deckFigures";
import { ctxOf, planStatus, refreshDeck, setInclude, starterDeck } from "../src/lib/deckPlan";
import { DeckInput } from "../src/lib/deck";

const m = (dest: string, balance: number, account = dest): Mapping => ({ acct: { key: account, code: account, account, iris: "", type: "", tbDr: 0, tbCr: 0, jDr: 0, jCr: 0, dr: 0, cr: 0, inTb: true, lines: [] }, balance, swBalance: balance, jBalance: 0, iris: "", irisName: "", dest, saved: false, why: "" } as Mapping);
const year = (s: number, c: number, w: number, bank: number, extra: Mapping[] = []) => { const list = [m("income/sales", -s, "Sales"), m("expenditure/cos", c, "Materials"), m("expenditure/employee", w, "Wages"), m("bank/current", bank, "Bank"), m("capital/shares", -100), ...extra]; const sum = list.reduce((a, x) => a + x.balance, 0); return [...list, m("capital/reserves", -sum)]; };
const input = (now: Mapping[], before?: Mapping[], queries: DeckInput["queries"] = []): DeckInput => ({ clientName: "Acme", period: "2026-04-30", f: accountsFigures(now), p: before && accountsFigures(before), maps: now, priorMaps: before,
  groups: { expenses: detailGroups(now).expenses, costs: detailGroups(now).costs }, priorGroups: before && { expenses: detailGroups(before).expenses, costs: detailGroups(before).costs }, queries });
const keys = (d: { slides: { auto?: string }[] }) => d.slides.map((s) => s.auto);

test("measures: built in, growth, account and custom figures", () => {
  const now = year(100000, 30000, 20000, 20000), before = year(80000, 28000, 20000, 15000), i = input(now, before);
  const c = ctxOf(i, [{ key: "c:1", label: "Sales and materials", accounts: ["Sales", "Materials"] }]);
  assert.equal(measure("turnover", c).now, 100000); assert.equal(measure("turnover", c).prior, 80000);
  assert.equal(measure("wages", c).now, 20000);
  assert.equal(measure("g:turnover", c).now, 25);
  assert.equal(measure("a:Bank", c).now, 20000);
  assert.equal(measure("c:1", c).now, -70000);
  assert.equal(measure("c:1", { ...c, custom: [{ ...c.custom[0], flip: true }] }).now, 70000);
  assert.ok(options(c).some((g) => g.group === "Your own figures"));
  assert.ok(options(c).find((g) => g.group === "Trial balance accounts")!.items.some((x) => x.key === "a:Wages"));
  assert.equal(measure("turnover", ctxOf(input(now))).prior, undefined);
});

test("a tile follows the figure it points at", () => {
  const now = year(100000, 30000, 20000, 20000), i = input(now, year(80000, 28000, 20000, 15000)), d = starterDeck(i), c = ctxOf(i);
  const head = d.slides.find((s) => s.auto === "headline")!;
  assert.equal(head.tiles![0].m, "turnover");
  const re = { ...d, slides: d.slides.map((s) => (s.auto === "headline" ? { ...s, tiles: s.tiles!.map((t, k) => (k === 0 ? { ...t, m: "wages" } : t)) } : s)) };
  assert.equal(bindDeck(re, c).slides.find((s) => s.auto === "headline")!.tiles![0].value, "£20k");
  assert.equal(bindDeck(d, c), d); // nothing changed, same deck back
});

test("the plan switches slides by the figures", () => {
  const plain = starterDeck(input(year(100000, 30000, 20000, 20000), year(80000, 28000, 20000, 15000)));
  assert.ok(keys(plain).includes("growth")); assert.ok(!keys(plain).includes("dividends")); assert.ok(!keys(plain).includes("dla")); assert.ok(!keys(plain).includes("questions"));
  const first = starterDeck(input(year(100000, 30000, 20000, 20000)));
  assert.ok(!keys(first).includes("growth")); assert.ok(!keys(first).includes("movement"));
  const rich = year(100000, 30000, 20000, 20000, [m("capital/dividends", 10000, "Dividends"), m("creditors/dla", 4000, "Directors loan")]);
  const d = starterDeck(input(rich, year(80000, 28000, 20000, 15000), [{ question: "Q", answer: "" }]));
  for (const k of ["dividends", "dla", "questions"]) assert.ok(keys(d).includes(k), k);
  assert.match(d.slides.find((s) => s.auto === "dla")!.takeaway!, /owes the company/);
  // order follows the storyline
  const k = keys(d) as string[]; assert.ok(k.indexOf("tax") < k.indexOf("dividends") && k.indexOf("dividends") < k.indexOf("questions") && k[k.length - 1] === "next");
});

test("switching a slide on or off is remembered and refresh respects it", () => {
  const i = input(year(100000, 30000, 20000, 20000), year(80000, 28000, 20000, 15000));
  let d = starterDeck(i);
  assert.ok(!keys(d).includes("dividends"));
  d = setInclude(d, i, "dividends", true);
  assert.ok(keys(d).includes("dividends"));
  d = setInclude(d, i, "growth", false);
  assert.ok(!keys(d).includes("growth"));
  d = refreshDeck(d, i);
  assert.ok(!keys(d).includes("growth"), "a slide switched off stays off");
  assert.ok(keys(d).includes("dividends"));
  const row = planStatus(d, i).find((r) => r.key === "growth")!;
  assert.equal(row.forced, true); assert.equal(row.on, false);
});

test("refresh adds newly relevant slides and keeps hand edits", () => {
  const before = year(80000, 28000, 20000, 15000);
  const i1 = input(year(100000, 30000, 20000, 20000), before);
  let d = starterDeck(i1);
  d = { ...d, slides: d.slides.map((s) => (s.auto === "headline" ? { ...s, title: "My title" } : s)) };
  const i2 = input(year(100000, 30000, 20000, 20000, [m("creditors/dla", -3000, "DLA")]), before);
  const r = refreshDeck(d, i2);
  assert.equal(r.slides.find((s) => s.auto === "headline")!.title, "My title");
  assert.ok(keys(r).includes("dla"));
});

test("checks warn about unmapped and missing figures", () => {
  const c = ctxOf(input(year(100000, 30000, 20000, 20000, [m("ignore", 500, "Odd")])));
  const w = figureChecks(undefined, c);
  assert.ok(w.some((x) => /Leave out|does not balance/.test(x))); assert.ok(w.some((x) => /last year/.test(x)));
});
