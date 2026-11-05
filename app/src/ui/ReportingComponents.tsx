// The report components that have their own settings: key numbers, rule-based observations, series charts, top-accounts charts and financial
// tables, each drawn from the client's monthly figures; and the "Edit component" panel that changes them. Used on screen and in the published page.
import { ReactNode, useEffect, useState } from "react";
import { MEASURES, measureById } from "../lib/analysis";
import { AgedData } from "../lib/aged";
import { figuresFor, KpiSettings } from "../lib/kpis";
import { Block, ChartOpts, Fmt, Icon, Op, Operand, TopGroup, When } from "../lib/reportBuilder";
import { OP_LABEL, TOP_GROUPS, WHEN_LABEL, buckets, evalRule, fmtValue, keyData, measureValue, periodMonthsFor, tableCols, topAccounts } from "../lib/reportComponents";
import { PeriodKind, ReportData, bsStatement, monthLabel, periodCols, periodMonths, plStatement } from "../lib/reportData";
import { Seg } from "./reportingKit";

export type Ctx = { d: ReportData; kind: PeriodKind; anchor: string; endMonth: number; kpi: KpiSettings; aged?: AgedData; land?: boolean; palette?: string[] };
export const NAVY = "#131b30", RED = "#d4300f", AMBER = "#f5a30a", GREY = "#b8bbc4", MUTED = "#6b6f7a", RULE = "#dcdde1";
export const LINE = [NAVY, RED, AMBER, "#5b7bb3", "#6f9a3a", "#8a8f9a"];
export const pal = (c: { palette?: string[] }) => (c.palette && c.palette.length ? c.palette : LINE);
export const labelsOn = (o: ChartOpts, n: number) => o.labels ?? n <= 13;
export const T: Record<string, React.CSSProperties> = {
  h2: { margin: "0 0 24px", fontSize: 24, fontWeight: 500, letterSpacing: -0.25, borderBottom: "1px solid #8a8d94", paddingBottom: 7, color: "#111" },
  cap: { margin: "20px 0 6px", fontSize: 12, fontWeight: 500, color: MUTED },
  p: { margin: "6px 0", fontSize: 10.7, lineHeight: 1.5, whiteSpace: "pre-wrap" },
  th: { textAlign: "right", padding: "4px 4px", fontWeight: 600, whiteSpace: "nowrap", borderBottom: "1px solid #111", color: "#111" },
  td: { textAlign: "right", padding: "3px 4px", fontVariantNumeric: "tabular-nums" },
};
const money0 = (v?: number) => (v === undefined ? "" : `${v < 0 ? "-" : ""}£${Math.abs(Math.round(v)).toLocaleString("en-GB")}`);
function nice(lo: number, hi: number) {
  const span = hi - lo || Math.abs(hi) || 1, raw = span / 4, p = 10 ** Math.floor(Math.log10(raw)), f = raw / p;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p, a = Math.floor(lo / step + 1e-9) * step, z = Math.ceil(hi / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = a; v <= z + step / 2; v += step) ticks.push(+v.toFixed(10));
  return { lo: a, hi: z, ticks };
}
const axisMoney = (v: number) => { const a = Math.abs(v), sg = v < 0 ? "-" : ""; return a >= 1e6 ? `${sg}£${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${sg}£${+(a / 1e3).toFixed(1)}K` : a === 0 ? "£0" : `${sg}£${Math.round(a)}`; };
const gbp = (n?: number) => (n === undefined ? "" : n === 0 ? "–" : n < 0 ? `(${Math.abs(Math.round(n)).toLocaleString("en-GB")})` : Math.round(n).toLocaleString("en-GB"));
const withPeriod = (c: Ctx, p?: PeriodKind): Ctx => (p ? { ...c, kind: p } : c);
const none = (t: string) => <p style={{ ...T.p, color: "#7a8591" }}>{t}</p>;
type B<K extends Block["type"]> = Extract<Block, { type: K }>;

// ------------------------------------------------------------------ series chart

