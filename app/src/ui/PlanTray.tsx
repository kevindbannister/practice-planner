// The tray of unplanned work, shared by the Week view and the Month view so they list, filter and show the same cards.
import React, { PointerEvent as ReactPointerEvent, ReactNode, useMemo, useState } from "react";
import { Job, Task, fmtDate, fmtHours, holdAlert, holdLabel, isOnHold, jobState } from "../lib/domain";
import { addDays, plannedLate } from "../lib/planning";
import { Icon } from "./bits";
import { elementsUrl } from "../lib/elements";
import { categoryOf, isBusinessTask } from "../lib/projects";
import { useData, useIndex } from "./data";
import { taskAsJob } from "./Editors";
import { TypeFilter, TypeOption, useRememberedTypes } from "./TypeFilter";
import { svcClass } from "../lib/serviceColour";
import { stageLabel } from "../lib/stages";
import { progress, readSubtasks } from "../lib/subtasks";
import { inFinalise, planHours, waitState, waitingForClient } from "../lib/waiting";
import { CardField } from "./CardOptions";
import { Horizon, inHorizon } from "../lib/trayFilter";

export type { Horizon };

export type Item = {
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
  business?: boolean; // a task of a business project: counts against business hours, not client capacity
  cat?: string; // its category colour
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

export function state(i: Item, today: string) {
  return jobState((i.kind === "task" ? taskAsJob(i.row as Task) : (i.row as Job)), today).state;
}

export type DragProps = {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onContextMenu: (e: { preventDefault: () => void }) => void;
  onClickCapture: (e: { preventDefault: () => void; stopPropagation: () => void }) => void;
};

export function PlanCard({
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
    on("period") && job?.PeriodEnd ? `Period to ${fmtDate(job.PeriodEnd)}` : "",
  ].filter(Boolean).join(" · ");
  const flags = on("flags") && !i.done && (i.urgent || (!i.held && (st.state === "overdue" || st.state === "tight")) || (i.planned && i.planned < today));
  const late = !i.done ? plannedLate(i.row) : null; // planned for a day after its deadline
  const showDeadline = on("deadline") && !!i.deadline;
  return (
    <button
      type="button"
      style={i.business ? ({ ["--cat" as string]: i.cat } as React.CSSProperties) : undefined}
      className={`pcard ${i.compliance ? svcClass((i.row as Job).ServiceKey) : "task"}${i.business ? " biz" : ""}${i.done ? " done" : ""}${i.held ? " held" : ""}${late ? " planned-late" : ""}${dragging ? " dragging" : ""}${suggested !== undefined ? " suggested" : ""}${!i.done && !i.held && i.planned && i.planned < today ? " missed" : ""}`}
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
          <span className="chip hold">{holdLabel(i.row)}</span>
          {(i.row.HoldReason as string) && <span style={{ fontSize: 12 }}>{i.row.HoldReason as string}</span>}
        </span>
      )}
      {late && <span className="pcard-foot"><span className="chip red" title={`Planned for ${fmtDate(late.planned, { weekday: true, year: false })}, but due ${fmtDate(late.deadline, { weekday: true, year: false })}`}>Planned {late.days}d after the deadline</span></span>}
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

function WaitWhen({ item: i, today }: { item: Item; today: string }) {
  const st = waitState(i.row, today);
  if (st === "nodate") return <span>no date to speak yet</span>;
  if (st === "today") return <span className="chip amber">Speaking today</span>;
  if (st === "passed") return <span className="chip amber">Spoke {fmtDate(i.speakOn!, { year: false })}?</span>;
  return <span>speaking {fmtDate(i.speakOn!, { weekday: true, year: false })}</span>;
}

function shortTag(service?: string, name?: string): string {
  const map: Record<string, string> = {
    ACCS_LTD: "Accounts", ACCS_LLP: "LLP accounts", CT600: "CT600", CS01: "CS01", VAT: "VAT", SA100: "Self Assessment",
    SA800: "SA800", PAYROLL: "Payroll", MGMT_ACCOUNTS: "Mgmt accounts", BOOKKEEPING: "Bookkeeping", MYS: "MYS",
    ONBOARDING: "Onboarding", TASK: "Task",
  };
  return map[service || ""] || name || "Job";
}

/** Every open job and task as a card item. */
export function usePlanItems() {
  const { data } = useData();
  const idx = useIndex();
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
  const mapTask = (t: Task): Item => {
    const proj = isBusinessTask(t) ? data.projects.find((p) => p.Key === t.ProjectKey) : undefined;
    const cat = proj ? categoryOf(proj) : isBusinessTask(t) ? categoryOf({}) : undefined;
    return {
      kind: "task", key: t.Key, row: t, title: t.Title,
      client: proj ? String(proj.Title) : (t.ClientKey && idx.clientByKey.get(t.ClientKey)?.Title) || "",
      tag: cat ? cat.name : t.Type || "Task", hours: t.EstimateHours || 1, planned: t.PlannedDate, deadline: t.DueDate,
      urgent: false, compliance: false, held: isOnHold(t), note: (t.CardNote as string) || "",
      business: isBusinessTask(t), cat: cat?.colour,
    };
  };
  const items: Item[] = useMemo(() => [...idx.openJobs.map(mapJob), ...idx.openTasks.map(mapTask)], [idx, data.services, data.projects]); // eslint-disable-line react-hooks/exhaustive-deps
  return { items, mapJob, mapTask };
}

const typeKey = (i: Item) => (i.kind === "task" ? "TASK" : (i.row as Job).ServiceKey || "OTHER");

/**
 * What the tray lists, with its own filters (due within, search, type of work). `items` is the work to choose from (already narrowed to
 * client or other work, if that is being filtered), `inTray` says which of it has no day, and `suggestedKeys` are held back as suggestions.
 */
export function usePlanTray({ items, today, inTray, suggestedKeys }: { items: Item[]; today: string; inTray: (i: Item) => boolean; suggestedKeys?: Set<string> }) {
  const idx = useIndex();
  // the due-date choice is remembered on this device until it is changed again (as are the type filter and the records toggle)
  const remembered = <T extends string>(key: string, fallback: T, ok: (v: string) => boolean) => () => { try { const v = localStorage.getItem(key); return v !== null && ok(v) ? (v as T) : fallback; } catch { return fallback; } };
  const keep = (key: string, v: string) => { try { localStorage.setItem(key, v); } catch { /* this visit only */ } };
  const [horizon, setHorizonState] = useState<Horizon>(remembered<Horizon>("pp.plan.horizon", "90", (v) => ["30", "90", "all", "days", "date"].includes(v)));
  const [days, setDaysState] = useState(remembered<string>("pp.plan.horizonDays", "45", (v) => /^\d{0,4}$/.test(v)));
  const [until, setUntilState] = useState(remembered<string>("pp.plan.horizonUntil", "", (v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v)));
  const setHorizon = (v: Horizon) => { setHorizonState(v); keep("pp.plan.horizon", v); };
  const setDays = (v: string) => { setDaysState(v); keep("pp.plan.horizonDays", v); };
  const setUntil = (v: string) => { setUntilState(v); keep("pp.plan.horizonUntil", v); };
  const [withRecords, setWithRecordsState] = useState(() => { try { return localStorage.getItem("pp.plan.withRecords") === "1"; } catch { return false; } });
  const setWithRecords = (v: boolean) => { setWithRecordsState(v); try { localStorage.setItem("pp.plan.withRecords", v ? "1" : "0"); } catch { /* this visit only */ } };
  const [search, setSearch] = useState("");
  const [types, setTypes] = useRememberedTypes("pp.plan.types");
  const skip = suggestedKeys || new Set<string>();
  const visible = items.filter((i) => !i.held); // on-hold work is off the board
  const held = items
    .filter((i) => i.held)
    .sort((a, b) => (a.deadline || "9999").localeCompare(b.deadline || "9999"));

  // with the client and not planned yet: their own group, soonest conversation first
  const withClient = visible
    .filter((i) => i.waiting && inTray(i) && !skip.has(i.key))
    .sort((a, b) => (a.speakOn || "9999").localeCompare(b.speakOn || "9999"));
  const speakDue = withClient.filter((i) => i.speakOn && i.speakOn <= today).length;
  const trayAll = visible
    .filter((i) => !skip.has(i.key) && !(i.waiting && inTray(i)))
    .filter(inTray)
    .filter((i) => inHorizon(i, { horizon, days, until, withRecords }, today))
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
  return { horizon, setHorizon, days, setDays, until, setUntil, withRecords, setWithRecords, search, setSearch, types, setTypes, held, withClient, speakDue, typeOptions, unplanned, today };
}

export type Tray = ReturnType<typeof usePlanTray>;

/** The Unplanned panel: filters, the groups waiting on the client or on hold, and the list. Each card is drawn by `card`. */
export function UnplannedTray({ tray, today, narrow, dropOver, card, wide }: { tray: Tray; today: string; narrow: boolean; dropOver: boolean; card: (i: Item) => ReactNode; wide?: boolean }) {
  return (
<aside className={`tray${dropOver ? " drop" : ""}`} aria-label="Unplanned work" data-drop="tray" style={wide ? { maxWidth: "none" } : undefined}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <h2 className="sec-h">Unplanned <span className="muted" style={{ fontWeight: 500 }}>({tray.unplanned.length})</span></h2>
        <label>
          <span className="sr-only">Due within</span>
          <select className="input" value={tray.horizon} onChange={(e) => tray.setHorizon(e.target.value as Horizon)} style={{ minHeight: 36, padding: "4px 8px", width: "auto", fontSize: 13 }}>
            <option value="30">Due in 30 days</option>
            <option value="90">Due in 90 days</option>
            <option value="days">Due in a number of days…</option>
            <option value="date">Due by a date…</option>
            <option value="all">Everything</option>
          </select>
        </label>
      </div>
      {(tray.horizon === "days" || tray.horizon === "date") && (
        <div className="row-wrap" style={{ gap: 6, alignItems: "center" }}>
          {tray.horizon === "days" ? (
            <label className="row-wrap" style={{ gap: 6, fontSize: 13 }}>Due within
              <input className="input" type="number" inputMode="numeric" min={0} max={3650} step={1} value={tray.days} aria-label="Number of days" onChange={(e) => tray.setDays(e.target.value)} style={{ width: 80, minHeight: 34, padding: "2px 8px" }} />
              days</label>
          ) : (
            <label className="row-wrap" style={{ gap: 6, fontSize: 13 }}>Due on or before
              <input className="input" type="date" value={tray.until} aria-label="Due on or before" onChange={(e) => tray.setUntil(e.target.value)} style={{ minHeight: 34, padding: "2px 8px", width: "auto" }} />
            </label>
          )}
        </div>
      )}
      <label className="row-wrap" style={{ gap: 6, fontSize: 13 }} title="Show jobs we already have the records for, even when their deadline is later than the limit above">
        <input type="checkbox" checked={tray.withRecords} onChange={(e) => tray.setWithRecords(e.target.checked)} />
        Also show jobs we have records for, whatever the deadline
      </label>
      <label className="search" style={{ maxWidth: "none", flex: "0 0 auto", minHeight: 40 }}>
        <Icon name="search" />
        <span className="sr-only">Search unplanned work</span>
        <input type="search" placeholder="Search" value={tray.search} onChange={(e) => tray.setSearch(e.target.value)} />
      </label>
      <TypeFilter options={tray.typeOptions} selected={tray.types} onChange={tray.setTypes} />
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>
        {narrow
          ? "Hold a card, or drag its handle, onto a day above to plan it. Hold it at the screen's edge to change week. Tap a card to open it. Swipe the days left or right to change week."
          : "Drag onto a day to plan it, or hold it at the screen's left or right edge to change week. Open a card to pick a date."}
      </p>
      {tray.withClient.length > 0 && (
        <details className="wait-list" open={tray.speakDue > 0}>
          <summary>
            With the client ({tray.withClient.length})
            {tray.speakDue > 0 && <span className="chip amber" style={{ marginLeft: 6 }}>{tray.speakDue} to speak to</span>}
          </summary>
          <p className="muted" style={{ margin: "6px 0", fontSize: 12 }}>
            Prepared and waiting for approval. Drag one onto a day to plan the finalising.
          </p>
          <div className="stack held-cards wait-cards" style={{ gap: 8 }}>{tray.withClient.map((i) => card(i))}</div>
        </details>
      )}
      {tray.held.length > 0 && (
        <details className="held-list">
          <summary>
            On hold or waiting ({tray.held.length})
            {tray.held.some((i) => holdAlert(i.row, i.deadline, today)) && (
              <span className="chip amber" style={{ marginLeft: 6 }}>{tray.held.filter((i) => holdAlert(i.row, i.deadline, today)).length} to look at</span>
            )}
          </summary>
          <p className="muted" style={{ margin: "6px 0", fontSize: 12 }}>Drag one onto a day to take it off hold and plan it.</p>
          <div className="stack held-cards" style={{ gap: 8 }}>{tray.held.map((i) => card(i))}</div>
        </details>
      )}
      <div className="tray-list">
        {tray.unplanned.slice(0, 80).map((i) => card(i))}
        {tray.unplanned.length > 80 && <p className="muted" style={{ fontSize: 12 }}>{tray.unplanned.length - 80} more; narrow the dates or search.</p>}
        {!tray.unplanned.length && <p className="muted" style={{ fontSize: 13 }}>Nothing waiting to be planned.</p>}
      </div>
</aside>
  );
}
