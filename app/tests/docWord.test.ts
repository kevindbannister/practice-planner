import test from "node:test";
import assert from "node:assert/strict";
import { renderDocx, imageSize } from "../src/lib/docWord";
import { unzip } from "../src/lib/docx";
import { DEFAULT_BRANDING } from "../src/lib/docBranding";
import { Block } from "../src/lib/docModel";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const blocks: Block[] = [
  { type: "h", level: 1, runs: [{ t: "Engagement & <terms>" }] },
  { type: "p", runs: [{ t: "Dear ", b: true }, { t: "Sir\nMadam", i: true, color: "#ff0000", size: 12 }] },
  { type: "list", ordered: true, items: [[{ t: "one" }], [{ t: "two" }]] },
  { type: "table", header: true, rows: [[{ runs: [{ t: "A" }] }, { runs: [{ t: "B" }] }], [{ runs: [{ t: "1" }] }, { runs: [{ t: "£2" }], align: "right" }]] },
  { type: "img", src: PNG, width: 40 },
  { type: "break" },
  { type: "p", runs: [{ t: "Last" }] },
];

test("writes a Word file with every part", async () => {
  const bytes = await renderDocx({ content: { blocks }, branding: { ...DEFAULT_BRANDING, practiceName: "Bannister & Co", logo: PNG, footer: "Registered" }, title: "T" });
  const files = await unzip(bytes);
  const names = files.map((f) => f.name);
  for (const n of ["[Content_Types].xml", "word/document.xml", "word/header1.xml", "word/footer1.xml", "word/styles.xml", "word/_rels/document.xml.rels"]) assert.ok(names.includes(n), n);
  assert.ok(names.some((n) => n.startsWith("word/media/")));
  const doc = new TextDecoder().decode(files.find((f) => f.name === "word/document.xml")!.data);
  assert.match(doc, /Engagement &amp; &lt;terms&gt;/);
  assert.match(doc, /<w:tblHeader\/>/);
  assert.match(doc, /w:br w:type="page"/);
  assert.match(doc, /<a:blip r:embed=/);
  const footer = new TextDecoder().decode(files.find((f) => f.name === "word/footer1.xml")!.data);
  assert.match(footer, /NUMPAGES/);
});

test("reads picture sizes", () => {
  const d = Uint8Array.from(Buffer.from(PNG.split(",")[1], "base64"));
  assert.deepEqual(imageSize(d), { w: 1, h: 1 });
  assert.equal(imageSize(new Uint8Array(10)), undefined);
});
