// Development Hub: the board. Cards are the repository's GitHub issues (never copies of them). Dragging a card changes the issue's status
// label on GitHub, and closes it when dropped on Done; a move GitHub refuses is shown on the card, not hidden.
import React, { useMemo, useState } from "react";
import { COLUMNS, Column, PRIORITIES, Priority, Task, duplicateIssue, issueUrl } from "../lib/devHub";
import { ISSUE_FEATURES } from "../lib/devHubSeed";
import { PriorityChip, useHub } from "./devHubKit";

const COL_NOTE: Record<Column, string> = { Backlog: "Open, no status yet", Ready: "status:ready", "In Progress": "status:in-progress", Blocked: "status:blocked", Testing: "status:testing", Done: "Closed on GitHub" };

export function DevBoard() {
  const hub = useHub();
  const [open, setOpen] = useState<number | null>(null);
  const [over, setOver] = useState<Column | "">("");
  const [msg, setMsg] = useState<{ kind: "red" | "green" | "amber"; text: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [prio, setPrio] = useState<Priority | "">("");
  const [q, setQ] = useState("");
  const [showDone, setShowDone] = useState(false);
  const tasks = hub.tasks.filter((t) => (!prio || t.priority === prio) && (!q.trim() || `${t.title} #${t.number}`.toLowerCase().includes(q.trim().toLowerCase())));
  const by = (c: Column) => tasks.filter((t) => t.column === c);
  const unsynced = hub.tasks.filter((t) => !t.synced);

  const drop = async (col: Column, e: React.DragEvent) => {
    e.preventDefault(); setOver("");
    const n = Number(e.dataTransfer.getData("text/plain"));
    if (!n) return;
    const err = await hub.moveTask(n, col);
    setMsg(err ? { kind: "red", text: `#${n}: ${err}` } : { kind: "green", text: `#${n} moved to ${col} on GitHub.` });
  };
  const sel = open ? hub.tasks.find((t) => t.number === open) : undefined;

  return (
    <section className="stack" style={{ gap: 12, minWidth: 0 }} aria-label="Development board">
      <div className="row-wrap" style={{ justifyContent: "space-between" }}>
        <h2 className="sec-h">Development board</h2>
        <div className="dh-tools">
          <input className="input" type="search" placeholder="Search issues" aria-label="Search issues" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input" aria-label="Filter by priority" value={prio} onChange={(e) => setPrio(e.target.value as Priority | "")}><option value="">Any priority</option>{PRIORITIES.filter((p) => p !== "None").map((p) => <option key={p}>{p}</option>)}</select>
          <button type="button" className="btn small" onClick={() => void hub.refreshGh()}>Refresh from GitHub</button>
          <button type="button" className="btn small primary" disabled={hub.gh.state !== "ready"} title={hub.gh.state === "ready" ? "" : "Needs the GitHub connection"} onClick={() => setCreating(true)}>New issue</button>
        </div>
      </div>
      <GhBanner />
      {msg && <div className={`alert ${msg.kind}`} role="status"><span>{msg.text}</span><button type="button" className="linkbtn" onClick={() => setMsg(null)}>Dismiss</button></div>}
      {unsynced.length > 0 && <div className="alert amber"><strong>{unsynced.length} move{unsynced.length === 1 ? "" : "s"} not on GitHub yet</strong><span>{unsynced.map((t) => `#${t.number}`).join(", ")} — marked on the cards. GitHub stays the source of truth: move them again once connected.</span></div>}
      <div className="dh-board">
        {COLUMNS.filter((c) => c !== "Done" || showDone || by("Done").length < 6).map((c) => (
          <div key={c} className={`dh-col${over === c ? " over" : ""}`} onDragOver={(e) => { e.preventDefault(); setOver(c); }} onDragLeave={() => setOver("")} onDrop={(e) => void drop(c, e)} aria-label={c}>
            <div className="dh-col-head"><strong>{c}</strong><span className="chip">{by(c).length}</span></div>
            <div className="muted" style={{ fontSize: 11 }}>{COL_NOTE[c]}</div>
            {by(c).map((t) => <Card key={t.number} t={t} onOpen={() => setOpen(t.number)} />)}
            {!by(c).length && <div className="dh-col-empty">Drop an issue here</div>}
          </div>
        ))}
        {!(COLUMNS.filter((c) => c !== "Done" || showDone || by("Done").length < 6).includes("Done")) && <div className="dh-col"><button type="button" className="btn small" onClick={() => setShowDone(true)}>Show Done ({by("Done").length})</button></div>}
      </div>
      {sel && <TaskDetail t={sel} onClose={() => setOpen(null)} />}
      {creating && <NewIssue onClose={() => setCreating(false)} />}
    </section>
  );
}

export function GhBanner() {
  const hub = useHub();
  const g = hub.gh;
  if (g.state === "ready") return g.message ? <div className="alert amber"><span>{g.message}</span></div> : null;
  if (g.state === "loading") return <div className="alert"><span>Reading GitHub…</span></div>;
  return (
    <div className={`alert ${g.state === "error" ? "red" : "amber"}`} role="status">
      <strong>{g.state === "demo" ? "Demo build" : g.state === "off" ? "GitHub isn't connected yet" : "GitHub couldn't be read"}</strong>
      <span>{g.state === "demo" ? "GitHub isn't called from the demo build. Showing the issues as they were on 6 November 2026." : g.message}</span>
      {g.state !== "demo" && <button type="button" className="btn small" onClick={() => void hub.refreshGh()}>Try again</button>}
    </div>
  );
}

function featureOf(t: Task): string[] {
  return t.meta.feature ? [t.meta.feature] : ISSUE_FEATURES[t.number] || [];
}

function Card({ t, onOpen }: { t: Task; onOpen: () => void }) {
  const hub = useHub();
  const feats = featureOf(t);
  const first = hub.features.find((f) => f.id === feats[0]);
  const done = t.meta.checklist?.filter((c) => c.done).length || 0;
  return (
    <div className={`dh-card${t.synced ? "" : " unsynced"}`} draggable onDragStart={(e) => { e.dataTransfer.setData("text/plain", String(t.number)); e.dataTransfer.effectAllowed = "move"; }}
      tabIndex={0} role="button" aria-label={`Issue ${t.number}: ${t.title}`} onClick={onOpen} onKeyDown={(e) => { if (e.key === "Enter") onOpen(); }}>
      <div className="row-wrap" style={{ gap: 6, justifyContent: "space-between" }}><a href={issueUrl(t.number)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="mono" style={{ fontSize: 13 }}>#{t.number}</a>{t.priority !== "None" && <PriorityChip p={t.priority} />}</div>
      <div className="dh-card-title">{t.title.replace(/^\s*\[[^\]]*\]\s*/, "")}</div>
      {first && <div className="muted" style={{ fontSize: 13 }}>Feature: {first.name}{feats.length > 1 ? ` +${feats.length - 1}` : ""}</div>}
      <div className="row-wrap" style={{ gap: 6, fontSize: 13 }}>
        {t.meta.assignee || t.assignee ? <span className="chip">{t.meta.assignee || t.assignee}</span> : null}
        {t.meta.target && <span className="chip">due {t.meta.target}</span>}
        {t.meta.deps?.length ? <span className="chip">needs {t.meta.deps.map((d) => `#${d}`).join(", ")}</span> : null}
        {t.meta.checklist?.length ? <span className="chip">{done}/{t.meta.checklist.length}</span> : null}
        {!t.synced && <span className="chip red" title={t.meta.error}>not synced</span>}
      </div>
    </div>
  );
}

/** Acceptance criteria written as "- [ ] item" lines in the issue itself. */
function criteriaFrom(body: string): string[] {
  return body.split("\n").map((l) => /^\s*-\s*\[[ xX]\]\s*(.+)$/.exec(l)?.[1]?.trim() || "").filter(Boolean);
}

function TaskDetail({ t, onClose }: { t: Task; onClose: () => void }) {
  const hub = useHub();
  const [title, setTitle] = useState(t.title);
  const [body, setBody] = useState(t.body);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState("");
  const [item, setItem] = useState("");
  const criteria = criteriaFrom(t.body);
  const refs = hub.activity.filter((a) => a.refs.includes(t.number));
  const feats = featureOf(t);
  const ready = hub.gh.state === "ready";
  const run = async (p: Promise<{ ok: boolean; message: string }>) => { const r = await p; setMsg(r.message); };
  const list = t.meta.checklist || [];
  return (
    <div className="dh-modal" role="dialog" aria-modal="true" aria-label={`Issue ${t.number}`} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="card pad stack dh-modal-box">
        <div className="row-wrap" style={{ justifyContent: "space-between" }}>
          <h2 className="sec-h">Issue #{t.number}</h2>
          <div className="row-wrap"><a className="btn small" href={issueUrl(t.number)} target="_blank" rel="noreferrer">Open on GitHub</a><button type="button" className="btn small" onClick={onClose}>Close</button></div>
        </div>
        <div className="row-wrap"><span className="chip">{t.column}</span><PriorityChip p={t.priority} /><span className="chip">{t.state}</span>{!t.synced && <span className="chip red">not synced: {t.meta.error}</span>}</div>
        <label>Title<input className="input" value={title} disabled={!ready} onChange={(e) => setTitle(e.target.value)} /></label>
        <label>Description (the issue text on GitHub)<textarea className="input" rows={8} value={body} disabled={!ready} onChange={(e) => setBody(e.target.value)} /></label>
        <div className="row-wrap">
          <button type="button" className="btn small primary" disabled={!ready || (title === t.title && body === t.body)} onClick={() => void run(hub.updateIssue(t.number, { title, body }))}>Save to GitHub</button>
          {t.state === "open" ? <button type="button" className="btn small" disabled={!ready} onClick={() => void run(hub.updateIssue(t.number, { state: "closed" }))}>Close issue</button> : <button type="button" className="btn small" disabled={!ready} onClick={() => void run(hub.updateIssue(t.number, { state: "open" }))}>Reopen</button>}
          {!ready && <span className="muted" style={{ fontSize: 13 }}>Editing needs the GitHub connection.</span>}
        </div>
        {msg && <div className="alert" role="status"><span>{msg}</span></div>}

        <section><h3 className="dh-h">Acceptance criteria</h3>
          {criteria.length ? <ul className="dh-list">{criteria.map((c) => <li key={c}>{c}</li>)}</ul> : <p className="muted" style={{ margin: 0 }}>None written in the issue. Add "- [ ] ..." lines to its description.</p>}
        </section>
        <section><h3 className="dh-h">Linked features</h3>
          {feats.length ? <ul className="dh-list">{feats.map((id) => { const f = hub.features.find((x) => x.id === id); return <li key={id}><a href={`#/devhub/map/${id}`}>{f ? f.name : id}</a></li>; })}</ul> : <p className="muted" style={{ margin: 0 }}>None linked. Every task should be linked to a feature.</p>}
        </section>
        <div className="dh-fields">
          <label>Assigned to<input className="input" defaultValue={t.meta.assignee || ""} placeholder={t.assignee || "Nobody"} onBlur={(e) => void hub.taskMeta(t.number, { assignee: e.target.value.trim() || undefined })} /></label>
          <label>Target date (only if agreed)<input className="input" type="date" defaultValue={t.meta.target || ""} onBlur={(e) => void hub.taskMeta(t.number, { target: e.target.value || undefined })} /></label>
          <label>Depends on (issue numbers)<input className="input" defaultValue={(t.meta.deps || []).join(", ")} placeholder="e.g. 4, 10" onBlur={(e) => void hub.taskMeta(t.number, { deps: e.target.value.split(/[ ,]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0 && n !== t.number) })} /></label>
        </div>
        <section><h3 className="dh-h">Checklist</h3>
          <ul className="dh-list">{list.map((c, i) => <li key={i}><label className="row-wrap" style={{ gap: 6 }}><input type="checkbox" checked={c.done} onChange={() => void hub.taskMeta(t.number, { checklist: list.map((x, j) => (j === i ? { ...x, done: !x.done } : x)) })} />{c.text}</label></li>)}</ul>
          <div className="row-wrap"><input className="input" value={item} onChange={(e) => setItem(e.target.value)} placeholder="Add a step" aria-label="Add a checklist step" /><button type="button" className="btn small" disabled={!item.trim()} onClick={() => { void hub.taskMeta(t.number, { checklist: [...list, { text: item.trim(), done: false }] }); setItem(""); }}>Add</button></div>
        </section>
        <section><h3 className="dh-h">Notes (kept here, not on GitHub)</h3>
          <textarea className="input" rows={3} defaultValue={t.meta.notes || ""} onBlur={(e) => void hub.taskMeta(t.number, { notes: e.target.value })} />
        </section>
        <section><h3 className="dh-h">Linked commits and pull requests</h3>
          {refs.length ? <ul className="dh-list">{refs.map((a) => <li key={a.kind + a.id}><a href={a.url} target="_blank" rel="noreferrer">{a.kind === "pull" ? "PR" : "commit"} {a.id}</a> {a.title}</li>)}</ul> : <p className="muted" style={{ margin: 0 }}>{hub.gh.state === "ready" ? "None of the recent commits or pull requests mention this issue." : "Needs the GitHub connection."} Mention #{t.number} in a commit or pull request to link it.</p>}
        </section>
        {ready && <section><h3 className="dh-h">Comment on GitHub</h3>
          <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Test evidence, blockers, links. No passwords, tokens or client data." />
          <div><button type="button" className="btn small" disabled={!note.trim()} onClick={() => void hub.comment(t.number, note.trim()).then((r) => { setMsg(r.message); if (r.ok) setNote(""); })}>Add comment</button></div>
        </section>}
      </div>
    </div>
  );
}

function NewIssue({ onClose }: { onClose: () => void }) {
  const hub = useHub();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [feature, setFeature] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const dup = useMemo(() => duplicateIssue(title, hub.issues), [title, hub.issues]);
  const modules = hub.features.filter((f) => f.parent && !hub.features.some((x) => x.id === f.parent && x.parent));
  const submit = async () => {
    setBusy(true);
    const text = `${body}${feature ? `\n\nFeature: ${hub.features.find((f) => f.id === feature)?.name} (${feature})` : ""}\n\nReporting: record blockers, test evidence and linked PRs here. Do not close based on UI/code alone.`.trim();
    const r = await hub.createIssue(title.trim(), text, []);
    setBusy(false);
    setMsg(r.message);
    if (r.ok && r.issue) { if (feature) await hub.taskMeta(r.issue.number, { feature }); onClose(); }
  };
  return (
    <div className="dh-modal" role="dialog" aria-modal="true" aria-label="New issue" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="card pad stack dh-modal-box">
        <h2 className="sec-h">New GitHub issue</h2>
        <p className="muted tip" style={{ margin: 0 }}>Every task is linked to a feature. Use the title prefix [P1] to [P5] or [Access]. Don't put passwords, tokens or client data in an issue.</p>
        <label>Title<input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="[P2] ..." /></label>
        {dup && <div className="alert amber"><strong>Issue #{dup.number} already has this title</strong><span>Use that one instead of creating a duplicate.</span></div>}
        <label>Feature this belongs to<select className="input" value={feature} onChange={(e) => setFeature(e.target.value)}><option value="">Choose a feature…</option>{modules.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
        <label>Description (use "- [ ] ..." lines for acceptance criteria)<textarea className="input" rows={7} value={body} onChange={(e) => setBody(e.target.value)} /></label>
        {msg && <div className="alert red"><span>{msg}</span></div>}
        <div className="row-wrap"><button type="button" className="btn primary" disabled={busy || !title.trim() || !feature || !!dup} onClick={() => void submit()}>Create issue</button><button type="button" className="btn" onClick={onClose}>Cancel</button></div>
      </div>
    </div>
  );
}
