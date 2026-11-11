// Shared pieces for task lists: the quick add box, bulk paste with review, the compact row, and the undo bar. Used by the Inbox and a client's Tasks tab.
import { useMemo, useRef, useState } from "react";
import { fmtDate, todayIso } from "../lib/domain";
import { newKey } from "../lib/planning";
import { Row } from "../lib/schema";
import { Capture, WorkTask, bulkCaptureKeys, newTaskRow, notYetCreated, splitBulk, statusLabel } from "../lib/work/model";
import { Change, Spec, bulkChange, changeTask, complete, reopen, undoChange } from "../lib/work/tasks";
import { useData } from "./data";
import { useEditor } from "./Editors";

const say = (e: unknown) => (e instanceof Error && e.message ? e.message : "That didn't save. Try again.");
type Applied = { changes: { key: string; patch: Row; before: Row }[]; label: string };

/** Saving task changes with an undo. Every change goes through lib/work/tasks, so a task that changed since the screen loaded is refused, not overwritten. */
export function useTaskChanges() {
  const { data, updateMany, user } = useData();
  const rows = data.tasks as Row[];
  const [undo, setUndo] = useState<Applied>();
  const [error, setError] = useState<string>();
  const timer = useRef(0);
  const ctx = () => ({ user: user || "", now: new Date().toISOString() });
  const save = async (changes: Extract<Change, { patch: Row }>[], label: string, skipped: { key: string; error: string }[] = []) => {
    setError(skipped.length ? `${skipped.length} not changed: ${skipped[0].error}` : undefined);
    if (!changes.length) return;
    try {
      await updateMany("Tasks", changes.map((c) => ({ row: rows.find((r) => r.Key === c.key)!, patch: c.patch })));
      setUndo({ changes: changes.map(({ key, patch, before }) => ({ key, patch, before })), label });
      window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setUndo(undefined), 12000);
    } catch (e) { setError(say(e)); }
  };
  return {
    rows, undo, error, setError, ctx,
    apply: (keys: string[], spec: Spec, label: string, force = false) => { const b = bulkChange(rows, keys, spec, ctx(), { force }); return save(b.changes, label, b.skipped); },
    one: (key: string, spec: Spec, label: string, force = false) => { const c = changeTask(rows, key, spec, ctx(), { force }); return "error" in c && c.error ? setError(c.error) : save([c as Extract<Change, { patch: Row }>], label); },
    toggle: (t: WorkTask) => { const c = t.status === "Done" || t.status === "Complete" ? reopen(rows, t.key, ctx()) : complete(rows, t.key, ctx()); return "error" in c && c.error ? setError(c.error) : save([c as Extract<Change, { patch: Row }>], t.status === "Done" ? "Reopened" : "Completed"); },
    undoNow: async () => {
      if (!undo) return;
      const back = undo.changes.map((c) => undoChange(rows, c, ctx()));
      const ok = back.filter((b) => b.patch).map((b) => ({ row: rows.find((r) => r.Key === b.key)!, patch: b.patch! }));
      const bad = back.find((b) => b.error);
      try { if (ok.length) await updateMany("Tasks", ok); setUndo(undefined); setError(bad ? `${back.filter((b) => b.error).length} not put back: ${bad.error}` : undefined); } catch (e) { setError(say(e)); }
    },
    dismissUndo: () => setUndo(undefined),
  };
}

export function UndoBar({ undo, error, onUndo, onClose }: { undo?: Applied; error?: string; onUndo: () => void; onClose: () => void }) {
  if (!undo && !error) return null;
  return (
    <div role="status" className="row-wrap" style={{ gap: 10, alignItems: "center" }}>
      {error && <span role="alert" style={{ color: "var(--red-ink)" }}>{error}</span>}
      {undo && <><span>{undo.label} ({undo.changes.length}).</span><button type="button" className="btn small" onClick={onUndo}>Undo</button><button type="button" className="linkbtn" onClick={onClose}>Dismiss</button></>}
    </div>
  );
}

/** One line to add a task. Only the title is needed. Enter saves; the box stays focused for the next one. */
export function QuickAdd({ context, placeholder = "Add a task and press Enter" }: { context: Omit<Capture, "title">; placeholder?: string }) {
  const { create, data, user } = useData();
  const [title, setTitle] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState<string>();
  const ref = useRef<HTMLInputElement>(null); const attempt = useRef(newKey("Q")); // same key until it saves, so a retry after a failure can't make two
  const submit = async () => {
    if (busy || !title.trim()) return;
    const key = newKey("T");
    const { row, error: err } = newTaskRow({ ...context, title, captureKey: attempt.current }, { user: user || "", now: new Date().toISOString(), key });
    if (err || !row) return setError(err);
    if ((data.tasks as Row[]).some((t) => t.CaptureKey === attempt.current)) { setTitle(""); attempt.current = newKey("Q"); return; }
    setBusy(true); setError(undefined);
    try { await create("Tasks", row); setTitle(""); attempt.current = newKey("Q"); ref.current?.focus(); } catch (e) { setError(say(e)); } finally { setBusy(false); }
  };
  return (
    <div className="stack" style={{ gap: 4 }}>
      <input ref={ref} className="input" aria-label="New task title" placeholder={placeholder} value={title} disabled={busy} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submit(); } }} style={{ minHeight: 44 }} />
      {error && <span role="alert" style={{ color: "var(--red-ink)", fontSize: 13 }}>{error}</span>}
    </div>
  );
}

