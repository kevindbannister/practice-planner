// Reporting › Cash Flow, Growth, Trend and Goalseek. Each reads the same monthly figures as Financials and KPIs (kept on OneDrive, read from
// Xero with Refresh) and draws one analysis: the cash waterfall, the growth trail, trend lines by month, and the goal levers.
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { GOAL_METRICS, GoalMetric, LEVERS, Levers, MEASURES, NO_CHANGE, PREDEFINED, cashFlow, contributions, financialYears, goalBase, goalValue, growthTrail, measureById, monthlySeries, soloChange, trendRange } from "../lib/analysis";
import { PeriodKind, monthLabel, monthLong } from "../lib/reportData";
import { Seg, useReportData } from "./reportingKit";

type Tenant = { tenantId: string; tenantName: string };
type Props = { clientKey: string; clientName: string; yearEnd?: string; tenant: Tenant };
const endMonthOf = (yearEnd?: string) => Number((/^(\d{2})-/.exec(yearEnd || "") || [])[1]) || 12;
const gbp = (n?: number) => (n === undefined ? "–" : `${n < 0 ? "-" : ""}£${Math.abs(Math.round(n)).toLocaleString("en-GB")}`);
const short = (n: number) => { const a = Math.abs(n), s = n < 0 ? "-" : ""; return a >= 1e6 ? `${s}£${+(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `${s}£${+(a / 1e3).toFixed(1)}K` : `${s}£${Math.round(a)}`; };

/** The client's figures, read from Xero straight away when nothing is saved yet; and the title bar with Refresh. */
function useScreen(clientKey: string, tenant: Tenant) {
  const r = useReportData(clientKey, tenant);
  const tried = useRef("");
  useEffect(() => {
    if (r.checked && !r.data && !r.busy && !r.error && tried.current !== clientKey) { tried.current = clientKey; void r.refresh(); }
  }, [r.checked, r.data, r.busy, r.error, clientKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return r;
}
function Frame({ title, clientName, r, children }: { title: string; clientName: string; r: ReturnType<typeof useReportData>; children: ReactNode }) {
  const d = r.data;
  return (
    <section className="stack" style={{ gap: 12, minWidth: 0 }} aria-label={title}>
      <div className="row-wrap" style={{ gap: 10, alignItems: "center", justifyContent: "space-between" }}>
        <div className="row-wrap" style={{ gap: 10, alignItems: "center" }}><h2 className="sec-h">{title}</h2><span className="muted" style={{ fontSize: 13 }}>{clientName}</span></div>
        <div className="row-wrap" style={{ gap: 8, alignItems: "center" }}>
          <span className="muted" style={{ fontSize: 12 }} aria-live="polite">{r.busy || (d ? `Read from Xero ${new Date(d.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : "")}</span>
          <button type="button" className="btn small" disabled={!!r.busy} onClick={() => void r.refresh()}>{d ? "Refresh from Xero" : "Read from Xero"}</button>
        </div>
      </div>
      {r.error && <div className="alert red"><strong>Couldn't read the figures</strong><span>{r.error}</span></div>}
      {d && children}
    </section>
  );
}
function MonthSelect({ months, at, set, label = "Month" }: { months: string[]; at: string; set: (m: string) => void; label?: string }) {
  return <select aria-label={label} value={at} onChange={(e) => set(e.target.value)}>{[...months].reverse().map((m) => <option key={m} value={m}>{monthLong(m)}</option>)}</select>;
}
const Lbl = ({ children }: { children: ReactNode }) => <span className="muted" style={{ fontSize: 13 }}>{children}</span>;
const pick = (months: string[], anchor: string) => (anchor && months.includes(anchor) ? anchor : months[months.length - 1] || "");

// ------------------------------------------------------------------ cash flow

