// Quick Add: capture a task from anywhere with just a title. Opened by the top-bar + button, the floating Add button on a phone, Alt+N, or a link shared
// from a phone. It files the task where you are (a client's page adds to that client) and otherwise puts it in the Inbox.
// If the connection drops, the task is kept on this device and saved when you're back online. It can't be saved twice: every task carries a capture key.
import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { todayIso } from "../lib/domain";
import { newKey } from "../lib/planning";
import { Row } from "../lib/schema";
import { Queued, QUICK_DATES, QuickDate, afterSync, cleanTranscript, contextFromHash, discard, enqueue, looksOffline, parseQueue, parseShare, quickDate, serializeQueue, syncPlan } from "../lib/work/capture";
import { splitBulk, newTaskRow, bulkCaptureKeys } from "../lib/work/model";
import { useData } from "./data";
import { useEditor } from "./Editors";
import { Icon } from "./bits";

export type Defaults = { title?: string; notes?: string; clientKey?: string; projectKey?: string; meetingKey?: string };
const Ctx = createContext<{ open: (d?: Defaults) => void; queued: Queued[]; discard: (id: string) => void; syncNow: () => void }>({ open: () => undefined, queued: [], discard: () => undefined, syncNow: () => undefined });
export const useQuickAdd = () => useContext(Ctx);

const STORE = "pp.captureQueue";
const readQueue = (): Queued[] => { try { return parseQueue(window.localStorage.getItem(STORE)); } catch { return []; } };
const writeQueue = (q: Queued[]) => { try { window.localStorage.setItem(STORE, serializeQueue(q)); } catch { /* private window: the queue just won't survive a reload */ } };

