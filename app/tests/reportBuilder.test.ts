import assert from "node:assert/strict";
import { test } from "node:test";
import { LAYOUTS, CHART_BLOCKS, TABLE_BLOCKS, TEXT_BLOCKS, anchorFor, copyReport, moveItem, newReport, periodWords } from "../src/lib/reportBuilder";

test("a new report starts as a draft with an Introduction section", () => {
  const r = newReport("  Board pack ", "month", "2026-10", "portrait", "2026-11-05");
  assert.equal(r.name, "Board pack"); assert.equal(r.status, "draft");
  assert.deepEqual(r.sections.map((s) => s.title), ["Introduction"]);
  assert.equal(newReport("", "year", "", "landscape", "x").name, "Report");
});
test("periods in words", () => {
  assert.equal(periodWords("month", "2026-10"), "October 2026");
  assert.equal(periodWords("quarter", "2026-10"), "Quarter to October 2026");
  assert.equal(periodWords("year", "2026-03"), "Year to March 2026");
  assert.equal(periodWords("month", ""), "");
});
test("moveItem moves within bounds and leaves the list alone otherwise", () => {
  assert.deepEqual(moveItem([1, 2, 3], 0, 2), [2, 3, 1]);
  const l = [1, 2, 3]; assert.equal(moveItem(l, 0, 5), l);
});
test("every block and layout makes blocks with their own ids", () => {
  const ids = new Set<string>();
  for (const p of [...TEXT_BLOCKS, ...CHART_BLOCKS, ...TABLE_BLOCKS]) { const b = p.make(); assert.ok(!ids.has(b.id)); ids.add(b.id); }
  for (const l of LAYOUTS) { const bs = l.make(); assert.ok(bs.length > 0); for (const b of bs) { assert.ok(!ids.has(b.id), l.name); ids.add(b.id); } }
});
test("a copy of a published report is a new draft", () => {
  const r = { ...newReport("A", "month", "2026-10", "portrait", "t"), status: "published" as const, publishedAt: "p", file: "f" };
  const c = copyReport(r, "n");
  assert.notEqual(c.id, r.id); assert.equal(c.status, "draft"); assert.equal(c.file, undefined); assert.equal(c.name, "A (copy)");
});
test("anchor falls back to the latest month", () => {
  assert.equal(anchorFor({ anchor: "" }, ["2026-08", "2026-09"]), "2026-09");
  assert.equal(anchorFor({ anchor: "2026-08" }, ["2026-08", "2026-09"]), "2026-08");
  assert.equal(anchorFor({ anchor: "2020-01" }, ["2026-08", "2026-09"]), "2026-09");
});

test("next period's copy moves the period on, keeps the layout and clears the commentary", async () => {
  const { nextCopy, newReport, uid } = await import("../src/lib/reportBuilder");
  const r = newReport("Management pack October 2026", "month", "2026-10", "portrait", "2026-11-01T00:00:00Z");
  r.status = "published"; r.file = "x"; r.publishedAt = "2026-11-02";
  r.sections[0].blocks = [{ id: uid(), type: "text", style: "heading", text: "Overview" }, { id: uid(), type: "text", style: "paragraph", text: "Sales were up." }, { id: uid(), type: "kpis", title: "KPIs" }] as never;
  const n = nextCopy(r, "2026-12-01T00:00:00Z", "2026-11");
  assert.equal(n.name, "Management pack November 2026");
  assert.equal(n.anchor, "2026-11");
  assert.equal(n.status, "draft"); assert.equal(n.file, undefined); assert.notEqual(n.id, r.id);
  assert.deepEqual(n.sections[0].blocks.map((b) => (b as { text?: string }).text), ["Overview", "", undefined]);
  assert.equal(r.sections[0].blocks[1].type === "text" && r.sections[0].blocks[1].text, "Sales were up."); // the original is untouched
  assert.equal(nextCopy({ ...r, anchor: "2026-11" }, "2026-12-01T00:00:00Z", "2026-11").anchor, ""); // no December figures yet: the latest month
  assert.equal(nextCopy({ ...r, name: "Board pack" }, "2026-12-01T00:00:00Z", "2026-11").name, "Board pack (next)");
});