export function CashFlowScreen({ clientKey, clientName, yearEnd, tenant }: Props) {
  const r = useScreen(clientKey, tenant);
  const [kind, setKind] = useState<PeriodKind>("month");
  const [anchor, setAnchor] = useState("");
  const d = r.data, months = d?.months || [], at = pick(months, anchor), endMonth = endMonthOf(yearEnd);
  const cf = useMemo(() => (d && at ? cashFlow(d, kind, at, endMonth) : undefined), [d, at, kind, endMonth]);

  const layout = useMemo(() => {
    if (!cf) return undefined;
    type Row = { kind: "line"; i: number; from: number; to: number; y: number } | { kind: "total"; label: string; v: number; y: number };
    const rows: Row[] = [];
    let cum = 0, y = 0;
    cf.lines.forEach((l, i) => {
      if (l.gapBefore) y += 14;
      rows.push({ kind: "line", i, from: cum, to: cum + l.amount, y }); cum += l.amount; y += 24;
      for (const t of cf.totals) if (t.after === i) { rows.push({ kind: "total", label: t.total.label, v: t.total.amount, y: y + 4 }); y += 40; }
    });
    const vals = rows.flatMap((x) => (x.kind === "line" ? [x.from, x.to] : [x.v])).concat(0);
    return { rows, height: y + 8, min: Math.min(...vals), max: Math.max(...vals) };
  }, [cf]);

  const LW = 330, CW = 560, W = LW + CW + 20;
  return (
    <Frame title="Cash Flow" clientName={clientName} r={r}>
      <div className="row-wrap" style={{ gap: 10, alignItems: "center" }}>
        <Lbl>For the</Lbl><Seg value={kind} set={setKind} opts={[["month", "Month"], ["quarter", "Quarter"], ["year", "Year"]]} label="Period" /><Lbl>of</Lbl><MonthSelect months={months} at={at} set={setAnchor} />
      </div>
      {!cf && <div className="alert amber"><strong>No cash flow for this period</strong><span>It needs the balance sheet for the period and the month before it. Choose Refresh from Xero (and reconnect Xero in Settings if the balance sheet was refused).</span></div>}
      {cf?.unexplainedBig && <div className="alert amber"><strong>The cash flow doesn't fully add up</strong><span>£{Math.abs(Math.round(cf.unexplained)).toLocaleString("en-GB")} of the movement in cash isn't explained by the profit and loss and the balance sheet (the "Unexplained difference" line). An account may be in the wrong group, or entries may have been made to a closed period.</span></div>}
      {cf && layout && (
        <>
          <div className="row-wrap" style={{ gap: 16 }}>
            {([["Operating cash flow", cf.operating], ["Free cash flow", cf.free], ["Net cash flow", cf.net]] as const).map(([l, v]) => (
              <div key={l} style={{ flex: "1 1 180px", borderBottom: "1px solid var(--line, #cbd5e1)", display: "flex", justifyContent: "space-between", alignItems: "baseline", paddingBottom: 4 }}>
                <span className="muted" style={{ fontSize: 11, letterSpacing: 1 }}>{l.toUpperCase()}</span><span style={{ fontSize: 22 }}>{gbp(v)}</span>
              </div>
            ))}
          </div>
          <div className="card pad" style={{ overflowX: "auto" }}>
            <div className="row-wrap" style={{ gap: 16, fontSize: 12, marginBottom: 6 }}>
              <span><span style={{ display: "inline-block", width: 10, height: 10, background: "#8fb35a", marginRight: 6 }} />Cash Received</span>
              <span><span style={{ display: "inline-block", width: 10, height: 10, background: "#d0342c", marginRight: 6 }} />Cash Spent</span>
            </div>
            <svg viewBox={`0 0 ${W} ${layout.height + 24}`} style={{ width: "100%", minWidth: 720, height: "auto" }} role="img" aria-label="Cash flow waterfall">
              {(() => {
                const span = layout.max - layout.min || 1, x = (v: number) => LW + 10 + ((v - layout.min) / span) * CW;
                const ticks = Array.from({ length: 5 }, (_, i) => layout.min + (span * i) / 4);
                return (
                  <g transform="translate(0,22)">
                    {ticks.map((t, i) => <g key={i}><line x1={x(t)} x2={x(t)} y1={-6} y2={layout.height} stroke="#eef1f4" /><text x={x(t)} y={-10} fontSize={9} fill="#6b7785" textAnchor="middle">{short(t)}</text></g>)}
                    <line x1={x(0)} x2={x(0)} y1={-6} y2={layout.height} stroke="#9aa5b1" strokeDasharray="2 3" />
                    {layout.rows.map((row, k) => {
                      if (row.kind === "total") {
                        return (
                          <g key={k}>
                            <rect x={0} y={row.y - 4} width={LW - 20} height={26} fill="#eef0f2" /><text x={12} y={row.y + 9} fontSize={11} fill="#59636e" dominantBaseline="middle">{row.label}</text>
                            <text x={x(row.v) + 10} y={row.y + 9} fontSize={20} fontWeight={500} dominantBaseline="middle" fill="#111">{gbp(row.v)}</text>
                          </g>
                        );
                      }
                      const l = cf.lines[row.i], a = Math.min(row.from, row.to), b = Math.max(row.from, row.to), w = Math.max(x(b) - x(a), 2), green = l.amount >= 0;
                      const text = gbp(l.amount), inside = w > 70 && l.amount !== 0;
                      return (
                        <g key={k}>
                          <text x={0} y={row.y + 9} fontSize={9} fill="#9aa5b1" dominantBaseline="middle">{l.tag}</text>
                          <text x={34} y={row.y + 9} fontSize={11} fill="#222" dominantBaseline="middle">{l.label}</text>
                          {l.amount !== 0 && <rect x={x(a)} y={row.y} width={w} height={18} fill={green ? "#8fb35a" : "#d0342c"} />}
                          <text x={inside ? x(a) + w / 2 : green ? x(b) + 6 : x(a) - 6} y={row.y + 9} fontSize={10} dominantBaseline="middle" fill={inside ? "#fff" : "#59636e"} textAnchor={inside ? "middle" : green ? "start" : "end"}>{text}</text>
                        </g>
                      );
                    })}
                  </g>
                );
              })()}
            </svg>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            Net cash flow can also be calculated as: change in cash on hand {gbp(cf.cash.close - cf.cash.open)} (open {gbp(cf.cash.open)}, close {gbp(cf.cash.close)}) less change in debt {gbp(cf.debt.close - cf.debt.open)} (open {gbp(cf.debt.open)}, close {gbp(cf.debt.close)}).
            Depreciation and amortisation are taken out of expenses, interest and tax charges are shown on their own lines, and Adjustments is whatever is left to make the lines agree with the bank.
          </p>
        </>
      )}
    </Frame>
  );
}

