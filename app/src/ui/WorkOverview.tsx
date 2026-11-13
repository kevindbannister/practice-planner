// Work overview across all clients: a heatmap of clients against work states, and a workload heatmap on a metric the user chooses. Every number can be opened up.
// Status is always written out as well as shaded, and on a phone the grid becomes a list.
import { useMemo, useState } from "react";
import { fmtDate } from "../lib/domain";
import { Row } from "../lib/schema";
import { COLUMNS, COLUMN_LABEL, Column, Metric, METRICS, Mode, Sort, cellText, columns, drill, filterItems, heatmap, workload } from "../lib/work/overview";
import { RISK_LABEL } from "../lib/work/risk";
import { PlanTabs } from "./bits";
import { useData } from "./data";
import { useWorkItems } from "./overviewKit";
import { WorkList } from "./WorkList";

const SORTS: [Sort, string][] = [["risk", "Highest deadline risk"], ["overdue", "Most overdue work"], ["blocked", "Most blocked work"], ["hours", "Most outstanding hours"], ["importance", "Client importance"], ["name", "Client name"]];
const shade = (n: number, max: number) => (n && max ? `color-mix(in srgb, var(--accent, #0a84ff) ${Math.round(10 + 50 * (n / max))}%, transparent)` : "transparent");

export function WorkOverview() {
  const { data } = useData(); const w = useWorkItems();
  const [view, setView] = useState<"counts" | "workload">("counts");
  const [sort, setSort] = useState<Sort>("risk"); const [user, setUser] = useState(""); const [service, setService] = useState(""); const [group, setGroup] = useState(""); const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [open, setOpen] = useState<{ client: string; col: Column }>();
  const [metric, setMetric] = useState<Metric>("remaining"); const [rowBy, setRowBy] = useState<"client" | "user">("client"); const [mode, setMode] = useState<Mode>("week");
  const owners = useMemo(() => [...new Set(w.items.map((i) => i.owner).filter(Boolean))].sort(), [w.items]);
  const filtered = useMemo(() => filterItems(w.items, { user, service, group, period: from && to ? { from, to } : undefined }), [w.items, user, service, group, from, to]);
  const rows = useMemo(() => heatmap(filtered, w.clientName, sort), [filtered, sort, w.clientName]);
  const cols = useMemo(() => columns(mode, w.today, mode === "day" ? 10 : mode === "week" ? 8 : 6), [mode, w.today]);
  const heat = useMemo(() => workload({ metric, rowBy, items: filtered, sessions: w.sessions, entries: w.entries, cols, today: w.today }), [metric, rowBy, filtered, w.sessions, w.entries, cols, w.today]);
  const rowName = (k: string) => (rowBy === "client" ? w.clientName(k) : k || "Unassigned");
  const unit = (n: number) => (heat.unit === "hours" ? `${n}h` : String(n));
  const shown = open ? rows.find((r) => r.clientKey === open.client) : undefined;
  return (
    <div className="page">
      <PlanTabs current="overview" />
      <div className="page-head"><div><h1>Work overview</h1><p className="muted tip" style={{ margin: "4px 0 0" }}>Every client's open work. Counts are of jobs and tasks, never of planned sessions.</p></div></div>
      <div className="card pad row-wrap" style={{ gap: 8 }}>
        <div role="group" aria-label="View" className="row-wrap" style={{ gap: 4 }}>{(["counts", "workload"] as const).map((v) => <button key={v} type="button" className={`btn small${view === v ? " primary" : ""}`} aria-pressed={view === v} onClick={() => setView(v)}>{v === "counts" ? "Counts" : "Workload"}</button>)}</div>
        <label className="doc-field"><span>Person</span><select className="input" value={user} onChange={(e) => setUser(e.target.value)}><option value="">Everyone</option>{owners.map((o) => <option key={o}>{o}</option>)}</select></label>
        <label className="doc-field"><span>Service</span><select className="input" value={service} onChange={(e) => setService(e.target.value)}><option value="">All</option>{(data.services as Row[]).map((s) => <option key={String(s.Key)} value={String(s.Key)}>{String(s.Title || s.Key)}</option>)}</select></label>
        <label className="doc-field"><span>Client group</span><select className="input" value={group} onChange={(e) => setGroup(e.target.value)}><option value="">All</option>{(data.groups as Row[]).map((g) => <option key={String(g.Key)} value={String(g.Key)}>{String(g.Title || g.Name || g.Key)}</option>)}</select></label>
        <label className="doc-field"><span>Due from</span><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="doc-field"><span>to</span><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        {view === "counts" && <label className="doc-field"><span>Sort by</span><select className="input" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>{SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>}
      </div>
      {view === "counts" ? <>
        {!rows.length && <p className="card pad muted">No open work matches.</p>}
        <div className="heat-table" style={{ overflowX: "auto" }}><table className="table">
          <thead><tr><th scope="col" style={{ textAlign: "left" }}>Client</th>{COLUMNS.map((c) => <th key={c} scope="col" style={{ textAlign: "right" }}>{COLUMN_LABEL[c]}</th>)}<th scope="col" style={{ textAlign: "right" }}>Hours left</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.clientKey}><th scope="row" style={{ textAlign: "left" }}><a href={`#/clients/${r.clientKey}`}>{w.clientName(r.clientKey)}</a>{r.worstRisk !== "on_track" && <span className="muted" style={{ fontSize: 13 }}> · {RISK_LABEL[r.worstRisk]}</span>}</th>
            {COLUMNS.map((c) => { const cell = r.cells[c], n = cell.jobs.length + cell.tasks.length, on = open?.client === r.clientKey && open.col === c; return <td key={c} style={{ textAlign: "right", background: shade(n, 6) }}>{n ? <button type="button" className="linkbtn" aria-pressed={on} title={cellText(cell)} onClick={() => setOpen(on ? undefined : { client: r.clientKey, col: c })}>{cell.jobs.length ? `${cell.jobs.length}J` : ""}{cell.jobs.length && cell.tasks.length ? " " : ""}{cell.tasks.length ? `${cell.tasks.length}T` : ""}</button> : <span className="muted">–</span>}</td>; })}
            <td style={{ textAlign: "right" }}>{r.hours}</td></tr>)}</tbody>
        </table></div>
        <ul className="plain stack heat-list" style={{ gap: 6, margin: 0 }}>{rows.map((r) => <li key={r.clientKey} className="card pad stack" style={{ gap: 4 }}><strong><a href={`#/clients/${r.clientKey}`}>{w.clientName(r.clientKey)}</a></strong>
          {COLUMNS.map((c) => { const cell = r.cells[c]; if (!cell.jobs.length && !cell.tasks.length) return null; return <button key={c} type="button" className="linkbtn" style={{ textAlign: "left" }} onClick={() => setOpen({ client: r.clientKey, col: c })}>{COLUMN_LABEL[c]}: {cellText(cell)}</button>; })}</li>)}</ul>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>J = jobs, T = tasks. Overdue and At risk overlap the other columns, so a row's numbers are not meant to add up.</p>
        {open && shown && <section className="card pad stack" aria-label="Drill-down"><div className="row-wrap" style={{ justifyContent: "space-between" }}><h2 style={{ margin: 0, fontSize: 17 }}>{w.clientName(open.client)}: {COLUMN_LABEL[open.col]}</h2><button type="button" className="btn small" onClick={() => setOpen(undefined)}>Close</button></div><WorkList items={drill(shown, open.col)} /></section>}
      </> : <>
        <div className="card pad row-wrap" style={{ gap: 8 }}>
          <label className="doc-field"><span>Measure</span><select className="input" value={metric} onChange={(e) => setMetric(e.target.value as Metric)}>{METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</select></label>
          <label className="doc-field"><span>Rows</span><select className="input" value={rowBy} onChange={(e) => setRowBy(e.target.value as "client" | "user")}><option value="client">Clients</option><option value="user">People</option></select></label>
          <label className="doc-field"><span>Columns</span><select className="input" value={mode} onChange={(e) => setMode(e.target.value as Mode)}><option value="day">Days</option><option value="week">Weeks</option><option value="month">Months</option></select></label>
        </div>
        <p className="muted" style={{ margin: 0 }}>{heat.note}</p>
        {!heat.rows.length && <p className="card pad muted">Nothing to show for this measure.</p>}
        <div className="heat-table" style={{ overflowX: "auto" }}><table className="table">
          <thead><tr><th scope="col" style={{ textAlign: "left" }}>{rowBy === "client" ? "Client" : "Person"}</th>{heat.cols.map((c) => <th key={c.key} scope="col" style={{ textAlign: "right" }}>{c.label}</th>)}<th scope="col" style={{ textAlign: "right" }}>Total</th></tr></thead>
          <tbody>{heat.rows.map((r) => <tr key={r.key}><th scope="row" style={{ textAlign: "left" }}>{rowName(r.key)}</th>{r.cells.map((n, i) => <td key={i} style={{ textAlign: "right", background: shade(n, heat.max) }}>{n ? unit(n) : <span className="muted">–</span>}</td>)}<td style={{ textAlign: "right", fontWeight: 600 }}>{unit(r.total)}</td></tr>)}</tbody>
        </table></div>
        <ul className="plain stack heat-list" style={{ gap: 6, margin: 0 }}>{heat.rows.map((r) => <li key={r.key} className="card pad"><strong>{rowName(r.key)}</strong>: {unit(r.total)} <span className="muted">· {r.cells.map((n, i) => n ? `${heat.cols[i].label} ${unit(n)}` : "").filter(Boolean).join(", ")}</span></li>)}</ul>
      </>}
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>Shading is only a guide: every cell shows its number. Due-based measures put each job or task in the column for its date; {fmtDate(w.today)} is today.</p>
    </div>
  );
}
