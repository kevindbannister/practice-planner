// The planning board: a working week of days with capacity, and a tray of unplanned
// work. Drag cards between days (or back to the tray); click a card to edit it.
// On a phone the week becomes a strip of days: tap one to see it, or drag a card onto it.
import { PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { Job, Task, fmtDate, fmtHours, holdAlert, isOnHold, jobState, resumePatch, todayIso } from "../lib/domain";
import { addDays, jobHours, mondayOf, weekday } from "../lib/planning";
import { Icon } from "./bits";
import { useData, useIndex } from "./data";
import { taskAsJob, useEditor } from "./Editors";
import { useBoardDrag } from "./useBoardDrag";

function useNarrow(query = "(max-width: 720px)"): boolean {
  const get = () => typeof matchMedia === "function" && matchMedia(query).matches;
  const [narrow, setNarrow] = useState(get);
  useEffect(() => {
    const m = matchMedia(query);
    const on = () => setNarrow(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [query]);
  return narrow;
}

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
  held: boolean;
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
  const [error, setError] = useState<string>();
  const [toast, setToast] = useState<{ text: string; undo?: () => void }>();
  const toastTimer = useRef(0);
  const narrow = useNarrow();

  const days = [0, 1, 2, 3, 4].map((i) => addDays(week, i));
  const [picked, setPicked] = useState<string>();
  const shownDay = picked && days.includes(picked) ? picked : days.includes(today) ? today : days[0];

  const items: Item[] = useMemo(() => {
    const jobs = idx.openJobs.map<Item>((j) => ({
      kind: "job", key: j.Key, row: j, title: j.Title,
      client: idx.clientByKey.get(j.ClientKey)?.Title || (j.ClientName as string) || "",
      tag: shortTag(j.ServiceKey, idx.serviceName.get(j.ServiceKey || "")),
      hours: jobHours(j, data.services), planned: j.PlannedDate, deadline: j.Deadline,
      urgent: j.Priority === "urgent", compliance: true, held: isOnHold(j),
    }));
    const tasks = idx.openTasks.map<Item>((t) => ({
      kind: "task", key: t.Key, row: t, title: t.Title,
      client: (t.ClientKey && idx.clientByKey.get(t.ClientKey)?.Title) || "",
      tag: t.Type || "Task", hours: t.EstimateHours || 1, planned: t.PlannedDate, deadline: t.DueDate,
      urgent: false, compliance: false, held: isOnHold(t),
    }));
    return [...jobs, ...tasks];
  }, [idx, data.services]);

  const shownKind = items.filter((i) => (show === "all" ? true : show === "compliance" ? i.compliance : !i.compliance));
  const visible = shownKind.filter((i) => !i.held); // on-hold work is off the board
  const held = shownKind
    .filter((i) => i.held)
    .sort((a, b) => (a.deadline || "9999").localeCompare(b.deadline || "9999"));
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
  const dueSoonUnplanned = items.filter((i) => !i.held && !i.planned && i.deadline && i.deadline <= addDays(today, 30)).length;

  const say = (text: string, undo?: () => void) => {
    window.clearTimeout(toastTimer.current);
    setToast({ text, undo });
    toastTimer.current = window.setTimeout(() => setToast(undefined), 5000);
  };
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const move = async (key: string, date?: string, quiet = false) => {
    const item = items.find((i) => i.key === key);
    if (!item || (item.planned || undefined) === date) return;
    const before = item.planned;
    const list = item.kind === "job" ? "Jobs" : "Tasks";
    setError(undefined);
    try {
      if (item.held) {
        // dropping something on hold onto the board takes it off hold
        if (!date) return;
        await update(list, item.row, { ...resumePatch(item.row, today), PlannedDate: date });
        say(`${item.client || item.title}: taken off hold and planned for ${fmtDate(date, { weekday: true, year: false })}`);
        return;
      }
      await update(list, item.row, { PlannedDate: date || "" });
      if (!quiet) {
        say(
          `${item.client || item.title}: ${date ? `planned for ${fmtDate(date, { weekday: true, year: false })}` : "back to unplanned"}`,
          () => moveRef.current(key, before, true).then(() => setToast(undefined)),
        );
      }
    } catch {
      setError("That move didn't save. It's been put back; try again.");
    }
  };

  const moveRef = useRef(move);
  moveRef.current = move; // undo runs later, so it needs the latest board

  const { dragKey, target: dropTarget, cardProps } = useBoardDrag((key, t) => move(key, t === "tray" ? undefined : t));

  const card = (i: Item) => (
    <PlanCard
      key={i.key}
      item={i}
      today={today}
      dragging={dragKey === i.key}
      onOpen={() => open(i.kind === "job" ? { kind: "job", key: i.key } : { kind: "task", key: i.key })}
      dragProps={cardProps(i.key)}
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
            <button type="button" className="btn primary hide-phone" onClick={() => open({ kind: "task" })}>+ New task</button>
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

      <div className="daystrip" role="group" aria-label="Days this week">
        {days.map((d) => {
          const used = load(d), cap = capacity(d);
          const over = used > cap;
          return (
            <button
              key={d}
              type="button"
              data-drop={d}
              className={`daypill${d === today ? " today" : ""}${dropTarget === d ? " drop" : ""}`}
              aria-pressed={shownDay === d}
              aria-label={`${fmtDate(d, { weekday: true, year: false })}, ${fmtHours(used) || "0h"} of ${fmtHours(cap)} planned`}
              onClick={() => setPicked(d)}
            >
              <span className="dw">{fmtDate(d, { weekday: true, year: false }).split(" ")[0]}</span>
              <span className="dn">{Number(d.slice(8))}</span>
              <span className="cap" aria-hidden="true"><span className={over ? "over" : ""} style={{ width: `${cap ? Math.min(100, Math.round((used / cap) * 100)) : 100}%` }} /></span>
              <span className={`dh${over ? " over" : ""}`}>{fmtHours(used) || "0h"}</span>
            </button>
          );
        })}
      </div>

      <div className="plan-body">
        <aside className={`tray${dropTarget === "tray" ? " drop" : ""}`} aria-label="Unplanned work" data-drop="tray">
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
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            {narrow
              ? "Hold a card, or drag its handle, onto a day above to plan it. Tap a card to open it."
              : "Drag onto a day to plan it, or open a card to pick a date."}
          </p>
          {missed.length > 0 && (
            <p style={{ margin: 0, fontSize: 12, color: "var(--amber-ink)", fontWeight: 600 }}>
              {missed.length} planned on an earlier day but not finished
            </p>
          )}
          {held.length > 0 && (
            <details className="held-list">
              <summary>
                On hold ({held.length})
                {held.some((i) => holdAlert(i.row, i.deadline, today)) && (
                  <span className="chip amber" style={{ marginLeft: 6 }}>{held.filter((i) => holdAlert(i.row, i.deadline, today)).length} to look at</span>
                )}
              </summary>
              <p className="muted" style={{ margin: "6px 0", fontSize: 12 }}>Drag one onto a day to take it off hold and plan it.</p>
              <div className="stack held-cards" style={{ gap: 8 }}>{held.map(card)}</div>
            </details>
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
              <div
                key={d}
                role="listitem"
                data-drop={d}
                className={`day${d === today ? " today" : ""}${dropTarget === d ? " drop" : ""}${d === shownDay ? " shown" : ""}`}
              >
                <div className="day-title">
                  <h2 style={{ margin: 0, fontSize: 16 }}>{fmtDate(d, { weekday: true, year: false })}</h2>
                  <span className="mono" style={{ fontSize: 12, color: over ? "var(--red-ink)" : "var(--ink-2)" }}>
                    {fmtHours(used) || "0h"} / {fmtHours(cap)}{over ? ` · ${fmtHours(used - cap)} over` : ""}
                  </span>
                </div>
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
                {!list.length && narrow && <p className="muted" style={{ margin: 0, fontSize: 13 }}>Nothing planned yet.</p>}
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
      <div aria-live="polite" className="sr-only">{toast?.text}</div>
      {toast && (
        <div className="toast" role="status">
          <span>{toast.text}</span>
          {toast.undo && <button type="button" onClick={toast.undo}>Undo</button>}
        </div>
      )}
    </div>
  );
}

function state(i: Item, today: string) {
  return jobState((i.kind === "task" ? taskAsJob(i.row as Task) : (i.row as Job)), today).state;
}

type DragProps = {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onContextMenu: (e: { preventDefault: () => void }) => void;
  onClickCapture: (e: { preventDefault: () => void; stopPropagation: () => void }) => void;
};

function PlanCard({
  item: i, today, dragging, onOpen, dragProps,
}: {
  item: Item; today: string; dragging: boolean; onOpen: () => void; dragProps: DragProps;
}) {
  const st = jobState(i.kind === "task" ? taskAsJob(i.row as Task) : (i.row as Job), today);
  const job = i.kind === "job" ? (i.row as Job) : undefined;
  return (
    <button
      type="button"
      className={`pcard${i.compliance ? "" : " task"}${i.held ? " held" : ""}${dragging ? " dragging" : ""}`}
      {...dragProps}
      onClick={onOpen}
      aria-label={`${i.title}${i.client ? ", " + i.client : ""}${i.deadline ? ", due " + fmtDate(i.deadline) : ""}. Open to edit.`}
    >
      <span className="pcard-top">
        <span className="pcard-tag">{i.tag}</span>
        <span className="row-wrap" style={{ gap: 6, flexWrap: "nowrap" }}>
          <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>{fmtHours(i.hours)}</span>
          <span className="pcard-grip" aria-hidden="true" title="Drag to plan"><Icon name="grip" /></span>
        </span>
      </span>
      <span className="pcard-client">{i.client || i.title}</span>
      <span className="pcard-sub">
        {i.client ? i.title : ""}
        {job?.PeriodEnd ? ` · to ${fmtDate(job.PeriodEnd, { year: false })}` : ""}
        {job?.StageNo ? ` · stage ${job.StageNo}` : ""}
      </span>
      {i.held && (
        <span className="pcard-foot">
          <span className="chip hold">On hold</span>
          {(i.row.HoldReason as string) && <span style={{ fontSize: 12 }}>{i.row.HoldReason as string}</span>}
        </span>
      )}
      {(i.deadline || i.urgent) && (
        <span className="pcard-foot">
          {i.deadline && <span className="mono" style={{ fontSize: 12 }}>Due {fmtDate(i.deadline, { year: i.deadline.slice(0, 4) !== today.slice(0, 4) })}</span>}
          {i.urgent && <span className="chip red">Urgent</span>}
          {!i.held && st.state === "overdue" && <span className="chip red">{-st.days!}d late</span>}
          {!i.held && st.state === "tight" && <span className="chip amber">Tight · {st.days}d</span>}
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
