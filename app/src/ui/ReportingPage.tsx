// The reporting centre: for one client, the figures from Xero laid out as reports. This first part is Financials: the profit and loss and
// balance sheet for a month, quarter or year, set beside the period before or the same period last year, or month by month across the year.
// The figures are read from Xero once (Refresh reads them again), kept on OneDrive, and worked out from the months.
import { useEffect, useMemo, useRef, useState } from "react";
import { Compare, Detail, PeriodKind, bsStatement, monthLong, periodCols, plStatement } from "../lib/reportData";
import { Icon, IconName, href, useRoute } from "./bits";
import { useData } from "./data";
import { KpiExplorer } from "./ReportingExplorer";
import { CashFlowScreen, GoalseekScreen, GrowthScreen, TrendScreen } from "./ReportingAnalysis";
import { ReportsScreen } from "./ReportingReports";
import { ReportingSettings } from "./ReportingSettings";
import { AgedScreen } from "./ReportingAged";
import { Profitability } from "./ReportingProfitability";
import { KpiScreen } from "./ReportingKpis";
import { ReadNote, readAndSave, useRecordRead, useReportData } from "./reportingKit";
import { lastCompleteMonth, monthLabel } from "../lib/reportData";
import type { SavedAlerts, Snapshot } from "../lib/kpis";
import { todayIso } from "../lib/domain";
import { readSetting } from "./data";
import { XeroError } from "../lib/xero";
import { useXero } from "./XeroSettings";
import { useXeroLinks } from "./XeroSettings";

const GROUPS: { name: string; items: [string, string, IconName][] }[] = [
  { name: "Analysis", items: [["financials", "Financials", "calc"], ["kpis", "KPIs", "flag"], ["explorer", "KPI Explorer", "spark"], ["profitability", "Profitability", "scale"], ["cashflow", "Cash Flow", "coins"], ["growth", "Growth", "up"], ["trend", "Trend", "chart"], ["goalseek", "Goalseek", "flag"]] },
  { name: "Receivables and payables", items: [["receivables", "Receivables", "down"], ["payables", "Payables", "up"]] },
  { name: "Reports", items: [["reports", "Reports", "book"]] },
  { name: "Settings", items: [["settings", "Settings", "cog"]] },
];

const daysAgo = (iso: string) => Math.floor((Date.now() - Date.parse(iso)) / 86400000);
const ago = (iso?: string) => (!iso ? "not read yet" : daysAgo(iso) <= 0 ? "today" : daysAgo(iso) === 1 ? "yesterday" : `${daysAgo(iso)} days ago`);
/** Behind when the last read is over a week old, or is missing the last complete month. */
export const figuresBehind = (n: ReadNote | undefined, today: string) => !n || daysAgo(n.at) > 7 || n.month < lastCompleteMonth(today);