export function ChartView({ b, c }: { b: B<"chart">; c: Ctx }) {
  const o: ChartOpts = b.opts || {};
  const unit = measureById(b.measures[0])?.unit || "money";
  const ids = b.measures.filter((id) => measureById(id)?.unit === unit && (!measureById(id)?.balance || c.d.bs.length));
  let bk = buckets(b.freq || "month", c.anchor, c.endMonth, b.freq ? b.previous ?? 13 : b.months, c.d.months);
  let series = ids.map((id) => bk.map((x) => measureValue(c.d, id, x.months)));
  if (o.trim) {
    const has = (i: number) => series.some((s) => s[i] !== undefined && s[i] !== 0);
    let a = 0, z = bk.length - 1;
    while (a <= z && !has(a)) a++;
    while (z >= a && !has(z)) z--;
    bk = bk.slice(a, z + 1); series = series.map((s) => s.slice(a, z + 1));
  }
  const all = series.flat().filter((v): v is number => v !== undefined);
  if (!all.length || !bk.length) return none(`There are no figures for this chart${ids.length < b.measures.length || !c.d.bs.length ? " yet (balance sheet measures need the balance sheet read from Xero)" : ""}.`);
  const W = 760, H = 340, L = 58, Tp = 22, B2 = 30, R = 16;
  const bars = !!b.bars || !!o.stack;
  const stacked = !!o.stack && unit === "money" && ids.length > 1;
  const tot = stacked ? bk.map((_, i) => series.reduce((a, s) => a + Math.max(0, s[i] || 0), 0)) : [];
  const hi0 = stacked ? Math.max(...tot) : Math.max(...all), lo0 = stacked ? 0 : Math.min(...all);
  const forceZero = bars || !!o.zero;
  const nz = nice(forceZero ? Math.min(0, lo0) : lo0, forceZero ? Math.max(0, hi0) : hi0);
  const lo = nz.lo, hi = nz.hi;
  const slot = (W - L - R) / bk.length;
  const X = (i: number) => (bars ? L + slot * (i + 0.5) : L + slot * 0.5 + (bk.length < 2 ? 0 : (i / (bk.length - 1)) * (W - L - R - slot)));
  const Y = (v: number) => H - B2 - ((v - lo) / (hi - lo)) * (H - Tp - B2);
  const fmt = (v: number) => fmtValue(unit, v, { rounded: true });
  const axis = (v: number) => (unit === "money" ? axisMoney(v) : fmtValue(unit, v, { rounded: true }));
  const showLabels = labelsOn(o, bk.length);
  const groupW = Math.max(4, slot * 0.72), bw = stacked ? groupW : groupW / ids.length;
  const P = pal(c), col = (k: number) => o.colors?.[k] || P[k % P.length];
  const last = bk.length - 1, zero = Y(Math.max(lo, Math.min(hi, 0)));
  const halo = { stroke: "#fff", strokeWidth: 3, paintOrder: "stroke" } as const;
  return (
    <div>
      {ids.length > 1 && o.legend !== false && <div style={{ display: "flex", gap: 16, fontSize: 9.3, flexWrap: "wrap", justifyContent: "flex-end", margin: "0 0 4px" }}>{ids.map((id, k) => <span key={id} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 8, height: 8, background: col(k), display: "inline-block" }} />{measureById(id)?.label}</span>)}</div>}
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label={b.title}>
        {nz.ticks.map((v) => <g key={v}><line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} stroke="#e4e5e9" /><text x={L - 8} y={Y(v)} fontSize={9.4} fill={MUTED} textAnchor="end" dominantBaseline="middle">{axis(v)}</text></g>)}
        {bk.map((_, i) => <line key={i} x1={X(i)} x2={X(i)} y1={Tp} y2={H - B2} stroke="#e4e5e9" strokeDasharray="1 3" />)}
        {o.highlight && <rect x={bars ? L + slot * last : X(last) - 14} y={Tp} width={bars ? slot : 28} height={H - Tp - B2} fill="#f1f1f4" />}
        {lo < 0 && hi > 0 && <line x1={L} x2={W - R} y1={zero} y2={zero} stroke="#8c8f97" />}
        {bk.map((x, i) => (bk.length <= 13 || i % 2 === 0) && <text key={i} x={X(i)} y={H - 10} fontSize={9.4} fill={MUTED} textAnchor="middle">{x.label}</text>)}
        {bars
          ? series.map((s, k) => s.map((v, i) => {
            if (v === undefined) return null;
            const base = stacked ? series.slice(0, k).reduce((a, q) => a + Math.max(0, q[i] || 0), 0) : 0, top = base + (stacked ? Math.max(0, v) : v);
            const x0 = stacked ? X(i) - bw / 2 : X(i) - groupW / 2 + k * bw;
            const fill = ids.length === 1 ? (v < 0 ? P[1] : col(0)) : col(k);
            return (
              <g key={`${k}-${i}`}>
                <rect x={x0} y={Math.min(Y(top), Y(stacked ? base : 0))} width={Math.max(1, bw - 1.5)} height={Math.abs(Y(top) - Y(stacked ? base : 0))} fill={fill} />
                {showLabels && !stacked && <text x={x0 + bw / 2} y={v < 0 ? Y(v) + 11 : Y(v) - 4} fontSize={7.8} textAnchor="middle" fill="#2b2f36" {...halo}>{fmt(v)}</text>}
              </g>
            );
          }))
          : series.map((s, k) => {
            const pts = s.map((v, i) => (v === undefined ? undefined : [X(i), Y(v)] as [number, number])).filter(Boolean) as [number, number][];
            const lc = col(k);
            return (
              <g key={ids[k]}>
                {pts.length > 1 && <polygon fill={lc} opacity={0.16} points={[`${pts[0][0]},${zero}`, ...pts.map((q) => q.join(",")), `${pts[pts.length - 1][0]},${zero}`].join(" ")} />}
                <polyline fill="none" stroke={lc} strokeWidth={2} strokeLinejoin="round" points={pts.map((q) => q.join(",")).join(" ")} />
                {s.map((v, i) => v !== undefined && <g key={i}><circle cx={X(i)} cy={Y(v)} r={3} fill="#fff" stroke={lc} strokeWidth={1.6} />{showLabels && <text x={X(i)} y={v < 0 ? Y(v) + 14 : Y(v) - 7} fontSize={7.8} textAnchor="middle" fill="#2b2f36" {...halo}>{fmt(v)}</text>}</g>)}
              </g>
            );
          })}
        {stacked && showLabels && tot.map((v, i) => <text key={i} x={X(i)} y={Y(v) - 4} fontSize={7.8} textAnchor="middle" fill="#2b2f36" {...halo}>{fmt(v)}</text>)}
      </svg>
    </div>
  );
}