/** Paste several lines, check them, then create them. A retry after a failure only creates the ones that are missing. */
export function BulkAdd({ context }: { context: Omit<Capture, "title"> }) {
  const { createMany, data, user } = useData();
  const [text, setText] = useState(""); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string>(); const [drop, setDrop] = useState<Set<number>>(new Set());
  const batch = useRef(newKey("B"));
  const titles = useMemo(() => splitBulk(text), [text]);
  const keep = titles.map((t, i) => ({ t, i })).filter((x) => !drop.has(x.i));
  const create = async () => {
    if (busy || !keep.length) return;
    const keys = bulkCaptureKeys(batch.current, keep.map((x) => x.t));
    const todo = notYetCreated(keys, (data.tasks as Row[]).map((r) => String(r.CaptureKey || "")));
    const now = new Date().toISOString();
    const rows = todo.flatMap((i) => { const r = newTaskRow({ ...context, title: keep[i].t, captureKey: keys[i] }, { user: user || "", now, key: newKey("T") }).row; return r ? [r] : []; });
    setBusy(true); setMsg(undefined);
    try { if (rows.length) await createMany("Tasks", rows); setMsg(`${rows.length} task${rows.length === 1 ? "" : "s"} added${keep.length - rows.length ? `, ${keep.length - rows.length} already there` : ""}.`); setText(""); setDrop(new Set()); batch.current = newKey("B"); }
    catch (e) { setMsg(`${say(e)} Press Add again: tasks already saved won't be repeated.`); } finally { setBusy(false); }
  };
  return (
    <details className="card pad">
      <summary>Add several tasks at once</summary>
      <div className="stack" style={{ marginTop: 8 }}>
        <textarea className="input" rows={5} aria-label="One task per line" placeholder={"One task per line.\nCall director about stock\nRequest bank statements"} value={text} onChange={(e) => { setText(e.target.value); setDrop(new Set()); }} />
        {keep.length > 0 && <ul className="plain" aria-label="Tasks to be added">{titles.map((t, i) => <li key={i} className="row-wrap" style={{ gap: 8, opacity: drop.has(i) ? 0.4 : 1 }}><input type="checkbox" aria-label={`Include ${t}`} checked={!drop.has(i)} onChange={() => setDrop((d) => { const n = new Set(d); if (n.has(i)) n.delete(i); else n.add(i); return n; })} /> {t}</li>)}</ul>}
        <div className="row-wrap"><button type="button" className="btn primary" disabled={busy || !keep.length} onClick={() => void create()}>Add {keep.length || ""} task{keep.length === 1 ? "" : "s"}</button>{msg && <span role="status">{msg}</span>}</div>
      </div>
    </details>
  );
}

/** One compact line: tick, title, then status, due date and priority. Small enough to scan ten at a time. */
export function TaskLine({ t, selected, onSelect, onToggle, onPriority, onDue, subline, childCount }: { t: WorkTask; selected?: boolean; onSelect?: (on: boolean) => void; onToggle: () => void; onPriority: (p: WorkTask["priority"]) => void; onDue: (d: string) => void; subline?: string; childCount?: { done: number; total: number } }) {
  const { open } = useEditor(); const today = todayIso();
  const done = t.status === "Done" || t.status === "Complete", off = t.status === "Cancelled";
  const overdue = !done && !off && !!t.dueDate && t.dueDate < today;
  return (
    <li className="row-wrap" style={{ gap: 8, alignItems: "center", padding: "4px 0", borderBottom: "1px solid var(--line, #e3e7ee)", paddingLeft: t.parentKey ? 22 : 0 }}>
      {onSelect && <input type="checkbox" aria-label={`Select ${t.title}`} checked={!!selected} onChange={(e) => onSelect(e.target.checked)} style={{ width: 20, height: 20 }} />}
      <input type="checkbox" aria-label={`${done ? "Reopen" : "Complete"} ${t.title}`} checked={done} onChange={onToggle} style={{ width: 22, height: 22 }} />
      <button type="button" className="linkbtn" style={{ flex: "1 1 180px", textAlign: "left", textDecoration: done || off ? "line-through" : "none", minHeight: 36 }} onClick={() => open({ kind: "task", key: t.key })}>{t.title}</button>
      {childCount && childCount.total > 0 && <span className="chip" title="Smaller tasks done">{childCount.done}/{childCount.total}</span>}
      {t.status !== "Open" && !done && <span className="chip">{statusLabel(t.status)}</span>}
      {t.ownerType !== "user" && <span className="chip">{t.responsible || "Client"}</span>}
      {t.blockedReason && <span className="chip red" title={t.blockedReason}>Blocked</span>}
      <select aria-label={`Priority of ${t.title}`} className="input" style={{ width: 104 }} value={t.priority} onChange={(e) => onPriority(e.target.value as WorkTask["priority"])}><option value="">Priority</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
      <input type="date" aria-label={`Due date of ${t.title}`} className="input" style={{ width: 140, color: overdue ? "var(--red-ink)" : undefined }} value={t.dueDate} onChange={(e) => onDue(e.target.value)} />
      {subline && <span className="muted" style={{ flexBasis: "100%", fontSize: 12, paddingLeft: 30 }}>{subline}{t.dueDate && overdue ? ` · was due ${fmtDate(t.dueDate, { year: false })}` : ""}</span>}
    </li>
  );
}