// ------------------------------------------------------------------ growth

export function GrowthScreen({ clientKey, clientName, tenant }: Props) {
  const r = useScreen(clientKey, tenant);
  const [anchor, setAnchor] = useState(""), [from, setFrom] = useState("");
  const [xId, setXId] = useState("invest"), [yId, setYId] = useState("operating");
  const d = r.data, months = d?.months || [], at = pick(months, anchor);
  const start = from && months.includes(from) && from < at ? from : months.filter((m) => m <= at).slice(-13)[0] || at;
  const money = MEASURES.filter((m) => m.unit === "money" && (!m.balance || d?.bs.length));
  const trail = useMemo(() => (d ? growthTrail(d, xId, yId, start, at).filter((t) => t.x !== undefined && t.y !== undefined) : []), [d, xId, yId, start, at]);
  const W = 660, H = 520, L = 70, T = 20, Rm = 20, B = 40;
  const xs = trail.map((t) => t.x as number), ys = trail.map((t) => t.y as number);
  const pad = (lo: number, hi: number) => { const p = (hi - lo || Math.abs(hi) || 1) * 0.12; return [lo - p, hi + p]; };
  const [x0, x1] = pad(Math.min(...xs), Math.max(...xs)), [y0, y1] = pad(Math.min(...ys), Math.max(...ys));
  const X = (v: number) => L + ((v - x0) / (x1 - x0)) * (W - L - Rm), Y = (v: number) => H - B - ((v - y0) / (y1 - y0)) * (H - T - B);
  const xl = measureById(xId)?.label.toUpperCase(), yl = measureById(yId)?.label.toUpperCase();
  const first = trail[0];
  return (
    <Frame title="Growth" clientName={clientName} r={r}>
      <div className="row-wrap" style={{ gap: 10, alignItems: "center" }}>
        <Lbl>Comparing</Lbl>
        <select aria-label="Up and down" value={yId} onChange={(e) => setYId(e.target.value)}>{money.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
        <Lbl>vs</Lbl>
        <select aria-label="Across" value={xId} onChange={(e) => setXId(e.target.value)}>{money.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
        <Lbl>from</Lbl><MonthSelect months={months.filter((m) => m < at)} at={start} set={setFrom} label="From month" />
        <Lbl>up to the month of</Lbl><MonthSelect months={months} at={at} set={setAnchor} label="To month" />
      </div>
      {trail.length < 2 ? <div className="alert amber"><span>Not enough months to draw a trail for these two measures.</span></div> : (
        <div className="card pad" style={{ display: "grid", justifyItems: "center" }}>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: 720, height: "auto" }} role="img" aria-label={`${yl} against ${xl}, month by month`}>
            <rect x={L} y={T} width={W - L - Rm} height={H - T - B} fill="#fff" stroke="#eef1f4" />
            <line x1={X(first.x as number)} x2={X(first.x as number)} y1={T} y2={H - B} stroke="#e2e6ea" />
            <line x1={L} x2={W - Rm} y1={Y(first.y as number)} y2={Y(first.y as number)} stroke="#e2e6ea" />
            {([["EFFICIENCY GAINS", 0, 0], ["QUALITY GROWTH", 1, 0], ["DECLINE", 0, 1], ["STRESS", 1, 1]] as const).map(([t, cx, cy]) => {
              const xa = cx ? X(first.x as number) : L, xb = cx ? W - Rm : X(first.x as number), ya = cy ? Y(first.y as number) : T, yb = cy ? H - B : Y(first.y as number);
              return <text key={t} x={(xa + xb) / 2} y={(ya + yb) / 2} fontSize={11} fill="#8a949e" textAnchor="middle" letterSpacing={0.5}>{t}</text>;
            })}
            <text x={(L + W - Rm) / 2} y={T + (H - T - B) / 2 + 20} fontSize={54} fill="#000" opacity={0.05} textAnchor="middle" fontWeight={600}>{monthLong(at)}</text>
            <polyline fill="none" stroke="#ececec" strokeWidth={14} strokeLinejoin="round" strokeLinecap="round" points={trail.map((t) => `${X(t.x as number)},${Y(t.y as number)}`).join(" ")} />
            {trail.map((t, i) => (
              <circle key={t.month} cx={X(t.x as number)} cy={Y(t.y as number)} r={4 + (6 * i) / (trail.length - 1)} fill={i >= trail.length - 2 ? "#8fb35a" : "#f5c32c"}>
                <title>{`${monthLong(t.month)}: ${xl} ${gbp(t.x)}, ${yl} ${gbp(t.y)}`}</title>
              </circle>
            ))}
            {[0, 0.5, 1].map((f) => <text key={f} x={L - 6} y={Y(y0 + (y1 - y0) * f)} fontSize={9} fill="#6b7785" textAnchor="end" dominantBaseline="middle">{short(y0 + (y1 - y0) * f)}</text>)}
            {[0, 0.5, 1].map((f) => <text key={f} x={X(x0 + (x1 - x0) * f)} y={H - B + 14} fontSize={9} fill="#6b7785" textAnchor="middle">{short(x0 + (x1 - x0) * f)}</text>)}
            <text x={(L + W - Rm) / 2} y={H - 6} fontSize={10} fill="#59636e" textAnchor="middle" letterSpacing={1}>{xl}</text>
            <text transform={`translate(14 ${(T + H - B) / 2}) rotate(-90)`} fontSize={10} fill="#59636e" textAnchor="middle" letterSpacing={1}>{yl}</text>
          </svg>
        </div>
      )}
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>Each dot is a month, from {monthLong(start)} to {monthLong(at)}; the dots grow and turn green as they get more recent. The lines cross at the first month, so a dot in the top right is growth on both counts.</p>
    </Frame>
  );
}

