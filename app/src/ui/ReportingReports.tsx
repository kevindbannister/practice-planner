// Reporting › Reports: build a report for a client from sections of text, charts, tables, KPIs and cash flow, for a month, quarter or year,
// then publish it as a finished page that can be opened or printed to PDF. Drafts save themselves; the figures are the client's monthly figures
// read from Xero, so a draft is always up to date and a published report is a frozen copy.
import { Fragment, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cashFlow, measureById, monthlySeries } from "../lib/analysis";
import { AgedData } from "../lib/aged";
import { KpiSettings, computeKpis, formatKpi } from "../lib/kpis";
import {
  Block, CHART_BLOCKS, LAYOUTS, Orientation, Pick, ReportDoc, Section, TABLE_BLOCKS, TEXT_BLOCKS, anchorFor, copyReport, moveItem, newReport, periodWords, uid,
} from "../lib/reportBuilder";
import { PeriodKind, REPORT_FOLDER, ReportData, bsStatement, monthLabel, monthLong, periodCols, plStatement } from "../lib/reportData";
import { todayIso } from "../lib/domain";
import { Icon, IconName, href } from "./bits";
import { readSetting, useData } from "./data";
import { AgedView, useAgedData } from "./ReportingAged";
import { ChartView, ComponentEditor, Ctx, KeyView, ObservationView, T, TableView, TopView, observationHidden } from "./ReportingComponents";
import { Seg, useReportData } from "./reportingKit";

type Tenant = { tenantId: string; tenantName: string };
type Props = { clientKey: string; clientName: string; yearEnd?: string; tenant: Tenant; id?: string };
const endMonthOf = (yearEnd?: string) => Number((/^(\d{2})-/.exec(yearEnd || "") || [])[1]) || 12;
const gbp = (n?: number) => (n === undefined ? "" : n === 0 ? "–" : n < 0 ? `(${Math.abs(Math.round(n)).toLocaleString("en-GB")})` : Math.round(n).toLocaleString("en-GB"));
const money = (n?: number) => (n === undefined ? "–" : `${n < 0 ? "-" : ""}£${Math.abs(Math.round(n)).toLocaleString("en-GB")}`);
const short = (n: number) => { const a = Math.abs(n), s = n < 0 ? "-" : ""; return a >= 1e6 ? `${s}£${+(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `${s}£${+(a / 1e3).toFixed(1)}K` : `${s}£${Math.round(a)}`; };
const GREEN = "#6f9a3a";
const fileOf = (clientKey: string, id: string) => `/me/drive/root:/${encodeURIComponent(REPORT_FOLDER)}/${encodeURIComponent(clientKey)}/reports/${encodeURIComponent(id)}.html`;
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

// ------------------------------------------------------------------ drawing the report (used on screen and in the published copy)

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
  const hidden = b.type === "observation" && observationHidden(b, c);
  if (hidden && !edit) return null;
  return (
    <div style={{ margin: "8px 0", pageBreakInside: "avoid", breakInside: "avoid", opacity: hidden ? 0.45 : 1 }} title={hidden ? "Hidden in the published report by its extra condition" : undefined}>
      {b.type !== "observation" && title(b.title)}
      {b.type === "key" ? <KeyView b={b} c={c} /> : b.type === "observation" ? <ObservationView b={b} c={c} /> : b.type === "top" ? <TopView b={b} c={c} /> : b.type === "aged" ? (c.aged ? <AgedView data={c.aged} kind={b.which} limit={15} /> : <p style={{ ...T.p, color: "#7a8591" }}>The unpaid invoices and bills haven't been read from Xero yet (Reporting › Receivables).</p>) : b.type === "chart" ? <ChartView b={b} c={c} /> : b.type === "table" ? <TableView b={b} c={c} /> : b.type === "kpis" ? <KpiView c={c} /> : <CashFlowView c={c} />}
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
      <div style={{ padding: "60px 0 34px", borderBottom: "1px solid #d9dee3" }}>
        <div style={{ fontSize: 11, letterSpacing: 1.4, textTransform: "uppercase", color: "#6b7683", fontWeight: 600 }}>{clientName}</div>
        <div style={{ fontSize: 32, fontWeight: 600, letterSpacing: -0.4, marginTop: 10, lineHeight: 1.15 }}>{doc.name}</div>
        <div style={{ width: 36, height: 3, background: "#2b4a6f", margin: "18px 0 14px" }} />
        <div style={{ fontSize: 14, color: "#3d4852" }}>{words}</div>
        {doc.status === "published" && <div style={{ fontSize: 12, color: "#7a8591", marginTop: 4 }}>Published {when(doc.publishedAt)}</div>}
      </div>
      {doc.sections.map((s, si) => (
        <section key={s.id} className="rb-section" style={{ marginBottom: 10 }}>
          {sectionTools ? sectionTools(s, si) : <h2 style={T.h2}>{s.title}</h2>}
          {s.blocks.map((b, bi) => (
            <div key={b.id} className="rb-block">
              {blockTools?.(s, b, bi)}
              <BlockView b={b} c={c} edit={edit?.(s, b)} />
            </div>
          ))}
          {addButtons?.(s)}
        </section>
      ))}
      {doc.disclaimer && <p style={{ ...T.p, marginTop: 30, fontSize: 11, color: "#7a8591", borderTop: "1px solid #d9dee3", paddingTop: 10 }}>{doc.disclaimerText}</p>}
    </div>
  );
}

/** The whole published page: the report, drawn with the figures as they are now, with its own print settings. */
export function publishedHtml(doc: ReportDoc, c: Ctx, clientName: string): string {
  const body = renderToStaticMarkup(<ReportView doc={doc} c={c} clientName={clientName} />);
  const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch] as string));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(doc.name)} – ${esc(clientName)}</title>
<style>@page{size:A4 ${doc.orientation};margin:14mm}body{margin:0;background:#e9ecef}main{max-width:${doc.orientation === "landscape" ? 1100 : 820}px;margin:0 auto;background:#fff;padding:20px 40px 40px}@media print{body{background:#fff}main{max-width:none;padding:0}.noprint{display:none}}.noprint{max-width:820px;margin:12px auto;text-align:right}button{font:inherit;padding:6px 14px}</style></head>
<body><div class="noprint"><button onclick="window.print()">Print or save as PDF</button></div><main>${body}</main></body></html>`;
}

