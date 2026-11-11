// Timesheets: the time entries (the same ones the job timers make) by week or by day. Type hours into a day, start a timer, or log time against a
// planned session. Nothing here is a second set of time: a timer on a job and the timesheet show the same record.
import { useMemo, useState } from "react";
import { fmtDate, fmtHours, todayIso } from "../lib/domain";
import { mondayOf, newKey } from "../lib/planning";
import { runningTimer } from "../lib/jobTime";
import { isActive } from "../lib/planSessions";
import { parseDuration } from "../lib/timeSpent";
import { Activity, BILLABLE_LABEL, Billable, Entry, activitiesFrom, actualHours, addDay, billableOf, dayEntries, entryMinutes, forgotten, legacyEntries, londonIso, londonTime, manualEntry, parseClock, readEntry, rowKey, setCell, stopAt, timerEntry, totalsByType, unaccounted, weekGrid } from "../lib/timesheet";
import { readSetting, useData } from "./data";
import { Icon, PlanTabs } from "./bits";
import { usePlanning } from "./usePlanning";
import { Denied, approvalOn, can, teamFrom } from "../lib/permissions";
import { readTask } from "../lib/work/model";
import { timeRefusal } from "../lib/work/planning";
import { readRec, timeEventRow } from "../lib/timeBilling";
import { submit, APPROVAL_LABEL } from "../lib/timeApproval";
import { useTodayModel } from "./useTodayModel";

const mins = (m: number) => (m ? fmtHours(m / 60) : "");
type Env = { data: ReturnType<typeof useData>["data"]; activities: Activity[]; busy: boolean; setErr: (m: string) => void; save: (k: string, p: Record<string, string | number>) => Promise<void>; del: (k: string) => Promise<void>; addEntry: (i: Parameters<typeof manualEntry>[0]) => Promise<void>; startTimer: (p: Pick, sessionKey?: string) => Promise<void> };
type Pick = { clientKey: string; jobKey: string; taskKey: string; activityKey: string };

