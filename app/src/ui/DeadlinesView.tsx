// Deadlines: everything due in the next 30, 60 or 90 days (and anything late), by month.
// Prints cleanly (or saves as PDF from the print dialog) and downloads as a CSV.
import { useMemo, useState } from "react";
import { Job, Task, fmtDate, isOnHold, jobState, todayIso } from "../lib/domain";
import { addDays } from "../lib/planning";
import { Icon, PlanTabs } from "./bits";
import { useData, useIndex } from "./data";
import { taskAsJob, useEditor } from "./Editors";

type Range = "30" | "60" | "90" | "180" | "all";
type Line = {
  key: string; kind: "job" | "task"; row: Job | Task; deadline: string; client: string; work: string; type: string;
  periodEnd?: string; stage?: string; planned?: string; records?: string; held: boolean; urgent: boolean;
};

const monthLabel = (iso: string) => new Date(`${iso.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

export function DeadlinesView() {
  const { data, user } = useData();
  const idx = useIndex();
  const { open } = useEditor();
  const today = todayIso();
  const [range, setRange] = useState<Range>("90");
  const [type, setType] = useState("");
  const [tasks, setTasks] = useState(true);
  const [held, setHeld] = useState(true);
  const [search, setSearch] = useState("");

  const lines = useMemo(() => {
    const out: Line[] = [];
    for (const j of idx.openJobs) {
      if (!j.Deadline) continue;
      out.push({
        key: j.Key, kind: "job", row: j, deadline: j.Deadline, client: idx.clientByKey.get(j.ClientKey)?.Title || (j.ClientName as string) || "",
        work: j.Title, type: j.ServiceKey || "", periodEnd: j.PeriodEnd, stage: j.StageName ? `${j.StageNo || 1}. ${j.StageName}` : j.StageNo ? `Stage ${j.StageNo}` : "",
        planned: j.PlannedDate, records: j.RecordsReceived ? `In ${fmtDate(j.RecordsReceived, { year: false })}` : "", held: isOnHold(j), urgent: j.Priority === "urgent",
      });
    }
    for (const t of idx.openTasks) {
      if (!t.DueDate) continue;
      out.push({
        key: t.Key, kind: "task", row: t, deadline: t.DueDate, client: (t.ClientKey && idx.clientByKey.get(t.ClientKey)?.Title) || "",
        work: t.Title, type: "TASK", planned: t.PlannedDate, held: isOnHold(t), urgent: false,
      });
    }
    return out.sort((a, b) => a.deadline.localeCompare(b.deadline) || a.client.localeCompare(b.client));
  }, [idx]);

  const until = range === "all" ? "9999-12-31" : addDays(today, Number(range));
  const shown = lines.filter((l) =>
    l.deadline <= until &&
    (!type || l.type === type) &&
    (tasks || l.kind !== "task") &&
    (held || !l.held) &&
    (!search || `${l.client} ${l.work}`.toLowerCase().includes(search.toLowerCase())));
  const late = shown.filter((l) => l.deadline < today);
  const months = new Map<string, Line[]>();
  for (const l of shown.filter((x) => x.deadline >= today)) {
    const k = l.deadline.slice(0, 7);
    if (!months.has(k)) months.set(k, []);
    months.get(k)!.push(l);
  }
  const types = [...new Set(lines.map((l) => l.type))]
    .map((k) => [k, k === "TASK" ? "Tasks" : idx.serviceName.get(k) || k] as const)
    .sort((a, b) => a[1].localeCompare(b[1]));
  const rangeText = range === "all" ? "all deadlines" : `the next ${range} days`;
  const typeText = type ? ` · ${types.find(([k]) => k === type)?.[1]}` : "";

  const downloadCsv = () => {
    const head = ["Deadline", "Client", "Work", "Type of work", "Period end", "Stage", "Planned", "Records", "Status"];
    const rows = shown.map((l) => [
      l.deadline, l.client, l.work, l.type === "TASK" ? "Task" : idx.serviceName.get(l.type) || l.type, l.periodEnd || "", l.stage || "",
      l.planned || "", l.records || "", status(l, today).map((s) => s.text).join("; "),
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

  const table = (list: Line[]) => (
    <table className="grid deadlines">
      <thead>
        <tr>
          <th scope="col">Deadline</th><th scope="col">Client</th><th scope="col">Work</th><th scope="col">Stage</th>
          <th scope="col">Planned</th><th scope="col">Records</th><th scope="col">Status</th>
        </tr>
      </thead>
      <tbody>
        {list.map((l) => (
          <tr key={l.key} className="clickable" onClick={() => open(l.kind === "job" ? { kind: "job", key: l.key } : { kind: "task", key: l.key })}>
            <td className="c-date mono" style={{ whiteSpace: "nowrap" }}>{fmtDate(l.deadline, { weekday: true, year: l.deadline.slice(0, 4) !== today.slice(0, 4) })}</td>
            <td className="c-client cell-title">{l.client || "—"}</td>
            <td className="c-work">
              {l.work}
              {l.periodEnd && <div className="cell-sub">Period to {fmtDate(l.periodEnd)}</div>}
            </td>
            <td className="c-stage">{l.stage || "—"}</td>
            <td className="c-planned">{l.planned ? <>Planned {fmtDate(l.planned, { weekday: true, year: false })}</> : <span className="muted">Not planned</span>}</td>
            <td className="c-records">{l.records || (l.kind === "task" ? "—" : <span className="muted">Not in</span>)}</td>
            <td className="c-status"><span className="row-wrap" style={{ gap: 4 }}>{status(l, today).map((s) => <span key={s.text} className={`chip ${s.tone}`}>{s.text}</span>)}</span></td>
          </tr>
        ))}
      </tbody>
    </table>
  );

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
        <label>
          <span className="sr-only">Type of work</span>
          <select className="input" value={type} onChange={(e) => setType(e.target.value)} style={{ width: "auto" }}>
            <option value="">All types of work</option>
            {types.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </label>
        <label className="search" style={{ flex: "1 1 200px" }}>
          <Icon name="search" />
          <span className="sr-only">Search deadlines</span>
          <input type="search" placeholder="Client or work" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <label className="row-wrap" style={{ gap: 6, fontSize: 14 }}>
          <input type="checkbox" checked={tasks} onChange={(e) => setTasks(e.target.checked)} style={{ width: 18, height: 18 }} /> Tasks
        </label>
        <label className="row-wrap" style={{ gap: 6, fontSize: 14 }}>
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
      {!shown.length && <div className="card empty">Nothing due in {rangeText}.</div>}
    </div>
  );
}

function status(l: Line, today: string): { text: string; tone: string }[] {
  const out: { text: string; tone: string }[] = [];
  if (l.held) out.push({ text: "On hold", tone: "hold" });
  if (l.urgent) out.push({ text: "Urgent", tone: "red" });
  const st = jobState(l.kind === "task" ? taskAsJob(l.row as Task) : (l.row as Job), today);
  if (st.state === "overdue") out.push({ text: `${-st.days!}d late`, tone: "red" });
  else if (st.state === "tight") out.push({ text: `Tight · ${st.days}d`, tone: "amber" });
  else if (st.days !== undefined) out.push({ text: `${st.days}d`, tone: "" });
  return out;
}
