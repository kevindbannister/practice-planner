// Reporting › KPI Explorer: every KPI as a tile round a wheel, grouped by category, green when the target is met and red when it isn't.
// The middle shows how many are on track; pick a tile to see its result, target and how it is worked out.
import { useEffect, useMemo, useRef, useState } from "react";
import { Grouping, KpiSettings, computeKpis, formatKpi, wheelLayout } from "../lib/kpis";
import { PeriodKind, monthLong } from "../lib/reportData";
import { readSetting, useData } from "./data";
import { Seg, useReportData } from "./reportingKit";

const C = 320, R = 215;
const COLOUR = { on: "#8fb35a", off: "#d0342c", none: "#c9cfd6" } as const;

export function KpiExplorer({ clientKey, clientName, yearEnd, tenant }: { clientKey: string; clientName: string; yearEnd?: string; tenant: { tenantId: string; tenantName: string } }) {
  const r = useReportData(clientKey, tenant);
  const { data } = useData();
  const settings = readSetting<KpiSettings>(data.settings, `reporting.kpi.${clientKey}`) || {};
  const [kind, setKind] = useState<PeriodKind>("month");
  const [anchor, setAnchor] = useState("");
  const [pick, setPick] = useState("");
  const [by, setBy] = useState<Grouping>("perspective");
  const [show, setShow] = useState<"all" | "off" | "on">("all");
  const endMonth = Number((/^(\d{2})-/.exec(yearEnd || "") || [])[1]) || 12;
  const d = r.data;
  const months = d?.months || [];
  const at = anchor && months.includes(anchor) ? anchor : months[months.length - 1] || "";

  const tried = useRef("");
  useEffect(() => {
    if (r.checked && !r.data && !r.busy && !r.error && tried.current !== clientKey) { tried.current = clientKey; void r.refresh(); }
  }, [r.checked, r.data, r.busy, r.error, clientKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const results = useMemo(() => (d && at ? computeKpis(d, kind, at, endMonth, settings) : []), [d, at, kind, endMonth, settings.targets, settings.off]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => results.filter((x) => show === "all" || (show === "off" ? x.onTrack === false : x.onTrack === true)), [results, show]);
  const { items, groups } = useMemo(() => wheelLayout(shown, by, settings.importance), [shown, by, settings.importance]);
  const { items: all } = useMemo(() => wheelLayout(results, by, settings.importance), [results, by, settings.importance]); // where a hidden tile waits
  const here = new Map(items.map((i) => [i.id, i]));
  const on = results.filter((x) => x.onTrack === true).length, off = results.filter((x) => x.onTrack === false).length;
  const scored = on + off;
  const share = scored ? Math.round((on / scored) * 100) : 0;
  const chosen = results.find((x) => x.def.id === pick);
  const pos = (angle: number, radius: number) => ({ x: C + radius * Math.sin((angle * Math.PI) / 180), y: C - radius * Math.cos((angle * Math.PI) / 180) });
  const ring = 2 * Math.PI * 52;

  return (
    <section className="stack" style={{ gap: 12, minWidth: 0 }} aria-label="KPI Explorer">
      <div className="row-wrap" style={{ gap: 10, alignItems: "center", justifyContent: "space-between" }}>
        <div className="row-wrap" style={{ gap: 10, alignItems: "center" }}>
          <h2 className="sec-h">KPI Explorer</h2>
          <span className="muted" style={{ fontSize: 13 }}>{clientName}</span>
        </div>
        <div className="row-wrap" style={{ gap: 8, alignItems: "center" }}>
          <span className="muted" style={{ fontSize: 12 }} aria-live="polite">{r.busy || (d ? `Read from Xero ${new Date(d.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : "")}</span>
          <button type="button" className="btn small" disabled={!!r.busy} onClick={() => void r.refresh()}>{d ? "Refresh from Xero" : "Read from Xero"}</button>
        </div>
      </div>
      {r.error && <div className="alert red"><strong>Couldn't read the figures</strong><span>{r.error}</span></div>}
      {d && (
        <>
          <div className="row-wrap" style={{ gap: 10, alignItems: "center" }}>
            <span className="muted" style={{ fontSize: 13 }}>For the</span>
            <Seg value={kind} set={(k) => { setKind(k); setPick(""); }} opts={[["month", "Month"], ["quarter", "Quarter"], ["year", "Year"]]} label="Period" />
            <span className="muted" style={{ fontSize: 13 }}>of</span>
            <select aria-label="Month" value={at} onChange={(e) => setAnchor(e.target.value)}>
              {[...months].reverse().map((m) => <option key={m} value={m}>{monthLong(m)}</option>)}
            </select>
            <span className="muted" style={{ fontSize: 13 }}>Showing {shown.length} KPIs, grouped by</span>
            <select aria-label="Group by" value={by} onChange={(e) => setBy(e.target.value as Grouping)}>
              <option value="perspective">Perspective</option><option value="result">Result</option><option value="importance">Importance</option>
            </select>
            <Seg value={show} set={(v) => { setShow(v); setPick(""); }} opts={[["all", "All KPIs"], ["off", "Off track"], ["on", "On track"]]} label="Show" />
          </div>
          <div className="card pad" style={{ display: "grid", justifyItems: "center", overflow: "hidden" }}>
            <svg viewBox="-110 -20 860 680" role="img" aria-label={`${on} of ${scored} KPIs on track`} style={{ width: "100%", maxWidth: 860, height: "auto" }}>
              <circle cx={C} cy={C} r={R} fill="none" stroke="#eef1f4" strokeWidth={6} />
              <style>{`@keyframes kpiFade{from{opacity:0}to{opacity:1}}`}</style>
              {groups.map((g) => {
                const p = pos(g.angle, R - 34), flip = g.angle > 90 && g.angle < 270;
                return <text key={`${by}-${g.category}`} x={p.x} y={p.y} fontSize={10} fontWeight={700} letterSpacing={1} textAnchor="middle" dominantBaseline="middle" transform={`rotate(${flip ? g.angle + 180 : g.angle} ${p.x} ${p.y})`} fill="#3b4652" style={{ animation: "kpiFade .7s .5s both" }}>{g.category.toUpperCase()}</text>;
              })}
              {all.map((slot) => {
                const it = here.get(slot.id) || slot, visible = here.has(slot.id);
                const ang = it.angle > 180 ? it.angle - 360 : it.angle; // short way round when tiles move
                const p = pos(ang, R), right = ang >= 0;
                const active = pick === it.id;
                return (
                  <g key={it.id} role="button" tabIndex={visible ? 0 : -1} aria-hidden={!visible} aria-label={`${it.name}: ${it.status === "on" ? "on track" : it.status === "off" ? "off track" : "no result"}`}
                    style={{ cursor: "pointer", opacity: visible ? 1 : 0, pointerEvents: visible ? "auto" : "none", transform: `translate(${p.x}px, ${p.y}px) rotate(${ang}deg)`, transition: "transform .9s cubic-bezier(.4,0,.2,1), opacity .5s" }}
                    onClick={() => setPick(active ? "" : it.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setPick(active ? "" : it.id); } }}>
                    <rect x={-13} y={-13} width={26} height={26} rx={3} fill={COLOUR[it.status]} stroke={active ? "#1f2a37" : "none"} strokeWidth={2.5} />
                    <text fontSize={14} fontWeight={700} fill="#fff" textAnchor="middle" dominantBaseline="central">{it.status === "on" ? "○" : it.status === "off" ? "✕" : "–"}</text>
                    <text y={-22} fontSize={11} fill="#3b4652" textAnchor={right ? "start" : "end"} dominantBaseline="middle" transform={`rotate(${right ? -90 : 90} 0 -22)`}>{it.name}</text>
                  </g>
                );
              })}
              <text x={C} y={C - 88} textAnchor="middle" fontSize={20} fontWeight={600} fill="#1f2a37">{monthLong(at)}</text>
              <circle cx={C} cy={C + 10} r={52} fill="none" stroke={COLOUR.off} strokeWidth={5} />
              <circle cx={C} cy={C + 10} r={52} fill="none" stroke={COLOUR.on} strokeWidth={5} strokeDasharray={`${(share / 100) * ring} ${ring}`} transform={`rotate(-90 ${C} ${C + 10})`} />
              <text x={C} y={C + 18} textAnchor="middle" fontSize={26} fontWeight={600} fill="#1f2a37">{scored ? `${share}%` : "–"}</text>
              <text x={C - 100} y={C + 5} textAnchor="middle" fontSize={22} fontWeight={700} fill="#1f2a37">{off}</text>
              <text x={C - 100} y={C + 22} textAnchor="middle" fontSize={10} fontWeight={700} fill="#3b4652">OFF TRACK</text>
              <text x={C + 100} y={C + 5} textAnchor="middle" fontSize={22} fontWeight={700} fill="#1f2a37">{on}</text>
              <text x={C + 100} y={C + 22} textAnchor="middle" fontSize={10} fontWeight={700} fill="#3b4652">ON TRACK</text>
              <text x={C} y={C + 96} textAnchor="middle" fontSize={12} fontWeight={600} fill="#3b4652">{results.length} KPIs</text>
            </svg>
          </div>
          {chosen ? (
            <div className="card pad stack" style={{ gap: 4 }} aria-live="polite">
              <strong>{chosen.def.name}</strong>
              <span>Result <strong className="mono">{chosen.note && chosen.value === undefined ? chosen.note : formatKpi(chosen.def.unit, chosen.value)}</strong> against a target of <span className="mono">{chosen.hasTarget ? formatKpi(chosen.def.unit, chosen.target) : "(not set)"}</span>
                {chosen.onTrack === undefined ? "" : chosen.onTrack ? " · on track" : " · off track"}</span>
              <span className="muted" style={{ fontSize: 13 }}>{chosen.def.how}</span>
            </div>
          ) : <p className="muted" style={{ margin: 0, fontSize: 12 }}>Pick a tile to see its result and how it is worked out. Targets are set under KPIs › Edit targets.</p>}
        </>
      )}
    </section>
  );
}