// ------------------------------------------------------------------ financial tables

const COLS: [string, string][] = [["this", "This period"], ["prior", "Last period"], ["lastYear", "Same period last year"], ["var", "Variance £"], ["varPct", "Variance %"], ["pctRev", "% of revenue"], ["months", "Every month of the year (instead of the others)"]];

function one(b: B<"table">, c: Ctx, which: "pl" | "bs") {
  const keys = new Set(tableCols(b));
  const base = (compare: "none" | "prior" | "lastYear" | "months", i: number) => periodCols(c.kind, c.anchor, c.endMonth, compare)[i];
  const monthly = keys.has("months");
  let cols = monthly ? periodCols(c.kind, c.anchor, c.endMonth, "months") : [keys.has("this") && base("none", 0), keys.has("prior") && base("prior", 1), keys.has("lastYear") && base("lastYear", 1)].filter(Boolean) as ReturnType<typeof periodCols>;
  if (!cols.length) cols = [base("none", 0)];
  const hidden = new Set(b.hidden || []);
  const rows = (which === "pl" ? plStatement(c.d, cols, b.detail) : bsStatement(c.d, cols, b.detail)).filter((r) => (r.kind !== "line" || r.code === undefined || r.vals.some((v) => v)) && !hidden.has(r.label));
  const showVar = !monthly && cols.length >= 2;
  const revenue = figuresFor(c.d, cols[0].months).revenue;
  return { cols, rows, showVar, varCols: showVar && keys.has("var"), pctCols: showVar && keys.has("varPct"), pctRev: !monthly && which === "pl" && keys.has("pctRev"), revenue };
}