// ------------------------------------------------------------------ the list and the editor

export function ReportsScreen({ clientKey, clientName, yearEnd, tenant, id }: Props) {
  const { data: app, saveSetting, store } = useData();
  const r = useReportData(clientKey, tenant);
  const ag = useAgedData(clientKey, tenant);
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
  if (doc) return <Editor key={doc.id} doc={doc} d={d} busy={r.busy} clientKey={clientKey} clientName={clientName} endMonth={endMonth} kpi={kpi} aged={ag.data} listRef={listRef} save={save} store={store} refresh={r.refresh} />;
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
const PANELS: [PanelId, string][] = [["outline", "Outline"], ["text", "Text"], ["charts", "Charts"], ["tables", "Tables & financials"], ["layouts", "Layouts"], ["settings", "Report settings"]];

function Editor({ doc: initial, d, busy, clientKey, clientName, endMonth, kpi, aged, listRef, save, store, refresh }: Common & { doc: ReportDoc; aged?: AgedData; listRef: { current: ReportDoc[] } }) {
  const [doc, setDoc] = useState<ReportDoc>(initial);
  const [panel, setPanel] = useState<PanelId>("outline");
  const [target, setTarget] = useState(initial.sections[initial.sections.length - 1]?.id || "");
  const [state, setState] = useState<"" | "saving" | "saved">("");
  const [publishing, setPublishing] = useState(""), [problem, setProblem] = useState("");
  const [editId, setEditId] = useState("");
  const dirty = useRef(false), docRef = useRef(doc); docRef.current = doc;
  const persist = async (x: ReportDoc) => { dirty.current = false; setState("saving"); try { await save(listRef.current.map((y) => (y.id === x.id ? x : y))); setState("saved"); } catch { setState(""); setProblem("The change couldn't be saved. Try again."); } };
  const update = (fn: (x: ReportDoc) => ReportDoc) => { dirty.current = true; setState(""); setDoc((x) => ({ ...fn(x), updatedAt: new Date().toISOString() })); };
  useEffect(() => { if (!dirty.current) return; const t = setTimeout(() => void persist(doc), 900); return () => clearTimeout(t); }, [doc]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (dirty.current) void persist(docRef.current); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const months = d?.months || [];
  const anchor = anchorFor(doc, months);
  const c: Ctx | undefined = d && anchor ? { d, kind: doc.kind, anchor, endMonth, kpi, aged } : undefined;
  const sec = (id: string, fn: (s: Section) => Section) => update((x) => ({ ...x, sections: x.sections.map((s) => (s.id === id ? fn(s) : s)) }));
  const add = (blocks: Block[]) => {
    const id = doc.sections.some((s) => s.id === target) ? target : doc.sections[doc.sections.length - 1]?.id;
    if (id) sec(id, (s) => ({ ...s, blocks: [...s.blocks, ...blocks] }));
  };
  const addSection = () => { const s: Section = { id: uid("s"), title: "New section", blocks: [] }; update((x) => ({ ...x, sections: [...x.sections, s] })); setTarget(s.id); };
  const editing = doc.sections.flatMap((s) => s.blocks.map((b) => ({ s, b }))).find((x) => x.b.id === editId);
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
    <div className="rb-list">
      <p className="rb-hint">Adds to “{targetTitle || "the last section"}”.</p>
      {items.map((p) => <button key={p.name} type="button" className="rb-pick" onClick={() => add([p.make()])}><strong>{p.name}</strong><span>{p.note}</span></button>)}
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
  const width = doc.orientation === "landscape" ? 1000 : 780;
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
          <span className="rb-meta">{clientName}{words ? ` · ${words}` : ""} · {doc.orientation}</span>
          {!d && <button type="button" className="btn small" disabled={!!busy} onClick={() => void refresh()}>Read from Xero</button>}
          <button type="button" className="btn primary small" disabled={!c || !!publishing} onClick={() => void publish()}>{publishing || "Publish"}</button>
        </div>
      </header>
      {(problem || !d) && <div className="rb-notes">
        {problem && <div className="alert red"><span>{problem}</span></div>}
        {!d && <div className="alert amber"><span>{busy || "The figures haven't been read from Xero yet, so charts and tables can't be drawn."}</span></div>}
      </div>}
      <div className="rb-body">
        <nav className="rb-rail" aria-label="Add to the report">
          {RAIL.map(([k, l, ic]) => (
            <button key={k} type="button" className={`rb-tab${panel === k && !editing ? " on" : ""}`} aria-pressed={panel === k && !editing} onClick={() => { setEditId(""); setPanel(k); }}>
              <Icon name={ic} size={18} /><span>{l}</span>
            </button>
          ))}
        </nav>
        <aside className="rb-panel">
          {editing && <ComponentEditor key={editing.b.id} block={editing.b} c={c} onCancel={() => setEditId("")} onSave={(nb) => { sec(editing.s.id, (x) => ({ ...x, blocks: x.blocks.map((y) => (y.id === nb.id ? nb : y)) })); setEditId(""); }} />}
          {!editing && <h3 className="rb-panel-title">{panelTitle}</h3>}
          {!editing && panel === "outline" && (
            <div className="rb-list">
              {doc.sections.map((s, i) => (
                <div key={s.id} className={`rb-out${s.id === target ? " on" : ""}`}>
                  <button type="button" className="rb-out-name" onClick={() => setTarget(s.id)}>{s.title || "Untitled"}<span>{s.blocks.length}</span></button>
                  {mini("Move up", () => update((x) => ({ ...x, sections: moveItem(x.sections, i, i - 1) })), i === 0)}{mini("Move down", () => update((x) => ({ ...x, sections: moveItem(x.sections, i, i + 1) })), i === doc.sections.length - 1)}
                </div>
              ))}
              <button type="button" className="btn small" style={{ alignSelf: "flex-start", marginTop: 8 }} onClick={addSection}>New section</button>
            </div>
          )}
          {!editing && panel === "text" && picks(TEXT_BLOCKS)}
          {!editing && panel === "charts" && picks(CHART_BLOCKS)}
          {!editing && panel === "tables" && picks(TABLE_BLOCKS)}
          {!editing && panel === "layouts" && (
            <div className="rb-list">
              <p className="rb-hint">A ready-made set of components, added to “{targetTitle || "the last section"}”.</p>
              {LAYOUTS.map((l) => <button key={l.name} type="button" className="rb-pick" onClick={() => add(l.make())}><strong>{l.name}</strong><span>{l.note}</span></button>)}
            </div>
          )}
          {!editing && panel === "settings" && (
            <div className="rb-form">
              <label>Period<Seg value={doc.kind} set={(k) => update((x) => ({ ...x, kind: k }))} opts={[["month", "Month"], ["quarter", "Quarter"], ["year", "Year"]]} label="Period" /></label>
              <label>Ending in<select aria-label="Month" value={anchor} onChange={(e) => update((x) => ({ ...x, anchor: e.target.value }))}>{[...months].reverse().map((m) => <option key={m} value={m}>{monthLong(m)}</option>)}</select></label>
              <label>Orientation<Seg value={doc.orientation} set={(o) => update((x) => ({ ...x, orientation: o }))} opts={[["portrait", "Portrait"], ["landscape", "Landscape"]]} label="Orientation" /></label>
              <label className="rb-check"><input type="checkbox" checked={doc.disclaimer} onChange={(e) => update((x) => ({ ...x, disclaimer: e.target.checked }))} /> Include a disclaimer at the end</label>
              {doc.disclaimer && <textarea aria-label="Disclaimer" rows={6} value={doc.disclaimerText} onChange={(e) => update((x) => ({ ...x, disclaimerText: e.target.value }))} />}
            </div>
          )}
        </aside>
        <main className="rb-canvas">
          <div className="rb-page" style={{ width }}>
            <ReportView
              doc={doc} c={c} clientName={clientName}
              edit={(s, b) => ({ change: (nb) => sec(s.id, (x) => ({ ...x, blocks: x.blocks.map((y) => (y.id === b.id ? nb : y)) })) })}
              sectionTools={(s, i) => (
                <div className={`rb-sechead${s.id === target ? " on" : ""}`}>
                  <input aria-label="Section title" value={s.title} onFocus={() => setTarget(s.id)} onChange={(e) => sec(s.id, (x) => ({ ...x, title: e.target.value }))} />
                  <span className="rb-tools">
                    {mini("Move up section", () => update((x) => ({ ...x, sections: moveItem(x.sections, i, i - 1) })), i === 0)}{mini("Move down section", () => update((x) => ({ ...x, sections: moveItem(x.sections, i, i + 1) })), i === doc.sections.length - 1)}
                    {doc.sections.length > 1 && mini("Delete section", () => update((x) => ({ ...x, sections: x.sections.filter((y) => y.id !== s.id) })))}
                  </span>
                </div>
              )}
              blockTools={(s, b, i) => (
                <div className="rb-tools rb-blocktools">
                  {["key", "observation", "top", "chart", "table", "kpis", "cashflow", "aged"].includes(b.type) && <button type="button" className="rb-ico wide" aria-label="Edit component" title="Edit component" onClick={() => setEditId(b.id)}><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICO.edit}</svg>Edit</button>}
                  {mini("Move up", () => sec(s.id, (x) => ({ ...x, blocks: moveItem(x.blocks, i, i - 1) })), i === 0)}{mini("Move down", () => sec(s.id, (x) => ({ ...x, blocks: moveItem(x.blocks, i, i + 1) })), i === s.blocks.length - 1)}{mini("Delete", () => sec(s.id, (x) => ({ ...x, blocks: x.blocks.filter((y) => y.id !== b.id) })))}
                </div>
              )}
              addButtons={(s) => (
                <div className="rb-add">
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
