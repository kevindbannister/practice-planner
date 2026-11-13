// Deadlines: everything due in the next 30, 60 or 90 days (and anything late), by month.
// Prints cleanly (or saves as PDF from the print dialog) and downloads as a CSV.
import { useMemo, useState } from "react";
import { Job, Task, fmtDate, isOnHold, jobState, todayIso } from "../lib/domain";
import { addDays } from "../lib/planning";
import { ElementsLink, Icon, PlanTabs, href } from "./bits";
import { TypeFilter, useRememberedTypes } from "./TypeFilter";
import { svcClass } from "../lib/serviceColour";
import { inFinalise, waitingForClient } from "../lib/waiting";
import { isStatutory } from "../lib/workGroups";
import { useData, useIndex } from "./data";
import { taskAsJob, useEditor } from "./Editors";

type Range = "30" | "60" | "90" | "180" | "all";
type Kind = "all" | "statutory" | "other";
type Line = {
  key: string; kind: "job" | "task"; row: Job | Task; deadline: string; client: string; clientKey?: string; groupKey?: string; work: string; type: string;
  periodEnd?: string; stage?: string; planned?: string; records?: string; held: boolean; urgent: boolean; wait?: string; statutory: boolean;
};

const monthLabel = (iso: string) => new Date(`${iso.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

export function DeadlinesView() {
  const { data, user } = useData();
  const idx = useIndex();
  const { open } = useEditor();
  const today = todayIso();
  const [range, setRange] = useState<Range>("90");
  const [picked, setPicked] = useRememberedTypes("pp.deadlines.types");
  // statutory deadlines (filing dates the law sets) or everything else; remembered on this device
  const [kind, setKindState] = useState<Kind>(() => { try { const v = localStorage.getItem("pp.deadlines.kind"); return v === "statutory" || v === "other" ? v : "all"; } catch { return "all"; } });
  const setKind = (k: Kind) => { setKindState(k); try { localStorage.setItem("pp.deadlines.kind", k); } catch { /* this visit only */ } };
  const [tasks, setTasks] = useState(true);
  const [held, setHeld] = useState(false); // jobs on hold are hidden until asked for
  const [search, setSearch] = useState("");
  // one group's clients together (remembered on this device)
  const [group, setGroupState] = useState(() => { try { return localStorage.getItem("pp.deadlines.group") || ""; } catch { return ""; } });
  const setGroup = (g: string) => {
    setGroupState(g);
    try { localStorage.setItem("pp.deadlines.group", g); } catch { /* no storage */ }
  };
  const groups = [...data.groups].sort((a, b) => String(a.Title).localeCompare(String(b.Title)));
  const theGroup = groups.find((g) => g.Key === group);
  const inGroup = (clientKey?: string) => !!clientKey && (idx.groupsByMember.get(clientKey) || []).some((g) => g.Key === group);
  const members = theGroup ? data.clients.filter((c) => inGroup(c.Key as string)).sort((a, b) => String(a.Title).localeCompare(String(b.Title))) : [];

  const lines = useMemo(() => {
    const out: Line[] = [];
    for (const j of idx.openJobs) {
      if (!j.Deadline) continue;
      out.push({
        key: j.Key, kind: "job", row: j, deadline: j.Deadline, client: idx.clientByKey.get(j.ClientKey)?.Title || (j.ClientName as string) || "", clientKey: j.ClientKey,
        work: j.Title, type: j.ServiceKey || "", periodEnd: j.PeriodEnd, stage: j.StageName ? `${j.StageNo || 1}. ${j.StageName}` : j.StageNo ? `Stage ${j.StageNo}` : "",
        planned: j.PlannedDate, records: j.RecordsReceived ? `In ${fmtDate(j.RecordsReceived, { year: false })}` : "", held: isOnHold(j), urgent: j.Priority === "urgent",
        statutory: isStatutory(data.services.find((x) => x.Key === j.ServiceKey), j.ServiceKey),
        wait: waitingForClient(j, idx.stagesByService.get(j.ServiceKey || "") || []) ? `With the client${j.SpeakOn ? ` · speaking ${fmtDate(j.SpeakOn as string, { year: false })}` : ""}` : inFinalise(j) ? "Ready to finalise" : "",
      });
    }
    for (const t of idx.openTasks) {
      if (!t.DueDate) continue;
      out.push({
        key: t.Key, kind: "task", row: t, deadline: t.DueDate, client: (t.ClientKey && idx.clientByKey.get(t.ClientKey)?.Title) || "", clientKey: t.ClientKey || undefined, groupKey: (t.GroupKey as string) || undefined,
        work: t.Title, type: "TASK", planned: t.PlannedDate, held: isOnHold(t), urgent: false, statutory: false,
      });
    }
    return out.sort((a, b) => a.deadline.localeCompare(b.deadline) || a.client.localeCompare(b.client));
  }, [idx, data.services]);

  const types = [...new Set(lines.map((l) => l.type))]
    .map((k) => [k, k === "TASK" ? "Tasks" : idx.serviceName.get(k) || k] as const)
    .sort((a, b) => a[1].localeCompare(b[1]));
  // only count choices that are still on offer
  const chosen = picked.filter((k) => types.some(([t]) => t === k));
  const typeOptions = types.map(([key, name]) => ({ key, name, count: lines.filter((l) => l.type === key).length }));
  const until = range === "all" ? "9999-12-31" : addDays(today, Number(range));
  const shown = lines.filter((l) =>
    l.deadline <= until &&
    (!chosen.length || chosen.includes(l.type)) &&
    (kind === "all" || (kind === "statutory") === l.statutory) &&
    (tasks || l.kind !== "task") &&
    (held || !l.held) &&
    (!theGroup || inGroup(l.clientKey) || l.groupKey === group) &&
    (!search || `${l.client} ${l.work}`.toLowerCase().includes(search.toLowerCase())));
  const late = shown.filter((l) => l.deadline < today);
  const dueToday = shown.filter((l) => l.deadline === today);
  const months = new Map<string, Line[]>();
  for (const l of shown.filter((x) => x.deadline > today)) {
    const k = l.deadline.slice(0, 7);
    if (!months.has(k)) months.set(k, []);
    months.get(k)!.push(l);
  }
  const inRange = lines.filter((l) => l.deadline <= until);
  const kindCount = { all: inRange.length, statutory: inRange.filter((l) => l.statutory).length, other: inRange.filter((l) => !l.statutory).length };
  const rangeText = range === "all" ? "all deadlines" : `the next ${range} days`;
  const typeText = (kind === "statutory" ? " · Statutory deadlines only" : kind === "other" ? " · Other deadlines only" : "") + (theGroup ? ` · ${theGroup.Title}` : "") + (chosen.length ? ` · ${chosen.map((k) => types.find(([t]) => t === k)?.[1]).join(", ")}` : "");

  const downloadCsv = () => {
    const head = ["Deadline", "Client", "Work", "Type of work", "Period end", "Stage", "Planned", "Records", "Kind", "Status"];
    const rows = shown.map((l) => [
      l.deadline, l.client, l.work, l.type === "TASK" ? "Task" : idx.serviceName.get(l.type) || l.type, l.periodEnd || "", l.stage || "",
      l.planned || "", l.records || "", l.statutory ? "Statutory" : "Deadline", status(l, today).map((s) => s.text).join("; "),
    ]);
    const csv = [head, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `Deadlines ${today}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  /** Statutory deadlines first, then the other deadlines; soonest first within each. */
  const row = (l: Line) => (
    <tr key={l.key} className="clickable" onClick={() => open(l.kind === "job" ? { kind: "job", key: l.key } : { kind: "task", key: l.key })}>
      <td className="c-date mono" style={{ whiteSpace: "nowrap" }}>{fmtDate(l.deadline, { weekday: true, year: l.deadline.slice(0, 4) !== today.slice(0, 4) })}</td>
      <td className="c-client cell-title">
        {l.client || "—"}
        {l.kind === "job" && <div><ElementsLink client={idx.clientByKey.get((l.row as Job).ClientKey)} /></div>}
      </td>
      <td className="c-work">
        <span className={`svc-dot ${svcClass(l.type)}`} aria-hidden="true" style={{ marginRight: 7, verticalAlign: "-1px" }} />{l.work}
        {l.periodEnd && <div className="cell-sub">Period to {fmtDate(l.periodEnd)}</div>}
      </td>
      <td className="c-stage">{l.stage || "—"}</td>
      <td className="c-planned">{l.planned ? <>Planned {fmtDate(l.planned, { weekday: true, year: false })}</> : <span className="muted">Not planned</span>}</td>
      <td className="c-records">{l.records || (l.kind === "task" ? "—" : <span className="muted">Not in</span>)}</td>
      <td className="c-status"><span className="row-wrap" style={{ gap: 4 }}>{status(l, today).map((s) => <span key={s.text} className={`chip ${s.tone}`}>{s.text}</span>)}</span></td>
    </tr>
  );
  const table = (list: Line[]) => {
    const sorted = (xs: Line[]) => [...xs].sort((a, b) => a.deadline.localeCompare(b.deadline) || a.client.localeCompare(b.client));
    const stat = sorted(list.filter((l) => l.statutory)), other = sorted(list.filter((l) => !l.statutory));
    const block = (name: string, tone: string, xs: Line[]) => xs.length > 0 && (
      <tbody key={name}>
        <tr className="date-row"><th scope="colgroup" colSpan={7}><span className={`chip ${tone}`}>{name}</span><span className="muted"> · {xs.length}</span></th></tr>
        {xs.map(row)}
      </tbody>
    );
    return (
      <table className="grid deadlines">
        <thead>
          <tr>
            <th scope="col">Deadline</th><th scope="col">Client</th><th scope="col">Work</th><th scope="col">Stage</th>
            <th scope="col">Planned</th><th scope="col">Records</th><th scope="col">Status</th>
          </tr>
        </thead>
        {block("Statutory deadlines", "blue", stat)}
        {block("Other deadlines", "", other)}
      </table>
    );
  };

  return (
    <div className="page">
      <PlanTabs current="deadlines" />
      <div className="print-only print-head">
        <strong>Deadlines: {rangeText}{typeText}</strong>
        <span>Printed {fmtDate(today, { weekday: true })}{user ? ` by ${user}` : ""} · {shown.length} items</span>
      </div>
      <div className="row-wrap no-print">
        <div className="seg" role="group" aria-label="Due within">
          {(["30", "60", "90", "180", "all"] as Range[]).map((r) => (
            <button key={r} type="button" aria-pressed={range === r} onClick={() => setRange(r)} aria-label={r === "all" ? "All" : `${r} days`}>
              {r === "all" ? "All" : <>{r}<span className="hide-phone">&nbsp;days</span><span className="only-phone">d</span></>}
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Kind of deadline">
          {([["all", "All"], ["statutory", "Statutory"], ["other", "Other"]] as [Kind, string][]).map(([k, l]) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} title={k === "statutory" ? "Filing and payment dates set by law or HMRC / Companies House" : k === "other" ? "Everything else: internal targets, client-agreed dates and tasks" : "Every deadline"}>{l} <span className="muted">{kindCount[k]}</span></button>
          ))}
        </div>
        <div className="deadline-types">
          <TypeFilter options={typeOptions} selected={picked} onChange={setPicked} />
        </div>
        <label>
          <span className="sr-only">Group</span>
          <select className="input" value={theGroup ? group : ""} onChange={(e) => setGroup(e.target.value)} style={{ width: "auto", maxWidth: 260 }}>
            <option value="">Any group</option>
            {groups.map((g) => <option key={g.Key as string} value={g.Key as string}>{g.Title as string}</option>)}
          </select>
        </label>
        <label className="search" style={{ flex: "1 1 200px" }}>
          <Icon name="search" />
          <span className="sr-only">Search deadlines</span>
          <input type="search" placeholder="Client or work" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <label className="row-wrap" style={{ gap: 6, fontSize: 15 }}>
          <input type="checkbox" checked={tasks} onChange={(e) => setTasks(e.target.checked)} style={{ width: 18, height: 18 }} /> Tasks
        </label>
        <label className="row-wrap" style={{ gap: 6, fontSize: 15 }}>
          <input type="checkbox" checked={held} onChange={(e) => setHeld(e.target.checked)} style={{ width: 18, height: 18 }} /> On hold
        </label>
        <div className="row-wrap" style={{ marginLeft: "auto" }}>
          <button type="button" className="btn" onClick={downloadCsv}><Icon name="download" />CSV</button>
          <button type="button" className="btn primary" onClick={() => window.print()}><Icon name="print" />Print or PDF</button>
        </div>
      </div>
      <p className="muted no-print" style={{ margin: 0, fontSize: 13 }}>
        {shown.length} item{shown.length === 1 ? "" : "s"} due in {rangeText}{typeText}{late.length ? `, including ${late.length} late` : ""}.
        To save a PDF, choose Print or PDF and pick "Save as PDF".
      </p>

      {theGroup && (
        <section className="card pad stack group-strip" aria-label={`${theGroup.Title} group`} style={{ gap: 8 }}>
          <div className="row-wrap" style={{ justifyContent: "space-between" }}>
            <h2 className="sec-h">{theGroup.Title as string}</h2>
            <button type="button" className="linkbtn no-print" onClick={() => setGroup("")}>Show every client</button>
          </div>
          <div className="row-wrap" style={{ gap: 8 }}>
            {members.map((c) => {
              const n = shown.filter((l) => l.clientKey === c.Key).length;
              return <a key={c.Key as string} className={`chip${n ? " blue" : ""}`} href={href("clients", c.Key as string)}>{c.Title as string}{` · ${n}`}</a>;
            })}
            {!members.length && <span className="muted">No clients in this group yet.</span>}
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            {members.length} client{members.length === 1 ? "" : "s"} in the group. The number on each is how many deadlines it has in {rangeText}.
          </p>
        </section>
      )}
      {dueToday.length > 0 ? (
        <section className="card deadline-group deadline-today" aria-labelledby="dl-today">
          <div className="card-head">
            <h2 id="dl-today">Due today: action needed</h2>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{dueToday.length} due{dueToday.filter((l) => l.statutory).length ? `, ${dueToday.filter((l) => l.statutory).length} statutory` : ""}</span>
          </div>
          <div className="table-wrap">{table(dueToday)}</div>
        </section>
      ) : (
        <p className="muted no-print" style={{ margin: 0, fontSize: 13 }}>Nothing is due today.</p>
      )}
      {late.length > 0 && (
        <section className="card deadline-group" aria-labelledby="dl-late">
          <div className="card-head"><h2 id="dl-late" style={{ color: "var(--red-ink)" }}>Late</h2><span className="muted" style={{ fontSize: 13 }}>{late.length}</span></div>
          <div className="table-wrap">{table(late)}</div>
        </section>
      )}
      {[...months.entries()].map(([k, list]) => (
        <section key={k} className="card deadline-group" aria-labelledby={`dl-${k}`}>
          <div className="card-head"><h2 id={`dl-${k}`}>{monthLabel(`${k}-01`)}</h2><span className="muted" style={{ fontSize: 13 }}>{list.length}</span></div>
          <div className="table-wrap">{table(list)}</div>
        </section>
      ))}
      {!shown.length && <div className="card empty">Nothing due in {rangeText}{theGroup ? ` for ${theGroup.Title}` : ""}.</div>}
    </div>
  );
}

function status(l: Line, today: string): { text: string; tone: string }[] {
  const out: { text: string; tone: string }[] = [];
  if (l.held) out.push({ text: "On hold", tone: "hold" });
  if (l.wait) out.push({ text: l.wait, tone: "wait" });
  if (l.urgent) out.push({ text: "Urgent", tone: "red" });
  const st = jobState(l.kind === "task" ? taskAsJob(l.row as Task) : (l.row as Job), today);
  if (st.state === "overdue") out.push({ text: `${-st.days!}d late`, tone: "red" });
  else if (st.state === "tight") out.push({ text: `Tight · ${st.days}d`, tone: "amber" });
  else if (st.days !== undefined) out.push({ text: `${st.days}d`, tone: "" });
  return out;
}
