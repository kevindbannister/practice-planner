// End of day review: what was planned for today (or earlier) and is still marked planned. Say how each went; nothing moves on its own.
// Moving work makes a new linked session and keeps the old one (lib/planSessions.ts). Replaces the old "roll unfinished to tomorrow" button.
import { useState } from "react";
import { fmtDate, fmtHours, todayIso } from "../lib/domain";
import { addDays, weekday } from "../lib/planning";
import { Session, conclude, reschedule, toReview } from "../lib/planSessions";
import { parseDuration } from "../lib/timeSpent";
import { readEntry, sessionMinutes } from "../lib/timesheet";
import { nextClientDay } from "../lib/today";
import { useData } from "./data";
import { usePlanning } from "./usePlanning";
import { useTodayModel } from "./useTodayModel";

type Way = "done" | "part" | "notdone" | "move" | "cancel";
const WAYS: [Way, string][] = [["done", "Done"], ["part", "Part done, move the rest"], ["move", "Move it"], ["notdone", "Not done, leave it"], ["cancel", "Not needed"]];

export function EndOfDay() {
  const { data } = useData();
  const pl = usePlanning();
  const { capacity } = useTodayModel();
  const today = todayIso();
  const next = nextClientDay(today, (d) => capacity(d)) || addDays(today, weekday(today) >= 5 ? 8 - weekday(today) : 1);
  const [open, setOpen] = useState<string>();
  const [way, setWay] = useState<Way>("done");
  const [hours, setHours] = useState("");
  const [left, setLeft] = useState("");
  const [to, setTo] = useState(next);
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; batch?: string; bad?: boolean }>();
  if (!pl.ready) return null;
  const list = toReview(pl.sessions, today);
  const recorded = (x: Session) => sessionMinutes(data.jobTime.map(readEntry), x.key, new Date());
  const clientName = (x: Session) => data.clients.find((c) => c.Key === x.clientKey)?.Title || "";

  const start = (x: Session) => { setOpen(x.key); setWay(x.date < today ? "move" : "done"); { const r = recorded(x) || x.actualMinutes; setHours(r ? String(Math.round((r / 60) * 100) / 100) : ""); } setLeft(""); setTo(next); setWhy(""); };
  const go = async (x: Session) => {
    const mins = hours.trim() ? Math.round((parseDuration(hours) || 0) * 60) : undefined;
    if (hours.trim() && mins === undefined) return setNote({ text: "Hours worked: try 1.5, 1h30 or 90m.", bad: true });
    const lm = left.trim() ? Math.round((parseDuration(left) || 0) * 60) : undefined;
    if (left.trim() && !lm) return setNote({ text: "Time left: try 1.5, 1h30 or 90m.", bad: true });
    const c = pl.ctx();
    const plan =
      way === "done" ? conclude(x, { outcome: "completed", actualMinutes: mins ?? x.minutes, note: why }, c)
      : way === "notdone" ? conclude(x, { outcome: mins ? "partial" : "not_completed", actualMinutes: mins, reason: why }, c)
      : way === "cancel" ? conclude(x, { outcome: "cancelled", reason: why }, c)
      : reschedule(x, { toDate: to, actualMinutes: way === "part" ? mins : 0, remainingMinutes: lm, reason: why }, c);
    if (way === "part" && !mins) return setNote({ text: "Say how long you worked on it, or choose Move it.", bad: true });
    setBusy(true); setNote(undefined);
    try {
      const r = await pl.apply(plan);
      setOpen(undefined);
      setNote(r.done ? { text: way === "done" ? `${x.title} recorded as done.` : way === "cancel" ? `${x.title} cancelled.` : way === "notdone" ? `${x.title} left as it is, and kept on record.` : `${x.title} moved to ${fmtDate(to, { weekday: true, year: false })}. Today's entry stays in your history.`, batch: r.batchKey } : { text: r.problems.join(" ") || "Nothing changed.", bad: true });
    } catch { setNote({ text: "Couldn't save all of that. Check the list and try again.", bad: true }); } finally { setBusy(false); }
  };
  const undo = async (batch: string) => {
    setBusy(true);
    try { const r = await pl.undo(batch); setNote({ text: r.done ? "Put back." : [...r.problems, ...r.notes].join(" ") || "Nothing to undo.", bad: !r.done }); } catch { setNote({ text: "Couldn't undo that. Open Planning history to see where it stands.", bad: true }); } finally { setBusy(false); }
  };

  if (!list.length && !note && !pl.legacy.rows.length) return null;
  return (
    <section className="card" aria-labelledby="td-eod">
      <div className="card-head"><h2 id="td-eod">End of day review</h2><span className="muted" style={{ fontSize: 13 }}>{list.length ? `${list.length} to review · ` : ""}<a href="#/plan/history">Planning history</a></span></div>
      {pl.legacy.rows.length > 0 && (
        <div className="alert row-wrap" role="status" style={{ justifyContent: "space-between", margin: "0 16px 8px" }}>
          <span>{pl.legacy.rows.length} planned {pl.legacy.rows.length === 1 ? "date has" : "dates have"} not been turned into sessions yet. Do it once and moving work keeps its history from then on.</span>
          <button type="button" className="btn small" disabled={busy} onClick={() => { setBusy(true); pl.bringIn().then((r) => setNote({ text: `${r.migrated} brought in (${fmtHours(r.minutes / 60)}).` })).catch(() => setNote({ text: "Couldn't bring them in. Try again.", bad: true })).finally(() => setBusy(false)); }}>Bring them in</button>
        </div>
      )}
      {note && (
        <div className={`alert row-wrap${note.bad ? " red" : ""}`} role={note.bad ? "alert" : "status"} style={{ justifyContent: "space-between", margin: "0 16px 8px", ...(note.bad ? {} : { borderColor: "var(--green)" }) }}>
          <strong>{note.text}</strong>
          {note.batch && <button type="button" className="btn small" disabled={busy} onClick={() => void undo(note.batch!)}>Undo</button>}
        </div>
      )}
      {!list.length && <p className="muted" style={{ margin: 0, padding: "0 16px 16px" }}>Nothing left to review. Work you move stays in your history.</p>}
      <ul className="today-list">
        {list.map((x) => (
          <li key={x.key} className="today-row" style={{ display: "block", padding: "8px 16px" }}>
            <div className="row-wrap" style={{ justifyContent: "space-between", gap: 8 }}>
              <span className="stack" style={{ gap: 2, minWidth: 0 }}>
                <strong className="ellipsis">{clientName(x) || x.title}{clientName(x) ? <span className="muted" style={{ fontWeight: 400 }}> · {x.title}</span> : null}</strong>
                <span className="muted" style={{ fontSize: 12 }}>{fmtHours(x.minutes / 60)} planned{recorded(x) ? ` · ${fmtHours(recorded(x) / 60)} recorded on the timesheet` : ""}{x.date < today ? ` for ${fmtDate(x.date, { weekday: true, year: false })}, still open` : ""}{x.originalKey ? " · moved from an earlier day" : ""}</span>
              </span>
              <button type="button" className="btn small" onClick={() => (open === x.key ? setOpen(undefined) : start(x))}>{open === x.key ? "Close" : "How did it go?"}</button>
            </div>
            {open === x.key && (
              <div className="stack" style={{ gap: 8, marginTop: 8 }}>
                <div className="row-wrap" role="radiogroup" aria-label="How it went">
                  {WAYS.map(([k, label]) => <label key={k} className="chip" style={{ cursor: "pointer", fontWeight: way === k ? 700 : 400 }}><input type="radio" name={`way-${x.key}`} checked={way === k} onChange={() => setWay(k)} /> {label}</label>)}
                </div>
                {(way === "done" || way === "part" || way === "notdone") && <label className="field">Time worked on it {way === "done" ? "(" + fmtHours(x.minutes / 60) + " if left empty)" : ""}<input value={hours} onChange={(e) => setHours(e.target.value)} placeholder="1.5, 1h30 or 90m" inputMode="decimal" /></label>}
                {(way === "move" || way === "part") && (
                  <div className="row-wrap">
                    <label className="field">Move to<input type="date" value={to} min={today} onChange={(e) => setTo(e.target.value)} /></label>
                    <label className="field">Work left (if not just what was planned less what you did)<input value={left} onChange={(e) => setLeft(e.target.value)} placeholder="optional" inputMode="decimal" /></label>
                  </div>
                )}
                <label className="field">{way === "done" ? "Note" : "Why"} (optional)<input value={why} onChange={(e) => setWhy(e.target.value)} placeholder={way === "done" ? "" : "Waiting on records, ran out of time…"} /></label>
                <div><button type="button" className="btn" disabled={busy} onClick={() => void go(x)}>Save</button></div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
