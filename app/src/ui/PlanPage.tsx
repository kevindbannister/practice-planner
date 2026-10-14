// The planning board: a working week of days with capacity, and a tray of unplanned
// work. Drag cards between days (or back to the tray); click a card to edit it.
// On a phone the week becomes a strip of days: tap one to see it, or drag a card onto it.
import React, { PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { Job, Task, fmtDate, fmtHours, holdAlert, isOnHold, jobState, resumePatch, todayIso } from "../lib/domain";
import { addDays, mondayOf, weekday } from "../lib/planning";
import { Icon, PlanTabs, useRoute } from "./bits";
import { elementsUrl } from "../lib/elements";
import { DoneView } from "./DoneView";
import { DeadlinesView } from "./DeadlinesView";
import { MonthsView } from "./MonthsView";
import { useData, useIndex } from "./data";
import { taskAsJob, useEditor } from "./Editors";
import { useBoardDrag } from "./useBoardDrag";
import { TypeFilter, TypeOption, useRememberedTypes } from "./TypeFilter";
import { useCalendar } from "./Calendar";
import { svcClass } from "../lib/serviceColour";
import { readSetting } from "./data";
import { Candidate, DEFAULT_FILL, LOOK_AHEAD_DAYS, Skipped, Suggestion, suggestPlan } from "../lib/autoplan";
import { waitingForRecords } from "../lib/chase";
import { stageLabel } from "../lib/stages";
import { Row } from "../lib/schema";
import { compareInDay, placeInDay } from "../lib/dayOrder";
import { HourCard, HoursView } from "./HoursView";
import { hhmm } from "../lib/calendar";
import { progress, readSubtasks } from "../lib/subtasks";
import { inFinalise, planHours, waitState, waitingForClient } from "../lib/waiting";
import { CardField, CardOptions, useCardFields } from "./CardOptions";

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
  elements?: string; // the client's Elements link
  tag: string;
  hours: number;
  planned?: string;
  deadline?: string;
  urgent: boolean;
  compliance: boolean;
  held: boolean;
  stage?: string; // the stage's name, e.g. "Records received"
  stageNo?: number;
  stageCount?: number;
  note?: string;
  recordsIn?: boolean;
  waiting?: boolean; // with the client for approval
  finalise?: boolean; // prepared; what's left is finalising
  speakOn?: string;
  done?: boolean; // finished: shown on its day, ticked off
  doneOn?: string;
};

type Show = "all" | "compliance" | "other";
type Horizon = "30" | "90" | "all";

export function PlanPage() {
  const { parts } = useRoute();
  if (parts[1] === "months") return <MonthsView />;
  if (parts[1] === "deadlines") return <DeadlinesView />;
  if (parts[1] === "done") return <DoneView />;
  return <WeekView />;
}