export function Timesheet() {
  const { data, user, create, createMany, update, updateMany, remove, saveSetting } = useData();
  const pl = usePlanning();
  const { capacity } = useTodayModel();
  const today = todayIso();
  const [view, setView] = useState<"week" | "day">("week");
  const [week, setWeek] = useState(mondayOf(today));
  const [day, setDay] = useState(today);
  const [extra, setExtra] = useState<Pick[]>([]);
  const [cell, setOpenCell] = useState<{ row: string; i: number }>();
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const now = useMemo(() => new Date(), [tick, data.jobTime]); // eslint-disable-line react-hooks/exhaustive-deps
  const ready = pl.ready || true;
  const activities = useMemo(() => activitiesFrom(readSetting<unknown>(data.settings, "timesheet.activities")), [data.settings]);
  const entries = useMemo(() => data.jobTime.map(readEntry), [data.jobTime]);
  const run = runningTimer(entries) as Entry | undefined;
  const client = (k: string) => data.clients.find((c) => c.Key === k)?.Title || "";
  const item = (p: { jobKey: string; taskKey: string }) => (p.jobKey ? data.jobs.find((j) => j.Key === p.jobKey)?.Title : p.taskKey ? data.tasks.find((t) => t.Key === p.taskKey)?.Title : "") || "";
  const actName = (k: string) => activities.find((a) => a.key === k)?.name || "";
  const label = (p: Pick) => [client(p.clientKey) || (p.jobKey || p.taskKey ? "" : "Internal"), item(p), actName(p.activityKey)].filter(Boolean).join(" · ") || "Time";

  const go = async (work: () => Promise<void>) => { setBusy(true); setErr(""); try { await work(); } catch (e) { setErr(e instanceof Denied ? e.message : "That didn't save. Try again."); } finally { setBusy(false); } };
  const rowOf = (k: string) => data.jobTime.find((r) => r.Key === k);
  const save = (k: string, patch: Record<string, string | number>) => go(async () => { const r = rowOf(k); if (r) await update("JobTime", r, patch); });
  const del = (k: string) => go(async () => { const r = rowOf(k); if (r && window.confirm("Delete this entry? The time comes off the job as well.")) await remove("JobTime", r); });
  const stopTimer = (e: Entry, at?: string) => go(async () => {
    const r = rowOf(e.key); if (!r) return;
    const s = stopAt(e, at || new Date().toISOString());
    if (s.error) setErr(s.error); else await update("JobTime", r, s.patch!);
  });
  const refuse = (taskKey: string, activityKey: string) => { const why = timeRefusal(data.tasks.find((x) => x.Key === taskKey) ? readTask(data.tasks.find((x) => x.Key === taskKey)!) : undefined, activityKey); if (why) setErr(why); return why; };
  const startTimer = (p: Pick, sessionKey = "") => go(async () => {
    if (refuse(p.taskKey, p.activityKey)) return;
    if (run) { const r = rowOf(run.key); const s = stopAt(run, new Date().toISOString()); if (r && s.patch) await update("JobTime", r, s.patch); } // one timer at a time
    await create("JobTime", timerEntry({ ...p, sessionKey }, user || "", newKey, new Date()));
  });
  const addEntry = (i: Parameters<typeof manualEntry>[0]) => go(async () => {
    if (refuse(i.taskKey || "", i.activityKey || "")) return;
    const m = manualEntry(i, user || "", newKey, new Date());
    if (m.error) { setErr(m.error); return; }
    await create("JobTime", m.row!);
  });

  const team = useMemo(() => teamFrom(data.settings), [data.settings]);
  const approval = { on: approvalOn(data.settings) };
  const recs = useMemo(() => data.jobTime.map((r) => readRec(r, readEntry(r))), [data.jobTime]);
  const mineWeek = recs.filter((e) => e.by.toLowerCase() === (user || "").toLowerCase() && e.workDate >= week && e.workDate <= addDay(week, 6) && e.ended);
  function ApprovalStrip() {
    const count = (s: string) => mineWeek.filter((e) => e.approval === s).length;
    const draft = mineWeek.filter((e) => e.approval === "" || e.approval === "returned");
    const returned = mineWeek.filter((e) => e.approval === "returned");
    const send = () => go(async () => {
      const ch = submit(draft, { user: user || "", now: new Date(), newKey });
      const rows = ch.patches.map((p) => ({ row: data.jobTime.find((r) => r.Key === p.key)!, patch: p.patch }));
      await updateMany("JobTime", rows);
      await createMany("TimeEvents", ch.events.map((e) => timeEventRow(e)));
    });
    return (
      <section className="card pad stack" aria-label="Approval" style={{ gap: 6 }}>
        <div className="row-wrap" style={{ justifyContent: "space-between" }}>
          <span><strong>This week's approval:</strong> {mineWeek.length === 0 ? "no time recorded" : ["", "submitted", "approved", "returned"].filter((s) => count(s)).map((s) => `${count(s)} ${APPROVAL_LABEL[s].toLowerCase()}`).join(", ")}</span>
          {draft.length > 0 && <button type="button" className="btn small primary" disabled={busy} onClick={() => void send()}>Submit week for approval</button>}
        </div>
        {returned.map((e) => <p key={e.key} className="muted" style={{ margin: 0, fontSize: 13 }}>Returned: {e.reviewNote || "no note"} ({fmtDate(e.workDate, { year: false })})</p>)}
        {!can(team, user || "", "time.approve") && <p className="muted" style={{ margin: 0, fontSize: 13 }}>Approved time is locked. Ask a reviewer to reopen it if it needs changing.</p>}
      </section>
    );
  }

  const env: Env = { data, activities, busy, setErr, save, del, addEntry, startTimer };
  const cap = (d: string) => capacity(d);
  const weekEnd = addDay(week, 6);
  const totals = totalsByType(entries, activities, week, weekEnd, now);
  const legacy = useMemo(() => legacyEntries([
    ...data.jobs.filter((j) => Number(j.ActualHours) > 0).map((j) => ({ kind: "job" as const, key: String(j.Key), clientKey: String(j.ClientKey || ""), title: String(j.Title), actual: Number(j.ActualHours), doneOn: String(j.CompletedDate || "") })),
    ...data.tasks.filter((t) => Number(t.ActualHours) > 0).map((t) => ({ kind: "task" as const, key: String(t.Key), clientKey: String(t.ClientKey || ""), title: String(t.Title), actual: Number(t.ActualHours), doneOn: String(t.CompletedDate || "") })),
  ], entries, user || "", new Date()), [data.jobs, data.tasks, entries, user]);

  return (
    <main className="page stack" style={{ gap: 16 }}>
      <PlanTabs current="timesheet" />
      {err && <div className="alert red" role="alert"><strong>{err}</strong></div>}
      {!ready && <div className="alert">Time entries need the Job Time list: Settings › Set up the lists.</div>}

      {run && (
        <section className="card pad row-wrap" style={{ justifyContent: "space-between" }} aria-live="polite">
          <span><strong>Timer running</strong> · {label({ clientKey: run.clientKey, jobKey: run.jobKey, taskKey: run.taskKey, activityKey: run.activityKey })} · since {londonTime(run.started)} ({fmtHours(entryMinutes(run, now) / 60) || "under a minute"})</span>
          <span className="row-wrap">
            <button type="button" className="btn small" disabled={busy} onClick={() => void stopTimer(run)}>Stop</button>
            {forgotten(run, now) && <ForgottenFix e={run} onStop={(t) => void stopTimer(run, t)} />}
            <button type="button" className="iconbtn" aria-label="Refresh the clock" onClick={() => setTick((t) => t + 1)}><Icon name="refresh" /></button>
          </span>
        </section>
      )}

      {approval.on && <ApprovalStrip />}

      <section className="card pad stack" aria-labelledby="ts-h">
        <div className="card-title-row">
          <h2 id="ts-h">Timesheet</h2>
          <span className="row-wrap">
            <span className="row-wrap" role="group" aria-label="View">
              {(["week", "day"] as const).map((v) => <button key={v} type="button" className={`btn small${view === v ? " primary" : ""}`} aria-pressed={view === v} onClick={() => setView(v)}>{v === "week" ? "Week" : "Day"}</button>)}
            </span>
            <span className="week-label">{view === "week" ? `${fmtDate(week, { year: false })} – ${fmtDate(weekEnd)}` : fmtDate(day, { weekday: true })}</span>
            <span className="week-arrows">
              <button type="button" className="iconbtn" aria-label={view === "week" ? "Previous week" : "Previous day"} onClick={() => (view === "week" ? setWeek(addDay(week, -7)) : setDay(addDay(day, -1)))}><Icon name="left" /></button>
              <button type="button" className="iconbtn" aria-label={view === "week" ? "Next week" : "Next day"} onClick={() => (view === "week" ? setWeek(addDay(week, 7)) : setDay(addDay(day, 1)))}><Icon name="right" /></button>
            </span>
            <button type="button" className="btn small" onClick={() => { setWeek(mondayOf(today)); setDay(today); }}>Today</button>
          </span>
        </div>
        {view === "week" ? (
          <>
            {WeekGrid()}
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              Recorded {fmtHours(totals.all / 60) || "0h"}: billable {fmtHours(totals.billable / 60) || "0h"}, non-billable client {fmtHours(totals.nonbillable / 60) || "0h"}, internal {fmtHours(totals.internal / 60) || "0h"}.
              Capacity this week {fmtHours([0, 1, 2, 3, 4, 5, 6].reduce((t, i) => t + cap(addDay(week, i)), 0))}. Hours not recorded are not counted as lost: recording every minute isn't expected.
            </p>
          </>
        ) : DayView()}
      </section>

      {legacy.rows.length > 0 && (
        <div className="alert row-wrap" role="status" style={{ justifyContent: "space-between" }}>
          <span>{legacy.rows.length} finished {legacy.rows.length === 1 ? "job or task has" : "jobs or tasks have"} hours typed in with no time entries behind them. Bring them in so a job's hours come from one place; its total stays the same.</span>
          <button type="button" className="btn small" disabled={busy} onClick={() => void go(async () => { await createMany("JobTime", legacy.rows); })}>Bring them in</button>
        </div>
      )}
      <ActivityCodes activities={activities} onSave={(a) => void saveSetting("timesheet.activities", a)} />
    </main>
  );

  // ---------------------------------------------------------------- week

  function WeekGrid() {
    const g = weekGrid(entries, week, now, extra);
    const open = cell ? g.rows.find((r) => r.key === cell.row) : undefined;
    return (
      <div className="stack" style={{ gap: 8 }}>
        <div style={{ overflowX: "auto" }}>
          <table className="table" style={{ minWidth: 720 }}>
            <thead><tr><th scope="col">Client · job or task · activity</th>{g.days.map((d) => <th key={d} scope="col" style={{ textAlign: "center", ...(d === today ? { color: "var(--accent, #0b5cab)" } : {}) }}>{fmtDate(d, { weekday: true, year: false }).split(" ").slice(0, 2).join(" ")}</th>)}<th scope="col" style={{ textAlign: "right" }}>Week</th></tr></thead>
            <tbody>
              {g.rows.map((r) => (
                <tr key={r.key}>
                  <th scope="row" style={{ textAlign: "left", fontWeight: 500 }}>{label(r)}{r.jobKey && actualHours(entries, "job", r.jobKey) ? <span className="muted" style={{ fontSize: 11 }}> · {fmtHours(actualHours(entries, "job", r.jobKey))} on the job</span> : null}</th>
                  {r.cells.map((c, i) => {
                    const many = c.entries.length > 1 || c.entries.some((e) => !e.ended);
                    return (
                      <td key={i} style={{ textAlign: "center", padding: 2 }}>
                        {many ? <button type="button" className="btn small" aria-label={`${c.entries.length} entries on ${g.days[i]}, open them`} onClick={() => setOpenCell({ row: r.key, i })}>{mins(c.minutes)} ({c.entries.length})</button>
                          : <HourBox key={`${r.key}-${i}-${c.minutes}`} value={c.minutes} label={`${label(r)}, ${g.days[i]}`} onCommit={(m) => void go(async () => {
                            const s = setCell(c, m, { date: g.days[i], clientKey: r.clientKey, jobKey: r.jobKey, taskKey: r.taskKey, activityKey: r.activityKey }, user || "", newKey, new Date());
                            if (s.error) setErr(s.error); else if (s.create) await create("JobTime", s.create); else if (s.patch) await update("JobTime", rowOf(s.patch.key)!, s.patch.patch); else if (s.remove) await remove("JobTime", rowOf(s.remove)!);
                          })} />}
                        {c.entries.length === 1 && <button type="button" className="iconbtn" aria-label="Open entry" title="Open entry" onClick={() => setOpenCell({ row: r.key, i })} style={{ marginLeft: 2 }}><Icon name="edit" size={12} /></button>}
                      </td>
                    );
                  })}
                  <td style={{ textAlign: "right", fontWeight: 600 }}>{mins(r.total)}</td>
                </tr>
              ))}
              {!g.rows.length && <tr><td colSpan={9} className="muted">No time recorded this week. Add a row, start a timer, or use the Day view.</td></tr>}
            </tbody>
            <tfoot>
              <tr><th scope="row" style={{ textAlign: "left" }}>Total</th>{g.dayTotals.map((m, i) => <td key={i} style={{ textAlign: "center", fontWeight: 600 }}>{mins(m)}</td>)}<td style={{ textAlign: "right", fontWeight: 700 }}>{mins(g.total)}</td></tr>
              <tr><th scope="row" style={{ textAlign: "left", fontWeight: 400 }} className="muted">Capacity</th>{g.days.map((d) => <td key={d} className="muted" style={{ textAlign: "center", fontSize: 12 }}>{cap(d) ? fmtHours(cap(d)) : "–"}</td>)}<td /></tr>
              <tr><th scope="row" style={{ textAlign: "left", fontWeight: 400 }} className="muted">Not yet recorded</th>{g.days.map((d, i) => <td key={d} className="muted" style={{ textAlign: "center", fontSize: 12 }}>{d <= today && cap(d) ? mins(unaccounted(g.dayTotals[i], cap(d))) || "–" : ""}</td>)}<td /></tr>
            </tfoot>
          </table>
        </div>
        <AddRow env={env} onAdd={(p) => setExtra((x) => (x.some((y) => rowKey(y) === rowKey(p)) ? x : [...x, p]))} />
        {open && cell && CellEntries({ row: open, i: cell.i, day: g.days[cell.i], onClose: () => setOpenCell(undefined) })}
      </div>
    );
  }

  function CellEntries({ row, i, day: d, onClose }: { row: ReturnType<typeof weekGrid>["rows"][number]; i: number; day: string; onClose: () => void }) {
    const c = row.cells[i];
    return (
      <div className="card pad stack" style={{ gap: 8 }} role="region" aria-label={`Entries for ${label(row)} on ${d}`}>
        <div className="row-wrap" style={{ justifyContent: "space-between" }}><strong>{label(row)} · {fmtDate(d, { weekday: true, year: false })}</strong><button type="button" className="btn small" onClick={onClose}>Close</button></div>
        {c.entries.map((e) => <EntryLine key={e.key} e={e} env={env} />)}
        <NewLine pick={row} date={d} env={env} />
      </div>
    );
  }

  // ---------------------------------------------------------------- day

  function DayView() {
    const list = dayEntries(entries, day);
    const total = list.reduce((t, e) => t + entryMinutes(e, now), 0);
    const planned = pl.sessions.filter((x) => isActive(x) && x.date === day);
    return (
      <div className="stack" style={{ gap: 12 }}>
        {planned.length > 0 && (
          <div className="stack" style={{ gap: 4 }}>
            <h3 className="today-sub" style={{ margin: 0 }}>Planned for the day</h3>
            <ul className="today-list">
              {planned.map((x) => {
                const done = entries.filter((e) => e.sessionKey === x.key).reduce((t, e) => t + entryMinutes(e, now), 0);
                return (
                  <li key={x.key} className="today-row">
                    <span className="stack" style={{ gap: 2, flex: 1 }}><strong>{client(x.clientKey) || x.title}{client(x.clientKey) ? <span className="muted" style={{ fontWeight: 400 }}> · {x.title}</span> : null}</strong><span className="muted" style={{ fontSize: 12 }}>{fmtHours(x.minutes / 60)} planned · {fmtHours(done / 60) || "0h"} recorded · {done >= x.minutes ? `${fmtHours((done - x.minutes) / 60) || "0h"} over` : `${fmtHours((x.minutes - done) / 60)} to go`}</span></span>
                    <button type="button" className="btn small" disabled={busy} onClick={() => void startTimer({ clientKey: x.clientKey, jobKey: x.kind === "job" ? x.itemKey : "", taskKey: x.kind === "task" ? x.itemKey : "", activityKey: "" }, x.key)}>Start timer</button>
                    <button type="button" className="btn small" disabled={busy} onClick={() => void addEntry({ date: day, minutes: Math.max(15, x.minutes - done), clientKey: x.clientKey, jobKey: x.kind === "job" ? x.itemKey : "", taskKey: x.kind === "task" ? x.itemKey : "", sessionKey: x.key })}>Log the {fmtHours(Math.max(15, x.minutes - done) / 60)}</button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <div style={{ overflowX: "auto" }}>
          <table className="table" style={{ minWidth: 700 }}>
            <thead><tr><th scope="col">Start</th><th scope="col">End</th><th scope="col">Time</th><th scope="col">Client · job or task</th><th scope="col">Activity</th><th scope="col">Type</th><th scope="col">Note</th><th scope="col">From</th></tr></thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.key}>
                  <td>{e.started ? londonTime(e.started) : "–"}</td><td>{e.ended && e.started ? londonTime(e.ended) : e.started ? "running" : "–"}</td><td>{fmtHours(entryMinutes(e, now) / 60) || "0m"}</td>
                  <td>{[client(e.clientKey), item(e)].filter(Boolean).join(" · ") || "Internal"}</td><td>{actName(e.activityKey) || "–"}</td><td>{BILLABLE_LABEL[billableOf(e, activities)].replace(" client time", "").replace(" time", "")}</td><td>{e.note}</td>
                  <td>{e.sessionKey ? "Planned session" : e.kind === "timer" ? "Timer" : e.key.startsWith("JT-legacy") ? "Typed on finishing" : "Typed in"}</td>
                </tr>
              ))}
              {!list.length && <tr><td colSpan={8} className="muted">Nothing recorded for this day.</td></tr>}
            </tbody>
            <tfoot><tr><th scope="row" colSpan={2} style={{ textAlign: "left" }}>Total</th><td style={{ fontWeight: 700 }}>{fmtHours(total / 60) || "0h"}</td><td colSpan={5} className="muted">{cap(day) ? `Capacity ${fmtHours(cap(day))}${day <= today ? ` · ${fmtHours(unaccounted(total, cap(day)) / 60) || "none"} not yet recorded` : ""}` : "Not a client day"}</td></tr></tfoot>
          </table>
        </div>
        {list.map((e) => <details key={e.key}><summary className="muted" style={{ cursor: "pointer", fontSize: 13 }}>Edit: {londonTime(e.started) || ""} {fmtHours(entryMinutes(e, now) / 60)} {[client(e.clientKey), item(e)].filter(Boolean).join(" · ")}</summary><EntryLine e={e} env={env} /></details>)}
        <NewLine pick={{ clientKey: "", jobKey: "", taskKey: "", activityKey: "" }} date={day} withPick env={env} />
      </div>
    );
  }

  // ---------------------------------------------------------------- pieces



}

function HourBox({ value, label, onCommit }: { value: number; label: string; onCommit: (minutes: number) => void }) {
  const [t, setT] = useState(value ? String(Math.round((value / 60) * 100) / 100) : "");
  const commit = () => {
    const was = value ? String(Math.round((value / 60) * 100) / 100) : "";
    if (t.trim() === was) return;
    const h = t.trim() ? parseDuration(t) : 0;
    if (h === undefined) return;
    onCommit(Math.round(h * 60));
  };
  return <input aria-label={label} value={t} onChange={(e) => setT(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} inputMode="decimal" style={{ width: 58, textAlign: "center" }} />;
}

function ForgottenFix({ e, onStop }: { e: Entry; onStop: (iso: string) => void }) {
  const [t, setT] = useState("");
  return (
    <span className="row-wrap">
      <span className="muted">Left running? It started {fmtDate(e.workDate, { weekday: true, year: false })}. Stop it at</span>
      <input aria-label="Stop time" value={t} onChange={(x) => setT(x.target.value)} placeholder="17:30" style={{ width: 70 }} />
      <button type="button" className="btn small" onClick={() => { const c = parseClock(t); if (c) onStop(londonIso(e.workDate, c)); }}>Stop then</button>
    </span>
  );
}

function ActivityCodes({ activities, onSave }: { activities: Activity[]; onSave: (a: Activity[]) => void }) {
  const [list, setList] = useState(activities);
  const [name, setName] = useState("");
  const [cat, setCat] = useState<Billable>("billable");
  const set = (i: number, p: Partial<Activity>) => setList((l) => l.map((a, j) => (j === i ? { ...a, ...p } : a)));
  return (
    <details className="card pad">
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>Activity codes</summary>
      <p className="muted" style={{ fontSize: 13 }}>What kind of work a piece of time was. The type sets whether it is billable, non-billable client time or internal; anyone can still change it on an entry.</p>
      <ul className="today-list">
        {list.map((a, i) => (
          <li key={a.key} className="today-row row-wrap" style={{ gap: 8 }}>
            <input aria-label="Name" value={a.name} onChange={(e) => set(i, { name: e.target.value })} style={{ flex: 1, minWidth: 160 }} />
            <select aria-label="Type" value={a.category} onChange={(e) => set(i, { category: e.target.value as Billable })}>{(Object.keys(BILLABLE_LABEL) as Billable[]).map((b) => <option key={b} value={b}>{BILLABLE_LABEL[b]}</option>)}</select>
            <label><input type="checkbox" checked={a.active} onChange={(e) => set(i, { active: e.target.checked })} /> In use</label>
          </li>
        ))}
      </ul>
      <div className="row-wrap" style={{ gap: 8, alignItems: "end" }}>
        <label className="field">New activity<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <select aria-label="Type of new activity" value={cat} onChange={(e) => setCat(e.target.value as Billable)}>{(Object.keys(BILLABLE_LABEL) as Billable[]).map((b) => <option key={b} value={b}>{BILLABLE_LABEL[b]}</option>)}</select>
        <button type="button" className="btn small" onClick={() => { if (name.trim()) { setList((l) => [...l, { key: name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), name: name.trim(), category: cat, active: true }]); setName(""); } }}>Add</button>
        <button type="button" className="btn" onClick={() => onSave(list)}>Save activity codes</button>
      </div>
    </details>
  );
}

function EntryLine({ e, env }: { e: Entry; env: Env }) {
  const { activities, busy, setErr, save, del } = env;
  const [h, setH] = useState(String(e.hours));
  const [note, setNote] = useState(e.note);
  const [act, setAct] = useState(e.activityKey);
  const [bill, setBill] = useState<string>(e.billable);
  return (
    <div className="row-wrap" style={{ alignItems: "end", gap: 8 }}>
      <label className="field">Hours<input value={e.ended ? h : "running"} disabled={!e.ended} onChange={(x) => setH(x.target.value)} inputMode="decimal" style={{ width: 90 }} /></label>
      <label className="field">Activity<select value={act} onChange={(x) => setAct(x.target.value)}><option value="">(none)</option>{activities.filter((a) => a.active || a.key === e.activityKey).map((a) => <option key={a.key} value={a.key}>{a.name}</option>)}</select></label>
      <label className="field">Type<select value={bill} onChange={(x) => setBill(x.target.value)}><option value="">As the activity says</option>{(Object.keys(BILLABLE_LABEL) as Billable[]).map((b) => <option key={b} value={b}>{BILLABLE_LABEL[b]}</option>)}</select></label>
      <label className="field" style={{ flex: 1, minWidth: 160 }}>Note<input value={note} onChange={(x) => setNote(x.target.value)} /></label>
      <button type="button" className="btn small" disabled={busy} onClick={() => {
        const hrs = e.ended ? parseDuration(h) : undefined;
        if (e.ended && hrs === undefined) return setErr("Hours like 1.5, 1h30 or 90m.");
        void save(e.key, { ...(e.ended ? { Hours: hrs!, ...(e.started ? { Ended: new Date(Date.parse(e.started) + hrs! * 3600000).toISOString() } : {}) } : {}), Note: note, ActivityKey: act, BillableType: bill, Version: e.version + 1 });
      }}>Save</button>
      <button type="button" className="btn small" disabled={busy} onClick={() => void del(e.key)}>Delete</button>
    </div>
  );
}

function NewLine({ pick, date, withPick, env }: { pick: Pick; date: string; withPick?: boolean; env: Env }) {
  const { data, activities, busy, setErr, addEntry, startTimer } = env;
  const [p, setP] = useState<Pick>(pick);
  const [len, setLen] = useState("");
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [note, setNote] = useState("");
  const jobs = data.jobs.filter((j) => (!p.clientKey || j.ClientKey === p.clientKey) && j.Status !== "Complete").slice(0, 200);
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row-wrap" style={{ alignItems: "end", gap: 8 }}>
        {withPick && <>
          <label className="field">Client<select value={p.clientKey} onChange={(x) => setP({ ...p, clientKey: x.target.value, jobKey: "", taskKey: "" })}><option value="">Internal (no client)</option>{data.clients.slice().sort((x, y) => String(x.Title).localeCompare(String(y.Title))).map((c) => <option key={c.Key} value={c.Key}>{c.Title}</option>)}</select></label>
          <label className="field">Job<select value={p.jobKey} onChange={(x) => setP({ ...p, jobKey: x.target.value, taskKey: "" })}><option value="">(none)</option>{jobs.map((j) => <option key={j.Key} value={j.Key}>{j.Title}</option>)}</select></label>
          <label className="field">Activity<select value={p.activityKey} onChange={(x) => setP({ ...p, activityKey: x.target.value })}><option value="">(none)</option>{activities.filter((x) => x.active).map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}</select></label>
        </>}
        <label className="field">How long<input value={len} onChange={(x) => setLen(x.target.value)} placeholder="1.5, 1h30, 35m" inputMode="decimal" style={{ width: 120 }} /></label>
        <span className="muted" style={{ paddingBottom: 8 }}>or</span>
        <label className="field">Start<input value={a} onChange={(x) => setA(x.target.value)} placeholder="09:30" style={{ width: 80 }} /></label>
        <label className="field">End<input value={b} onChange={(x) => setB(x.target.value)} placeholder="11:00" style={{ width: 80 }} /></label>
        <label className="field" style={{ flex: 1, minWidth: 140 }}>Note<input value={note} onChange={(x) => setNote(x.target.value)} /></label>
        <button type="button" className="btn" disabled={busy} onClick={() => {
          const h = len.trim() ? parseDuration(len) : undefined;
          if (len.trim() && h === undefined) return setErr("How long: try 1.5, 1h30 or 35m.");
          if ((a || b) && (!parseClock(a) || !parseClock(b))) return setErr("Start and end like 09:30 and 11:00.");
          void addEntry({ date, ...(a || b ? { start: a, end: b } : { minutes: Math.round((h || 0) * 60) }), ...p, note }).then(() => { setLen(""); setA(""); setB(""); setNote(""); });
        }}>Add time</button>
        {withPick && <button type="button" className="btn" disabled={busy} onClick={() => void startTimer(p)}>Start timer</button>}
      </div>
    </div>
  );
}

function AddRow({ onAdd, env }: { onAdd: (p: Pick) => void; env: Env }) {
  const { data, activities } = env;
  const [p, setP] = useState<Pick>({ clientKey: "", jobKey: "", taskKey: "", activityKey: "" });
  const jobs = data.jobs.filter((j) => (!p.clientKey || j.ClientKey === p.clientKey) && j.Status !== "Complete").slice(0, 200);
  return (
    <div className="row-wrap" style={{ alignItems: "end", gap: 8 }}>
      <label className="field">Client<select value={p.clientKey} onChange={(x) => setP({ ...p, clientKey: x.target.value, jobKey: "" })}><option value="">Internal (no client)</option>{data.clients.slice().sort((x, y) => String(x.Title).localeCompare(String(y.Title))).map((c) => <option key={c.Key} value={c.Key}>{c.Title}</option>)}</select></label>
      <label className="field">Job<select value={p.jobKey} onChange={(x) => setP({ ...p, jobKey: x.target.value })}><option value="">(none)</option>{jobs.map((j) => <option key={j.Key} value={j.Key}>{j.Title}</option>)}</select></label>
      <label className="field">Activity<select value={p.activityKey} onChange={(x) => setP({ ...p, activityKey: x.target.value })}><option value="">(none)</option>{activities.filter((x) => x.active).map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}</select></label>
      <button type="button" className="btn" onClick={() => onAdd(p)}>Add row</button>
    </div>
  );
}

