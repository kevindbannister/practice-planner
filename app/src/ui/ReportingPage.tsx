// The reporting centre: for one client, the figures from Xero laid out as reports. This first part is Financials: the profit and loss and
// balance sheet for a month, quarter or year, set beside the period before or the same period last year, or month by month across the year.
// The figures are read from Xero once (Refresh reads them again), kept on OneDrive, and worked out from the months.
import { useEffect, useMemo, useRef, useState } from "react";
import { Compare, Detail, PeriodKind, bsStatement, monthLong, periodCols, plStatement } from "../lib/reportData";
import { href, useRoute } from "./bits";
import { useData } from "./data";
import { KpiExplorer } from "./ReportingExplorer";
import { CashFlowScreen, GoalseekScreen, GrowthScreen, TrendScreen } from "./ReportingAnalysis";
import { ReportsScreen } from "./ReportingReports";
import { ReportingSettings } from "./ReportingSettings";
import { AgedScreen } from "./ReportingAged";
import { Profitability } from "./ReportingProfitability";
import { KpiScreen } from "./ReportingKpis";
import { useReportData } from "./reportingKit";
import { useXeroLinks } from "./XeroSettings";

const TOOLS: [string, string, boolean][] = [
  ["financials", "Financials", true], ["kpis", "KPIs", true], ["explorer", "KPI Explorer", true], ["profitability", "Profitability", true],
  ["cashflow", "Cash Flow", true], ["growth", "Growth", true], ["trend", "Trend", true], ["goalseek", "Goalseek", true], ["receivables", "Receivables", true], ["settings", "Settings", true], ["payables", "Payables", true], ["reports", "Reports", true],
];

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

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="row-wrap" style={{ gap: 12, alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>Reporting</h1>
        <select aria-label="Client" value={clientKey} onChange={(e) => { window.location.hash = href("reporting", e.target.value, tool); }}>
          <option value="">Choose a client…</option>
          {clients.map((c) => <option key={c.Key} value={c.Key}>{c.Title}</option>)}
        </select>
      </div>
      {!connected && <div className="alert amber"><strong>Xero isn't connected</strong><span>Connect Xero in Settings › Xero, then link each client, and the reports fill from it.</span></div>}
      {connected && !clients.length && <div className="alert amber"><strong>No clients are linked to Xero yet</strong><span>Link a client's Xero organisation in Settings › Xero.</span></div>}
      {client && tenantFor(client.Key) && (
        <div style={{ display: "grid", gridTemplateColumns: "180px minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
          <nav aria-label="Reports" className="stack" style={{ gap: 2 }}>
            {TOOLS.map(([k, label, ready]) => ready
              ? <a key={k} href={href("reporting", client.Key, k)} aria-current={tool === k ? "page" : undefined} style={{ padding: "6px 10px", borderRadius: 6, fontWeight: tool === k ? 600 : 400, background: tool === k ? "var(--soft, #eef2f7)" : "none" }}>{label}</a>
              : <span key={k} className="muted" style={{ padding: "6px 10px", fontSize: 13 }}>{label} <span style={{ fontSize: 11 }}>· next</span></span>)}
          </nav>
          {tool === "settings" ? <ReportingSettings clientKey={client.Key} clientName={String(client.Title)} yearEnd={client.YearEnd as string | undefined} tenant={tenantFor(client.Key)!} tab={parts[3]} />
            : tool === "receivables" || tool === "payables" ? <AgedScreen clientKey={client.Key} clientName={String(client.Title)} tenant={tenantFor(client.Key)!} kind={tool === "payables" ? "pay" : "rec"} />
            : tool === "reports" ? <ReportsScreen clientKey={client.Key} clientName={String(client.Title)} yearEnd={client.YearEnd as string | undefined} tenant={tenantFor(client.Key)!} id={parts[3]} />
            : tool === "cashflow" ? <CashFlowScreen clientKey={client.Key} clientName={String(client.Title)} yearEnd={client.YearEnd as string | undefined} tenant={tenantFor(client.Key)!} />
            : tool === "growth" ? <GrowthScreen clientKey={client.Key} clientName={String(client.Title)} yearEnd={client.YearEnd as string | undefined} tenant={tenantFor(client.Key)!} />
            : tool === "trend" ? <TrendScreen clientKey={client.Key} clientName={String(client.Title)} yearEnd={client.YearEnd as string | undefined} tenant={tenantFor(client.Key)!} />
            : tool === "goalseek" ? <GoalseekScreen clientKey={client.Key} clientName={String(client.Title)} yearEnd={client.YearEnd as string | undefined} tenant={tenantFor(client.Key)!} />
            : tool === "profitability"
            ? <Profitability clientKey={client.Key} clientName={String(client.Title)} yearEnd={client.YearEnd as string | undefined} tenant={tenantFor(client.Key)!} />
            : tool === "explorer"
            ? <KpiExplorer clientKey={client.Key} clientName={String(client.Title)} yearEnd={client.YearEnd as string | undefined} tenant={tenantFor(client.Key)!} />
            : tool === "kpis"
            ? <KpiScreen clientKey={client.Key} clientName={String(client.Title)} yearEnd={client.YearEnd as string | undefined} tenant={tenantFor(client.Key)!} />
            : <Financials clientKey={client.Key} clientName={String(client.Title)} yearEnd={client.YearEnd as string | undefined} tenant={tenantFor(client.Key)!} />}
        </div>
      )}
      {client && !tenantFor(client.Key) && <div className="alert amber"><strong>This client isn't linked to Xero</strong><span>Link it in Settings › Xero first.</span></div>}
    </div>
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
          <h2 style={{ margin: 0 }}>Financials</h2>
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
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "2px solid var(--line, #cbd5e1)" }}>
                  <th style={{ textAlign: "left", padding: "8px 12px", position: "sticky", left: 0, background: "var(--card, #fff)" }}>{statement === "pl" ? "PROFIT & LOSS" : "BALANCE SHEET"}</th>
                  {cols.map((c) => <th key={c.key} className="num" style={{ textAlign: "right", padding: "8px 10px", whiteSpace: "nowrap", fontWeight: c.total ? 700 : 600 }}>{c.label}</th>)}
                  {showVar && <><th className="num" style={{ textAlign: "right", padding: "8px 10px" }}>Variance £</th><th className="num" style={{ textAlign: "right", padding: "8px 10px" }}>Variance %</th></>}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const strong = row.kind === "total" || row.kind === "sub" || row.kind === "head";
                  const v = showVar && row.vals.length >= 2 && row.vals[0] !== undefined && row.vals[1] !== undefined ? Math.round((row.vals[0] as number) - (row.vals[1] as number)) : undefined;
                  return (
                    <tr key={i} style={{ borderTop: row.kind === "total" || row.kind === "sub" ? "1px solid var(--line, #cbd5e1)" : "1px solid var(--line-soft, #eef2f7)", fontWeight: strong ? 600 : 400, background: row.kind === "total" ? "var(--soft, #f4f7fb)" : "none" }}>
                      <td style={{ padding: "5px 12px", paddingLeft: row.kind === "line" && detail === "detailed" ? 24 : 12, position: "sticky", left: 0, background: row.kind === "total" ? "var(--soft, #f4f7fb)" : "var(--card, #fff)" }}>{row.label}</td>
                      {cols.map((c, j) => <td key={c.key} className="num mono" style={{ textAlign: "right", padding: "5px 10px", fontWeight: c.total ? 700 : undefined }}>{row.kind === "head" ? "" : fmt(row.vals[j])}</td>)}
                      {showVar && <><td className="num mono" style={{ textAlign: "right", padding: "5px 10px" }}>{row.kind === "head" ? "" : fmt(v)}</td><td className="num mono" style={{ textAlign: "right", padding: "5px 10px" }}>{row.kind === "head" ? "" : pct(row.vals[0], row.vals[1])}</td></>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            Figures are whole pounds, as Xero holds them by month. A quarter or year is the months added together; a balance sheet is the balance at the end of the period.
            The year runs to {monthLong(`2000-${String(endMonth).padStart(2, "0")}`).slice(0, 3)} (the client's year end).
          </p>
        </>
      )}
    </section>
  );
}
