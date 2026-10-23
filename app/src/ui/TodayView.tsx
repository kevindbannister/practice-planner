// Today: what you're doing today, and why. Built by plain rules (lib/today.ts), with a reason on
// every line. Nothing changes until you press a button.
import { useMemo, useState } from "react";
import { Job, Task, fmtDate, fmtHours, holdLabel, isOnHold, todayIso } from "../lib/domain";
import { addDays, weekday } from "../lib/planning";
import { dayHours, typeOn, usualTypeKey } from "../lib/dayTypes";
import { Line, Work, buildToday, nextClientDay } from "../lib/today";
import { isBusinessTask } from "../lib/projects";
import { waitingForRecords } from "../lib/chase";
import { inFinalise, planHours, waitingForClient } from "../lib/waiting";
import { importanceOf } from "../lib/domain";
import { Row } from "../lib/schema";
import { Icon, PlanTabs } from "./bits";
import { useData, useIndex } from "./data";
import { useEditor } from "./Editors";
import { useCalendar } from "./Calendar";
import { useCompaniesHouse } from "./CompaniesHouse";
import { useTodayModel } from "./useTodayModel";
import { ConflictCard, useMakeClientDay } from "./Conflicts";
import { TimeToLog } from "./TimeSpent";
import { ProjectsToLookAt } from "./ProjectsView";

