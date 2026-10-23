// Completed work: every task and job you've finished, newest first. Open one to look at it, or
// reopen a task that isn't really done.
import { useMemo, useState } from "react";
import { Job, Task, fmtDate, fmtHours, todayIso } from "../lib/domain";
import { addDays, jobHours } from "../lib/planning";
import { svcClass } from "../lib/serviceColour";
import { Icon, PlanTabs } from "./bits";
import { useData, useIndex } from "./data";
import { useEditor } from "./Editors";
import { TimeEntry } from "./TimeSpent";
import { Finished } from "../lib/timeSpent";

type Line = { key: string; kind: "job" | "task"; title: string; client: string; type: string; done: string; hours?: number; skipped?: boolean; estimate: number; svc: string; row: Job | Task };
type Range = "30" | "90" | "365" | "all";

export function DoneView() {
  const { data, update } = useData();
  const idx = useIndex();
  const { open } = useEditor();
  const today = todayIso();
  const [range, setRange] = useState<Range>("90");
  const [what, setWhat] = useState<"all" | "tasks" | "jobs">("all");
  const [search, setSearch] = useState("");
  const [noTime, setNoTime] = useState(false);
  const [addingFor, setAddingFor] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

  const lines = useMemo(() => {
    const out: Line[] = [];
    for (const t of data.tasks) {
      if (t.Status !== "Done") continue;
      out.push({
        key: t.Key, kind: "task", title: t.Title, client: (t.ClientKey && idx.clientByKey.get(t.ClientKey)?.Title) || "", type: t.Type || "Task",
        done: String(t.CompletedDate || ""), hours: Number(t.ActualHours) || undefined, skipped: !!t.TimeSkipped, estimate: Number(t.EstimateHours) || 0, svc: "task", row: t,
      });
    }
    for (const j of data.jobs) {
      if (j.Status !== "Complete") continue;
      out.push({
        key: j.Key, kind: "job", title: j.Title, client: idx.clientByKey.get(j.ClientKey)?.Title || String(j.ClientName || ""),
        type: idx.serviceName.get(j.ServiceKey || "") || "Job", done: String(j.CompletedDate || ""), hours: Number(j.ActualHours) || undefined, skipped: !!j.TimeSkipped,
        estimate: jobHours(j, data.services), svc: svcClass(j.ServiceKey), row: j,
      });
    }
    return out.sort((a, b) => b.done.localeCompare(a.done) || a.client.localeCompare(b.client));
  }, [data.tasks, data.jobs, data.services, idx]);

  const since = range === "all" ? "" : addDays(today, -Number(range));
  const shown = lines.filter((l) =>
    (what === "all" || (what === "tasks") === (l.kind === "task")) &&
    (!since || l.done >= since) &&
    (!noTime || (!l.hours && !l.skipped)) &&
    (!search || `${l.client} ${l.title} ${l.type}`.toLowerCase().includes(search.toLowerCase())));

  const missing = lines.filter((l) => (!since || l.done >= since) && !l.hours && !l.skipped).length;
  const asFinished = (l: Line): Finished => ({ kind: l.kind, key: l.key, row: l.row, title: l.title, clientKey: l.row.ClientKey as string | undefined, done: l.done, estimate: l.estimate });

  const reopen = async (l: Line) => {
    setBusy(l.key);
    setError(undefined);
    try {
      await update("Tasks", l.row, { Status: "Open", CompletedDate: "" });
    } catch {
      setError("Couldn't reopen it. Try again.");
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <div className="page">
      <PlanTabs current="done" />
      <div className="row-wrap">
        <div className="seg" role="group" aria-label="Finished within">
          {(["30", "90", "365", "all"] as Range[]).map((r) => (
            <button key={r} type="button" aria-pressed={range === r} onClick={() => setRange(r)}>
              {r === "all" ? "All" : r === "365" ? "Year" : `${r} days`}
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Show">
          {(["all", "tasks", "jobs"] as const).map((k) => (
            <button key={k} type="button" aria-pressed={what === k} onClick={() => setWhat(k)}>{k === "all" ? "Everything" : k === "tasks" ? "Tasks" : "Jobs"}</button>
          ))}
        </div>
        <button type="button" className="btn small" aria-pressed={noTime} onClick={() => setNoTime(!noTime)}>
          No time logged ({missing})
        </button>
        <label className="search" style={{ flex: "1 1 200px" }}>
          <Icon name="search" />
          <span className="sr-only">Search completed work</span>
          <input type="search" placeholder="Client or work" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>{shown.length} completed item{shown.length === 1 ? "" : "s"}. Completed work also stays on the planner, ticked off, on the day it was planned.</p>
      {error && <p className="error-text" role="alert">{error}</p>}
      {shown.length ? (
        <section className="card">
          <div className="table-wrap">
            <table className="grid done-table">
              <thead><tr><th scope="col">Completed</th><th scope="col">Client</th><th scope="col">Work</th><th scope="col">Hours</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {shown.slice(0, 300).flatMap((l) => [
                  <tr key={l.key} className="clickable" onClick={() => open(l.kind === "job" ? { kind: "job", key: l.key } : { kind: "task", key: l.key })}>
                    <td className="mono" style={{ whiteSpace: "nowrap" }}>{l.done ? fmtDate(l.done, { weekday: true, year: l.done.slice(0, 4) !== today.slice(0, 4) }) : "—"}</td>
                    <td className="cell-title">{l.client || "—"}</td>
                    <td>
                      <span className={`svc-dot ${l.svc}`} aria-hidden="true" style={{ marginRight: 7 }} />{l.title}
                      <div className="cell-sub">{l.kind === "task" ? l.type : "Job"}</div>
                    </td>
                    <td className="mono">
                      {l.hours ? fmtHours(l.hours) : (
                        <button type="button" className="btn small" aria-label={`Add time for ${l.title}`} onClick={(e) => { e.stopPropagation(); setAddingFor(addingFor === l.key ? undefined : l.key); }}>
                          {l.skipped ? "Add time" : "Add time"}
                        </button>
                      )}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {l.kind === "task" && (
                        <button type="button" className="btn small" disabled={busy === l.key} onClick={(e) => { e.stopPropagation(); void reopen(l); }}>Reopen</button>
                      )}
                    </td>
                  </tr>,
                  ...(addingFor === l.key ? [
                    <tr key={`${l.key}-time`} className="time-row">
                      <td colSpan={5} onClick={(e) => e.stopPropagation()}>
                        <TimeEntry finished={asFinished(l)} onSaved={() => setAddingFor(undefined)} onCancel={() => setAddingFor(undefined)} />
                      </td>
                    </tr>,
                  ] : []),
                ])}
              </tbody>
            </table>
          </div>
          {shown.length > 300 && <p className="muted" style={{ fontSize: 12, padding: "0 16px 12px" }}>{shown.length - 300} older ones not shown; narrow the dates or search.</p>}
        </section>
      ) : (
        <div className="card empty">Nothing completed in that time.</div>
      )}
    </div>
  );
}
