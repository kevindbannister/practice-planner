// Extra details on an existing task, in the task editor: who is responsible, status, priority, dates, parent task and what is blocking it.
// Every save goes through lib/work/tasks, so the rules (parents, client-action status path, version) are the same as in the lists.
import { ReactNode, useState } from "react";
import { Row } from "../lib/schema";
import { EXTERNAL_STATUSES, CORE_STATUSES, canMove, readTask, statusLabel } from "../lib/work/model";
import { Spec, childProgress, changeTask } from "../lib/work/tasks";
import { teamFrom } from "../lib/permissions";
import { useData } from "./data";

export function TaskDetails({ task }: { task: Row }) {
  const { data, update, user } = useData();
  const rows = data.tasks as Row[];
  const t = readTask(task);
  const [error, setError] = useState<string>();
  const members = teamFrom(data.settings).members;
  const kids = childProgress(rows, t.key);
  const save = async (spec: Spec) => {
    const c = changeTask(rows, t.key, spec, { user: user || "", now: new Date().toISOString() });
    if ("error" in c && c.error) return setError(c.error);
    setError(undefined);
    try { await update("Tasks", task, (c as { patch: Row }).patch); } catch { setError("That didn't save. Try again."); }
  };
  const statuses = (t.ownerType === "user" ? CORE_STATUSES : EXTERNAL_STATUSES).filter((s) => canMove(t.status, s, t.ownerType));
  const parents = rows.map(readTask).filter((p) => p.key !== t.key && !["Done", "Complete", "Cancelled"].includes(p.status) && (!t.clientKey || !p.clientKey || p.clientKey === t.clientKey));
  const field = (label: string, el: ReactNode) => <label className="doc-field"><span>{label}</span>{el}</label>;
  return (
    <section className="stack" aria-label="Task details">
      <h3 style={{ margin: 0, fontSize: 15 }}>Details</h3>
      <div className="form" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
        {field("Who does it", <select className="input" value={t.ownerType} onChange={(e) => void save({ ownerType: e.target.value as "user" })}><option value="user">Us</option><option value="contact">The client</option><option value="external">Someone else</option></select>)}
        {t.ownerType !== "user" && field("Who exactly", <input className="input" defaultValue={t.responsible} placeholder="e.g. Director, solicitor, HMRC" onBlur={(e) => { if (e.target.value !== t.responsible) void save({ responsible: e.target.value }); }} />)}
        {field(t.ownerType === "user" ? "Owner" : "Who chases it", <select className="input" value={t.owner} onChange={(e) => void save({ owner: e.target.value })}><option value="">Not assigned</option>{user && <option value={user}>Me</option>}{members.filter((m) => m.user !== (user || "").toLowerCase()).map((m) => <option key={m.user} value={m.user}>{m.name || m.user}</option>)}</select>)}
        {field("Status", <select className="input" value={t.status} onChange={(e) => void save({ status: e.target.value })}>{!statuses.includes(t.status as never) && <option>{statusLabel(t.status)}</option>}{statuses.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}</select>)}
        {field("Priority", <select className="input" value={t.priority} onChange={(e) => void save({ priority: e.target.value as "high" })}><option value="">None</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>)}
        {field("Due date", <input className="input" type="date" value={t.dueDate} onChange={(e) => void save({ due: e.target.value || null })} />)}
        {field("Our target date", <input className="input" type="date" value={t.internalTarget} onChange={(e) => void save({ target: e.target.value || null })} />)}
        {field("Follow up on", <input className="input" type="date" value={t.followUpDate} onChange={(e) => void save({ followUp: e.target.value || null })} />)}
        {field("Part of (bigger task)", <select className="input" value={t.parentKey} onChange={(e) => void save({ parent: e.target.value || null })}><option value="">None</option>{parents.map((p) => <option key={p.key} value={p.key}>{p.title}</option>)}</select>)}
        <div style={{ gridColumn: "1 / -1" }}>{field("What is stopping it? (optional)", <input className="input" defaultValue={t.blockedReason} placeholder="Leave blank if nothing" onBlur={(e) => { if (e.target.value.trim() !== t.blockedReason) void save({ blockedReason: e.target.value }); }} />)}</div>
      </div>
      {kids.total > 0 && <p className="muted" style={{ margin: 0 }}>Smaller tasks: {kids.done} of {kids.total} done.</p>}
      {t.ownerType !== "user" && t.status === "Submitted" && <p className="muted" style={{ margin: 0 }}>The client says this is done. It only counts once you've checked it: move it to Under review, then Done.</p>}
      {error && <p className="error-text" role="alert">{error}</p>}
    </section>
  );
}
