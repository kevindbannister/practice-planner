// Planning history: what was planned on each day and what happened to it, week by week, and the log of every change with an Undo for each.
import { useMemo, useState } from "react";
import { fmtDate, fmtHours, todayIso } from "../lib/domain";
import { addDays, mondayOf } from "../lib/planning";
import { EVENT_LABEL, STATUS_LABEL, Session, historical, isActive, movedTo, undoable } from "../lib/planSessions";
import { useData } from "./data";
import { Icon, PlanTabs } from "./bits";
import { usePlanning } from "./usePlanning";

const TONE: Record<string, string> = { completed: "var(--green)", partial: "var(--amber, #b7791f)", not_completed: "var(--red)", rescheduled: "var(--amber, #b7791f)", cancelled: "var(--muted)", planned: "var(--blue, #1d4ed8)", in_progress: "var(--blue, #1d4ed8)" };

export function PlanningHistory() {
  const { data } = useData();
  const pl = usePlanning();
  const today = todayIso();
  const [week, setWeek] = useState(mondayOf(today));
  const [show, setShow] = useState<"all" | "moved" | "live">("all");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; bad?: boolean }>();
  const clientName = (x: Session) => data.clients.find((c) => c.Key === x.clientKey)?.Title || "";
  const days = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(week, i));
  const sessions = useMemo(() => historical(pl.sessions, week, addDays(week, 6)).filter((x) => (show === "moved" ? !!x.replacedByKey || !!x.originalKey : show === "live" ? isActive(x) : true)), [pl.sessions, week, show]);
  const batches = useMemo(() => {
    const by = new Map<string, typeof pl.events>();
    for (const e of pl.events) by.set(e.batchKey, [...(by.get(e.batchKey) || []), e]);
    return [...by].map(([batch, list]) => ({ batch, list, at: list[0].created, by: list[0].createdBy })).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40);
  }, [pl.events]);
  const undo = async (batch: string) => {
    setBusy(true); setNote(undefined);
    try { const r = await pl.undo(batch); setNote({ text: r.done ? (r.notes.length ? `Part of it was put back. ${r.notes.join(" ")}` : "Put back.") : [...r.problems, ...r.notes].join(" ") || "Nothing to undo.", bad: !r.done }); } catch { setNote({ text: "Couldn't undo that. Try again.", bad: true }); } finally { setBusy(false); }
  };
  const ago = (iso: string) => `${fmtDate(iso.slice(0, 10), { weekday: true, year: false })} ${new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
  const describe = (b: (typeof batches)[number]) => {
    const kinds = [...new Set(b.list.filter((e) => e.type !== "undo" || true).map((e) => EVENT_LABEL[e.type]))].join(", ");
    const titles = [...new Set(b.list.map((e) => pl.sessions.find((x) => x.key === e.sessionKey)?.title).filter(Boolean))];
    return `${kinds}: ${titles.slice(0, 3).join(", ")}${titles.length > 3 ? ` and ${titles.length - 3} more` : ""}`;
  };
  return (
    <main className="page stack" style={{ gap: 16 }}>
      <PlanTabs current="history" />
      {!pl.ready && <div className="alert">Planning sessions need two new lists. Open Settings › Set up the lists to create them.</div>}
      {note && <div className={`alert${note.bad ? " red" : ""}`} role={note.bad ? "alert" : "status"}><strong>{note.text}</strong></div>}
      <section className="card pad stack" aria-labelledby="ph-h">
        <div className="card-title-row">
          <h2 id="ph-h">What was planned</h2>
          <span className="row-wrap week-nav">
            <span className="week-label">{fmtDate(week, { year: false })} – {fmtDate(addDays(week, 6))}</span>
            <span className="week-arrows">
              <button type="button" className="iconbtn" aria-label="Previous week" onClick={() => setWeek(addDays(week, -7))}><Icon name="left" /></button>
              <button type="button" className="iconbtn" aria-label="Next week" onClick={() => setWeek(addDays(week, 7))}><Icon name="right" /></button>
            </span>
            <button type="button" className="btn small" onClick={() => setWeek(mondayOf(today))}>This week</button>
          </span>
        </div>
        <div className="row-wrap" role="group" aria-label="Show">
          {([["all", "Everything"], ["moved", "Moved work"], ["live", "Still to do"]] as const).map(([k, l]) => <button key={k} type="button" className={`btn small${show === k ? " primary" : ""}`} aria-pressed={show === k} onClick={() => setShow(k)}>{l}</button>)}
        </div>
        {days.map((d) => {
          const list = sessions.filter((x) => x.date === d);
          if (!list.length) return null;
          return (
            <div key={d} className="stack" style={{ gap: 4 }}>
              <h3 className="today-sub" style={{ margin: 0 }}>{fmtDate(d, { weekday: true, year: false })}{d === today ? " (today)" : ""}</h3>
              <ul className="today-list">
                {list.map((x) => {
                  const to = movedTo(x, pl.sessions);
                  return (
                    <li key={x.key} className="today-row" style={{ opacity: isActive(x) ? 1 : 0.85 }}>
                      <span className="stack" style={{ gap: 2, minWidth: 0, flex: 1 }}>
                        <strong className="ellipsis">{clientName(x) || x.title}{clientName(x) ? <span className="muted" style={{ fontWeight: 400 }}> · {x.title}</span> : null}</strong>
                        <span className="muted" style={{ fontSize: 13 }}>
                          {fmtHours(x.minutes / 60)} planned · {fmtHours(x.actualMinutes / 60) || "0h"} worked
                          {to ? ` · moved to ${fmtDate(to.date, { weekday: true, year: false })}` : ""}
                          {x.originalKey ? " · carried over from an earlier session" : ""}
                          {x.reason ? ` · ${x.reason}` : ""}
                        </span>
                      </span>
                      <span className="chip" style={{ borderColor: TONE[x.status], color: TONE[x.status] }}>{STATUS_LABEL[x.status]}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
        {!sessions.length && <p className="muted" style={{ margin: 0 }}>Nothing was planned this week{show === "all" ? "" : " that fits that filter"}.</p>}
      </section>
      <section className="card" aria-labelledby="ph-log">
        <div className="card-head"><h2 id="ph-log">Changes, newest first</h2><span className="muted" style={{ fontSize: 13 }}>nothing here is ever deleted; an undo is added as a new line</span></div>
        <ul className="today-list">
          {batches.map((b) => (
            <li key={b.batch} className="today-row">
              <span className="stack" style={{ gap: 2, minWidth: 0, flex: 1 }}>
                <strong className="ellipsis">{describe(b)}</strong>
                <span className="muted" style={{ fontSize: 13 }}>{ago(b.at)}{b.by ? ` · ${b.by}` : ""}{b.list.find((e) => e.reason)?.reason ? ` · ${b.list.find((e) => e.reason)!.reason}` : ""}</span>
              </span>
              {b.list[0].type === "undo" ? <span className="muted" style={{ fontSize: 13 }}>Reversal</span> : undoable(b.batch, pl.events) ? <button type="button" className="btn small" disabled={busy} onClick={() => void undo(b.batch)}>Undo</button> : <span className="muted" style={{ fontSize: 13 }}>Undone</span>}
            </li>
          ))}
          {!batches.length && <li className="muted" style={{ padding: "0 16px 16px" }}>No planning changes yet.</li>}
        </ul>
      </section>
    </main>
  );
}
