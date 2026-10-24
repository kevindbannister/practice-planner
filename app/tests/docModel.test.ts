import assert from "node:assert/strict";
import { test } from "node:test";
import { DocContent, allRuns, parseHtml, plainText, readContent, toHtml } from "../src/lib/docModel";

test("paragraphs, marks, headings and lists are read from editor HTML", () => {
  const c = parseHtml('<h1 style="text-align:center">Title</h1><p>Hello <b>bold</b> and <i><u>both</u></i> <span style="color:#ff0000;font-size:14pt">red</span></p><ul><li>one</li><li>two</li></ul><ol><li>first</li></ol>');
  assert.deepEqual(c.blocks[0], { type: "h", level: 1, align: "center", runs: [{ t: "Title" }] });
  const p = c.blocks[1] as { runs: { t: string; b?: boolean; i?: boolean; u?: boolean; color?: string; size?: number }[] };
  assert.deepEqual(p.runs.map((r) => r.t), ["Hello ", "bold", " and ", "both", " ", "red"]);
  assert.equal(p.runs[1].b, true);
  assert.ok(p.runs[3].i && p.runs[3].u);
  assert.equal(p.runs[5].color, "#ff0000");
  assert.equal(p.runs[5].size, 14);
  assert.deepEqual(c.blocks[2], { type: "list", ordered: false, items: [[{ t: "one" }], [{ t: "two" }]] });
  assert.equal((c.blocks[3] as { ordered: boolean }).ordered, true);
});

test("scripts, event handlers, links, styles and odd colours are dropped", () => {
  const c = parseHtml('<p onclick="x()">Safe<script>alert(1)</script> <a href="javascript:alert(1)">link</a> <span style="color:expression(alert(1));background:url(x)">t</span><style>p{display:none}</style><iframe src="x">frame</iframe></p><img src="https://evil/x.png"><img src="data:image/svg+xml;base64,PHN2Zz4="><p style="text-align:evil">x</p>');
  assert.equal(plainText(c), "Safe link t\nx");
  assert.ok(!JSON.stringify(c).includes("alert"));
  assert.ok(!JSON.stringify(c).includes("evil"));
  assert.equal(c.blocks.filter((b) => b.type === "img").length, 0);
});

test("PNG and JPEG data images are kept with a sensible width, other images are not", () => {
  const png = "data:image/png;base64,iVBORw0KGgo=";
  const c = parseHtml(`<p>x</p><img src="${png}" style="width:200px">`);
  const img = c.blocks[1] as { type: string; src: string; width: number };
  assert.equal(img.type, "img");
  assert.equal(img.src, png);
  assert.ok(img.width > 50 && img.width < 55);
});

test("tables keep rows, cells and a header row", () => {
  const c = parseHtml("<table><tr><th>Item</th><th>£</th></tr><tr><td>Fee</td><td style=\"text-align:right\">100</td></tr></table>");
  const t = c.blocks[0] as { type: string; header: boolean; rows: { runs: { t: string }[]; align?: string }[][] };
  assert.equal(t.type, "table");
  assert.equal(t.header, true);
  assert.equal(t.rows.length, 2);
  assert.equal(t.rows[1][1].align, "right");
  assert.equal(t.rows[0][0].runs[0].t, "Item");
});

test("blank lines and line breaks survive, page breaks are kept", () => {
  const c = parseHtml('<p>a<br>b</p><p><br></p><hr class="pagebreak"><p>c</p>');
  assert.equal(plainText(c), "a\nb\n\n\nc");
  assert.equal((c.blocks[1] as { runs: unknown[] }).runs.length, 0);
  assert.equal(c.blocks[2].type, "break");
});

test("merge fields become chips for the editor and stay as text in the preview", () => {
  const c: DocContent = { blocks: [{ type: "p", runs: [{ t: "Dear {{client.name}}," }] }] };
  assert.match(toHtml(c, true), /<span class="mf" contenteditable="false" data-field="client.name">\{\{client.name\}\}<\/span>/);
  assert.ok(!toHtml(c, false).includes("class=\"mf\""));
  // a chip read back is the same text
  assert.equal(plainText(parseHtml(toHtml(c, true))), "Dear {{client.name}},");
});

test("content goes round trip and stored content is cleaned when read", () => {
  const c = parseHtml('<h2>Heading</h2><p>Some <b>text</b></p><ul><li>a</li></ul>');
  assert.deepEqual(parseHtml(toHtml(c)), c);
  assert.deepEqual(readContent(JSON.stringify(c)), c);
  assert.equal(readContent("not json").blocks.length, 1);
  assert.equal(allRuns(c).length, 4);
  const evil = readContent(JSON.stringify({ blocks: [{ type: "p", runs: [{ t: "<script>alert(1)</script>ok" }] }] }));
  assert.ok(!toHtml(evil).includes("<script"));
});