const greeting = (h: number) => (h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening");

export function TodayView() {
  const { data, settings, update, saveSetting, user } = useData();
  const idx = useIndex();
  const { open } = useEditor();
  const cal = useCalendar();
  const ch = useCompaniesHouse();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [note, setNote] = useState<string>();

  const { today, work, dh, capacity, input } = useTodayModel();
  const t = buildToday(input);
  const cap = weekday(today) <= 5 ? capacity(today) : 0;
  const meetings = cal.eventsOn(today).filter((e) => !e.allDay).sort((a, b) => a.start.getTime() - b.start.getTime());
  const hhmm = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const unfinished = [...t.lines].filter((l) => l.planned === today || (l.planned && l.planned < today));
  const nextDay = nextClientDay(today, (d) => capacity(d));

  const run = async (work: () => Promise<void>, message?: string) => {
    setBusy(true); setError(undefined); setNote(undefined);
    try { await work(); if (message) setNote(message); } catch { setError("Couldn't save that. Nothing was changed; try again."); } finally { setBusy(false); }
  };
  const openLine = (l: Line) => open(l.kind === "job" ? { kind: "job", key: l.key } : { kind: "task", key: l.key });
  const rowOf = (l: Line) => (l.kind === "job" ? data.jobs : data.tasks).find((r) => r.Key === l.key)!;
  const list = (l: Line) => (l.kind === "job" ? "Jobs" : "Tasks");
  const addToToday = (l: Line) => run(() => update(list(l), rowOf(l), { PlannedDate: today }), `${l.client || l.title} added to today.`);
  const rollForward = () => run(async () => {
    if (!nextDay) return;
    for (const l of unfinished) await update(list(l), rowOf(l), { PlannedDate: nextDay, DayOrder: "", StartTime: "" });
  }, nextDay ? `${unfinished.length} moved to ${fmtDate(nextDay, { weekday: true, year: false })}.` : undefined);
  const mk = useMakeClientDay();

  const row = (l: Line, action?: { label: string; on: () => void }) => (
    <li key={l.key} className="today-row">
      <button type="button" className="today-main" onClick={() => openLine(l)}>
        <span className={`today-dot ${l.level}`} aria-hidden="true" />
        <span className="stack" style={{ gap: 2, minWidth: 0 }}>
          <strong className="ellipsis">{l.client || l.projectTitle || l.title}{l.client || l.projectTitle ? <span className="muted" style={{ fontWeight: 400 }}> · {l.title}</span> : null}</strong>
          <span className="muted" style={{ fontSize: 12 }}>{l.reasons.join(" · ")}</span>
        </span>
        <span className="mono muted" style={{ fontSize: 12 }}>{fmtHours(l.hours)}</span>
      </button>
      {action && <button type="button" className="btn small" disabled={busy} onClick={action.on}>{action.label}</button>}
    </li>
  );
  const first = user && !user.includes("@") ? user.split(" ")[0] : "";

  return (
    <main className="page stack" style={{ gap: 16 }}>
      <PlanTabs current="today" />
      <section className="card pad stack" aria-labelledby="td-h">
        <div className="card-title-row">
          <h2 id="td-h">{greeting(new Date().getHours())}{first ? `, ${first}` : ""}</h2>
          <span className="chip" style={{ borderColor: dh.type.colour, color: dh.type.colour }}>{fmtDate(today, { weekday: true, year: false })} · {dh.type.name}</span>
        </div>
        <p style={{ margin: 0, fontSize: 15 }}>{t.headline}</p>
        {cap > 0 && (
          <div className="meter" style={{ margin: "4px 0" }} role="img" aria-label={`${fmtHours(t.clientUsed) || "0h"} planned of ${fmtHours(cap)} available`}>
            <span className={t.clientUsed > cap ? "over" : ""} style={{ width: `${Math.min(100, (t.clientUsed / cap) * 100)}%` }} />
          </div>
        )}
        <span className="muted" style={{ fontSize: 13 }}>
          {cap > 0 ? `${fmtHours(t.clientUsed) || "0h"} planned of ${fmtHours(cap)} for clients` : ""}
          {cal.meetingsOn(today) ? ` · meetings ${fmtHours(cal.meetingsOn(today))}` : ""}
          {dh.business ? ` · ${fmtHours(t.businessUsed) || "0h"} of ${fmtHours(dh.business)} for the business` : ""}
        </span>
        {note && <div className="alert" role="status" style={{ borderColor: "var(--green)" }}><strong>{note}</strong></div>}
        {error && <div className="alert red" role="alert"><strong>{error}</strong></div>}
      </section>

      {t.conflicts.map((c) => <ConflictCard key={c.deadline} c={c} busy={busy || mk.busy} onMake={(d) => void mk.make(d)} />)}
      {mk.note && <div className="alert" role="status" style={{ borderColor: "var(--green)" }}><strong>{mk.note}</strong></div>}
      {mk.error && <div className="alert red" role="alert"><strong>{mk.error}</strong></div>}

      {meetings.length > 0 && (
        <section className="card" aria-labelledby="td-meet">
          <div className="card-head"><h2 id="td-meet">Fixed today</h2><span className="muted" style={{ fontSize: 13 }}>from your calendar</span></div>
          <ul className="home-list">
            {meetings.map((e) => (
              <li key={e.id}><span style={{ display: "flex", gap: 12, padding: "6px 16px", fontSize: 14 }}>
                <span className="mono muted">{hhmm(e.start)}–{hhmm(e.end)}</span><span>{e.subject || "Busy"}</span></span></li>
            ))}
          </ul>
        </section>
      )}

      {t.chase.length > 0 && (
        <section className="card" aria-labelledby="td-chase">
          <div className="card-head"><h2 id="td-chase">Time to chase</h2><span className="muted" style={{ fontSize: 13 }}>{t.chase.length}</span></div>
          <ul className="today-list">{t.chase.map((l) => row(l))}</ul>
        </section>
      )}

      <section className="card" aria-labelledby="td-plan">
        <div className="card-head">
          <h2 id="td-plan">{cap > 0 || t.lines.length ? "Your day" : "Nothing for clients today"}</h2>
          {unfinished.length > 0 && nextDay && (
            <button type="button" className="btn small" disabled={busy} onClick={rollForward} title="End of day: moves what you didn't finish to the next client day">
              Roll unfinished to {fmtDate(nextDay, { weekday: true, year: false }).split(" ")[0]}
            </button>
          )}
        </div>
        {t.lines.length ? <ul className="today-list">{t.lines.map((l) => row(l))}</ul> : <p className="muted" style={{ margin: 0, padding: "0 16px 16px" }}>Nothing is planned for today.</p>}
        {t.suggested.length > 0 && (
          <>
            <h3 className="today-sub">Suggested to fill the day</h3>
            <ul className="today-list">{t.suggested.map((l) => row(l, { label: "Add to today", on: () => void addToToday(l) }))}</ul>
          </>
        )}
      </section>

      {t.business.length > 0 && (
        <section className="card" aria-labelledby="td-biz">
          <div className="card-head"><h2 id="td-biz">For the business</h2><span className="muted" style={{ fontSize: 13 }}>{fmtHours(t.businessUsed)} of {fmtHours(dh.business) || "0h"}</span></div>
          <ul className="today-list">{t.business.map((l) => row(l, l.planned === today ? undefined : { label: "Add to today", on: () => void addToToday(l) }))}</ul>
        </section>
      )}

      <TimeToLog />
      <ProjectsToLookAt />
      {ch.openFlags.length > 0 && (
        <a className="card pad" href="#/settings/companies-house" style={{ textDecoration: "none", color: "inherit" }}>
          <strong>{ch.openFlags.length} check{ch.openFlags.length === 1 ? "" : "s"} to review</strong>
          <span className="muted"> · deadlines, Companies House and compliance. Apply or ignore each one.</span>
        </a>
      )}
    </main>
  );
}
