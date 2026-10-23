// Business projects: work on the practice itself. Each card shows what the project is for, how
// far along it is, what's next and whether it has stopped moving. Their tasks are planned onto
// business days on the Week view.
import { useState } from "react";
import { fmtDate, fmtHours, todayIso } from "../lib/domain";
import { addDays, mondayOf } from "../lib/planning";
import { dayHours } from "../lib/dayTypes";
import { Row } from "../lib/schema";
import { categoryOf, isBusinessTask, lastMoved, nextAction, progressOf, projectAttention, sortProjects, statusOf } from "../lib/projects";
import { Icon, PlanTabs } from "./bits";
import { useData } from "./data";
import { useEditor } from "./Editors";

export function ProjectsView() {
  const { data, settings } = useData();
  const { open } = useEditor();
  const today = todayIso();
  const [show, setShow] = useState<"active" | "all">("active");
  const all = sortProjects(data.projects);
  const list = show === "all" ? all : all.filter((p) => statusOf(p) === "Active");
  const stalled = all.filter((p) => projectAttention(p, data.tasks, today)).length;

  // business time this week: the business share of each day against business tasks planned onto it
  const monday = mondayOf(today);
  const week = [0, 1, 2, 3, 4].map((i) => addDays(monday, i));
  const available = week.reduce((t, d) => t + dayHours(d, settings).business, 0);
  const planned = data.tasks
    .filter((t) => isBusinessTask(t) && t.Status !== "Cancelled" && t.PlannedDate && week.includes(String(t.PlannedDate)))
    .reduce((t, x) => t + (Number(x.EstimateHours) || 1), 0);

  return (
    <div className="page">
      <PlanTabs current="projects" />
      <div className="row-wrap" style={{ justifyContent: "space-between" }}>
        <div className="row-wrap">
          <div className="seg" role="group" aria-label="Show">
            <button type="button" aria-pressed={show === "active"} onClick={() => setShow("active")}>Active</button>
            <button type="button" aria-pressed={show === "all"} onClick={() => setShow("all")}>All</button>
          </div>
          <span className="muted" style={{ fontSize: 13 }}>
            {list.length} project{list.length === 1 ? "" : "s"}{stalled ? ` · ${stalled} need${stalled === 1 ? "s" : ""} a look` : ""}
          </span>
        </div>
        <button type="button" className="btn primary" onClick={() => open({ kind: "project" })}>+ New project</button>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        Business time this week: {fmtHours(planned) || "0h"} planned of {fmtHours(available) || "0h"}.
        {available === 0 ? " No business time in your week yet: make a day a business day in Settings › Your week, or from the Week view." : ""}
      </p>
      {list.length ? (
        <div className="proj-grid">
          {list.map((p) => <ProjectCard key={p.Key as string} project={p} today={today} />)}
        </div>
      ) : (
        <div className="card empty">
          {all.length ? "No active projects." : "No business projects yet. Add one for marketing, a new system, recruiting, or anything else that improves the practice."}
        </div>
      )}
    </div>
  );
}

function ProjectCard({ project: p, today }: { project: Row; today: string }) {
  const { data } = useData();
  const { open } = useEditor();
  const cat = categoryOf(p);
  const status = statusOf(p);
  const prog = progressOf(p, data.tasks);
  const next = nextAction(p, data.tasks);
  const attention = projectAttention(p, data.tasks, today);
  const moved = lastMoved(p, data.tasks);
  const pct = prog.total ? Math.round((prog.done / prog.total) * 100) : 0;
  return (
    <article className={`proj-card${status !== "Active" ? " quiet" : ""}`} style={{ ["--cat" as string]: cat.colour }} aria-label={p.Title as string}>
      <button type="button" className="proj-main" onClick={() => open({ kind: "project", key: p.Key as string })}>
        <span className="proj-cat"><span className="proj-dot" aria-hidden="true" />{cat.name}</span>
        <strong className="proj-title">{p.Title as string}</strong>
        {p.Outcome ? <span className="proj-outcome">{p.Outcome as string}</span> : null}
        <span className="proj-bar" role="img" aria-label={`${prog.done} of ${prog.total} tasks done`}><span style={{ width: `${pct}%` }} /></span>
        <span className="muted proj-meta">
          {prog.total ? `${prog.done} of ${prog.total} tasks done` : "No tasks yet"}
          {p.TargetDate ? ` · target ${fmtDate(p.TargetDate as string, { year: false })}` : ""}
          {moved ? ` · last moved ${fmtDate(moved, { year: false })}` : ""}
        </span>
        {status === "Active" && (
          <span className="proj-next">{next ? <>Next: {next.Title as string}{next.PlannedDate ? <span className="muted"> · {fmtDate(next.PlannedDate as string, { weekday: true, year: false })}</span> : <span className="muted"> · not planned</span>}</> : <span className="muted">Next: nothing yet</span>}</span>
        )}
      </button>
      <div className="row-wrap proj-foot">
        {status !== "Active" && <span className="chip hold">{status}</span>}
        {attention && <span className={`chip ${attention.level}`}>{attention.text}</span>}
        <button type="button" className="btn small" onClick={() => open({ kind: "task", projectKey: p.Key as string })}>Add task</button>
      </div>
    </article>
  );
}

/** On Home: business projects that have stalled, are past their target, or have no next step. */
export function ProjectsToLookAt() {
  const { data } = useData();
  const { open } = useEditor();
  const today = todayIso();
  const list = sortProjects(data.projects)
    .map((p) => ({ p, a: projectAttention(p, data.tasks, today) }))
    .filter((x): x is { p: Row; a: NonNullable<ReturnType<typeof projectAttention>> } => !!x.a);
  if (!list.length) return null;
  return (
    <section className="card" aria-labelledby="proj-look-h">
      <div className="card-head">
        <h2 className="with-icon" id="proj-look-h"><span className="h-icon hue-violet" aria-hidden="true"><Icon name="list" size={15} /></span>Business projects to look at</h2>
        <a href="#/plan/projects" style={{ fontSize: 13 }}>All projects</a>
      </div>
      <ul className="home-list">
        {list.map(({ p, a }) => (
          <li key={p.Key as string}>
            <button type="button" className="proj-look" style={{ ["--cat" as string]: categoryOf(p).colour }} onClick={() => open({ kind: "project", key: p.Key as string })}>
              <span className="proj-dot" aria-hidden="true" />
              <span className="proj-look-text"><strong>{p.Title as string}</strong><span className="muted">{categoryOf(p).name}</span></span>
              <span className={`chip ${a.level}`}>{a.text}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