export function QuickAddProvider({ children, ready }: { children: ReactNode; ready: boolean }) {
  const { data, createMany } = useData();
  const [dlg, setDlg] = useState<Defaults>();
  const [queue, setQueue] = useState<Queued[]>(readQueue);
  const busy = useRef(false);
  const open = useCallback((d: Defaults = {}) => setDlg(d), []);
  const set = (q: Queued[]) => { setQueue(q); writeQueue(q); };

  const syncNow = useCallback(async () => {
    if (busy.current || !ready || !navigator.onLine) return;
    const q = readQueue(); if (!q.length) return;
    const plan = syncPlan(q, (data.tasks as Row[]).map((r) => String(r.CaptureKey || "")));
    busy.current = true;
    try {
      let saved = plan.drop.map((x) => x.id), failed: { id: string; error: string }[] = [];
      if (plan.create.length) {
        try { await createMany("Tasks", plan.create.map((x) => x.row)); saved = [...saved, ...plan.create.map((x) => x.id)]; }
        catch (e) { failed = plan.create.map((x) => ({ id: x.id, error: e instanceof Error ? e.message : "failed" })); }
      }
      set(afterSync(q, saved, failed));
    } finally { busy.current = false; }
  }, [data.tasks, createMany, ready]);

  useEffect(() => { if (ready) void syncNow(); }, [ready, syncNow]);
  useEffect(() => { const on = () => void syncNow(); window.addEventListener("online", on); return () => window.removeEventListener("online", on); }, [syncNow]);
  useEffect(() => { // Alt+N (Option+N on a Mac). Ctrl/Cmd+K is already Search.
    const onKey = (e: KeyboardEvent) => { if (ready && e.altKey && !e.ctrlKey && !e.metaKey && e.code === "KeyN") { e.preventDefault(); setDlg((d) => d || {}); } };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [ready]);
  useEffect(() => { // a link or text shared from a phone opens the composer with it filled in
    if (!ready) return;
    const s = parseShare(window.location.search); if (!s) return;
    window.history.replaceState(null, "", window.location.pathname + window.location.hash);
    setDlg({ title: s.title, notes: s.notes });
  }, [ready]);

  const value = useMemo(() => ({ open, queued: queue, discard: (id: string) => set(discard(readQueue(), id)), syncNow: () => void syncNow() }), [open, queue, syncNow]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {ready && <button type="button" className="fab only-phone" aria-label="Add a task" onClick={() => open()}><Icon name="plus" size={26} /></button>}
      {dlg && createPortal(<QuickAddDialog defaults={dlg} onClose={() => setDlg(undefined)} onQueue={(row) => set(enqueue(readQueue(), row, new Date().toISOString()))} />, document.body)}
    </Ctx.Provider>
  );
}

type Speech = { start(): void; stop(): void; lang: string; interimResults: boolean; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null };
const speechCtor = (): (new () => Speech) | undefined => { const w = window as unknown as { SpeechRecognition?: new () => Speech; webkitSpeechRecognition?: new () => Speech }; return w.SpeechRecognition || w.webkitSpeechRecognition; };

function QuickAddDialog({ defaults, onClose, onQueue }: { defaults: Defaults; onClose: () => void; onQueue: (row: Row) => void }) {
  const { data, create, createMany, user } = useData();
  const { open: openFull } = useEditor();
  const here = useMemo(() => contextFromHash(window.location.hash), []);
  const [title, setTitle] = useState(defaults.title || "");
  const [notes, setNotes] = useState(defaults.notes || "");
  const [clientKey, setClientKey] = useState(defaults.clientKey ?? here.clientKey ?? "");
  const [projectKey, setProjectKey] = useState(defaults.projectKey ?? "");
  const [due, setDue] = useState(""); const [planFor, setPlanFor] = useState(""); const [priority, setPriority] = useState("");
  const [more, setMore] = useState(!!defaults.notes); const [another, setAnother] = useState(false);
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string>(); const [error, setError] = useState<string>();
  const [listening, setListening] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null); const attempt = useRef(newKey("Q")); const batch = useRef(newKey("B"));
  const today = todayIso();
  useEffect(() => input.current?.focus(), []);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const clients = useMemo(() => [...data.clients].sort((a, b) => String(a.Title).localeCompare(String(b.Title))), [data.clients]);
  const lines = useMemo(() => splitBulk(title), [title]);
  const many = lines.length > 1;
  const Voice = typeof window !== "undefined" ? speechCtor() : undefined;

  const dictate = () => {
    if (!Voice || listening) return;
    const r = new Voice(); r.lang = "en-GB"; r.interimResults = false;
    r.onresult = (e) => { const t = cleanTranscript(Array.from(e.results).map((x) => x[0].transcript).join(" ")); if (t) setTitle((cur) => (cur.trim() ? `${cur.trim()} ${t.toLowerCase()}` : t)); input.current?.focus(); };
    r.onend = () => setListening(false); r.onerror = () => setListening(false);
    setListening(true); try { r.start(); } catch { setListening(false); }
  };

  const save = async () => {
    if (busy || !lines.length) return setError(title.trim() ? undefined : "Type what needs doing.");
    setBusy(true); setError(undefined); setMsg(undefined);
    const now = new Date().toISOString(), ctx = { user: user || "", now };
    const keys = many ? bulkCaptureKeys(batch.current, lines) : [attempt.current];
    const have = new Set((data.tasks as Row[]).map((r) => String(r.CaptureKey || "")));
    const rows = lines.flatMap((l, i) => {
      if (have.has(keys[i])) return [];
      const r = newTaskRow({ title: l, clientKey: clientKey || undefined, projectKey: projectKey || undefined, meetingKey: defaults.meetingKey, due: many ? "" : due, captureKey: keys[i] }, { ...ctx, key: newKey("T") }).row;
      if (!r) return [];
      if (!many && notes.trim()) r.Description = notes.trim();
      if (!many && planFor) r.PlannedDate = planFor;
      if (!many && priority) r.Priority = priority;
      return [r];
    });
    try {
      if (rows.length === 1) await create("Tasks", rows[0]); else if (rows.length) await createMany("Tasks", rows);
      setMsg(`${many ? `${rows.length} tasks` : "Task"} added to ${clientKey ? String(clients.find((c) => c.Key === clientKey)?.Title || "the client") : projectKey ? "the project" : "the Inbox"}.`);
    } catch (e) {
      if (looksOffline(navigator.onLine, e)) { rows.forEach(onQueue); setMsg(`No connection. ${rows.length === 1 ? "Saved on this device" : `${rows.length} tasks saved on this device`} and will be added when you're back online.`); }
      else { setError("That didn't save. Try again: nothing will be added twice."); setBusy(false); return; }
    }
    attempt.current = newKey("Q"); batch.current = newKey("B");
    setBusy(false);
    if (another) { setTitle(""); setNotes(""); setDue(""); setPlanFor(""); setPriority(""); input.current?.focus(); } else window.setTimeout(onClose, 700);
  };

  const dateRow = (label: string, value: string, set: (v: string) => void, hint: string) => (
    <div className="stack" style={{ gap: 4 }}>
      <span className="muted" style={{ fontSize: 13 }}>{label} <span style={{ opacity: 0.8 }}>{hint}</span></span>
      <div className="row-wrap" style={{ gap: 6 }}>
        {QUICK_DATES.map(([k, l]) => <button key={k} type="button" className="btn small" aria-pressed={value === quickDate(k as QuickDate, today)} onClick={() => set(value === quickDate(k as QuickDate, today) ? "" : quickDate(k as QuickDate, today))}>{l}</button>)}
        <input type="date" className="input" aria-label={`${label}: pick a date`} style={{ width: 150, minHeight: 36 }} value={value} onChange={(e) => set(e.target.value)} />
        {value && <button type="button" className="linkbtn" onClick={() => set("")}>No date</button>}
      </div>
    </div>
  );

  return (
    <div className="search-wrap" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="search-dialog" role="dialog" aria-modal="true" aria-label="Quick add" style={{ padding: 16, maxHeight: "92vh", overflow: "auto" }}>
        <div className="stack" style={{ gap: 12 }}>
          <div className="row-wrap" style={{ justifyContent: "space-between" }}><strong>New task</strong><button type="button" className="linkbtn" onClick={onClose} aria-label="Close">Close</button></div>
          <div className="row-wrap" style={{ gap: 8, alignItems: "flex-start" }}>
            <textarea ref={input} className="input" rows={many ? 4 : 2} aria-label="What needs doing" placeholder="What needs doing?" value={title} disabled={busy}
              onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !many) { e.preventDefault(); void save(); } }} style={{ flex: "1 1 220px", fontSize: 17, minHeight: 48 }} />
            {Voice && <button type="button" className="btn" aria-label={listening ? "Listening…" : "Speak the task"} aria-pressed={listening} onClick={dictate} style={{ minHeight: 48, minWidth: 48 }}>{listening ? "Listening…" : "Speak"}</button>}
          </div>
          {!many && !title && <span className="muted" style={{ fontSize: 13 }}>Tip: paste several lines to add several tasks at once.</span>}
          {many && <ul className="plain" aria-label="Tasks to be added" style={{ margin: 0 }}>{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>}
          <label className="stack" style={{ gap: 4 }}><span className="muted" style={{ fontSize: 13 }}>Goes to</span>
            <select className="input" aria-label="Where this task goes" value={projectKey ? `p:${projectKey}` : clientKey ? `c:${clientKey}` : ""} onChange={(e) => { const v = e.target.value; setClientKey(v.startsWith("c:") ? v.slice(2) : ""); setProjectKey(v.startsWith("p:") ? v.slice(2) : ""); }} style={{ minHeight: 44 }}>
              <option value="">Inbox (file it later)</option>
              <optgroup label="Client">{clients.map((c) => <option key={String(c.Key)} value={`c:${c.Key}`}>{String(c.Title)}</option>)}</optgroup>
              {data.projects.length > 0 && <optgroup label="Business project">{data.projects.map((p) => <option key={String(p.Key)} value={`p:${p.Key}`}>{String(p.Title)}</option>)}</optgroup>}
            </select></label>
          {!many && dateRow("Due", due, setDue, "(the deadline)")}
          <details open={more} onToggle={(e) => setMore((e.currentTarget as HTMLDetailsElement).open)}>
            <summary>More details</summary>
            {!many && <div className="stack" style={{ gap: 10, marginTop: 8 }}>
              <label className="stack" style={{ gap: 4 }}><span className="muted" style={{ fontSize: 13 }}>Notes</span><textarea className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
              <label className="stack" style={{ gap: 4 }}><span className="muted" style={{ fontSize: 13 }}>Priority</span><select className="input" value={priority} onChange={(e) => setPriority(e.target.value)}><option value="">None</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label>
              {dateRow("Plan to work on it", planFor, setPlanFor, "(separate from the deadline)")}
              <button type="button" className="linkbtn" style={{ textAlign: "left" }} onClick={() => { onClose(); openFull({ kind: "task", clientKey: clientKey || undefined, projectKey: projectKey || undefined }); }}>Open the full task form instead</button>
            </div>}
          </details>
          {error && <p role="alert" className="error-text" style={{ margin: 0 }}>{error}</p>}
          {msg && <p role="status" style={{ margin: 0 }}>{msg}</p>}
          <div className="row-wrap" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <label className="row-wrap" style={{ gap: 6 }}><input type="checkbox" checked={another} onChange={(e) => setAnother(e.target.checked)} /> Add another after this</label>
            <button type="button" className="btn primary" disabled={busy || !lines.length} onClick={() => void save()} style={{ minHeight: 44, minWidth: 100 }}>{busy ? "Saving…" : many ? `Add ${lines.length} tasks` : "Add task"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** A small notice for tasks waiting on this device: where they are, to try now, or to throw away. */
export function QueueNotice() {
  const { queued, syncNow, discard: drop } = useQuickAdd();
  if (!queued.length) return null;
  return (
    <div className="card pad stack" role="status" style={{ gap: 6 }}>
      <strong>{queued.length} task{queued.length === 1 ? "" : "s"} waiting to be saved from this device</strong>
      <ul className="plain" style={{ margin: 0 }}>{queued.map((x) => <li key={x.id} className="row-wrap" style={{ gap: 8 }}>{String(x.row.Title)}{x.error && <span className="chip red" title={x.error}>Couldn't save{x.attempts >= 5 ? ", stopped trying" : ""}</span>}<button type="button" className="linkbtn" onClick={() => drop(x.id)}>Discard</button></li>)}</ul>
      <div><button type="button" className="btn small" onClick={syncNow}>Try now</button></div>
    </div>
  );
}
