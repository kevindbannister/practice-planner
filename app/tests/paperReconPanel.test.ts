import "./support/reactGlobal";
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DataContext } from "../src/ui/data";
import { AssetSummary, PaperWriter, Schedule, SectionRecon } from "../src/ui/PaperSchedules";
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
