import assert from "node:assert/strict";
import { test } from "node:test";
import { LAYOUTS, CHART_BLOCKS, TABLE_BLOCKS, TEXT_BLOCKS, anchorFor, copyReport, moveItem, newReport, periodWords, sectionOrientation } from "../src/lib/reportBuilder";

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

test("a page follows the report's orientation unless it has its own", () => {
  const r = newReport("Pack", "month", "2026-10", "portrait", "2026-11-05");
  assert.equal(sectionOrientation(r, { }), "portrait");
  assert.equal(sectionOrientation(r, { orientation: "landscape" }), "landscape");
  assert.equal(sectionOrientation({ ...r, orientation: "landscape" }, { }), "landscape");
});

test("saved templates: made from a report, customised from a built-in, copied, and used for a new report", async () => {
  const { TEMPLATES, asTemplate, copyTemplate, customise, fromSaved, fromTemplate } = await import("../src/lib/reportBuilder");
  const r = fromTemplate(TEMPLATES[0], "Board pack", "2026-01", "2026-02-01");
  const text = r.sections[0].blocks.find((b) => b.type === "text");
  if (text && text.type === "text") text.text = "Written for January";
  const t = asTemplate(r, "2026-02-02");
  assert.equal(t.template, true); assert.notEqual(t.id, r.id); assert.equal(t.anchor, "");
  assert.ok(!JSON.stringify(t).includes("Written for January"), "the commentary is cleared");
  assert.equal(t.sections.length, r.sections.length);
  const c = copyTemplate(t, "2026-02-03");
  assert.equal(c.name, `${t.name} (copy)`); assert.notEqual(c.id, t.id); assert.equal(c.template, true);
  const k = customise(TEMPLATES[0], "2026-02-03");
  assert.equal(k.template, true); assert.equal(k.orientation, "landscape");
  const n = fromSaved({ ...t, orientation: "landscape" }, "", "2026-03", "portrait", "2026-04-01");
  assert.equal(n.orientation, "portrait"); assert.equal(n.template, undefined); assert.equal(n.anchor, "2026-03"); assert.equal(n.status, "draft"); assert.equal(n.name, t.name);
  assert.equal(t.template, true, "the template itself is untouched");
});
