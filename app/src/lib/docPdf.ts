// Documents: the PDF renderer. It takes content (already filled with its merge fields), a page
// layout and the practice's branding, and lays the pages out itself, so the result is the same in
// every browser: text wraps and justifies, tables carry their heading row onto each new page and rows
// can split across pages, images keep their shape, and headers, footers and "Page x of y" go on every
// page. Nothing here knows about clients, templates or SharePoint: that separation is what lets the
// same engine lay out other documents later (accounts packs, reports).
//
// Fonts are the standard PDF fonts (Helvetica, Times, Courier). The pdf-lib library is passed in, so
// the browser loads it from the site's own files and tests load it from node_modules.
import type { PDFDocument, PDFFont, PDFImage, PDFPage, RGB } from "pdf-lib";
import { Branding, displayName } from "./docBranding";
import { Block, Cell, DEFAULT_LAYOUT, DocContent, DocLayout, Run, runsText } from "./docModel";

export type PdfLib = typeof import("pdf-lib");
export type RenderInput = { content: DocContent; layout?: Partial<DocLayout>; branding: Branding; title?: string; reference?: string; author?: string; created?: Date };

const MM = 72 / 25.4;
const A4 = { w: 595.28, h: 841.89 };

type Style = { font: PDFFont; size: number; color: RGB; u: boolean };
type Atom = { text: string; w: number; style: Style; space: boolean };
type Line = { atoms: Atom[]; width: number; height: number; size: number; forced: boolean };

