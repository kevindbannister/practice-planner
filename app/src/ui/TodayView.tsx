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
import { TimeToLog } from "./TimeSpent";
import { ProjectsToLookAt } from "./ProjectsView";

const greeting = (h: number) => (h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening");

export function TodayView() {
  const { data, settings, update, saveSetting, user } = useData();
  const idx = useIndex();
  const { open } = useEditor();
  const cal = useCalendar();
  const ch = useCompaniesHouse();
  const today = todayIso();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [note, setNote] = useState<string>();

  const work = useMemo((): Work[] => {
    const name = (k?: string) => (k && idx.clientByKey.get(k)?.Title) || "";
    const imp = (k?: string) => (k && idx.clientByKey.get(k) ? importanceOf(idx.clientByKey.get(k)!) : "normal");
    const held = (r: Record<string, unknown>) => { const h = isOnHold(r as { Status?: string }); return { held: h, chaseOn: h ? (r.HoldUntil as string) || undefined : undefined, heldLabel: h ? holdLabel(r as { Status?: string }) : undefined }; };
    return [
      ...idx.openJobs.map((j: Job): Work => ({
        key: j.Key, kind: "job", title: j.Title, client: name(j.ClientKey) || (j.ClientName as string) || "",
        hours: planHours(j, data.services), deadline: j.Deadline, planned: j.PlannedDate, urgent: j.Priority === "urgent",
        importance: imp(j.ClientKey), business: false, ...held(j),
        blocked: waitingForClient(j, idx.stagesByService.get(j.ServiceKey || "") || []) || (!inFinalise(j) && waitingForRecords(j, data.services, data.stageTemplates)),
      })),
      ...idx.openTasks.map((t: Task): Work => {
        const proj = isBusinessTask(t) ? data.projects.find((p) => p.Key === t.ProjectKey) : undefined;
        return {
          key: t.Key, kind: "task", title: t.Title, client: proj ? "" : name(t.ClientKey), hours: t.EstimateHours || 1,
          deadline: t.DueDate, planned: t.PlannedDate, urgent: false, importance: imp(t.ClientKey), business: isBusinessTask(t),
          blocked: false, projectTitle: proj ? String(proj.Title) : isBusinessTask(t) ? "a business project" : undefined, ...held(t),
        };
      }),
    ];
  }, [idx, data.services, data.projects, data.stageTemplates]);

  const dh = dayHours(today, settings);
  const capacity = (d: string, asType?: string) => {
    if (weekday(d) > 5) return 0;
    const s = asType ? { ...settings, overrides: { ...settings.overrides, [d]: asType } } : settings;
    return cal.capacityFor(d, dayHours(d, s).client);
  };
  const t = buildToday({
    today, work,
    day: { client: weekday(today) <= 5 ? capacity(today) : 0, business: dh.business, typeName: dh.type.name },
    capacity,
    dayType: (d) => { const ty = typeOn(d, settings); return { key: ty.key, name: ty.name, business: dayHours(d, settings).business }; },
  });
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
  const makeClientDay = (dates: string[]) => run(async () => {
    const next = { ...settings.overrides };
    for (const d of dates) if (usualTypeKey(weekday(d), settings) === "client") delete next[d]; else next[d] = "client";
    await saveSetting("dayOverrides", next);
  }, `${dates.length === 1 ? fmtDate(dates[0], { weekday: true, year: false }) : "Those days"} now ${dates.length === 1 ? "a client day" : "client days"}. Business work planned on ${dates.length === 1 ? "it" : "them"} stays where it is; move it from the Week view.`);

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

      {t.conflicts.map((c) => (
        <section key={c.deadline} className="card pad stack today-conflict" aria-label={`Deadline ${fmtDate(c.deadline)} won't fit`}>
          <h3 className="with-icon" style={{ margin: 0 }}><span className="h-icon hue-red" aria-hidden="true"><Icon name="alert" size={15} /></span>Work due {fmtDate(c.deadline, { weekday: true, year: false })} won't fit</h3>
          <p style={{ margin: 0, fontSize: 14 }}>{c.text}</p>
          <span className="muted" style={{ fontSize: 12 }}>{c.due.join(" · ")}</span>
          {c.days.map((d) => (
            <div key={d.date} className="row-wrap" style={{ gap: 8, fontSize: 13 }}>
              <span><strong>{fmtDate(d.date, { weekday: true, year: false })}</strong> is a {d.typeName.toLowerCase()} (+{fmtHours(d.hours)} for clients)
                {d.businessWork.length ? `. Business work planned: ${d.businessWork.join(", ")}` : ""}</span>
            </div>
          ))}
          {c.days.length > 0 && (
            <div className="row-wrap">
              <button type="button" className="btn small primary" disabled={busy} onClick={() => makeClientDay(c.days.map((d) => d.date))}>
                Yes, make {c.days.length === 1 ? "it" : "them"} client {c.days.length === 1 ? "day" : "days"}
              </button>
              <span className="muted" style={{ fontSize: 12 }}>Nothing changes unless you press this.</span>
            </div>
          )}
        </section>
      ))}

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
