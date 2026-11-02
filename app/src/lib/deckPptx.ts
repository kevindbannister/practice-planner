// A deck as a PowerPoint file: real slides with real charts, so it can be changed in PowerPoint as well.
// The constructor is passed in (the browser loads pptxgenjs from the site; the tests use the package).
import { Deck, Slide, hex6, presentable, themeOf, onColour, mix } from "./deck";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Pptx = any;
const W = 10, H = 5.625, M = 0.5;
const k = (n: number) => `£${Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(Math.abs(n) >= 1e4 ? 1 : 1).replace(/\.0$/, "")}k` : Math.round(n)}`;

export type PptxOptions = { includeInternal?: boolean; firmLogo?: string; firmName?: string };

export async function buildPptx(Ctor: new () => Pptx, deck: Deck, opt: PptxOptions = {}): Promise<ArrayBuffer> {
  const pres = new Ctor();
  pres.layout = "LAYOUT_16x9";
  const b = deck.brand, T = themeOf(b);
  const head = b.serif ? "Cambria" : "Calibri", body = "Calibri";
  pres.title = `${b.clientName} business review`;
  pres.company = (opt.firmName || "").replace(/&/g, "&amp;");
  const slides = presentable(deck, !!opt.includeInternal);
  const total = slides.length;
  const C = (h: string) => hex6(h);

  const frame = (s: Slide, n: number) => {
    const sl = pres.addSlide();
    sl.background = { color: C(T.bg) };
    if (b.logo) sl.addImage({ data: b.logo, x: M, y: 0.28, w: 1.0, h: 0.5, sizing: { type: "contain", w: 1.0, h: 0.5 }, altText: `${b.clientName} logo` });
    sl.addText(s.title, { x: b.logo ? 1.7 : M, y: 0.28, w: W - (b.logo ? 1.7 : M) - M, h: 0.5, fontFace: head, fontSize: 24, bold: true, color: C(T.ink), valign: "middle", margin: 0, isTextBox: true, fit: "shrink" });
    sl.addText(`${n} / ${total}`, { x: M, y: H - 0.4, w: 1, h: 0.25, fontSize: 10, color: C(T.muted), margin: 0, isTextBox: true });
    if (b.footer) sl.addText(b.footer, { x: 2, y: H - 0.4, w: 6, h: 0.25, fontSize: 10, color: C(T.muted), align: "center", margin: 0, isTextBox: true });
    if (b.firmLogo && opt.firmLogo) sl.addImage({ data: opt.firmLogo, x: W - M - 0.9, y: H - 0.45, w: 0.9, h: 0.3, sizing: { type: "contain", w: 0.9, h: 0.3 }, altText: "Firm logo" });
    if (s.notes) sl.addNotes(s.notes);
    return sl;
  };
  const sub = (sl: Pptx, s: Slide) => { if (s.subtitle) sl.addText(s.subtitle, { x: M, y: 0.95, w: W - 2 * M, h: 0.3, fontSize: 14, bold: true, color: C(T.muted), margin: 0, isTextBox: true }); };
  const take = (sl: Pptx, s: Slide) => { if (s.takeaway) sl.addText(s.takeaway, { x: M, y: H - 1.05, w: W - 2 * M, h: 0.6, fontSize: 14, bold: true, color: C(T.primary), align: "center", margin: 0, isTextBox: true, fit: "shrink" }); };
  const chartBase = (title?: string) => ({ catAxisLabelColor: C(T.muted), valAxisLabelColor: C(T.muted), catAxisLabelFontFace: body, valAxisLabelFontFace: body, catAxisLabelFontSize: 11, valAxisLabelFontSize: 10, valGridLine: { color: C(mix(T.bg, T.muted, 0.3)), size: 0.5 }, catGridLine: { style: "none" }, ...(title ? { showTitle: true, title } : {}) });

  slides.forEach((s, i) => {
    const n = i + 1;
    if (s.type === "cover" || s.type === "section") {
      const sl = pres.addSlide();
      sl.background = { color: C(T.dark) };
      const half = s.type === "cover";
      if (half && b.cover) sl.addImage({ data: b.cover, x: W / 2, y: 0, w: W / 2, h: H, sizing: { type: "cover", w: W / 2, h: H }, altText: "Cover picture" });
      if (b.logo) sl.addImage({ data: b.logo, x: M, y: 0.4, w: 1.4, h: 0.7, sizing: { type: "contain", w: 1.4, h: 0.7 }, altText: `${b.clientName} logo` });
      sl.addText(s.title, { x: M, y: 1.7, w: half ? 4.4 : W - 2 * M, h: 1.6, fontFace: head, fontSize: half ? 32 : 36, bold: true, color: C(T.onDark), valign: "top", margin: 0, isTextBox: true, fit: "shrink" });
      if (s.subtitle) sl.addText(s.subtitle, { x: M, y: 3.4, w: half ? 4.4 : W - 2 * M, h: 0.4, fontSize: 16, bold: true, color: C(T.primary), margin: 0, isTextBox: true });
      if (b.firmLogo && opt.firmLogo) sl.addImage({ data: opt.firmLogo, x: M, y: H - 0.8, w: 1.2, h: 0.4, sizing: { type: "contain", w: 1.2, h: 0.4 }, altText: "Firm logo" });
      if (s.notes) sl.addNotes(s.notes);
      return;
    }
    const sl = frame(s, n);
    if (s.type === "kpis" && s.tiles) {
      const cnt = s.tiles.length, gap = 0.25, w = (W - 2 * M - gap * (cnt - 1)) / cnt;
      s.tiles.forEach((t, j) => {
        const x = M + j * (w + gap);
        sl.addShape("roundRect", { x, y: 1.5, w, h: 2.2, fill: { color: C(T.card) }, rectRadius: 0.12, line: { color: C(mix(T.bg, T.muted, 0.25)), width: 0.75 }, objectName: `Tile ${j + 1}` });
        sl.addText(t.label, { x: x + 0.15, y: 1.65, w: w - 0.3, h: 0.3, fontSize: 12, bold: true, color: C(T.muted), align: "center", margin: 0, isTextBox: true });
        sl.addText(t.value, { x: x + 0.1, y: 2.05, w: w - 0.2, h: 0.8, fontFace: head, fontSize: cnt > 4 ? 28 : 36, bold: true, color: C(T.ink), align: "center", margin: 0, isTextBox: true, fit: "shrink" });
        if (t.change) sl.addText(t.change, { x: x + 0.1, y: 2.95, w: w - 0.2, h: 0.35, fontSize: 18, bold: true, color: C(t.tone === "up" ? T.up : t.tone === "down" ? T.down : T.muted), align: "center", margin: 0, isTextBox: true });
        if (t.sub) sl.addText(t.sub, { x: x + 0.1, y: 3.3, w: w - 0.2, h: 0.25, fontSize: 11, color: C(T.muted), align: "center", margin: 0, isTextBox: true });
      });
      take(sl, s);
    } else if (s.type === "bars" && s.bars) {
      sub(sl, s);
      const data = s.bars.names.map((name, j) => ({ name, labels: s.bars!.rows.map((r) => r.label), values: s.bars!.rows.map((r) => r.values[j] ?? 0) }));
      const colours = s.bars.names.length > 1 ? [C(T.grey), C(T.primary)] : [C(T.primary)];
      sl.addChart(pres.charts.BAR, data, { x: M, y: 1.3, w: W - 2 * M, h: 3.0, barDir: s.bars.horizontal ? "bar" : "col", barGapWidthPct: 60, chartColors: colours, showLegend: s.bars.names.length > 1, legendPos: "t", legendColor: C(T.muted), legendFontSize: 11,
        showValue: true, dataLabelColor: C(T.ink), dataLabelFontSize: 10, dataLabelFontFace: body, dataLabelFormatCode: s.bars.unit === "%" ? '0"%"' : '"£"#,##0', catAxisOrientation: s.bars.horizontal ? "maxMin" : "minMax", valAxisHidden: false, valAxisLabelFormatCode: s.bars.unit === "%" ? '0"%"' : '"£"#,##0', ...chartBase() });
      take(sl, s);
    } else if (s.type === "bridge" && s.bridge) {
      sub(sl, s);
      let run = 0;
      const base: number[] = [], tot: number[] = [], up: number[] = [], down: number[] = [];
      s.bridge.rows.forEach((r) => {
        if (r.total) { run = r.value; base.push(0); tot.push(r.value); up.push(0); down.push(0); }
        else if (r.value >= 0) { base.push(run); tot.push(0); up.push(r.value); down.push(0); run += r.value; }
        else { run += r.value; base.push(run); tot.push(0); up.push(0); down.push(-r.value); }
      });
      const labels = s.bridge.rows.map((r) => r.label);
      sl.addChart(pres.charts.BAR, [{ name: "Base", labels, values: base }, { name: "Total", labels, values: tot }, { name: "Increase", labels, values: up }, { name: "Decrease", labels, values: down }],
        { x: M, y: 1.6, w: W - 2 * M, h: 2.75, barDir: "col", barGrouping: "stacked", barGapWidthPct: 40, chartColors: [C(T.bg), C(T.primary), C(T.up), C(T.down)], showLegend: false, showValue: false, valAxisLabelFormatCode: '"£"#,##0', ...chartBase(), valGridLine: { style: "none" } });
      // labels above each bar, from the figures
      const plotX = M + 0.75, plotW = W - 2 * M - 0.85, step = plotW / s.bridge.rows.length;
      s.bridge.rows.forEach((r, j) => sl.addText(r.total ? k(r.value) : `${r.value >= 0 ? "+" : "-"}${k(Math.abs(r.value))}`, { x: plotX + j * step, y: 1.38, w: step, h: 0.25, fontSize: 10, bold: true, color: C(r.total ? T.ink : r.value >= 0 ? T.up : T.down), align: "center", margin: 0, isTextBox: true }));
      take(sl, s);
    } else if (s.type === "line" && s.line) {
      sub(sl, s);
      sl.addChart(pres.charts.LINE, s.line.series.map((x) => ({ name: x.name, labels: s.line!.categories, values: x.values })), { x: M, y: 1.3, w: W - 2 * M, h: 3.0, chartColors: s.line.series.length > 1 ? [C(T.grey), C(T.primary)] : [C(T.primary)], lineSize: 3, lineDataSymbolSize: 7, showLegend: s.line.series.length > 1, legendPos: "t", legendColor: C(T.muted), legendFontSize: 11, valAxisLabelFormatCode: '"£"#,##0', ...chartBase() });
      take(sl, s);
    } else if (s.type === "timeline" && s.points) {
      const cnt = s.points.length, step = (W - 2 * M) / cnt;
      sl.addShape("line", { x: M + step / 2, y: 2.6, w: step * (cnt - 1), h: 0, line: { color: C(T.muted), width: 1.5 }, objectName: "Timeline" });
      s.points.forEach((p, j) => {
        const cx = M + step * j + step / 2, up = j % 2 === 0;
        sl.addShape("ellipse", { x: cx - 0.1, y: 2.5, w: 0.2, h: 0.2, fill: { color: C(T.primary) }, line: { color: C(T.bg), width: 2 }, objectName: `Point ${j + 1}` });
        sl.addText([{ text: p.value, options: { fontFace: head, fontSize: 22, bold: true, color: C(T.ink), breakLine: true } }, { text: p.label, options: { fontSize: 12, bold: true, color: C(T.muted), breakLine: !!p.sub } }, ...(p.sub ? [{ text: p.sub, options: { fontSize: 11, color: C(T.muted) } }] : [])],
          { x: cx - step / 2, y: up ? 1.5 : 2.85, w: step, h: 0.95, align: "center", valign: up ? "bottom" : "top", margin: 0, isTextBox: true, fit: "shrink" });
      });
      take(sl, s);
    } else if (s.type === "table" && s.table) {
      const cols = s.table.head.length, first = Math.min(0.5, 0.9 / cols) + 0.15;
      const cell = (t: string, headRow: boolean, c: number) => ({ text: t, options: { bold: headRow, color: C(headRow ? T.onPrimary : T.ink), fill: { color: C(headRow ? T.primary : T.card) }, fontFace: body, fontSize: 13, align: c === 0 ? "left" : cols === 2 ? "left" : "right", valign: "middle", margin: [0.04, 0.1, 0.04, 0.1] } });
      const rows = [s.table.head.map((t, c) => cell(t, true, c)), ...s.table.rows.map((r) => r.map((t, c) => cell(t, false, c)))];
      sl.addTable(rows, { x: M, y: 1.15, w: W - 2 * M, colW: cols === 2 ? [(W - 2 * M) * 0.5, (W - 2 * M) * 0.5] : [(W - 2 * M) * first, ...Array(cols - 1).fill((W - 2 * M) * (1 - first) / (cols - 1))], border: { type: "solid", color: C(mix(T.bg, T.muted, 0.25)), pt: 0.5 }, autoPage: false });
      take(sl, s);
    } else if (s.type === "checklist" && s.items) {
      const rowH = Math.min(0.62, 2.9 / Math.max(1, s.items.length));
      s.items.forEach((it, j) => {
        const y = 1.2 + j * rowH;
        sl.addText(String(j + 1).padStart(2, "0"), { x: M, y, w: 0.6, h: rowH, fontFace: head, fontSize: 20, bold: true, color: C(T.primary), valign: "middle", margin: 0, isTextBox: true });
        sl.addText(it.title, { x: M + 0.7, y, w: it.text ? 3.0 : W - 2 * M - 0.7, h: rowH, fontSize: 15, bold: true, color: C(T.ink), valign: "middle", margin: 0, isTextBox: true, fit: "shrink" });
        if (it.text) sl.addText(it.text, { x: M + 3.8, y, w: W - 2 * M - 3.8, h: rowH, fontSize: 13, color: C(T.muted), valign: "middle", margin: 0, isTextBox: true, fit: "shrink" });
      });
      if (s.band && (s.band.left || s.band.right)) {
        sl.addShape("rect", { x: 0, y: H - 1.0, w: W, h: 0.55, fill: { color: C(T.dark) }, objectName: "Band" });
        sl.addText(s.band.left, { x: M, y: H - 1.0, w: 5, h: 0.55, fontSize: 14, bold: true, color: C(T.onDark), valign: "middle", margin: 0, isTextBox: true });
        sl.addText(s.band.right, { x: W / 2, y: H - 1.0, w: W / 2 - M, h: 0.55, fontSize: 14, bold: true, color: C(T.primary), align: "right", valign: "middle", margin: 0, isTextBox: true });
      }
    } else if (s.type === "callout" && s.big) {
      sl.addText(s.big.value, { x: M, y: 1.4, w: W - 2 * M, h: 1.4, fontFace: head, fontSize: 72, bold: true, color: C(T.primary), align: "center", valign: "middle", margin: 0, isTextBox: true, fit: "shrink" });
      sl.addText(s.big.caption, { x: M, y: 2.9, w: W - 2 * M, h: 0.5, fontSize: 18, bold: true, color: C(T.ink), align: "center", margin: 0, isTextBox: true });
      take(sl, s);
    } else if (s.type === "text" && s.bullets) {
      sl.addText(s.bullets.map((t, j) => ({ text: t, options: { bullet: true, breakLine: j < s.bullets!.length - 1, paraSpaceAfter: 8 } })), { x: M, y: 1.2, w: W - 2 * M, h: 3.4, fontSize: 18, color: C(T.ink), valign: "top", margin: 0, isTextBox: true, fit: "shrink" });
    }
  });
  const out = await pres.write({ outputType: "arraybuffer" });
  return out as ArrayBuffer;
}
export { onColour };
