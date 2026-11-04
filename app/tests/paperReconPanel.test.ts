import "./support/reactGlobal";
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DataContext } from "../src/ui/data";
import { AssetSummary, AssetsView, LeadTable, DisposalsFromRegisters, PaperWriter, Schedule, SectionRecon } from "../src/ui/PaperSchedules";
import { SECTIONS } from "../src/lib/papers";

const P = "2026-03-31", client = { Key: "C1", Title: "Kent Stove" } as any;
const tb = (Key: string, Code: string, Detail: string, type: string, dr?: number, cr?: number) => ({ Key, ClientKey: "C1", PeriodEnd: P, SectionKey: "tb", SubKey: "main", Code, Detail, Seq: Number(Key.slice(1)), Figures: JSON.stringify({ type, dr, cr }) });
const reg = (Key: string, sub: string, Detail: string, f: Record<string, unknown>, seq: number) => ({ Key, ClientKey: "C1", PeriodEnd: P, SectionKey: "fixed", SubKey: sub, Detail, Seq: seq, Figures: JSON.stringify(f) });
const setup = (ItemKey: string, s: Record<string, unknown>) => ({ Key: `S${ItemKey}`, ClientKey: "C1", PeriodEnd: P, ItemKey, Setup: JSON.stringify(s) });

const paperLines = [
  tb("T1", "230", "Plant and machinery - cost", "Fixed Asset", 15000),
  tb("T2", "231", "Plant and machinery - accumulated depreciation", "Fixed Asset", undefined, 2000),
  tb("T3", "200", "Sales", "Revenue", undefined, 20000),
  tb("T4", "310", "Wages", "Overheads", 7000),
  reg("R1", "plant", "Old lathe", { costBf: 10000, depBf: 2000 }, 1),
  reg("R2", "plant", "New press", { add: 5000, date: "2025-10-01" }, 2),
];
const render = (node: (section: any) => any, papers: any[] = [setup("fixed/plant", { method: "sl", rate: 20 })], lines: any[] = paperLines) => {
  const data: any = { settings: [], papers, paperLines: lines, clients: [client] };
  const ctx: any = { data, user: "Kevin", create: async (_l: string, r: any) => r, createMany: async () => undefined, update: async () => undefined, remove: async () => undefined };
  const fixed = SECTIONS.find((s) => s.key === "fixed")!;
  return renderToStaticMarkup(createElement(DataContext.Provider, { value: ctx }, createElement(PaperWriter, { client, period: P, children: node(fixed) } as any)));
};

test("the fixed asset summary has a tick box per class and hides classes with nothing in the trial balance", () => {
  const h = render((fixed) => createElement(AssetSummary, { section: fixed }));
  assert.match(h, /Columns shown/);
  assert.equal((h.match(/type="checkbox"/g) || []).length, 5, "one tick box per class");
  assert.match(h, /Motor vehicles<\/span><span class="muted"> \(nothing in the trial balance\)/);
  assert.match(h, /<th scope="col" class="num">Plant and machinery/);
  assert.doesNotMatch(h, /<th scope="col" class="num">Motor vehicles/);
});

test("a class the user ticks on shows even with nothing in the trial balance", () => {
  const h = render((fixed) => createElement(AssetSummary, { section: fixed }), [setup("fixed/plant", { method: "sl", rate: 20 }), setup("fixed", { cols: { motor: true, plant: false } })]);
  assert.match(h, /<th scope="col" class="num">Motor vehicles/);
  assert.doesNotMatch(h, /<th scope="col" class="num">Plant and machinery/);
  assert.match(h, /The total includes Plant and machinery, which is hidden but has figures/);
});

test("this year's additions list the assets added in the registers", () => {
  const h = render((fixed) => createElement(Schedule, { section: fixed, sb: fixed.subs.find((s) => s.key === "additions")! }));
  assert.match(h, /New press/); assert.match(h, /5,000\.00/); assert.doesNotMatch(h, /Old lathe/);
  assert.match(h, /Total additions/); assert.match(h, /Agrees to the registers/);
});

test("the depreciation journal is offered when the trial balance is short of the registers' depreciation", () => {
  const journals = SECTIONS.find((s) => s.key === "journals")!;
  const h = render(() => createElement(Schedule, { section: journals, sb: journals.subs.find((s) => s.key === "dep")! }));
  assert.match(h, /The trial balance is short of the depreciation the registers show/);
  assert.match(h, /Post the depreciation journal/);
  assert.match(h, /Depreciation/); assert.match(h, /Plant and machinery - accumulated depreciation/);
});

