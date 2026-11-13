import { todayIso } from "../lib/domain";
// Development Hub: the roadmap, the external approvals tracker and the architecture decision register.
import React, { useMemo, useState } from "react";
import {
  API_STATUSES, ApiStatus, DECISION_STATUSES, Decision, DecisionStatus, Integration, Milestone, PRIORITIES, Priority, dueFollowUps, featuresUnder, issueUrl, looksSecret, outstanding,
  progressOf, reviseDecision,
} from "../lib/devHub";
import { SEED_ROADMAP } from "../lib/devHubSeed";
import { Bar, STATUS_COLOR, StatusChip, statusParts, useHub } from "./devHubKit";

const today = () => todayIso();

// ------------------------------------------------------------------ roadmap

export function DevRoadmap() {
  const hub = useHub();
  const [adding, setAdding] = useState(false);
  const open = outstanding(hub.integrations).length;
  return (
    <section className="stack" style={{ gap: 12, minWidth: 0 }} aria-label="Roadmap">
      <h2 className="sec-h">Roadmap</h2>
      <p className="muted tip" style={{ margin: 0 }}>The five agreed priorities, in order. Bars show where each group of features actually stands: the dark green part is features verified complete live; nothing is counted as done because code exists. No dates are shown until some are agreed.</p>
      <div className="alert blue"><strong>Parallel track: external approvals</strong><span>{open} of {hub.integrations.length} approvals still need action. These run alongside every priority below.</span><a className="btn small" href="#/devhub/integrations">Open approvals</a></div>
      {SEED_ROADMAP.map((p, idx) => {
        const feats = featuresUnder(hub.features, p.items.flatMap((i) => i.features));
        const pr = progressOf(feats);
        const blocked = feats.filter((f) => f.status === "Blocked" || f.status === "Broken");
        return (
          <div key={p.id} className="card pad stack" style={{ gap: 10 }}>
            <div className="row-wrap" style={{ justifyContent: "space-between" }}>
              <h3 className="sec-h" style={{ fontSize: 17 }}>{p.title}</h3>
              <div className="row-wrap">{p.issue && <a className="chip blue" href={issueUrl(p.issue)} target="_blank" rel="noreferrer">Issue #{p.issue}</a>}<span className="chip">{idx === 0 ? "Work on now" : `Priority ${idx + 1}`}</span></div>
            </div>
            <Bar parts={statusParts(pr.byStatus)} label={`${p.title}: ${pr.complete} of ${pr.total} verified complete, ${pr.pastBuild} built`} />
            <div className="muted" style={{ fontSize: 12 }}>{pr.complete} of {pr.total} features verified complete · {pr.pastBuild} built and past development · {blocked.length} blocked or broken</div>
            <div className="dh-roadmap-items">
              {p.items.map((it) => {
                const fs = featuresUnder(hub.features, it.features);
                const ip = progressOf(fs);
                return (
                  <div key={it.name} className="dh-ritem">
                    <div className="row-wrap" style={{ justifyContent: "space-between", gap: 6 }}><strong style={{ fontSize: 13 }}>{it.name}</strong><span className="muted" style={{ fontSize: 12 }}>{fs.length ? `${ip.complete}/${fs.length}` : "no features"}</span></div>
                    {fs.length ? <Bar parts={statusParts(ip.byStatus)} label={`${it.name}: ${ip.complete} of ${fs.length} verified complete`} /> : <div className="dh-bar empty" />}
                    <div className="row-wrap" style={{ gap: 4 }}>{fs.slice(0, 4).map((f) => <a key={f.id} className="dh-mini" href={`#/devhub/map/${f.id}`} title={`${f.name}: ${f.status}`}><i style={{ background: STATUS_COLOR[f.status] }} />{f.name}</a>)}{fs.length > 4 && <span className="muted" style={{ fontSize: 11 }}>+{fs.length - 4}</span>}</div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <div className="row-wrap" style={{ justifyContent: "space-between" }}><h3 className="sec-h" style={{ fontSize: 17 }}>Milestones</h3><button type="button" className="btn small" onClick={() => setAdding(true)}>Add milestone</button></div>
      {adding && <MilestoneForm onClose={() => setAdding(false)} />}
      {hub.milestones.items.map((m) => <MilestoneCard key={m.id} m={m} />)}
    </section>
  );
}

function MilestoneCard({ m }: { m: Milestone }) {
  const hub = useHub();
  const [text, setText] = useState("");
  const done = m.items.filter((i) => i.done).length;
  const save = (next: Milestone) => hub.saveMilestones({ items: hub.milestones.items.map((x) => (x.id === m.id ? next : x)) });
  return (
    <div className="card pad stack" style={{ gap: 8 }}>
      <div className="row-wrap" style={{ justifyContent: "space-between" }}>
        <strong>{m.title}</strong>
        <div className="row-wrap"><span className="chip">{m.priority}</span>{m.target && <span className="chip">target {m.target}</span>}{m.issues.map((n) => <a key={n} className="chip blue" href={issueUrl(n)} target="_blank" rel="noreferrer">#{n}</a>)}</div>
      </div>
      <Bar parts={[{ n: done, color: STATUS_COLOR.Complete, title: "Done" }, { n: m.items.length - done, color: "#d1d1d6", title: "To do" }]} label={`${done} of ${m.items.length} steps done`} />
      <ul className="dh-list">{m.items.map((it, i) => <li key={i}><label className="row-wrap" style={{ gap: 6 }}><input type="checkbox" checked={it.done} onChange={() => void save({ ...m, items: m.items.map((x, j) => (j === i ? { ...x, done: !x.done } : x)) })} />{it.text}</label></li>)}</ul>
      <div className="row-wrap"><input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a step" aria-label="Add a step" /><button type="button" className="btn small" disabled={!text.trim()} onClick={() => { void save({ ...m, items: [...m.items, { text: text.trim(), done: false }] }); setText(""); }}>Add</button>
        <label className="row-wrap" style={{ gap: 6, fontSize: 12 }}>Target date <input className="input" type="date" defaultValue={m.target || ""} onBlur={(e) => void save({ ...m, target: e.target.value || undefined })} /></label></div>
      {m.notes && <p className="muted" style={{ margin: 0, fontSize: 12 }}>{m.notes}</p>}
    </div>
  );
}

function MilestoneForm({ onClose }: { onClose: () => void }) {
  const hub = useHub();
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<Priority>("P1");
  const [steps, setSteps] = useState("");
  const add = async () => {
    const m: Milestone = { id: `ms.${Date.now().toString(36)}`, title: title.trim(), priority, done: false, issues: [], notes: "", items: steps.split("\n").map((s) => s.trim()).filter(Boolean).map((text) => ({ text, done: false })) };
    await hub.saveMilestones({ items: [...hub.milestones.items, m] });
    onClose();
  };
  return (
    <div className="card pad stack">
      <label>Milestone<input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <label>Priority<select className="input" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>{PRIORITIES.filter((p) => p !== "None").map((p) => <option key={p}>{p}</option>)}</select></label>
      <label>Steps (one per line)<textarea className="input" rows={4} value={steps} onChange={(e) => setSteps(e.target.value)} /></label>
      <div className="row-wrap"><button type="button" className="btn primary small" disabled={!title.trim()} onClick={() => void add()}>Add milestone</button><button type="button" className="btn small" onClick={onClose}>Cancel</button></div>
    </div>
  );
}

// ------------------------------------------------------------------ external approvals

const STATUS_CHIP: Partial<Record<ApiStatus, string>> = { Operational: "green", "Credentials Received": "green", Approved: "green", Testing: "blue", Applied: "amber", "Awaiting Approval": "amber", "Need to Apply": "amber", Blocked: "red" };

export function DevIntegrations() {
  const hub = useHub();
  const [edit, setEdit] = useState<string>("");
  const [adding, setAdding] = useState(false);
  const due = dueFollowUps(hub.integrations, today());
  const cur = hub.integrations.find((i) => i.id === edit);
  return (
    <section className="stack" style={{ gap: 12, minWidth: 0 }} aria-label="Integrations and approvals">
      <div className="row-wrap" style={{ justifyContent: "space-between" }}><h2 className="sec-h">Integrations &amp; approvals</h2><button type="button" className="btn small" onClick={() => setAdding(true)}>Add integration</button></div>
      <p className="muted" style={{ margin: 0 }}>Applications that may involve waiting periods, started now regardless of the main roadmap order. Nothing is submitted from here: record what you have done. Never put passwords, tokens or API secrets in this tracker.</p>
      {due.length > 0 && <div className="alert amber" role="status"><strong>{due.length} follow-up{due.length === 1 ? " is" : "s are"} due</strong><span>{due.map((d) => `${d.provider} ${d.service}`).join("; ")}</span></div>}
      <div className="card table-wrap">
        <table className="grid">
          <thead><tr><th>Provider</th><th>Service</th><th>Status</th><th>Applied</th><th>Expected reply</th><th>Next action</th><th>Follow up</th><th /></tr></thead>
          <tbody>{hub.integrations.map((i) => (
            <tr key={i.id} className={edit === i.id ? "selected" : undefined}>
              <td data-label="Provider"><strong>{i.provider}</strong></td>
              <td data-label="Service">{i.service}</td>
              <td data-label="Status"><span className={`chip ${STATUS_CHIP[i.status] || ""}`}>{i.status}</span></td>
              <td data-label="Applied">{i.submitted || "—"}</td>
              <td data-label="Expected reply">{i.expected || "—"}</td>
              <td data-label="Next action" style={{ minWidth: 220 }}>{i.next}{i.blockers ? <div className="muted" style={{ fontSize: 12 }}>Blocker: {i.blockers}</div> : null}</td>
              <td data-label="Follow up">{i.followUp ? <span className={i.followUp <= today() ? "chip amber" : ""}>{i.followUp}</span> : "—"}</td>
              <td><button type="button" className="btn small" onClick={() => setEdit(i.id)}>Update</button></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {cur && <IntegrationForm key={cur.id} i={cur} isNew={false} onClose={() => setEdit("")} />}
      {adding && <IntegrationForm i={{ id: `acc.${Date.now().toString(36)}`, provider: "", service: "", requirement: "", status: "Not Checked", next: "", blockers: "", tasks: [], features: [], docs: "" }} isNew onClose={() => setAdding(false)} />}
    </section>
  );
}

function IntegrationForm({ i, isNew, onClose }: { i: Integration; isNew: boolean; onClose: () => void }) {
  const hub = useHub();
  const [v, setV] = useState<Integration>(i);
  const [tasks, setTasks] = useState(i.tasks.join(", "));
  const [err, setErr] = useState("");
  const set = <K extends keyof Integration>(k: K, val: Integration[K]) => setV((x) => ({ ...x, [k]: val }));
  const save = async () => {
    const text = [v.requirement, v.next, v.blockers, v.reference || "", v.notes || ""].join("\n");
    if (looksSecret(text)) { setErr("That looks like a password, token or key. Remove it: this tracker must not hold secrets. Record only where it is kept."); return; }
    if (!v.provider.trim() || !v.service.trim()) { setErr("Give the provider and the service."); return; }
    const nums = tasks.split(/[ ,]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0);
    const hist = (i.history || []).slice();
    if (v.status !== i.status) hist.push({ on: today(), status: v.status });
    await hub.saveIntegration({ ...v, tasks: nums, history: hist }, isNew);
    onClose();
  };
  return (
    <div className="card pad stack" role="group" aria-label={`${v.provider} ${v.service}`}>
      <h3 className="sec-h" style={{ fontSize: 17 }}>{isNew ? "Add integration" : `${i.provider}: ${i.service}`}</h3>
      {!isNew && i.requirement && <p style={{ margin: 0 }}>{i.requirement}</p>}
      <div className="dh-fields">
        {isNew && <><label>Provider<input className="input" value={v.provider} onChange={(e) => set("provider", e.target.value)} /></label><label>API or service<input className="input" value={v.service} onChange={(e) => set("service", e.target.value)} /></label></>}
        <label>Status<select className="input" value={v.status} onChange={(e) => set("status", e.target.value as ApiStatus)}>{API_STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
        <label>Application submitted<input className="input" type="date" value={v.submitted || ""} onChange={(e) => set("submitted", e.target.value || undefined)} /></label>
        <label>Expected response (only if confirmed)<input className="input" type="date" value={v.expected || ""} onChange={(e) => set("expected", e.target.value || undefined)} /></label>
        <label>Reference number<input className="input" value={v.reference || ""} onChange={(e) => set("reference", e.target.value || undefined)} /></label>
        <label>Follow-up reminder<input className="input" type="date" value={v.followUp || ""} onChange={(e) => set("followUp", e.target.value || undefined)} /></label>
        <label>Related issues (numbers)<input className="input" value={tasks} onChange={(e) => setTasks(e.target.value)} placeholder="10" /></label>
      </div>
      {isNew && <label>What is required<textarea className="input" rows={2} value={v.requirement} onChange={(e) => set("requirement", e.target.value)} /></label>}
      <label>Next action<textarea className="input" rows={2} value={v.next} onChange={(e) => set("next", e.target.value)} /></label>
      <label>Blockers<textarea className="input" rows={2} value={v.blockers} onChange={(e) => set("blockers", e.target.value)} /></label>
      <label>Notes (no secrets)<textarea className="input" rows={2} value={v.notes || ""} onChange={(e) => set("notes", e.target.value)} /></label>
      <label>Official documentation link<input className="input" value={v.docs} onChange={(e) => set("docs", e.target.value)} /></label>
      {v.docs && /^https:\/\//.test(v.docs) && <a href={v.docs} target="_blank" rel="noreferrer">Open the official documentation</a>}
      {(v.features.length > 0 || v.tasks.length > 0) && <div className="row-wrap" style={{ gap: 6 }}>{v.features.map((id) => { const f = hub.features.find((x) => x.id === id); return f ? <a key={id} className="chip blue" href={`#/devhub/map/${id}`}>{f.name}</a> : null; })}{v.tasks.map((n) => <a key={n} className="chip" href={issueUrl(n)} target="_blank" rel="noreferrer">#{n}</a>)}</div>}
      {(i.history || []).length > 0 && <div className="muted" style={{ fontSize: 12 }}>History: {(i.history || []).map((h) => `${h.on} → ${h.status}`).join("; ")}</div>}
      {err && <div className="alert red" role="alert"><span>{err}</span></div>}
      <div className="row-wrap"><button type="button" className="btn primary small" onClick={() => void save()}>Save</button><button type="button" className="btn small" onClick={onClose}>Cancel</button></div>
    </div>
  );
}

// ------------------------------------------------------------------ decisions

export function DevDecisions() {
  const hub = useHub();
  const [open, setOpen] = useState<string>("");
  const [form, setForm] = useState<{ d: Decision; isNew: boolean } | null>(null);
  const blank = (): Decision => ({ id: `dec.${Date.now().toString(36)}`, title: "", topic: "", history: [], current: { on: today(), by: hub.user, decision: "", rationale: "", alternatives: "", consequences: "", status: "Proposed" } });
  return (
    <section className="stack" style={{ gap: 12, minWidth: 0 }} aria-label="Architecture and decisions">
      <div className="row-wrap" style={{ justifyContent: "space-between" }}><h2 className="sec-h">Architecture &amp; decisions</h2><button type="button" className="btn small" onClick={() => setForm({ d: blank(), isNew: true })}>Record a decision</button></div>
      <p className="muted" style={{ margin: 0 }}>Why things are the way they are. Changing a decision keeps the earlier wording in its history, and the full roadmap decision log is in <code>docs/BUILD-ROADMAP.md</code>.</p>
      {form && <DecisionForm d={form.d} isNew={form.isNew} onClose={() => setForm(null)} />}
      {hub.decisions.map((d) => (
        <div key={d.id} className="card pad stack" style={{ gap: 8 }}>
          <div className="row-wrap" style={{ justifyContent: "space-between" }}>
            <div><div className="eyebrow">{d.topic}</div><strong>{d.title}</strong></div>
            <div className="row-wrap"><span className={`chip ${d.current.status === "Accepted" ? "green" : d.current.status === "Superseded" || d.current.status === "Rejected" ? "" : "amber"}`}>{d.current.status}</span><span className="chip">{d.current.on}</span></div>
          </div>
          <p style={{ margin: 0 }}>{d.current.decision}</p>
          {d.current.why && <p className="muted" style={{ margin: 0, fontSize: 12 }}>Changed because: {d.current.why}</p>}
          <div className="row-wrap"><button type="button" className="linkbtn" aria-expanded={open === d.id} onClick={() => setOpen(open === d.id ? "" : d.id)}>{open === d.id ? "Hide detail" : "Rationale, alternatives and consequences"}</button><button type="button" className="linkbtn" onClick={() => setForm({ d, isNew: false })}>Revise</button></div>
          {open === d.id && (
            <div className="stack" style={{ gap: 6 }}>
              <div><h3 className="dh-h">Rationale</h3><p style={{ margin: 0 }}>{d.current.rationale}</p></div>
              <div><h3 className="dh-h">Alternatives considered</h3><p style={{ margin: 0 }}>{d.current.alternatives || "None recorded."}</p></div>
              <div><h3 className="dh-h">Consequences</h3><p style={{ margin: 0 }}>{d.current.consequences}</p></div>
              <div className="muted" style={{ fontSize: 12 }}>Recorded by {d.current.by || "unknown"}.</div>
              <div><h3 className="dh-h">History</h3>{d.history.length ? <ul className="dh-list">{d.history.map((h, i) => <li key={i}><strong>{h.on}</strong> ({h.status}): {h.decision}{h.why ? <div className="muted" style={{ fontSize: 12 }}>Changed because: {h.why}</div> : null}</li>)}</ul> : <p className="muted" style={{ margin: 0 }}>No earlier versions.</p>}</div>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

function DecisionForm({ d, isNew, onClose }: { d: Decision; isNew: boolean; onClose: () => void }) {
  const hub = useHub();
  const [title, setTitle] = useState(d.title);
  const [topic, setTopic] = useState(d.topic);
  const [v, setV] = useState({ ...d.current, why: "" });
  const [err, setErr] = useState("");
  const save = async () => {
    if (!title.trim() || !v.decision.trim() || !v.rationale.trim()) { setErr("A decision needs a title, the decision and its rationale."); return; }
    if (isNew) await hub.saveDecision({ ...d, title: title.trim(), topic: topic.trim() || "General", current: { ...v, by: hub.user, on: today() } }, true);
    else {
      const next = reviseDecision({ ...d, title: title.trim(), topic: topic.trim() || d.topic }, { ...v, by: hub.user }, today());
      if (next === d && title.trim() === d.title) { onClose(); return; }
      await hub.saveDecision({ ...next, title: title.trim(), topic: topic.trim() || next.topic }, false);
    }
    onClose();
  };
  const set = <K extends keyof typeof v>(k: K, x: (typeof v)[K]) => setV((s) => ({ ...s, [k]: x }));
  return (
    <div className="card pad stack" role="group" aria-label={isNew ? "Record a decision" : `Revise ${d.title}`}>
      <h3 className="sec-h" style={{ fontSize: 17 }}>{isNew ? "Record a decision" : `Revise: ${d.title}`}</h3>
      <div className="dh-fields"><label>Title<input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></label><label>Topic<input className="input" value={topic} onChange={(e) => setTopic(e.target.value)} /></label>
        <label>Status<select className="input" value={v.status} onChange={(e) => set("status", e.target.value as DecisionStatus)}>{DECISION_STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label></div>
      <label>Decision<textarea className="input" rows={3} value={v.decision} onChange={(e) => set("decision", e.target.value)} /></label>
      <label>Rationale<textarea className="input" rows={3} value={v.rationale} onChange={(e) => set("rationale", e.target.value)} /></label>
      <label>Alternatives considered<textarea className="input" rows={2} value={v.alternatives} onChange={(e) => set("alternatives", e.target.value)} /></label>
      <label>Consequences<textarea className="input" rows={2} value={v.consequences} onChange={(e) => set("consequences", e.target.value)} /></label>
      {!isNew && <label>Why it is changing (kept in the history)<input className="input" value={v.why} onChange={(e) => set("why", e.target.value)} /></label>}
      {err && <div className="alert red"><span>{err}</span></div>}
      <div className="row-wrap"><button type="button" className="btn primary small" onClick={() => void save()}>Save</button><button type="button" className="btn small" onClick={onClose}>Cancel</button></div>
    </div>
  );
}
