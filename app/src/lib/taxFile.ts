// Reads a PDF from IRIS Elements for the tax import: the text of each page, and for the pages that are HMRC's forms (the
// filled-in SA100, SA102, SA110...) what is written in every box. Works in the browser (pdf.js from the site's own files) and,
// when given a pdf.js, in node (the tests).
import { loadPdfJs } from "./pdfText";
import type { ImportFile } from "./taxImport";
import type { ReadPage } from "./taxReturnRead";
import { pageBoxes } from "./formMap.mjs";

type PdfPage = { getTextContent(): Promise<{ items: { str: string; transform: number[] }[] }> };
type PdfLib = { OPS: unknown; getDocument(src: { data: Uint8Array; isEvalSupported?: boolean; verbosity?: number }): { promise: Promise<{ numPages: number; getPage(n: number): Promise<PdfPage> }> } };

export async function readIrisPdf(name: string, data: Uint8Array, pdfjs?: unknown): Promise<ImportFile> {
  const lib = (pdfjs || (await loadPdfJs())) as unknown as PdfLib;
  const doc = await lib.getDocument({ data, isEvalSupported: false, verbosity: 0 }).promise;
  const pages: string[][] = [];
  const forms: ReadPage[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const words = content.items.filter((i) => i.str.trim()).map((i) => ({ x: i.transform[4], y: i.transform[5], text: i.str.trim() }));
    words.sort((a, b) => b.y - a.y || a.x - b.x);
    const lines: { y: number; t: string[] }[] = [];
    for (const w of words) { const l = lines[lines.length - 1]; if (l && Math.abs(l.y - w.y) <= 2.5) l.t.push(w.text); else lines.push({ y: w.y, t: [w.text] }); }
    const text = lines.map((l) => l.t.join(" "));
    pages.push(text);
    // HMRC's form pages carry "SA100 2020", "SA102 2020"... in the footer
    if (text.some((l) => /^SA1\d\d\b/.test(l))) {
      const m = await pageBoxes(page, p, lib.OPS, true);
      if (m.form) forms.push({ form: m.form, no: m.no, boxes: m.boxes.map((b) => ({ id: b.id, n: b.n, section: b.section, label: b.label, fields: b.fields.map((f) => ({ kind: f.kind, sub: f.sub, value: f.value })) })) });
    }
  }
  return { name, pages, forms: forms.length ? forms : undefined };
}