export function TableView({ b, c }: { b: B<"table">; c: Ctx }) {
  const cc = withPeriod(c, b.period);
  const fmtOn = !!(b.fmt?.rounded || b.fmt?.decimals || b.fmt?.symbol === false);
  const f = (v?: number) => (v === undefined ? "" : fmtOn ? fmtValue("money", v, b.fmt) : money0(v));
  const parts: ("pl" | "bs")[] = b.statement === "both" ? ["pl", "bs"] : [b.statement];
  return (
    <div>
      {parts.map((which) => {
        const t = one(b, cc, which);
        const hl = t.cols.findIndex((col) => !col.total && col.months.length === 1 && col.months[0] === cc.anchor && t.cols.length > 3) >= 0 ? t.cols.findIndex((col) => !col.total && col.months.length === 1 && col.months[0] === cc.anchor) : t.cols.length > 1 && t.cols.length <= 3 ? 0 : -1;
        const tint = (j: number): React.CSSProperties => (j === hl ? { background: b.tint || "#efe7f1" } : {});
        const size = t.cols.length > 10 ? (cc.land ? 8.8 : 7.8) : 8.8;
        const many = t.cols.length > 6;
        return (
          <table key={which} style={{ width: "100%", borderCollapse: "collapse", fontSize: size, marginBottom: 16, color: "#111", tableLayout: many ? "fixed" : undefined }}>
            <thead><tr>
              <th style={{ ...T.th, textAlign: "left", color: MUTED, fontSize: size, width: many ? "17%" : undefined }}>{b.hideTitles ? "" : which === "pl" ? "PROFIT & LOSS" : "BALANCE SHEET"}</th>
              {t.cols.map((col, j) => <th key={col.key} style={{ ...T.th, ...tint(j), padding: many ? "4px 3px" : T.th.padding }}>{col.label}</th>)}
              {t.pctRev && <th style={T.th}>% of Revenue</th>}
              {t.varCols && <th style={T.th}>Variance £</th>}{t.pctCols && <th style={T.th}>Variance %</th>}
            </tr></thead>
            <tbody>
              {t.rows.map((row, i) => {
                const strong = row.kind !== "line", head = row.kind === "head";
                const v0 = row.vals[0], v1 = row.vals[1];
                const v = t.showVar && v0 !== undefined && v1 !== undefined ? Math.round((v0 as number) - (v1 as number)) : undefined;
                const pc = v1 ? `${Math.round((((v0 as number) - (v1 as number)) / Math.abs(v1 as number)) * 100)}%` : "";
                const rule = strong ? "1px solid #111" : "1px solid #e6e6ea";
                const rs: React.CSSProperties = { fontWeight: strong ? 600 : 400, borderBottom: rule, borderTop: row.kind === "total" || row.kind === "sub" ? "1px solid #111" : undefined };
                return (
                  <tr key={i} style={rs}>
                    <td style={{ ...T.td, textAlign: "left", paddingLeft: row.kind === "line" ? 12 : 4, fontSize: size }}>{row.label}</td>
                    {t.cols.map((col, j) => <td key={col.key} style={{ ...T.td, ...tint(j), padding: many ? "3px 3px" : T.td.padding, whiteSpace: "nowrap" }}>{head ? "" : f(row.vals[j])}</td>)}
                    {t.pctRev && <td style={T.td}>{head || v0 === undefined || !t.revenue ? "" : `${(((v0 as number) / t.revenue) * 100).toFixed(1)}%`}</td>}
                    {t.varCols && <td style={T.td}>{head ? "" : f(v)}</td>}{t.pctCols && <td style={T.td}>{head ? "" : pc}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ key number, observation, top accounts

function Spark({ values, color }: { values: (number | undefined)[]; color: string }) {
  const v = values.filter((x): x is number => x !== undefined);
  if (v.length < 2) return null;
  const lo = Math.min(...v), hi = Math.max(...v), W = 90, H = 18;
  const y = (x: number) => H - 3 - ((x - lo) / (hi - lo || 1)) * (H - 6);
  const pts = values.map((x, i) => (x === undefined ? undefined : [(i / (values.length - 1)) * W, y(x)] as [number, number])).filter(Boolean) as [number, number][];
  const line = pts.map((q) => q.join(",")).join(" ");
  return <svg viewBox={`0 0 ${W} ${H}`} style={{ width: 90, height: 18, display: "block", margin: "12px 0" }} aria-hidden="true"><polygon fill={color} opacity={0.14} points={`0,${H} ${line} ${W},${H}`} /><polyline fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" points={line} /></svg>;
}

export function KeyView({ b, c, label, tone = 0 }: { b: B<"key">; c: Ctx; label?: ReactNode; tone?: number }) {
  const cc = withPeriod(c, b.period);
  const m = measureById(b.measure);
  const k = keyData(cc.d, b.measure, cc.kind, cc.anchor, cc.endMonth, b.compare);
  const tag = periodCols(cc.kind, cc.anchor, cc.endMonth, "none")[0]?.label;
  const head = <div style={{ borderBottom: "1px solid #8a8d94", paddingBottom: 6, marginBottom: 12, fontSize: 10.7, fontWeight: 700, letterSpacing: 0.2, textTransform: "uppercase", color: "#8a8d94", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label ?? b.title}{tag && <span style={{ fontWeight: 500, textTransform: "none" }}> ({tag})</span>}</div>;
  if (!m || k.value === undefined) return <div>{head}{none("No figure for this yet.")}</div>;
  const diff = k.compare !== undefined ? k.value - k.compare : undefined;
  const up = (diff ?? 0) >= 0;
  const cmpLabel = b.compare === "none" ? "" : periodCols(cc.kind, cc.anchor, cc.endMonth, b.compare)[1]?.label;
  return (
    <div>
      {head}
      <div style={{ fontSize: 24, fontWeight: 500, letterSpacing: -0.25, lineHeight: 1.1, color: "#111" }}>{fmtValue(m.unit, k.value, b.fmt)}</div>
      {diff !== undefined && <div style={{ fontSize: 9.3, color: MUTED, marginTop: 8 }}><span style={{ color: up ? "#7ea34f" : RED }}>{up ? "▲" : "▼"} {m.unit === "money" ? fmtValue(m.unit, Math.abs(diff), b.fmt) : fmtValue(m.unit, diff, b.fmt)}</span> from {cmpLabel}</div>}
      {b.spark && <Spark values={k.spark} color={b.color || pal(cc)[tone % 3]} />}
      {b.showDesc && b.desc && <div style={{ fontSize: 10.7, lineHeight: 1.4, color: "#222", marginTop: 4, whiteSpace: "pre-wrap" }}>{b.desc}</div>}
    </div>
  );
}

const Thumb = ({ icon, color }: { icon: Icon; color?: string }) => (icon === "none" ? null : (
  <svg viewBox="0 0 16 16" width={20} height={20} aria-label={icon === "up" ? "Good" : "Bad"} style={{ verticalAlign: "-6px", marginRight: 8 }}><path d={icon === "up" ? "M3 14V7M3 7l4-5c1.5 0 2 1 1.7 2.5L8.4 6H13c.8 0 1.2.7 1 1.4l-1.4 5.6c-.2.6-.7 1-1.3 1H3" : "M3 2v7M3 9l4 5c1.5 0 2-1 1.7-2.5L8.4 10H13c.8 0 1.2-.7 1-1.4L11.6 3c-.2-.6-.7-1-1.3-1H3"} fill="none" stroke={color || (icon === "up" ? "#5b8a2d" : RED)} strokeWidth={1} strokeLinecap="round" strokeLinejoin="round" /></svg>
));

/** Whether an observation is hidden (its extra condition says so) – the screen still shows it, dimmed, so it can be edited. */
export function observationHidden(b: B<"observation">, c: Ctx): boolean {
  const cc = withPeriod(c, b.period);
  const r = evalRule(cc.d, cc.kind, cc.anchor, cc.endMonth, b.left, b.op, b.right);
  return (b.hideWhen === "true" && r.ok === true) || (b.hideWhen === "false" && r.ok === false);
}
export function ObservationView({ b, c }: { b: B<"observation">; c: Ctx }) {
  const cc = withPeriod(c, b.period);
  const r = evalRule(cc.d, cc.kind, cc.anchor, cc.endMonth, b.left, b.op, b.right);
  const lm = measureById(b.left.measure), rm = "measure" in b.right ? measureById(b.right.measure) : undefined;
  const icon = r.ok === undefined ? "none" : r.ok ? b.thenIcon : b.elseIcon, text = r.ok === undefined ? "" : r.ok ? b.thenText : b.elseText;
  return (
    <div style={{ margin: "20px 0" }}>
      <div style={{ fontSize: 10.7, letterSpacing: 0.3, color: "#8a8d94", textTransform: "uppercase", marginBottom: 6 }}><Thumb icon={icon} color={r.ok === undefined ? undefined : r.ok ? b.thenColor : b.elseColor} />{b.title}</div>
      <div style={{ fontSize: 10.7, fontWeight: 700, color: "#111" }}>{lm?.label} {fmtValue(lm?.unit || "money", r.left)} <span style={{ fontWeight: 400, color: "#8a8d94", fontSize: 9.3 }}>({"measure" in b.right ? WHEN_LABEL[b.right.when] : "Target"} {fmtValue(rm?.unit || lm?.unit || "money", r.right)})</span></div>
      <div style={{ fontSize: 10.7, lineHeight: 1.45, whiteSpace: "pre-wrap", marginTop: 2 }}>{r.ok === undefined ? <span style={{ color: "#8a8d94" }}>No figures to compare yet.</span> : text}</div>
    </div>
  );
}

export function TopView({ b, c }: { b: B<"top">; c: Ctx }) {
  const cc = withPeriod(c, b.period);
  const rows = topAccounts(cc.d, b.group, periodMonths(cc.kind, cc.anchor, cc.endMonth), b.n, b.order, b.hideNil);
  if (!rows.length) return none("No accounts have a balance for this period.");
  const nz = nice(0, Math.max(...rows.map((r) => r.amount), 1));
  const pos = (v: number) => `${Math.max(0, Math.min(100, (v / (nz.hi * 1.12)) * 100))}%`;
  const red = b.group === "expense" || b.group === "cos";
  const P = pal(cc), colour = (i: number) => (red ? b.color || P[1] : i === 0 ? b.color || P[0] : b.color2 || GREY);
  const LAB = "28%";
  return (
    <div style={{ fontSize: 9.3 }}>
      <div style={{ display: "flex", borderBottom: `1px solid ${RULE}`, height: 22, alignItems: "flex-end" }}>
        <div style={{ width: LAB }} />
        <div style={{ position: "relative", flex: 1, height: 14 }}>{nz.ticks.map((v) => <span key={v} style={{ position: "absolute", left: pos(v), transform: "translateX(-50%)", fontSize: 8, color: MUTED, whiteSpace: "nowrap" }}>{axisMoney(v).replace("K", "K")}</span>)}</div>
      </div>
      {rows.map((r, i) => (
        <div key={r.name} style={{ display: "flex", alignItems: "center", height: 32, borderBottom: `1px solid ${RULE}` }}>
          <div style={{ width: LAB, paddingRight: 10, color: "#111", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
          <div style={{ position: "relative", flex: 1, height: "100%", borderLeft: `1px solid ${RULE}` }}>
            <div style={{ position: "absolute", left: 0, top: 7, height: 18, width: pos(Math.max(0, r.amount)), background: colour(i), opacity: red ? Math.max(0.35, 1 - i * 0.09) : 1 }} />
            <span style={{ position: "absolute", left: `calc(${pos(Math.max(0, r.amount))} + 8px)`, top: 0, lineHeight: "32px", fontSize: 10.7, fontWeight: 500, color: "#3a3d45", fontVariantNumeric: "tabular-nums" }}>{fmtValue("money", r.amount)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ the Edit component panel

const Sec = ({ title, children }: { title: string; children: ReactNode }) => <div className="stack" style={{ gap: 6, borderTop: "1px solid var(--line-soft, #eef2f7)", paddingTop: 8 }}><div style={{ fontWeight: 600, fontSize: 13 }}>{title}</div>{children}</div>;
const Check = ({ label, on, set, disabled }: { label: string; on: boolean; set: (v: boolean) => void; disabled?: boolean }) => <label style={{ fontSize: 13, display: "flex", gap: 6, alignItems: "center", opacity: disabled ? 0.5 : 1 }}><input type="checkbox" checked={on} disabled={disabled} onChange={(e) => set(e.target.checked)} />{label}</label>;
const measureOpts = MEASURES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>);
const PERIODS: [string, string][] = [["", "Report"], ["month", "Month"], ["quarter", "Quarter"], ["year", "Year"]];
const PeriodSec = ({ value, set }: { value?: PeriodKind; set: (p?: PeriodKind) => void }) => <Sec title="Show"><Seg value={value || ""} set={(v) => set((v || undefined) as PeriodKind | undefined)} opts={PERIODS} label="Period" /><span className="muted" style={{ fontSize: 12 }}>“Report” uses the report's own period.</span></Sec>;
const FmtSec = ({ f, set, only }: { f: Fmt; set: (f: Fmt) => void; only?: boolean }) => (
  <Sec title="Currency formatting">
    <Check label="Display rounded figures (£105.8K)" on={!!f.rounded} set={(v) => set({ ...f, rounded: v })} />
    <Check label="Display decimal places" on={!!f.decimals} set={(v) => set({ ...f, decimals: v })} />
    {!only && <Check label="Show currency symbol with each result" on={f.symbol !== false} set={(v) => set({ ...f, symbol: v })} />}
  </Sec>
);
export const Swatch = ({ label, value, fallback, set }: { label: string; value?: string; fallback: string; set: (v: string | undefined) => void }) => (
  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
    <input type="color" aria-label={label} value={/^#[0-9a-f]{6}$/i.test(value || "") ? (value as string) : fallback} onChange={(e) => set(e.target.value)} style={{ width: 30, height: 24, padding: 0, border: "1px solid #cbd5e1", borderRadius: 4, background: "none", cursor: "pointer", flex: "none" }} />
    <span style={{ flex: 1 }}>{label}</span>
    {value && <button type="button" className="linkbtn" style={{ fontSize: 12 }} onClick={() => set(undefined)}>Reset</button>}
  </label>
);
const ICONS: [Icon, string][] = [["up", "Thumbs up"], ["down", "Thumbs down"], ["none", "No icon"]];

export function ComponentEditor({ block, c, onSave, onCancel, preview, onDraft }: { block: Block; c?: Ctx; onSave: (b: Block) => void; onCancel: () => void; preview?: (b: Block) => ReactNode; onDraft?: (b?: Block) => void }) {
  const [b, setB] = useState<Block>(block);
  const P = c ? pal(c) : LINE;
  // the report shows each change as it is made; nothing is kept until Save
  useEffect(() => { onDraft?.(b); }, [b]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onDraft?.(undefined), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [tab, setTab] = useState<"columns" | "rows">("columns");
  const upd = (patch: Partial<Block>) => setB((x) => ({ ...x, ...patch }) as Block);
  const title = "title" in b ? b.title : "";
  const rowLabels = (() => {
    if (b.type !== "table" || !c) return [] as string[];
    const cols = [periodCols(c.kind, c.anchor, c.endMonth, "none")[0]];
    const labels = (b.statement === "bs" ? [] : plStatement(c.d, cols, b.detail)).concat(b.statement === "pl" ? [] : bsStatement(c.d, cols, b.detail));
    return [...new Set(labels.filter((r) => r.kind !== "head" || true).map((r) => r.label))];
  })();
  return (
    <div className="stack" style={{ gap: 10 }} aria-label="Edit component">
      <div style={{ fontWeight: 600 }}>Edit component</div>
      {preview && <div className="rb-prev" aria-label="Preview"><div className="rb-prev-in">{preview(b)}</div></div>}
      {"title" in b && <label className="stack" style={{ gap: 2, fontSize: 13 }}>{b.type === "chart" || b.type === "top" ? "Chart title" : b.type === "key" ? "Key number title" : b.type === "observation" ? "Observation title" : "Title"}<input aria-label="Title" value={title} onChange={(e) => upd({ title: e.target.value } as Partial<Block>)} /></label>}

      {b.type === "key" && <>
        <Sec title="Key number">
          <select aria-label="Measure" value={b.measure} onChange={(e) => upd({ measure: e.target.value })}>{measureOpts}</select>
          <PeriodSec value={b.period} set={(p) => upd({ period: p })} />
        </Sec>
        <FmtSec f={b.fmt} set={(fmt) => upd({ fmt })} only />
        <Sec title="Show comparative"><select aria-label="Comparative" value={b.compare} onChange={(e) => upd({ compare: e.target.value as typeof b.compare })}><option value="none">None</option><option value="prior">Last period</option><option value="lastYear">Same period last year</option></select></Sec>
        <Sec title="Sparkline"><Check label="Show sparkline (last 13 months)" on={b.spark} set={(v) => upd({ spark: v })} />{b.spark && <Swatch label="Sparkline colour" value={b.color} fallback={P[0]} set={(color) => upd({ color })} />}</Sec>
        <Sec title="Description"><Check label="Show description" on={b.showDesc} set={(v) => upd({ showDesc: v })} />{b.showDesc && <textarea aria-label="Description" rows={4} maxLength={300} value={b.desc} onChange={(e) => upd({ desc: e.target.value })} />}</Sec>
      </>}

      {b.type === "observation" && (() => {
        const operand = (label: string, v: { measure: string; when: When }, set: (x: { measure: string; when: When }) => void) => (
          <div className="stack" style={{ gap: 4 }}>
            <select aria-label={`${label} measure`} value={v.measure} onChange={(e) => set({ ...v, measure: e.target.value })}>{measureOpts}</select>
            <select aria-label={`${label} period`} value={v.when} onChange={(e) => set({ ...v, when: e.target.value as When })}>{(Object.keys(WHEN_LABEL) as When[]).map((w) => <option key={w} value={w}>{WHEN_LABEL[w]}</option>)}</select>
          </div>
        );
        const right: Operand = b.right;
        return <>
          <PeriodSec value={b.period} set={(p) => upd({ period: p })} />
          <Sec title="Rule">
            <span className="muted" style={{ fontSize: 12 }}>If</span>
            {operand("If", b.left, (left) => upd({ left }))}
            <label style={{ fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}>is <select aria-label="Comparison" value={b.op} onChange={(e) => upd({ op: e.target.value as Op })}>{(Object.keys(OP_LABEL) as Op[]).map((o) => <option key={o} value={o}>{OP_LABEL[o]}</option>)}</select></label>
            <select aria-label="Compare with" value={"value" in right ? "number" : "measure"} onChange={(e) => upd({ right: e.target.value === "number" ? { value: 0 } : { measure: b.left.measure, when: "lastYear" } })}><option value="measure">another figure</option><option value="number">a number</option></select>
            {"value" in right ? <input type="number" step="any" aria-label="Number" value={right.value} onChange={(e) => upd({ right: { value: Number(e.target.value) || 0 } })} /> : operand("Then compare", right, (r) => upd({ right: r }))}
          </Sec>
          <Sec title="Icon colours"><Swatch label="Then icon" value={b.thenColor} fallback={b.thenIcon === "down" ? "#d4300f" : "#5b8a2d"} set={(thenColor) => upd({ thenColor })} /><Swatch label="Else icon" value={b.elseColor} fallback={b.elseIcon === "up" ? "#5b8a2d" : "#d4300f"} set={(elseColor) => upd({ elseColor })} /></Sec>
          <Sec title="Then"><select aria-label="Then icon" value={b.thenIcon} onChange={(e) => upd({ thenIcon: e.target.value as Icon })}>{ICONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select><textarea aria-label="Then text" rows={3} maxLength={1500} value={b.thenText} onChange={(e) => upd({ thenText: e.target.value })} /></Sec>
          <Sec title="Else"><select aria-label="Else icon" value={b.elseIcon} onChange={(e) => upd({ elseIcon: e.target.value as Icon })}>{ICONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select><textarea aria-label="Else text" rows={3} maxLength={1500} value={b.elseText} onChange={(e) => upd({ elseText: e.target.value })} /></Sec>
          <Sec title="Extra condition"><label style={{ fontSize: 13 }}>Hide this observation when the rule is <select aria-label="Hide when" value={b.hideWhen} onChange={(e) => upd({ hideWhen: e.target.value as typeof b.hideWhen })}><option value="never">never hidden</option><option value="true">true (the Then case)</option><option value="false">false (the Else case)</option></select></label></Sec>
        </>;
      })()}

      {b.type === "top" && <>
        <PeriodSec value={b.period} set={(p) => upd({ period: p })} />
        <Sec title="For the account classification"><select aria-label="Classification" value={b.group} onChange={(e) => upd({ group: e.target.value as TopGroup })}>{TOP_GROUPS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Sec>
        <Sec title="Colours"><Swatch label={b.group === "expense" || b.group === "cos" ? "Bars" : "Largest bar"} value={b.color} fallback={b.group === "expense" || b.group === "cos" ? P[1] : P[0]} set={(color) => upd({ color })} />{!(b.group === "expense" || b.group === "cos") && <Swatch label="Other bars" value={b.color2} fallback="#b8bbc4" set={(color2) => upd({ color2 })} />}</Sec>
        <Sec title="Display">
          <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
            <select aria-label="Top or bottom" value={b.order} onChange={(e) => upd({ order: e.target.value as "top" | "bottom" })}><option value="top">Top</option><option value="bottom">Bottom</option></select>
            <input type="number" min={1} max={50} aria-label="How many" value={b.n} onChange={(e) => upd({ n: Math.max(1, Math.min(50, Number(e.target.value) || 10)) })} style={{ width: 64 }} /> accounts
          </div>
          <Check label="Hide accounts with nil balances" on={b.hideNil} set={(v) => upd({ hideNil: v })} />
        </Sec>
      </>}

      {b.type === "chart" && (() => {
        const o = b.opts || {};
        const unit = measureById(b.measures[0])?.unit;
        const setO = (p: Partial<ChartOpts>) => upd({ opts: { ...o, ...p } });
        return <>
          <Sec title={`Series (${b.measures.length} of ${MEASURES.length} selected)`}>
            <div style={{ maxHeight: 190, overflowY: "auto" }} className="stack">
              {MEASURES.map((m) => <Check key={m.id} label={m.label} on={b.measures.includes(m.id)} disabled={!!unit && m.unit !== unit && !b.measures.includes(m.id)} set={(v) => upd({ measures: v ? [...b.measures, m.id] : b.measures.length > 1 ? b.measures.filter((x) => x !== m.id) : b.measures })} />)}
            </div>
            <span className="muted" style={{ fontSize: 12 }}>Measures of one kind (money, or percentages) go on one chart.</span>
          </Sec>
          <Sec title="Frequency of results"><select aria-label="Frequency" value={b.freq || "month"} onChange={(e) => upd({ freq: e.target.value as "month" | "quarter" | "year", previous: b.previous ?? b.months })}><option value="month">Month</option><option value="quarter">Quarter</option><option value="year">Year</option></select></Sec>
          <Sec title="Date range"><label style={{ fontSize: 13 }}>Show the previous <input type="number" min={1} max={60} aria-label="Previous periods" value={b.freq ? b.previous ?? 13 : b.months} onChange={(e) => upd({ freq: b.freq || "month", previous: Math.max(1, Math.min(60, Number(e.target.value) || 13)) })} style={{ width: 64 }} /> {b.freq === "year" ? "years" : b.freq === "quarter" ? "quarters" : "months"}</label></Sec>
          <Sec title="Colours">
            {b.measures.map((id, k) => <Swatch key={id} label={measureById(id)?.label || id} value={o.colors?.[k]} fallback={P[k % P.length]} set={(v) => { const cs = b.measures.map((_, i) => o.colors?.[i] || ""); cs[k] = v || ""; setO({ colors: cs.some(Boolean) ? cs : undefined }); }} />)}
          </Sec>
          <Sec title="Options">
            <Check label="Show as bars" on={!!b.bars} set={(v) => upd({ bars: v })} />
            <Check label="Highlight the current period" on={!!o.highlight} set={(v) => setO({ highlight: v })} />
            <Check label="Trim periods without results" on={!!o.trim} set={(v) => setO({ trim: v })} />
            <Check label="Stack results" on={!!o.stack} set={(v) => setO({ stack: v })} />
            <Check label="Always show zero on the vertical axis" on={!!o.zero} set={(v) => setO({ zero: v })} />
            <Check label="Show legend" on={o.legend !== false} set={(v) => setO({ legend: v })} />
            <Check label="Show data labels" on={labelsOn(o, b.freq ? b.previous ?? 13 : b.months)} set={(v) => setO({ labels: v })} />
          </Sec>
        </>;
      })()}

      {b.type === "table" && <>
        <Check label="Hide default financial statement titles" on={!!b.hideTitles} set={(v) => upd({ hideTitles: v })} />
        <PeriodSec value={b.period} set={(p) => upd({ period: p })} />
        <Sec title="Statements"><select aria-label="Statements" value={b.statement} onChange={(e) => upd({ statement: e.target.value as "pl" | "bs" | "both" })}><option value="both">Both Financial Statements</option><option value="pl">Profit & Loss</option><option value="bs">Balance Sheet</option></select>
          <select aria-label="Detail" value={b.detail} onChange={(e) => upd({ detail: e.target.value as "summary" | "detailed" })}><option value="summary">Summary</option><option value="detailed">Detailed (every account)</option></select></Sec>
        <Seg value={tab} set={setTab} opts={[["columns", "Columns"], ["rows", "Rows"]]} label="Columns or rows" />
        {tab === "columns" ? (
          <div className="stack" style={{ gap: 4 }}>
            {COLS.map(([k, l]) => { const cur = tableCols(b); return <Check key={k} label={l} on={cur.includes(k)} set={(v) => { let next = v ? [...cur, k] : cur.filter((x) => x !== k); if (v && k === "months") next = ["months"]; if (v && k !== "months") next = next.filter((x) => x !== "months"); upd({ cols: next.length ? COLS.map(([x]) => x).filter((x) => next.includes(x)) : ["this"] }); }} />; })}
          </div>
        ) : (
          <div className="stack" style={{ gap: 4, maxHeight: 260, overflowY: "auto" }}>
            {rowLabels.map((l) => <Check key={l} label={l} on={!(b.hidden || []).includes(l)} set={(v) => upd({ hidden: v ? (b.hidden || []).filter((x) => x !== l) : [...(b.hidden || []), l] })} />)}
          </div>
        )}
        <FmtSec f={b.fmt || {}} set={(fmt) => upd({ fmt })} />
        <Sec title="Colour"><Swatch label="Current period column" value={b.tint} fallback="#efe7f1" set={(tint) => upd({ tint })} /></Sec>
      </>}

      {(b.type === "kpis" || b.type === "cashflow" || b.type === "aged") && <p className="muted" style={{ margin: 0, fontSize: 12 }}>This component uses the report's period. Change its title above.</p>}

      <div style={{ display: "flex", gap: 8 }}><button type="button" className="btn primary" onClick={() => onSave(b)}>Save changes</button><button type="button" className="btn" onClick={onCancel}>Cancel</button></div>
    </div>
  );
}
