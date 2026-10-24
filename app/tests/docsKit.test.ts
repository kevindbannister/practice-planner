import test from "node:test";
import assert from "node:assert/strict";
import { documentFileName, nextReference, snapshotOf, templateFromRow, docFromRow, MAX_BODY } from "../src/ui/docsKit";
import { encodeBody } from "../src/lib/docTemplates";
import { DEFAULT_LAYOUT } from "../src/lib/docModel";

test("references count up within the year", () => {
  assert.equal(nextReference([], 2026), "DOC-2026-0001");
  assert.equal(nextReference([{ reference: "DOC-2026-0007" }, { reference: "DOC-2025-0099" }, { reference: "" }], 2026), "DOC-2026-0008");
});

test("file names are safe and carry the date and reference", () => {
  assert.equal(documentFileName('A/B: "Letter"?', "2026-10-24", "DOC-2026-0001"), "2026-10-24 A B Letter DOC-2026-0001.pdf");
});

test("a saved document keeps a copy of what was made; huge ones drop pictures", () => {
  const small = JSON.parse(snapshotOf({ blocks: [{ type: "p", runs: [{ t: "Hi" }] }] }, DEFAULT_LAYOUT, { values: { a: "b" } }));
  assert.equal(small.content.blocks[0].runs[0].t, "Hi");
  assert.equal(small.values.a, "b");
  const big = "data:image/png;base64," + "A".repeat(MAX_BODY + 10);
  const s = snapshotOf({ blocks: [{ type: "p", runs: [{ t: "Keep this text" }] }, { type: "img", src: big, width: 50 }] }, DEFAULT_LAYOUT, {});
  assert.ok(s.length <= MAX_BODY);
  assert.ok(JSON.parse(s).imagesDropped);
  assert.match(s, /Keep this text/);
});

test("rows from the lists become templates and documents", () => {
  const t = templateFromRow({ Key: "t1", Title: "Mine", Category: "Nonsense", Version: "3", Archived: "true", IsDefault: false, Body: encodeBody({ content: { blocks: [{ type: "p", runs: [{ t: "x" }] }] }, layout: DEFAULT_LAYOUT }) } as never);
  assert.equal(t.category, "Custom documents");
  assert.equal(t.version, 3);
  assert.equal(t.archived, true);
  const d = docFromRow({ Key: "d1", ClientKey: "c1", Pages: "2", TemplateVersion: 1 } as never);
  assert.equal(d.pages, 2);
  assert.equal(d.status, "");
});
