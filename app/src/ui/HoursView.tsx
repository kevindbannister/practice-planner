// The planner's hours view: each day as a column of hours. Outside your working day and
// lunch is shaded; your Outlook meetings show in their own colour; planned work is laid out
// in your free time in the order you've set (or at the time you dropped it). Drag work to a
// time to pin it there; click an empty time to add a task there.
import { ReactNode, useEffect, useState } from "react";
import { CalEvent, CalendarPrefs, hhmm } from "../lib/calendar";
import { clock, gridRange, layoutDay, offHours } from "../lib/dayGrid";
import { fmtHours } from "../lib/domain";
import { Icon } from "./bits";

export type HourCard = {
  key: string; title: string; client: string; tag: string; hours: number; svc: string; start?: string;
  flags: string[]; // "late", "tight", "urgent", "held"
  suggested?: string; prepared?: boolean; subtasks?: string; task?: boolean;
};

type Props = {
  days: string[];
  today: string;
  shownDay: string;
  narrow: boolean;
  prefs: CalendarPrefs;
  cardsFor: (day: string) => HourCard[];
  eventsOn: (day: string) => CalEvent[];
  busyOn: (day: string) => [number, number][];
  dragKey?: string;
  dropTarget?: string;
  insertAt?: number;
  dropKind?: "index" | "time";
  dragHours?: number;
  cardProps: (key: string) => Record<string, unknown>;
  onOpen: (key: string) => void;
  onAdd: (day: string, time: string) => void;
  head: (day: string) => ReactNode;
  className?: string;
  swipe?: Record<string, unknown>;
  connected: boolean;
};

const PPM = 0.9; // pixels a minute (54px an hour)
const PPM_PHONE = 1.1;

function minutesIn(e: CalEvent, day: string): [number, number] {
  const start = new Date(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)).getTime();
  const s = Math.max(0, Math.round((e.start.getTime() - start) / 60000));
  const f = Math.min(1440, Math.round((e.end.getTime() - start) / 60000));
  return [s, f];
}

/** Side-by-side lanes for meetings that overlap. */
function lanes(list: { s: number; e: number }[]): { lane: number; of: number }[] {
  const order = list.map((x, i) => ({ ...x, i })).sort((a, b) => a.s - b.s || b.e - a.e);
  const out: { lane: number; of: number }[] = new Array(list.length);
  let group: typeof order = [];
  let groupEnd = -1;
  const flush = () => {
    const ends: number[] = [];
    for (const x of group) {
      let l = ends.findIndex((end) => end <= x.s);
      if (l < 0) l = ends.length;
      ends[l] = x.e;
      out[x.i] = { lane: l, of: 0 };
    }
    for (const x of group) out[x.i].of = ends.length;
    group = [];
  };
  for (const x of order) {
    if (group.length && x.s >= groupEnd) flush();
    group.push(x);
    groupEnd = Math.max(groupEnd, x.e);
  }
  if (group.length) flush();
  return out;
}

function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

