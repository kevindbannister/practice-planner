// Dependencies for one task or job: what it is waiting on and why, the chain behind it, and adding, overriding or removing a dependency.
// Everything is calculated from the dependency records and the real state of the work they point at (lib/work/readiness). Nothing is guessed from titles.
import { useEffect, useMemo, useState } from "react";
import { newKey } from "../lib/planning";
import { Row } from "../lib/schema";
import { Dependency, Ref, dependencyRow, depEventRow, readDependency, transition, validateDependency, DEP_LABEL, DEP_TYPES, DepType } from "../lib/work/dependencies";
import { READINESS_LABEL, World, assess, chain, evaluate, integrity, syncPlan } from "../lib/work/readiness";
import { readTask } from "../lib/work/model";
import { readTaskEvent } from "../lib/work/clientActions";
import { isOnHold } from "../lib/domain";
import { useData, useIndex } from "./data";
import { useEditor } from "./Editors";

const CHIP: Record<string, string> = { ready: "green", partly_ready: "amber", blocked: "red", waiting: "blue", on_hold: "", complete: "green" };

/** The world the engine reads, built from what is loaded. */
export function useWorld(): World {
  const { data } = useData(); const idx = useIndex();
  return useMemo(() => {
    const events = (data.taskEvents as Row[]).map(readTaskEvent), verified = new Set(events.filter((e) => e.type === "verified").map((e) => e.taskKey));
    const tasks = new Map((data.tasks as Row[]).map((r) => [String(r.Key), readTask(r)]));
    const jobs = new Map((data.jobs as Row[]).map((j) => [String(j.Key), { key: String(j.Key), title: String(j.Title || ""), status: String(j.Status || ""), stageNo: Number(j.StageNo) || 1, stageCount: (idx.stagesByService.get(String(j.ServiceKey || "")) || []).length, onHold: isOnHold(j as never), clientKey: String(j.ClientKey || ""), deadline: String(j.Deadline || "") }]));
    return { deps: (data.dependencies as Row[]).map(readDependency), tasks, jobs, verified: (k: string) => verified.has(k), stageName: (jk: string, n: number) => { const sv = (data.jobs as Row[]).find((j) => j.Key === jk)?.ServiceKey; const st = (idx.stagesByService.get(String(sv || "")) || []).find((s) => Number(s.StageNo) === n); return String(st?.Title || `stage ${n}`); } };
  }, [data.dependencies, data.tasks, data.jobs, data.taskEvents, idx]);
}

export function ReadinessChip({ kind, id }: { kind: "task" | "job"; id: string }) {
  const w = useWorld(); const a = assess(kind, id, w);
  if (a.readiness === "ready" || a.readiness === "complete") return null;
  return <span className={`chip ${CHIP[a.readiness]}`} title={a.reasons.join(" ")}>{READINESS_LABEL[a.readiness]}</span>;
}

