// Routine work: the Settings card where you set up weekly and monthly routines, and the bar on
// the Week view that offers the week's tasks for you to add.
import { useState } from "react";
import { fmtDate, fmtHours } from "../lib/domain";
import { newKey } from "../lib/planning";
import { Routine, describeRoutine, dueRoutines, newRoutine, readRoutines, routineTask } from "../lib/routines";
import { readSetting, useData } from "./data";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

export function useRoutines(): Routine[] {
  const { data } = useData();
  return readRoutines(readSetting<unknown>(data.settings, "routines"));
}

export function RoutinesCard() {
  const { data, saveSetting } = useData();
  const saved = useRoutines();
  const [list, setList] = useState<Routine[]>(saved);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const same = JSON.stringify(list) === JSON.stringify(saved);
  const clients = [...data.clients].sort((a, b) => String(a.Title).localeCompare(String(b.Title)));
  const projects = data.projects.filter((p) => p.Status !== "Done");
  const edit = (id: string, patch: Partial<Routine>) => setList(list.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const save = async () => {
    setState("saving");
    try {
      await saveSetting("routines", readRoutines(list));
      setState("saved");
    } catch {
      setState("error");
    }
  };
  return (
    <section className="card pad stack" aria-labelledby="rout-h" style={{ maxWidth: 720 }}>
      <h2 id="rout-h">Routine work</h2>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        Things you do every week or month, such as Monday bookkeeping or a monthly look at the business. Each week the
        Week view offers the ones that are missing, and you add them with one button.
      </p>
      {list.length === 0 && <p className="muted" style={{ margin: 0 }}>No routines yet.</p>}
      {list.map((r) => (
        <div key={r.id} className="routine-row">
          <input className="input" aria-label="Routine name" placeholder="What is it?" value={r.title} onChange={(e) => edit(r.id, { title: e.target.value })} />
          <label className="dtypes-cell"><span className="dtypes-lab" aria-hidden="true">How often</span>
            <select className="input" aria-label={`How often: ${r.title}`} value={r.every} onChange={(e) => edit(r.id, { every: e.target.value as Routine["every"] })}>
              <option value="week">Every week</option><option value="month">Every month</option>
            </select></label>
          {r.every === "week" ? (
            <label className="dtypes-cell"><span className="dtypes-lab" aria-hidden="true">Day</span>
              <select className="input" aria-label={`Day: ${r.title}`} value={r.weekday} onChange={(e) => edit(r.id, { weekday: Number(e.target.value) })}>
                {DAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
              </select></label>
          ) : (
            <label className="dtypes-cell"><span className="dtypes-lab" aria-hidden="true">Day of month</span>
              <input className="input" type="number" min="1" max="28" aria-label={`Day of month: ${r.title}`} value={r.monthDay} onChange={(e) => edit(r.id, { monthDay: Number(e.target.value) })} /></label>
          )}
          <label className="dtypes-cell"><span className="dtypes-lab" aria-hidden="true">Hours</span>
            <input className="input" type="number" min="0.25" max="24" step="0.25" aria-label={`Hours: ${r.title}`} value={r.hours} onChange={(e) => edit(r.id, { hours: Number(e.target.value) })} /></label>
          <label className="dtypes-cell"><span className="dtypes-lab" aria-hidden="true">For</span>
            <select className="input" aria-label={`For: ${r.title}`} value={r.clientKey ? `c:${r.clientKey}` : r.projectKey ? `p:${r.projectKey}` : ""}
              onChange={(e) => { const v = e.target.value; edit(r.id, { clientKey: v.startsWith("c:") ? v.slice(2) : undefined, projectKey: v.startsWith("p:") ? v.slice(2) : undefined }); }}>
              <option value="">Nobody in particular</option>
              {projects.length > 0 && <optgroup label="Business project">{projects.map((p) => <option key={p.Key as string} value={`p:${p.Key}`}>{String(p.Title)}</option>)}</optgroup>}
              <optgroup label="Client">{clients.map((c) => <option key={c.Key} value={`c:${c.Key}`}>{c.Title}</option>)}</optgroup>
            </select></label>
          <div className="row-wrap" style={{ gap: 8 }}>
            <label className="row-wrap" style={{ gap: 6, fontSize: 13 }}><input type="checkbox" checked={r.active} onChange={(e) => edit(r.id, { active: e.target.checked })} />On</label>
            <button type="button" className="btn small" onClick={() => setList(list.filter((x) => x.id !== r.id))}>Remove</button>
          </div>
        </div>
      ))}
      <div className="form-actions" style={{ alignItems: "center" }}>
        {state === "saved" && same && <span className="muted" style={{ fontSize: 13 }}>Saved</span>}
        {state === "error" && <span className="error-text">Couldn't save</span>}
        <button type="button" className="btn" onClick={() => setList([...list, newRoutine(newKey("R"))])}>Add a routine</button>
        <button type="button" className="btn primary" disabled={same || state === "saving"} onClick={save}>{state === "saving" ? "Saving…" : "Save"}</button>
      </div>
    </section>
  );
}

/** On the Week view: routine tasks for the days from `from` to `to` that aren't on the planner yet. */
export function RoutineBar({ from, to, onAdded }: { from: string; to: string; onAdded?: (n: number) => void }) {
  const { data, create } = useData();
  const routines = useRoutines();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const due = dueRoutines(routines, data.tasks, from, to);
  if (!due.length) return null;
  const clientName = (k?: string) => data.clients.find((c) => c.Key === k)?.Title as string | undefined;
  const add = async () => {
    setBusy(true);
    setError(undefined);
    let n = 0;
    try {
      for (const d of due) {
        await create("Tasks", routineTask(d, newKey("T"), clientName(d.routine.clientKey)));
        n++;
      }
      onAdded?.(n);
    } catch {
      setError(`Added ${n} of ${due.length}. Try again for the rest.`);
    } finally {
      setBusy(false);
    }
  };
  const hours = due.reduce((t, d) => t + d.routine.hours, 0);
  return (
    <section className="suggest-bar" aria-label="Routine work for this week">
      <div className="stack" style={{ gap: 2 }}>
        <strong>{due.length} routine task{due.length === 1 ? "" : "s"} for this week ({fmtHours(hours)})</strong>
        <span className="muted" style={{ fontSize: 13 }}>
          {due.slice(0, 4).map((d) => `${d.routine.title} (${describeRoutine(d.routine).replace("Every ", "").replace(/^Monthly, on the /, "the ")}, ${fmtDate(d.date, { weekday: true, year: false }).split(" ")[0]})`).join(" · ")}{due.length > 4 ? ` · and ${due.length - 4} more` : ""}
        </span>
        {error && <span className="error-text" role="alert">{error}</span>}
      </div>
      <button type="button" className="btn primary" disabled={busy} onClick={add}>{busy ? "Adding…" : "Add to my week"}</button>
    </section>
  );
}
