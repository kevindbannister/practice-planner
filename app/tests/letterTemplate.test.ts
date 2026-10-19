// Letters laid out like an example letter in the letterhead, tables, and pasting a whole letter.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fillExample, letterXml, ordinalDate } from "../src/lib/docx";
import { parseText, toHtml } from "../src/lib/richText";
import { dateFromText, oneLine, parseLetter } from "../src/lib/comms";

test("tables: tab rows and pipe rows, figures on the right, heading row", () => {
  const [t] = parseText("Item\t2026\t2025\nTurnover\t1,200.00\t(50)\nTax\t£300\t");
  assert.equal(t.type, "table");
  if (t.type !== "table") return;
  assert.equal(t.header, true);
  assert.equal(t.rows.length, 3);
  assert.equal(t.rows[1][1].num, true);
  assert.equal(t.rows[1][2].num, true);
  assert.equal(t.rows[2].length, 3);
  const [p] = parseText("| Name | Due |\n|---|---|\n| VAT | 7 May |");
  assert.equal(p.type === "table" && p.header && p.rows.length, 2);
  const [n] = parseText("Corporation tax\tdue 1 January\nVAT\tdue 7 May");
  assert.equal(n.type === "table" && n.header, false);
  // text round it stays as paragraphs
  assert.deepEqual(parseText("Before\n\nA\t1\nB\t2\n\nAfter").map((b) => b.type), ["p", "table", "p"]);
  assert.match(toHtml("A\t1\nB\t2"), /<table[^>]*><tr><td[^>]*>A<\/td><td[^>]*text-align:right[^>]*>1<\/td>/);
});

test("plain letters can have tables and two-line subjects", () => {
  const x = letterXml({ date: "1 May 2026", address: ["A"], salutation: "Dear A,", subject: "Line one\nLine two", body: "X\t1", signOff: "Yours sincerely,", signName: "K" });
  assert.match(x, /<w:tbl>.*X.*<\/w:tbl>/);
  assert.match(x, /Line one<\/w:t><\/w:r><w:r><w:rPr><w:b\/><w:bCs\/><\/w:rPr><w:br\/>|Line one.*<w:br\/>.*Line two/);
});

const rpr = '<w:rFonts w:ascii="Aptos" w:hAnsi="Aptos"/><w:sz w:val="20"/>';
const p = (text: string, ppr = '<w:ind w:left="426" w:right="260"/>', extra = "") =>
  `<w:p><w:pPr>${ppr}</w:pPr>${extra}<w:r><w:rPr>${rpr}</w:rPr><w:t>${text}</w:t></w:r></w:p>`;
const example =
  '<?xml version="1.0"?><w:document xmlns:w="w"><w:body>' +
  `<w:p><w:pPr><w:ind w:left="426"/></w:pPr><w:bookmarkStart w:id="0" w:name="x"/><w:r><w:t>Example Co</w:t></w:r><w:r><w:br/><w:t>1 Road</w:t></w:r></w:p>` +
  p("28th July 2026", '<w:ind w:left="426"/><w:jc w:val="right"/>') +
  `<w:p><w:pPr><w:ind w:left="426"/></w:pPr><w:r><w:rPr>${rpr}</w:rPr><w:t>Dear Sir,</w:t></w:r><w:r><w:br/></w:r><w:r><w:rPr><w:rStyle w:val="Strong"/></w:rPr><w:t>Old subject</w:t></w:r></w:p>` +
  p("Old body one.") + p("Old body two.") + p("Yours faithfully,") +
  `<w:p><w:r><w:drawing>SIG</w:drawing></w:r><w:bookmarkEnd w:id="0"/><w:r><w:t>Kevin Bannister</w:t></w:r></w:p>` +
  '<w:sectPr><w:pgSz w:w="11906"/></w:sectPr></w:body></w:document>';

test("an example letter: its layout, new words, its signature", () => {
  const out = fillExample(example, {
    date: "3 May 2026", address: ["New Client Ltd", "2 Lane"], salutation: "Dear Jo,", subject: "First\nSecond",
    body: "Hello & welcome.\n\n- a point\n\nFig\t1", signOff: "Yours sincerely,", signName: "ignored",
  })!;
  assert.ok(out);
  for (const gone of ["Example Co", "Old subject", "Old body", "Yours faithfully", "28th July", "bookmark"]) assert.ok(!out.includes(gone), gone);
  assert.match(out, /3rd May 2026/); // written the example's way
  assert.match(out, /<w:jc w:val="right"\/><\/w:pPr><w:r><w:rPr>[^]*?3rd May 2026/);
  assert.match(out, /New Client Ltd<\/w:t><\/w:r><w:r>.*?<w:br\/><\/w:r><w:r>.*?2 Lane/);
  assert.match(out, /Dear Jo,.*<w:br\/>.*<w:rStyle w:val="Strong"\/><\/w:rPr><w:t xml:space="preserve">First<\/w:t>.*Second/);
  assert.match(out, /<w:ind w:left="426" w:right="260"\/><\/w:pPr><w:r><w:rPr><w:rFonts[^>]*\/><w:sz w:val="20"\/><\/w:rPr><w:t xml:space="preserve">Hello &amp; welcome\./);
  assert.match(out, /<w:tbl>.*<w:tblInd w:w="426"/);
  assert.match(out, /Yours sincerely,.*SIG.*Kevin Bannister/);
  assert.ok(out.indexOf("Yours sincerely") < out.indexOf("SIG") && out.indexOf("SIG") < out.indexOf("<w:sectPr"));
  assert.equal(fillExample('<w:document><w:body><w:p><w:r><w:t>Just a heading</w:t></w:r></w:p></w:body></w:document>', {} as any), undefined);
});

test("dates the example's way", () => {
  assert.equal(ordinalDate("1 May 2026"), "1st May 2026");
  assert.equal(ordinalDate("12 May 2026"), "12th May 2026");
  assert.equal(ordinalDate("22 May 2026"), "22nd May 2026");
  assert.equal(dateFromText("28th July 2026"), "2026-07-28");
  assert.equal(dateFromText("Monday, 3 Aug 2026"), "2026-08-03");
  assert.equal(dateFromText("03/08/2026"), "2026-08-03");
  assert.equal(dateFromText("Cardiff"), undefined);
});

test("pasting a whole letter", () => {
  const l = parseLetter(
    "The Manager\nSample Ltd\n1 Street\nTown\nTN1 1AA\n\n19th October 2026\n\nDear Sir/Madam,\nSample Ltd - Company Number 01234567\nYour accounts\n\nFirst paragraph.\n\nItem\t2026\nSales\t100\n\nYours faithfully,\n\nKevin Bannister FCCA",
  );
  assert.equal(l.date, "2026-10-19");
  assert.equal(l.address, "The Manager\nSample Ltd\n1 Street\nTown\nTN1 1AA");
  assert.equal(l.salutation, "Dear Sir/Madam,");
  assert.equal(l.subject, "Sample Ltd - Company Number 01234567\nYour accounts");
  assert.equal(l.body, "First paragraph.\n\nItem\t2026\nSales\t100");
  assert.equal(l.signOff, "Yours faithfully,");
  // no subject: the first paragraph is a sentence
  assert.equal(parseLetter("Dear Jo,\n\nThanks for the records.\n\nKind regards").subject, "");
  assert.equal(parseLetter("Just some text.").body, "Just some text.");
  assert.equal(oneLine("A\nB"), "A - B");
});
