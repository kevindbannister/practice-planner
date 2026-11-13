// Dependency templates: the standard "this waits for that" relationships between kinds of work, what they would do now, and what needs a person to decide.
import { useMemo, useState } from "react";
import { can } from "../lib/checklist";
import { newKey } from "../lib/planning";
import { Row } from "../lib/schema";
import { DEP_LABEL, DEP_TYPES, DepType, depEventRow, dependencyRow, readDependency } from "../lib/work/dependencies";
import { Env, JobLite, Outcome, RELATIONS, RELATION_LABEL, Relation, STARTERS, Template, decisionRow, dependencyFor, plan, readJobLite, readTemplate, taskAndDependency, templateProblems, templateRow, usage } from "../lib/work/templates";
import { useChecklists } from "./checklistKit";
import { useData, useIndex } from "./data";
import { useApplyTemplates, useTemplateEnv } from "./templateKit";

export function DependencyTemplatesPage() {
  const { data, create, update, user } = useData(); const idx = useIndex(); const cl = useChecklists();
  const { env, templates, open } = useTemplateEnv(); const apply = useApplyTemplates();
  const canEdit = can(cl.config, user || "", "template");
  const [editing, setEditing] = useState<Template | null>(null); const [msg, setMsg] = useState<string>(); const [error, setError] = useState<string>(); const [busy, setBusy] = useState(false);
  const p = useMemo(() => plan(templates, open, env), [templates, open, env]);
  const jobTitle = (j: JobLite) => { const c = idx.clientByKey.get(j.clientKey); return `${c?.Title || j.clientKey}: ${j.title}${j.periodEnd ? ` (${j.periodEnd})` : ""}`; };
  const services = (data.services as Row[]).map((s) => String(s.Key));
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(undefined); setMsg(undefined); try { await fn(); } catch { setError("That didn't save. Try again."); } finally { setBusy(false); } };
  const createAll = () => run(async () => { const r = await apply(p, env); setMsg(`${r.made} created.${r.skipped.length ? ` ${r.skipped.length} skipped: ${r.skipped[0]}` : ""} Nothing was sent to any client.`); });
  const toggle = (t: Template) => { const probs = templateProblems(t); if (!t.enabled && probs.length) return setError(probs[0]); void run(async () => { const row = (data.depTemplates as Row[]).find((r) => r.Key === t.key)!; await update("DependencyTemplates", row, { Enabled: t.enabled ? "no" : "yes", Version: t.version + 1 }); }); };
  const addStarter = (i: number) => run(async () => { const t: Template = { ...STARTERS[i], key: newKey("DT"), enabled: false, version: 1, created: new Date().toISOString(), createdBy: user || "" }; await create("DependencyTemplates", templateRow(t)); setEditing(t); });
  const resolve = (o: Extract<Outcome, { kind: "review" }>, pre: JobLite) => run(async () => {
    const preStage = o.template.preStage ? (env.stages(pre.serviceKey).findIndex((n) => n.toLowerCase() === o.template.preStage.toLowerCase()) + 1 || undefined) : undefined;
    const d = dependencyFor(o, pre, preStage, env, { user: user || "", now: new Date().toISOString(), key: () => newKey("DP") });
    if ("error" in d) return setError(d.error);
    await create("Dependencies", dependencyRow(d)); await create("DependencyEvents", depEventRow({ key: newKey("V"), dependencyKey: d.key, type: "create", at: d.created, by: user || "", before: "", after: "active", reason: `Confirmed by a person from template: ${o.template.title}` }));
  });
  const decline = (o: Extract<Outcome, { kind: "review" }>) => run(async () => { await create("TemplateDecisions", decisionRow(o.template.key, o.dependent.key, { user: user || "", now: new Date().toISOString(), key: () => newKey("TD") }, "Does not apply")); });
  return (
    <div className="page">
      <div className="page-head"><div><h1>Dependency templates</h1><p className="muted tip" style={{ margin: "4px 0 0" }}>Standard relationships between kinds of work, applied to each new period's jobs. They only fill in what is missing on open jobs and never change finished ones. Nothing is sent to a client.</p></div></div>
      {error && <p className="error-text" role="alert">{error}</p>}{msg && <p role="status">{msg}</p>}
      {p.reviews.length > 0 && <section className="card pad stack" aria-label="Needs a decision"><h2 style={{ margin: 0, fontSize: 17 }}>Needs a decision ({p.reviews.length})</h2>
        {p.reviews.map((o) => <div key={o.template.key + o.dependent.key} className="stack" style={{ gap: 4, borderTop: "1px solid var(--line)", paddingTop: 8 }}>
          <strong>{jobTitle(o.dependent)}</strong><span className="muted">{o.template.title}</span><span>{o.reason}</span>
          <div className="row-wrap" style={{ gap: 6 }}>{o.candidates.map((c) => <button key={c.key} type="button" className="btn small" disabled={!canEdit || busy} onClick={() => void resolve(o, c)}>Wait for: {jobTitle(c)}</button>)}<button type="button" className="btn small" disabled={!canEdit || busy} onClick={() => void decline(o)}>This doesn't apply</button></div>
        </div>)}</section>}
      {(p.links.length > 0 || p.tasks.length > 0) && <section className="card pad stack" aria-label="Ready to create"><h2 style={{ margin: 0, fontSize: 17 }}>Ready to create ({p.links.length + p.tasks.length})</h2>
        <ul style={{ margin: 0, paddingLeft: 18 }}>{p.links.map((o) => <li key={o.template.key + o.dependent.key}>{jobTitle(o.dependent)} will wait for {jobTitle(o.prerequisite)}</li>)}{p.tasks.map((o) => <li key={o.template.key + o.dependent.key}>{jobTitle(o.dependent)} will wait for "{o.title}" (a client task is added; it is not shared)</li>)}</ul>
        <div><button type="button" className="btn primary" disabled={!canEdit || busy} onClick={() => void createAll()}>Create these</button></div></section>}
      <section className="card pad stack" aria-label="Templates">
        <div className="row-wrap" style={{ justifyContent: "space-between" }}><h2 style={{ margin: 0, fontSize: 17 }}>Templates</h2><button type="button" className="btn small primary" disabled={!canEdit} onClick={() => setEditing({ ...STARTERS[1], key: newKey("DT"), title: "", kind: "job", enabled: false, version: 1, created: "", createdBy: user || "", notes: "" })}>New template</button></div>
        {!canEdit && <p className="muted" style={{ margin: 0 }}>Only a manager or partner can change templates.</p>}
        {!templates.length && <p className="muted" style={{ margin: 0 }}>None yet. Start from one of the standard ones below.</p>}
        <ul className="plain stack" style={{ gap: 8, margin: 0 }}>{templates.map((t) => { const used = usage(t, env.deps); const probs = templateProblems(t); return (
          <li key={t.key} className="stack" style={{ gap: 2 }}>
            <span><strong>{t.title || "Untitled"}</strong> <span className={`chip ${t.enabled ? "green" : ""}`}>{t.enabled ? "On" : "Off"}</span>{probs.length > 0 && <span className="chip amber" title={probs.join(" ")}>Not finished</span>}</span>
            <span className="muted">{t.kind === "task" ? `Information: ${t.preTask}` : `Waits for ${t.preService || "?"}${t.preStage ? ` at ${t.preStage}` : ""}`} → {t.depService || "?"}{t.depStage ? ` (holds back ${t.depStage})` : ""} · {RELATION_LABEL[t.relation]} · used on {used.length} job{used.length === 1 ? "" : "s"}</span>
            <span className="row-wrap" style={{ gap: 6 }}><button type="button" className="linkbtn" disabled={!canEdit} onClick={() => setEditing(t)}>Edit</button><button type="button" className="linkbtn" disabled={!canEdit || busy} onClick={() => toggle(t)}>{t.enabled ? "Turn off" : "Turn on"}</button></span>
            {used.length > 0 && <details><summary>Where it is used</summary><ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{used.slice(0, 30).map((d) => { const j = env.jobs.find((x) => x.key === d.dependent.key); return <li key={d.key}>{j ? jobTitle(j) : d.dependent.key} ({d.status})</li>; })}</ul></details>}
          </li>); })}</ul>
        <details><summary>Standard templates to start from</summary><ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{STARTERS.map((s, i) => <li key={i}>{s.title} <button type="button" className="linkbtn" disabled={!canEdit || busy} onClick={() => void addStarter(i)}>Add</button></li>)}</ul></details>
      </section>
      {editing && <TemplateForm key={editing.key} t={editing} services={services} stagesOf={env.stages} exists={templates.some((x) => x.key === editing.key)} onClose={() => setEditing(null)} onSave={(t, exists) => run(async () => { if (exists) { const row = (data.depTemplates as Row[]).find((r) => r.Key === t.key)!; await update("DependencyTemplates", row, templateRow({ ...t, version: t.version + 1 })); } else await create("DependencyTemplates", templateRow({ ...t, created: new Date().toISOString() })); setEditing(null); })} />}
    </div>
  );
}