function WeekView() {
  const { data, settings, update, updateMany } = useData();
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
  const [plan, setPlan] = useState<{ week: string; suggestions: Suggestion[]; skipped: Skipped[]; includeWaiting: boolean } | null>(null);
  const [accepting, setAccepting] = useState(false);
  const fillPct = (readSetting<number>(data.settings, "planFill") ?? DEFAULT_FILL) / 100;

  const days = [0, 1, 2, 3, 4].map((i) => addDays(week, i));
  const [picked, setPicked] = useState<string>();
  const [types, setTypes] = useRememberedTypes("pp.plan.types");
  const [view, setViewState] = useState<"hours" | "cards">(() => {
    try {
      return localStorage.getItem("pp.plan.view") === "cards" ? "cards" : "hours";
    } catch {
      return "hours";
    }
  });
  const setView = (v: "hours" | "cards") => {
    setViewState(v);
    try {
      localStorage.setItem("pp.plan.view", v);
    } catch {
      /* this visit only */
    }
  };
  const [fields, toggleField, resetFields] = useCardFields();
  const [showDone, setShowDoneState] = useState<boolean>(() => {
    try {
      return localStorage.getItem("pp.plan.done") !== "0";
    } catch {
      return true;
    }
  });
  const setShowDone = (v: boolean) => {
    setShowDoneState(v);
    try {
      localStorage.setItem("pp.plan.done", v ? "1" : "0");
    } catch {
      /* this visit only */
    }
  };
  const [slide, setSlide] = useState<"" | "next" | "prev">("");
  const swipe = useRef<{ x: number; y: number; cancelled: boolean } | null>(null);
  /** Move a week on or back; on a phone the same weekday stays selected. */
  const changeWeek = (by: number) => {
    setWeek((w) => addDays(w, 7 * by));
    setPicked((p) => (p ? addDays(p, 7 * by) : undefined));
    setSlide(by > 0 ? "next" : "prev");
    window.setTimeout(() => setSlide(""), 260);
  };
  // swipe left or right across the days on a phone to change week
  const swipeProps = {
    onTouchStart: (e: React.TouchEvent) => {
      const t = e.touches[0];
      swipe.current = e.touches.length === 1 ? { x: t.clientX, y: t.clientY, cancelled: false } : null;
    },
    onTouchMove: () => {
      if (swipe.current && document.body.classList.contains("is-dragging")) swipe.current.cancelled = true;
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const s = swipe.current;
      swipe.current = null;
      if (!s || s.cancelled || document.body.classList.contains("is-dragging")) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - s.x, dy = t.clientY - s.y;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) changeWeek(dx < 0 ? 1 : -1);
    },
  };
  const shownDay = picked && days.includes(picked) ? picked : days.includes(today) ? today : days[0];
  // on a phone, once the day strip sticks under the top bar, a small month label hangs below it
  const stripRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    if (!narrow) return setStuck(false);
    const check = () => {
      const el = stripRef.current;
      if (!el) return;
      const top = parseFloat(getComputedStyle(el).top) || 0;
      setStuck(el.getBoundingClientRect().top <= top + 1 && window.scrollY > 0);
    };
    check();
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => {
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, [narrow]);

  const mapJob = (j: Job): Item => {
    const stages = idx.stagesByService.get(j.ServiceKey || "") || [];
    const finalise = inFinalise(j);
    const tag = shortTag(j.ServiceKey, idx.serviceName.get(j.ServiceKey || ""));
    return {
      kind: "job", key: j.Key, row: j, title: j.Title,
      client: idx.clientByKey.get(j.ClientKey)?.Title || (j.ClientName as string) || "",
      elements: elementsUrl(idx.clientByKey.get(j.ClientKey)),
      tag: finalise ? `Finalise · ${tag}` : tag,
      hours: planHours(j, data.services), planned: j.PlannedDate, deadline: j.Deadline,
      waiting: waitingForClient(j, stages), finalise, speakOn: (j.SpeakOn as string) || undefined,
      urgent: j.Priority === "urgent", compliance: true, held: isOnHold(j),
      stage: stages.length || j.StageName ? stageLabel(j, stages) : undefined,
      stageNo: Math.min(Number(j.StageNo || 1), Math.max(stages.length, 1)), stageCount: stages.length,
      note: (j.CardNote as string) || "", recordsIn: !!j.RecordsReceived,
    };
  };
  const mapTask = (t: Task): Item => ({
    kind: "task", key: t.Key, row: t, title: t.Title,
    client: (t.ClientKey && idx.clientByKey.get(t.ClientKey)?.Title) || "",
    tag: t.Type || "Task", hours: t.EstimateHours || 1, planned: t.PlannedDate, deadline: t.DueDate,
    urgent: false, compliance: false, held: isOnHold(t), note: (t.CardNote as string) || "",
  });
  const items: Item[] = useMemo(() => [...idx.openJobs.map(mapJob), ...idx.openTasks.map(mapTask)], [idx, data.services]);

  const shownKind = items.filter((i) => (show === "all" ? true : show === "compliance" ? i.compliance : !i.compliance));
  const visible = shownKind.filter((i) => !i.held); // on-hold work is off the board
  const held = shownKind
    .filter((i) => i.held)
    .sort((a, b) => (a.deadline || "9999").localeCompare(b.deadline || "9999"));
  const byDay = new Map(days.map((d) => [d, visible.filter((i) => i.planned === d).sort(compareInDay)]));
  // finished work stays on its day, ticked off: the day it was planned for, or the day it was finished
  const asDone = (i: Item, day: string, finished?: string): Item => ({ ...i, done: true, doneOn: finished, planned: day, waiting: false, finalise: false, held: false, urgent: false });
  const doneItems: Item[] = [
    ...data.jobs.filter((j) => j.Status === "Complete" && days.includes(String(j.PlannedDate || j.CompletedDate || "")))
      .map((j) => asDone(mapJob(j), String(j.PlannedDate || j.CompletedDate), j.CompletedDate)),
    ...data.tasks.filter((t) => t.Status === "Done" && days.includes(String(t.PlannedDate || t.CompletedDate || "")))
      .map((t) => asDone(mapTask(t), String(t.PlannedDate || t.CompletedDate), t.CompletedDate)),
  ].filter((i) => (show === "all" ? true : show === "compliance" ? i.compliance : !i.compliance));
  const doneOn = (d: string) => doneItems.filter((i) => i.planned === d).sort((a, b) => String(a.row.StartTime || "").localeCompare(String(b.row.StartTime || "")) || a.client.localeCompare(b.client));
  // preparing already done (the job's now with the client, or being finalised), shown on its day
  const preparedOn = (d: string) => items.filter((i) => i.kind === "job" && i.finalise && (i.row as Job).PreparedOn === d);
  const preparedLoad = (d: string) => preparedOn(d).reduce((t, i) => t + (Number((i.row as Job).PreparedHours) || 0), 0);
  const activePlan = plan && plan.week === week ? plan : null;
  const suggestedKeys = new Set(activePlan?.suggestions.map((s) => s.key));
  const suggestedOn = (d: string) =>
    (activePlan?.suggestions || []).filter((s) => s.day === d).map((s) => ({ s, item: items.find((i) => i.key === s.key)! })).filter((x) => x.item);
  const typeKey = (i: Item) => (i.kind === "task" ? "TASK" : (i.row as Job).ServiceKey || "OTHER");
  const inTray = (i: Item) => !i.planned || (i.planned < today && !days.includes(i.planned));
  // with the client and not planned yet: their own group, soonest conversation first
  const withClient = visible
    .filter((i) => i.waiting && inTray(i) && !suggestedKeys.has(i.key))
    .sort((a, b) => (a.speakOn || "9999").localeCompare(b.speakOn || "9999"));
  const speakDue = withClient.filter((i) => i.speakOn && i.speakOn <= today).length;
  const trayAll = visible
    .filter((i) => !suggestedKeys.has(i.key) && !(i.waiting && inTray(i)))
    .filter(inTray)
    .filter((i) => horizon === "all" || !i.deadline || i.deadline <= addDays(today, Number(horizon)))
    .filter((i) => !search || `${i.title} ${i.client}`.toLowerCase().includes(search.toLowerCase()));
  const typeOptions: TypeOption[] = [...trayAll.reduce((m, i) => {
    const k = typeKey(i);
    const o = m.get(k) || { key: k, name: k === "TASK" ? "Tasks" : idx.serviceName.get(k) || i.title, count: 0 };
    o.count++;
    return m.set(k, o);
  }, new Map<string, TypeOption>()).values()].sort((a, b) => a.name.localeCompare(b.name));
  const activeTypes = types.filter((k) => typeOptions.some((o) => o.key === k));
  const unplanned = trayAll
    .filter((i) => !activeTypes.length || activeTypes.includes(typeKey(i)))
    .sort((a, b) => (a.deadline || "9999").localeCompare(b.deadline || "9999"));
  const missed = unplanned.filter((i) => i.planned && i.planned < today);

  const cal = useCalendar();
  const usualHours = (d: string) => settings.hours[String(weekday(d)) as keyof typeof settings.hours] ?? 0;
  const capacity = (d: string) => cal.capacityFor(d, usualHours(d)); // less meetings, when the calendar is connected
  const load = (d: string) => (byDay.get(d) || []).reduce((t, i) => t + i.hours, 0) + preparedLoad(d) + doneOn(d).reduce((t, i) => t + i.hours, 0);
  const suggestedLoad = (d: string) => suggestedOn(d).reduce((t, x) => t + x.item.hours, 0);
  const weekHours = days.reduce((t, d) => t + load(d), 0);
  const weekCapacity = days.reduce((t, d) => t + capacity(d), 0);
  const overDays = days.filter((d) => load(d) > capacity(d)).length;
  const tightPlanned = days.flatMap((d) => byDay.get(d) || []).filter((i) => ["tight", "overdue"].includes(state(i, today))).length;
  const dueSoonUnplanned = items.filter((i) => !i.held && !i.waiting && !i.planned && i.deadline && i.deadline <= addDays(today, 30)).length;

  const say = (text: string, undo?: () => void) => {
    window.clearTimeout(toastTimer.current);
    setToast({ text, undo });
    toastTimer.current = window.setTimeout(() => setToast(undefined), 5000);
  };
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  /** Saves DayOrder (and the moved card's day) for a day's new order, jobs and tasks in their own lists. */
  const saveOrder = async (changes: { item: Item; patch: Row }[]) => {
    const jobs = changes.filter((c) => c.item.kind === "job").map((c) => ({ row: c.item.row, patch: c.patch }));
    const tasks = changes.filter((c) => c.item.kind === "task").map((c) => ({ row: c.item.row, patch: c.patch }));
    if (jobs.length) await updateMany("Jobs", jobs);
    if (tasks.length) await updateMany("Tasks", tasks);
  };

  const move = async (key: string, date?: string, quiet = false, at?: number, kind?: "index" | "time") => {
    const item = items.find((i) => i.key === key);
    if (!item) return;
    if (date && kind === "time" && at !== undefined) return moveToTime(item, date, at, quiet);
    const sameDay = (item.planned || undefined) === date;
    if (sameDay && (!date || at === undefined)) return;
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
      if (!date) {
        await update(list, item.row, { PlannedDate: "", DayOrder: "", StartTime: "" });
      } else {
        // the day's order, with this card where it was dropped (or at the end)
        const dayList = (byDay.get(date) || visible.filter((i) => i.planned === date)).filter((i) => i.key !== key);
        const { changes } = placeInDay(dayList, item, at);
        const undoOrder = changes.map((c) => ({ item: c.item, patch: { DayOrder: c.item.row.DayOrder ?? "", ...(c.item.key === key ? { PlannedDate: before || "", StartTime: c.item.row.StartTime ?? "" } : {}) } }));
        await saveOrder(changes.map((c) => ({ item: c.item, patch: { DayOrder: c.DayOrder, ...(c.item.key === key ? { StartTime: "", ...(!sameDay ? { PlannedDate: date } : {}) } : {}) } })));
        if (!quiet) {
          say(
            sameDay ? `${item.client || item.title}: moved ${at === 0 ? "to the top" : `to number ${(at ?? 0) + 1}`} on ${fmtDate(date, { weekday: true, year: false })}` : `${item.client || item.title}: planned for ${fmtDate(date, { weekday: true, year: false })}`,
            () => saveOrder(undoOrder).then(() => setToast(undefined)),
          );
        }
        return;
      }
      if (!quiet) {
        say(`${item.client || item.title}: back to unplanned`, () => moveRef.current(key, before, true).then(() => setToast(undefined)));
      }
    } catch {
      setError("That move didn't save. It's been put back; try again.");
    }
  };

  /** Dropped on the hours view: planned for that day, set to that time. */
  const moveToTime = async (item: Item, date: string, minutes: number, quiet = false) => {
    const list = item.kind === "job" ? "Jobs" : "Tasks";
    const time = hhmm(minutes);
    const before = { PlannedDate: item.planned || "", StartTime: (item.row.StartTime as string) || "", DayOrder: item.row.DayOrder ?? "" };
    setError(undefined);
    try {
      const patch = { PlannedDate: date, StartTime: time, ...(item.held ? resumePatch(item.row, today) : {}) };
      await update(list, item.row, patch);
      if (!quiet) {
        say(`${item.client || item.title}: ${fmtDate(date, { weekday: true, year: false })} at ${time.replace(/^0/, "")}`,
          item.held ? undefined : () => update(list, item.row, before).then(() => setToast(undefined)));
      }
    } catch {
      setError("That move didn't save. It's been put back; try again.");
    }
  };

  /** A block's edge dragged in the hours view: new length, and maybe a new start time. */
  const resizeItem = async (key: string, change: { hours: number; start?: string }) => {
    const item = items.find((i) => i.key === key);
    if (!item) return;
    const list = item.kind === "job" ? "Jobs" : "Tasks";
    // a job being finalised keeps its finalising time; otherwise it's the job's hours
    const field = item.kind === "job" && item.finalise ? "FinaliseHours" : "EstimateHours";
    const hours = Math.max(0.25, Math.round(change.hours * 4) / 4);
    const before: Row = { [field]: item.row[field] ?? "", StartTime: (item.row.StartTime as string) || "" };
    setError(undefined);
    try {
      await update(list, item.row, { [field]: hours, ...(change.start ? { StartTime: change.start } : {}) });
      say(
        `${item.client || item.title}: ${fmtHours(hours)}${change.start ? `, from ${change.start.replace(/^0/, "")}` : ""}`,
        () => update(list, item.row, before).then(() => setToast(undefined)),
      );
    } catch {
      setError("That change didn't save. Try again.");
    }
  };

  const moveRef = useRef(move);
  moveRef.current = move; // undo runs later, so it needs the latest board

  const { dragKey, target: dropTarget, insertAt, dropKind, cardProps } = useBoardDrag(
    (key, t, at, kind) => move(key, t === "tray" ? undefined : t, false, at, kind),
    (by) => changeWeek(by), // holding a card at the screen edge turns the week
  );

  const runSuggest = (includeWaiting = plan?.includeWaiting ?? false) => {
    const cands: Candidate[] = shownKind.map((i) => ({
      key: i.key, kind: i.kind, hours: i.hours, deadline: i.deadline, urgent: i.urgent, held: i.held,
      planned: i.planned, suggestedSlot: i.kind === "job" && !i.finalise ? ((i.row as Job).SuggestedSlot as string | undefined) : undefined,
      waitingForClient: !!i.waiting, notBefore: i.waiting ? i.speakOn : undefined,
      waitingForRecords: !includeWaiting && i.kind === "job" && waitingForRecords(i.row as Job, data.services, data.stageTemplates),
    }));
    const r = suggestPlan(cands, {
      today, days, capacity: Object.fromEntries(days.map((d) => [d, capacity(d)])), load: Object.fromEntries(days.map((d) => [d, load(d)])),
      fillPct, lookAheadDays: LOOK_AHEAD_DAYS,
    });
    setPlan({ week, ...r, includeWaiting });
  };

  const removeSuggestion = (key: string) =>
    setPlan((p) => (p ? { ...p, suggestions: p.suggestions.filter((s) => s.key !== key) } : p));

  const acceptPlan = async () => {
    if (!activePlan) return;
    setAccepting(true);
    setError(undefined);
    const done: { item: Item; before?: string }[] = [];
    try {
      for (const s of activePlan.suggestions) {
        const item = items.find((i) => i.key === s.key);
        if (!item) continue;
        await update(item.kind === "job" ? "Jobs" : "Tasks", item.row, { PlannedDate: s.day, DayOrder: "" });
        done.push({ item, before: item.planned });
      }
      setPlan(null);
      const hours = done.reduce((t, d) => t + d.item.hours, 0);
      say(`Planned ${done.length} item${done.length === 1 ? "" : "s"} (${fmtHours(hours)})`, () => {
        (async () => {
          for (const d of done) await update(d.item.kind === "job" ? "Jobs" : "Tasks", d.item.row, { PlannedDate: d.before || "" });
          setToast(undefined);
        })();
      });
    } catch {
      setError(`Saved ${done.length} of ${activePlan.suggestions.length}. The rest weren't planned; try again.`);
    } finally {
      setAccepting(false);
    }
  };
  const canSuggest = days.some((d) => d >= today);
  const waitingCount = activePlan?.skipped.filter((s) => s.reason === "Waiting for records").length || 0;
  const noRoomCount = activePlan?.skipped.filter((s) => s.reason !== "Waiting for records").length || 0;

  /** A day's work for the hours view: what's been prepared, the plan in your order, then suggestions. */
  const hourCards = (d: string): HourCard[] => {
    const toCard = (i: Item, extra: Partial<HourCard> = {}): HourCard => {
      const st = state(i, today);
      const subs = i.kind === "task" ? progress(readSubtasks(i.row.Subtasks)) : { done: 0, total: 0 };
      return {
        key: i.key, title: i.title, client: i.client, tag: i.tag, hours: i.hours, task: i.kind === "task",
        svc: i.compliance ? svcClass((i.row as Job).ServiceKey) : "task", start: (i.row.StartTime as string) || undefined,
        flags: [st === "overdue" ? "late" : st === "tight" ? "tight" : "", i.urgent ? "urgent" : ""].filter(Boolean),
        subtasks: subs.total ? `${subs.done}/${subs.total} subtasks` : undefined,
        ...extra,
      };
    };
    return [
      ...preparedOn(d).map((i) => toCard(i, { key: `p-${i.key}`, hours: Number((i.row as Job).PreparedHours) || 0.25, prepared: true, start: undefined, flags: [] })),
      ...(byDay.get(d) || []).map((i) => toCard(i)),
      ...(showDone ? doneOn(d).map((i) => toCard(i, { done: true, flags: [] })) : []),
      ...suggestedOn(d).map(({ s, item }) => toCard(item, { suggested: s.reason, start: undefined })),
    ];
  };

  const dayHeadFor = (d: string) => {
    const used = load(d), cap = capacity(d);
    const over = used > cap;
    const pct = cap ? Math.min(100, Math.round((used / cap) * 100)) : 100;
    const [weekdayName, , monthName] = fmtDate(d, { weekday: true, year: false }).split(" ");
    const meet = cal.meetingsOn(d);
    return (
      <div className={`dhead${d === today ? " today" : ""}${over ? " over" : ""}`}>
        <div className="dhead-date">
          <span className="dhead-num">{Number(d.slice(8))}</span>
          <span className="dhead-names"><strong>{weekdayName}</strong><span>{monthName}</span></span>
        </div>
        <div className="dhead-load">
          <span className="dhead-bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
          <span className="dhead-hours">
            {fmtHours(used) || "0h"} of {fmtHours(cap) || "0h"}
            {over ? <strong> · {fmtHours(used - cap)} over</strong> : null}
          </span>
          {meet > 0 && <span className="dhead-meet">{fmtHours(meet)} in meetings</span>}
        </div>
      </div>
    );
  };

  const card = (i: Item, onDay = false) => (
    <PlanCard
      key={i.key}
      onDay={onDay}
      item={i}
      today={today}
      fields={fields}
      dragging={dragKey === i.key}
      onOpen={() => open(i.kind === "job" ? { kind: "job", key: i.key } : { kind: "task", key: i.key })}
      dragProps={cardProps(i.key)}
    />
  );

  return (
    <div className="plan">
      <section className="plan-head">
        <div className="plan-head-top">
          <PlanTabs current="week" />
          <div className="week-summary" aria-label="This week">
            <div className="ws-load">
              <span className="ws-label">Planned</span>
              <span className="ws-value">{fmtHours(weekHours) || "0h"}<span className="ws-of"> of {fmtHours(weekCapacity)}</span></span>
              <span className="ws-bar" aria-hidden="true">
                <span className={weekHours > weekCapacity ? "over" : ""} style={{ width: `${weekCapacity ? Math.min(100, (weekHours / weekCapacity) * 100) : 0}%` }} />
              </span>
            </div>
            <div className={`ws-stat${overDays ? " red" : ""}`}><span className="ws-num">{overDays}</span><span className="ws-label">day{overDays === 1 ? "" : "s"} over capacity</span></div>
            <div className={`ws-stat${tightPlanned ? " amber" : ""}`}><span className="ws-num">{tightPlanned}</span><span className="ws-label">tight or late</span></div>
            <div className={`ws-stat${dueSoonUnplanned ? " amber" : ""}`}><span className="ws-num">{dueSoonUnplanned}</span><span className="ws-label">due in 30 days, unplanned</span></div>
          </div>
        </div>
        <div className="plan-toolbar">
          <div className="row-wrap week-nav">
            <span className="week-label">{fmtDate(week, { year: false })} – {fmtDate(addDays(week, 4))}</span>
            <span className="week-arrows">
              <button type="button" className="iconbtn" aria-label="Previous week" onClick={() => changeWeek(-1)}><Icon name="left" /></button>
              <button type="button" className="iconbtn" aria-label="Next week" onClick={() => changeWeek(1)}><Icon name="right" /></button>
            </span>
            {week !== mondayOf(today) && <button type="button" className="btn small" onClick={() => setWeek(mondayOf(today))}>This week</button>}
          </div>
          <div className="seg" role="group" aria-label="Show">
            {(["all", "compliance", "other"] as Show[]).map((s) => (
              <button key={s} type="button" aria-pressed={show === s} onClick={() => setShow(s)}>
                {s === "all" ? "All work" : s === "compliance" ? "Compliance" : "Tasks"}
              </button>
            ))}
          </div>
          <div className="seg" role="group" aria-label="View">
            <button type="button" aria-pressed={view === "hours"} onClick={() => setView("hours")}><Icon name="clock" /><span className="tb-text">Hours</span></button>
            <button type="button" aria-pressed={view === "cards"} onClick={() => setView("cards")}><Icon name="list" /><span className="tb-text">Cards</span></button>
          </div>
          <label className="row-wrap show-done" style={{ gap: 6, fontSize: 14 }}>
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} style={{ width: 18, height: 18 }} />
            <span>Completed</span>
          </label>
          {view === "cards" && <CardOptions fields={fields} toggle={toggleField} reset={resetFields} />}
          <div className="toolbar-actions">
            {cal.prefs.enabled ? (
              <button
                type="button"
                className={`btn cal-refresh${cal.state.syncing ? " spinning" : ""}`}
                onClick={() => void cal.sync()}
                disabled={cal.state.syncing}
                title={cal.state.at ? `Calendar updated ${cal.state.at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : "Get the latest from your Outlook calendar"}
              >
                <Icon name="refresh" />
                <span className="tb-text">{cal.state.syncing ? "Refreshing…" : "Refresh calendar"}</span>
                {!cal.state.syncing && cal.state.at && (
                  <span className="muted cal-refresh-at">{cal.state.at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
                )}
              </button>
            ) : (
              <a className="btn" href="#/settings/calendar" title="Connect Outlook to see your meetings in the planner"><Icon name="refresh" />Connect calendar</a>
            )}
            {canSuggest && (
              <button type="button" className="btn" onClick={() => runSuggest()} aria-describedby="suggest-help">
                <Icon name="spark" /><span className="tb-text">Suggest a plan</span>
              </button>
            )}
          </div>
          <span id="suggest-help" className="sr-only">Fills the days left this week from unplanned work. Nothing is saved until you accept.</span>
        </div>
      </section>
      {error && <p className="error-text" role="alert" style={{ padding: "0 24px" }}>{error}</p>}
      {cal.prefs.enabled && cal.state.error && !cal.state.syncing && (
        <p className="error-text" role="alert" style={{ padding: "0 24px", margin: 0 }}>
          Calendar didn't refresh: {cal.state.error} <a href="#/settings/calendar">Calendar settings</a>
        </p>
      )}
      {activePlan && (
        <section className="suggest-bar" aria-label="Suggested plan">
          <div className="stack" style={{ gap: 2 }}>
            <strong>
              {activePlan.suggestions.length
                ? `Suggested ${activePlan.suggestions.length} item${activePlan.suggestions.length === 1 ? "" : "s"} (${fmtHours(activePlan.suggestions.reduce((t, s) => t + (items.find((i) => i.key === s.key)?.hours || 0), 0))}) for the rest of this week`
                : "Nothing to suggest for the rest of this week"}
            </strong>
            <span style={{ fontSize: 13 }}>
              Late work first, then urgent, then the nearest deadline; each day filled to {Math.round(fillPct * 100)}% of your hours.
              Remove any you don't want, then accept.
              {noRoomCount ? ` ${noRoomCount} didn't fit.` : ""}
            </span>
            {(waitingCount > 0 || activePlan.includeWaiting) && (
              <span style={{ fontSize: 13 }}>
                {activePlan.includeWaiting ? "Including work still waiting for records. " : `${waitingCount} left out because the records aren't in yet. `}
                <button type="button" className="linkbtn" style={{ minHeight: 0, padding: 0 }} onClick={() => runSuggest(!activePlan.includeWaiting)}>
                  {activePlan.includeWaiting ? "Leave them out" : "Include them"}
                </button>
              </span>
            )}
          </div>
          <div className="row-wrap">
            <button type="button" className="btn small" onClick={() => setPlan(null)} disabled={accepting}>Clear</button>
            {activePlan.suggestions.length > 0 && (
              <button type="button" className="btn small primary" onClick={acceptPlan} disabled={accepting}>{accepting ? "Planning…" : "Accept all"}</button>
            )}
          </div>
        </section>
      )}

      <div ref={stripRef} className={`daystrip${slide ? ` slide-${slide}` : ""}${stuck ? " stuck" : ""}`} role="group" aria-label="Days this week" {...swipeProps}>
        <span className="daystrip-month" aria-hidden="true">{monthSpan(days[0], days[days.length - 1])}</span>
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
              aria-label={`${fmtDate(d, { weekday: true, year: false })}, ${fmtHours(used) || "0h"} of ${fmtHours(cap)} planned${suggestedLoad(d) ? `, ${fmtHours(suggestedLoad(d))} suggested` : ""}`}
              onClick={() => setPicked(d)}
            >
              <span className="dw">{fmtDate(d, { weekday: true, year: false }).split(" ")[0]}</span>
              <span className="dn">{Number(d.slice(8))}</span>
              <span className="cap" aria-hidden="true"><span className={over ? "over" : ""} style={{ width: `${cap ? Math.min(100, Math.round((used / cap) * 100)) : 100}%` }} /></span>
              <span className={`dh${over ? " over" : ""}`}>{fmtHours(used) || "0h"}{suggestedLoad(d) ? `+${fmtHours(suggestedLoad(d))}` : ""}</span>
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
          <TypeFilter options={typeOptions} selected={types} onChange={setTypes} />
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            {narrow
              ? "Hold a card, or drag its handle, onto a day above to plan it. Hold it at the screen's edge to change week. Tap a card to open it. Swipe the days left or right to change week."
              : "Drag onto a day to plan it, or hold it at the screen's left or right edge to change week. Open a card to pick a date."}
          </p>
          {missed.length > 0 && (
            <p style={{ margin: 0, fontSize: 12, color: "var(--amber-ink)", fontWeight: 600 }}>
              {missed.length} planned on an earlier day but not finished
            </p>
          )}
          {withClient.length > 0 && (
            <details className="wait-list" open={speakDue > 0}>
              <summary>
                With the client ({withClient.length})
                {speakDue > 0 && <span className="chip amber" style={{ marginLeft: 6 }}>{speakDue} to speak to</span>}
              </summary>
              <p className="muted" style={{ margin: "6px 0", fontSize: 12 }}>
                Prepared and waiting for approval. Drag one onto a day to plan the finalising.
              </p>
              <div className="stack held-cards wait-cards" style={{ gap: 8 }}>{withClient.map((i) => card(i))}</div>
            </details>
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
              <div className="stack held-cards" style={{ gap: 8 }}>{held.map((i) => card(i))}</div>
            </details>
          )}
          <div className="tray-list">
            {unplanned.slice(0, 80).map((i) => card(i))}
            {unplanned.length > 80 && <p className="muted" style={{ fontSize: 12 }}>{unplanned.length - 80} more; narrow the dates or search.</p>}
            {!unplanned.length && <p className="muted" style={{ fontSize: 13 }}>Nothing waiting to be planned.</p>}
          </div>
        </aside>

        {view === "hours" ? (
          <HoursView
            days={days}
            today={today}
            shownDay={shownDay}
            narrow={narrow}
            prefs={cal.prefs}
            connected={cal.prefs.enabled}
            cardsFor={hourCards}
            eventsOn={cal.eventsOn}
            busyOn={cal.busyOn}
            dragKey={dragKey}
            dragHours={items.find((i) => i.key === dragKey)?.hours}
            dropTarget={dropTarget}
            insertAt={insertAt}
            dropKind={dropKind}
            cardProps={cardProps as (k: string) => Record<string, unknown>}
            doneMeetings={cal.doneMeetings}
            onToggleMeeting={(id) => void cal.toggleMeetingDone(id).catch(() => setError("That didn't save. Try again."))}
            onOpen={(k) => {
              const it = items.find((i) => i.key === k) || doneItems.find((i) => i.key === k);
              if (it) open(it.kind === "job" ? { kind: "job", key: k } : { kind: "task", key: k });
            }}
            onAdd={(d, time) => open({ kind: "task", plannedDate: d, startTime: time })}
            onResize={resizeItem}
            head={dayHeadFor}
            className={slide ? `slide-${slide}` : ""}
            swipe={narrow ? swipeProps : undefined}
          />
        ) : (
        <div className={`week${slide ? ` slide-${slide}` : ""}`} role="list" aria-label="Week" {...(narrow ? swipeProps : {})}>
          {days.map((d) => {
            const list = byDay.get(d) || [];
            const used = load(d), cap = capacity(d);
            const over = used > cap;
            const pct = cap ? Math.min(100, Math.round((used / cap) * 100)) : 100;
            const sugg = suggestedOn(d);
            const sHours = suggestedLoad(d);
            const sPct = cap ? Math.max(0, Math.min(100 - pct, Math.round((sHours / cap) * 100))) : 0;
            return (
              <div
                key={d}
                role="listitem"
                data-drop={d}
                data-order=""
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
                  <div className="cap" aria-hidden="true" style={{ display: "flex" }}>
                    <span className={over ? "over" : ""} style={{ width: `${pct}%` }} />
                    {sPct > 0 && <span className="sugg" style={{ width: `${sPct}%` }} />}
                  </div>
                  {over && <span style={{ fontSize: 12, fontWeight: 600, color: "var(--red-ink)" }}>{fmtHours(used - cap)} over</span>}
                  {sHours > 0 && <span style={{ fontSize: 12, color: "var(--blue-ink)" }}>+{fmtHours(sHours)} suggested</span>}
                  {cal.meetingsOn(d) > 0 && <span className="muted" style={{ fontSize: 12 }}>Meetings {fmtHours(cal.meetingsOn(d))}</span>}
                </div>
                {preparedOn(d).map((i) => (
                  <PreparedCard key={`p-${i.key}`} item={i} onOpen={() => open({ kind: "job", key: i.key })} />
                ))}
                {(() => {
                  // a line shows where a dragged card will land among the day's cards
                  let n = 0;
                  const out: React.ReactNode[] = [];
                  for (const i of list) {
                    if (i.key !== dragKey) {
                      if (dropTarget === d && insertAt === n) out.push(<div key="drop-line" className="drop-line" aria-hidden="true" />);
                      n++;
                    }
                    out.push(card(i, true));
                  }
                  if (dropTarget === d && dragKey && insertAt === n && list.some((i) => i.key !== dragKey)) out.push(<div key="drop-line" className="drop-line" aria-hidden="true" />);
                  return out;
                })()}
                {showDone && doneOn(d).map((i) => (
                  <PlanCard key={`done-${i.key}`} item={i} today={today} fields={fields} dragging={false}
                    onOpen={() => open(i.kind === "job" ? { kind: "job", key: i.key } : { kind: "task", key: i.key })} />
                ))}
                {sugg.map(({ s, item }) => (
                  <div key={item.key} className="suggest-wrap">
                    <PlanCard
                      item={item}
                      today={today}
                      fields={fields}
                      dragging={false}
                      suggested={s.reason}
                      onOpen={() => open(item.kind === "job" ? { kind: "job", key: item.key } : { kind: "task", key: item.key })}
                    />
                    <button type="button" className="suggest-remove" aria-label={`Don't suggest ${item.client || item.title}`} onClick={() => removeSuggestion(item.key)}>
                      <Icon name="close" size={14} />
                    </button>
                  </div>
                ))}
                {!list.length && !sugg.length && !preparedOn(d).length && !(showDone && doneOn(d).length) && narrow && <p className="muted" style={{ margin: 0, fontSize: 13 }}>Nothing planned yet.</p>}
                <button type="button" className="day-add" onClick={() => open({ kind: "task", plannedDate: d })}>+ Task</button>
              </div>
            );
          })}
        </div>
        )}
      </div>
      {dragKey && (
        <>
          <div className={`week-edge prev${dropTarget === "week-prev" ? " on" : ""}`} data-drop="week-prev" aria-hidden="true">
            <Icon name="left" size={20} /><span>Previous week</span>
          </div>
          <div className={`week-edge next${dropTarget === "week-next" ? " on" : ""}`} data-drop="week-next" aria-hidden="true">
            <span>Next week</span><Icon name="right" size={20} />
          </div>
        </>
      )}
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
  item: i, today, fields, dragging, onOpen, dragProps, suggested, onDay,
}: {
  item: Item; today: string; fields: Set<CardField>; dragging: boolean; onOpen: () => void; dragProps?: DragProps; suggested?: string; onDay?: boolean;
}) {
  const subs = i.kind === "task" ? progress(readSubtasks(i.row.Subtasks)) : { done: 0, total: 0 };
  const st = jobState(i.kind === "task" ? taskAsJob(i.row as Task) : (i.row as Job), today);
  const job = i.kind === "job" ? (i.row as Job) : undefined;
  const on = (f: CardField) => fields.has(f);
  // the first line is the client, or the job when the client is hidden (or there isn't one)
  const showClient = on("client") && !!i.client;
  const head = showClient ? i.client : on("job") || !i.client ? i.title : i.client;
  const sub = [
    showClient && on("job") ? i.title : "",
    on("period") && job?.PeriodEnd ? `to ${fmtDate(job.PeriodEnd, { year: false })}` : "",
  ].filter(Boolean).join(" · ");
  const flags = on("flags") && !i.done && (i.urgent || (!i.held && (st.state === "overdue" || st.state === "tight")) || (i.planned && i.planned < today));
  const showDeadline = on("deadline") && !!i.deadline;
  return (
    <button
      type="button"
      className={`pcard ${i.compliance ? svcClass((i.row as Job).ServiceKey) : "task"}${i.done ? " done" : ""}${i.held ? " held" : ""}${dragging ? " dragging" : ""}${suggested !== undefined ? " suggested" : ""}`}
      {...(dragProps || {})}
      {...(onDay ? { "data-card": i.key } : {})}
      onClick={onOpen}
      aria-label={`${i.done ? "Completed: " : suggested !== undefined ? "Suggested: " : ""}${i.title}${i.client ? ", " + i.client : ""}${i.stage ? ", stage: " + i.stage : ""}${i.deadline ? ", due " + fmtDate(i.deadline) : ""}${i.note ? ". Note: " + i.note : ""}. Open to edit.`}
    >
      {(on("type") || on("hours") || dragProps) && (
        <span className="pcard-top">
          {on("type") ? <span className="pcard-tag">{i.tag}</span> : <span />}
          <span className="row-wrap" style={{ gap: 6, flexWrap: "nowrap" }}>
            {on("hours") && <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>{fmtHours(i.hours)}</span>}
            {dragProps && <span className="pcard-grip" aria-hidden="true" title="Drag to plan"><Icon name="grip" /></span>}
          </span>
        </span>
      )}
      {i.done && <span className="pcard-done"><Icon name="check" size={12} />Completed{i.doneOn ? ` ${fmtDate(i.doneOn, { weekday: true, year: false })}` : ""}</span>}
      <span className="pcard-client">{head}</span>
      {sub && <span className="pcard-sub">{sub}</span>}
      {on("stage") && i.stage && (
        <span className="pcard-stage">
          <span className="pcard-stage-dot" aria-hidden="true" />
          <span className="pcard-stage-name">{i.stage}</span>
          {i.stageCount ? <span className="pcard-stage-of">{i.stageNo}/{i.stageCount}</span> : null}
        </span>
      )}
      {on("records") && job && !i.done && (
        <span className={`pcard-records ${i.recordsIn ? "in" : "out"}`}>{i.recordsIn ? `Records in ${fmtDate(job.RecordsReceived!, { year: false })}` : "Records not in yet"}</span>
      )}
      {on("note") && i.note && <span className="pcard-note">{i.note}</span>}
      {on("elements") && i.elements && (
        // inside a button, so a span that behaves as a link rather than a nested <a>
        <span role="link" tabIndex={0} className="elements-link" title="Open this client in Iris Elements"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); window.open(i.elements, "_blank", "noopener,noreferrer"); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); e.preventDefault(); window.open(i.elements, "_blank", "noopener,noreferrer"); } }}>
          Elements<span aria-hidden="true"> ↗</span>
        </span>
      )}
      {on("subtasks") && subs.total > 0 && (
        <span className={`pcard-subtasks${subs.done === subs.total ? " all" : ""}`}>
          <span className="pcard-subbar" aria-hidden="true"><span style={{ width: `${(subs.done / subs.total) * 100}%` }} /></span>
          <span>{subs.done}/{subs.total} subtasks</span>
        </span>
      )}
      {i.waiting && (
        <span className="pcard-wait">
          <span className="chip wait">With the client</span>
          <WaitWhen item={i} today={today} />
        </span>
      )}
      {i.finalise && !i.waiting && (
        <span className="pcard-wait"><span className="chip wait">Ready to finalise</span></span>
      )}
      {suggested !== undefined && (
        <span className="pcard-suggest"><span className="chip blue">Suggested</span>{suggested && <span>{suggested}</span>}</span>
      )}
      {i.held && (
        <span className="pcard-foot">
          <span className="chip hold">On hold</span>
          {(i.row.HoldReason as string) && <span style={{ fontSize: 12 }}>{i.row.HoldReason as string}</span>}
        </span>
      )}
      {(showDeadline || flags) && (
        <span className="pcard-foot">
          {showDeadline && <span className="mono" style={{ fontSize: 12 }}>Due {fmtDate(i.deadline!, { year: i.deadline!.slice(0, 4) !== today.slice(0, 4) })}</span>}
          {on("flags") && i.urgent && <span className="chip red">Urgent</span>}
          {on("flags") && !i.held && st.state === "overdue" && <span className="chip red">{-st.days!}d late</span>}
          {on("flags") && !i.held && st.state === "tight" && <span className="chip amber">Tight · {st.days}d</span>}
          {on("flags") && i.planned && i.planned < today && <span className="chip amber">Planned {fmtDate(i.planned, { year: false })}</span>}
        </span>
      )}
    </button>
  );
}

