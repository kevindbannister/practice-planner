// Month: the plan on a calendar. Each day shows what is planned on it against the hours available, and what is due. Click a day to plan it in the Week view.
import { KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { Job, Task, fmtDate, fmtHours, isOnHold, todayIso } from "../lib/domain";
import { addDays } from "../lib/planning";
import { dayHours } from "../lib/dayTypes";
import { MonthItem, Show, buildMonth, monthKey, shiftMonth } from "../lib/monthPlan";
import { Item, PlanCard, UnplannedTray, usePlanItems, usePlanTray } from "./PlanTray";
import { useCardFields } from "./CardOptions";
import { isBusinessTask } from "../lib/projects";
import { svcClass } from "../lib/serviceColour";
import { planHours } from "../lib/waiting";
import { isStatutory } from "../lib/workGroups";
import { PlanTabs } from "./bits";
import { Row } from "../lib/schema";
import { useData, useIndex } from "./data";
import { useEditor } from "./Editors";
import { useBoardDrag } from "./useBoardDrag";

const monthName = (key: string) => new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const dayName = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_SHOWN = 3;
function useNarrow(q = "(max-width: 720px)") { const get = () => typeof matchMedia === "function" && matchMedia(q).matches; const [n, setN] = useState(get); useEffect(() => { const m = matchMedia(q); const f = () => setN(m.matches); m.addEventListener("change", f); return () => m.removeEventListener("change", f); }, [q]); return n; }

export function MonthView() {
  const { data, settings, update } = useData(); const idx = useIndex(); const { open } = useEditor(); const today = todayIso(); const narrow = useNarrow();
  const [month, setMonth] = useState(monthKey(today)); const [show, setShow] = useState<Show>("all");
  // Saturdays and Sundays are hidden unless asked for; the choice is remembered on this device
  const [weekends, setWeekends] = useState(() => { try { return localStorage.getItem("pp.month.weekends") === "1"; } catch { return false; } });
  const toggleWeekends = () => setWeekends((w) => { const n = !w; try { localStorage.setItem("pp.month.weekends", n ? "1" : "0"); } catch { /* not remembered */ } return n; });
  const items: MonthItem[] = useMemo(() => {
    const out: MonthItem[] = [];
    for (const j of data.jobs as Job[]) {
      const done = j.Status === "Complete"; if (!done && (j.Status === "Cancelled")) continue;
      out.push({ key: j.Key, kind: "job", title: j.Title, client: idx.clientByKey.get(j.ClientKey)?.Title || (j.ClientName as string) || "", serviceKey: j.ServiceKey, hours: planHours(j, data.services), planned: String(j.PlannedDate || "").slice(0, 10), deadline: String(j.Deadline || "").slice(0, 10), statutory: isStatutory(data.services.find((x) => x.Key === j.ServiceKey), j.ServiceKey), held: !done && isOnHold(j), done, doneOn: done ? String(j.CompletedDate || j.PlannedDate || "").slice(0, 10) : "", period: String(j.PeriodEnd || "").slice(0, 10) || undefined });
    }
    for (const t of data.tasks as Task[]) {
      const done = t.Status === "Done"; if (!done && (t.Status === "Cancelled")) continue;
      const proj = isBusinessTask(t) ? data.projects.find((p) => p.Key === t.ProjectKey) : undefined;
      out.push({ key: t.Key, kind: "task", title: t.Title, client: proj ? String(proj.Title) : (t.ClientKey && idx.clientByKey.get(t.ClientKey)?.Title) || "", hours: t.EstimateHours || 1, planned: String(t.PlannedDate || "").slice(0, 10), deadline: String(t.DueDate || "").slice(0, 10), statutory: false, held: !done && isOnHold(t), done, doneOn: done ? String(t.CompletedDate || t.PlannedDate || "").slice(0, 10) : "" });
    }
    return out;
  }, [data.jobs, data.tasks, data.services, data.projects, idx]);
  // moving a job or task to another day changes only the day it is planned for; deadlines are never touched
  const [toast, setToast] = useState<{ text: string; undo?: () => void }>(); const [error, setError] = useState<string>(); const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const say = (text: string, undo?: () => void) => { setToast({ text, undo }); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setToast(undefined), 6000); };
  const move = async (key: string, date: string) => {
    const item = items.find((i) => i.key === key); if (!item || item.done || item.held || (date !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(date)) || item.planned === date) return;
    const list = item.kind === "job" ? "Jobs" : "Tasks"; const row = ((item.kind === "job" ? data.jobs : data.tasks) as Row[]).find((r) => r.Key === key); if (!row) return;
    const before = { PlannedDate: String(row.PlannedDate || ""), StartTime: String(row.StartTime || ""), DayOrder: row.DayOrder ?? "" }; setError(undefined);
    try {
      await update(list, row, { PlannedDate: date, StartTime: "", DayOrder: "" });
      if (!date) { say(`${item.client || item.title}: taken off the plan`, () => update(list, row, before).then(() => setToast(undefined)).catch(() => setError("Couldn't undo that. Plan it again by hand."))); return; }
      const late = item.deadline && date > item.deadline ? `. That is after its deadline (${fmtDate(item.deadline, { year: false })})` : "";
      say(`${item.client || item.title}: planned for ${fmtDate(date, { weekday: true, year: false })}${late}`, () => update(list, row, before).then(() => setToast(undefined)).catch(() => setError("Couldn't undo that. Move it back by hand.")));
    } catch { setError("That move didn't save. It's been put back; try again."); }
  };
  const { dragKey, target: dropTarget, cardProps } = useBoardDrag((key, to) => void move(key, to === "tray" ? "" : to), (by) => setMonth((m) => shiftMonth(m, by))); // holding a card at the edge turns the month
  const keyMove = (i: MonthItem, e: ReactKeyboardEvent) => {
    if (!e.altKey || !i.planned) return; const by = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" ? -7 : e.key === "ArrowDown" ? 7 : 0; if (!by) return;
    e.preventDefault(); void move(i.key, addDays(i.planned, by));
  };
  const cap = (d: string) => { const h = dayHours(d, settings); return h.client + h.business; };
  const m = useMemo(() => buildMonth(month, items, cap, today, show), [month, items, settings, today, show]); // eslint-disable-line react-hooks/exhaustive-deps
  // the Unplanned panel is the Week view's: the same list, filters and cards
  const { items: planItems } = usePlanItems();
  const [fields] = useCardFields();
  const isStat = (i: Item) => i.kind === "job" && isStatutory(data.services.find((x) => x.Key === (i.row as Job).ServiceKey), (i.row as Job).ServiceKey);
  const narrowed = useMemo(() => planItems.filter((i) => show === "all" || (show === "statutory") === isStat(i)), [planItems, show, data.services]); // eslint-disable-line react-hooks/exhaustive-deps
  const tray = usePlanTray({ items: narrowed, today, inTray: (i) => !i.planned });
  const hiddenWeekend = useMemo(() => m.weeks.flat().filter((c) => c.weekend && c.inMonth).reduce((t, c) => t + c.planned.length, 0), [m]);
  const goWeek = (date: string) => { try { sessionStorage.setItem("pp.plan.jump", date); } catch { /* the Week view opens on this week instead */ } window.location.hash = "#/plan"; };
  const openItem = (i: MonthItem) => open(i.kind === "job" ? { kind: "job", key: i.key } : { kind: "task", key: i.key });
  const chip = (i: MonthItem) => (
    <button key={i.key} type="button" className={`month-item${dragKey === i.key ? " dragging" : ""}`} {...(i.done || i.held ? {} : cardProps(i.key))} onKeyDown={(e) => keyMove(i, e)} onClick={(e) => { e.stopPropagation(); openItem(i); }} title={`${i.client ? i.client + ": " : ""}${i.title}${i.period ? ` · period to ${fmtDate(i.period)}` : ""} · ${fmtHours(i.hours)}`}>
      <span className={`svc-dot ${svcClass(i.kind === "job" ? i.serviceKey : "TASK")}`} aria-hidden="true" />{i.client || i.title}<span className="muted"> {fmtHours(i.hours)}</span>{i.period && <span className="muted month-period"> · to {fmtDate(i.period, { year: false })}</span>}
    </button>
  );
  const panel = (
    <UnplannedTray tray={tray} today={today} narrow={narrow} dropOver={dropTarget === "tray"} wide
      card={(i) => (
        <div key={i.key} className="stack" style={{ gap: 4 }}>
          <PlanCard item={i} today={today} fields={fields} dragging={dragKey === i.key} onOpen={() => open(i.kind === "job" ? { kind: "job", key: i.key } : { kind: "task", key: i.key })} dragProps={cardProps(i.key)} />
          {narrow && <input className="input" type="date" aria-label={`Plan ${i.client || i.title} for a day`} value="" style={{ width: "auto", minHeight: 32, padding: "2px 6px", fontSize: 12 }} onChange={(e) => void move(i.key, e.target.value)} />}
        </div>
      )} />
  );
  const cellsWithContent = m.weeks.flat().filter((c) => c.inMonth && (weekends || !c.weekend) && (c.planned.length || c.due.length || c.done.length));
  return (
    <div className="page">
      <PlanTabs current="month" />
      <div className="row-wrap no-print" style={{ gap: 12, alignItems: "center" }}>
        <div className="row" style={{ gap: 4 }}>
          <button type="button" className="btn small" data-drop="week-prev" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
          <button type="button" className="btn small" data-drop="week-next" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}>›</button>
        </div>
        <h2 style={{ margin: 0, fontSize: 20 }} aria-live="polite">{monthName(month)}</h2>
        {month !== monthKey(today) && <button type="button" className="btn small" onClick={() => setMonth(monthKey(today))}>This month</button>}
        <div className="seg" role="group" aria-label="Show">
          {([["all", "All work"], ["statutory", "Statutory"], ["other", "Other"]] as [Show, string][]).map(([k, l]) => <button key={k} type="button" aria-pressed={show === k} onClick={() => setShow(k)}>{l}</button>)}
        </div>
        <button type="button" className="btn small" aria-pressed={weekends} onClick={toggleWeekends} title={weekends ? "Hide Saturdays and Sundays" : "Show Saturdays and Sundays"}>{weekends ? "Hide weekends" : `Show weekends${hiddenWeekend ? ` (${hiddenWeekend} planned)` : ""}`}</button>
        <span className="muted">{fmtHours(m.totals.planned) || "0h"} planned of {fmtHours(m.totals.capacity) || "0h"} available · {m.totals.due} due{m.totals.unplanned ? `, ${m.totals.unplanned} not planned yet` : ""}</span>
      </div>
      <div className="month-layout">
      {!narrow && panel}
      <div>
      {narrow ? (
        <ul className="month-agenda" aria-label={`Plan for ${monthName(month)}`}>
          {cellsWithContent.length === 0 && <li className="muted">Nothing planned or due this month.</li>}
          {cellsWithContent.map((c) => (
            <li key={c.date} className={c.today ? "today" : ""}>
              <button type="button" className="linkbtn" onClick={() => goWeek(c.date)}><strong>{dayName(c.date)}</strong></button> <span className="muted">{fmtHours(c.plannedHours) || "0h"} of {fmtHours(c.capacity) || "0h"}</span>
              <div>{c.planned.map((i) => <div key={i.key} className="row" style={{ gap: 6, justifyContent: "space-between" }}>{chip(i)}<input className="input" type="date" aria-label={`Move ${i.client || i.title} to another day`} value={c.date} style={{ width: "auto", minHeight: 32, padding: "2px 6px", fontSize: 12 }} onChange={(e) => void move(i.key, e.target.value)} /></div>)}</div>
              {c.due.length > 0 && <div className="month-due">Due: {c.due.map((i) => (i.client || i.title)).join(", ")}</div>}
            </li>
          ))}
        </ul>
      ) : (
        <table className="month-grid">
          <caption className="sr-only">Plan for {monthName(month)}</caption>
          <thead><tr>{WEEKDAYS.filter((_, n) => weekends || n < 5).map((d) => <th key={d} scope="col">{d}</th>)}</tr></thead>
          <tbody>
            {m.weeks.map((w, wi) => (
              <tr key={wi}>
                {w.filter((c) => weekends || !c.weekend).map((c) => {
                  const pct = c.capacity ? Math.min(100, Math.round((c.plannedHours / c.capacity) * 100)) : c.plannedHours ? 100 : 0;
                  return (
                    <td key={c.date} data-drop={c.date} className={`month-cell${dropTarget === c.date ? " drop" : ""}${c.inMonth ? "" : " out"}${c.today ? " today" : ""}${c.weekend ? " weekend" : ""}${c.over ? " over" : ""}`} onClick={() => goWeek(c.date)}>
                      <div className="month-cell-head">
                        <button type="button" className="month-day" aria-label={`${dayName(c.date)}: ${fmtHours(c.plannedHours) || "0h"} planned of ${fmtHours(c.capacity) || "0h"}. Open in the week view`} onClick={(e) => { e.stopPropagation(); goWeek(c.date); }}>{Number(c.date.slice(8))}</button>
                        {c.due.length > 0 && <span className="chip red" title={c.due.map((i) => `${i.client ? i.client + ": " : ""}${i.title}`).join("\n")}>{c.due.length} due</span>}
                      </div>
                      {c.capacity > 0 || c.plannedHours > 0 ? <div className="month-bar" aria-hidden="true"><span className={c.over ? "over" : ""} style={{ width: `${pct}%` }} /></div> : null}
                      {c.planned.slice(0, MAX_SHOWN).map(chip)}
                      {c.planned.length > MAX_SHOWN && <button type="button" className="linkbtn month-more" onClick={(e) => { e.stopPropagation(); goWeek(c.date); }}>+{c.planned.length - MAX_SHOWN} more</button>}
                      {c.done.length > 0 && <div className="muted month-doneline">{c.done.length} done</div>}
                      {c.capacity > 0 && <div className="muted month-hours">{fmtHours(c.plannedHours) || "0h"}/{fmtHours(c.capacity)}</div>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      </div>
      </div>
      {narrow && panel}
      <p className="muted" style={{ margin: 0 }}>Held work is left off. Bars show planned hours against the hours you have that day; red means more is planned than fits. Drag a job or task to another day to move it (or hold it at the left or right edge of the screen to change month), or focus it and press Alt with an arrow key: left and right move a day, up and down a week. Click a day to plan it in the Week view. The Unplanned list shows work with no day yet, earliest deadline first.</p>
      {error && <p className="import-list warn" role="alert">{error}</p>}
      <div aria-live="polite" className="sr-only">{toast?.text}</div>
      {toast && <div className="toast" role="status">{toast.text}{toast.undo && <button type="button" className="linkbtn" style={{ marginLeft: 10 }} onClick={toast.undo}>Undo</button>}</div>}
    </div>
  );
}
