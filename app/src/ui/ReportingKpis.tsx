// Reporting › KPIs: the client's key measures for a month, quarter or year, each against its target, with the ones off track picked out.
// "Edit targets" changes a target or switches a KPI off for this client (saved in the planner's settings).
import { useEffect, useMemo, useRef, useState } from "react";
import { CATEGORIES, KPI_DEFS, KpiSettings, alertWording, computeKpis, formatKpi, triggeredAlerts } from "../lib/kpis";
import { PeriodKind, monthLong } from "../lib/reportData";
import { readSetting, useData } from "./data";
import { Seg, useReportData } from "./reportingKit";

export function KpiScreen({ clientKey, clientName, yearEnd, tenant }: { clientKey: string; clientName: string; yearEnd?: string; tenant: { tenantId: string; tenantName: string } }) {
  const r = useReportData(clientKey, tenant);
  const { data, saveSetting } = useData();
  const key = `reporting.kpi.${clientKey}`;
  const settings = readSetting<KpiSettings>(data.settings, key) || {};
  const [kind, setKind] = useState<PeriodKind>("month");
  const [anchor, setAnchor] = useState("");
  const [edit, setEdit] = useState(false);
  const [filter, setFilter] = useState<"all" | "on" | "off">("all");
  const [saving, setSaving] = useState(false);
  const endMonth = Number((/^(\d{2})-/.exec(yearEnd || "") || [])[1]) || 12;
  const d = r.data;
  const months = d?.months || [];
  const at = anchor && months.includes(anchor) ? anchor : months[months.length - 1] || "";

  const tried = useRef("");
  useEffect(() => {
    if (r.checked && !r.data && !r.busy && !r.error && tried.current !== clientKey) { tried.current = clientKey; void r.refresh(); }
  }, [r.checked, r.data, r.busy, r.error, clientKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const results = useMemo(() => (d && at ? computeKpis(d, kind, at, endMonth, edit ? { ...settings, off: [] } : settings) : []), [d, at, kind, endMonth, edit, settings.targets, settings.off]); // eslint-disable-line react-hooks/exhaustive-deps
  const off = new Set(settings.off || []);
  const shown = results.filter((x) => filter === "all" || (filter === "on" ? x.onTrack === true : x.onTrack === false));
  const counts = { all: results.length, on: results.filter((x) => x.onTrack === true).length, off: results.filter((x) => x.onTrack === false).length };

  const save = async (next: KpiSettings) => {
    setSaving(true);
    try { await saveSetting(key, next); } finally { setSaving(false); }
  };
  const setTarget = (id: string, text: string) => {
    const targets = { ...(settings.targets || {}) };
    const n = Number(text);
    if (text.trim() === "" || Number.isNaN(n) || n === KPI_DEFS.find((k) => k.id === id)?.target) delete targets[id];
    else targets[id] = n;
    void save({ ...settings, targets });
  };
  const toggle = (id: string) => void save({ ...settings, off: off.has(id) ? (settings.off || []).filter((x) => x !== id) : [...(settings.off || []), id] });

  return (
    <section className="stack" style={{ gap: 12, minWidth: 0 }} aria-label="KPIs">
      <div className="row-wrap" style={{ gap: 10, alignItems: "center", justifyContent: "space-between" }}>
        <div className="row-wrap" style={{ gap: 10, alignItems: "center" }}>
          <h2 className="sec-h">KPIs</h2>
          <span className="muted" style={{ fontSize: 13 }}>{clientName}</span>
        </div>
        <div className="row-wrap" style={{ gap: 8, alignItems: "center" }}>
          <span className="muted" style={{ fontSize: 12 }} aria-live="polite">{r.busy || (d ? `Read from Xero ${new Date(d.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : "")}</span>
          <button type="button" className="btn small" disabled={!!r.busy} onClick={() => void r.refresh()}>{d ? "Refresh from Xero" : "Read from Xero"}</button>
        </div>
      </div>
      {r.error && <div className="alert red"><strong>Couldn't read the figures</strong><span>{r.error}</span></div>}
      {d?.notes.map((n) => <div key={n} className="alert amber"><span>{n}</span></div>)}
      {triggeredAlerts(results, settings).length > 0 && (
        <div className="alert red" role="status"><strong>{triggeredAlerts(results, settings).length} alert{triggeredAlerts(results, settings).length === 1 ? "" : "s"} triggered</strong>
          <span>{triggeredAlerts(results, settings).map((f) => `${alertWording(f.def)} ${formatKpi(f.def.unit, f.threshold)} (now ${formatKpi(f.def.unit, f.value)})`).join(" · ")}</span></div>
      )}

      {d && (
        <>
          <div className="row-wrap" style={{ gap: 10, alignItems: "center" }}>
            <span className="muted" style={{ fontSize: 13 }}>For the</span>
            <Seg value={kind} set={setKind} opts={[["month", "Month"], ["quarter", "Quarter"], ["year", "Year"]]} label="Period" />
            <span className="muted" style={{ fontSize: 13 }}>of</span>
            <select aria-label="Month" value={at} onChange={(e) => setAnchor(e.target.value)}>
              {[...months].reverse().map((m) => <option key={m} value={m}>{monthLong(m)}</option>)}
            </select>
            <span style={{ flex: 1 }} />
            <Seg value={filter} set={setFilter} opts={[["all", `All KPIs ${counts.all}`], ["on", `On track ${counts.on}`], ["off", `Off track ${counts.off}`]]} label="Show" />
            <button type="button" className="btn small" aria-pressed={edit} onClick={() => setEdit(!edit)}>{edit ? "Done" : "Edit targets"}</button>
          </div>

          <div className="card" style={{ overflowX: "auto" }}>
            <table className="grid">
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>KPI</th>
                  <th className="num" style={{ textAlign: "right" }}>Result</th>
                  <th className="num" style={{ textAlign: "right" }}>Target{kind !== "month" ? " (for the period)" : ""}</th>
                  <th style={{ textAlign: "center" }}>Status</th>
                  <th className="num" style={{ textAlign: "right" }}>vs target</th>
                  {edit && <th>Monthly target</th>}
                </tr>
              </thead>
              <tbody>
                {CATEGORIES.map((cat) => {
                  const list = shown.filter((x) => x.def.category === cat);
                  if (!list.length) return null;
                  return [
                    <tr key={cat} style={{ background: "var(--surface-2)" }}><td colSpan={edit ? 6 : 5} style={{ fontWeight: 700, fontSize: 12, letterSpacing: 0.4 }}>{cat.toUpperCase()}</td></tr>,
                    ...list.map((x) => (
                      <tr key={x.def.id} style={{ opacity: off.has(x.def.id) ? 0.45 : 1 }} title={x.def.how}>
                        <td>{x.def.name}{x.def.lowerIsBetter ? "*" : ""}</td>
                        <td className="num mono" style={{ textAlign: "right" }}>{x.note && x.value === undefined ? <span className="muted" style={{ fontSize: 11 }}>{x.note}</span> : formatKpi(x.def.unit, x.value)}</td>
                        <td className="num mono muted" style={{ textAlign: "right" }}>{formatKpi(x.def.unit, x.target)}</td>
                        <td style={{ textAlign: "center", color: x.onTrack === undefined ? "var(--muted)" : x.onTrack ? "#2f8f4e" : "#c0392b", fontWeight: 700 }} aria-label={x.onTrack === undefined ? "No result" : x.onTrack ? "On track" : "Off track"}>{x.onTrack === undefined ? "–" : x.onTrack ? "✓" : "✕"}</td>
                        <td className="num mono" style={{ textAlign: "right" }}>{x.gap === undefined ? "–" : `${x.gap > 0 ? "+" : ""}${formatKpi(x.def.unit === "days" ? "days" : x.def.unit, x.gap)}`}</td>
                        {edit && (
                          <td style={{ whiteSpace: "nowrap" }}>
                            <input aria-label={`Target for ${x.def.name}`} type="number" step="any" disabled={saving} defaultValue={settings.targets?.[x.def.id] ?? x.def.target} style={{ width: 90 }} onBlur={(e) => setTarget(x.def.id, e.target.value)} />
                            <label style={{ marginLeft: 8, fontSize: 12 }}><input type="checkbox" checked={!off.has(x.def.id)} disabled={saving} onChange={() => toggle(x.def.id)} /> Show</label>
                          </td>
                        )}
                      </tr>
                    )),
                  ];
                })}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            * A result below the target is the good side. Hover a KPI for how it is worked out. Amounts have their monthly target added up for a quarter or year; returns are scaled to a full year.
            Targets start at standard values and are saved for this client when you change them.
          </p>
        </>
      )}
    </section>
  );
}