export function DependencyPanel({ kind, id }: { kind: "task" | "job"; id: string }) {
  const { data, create, update, user } = useData(); const idx = useIndex(); const editor = useEditor(); const w = useWorld();
  const [adding, setAdding] = useState(false); const [error, setError] = useState<string>(); const [why, setWhy] = useState<{ key: string; text: string }>();
  const a = assess(kind, id, w), ch = chain(kind, id, w);
  const mine = w.deps.filter((d) => (d.dependent.kind === "job" ? "job" : "task") === kind && d.dependent.key === id && d.status !== "cancelled");
  const problems = integrity(w).filter((i) => mine.some((d) => d.key === i.depKey));
  const ctx = () => ({ by: user || "", now: new Date().toISOString(), key: () => newKey("V") });
  // keep the records in step with the facts: satisfied once truly met and checked, reopened if it went back
  useEffect(() => {
    const only = { ...w, deps: mine };
    for (const p of syncPlan(only, ctx())) { const row = (data.dependencies as Row[]).find((r) => r.Key === p.dep.key); if (row) void update("Dependencies", row, { Status: p.dep.status, ResolvedAt: p.dep.resolvedAt, ResolvedBy: p.dep.resolvedBy, Version: p.dep.version }).then(() => create("DependencyEvents", depEventRow(p.event))).catch(() => undefined); }
  }, [JSON.stringify(mine.map((d) => [d.key, d.status])), w.tasks, w.jobs]);
  const change = async (d: Dependency, to: "active" | "overridden" | "cancelled", reason = "") => {
    const r = transition(d, to, { ...ctx(), eventKey: newKey("V"), reason }); if (r.error || !r.dep || !r.event) return setError(r.error);
    setError(undefined);
    const row = (data.dependencies as Row[]).find((x) => x.Key === d.key); if (!row) return;
    try { await update("Dependencies", row, { Status: r.dep.status, ResolvedAt: r.dep.resolvedAt, ResolvedBy: r.dep.resolvedBy, OverrideReason: r.dep.overrideReason, Version: r.dep.version }); await create("DependencyEvents", depEventRow(r.event)); setWhy(undefined); } catch { setError("That didn't save. Try again."); }
  };
  const open = (r: Ref) => editor.open(r.kind === "job" ? { kind: "job", key: r.key } : { kind: "task", key: r.key });
  return (
    <section className="stack" aria-label="Dependencies" style={{ gap: 8 }}>
      <div className="row-wrap" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>Dependencies {a.readiness !== "ready" && <span className={`chip ${CHIP[a.readiness]}`}>{READINESS_LABEL[a.readiness]}</span>}</h3>
        <button type="button" className="btn small" onClick={() => setAdding(!adding)}>{adding ? "Close" : "Add dependency"}</button>
      </div>
      {a.reasons.map((r, i) => <p key={i} style={{ margin: 0 }}>{r}</p>)}
      {a.unknownDates.length > 0 && <p className="muted" style={{ margin: 0 }}>No expected date is known for {a.unknownDates.length === 1 ? "this prerequisite" : "these prerequisites"}. The deadline does not move.</p>}
      {!mine.length && !adding && <p className="muted" style={{ margin: 0 }}>Nothing is holding this back.</p>}
      <ul className="plain stack" style={{ gap: 6, margin: 0 }}>
        {mine.map((d) => { const e = evaluate(d, w); return (
          <li key={d.key} className="stack" style={{ gap: 2 }}>
            <span><span className={`chip ${e.state === "met" || e.state === "overridden" ? "green" : "red"}`}>{e.state === "met" ? "Met" : e.state === "overridden" ? "Overridden" : e.state === "missing" ? "Missing" : e.state === "conflict" ? "Check" : "Waiting"}</span> {e.reason}{d.dependent.stage !== undefined ? ` (holds back ${w.stageName?.(d.dependent.key, d.dependent.stage)})` : ""}{d.expectedCompletion ? ` Expected ${d.expectedCompletion}.` : ""}</span>
            <span className="row-wrap" style={{ gap: 6 }}>
              <button type="button" className="linkbtn" onClick={() => open(d.prerequisite)}>Open prerequisite</button>
              {d.status === "overridden" ? <button type="button" className="linkbtn" onClick={() => void change(d, "active")}>Put back</button> : <button type="button" className="linkbtn" onClick={() => setWhy({ key: d.key, text: "" })}>Override…</button>}
              <button type="button" className="linkbtn" onClick={() => void change(d, "cancelled")}>Remove</button>
            </span>
            {why?.key === d.key && <span className="row-wrap" style={{ gap: 6 }}><input className="input" aria-label="Reason for overriding" placeholder="Why can this go ahead anyway?" value={why.text} onChange={(ev) => setWhy({ key: d.key, text: ev.target.value })} style={{ flex: 1 }} /><button type="button" className="btn small" onClick={() => void change(d, "overridden", why.text)}>Override</button></span>}
          </li>); })}
      </ul>
      {problems.length > 0 && <ul className="import-list warn" aria-label="Problems with these dependencies">{problems.map((p, i) => <li key={i}>{p.text}</li>)}</ul>}
      {ch.nodes.length > 1 && <details><summary>Full chain ({ch.nodes.length})</summary><ul style={{ margin: "6px 0 0", paddingLeft: 16 }}>{ch.nodes.map((n) => <li key={n.kind + n.key} style={{ marginLeft: (n.depth - 1) * 14 }}><button type="button" className="linkbtn" onClick={() => open({ kind: n.kind, key: n.key })}>{n.label}</button> {n.actionable ? <strong>(start here)</strong> : null}<span className="muted"> {n.reason}</span></li>)}</ul></details>}
      {ch.earliest.length > 0 && <p style={{ margin: 0 }}><strong>Earliest step you can act on:</strong> {ch.earliest.map((n) => n.label).join(", ")}.</p>}
      {adding && <AddDependency kind={kind} id={id} onDone={() => setAdding(false)} onError={setError} />}
      {error && <p className="error-text" role="alert">{error}</p>}
    </section>
  );
}

