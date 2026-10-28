// A plain letter-style PDF for corporate documents (certificates, minutes, vouchers, schedules). Text only; the caller supplies the words.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export type Block = { t: "h1" | "h2" | "p" | "small" | "gap" | "row"; text?: string; cells?: string[] };
const clean = (t: string) => t.replace(/[^\x20-\x7E£]/g, "?");

export async function textPdf(pages: Block[][], footer = ""): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595, H = 842, M = 56;
  const wrap = (t: string, w: number, size: number, f = font) => { const out: string[] = []; let line = ""; for (const word of clean(t).split(/\s+/)) { const next = line ? `${line} ${word}` : word; if (f.widthOfTextAtSize(next, size) > w && line) { out.push(line); line = word; } else line = next; } out.push(line); return out; };
  for (const blocks of pages) {
    let page = pdf.addPage([W, H]); let y = H - M;
    const more = (need: number) => { if (y - need < M + 24) { page = pdf.addPage([W, H]); y = H - M; } };
    for (const b of blocks) {
      if (b.t === "gap") { y -= 10; continue; }
      if (b.t === "row") {
        const cells = b.cells || [], cw = (W - 2 * M) / Math.max(1, cells.length);
        const lines = cells.map((c) => wrap(c, cw - 8, 9)); const h = Math.max(...lines.map((l) => l.length)) * 11; more(h);
        lines.forEach((ls, i) => ls.forEach((l, li) => page.drawText(l, { x: M + i * cw, y: y - li * 11, size: 9, font, color: rgb(0.1, 0.1, 0.1) })));
        y -= h + 4; continue;
      }
      const size = b.t === "h1" ? 18 : b.t === "h2" ? 12 : b.t === "small" ? 8 : 10, f = b.t === "h1" || b.t === "h2" ? bold : font;
      for (const l of wrap(b.text || "", W - 2 * M, size, f)) { more(size + 4); page.drawText(l, { x: M, y, size, font: f, color: rgb(0.1, 0.1, 0.1) }); y -= size + 4; }
      y -= b.t === "h1" ? 6 : 2;
    }
  }
  const all = pdf.getPages();
  all.forEach((p, i) => p.drawText(clean(`${footer}${footer ? " - " : ""}page ${i + 1} of ${all.length}`), { x: M, y: 24, size: 7, font, color: rgb(0.4, 0.4, 0.4) }));
  return pdf.save();
}
