// Works out where every box is on HMRC's blank SA100 forms, so the tax return screen can write each figure into its box and
// make the boxes clickable. Run from app/:  node tools/sa100-map.mjs   (or name the years: node tools/sa100-map.mjs 2026)
// For each public/forms/sa100/SA100-<year>.pdf it writes SA100-<year>.json beside it.
//
// The forms are drawn, not fillable, so the boxes are found from the drawing: every white input cell (and the shaded cell with
// the £ sign), grouped into fields, and each field matched to the numbered badge above-left of it ("1", "2"...) and its label.
// The first page has HMRC's own few fields (UTR, NINO, reference, name and address), taken from the form's widgets.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "public/forms/sa100";
const r1 = (v) => Math.round(v * 10) / 10;
const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

async function pageBoxes(page, number) {
  const view = page.getViewport({ scale: 1 });
  const text = (await page.getTextContent()).items.filter((i) => i.str.trim()).map((i) => ({ x: i.transform[4], y: i.transform[5], size: Math.abs(i.transform[0]) || Math.abs(i.transform[3]), s: i.str.trim(), font: i.fontName, w: i.width }));
  const tr = (() => { const t = text.find((i) => i.y < 30 && /^\d$/.test(i.s) && text.some((j) => j.s === "TR" && Math.abs(j.y - i.y) < 2)); return t ? Number(t.s) : 0; })();
  // drawn rectangles with their fill colour
  const ops = await page.getOperatorList();
  const O = pdfjs.OPS;
  let ctm = [1, 0, 0, 1, 0, 0], fill = "#000000";
  const stack = [], rects = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i], a = ops.argsArray[i];
    if (fn === O.save) stack.push([ctm, fill]);
    else if (fn === O.restore) [ctm, fill] = stack.pop() || [ctm, fill];
    else if (fn === O.transform) ctm = mul(ctm, a);
    else if (fn === O.setFillRGBColor) fill = typeof a[0] === "string" ? a[0] : `#${a.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
    else if (fn === O.setFillGray) fill = a[0] >= 0.999 ? "#ffffff" : "#000000";
    else if (fn === O.constructPath) {
      const bb = a[2];
      if (!bb || bb.length < 4) continue;
      const [x0, y0] = apply(ctm, bb[0], bb[1]), [x1, y1] = apply(ctm, bb[2], bb[3]);
      rects.push({ x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1), fill, op: a[0] });
    }
  }
  const white = (r) => r.fill.toLowerCase() === "#ffffff";
  const h = (r) => r.y1 - r.y0, w = (r) => r.x1 - r.x0;
  // badges: small white boxes holding the box number
  const nums = text.filter((t) => /^\d{1,2}(\.\d{1,2})?$/.test(t.s) && t.size <= 8.5 && t.y > 40);
  const badges = nums.map((t) => ({ ...t, r: rects.find((r) => white(r) && h(r) < 14 && w(r) < 30 && t.x >= r.x0 - 1 && t.x <= r.x1 && t.y >= r.y0 - 2 && t.y <= r.y1) })).filter((b) => b.r);
  // box numbers start again at 1 in some sections (TR5: student loans, child benefit, marriage allowance): read the badges
  // column by column and start a new section whenever the number doesn't go up
  const mid = view.width / 2 - 20;
  badges.sort((a, b) => (a.x < mid ? 0 : 1) - (b.x < mid ? 0 : 1) || b.y - a.y);
  const headings = text.filter((t) => t.size >= 12.5 && t.y > 40 && t.y < view.height - 40);
  const heads = [...headings].sort((a, b) => b.y - a.y);
  for (const b of badges) {
    const hd = headings.filter((t) => t.y > b.y && t.x <= b.x + 4).sort((a, c) => a.y - c.y)[0];
    b.sec = hd ? heads.indexOf(hd) : 0;
    b.section = hd ? text.filter((t) => t.size >= 12.5 && Math.abs(t.y - hd.y) < 2 && Math.abs(t.x - hd.x) < 300).map((t) => t.s).join(" ") : "";
  }
  // input cells: white (or the shaded £ cell) boxes, not badges, not the page background
  const isPound = (r) => text.some((t) => t.s === "£" && t.x >= r.x0 - 1 && t.x <= r.x1 && t.y >= r.y0 - 1 && t.y <= r.y1);
  // the pence cells are outlined, not filled, and have a pale 0 printed in them
  const isPence = (r) => r.op === 20 && h(r) >= 12.5 && h(r) < 25 && w(r) < 20 && text.some((t) => t.s === "0" && t.x >= r.x0 - 1 && t.x <= r.x1 && t.y >= r.y0 - 1 && t.y <= r.y1);
  let cells = rects.filter((r) => (white(r) || isPound(r) || isPence(r)) && h(r) >= 12.5 && h(r) < 400 && w(r) >= 7 && w(r) < 530 && !badges.some((b) => b.r === r));
  // the same rectangle is often drawn twice (fill, then outline): keep one
  cells = cells.filter((r, i) => !cells.some((q, j) => j < i && Math.abs(q.x0 - r.x0) < 0.6 && Math.abs(q.y0 - r.y0) < 0.6 && Math.abs(q.x1 - r.x1) < 0.6 && Math.abs(q.y1 - r.y1) < 0.6));
  // drop any cell that holds other cells (a frame around a group)
  cells = cells.filter((r) => !cells.some((q) => q !== r && q.x0 >= r.x0 - 0.5 && q.x1 <= r.x1 + 0.5 && q.y0 >= r.y0 - 0.5 && q.y1 <= r.y1 + 0.5 && (w(q) < w(r) - 1 || h(q) < h(r) - 1)));
  cells.sort((a, b) => b.y1 - a.y1 || a.x0 - b.x0);
  // group into fields: cells side by side on a line, joined across a decimal point
  const dots = text.filter((t) => t.s === "•" || t.s === "·");
  const fields = [];
  for (const c of cells) {
    const f = fields.find((g) => {
      const last = g.cells[g.cells.length - 1];
      if (Math.abs(last.y0 - c.y0) > 1 || Math.abs(h(last) - h(c)) > 1.5) return false;
      const gap = c.x0 - last.x1;
      if (gap < -0.5) return false;
      if (gap <= 3.2) return true;
      if (g.cells.length === 1 && isPound(last) && gap < 18) return true; // a shaded spacer after the £ cell
      const dot = dots.find((d) => d.x >= last.x1 - 1 && d.x <= c.x0 + 1 && d.y >= c.y0 && d.y <= c.y1);
      if (dot && gap < 20) { g.dec = (last.x1 + c.x0) / 2; return true; }
      return false;
    });
    if (f) f.cells.push(c); else fields.push({ cells: [c] });
  }
  const boxes = new Map();
  for (const f of fields) {
    const x0 = Math.min(...f.cells.map((c) => c.x0)), x1 = Math.max(...f.cells.map((c) => c.x1)), y0 = Math.min(...f.cells.map((c) => c.y0)), y1 = Math.max(...f.cells.map((c) => c.y1));
    // the badge above-left, nearest in reading order
    let best, score = Infinity;
    for (const b of badges) {
      const dy = b.r.y0 - y1, dx = x0 - b.r.x0;
      if (dy < -h({ y0, y1 }) - 2 || dx < -6 || dx > 300) continue;
      const s = Math.max(0, dy) + dx * 0.3 + (dy < 0 ? 0 : 0);
      if (s < score) { score = s; best = b; }
    }
    if (!best) continue;
    const pound = isPound(f.cells[0]);
    if (pound && !f.dec) { const d = dots.find((t) => t.x > x0 && t.x < x1 && t.y >= y0 - 1 && t.y <= y1 + 1); if (d) f.dec = d.x + (d.w || 2) / 2; }
    const left = text.filter((t) => Math.abs(t.y - (y0 + 3)) < 6 && t.x < x0 && t.x > x0 - 70 && !/^\d+$/.test(t.s)).sort((a, b) => b.x - a.x)[0];
    const sub = left && /^(Yes|No|Number|Computations provided)$/i.test(left.s) ? left.s : undefined;
    const kind = pound ? "money" : f.cells.length === 1 && w(f.cells[0]) < 20 ? "tick" : f.cells.length >= 8 && f.cells.length <= 10 && sub === undefined && /DD|date/i.test(labelOf(best)) ? "date" : "text";
    const field = { kind, rect: [r1(x0), r1(y0), r1(x1), r1(y1)], cells: f.cells.length > 1 ? f.cells.map((c) => [r1(c.x0), r1(c.x1)]) : undefined, dec: f.dec ? r1(f.dec) : undefined, sub };
    const repeats = badges.filter((b) => b.s === best.s).length > 1;
    const id = `TR${tr}.${repeats ? `${best.sec}.` : ""}${best.s}`;
    if (!boxes.has(id)) boxes.set(id, { id, n: best.s, section: best.section, label: labelOf(best), fields: [] });
    boxes.get(id).fields.push(field);
  }
  function labelOf(b) {
    const edge = b.x < mid ? mid + 10 : view.width;
    const line = text.filter((t) => Math.abs(t.y - b.y) < 2.5 && t.x > b.x && t.x < edge && !nums.includes(t)).sort((a, c) => a.x - c.x);
    const next = text.filter((t) => t.y < b.y - 2.5 && t.y > b.y - 14 && t.x > b.x && t.x < edge && t.size < 10 && !nums.includes(t)).sort((a, c) => a.x - c.x);
    return [...line, ...next].map((t) => t.s).join(" ").replace(/\s+/g, " ").replace(/ ([,.)])/g, "$1").slice(0, 220);
  }
  // HMRC's own widgets on the first page (UTR, NINO, reference, name and address)
  for (const a of (await page.getAnnotations()).filter((x) => x.subtype === "Widget")) {
    const id = `TR${tr || 1}.${String(a.fieldName).toLowerCase()}`;
    boxes.set(id, { id, n: "", label: a.fieldName, fields: [{ kind: "text", rect: a.rect.map(r1) }] });
  }
  return { index: number, tr, w: r1(view.width), h: r1(view.height), boxes: [...boxes.values()].sort((a, b) => (Number(a.n) || 0) - (Number(b.n) || 0)) };
}

async function mapYear(year) {
  const file = join(DIR, `SA100-${year}.pdf`);
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), isEvalSupported: false, verbosity: 0 }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const pg = await pageBoxes(await doc.getPage(p), p);
    if (pg.tr) pages.push(pg);
  }
  const out = { year, made: "tools/sa100-map.mjs", pages };
  writeFileSync(join(DIR, `SA100-${year}.json`), JSON.stringify(out));
  console.log(`SA100-${year}: ${pages.length} pages, ${pages.reduce((a, p) => a + p.boxes.length, 0)} boxes`);
}

const years = process.argv.slice(2).length ? process.argv.slice(2).map(Number) : readdirSync(DIR).map((f) => f.match(/^SA100-(\d{4})\.pdf$/)?.[1]).filter(Boolean).map(Number);
for (const y of years.sort()) await mapYear(y);
// the years the app can show
const have = readdirSync(DIR).map((f) => f.match(/^SA100-(\d{4})\.json$/)?.[1]).filter(Boolean).map(Number).filter((y) => readdirSync(DIR).includes(`SA100-${y}.pdf`)).sort();
writeFileSync(join(DIR, "index.json"), JSON.stringify({ years: have }));