const hex = (lib: PdfLib, c: string): RGB => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c);
  return m ? lib.rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255) : lib.rgb(0, 0, 0);
};
const tint = (lib: PdfLib, c: string, amount: number): RGB => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c) || ["", "00", "00", "00"];
  const mix = (v: string) => (parseInt(v, 16) * (1 - amount) + 255 * amount) / 255;
  return lib.rgb(mix(m[1]), mix(m[2]), mix(m[3]));
};
const base64Bytes = (src: string): Uint8Array => {
  const b = src.slice(src.indexOf(",") + 1);
  if (typeof atob === "function") return Uint8Array.from(atob(b), (ch) => ch.charCodeAt(0));
  return new Uint8Array((globalThis as unknown as { Buffer: { from(s: string, e: string): ArrayLike<number> } }).Buffer.from(b, "base64"));
};
const numeric = (s: string) => /^[-(]?\s*[£$€]?\s*[-(]?\d[\d,]*(\.\d+)?\)?%?$/.test(s.trim());

class Fonts {
  private cache = new Map<string, PDFFont>();
  private ok = new Map<PDFFont, Map<string, string>>();
  constructor(private doc: PDFDocument, private lib: PdfLib, private family: "sans" | "serif" | "mono") {}
  async load() {
    const F = this.lib.StandardFonts;
    const names = {
      sans: [F.Helvetica, F.HelveticaBold, F.HelveticaOblique, F.HelveticaBoldOblique],
      serif: [F.TimesRoman, F.TimesRomanBold, F.TimesRomanItalic, F.TimesRomanBoldItalic],
      mono: [F.Courier, F.CourierBold, F.CourierOblique, F.CourierBoldOblique],
    }[this.family];
    for (const [i, n] of names.entries()) this.cache.set(`${i & 1 ? "b" : ""}${i & 2 ? "i" : ""}`, await this.doc.embedFont(n));
  }
  get(b?: boolean, i?: boolean): PDFFont {
    return this.cache.get(`${b ? "b" : ""}${i ? "i" : ""}`)!;
  }
  /** Text the font can show: anything outside its character set becomes "?" (a PDF can't hold it). */
  safe(font: PDFFont, text: string): string {
    let map = this.ok.get(font);
    if (!map) this.ok.set(font, (map = new Map()));
    let out = "";
    for (const ch of text.replace(/\t/g, "    ").replace(/ /g, " ")) {
      let r = map.get(ch);
      if (r === undefined) {
        try {
          font.encodeText(ch);
          r = ch;
        } catch {
          r = /[‐-―]/.test(ch) ? "-" : /[‘’]/.test(ch) ? "'" : /[“”]/.test(ch) ? '"' : "?";
        }
        map.set(ch, r);
      }
      out += r;
    }
    return out;
  }
}

type Ctx = { lib: PdfLib; doc: PDFDocument; fonts: Fonts; layout: DocLayout; brand: Branding; primary: RGB; secondary: RGB; ink: RGB; logo?: PDFImage };

function atomsOf(c: Ctx, runs: Run[], size: number, color: RGB, bold = false, forceBold = false): (Atom | "nl")[] {
  const out: (Atom | "nl")[] = [];
  for (const r of runs) {
    const font = c.fonts.get(bold || forceBold || r.b, r.i);
    const style: Style = { font, size: r.size || size, color: r.color ? hex(c.lib, r.color) : color, u: !!r.u };
    const lines = r.t.split("\n");
    lines.forEach((ln, li) => {
      if (li > 0) out.push("nl");
      for (const piece of c.fonts.safe(font, ln).split(/( +)/)) {
        if (!piece) continue;
        out.push({ text: piece, w: font.widthOfTextAtSize(piece, style.size), style, space: piece[0] === " " });
      }
    });
  }
  return out;
}

/** Breaks atoms into lines no wider than `width` (the first line may be indented). */
function wrap(items: (Atom | "nl")[], width: number, firstIndent = 0, minSize = 10): Line[] {
  const lines: Line[] = [];
  let cur: Atom[] = [], w = 0, limit = width - firstIndent;
  const close = (forced: boolean) => {
    while (cur.length && cur[cur.length - 1].space) w -= cur.pop()!.w;
    const size = Math.max(minSize, ...cur.map((a) => a.style.size));
    lines.push({ atoms: cur, width: w, height: size * 1.32, size, forced });
    cur = []; w = 0; limit = width;
  };
  for (const it of items) {
    if (it === "nl") { close(true); continue; }
    if (it.space && !cur.length) continue;
    if (w + it.w > limit && cur.length && !it.space) close(false);
    if (it.w > limit && !it.space) {
      // a word wider than the line: split it
      let part = "";
      for (const ch of it.text) {
        const cw = it.style.font.widthOfTextAtSize(part + ch, it.style.size);
        if (cw > limit && part) { cur.push({ ...it, text: part, w: it.style.font.widthOfTextAtSize(part, it.style.size) }); w += cur[cur.length - 1].w; close(false); part = ch; } else part += ch;
      }
      if (part) { const pw = it.style.font.widthOfTextAtSize(part, it.style.size); cur.push({ ...it, text: part, w: pw }); w += pw; }
      continue;
    }
    cur.push(it); w += it.w;
  }
  close(true);
  // a trailing empty line created by the final close when text ended on a newline is a real blank line; one from an empty input is not
  if (lines.length > 1 && !lines[lines.length - 1].atoms.length && items.length && items[items.length - 1] !== "nl") lines.pop();
  return lines;
}

class Pager {
  pages: PDFPage[] = [];
  y = 0; // distance used down the page from the top of the content area
  constructor(private c: Ctx) {}
  get top() { return A4.h - this.c.layout.margins.top * MM; }
  get left() { return this.c.layout.margins.left * MM; }
  get width() { return A4.w - (this.c.layout.margins.left + this.c.layout.margins.right) * MM; }
  get avail() { return A4.h - (this.c.layout.margins.top + this.c.layout.margins.bottom) * MM; }
  get page() { return this.pages[this.pages.length - 1]; }
  get remaining() { return this.avail - this.y; }
  newPage() { this.pages.push(this.c.doc.addPage([A4.w, A4.h])); this.y = 0; }
  ensure(h: number, onNew?: () => void) {
    if (!this.pages.length) { this.newPage(); onNew?.(); }
    if (h > this.remaining + 0.01 && this.y > 0) { this.newPage(); onNew?.(); }
  }
}

function drawLine(c: Ctx, pg: Pager, line: Line, x: number, width: number, align: string | undefined, top: number) {
  const page = pg.page;
  const baseline = top - line.size * 1.0;
  let extra = 0, gap = 0;
  if (align === "center") extra = (width - line.width) / 2;
  else if (align === "right") extra = width - line.width;
  else if (align === "justify" && !line.forced) {
    const spaces = line.atoms.filter((a) => a.space).length;
    if (spaces) gap = (width - line.width) / spaces;
  }
  let cx = x + Math.max(0, extra);
  for (const a of line.atoms) {
    if (!a.space) {
      page.drawText(a.text, { x: cx, y: baseline, size: a.style.size, font: a.style.font, color: a.style.color });
      if (a.style.u) page.drawLine({ start: { x: cx, y: baseline - 1.5 }, end: { x: cx + a.w, y: baseline - 1.5 }, thickness: 0.6, color: a.style.color });
    } else if (a.style.u) {
      page.drawLine({ start: { x: cx, y: baseline - 1.5 }, end: { x: cx + a.w + gap, y: baseline - 1.5 }, thickness: 0.6, color: a.style.color });
    }
    cx += a.w + (a.space ? gap : 0);
  }
}

/** Lays out lines at the cursor, moving to a new page between lines when needed. */
function flowLines(c: Ctx, pg: Pager, lines: Line[], opts: { x?: number; width?: number; align?: string; keepWithNext?: number; marker?: (first: boolean) => Atom | undefined; markerX?: number }) {
  const x = opts.x ?? pg.left, width = opts.width ?? pg.width;
  // keep a heading with the first lines of what follows
  const first = lines.slice(0, 2).reduce((a, l) => a + l.height, 0) + (opts.keepWithNext || 0);
  pg.ensure(Math.min(first, pg.avail));
  lines.forEach((ln, i) => {
    pg.ensure(ln.height);
    const top = pg.top - pg.y;
    const m = i === 0 ? opts.marker?.(true) : undefined;
    if (m) pg.page.drawText(m.text, { x: opts.markerX ?? x - m.w - 4, y: top - ln.size, size: m.style.size, font: m.style.font, color: m.style.color });
    drawLine(c, pg, ln, x, width, opts.align, top);
    pg.y += ln.height;
  });
}

function paragraph(c: Ctx, pg: Pager, b: Extract<Block, { type: "p" | "h" }>) {
  const base = c.layout.fontSize;
  const heading = b.type === "h";
  const size = heading ? [0, 18, 14, 11.5][b.level] : base;
  const color = heading ? c.primary : c.ink;
  if (heading) pg.y += pg.y > 0 ? [0, 10, 8, 6][b.level] : 0;
  const items = atomsOf(c, b.runs, size, color, heading);
  const lines = items.length ? wrap(items, pg.width, 0, size) : [{ atoms: [], width: 0, height: base * 1.32, size: base, forced: true } as Line];
  flowLines(c, pg, lines, { align: b.align, keepWithNext: heading ? base * 2 : 0 });
  pg.y += heading ? [0, 6, 5, 4][b.level] : base * 0.55;
}

function list(c: Ctx, pg: Pager, b: Extract<Block, { type: "list" }>) {
  const size = c.layout.fontSize, indent = 16;
  b.items.forEach((runs, i) => {
    const marker: Atom = { text: b.ordered ? `${i + 1}.` : "•", w: 0, style: { font: c.fonts.get(), size, color: c.ink, u: false }, space: false };
    marker.w = marker.style.font.widthOfTextAtSize(marker.text, size);
    const lines = wrap(atomsOf(c, runs, size, c.ink), pg.width - indent, 0, size);
    flowLines(c, pg, lines, { x: pg.left + indent, width: pg.width - indent, marker: () => marker, markerX: pg.left + indent - marker.w - 5 });
    pg.y += size * 0.25;
  });
  pg.y += size * 0.45;
}

function columnWidths(c: Ctx, rows: Cell[][], width: number, size: number, pad: number): number[] {
  const n = Math.max(...rows.map((r) => r.length));
  const natural = new Array(n).fill(0), min = new Array(n).fill(0);
  for (const r of rows) {
    r.forEach((cell, i) => {
      const atoms = atomsOf(c, cell.runs, size, c.ink).filter((a): a is Atom => a !== "nl");
      natural[i] = Math.max(natural[i], Math.min(260, atoms.reduce((a, x) => a + x.w, 0) + 2 * pad));
      min[i] = Math.max(min[i], Math.min(width / 2, Math.max(0, ...atoms.filter((x) => !x.space).map((x) => x.w)) + 2 * pad), 30);
    });
  }
  const sumMin = min.reduce((a: number, b: number) => a + b, 0), sumNat = natural.reduce((a: number, b: number) => a + b, 0);
  if (sumMin >= width) return min.map((m: number) => (m * width) / sumMin);
  if (sumNat <= width) return natural.map((x: number) => (x * width) / sumNat);
  const spare = width - sumMin, want = natural.reduce((a: number, x: number, i: number) => a + Math.max(0, x - min[i]), 0);
  return min.map((m: number, i: number) => m + (spare * Math.max(0, natural[i] - m)) / (want || 1));
}

function table(c: Ctx, pg: Pager, b: Extract<Block, { type: "table" }>) {
  const size = Math.max(8, c.layout.fontSize - 0.5), pad = 4;
  const widths = columnWidths(c, b.rows, pg.width, size, pad);
  const cols = widths.length;
  const laid = b.rows.map((r, ri) => {
    const head = b.header && ri === 0;
    return Array.from({ length: cols }, (_, i) => {
      const cell = r[i] || { runs: [] };
      const align = cell.align || (numeric(runsText(cell.runs)) ? "right" : undefined);
      const lines = wrap(atomsOf(c, cell.runs, size, c.ink, false, head), widths[i] - 2 * pad, 0, size);
      return { lines, align };
    });
  });
  const rowHeight = (cells: { lines: Line[] }[], from = 0, to = Infinity) => Math.max(...cells.map((x) => x.lines.slice(from, to).reduce((a, l) => a + l.height, 0))) + 2 * pad;
  const xs = widths.reduce<number[]>((a, w, i) => (a.push(i ? a[i - 1] + widths[i - 1] : pg.left), a), []);
  const border = c.lib.rgb(0.78, 0.8, 0.83);

  const drawSegment = (cells: typeof laid[number], from: number, to: number, head: boolean) => {
    const h = rowHeight(cells, from, to);
    const top = pg.top - pg.y;
    cells.forEach((cell, i) => {
      pg.page.drawRectangle({ x: xs[i], y: top - h, width: widths[i], height: h, borderColor: border, borderWidth: 0.5, ...(head ? { color: tint(c.lib, c.brand.primary, 0.86) } : {}) });
      let ly = top - pad;
      for (const ln of cell.lines.slice(from, to)) {
        drawLine(c, pg, ln, xs[i] + pad, widths[i] - 2 * pad, cell.align, ly);
        ly -= ln.height;
      }
    });
    pg.y += h;
  };
  const repeatHeader = () => { if (b.header && laid.length > 1) drawSegment(laid[0], 0, Infinity, true); };

  laid.forEach((cells, ri) => {
    const head = b.header && ri === 0;
    const total = rowHeight(cells);
    if (!pg.pages.length) pg.newPage();
    // keep the heading row with the first row under it
    const need = head ? total + rowHeight(laid[1] || cells) : total;
    if (need > pg.remaining && pg.y > 0 && (total <= pg.avail || head)) { pg.newPage(); if (!head) repeatHeader(); }
    if (total <= pg.remaining + 0.01) { drawSegment(cells, 0, Infinity, head); return; }
    // a row taller than the space left (or a page): split it between lines
    let from = 0;
    const maxLines = Math.max(...cells.map((x) => x.lines.length));
    while (from < maxLines) {
      let to = from;
      while (to < maxLines && rowHeight(cells, from, to + 1) <= pg.remaining + 0.01) to++;
      if (to === from) {
        if (pg.y > 0) { pg.newPage(); repeatHeader(); continue; }
        to = from + 1; // a single line taller than a page: draw it anyway
      }
      drawSegment(cells, from, to, head);
      from = to;
      if (from < maxLines) { pg.newPage(); repeatHeader(); }
    }
  });
  pg.y += c.layout.fontSize * 0.8;
}

async function image(c: Ctx, pg: Pager, b: Extract<Block, { type: "img" }>) {
  let img: PDFImage;
  try {
    const bytes = base64Bytes(b.src);
    img = /^data:image\/png/.test(b.src) ? await c.doc.embedPng(bytes) : await c.doc.embedJpg(bytes);
  } catch {
    return; // an image that can't be read is left out
  }
  let w = Math.min(b.width * MM, pg.width), h = (img.height / img.width) * w;
  if (h > pg.avail) { h = pg.avail; w = (img.width / img.height) * h; }
  pg.ensure(h);
  const x = pg.left + (b.align === "center" ? (pg.width - w) / 2 : b.align === "right" ? pg.width - w : 0);
  pg.page.drawImage(img, { x, y: pg.top - pg.y - h, width: w, height: h });
  pg.y += h + c.layout.fontSize * 0.6;
}

function furniture(c: Ctx, pages: PDFPage[]) {
  const { layout: L, brand: B } = c;
  const small = 8;
  const font = c.fonts.get(), bold = c.fonts.get(true);
  const total = pages.length;
  const headerText = c.fonts.safe(font, L.header || B.header || "");
  const footerText = c.fonts.safe(font, L.footer || B.footer || "");
  pages.forEach((p, i) => {
    const x0 = L.margins.left * MM, x1 = A4.w - L.margins.right * MM;
    const top = A4.h - 8 * MM;
    // logo at the right, header text at the left, a fine rule under them
    let band = 0;
    if (L.showLogo && c.logo) {
      const maxH = Math.max(8, Math.min(18, L.margins.top - 12)) * MM;
      let h = maxH, w = (c.logo.width / c.logo.height) * h;
      if (w > 60 * MM) { w = 60 * MM; h = (c.logo.height / c.logo.width) * w; }
      p.drawImage(c.logo, { x: x1 - w, y: top - h, width: w, height: h });
      band = h;
    }
    if (headerText) {
      headerText.split("\n").slice(0, 3).forEach((ln, k) => p.drawText(ln, { x: x0, y: top - 9 - k * 11, size: 9, font: k === 0 ? bold : font, color: c.primary }));
      band = Math.max(band, Math.min(3, headerText.split("\n").length) * 11);
    }
    if (band) p.drawLine({ start: { x: x0, y: top - band - 5 }, end: { x: x1, y: top - band - 5 }, thickness: 0.8, color: c.secondary });
    // footer
    const fy = L.margins.bottom * MM - 14;
    p.drawLine({ start: { x: x0, y: fy + 12 }, end: { x: x1, y: fy + 12 }, thickness: 0.4, color: c.lib.rgb(0.75, 0.77, 0.8) });
    const grey = c.lib.rgb(0.4, 0.43, 0.47);
    footerText.split("\n").slice(0, 3).forEach((ln, k) => p.drawText(ln, { x: x0, y: fy - k * 10, size: small, font, color: grey }));
    if (L.pageNumbers) {
      const label = `Page ${i + 1} of ${total}`;
      p.drawText(label, { x: x1 - font.widthOfTextAtSize(label, small), y: fy, size: small, font, color: grey });
    }
  });
}

/** Makes the PDF. */
export async function renderPdf(lib: PdfLib, input: RenderInput): Promise<Uint8Array> {
  const layout: DocLayout = { ...DEFAULT_LAYOUT, ...(input.layout || {}), margins: { ...DEFAULT_LAYOUT.margins, ...(input.layout?.margins || {}) } };
  const doc = await lib.PDFDocument.create();
  const fonts = new Fonts(doc, lib, input.branding.font);
  await fonts.load();
  const c: Ctx = { lib, doc, fonts, layout, brand: input.branding, primary: hex(lib, input.branding.primary), secondary: hex(lib, input.branding.secondary), ink: lib.rgb(0.11, 0.12, 0.14) };
  if (input.branding.logo) {
    try {
      const bytes = base64Bytes(input.branding.logo);
      c.logo = /^data:image\/png/.test(input.branding.logo) ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    } catch {
      c.logo = undefined;
    }
  }
  const pg = new Pager(c);
  pg.newPage();
  for (const b of input.content.blocks) {
    switch (b.type) {
      case "p": case "h":
        // a sign-off stays with the name under it: move to a new page if there isn't room for both
        if (b.type === "p" && /^yours\s+(sincerely|faithfully)/i.test(runsText(b.runs).trim())) pg.ensure(Math.min(110, pg.avail));
        paragraph(c, pg, b);
        break;
      case "list": list(c, pg, b); break;
      case "table": if (b.rows.length) table(c, pg, b); break;
      case "img": await image(c, pg, b); break;
      case "break": if (pg.y > 0) pg.newPage(); break;
    }
  }
  furniture(c, pg.pages);
  doc.setTitle(input.title || input.reference || "Document");
  doc.setAuthor(input.author || displayName(input.branding) || "XProFlow");
  doc.setProducer("XProFlow");
  doc.setCreator("XProFlow");
  const when = input.created || new Date();
  doc.setCreationDate(when);
  doc.setModificationDate(when);
  return doc.save();
}

// ------------------------------------------------------------------ loading pdf-lib in the browser

let loaded: Promise<PdfLib> | undefined;
/** pdf-lib from the site's own files (see build.mjs); the page's security policy allows scripts from nowhere else. */
export function loadPdfLib(): Promise<PdfLib> {
  loaded ||= (async () => {
    const url = "/pdf/pdf-lib.esm.min.js";
    return (await import(/* webpackIgnore: true */ url)) as PdfLib;
  })();
  return loaded;
}
