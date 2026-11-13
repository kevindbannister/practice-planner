// A compact list of work (jobs and tasks) with the actions that can be taken without opening it. Used by the client overview and by heatmap drill-down.
import { useState } from "react";
import { fmtDate, holdPatch } from "../lib/domain";
import { createSessions } from "../lib/planSessions";
import { RISK_LABEL } from "../lib/work/risk";
import { Item } from "../lib/work/overview";
import { teamFrom } from "../lib/permissions";
import { Row } from "../lib/schema";
import { readTask } from "../lib/work/model";
import { useData } from "./data";
import { useEditor } from "./Editors";
import { UndoBar, useTaskChanges } from "./taskKit";
import { usePlanning } from "./usePlanning";

const STATE_LABEL: Record<Item["state"], string> = { ready: "Ready", in_progress: "In progress", waiting: "Waiting", blocked: "Blocked", done: "Done" };

export function WorkList({ items, showClient, nameOf }: { items: Item[]; showClient?: boolean; nameOf?: (k: string) => string }) {
  const editor = useEditor(); const { data, update, user } = useData(); const tc = useTaskChanges(); const planning = usePlanning();
  const members = teamFrom(data.settings).members;
  const [msg, setMsg] = useState<string>(); const [form, setForm] = useState<{ key: string; what: "assign" | "schedule" | "waiting"; value: string; extra: string }>();
  const open = (it: Item) => editor.open(it.kind === "job" ? { kind: "job", key: it.key } : { kind: "task", key: it.key });
  const close = () => setForm(undefined);
  const submit = async (it: Item) => {
    if (!form) return; setMsg(undefined);
    try {
      if (form.what === "assign" && it.kind === "task") { await tc.one(it.key, { owner: form.value }, "Assigned"); }
      else if (form.what === "schedule") {
        if (!planning.ready) return setMsg("Planning isn't set up yet.");
        const hrs = Number(form.extra) > 0 ? Number(form.extra) : Math.min(it.remaining || 1, 2);
        const r = await planning.apply(createSessions([{ kind: it.kind, itemKey: it.key, clientKey: it.clientKey, title: it.title, userKey: user || "", date: form.value, minutes: Math.round(hrs * 60) }], planning.ctx()));
        setMsg(r.done ? `Planned ${hrs}h on ${fmtDate(form.value)}.` : r.problems[0] || "Not planned.");
      } else if (form.what === "waiting") {
        if (it.kind === "task") await tc.one(it.key, { status: "On hold", blockedReason: form.value || "Waiting" }, "Marked waiting");
        else { const row = (data.jobs as Row[]).find((j) => j.Key === it.key)!; await update("Jobs", row, holdPatch(form.value || "Waiting", form.extra, new Date().toISOString().slice(0, 10), "Client")); setMsg("Marked as waiting on the client."); }
      }
      close();
    } catch { setMsg("That didn't save. Try again."); }
  };
  if (!items.length) return <p className="muted" style={{ margin: 0 }}>Nothing here.</p>;
  return (
    <div className="stack" style={{ gap: 4 }}>
      <UndoBar undo={tc.undo} error={tc.error} onUndo={() => void tc.undoNow()} onClose={tc.dismissUndo} />
      {msg && <p role="status" style={{ margin: 0 }}>{msg}</p>}
      <ul className="plain stack" style={{ gap: 2, margin: 0 }}>{items.map((it) => (
        <li key={it.kind + it.key} className="row-wrap" style={{ gap: 8, alignItems: "center", padding: "4px 0", borderBottom: "1px solid var(--line)" }}>
          <span className="chip" title={it.kind === "job" ? "Job" : "Task"}>{it.kind === "job" ? "Job" : "Task"}</span>
          <button type="button" className="linkbtn" style={{ flex: "1 1 200px", textAlign: "left" }} onClick={() => open(it)}>{showClient && nameOf ? `${nameOf(it.clientKey)}: ` : ""}{it.title}</button>
          <span className={`chip ${it.state === "blocked" ? "red" : it.state === "waiting" ? "blue" : it.state === "in_progress" ? "amber" : "green"}`}>{STATE_LABEL[it.state]}{it.partly ? " (partly)" : ""}</span>
          {it.overdue && <span className="chip red">Overdue</span>}
          {it.kind === "job" && it.risk !== "on_track" && it.risk !== "overdue" && <span className="chip amber">{RISK_LABEL[it.risk]}</span>}
          <span className="muted" style={{ fontSize: 13 }}>{it.due ? `due ${fmtDate(it.due)}` : "no date"}{it.remaining ? ` · ${it.remaining}h left` : ""}{it.owner ? ` · ${it.owner}` : it.ownerType !== "user" ? " · client" : ""}</span>
          <details style={{ position: "relative" }}><summary className="btn small" style={{ listStyle: "none", cursor: "pointer" }}>Actions</summary>
            <div className="card pad stack" style={{ gap: 4, position: "absolute", right: 0, zIndex: 5, minWidth: 220 }}>
              <button type="button" className="linkbtn" onClick={() => open(it)}>Open</button>
              <button type="button" className="linkbtn" onClick={() => open(it)}>View dependencies</button>
              {it.kind === "task" && it.state !== "done" && <button type="button" className="linkbtn" onClick={() => { const row = tc.rows.find((r) => r.Key === it.key); if (row) void tc.toggle(readTask(row)); }}>Complete</button>}
              {it.kind === "job" && it.state !== "done" && <span className="muted" style={{ fontSize: 13 }}>Complete a job from its page, where its checks apply.</span>}
              {it.kind === "task" && <button type="button" className="linkbtn" onClick={() => setForm({ key: it.key, what: "assign", value: user || "", extra: "" })}>Assign…</button>}
              <button type="button" className="linkbtn" onClick={() => setForm({ key: it.key, what: "schedule", value: "", extra: "" })}>Schedule or reschedule…</button>
              {it.ownerType !== "user" || it.waitingClient ? <button type="button" className="linkbtn" onClick={() => open(it)}>Chase…</button> : null}
              {it.state !== "done" && it.state !== "waiting" && <button type="button" className="linkbtn" onClick={() => setForm({ key: it.key, what: "waiting", value: "", extra: "" })}>Mark waiting…</button>}
            </div></details>
          {form?.key === it.key && <span className="row-wrap" style={{ gap: 6, flexBasis: "100%" }}>
            {form.what === "assign" && <select className="input" aria-label="Assign to" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })}>{user && <option value={user}>Me</option>}{members.filter((m) => m.user !== (user || "").toLowerCase()).map((m) => <option key={m.user} value={m.user}>{m.name || m.user}</option>)}</select>}
            {form.what === "schedule" && <><input className="input" type="date" aria-label="Plan on" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} /><input className="input" type="number" min={0.25} step={0.25} aria-label="Hours" placeholder="Hours" value={form.extra} onChange={(e) => setForm({ ...form, extra: e.target.value })} style={{ width: 90 }} /><span className="muted" style={{ fontSize: 13 }}>Adds a planned session. Nothing else is moved. To move an existing session use the planner.</span></>}
            {form.what === "waiting" && <><input className="input" aria-label="Waiting for what" placeholder="Waiting for…" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />{it.kind === "job" && <input className="input" type="date" aria-label="Look again on" value={form.extra} onChange={(e) => setForm({ ...form, extra: e.target.value })} />}</>}
            <button type="button" className="btn small primary" disabled={form.what !== "waiting" && !form.value} onClick={() => void submit(it)}>Save</button><button type="button" className="btn small" onClick={close}>Cancel</button>
          </span>}
        </li>))}</ul>
    </div>
  );
}
