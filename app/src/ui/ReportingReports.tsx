// Reporting › Reports: build a report for a client from sections of text, charts, tables, KPIs and cash flow, for a month, quarter or year,
// then publish it as a finished page that can be opened or printed to PDF. Drafts save themselves; the figures are the client's monthly figures
// read from Xero, so a draft is always up to date and a published report is a frozen copy.
import { Fragment, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cashFlow, measureById, monthlySeries } from "../lib/analysis";
import { KpiSettings, computeKpis, formatKpi } from "../lib/kpis";
import {
  Block, CHART_BLOCKS, LAYOUTS, Orientation, Pick, ReportDoc, Section, TABLE_BLOCKS, TEXT_BLOCKS, anchorFor, copyReport, moveItem, newReport, periodWords, uid,
} from "../lib/reportBuilder";
import { PeriodKind, REPORT_FOLDER, ReportData, bsStatement, monthLabel, monthLong, periodCols, plStatement } from "../lib/reportData";
import { todayIso } from "../lib/domain";
import { href } from "./bits";
import { readSetting, useData } from "./data";
import { Seg, useReportData } from "./reportingKit";

type Tenant = { tenantId: string; tenantName: string };
type Props = { clientKey: string; clientName: string; yearEnd?: string; tenant: Tenant; id?: string };
const endMonthOf = (yearEnd?: string) => Number((/^(\d{2})-/.exec(yearEnd || "") || [])[1]) || 12;
const gbp = (n?: number) => (n === undefined ? "" : n === 0 ? "–" : n < 0 ? `(${Math.abs(Math.round(n)).toLocaleString("en-GB")})` : Math.round(n).toLocaleString("en-GB"));
const money = (n?: number) => (n === undefined ? "–" : `${n < 0 ? "-" : ""}£${Math.abs(Math.round(n)).toLocaleString("en-GB")}`);
const short = (n: number) => { const a = Math.abs(n), s = n < 0 ? "-" : ""; return a >= 1e6 ? `${s}£${+(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `${s}£${+(a / 1e3).toFixed(1)}K` : `${s}£${Math.round(a)}`; };
const LINE = ["#3b82c4", "#d0342c", "#8fb35a", "#7a3b8f", "#f0a020", "#2b2f33"];
const GREEN = "#6f9a3a";
const fileOf = (clientKey: string, id: string) => `/me/drive/root:/${encodeURIComponent(REPORT_FOLDER)}/${encodeURIComponent(clientKey)}/reports/${encodeURIComponent(id)}.html`;
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

// ------------------------------------------------------------------ drawing the report (used on screen and in the published copy)

type Ctx = { d: ReportData; kind: PeriodKind; anchor: string; endMonth: number; kpi: KpiSettings };
const T: Record<string, React.CSSProperties> = {
  h2: { margin: "28px 0 10px", fontSize: 20, fontWeight: 600, borderBottom: "2px solid #e3e7eb", paddingBottom: 6 },
  cap: { margin: "18px 0 6px", fontSize: 13, fontWeight: 600, letterSpacing: 0.4, textTransform: "uppercase", color: "#4a5560" },
  p: { margin: "8px 0", fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap" },
  th: { textAlign: "right", padding: "6px 8px", fontWeight: 600, whiteSpace: "nowrap", borderBottom: "2px solid #cbd5e1" },
  td: { textAlign: "right", padding: "4px 8px", fontVariantNumeric: "tabular-nums" },
};

function ChartView({ b, c }: { b: Extract<Block, { type: "chart" }>; c: Ctx }) {
  const unit = measureById(b.measures[0])?.unit || "money";
  const ids = b.measures.filter((id) => measureById(id)?.unit === unit && (!measureById(id)?.balance || c.d.bs.length));
  const range = c.d.months.filter((m) => m <= c.anchor).slice(-b.months);
  const series = ids.map((id) => { const s = monthlySeries(c.d, id); return range.map((m) => s.find((x) => x.month === m)?.value); });
  const all = series.flat().filter((v): v is number => v !== undefined);
  if (!all.length || !range.length) return <p style={{ ...T.p, color: "#7a8591" }}>There are no figures for this chart{ids.length < b.measures.length || !c.d.bs.length ? " yet (balance sheet measures need the balance sheet read from Xero)" : ""}.</p>;
  const W = 700, H = 240, L = 54, Tp = 10, B = 26, R = 22;
  const bars = b.bars && ids.length === 1;
  const lo0 = Math.min(...all, bars ? 0 : Infinity), hi0 = Math.max(...all), pad = (hi0 - lo0 || Math.abs(hi0) || 1) * 0.08;
  const lo = bars ? Math.min(0, lo0) : lo0 - pad, hi = hi0 + pad;
  const X = (i: number) => L + (range.length < 2 ? (W - L - R) / 2 : (i / (range.length - 1)) * (W - L - R)), Y = (v: number) => H - B - ((v - lo) / (hi - lo)) * (H - Tp - B);
  const fmt = (v: number) => (unit === "percent" ? `${+v.toFixed(1)}%` : short(v));
  const bw = Math.max(4, ((W - L - R) / range.length) * 0.6);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }} role="img" aria-label={b.title}>
        {[0, 1, 2, 3, 4].map((i) => { const v = lo + ((hi - lo) * i) / 4; return <g key={i}><line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} stroke="#eef1f4" /><text x={L - 6} y={Y(v)} fontSize={9} fill="#6b7785" textAnchor="end" dominantBaseline="middle">{fmt(v)}</text></g>; })}
        {range.map((m, i) => (range.length <= 13 || i % 2 === 0) && <text key={m} x={X(i)} y={H - 8} fontSize={9} fill="#59636e" textAnchor="middle">{monthLabel(m)}</text>)}
        {bars ? series[0].map((v, i) => v !== undefined && <rect key={i} x={X(i) - bw / 2} y={Math.min(Y(v), Y(0))} width={bw} height={Math.abs(Y(v) - Y(0))} fill={v < 0 ? "#d0342c" : "#8fb35a"} />)
          : series.map((s, k) => (
            <g key={ids[k]}>
              <polyline fill="none" stroke={LINE[k % LINE.length]} strokeWidth={2} points={s.map((v, i) => (v === undefined ? "" : `${X(i)},${Y(v)}`)).filter(Boolean).join(" ")} />
              {s.map((v, i) => v !== undefined && <circle key={i} cx={X(i)} cy={Y(v)} r={2.5} fill="#fff" stroke={LINE[k % LINE.length]} strokeWidth={1.5} />)}
            </g>
          ))}
      </svg>
      {ids.length > 1 && <div style={{ display: "flex", gap: 14, fontSize: 12, flexWrap: "wrap" }}>{ids.map((id, k) => <span key={id}><span style={{ color: LINE[k % LINE.length] }}>●</span> {measureById(id)?.label}</span>)}</div>}
    </div>
  );
}

function TableView({ b, c }: { b: Extract<Block, { type: "table" }>; c: Ctx }) {
  const cols = periodCols(c.kind, c.anchor, c.endMonth, b.compare);
  const rows = (b.statement === "pl" ? plStatement(c.d, cols, b.detail) : bsStatement(c.d, cols, b.detail)).filter((r) => r.kind !== "line" || r.code === undefined || r.vals.some((v) => v));
  const showVar = b.compare === "prior" || b.compare === "lastYear";
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
      <thead><tr><th style={{ ...T.th, textAlign: "left" }}>{b.statement === "pl" ? "PROFIT & LOSS" : "BALANCE SHEET"}</th>{cols.map((col) => <th key={col.key} style={T.th}>{col.label}</th>)}{showVar && <><th style={T.th}>Variance £</th><th style={T.th}>Variance %</th></>}</tr></thead>
      <tbody>
        {rows.map((row, i) => {
          const strong = row.kind !== "line";
          const v = showVar && row.vals.length >= 2 && row.vals[0] !== undefined && row.vals[1] !== undefined ? Math.round((row.vals[0] as number) - (row.vals[1] as number)) : undefined;
          const pc = row.vals[1] ? `${Math.round((((row.vals[0] as number) - (row.vals[1] as number)) / Math.abs(row.vals[1] as number)) * 100)}%` : "";
          return (
            <tr key={i} style={{ fontWeight: strong ? 600 : 400, borderTop: row.kind === "total" || row.kind === "sub" ? "1px solid #cbd5e1" : "1px solid #f0f3f6", background: row.kind === "total" ? "#f4f7fb" : undefined }}>
              <td style={{ ...T.td, textAlign: "left", paddingLeft: row.kind === "line" && b.detail === "detailed" ? 20 : 8 }}>{row.label}</td>
              {cols.map((col, j) => <td key={col.key} style={T.td}>{row.kind === "head" ? "" : gbp(row.vals[j])}</td>)}
              {showVar && <><td style={T.td}>{row.kind === "head" ? "" : gbp(v)}</td><td style={T.td}>{row.kind === "head" ? "" : pc}</td></>}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function KpiView({ c }: { c: Ctx }) {
  const res = computeKpis(c.d, c.kind, c.anchor, c.endMonth, c.kpi);
  const on = res.filter((r) => r.onTrack === true).length, off = res.filter((r) => r.onTrack === false).length;
  let last = "";
  return (
    <div>
      <p style={T.p}><strong>{on}</strong> of {on + off} KPIs are on track{off ? `, ${off} off track` : ""}.</p>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead><tr><th style={{ ...T.th, textAlign: "left" }}>KPI</th><th style={T.th}>Result</th><th style={T.th}>Target</th><th style={{ ...T.th, textAlign: "center" }}>Status</th></tr></thead>
        <tbody>
          {res.map((r) => {
            const head = r.def.category !== last; last = r.def.category;
            return (
              <Fragment key={r.def.id}>
                {head && <tr><td colSpan={4} style={{ padding: "8px 8px 2px", fontWeight: 700, fontSize: 11, letterSpacing: 0.5, color: "#4a5560" }}>{r.def.category.toUpperCase()}</td></tr>}
                <tr style={{ borderTop: "1px solid #f0f3f6" }}>
                  <td style={{ ...T.td, textAlign: "left" }}>{r.def.name}</td><td style={T.td}>{r.note && r.value === undefined ? "–" : formatKpi(r.def.unit, r.value)}</td><td style={T.td}>{formatKpi(r.def.unit, r.target)}</td>
                  <td style={{ ...T.td, textAlign: "center", color: r.onTrack === undefined ? "#9aa5b1" : r.onTrack ? "#6f9a3a" : "#d0342c", fontWeight: 700 }}>{r.onTrack === undefined ? "–" : r.onTrack ? "On track" : "Off track"}</td>
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
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
      <tbody>
        {cf.lines.map((l, i) => (
          <Fragment key={l.label}>
            <tr style={{ borderTop: "1px solid #f0f3f6" }}><td style={{ ...T.td, textAlign: "left", color: "#7a8591", width: 44, fontSize: 10 }}>{l.tag}</td><td style={{ ...T.td, textAlign: "left" }}>{l.label}</td><td style={{ ...T.td, color: l.amount < 0 ? "#d0342c" : undefined }}>{gbp(l.amount)}</td></tr>
            {cf.totals.filter((t) => t.after === i).map((t) => <tr key={t.total.label} style={{ background: "#f4f7fb", fontWeight: 700 }}><td colSpan={2} style={{ ...T.td, textAlign: "left" }}>{t.total.label}</td><td style={T.td}>{gbp(t.total.amount)}</td></tr>)}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

type Edit = { change: (b: Block) => void };
function BlockView({ b, c, edit }: { b: Block; c?: Ctx; edit?: Edit }) {
  const field = (value: string, set: (v: string) => void, rows = 4, label = "Text") => (edit
    ? <textarea aria-label={label} value={value} rows={rows} placeholder="Write here…" onChange={(e) => set(e.target.value)} style={{ width: "100%", boxSizing: "border-box", font: "inherit", fontSize: 14, lineHeight: 1.5, padding: 8, border: "1px dashed #cbd5e1", borderRadius: 4, resize: "vertical" }} />
    : <div style={T.p}>{value}</div>);
  if (b.type === "line") return <hr style={{ border: 0, borderTop: "1px solid #cbd5e1", margin: "16px 0" }} />;
  if (b.type === "page") return edit ? <div style={{ borderTop: "2px dashed #b8c2cc", margin: "18px 0", textAlign: "center", fontSize: 11, color: "#7a8591" }}>Page break</div> : <div style={{ pageBreakAfter: "always", breakAfter: "page" }} />;
  if (b.type === "columns") return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>{field(b.left, (v) => edit?.change({ ...b, left: v }), 5, "Left column")}{field(b.right, (v) => edit?.change({ ...b, right: v }), 5, "Right column")}</div>;
  if (b.type === "text") {
    if (b.style === "heading") return edit ? <input aria-label="Heading" value={b.text} placeholder="Heading" onChange={(e) => edit.change({ ...b, text: e.target.value })} style={{ width: "100%", boxSizing: "border-box", fontSize: 16, fontWeight: 600, border: "1px dashed #cbd5e1", padding: 6 }} /> : <h3 style={{ margin: "14px 0 6px", fontSize: 16 }}>{b.text}</h3>;
    const box = b.style === "observation" || b.style === "summary";
    return (
      <div style={box ? { borderLeft: `4px solid ${b.style === "summary" ? "#2b6cb0" : GREEN}`, background: "#f7f9fb", padding: "8px 14px", margin: "10px 0" } : undefined}>
        {box && b.title !== undefined && <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: "#4a5560" }}>{edit ? <input aria-label="Title" value={b.title} onChange={(e) => edit.change({ ...b, title: e.target.value })} style={{ font: "inherit", textTransform: "inherit", border: 0, background: "transparent", width: "100%" }} /> : b.title}</div>}
        {field(b.text, (v) => edit?.change({ ...b, text: v }), box ? 4 : 5)}
      </div>
    );
  }
  const title = (t: string) => (edit
    ? <input aria-label="Block title" value={t} onChange={(e) => edit.change({ ...b, title: e.target.value } as Block)} style={{ ...T.cap, width: "100%", boxSizing: "border-box", border: 0, background: "transparent" }} />
    : <div style={T.cap}>{t}</div>);
  if (!c) return null;
  return (
    <div style={{ margin: "8px 0", pageBreakInside: "avoid", breakInside: "avoid" }}>
      {title(b.title)}
      {b.type === "chart" ? <ChartView b={b} c={c} /> : b.type === "table" ? <TableView b={b} c={c} /> : b.type === "kpis" ? <KpiView c={c} /> : <CashFlowView c={c} />}
    </div>
  );
}

export function ReportView({ doc, c, clientName, edit, sectionTools, blockTools, addButtons }: {
  doc: ReportDoc; c?: Ctx; clientName: string; edit?: (s: Section, b: Block) => Edit;
  sectionTools?: (s: Section, i: number) => ReactNode; blockTools?: (s: Section, b: Block, i: number) => ReactNode; addButtons?: (s: Section) => ReactNode;
}) {
  const words = periodWords(doc.kind, c?.anchor || doc.anchor);
  return (
    <div style={{ fontFamily: "system-ui, -apple-system, 'Segoe UI', Arial, sans-serif", color: "#1f2a37" }}>
      <div style={{ textAlign: "center", padding: "56px 0 40px", borderBottom: "1px solid #e3e7eb" }}>
        <div style={{ fontSize: 30, fontWeight: 600 }}>{doc.name}</div>
        <div style={{ marginTop: 10, fontSize: 15 }}>{clientName}{words ? ` · ${words}` : ""}</div>
        <div style={{ marginTop: 6, fontSize: 12, color: "#7a8591" }}>{doc.status === "published" ? `Published ${when(doc.publishedAt)}` : "Not yet published"}</div>
      </div>
      {doc.sections.map((s, si) => (
        <section key={s.id} style={{ marginBottom: 10 }}>
          {sectionTools ? sectionTools(s, si) : <h2 style={T.h2}>{s.title}</h2>}
          {s.blocks.map((b, bi) => (
            <div key={b.id}>
              {blockTools?.(s, b, bi)}
              <BlockView b={b} c={c} edit={edit?.(s, b)} />
            </div>
          ))}
          {addButtons?.(s)}
        </section>
      ))}
      {doc.disclaimer && <p style={{ ...T.p, marginTop: 30, fontSize: 11, color: "#7a8591", borderTop: "1px solid #e3e7eb", paddingTop: 10 }}>{doc.disclaimerText}</p>}
    </div>
  );
}

/** The whole published page: the report, drawn with the figures as they are now, with its own print settings. */
export function publishedHtml(doc: ReportDoc, c: Ctx, clientName: string): string {
  const body = renderToStaticMarkup(<ReportView doc={doc} c={c} clientName={clientName} />);
  const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch] as string));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(doc.name)} – ${esc(clientName)}</title>
<style>@page{size:A4 ${doc.orientation};margin:14mm}body{margin:0;background:#eef1f4}main{max-width:${doc.orientation === "landscape" ? 1100 : 820}px;margin:0 auto;background:#fff;padding:20px 40px 40px}@media print{body{background:#fff}main{max-width:none;padding:0}.noprint{display:none}}.noprint{max-width:820px;margin:12px auto;text-align:right}button{font:inherit;padding:6px 14px}</style></head>
<body><div class="noprint"><button onclick="window.print()">Print or save as PDF</button></div><main>${body}</main></body></html>`;
}

