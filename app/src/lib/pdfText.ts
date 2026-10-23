// Reads a text PDF into lines of positioned words, for bankStatement.parseLines. pdf.js is loaded
// from the site's own files when first needed (see build.mjs) so the page's security policy,
// which allows scripts only from the site itself, is kept.
import type { Item } from "./bankStatement";

type PdfJs = {
  getDocument(src: { data: Uint8Array; useSystemFonts?: boolean; isEvalSupported?: boolean }): { promise: Promise<{ numPages: number; getPage(n: number): Promise<{ getTextContent(): Promise<{ items: { str: string; transform: number[]; width: number }[] }> }> }> };
  GlobalWorkerOptions: { workerSrc: string };
};

let loaded: Promise<PdfJs> | undefined;
export function loadPdfJs(): Promise<PdfJs> {
  loaded ||= (async () => {
    const url = "/pdf/pdf.min.mjs";
    const mod = (await import(/* webpackIgnore: true */ url)) as PdfJs;
    mod.GlobalWorkerOptions.workerSrc = "/pdf/pdf.worker.min.mjs";
    return mod;
  })();
  return loaded;
}

/** Each page's words grouped into lines (top to bottom), each line's words left to right. */
export async function pdfLines(data: Uint8Array, pdfjs?: PdfJs): Promise<Item[][]> {
  const lib = pdfjs || (await loadPdfJs());
  const doc = await lib.getDocument({ data, isEvalSupported: false }).promise;
  const out: Item[][] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const words = content.items.filter((i) => i.str.trim()).map((i) => ({ x: i.transform[4], y: i.transform[5], text: i.str.trim(), w: i.width }));
    words.sort((a, b) => b.y - a.y || a.x - b.x);
    let line: { y: number; items: Item[] } | undefined;
    for (const w of words) {
      if (line && Math.abs(line.y - w.y) <= 2.5) line.items.push({ x: w.x, text: w.text, w: w.w });
      else {
        if (line) out.push(line.items);
        line = { y: w.y, items: [{ x: w.x, text: w.text, w: w.w }] };
      }
    }
    if (line) out.push(line.items);
  }
  return out;
}
