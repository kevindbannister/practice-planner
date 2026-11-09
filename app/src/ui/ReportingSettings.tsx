// Reporting › Settings, for one client: which KPIs are used and how important each is, the monthly target for each, and the alerts that
// flag a KPI going the wrong way. All of it is saved with the client in the planner's settings and used by KPIs, KPI Explorer and the alerts.
import { useMemo, useState } from "react";
import { CATEGORIES, IMPORTANCE_LEVELS, Importance, KPI_DEFS, KpiDef, KpiSettings, alertWording, computeKpis, formatKpi, importanceOf, triggeredAlerts } from "../lib/kpis";
import { readSetting, useData } from "./data";
import { Seg, useReportData } from "./reportingKit";

type Tenant = { tenantId: string; tenantName: string };
const TABS: [string, string][] = [["kpis", "KPIs"], ["targets", "Targets"], ["alerts", "Alerts"]];
const COLOUR: Record<Importance, string> = { Critical: "#d0342c", High: "#e08a1e", Medium: "#3b82c4", Low: "#8a949e" };
const unitNote = (d: KpiDef) => (d.unit === "percent" ? "%" : d.unit === "days" ? "days" : d.unit === "ratio" ? ": 1" : d.perMonth ? "£ a month" : "£");

export function ReportingSettings({ clientKey, clientName, yearEnd, tenant, tab }: { clientKey: string; clientName: string; yearEnd?: string; tenant: Tenant; tab?: string }) {
  const { data, saveSetting } = useData();
  const r = useReportData(clientKey, tenant);
  const key = `reporting.kpi.${clientKey}`;
  const settings = readSetting<KpiSettings>(data.settings, key) || {};
  const off = new Set(settings.off || []);
  const [saving, setSaving] = useState(false), [copyFrom, setCopyFrom] = useState(""), [note, setNote] = useState("");
  const [which, setWhich] = useState(TABS.some(([k]) => k === tab) ? (tab as string) : "kpis");
  const endMonth = Number((/^(\d{2})-/.exec(yearEnd || "") || [])[1]) || 12;
  const save = async (next: KpiSettings) => { setSaving(true); try { await saveSetting(key, next); } finally { setSaving(false); } };

  const latest = r.data?.months[r.data.months.length - 1] || "";
  const results = useMemo(() => (r.data && latest ? computeKpis(r.data, "month", latest, endMonth, settings) : []), [r.data, latest, endMonth, settings.targets, settings.off]); // eslint-disable-line react-hooks/exhaustive-deps
  const fired = triggeredAlerts(results, settings);

  const others = data.clients.filter((c) => c.Key !== clientKey && readSetting<KpiSettings>(data.settings, `reporting.kpi.${c.Key}`)).sort((a, b) => String(a.Title).localeCompare(String(b.Title)));
  const copy = async () => {
    const from = readSetting<KpiSettings>(data.settings, `reporting.kpi.${copyFrom}`);
    if (!from) return;
    await save(JSON.parse(JSON.stringify(from)));
    setNote(`Copied from ${data.clients.find((c) => c.Key === copyFrom)?.Title}.`); setCopyFrom("");
  };

  const setTarget = (id: string, text: string) => {
    const targets = { ...(settings.targets || {}) };
    const n = Number(text);
    if (text.trim() === "" || Number.isNaN(n) || n === KPI_DEFS.find((k) => k.id === id)?.target) delete targets[id]; else targets[id] = n;
    void save({ ...settings, targets });
  };
  const setImportance = (id: string, v: Importance) => {
    const importance = { ...(settings.importance || {}) };
    if (v === importanceOf(id)) delete importance[id]; else importance[id] = v;
    void save({ ...settings, importance });
  };
  const toggle = (id: string) => void save({ ...settings, off: off.has(id) ? (settings.off || []).filter((x) => x !== id) : [...(settings.off || []), id] });
  const setAlert = (id: string, patch: { on?: boolean; threshold?: number | null }) => {
    const alerts = { ...(settings.alerts || {}) };
    const cur = alerts[id] || { on: false };
    const next = { on: patch.on ?? cur.on, threshold: patch.threshold === null ? undefined : patch.threshold ?? cur.threshold };
    if (!next.on && next.threshold === undefined) delete alerts[id]; else alerts[id] = next.threshold === undefined ? { on: next.on } : { on: next.on, threshold: next.threshold };
    void save({ ...settings, alerts });
  };
  const switchTab = (k: string) => { setWhich(k); window.history.replaceState(null, "", `#/reporting/${encodeURIComponent(clientKey)}/settings/${k}`); };

  const rowStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr) minmax(0, 1fr) 60px", gap: 10, alignItems: "center", padding: "7px 4px", borderTop: "1px solid var(--line-soft, #eef2f7)", fontSize: 13 };
  const toggleBox = (on: boolean, label: string, click: () => void) => (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={saving} onClick={click} style={{ width: 38, height: 20, borderRadius: 10, border: 0, background: on ? "#6f9a3a" : "#cdd3d9", position: "relative", cursor: "pointer" }}>
      <span style={{ position: "absolute", top: 2, left: on ? 20 : 2, width: 16, height: 16, borderRadius: 8, background: "#fff", transition: "left .15s" }} />
    </button>
  );

  return (
    <section className="stack" style={{ gap: 12, minWidth: 0 }} aria-label="Reporting settings">
      <div className="row-wrap" style={{ gap: 10, alignItems: "center", justifyContent: "space-between" }}>
        <div className="row-wrap" style={{ gap: 10, alignItems: "center" }}><h2 className="sec-h">Reporting settings</h2><span className="muted" style={{ fontSize: 13 }}>{clientName}</span></div>
        <div className="row-wrap" style={{ gap: 8, alignItems: "center" }}>
          {saving && <span className="muted" style={{ fontSize: 12 }} aria-live="polite">Saving…</span>}
          {others.length > 0 && <>
            <select aria-label="Copy settings from" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}><option value="">Copy settings from…</option>{others.map((c) => <option key={c.Key} value={c.Key}>{String(c.Title)}</option>)}</select>
            <button type="button" className="btn small" disabled={!copyFrom || saving} onClick={() => void copy()}>Copy</button>
          </>}
        </div>
      </div>
      {note && <div className="alert green" role="status"><span>{note}</span></div>}
      <Seg value={which} set={switchTab} opts={TABS} label="Settings" />

      {which === "kpis" && (
        <div className="card pad">
          <p className="muted" style={{ margin: "0 0 8px", fontSize: 13 }}>Choose the KPIs used for this client and how important each is. Importance groups the KPI Explorer; a KPI switched off is left out of KPIs, the Explorer and alerts.</p>
          {CATEGORIES.map((cat) => (
            <div key={cat} style={{ marginBottom: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 13, margin: "6px 0" }}>{cat}</div>
              {KPI_DEFS.filter((k) => k.category === cat).map((k) => {
                const imp = importanceOf(k.id, settings);
                return (
                  <div key={k.id} style={rowStyle}>
                    <span style={{ opacity: off.has(k.id) ? 0.5 : 1 }}>{k.name}</span>
                    <span className="muted" style={{ fontSize: 12 }}>{k.how.split(".")[0]}</span>
                    <select aria-label={`${k.name} importance`} value={imp} onChange={(e) => setImportance(k.id, e.target.value as Importance)} style={{ color: COLOUR[imp], fontWeight: 600 }}>{IMPORTANCE_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}</select>
                    {toggleBox(!off.has(k.id), `${k.name} in use`, () => toggle(k.id))}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {which === "targets" && (
        <div className="card pad">
          <p className="muted" style={{ margin: "0 0 8px", fontSize: 13 }}>The monthly target for each KPI. Amounts are per month (a quarter or a year uses the months added up); percentages, days and ratios are the same whatever the period. Clear a box to go back to the standard.</p>
          {CATEGORIES.map((cat) => (
            <div key={cat} style={{ marginBottom: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 13, margin: "6px 0" }}>{cat}</div>
              {KPI_DEFS.filter((k) => k.category === cat).map((k) => (
                <div key={k.id} style={rowStyle}>
                  <span style={{ opacity: off.has(k.id) ? 0.5 : 1 }}>{k.name}</span>
                  <span className="muted" style={{ fontSize: 12 }}>{k.lowerIsBetter ? "Aim to stay under" : "Aim to reach"} · {k.noStandard ? "no standard: set one for this client" : `standard ${formatKpi(k.unit, k.target)}${k.perMonth ? " a month" : ""}`}</span>
                  <input type="number" step="any" aria-label={`${k.name} target`} defaultValue={settings.targets?.[k.id] ?? ""} placeholder={k.noStandard ? "not set" : String(k.target)} key={`${k.id}-${settings.targets?.[k.id] ?? ""}`} onBlur={(e) => { if (e.target.value !== String(settings.targets?.[k.id] ?? "")) setTarget(k.id, e.target.value); }} style={{ textAlign: "right" }} />
                  <span className="muted" style={{ fontSize: 12 }}>{unitNote(k)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {which === "alerts" && (
        <>
          <div className="card pad">
            <p className="muted" style={{ margin: "0 0 8px", fontSize: 13 }}>Turn on an alert and set the monthly threshold; it shows on the KPIs screen when the latest result is on the wrong side. With no threshold set, the KPI's target is used.</p>
            {KPI_DEFS.filter((k) => !off.has(k.id)).map((k) => {
              const a = settings.alerts?.[k.id];
              return (
                <div key={k.id} style={rowStyle}>
                  <span style={{ opacity: a?.on ? 1 : 0.55 }}>{alertWording(k)}</span>
                  <span className="muted" style={{ fontSize: 12 }}>{a?.on ? "Active" : "Off"}</span>
                  <input type="number" step="any" aria-label={`${k.name} alert threshold`} disabled={!a?.on} key={`${k.id}-${a?.threshold ?? ""}`} defaultValue={a?.threshold ?? ""} placeholder={String(settings.targets?.[k.id] ?? k.target)} onBlur={(e) => { const t = e.target.value.trim(); const n = Number(t); setAlert(k.id, { threshold: t === "" || Number.isNaN(n) ? null : n }); }} style={{ textAlign: "right" }} />
                  {toggleBox(!!a?.on, `${k.name} alert`, () => setAlert(k.id, { on: !a?.on }))}
                </div>
              );
            })}
          </div>
          <div className="card pad">
            <strong style={{ fontSize: 13 }}>Triggered for the latest month{latest ? "" : ""}</strong>
            {!r.data ? <p className="muted" style={{ margin: "6px 0 0", fontSize: 13 }}>{r.busy || "Read the figures from Xero (Financials › Read from Xero) to see which alerts fire."}</p>
              : fired.length === 0 ? <p className="muted" style={{ margin: "6px 0 0", fontSize: 13 }}>None of the alerts that are on has fired.</p>
              : fired.map((f) => <p key={f.def.id} style={{ margin: "6px 0 0", fontSize: 13, color: "#d0342c" }}>{alertWording(f.def)} {formatKpi(f.def.unit, f.threshold)}: now {formatKpi(f.def.unit, f.value)}</p>)}
          </div>
        </>
      )}
    </section>
  );
}