// ------------------------------------------------------------------ the list and the editor

export function ReportsScreen({ clientKey, clientName, yearEnd, tenant, id }: Props) {
  const { data: app, saveSetting, store } = useData();
  const r = useReportData(clientKey, tenant);
  const tried = useRef("");
  useEffect(() => {
    if (r.checked && !r.data && !r.busy && !r.error && tried.current !== clientKey) { tried.current = clientKey; void r.refresh(); }
  }, [r.checked, r.data, r.busy, r.error, clientKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const key = `reports.${clientKey}`;
  const list = readSetting<ReportDoc[]>(app.settings, key) || [];
  const listRef = useRef(list); listRef.current = list;
  const save = (next: ReportDoc[]) => saveSetting(key, next);
  const kpi = readSetting<KpiSettings>(app.settings, `reporting.kpi.${clientKey}`) || {};
  const endMonth = endMonthOf(yearEnd);
  const d = r.data;
  const doc = id ? list.find((x) => x.id === id) : undefined;

  if (id && !doc) return <div className="alert amber"><strong>That report isn't there</strong><span><a href={href("reporting", clientKey, "reports")}>Back to the reports</a></span></div>;
  if (doc) return <Editor key={doc.id} doc={doc} d={d} busy={r.busy} clientKey={clientKey} clientName={clientName} endMonth={endMonth} kpi={kpi} listRef={listRef} save={save} store={store} refresh={r.refresh} />;
  return <List list={list} d={d} busy={r.busy} error={r.error} clientKey={clientKey} clientName={clientName} endMonth={endMonth} kpi={kpi} save={save} store={store} refresh={r.refresh} />;
}

type Common = { d?: ReportData; busy: string; clientKey: string; clientName: string; endMonth: number; kpi: KpiSettings; save: (l: ReportDoc[]) => Promise<void>; store: ReturnType<typeof useData>["store"]; refresh: () => Promise<void> };

function List({ list, d, busy, error, clientKey, clientName, save, store }: Common & { list: ReportDoc[]; error?: string }) {
  const [tab, setTab] = useState<"draft" | "published">("draft");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState(""), [kind, setKind] = useState<PeriodKind>("month"), [anchor, setAnchor] = useState(""), [orient, setOrient] = useState<Orientation>("portrait");
  const [confirm, setConfirm] = useState(""), [note, setNote] = useState("");
  const months = d?.months || [];
  const at = anchor && months.includes(anchor) ? anchor : months[months.length - 1] || "";
  const shown = list.filter((x) => x.status === tab).sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  const create = async () => {
    const doc = newReport(name, kind, at, orient, new Date().toISOString());
    await save([...list, doc]);
    window.location.hash = href("reporting", clientKey, "reports", doc.id);
  };
  const open = async (x: ReportDoc) => {
    const w = window.open("", "_blank");
    try {
      const bytes = await store.graph.download(fileOf(clientKey, x.id));
      const html = new TextDecoder().decode(bytes);
      if (w) { w.document.open(); w.document.write(html); w.document.close(); } else setNote("Your browser blocked the new window. Allow pop-ups for this site and try again.");
    } catch { w?.close(); setNote("The published copy couldn't be opened from OneDrive."); }
  };
  return (
    <section className="stack" style={{ gap: 12, minWidth: 0 }} aria-label="Reports">
      <div className="row-wrap" style={{ gap: 10, alignItems: "center", justifyContent: "space-between" }}>
        <div className="row-wrap" style={{ gap: 10, alignItems: "center" }}><h2 style={{ margin: 0 }}>Reports</h2><span className="muted" style={{ fontSize: 13 }}>{clientName}</span></div>
        <button type="button" className="btn primary" disabled={!d} onClick={() => setCreating(true)}>Create report</button>
      </div>
      {error && <div className="alert red"><strong>Couldn't read the figures</strong><span>{error}</span></div>}
      {busy && <p className="muted" style={{ margin: 0, fontSize: 12 }} aria-live="polite">{busy}</p>}
      {note && <div className="alert amber"><span>{note}</span></div>}
      <Seg value={tab} set={setTab} opts={[["draft", `Drafts (${list.filter((x) => x.status === "draft").length})`], ["published", `Published (${list.filter((x) => x.status === "published").length})`]]} label="Reports" />
      {!shown.length && <div className="card pad"><p style={{ margin: 0 }}>{tab === "draft" ? "No draft reports. Create one and build it from sections of text, charts and tables." : "Nothing published yet. Publish a draft to keep a finished copy you can open, print or save as a PDF."}</p></div>}
      {shown.map((x) => (
        <div key={x.id} className="card pad row-wrap" style={{ gap: 12, alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <strong>{x.name}</strong>
            <div className="muted" style={{ fontSize: 12 }}>{periodWords(x.kind, x.anchor || months[months.length - 1] || "")} · {x.orientation} · {x.status === "published" ? `published ${when(x.publishedAt)}` : `edited ${when(x.updatedAt)}`}</div>
          </div>
          <div className="row-wrap" style={{ gap: 8 }}>
            {x.status === "draft"
              ? <a className="btn small" href={href("reporting", clientKey, "reports", x.id)}>Edit</a>
              : <button type="button" className="btn small" onClick={() => void open(x)}>View</button>}
            <button type="button" className="btn small" onClick={() => void save([...list, copyReport(x, new Date().toISOString())])}>{x.status === "published" ? "Make a draft copy" : "Duplicate"}</button>
            {confirm === x.id
              ? <><button type="button" className="btn small danger" onClick={() => { setConfirm(""); void save(list.filter((y) => y.id !== x.id)); }}>Delete it</button><button type="button" className="btn small" onClick={() => setConfirm("")}>Keep</button></>
              : <button type="button" className="btn small" onClick={() => setConfirm(x.id)}>Delete</button>}
          </div>
        </div>
      ))}
      {creating && (
        <div role="dialog" aria-modal="true" aria-label="Create report" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "grid", placeItems: "center", zIndex: 50 }}>
          <div className="card pad stack" style={{ gap: 12, width: 420, maxWidth: "92vw", background: "var(--card, #fff)" }}>
            <h3 style={{ margin: 0 }}>Create report from scratch</h3>
            <input aria-label="Report name" autoFocus placeholder="Report name" value={name} onChange={(e) => setName(e.target.value)} />
            <div className="row-wrap" style={{ gap: 8, alignItems: "center" }}>
              <span className="muted" style={{ fontSize: 13 }}>Reporting period: for the</span>
              <Seg value={kind} set={setKind} opts={[["month", "Month"], ["quarter", "Quarter"], ["year", "Year"]]} label="Period" />
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
const PANELS: [PanelId, string][] = [["outline", "Outline"], ["text", "Text"], ["charts", "Charts"], ["tables", "Tables & Financials"], ["layouts", "Layouts"], ["settings", "Report settings"]];

function Editor({ doc: initial, d, busy, clientKey, clientName, endMonth, kpi, listRef, save, store, refresh }: Common & { doc: ReportDoc; listRef: { current: ReportDoc[] } }) {
  const [doc, setDoc] = useState<ReportDoc>(initial);
  const [panel, setPanel] = useState<PanelId>("outline");
  const [target, setTarget] = useState(initial.sections[initial.sections.length - 1]?.id || "");
  const [state, setState] = useState<"" | "saving" | "saved">("");
  const [publishing, setPublishing] = useState(""), [problem, setProblem] = useState("");
  const dirty = useRef(false), docRef = useRef(doc); docRef.current = doc;
  const persist = async (x: ReportDoc) => { dirty.current = false; setState("saving"); try { await save(listRef.current.map((y) => (y.id === x.id ? x : y))); setState("saved"); } catch { setState(""); setProblem("The change couldn't be saved. Try again."); } };
  const update = (fn: (x: ReportDoc) => ReportDoc) => { dirty.current = true; setState(""); setDoc((x) => ({ ...fn(x), updatedAt: new Date().toISOString() })); };
  useEffect(() => { if (!dirty.current) return; const t = setTimeout(() => void persist(doc), 900); return () => clearTimeout(t); }, [doc]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (dirty.current) void persist(docRef.current); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const months = d?.months || [];
  const anchor = anchorFor(doc, months);
  const c: Ctx | undefined = d && anchor ? { d, kind: doc.kind, anchor, endMonth, kpi } : undefined;
  const sec = (id: string, fn: (s: Section) => Section) => update((x) => ({ ...x, sections: x.sections.map((s) => (s.id === id ? fn(s) : s)) }));
  const add = (blocks: Block[]) => {
    const id = doc.sections.some((s) => s.id === target) ? target : doc.sections[doc.sections.length - 1]?.id;
    if (id) sec(id, (s) => ({ ...s, blocks: [...s.blocks, ...blocks] }));
  };
  const addSection = () => { const s: Section = { id: uid("s"), title: "New section", blocks: [] }; update((x) => ({ ...x, sections: [...x.sections, s] })); setTarget(s.id); };
  const targetTitle = doc.sections.find((s) => s.id === target)?.title;

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

  const picks = (items: Pick[]) => (
    <div className="stack" style={{ gap: 6 }}>
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>Adds to the “{targetTitle || "last"}” section.</p>
      {items.map((p) => <button key={p.name} type="button" className="card pad" style={{ textAlign: "left", cursor: "pointer", padding: "8px 10px" }} onClick={() => add([p.make()])}><strong style={{ fontSize: 13 }}>{p.name}</strong><div className="muted" style={{ fontSize: 11 }}>{p.note}</div></button>)}
    </div>
  );
  const mini = (label: string, onClick: () => void, off = false) => <button type="button" aria-label={label} title={label} disabled={off} onClick={onClick} style={{ border: "1px solid #d5dbe1", background: "#fff", borderRadius: 4, width: 26, height: 24, cursor: off ? "default" : "pointer", opacity: off ? 0.35 : 1 }}>{label.startsWith("Move up") ? "↑" : label.startsWith("Move down") ? "↓" : "✕"}</button>;
  const width = doc.orientation === "landscape" ? 980 : 760;

  return (
    <section className="stack" style={{ gap: 10, minWidth: 0 }} aria-label="Report editor">
      <div className="row-wrap" style={{ gap: 10, alignItems: "center", justifyContent: "space-between" }}>
        <div className="row-wrap" style={{ gap: 10, alignItems: "center" }}>
          <a href={href("reporting", clientKey, "reports")}>← Reports</a>
          <input aria-label="Report name" value={doc.name} onChange={(e) => update((x) => ({ ...x, name: e.target.value }))} style={{ fontSize: 18, fontWeight: 600, minWidth: 260 }} />
          <span className="muted" style={{ fontSize: 12 }} aria-live="polite">{state === "saving" ? "Saving…" : state === "saved" ? "Saved" : dirty.current ? "Unsaved changes" : "Draft"}</span>
        </div>
        <div className="row-wrap" style={{ gap: 8, alignItems: "center" }}>
          {!d && <button type="button" className="btn small" disabled={!!busy} onClick={() => void refresh()}>Read from Xero</button>}
          <button type="button" className="btn primary" disabled={!c || !!publishing} onClick={() => void publish()}>{publishing || "Publish report"}</button>
        </div>
      </div>
      {problem && <div className="alert red"><span>{problem}</span></div>}
      {!d && <div className="alert amber"><span>{busy || "The figures haven't been read from Xero yet, so charts and tables can't be drawn."}</span></div>}
      <div style={{ display: "grid", gridTemplateColumns: "260px minmax(0, 1fr)", gap: 14, alignItems: "start" }}>
        <aside className="card pad stack" style={{ gap: 10, position: "sticky", top: 8 }}>
          <select aria-label="Panel" value={panel} onChange={(e) => setPanel(e.target.value as PanelId)}>{PANELS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          {panel === "outline" && (
            <div className="stack" style={{ gap: 6 }}>
              {doc.sections.map((s, i) => (
                <div key={s.id} style={{ display: "flex", gap: 4, alignItems: "center", padding: 4, borderRadius: 4, background: s.id === target ? "var(--soft, #eef2f7)" : undefined }}>
                  <button type="button" onClick={() => setTarget(s.id)} style={{ flex: 1, textAlign: "left", border: 0, background: "none", cursor: "pointer", fontSize: 13 }}>{s.title || "Untitled"} <span className="muted" style={{ fontSize: 11 }}>· {s.blocks.length}</span></button>
                  {mini("Move up", () => update((x) => ({ ...x, sections: moveItem(x.sections, i, i - 1) })), i === 0)}{mini("Move down", () => update((x) => ({ ...x, sections: moveItem(x.sections, i, i + 1) })), i === doc.sections.length - 1)}
                </div>
              ))}
              <button type="button" className="btn small" onClick={addSection}>New section</button>
            </div>
          )}
          {panel === "text" && picks(TEXT_BLOCKS)}
          {panel === "charts" && picks(CHART_BLOCKS)}
          {panel === "tables" && picks(TABLE_BLOCKS)}
          {panel === "layouts" && (
            <div className="stack" style={{ gap: 6 }}>
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>A ready-made set of blocks, added to the “{targetTitle || "last"}” section.</p>
              {LAYOUTS.map((l) => <button key={l.name} type="button" className="card pad" style={{ textAlign: "left", cursor: "pointer", padding: "8px 10px" }} onClick={() => add(l.make())}><strong style={{ fontSize: 13 }}>{l.name}</strong><div className="muted" style={{ fontSize: 11 }}>{l.note}</div></button>)}
            </div>
          )}
          {panel === "settings" && (
            <div className="stack" style={{ gap: 10 }}>
              <label className="stack" style={{ gap: 2, fontSize: 12 }}>Period<Seg value={doc.kind} set={(k) => update((x) => ({ ...x, kind: k }))} opts={[["month", "Month"], ["quarter", "Quarter"], ["year", "Year"]]} label="Period" /></label>
              <label className="stack" style={{ gap: 2, fontSize: 12 }}>Ending in<select aria-label="Month" value={anchor} onChange={(e) => update((x) => ({ ...x, anchor: e.target.value }))}>{[...months].reverse().map((m) => <option key={m} value={m}>{monthLong(m)}</option>)}</select></label>
              <label className="stack" style={{ gap: 2, fontSize: 12 }}>Orientation<Seg value={doc.orientation} set={(o) => update((x) => ({ ...x, orientation: o }))} opts={[["portrait", "Portrait"], ["landscape", "Landscape"]]} label="Orientation" /></label>
              <label style={{ fontSize: 12 }}><input type="checkbox" checked={doc.disclaimer} onChange={(e) => update((x) => ({ ...x, disclaimer: e.target.checked }))} /> Include a disclaimer at the end</label>
              {doc.disclaimer && <textarea aria-label="Disclaimer" rows={5} value={doc.disclaimerText} onChange={(e) => update((x) => ({ ...x, disclaimerText: e.target.value }))} style={{ fontSize: 12 }} />}
            </div>
          )}
        </aside>
        <div style={{ overflowX: "auto", background: "#eef1f4", padding: 14, borderRadius: 6 }}>
          <div style={{ width, maxWidth: "100%", margin: "0 auto", background: "#fff", boxShadow: "0 1px 6px rgba(0,0,0,.15)", padding: "0 36px 36px", boxSizing: "border-box" }}>
            <ReportView
              doc={doc} c={c} clientName={clientName}
              edit={(s, b) => ({ change: (nb) => sec(s.id, (x) => ({ ...x, blocks: x.blocks.map((y) => (y.id === b.id ? nb : y)) })) })}
              sectionTools={(s, i) => (
                <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 26, borderBottom: "2px solid #e3e7eb", paddingBottom: 6, outline: s.id === target ? "2px solid #cfe0f3" : undefined }}>
                  <input aria-label="Section title" value={s.title} onFocus={() => setTarget(s.id)} onChange={(e) => sec(s.id, (x) => ({ ...x, title: e.target.value }))} style={{ flex: 1, fontSize: 20, fontWeight: 600, border: 0, background: "transparent" }} />
                  {mini("Move up section", () => update((x) => ({ ...x, sections: moveItem(x.sections, i, i - 1) })), i === 0)}{mini("Move down section", () => update((x) => ({ ...x, sections: moveItem(x.sections, i, i + 1) })), i === doc.sections.length - 1)}
                  {doc.sections.length > 1 && mini("Delete section", () => update((x) => ({ ...x, sections: x.sections.filter((y) => y.id !== s.id) })))}
                </div>
              )}
              blockTools={(s, b, i) => (
                <div style={{ display: "flex", gap: 4, justifyContent: "flex-end", marginTop: 6 }}>
                  <BlockOptions b={b} onChange={(nb) => sec(s.id, (x) => ({ ...x, blocks: x.blocks.map((y) => (y.id === b.id ? nb : y)) }))} />
                  {mini("Move up", () => sec(s.id, (x) => ({ ...x, blocks: moveItem(x.blocks, i, i - 1) })), i === 0)}{mini("Move down", () => sec(s.id, (x) => ({ ...x, blocks: moveItem(x.blocks, i, i + 1) })), i === s.blocks.length - 1)}{mini("Delete", () => sec(s.id, (x) => ({ ...x, blocks: x.blocks.filter((y) => y.id !== b.id) })))}
                </div>
              )}
              addButtons={(s) => (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "14px 0", padding: 10, border: "1px dashed #cbd5e1", borderRadius: 6, justifyContent: "center" }}>
                  {([["Add Text", "text"], ["Add Charts", "charts"], ["Add Tables & Financials", "tables"], ["Add a layout", "layouts"]] as [string, PanelId][]).map(([l, p]) => <button key={l} type="button" className="btn small" onClick={() => { setTarget(s.id); setPanel(p); }}>{l}</button>)}
                </div>
              )}
            />
            <div style={{ textAlign: "center", marginTop: 20 }}><button type="button" className="btn" onClick={addSection}>Add another section</button><p className="muted" style={{ fontSize: 12 }}>Or, are you all done? Choose Publish report.</p></div>
          </div>
        </div>
      </div>
    </section>
  );
}

function BlockOptions({ b, onChange }: { b: Block; onChange: (b: Block) => void }) {
  const sel = (label: string, value: string, opts: [string, string][], set: (v: string) => void) => <select aria-label={label} value={value} onChange={(e) => set(e.target.value)} style={{ fontSize: 12 }}>{opts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>;
  if (b.type === "table") return <>
    {sel("Statement", b.statement, [["pl", "Profit & Loss"], ["bs", "Balance Sheet"]], (v) => onChange({ ...b, statement: v as "pl" | "bs" }))}
    {sel("Compare with", b.compare, [["none", "No comparison"], ["prior", "Last period"], ["lastYear", "Last year"], ["months", "Every month"]], (v) => onChange({ ...b, compare: v as typeof b.compare }))}
    {sel("Detail", b.detail, [["summary", "Summary"], ["detailed", "Detailed"]], (v) => onChange({ ...b, detail: v as typeof b.detail }))}
  </>;
  if (b.type === "chart") return <>
    {sel("Months", String(b.months), [["13", "13 months"], ["24", "24 months"], ["36", "36 months"]], (v) => onChange({ ...b, months: Number(v) as 13 | 24 | 36 }))}
    {b.measures.length === 1 && sel("Style", b.bars ? "bars" : "line", [["bars", "Bars"], ["line", "Line"]], (v) => onChange({ ...b, bars: v === "bars" }))}
  </>;
  return null;
}
