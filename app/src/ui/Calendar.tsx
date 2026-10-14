// Outlook calendar in the app: reads your meetings (so each day's hours reflect them, and the
// planner's hours view shows them). Optionally (off unless turned on) keeps a block in your
// calendar for each piece of planned work. Settings › Calendar.
import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { addScope, hasExtraScope, refreshNow } from "../lib/auth";
import {
  CAL_SCOPE, CalEvent, CalendarPrefs, DEFAULT_CAL, PlannedItem, applyChanges, busyOn, capacityOn, diffBlocks, fetchEvents, layoutBlocks,
  meetingHours, readDays, windowDays,
} from "../lib/calendar";
import { Job, Task, fmtDate, fmtHours, isOnHold, isOpen, todayIso } from "../lib/domain";
import { GraphError } from "../lib/graph";
import { planHours } from "../lib/waiting";
import { dayRank } from "../lib/dayOrder";
import { friendlyError } from "../lib/sharepoint";
import { readSetting, useData } from "./data";

type CalState = { syncing: boolean; at?: Date; error?: string; needsConsent?: boolean; changed?: number; unfitted: string[] };
type Ctx = {
  prefs: CalendarPrefs;
  state: CalState;
  events: CalEvent[] | null;
  /** Hours you have on a day, after meetings (your usual hours if the calendar isn't on). */
  capacityFor: (day: string, usual: number) => number;
  meetingsOn: (day: string) => number;
  /** Your own calendar events on a day (not the planner's blocks), for the hours view. */
  eventsOn: (day: string) => CalEvent[];
  /** Busy time on a day, as minutes from midnight (empty if the calendar isn't on). */
  busyOn: (day: string) => [number, number][];
  /** Meetings you have ticked off in the planner (this stays in the planner; Outlook isn't changed). */
  doneMeetings: Set<string>;
  toggleMeetingDone: (id: string) => Promise<void>;
  sync: () => Promise<void>;
  savePrefs: (p: Partial<CalendarPrefs>) => Promise<void>;
  connect: () => Promise<void>;
  disconnect: (removeBlocks: boolean) => Promise<void>;
};

const CalCtx = createContext<Ctx | null>(null);