// ------------------------------------------------------------------ trend

const LINE = ["#3b82c4", "#d0342c", "#8fb35a", "#7a3b8f", "#f0a020", "#2b2f33"];
export function TrendScreen({ clientKey, clientName, yearEnd, tenant }: Props) {
  const r = useScreen(clientKey, tenant);
  const [anchor, setAnchor] = useState(""), [ids, setIds] = useState<string[]>(["revenue"]), [show, setShow] = useState("13");
  const d = r.data, months = d?.months || [], at = pick(months, anchor), endMonth = endMonthOf(yearEnd);
  const unit = measureById(ids[0])?.unit || "money";
  const range = useMemo(() => (d ? trendRange(months, at, show, endMonth) : []), [d, months, at, show, endMonth]);
  const series = useMemo(() => (d ? ids.map((id) => { const s = monthlySeries(d, id); return range.map((m) => s.find((x) => x.month === m)?.value); }) : []), [d, ids, range]);
  const fyears = financialYears(months, endMonth);
  const fmt = (v?: number) => (v === undefined ? "–" : unit === "percent" ? `${v.toLocaleString("en-GB", { maximumFractionDigits: 2 })}%` : unit === "money" ? gbp(v) : String(v));
  const axis = (n: number) => (unit === "percent" ? `${+n.toFixed(1)}%` : short(n));
  const all = series.flat().filter((v): v is number => v !== undefined);
  const lo0 = all.length ? Math.min(...all) : 0, hi0 = all.length ? Math.max(...all) : 1;
  const padv = (hi0 - lo0 || Math.abs(hi0) || 1) * 0.1, lo = lo0 - padv, hi = hi0 + padv;
  const W = 900, H = 340, L = 56, T = 12, B = 30, Rm = 14;
  const X = (i: number) => L + (range.length < 2 ? 0 : (i / (range.length - 1)) * (W - L - Rm)), Y = (v: number) => H - B - ((v - lo) / (hi - lo)) * (H - T - B);
  const addable = MEASURES.filter((m) => m.unit === unit && !ids.includes(m.id) && (!m.balance || d?.bs.length));
  return (
    <Frame title="Trend" clientName={clientName} r={r}>
      <div className="row-wrap" style={{ gap: 10, alignItems: "center", justifyContent: "space-between" }}>
        <div className="row-wrap" style={{ gap: 8, alignItems: "center" }}>
          <Lbl>Showing</Lbl>
          {ids.map((id, i) => (
            <span key={id} className="chip" style={{ display: "inline-flex", gap: 6, alignItems: "center", border: "1px solid var(--line, #cbd5e1)", borderRadius: 14, padding: "2px 10px", fontSize: 13 }}>
              <span style={{ width: 10, height: 10, borderRadius: 5, background: LINE[i % LINE.length] }} />{measureById(id)?.label}
              {ids.length > 1 && <button type="button" aria-label={`Remove ${measureById(id)?.label}`} onClick={() => setIds(ids.filter((x) => x !== id))} style={{ border: 0, background: "none", cursor: "pointer" }}>×</button>}
            </span>
          ))}
          {addable.length > 0 && ids.length < LINE.length && (
            <select aria-label="Add a measure" value="" onChange={(e) => e.target.value && setIds([...ids, e.target.value])}><option value="">+ Add</option>{addable.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
          )}
        </div>
        <div className="row-wrap" style={{ gap: 8, alignItems: "center" }}>
          <select aria-label="Predefined chart" value="" onChange={(e) => { const p = PREDEFINED.find((x) => x.name === e.target.value); if (p) setIds(p.ids.filter((id) => !measureById(id)?.balance || d?.bs.length)); }}>
            <option value="">Select a predefined chart</option>{PREDEFINED.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
          </select>
          <Lbl>Up to the month of</Lbl><MonthSelect months={months} at={at} set={setAnchor} />
        </div>
      </div>
      <div className="row-wrap" style={{ gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
        <Lbl>Show:</Lbl>
        <Seg value={show} set={setShow} opts={[["13", "13 months"], ...fyears.map((y): [string, string] => [String(y), `${String(y - 1).slice(2)}/${String(y).slice(2)}`]), ["all", "All"]]} label="Range" />
      </div>
      {all.length === 0 ? <div className="alert amber"><span>Nothing to show for these months. Balance sheet measures need the balance sheet read from Xero.</span></div> : (
        <div className="card pad" style={{ overflowX: "auto" }}>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", minWidth: 560, height: "auto" }} role="img" aria-label="Trend by month">
            {[0, 1, 2, 3, 4, 5].map((i) => { const v = lo + ((hi - lo) * i) / 5; return <g key={i}><line x1={L} x2={W - Rm} y1={Y(v)} y2={Y(v)} stroke="#eef1f4" /><text x={L - 8} y={Y(v)} fontSize={10} fill="#6b7785" textAnchor="end" dominantBaseline="middle">{axis(v)}</text></g>; })}
            {range.map((m, i) => (range.length <= 14 || i % Math.ceil(range.length / 12) === 0) && <text key={m} x={X(i)} y={H - 10} fontSize={10} fill="#59636e" textAnchor="middle">{monthLong(m)}</text>)}
            {series.map((s, k) => (
              <g key={ids[k]}>
                <polyline fill="none" stroke={LINE[k % LINE.length]} strokeWidth={2} points={s.map((v, i) => (v === undefined ? "" : `${X(i)},${Y(v)}`)).filter(Boolean).join(" ")} />
                {s.map((v, i) => v !== undefined && <circle key={i} cx={X(i)} cy={Y(v)} r={3} fill="#fff" stroke={LINE[k % LINE.length]} strokeWidth={1.5}><title>{`${measureById(ids[k])?.label}, ${monthLong(range[i])}: ${fmt(v)}`}</title></circle>)}
              </g>
            ))}
          </svg>
        </div>
      )}
      <div className="card" style={{ overflowX: "auto" }}>
        <table className="grid">
          <thead><tr><th style={{ textAlign: "left" }}>Month</th>{ids.map((id, i) => <th key={id} style={{ textAlign: "right" }}><span style={{ color: LINE[i % LINE.length] }}>●</span> {measureById(id)?.label}</th>)}</tr></thead>
          <tbody>{range.map((m, i) => <tr key={m} style={{ borderTop: "1px solid var(--line-soft, #eef2f7)" }}><td style={{ fontWeight: 600 }}>{monthLong(m)}</td>{ids.map((id, k) => <td key={id} className="num mono" style={{ textAlign: "right" }}>{fmt(series[k]?.[i])}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </Frame>
  );
}

// ------------------------------------------------------------------ goalseek

const LEVER_COLOUR: Record<keyof Levers, string> = { price: "#3a85c8", volume: "#6a3070", cos: "#4aa8b0", fixed: "#6a9f5b", varExp: "#d0485a" };
export function GoalseekScreen({ clientKey, clientName, yearEnd, tenant }: Props) {
  const r = useScreen(clientKey, tenant);
  const [kind, setKind] = useState<PeriodKind>("month");
  const [anchor, setAnchor] = useState(""), [metric, setMetric] = useState<GoalMetric>("opm"), [goalText, setGoalText] = useState("");
  const [lev, setLev] = useState<Levers>(NO_CHANGE);
  const d = r.data, months = d?.months || [], at = pick(months, anchor), endMonth = endMonthOf(yearEnd);
  const base = useMemo(() => (d && at ? goalBase(d, kind, at, endMonth) : undefined), [d, at, kind, endMonth]);
  const money = GOAL_METRICS.find((m) => m[0] === metric)?.[2] === "money";
  const start = base ? goalValue(base, metric, NO_CHANGE) : undefined;
  const auto = start === undefined ? 0 : Math.round(start * 1.2 * 100) / 100;
  const goal = goalText !== "" && Number.isFinite(Number(goalText)) ? Number(goalText) : auto;
  const solos = useMemo(() => Object.fromEntries(LEVERS.map(([k]) => [k, base ? soloChange(base, metric, goal, k) : undefined])) as Record<keyof Levers, number | undefined>, [base, metric, goal]);
  const now = base ? goalValue(base, metric, lev) : undefined;
  const parts = base ? contributions(base, metric, lev) : [];
  const fmt = (v?: number) => (v === undefined ? "–" : money ? gbp(v) : `${+v.toFixed(2)}%`);
  const span = start === undefined ? 0 : goal - start;
  const total = parts.reduce((a, p) => a + Math.abs(p.delta), 0), scale = span && total > Math.abs(span) ? Math.abs(span) / total : 1;
  const pc = (v?: number) => (v === undefined ? "–" : `${+(v * 100).toFixed(2)}%`);
  const high = LEVERS.filter(([k]) => k !== "varExp"), medium = LEVERS.filter(([k]) => k === "varExp");
  const reset = () => { setLev(NO_CHANGE); setGoalText(""); };
  const row = ([k, name]: [keyof Levers, string], range: number) => (
    <div key={k} style={{ display: "grid", gridTemplateColumns: "150px 90px 90px minmax(0, 1fr)", gap: 10, alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--line-soft, #eef2f7)", fontSize: 13 }}>
      <span><span style={{ display: "inline-block", width: 8, height: 8, background: LEVER_COLOUR[k], marginRight: 8 }} />{name}</span>
      <button type="button" disabled={solos[k] === undefined} title="Use this change" onClick={() => setLev({ ...lev, [k]: solos[k] as number })} style={{ border: 0, background: "none", cursor: solos[k] === undefined ? "default" : "pointer", textAlign: "right", color: "inherit" }}>{pc(solos[k])}</button>
      <input type="number" step={0.1} aria-label={`${name} change %`} value={+(lev[k] * 100).toFixed(2)} onChange={(e) => setLev({ ...lev, [k]: (Number(e.target.value) || 0) / 100 })} style={{ width: 80, textAlign: "right" }} />
      <input type="range" aria-label={`${name} slider`} min={-range} max={range} step={range / 100} value={Math.max(-range, Math.min(range, lev[k] * 100))} onChange={(e) => setLev({ ...lev, [k]: Number(e.target.value) / 100 })} style={{ width: "100%" }} />
    </div>
  );
  return (
    <Frame title="Goalseek" clientName={clientName} r={r}>
      <div className="row-wrap" style={{ gap: 10, alignItems: "center" }}>
        <Lbl>For the</Lbl><Seg value={kind} set={(k) => { setKind(k); setLev(NO_CHANGE); }} opts={[["month", "Month"], ["quarter", "Quarter"], ["year", "Year"]]} label="Period" /><Lbl>of</Lbl><MonthSelect months={months} at={at} set={(m) => { setAnchor(m); setLev(NO_CHANGE); }} />
      </div>
      {base && start !== undefined && (
        <>
          <div className="row-wrap" style={{ gap: 8, alignItems: "center", justifyContent: "space-between" }}>
            <div className="row-wrap" style={{ gap: 8, alignItems: "center" }}>
              <Lbl>Changes required to {goal >= start ? "increase" : "decrease"}</Lbl>
              <select aria-label="Measure" value={metric} onChange={(e) => { setMetric(e.target.value as GoalMetric); setGoalText(""); setLev(NO_CHANGE); }}>{GOAL_METRICS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              <Lbl>from {fmt(start)} to</Lbl>
              <input aria-label="Goal" type="number" step="any" value={goalText !== "" ? goalText : auto} onChange={(e) => setGoalText(e.target.value)} style={{ width: 110 }} />
            </div>
            <button type="button" className="btn small" onClick={reset}>Reset</button>
          </div>
          <div className="card pad stack" style={{ gap: 6 }}>
            <div style={{ position: "relative", paddingTop: 30 }}>
              <div style={{ display: "flex", height: 36, border: "1px solid var(--line, #cbd5e1)", alignItems: "stretch" }}>
                <div style={{ width: 48, display: "grid", placeItems: "center", fontSize: 10, fontWeight: 700, borderRight: "1px solid var(--line, #cbd5e1)" }}>START</div>
                <div style={{ flex: 1, display: "flex", position: "relative", background: "repeating-linear-gradient(45deg, #fff, #fff 3px, #e6e9ec 3px, #e6e9ec 4px)" }}>
                  {span !== 0 && parts.filter((p) => p.delta !== 0).map((p) => <div key={p.lever} title={`${LEVERS.find((l) => l[0] === p.lever)?.[1]}: ${p.delta > 0 ? "+" : ""}${+p.delta.toFixed(2)}`} style={{ width: `${(Math.abs(p.delta) * scale / Math.abs(span)) * 100}%`, background: LEVER_COLOUR[p.lever], opacity: p.delta < 0 ? 0.45 : 1, borderRight: "1px solid #fff" }} />)}
                </div>
                <div style={{ width: 48, display: "grid", placeItems: "center", fontSize: 10, fontWeight: 700, borderLeft: "1px solid var(--line, #cbd5e1)" }}>GOAL</div>
              </div>
              {now !== undefined && <div style={{ position: "absolute", top: 0, left: `calc(48px + (100% - 96px) * ${span ? Math.max(0, Math.min(1, (now - start) / span)) : 0})`, transform: "translateX(-50%)", border: "1px solid var(--line, #cbd5e1)", background: "#fff", borderRadius: 4, padding: "2px 8px", fontSize: 11 }}>{fmt(now)}</div>}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }} className="muted"><span>{fmt(start)}</span><span>{fmt(goal)}</span></div>
          </div>
          <div className="card pad">
            <div style={{ display: "grid", gridTemplateColumns: "150px 90px 90px minmax(0, 1fr)", gap: 10, fontSize: 11 }} className="muted"><span /><span style={{ textAlign: "right" }}>To achieve goal</span><span style={{ textAlign: "right" }}>Change</span><span style={{ textAlign: "center" }}>HIGH SENSITIVITY (−10% to 10%)</span></div>
            {high.map((l) => row(l, 10))}
            {medium.length > 0 && <div style={{ textAlign: "right", fontSize: 11, margin: "14px 0 0" }} className="muted"><span style={{ display: "inline-block", width: "calc(100% - 330px)", textAlign: "center" }}>MEDIUM SENSITIVITY (−100% to 100%)</span></div>}
            {medium.map((l) => row(l, 100))}
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            Price and volume move revenue; volume also moves cost of sales and variable expenses; fixed expenses stay as they are unless changed. Variable expenses are the commission, card, carriage, postage, delivery and sub-contractor type accounts; every other expense is fixed.
            "To achieve goal" is the change that gets there on its own; click it to use it, or set a mix with the sliders and watch the bar fill.
          </p>
        </>
      )}
    </Frame>
  );
}
