// A PDF file of a report, made in the browser: each page of the report is drawn off screen exactly as it shows, turned into a picture
// (html-to-image, kept in src/vendor) and placed on an A4 page (pdf-lib). A section longer than a page is split between its blocks, never
// through one where that can be helped. The text in the PDF is a picture, so it can't be selected or searched; Print still gives a text PDF.

const PORTRAIT = { w: 794, h: 1123 }, LANDSCAPE = { w: 1123, h: 794 }; // A4 at 96 dpi, as the report is drawn
const PT = 0.75;            // CSS px to PDF points
const FOOT = 46, TOP = 40;  // room kept for the footer, and the top margin of a page a section runs onto

/** Where to cut a section of height `h` into pages: between blocks where possible, at a page break block always. Heights in px. */
export function slices(h: number, pageH: number, blocks: { top: number; bottom: number }[], forced: number[]): [number, number][] {
  const out: [number, number][] = [];
  let a = 0;
  for (let guard = 0; guard < 200; guard++) {
    const avail = pageH - FOOT - (out.length ? TOP : 0);
    const limit = a + avail;
    const must = forced.filter((b) => b > a + 1 && b < h - 1 && b <= limit).sort((x, y) => x - y)[0];
    if (must === undefined && h - a <= avail) { out.push([a, h]); break; }
    const fits = pageH - FOOT - TOP; // a block taller than a page can't be kept whole, so it doesn't decide where to cut
    const straddling = blocks.filter((b) => b.top > a + 1 && b.top < limit && b.bottom > limit && b.bottom - b.top <= fits).map((b) => b.top);
    let cut = must ?? (straddling.length ? Math.min(...straddling) : limit);
    if (cut <= a + 1) cut = limit; // one block taller than a page: it has to be cut
    out.push([a, Math.min(cut, h)]);
    a = cut;
    if (a >= h - 1) break;
  }
  return out;
}

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/** Makes the PDF from a report's page (the same HTML that is published). */
export async function reportPdf(html: string, o: { clientName: string; name: string; step?: (m: string) => void }): Promise<Uint8Array> {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const rp = parsed.querySelector(".rp");
  if (!rp) throw new Error("The report has no pages.");
  const wide = !!rp.querySelector(".rp-cover.L, .rp-sec.L");
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = `position:fixed;left:-30000px;top:0;width:${wide ? LANDSCAPE.w : PORTRAIT.w}px;background:#fff;pointer-events:none`;
  const fix = document.createElement("style");
  host.className = "rp-pdf-host"; // the fixes below only touch this hidden copy, not the report on screen
  fix.textContent = ".rp-pdf-host .rp-sec{box-shadow:none!important;background-image:none!important;aspect-ratio:auto!important}.rp-pdf-host .rp-sec::after{display:none!important}.rp-pdf-host .rp-cover{box-shadow:none!important}.rp-pdf-host .rp-break{height:0!important;overflow:hidden!important;visibility:hidden!important}";
  host.append(fix, document.importNode(rp, true));
  document.body.appendChild(host);
  try {
    await document.fonts.ready; await frame(); await frame();
    try { await document.fonts.load("400 12px Figtree"); await document.fonts.load("700 12px Figtree"); } catch { /* the fallback font is used */ }
    await frame();
    const [{ toCanvas, getFontEmbedCSS }, { PDFDocument, StandardFonts, rgb }] = await Promise.all([import("../vendor/html-to-image/index.js"), import("pdf-lib")]);
    const fontCss = await getFontEmbedCSS(host).catch(() => "");
    const pdf = await PDFDocument.create();
    pdf.setTitle(`${o.name} – ${o.clientName}`);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const els = [...host.querySelectorAll<HTMLElement>(".rp-cover, .rp-sec")];
    let pageNo = 0;
    for (let i = 0; i < els.length; i++) {
      const el = els[i], cover = el.classList.contains("rp-cover");
      o.step?.(`Drawing page ${i + 1} of ${els.length}…`);
      const size = el.classList.contains("L") ? LANDSCAPE : PORTRAIT;
      const box = el.getBoundingClientRect(), h = cover ? size.h : box.height;
      const rel = (n: Element) => { const r = n.getBoundingClientRect(); return { top: r.top - box.top, bottom: r.bottom - box.top }; };
      const cuts = cover ? [[0, h] as [number, number]] : slices(h, size.h, [...el.querySelectorAll(".rb-block, .rp-keys")].map(rel), [...el.querySelectorAll(".rp-break")].map((n) => rel(n).top));
      const canvas = await toCanvas(el, { pixelRatio: 2, backgroundColor: "#ffffff", fontEmbedCSS: fontCss });
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
      if (!blob) throw new Error("A page couldn't be drawn.");
      const img = await pdf.embedPng(new Uint8Array(await blob.arrayBuffer()));
      const W = size.w * PT, H = size.h * PT, imgH = (cover ? box.height : h) * PT;
      cuts.forEach(([a, b], n) => {
        const page = pdf.addPage([W, H]);
        pageNo++;
        const top = n ? TOP : 0;
        page.drawImage(img, { x: 0, y: H - top * PT + a * PT - imgH, width: W, height: imgH });
        if (cover) return;
        // hide what belongs to the pages before and after this one
        if (top) page.drawRectangle({ x: 0, y: H - top * PT, width: W, height: top * PT, color: rgb(1, 1, 1) });
        const below = H - (top + (b - a)) * PT;
        if (below > 0) page.drawRectangle({ x: 0, y: 0, width: W, height: below, color: rgb(1, 1, 1) });
        const grey = rgb(0.6, 0.64, 0.7), text = `${o.clientName} · ${o.name}`.replace(/[^\x20-\x7E\u00A0-\u00FF–—’‘“”]/g, "?"), num = `Page ${pageNo}`;
        page.drawText(text, { x: 34, y: 16, size: 7, font, color: grey });
        page.drawText(num, { x: W - 34 - font.widthOfTextAtSize(num, 7), y: 16, size: 7, font, color: grey });
      });
    }
    return await pdf.save();
  } finally { host.remove(); }
}

export function saveBytes(bytes: Uint8Array, fileName: string, type = "application/pdf"): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export const pdfName = (client: string, name: string) => `${client} - ${name}`.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) + ".pdf";
