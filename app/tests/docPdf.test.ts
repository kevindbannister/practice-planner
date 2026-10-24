import test from "node:test";
import assert from "node:assert/strict";
import * as lib from "pdf-lib";
import { renderPdf } from "../src/lib/docPdf";
import { DEFAULT_BRANDING } from "../src/lib/docBranding";
import { Block, DocContent } from "../src/lib/docModel";

const para = (t: string, extra: object = {}): Block => ({ type: "p", runs: [{ t, ...extra }] }) as Block;
const brand = { ...DEFAULT_BRANDING, practiceName: "Bannister & Co", header: "Bannister & Co\nChartered Accountants", footer: "Registered in England" };
const doc = (blocks: Block[]): DocContent => ({ blocks }) as DocContent;

async function textOf(bytes: Uint8Array): Promise<string[]> {
  // @ts-ignore
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const d = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
  const out: string[] = [];
  for (let i = 1; i <= d.numPages; i++) out.push((await (await d.getPage(i)).getTextContent()).items.map((x: any) => x.str).join(" "));
  return out;
}

test("renders a one page letter with header, footer and page number", async () => {
  const bytes = await renderPdf(lib, { content: doc([para("Dear Kevin,"), para("Thank you for your instructions. £1,250.00 – “quoted”")]), branding: brand, title: "Letter" });
  const pages = await textOf(bytes);
  assert.equal(pages.length, 1);
  assert.match(pages[0], /Dear Kevin/);
  assert.match(pages[0], /Chartered Accountants/);
  assert.match(pages[0], /Registered in England/);
  assert.match(pages[0], /Page 1 of 1/);
  assert.match(pages[0], /£1,250\.00/);
});

test("long text flows over several pages with correct totals", async () => {
  const blocks = Array.from({ length: 60 }, (_, i) => para(`Paragraph ${i + 1}. ` + "Lorem ipsum dolor sit amet consectetur. ".repeat(12)));
  const pages = await textOf(await renderPdf(lib, { content: doc(blocks), branding: brand }));
  assert.ok(pages.length >= 3);
  pages.forEach((p, i) => assert.match(p, new RegExp(`Page ${i + 1} of ${pages.length}`)));
  assert.match(pages[pages.length - 1], /Paragraph 60/);
});

test("tables split across pages and repeat the heading row", async () => {
  const rows = [[{ runs: [{ t: "Item" }] }, { runs: [{ t: "Amount" }] }], ...Array.from({ length: 80 }, (_, i) => [{ runs: [{ t: `Row ${i + 1}` }] }, { runs: [{ t: `${i * 10}.00` }] }])];
  const pages = await textOf(await renderPdf(lib, { content: doc([{ type: "table", header: true, rows } as Block]), branding: brand }));
  assert.ok(pages.length >= 2);
  pages.forEach((p) => assert.match(p, /Item/));
  assert.match(pages[pages.length - 1], /Row 80/);
});

test("page breaks, lists, unsupported characters and a page number toggle", async () => {
  const bytes = await renderPdf(lib, { content: doc([para("First"), { type: "break" } as Block, para("Second 日本"), { type: "list", ordered: true, items: [[{ t: "one" }], [{ t: "two" }]] } as Block]), layout: { pageNumbers: false }, branding: brand });
  const pages = await textOf(bytes);
  assert.equal(pages.length, 2);
  assert.match(pages[1], /Second \?\?/);
  assert.match(pages[1], /1\./);
  assert.doesNotMatch(pages[0], /Page 1/);
});

test("sets document properties and applies a logo", async () => {
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const bytes = await renderPdf(lib, { content: doc([para("Hi")]), branding: { ...brand, logo: png }, title: "My title" });
  const d = await lib.PDFDocument.load(bytes);
  assert.equal(d.getTitle(), "My title");
  assert.equal(d.getPageCount(), 1);
});
