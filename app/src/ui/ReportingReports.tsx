// Reporting › Reports: build a report for a client from sections of text, charts, tables, KPIs and cash flow, for a month, quarter or year,
// then publish it as a finished page that can be opened or printed to PDF. Drafts save themselves; the figures are the client's monthly figures
// read from Xero, so a draft is always up to date and a published report is a frozen copy.
import { Fragment, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cashFlow, measureById, monthlySeries } from "../lib/analysis";
import { r2 } from "../lib/xero";
import { AgedData } from "../lib/aged";
import { KpiSettings, computeKpis, formatKpi } from "../lib/kpis";
import { keyData } from "../lib/reportComponents";
import {
  Block, CHART_BLOCKS, LAYOUTS, TEMPLATES, fromTemplate, chartH, spanOf, Orientation, PALETTES, Pick, ReportDoc, Section, TABLE_BLOCKS, TEXT_BLOCKS, anchorFor, copyReport, nextCopy, asTemplate, copyTemplate, customise, fromSaved, moveItem, newReport, periodWords, uid, sectionOrientation,
} from "../lib/reportBuilder";
import { PeriodKind, REPORT_FOLDER, ReportData, bsStatement, monthLabel, monthLong, periodCols, plStatement } from "../lib/reportData";
import { todayIso } from "../lib/domain";
import { Icon, IconName, href } from "./bits";
import { readSetting, useData } from "./data";
import { brandOf, readBranding } from "../lib/docBranding";
import { AgedView, useAgedData } from "./ReportingAged";
import { ChartView, ComponentEditor, Ctx, KeyView, LINE, MovementsView, NAVY, ObservationView, Swatch, T, TableView, TopView, observationHidden } from "./ReportingComponents";
import { Seg, useReportData } from "./reportingKit";
import { Thumb } from "./ReportingThumbs";

