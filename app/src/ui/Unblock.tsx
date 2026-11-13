// "What can I unblock?": the outstanding prerequisites that hold up the most work, ranked by deadline risk, how much they hold up and whether anyone can act on them now.
// Also the deadline risk of every open job. Dates shown are the real ones; where a prerequisite has no known date it says so.
import { useState } from "react";
import { fmtDate } from "../lib/domain";
import { RISK_LABEL, RISK_RANK, DEFAULT_RISK, RiskCategory } from "../lib/work/risk";
import { PlanTabs } from "./bits";
import { useData, useIndex } from "./data";
import { useEditor } from "./Editors";
import { useRisk } from "./riskKit";

export const RISK_CHIP: Record<RiskCategory, string> = { on_track: "green", attention: "amber", at_risk: "red", critical: "red", overdue: "red" };

export function Unblock() {
  const r = useRisk(); const editor = useEditor(); const idx = useIndex(); const { saveSetting } = useData();
  const [all, setAll] = useState(false);
  const open = (k: "task" | "job", key: string) => editor.open(k === "job" ? { kind: "job", key } : { kind: "task", key });
  const jobs = [...r.risks.entries()].filter(([, x]) => all ? true : x.category !== "on_track").sort((a, b) => RISK_RANK[b[1].category] - RISK_RANK[a[1].category] || (r.facts.get(a[0])!.deadline || "9").localeCompare(r.facts.get(b[0])!.deadline || "9"));
  const name = (ck: string) => String(idx.clientByKey.get(ck)?.Title || "");
  return (
    <div className="page">
      <PlanTabs current="unblock" />
      <div className="page-head"><div><h1>What can I unblock?</h1><p className="muted tip" style={{ margin: "4px 0 0" }}>Outstanding prerequisites, most worth acting on first. Deadlines never move because something is waiting.</p></div></div>
      {!r.impacts.length && <p className="card pad muted">Nothing is holding up any work.</p>}
      <ul className="plain stack" style={{ gap: 10, margin: 0 }}>{r.impacts.map((i) => (
        <li key={i.prerequisite.kind + i.prerequisite.key} className="card pad stack" style={{ gap: 4 }}>
          <div className="row-wrap" style={{ justifyContent: "space-between" }}>
            <strong><button type="button" className="linkbtn" onClick={() => open(i.prerequisite.kind, i.prerequisite.key)}>{i.prerequisite.label}</button></strong>
            <span><span className={`chip ${RISK_CHIP[i.worst]}`}>{RISK_LABEL[i.worst]}</span> {i.actionable ? <span className="chip green">You can act</span> : <span className="chip">Not actionable yet</span>}</span>
          </div>
          <span>Holds up {i.direct.length} item{i.direct.length === 1 ? "" : "s"} directly{i.indirect.length ? ` and ${i.indirect.length} further along` : ""}{i.hours ? `, about ${i.hours}h of work` : ""}.</span>
          <span className="muted">{i.direct.concat(i.indirect).slice(0, 6).map((a) => a.label).join(" → ")}</span>
          <span>With: {i.responsible}{i.followUp ? ` · follow up ${fmtDate(i.followUp)}` : " · no follow-up date set"} · {i.expectedKnown && i.expected ? `expected ${fmtDate(i.expected)}` : "no date known"}</span>
          {i.deadlines[0] && <span>Nearest deadline affected: {i.deadlines[0].label}, {fmtDate(i.deadlines[0].date)}{i.deadlines.length > 1 ? ` (and ${i.deadlines.length - 1} more)` : ""}</span>}
          {i.earliest.length > 0 && i.earliest[0].key !== i.prerequisite.key && <span>Earliest step you can act on: <button type="button" className="linkbtn" onClick={() => open(i.earliest[0].kind, i.earliest[0].key)}>{i.earliest[0].label}</button></span>}
        </li>))}</ul>
      <section className="card pad stack" aria-label="Deadline risk">
        <div className="row-wrap" style={{ justifyContent: "space-between" }}><h2 style={{ margin: 0, fontSize: 17 }}>Deadline risk</h2><label className="row-wrap"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show jobs that are on track</label></div>
        {!jobs.length && <p className="muted" style={{ margin: 0 }}>No job needs attention.</p>}
        <ul className="plain stack" style={{ gap: 6, margin: 0 }}>{jobs.map(([k, x]) => { const f = r.facts.get(k)!; return (
          <li key={k}><span className={`chip ${RISK_CHIP[x.category]}`}>{RISK_LABEL[x.category]}</span> <button type="button" className="linkbtn" onClick={() => open("job", k)}>{name(f.clientKey)}: {f.title}</button> <span className="muted">{f.deadline ? `due ${fmtDate(f.deadline)}` : "no deadline"}{x.workingDaysLeft !== null ? ` · ${x.workingDaysLeft} working days` : ""}{x.uncertain ? " · prerequisite date unknown" : ""}{x.reasons[0] ? ` · ${x.reasons[0]}` : ""}</span></li>); })}</ul>
      </section>
      <details className="card pad"><summary>Risk settings</summary>
        <form className="row-wrap" style={{ gap: 8, marginTop: 8 }} onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void saveSetting("work.risk", JSON.stringify({ leadDays: Number(f.get("lead")), focusHours: Number(f.get("focus")), uncertain: { attention: Number(f.get("a")), atRisk: Number(f.get("r")), critical: Number(f.get("c")) } })); }}>
          <label className="doc-field"><span>Spare working days below which a job is at risk</span><input name="lead" className="input" type="number" min={0} defaultValue={r.cfg.leadDays} /></label>
          <label className="doc-field"><span>Hours one job can take in a day</span><input name="focus" className="input" type="number" min={0.25} step={0.25} defaultValue={r.cfg.focusHours} /></label>
          <label className="doc-field"><span>No date known: attention at working days left</span><input name="a" className="input" type="number" min={0} defaultValue={r.cfg.uncertain.attention} /></label>
          <label className="doc-field"><span>…at risk at</span><input name="r" className="input" type="number" min={0} defaultValue={r.cfg.uncertain.atRisk} /></label>
          <label className="doc-field"><span>…critical at</span><input name="c" className="input" type="number" min={0} defaultValue={r.cfg.uncertain.critical} /></label>
          <button className="btn small primary" type="submit">Save</button>
        </form>
        <p className="muted" style={{ marginBottom: 0 }}>Working days use your usual week and any days you've marked off. Bank holidays count as working days unless you mark them off. Defaults: {DEFAULT_RISK.leadDays} spare days, {DEFAULT_RISK.focusHours}h a day.</p>
      </details>
    </div>
  );
}
