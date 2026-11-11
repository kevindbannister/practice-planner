// A client's Tasks tab: every outstanding action for the client in one compact list, ours and the client's, with filters, grouping, quick add and bulk entry.
// These are the same task records as everywhere else (including tasks linked to a job or a meeting): nothing is copied.
import { useMemo, useState } from "react";
import { todayIso } from "../lib/domain";
import { Row } from "../lib/schema";
import { readTask } from "../lib/work/model";
import { blockedTaskKeys } from "../lib/work/readiness";
import { useWorld } from "./DependencyPanel";
import { FILTERS, Filter, GroupBy, childProgress, filterCounts, filterTasks, groupTasks } from "../lib/work/tasks";
import { useData } from "./data";
import { BulkAdd, QuickAdd, TaskLine, UndoBar, useTaskChanges } from "./taskKit";

const GROUPS: [GroupBy, string][] = [["none", "No grouping"], ["status", "Status"], ["responsible", "Responsible party"], ["job", "Job"], ["due", "Due date"], ["priority", "Priority"]];

export function ClientTasks({ client }: { client: Row }) {
  const { data } = useData();
  const k = useTaskChanges();
  const ck = String(client.Key), today = todayIso();
  const [filter, setFilter] = useState<Filter>("outstanding"); const [by, setBy] = useState<GroupBy>("none");
  const mine = useMemo(() => k.rows.filter((r) => r.ClientKey === ck).map(readTask), [k.rows, ck]);
  const world = useWorld(); const blocked = useMemo(() => blockedTaskKeys(world), [world]);
  const counts = filterCounts(mine, today, blocked);
  const shown = filterTasks(mine, filter, today, blocked);
  const jobTitle = (key: string) => { const j = data.jobs.find((x) => x.Key === key); return j ? String(j.Title || j.ServiceKey || key) : key; };
  const jobLine = (t: ReturnType<typeof readTask>) => [t.jobKey ? `Job: ${jobTitle(t.jobKey)}` : "", t.followUpDate ? `Follow up ${t.followUpDate}` : "", t.blockedReason ? `Blocked: ${t.blockedReason}` : ""].filter(Boolean).join(" · ");
  const groups = groupTasks(by === "none" ? shown.filter((t) => !t.parentKey || !shown.some((p) => p.key === t.parentKey)) : shown, by, { today, jobTitle });
  const kids = (key: string) => shown.filter((t) => t.parentKey === key);
  const line = (t: ReturnType<typeof readTask>, nested = false) => <TaskLine key={t.key} t={nested ? t : { ...t, parentKey: by === "none" ? "" : t.parentKey }} onToggle={() => void k.toggle(t)} onPriority={(p) => void k.one(t.key, { priority: p }, "Priority set")} onDue={(d) => void k.one(t.key, { due: d || null }, "Due date set")} subline={jobLine(t)} childCount={childProgress(k.rows, t.key)} />;
  return (
    <div className="stack" style={{ gap: 12 }}>
      <QuickAdd context={{ clientKey: ck }} placeholder={`Add a task for ${String(client.Title)} and press Enter`} />
      <div className="row-wrap" style={{ gap: 6 }} role="group" aria-label="Show">
        {FILTERS.map(([f, label]) => <button key={f} type="button" className="btn small" aria-pressed={filter === f} onClick={() => setFilter(f)}>{label} <span className="chip">{counts[f]}</span></button>)}
        <label className="row-wrap" style={{ gap: 6, marginLeft: "auto" }}><span className="muted">Group by</span><select className="input" value={by} onChange={(e) => setBy(e.target.value as GroupBy)}>{GROUPS.map(([g, l]) => <option key={g} value={g}>{l}</option>)}</select></label>
      </div>
      <UndoBar undo={k.undo} error={k.error} onUndo={() => void k.undoNow()} onClose={k.dismissUndo} />
      {shown.length === 0 ? <div className="card empty">{filter === "outstanding" ? "Nothing outstanding for this client." : "Nothing in this view."}</div> : groups.map((g) => (
        <section key={g.key} className="card pad" aria-label={g.label || "Tasks"}>
          {g.label && <h3 style={{ margin: "0 0 4px", fontSize: 14 }}>{g.label} <span className="chip">{g.tasks.length}</span></h3>}
          <ul className="plain" style={{ margin: 0 }}>{g.tasks.map((t) => <span key={t.key} style={{ display: "contents" }}>{line(t)}{by === "none" && kids(t.key).map((c) => line(c, true))}</span>)}</ul>
        </section>
      ))}
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>Counts are tasks, not jobs. A task can appear under more than one filter.</p>
      <BulkAdd context={{ clientKey: ck }} />
    </div>
  );
}