/** Every linked client's figures: when each was last read, and one button to read them all again from Xero. */
function FiguresPanel({ clients }: { clients: { Key: string; Title: string; tenant: { tenantId: string; tenantName: string } }[] }) {
  const { data, store } = useData();
  const api = useXero();
  const record = useRecordRead();
  const [busy, setBusy] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const today = todayIso();
  const run = async () => {
    const problems: string[] = [];
    let i = 0;
    for (const c of clients) {
      i++;
      setBusy(`Reading ${c.Title} (${i} of ${clients.length})…`);
      try { const d = await readAndSave(api, store, c.Key, c.tenant, (m) => setBusy(`${c.Title}: ${m}`)); await record(c.Key, d); }
      catch (e) { problems.push(`${c.Title}: ${e instanceof XeroError ? e.message : "couldn't be read or saved"}`); }
    }
    setBusy(""); setLog(problems.length ? problems : ["All read."]);
  };
  const rows = clients.map((c) => ({ c, note: readSetting<ReadNote>(data.settings, `reporting.read.${c.Key}`) }));
  const behind = rows.filter((r) => figuresBehind(r.note, today)).length;
  return (
    <div className="card pad stack" style={{ gap: 8 }}>
      <div className="row-wrap" style={{ gap: 10, alignItems: "center", justifyContent: "space-between" }}>
        <strong>All clients: latest month</strong>
        <button type="button" className="btn small" disabled={!!busy || !clients.length} onClick={() => void run()}>Read all {clients.length} again from Xero</button>
      </div>
      <span className="muted" style={{ fontSize: 12 }} aria-live="polite">{busy || (behind ? `${behind} of ${clients.length} are over a week old or missing the latest month.` : "All are up to date.")}</span>
      <div style={{ overflowX: "auto" }}>
        <table className="table" style={{ fontSize: 13 }}>
          <thead><tr><th scope="col">Client</th><th scope="col">Month</th><th scope="col" className="num">Revenue</th><th scope="col" className="num">On last year</th><th scope="col" className="num">Gross margin</th><th scope="col" className="num">Net margin</th><th scope="col" className="num">Cash</th><th scope="col" className="num">Debtor days</th><th scope="col">Alerts</th><th scope="col">Figures read</th></tr></thead>
          <tbody>{rows.map(({ c, note }) => {
            const snap = readSetting<Snapshot>(data.settings, `reporting.snap.${c.Key}`), k = snap?.k || {};
            const al = readSetting<SavedAlerts>(data.settings, `reporting.alerts.${c.Key}`);
            const alerts = al && al.month === snap?.month ? al.lines : [];
            const money = (v?: number) => (v === undefined ? "" : v < 0 ? `(£${Math.abs(Math.round(v)).toLocaleString("en-GB")})` : `£${Math.round(v).toLocaleString("en-GB")}`);
            const per = (v?: number) => (v === undefined ? "" : `${v.toFixed(1)}%`);
            const tone = (v: number | undefined, bad: boolean): React.CSSProperties | undefined => (v === undefined ? undefined : { color: bad ? "var(--red-ink, #b42318)" : undefined, fontWeight: bad ? 600 : undefined });
            return (
              <tr key={c.Key}>
                <th scope="row" style={{ fontWeight: 600 }}><a href={href("reporting", c.Key, "financials")}>{c.Title}</a></th>
                <td>{snap ? monthLabel(snap.month) : <span className="muted">Read again to fill</span>}</td>
                <td className="num">{money(k.revenue)}</td>
                <td className="num" style={tone(k.revg, (k.revg ?? 0) < 0)}>{k.revg === undefined ? "" : `${k.revg >= 0 ? "+" : "−"}${Math.abs(k.revg).toFixed(0)}%`}</td>
                <td className="num">{per(k.gpm)}</td>
                <td className="num" style={tone(k.npm, (k.npm ?? 0) < 0)}>{per(k.npm)}</td>
                <td className="num" style={tone(k.cash, (k.cash ?? 0) < 0)}>{money(k.cash)}</td>
                <td className="num">{k.ardays === undefined ? "" : Math.round(k.ardays)}</td>
                <td>{alerts.length ? <span className="chip red" title={alerts.join("\n")}>{alerts.length} alert{alerts.length === 1 ? "" : "s"}</span> : snap ? <span className="chip green">None</span> : ""}</td>
                <td className="muted">{ago(note?.at)}{figuresBehind(note, today) && <span className="chip amber" style={{ marginLeft: 6 }}>behind</span>}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
      <span className="muted" style={{ fontSize: 12 }}>Each row is the client's latest complete month when its figures were last read. Alerts are the KPI alerts you have switched on for that client.</span>
      {log.map((l) => <span key={l} className="muted" style={{ fontSize: 12 }}>{l}</span>)}
    </div>
  );
}

const fmt = (n?: number) => (n === undefined ? "" : n === 0 ? "–" : n < 0 ? `(${Math.abs(Math.round(n)).toLocaleString("en-GB")})` : Math.round(n).toLocaleString("en-GB"));
const pct = (a?: number, b?: number) => (a === undefined || b === undefined || b === 0 ? "" : `${Math.round(((a - b) / Math.abs(b)) * 100)}%`);

export function ReportingPage() {
  const { data } = useData();
  const { parts } = useRoute();
  const { tenantFor, connected } = useXeroLinks();
  const clientKey = parts[1] || "";
  const tool = parts[2] || "financials";
  const clients = data.clients.filter((c) => c.Title && tenantFor(c.Key)).sort((a, b) => String(a.Title).localeCompare(String(b.Title)));
  const client = data.clients.find((c) => c.Key === clientKey);

  const [shut, setShut] = useState<string[]>(() => {
    try { const v = localStorage.getItem("reporting.shut"); if (v) return JSON.parse(v) as string[]; } catch { /* no storage */ }
    return [];
  });
  const flip = (g: string) => setShut((a) => {
    const n = a.includes(g) ? a.filter((x) => x !== g) : [...a, g];
    try { localStorage.setItem("reporting.shut", JSON.stringify(n)); } catch { /* no storage */ }
    return n;
  });
  const linked = !!client && !!tenantFor(client.Key);

  if (!client || !linked) {
    return (
      <div className="page">
        <div className="page-head"><div><h1>Reporting</h1><p className="muted" style={{ margin: "4px 0 0" }}>Choose a client to see their figures from Xero.</p></div></div>
        <div className="row-wrap">
          <select aria-label="Client" value={clientKey} onChange={(e) => { window.location.hash = href("reporting", e.target.value, tool); }}>
            <option value="">Choose a client…</option>
            {clients.map((c) => <option key={c.Key} value={c.Key}>{c.Title}</option>)}
          </select>
        </div>
        {connected && clients.length > 0 && <FiguresPanel clients={clients.map((c) => ({ Key: c.Key, Title: String(c.Title), tenant: tenantFor(c.Key)! }))} />}
        {!connected && <div className="alert amber"><strong>Xero isn't connected</strong><span>Connect Xero in Settings › Xero, then link each client, and the reports fill from it.</span></div>}
        {connected && !clients.length && <div className="alert amber"><strong>No clients are linked to Xero yet</strong><span>Link a client's Xero organisation in Settings › Xero.</span></div>}
        {client && !linked && <div className="alert amber"><strong>This client isn't linked to Xero</strong><span>Link it in Settings › Xero first.</span></div>}
      </div>
    );
  }

  const props = { clientKey: client.Key, clientName: String(client.Title), yearEnd: client.YearEnd as string | undefined, tenant: tenantFor(client.Key)! };
  // the report builder gets a page of its own, without the tools menu
  if (tool === "reports" && parts[3]) return <ReportsScreen {...props} id={parts[3]} />;
  return (
    <>
      <header className="paper-top">
        <a className="paper-top-icon" href="#/reporting" title="Back to reporting" aria-label="Back to reporting"><Icon name="chart" size={20} /></a>
        <h1>{client.Title}</h1>
        {client.CompanyNumber && <span className="chip mono">{client.CompanyNumber}</span>}
        <span className="chip">{props.tenant.tenantName}</span>
        <a className="chip blue chip-fixed" href={href("clients", client.Key)}>Client page</a>
        <div className="paper-tools">
          <select className="input" aria-label="Client" value={clientKey} style={{ width: "auto", minHeight: 32, padding: "2px 8px" }} onChange={(e) => { window.location.hash = href("reporting", e.target.value, tool); }}>
            {clients.map((c) => <option key={c.Key} value={c.Key}>{c.Title}</option>)}
          </select>
        </div>
      </header>
      <div className="page paper-page">
        <div className="paper">
          <nav className="paper-side" aria-label="Reporting tools">
            {GROUPS.map((g) => {
              const closed = shut.includes(g.name) && !g.items.some(([k]) => k === tool);
              return (
                <div key={g.name} className="paper-group">
                  <button type="button" className="paper-group-name" aria-expanded={!closed} onClick={() => flip(g.name)}>
                    <span aria-hidden="true">{closed ? "▸" : "▾"}</span> {g.name}
                  </button>
                  {!closed && <ul>
                    {g.items.map(([k, label, icon]) => (
                      <li key={k}>
                        <button type="button" className={`paper-item${tool === k ? " on" : ""}`} aria-current={tool === k ? "true" : undefined} onClick={() => { window.location.hash = href("reporting", client.Key, k); }}>
                          <span className="paper-ico" aria-hidden="true"><Icon name={icon} size={15} /></span>
                          <span className="paper-name">{label}</span>
                        </button>
                      </li>
                    ))}
                  </ul>}
                </div>
              );
            })}
          </nav>
          <section className="paper-main stack" style={{ minWidth: 0 }}>
            {(() => { const n = readSetting<ReadNote>(data.settings, `reporting.read.${client.Key}`); return n && figuresBehind(n, todayIso()) && tool !== "settings" ? <div className="alert amber" role="status"><strong>These figures may be out of date</strong><span>They were read from Xero {ago(n.at)}{n.month < lastCompleteMonth(todayIso()) ? " and stop at an earlier month than last month" : ""}. Use Refresh from Xero on a screen below, or Read all from the Reporting home page.</span></div> : null; })()}
            {tool === "settings" ? <ReportingSettings {...props} tab={parts[3]} />
              : tool === "receivables" || tool === "payables" ? <AgedScreen clientKey={props.clientKey} clientName={props.clientName} tenant={props.tenant} kind={tool === "payables" ? "pay" : "rec"} />
              : tool === "reports" ? <ReportsScreen {...props} id={parts[3]} />
              : tool === "cashflow" ? <CashFlowScreen {...props} />
              : tool === "growth" ? <GrowthScreen {...props} />
              : tool === "trend" ? <TrendScreen {...props} />
              : tool === "goalseek" ? <GoalseekScreen {...props} />
              : tool === "profitability" ? <Profitability {...props} />
              : tool === "explorer" ? <KpiExplorer {...props} />
              : tool === "kpis" ? <KpiScreen {...props} />
              : <Financials {...props} />}
          </section>
        </div>
      </div>
    </>
  );
}

function Financials({ clientKey, clientName, yearEnd, tenant }: { clientKey: string; clientName: string; yearEnd?: string; tenant: { tenantId: string; tenantName: string } }) {
  const r = useReportData(clientKey, tenant);
  const [statement, setStatement] = useState<"pl" | "bs">("pl");
  const [kind, setKind] = useState<PeriodKind>("month");
  const [compare, setCompare] = useState<Compare>("prior");
  const [detail, setDetail] = useState<Detail>("detailed");
  const [anchor, setAnchor] = useState("");
  const endMonth = Number((/^(\d{2})-/.exec(yearEnd || "") || [])[1]) || 12;
  const d = r.data;
  // nothing saved yet for this client: read it from Xero straight away (once)
  const tried = useRef("");
  useEffect(() => {
    if (r.checked && !r.data && !r.busy && !r.error && tried.current !== clientKey) { tried.current = clientKey; void r.refresh(); }
  }, [r.checked, r.data, r.busy, r.error, clientKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const months = d?.months || [];
  const at = anchor && months.includes(anchor) ? anchor : months[months.length - 1] || "";

  const cols = useMemo(() => (at ? periodCols(kind, at, endMonth, compare) : []), [kind, at, endMonth, compare]);
  const rows = useMemo(() => {
    if (!d || !at) return [];
    const all = statement === "pl" ? plStatement(d, cols, detail) : bsStatement(d, cols, detail);
    return all.filter((r) => r.kind !== "line" || r.code === undefined || r.vals.some((v) => v)); // an account with nothing in any column isn't shown
  }, [d, at, statement, cols, detail]);
  const showVar = compare === "prior" || compare === "lastYear";
  const seg = <T extends string>(value: T, set: (v: T) => void, opts: [T, string][], label: string) => (
    <div className="seg" role="group" aria-label={label}>{opts.map(([k, l]) => <button key={k} type="button" aria-pressed={value === k} onClick={() => set(k)}>{l}</button>)}</div>
  );

  return (
    <section className="stack" style={{ gap: 12, minWidth: 0 }} aria-label="Financials">
      <div className="row-wrap" style={{ gap: 10, alignItems: "center", justifyContent: "space-between" }}>
        <div className="row-wrap" style={{ gap: 10, alignItems: "center" }}>
          <h2 className="sec-h">Financials</h2>
          <span className="muted" style={{ fontSize: 13 }}>{clientName}</span>
        </div>
        <div className="row-wrap" style={{ gap: 8, alignItems: "center" }}>
          <span className="muted" style={{ fontSize: 12 }} aria-live="polite">{r.busy || (d ? `Read from Xero ${new Date(d.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : "")}</span>
          <button type="button" className="btn small" disabled={!!r.busy} onClick={() => void r.refresh()}>{d ? "Refresh from Xero" : "Read from Xero"}</button>
        </div>
      </div>

      {r.error && <div className="alert red"><strong>Couldn't read the figures</strong><span>{r.error}</span></div>}
      {!d && r.checked && !r.busy && <div className="alert amber"><strong>The figures haven't been read from Xero yet</strong><span>Choose "Read from Xero" to bring in the last three years by month.</span></div>}
      {d?.notes.map((n) => <div key={n} className="alert amber"><span>{n}</span></div>)}

      {d && (
        <>
          <div className="row-wrap" style={{ gap: 10, alignItems: "center" }}>
            {seg(statement, setStatement, [["pl", "Profit & Loss"], ["bs", "Balance Sheet"]], "Statement")}
            <span className="muted" style={{ fontSize: 13 }}>For the</span>
            {seg(kind, setKind, [["month", "Month"], ["quarter", "Quarter"], ["year", "Year"]], "Period")}
            <span className="muted" style={{ fontSize: 13 }}>of</span>
            <select aria-label="Month" value={at} onChange={(e) => setAnchor(e.target.value)}>
              {[...months].reverse().map((m) => <option key={m} value={m}>{monthLong(m)}</option>)}
            </select>
          </div>
          <div className="row-wrap" style={{ gap: 10, alignItems: "center" }}>
            <span className="muted" style={{ fontSize: 13 }}>Compared with</span>
            {seg(compare, setCompare, [["none", "Nothing"], ["prior", "Last period"], ["lastYear", "Same period last year"], ["months", "Every month of the year"]], "Compare with")}
            <span className="muted" style={{ fontSize: 13 }}>Detail</span>
            {seg(detail, setDetail, [["summary", "Summary"], ["detailed", "Detailed"]], "Detail")}
          </div>

          <div className="card" style={{ overflowX: "auto" }}>
            <table className="grid">
              <thead>
                <tr>
                  <th style={{ textAlign: "left", position: "sticky", left: 0, background: "var(--surface)" }}>{statement === "pl" ? "PROFIT & LOSS" : "BALANCE SHEET"}</th>
                  {cols.map((c) => <th key={c.key} className="num" style={{ textAlign: "right", whiteSpace: "nowrap", fontWeight: c.total ? 700 : 600 }}>{c.label}</th>)}
                  {showVar && <><th className="num" style={{ textAlign: "right" }}>Variance £</th><th className="num" style={{ textAlign: "right" }}>Variance %</th></>}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const strong = row.kind === "total" || row.kind === "sub" || row.kind === "head";
                  const v = showVar && row.vals.length >= 2 && row.vals[0] !== undefined && row.vals[1] !== undefined ? Math.round((row.vals[0] as number) - (row.vals[1] as number)) : undefined;
                  return (
                    <tr key={i} style={{ fontWeight: strong ? 600 : 400, background: row.kind === "total" ? "var(--surface-2)" : "none" }}>
                      <td style={{ paddingLeft: row.kind === "line" && detail === "detailed" ? 32 : 16, position: "sticky", left: 0, background: row.kind === "total" ? "var(--surface-2)" : "var(--surface)" }}>{row.label}</td>
                      {cols.map((c, j) => <td key={c.key} className="num mono" style={{ textAlign: "right", fontWeight: c.total ? 700 : undefined }}>{row.kind === "head" ? "" : fmt(row.vals[j])}</td>)}
                      {showVar && <><td className="num mono" style={{ textAlign: "right" }}>{row.kind === "head" ? "" : fmt(v)}</td><td className="num mono" style={{ textAlign: "right" }}>{row.kind === "head" ? "" : pct(row.vals[0], row.vals[1])}</td></>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            Figures are shown in whole pounds (Xero holds pence, so columns can differ from their total by £1). A quarter or year is the months added together; a balance sheet is the balance at the end of the period.
            The year runs to {monthLong(`2000-${String(endMonth).padStart(2, "0")}`).slice(0, 3)} (the client's year end).
          </p>
        </>
      )}
    </section>
  );
}
