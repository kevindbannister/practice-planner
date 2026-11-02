import test from "node:test";
import assert from "node:assert/strict";
import { accountsFigures, Mapping } from "../src/lib/tbMap";
import { detailGroups } from "../src/lib/accounts";
import { DEFAULT_BRAND, blankSlide, duplicateSlide, kfmt, moveSlide, onColour, presentable, readDeck, refreshDeck, starterDeck, themeOf, yearLabel, SLIDE_TYPES } from "../src/lib/deck";

const m = (dest: string, balance: number, account = dest): Mapping => ({ acct: { key: account, code: account, account, iris: "", type: "", tbDr: 0, tbCr: 0, jDr: 0, jCr: 0, dr: 0, cr: 0, inTb: true, lines: [] }, balance, swBalance: balance, jBalance: 0, iris: "", irisName: "", dest, saved: false, why: "" } as Mapping);
const year = (s: number, c: number, r: number, w: number, bank: number) => { const dr = c + r + w + bank, cr = s + 100; return [m("income/sales", -s, "Sales"), m("expenditure/cos", c, "Materials"), m("expenditure/premises", r, "Rent"), m("expenditure/employee", w, "Wages"), m("bank/current", bank, "Bank"), m("capital/shares", -100), m("capital/reserves", dr - cr > 0 ? -(dr - cr) : cr - dr)]; };
const now = year(100000, 30000, 6000, 20000, 20000), before = year(80000, 28000, 5000, 20000, 15000);
const input = (withPrior = true) => ({ clientName: "Acme Ltd", period: "2026-04-30", f: accountsFigures(now), p: withPrior ? accountsFigures(before) : undefined,
  groups: { expenses: detailGroups(now).expenses, costs: detailGroups(now).costs }, priorGroups: withPrior ? { expenses: detailGroups(before).expenses, costs: detailGroups(before).costs } : undefined, queries: [{ question: "Is the loan repayable?", answer: "" }] });

test("figures read as they do on a slide", () => {
  assert.equal(kfmt(1688000), "£1.69m"); assert.equal(kfmt(169411), "£169.4k"); assert.equal(kfmt(850), "£850"); assert.equal(kfmt(-45200), "-£45.2k");
  assert.equal(yearLabel("2026-04-30"), "2025/26"); assert.equal(yearLabel("2026-12-31"), "2026");
});
test("the starter deck has the standard slides, filled from the figures", () => {
  const d = starterDeck(input());
  assert.deepEqual(d.slides.map((s) => s.type), ["cover", "kpis", "bars", "bridge", "bars", "table", "kpis", "table", "checklist"]);
  assert.equal(d.slides[0].title, "2025/26 business performance review");
  const k = d.slides[1]; assert.equal(k.tiles![0].value, "£100k".replace("£100k", "£100k")); assert.equal(k.tiles![0].change, "+25%");
  const br = d.slides[3].bridge!.rows; assert.equal(br[0].value, 27000); assert.equal(br[br.length - 1].value, 44000);
  assert.equal(br.slice(1, -1).reduce((a, r) => a + r.value, 0), 17000);
  assert.equal(starterDeck(input(false)).slides.some((s) => s.type === "bridge"), false);
});
test("refresh brings figures up to date but keeps titles and notes; hand-made slides are left alone", () => {
  let d = starterDeck(input());
  d = { ...d, slides: d.slides.map((s, i) => (i === 1 ? { ...s, title: "Our best year", notes: "mine" } : s)).concat(blankSlide("text")) };
  const more = input(); more.f = accountsFigures(year(120000, 30000, 6000, 20000, 20000));
  const r = refreshDeck(d, more);
  assert.equal(r.slides[1].title, "Our best year"); assert.equal(r.slides[1].notes, "mine"); assert.equal(r.slides[1].tiles![0].change, "+50%");
  assert.deepEqual(r.slides[r.slides.length - 1].bullets, ["First point", "Second point"]);
});
test("moving, copying and hiding slides; every slide type can be added", () => {
  const d = starterDeck(input());
  const id = d.slides[2].id;
  assert.equal(moveSlide(d, id, -1).slides[1].id, id); assert.equal(moveSlide(d, d.slides[0].id, -1), d);
  const c = duplicateSlide(d, id); assert.equal(c.slides.length, d.slides.length + 1); assert.equal(c.slides[3].auto, undefined);
  const h = { ...d, slides: d.slides.map((s, i) => ({ ...s, hidden: i === 2, internal: i === 3 })) };
  assert.equal(presentable(h).length, d.slides.length - 2); assert.equal(presentable(h, true).length, d.slides.length - 1);
  for (const t of SLIDE_TYPES) assert.equal(blankSlide(t.type).type, t.type);
});
test("colours stay readable; saved decks read back", () => {
  assert.equal(onColour("#141414"), "#ffffff"); assert.equal(onColour("#f6f4ee"), "#141414");
  const t = themeOf({ ...DEFAULT_BRAND, primary: "nope", dark: "#000000" }); assert.equal(t.primary, DEFAULT_BRAND.primary); assert.equal(t.onDark, "#ffffff");
  assert.equal(readDeck(null), undefined); assert.equal(readDeck({ v: 1, slides: [{ id: "a", type: "text" }] })!.slides[0].title, "");
});