export function CalendarProvider({ demo, children }: { demo: boolean; children: ReactNode }) {
  const ctx = useData();
  const latest = useRef(ctx);
  latest.current = ctx;
  const prefs = useMemo<CalendarPrefs>(
    () => ({ ...DEFAULT_CAL, ...(readSetting<Partial<CalendarPrefs>>(ctx.data.settings, "calendar") || {}) }),
    [ctx.data.settings],
  );
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const [events, setEvents] = useState<CalEvent[] | null>(null);
  const [state, setState] = useState<CalState>({ syncing: false, unfitted: [] });
  const running = useRef(false);
  const again = useRef(false);

  const today = todayIso();
  const days = useMemo(() => windowDays(today), [today]);
  const shown = useMemo(() => readDays(today), [today]); // meetings are read from this Monday on

  /** Planned work in the next four weeks, in the order it should sit in each day. */
  const planned = useMemo((): PlannedItem[] => {
    const { data } = ctx;
    const clientName = (k?: string) => (k && data.clients.find((c) => c.Key === k)?.Title) || "";
    const from = days[0], to = days[days.length - 1];
    const inWindow = (d?: string) => !!d && d >= from && d <= to;
    const rows: { item: PlannedItem; urgent: boolean; due: string; rank: number }[] = [];
    for (const j of data.jobs as Job[]) {
      if (!isOpen(j) || isOnHold(j) || !inWindow(j.PlannedDate)) continue;
      const name = clientName(j.ClientKey) || (j.ClientName as string) || "";
      rows.push({
        item: { key: j.Key, day: j.PlannedDate!, hours: planHours(j, data.services), subject: `${name ? `${name}: ` : ""}${j.Title}`, note: j.Deadline ? `Due ${fmtDate(j.Deadline)}` : "" },
        urgent: j.Priority === "urgent", due: j.Deadline || "9999", rank: dayRank(j),
      });
    }
    for (const t of data.tasks as Task[]) {
      if (!isOpen(t) || isOnHold(t) || !inWindow(t.PlannedDate)) continue;
      const name = clientName(t.ClientKey);
      rows.push({
        item: { key: t.Key, day: t.PlannedDate!, hours: t.EstimateHours || 1, subject: `${name ? `${name}: ` : ""}${t.Title}`, note: t.DueDate ? `Due ${fmtDate(t.DueDate)}` : "" },
        urgent: false, due: t.DueDate || "9999", rank: dayRank(t),
      });
    }
    // the order you've set for each day, then urgent, then nearest deadline
    rows.sort((a, b) => a.item.day.localeCompare(b.item.day) || (a.rank === b.rank ? 0 : a.rank < b.rank ? -1 : 1) || Number(b.urgent) - Number(a.urgent) || a.due.localeCompare(b.due));
    return rows.map((r) => r.item);
  }, [ctx, days]);
  const plannedSig = JSON.stringify(planned.map((p) => [p.key, p.day, p.hours, p.subject]));
  const plannedRef = useRef(planned);
  plannedRef.current = planned;

  const sync = useCallback(async () => {
    const p = prefsRef.current;
    if (!p.enabled) return;
    if (running.current) {
      again.current = true;
      return;
    }
    running.current = true;
    setState((s) => ({ ...s, syncing: true, error: undefined }));
    try {
      const graph = latest.current.store.graph;
      const from = days[0], to = days[days.length - 1];
      const readFrom = shown[0], readTo = shown[shown.length - 1];
      let evs = await fetchEvents(graph, readFrom, readTo);
      let changed = 0;
      let unfitted: string[] = [];
      if (p.writeBlocks) {
        const busy = Object.fromEntries(days.map((d) => [d, p.readMeetings ? busyOn(d, evs) : []]));
        const layout = layoutBlocks(plannedRef.current, p, busy);
        unfitted = layout.unfitted;
        const diff = diffBlocks(layout.blocks, evs, from);
        changed = await applyChanges(graph, diff, p);
        if (changed) evs = await fetchEvents(graph, readFrom, readTo);
      } else {
        // blocks turned off: take the planner's future blocks back out
        const diff = diffBlocks([], evs, from);
        changed = await applyChanges(graph, diff, p);
        if (changed) evs = await fetchEvents(graph, readFrom, readTo);
      }
      void to;
      setEvents(evs);
      setState({ syncing: false, at: new Date(), changed, unfitted });
    } catch (e) {
      const consent = e instanceof GraphError && (e.status === 401 || e.status === 403);
      setState((s) => ({
        ...s, syncing: false,
        needsConsent: consent,
        error: consent ? "The planner doesn't have permission to use your calendar yet." : friendlyError(e),
      }));
    } finally {
      running.current = false;
      if (again.current) {
        again.current = false;
        void sync();
      }
    }
  }, [days, shown]);

  // Kevin asked (13 Oct 2026) for planned work not to go into Outlook: turn blocks off once;
  // the next sync takes the planner's blocks back out. It can be turned back on in Settings.
  useEffect(() => {
    if (ctx.status !== "ready" || !prefs.writeBlocks || readSetting(ctx.data.settings, "calendar.blocksOff")) return;
    void (async () => {
      await latest.current.saveSetting("calendar", { ...prefsRef.current, writeBlocks: false });
      await latest.current.saveSetting("calendar.blocksOff", { on: todayIso() });
    })().catch(() => undefined);
  }, [ctx.status, prefs.writeBlocks, ctx.data.settings]);

  // on a device that hasn't asked for calendar access yet, ask quietly (no sign-in screen)
  useEffect(() => {
    if (ctx.status !== "ready" || !prefs.enabled || demo || hasExtraScope(CAL_SCOPE)) return;
    addScope(CAL_SCOPE).then(() => refreshNow()).then(() => sync()).catch(() => setState((s) => ({ ...s, needsConsent: true, error: "Sign in again to let the planner use your calendar." })));
  }, [ctx.status, prefs.enabled, demo, sync]);

  // keep in step: when the plan changes (after a pause), on opening, and when you come back to the tab
  useEffect(() => {
    if (ctx.status !== "ready" || !prefs.enabled) return;
    if (!demo && !hasExtraScope(CAL_SCOPE)) return;
    const t = window.setTimeout(() => void sync(), events ? 2500 : 300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.status, prefs.enabled, prefs.writeBlocks, prefs.readMeetings, prefs.dayStart, prefs.dayEnd, prefs.lunchStart, prefs.lunchMins, prefs.showAs, plannedSig, sync]);
  useEffect(() => {
    const onShow = () => document.visibilityState === "visible" && prefsRef.current.enabled && void sync();
    document.addEventListener("visibilitychange", onShow);
    const every = window.setInterval(() => prefsRef.current.enabled && document.visibilityState === "visible" && void sync(), 10 * 60 * 1000);
    return () => {
      document.removeEventListener("visibilitychange", onShow);
      window.clearInterval(every);
    };
  }, [sync]);

  const busyCache = useMemo(() => {
    const m = new Map<string, ReturnType<typeof busyOn>>();
    if (events) for (const d of shown) m.set(d, busyOn(d, events));
    return m;
  }, [events, shown]);
  const eventsOn = useCallback(
    (day: string) => {
      if (!prefs.enabled || !events) return [];
      const start = new Date(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)).getTime();
      const end = start + 86400000;
      return events.filter((e) => !e.block && !e.cancelled && e.end.getTime() > start && e.start.getTime() < end);
    },
    [events, prefs.enabled],
  );
  const busyFor = useCallback((day: string) => (prefs.enabled && prefs.readMeetings ? busyCache.get(day) || [] : []), [prefs, busyCache]);

  const capacityFor = useCallback(
    (day: string, usual: number) => {
      if (!prefs.enabled || !prefs.readMeetings || !busyCache.has(day)) return usual;
      return capacityOn(usual, prefs, busyCache.get(day)!);
    },
    [prefs, busyCache],
  );
  const meetingsOn = useCallback(
    (day: string) => (prefs.enabled && prefs.readMeetings && busyCache.has(day) ? meetingHours(prefs, busyCache.get(day)!) : 0),
    [prefs, busyCache],
  );

  // ticked-off meetings: event id -> the day it was ticked. Kept in settings, not in Outlook; old ones drop off.
  const doneMap = useMemo(() => readSetting<Record<string, string>>(ctx.data.settings, "calendar.done") || {}, [ctx.data.settings]);
  const doneRef = useRef(doneMap);
  doneRef.current = doneMap;
  const doneMeetings = useMemo(() => new Set(Object.keys(doneMap)), [doneMap]);
  const toggleMeetingDone = useCallback(async (id: string) => {
    const next = { ...doneRef.current };
    if (next[id]) delete next[id];
    else next[id] = todayIso();
    const cutoff = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    for (const k of Object.keys(next)) if (next[k] < cutoff) delete next[k];
    doneRef.current = next;
    await latest.current.saveSetting("calendar.done", next);
  }, []);

  const savePrefs = useCallback(async (p: Partial<CalendarPrefs>) => {
    await latest.current.saveSetting("calendar", { ...prefsRef.current, ...p });
  }, []);

  const connect = useCallback(async () => {
    await latest.current.saveSetting("calendar", { ...prefsRef.current, enabled: true });
    if (!demo) await addScope(CAL_SCOPE, true); // Microsoft asks you to allow calendar access
  }, [demo]);

  const disconnect = useCallback(async (removeBlocks: boolean) => {
    if (removeBlocks) {
      try {
        const graph = latest.current.store.graph;
        const evs = await fetchEvents(graph, days[0], days[days.length - 1]);
        await applyChanges(graph, diffBlocks([], evs, days[0]), prefsRef.current);
      } catch {
        /* turn it off anyway */
      }
    }
    await latest.current.saveSetting("calendar", { ...prefsRef.current, enabled: false });
    setEvents(null);
    setState({ syncing: false, unfitted: [] });
  }, [days]);

  const value = useMemo(
    () => ({ prefs, state, events, capacityFor, meetingsOn, eventsOn, busyOn: busyFor, doneMeetings, toggleMeetingDone, sync, savePrefs, connect, disconnect }),
    [prefs, state, events, capacityFor, meetingsOn, eventsOn, busyFor, doneMeetings, toggleMeetingDone, sync, savePrefs, connect, disconnect],
  );
  return <CalCtx.Provider value={value}>{children}</CalCtx.Provider>;
}