/** "October 2026", or "October – November 2026" for a week that crosses months. */
export function monthSpan(from: string, to: string): string {
  const name = (iso: string, year: boolean) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" });
  if (from.slice(0, 7) === to.slice(0, 7)) return name(from, true);
  return from.slice(0, 4) === to.slice(0, 4) ? `${name(from, false)} – ${name(to, true)}` : `${name(from, true)} – ${name(to, true)}`;
}

function WaitWhen({ item: i, today }: { item: Item; today: string }) {
  const st = waitState(i.row, today);
  if (st === "nodate") return <span>no date to speak yet</span>;
  if (st === "today") return <span className="chip amber">Speaking today</span>;
  if (st === "passed") return <span className="chip amber">Spoke {fmtDate(i.speakOn!, { year: false })}?</span>;
  return <span>speaking {fmtDate(i.speakOn!, { weekday: true, year: false })}</span>;
}

/** The preparing part of a job, done on this day; the job itself is with the client or being finalised. */
function PreparedCard({ item: i, onOpen }: { item: Item; onOpen: () => void }) {
  const job = i.row as Job;
  const hours = Number(job.PreparedHours) || 0;
  return (
    <button type="button" className={`pcard prepared ${svcClass(job.ServiceKey)}`} onClick={onOpen}
      aria-label={`Prepared: ${i.title}${i.client ? ", " + i.client : ""}. Open the job.`}>
      <span className="pcard-top">
        <span className="pcard-tag"><Icon name="check" size={12} /> Prepared</span>
        {hours > 0 && <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>{fmtHours(hours)}</span>}
      </span>
      <span className="pcard-client">{i.client || i.title}</span>
      <span className="pcard-sub">{i.client ? job.Title : ""}{i.waiting ? `${i.client ? " · " : ""}with the client` : ""}</span>
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
