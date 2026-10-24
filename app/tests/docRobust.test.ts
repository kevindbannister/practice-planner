import test from "node:test";
import assert from "node:assert/strict";
import * as lib from "pdf-lib";
import { renderPdf } from "../src/lib/docPdf";
import { renderDocx } from "../src/lib/docWord";
import { DEFAULT_BRANDING } from "../src/lib/docBranding";
import { Block, parseHtml, toHtml, plainText } from "../src/lib/docModel";

const brand = { ...DEFAULT_BRANDING, practiceName: "X" };
const run = (blocks: Block[]) => renderPdf(lib, { content: { blocks }, branding: brand });
const pages = async (b: Uint8Array) => (await lib.PDFDocument.load(b)).getPageCount();

test("empty document and blank paragraphs render one page", async () => {
  assert.equal(await pages(await run([])), 1);
  assert.equal(await pages(await run([{ type: "p", runs: [] }])), 1);
});
test("a word wider than the page, and a very long paragraph", async () => {
  assert.ok(await pages(await run([{ type: "p", runs: [{ t: "W".repeat(400) }] }])) >= 1);
  assert.ok(await pages(await run([{ type: "p", runs: [{ t: "word ".repeat(5000) }] }])) > 3);
});
test("tables: ragged rows, empty cells, tall cells, header only, wide", async () => {
  const c = (t: string) => ({ runs: [{ t }] });
  await run([{ type: "table", header: true, rows: [[c("a")], [c("a"), c("b"), c("c")], []] }]);
  await run([{ type: "table", header: true, rows: [[c("H1"), c("H2")]] }]);
  const tall = c("line of text in a cell ".repeat(900));
  assert.ok(await pages(await run([{ type: "table", header: true, rows: [[c("H"), c("H")], [tall, c("x")]] }])) >= 2);
  await run([{ type: "table", header: false, rows: [Array.from({ length: 8 }, () => c("some wide column text here"))] }]);
});
test("odd characters, tabs, emoji and unicode do not crash", async () => {
  await run([{ type: "p", runs: [{ t: "tab\there €£ “smart” – dash 😀 日本語  nbsp ñ é" }] }]);
});
test("bad images are skipped, not fatal", async () => {
  await run([{ type: "img", src: "data:image/png;base64,AAAA", width: 50 }, { type: "p", runs: [{ t: "after" }] }]);
  await renderDocx({ content: { blocks: [{ type: "img", src: "data:image/png;base64,AAAA", width: 50 }] }, branding: brand });
});
test("a bad logo is ignored", async () => {
  await renderPdf(lib, { content: { blocks: [] }, branding: { ...brand, logo: "data:image/png;base64,AAAA" } });
});
test("pasted hostile html is reduced to safe content and round-trips", () => {
  const evil = '<p onclick="x()">Hi<script>alert(1)</script><iframe src="//e"></iframe><a href="javascript:1">link</a><img src="javascript:1"><img src="https://e/x.png"><style>p{}</style><b style="color:red;background:url(x)">bold</b></p><svg><script>1</script></svg>';
  const c = parseHtml(evil);
  const html = toHtml(c, false);
  assert.doesNotMatch(html, /script|iframe|onclick|javascript|https:|svg|style>|url\(/i);
  assert.match(plainText(c), /Hi/);
  assert.match(plainText(c), /bold/);
  assert.deepEqual(parseHtml(toHtml(c)), c);
});