test("a section says whether it agrees to the trial balance", () => {
  const off = render((fixed) => createElement(SectionRecon, { section: fixed }));
  assert.match(off, /Doesn&#x27;t agree to the trial balance/); assert.match(off, /Plant and machinery: depreciation \(3,000.00\)/);
  const ok = render((fixed) => createElement(SectionRecon, { section: fixed }), [setup("fixed/plant", { method: "none" })], [tb("T1", "230", "Plant and machinery - cost", "Fixed Asset", 15000), tb("T2", "231", "Plant and machinery - accumulated depreciation", "Fixed Asset", undefined, 2000), reg("R1", "plant", "Old lathe", { costBf: 10000, depBf: 2000 }, 1), reg("R2", "plant", "New press", { add: 5000 }, 2)]);
  assert.match(ok, /Agrees to the trial balance/);
});

const withDisposal = [...paperLines, reg("R3", "plant", "Sold drill", { costBf: 3000, depBf: 2500, disp: 3000, depDisp: 2500, proceeds: 800, disposedOn: "2025-12-01" }, 3), reg("R4", "plant", "Scrapped saw", { costBf: 500, depBf: 500, disp: 500, depDisp: 500 }, 4)];

test("the fixed asset section opens on the lead schedule, with additions and disposals in tabs and no register open", () => {
  const h = render((fixed) => createElement(AssetsView, { section: fixed }));
  assert.match(h, /class="lead-split asset-split"/); assert.match(h, /class="asset-pick"/);
  assert.doesNotMatch(h, /class="lead-panel"/, "no register is open until an asset type is clicked");
  assert.match(h, /This year&#x27;s additions/); assert.match(h, /Disposals<\/button>/);
  assert.match(h, /New press/, "the additions tab is the one showing");
  assert.doesNotMatch(h, /Sold drill/);
});

test("with an asset type picked, only its column shows (no total) and the others are hidden", () => {
  const h = render((fixed) => createElement(AssetSummary, { section: fixed, picked: "plant", onPick: () => undefined }), [setup("fixed/plant", { method: "sl", rate: 20 }), setup("fixed", { cols: { motor: true } })]);
  assert.match(h, /aria-pressed="true"[^>]*>Plant and machinery</);
  assert.doesNotMatch(h, />Motor vehicles</); assert.doesNotMatch(h, />Total</); assert.doesNotMatch(h, /Columns shown/);
});

test("the disposals tab lists each disposal with NBV, the proceeds typed and the profit or loss", () => {
  const h = render((fixed) => createElement(DisposalsFromRegisters, { section: fixed }), [setup("fixed/plant", { method: "none" })], withDisposal);
  assert.match(h, /Sold drill/); assert.match(h, /Scrapped saw/); assert.doesNotMatch(h, /Old lathe/);
  assert.match(h, /Profit on disposal/);
  assert.match(h, /300\.00/, "NBV of the drill (3,000 less 2,500) is 500: proceeds 800 give a profit of 300 on that line");
  assert.match(h, /Proceeds not entered/);
});

test("with no disposals the tab says how to record one", () => {
  const h = render((fixed) => createElement(DisposalsFromRegisters, { section: fixed }));
  assert.match(h, /No disposals in the registers this year/);
});

test("a lead schedule sits on the left, with no choice of how a line opens and nothing open until one is clicked", () => {
  const exp = SECTIONS.find((s) => s.key === "expenditure")!;
  const h = render(() => createElement(LeadTable, { section: exp }));
  assert.match(h, /class="lead-split asset-split"/);
  assert.match(h, /lead-main asset-main stack"/);
  assert.doesNotMatch(h, /Side panel|Under the line/);
  assert.doesNotMatch(h, /class="lead-panel"/);
  assert.match(h, /open its working on the right/);
});

test("the year end trial balance shows last year's final figures read-only, linked to last year's papers, with a box to use different figures", () => {
  const prior = (Key: string, Code: string, Detail: string, f: Record<string, unknown>, seq: number) => ({ Key, ClientKey: "C1", PeriodEnd: "2025-03-31", SectionKey: "tb", SubKey: "main", Code, Detail, Seq: seq, Figures: JSON.stringify(f) });
  const lines = [tb("T3", "200", "Sales", "Revenue", undefined, 20000), prior("P1", "200", "Sales", { cr: 17000 }, 1)];
  const show = (papers: any[]) => render(() => createElement(Schedule, { section: SECTIONS.find((s) => s.key === "tb")!, sb: SECTIONS.find((s) => s.key === "tb")!.subs[0] }), papers, lines);
  const h = show([]);
  assert.match(h, /final trial balance/); assert.match(h, /can&#x27;t be changed from this year/); assert.match(h, /href="[^"]*C1[^"]*2025-03-31/);
  assert.match(h, /Use different figures for last year/); assert.match(h, /17,000\.00/);
  assert.doesNotMatch(h, /aria-label="2025 credit for Sales"/);
  const own = show([setup("tb/main", { priorOwn: true })]);
  assert.match(own, /Edit them here/);
});
