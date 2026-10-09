// Home: the first screen. What needs you today, what's due soon, how full your time is,
// and anything waiting for a decision. Each panel links through to the screen with the detail.
import { useMemo } from "react";
import { chaseItems, groupByClient } from "../lib/chase";
import { Job, Task, fmtDate, fmtHours, holdAlert, isOnHold, jobState, todayIso } from "../lib/domain";
import { forecast } from "../lib/forecast";
import { addDays, jobHours, mondayOf, weekday } from "../lib/planning";
import { useBackup } from "./Backups";
import { useCalendar } from "./Calendar";
import { fmtWhen, useCompaniesHouse } from "./CompaniesHouse";
import { useData, useIndex } from "./data";
import { taskAsJob, useEditor } from "./Editors";
import { svcClass } from "../lib/serviceColour";

type Work = {
  key: string; kind: "job" | "task"; row: Job | Task; title: string; client: string; serviceKey?: string;
  hours: number; deadline?: string; planned?: string; urgent: boolean; held: boolean; records?: string; periodEnd?: string; typeName: string;
};

const greeting = (h: number) => (h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening");

export function HomePage() {
  const { data, settings, user } = useData();
  const idx = useIndex();
  const { open } = useEditor();
  const cal = useCalendar();
  const ch = useCompaniesHouse();
  const backup = useBackup();
  const today = todayIso();
  const monday = mondayOf(today);
  const week = [0, 1, 2, 3, 4].map((i) => addDays(monday, i));
  const usual = (d: string) => settings.hours[String(weekday(d)) as keyof typeof settings.hours] ?? 0;
  const capacity = (d: string) => cal.capacityFor(d, usual(d));

  const work = useMemo((): Work[] => {
    const name = (k?: string) => (k && idx.clientByKey.get(k)?.Title) || "";
    return [
      ...idx.openJobs.map((j): Work => ({
        key: j.Key, kind: "job", row: j, title: j.Title, client: name(j.ClientKey) || (j.ClientName as string) || "", serviceKey: j.ServiceKey,
        hours: jobHours(j, data.services), deadline: j.Deadline, planned: j.PlannedDate, urgent: j.Priority === "urgent", held: isOnHold(j),
        records: j.RecordsReceived, periodEnd: j.PeriodEnd, typeName: idx.serviceName.get(j.ServiceKey || "") || j.Title,
      })),
      ...idx.openTasks.map((t): Work => ({
        key: t.Key, kind: "task", row: t, title: t.Title, client: name(t.ClientKey), hours: t.EstimateHours || 1, deadline: t.DueDate,
        planned: t.PlannedDate, urgent: false, held: isOnHold(t), serviceKey: "TASK", typeName: "Tasks",
      })),
    ];
  }, [idx, data.services]);

  const active = work.filter((w) => !w.held);
  const late = active.filter((w) => w.deadline && w.deadline < today).sort((a, b) => a.deadline!.localeCompare(b.deadline!));
  const next7 = active.filter((w) => w.deadline && w.deadline >= today && w.deadline <= addDays(today, 7));
  const next7Unplanned = next7.filter((w) => !w.planned || w.planned < today);
  const due30Unplanned = active.filter((w) => w.deadline && w.deadline <= addDays(today, 30) && (!w.planned || w.planned < today));
  const todays = active.filter((w) => w.planned === today).sort((a, b) => Number(b.urgent) - Number(a.urgent) || (a.deadline || "9999").localeCompare(b.deadline || "9999"));
  const todayHours = todays.reduce((t, w) => t + w.hours, 0);
  const todayCap = weekday(today) >= 1 && weekday(today) <= 5 ? capacity(today) : 0;
  const chase = useMemo(() => groupByClient(chaseItems(idx.openJobs, data.services, today, data.stageTemplates)).filter((g) => g.status !== "chased"), [idx.openJobs, data.services, today, data.stageTemplates]);
  const heldAlerts = work.filter((w) => w.held && holdAlert(w.row, w.deadline, today));
  const missed = active.filter((w) => w.planned && w.planned < today);

  // next fortnight's deadlines, by day
  const upcoming = active
    .filter((w) => w.deadline && w.deadline >= today && w.deadline <= addDays(today, 14))
    .sort((a, b) => a.deadline!.localeCompare(b.deadline!) || a.client.localeCompare(b.client));
  const byDay = new Map<string, Work[]>();
  for (const w of upcoming) {
    if (!byDay.has(w.deadline!)) byDay.set(w.deadline!, []);
    byDay.get(w.deadline!)!.push(w);
  }

  const f = useMemo(() => forecast(data.jobs, data.tasks, data.services, settings.hours, today, 6), [data.jobs, data.tasks, data.services, settings.hours, today]);
  const monthMax = Math.max(1, ...f.months.map((m) => Math.max(m.due, m.capacity)));

  // open work by type of work
  const byType = useMemo(() => {
    const m = new Map<string, { name: string; open: number; soon: number; late: number }>();
    for (const w of active) {
      const k = w.kind === "task" ? "TASK" : w.serviceKey || "OTHER";
      const name = k === "TASK" ? "Tasks" : idx.serviceName.get(k) || k;
      const r = m.get(k) || { name, open: 0, soon: 0, late: 0 };
      r.open++;
      if (w.deadline && w.deadline < today) r.late++;
      else if (w.deadline && w.deadline <= addDays(today, 30)) r.soon++;
      m.set(k, r);
    }
    return [...m.values()].sort((a, b) => b.late - a.late || b.soon - a.soon || b.open - a.open);
  }, [active, idx.serviceName, today]);

  const doneThisWeek = data.jobs.filter((j) => j.Status === "Complete" && j.CompletedDate && j.CompletedDate >= monday).length +
    data.tasks.filter((t) => t.Status === "Done" && t.CompletedDate && t.CompletedDate >= monday).length;

  const first = (user || "").split(" ")[0];
  const openWork = (w: Work) => open(w.kind === "job" ? { kind: "job", key: w.key } : { kind: "task", key: w.key });
  const weekLoad = (d: string) => active.filter((w) => w.planned === d).reduce((t, w) => t + w.hours, 0);
  const weekMax = Math.max(1, ...week.map((d) => Math.max(weekLoad(d), capacity(d))));

  const summary = [
    late.length ? `${late.length} late` : "nothing late",
    `${next7.length} due in the next 7 days${next7Unplanned.length ? ` (${next7Unplanned.length} not planned)` : ""}`,
    todayCap ? `${fmtHours(todayHours) || "nothing"} planned today` : "",
  ].filter(Boolean).join(" · ");

  return (
    <div className="page home">
      <div className="home-head">
        <div>
          <h1>{greeting(new Date().getHours())}{first ? `, ${first}` : ""}</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>{fmtDate(today, { weekday: true })} · {summary}</p>
        </div>
        <div className="row-wrap">
          <a className="btn" href="#/plan/deadlines">Deadlines</a>
          <a className="btn primary" href="#/plan">Open the plan</a>
        </div>
      </div>

      <div className="home-tiles">
        <Tile href="#/plan/deadlines" tone={late.length ? "red" : ""} label="Late" value={String(late.length)} sub={late.length ? `${fmtHours(late.reduce((t, w) => t + w.hours, 0))} of work` : "All on time"} />
        <Tile href="#/plan/deadlines" tone={next7Unplanned.length ? "amber" : ""} label="Due in 7 days" value={String(next7.length)} sub={next7Unplanned.length ? `${next7Unplanned.length} not planned` : next7.length ? "All planned" : "Nothing due"} />
        <Tile href="#/plan" tone={due30Unplanned.length ? "amber" : ""} label="Due in 30 days, not planned" value={String(due30Unplanned.length)} sub={`${fmtHours(due30Unplanned.reduce((t, w) => t + w.hours, 0)) || "0h"} to fit in`} />
        <Tile href="#/chase" tone={chase.some((g) => g.status === "late") ? "amber" : ""} label="Records to chase" value={String(chase.length)} sub={chase.length ? `${chase.filter((g) => g.status === "late").length} late` : "Nobody to chase"} />
        <Tile href="#/settings/companies-house" tone={ch.openFlags.length ? "amber" : ""} label="Companies House" value={String(ch.openFlags.length)} sub={ch.openFlags.length ? "changes to review" : ch.lastRun ? "No changes" : "Not checked yet"} />
        <Tile href="#/plan" tone={doneThisWeek ? "green" : ""} label="Done this week" value={String(doneThisWeek)} sub="jobs and tasks completed" />
      </div>

      <div className="home-grid">
        <div className="home-col">
          <section className="card" aria-labelledby="today-h">
            <div className="card-head">
              <h2 id="today-h">Today</h2>
              <span className="muted" style={{ fontSize: 13 }}>
                {todayCap ? `${fmtHours(todayHours) || "0h"} of ${fmtHours(todayCap)}` : "Not a working day"}
                {cal.meetingsOn(today) ? ` · meetings ${fmtHours(cal.meetingsOn(today))}` : ""}
              </span>
            </div>
            {todayCap > 0 && (
              <div className="meter" role="img" aria-label={`${fmtHours(todayHours) || "0h"} planned of ${fmtHours(todayCap)} available today`}>
                <span className={todayHours > todayCap ? "over" : ""} style={{ width: `${Math.min(100, (todayHours / todayCap) * 100)}%` }} />
              </div>
            )}
            {todays.length ? (
              <ul className="home-list">
                {todays.map((w) => <WorkRow key={w.key} w={w} today={today} onOpen={() => openWork(w)} show="deadline" />)}
              </ul>
            ) : (
              <div className="home-empty">
                <p style={{ margin: 0 }}>Nothing planned for today{missed.length ? `, and ${missed.length} item${missed.length === 1 ? " was" : "s were"} planned on an earlier day but not finished` : ""}.</p>
                <a className="btn small" href="#/plan">Plan the week, or use Suggest a plan</a>
              </div>
            )}
          </section>

          <section className="card" aria-labelledby="soon-h">
            <div className="card-head">
              <h2 id="soon-h">Due in the next 14 days</h2>
              <a href="#/plan/deadlines" style={{ fontSize: 13 }}>All deadlines</a>
            </div>
            {byDay.size ? (
              <div className="home-days">
                {[...byDay.entries()].map(([d, list]) => (
                  <div key={d} className="home-day">
                    <div className="home-date">
                      <strong>{fmtDate(d, { weekday: true, year: false })}</strong>
                      <span className="muted">{d === today ? "today" : `in ${Math.round((Date.parse(d) - Date.parse(today)) / 86400000)}d`}</span>
                    </div>
                    <div className="svc-groups">
                      {groupByType(list).map((g) => <TypeGroup key={g.key} group={g} today={today} onOpen={openWork} />)}
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="muted" style={{ margin: 0, padding: 16 }}>Nothing due in the next fortnight.</p>}
          </section>
        </div>

        <div className="home-col">
          <section className="card pad stack" aria-labelledby="week-h">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
              <h2 id="week-h">This week</h2>
              <a href="#/plan" style={{ fontSize: 13 }}>Plan</a>
            </div>
            <div className="weekbars" role="list" aria-label="Hours planned each day this week">
              {week.map((d) => {
                const used = weekLoad(d), cap = capacity(d);
                const label = `${fmtDate(d, { weekday: true, year: false })}: ${fmtHours(used) || "0h"} planned of ${fmtHours(cap)}${cal.meetingsOn(d) ? `, meetings ${fmtHours(cal.meetingsOn(d))}` : ""}`;
                return (
                  <div key={d} role="listitem" className={`weekbar${d === today ? " today" : ""}${d < today ? " past" : ""}`} title={label} aria-label={label}>
                    <span className="wb-val mono">{fmtHours(used) || "0h"}</span>
                    <div className="wb-track">
                      <span className="wb-cap" style={{ height: `${(cap / weekMax) * 100}%` }} />
                      <span className={`wb-fill${used > cap ? " over" : ""}`} style={{ height: `${(Math.min(used, weekMax) / weekMax) * 100}%` }} />
                    </div>
                    <span className="wb-day">{fmtDate(d, { weekday: true, year: false }).split(" ")[0]}</span>
                  </div>
                );
              })}
            </div>
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>
              Bars are hours planned; the outline is the hours you have{cal.prefs.enabled ? " after meetings" : ""}.
            </p>
          </section>

          <section className="card" aria-labelledby="att-h">
            <div className="card-head"><h2 id="att-h">Needs a decision</h2></div>
            <ul className="home-list attention">
              {late.slice(0, 4).map((w) => (
                <li key={w.key}><button type="button" onClick={() => openWork(w)}>
                  <span className="dot red" aria-hidden="true" />
                  <span className="stack" style={{ gap: 1 }}><strong>{w.client ? `${w.client}: ` : ""}{w.title}</strong><span className="muted">Was due {fmtDate(w.deadline, { year: false })}</span></span>
                </button></li>
              ))}
              {late.length > 4 && <li className="muted more"><a href="#/plan/deadlines">{late.length - 4} more late</a></li>}
              {ch.openFlags.length > 0 && (
                <li><a href="#/settings/companies-house">
                  <span className="dot amber" aria-hidden="true" />
                  <span className="stack" style={{ gap: 1 }}><strong>{ch.openFlags.length} Companies House change{ch.openFlags.length === 1 ? "" : "s"} to review</strong><span className="muted">Apply or ignore each one</span></span>
                </a></li>
              )}
              {heldAlerts.map((w) => (
                <li key={w.key}><button type="button" onClick={() => openWork(w)}>
                  <span className="dot amber" aria-hidden="true" />
                  <span className="stack" style={{ gap: 1 }}><strong>{w.client ? `${w.client}: ` : ""}{w.title}</strong><span className="muted">{holdAlert(w.row, w.deadline, today)!.text}</span></span>
                </button></li>
              ))}
              {missed.length > 0 && (
                <li><a href="#/plan">
                  <span className="dot amber" aria-hidden="true" />
                  <span className="stack" style={{ gap: 1 }}><strong>{missed.length} planned on an earlier day, not finished</strong><span className="muted">Move them to a new day</span></span>
                </a></li>
              )}
              {!late.length && !ch.openFlags.length && !heldAlerts.length && !missed.length && (
                <li className="muted" style={{ padding: "12px 16px" }}>Nothing waiting on you.</li>
              )}
            </ul>
          </section>

          <section className="card pad stack" aria-labelledby="mon-h">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
              <h2 id="mon-h">Next 6 months</h2>
              <a href="#/plan/months" style={{ fontSize: 13 }}>Months ahead</a>
            </div>
            <ul className="minimonths">
              {f.months.map((m) => {
                const over = m.due > m.capacity;
                const label = `${new Date(`${m.key}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" })}: ${fmtHours(m.due) || "0h"} due, ${fmtHours(m.capacity)} available`;
                return (
                  <li key={m.key} title={label} aria-label={label}>
                    <span className="mm-name">{new Date(`${m.key}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })}</span>
                    <span className="mm-track">
                      <span className={`mm-fill${over ? " over" : ""}`} style={{ width: `${(m.due / monthMax) * 100}%` }} />
                      <span className="mm-cap" style={{ left: `${(m.capacity / monthMax) * 100}%` }} />
                    </span>
                    <span className="mm-val mono">{Math.round((m.due / Math.max(1, m.capacity)) * 100)}%</span>
                  </li>
                );
              })}
            </ul>
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>Hours due each month as a share of the hours you have (the line), including next periods of recurring work.</p>
          </section>

          <section className="card" aria-labelledby="type-h">
            <div className="card-head"><h2 id="type-h">Open work by type</h2><span className="muted" style={{ fontSize: 13 }}>{active.length} open</span></div>
            <div className="table-wrap">
              <table className="grid">
                <thead><tr><th scope="col">Type of work</th><th scope="col" className="num">Open</th><th scope="col" className="num">Due in 30 days</th><th scope="col" className="num">Late</th></tr></thead>
                <tbody>
                  {byType.slice(0, 10).map((r) => (
                    <tr key={r.name}>
                      <td>{r.name}</td>
                      <td className="num mono">{r.open}</td>
                      <td className="num mono">{r.soon || <span className="muted">0</span>}</td>
                      <td className="num mono" style={r.late ? { color: "var(--red-ink)", fontWeight: 600 } : undefined}>{r.late || <span className="muted">0</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>

      <p className="muted home-foot">
        Companies House checked {fmtWhen(ch.lastRun?.at)} · Backup {backup.last ? fmtWhen(backup.last.at) : "not yet"}
        {cal.prefs.enabled ? ` · Calendar synced ${cal.state.at ? cal.state.at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "soon"}` : ""}
      </p>
    </div>
  );
}

function Tile({ href: to, tone, label, value, sub }: { href: string; tone: string; label: string; value: string; sub: string }) {
  return (
    <a className={`tile home-tile${tone ? ` ${tone}` : ""}`} href={to}>
      <span className="label">{label}</span>
      <span className="value">{value}</span>
      <span className="sub">{sub}</span>
    </a>
  );
}

type Group = { key: string; name: string; items: Work[]; hours: number; planned: number };

/** A day's deadlines grouped by type of work, biggest group first. */
function groupByType(list: Work[]): Group[] {
  const m = new Map<string, Group>();
  for (const w of list) {
    const k = w.kind === "task" ? "TASK" : w.serviceKey || w.title;
    const g = m.get(k) || { key: k, name: w.typeName, items: [], hours: 0, planned: 0 };
    g.items.push(w);
    g.hours += w.hours;
    if (w.planned && w.planned >= todayIso()) g.planned++;
    m.set(k, g);
  }
  return [...m.values()].sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name));
}

function TypeGroup({ group: g, today, onOpen }: { group: Group; today: string; onOpen: (w: Work) => void }) {
  const meta = (
    <span className="svc-meta">
      <span className="mono">{fmtHours(g.hours)}</span>
      <span className={`chip ${g.planned === g.items.length ? "blue" : g.planned ? "" : "amber"}`}>
        {g.planned === g.items.length ? "All planned" : `${g.planned} of ${g.items.length} planned`}
      </span>
    </span>
  );
  const rows = (
    <ul className="home-list">
      {g.items.map((w) => <WorkRow key={w.key} w={w} today={today} onOpen={() => onOpen(w)} show="planned" inGroup />)}
    </ul>
  );
  const title = <><span className="svc-dot" aria-hidden="true" /><span>{g.name}{g.items.length > 1 ? ` × ${g.items.length}` : ""}</span></>;
  if (g.items.length <= 2) {
    return <div className={`svc-group ${svcClass(g.key)}`}><div className="svc-head">{title}{meta}</div>{rows}</div>;
  }
  return (
    <details className={`svc-group ${svcClass(g.key)}`}>
      <summary>
        {title}
        <span className="svc-preview">{g.items.map((w) => w.client).filter(Boolean).join(", ")}</span>
        {meta}
      </summary>
      {rows}
    </details>
  );
}

function WorkRow({ w, today, onOpen, show, inGroup }: { w: Work; today: string; onOpen: () => void; show: "deadline" | "planned"; inGroup?: boolean }) {
  const st = jobState(w.kind === "task" ? taskAsJob(w.row as Task) : (w.row as Job), today);
  const plannedOk = w.planned && w.planned >= today;
  const sub = inGroup
    ? (w.kind === "task" ? w.title : w.periodEnd ? `Period to ${fmtDate(w.periodEnd, { year: false })}` : "")
    : (w.client ? w.title : w.kind === "task" ? "Task" : "");
  return (
    <li>
      <button type="button" onClick={onOpen}>
        {!inGroup && <span className={`svc-dot ${svcClass(w.serviceKey)}`} aria-hidden="true" style={{ alignSelf: "center" }} />}
        <span className="stack" style={{ gap: 1, minWidth: 0 }}>
          <strong className="ellipsis">{w.client || w.title}</strong>
          {sub && <span className="muted ellipsis">{sub}</span>}
        </span>
        <span className="row-wrap" style={{ gap: 6, justifyContent: "flex-end", flexWrap: "nowrap" }}>
          {w.urgent && <span className="chip red">Urgent</span>}
          {show === "deadline" && w.deadline && (
            <span className={`chip ${st.state === "overdue" ? "red" : st.state === "tight" ? "amber" : ""}`}>
              {st.state === "overdue" ? `${-st.days!}d late` : `Due ${fmtDate(w.deadline, { year: false })}`}
            </span>
          )}
          {show === "planned" && (plannedOk
            ? <span className="chip blue">Planned {fmtDate(w.planned, { weekday: true, year: false }).split(" ").slice(0, 2).join(" ")}</span>
            : <span className="chip amber">Not planned</span>)}
          <span className="mono muted" style={{ fontSize: 12, minWidth: 44, textAlign: "right" }}>{fmtHours(w.hours)}</span>
        </span>
      </button>
    </li>
  );
}

