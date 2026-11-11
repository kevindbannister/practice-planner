// The Task Inbox: where every task lands when you capture it with just a title. File them later: pick some, move them to a client or project, set a due date.
// Nothing is deleted from here: "Archive" cancels a task, and Undo puts back the last change.
import { useMemo, useState } from "react";
import { todayIso } from "../lib/domain";
import { teamFrom } from "../lib/permissions";
import { inbox } from "../lib/work/tasks";
import { PlanTabs } from "./bits";
import { useData } from "./data";
import { QueueNotice } from "./QuickAdd";
import { BulkAdd, QuickAdd, TaskLine, UndoBar, useTaskChanges } from "./taskKit";

export function TaskInbox() {
  const { data, user } = useData();
  const k = useTaskChanges();
  const [q, setQ] = useState(""); const [sel, setSel] = useState<Set<string>>(new Set());
  const list = useMemo(() => inbox(k.rows).filter((t) => !q.trim() || t.title.toLowerCase().includes(q.trim().toLowerCase())), [k.rows, q]);
  const chosen = [...sel].filter((x) => list.some((t) => t.key === x));
  const members = teamFrom(data.settings).members;
  const clients = [...data.clients].sort((a, b) => String(a.Title).localeCompare(String(b.Title)));
  const run = (spec: Parameters<typeof k.apply>[1], label: string) => { void k.apply(chosen, spec, label); setSel(new Set()); };
  const bar = chosen.length > 0;
  return (
    <div className="stack" style={{ gap: 12 }}>
      <PlanTabs current="inbox" />
      <p className="muted" style={{ margin: 0 }}>Type a task and press Enter. Everything else can wait: file it here later.</p>
      <QueueNotice />
      <QuickAdd context={{}} />
      <div className="row-wrap" style={{ gap: 10, alignItems: "center", justifyContent: "space-between" }}>
        <span className="muted">{list.length} to file</span>
        <input className="input" type="search" aria-label="Search the Inbox" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 240 }} />
      </div>
      {bar && (
        <div className="card pad row-wrap" role="group" aria-label={`${chosen.length} selected`} style={{ gap: 8, alignItems: "center", position: "sticky", top: 0, zIndex: 2 }}>
          <strong>{chosen.length} selected</strong>
          <select aria-label="Move to client" className="input" style={{ width: 170 }} value="" onChange={(e) => e.target.value && run({ client: e.target.value }, "Moved to client")}><option value="">Move to client…</option>{clients.map((c) => <option key={String(c.Key)} value={String(c.Key)}>{String(c.Title)}</option>)}</select>
          <select aria-label="Move to project" className="input" style={{ width: 170 }} value="" onChange={(e) => e.target.value && run({ project: e.target.value }, "Moved to project")}><option value="">Move to project…</option>{data.projects.map((p) => <option key={String(p.Key)} value={String(p.Key)}>{String(p.Title)}</option>)}</select>
          <select aria-label="Assign to" className="input" style={{ width: 150 }} value="" onChange={(e) => e.target.value && run({ owner: e.target.value }, "Assigned")}><option value="">Assign to…</option>{user && <option value={user}>Me</option>}{members.filter((m) => m.user !== (user || "").toLowerCase()).map((m) => <option key={m.user} value={m.user}>{m.name || m.user}</option>)}</select>
          <input type="date" aria-label="Set due date" className="input" style={{ width: 140 }} onChange={(e) => e.target.value && run({ due: e.target.value }, "Due date set")} />
          <select aria-label="Set priority" className="input" style={{ width: 110 }} value="" onChange={(e) => e.target.value && run({ priority: e.target.value as "high" }, "Priority set")}><option value="">Priority…</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
          <button type="button" className="btn small" onClick={() => run({ status: "Done" }, "Completed")}>Complete</button>
          <button type="button" className="btn small" onClick={() => run({ status: "Cancelled" }, "Archived")}>Archive</button>
          <button type="button" className="linkbtn" onClick={() => setSel(new Set())}>Clear</button>
        </div>
      )}
      <UndoBar undo={k.undo} error={k.error} onUndo={() => void k.undoNow()} onClose={k.dismissUndo} />
      {list.length === 0 ? <div className="card empty">{q ? "Nothing matches." : "The Inbox is empty. Anything you capture without a client or project appears here."}</div> : (
        <div className="card pad">
          <label className="row-wrap" style={{ gap: 8, paddingBottom: 6 }}><input type="checkbox" aria-label="Select all" checked={chosen.length === list.length} onChange={(e) => setSel(e.target.checked ? new Set(list.map((t) => t.key)) : new Set())} /> <span className="muted">Select all</span></label>
          <ul className="plain" style={{ margin: 0 }}>
            {list.map((t) => <TaskLine key={t.key} t={t} selected={sel.has(t.key)} onSelect={(on) => setSel((s) => { const n = new Set(s); if (on) n.add(t.key); else n.delete(t.key); return n; })} onToggle={() => void k.toggle(t)} onPriority={(p) => void k.one(t.key, { priority: p }, "Priority set")} onDue={(d) => void k.one(t.key, { due: d || null }, "Due date set")} />)}
          </ul>
        </div>
      )}
      <BulkAdd context={{}} />
      <span hidden>{todayIso()}</span>
    </div>
  );
}