type Tenant = { tenantId: string; tenantName: string };
type Props = { clientKey: string; clientName: string; yearEnd?: string; tenant: Tenant; id?: string };
const endMonthOf = (yearEnd?: string) => Number((/^(\d{2})-/.exec(yearEnd || "") || [])[1]) || 12;
const gbp = (n?: number) => (n === undefined ? "" : n === 0 ? "–" : n < 0 ? `(${Math.abs(Math.round(n)).toLocaleString("en-GB")})` : Math.round(n).toLocaleString("en-GB"));
const money = (n?: number) => (n === undefined ? "–" : `${n < 0 ? "-" : ""}£${Math.abs(Math.round(n)).toLocaleString("en-GB")}`);
const short = (n: number) => { const a = Math.abs(n), s = n < 0 ? "-" : ""; return a >= 1e6 ? `${s}£${+(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `${s}£${+(a / 1e3).toFixed(1)}K` : `${s}£${Math.round(a)}`; };
const GREEN = "#6f9a3a";
const fileOf = (clientKey: string, id: string) => `/me/drive/root:/${encodeURIComponent(REPORT_FOLDER)}/${encodeURIComponent(clientKey)}/reports/${encodeURIComponent(id)}.html`;
const withP = (c: Ctx, p?: PeriodKind): Ctx => (p ? { ...c, kind: p } : c);
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

// ------------------------------------------------------------------ drawing the report (used on screen and in the published copy)

function KpiView({ c }: { c: Ctx }) {
  const res = computeKpis(c.d, c.kind, c.anchor, c.endMonth, c.kpi);
  const on = res.filter((r) => r.onTrack === true).length, off = res.filter((r) => r.onTrack === false).length;
  let last = "";
  return (
    <div>
      <p style={T.p}><strong>{on}</strong> of {on + off} KPIs are on track{off ? `, ${off} off track` : ""}.</p>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 8.8 }}>
        <thead><tr><th style={{ ...T.th, textAlign: "left" }}>KPI</th><th style={T.th}>Result</th><th style={T.th}>Target</th><th style={{ ...T.th, textAlign: "center" }}>Status</th></tr></thead>
        <tbody>
          {res.map((r) => {
            const head = r.def.category !== last; last = r.def.category;
            return (
              <Fragment key={r.def.id}>
                {head && <tr style={{ borderBottom: "1px solid #111" }}><td colSpan={4} style={{ padding: "8px 4px 3px", fontWeight: 700, fontSize: 8.8, letterSpacing: 0.3, color: "#111" }}>{r.def.category.toUpperCase()}</td></tr>}
                <tr style={{ borderBottom: "1px solid #e6e6ea" }}>
                  <td style={{ ...T.td, textAlign: "left", paddingLeft: 14 }}>{r.def.name}</td><td style={T.td}>{r.note && r.value === undefined ? "–" : formatKpi(r.def.unit, r.value)}</td><td style={T.td}>{r.hasTarget ? formatKpi(r.def.unit, r.target) : "not set"}</td>
                  <td style={{ ...T.td, textAlign: "center", color: r.onTrack === undefined ? "#9aa5b1" : r.onTrack ? "#5b8a2d" : "#d4300f", fontWeight: 700 }}>{r.onTrack === undefined ? "–" : r.onTrack ? "On track" : "Off track"}</td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CashFlowView({ c }: { c: Ctx }) {
  const cf = cashFlow(c.d, c.kind, c.anchor, c.endMonth);
  if (!cf) return <p style={{ ...T.p, color: "#7a8591" }}>The cash flow needs the balance sheet for this period and the month before it.</p>;
  return (
    <>
    {cf.unexplainedBig && <p style={{ ...T.p, color: "#d4300f" }}>Note: £{Math.abs(Math.round(cf.unexplained)).toLocaleString("en-GB")} of the movement in cash isn't explained by the figures (see the unexplained difference below).</p>}
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 8.8 }}>
      <tbody>
        {cf.lines.map((l, i) => (
          <Fragment key={l.label}>
            <tr style={{ borderBottom: "1px solid #e6e6ea" }}><td style={{ ...T.td, textAlign: "left", color: "#7a8591", width: 44, fontSize: 10 }}>{l.tag}</td><td style={{ ...T.td, textAlign: "left" }}>{l.label}</td><td style={{ ...T.td, color: l.amount < 0 ? "#d4300f" : undefined }}>{gbp(l.amount)}</td></tr>
            {cf.totals.filter((t) => t.after === i).map((t) => <tr key={t.total.label} style={{ borderTop: "1px solid #111", borderBottom: "1px solid #111", fontWeight: 700 }}><td colSpan={2} style={{ ...T.td, textAlign: "left" }}>{t.total.label}</td><td style={T.td}>{gbp(t.total.amount)}</td></tr>)}
          </Fragment>
        ))}
        {/* from the net cash flow to the bank: opening cash, the cash flow, money borrowed or repaid, closing cash */}
        {(() => {
          const debt = r2(cf.debt.close - cf.debt.open), r = (label: string, v: number, strong = false) => (
            <tr key={label} style={strong ? { borderTop: "1px solid #111", borderBottom: "1px solid #111", fontWeight: 700 } : { borderBottom: "1px solid #e6e6ea" }}><td colSpan={2} style={{ ...T.td, textAlign: "left" }}>{label}</td><td style={T.td}>{gbp(v)}</td></tr>);
          return [<tr key="gap"><td colSpan={3} style={{ height: 10 }} /></tr>, r("Cash at bank at the start", cf.cash.open), r("Net cash flow", cf.net), r(debt >= 0 ? "Borrowing drawn" : "Borrowing repaid", debt), r("Cash at bank at the end", cf.cash.close, true)];
        })()}
      </tbody>
    </table>
    </>
  );
}

type Edit = { change: (b: Block) => void };
function BlockView({ b, c, edit, tone }: { b: Block; c?: Ctx; edit?: Edit; tone?: number }) {
  const field = (value: string, set: (v: string) => void, rows = 4, label = "Text") => (edit
    ? <textarea aria-label={label} value={value} rows={rows} placeholder="Write here…" onChange={(e) => set(e.target.value)} style={{ width: "100%", boxSizing: "border-box", font: "inherit", fontSize: 10.7, lineHeight: 1.5, padding: 8, border: "1px dashed #cbd5e1", borderRadius: 4, resize: "vertical" }} />
    : <div style={T.p}>{value}</div>);
  if (b.type === "line") return <hr style={{ border: 0, borderTop: "1px solid #cbd5e1", margin: "16px 0" }} />;
  if (b.type === "page") return edit ? <div style={{ borderTop: "2px dashed #b8c2cc", margin: "18px 0", textAlign: "center", fontSize: 11, color: "#7a8591" }}>Page break</div> : <div style={{ pageBreakAfter: "always", breakAfter: "page" }} />;
  if (b.type === "columns") return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>{field(b.left, (v) => edit?.change({ ...b, left: v }), 5, "Left column")}{field(b.right, (v) => edit?.change({ ...b, right: v }), 5, "Right column")}</div>;
  if (b.type === "text") {
    if (b.style === "heading") return edit ? <input aria-label="Heading" value={b.text} placeholder="Heading" onChange={(e) => edit.change({ ...b, text: e.target.value })} style={{ width: "100%", boxSizing: "border-box", fontSize: 16, fontWeight: 600, border: "1px dashed #cbd5e1", padding: 6 }} /> : <h3 style={{ margin: "16px 0 6px", fontSize: 14, fontWeight: 500, color: "#111" }}>{b.text}</h3>;
    const box = b.style === "observation" || b.style === "summary";
    return (
      <div style={box ? { margin: "18px 0" } : undefined}>
        {box && b.title !== undefined && <div style={{ fontSize: 10.7, letterSpacing: 0.3, textTransform: "uppercase", color: "#8a8d94", marginBottom: 4 }}>{edit ? <input aria-label="Title" value={b.title} onChange={(e) => edit.change({ ...b, title: e.target.value })} style={{ font: "inherit", textTransform: "inherit", border: 0, background: "transparent", width: "100%" }} /> : b.title}</div>}
        {field(b.text, (v) => edit?.change({ ...b, text: v }), box ? 4 : 5)}
      </div>
    );
  }
  const tagOf = (cx: Ctx, p?: PeriodKind) => periodCols(p || cx.kind, cx.anchor, cx.endMonth, "none")[0]?.label;
  const title = (t: string, suffix?: string) => (edit
    ? <input aria-label="Block title" value={t} onChange={(e) => edit.change({ ...b, title: e.target.value } as Block)} style={{ ...T.cap, width: "100%", boxSizing: "border-box", border: 0, background: "transparent" }} />
    : <div style={T.cap}>{t}{suffix && <span style={{ color: "#a5a8b0" }}> ({suffix})</span>}</div>);
  if (!c) return null;
  // "hide when empty": in the finished report a part with nothing to show is left out rather than shown with a placeholder
  if (!edit && "hideEmpty" in b && b.hideEmpty) {
    const cx = b.type === "key" ? withP(c, b.period) : c;
    if (b.type === "key" && keyData(cx.d, b.measure, cx.kind, cx.anchor, cx.endMonth, "none").value === undefined) return null;
    if (b.type === "aged" && !c.aged) return null;
    if (b.type === "cashflow" && !cashFlow(c.d, c.kind, c.anchor, c.endMonth)) return null;
  }
  const hidden = b.type === "observation" && observationHidden(b, c);
  if (hidden && !edit) return null;
  return (
    <div style={{ margin: "6px 0", pageBreakInside: "avoid", breakInside: "avoid", opacity: hidden ? 0.45 : 1 }} title={hidden ? "Hidden in the published report by its extra condition" : undefined}>
      {b.type !== "observation" && b.type !== "key" && title(b.title, b.type === "top" ? tagOf(c, b.period) : undefined)}
      {b.type === "key" ? <KeyView b={b} c={c} tone={tone} label={edit ? <input aria-label="Block title" value={b.title} onChange={(e) => edit.change({ ...b, title: e.target.value })} style={{ font: "inherit", textTransform: "inherit", color: "inherit", letterSpacing: "inherit", border: 0, background: "transparent", width: "70%" }} /> : undefined} /> : b.type === "observation" ? <ObservationView b={b} c={c} /> : b.type === "top" ? <TopView b={b} c={c} /> : b.type === "aged" ? (c.aged ? <AgedView data={c.aged} kind={b.which} limit={15} /> : <p style={{ ...T.p, color: "#7a8591" }}>The unpaid invoices and bills haven't been read from Xero yet (Reporting › Receivables).</p>) : b.type === "chart" ? <ChartView b={b} c={c} /> : b.type === "table" ? <TableView b={b} c={c} /> : b.type === "kpis" ? <KpiView c={c} /> : b.type === "movements" ? <MovementsView b={b} c={c} onNotes={edit ? (notes) => edit.change({ ...b, notes }) : undefined} /> : <CashFlowView c={c} />}
    </div>
  );
}

// the report's look (the print rules in publishedHtml are written "html body …" so they win over these): a cover page, then one page per section, in a restrained navy / red / amber palette
const REPORT_CSS = `@import url('https://fonts.googleapis.com/css2?family=Figtree:wght@300;400;500;600;700;800&display=swap');
.rp{font-family:Figtree,"Avenir Next","Segoe UI",system-ui,-apple-system,Arial,sans-serif;color:#111;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.rp *{box-sizing:border-box}
.rp{container-type:inline-size;--ph:141.42cqw}
.rp-cover{position:relative;container-type:inline-size;aspect-ratio:210/297;background:#fff;overflow:hidden;page:cover;box-shadow:0 1px 3px rgba(0,0,0,.12),0 6px 20px rgba(0,0,0,.08)}
.rp-cover.L{aspect-ratio:297/210}
.rp-cover-body{position:absolute;left:17%;right:17%;top:24%}
.rp-cover.L .rp-cover-body{top:14%}
.rp-logo{font-size:5.2cqw;font-weight:800;letter-spacing:-.045em;line-height:1;color:#111;margin-bottom:9cqw}
.rp-cover.L .rp-logo{font-size:3.8cqw;margin-bottom:4cqw}
.rp-rule{border:0;border-top:1px solid #333;margin:0}
.rp-prep{display:flex;align-items:center;gap:2cqw;margin-top:4cqw;font-size:1.6cqw;color:#59606d}.rp-prep img{max-height:5cqw;max-width:18cqw;object-fit:contain}
.rp-title{font-size:3cqw;font-weight:500;margin:0;padding:2.6cqw 0;letter-spacing:-.01em}
.rp-sub{font-size:2.35cqw;font-weight:300;line-height:1.5;margin-top:2.6cqw}
.rp-band{position:absolute;left:0;right:0;bottom:0;height:33%;background:#141b2f}
.rp-cover.L .rp-band{height:28%}
.rp-band svg{width:100%;height:100%;display:block}
.rp-in{padding:0 9%}
.rp-sec.L .rp-in{padding:0 4.04%}
.rp-sec{position:relative;padding:40px 0 40px;background:#fff;aspect-ratio:210/297;box-shadow:0 1px 3px rgba(0,0,0,.12),0 6px 20px rgba(0,0,0,.08);background-image:repeating-linear-gradient(to bottom,transparent 0,transparent calc(var(--ph) - 2px),#b9c9e0 calc(var(--ph) - 2px),#b9c9e0 var(--ph))}
.rp-sec.L{aspect-ratio:297/210;page:pl}.rp-sec.P{page:pp}
.rp-mix .rp-sec.P,.rp-mix .rp-cover.P{width:70.71%;margin-left:auto;margin-right:auto}
.rp{counter-reset:pg 1}.rp-sec{counter-increment:pg}
.rp-sec::after{content:"Page " counter(pg);position:absolute;right:4%;top:calc(var(--ph) - 24px);font-size:10px;color:#9aa4b2}
.rp-break{display:flex;align-items:center;gap:12px;height:44px;color:#8a95a1;font-size:11px;letter-spacing:.08em;text-transform:uppercase}
.rp-break::before,.rp-break::after{content:"";flex:1;border-top:1px dashed #aab4c2}
.rp-grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));column-gap:3%;align-items:start}
.rp-foot{font-size:8.4px;color:#8a8d94;border-top:1px solid #dcdde1;padding-top:10px;margin:30px 0 20px}`;

const NET = (() => {
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pts = Array.from({ length: 64 }, () => [rnd() * 1000, 30 + rnd() * 260] as [number, number]);
  const edges: [number, number][] = [];
  pts.forEach((p, i) => {
    pts.map((q, j) => ({ j, d: (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 })).filter((x) => x.j !== i).sort((x, y) => x.d - y.d).slice(0, 3).forEach((x) => edges.push([i, x.j]));
  });
  for (let k = 0; k < 26; k++) edges.push([Math.floor(rnd() * pts.length), Math.floor(rnd() * pts.length)]);
  return { pts, edges };
})();
function Network() {
  return (
    <svg viewBox="0 0 1000 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {NET.edges.map(([i, j], k) => <line key={k} x1={NET.pts[i][0]} y1={NET.pts[i][1]} x2={NET.pts[j][0]} y2={NET.pts[j][1]} stroke="#3a4157" strokeWidth={1.2} />)}
      {NET.pts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={i % 3 === 0 ? 4.6 : 3.2} fill="#3a4157" />)}
    </svg>
  );
}

export type BlockProps = { className?: string; onDragOver?: React.DragEventHandler<HTMLDivElement>; onDrop?: React.DragEventHandler<HTMLDivElement> };
export function ReportView({ doc, c, clientName, edit, sectionTools, blockTools, addButtons, selectedId, onSelect, blockProps }: {
  doc: ReportDoc; c?: Ctx; clientName: string; edit?: (s: Section, b: Block) => Edit; selectedId?: string; onSelect?: (b: Block) => void; blockProps?: (s: Section, b: Block, i: number) => BlockProps;
  sectionTools?: (s: Section, i: number) => ReactNode; blockTools?: (s: Section, b: Block, i: number) => ReactNode; addButtons?: (s: Section) => ReactNode;
}) {
  const words = periodWords(doc.kind, c?.anchor || doc.anchor);
  const baseC = c && { ...c, palette: doc.palette ?? c.palette };
  // a report with both kinds of page is drawn as wide as its landscape pages, the portrait ones narrower and centred
  const lands = doc.sections.map((s) => sectionOrientation(doc, s) === "landscape");
  const mixed = lands.some(Boolean) && (lands.some((x) => !x) || doc.orientation === "portrait");
  const coverL = doc.orientation === "landscape";
  return (
    <div className={`rp${mixed ? " rp-mix" : ""}`}>
      <style>{REPORT_CSS}</style>
      <div className={`rp-cover ${coverL ? "L" : "P"}`}>
        <div className="rp-cover-body">
          <div className="rp-logo">{clientName}</div>
          <hr className="rp-rule" />
          <h1 className="rp-title">{doc.name}</h1>
          <hr className="rp-rule" />
          <div className="rp-sub">{clientName}<br />{words}</div>
          {c?.brand && (c.brand.name || c.brand.logo) && <div className="rp-prep">{c.brand.logo && <img src={c.brand.logo} alt="" />}{c.brand.name && <span>Prepared by {c.brand.name}</span>}</div>}
        </div>
        <div className="rp-band"><Network /></div>
      </div>
      {doc.sections.map((s, si) => {
        let ki = 0;
        const land = lands[si], c = baseC && { ...baseC, land };
        const items = s.blocks.map((b, bi) => {
          const bp = blockProps?.(s, b, bi), tone = b.type === "key" ? ki++ : undefined;
          return (
            <div key={b.id} className={`rb-block${selectedId === b.id ? " sel" : ""}${onSelect ? " pick" : ""}${bp?.className ? ` ${bp.className}` : ""}`} style={{ gridColumn: `span ${spanOf(b)}` }}
              onDragOver={bp?.onDragOver} onDrop={bp?.onDrop}
              onClick={onSelect ? (e) => { if (!(e.target as HTMLElement).closest("input,textarea,button,select,a")) onSelect(b); } : undefined}>
              {blockTools?.(s, b, bi)}
              <BlockView b={b} c={c} edit={edit?.(s, b)} tone={tone} />
            </div>
          );
        });
        return (
          <Fragment key={s.id}>
            <div className="rp-break" aria-hidden="true"><span>Page break</span></div>
            <section className={`rp-sec rb-section ${land ? "L" : "P"}`} style={{ "--ph": land ? "70.71cqw" : mixed ? "100cqw" : "141.42cqw" } as React.CSSProperties}>
              <div className="rp-in">
                {sectionTools ? sectionTools(s, si) : <h2 style={doc.look === "management" ? { ...T.h2, color: NAVY, fontWeight: 600, fontSize: 21, borderBottom: `2px solid ${NAVY}` } : T.h2}>{s.title}{doc.look === "management" && words && <span style={{ fontWeight: 400, color: "#6b6f7a", fontSize: 15 }}> · {words}</span>}</h2>}
                <div className="rp-grid">{items}</div>
                {addButtons?.(s)}
                {doc.disclaimer && si === doc.sections.length - 1 && <p className="rp-foot">{doc.disclaimerText}</p>}
              </div>
            </section>
          </Fragment>
        );
      })}
    </div>
  );
}

/** The whole published page: the report, drawn with the figures as they are now, with its own print settings. */
export function publishedHtml(doc: ReportDoc, c: Ctx, clientName: string): string {
  const body = renderToStaticMarkup(<ReportView doc={doc} c={c} clientName={clientName} />);
  const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch] as string));
  const land = doc.orientation === "landscape";
  const wide = land || doc.sections.some((s) => s.orientation === "landscape");
  const css = (t: string) => t.replace(/[\\"]/g, "\\$&").replace(/[<>\n\r]/g, " ");
  const foot = `@bottom-right{content:"Page " counter(page);font:9px Figtree,Arial,sans-serif;color:#9aa4b2;padding-right:12mm}@bottom-left{content:"${css(clientName)} · ${css(doc.name)}";font:9px Figtree,Arial,sans-serif;color:#9aa4b2;padding-left:12mm}`;
  const pages = `@page{size:A4 ${doc.orientation};margin:${land ? "12mm 0 14mm" : "19mm 0"};${foot}}@page pl{size:A4 landscape;margin:12mm 0 14mm;${foot}}@page pp{size:A4 portrait;margin:19mm 0;${foot}}@page cover{size:A4 ${doc.orientation};margin:0;@bottom-right{content:none}@bottom-left{content:none}}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(doc.name)} – ${esc(clientName)}</title>
<style>${pages}body{margin:0;background:#e9ecef}main{max-width:${wide ? 1123 : 794}px;margin:0 auto;padding-bottom:40px}.noprint{max-width:${wide ? 1123 : 794}px;margin:12px auto;text-align:right;font-family:system-ui,sans-serif}button{font:inherit;padding:6px 14px}@media print{body{background:#fff}main{max-width:none}.noprint{display:none}html body .rp .rp-cover{aspect-ratio:auto;width:100%!important;margin:0!important;height:${land ? 209 : 296}mm;box-shadow:none}html body .rp .rp-sec{break-before:page;padding:0;border:0;aspect-ratio:auto;width:100%!important;margin:0!important;box-shadow:none;background:none}html body .rp .rp-sec::after,html body .rp .rp-break{display:none}html body .rp .rp-sec.L .rp-in{padding:0 12mm}html body .rp .rp-sec.P .rp-in{padding:0 19mm}.rb-block,.rp-keys{break-inside:avoid}}</style></head>
<body><div class="noprint"><button onclick="window.print()">Print or save as PDF</button></div><main>${body}</main></body></html>`;
}

/** A report page shown inside the planner with a Print button of ours: the page's own button can't run here (the site's security
 *  policy blocks scripts that aren't the planner's own), and a blob window would inherit that. Print offers "Save as PDF". */
function PrintViewer({ name, url, onClose }: { name: string; url: string; onClose: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  return (
    <div role="dialog" aria-modal="true" aria-label={name} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", flexDirection: "column", zIndex: 50, padding: 16, gap: 8 }}>
      <div className="row-wrap" style={{ gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
        <strong style={{ color: "#fff", marginRight: "auto" }}>{name}</strong>
        <button type="button" className="btn primary" onClick={() => { frame.current?.contentWindow?.focus(); frame.current?.contentWindow?.print(); }}>Print or save as PDF</button>
        <button type="button" className="btn" onClick={onClose}>Close</button>
      </div>
      <iframe ref={frame} title={name} src={url} style={{ flex: 1, width: "100%", border: 0, background: "#fff", borderRadius: 6 }} />
    </div>
  );
}
const hideButton = (html: string) => html.replace('<div class="noprint">', '<div class="noprint" style="display:none">');

// ------------------------------------------------------------------ the list and the editor

export function ReportsScreen({ clientKey, clientName, yearEnd, tenant, id }: Props) {
  const { data: app, saveSetting, remove, store } = useData();
  const r = useReportData(clientKey, tenant);
  const ag = useAgedData(clientKey, tenant);
  const tried = useRef("");
  useEffect(() => {
    if (r.checked && !r.data && !r.busy && !r.error && tried.current !== clientKey) { tried.current = clientKey; void r.refresh(); }
  }, [r.checked, r.data, r.busy, r.error, clientKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Each report is saved as a setting of its own (a setting holds about 60,000 characters, which a few full reports would use up).
  // Reports saved the old way, all together under reports.<client>, are moved across the first time anything is saved.
  const legacyKey = `reports.${clientKey}`, prefix = `report.${clientKey}.`;
  const own = app.settings.filter((s) => String(s.Key).startsWith(prefix)).map((s) => readSetting<ReportDoc>(app.settings, String(s.Key))).filter((x): x is ReportDoc => !!x && !!x.id);
  const old = (readSetting<ReportDoc[]>(app.settings, legacyKey) || []).filter((x) => !own.some((o) => o.id === x.id));
  const list = [...own, ...old];
  const listRef = useRef(list); listRef.current = list;
  const save = async (next: ReportDoc[]) => {
    const now = listRef.current;
    for (const d of next) {
      const have = own.find((o) => o.id === d.id);
      if (!have || JSON.stringify(have) !== JSON.stringify(d)) await saveSetting(prefix + d.id, d);
    }
    for (const gone of now.filter((x) => !next.some((n) => n.id === x.id))) {
      const row = app.settings.find((s) => s.Key === prefix + gone.id);
      if (row) await remove("Settings", row);
      if (gone.file) { try { await store.graph.delete(gone.file); } catch { /* the published copy was already gone */ } }
    }
    if (readSetting<ReportDoc[]>(app.settings, legacyKey)?.length) await saveSetting(legacyKey, []);
  };
  // Templates are kept for the whole practice, one setting each.
  const tprefix = "report.template.";
  const tpls = app.settings.filter((s) => String(s.Key).startsWith(tprefix)).map((s) => readSetting<ReportDoc>(app.settings, String(s.Key))).filter((x): x is ReportDoc => !!x && !!x.id);
  const tplsRef = useRef(tpls); tplsRef.current = tpls;
  const saveTpls = async (next: ReportDoc[]) => {
    for (const t of next) {
      const have = tplsRef.current.find((o) => o.id === t.id);
      if (!have || JSON.stringify(have) !== JSON.stringify(t)) await saveSetting(tprefix + t.id, t);
    }
    for (const gone of tplsRef.current.filter((x) => !next.some((n) => n.id === x.id))) {
      const row = app.settings.find((s) => s.Key === tprefix + gone.id);
      if (row) await remove("Settings", row);
    }
  };
  const kpi = readSetting<KpiSettings>(app.settings, `reporting.kpi.${clientKey}`) || {};
  const endMonth = endMonthOf(yearEnd);
  const d = r.data;
  const doc = id ? list.find((x) => x.id === id) || tpls.find((x) => x.id === id) : undefined;

  if (id && !doc) return <div className="alert amber"><strong>That report isn't there</strong><span><a href={href("reporting", clientKey, "reports")}>Back to the reports</a></span></div>;
  if (doc) return <Editor key={doc.id} doc={doc} d={d} busy={r.busy} clientKey={clientKey} clientName={clientName} endMonth={endMonth} kpi={kpi} aged={ag.data} listRef={doc.template ? tplsRef : listRef} save={doc.template ? saveTpls : save} store={store} refresh={r.refresh} />;
  return <List list={list} tpls={tpls} saveTpls={saveTpls} d={d} busy={r.busy} error={r.error} clientKey={clientKey} clientName={clientName} endMonth={endMonth} kpi={kpi} save={save} store={store} refresh={r.refresh} />;
}

type Common = { d?: ReportData; busy: string; clientKey: string; clientName: string; endMonth: number; kpi: KpiSettings; save: (l: ReportDoc[]) => Promise<void>; store: ReturnType<typeof useData>["store"]; refresh: () => Promise<void> };

function TemplateRows({ tpls, saveTpls, use, go }: { tpls: ReportDoc[]; saveTpls: (l: ReportDoc[]) => Promise<void>; use: (v: string) => void; go: (id: string) => void }) {
  const [confirm, setConfirm] = useState("");
  const now = () => new Date().toISOString();
  const change = (t: ReportDoc, o: Orientation) => saveTpls(tpls.map((x) => (x.id === t.id ? { ...x, orientation: o, updatedAt: now() } : x)));
  return (
    <>
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>A template is a layout to start reports from. Your own can be edited, duplicated and changed between portrait and landscape; a built-in one is customised into a copy of your own first.</p>
      {TEMPLATES.map((t) => (
        <div key={t.name} className="card pad row-wrap" style={{ gap: 12, alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ flex: "1 1 260px", minWidth: 0 }}><strong>{t.name}</strong> <span className="muted" style={{ fontSize: 12 }}>· built in · {t.orientation}</span><div className="muted" style={{ fontSize: 12 }}>{t.note}</div></div>
          <div className="row-wrap" style={{ gap: 8 }}>
            <button type="button" className="btn small primary" onClick={() => use(`b:${t.name}`)}>Use</button>
            <button type="button" className="btn small" onClick={() => { const c = customise(t, now()); void saveTpls([...tpls, c]).then(() => go(c.id)); }}>Customise</button>
          </div>
        </div>
      ))}
      {tpls.map((t) => (
        <div key={t.id} className="card pad row-wrap" style={{ gap: 12, alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ flex: "1 1 260px", minWidth: 0 }}><strong>{t.name}</strong> <span className="muted" style={{ fontSize: 12 }}>· {t.sections.length} {t.sections.length === 1 ? "page" : "pages"}</span>{t.note && <div className="muted" style={{ fontSize: 12 }}>{t.note}</div>}</div>
          <div className="row-wrap" style={{ gap: 8, alignItems: "center" }}>
            <Seg value={t.orientation} set={(o) => void change(t, o)} opts={[["portrait", "Portrait"], ["landscape", "Landscape"]]} label={`Orientation of ${t.name}`} />
            <button type="button" className="btn small primary" onClick={() => use(`c:${t.id}`)}>Use</button>
            <button type="button" className="btn small" onClick={() => go(t.id)}>Edit</button>
            <button type="button" className="btn small" onClick={() => void saveTpls([...tpls, copyTemplate(t, now())])}>Duplicate</button>
            {confirm === t.id
              ? <><button type="button" className="btn small danger" onClick={() => { setConfirm(""); void saveTpls(tpls.filter((x) => x.id !== t.id)); }}>Delete it</button><button type="button" className="btn small" onClick={() => setConfirm("")}>Keep</button></>
              : <button type="button" className="btn small" onClick={() => setConfirm(t.id)}>Delete</button>}
          </div>
        </div>
      ))}
    </>
  );
}

function List({ list, tpls, saveTpls, d, busy, error, clientKey, clientName, save, store }: Common & { list: ReportDoc[]; tpls: ReportDoc[]; saveTpls: (l: ReportDoc[]) => Promise<void>; error?: string }) {
  const [tab, setTab] = useState<"draft" | "published" | "templates">("draft");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState(""), [kind, setKind] = useState<PeriodKind>("month"), [anchor, setAnchor] = useState(""), [orient, setOrient] = useState<Orientation>("portrait");
  const [confirm, setConfirm] = useState(""), [note, setNote] = useState("");
  const [tpl, setTpl] = useState("");
  // `tpl` is "b:<name>" for a built-in template and "c:<id>" for one the practice has saved
  const builtIn = tpl.startsWith("b:") ? TEMPLATES.find((t) => t.name === tpl.slice(2)) : undefined;
  const saved = tpl.startsWith("c:") ? tpls.find((t) => t.id === tpl.slice(2)) : undefined;
  const template = builtIn || saved;
  const tplName = builtIn?.name || saved?.name || "", tplNote = builtIn?.note || saved?.note || "";
  const pickTpl = (v: string) => {
    setTpl(v);
    const t = v.startsWith("b:") ? TEMPLATES.find((x) => x.name === v.slice(2)) : tpls.find((x) => x.id === v.slice(2));
    if (t) { setKind(t.kind); setOrient(t.orientation); }
  };
  const months = d?.months || [];
  const at = anchor && months.includes(anchor) ? anchor : months[months.length - 1] || "";
  const shown = list.filter((x) => x.status === tab).sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  const create = async () => {
    const now = new Date().toISOString();
    const doc = builtIn ? { ...fromTemplate(builtIn, name.trim(), at, now), orientation: orient } : saved ? fromSaved(saved, name.trim(), at, orient, now) : newReport(name, kind, at, orient, now);
    await save([...list, doc]);
    window.location.hash = href("reporting", clientKey, "reports", doc.id);
  };
  // The published page is shown inside the planner, with a Print button of ours: the page's own button can't run here (the site's security
  // policy blocks scripts that aren't the planner's own), and a blob window would inherit that.
  const [viewing, setViewing] = useState<{ name: string; url: string } | undefined>();
  const close = () => { if (viewing) URL.revokeObjectURL(viewing.url); setViewing(undefined); };
  const open = async (x: ReportDoc) => {
    try {
      const bytes = await store.graph.download(fileOf(clientKey, x.id));
      const html = hideButton(new TextDecoder().decode(bytes));
      setViewing({ name: x.name, url: URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" })) });
    } catch { setNote("The published copy couldn't be opened from OneDrive."); }
  };
  return (
    <section className="stack" style={{ gap: 12, minWidth: 0 }} aria-label="Reports">
      <div className="row-wrap" style={{ gap: 10, alignItems: "center", justifyContent: "space-between" }}>
        <div className="row-wrap" style={{ gap: 10, alignItems: "center" }}><h2 className="sec-h">Reports</h2><span className="muted" style={{ fontSize: 13 }}>{clientName}</span></div>
        <button type="button" className="btn primary" disabled={!d} onClick={() => setCreating(true)}>Create report</button>
      </div>
      {error && <div className="alert red"><strong>Couldn't read the figures</strong><span>{error}</span></div>}
      {busy && <p className="muted" style={{ margin: 0, fontSize: 12 }} aria-live="polite">{busy}</p>}
      {note && <div className="alert amber"><span>{note}</span></div>}
      <Seg value={tab} set={setTab} opts={[["draft", `Drafts (${list.filter((x) => x.status === "draft").length})`], ["published", `Published (${list.filter((x) => x.status === "published").length})`], ["templates", `Templates (${TEMPLATES.length + tpls.length})`]]} label="Reports" />
      {tab === "templates" && <TemplateRows tpls={tpls} saveTpls={saveTpls} use={(v) => { pickTpl(v); setCreating(true); }} go={(id) => { window.location.hash = href("reporting", clientKey, "reports", id); }} />}
      {tab !== "templates" && !shown.length && <div className="card pad"><p style={{ margin: 0 }}>{tab === "draft" ? "No draft reports. Create one and build it from sections of text, charts and tables." : "Nothing published yet. Publish a draft to keep a finished copy you can open, print or save as a PDF."}</p></div>}
      {tab !== "templates" && shown.map((x) => (
        <div key={x.id} className="card pad row-wrap" style={{ gap: 12, alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <strong>{x.name}</strong>
            <div className="muted" style={{ fontSize: 12 }}>{periodWords(x.kind, x.anchor || months[months.length - 1] || "")} · {x.orientation} · {x.status === "published" ? `published ${when(x.publishedAt)}` : `edited ${when(x.updatedAt)}`}</div>
          </div>
          <div className="row-wrap" style={{ gap: 8 }}>
            {x.status === "draft"
              ? <a className="btn small" href={href("reporting", clientKey, "reports", x.id)}>Edit</a>
              : <button type="button" className="btn small" onClick={() => void open(x)}>View</button>}
            <button type="button" className="btn small" title="The same layout, one period on, with the commentary cleared" onClick={() => void save([...list, nextCopy(x, new Date().toISOString(), months[months.length - 1] || "")])}>Next period's copy</button>
            <button type="button" className="btn small" onClick={() => void save([...list, copyReport(x, new Date().toISOString())])}>{x.status === "published" ? "Make a draft copy" : "Duplicate"}</button>
            <button type="button" className="btn small" title="Keep this layout, with the commentary cleared, to start other reports from" onClick={() => void saveTpls([...tpls, asTemplate(x, new Date().toISOString())]).then(() => { setTab("templates"); setNote(`Saved “${x.name} template” under Templates.`); })}>Save as template</button>
            {confirm === x.id
              ? <><button type="button" className="btn small danger" onClick={() => { setConfirm(""); void save(list.filter((y) => y.id !== x.id)); }}>Delete it</button><button type="button" className="btn small" onClick={() => setConfirm("")}>Keep</button></>
              : <button type="button" className="btn small" onClick={() => setConfirm(x.id)}>Delete</button>}
          </div>
        </div>
      ))}
      {viewing && <PrintViewer name={viewing.name} url={viewing.url} onClose={close} />}
      {creating && (
        <div role="dialog" aria-modal="true" aria-label="Create report" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "grid", placeItems: "center", zIndex: 50 }}>
          <div className="card pad stack" style={{ gap: 12, width: 420, maxWidth: "92vw", background: "var(--card, #fff)" }}>
            <h3 style={{ margin: 0 }}>Create report</h3>
            <label className="stack" style={{ gap: 4, fontSize: 13 }}>Start from
              <select aria-label="Start from" value={tpl} onChange={(e) => pickTpl(e.target.value)}>
                <option value="">A blank report</option>
                {TEMPLATES.map((t) => <option key={t.name} value={`b:${t.name}`}>Template: {t.name}</option>)}
                {tpls.map((t) => <option key={t.id} value={`c:${t.id}`}>Template: {t.name}</option>)}
              </select>
              {template && tplNote && <span className="muted" style={{ fontSize: 12 }}>{tplNote.replace(/\.$/, "")}.</span>}
            </label>
            <input aria-label="Report name" autoFocus placeholder={template ? tplName : "Report name"} value={name} onChange={(e) => setName(e.target.value)} />
            <div className="row-wrap" style={{ gap: 8, alignItems: "center" }}>
              <span className="muted" style={{ fontSize: 13 }}>Reporting period: for the</span>
              {template ? <strong style={{ fontSize: 13 }}>{kind}</strong> : <Seg value={kind} set={setKind} opts={[["month", "Month"], ["quarter", "Quarter"], ["year", "Year"]]} label="Period" />}
              <span className="muted" style={{ fontSize: 13 }}>of</span>
              <select aria-label="Month" value={at} onChange={(e) => setAnchor(e.target.value)}>{[...months].reverse().map((m) => <option key={m} value={m}>{monthLong(m)}</option>)}</select>
            </div>
            <div className="row-wrap" style={{ gap: 8, alignItems: "center" }}><span className="muted" style={{ fontSize: 13 }}>Orientation</span><Seg value={orient} set={setOrient} opts={[["portrait", "Portrait"], ["landscape", "Landscape"]]} label="Orientation" /></div>
            <div className="row-wrap" style={{ gap: 8, justifyContent: "flex-end" }}><button type="button" className="btn" onClick={() => setCreating(false)}>Cancel</button><button type="button" className="btn primary" onClick={() => void create()}>Create</button></div>
          </div>
        </div>
      )}
    </section>
  );
}

type PanelId = "outline" | "text" | "charts" | "tables" | "layouts" | "settings";
const PANELS: [PanelId, string][] = [["outline", "Outline"], ["text", "Text"], ["charts", "Charts"], ["tables", "Tables & financials"], ["layouts", "Layouts"], ["settings", "Report settings"]];

export function Editor({ doc: initial, d, busy, clientKey, clientName, endMonth, kpi, aged, listRef, save, store, refresh }: Common & { doc: ReportDoc; aged?: AgedData; listRef: { current: ReportDoc[] } }) {
  const [doc, setDoc] = useState<ReportDoc>(initial);
  const [panel, setPanel] = useState<PanelId>("outline");
  const [target, setTarget] = useState(initial.sections[initial.sections.length - 1]?.id || "");
  const [state, setState] = useState<"" | "saving" | "saved">("");
  const [publishing, setPublishing] = useState(""), [problem, setProblem] = useState("");
  const [editId, setEditId] = useState("");
  const [draft, setDraft] = useState<Block | undefined>();
  const [over, setOver] = useState<{ id: string; after: boolean; horiz: boolean } | undefined>();
  const [dragging, setDragging] = useState(false);
  const dragId = useRef("");
  const dirty = useRef(false), docRef = useRef(doc); docRef.current = doc;
  const persist = async (x: ReportDoc) => { dirty.current = false; setState("saving"); try { await save(listRef.current.map((y) => (y.id === x.id ? x : y))); setState("saved"); } catch { setState(""); setProblem("The change couldn't be saved. Try again."); } };
  const update = (fn: (x: ReportDoc) => ReportDoc) => { dirty.current = true; setState(""); setDoc((x) => ({ ...fn(x), updatedAt: new Date().toISOString() })); };
  useEffect(() => { if (!dirty.current) return; const t = setTimeout(() => void persist(doc), 900); return () => clearTimeout(t); }, [doc]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (dirty.current) void persist(docRef.current); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const months = d?.months || [];
  const anchor = anchorFor(doc, months);
  const { data: app } = useData();
  const brand = useMemo(() => { const b = brandOf(readBranding(app.settings)); return b ? { name: b.tradingName || b.practiceName, logo: b.logo } : undefined; }, [app.settings]);
  const c: Ctx | undefined = d && anchor ? { d, kind: doc.kind, anchor, endMonth, kpi, aged, palette: doc.palette, brand } : undefined;
  const shown: ReportDoc = draft ? { ...doc, sections: doc.sections.map((s) => ({ ...s, blocks: s.blocks.map((x) => (x.id === draft.id ? draft : x)) })) } : doc;
  const EDITABLE = ["key", "observation", "top", "chart", "table", "kpis", "cashflow", "aged"];
  const WIDTHS: [number, string][] = [[3, "¼"], [4, "⅓"], [6, "½"], [8, "⅔"], [9, "¾"], [12, "Full"]];
  const sec = (id: string, fn: (s: Section) => Section) => update((x) => ({ ...x, sections: x.sections.map((s) => (s.id === id ? fn(s) : s)) }));
  const add = (blocks: Block[]) => {
    const id = doc.sections.some((s) => s.id === target) ? target : doc.sections[doc.sections.length - 1]?.id;
    if (id) sec(id, (s) => ({ ...s, blocks: [...s.blocks, ...blocks] }));
  };
  const patchBlock = (secId: string, id: string, patch: Partial<Block>) => sec(secId, (x) => ({ ...x, blocks: x.blocks.map((y) => (y.id === id ? ({ ...y, ...patch } as Block) : y)) }));
  /** Move a block next to another (before or after it), or to the end of a section, in this section or another. */
  const moveBlock = (id: string, toSec: string, beside: string | null, after: boolean) => update((x) => {
    const mover = x.sections.flatMap((s) => s.blocks).find((y) => y.id === id);
    if (!mover) return x;
    const stripped = x.sections.map((s) => ({ ...s, blocks: s.blocks.filter((y) => y.id !== id) }));
    return { ...x, sections: stripped.map((s) => {
      if (s.id !== toSec) return s;
      const at = beside ? s.blocks.findIndex((y) => y.id === beside) : -1;
      const i = at < 0 ? s.blocks.length : at + (after ? 1 : 0);
      return { ...s, blocks: [...s.blocks.slice(0, i), mover, ...s.blocks.slice(i)] };
    }) };
  });
  const endDrag = () => { dragId.current = ""; setDragging(false); setOver(undefined); };
  /** Drag an edge of a block: the right edge changes how many of the 12 columns it takes, the bottom edge of a chart its height. */
  const startResize = (e: React.PointerEvent, secId: string, b: Block, axis: "w" | "h") => {
    e.preventDefault(); e.stopPropagation();
    const el = (e.currentTarget as HTMLElement).closest(".rb-block") as HTMLElement, grid = el.parentElement as HTMLElement;
    const gw = grid.getBoundingClientRect().width, unit = (gw * 1.03) / 12, shown = el.getBoundingClientRect().width;
    const x0 = e.clientX, y0 = e.clientY, w0 = spanOf(b), h0 = chartH(b);
    const move = (ev: PointerEvent) => {
      if (axis === "w") patchBlock(secId, b.id, { w: Math.max(2, Math.min(12, Math.round(w0 + (ev.clientX - x0) / unit))) });
      else patchBlock(secId, b.id, { h: Math.max(160, Math.min(700, Math.round(h0 + (ev.clientY - y0) * (760 / shown)))) });
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  const addSection = () => { const s: Section = { id: uid("s"), title: "New section", blocks: [] }; update((x) => ({ ...x, sections: [...x.sections, s] })); setTarget(s.id); };
  const editing = doc.sections.flatMap((s) => s.blocks.map((b) => ({ s, b }))).find((x) => x.b.id === editId);
  const targetTitle = doc.sections.find((s) => s.id === target)?.title;

  // The page is drawn at its printed width (A4 at 96 dpi) and scaled down to fit the window as a whole, so text sits as it will in the PDF.
  const canvas = useRef<HTMLElement>(null);
  const [avail, setAvail] = useState(0);
  useEffect(() => {
    const el = canvas.current; if (!el) return;
    const measure = () => { const cs = getComputedStyle(el); setAvail(el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)); };
    measure();
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [printing, setPrinting] = useState<string>("");
  const openPrint = () => { if (!c) return; if (printing) URL.revokeObjectURL(printing); setPrinting(URL.createObjectURL(new Blob([hideButton(publishedHtml(shown, c, clientName))], { type: "text/html;charset=utf-8" }))); };
  const closePrint = () => { URL.revokeObjectURL(printing); setPrinting(""); };
  const publish = async () => {
    if (!c) return;
    setPublishing("Publishing…"); setProblem("");
    try {
      const now = new Date().toISOString();
      const done: ReportDoc = { ...doc, status: "published", publishedAt: now, updatedAt: now, file: fileOf(clientKey, doc.id) };
      await store.graph.put(`${fileOf(clientKey, doc.id)}:/content`, new TextEncoder().encode(publishedHtml(done, c, clientName)), "text/html");
      dirty.current = false;
      await save(listRef.current.map((y) => (y.id === done.id ? done : y)));
      window.location.hash = href("reporting", clientKey, "reports");
    } catch { setPublishing(""); setProblem("The report couldn't be published. Nothing has changed; try again."); }
  };

  const picks = (items: Pick[], group: "text" | "charts" | "tables") => (
    <div className="rb-list">
      <p className="rb-hint">Adds to “{targetTitle || "the last section"}”.</p>
      {items.map((p) => <button key={p.name} type="button" className="rb-pick" onClick={() => add([p.make()])}><Thumb name={p.name} group={group} /><span className="rb-pick-t"><strong>{p.name}</strong><span>{p.note}</span></span></button>)}
    </div>
  );
  const ICO: Record<string, ReactNode> = {
    up: <path d="M3.5 9.5 8 5l4.5 4.5" />, down: <path d="M3.5 6.5 8 11l4.5-4.5" />,
    del: <path d="M3.5 4.5h9M6.5 4.5V3h3v1.5M5 4.5l.5 8h5l.5-8" />, edit: <path d="M3 13l.6-2.6 7-7 2 2-7 7L3 13Z" />,
  };
  const mini = (label: string, onClick: () => void, off = false) => {
    const k = label.startsWith("Move up") ? "up" : label.startsWith("Move down") ? "down" : "del";
    return <button type="button" className="rb-ico" aria-label={label} title={label} disabled={off} onClick={onClick}><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICO[k]}</svg></button>;
  };
  const mg = doc.look === "management";
  const width = doc.orientation === "landscape" || doc.sections.some((x) => x.orientation === "landscape") ? 1123 : 794;
  const RAIL: [PanelId, string, IconName][] = [["outline", "Outline", "list"], ["text", "Text", "letter"], ["charts", "Charts", "chart"], ["tables", "Tables", "calc"], ["layouts", "Layouts", "layout"], ["settings", "Settings", "cog"]];
  const panelTitle = PANELS.find(([k]) => k === panel)?.[1];
  const words = periodWords(doc.kind, anchor);

  return (
    <div className="rb" aria-label="Report editor">
      <header className="rb-bar">
        <a className="rb-back" href={href("reporting", clientKey, "reports")}><Icon name="left" size={14} /> Reports</a>
        <span className="rb-sep" aria-hidden="true" />
        <input className="rb-title" aria-label="Report name" value={doc.name} onChange={(e) => update((x) => ({ ...x, name: e.target.value }))} />
        <span className="rb-state" aria-live="polite">{state === "saving" ? "Saving…" : state === "saved" ? "Saved" : dirty.current ? "Unsaved changes" : "Draft"}</span>
        <div className="rb-actions">
          <span className="rb-meta">{doc.template ? "Template" : `${clientName}${words ? ` · ${words}` : ""}`} · {doc.orientation}</span>
          {!d && <button type="button" className="btn small" disabled={!!busy} onClick={() => void refresh()}>Read from Xero</button>}
          <button type="button" className="btn small" disabled={!c} title="See the report as it prints, and save it as a PDF, without publishing" onClick={() => c && openPrint()}>Print / PDF</button>
          {!doc.template && <button type="button" className="btn primary small" disabled={!c || !!publishing} onClick={() => void publish()}>{publishing || "Publish"}</button>}
        </div>
      </header>
      {(problem || !d) && <div className="rb-notes">
        {problem && <div className="alert red"><span>{problem}</span></div>}
        {!d && <div className="alert amber"><span>{busy || "The figures haven't been read from Xero yet, so charts and tables can't be drawn."}</span></div>}
      </div>}
      {printing && <PrintViewer name={doc.name} url={printing} onClose={closePrint} />}
      <div className="rb-body">
        <nav className="rb-rail" aria-label="Add to the report">
          {RAIL.map(([k, l, ic]) => (
            <button key={k} type="button" className={`rb-tab${panel === k && !editing ? " on" : ""}`} aria-pressed={panel === k && !editing} onClick={() => { setEditId(""); setPanel(k); }}>
              <Icon name={ic} size={18} /><span>{l}</span>
            </button>
          ))}
        </nav>
        <aside className="rb-panel">
          {editing && <ComponentEditor key={editing.b.id} block={editing.b} c={c} preview={(nb) => (c ? <BlockView b={nb} c={{ ...c, land: sectionOrientation(doc, editing.s) === "landscape" }} /> : null)} onDraft={setDraft} onCancel={() => setEditId("")} onSave={(nb) => { sec(editing.s.id, (x) => ({ ...x, blocks: x.blocks.map((y) => (y.id === nb.id ? nb : y)) })); setEditId(""); }} />}
          {!editing && <h3 className="rb-panel-title">{panelTitle}</h3>}
          {!editing && panel === "outline" && (
            <div className="rb-list">
              {doc.sections.map((s, i) => (
                <div key={s.id} className={`rb-out${s.id === target ? " on" : ""}`}>
                  <button type="button" className="rb-out-name" onClick={() => setTarget(s.id)}>{s.title || "Untitled"}<span>{s.orientation ? `${s.orientation === "landscape" ? "Land" : "Port"} · ` : ""}{s.blocks.length}</span></button>
                  {mini("Move up", () => update((x) => ({ ...x, sections: moveItem(x.sections, i, i - 1) })), i === 0)}{mini("Move down", () => update((x) => ({ ...x, sections: moveItem(x.sections, i, i + 1) })), i === doc.sections.length - 1)}
                </div>
              ))}
              <button type="button" className="btn small" style={{ alignSelf: "flex-start", marginTop: 8 }} onClick={addSection}>New section</button>
            </div>
          )}
          {!editing && panel === "text" && picks(TEXT_BLOCKS, "text")}
          {!editing && panel === "charts" && picks(CHART_BLOCKS, "charts")}
          {!editing && panel === "tables" && picks(TABLE_BLOCKS, "tables")}
          {!editing && panel === "layouts" && (
            <div className="rb-list">
              <p className="rb-hint">A ready-made set of components, added to “{targetTitle || "the last section"}”.</p>
              {LAYOUTS.map((l) => <button key={l.name} type="button" className="rb-pick" onClick={() => add(l.make())}><Thumb name={l.name} group="layouts" /><span className="rb-pick-t"><strong>{l.name}</strong><span>{l.note}</span></span></button>)}
            </div>
          )}
          {!editing && panel === "settings" && (
            <div className="rb-form">
              {doc.template && <label>What it is for<textarea aria-label="What this template is for" rows={3} value={doc.note || ""} onChange={(e) => update((x) => ({ ...x, note: e.target.value }))} /></label>}
              <label>Period<Seg value={doc.kind} set={(k) => update((x) => ({ ...x, kind: k }))} opts={[["month", "Month"], ["quarter", "Quarter"], ["year", "Year"]]} label="Period" /></label>
              <label>Ending in<select aria-label="Month" value={anchor} onChange={(e) => update((x) => ({ ...x, anchor: e.target.value }))}>{[...months].reverse().map((m) => <option key={m} value={m}>{monthLong(m)}</option>)}</select></label>
              <label>Orientation<Seg value={doc.orientation} set={(o) => update((x) => ({ ...x, orientation: o }))} opts={[["portrait", "Portrait"], ["landscape", "Landscape"]]} label="Orientation" /></label>
              <div className="rb-colours">
                <span>Colours</span>
                <div className="rb-presets">{PALETTES.map((p) => <button key={p.name} type="button" className={`rb-preset${(doc.palette || PALETTES[0].colors).join() === p.colors.join() ? " on" : ""}`} title={p.name} aria-label={p.name} onClick={() => update((x) => ({ ...x, palette: p.name === PALETTES[0].name ? undefined : p.colors }))}>{p.colors.slice(0, 4).map((k) => <i key={k} style={{ background: k }} />)}</button>)}</div>
                {(doc.palette || LINE).slice(0, 6).map((k, i) => <Swatch key={i} label={`Colour ${i + 1}`} value={doc.palette?.[i]} fallback={k} set={(v) => update((x) => { const base = [...(x.palette || LINE)]; base[i] = v || LINE[i]; return { ...x, palette: base.join() === LINE.join() ? undefined : base }; })} />)}
              </div>
              <label className="rb-check"><input type="checkbox" checked={doc.disclaimer} onChange={(e) => update((x) => ({ ...x, disclaimer: e.target.checked }))} /> Include a disclaimer at the end</label>
              {doc.disclaimer && <textarea aria-label="Disclaimer" rows={6} value={doc.disclaimerText} onChange={(e) => update((x) => ({ ...x, disclaimerText: e.target.value }))} />}
            </div>
          )}
        </aside>
        <main className="rb-canvas" ref={canvas}>
          <div className={`rb-page${dragging ? " rb-dragging" : ""}`} style={{ width, maxWidth: "none", ...(avail > 0 && avail < width ? { zoom: avail / width } : {}) }}>
            <ReportView
              doc={shown} c={c} clientName={clientName} selectedId={editId} onSelect={(b) => { if (EDITABLE.includes(b.type)) setEditId(b.id); }}
              edit={(s, b) => ({ change: (nb) => sec(s.id, (x) => ({ ...x, blocks: x.blocks.map((y) => (y.id === b.id ? nb : y)) })) })}
              sectionTools={(s, i) => (
                <div className={`rb-sechead${s.id === target ? " on" : ""}`} style={{ marginBottom: 24, paddingBottom: 7, borderBottom: mg ? `2px solid ${NAVY}` : "1px solid #8a8d94" }}>
                  <input aria-label="Section title" value={s.title} style={{ fontSize: mg ? 21 : 24, fontWeight: mg ? 600 : 500, letterSpacing: -0.25, color: mg ? NAVY : "#111", flex: mg && words ? "0 1 auto" : 1, width: mg && words ? `${Math.max(4, Math.round(s.title.length * 0.75) + 1)}ch` : undefined }} onFocus={() => setTarget(s.id)} onChange={(e) => sec(s.id, (x) => ({ ...x, title: e.target.value }))} />
                  {mg && words && <span style={{ fontWeight: 400, color: "#6b6f7a", fontSize: 15, marginRight: "auto" }}> · {words}</span>}
                  <span className="rb-tools">
                    <select className="rb-w" aria-label="Page orientation" title="Page orientation (this page only)" value={sectionOrientation(doc, s)} onChange={(e) => sec(s.id, (x) => ({ ...x, orientation: e.target.value === doc.orientation ? undefined : (e.target.value as Orientation) }))}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select>
                    {mini("Move up section", () => update((x) => ({ ...x, sections: moveItem(x.sections, i, i - 1) })), i === 0)}{mini("Move down section", () => update((x) => ({ ...x, sections: moveItem(x.sections, i, i + 1) })), i === doc.sections.length - 1)}
                    {doc.sections.length > 1 && mini("Delete section", () => update((x) => ({ ...x, sections: x.sections.filter((y) => y.id !== s.id) })))}
                  </span>
                </div>
              )}
              blockTools={(s, b, i) => (
                <>
                  <div className="rb-tools rb-blocktools">
                    <select className="rb-w" aria-label="Width" title="Width" value={spanOf(b)} onChange={(e) => patchBlock(s.id, b.id, { w: Number(e.target.value) })}>
                      {([[3, "¼"], [4, "⅓"], [6, "½"], [8, "⅔"], [9, "¾"], [12, "Full"]] as [number, string][]).concat(WIDTHS.some(([n]) => n === spanOf(b)) ? [] : [[spanOf(b), `${spanOf(b)}/12`]]).map(([n, l]) => <option key={n} value={n}>{l}</option>)}
                    </select>
                    {EDITABLE.includes(b.type) && <button type="button" className="rb-ico wide" aria-label="Edit component" title="Edit component" onClick={() => setEditId(b.id)}><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICO.edit}</svg>Edit</button>}
                    {mini("Move up", () => sec(s.id, (x) => ({ ...x, blocks: moveItem(x.blocks, i, i - 1) })), i === 0)}{mini("Move down", () => sec(s.id, (x) => ({ ...x, blocks: moveItem(x.blocks, i, i + 1) })), i === s.blocks.length - 1)}{mini("Delete", () => sec(s.id, (x) => ({ ...x, blocks: x.blocks.filter((y) => y.id !== b.id) })))}
                  </div>
                  <button type="button" className="rb-grip" draggable aria-label="Drag to move" title="Drag to move this component"
                    onDragStart={(e) => { const el = (e.currentTarget as HTMLElement).closest(".rb-block") as HTMLElement; e.dataTransfer.setData("text/plain", b.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setDragImage(el, 16, 16); dragId.current = b.id; setTimeout(() => setDragging(true), 0); }}
                    onDragEnd={endDrag}>
                    <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor" aria-hidden="true">{[3, 8, 13].map((y) => <g key={y}><circle cx="3" cy={y} r="1.3" /><circle cx="9" cy={y} r="1.3" /></g>)}</svg>
                  </button>
                  {spanOf(b) < 12 || b.type !== "line" ? <span className="rb-rz rb-rz-r" role="separator" aria-label="Resize width" title="Drag to change the width" onPointerDown={(e) => startResize(e, s.id, b, "w")} /> : null}
                  {b.type === "chart" && <span className="rb-rz rb-rz-b" role="separator" aria-label="Resize height" title="Drag to change the height" onPointerDown={(e) => startResize(e, s.id, b, "h")} />}
                </>
              )}
              blockProps={(s, b) => ({
                className: over?.id === b.id ? `${over.after ? "drop-after" : "drop-before"}${over.horiz ? " h" : ""}` : "",
                onDragOver: (e) => {
                  if (!dragId.current || dragId.current === b.id) return;
                  e.preventDefault(); e.dataTransfer.dropEffect = "move";
                  const r = e.currentTarget.getBoundingClientRect(), horiz = spanOf(b) < 12;
                  const after = horiz ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2;
                  if (over?.id !== b.id || over.after !== after) setOver({ id: b.id, after, horiz });
                },
                onDrop: (e) => { e.preventDefault(); if (dragId.current && dragId.current !== b.id) moveBlock(dragId.current, s.id, b.id, over?.after ?? false); endDrag(); },
              })}
              addButtons={(s) => (
                <div className="rb-add" onDragOver={(e) => { if (dragId.current) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } }} onDrop={(e) => { e.preventDefault(); if (dragId.current) moveBlock(dragId.current, s.id, null, false); endDrag(); }}>
                  <span>Add</span>
                  {([["Text", "text"], ["Charts", "charts"], ["Tables", "tables"], ["Layout", "layouts"]] as [string, PanelId][]).map(([l, pn]) => <button key={l} type="button" onClick={() => { setTarget(s.id); setEditId(""); setPanel(pn); }}>{l}</button>)}
                </div>
              )}
            />
            <div className="rb-end"><button type="button" className="btn small" onClick={addSection}>Add a section</button><p>When you're done, choose Publish.</p></div>
          </div>
        </main>
      </div>
    </div>
  );
}
