// Checklists: the practice view of every job's checklist (what needs attention and who has what), the template
// library and builder, and the team settings. A single job's checklist is on its own page (JobChecklist).
import { useMemo, useState } from "react";
import * as C from "../lib/checklist";
import { fmtDate } from "../lib/domain";
import { href, useRoute } from "./bits";
import { ChecklistBuilder, ChecklistLibrary, TeamSettings } from "./ChecklistTemplates";
import { useChecklists } from "./checklistKit";
import { JobChecklistPage, ProgressBar } from "./JobChecklist";
import { useData, useIndex } from "./data";

const TABS: [string, string, string][] = [["", "Overview", "#/checklists"], ["templates", "Templates", "#/checklists/templates"], ["team", "Team and rules", "#/checklists/team"]];

export function ChecklistsPage() {
  const { parts } = useRoute();
  const cl = useChecklists();
  if (parts[1] === "job" && parts[2]) return <JobChecklistPage key={parts[2]} jobKey={decodeURIComponent(parts[2])} />;
  const sub = parts[1] === "template" ? "templates" : parts[1] || "";
  return (
    <div className="page checklists-page">
      <div className="page-head"><div>
        <h1>Checklists</h1>
        <p className="muted" style={{ margin: "4px 0 0" }}>Standard steps for each job: what applies, who does it, what's left and what's been reviewed.</p>
      </div></div>
      <nav className="subtabs" aria-label="Checklists">
        {TABS.map(([k, label, h]) => <a key={k} className="subtab" href={h} aria-current={sub === k ? "page" : undefined}>{label}</a>)}
      </nav>
      {!cl.ready && <p className="import-list warn" role="alert">The checklist lists aren't set up yet. They are added automatically when the planner starts; if this stays, open Setup and choose “Create the lists”.</p>}
      {parts[1] === "template" && parts[2] ? <ChecklistBuilder key={parts[2]} id={decodeURIComponent(parts[2])} />
        : parts[1] === "templates" ? <ChecklistLibrary />
        : parts[1] === "team" ? <TeamSettings />
        : <Overview />}
    </div>
  );
}

type Filter = "all" | "mandatory" | "review" | "client" | "blocked" | "overdue" | "ready";
const FILTERS: [Filter, string][] = [["all", "All"], ["mandatory", "Mandatory items open"], ["review", "Ready for review"], ["client", "Waiting for client"], ["blocked", "Blocked"], ["overdue", "Overdue"], ["ready", "Ready to complete"]];

/** Progress across every job with a checklist. Each number is the same one the job's own page shows. */
export function useOverview() {
  const cl = useChecklists();
  const { data } = useData();
  const openJobs = useMemo(() => new Set(data.jobs.filter((j) => j.Status !== "Complete" && j.Status !== "Closed").map((j) => j.Key)), [data.jobs]);
  const rows = useMemo(() => C.summarise(
    cl.checklists.filter((c) => openJobs.has(c.jobKey)).map((c) => ({ key: c.key, jobKey: c.jobKey, clientKey: c.clientKey, jobType: c.jobType, status: c.status })),
    cl.items, cl.today, cl.notes.map((n) => n),
  ), [cl.checklists, cl.items, cl.notes, cl.today, openJobs]);
  return { cl, rows };
}

export const matches = (s: C.Summary, f: Filter) =>
  f === "all" ? true : f === "mandatory" ? s.p.mandatoryOpen.length > 0 : f === "review" ? s.status === "active" && s.p.readyForReview || s.status === "review" : f === "client" ? s.p.waitingClient.length > 0
    : f === "blocked" ? s.p.blocked.length > 0 : f === "overdue" ? s.p.overdue.length > 0 : s.p.readyToComplete && s.status !== "review";

function Overview() {
  const { cl, rows } = useOverview();
  const { data } = useData();
  const idx = useIndex();
  const [f, setF] = useState<Filter>("all");
  const [type, setType] = useState("");
  const [client, setClient] = useState("");
  const [who, setWho] = useState("");
  const [status, setStatus] = useState("");
  const clientName = (k: string) => String(data.clients.find((c) => c.Key === k)?.Title || "");
  const jobOf = (k: string) => data.jobs.find((j) => j.Key === k);
  const base = rows.filter((s) => (!type || s.jobType === type) && (!client || s.clientKey === client) && (!who || s.assignees.includes(who)) && (!status || s.status === status));
  const shown = base.filter((s) => matches(s, f)).sort((a, b) => b.p.overdue.length - a.p.overdue.length || a.p.pct - b.p.pct);
  const items = cl.items.filter((i) => rows.some((r) => r.checklistKey === i.checklistKey) && (!who || i.assignee === who));
  const load = C.workload(items);
  const people = [...new Set(cl.items.map((i) => i.assignee).filter(Boolean))].sort();
  const clientsWith: string[] = [...new Set<string>(rows.map((r) => r.clientKey))];
  const noChecklist = data.jobs.filter((j) => j.Status !== "Complete" && j.Status !== "Closed" && !cl.byJob.has(j.Key)).length;

  return (
    <div className="stack">
      <div className="cl-tiles" role="list">
        {FILTERS.filter(([k]) => k !== "all").map(([k, label]) => (
          <button key={k} type="button" role="listitem" className={`tl-sum${f === k ? " on" : ""}`} onClick={() => setF(f === k ? "all" : k)} aria-pressed={f === k}>
            <span className="tl-sum-label">{label}</span><strong>{base.filter((s) => matches(s, k)).length}</strong><span className="muted tl-sum-sub">job{base.filter((s) => matches(s, k)).length === 1 ? "" : "s"}</span>
          </button>
        ))}
      </div>
      <div className="row-wrap">
        <select className="input" aria-label="Job type" value={type} onChange={(e) => setType(e.target.value)}><option value="">All job types</option>{data.services.map((s) => <option key={s.Key as string} value={s.Key as string}>{s.Title as string}</option>)}</select>
        <select className="input" aria-label="Client" value={client} onChange={(e) => setClient(e.target.value)}><option value="">All clients</option>{clientsWith.map((k) => <option key={k} value={k}>{clientName(k)}</option>)}</select>
        <select className="input" aria-label="Staff member" value={who} onChange={(e) => setWho(e.target.value)}><option value="">Everyone</option>{people.map((p) => <option key={p}>{p}</option>)}</select>
        <select className="input" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any status</option><option value="active">In preparation</option><option value="review">With the reviewer</option><option value="approved">Approved</option></select>
        <select className="input" aria-label="Show" value={f} onChange={(e) => setF(e.target.value as Filter)}>{FILTERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        {noChecklist > 0 && <span className="muted">{noChecklist} open job{noChecklist === 1 ? " has" : "s have"} no checklist</span>}
      </div>
      {shown.length ? (
        <div className="table-wrap"><table className="bank-table"><thead><tr><th>Client and job</th><th>Progress</th><th>Mandatory open</th><th>Blocked</th><th>Overdue</th><th>With</th><th>Status</th></tr></thead><tbody>
          {shown.map((s) => {
            const j = jobOf(s.jobKey);
            return (
              <tr key={s.checklistKey} className="clickable" onClick={() => (window.location.hash = href("checklists", "job", s.jobKey))}>
                <td><a href={href("checklists", "job", s.jobKey)}><strong>{clientName(s.clientKey)}</strong></a><div className="muted">{String(idx.serviceName.get(s.jobType) || "")}{j?.PeriodEnd ? `, ${fmtDate(String(j.PeriodEnd))}` : ""}</div></td>
                <td><span className="row-wrap" style={{ flexWrap: "nowrap" }}><ProgressBar pct={s.p.pct} /> <span>{s.p.pct}%</span></span></td>
                <td className="num">{s.p.mandatoryOpen.length}</td>
                <td className="num">{s.p.blocked.length || ""}</td>
                <td className="num">{s.p.overdue.length ? <span className="warn">{s.p.overdue.length}</span> : ""}</td>
                <td>{s.assignees.slice(0, 3).join(", ")}{s.assignees.length > 3 ? ` +${s.assignees.length - 3}` : ""}</td>
                <td><span className={`chip ${s.status === "approved" ? "green" : s.status === "review" ? "blue" : ""}`}>{s.status === "review" ? "With reviewer" : s.status === "approved" ? "Approved" : "In preparation"}</span></td>
              </tr>
            );
          })}
        </tbody></table></div>
      ) : <p className="muted">{rows.length ? "No jobs match these filters." : "No open jobs have a checklist yet. New jobs get one automatically from the default template for their type; open any job to add one to an existing job."}</p>}
      <h3>Open work by person</h3>
      {load.length ? <table className="bank-table"><thead><tr><th>Person</th><th>Open items</th><th>Estimated hours</th></tr></thead><tbody>{load.map((w) => <tr key={w.who}><td>{w.who}</td><td className="num">{w.open}</td><td className="num">{w.hours}</td></tr>)}</tbody></table> : <p className="muted">Nothing assigned.</p>}
    </div>
  );
}

/** The practice's checklist position at a glance, for the home screen. Nothing shows until a job has a checklist. */
export function ChecklistsHomeCard() {
  const { rows } = useOverview();
  if (!rows.length) return null;
  const n = (f: Filter) => rows.filter((s) => matches(s, f)).length;
  const tiles: [Filter, string, number][] = [["mandatory", "Mandatory items open", n("mandatory")], ["review", "Ready for review", n("review")], ["client", "Waiting for client", n("client")], ["blocked", "Blocked", n("blocked")], ["overdue", "Overdue", n("overdue")], ["ready", "Ready to complete", n("ready")]];
  return (
    <section className="card pad stack" aria-labelledby="cl-home-h">
      <div className="row-wrap"><h2 id="cl-home-h" style={{ margin: 0, fontSize: 16 }}>Checklists</h2><span style={{ flex: 1 }} /><a href="#/checklists">All checklists →</a></div>
      <div className="cl-tiles">{tiles.map(([k, label, v]) => <a key={k} className="tl-sum" href="#/checklists"><span className="tl-sum-label">{label}</span><strong className={v && (k === "blocked" || k === "overdue") ? "warn" : ""}>{v}</strong><span className="muted tl-sum-sub">job{v === 1 ? "" : "s"}</span></a>)}</div>
    </section>
  );
}