function AddDependency({ kind, id, onDone, onError }: { kind: "task" | "job"; id: string; onDone: () => void; onError: (m?: string) => void }) {
  const { data, create, user } = useData(); const idx = useIndex(); const w = useWorld();
  const me = kind === "job" ? w.jobs.get(id) : w.tasks.get(id);
  const clientKey = (me as { clientKey?: string } | undefined)?.clientKey || "";
  const [type, setType] = useState<DepType>("finish_to_start");
  const [pre, setPre] = useState(""); const [heldStage, setHeldStage] = useState(""); const [needStage, setNeedStage] = useState(""); const [verify, setVerify] = useState(false); const [expected, setExpected] = useState("");
  const options = [
    ...[...w.jobs.values()].filter((j) => j.key !== id || kind !== "job").filter((j) => !["Complete", "Done", "Cancelled"].includes(j.status) && (!clientKey || !j.clientKey || j.clientKey === clientKey)).map((j) => ({ v: `job:${j.key}`, l: `Job: ${j.title}` })),
    ...[...w.tasks.values()].filter((t) => t.key !== id || kind !== "task").filter((t) => !["Done", "Complete", "Cancelled"].includes(t.status) && (!clientKey || !t.clientKey || t.clientKey === clientKey)).map((t) => ({ v: `task:${t.key}`, l: `${t.ownerType === "user" ? "Task" : "Client action"}: ${t.title}` })),
  ];
  const [pk, pid] = pre.split(":") as ["job" | "task", string];
  const stagesOf = (jobKey: string) => { const j = (data.jobs as Row[]).find((r) => r.Key === jobKey); return idx.stagesByService.get(String(j?.ServiceKey || "")) || []; };
  const preStages = pk === "job" ? stagesOf(pid) : [], myStages = kind === "job" ? stagesOf(id) : [];
  const save = async () => {
    const stage = (v: string) => (v ? Number(v) : undefined);
    const prerequisite: Ref = { kind: pk === "job" ? "job" : "task", key: pid, stage: pk === "job" ? stage(needStage) : undefined };
    const dependent: Ref = { kind: kind === "job" ? "job" : "task", key: id, stage: kind === "job" ? stage(heldStage) : undefined };
    const outcome = pk === "job" ? (prerequisite.stage !== undefined ? "stage" : "complete") : type === "approval" ? "approved" : "done";
    const t = type === "partial" && !dependent.stage ? type : type;
    const probs = validateDependency({ prerequisite, dependent, type: t, outcome, overrideReason: "", status: "active" }, w.deps, { tasks: new Set(w.tasks.keys()), jobs: new Set(w.jobs.keys()), stages: new Map([...w.jobs.keys()].map((k) => [k, new Set(stagesOf(k).map((s) => Number(s.StageNo)))])) });
    if (probs.length) return onError(probs[0]);
    const d: Dependency = { key: newKey("DP"), prerequisite, dependent, type: t, outcome, verificationRequired: verify || type === "information", status: "active", expectedCompletion: expected, resolvedAt: "", resolvedBy: "", overrideReason: "", templateKey: "", created: new Date().toISOString(), createdBy: user || "", version: 1 };
    try { await create("Dependencies", dependencyRow(d)); await create("DependencyEvents", depEventRow({ key: newKey("V"), dependencyKey: d.key, type: "create", at: d.created, by: user || "", before: "", after: "active", reason: "" })); onError(undefined); onDone(); } catch { onError("That didn't save. Try again."); }
  };
  return (
    <div className="card pad stack" style={{ gap: 6 }} aria-label="Add a dependency">
      <label className="doc-field"><span>Kind</span><select className="input" value={type} onChange={(e) => setType(e.target.value as DepType)}>{DEP_TYPES.map((t) => <option key={t} value={t}>{DEP_LABEL[t]}</option>)}</select></label>
      <label className="doc-field"><span>This waits for</span><select className="input" value={pre} onChange={(e) => { setPre(e.target.value); setNeedStage(""); }}><option value="">Choose…</option>{options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}</select></label>
      {pk === "job" && <label className="doc-field"><span>…until that job reaches</span><select className="input" value={needStage} onChange={(e) => setNeedStage(e.target.value)}><option value="">Complete</option>{preStages.map((s) => <option key={String(s.Key)} value={String(s.StageNo)}>{String(s.Title)}</option>)}</select></label>}
      {kind === "job" && <label className="doc-field"><span>{type === "partial" ? "Holds back this stage" : "Only holds back this stage (optional)"}</span><select className="input" value={heldStage} onChange={(e) => setHeldStage(e.target.value)}><option value="">{type === "partial" ? "Choose…" : "The whole job"}</option>{myStages.map((s) => <option key={String(s.Key)} value={String(s.StageNo)}>{String(s.Title)}</option>)}</select></label>}
      <label className="row-wrap"><input type="checkbox" checked={verify || type === "information"} disabled={type === "information"} onChange={(e) => setVerify(e.target.checked)} /> We must check it before it counts</label>
      <label className="doc-field"><span>Expected by (leave blank if not known)</span><input className="input" type="date" value={expected} onChange={(e) => setExpected(e.target.value)} /></label>
      <div><button type="button" className="btn small primary" disabled={!pre} onClick={() => void save()}>Add</button></div>
    </div>
  );
}
