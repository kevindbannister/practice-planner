// Works out where every box is on a drawn HMRC form page (SA100 and its supplementary pages), and can read what has been typed
// into them. Used by tools/sa100-map.mjs (to map HMRC's blank forms) and by the app (to read a filled-in return that IRIS Elements
// prints, whatever year it is for). pdf.js is passed in as `page` and `OPS` so this runs in node and in the browser.
//
// The forms are drawn, not fillable, so the boxes are found from the drawing: every white input cell (and the shaded cell with
// the £ sign), grouped into fields, and each field matched to the numbered badge above-left of it ("1", "2"...) and its label.
// The first page has HMRC's own few fields (UTR, NINO, reference, name and address), taken from the form's widgets.

// the code in the page footer: "Page TR 3", "Page E 1", "Page TC 2"...
const CODES = /^(TR|E|TC|SE|SEF|SES|SEFull|UKP|UKPF|F|CG|Ai|AI|P|Pa|SA|PE)$/;
export function pageCode(text) {
  const foot = text.filter((i) => i.y < 30);
  const d = foot.find((i) => /^\d{1,2}$/.test(i.s) && foot.some((j) => CODES.test(j.s) && j.x < i.x && Math.abs(j.y - i.y) < 2));
  const c = d && foot.filter((j) => CODES.test(j.s) && j.x < d.x && Math.abs(j.y - d.y) < 2).sort((x, y) => y.x - x.x)[0];
  return c ? { form: c.s, no: Number(d.s) } : { form: "", no: 0 };
}

const r1 = (v) => Math.round(v * 10) / 10;
const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

export async function pageBoxes(page, number, OPS, read = false) {
  const view = page.getViewport({ scale: 1 });
  const text = (await page.getTextContent()).items.filter((i) => i.str.trim()).map((i) => ({ x: i.transform[4], y: i.transform[5], size: Math.abs(i.transform[0]) || Math.abs(i.transform[3]), s: i.str.trim(), font: i.fontName, w: i.width }));
  const { form, no } = pageCode(text);
  const tr = form === "TR" ? no : 0;
  // drawn rectangles with their fill colour
  const ops = await page.getOperatorList();
  const O = OPS;
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
  cells.sort((a, b) => (Math.abs(a.y1 - b.y1) > 1.5 ? b.y1 - a.y1 : a.x0 - b.x0)); // same row (within 1.5pt) left to right
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
    const id = `${form}${no}.${repeats ? `${best.sec}.` : ""}${best.s}`;
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
    const id = `${form || "TR"}${no || 1}.${String(a.fieldName).toLowerCase()}`;
    boxes.set(id, { id, n: "", label: a.fieldName, fields: [{ kind: "text", rect: a.rect.map(r1) }] });
  }
  if (read) for (const bx of boxes.values()) for (const f of bx.fields) f.value = readField(text, f);
  return { index: number, form, no, tr, w: r1(view.width), h: r1(view.height), boxes: [...boxes.values()].sort((a, b) => (Number(a.n) || 0) - (Number(b.n) || 0)) };
}

// ------------------------------------------------------------------ reading what is typed in

/** What is written in a field: money as "1234.50" ("" when empty), a tick as "X", a date as "dd/mm/yyyy", text as it reads. */
export function readField(text, f) {
  const [x0, y0, x1, y1] = f.rect;
  // the middle of each piece of text must be in the box, so printed words that only start inside its edge aren't taken
  const inside = text.filter((t) => { const mid = t.x + (t.w || 0) / 2; return mid >= x0 - 1 && mid <= x1 + 1 && t.y >= y0 - 1.5 && t.y <= y1 + 1.5 && t.s !== "£" && t.s !== "•" && t.s !== "·"; });
  // HMRC prints a pale 0 in each pence cell (11pt); what is typed in is a little bigger. Where both sit in a cell keep the typed one.
  const mine = [];
  for (const t of inside.sort((a, b) => b.size - a.size)) if (!mine.some((m) => Math.abs(m.x - t.x) < 2 && Math.abs(m.y - t.y) < 2)) mine.push(t);
  const decX = f.dec ?? (f.cells ? f.cells[f.cells.length - 1][0] : x1);
  const typed = mine.filter((t) => !(t.s === "0" && t.size < 11.4 && f.kind === "money" && t.x >= decX)).sort((a, b) => b.y - a.y || a.x - b.x);
  if (!typed.length) return "";
  if (f.kind === "tick") { const w = typed.map((t) => t.s).join(""); return /[Xx✓✔]/.test(w) ? "X" : /^\d+$/.test(w) ? w : ""; } // a tick, or the Number box
  if (f.kind === "money") {
    const dec = decX;
    const whole = typed.filter((t) => t.x < dec && /^\d$/.test(t.s)).map((t) => t.s).join("");
    const pence = typed.filter((t) => t.x >= dec && /^\d$/.test(t.s)).sort((a, b) => a.x - b.x).map((t) => t.s).join("");
    if (!whole && !/[1-9]/.test(pence)) return "";
    const neg = typed.some((t) => /^[-−–]$/.test(t.s));
    return `${neg ? "-" : ""}${whole || "0"}.${(pence + "00").slice(0, 2)}`;
  }
  const flat = typed.filter((t) => t.s !== "/" || f.kind !== "date");
  if (f.kind === "date") {
    const digits = flat.map((t) => t.s).join("").replace(/\D/g, "");
    return digits.length === 8 ? `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}` : digits;
  }
  // text: one character per cell joins up; a run of words is spaced by its gaps
  const sorted = [...typed].sort((a, b) => Math.round(b.y / 3) - Math.round(a.y / 3) || a.x - b.x);
  let out = "", prev;
  for (const t of sorted) {
    if (prev && Math.abs(prev.y - t.y) > 3) out += "\n";
    else if (prev && !(f.cells && f.cells.length > 1) && t.x - (prev.x + (prev.w || 0)) > 1.5) out += " ";
    out += t.s;
    prev = t;
  }
  return out.trim();
}
