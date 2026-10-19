// Letters and emails: text formatting, Word letters, zip reading.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fillDocument, letterDocx, letterXml, unzip, checkLetterhead, PLACEHOLDER } from "../src/lib/docx";
import { parseText, toHtml, runs } from "../src/lib/richText";
import { zip } from "../src/lib/xlsx";

const enc = new TextEncoder();
const dec = new TextDecoder();

test("text: paragraphs, bullets and bold", () => {
  assert.deepEqual(runs("a **b** c"), [{ text: "a " }, { text: "b", bold: true }, { text: " c" }]);
  const b = parseText("First line\nsecond line\n\n- one\n- **two**\n\nLast.");
  assert.equal(b.length, 4);
  assert.deepEqual(b[0], { type: "p", lines: [[{ text: "First line" }], [{ text: "second line" }]] });
  assert.deepEqual(b[2], { type: "li", runs: [{ text: "two", bold: true }] });
  const html = toHtml("Hi <Tom> & co,\n\n- a\n- b\n\nThanks", "Kevin\nInsight");
  assert.match(html, /<p[^>]*>Hi &lt;Tom&gt; &amp; co,<\/p><ul[^>]*><li>a<\/li><li>b<\/li><\/ul><p[^>]*>Thanks<\/p>/);
  assert.match(html, /Kevin<br>Insight/);
});

const letter = {
  date: "12 October 2026", address: ["Mr T Walters", "1 High Street", "Leeds, LS1 1AA"], salutation: "Dear Tristan,",
  subject: "Your 2025/26 tax return", body: "Para & one.\n\n- point\n\nPara two.", signOff: "Yours sincerely,", signName: "Kevin Bannister", signTitle: "Insight",
};

test("letter paragraphs are escaped and in order", () => {
  const x = letterXml(letter);
  assert.ok(x.indexOf("12 October 2026") < x.indexOf("Dear Tristan,"));
  assert.ok(x.indexOf("Dear Tristan,") < x.indexOf("Your 2025/26 tax return"));
  assert.match(x, /Para &amp; one\./);
  assert.match(x, /<w:b\/><w:bCs\/><\/w:rPr><w:t xml:space="preserve">Your 2025\/26 tax return/);
  assert.ok(x.lastIndexOf("Kevin Bannister") > x.indexOf("Para two."));
});

test("goes where the letterhead says {{LETTER}}, else before the page settings", () => {
  const withMarker = `<w:document><w:body><w:p><w:r><w:t>Top</w:t></w:r></w:p><w:p><w:pPr/><w:r><w:t>${PLACEHOLDER}</w:t></w:r></w:p><w:p><w:r><w:t>Bottom</w:t></w:r></w:p><w:sectPr><w:pgSz/></w:sectPr></w:body></w:document>`;
  const a = fillDocument(withMarker, "<w:p>LETTER</w:p>");
  assert.equal(a, `<w:document><w:body><w:p><w:r><w:t>Top</w:t></w:r></w:p><w:p>LETTER</w:p><w:p><w:r><w:t>Bottom</w:t></w:r></w:p><w:sectPr><w:pgSz/></w:sectPr></w:body></w:document>`);
  const plain = `<w:document><w:body><w:p/><w:sectPr w:rsidR="1"><w:pgSz/></w:sectPr></w:body></w:document>`;
  assert.equal(fillDocument(plain, "<w:p>L</w:p>"), `<w:document><w:body><w:p/><w:p>L</w:p><w:sectPr w:rsidR="1"><w:pgSz/></w:sectPr></w:body></w:document>`);
});

test("reads back a zip, keeps the letterhead's other files, turns a template into a document", async () => {
  const head = await zip([
    { name: "[Content_Types].xml", data: enc.encode('<Types><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml"/></Types>') },
    { name: "word/document.xml", data: enc.encode('<w:document><w:body><w:p/><w:sectPr/></w:body></w:document>'.replace("<w:sectPr/>", "<w:sectPr></w:sectPr>")) },
    { name: "word/header1.xml", data: enc.encode("<w:hdr>LOGO ".repeat(50) + "</w:hdr>") },
    { name: "word/media/image1.png", data: new Uint8Array([137, 80, 78, 71, 1, 2, 3]) },
  ]);
  assert.deepEqual(await checkLetterhead(head), { placeholder: false, example: false });
  const out = await unzip(await letterDocx(letter, head));
  const names = out.map((f) => f.name);
  assert.deepEqual(names, ["[Content_Types].xml", "word/document.xml", "word/header1.xml", "word/media/image1.png"]);
  const doc = dec.decode(out[1].data);
  assert.ok(doc.indexOf("Dear Tristan,") > 0 && doc.indexOf("Dear Tristan,") < doc.indexOf("<w:sectPr>"));
  assert.match(dec.decode(out[0].data), /document\.main\+xml/);
  assert.deepEqual([...out[3].data], [137, 80, 78, 71, 1, 2, 3]);
  await assert.rejects(checkLetterhead(new Uint8Array([1, 2, 3, 4])), /Word/);
});

test("a plain letter without a letterhead", async () => {
  const out = await unzip(await letterDocx(letter, null));
  assert.ok(out.some((f) => f.name === "word/styles.xml"));
  assert.match(dec.decode(out.find((f) => f.name === "word/document.xml")!.data), /Kevin Bannister/);
});