export function useCalendar(): Ctx {
  const c = useContext(CalCtx);
  if (!c) throw new Error("useCalendar must be inside CalendarProvider");
  return c;
}

// ------------------------------------------------------------------ settings

export function CalendarSettings() {
  const { prefs, state, sync, savePrefs, connect, disconnect, events, meetingsOn } = useCalendar();
  const { data } = useData();
  const [draft, setDraft] = useState(prefs);
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(prefs), [prefs]);
  const changed = JSON.stringify(draft) !== JSON.stringify(prefs);
  const today = todayIso();
  const blocks = (events || []).filter((e) => e.block).length;
  const meetingsThisWeek = windowDays(today).slice(0, 7).reduce((t, d) => t + meetingsOn(d), 0);
  const nameOf = (k: string) => data.jobs.find((j) => j.Key === k)?.Title || data.tasks.find((t) => t.Key === k)?.Title || k;
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  };

  if (!prefs.enabled) {
    return (
      <section className="card pad stack" aria-labelledby="cal-h" style={{ maxWidth: 720 }}>
        <h2 id="cal-h">Outlook calendar</h2>
        <p style={{ margin: 0 }}>Connect your Outlook calendar and the planner will:</p>
        <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.6 }}>
          <li>take your meetings off each day's hours, so the plan and "Suggest a plan" use the time you really have</li>
          <li>show your meetings in the planner's hours view, in their own colour</li>
        </ul>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Microsoft will ask you to allow the planner to use your calendar. Your events are only read. Planned work isn't put in your
          calendar unless you turn that on below.
        </p>
        <div><button type="button" className="btn primary" disabled={busy} onClick={() => run(connect)}>Connect Outlook calendar</button></div>
      </section>
    );
  }

  return (
    <div className="stack" style={{ gap: 16, maxWidth: 720 }}>
      <section className="card pad stack" aria-labelledby="cal-h">
        <div className="card-title-row">
          <h2 id="cal-h">Outlook calendar</h2>
          <div className="row-wrap">
            <button type="button" className="btn" disabled={busy || state.syncing} onClick={() => run(sync)}>{state.syncing ? "Syncing…" : "Sync now"}</button>
          </div>
        </div>
        <p role="status" style={{ margin: 0, fontSize: 14 }}>
          {state.at ? <>Last synced <strong>{state.at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</strong></> : state.syncing ? "Syncing…" : "Not synced yet"}
          {events ? ` · ${fmtHours(meetingsThisWeek) || "0h"} of meetings in the next 7 days · ${blocks} planner block${blocks === 1 ? "" : "s"} in the next 4 weeks` : ""}
        </p>
        {state.unfitted.length > 0 && (
          <div className="alert amber">
            <strong>{state.unfitted.length} planned item{state.unfitted.length === 1 ? "" : "s"} didn't fit in the working day</strong>
            <span>They're still planned, but have no calendar block: {state.unfitted.slice(0, 6).map(nameOf).join(", ")}{state.unfitted.length > 6 ? "…" : ""}</span>
          </div>
        )}
        {state.error && (
          <div className="alert red" role="alert">
            <strong>{state.error}</strong>
            {state.needsConsent && (
              <span>
                <button type="button" className="linkbtn" style={{ minHeight: 0, padding: 0 }} onClick={() => run(connect)}>Connect again</button>
                {" "}and accept Microsoft's request to use your calendar.
              </span>
            )}
          </div>
        )}
      </section>

      <section className="card pad stack" aria-labelledby="cal-o">
        <h2 id="cal-o">How it works</h2>
        <label className="radio">
          <input type="checkbox" checked={draft.readMeetings} onChange={(e) => setDraft({ ...draft, readMeetings: e.target.checked })} />
          <span>Meetings reduce my hours for the day (anything shown as busy, tentative or out of office)</span>
        </label>
        <label className="radio">
          <input type="checkbox" checked={draft.writeBlocks} onChange={(e) => setDraft({ ...draft, writeBlocks: e.target.checked })} />
          <span>Also put planned work in my calendar as time blocks (off: your calendar only has your own events)</span>
        </label>
        <div className="form" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
          <label>Day starts<input className="input" type="time" value={draft.dayStart} onChange={(e) => setDraft({ ...draft, dayStart: e.target.value })} /></label>
          <label>Day ends<input className="input" type="time" value={draft.dayEnd} onChange={(e) => setDraft({ ...draft, dayEnd: e.target.value })} /></label>
          <label>Lunch at<input className="input" type="time" value={draft.lunchStart} onChange={(e) => setDraft({ ...draft, lunchStart: e.target.value })} /></label>
          <label>Lunch (minutes)<input className="input" type="number" min="0" max="180" step="15" value={draft.lunchMins} onChange={(e) => setDraft({ ...draft, lunchMins: Math.max(0, Number(e.target.value) || 0) })} /></label>
          <label>
            Show blocks as
            <select className="input" value={draft.showAs} onChange={(e) => setDraft({ ...draft, showAs: e.target.value as CalendarPrefs["showAs"] })}>
              <option value="busy">Busy</option>
              <option value="tentative">Tentative</option>
              <option value="free">Free</option>
            </select>
          </label>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Blocks are placed from the start of the day in order (urgent first, then the nearest deadline), around lunch and meetings,
          for the next four weeks. Days before today are left alone.
        </p>
        <div className="form-actions" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <button type="button" className="linkbtn" disabled={busy}
            onClick={() => window.confirm("Turn off the calendar link and remove the planner's blocks from the next four weeks?") && run(() => disconnect(true))}>
            Turn off and remove the planner's blocks
          </button>
          <button type="button" className="btn primary" disabled={!changed || busy} onClick={() => run(() => savePrefs(draft))}>Save</button>
        </div>
      </section>
    </div>
  );
}
