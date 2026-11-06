// Reporting › Profitability: the breakeven chart. Revenue climbs against total costs (cost of sales rising with sales, on top of the fixed
// expenses); where they cross is the breakeven point, and the gap between today's revenue and that point is the margin of safety.
import { useEffect, useMemo, useRef, useState } from "react";
import { breakeven } from "../lib/profitability";
import { PeriodKind, monthLong } from "../lib/reportData";
import { Seg, useReportData } from "./reportingKit";

const gbp = (n?: number) => (n === undefined ? "–" : `${n < 0 ? "-" : ""}£${Math.abs(Math.round(n)).toLocaleString("en-GB")}`);
const GREEN = "#8fb35a", RED = "#d0342c", DARK = "#2b2f33";
const W = 640, H = 420, L = 56, T = 16, B = 28, Rm = 16;

export function Profitability({ clientKey, clientName, yearEnd, tenant }: { clientKey: string; clientName: string; yearEnd?: string; tenant: { tenantId: string; tenantName: string } }) {
  const r = useReportData(clientKey, tenant);
  const [kind, setKind] = useState<PeriodKind>("year");
  const [anchor, setAnchor] = useState("");
  const [open, setOpen] = useState<"" | "rev" | "cost">("");
  const endMonth = Number((/^(\d{2})-/.exec(yearEnd || "") || [])[1]) || 12;
  const d = r.data;
  const months = d?.months || [];
  const at = anchor && months.includes(anchor) ? anchor : months[months.length - 1] || "";
  const tried = useRef("");
  useEffect(() => {
    if (r.checked && !r.data && !r.busy && !r.error && tried.current !== clientKey) { tried.current = clientKey; void r.refresh(); }
  }, [r.checked, r.data, r.busy, r.error, clientKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const b = useMemo(() => (d && at ? breakeven(d, kind, at, endMonth) : undefined), [d, at, kind, endMonth]);

  const chart = useMemo(() => {
    if (!b) return undefined;
    const xmax = Math.max(b.revenue * 1.35, (b.breakeven || 0) * 1.5, 1);
    const ymax = Math.max(xmax, b.fixed + b.variablePerPound * xmax, 1);
    const x = (v: number) => L + (v / xmax) * (W - L - Rm), y = (v: number) => H - B - (v / ymax) * (H - T - B);
    const steps = Array.from({ length: 21 }, (_, i) => (xmax * i) / 20);
    const cost = (v: number) => b.fixed + b.variablePerPound * v;
    const ticks = Array.from({ length: 5 }, (_, i) => (ymax * (i + 1)) / 5);
    return { x, y, steps, cost, ticks };
  }, [b]);

  return (
    <section className="stack" style={{ gap: 12, minWidth: 0 }} aria-label="Profitability">
      <div className="row-wrap" style={{ gap: 10, alignItems: "center", justifyContent: "space-between" }}>
        <div className="row-wrap" style={{ gap: 10, alignItems: "center" }}>
          <h2 className="sec-h">Profitability</h2>
          <span className="muted" style={{ fontSize: 13 }}>{clientName}</span>
        </div>
        <div className="row-wrap" style={{ gap: 8, alignItems: "center" }}>
          <span className="muted" style={{ fontSize: 12 }} aria-live="polite">{r.busy || (d ? `Read from Xero ${new Date(d.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : "")}</span>
          <button type="button" className="btn small" disabled={!!r.busy} onClick={() => void r.refresh()}>{d ? "Refresh from Xero" : "Read from Xero"}</button>
        </div>
      </div>
      {r.error && <div className="alert red"><strong>Couldn't read the figures</strong><span>{r.error}</span></div>}
      {d && b && chart && (
        <>
          <div className="row-wrap" style={{ gap: 10, alignItems: "center" }}>
            <span className="muted" style={{ fontSize: 13 }}>For the</span>
            <Seg value={kind} set={setKind} opts={[["month", "Month"], ["quarter", "Quarter"], ["year", "Year"]]} label="Period" />
            <span className="muted" style={{ fontSize: 13 }}>of</span>
            <select aria-label="Month" value={at} onChange={(e) => setAnchor(e.target.value)}>
              {[...months].reverse().map((m) => <option key={m} value={m}>{monthLong(m)}</option>)}
            </select>
          </div>
          <div className="row-wrap" style={{ gap: 16 }}>
            {([["Gross profit", b.gross], ["Operating profit", b.operating], ["Net profit", b.net]] as const).map(([l, v]) => (
              <div key={l} style={{ flex: "1 1 160px", borderBottom: "1px solid var(--line, #cbd5e1)", display: "flex", justifyContent: "space-between", alignItems: "baseline", paddingBottom: 4 }}>
                <span className="muted" style={{ fontSize: 11, letterSpacing: 1 }}>{l.toUpperCase()}</span><span style={{ fontSize: 22 }}>{gbp(v)}</span>
              </div>
            ))}
          </div>
          <div className="card pad" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 260px", gap: 20, alignItems: "start" }}>
            <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Breakeven chart: revenue against total costs" style={{ width: "100%", height: "auto" }}>
              <rect x={L} y={T} width={W - L - Rm} height={H - T - B} fill="#fff" stroke="#eef1f4" />
              {chart.ticks.map((t) => <g key={t}><line x1={L} x2={W - Rm} y1={chart.y(t)} y2={chart.y(t)} stroke="#eef1f4" /><text x={L - 6} y={chart.y(t)} fontSize={10} fill="#6b7785" textAnchor="end" dominantBaseline="middle">{t >= 1e6 ? `£${(t / 1e6).toFixed(1)}M` : `£${Math.round(t / 1000)}k`}</text></g>)}
              <rect x={L} y={chart.y(b.fixed)} width={W - L - Rm} height={H - B - chart.y(b.fixed)} fill="#f5f6f7" />
              {b.breakeven !== undefined && b.revenue > b.breakeven && (
                <polygon fill="#dce8cc" points={`${chart.x(b.breakeven)},${chart.y(b.breakeven)} ${chart.x(b.revenue)},${chart.y(b.revenue)} ${chart.x(b.revenue)},${chart.y(chart.cost(b.revenue))}`} />
              )}
              <polyline fill="none" stroke={DARK} strokeWidth={1.5} points={`${L},${chart.y(b.fixed)} ${W - Rm},${chart.y(b.fixed)}`} />
              <polyline fill="none" stroke={RED} strokeWidth={1.5} points={chart.steps.map((v) => `${chart.x(v)},${chart.y(chart.cost(v))}`).join(" ")} />
              <polyline fill="none" stroke={GREEN} strokeWidth={1.5} points={chart.steps.map((v) => `${chart.x(v)},${chart.y(v)}`).join(" ")} />
              {chart.steps.map((v, i) => <g key={i}><circle cx={chart.x(v)} cy={chart.y(v)} r={2.5} fill={GREEN} /><circle cx={chart.x(v)} cy={chart.y(chart.cost(v))} r={2.5} fill={RED} /><circle cx={chart.x(v)} cy={chart.y(b.fixed)} r={2.5} fill={DARK} /></g>)}
              {b.breakeven !== undefined && <circle cx={chart.x(b.breakeven)} cy={chart.y(b.breakeven)} r={6} fill="#fff" stroke={DARK} strokeWidth={3} />}
              <circle cx={chart.x(b.revenue)} cy={chart.y(b.revenue)} r={6} fill="#fff" stroke={GREEN} strokeWidth={3} />
              <circle cx={chart.x(b.revenue)} cy={chart.y(chart.cost(b.revenue))} r={6} fill="#fff" stroke={RED} strokeWidth={3} />
              {([["REVENUE", GREEN, chart.x(chart.steps[16]), chart.y(chart.steps[16]) - 26], ["VARIABLE COSTS", RED, chart.x(chart.steps[17]), chart.y(chart.cost(chart.steps[17])) + 30], ["FIXED COSTS", DARK, chart.x(chart.steps[17]), chart.y(b.fixed) + 46]] as const).map(([t, c, x, y]) => (
                <g key={t}><rect x={x - 46} y={y - 11} width={92} height={22} rx={11} fill={c} /><text x={x} y={y} fontSize={10} fill="#fff" textAnchor="middle" dominantBaseline="central">{t}</text></g>
              ))}
              <text x={W / 2} y={H - 6} fontSize={10} fill="#6b7785" textAnchor="middle">Revenue</text>
            </svg>
            <div className="stack" style={{ gap: 10 }}>
              <h3 style={{ margin: 0, borderBottom: "1px solid var(--line, #cbd5e1)", paddingBottom: 4 }}>Breakeven</h3>
              <Stat colour={GREEN} label="Revenue" value={gbp(b.revenue)} link="Top ten Revenue accounts" onLink={() => setOpen(open === "rev" ? "" : "rev")} />
              {open === "rev" && <Top rows={b.topRevenue} />}
              <Stat colour={RED} label="Total costs" value={gbp(b.totalCosts)} link="Top ten Expense and COS accounts" onLink={() => setOpen(open === "cost" ? "" : "cost")} />
              {open === "cost" && <Top rows={b.topCosts} />}
              <Stat colour={DARK} label="Breakeven point" value={b.breakeven === undefined ? "Not reached" : gbp(b.breakeven)} />
              <div><div className="muted" style={{ fontSize: 11, letterSpacing: 1 }}>MARGIN OF SAFETY</div><div style={{ fontSize: 22 }}>{gbp(b.marginOfSafety)}</div>{b.marginPct !== undefined && <div className="muted" style={{ fontSize: 12 }}>{b.marginPct}% of revenue</div>}</div>
              <div><div className="muted" style={{ fontSize: 11, letterSpacing: 1 }}>VARIABLE COSTS</div><div style={{ fontSize: 13 }}>£{b.variablePerPound.toFixed(2)} per £1 of Revenue</div></div>
              <div><div className="muted" style={{ fontSize: 11, letterSpacing: 1 }}>FIXED COSTS</div><div style={{ fontSize: 13 }}>{gbp(b.fixed)}</div></div>
            </div>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>Cost of sales is treated as the cost that rises with revenue and the expenses as fixed. Breakeven is the revenue at which gross profit just covers the expenses.</p>
        </>
      )}
    </section>
  );
}

function Stat({ colour, label, value, link, onLink }: { colour: string; label: string; value: string; link?: string; onLink?: () => void }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 11, letterSpacing: 1, display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 5, border: `3px solid ${colour}`, display: "inline-block" }} />{label.toUpperCase()}</div>
      <div style={{ fontSize: 22 }}>{value}</div>
      {link && <button type="button" className="link" style={{ fontSize: 11, background: "none", border: 0, padding: 0, textDecoration: "underline dotted", cursor: "pointer", color: "inherit" }} onClick={onLink}>{link}</button>}
    </div>
  );
}
function Top({ rows }: { rows: { name: string; amount: number }[] }) {
  return <table className="grid"><tbody>{rows.map((x) => <tr key={x.name}><td>{x.name}</td><td className="num mono" style={{ textAlign: "right" }}>{gbp(x.amount)}</td></tr>)}</tbody></table>;
}
