// The planning board: a working week of days with capacity, and a tray of unplanned
// work. Drag cards between days (or back to the tray); click a card to edit it.
import { DragEvent, useMemo, useState } from "react";
import { Job, Task, fmtDate, fmtHours, jobState, todayIso } from "../lib/domain";
import { addDays, jobHours, mondayOf, weekday } from "../lib/planning";
import { Icon } from "./bits";
import { useData, useIndex } from "./data";
import { taskAsJob, useEditor } from "./Editors";

type Item = {
  kind: "job" | "task";
  key: string;
  row: Job | Task;
  title: string;
  client: string;
  tag: string;
  hours: number;
  planned?: string;
  deadline?: string;
  urgent: boolean;
  compliance: boolean;
};

type Show = "all" | "compliance" | "other";
type Horizon = "30" | "90" | "all";

export function PlanPage() {
  const { data, settings, update } = useData();
  const idx = useIndex();
  const { open } = useEditor();
  const today = todayIso();
  const [week, setWeek] = useState(mondayOf(today));
  const [show, setShow] = useState<Show>("all");
  const [horizon, setHorizon] = useState<Horizon>("90");
  const [search, setSearch] = useState("");
  const [dragKey, setDragKey] = useState<string>();
  const [dropTarget, setDropTarget] = useState<string>();
  const [error, setError] = useState<string>();

  const days = [0, 1, 2, 3, 4].map((i) => addDays(week, i));

  const items: Item[] = useMemo(() => {
    const jobs = idx.openJobs.map<Item>((j) => ({
      kind: "job", key: j.Key, row: j, title: j.Title,
      client: idx.clientByKey.get(j.ClientKey)?.Title || (j.ClientName as string) || "",
      tag: shortTag(j.ServiceKey, idx.serviceName.get(j.ServiceKey || "")),
      hours: jobHours(j, data.services), planned: j.PlannedDate, deadline: j.Deadline,
      urgent: j.Priority === "urgent", compliance: true,
    }));
    const tasks = idx.openTasks.map<Item>((t) => ({
      kind: "task", key: t.Key, row: t, title: t.Title,
      client: (t.ClientKey && idx.clientByKey.get(t.ClientKey)?.Title) || "",
      tag: t.Type || "Task", hours: t.EstimateHours || 1, planned: t.PlannedDate, deadline: t.DueDate,
      urgent: false, compliance: false,
    }));
    return [...jobs, ...tasks];
  }, [idx, data.services]);

  const visible = items.filter((i) => (show === "all" ? true : show === "compliance" ? i.compliance : !i.compliance));
  const byDay = new Map(days.map((d) => [d, visible.filter((i) => i.planned === d)]));
  const unplanned = visible
    .filter((i) => !i.planned || (i.planned < today && !days.includes(i.planned)))
    .filter((i) => horizon === "all" || !i.deadline || i.deadline <= addDays(today, Number(horizon)))
    .filter((i) => !search || `${i.title} ${i.client}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => (a.deadline || "9999").localeCompare(b.deadline || "9999"));
  const missed = unplanned.filter((i) => i.planned && i.planned < today);

  const capacity = (d: string) => settings.hours[String(weekday(d)) as keyof typeof settings.hours] ?? 0;
  const load = (d: string) => (byDay.get(d) || []).reduce((t, i) => t + i.hours, 0);
  const weekHours = days.reduce((t, d) => t + load(d), 0);
  const weekCapacity = days.reduce((t, d) => t + capacity(d), 0);
  const overDays = days.filter((d) => load(d) > capacity(d)).length;
  const tightPlanned = days.flatMap((d) => byDay.get(d) || []).filter((i) => ["tight", "overdue"].includes(state(i, today))).length;
  const dueSoonUnplanned = items.filter((i) => !i.planned && i.deadline && i.deadline <= addDays(today, 30)).length;

  const move = async (key: string, date?: string) => {
    const item = items.find((i) => i.key === key);
    if (!item || item.planned === date) return;
    setError(undefined);
    try {
      await update(item.kind === "job" ? "Jobs" : "Tasks", item.row, { PlannedDate: date || "" });
    } catch {
      setError("That move didn't save. It's been put back; try again.");
    }
  };

  const onDrop = (date?: string) => (e: DragEvent) => {
    e.preventDefault();
    const key = e.dataTransfer.getData("text/plain") || dragKey;
    setDropTarget(undefined);
    setDragKey(undefined);
    if (key) move(key, date);
  };
  const dropProps = (target: string, date?: string) => ({
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      setDropTarget(target);
    },
    onDragLeave: () => setDropTarget((t) => (t === target ? undefined : t)),
    onDrop: onDrop(date),
  });

  const card = (i: Item) => (
    <PlanCard
      key={i.key}
      item={i}
      today={today}
      dragging={dragKey === i.key}
      onOpen={() => open(i.kind === "job" ? { kind: "job", key: i.key } : { kind: "task", key: i.key })}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", i.key);
        e.dataTransfer.effectAllowed = "move";
        setDragKey(i.key);
      }}
      onDragEnd={() => setDragKey(undefined)}
    />
  );

  return (
    <div className="plan">
      <section className="plan-head">
        <div className="stack" style={{ gap: 10 }}>
          <h1 style={{ margin: 0, fontSize: 28, letterSpacing: "-0.02em" }}>Plan</h1>
          <div className="row-wrap">
            <button type="button" className="iconbtn" aria-label="Previous week" onClick={() => setWeek(addDays(week, -7))}><Icon name="left" /></button>
            <span style={{ fontWeight: 600, fontSize: 16, padding: "0 4px", minWidth: 180, textAlign: "center" }}>
              {fmtDate(week, { year: false })} – {fmtDate(addDays(week, 4))}
            </span>
            <button type="button" className="iconbtn" aria-label="Next week" onClick={() => setWeek(addDays(week, 7))}><Icon name="right" /></button>
            {week !== mondayOf(today) && <button type="button" className="btn small" onClick={() => setWeek(mondayOf(today))}>This week</button>}
            <div className="seg" role="group" aria-label="Show">
              {(["all", "compliance", "other"] as Show[]).map((s) => (
                <button key={s} type="button" aria-pressed={show === s} onClick={() => setShow(s)}>
                  {s === "all" ? "All work" : s === "compliance" ? "Compliance" : "Tasks"}
                </button>
              ))}
            </div>
            <button type="button" className="btn primary" onClick={() => open({ kind: "task" })}>+ New task</button>
          </div>
        </div>
        <div className="tiles" style={{ flex: "1 1 320px", minWidth: 0, maxWidth: 680 }}>
          <div className="tile"><div className="label">Planned this week</div><div className="value">{fmtHours(weekHours) || "0h"} <span className="muted" style={{ fontSize: 13 }}>/ {fmtHours(weekCapacity)}</span></div></div>
          <div className={`tile${overDays ? " red" : ""}`}><div className="label">Over capacity</div><div className="value">{overDays} day{overDays === 1 ? "" : "s"}</div></div>
          <div className={`tile${tightPlanned ? " amber" : ""}`}><div className="label">Tight or late</div><div className="value">{tightPlanned}</div></div>
          <div className={`tile${dueSoonUnplanned ? " amber" : ""}`}><div className="label">Due in 30 days, unplanned</div><div className="value">{dueSoonUnplanned}</div></div>
        </div>
      </section>
      {error && <p className="error-text" role="alert" style={{ padding: "0 24px" }}>{error}</p>}

      <div className="plan-body">
        <aside
          className={`tray${dropTarget === "tray" ? " drop" : ""}`}
          aria-label="Unplanned work"
          {...dropProps("tray", undefined)}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
            <h2 style={{ margin: 0, fontSize: 16 }}>Unplanned <span className="muted" style={{ fontWeight: 500 }}>({unplanned.length})</span></h2>
            <label>
              <span className="sr-only">Due within</span>
              <select className="input" value={horizon} onChange={(e) => setHorizon(e.target.value as Horizon)} style={{ minHeight: 36, padding: "4px 8px", width: "auto", fontSize: 13 }}>
                <option value="30">Due in 30 days</option>
                <option value="90">Due in 90 days</option>
                <option value="all">Everything</option>
              </select>
            </label>
          </div>
          <label className="search" style={{ maxWidth: "none", flex: "0 0 auto", minHeight: 40 }}>
            <Icon name="search" />
            <span className="sr-only">Search unplanned work</span>
            <input type="search" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>Drag onto a day to plan it, or open a card to pick a date.</p>
          {missed.length > 0 && (
            <p style={{ margin: 0, fontSize: 12, color: "var(--amber-ink)", fontWeight: 600 }}>
              {missed.length} planned on an earlier day but not finished
            </p>
          )}
          <div className="tray-list">
            {unplanned.slice(0, 80).map(card)}
            {unplanned.length > 80 && <p className="muted" style={{ fontSize: 12 }}>{unplanned.length - 80} more; narrow the dates or search.</p>}
            {!unplanned.length && <p className="muted" style={{ fontSize: 13 }}>Nothing waiting to be planned.</p>}
          </div>
        </aside>

        <div className="week" role="list" aria-label="Week">
          {days.map((d) => {
            const list = byDay.get(d) || [];
            const used = load(d), cap = capacity(d);
            const over = used > cap;
            const pct = cap ? Math.min(100, Math.round((used / cap) * 100)) : 100;
            return (
              <div key={d} role="listitem" className={`day${d === today ? " today" : ""}${dropTarget === d ? " drop" : ""}`} {...dropProps(d, d)}>
                <div className="day-head">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                    <span style={{ fontWeight: 700 }}>{fmtDate(d, { weekday: true, year: false })}</span>
                    <span className="mono" style={{ fontSize: 12, color: over ? "var(--red-ink)" : "var(--ink-2)" }}>
                      {fmtHours(used) || "0h"} / {fmtHours(cap)}
                    </span>
                  </div>
                  <div className="cap" aria-hidden="true"><span className={over ? "over" : ""} style={{ width: `${pct}%` }} /></div>
                  {over && <span style={{ fontSize: 12, fontWeight: 600, color: "var(--red-ink)" }}>{fmtHours(used - cap)} over</span>}
                </div>
                {list.map(card)}
                <button type="button" className="day-add" onClick={() => open({ kind: "task", plannedDate: d })}>+ Task</button>
              </div>
            );
          })}
        </div>
      </div>
      <p className="muted legend">
        <span className="chip amber">Tight</span> due within {settings.tightDays} days of when it's planned ·{" "}
        <span className="chip red">Late</span> past its deadline · dashed cards are your own tasks
      </p>
    </div>
  );
}

function state(i: Item, today: string) {
  return jobState((i.kind === "task" ? taskAsJob(i.row as Task) : (i.row as Job)), today).state;
}

function PlanCard({
  item: i, today, dragging, onOpen, onDragStart, onDragEnd,
}: {
  item: Item; today: string; dragging: boolean; onOpen: () => void;
  onDragStart: (e: DragEvent) => void; onDragEnd: () => void;
}) {
  const st = jobState(i.kind === "task" ? taskAsJob(i.row as Task) : (i.row as Job), today);
  const job = i.kind === "job" ? (i.row as Job) : undefined;
  return (
    <button
      type="button"
      className={`pcard${i.compliance ? "" : " task"}${dragging ? " dragging" : ""}`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      aria-label={`${i.title}${i.client ? ", " + i.client : ""}${i.deadline ? ", due " + fmtDate(i.deadline) : ""}. Open to edit.`}
    >
      <span className="pcard-top">
        <span className="pcard-tag">{i.tag}</span>
        <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>{fmtHours(i.hours)}</span>
      </span>
      <span className="pcard-client">{i.client || i.title}</span>
      <span className="pcard-sub">
        {i.client ? i.title : ""}
        {job?.PeriodEnd ? ` · to ${fmtDate(job.PeriodEnd, { year: false })}` : ""}
        {job?.StageNo ? ` · stage ${job.StageNo}` : ""}
      </span>
      {(i.deadline || i.urgent) && (
        <span className="pcard-foot">
          {i.deadline && <span className="mono" style={{ fontSize: 12 }}>Due {fmtDate(i.deadline, { year: i.deadline.slice(0, 4) !== today.slice(0, 4) })}</span>}
          {i.urgent && <span className="chip red">Urgent</span>}
          {st.state === "overdue" && <span className="chip red">{-st.days!}d late</span>}
          {st.state === "tight" && <span className="chip amber">Tight · {st.days}d</span>}
          {i.planned && i.planned < today && <span className="chip amber">Planned {fmtDate(i.planned, { year: false })}</span>}
        </span>
      )}
    </button>
  );
}

function shortTag(service?: string, name?: string): string {
  const map: Record<string, string> = {
    ACCS_LTD: "Accounts", ACCS_LLP: "LLP accounts", CT600: "CT600", CS01: "CS01", VAT: "VAT", SA100: "Self Assessment",
    SA800: "SA800", PAYROLL: "Payroll", MGMT_ACCOUNTS: "Mgmt accounts", BOOKKEEPING: "Bookkeeping", MYS: "MYS",
    ONBOARDING: "Onboarding", TASK: "Task",
  };
  return map[service || ""] || name || "Job";
}