function TemplateForm({ t, services, stagesOf, exists, onClose, onSave }: { t: Template; services: string[]; stagesOf: (s: string) => string[]; exists: boolean; onClose: () => void; onSave: (t: Template, exists: boolean) => void }) {
  const [v, setV] = useState(t); const set = (p: Partial<Template>) => setV({ ...v, ...p });
  const probs = templateProblems(v);
  const svc = (label: string, val: string, on: (x: string) => void) => <label className="doc-field"><span>{label}</span><select className="input" value={val} onChange={(e) => on(e.target.value)}><option value="">Choose…</option>{services.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>;
  const stage = (label: string, service: string, val: string, on: (x: string) => void, none: string) => <label className="doc-field"><span>{label}</span><select className="input" value={val} onChange={(e) => on(e.target.value)}><option value="">{none}</option>{stagesOf(service).map((n) => <option key={n} value={n}>{n}</option>)}</select></label>;
  return (
    <section className="card pad stack" aria-label="Edit template" style={{ gap: 8 }}>
      <h2 style={{ margin: 0, fontSize: 17 }}>{exists ? "Edit template" : "New template"}</h2>
      <p className="muted tip" style={{ margin: 0 }}>Changes apply to jobs created or checked from now on. Existing dependencies and finished jobs are not changed.</p>
      <label className="doc-field"><span>Name</span><input className="input" value={v.title} onChange={(e) => set({ title: e.target.value })} /></label>
      <label className="doc-field"><span>It waits for</span><select className="input" value={v.kind} onChange={(e) => set({ kind: e.target.value as "job" | "task", relation: e.target.value === "task" ? "same_period" : v.relation, type: e.target.value === "task" ? "information" : v.type })}><option value="job">Another job</option><option value="task">Information to be received</option></select></label>
      {svc("This service waits", v.depService, (x) => set({ depService: x, depStage: "" }))}
      {stage("Holds back only this stage (optional)", v.depService, v.depStage, (x) => set({ depStage: x }), "The whole job")}
      {v.kind === "job" ? <>
        {svc("…for this service", v.preService, (x) => set({ preService: x, preStage: "" }))}
        {stage("…until it reaches", v.preService, v.preStage, (x) => set({ preStage: x }), "Complete")}
        <label className="doc-field"><span>How the jobs are matched</span><select className="input" value={v.relation} onChange={(e) => set({ relation: e.target.value as Relation })}>{RELATIONS.map((r) => <option key={r} value={r}>{RELATION_LABEL[r]}</option>)}</select></label>
      </> : <label className="doc-field"><span>Information (use {"{period}"} for the period end)</span><input className="input" value={v.preTask} onChange={(e) => set({ preTask: e.target.value })} /></label>}
      <label className="doc-field"><span>Kind of dependency</span><select className="input" value={v.type} onChange={(e) => set({ type: e.target.value as DepType })}>{DEP_TYPES.map((d) => <option key={d} value={d}>{DEP_LABEL[d]}</option>)}</select></label>
      <label className="row-wrap"><input type="checkbox" checked={v.verify || v.type === "information"} disabled={v.type === "information"} onChange={(e) => set({ verify: e.target.checked })} /> We must check it before it counts</label>
      <label className="doc-field"><span>Notes</span><input className="input" value={v.notes} onChange={(e) => set({ notes: e.target.value })} /></label>
      {probs.length > 0 && <p className="muted" style={{ margin: 0 }}>Needed before it can be turned on: {probs.join(" ")}</p>}
      <div className="row-wrap" style={{ gap: 6 }}><button type="button" className="btn small primary" onClick={() => onSave(v.enabled && probs.length ? { ...v, enabled: false } : v, exists)}>Save</button><button type="button" className="btn small" onClick={onClose}>Cancel</button></div>
    </section>
  );
}