export function HoursView(p: Props) {
  const ppm = p.narrow ? PPM_PHONE : PPM;
  const now = useNow();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const shownDays = p.narrow ? [p.shownDay] : p.days;

  // one layout per day, and the hours to show (stretched for early or late meetings or work)
  const perDay = shownDays.map((d) => {
    const cards = p.cardsFor(d);
    const events = p.eventsOn(d);
    const timed = events.filter((e) => !e.allDay);
    const layout = layoutDay(cards.map((c) => ({ key: c.key, hours: c.hours, start: c.start })), p.prefs, p.busyOn(d));
    return { d, cards, events, timed, allDay: events.filter((e) => e.allDay), layout };
  });
  const extra: [number, number][] = perDay.flatMap((x) => [
    ...x.timed.filter((e) => e.showAs !== "free").map((e) => minutesIn(e, x.d)),
    ...x.layout.placed.flatMap((pl) => pl.segments),
  ]);
  const range = gridRange(p.prefs, extra);
  const height = (range[1] - range[0]) * ppm;
  const y = (m: number) => (m - range[0]) * ppm;
  const hours: number[] = [];
  for (let m = range[0]; m < range[1]; m += 60) hours.push(m);
  const shade = offHours(p.prefs, range);

  return (
    <div className={`hours${p.narrow ? " one" : ""}${p.className ? ` ${p.className}` : ""}`} style={{ ["--hour-px" as string]: `${60 * ppm}px` }} {...(p.swipe || {})}>
      <div className="hours-head">
        <div className="hours-corner" aria-hidden="true" />
        {perDay.map((x) => (
          <div key={x.d} className={`hours-dayhead${x.d === p.today ? " today" : ""}`}>
            {p.head(x.d)}
            {x.allDay.map((e) => <div key={e.id} className="allday" title={e.subject}>{e.subject || "All day"}</div>)}
          </div>
        ))}
      </div>
      <div className="hours-body">
        <div className="hours-gutter" style={{ height }} aria-hidden="true">
          {hours.map((m) => <span key={m} style={{ top: y(m) }}>{hhmm(m)}</span>)}
        </div>
        {perDay.map((x) => {
          const byKey = new Map(x.cards.map((c) => [c.key, c]));
          const meetLanes = lanes(x.timed.map((e) => {
            const [s, f] = minutesIn(e, x.d);
            return { s, e: f };
          }));
          const ghostH = Math.max(15, Math.round((p.dragHours || 1) * 60)) * ppm;
          return (
            <div
              key={x.d}
              className={`hours-col${x.d === p.today ? " today" : ""}${p.dropTarget === x.d ? " drop" : ""}`}
              style={{ height }}
              data-drop={x.d}
              data-time=""
              data-from={range[0]}
              data-ppm={ppm}
              role="group"
              aria-label={`Hours on ${x.d}`}
              onClick={(e) => {
                if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains("off")) return;
                const r = e.currentTarget.getBoundingClientRect();
                const m = Math.floor((range[0] + (e.clientY - r.top) / ppm) / 15) * 15;
                p.onAdd(x.d, hhmm(m));
              }}
            >
              {shade.map(([s, f]) => <div key={`o${s}`} className="off" style={{ top: y(s), height: (f - s) * ppm }} />)}
              {x.timed.map((e, i) => {
                const [s, f] = minutesIn(e, x.d);
                const l = meetLanes[i];
                const w = 100 / (l?.of || 1);
                return (
                  <div
                    key={e.id}
                    className={`meet ${e.showAs}`}
                    style={{ top: y(s), height: Math.max(14, (f - s) * ppm - 2), left: `calc(${w * (l?.lane || 0)}% + 2px)`, width: `calc(${w}% - 4px)` }}
                    title={`${e.subject || "Busy"} · ${clock(s)}–${clock(f)}`}
                  >
                    <strong>{e.subject || "Busy"}</strong>
                    {(f - s) * ppm > 30 && <span>{clock(s)}–{clock(f)}{e.showAs === "tentative" ? " · tentative" : ""}</span>}
                  </div>
                );
              })}
              {x.layout.placed.flatMap((pl) => {
                const c = byKey.get(pl.key)!;
                return pl.segments.map(([s, f], n) => {
                  const h = (f - s) * ppm;
                  const small = h < 34;
                  return (
                    <button
                      key={`${pl.key}-${n}`}
                      type="button"
                      className={`hblock ${c.svc}${c.task ? " task" : ""}${c.suggested !== undefined ? " suggested" : ""}${c.prepared ? " prepared" : ""}${pl.clash ? " clash" : ""}${p.dragKey === c.key ? " dragging" : ""}${small ? " small" : ""}`}
                      style={{ top: y(s) + 1, height: Math.max(16, h - 2) }}
                      {...(c.suggested === undefined && !c.prepared ? p.cardProps(c.key) : {})}
                      onClick={() => p.onOpen(c.key)}
                      aria-label={`${c.client ? `${c.client}: ` : ""}${c.title}, ${clock(s)} to ${clock(f)}${pl.pinned ? ", set time" : ""}${c.suggested !== undefined ? ", suggested" : ""}. Open.`}
                    >
                      <span className="hb-top">
                        <strong>{c.prepared ? "✓ " : ""}{c.client || c.title}</strong>
                        {pl.pinned && <span className="hb-pin" title="Set to this time"><Icon name="clock" size={11} /></span>}
                      </span>
                      {!small && <span className="hb-sub">{c.client ? c.title : c.tag}{n > 0 ? " (continued)" : ""}</span>}
                      {!small && h > 52 && (
                        <span className="hb-time">
                          {clock(s)}–{clock(f)}
                          {pl.segments.length > 1 && n === 0 ? ` · ${fmtHours(c.hours)} in all` : ""}
                          {c.subtasks ? ` · ${c.subtasks}` : ""}
                        </span>
                      )}
                      {!small && h > 70 && c.flags.length > 0 && (
                        <span className="hb-flags">
                          {c.flags.map((fl) => <span key={fl} className={`chip ${fl === "tight" ? "amber" : fl === "held" ? "hold" : "red"}`}>{fl === "late" ? "Late" : fl === "tight" ? "Tight" : fl === "urgent" ? "Urgent" : "On hold"}</span>)}
                        </span>
                      )}
                      {c.suggested !== undefined && !small && <span className="hb-time">Suggested{c.suggested ? `: ${c.suggested}` : ""}</span>}
                    </button>
                  );
                });
              })}
              {p.dropTarget === x.d && p.dropKind === "time" && p.insertAt !== undefined && (
                <div className="hdrop" style={{ top: y(p.insertAt), height: ghostH }} aria-hidden="true"><span>{clock(p.insertAt)}</span></div>
              )}
              {x.d === p.today && nowMins >= range[0] && nowMins <= range[1] && <div className="now-line" style={{ top: y(nowMins) }} aria-hidden="true" />}
            </div>
          );
        })}
      </div>
      {perDay.some((x) => x.layout.unfitted.length) && (
        <div className="hours-foot">
          <div className="hours-corner" aria-hidden="true" />
          {perDay.map((x) => (
            <div key={x.d} className="hours-unfit">
              {x.layout.unfitted.length > 0 && (
                <>
                  <span className="hours-unfit-h">Doesn't fit in the day</span>
                  {x.layout.unfitted.map((k) => {
                    const c = x.cards.find((cc) => cc.key === k)!;
                    return (
                      <button key={k} type="button" className={`hblock unfit ${c.svc}${c.task ? " task" : ""}${c.suggested !== undefined ? " suggested" : ""}`}
                        {...(c.suggested === undefined && !c.prepared ? p.cardProps(c.key) : {})} onClick={() => p.onOpen(c.key)}>
                        <span className="hb-top"><strong>{c.client || c.title}</strong><span className="mono">{fmtHours(c.hours)}</span></span>
                        <span className="hb-sub">{c.client ? c.title : c.tag}</span>
                      </button>
                    );
                  })}
                </>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="hours-legend muted">
        <span><i className="lg off" />Outside your working hours and lunch</span>
        <span><i className="lg meet" />{p.connected ? "Meetings from Outlook" : "Meetings (connect Outlook in Settings › Calendar)"}</span>
        <span><Icon name="clock" size={11} /> set to a time (drag it to a time; clear it in the job or task)</span>
      </div>
    </div>
  );
}
