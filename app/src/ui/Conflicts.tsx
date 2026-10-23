// "Work due won't fit" cards, shared by Today and the Week view. Pressing the button turns the
// named business days into client days (a one-day override); nothing changes before that.
import { useState } from "react";
import { fmtDate, fmtHours } from "../lib/domain";
import { addDays, weekday } from "../lib/planning";
import { usualTypeKey } from "../lib/dayTypes";
import { Conflict } from "../lib/today";
import { Icon } from "./bits";
import { useData } from "./data";

export function useMakeClientDay() {
  const { settings, saveSetting } = useData();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string>();
  const [error, setError] = useState<string>();
  const make = async (dates: string[]) => {
    setBusy(true); setError(undefined); setNote(undefined);
    try {
      const next = { ...settings.overrides };
      const keep = addDays(dates[0], -60);
      for (const k of Object.keys(next)) if (k < keep) delete next[k];
      for (const d of dates) if (usualTypeKey(weekday(d), settings) === "client") delete next[d]; else next[d] = "client";
      await saveSetting("dayOverrides", next);
      setNote(`${dates.length === 1 ? fmtDate(dates[0], { weekday: true, year: false }) : "Those days"} now ${dates.length === 1 ? "a client day" : "client days"}. Business work planned on ${dates.length === 1 ? "it" : "them"} stays where it is; move it from the Week view.`);
    } catch {
      setError("Couldn't save that. Nothing was changed; try again.");
    } finally {
      setBusy(false);
    }
  };
  return { make, busy, note, error };
}

export function ConflictCard({ c, busy, onMake }: { c: Conflict; busy: boolean; onMake: (dates: string[]) => void }) {
  return (
    <section className="card pad stack today-conflict" aria-label={`Deadline ${fmtDate(c.deadline)} won't fit`}>
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
          <button type="button" className="btn small primary" disabled={busy} onClick={() => onMake(c.days.map((d) => d.date))}>
            Yes, make {c.days.length === 1 ? "it" : "them"} client {c.days.length === 1 ? "day" : "days"}
          </button>
          <span className="muted" style={{ fontSize: 12 }}>Nothing changes unless you press this.</span>
        </div>
      )}
    </section>
  );
}
