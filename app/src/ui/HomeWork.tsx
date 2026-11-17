// The Home work tiles: one tile for all the work in view and one for each type of work, with the jobs counted by how close they are
// (overdue, due very soon, due soon, OK, on hold). The chart button on a tile opens the breakdown, where the number of days can be
// changed for that tile. A switch picks whose work is counted: for a partner everyone's or their own, for a manager the jobs they own
// or their own work, for everyone else the work assigned to them. See lib/jobBands.ts for the rules.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Row } from "../lib/schema";
import { daysBetween, fmtDate, todayIso } from "../lib/domain";
import { stageAt } from "../lib/waiting";
import { svcClass } from "../lib/serviceColour";
import { BANDS, BAND_LABEL, Band, Counts, DEFAULT_WINDOW, SCOPE_LABEL, START_KEY, Scope, StartRule, accessFor, bandsOf, bandsShown, emptyCounts, inScope, nextOn, readStartRules, startRuleFor, tally } from "../lib/jobBands";
import { Icon } from "./bits";
import { readSetting, useData, useIndex } from "./data";
import { useStaff } from "./staffKit";

/** How Work by type is drawn, chosen in the profile menu and remembered on this device. */
export type WorkView = "table" | "cards" | "bars" | "summary";
export const WORK_VIEWS: [WorkView, string][] = [["table", "Table"], ["cards", "Cards"], ["bars", "Bars"], ["summary", "Summary"]];
const VIEW_KEY = "pp.home.view";
const readView = (): WorkView => { try { const v = localStorage.getItem(VIEW_KEY); return WORK_VIEWS.some(([k]) => k === v) ? (v as WorkView) : "table"; } catch { return "table"; } };
export function useWorkView(): [WorkView, (v: WorkView) => void] {
  const [v, setV] = useState<WorkView>(readView);
  useEffect(() => {
    const f = () => setV(readView());
    window.addEventListener("pp-work-view", f);
    return () => window.removeEventListener("pp-work-view", f);
  }, []);
  return [v, (n) => { try { localStorage.setItem(VIEW_KEY, n); } catch { /* this visit only */ } setV(n); window.dispatchEvent(new Event("pp-work-view")); }];
}

const STORE = "pp.home.work.v1";
/** `until`: every tile counts work due up to this date (set by the 31 December and 31 January buttons) instead of its own days. */
/** `holds`: count jobs on hold (in their own band). Off unless turned on. */
type Saved = { scope?: Scope; holds?: boolean; days?: Record<string, number>; until?: string };
const read = (user: string): Saved => { try { return JSON.parse(localStorage.getItem(`${STORE}:${user}`) || "{}") as Saved; } catch { return {}; } };
const write = (user: string, s: Saved) => { try { localStorage.setItem(`${STORE}:${user}`, JSON.stringify(s)); } catch { /* this visit only */ } };

const ALL = "ALL";

export function HomeWork() {
  const { data, user } = useData();
  const idx = useIndex();
  const staff = useStaff();
  const today = todayIso();
  const access = useMemo(() => accessFor(staff.cfg, user || ""), [staff.cfg, user]);
  const saved = useMemo(() => read(user || ""), [user]);
  const [scope, setScope] = useState<Scope>(saved.scope && access.scopes.includes(saved.scope) ? saved.scope : access.initial);
  const [includeHolds, setIncludeHolds] = useState(saved.holds === true);
  const rules = useMemo(() => readStartRules(readSetting(data.settings, START_KEY)), [data.settings]);
  const ruleFor = (k: string): StartRule => startRuleFor(rules, k);
  const bands = bandsShown(includeHolds);
  const [days, setDays] = useState<Record<string, number>>(saved.days || {});
  const [open, setOpen] = useState<string | null>(null);
  const [view] = useWorkView();
  const [until, setUntil] = useState<string | undefined>(saved.until && saved.until >= today ? saved.until : undefined);
  useEffect(() => { write(user || "", { scope, holds: includeHolds, days, until }); }, [user, scope, includeHolds, days, until]);
  // a role change (someone made a manager, say) can take away a view that was saved
  useEffect(() => { if (!access.scopes.includes(scope)) setScope(access.initial); }, [access, scope]);

  const stagesFor = (k: string): Row[] => idx.stagesByService.get(k) || [];
  const jobs = useMemo(
    () => idx.openJobs.filter((j) => inScope(scope, user || "", j, idx.clientByKey.get(String(j.ClientKey || "")), stagesFor(String(j.ServiceKey || "")), data.clientStages)),
    [idx, scope, user, data.clientStages], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const types = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const j of jobs) { const k = String(j.ServiceKey || ""); if (!m.has(k)) m.set(k, []); m.get(k)!.push(j); }
    return [...m.entries()].map(([key, list]) => ({ key, name: idx.serviceName.get(key) || key || "Other work", jobs: list }));
  }, [jobs, idx.serviceName]);
  const win = (k: string) => (until ? Math.max(0, daysBetween(today, until)) : days[k] ?? DEFAULT_WINDOW);
  const ahead = (k: string) => (until ? `Up to ${fmtDate(until)}` : `Next ${win(k)} days`);
  // quick ways to look ahead to a date for every tile at once: the year end, and the Self Assessment deadline
  const targets = [
    { key: "christmas", date: nextOn(today, 12, 31), icon: <TreeIcon /> },
    { key: "jan", date: nextOn(today, 1, 31), icon: <Icon name="form" size={16} /> },
  ];
  const counts = (list: Row[], k: string): Counts => tally(list, stagesFor, today, win(k), includeHolds, ruleFor);
  const withCounts = types.map((t) => ({ ...t, c: counts(t.jobs, t.key) })).sort((a, b) => b.c.overdue - a.c.overdue || a.name.localeCompare(b.name));
  const allCounts = tally(jobs, stagesFor, today, win(ALL), includeHolds, ruleFor);
  const label = SCOPE_LABEL[scope === "everyone" ? "everyone" : scope];
  const allName = scope === "everyone" ? "All work" : label;

  return (
    <section className="hw" aria-labelledby="hw-h">
      <div className="hw-bar-head">
        <h2 id="hw-h">Work by type</h2>
        <span className="hw-tools">
        {targets.map((t) => {
          const on = until === t.date;
          return (
            <button key={t.key} type="button" className={`hw-target${on ? " on" : ""}`} aria-pressed={on} onClick={() => setUntil(on ? undefined : t.date)}
              aria-label={`Count work due up to ${fmtDate(t.date)} on every tile`}
              title={on ? `Every tile counts work due up to ${fmtDate(t.date)}. Click again to go back to each tile's own days.` : `Count work due up to ${fmtDate(t.date)} on every tile`}>
              {t.icon}
            </button>
          );
        })}
        <button type="button" className={`hw-holds${includeHolds ? " on" : ""}`} aria-pressed={includeHolds} onClick={() => setIncludeHolds(!includeHolds)}
          title={includeHolds ? "Jobs on hold are counted under On hold. Click to leave them out." : "Jobs on hold are left out. Click to count them under On hold."}>
          <Icon name={includeHolds ? "check" : "clock"} size={14} /> Include on hold
        </button>
        {access.scopes.length > 1 ? (
          <span className="seg" role="group" aria-label="Whose work to show">
            {access.scopes.map((s) => <button key={s} type="button" aria-pressed={scope === s} onClick={() => setScope(s)}>{SCOPE_LABEL[s]}</button>)}
          </span>
        ) : <span className="muted" style={{ fontSize: 13 }}>Showing {label.toLowerCase()}</span>}
        </span>
      </div>
      {jobs.length === 0 ? (
        <p className="muted hw-empty">
          {scope === "mine" ? "No work is assigned to you yet. Whoever does each stage is set on the client's Work tab." : scope === "jobs" ? "No jobs are yours yet. A job's owner is set on the job, or comes from the client's manager." : "No open work."}
        </p>
      ) : (
        <WorkDisplay view={view} bands={bands} items={[
          { key: ALL, name: allName, total: true, c: allCounts, days: win(ALL), ahead: ahead(ALL), onOpen: () => setOpen(ALL) },
          ...withCounts.map((t) => ({ key: t.key, name: t.name, serviceKey: t.key, c: t.c, days: win(t.key), ahead: ahead(t.key), onOpen: () => setOpen(t.key) })),
        ]} />
      )}
      {open && (
        <Breakdown
          title={open === ALL ? `Breakdown by job type: ${allName.toLowerCase()}` : `Breakdown: ${idx.serviceName.get(open) || open}`}
          days={win(open)} until={until} onDays={(n) => { setUntil(undefined); setDays({ ...days, [open]: n }); }}
          includeHolds={includeHolds} onIncludeHolds={setIncludeHolds} bands={bands}
          rows={open === ALL
            ? withCounts.map((t) => ({ label: t.name, c: tally(t.jobs, stagesFor, today, win(ALL), includeHolds, ruleFor) }))
            : stageRows(types.find((t) => t.key === open)?.jobs || [], stagesFor(open), today, win(open), includeHolds, ruleFor(open))}
          total={open === ALL ? allCounts : counts(types.find((t) => t.key === open)?.jobs || [], open)}
          rowHeading={open === ALL ? "Service" : "Stage"}
          onClose={() => setOpen(null)}
        />
      )}
    </section>
  );
}

/** A service's jobs counted stage by stage, so each stage's own days show. Jobs at a stage that has gone count as "Other". */
function stageRows(jobs: Row[], stages: Row[], today: string, windowDays: number, includeHolds: boolean, rule: StartRule): { label: string; c: Counts }[] {
  const ordered = [...stages].sort((a, b) => Number(a.StageNo) - Number(b.StageNo));
  const rows = ordered.map((s) => ({ no: Number(s.StageNo), label: `${s.StageNo}. ${s.Title}`, c: emptyCounts() }));
  const other = { no: -1, label: "Other", c: emptyCounts() };
  for (const j of jobs) {
    const no = Number(j.StageNo || 1);
    const row = rows.find((r) => r.no === no) || other;
    for (const b of bandsOf(j, stageAt(ordered, no), today, windowDays, includeHolds, rule)) row.c[b] += 1;
  }
  return [...rows, ...(BANDS.some((b) => other.c[b]) ? [other] : [])].map(({ label, c }) => ({ label, c }));
}

/** `slot` sets the colour directly (the Appearance preview shows a colour before it is saved). */
export type Item = { key: string; name: string; serviceKey?: string; slot?: number; total?: boolean; c: Counts; days: number; ahead: string; onOpen: () => void };

export function WorkDisplay({ view, items, bands = BANDS }: { view: WorkView; items: Item[]; bands?: Band[] }) {
  if (view === "cards") return <div className="hw-tiles">{items.map(({ key, ...rest }) => <Tile key={key} {...rest} bands={bands} />)}</div>;
  if (view === "bars") return <BarsView items={items} bands={bands} />;
  if (view === "summary") return <SummaryView items={items} bands={bands} />;
  return (
    <div className="hw-board">
      <table className="hw-grid">
        <caption className="sr-only">Open jobs by type of work and how close their deadlines are</caption>
        <thead>
          <tr>
            <th scope="col">Type of work</th>
            {bands.map((b) => <th key={b} scope="col" className="num">{BAND_LABEL[b]}</th>)}
            <th scope="col" className="ahead">Looking ahead</th>
          </tr>
        </thead>
        <tbody>{items.map(({ key, ...rest }) => <Line key={key} {...rest} bands={bands} />)}</tbody>
      </table>
    </div>
  );
}

const markClass = (serviceKey?: string, slot?: number) => (slot !== undefined ? `svc-${slot}` : serviceKey ? svcClass(serviceKey) : "");
const Mark = ({ total, serviceKey, slot }: { total?: boolean; serviceKey?: string; slot?: number }) =>
  total ? <span className="hw-mark total" aria-hidden="true"><Icon name="layout" size={13} /></span> : <span className={`hw-mark ${markClass(serviceKey, slot)}`} aria-hidden="true" />;

const AheadButton = ({ name, ahead, onOpen }: { name: string; ahead: string; onOpen: () => void }) => (
  <button type="button" className="hw-ahead" onClick={onOpen} aria-label={`${name}: ${ahead}. Open the breakdown`} title="Breakdown, and how far ahead to look">
    <Icon name="chart" size={14} /><span>{ahead}</span>
  </button>
);

/** Bars: each type of work as one stacked bar on a shared scale (the longest bar is the busiest type), segments in band order with
 *  the count written in each, a key above, and a tooltip on each segment. */
function BarsView({ items, bands }: { items: Item[]; bands: Band[] }) {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const totalOf = (c: Counts) => bands.reduce((n, b) => n + c[b], 0);
  const max = Math.max(1, ...items.filter((i) => !i.total).map((i) => totalOf(i.c)), ...items.filter((i) => i.total).map((i) => totalOf(i.c)));
  const show = (e: React.MouseEvent | React.FocusEvent, text: string) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect(), o = box.current!.getBoundingClientRect();
    setTip({ x: r.left - o.left + r.width / 2, y: r.top - o.top, text });
  };
  return (
    <div className="hw-board hw-bars" ref={box} onMouseLeave={() => setTip(null)}>
      <ul className="hw-key-row" aria-label="Key">
        {bands.map((b) => <li key={b}><i className={`hw-key ${b}`} />{BAND_LABEL[b]}</li>)}
      </ul>
      {items.map((i) => {
        const t = totalOf(i.c);
        return (
          <div key={i.key} className={`hw-bar-row${i.total ? " total" : ""}`}>
            <div className="hw-bar-name"><Mark total={i.total} serviceKey={i.serviceKey} slot={i.slot} /><span>{i.name}</span><span className="hw-type-sum">{t} shown</span></div>
            <div className="hw-bar-track" role="img" aria-label={`${i.name}: ${bands.map((b) => `${i.c[b]} ${BAND_LABEL[b].toLowerCase()}`).join(", ")}`}>
              <div className="hw-bar-fill" style={{ width: `${(t / max) * 100}%` }}>
                {bands.filter((b) => i.c[b]).map((b) => (
                  <span key={b} className={`hw-bseg ${b}`} style={{ flexGrow: i.c[b] }} tabIndex={0}
                    onMouseEnter={(e) => show(e, `${i.name} · ${BAND_LABEL[b]}: ${i.c[b]}`)} onFocus={(e) => show(e, `${i.name} · ${BAND_LABEL[b]}: ${i.c[b]}`)} onBlur={() => setTip(null)}>
                    <span className="hw-bseg-n">{i.c[b]}</span>
                  </span>
                ))}
              </div>
              {t === 0 && <span className="muted hw-bar-none">Nothing in view</span>}
            </div>
            <AheadButton name={i.name} ahead={i.ahead} onOpen={i.onOpen} />
          </div>
        );
      })}
      {tip && <div className="hw-tip" role="tooltip" style={{ left: tip.x, top: tip.y }}>{tip.text}</div>}
    </div>
  );
}

/** Summary: a plain sentence for each type of work, most pressing first, with the overdue count as a badge. */
function SummaryView({ items, bands }: { items: Item[]; bands: Band[] }) {
  const words: Record<Band, string> = { overdue: "overdue", verySoon: "due very soon", soon: "due soon", ok: "on track", notYet: "not ready yet", hold: "on hold" };
  const [all, ...rest] = items;
  const order = [all, ...[...rest].sort((a, b) => b.c.overdue - a.c.overdue || b.c.verySoon - a.c.verySoon || b.c.soon - a.c.soon || a.name.localeCompare(b.name))];
  return (
    <ul className="hw-board hw-summary">
      {order.map((i) => {
        const parts = bands.filter((b) => b !== "overdue" && i.c[b]).map((b) => `${i.c[b]} ${words[b]}`);
        return (
          <li key={i.key} className={i.total ? "total" : ""}>
            <span className={`hw-badge${i.c.overdue ? " late" : " clear"}`} aria-hidden="true">{i.c.overdue ? i.c.overdue : <Icon name="check" size={16} />}</span>
            <span className="hw-say">
              <span className="hw-say-name"><Mark total={i.total} serviceKey={i.serviceKey} slot={i.slot} />{i.name}</span>
              <span className="hw-say-text">
                {i.c.overdue ? <strong className="late">{i.c.overdue} overdue</strong> : <strong>Nothing overdue</strong>}
                {parts.length ? <>{" · "}{parts.join(", ")}</> : " · nothing else coming up"}
              </span>
            </span>
            <AheadButton name={i.name} ahead={i.ahead} onOpen={i.onOpen} />
          </li>
        );
      })}
    </ul>
  );
}

/** One type of work as a row: its counts in each band as pills (coloured when there is any), a thin bar showing the mix, and the
 *  look-ahead, which opens the breakdown where it can be changed. */
function Line({ name, serviceKey, slot, total, c, ahead: aheadLabel, onOpen, bands }: { name: string; serviceKey?: string; slot?: number; total?: boolean; c: Counts; ahead: string; onOpen: () => void; bands: Band[] }) {
  const sum = bands.reduce((n, b) => n + c[b], 0);
  return (
    <tr className={`hw-row${total ? " total" : ""}`}>
      <th scope="row">
        <span className="hw-type">
          {total ? <span className="hw-mark total" aria-hidden="true"><Icon name="layout" size={13} /></span> : <span className={`hw-mark ${markClass(serviceKey, slot)}`} aria-hidden="true" />}
          <span className="hw-type-name">{name}</span>
          <span className="hw-type-sum" title="Jobs counted in the bands for this look-ahead">{sum} shown</span>
        </span>
        <span className="hw-mix" aria-hidden="true">
          {sum ? bands.filter((b) => c[b]).map((b) => <span key={b} className={`hw-seg ${b}`} style={{ flexGrow: c[b] }} />) : null}
        </span>
      </th>
      {bands.map((b) => (
        <td key={b} className="num" data-label={BAND_LABEL[b]}>
          <span className={`hw-cell ${b}${c[b] ? " on" : ""}`} aria-label={`${BAND_LABEL[b]}: ${c[b]}`}>{c[b]}</span>
        </td>
      ))}
      <td className="ahead">
        <button type="button" className="hw-ahead" onClick={onOpen} aria-label={`${name}: ${aheadLabel}. Open the breakdown`} title="Breakdown, and how far ahead to look">
          <Icon name="chart" size={14} /><span>{aheadLabel}</span>
        </button>
      </td>
    </tr>
  );
}

function Tile({ name, serviceKey, slot, total, c, days, onOpen, bands }: { name: string; serviceKey?: string; slot?: number; total?: boolean; c: Counts; days: number; onOpen: () => void; bands: Band[] }) {
  const ahead: Band[] = bands.filter((b) => b !== "overdue");
  const SHORT: Record<Band, string> = { overdue: "overdue", verySoon: "very soon", soon: "soon", ok: "OK", notYet: "not ready", hold: "on hold" };
  const sum = ahead.reduce((n, b) => n + c[b], 0);
  return (
    <article className={`hw-tile${total ? " total" : ""}${c.overdue ? " late" : ""}`}>
      <div className="hw-head">
        <a className="hw-name" href="#/plan/deadlines" title="Open the deadlines">
          {total ? <span className="hw-mark total" aria-hidden="true"><Icon name="layout" size={13} /></span> : <span className={`hw-mark ${markClass(serviceKey, slot)}`} aria-hidden="true" />}
          <span>{name}</span>
        </a>
        <button type="button" className="hw-info" onClick={onOpen} aria-label={`Breakdown of ${name}`} title="Breakdown, and how many days to look ahead"><Icon name="chart" size={16} /></button>
      </div>
      <div className="hw-main">
        <span className="hw-big">{c.overdue}</span>
        <span className="hw-big-label">overdue</span>
      </div>
      <div className="hw-meter" role="img" aria-label={`Next ${days} days: ${ahead.map((b) => `${c[b]} ${SHORT[b]}`).join(", ")}`}>
        {sum ? ahead.filter((b) => c[b]).map((b) => <span key={b} className={`hw-seg ${b}`} style={{ flexGrow: c[b] }} />) : <span className="hw-seg none" />}
      </div>
      <ul className="hw-legend" aria-hidden="true">
        {ahead.map((b) => <li key={b} className={c[b] ? "on" : ""}><i className={`hw-key ${b}`} /><strong>{c[b]}</strong> {SHORT[b]}</li>)}
      </ul>
      <span className="hw-window">Next {days} days</span>
    </article>
  );
}

function Breakdown({ title, days, until, onDays, includeHolds, onIncludeHolds, bands, rows, total, rowHeading, onClose }: {
  title: string; days: number; until?: string; onDays: (n: number) => void; includeHolds: boolean; onIncludeHolds: (v: boolean) => void; bands: Band[];
  rows: { label: string; c: Counts }[]; total: Counts; rowHeading: string; onClose: () => void;
}) {
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    first.current?.focus();
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const jobs = (n: number) => `${n} job${n === 1 ? "" : "s"}`;
  return (
    <div className="hw-modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="hw-dialog">
        <div className="row-wrap" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button type="button" className="iconbtn small" aria-label="Close" onClick={onClose}><Icon name="close" size={16} /></button>
        </div>
        <div className="hw-controls">
          <label>Overdue and due in the next{" "}
            <input ref={first} className="input" type="number" min={1} max={365} value={days} aria-label="Number of days to look ahead"
              onChange={(e) => { const n = Math.floor(Number(e.target.value)); if (Number.isFinite(n) && n >= 1 && n <= 365) onDays(n); }} />{" "}days.</label>
          <label className="row-wrap" style={{ gap: 6 }}><input type="checkbox" checked={includeHolds} onChange={(e) => onIncludeHolds(e.target.checked)} /> Include jobs on hold</label>
        </div>
        {until && <p className="hw-until-note">Every tile is counting work due up to {fmtDate(until)}. Changing the days here goes back to each tile's own setting.</p>}
        <p className="muted" style={{ margin: 0, fontSize: 13, textAlign: "center" }}>
          These settings also apply to the tile. "Due very soon" and "due soon" are set for each stage in Settings. "Not ready yet" is work that can't be started yet (its period hasn't ended, or for payroll it's too early in the month); when it can start is set for each type of work in Settings. Jobs on hold are left out unless included.
        </p>
        <div className="table-wrap">
          <table className="hw-table">
            <thead><tr><th scope="col">{rowHeading}</th>{bands.map((b) => <th key={b} scope="col">{BAND_LABEL[b]}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}><th scope="row">{r.label}</th>{bands.map((b) => <td key={b}><span className={`hw-cell ${b}${r.c[b] ? " on" : ""}`}>{r.c[b]}</span></td>)}</tr>
              ))}
            </tbody>
            <tfoot><tr><th scope="row">TOTAL</th>{bands.map((b) => <td key={b}>{jobs(total[b])}</td>)}</tr></tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

/** A small Christmas tree, drawn like the app's other icons (the 31 December button). */
function TreeIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      <path d="M8 .6l.55 1.1 1.2.18-.87.85.2 1.2L8 3.37l-1.08.56.2-1.2-.87-.85 1.2-.18z" />
      <path d="M8 3.9L5.3 7.1h1.5L4.3 10.2h1.7L3.3 13.3h9.4L10 10.2h1.7L9.2 7.1h1.5z" />
      <rect x="7.1" y="13.3" width="1.8" height="2.1" rx=".4" />
    </svg>
  );
}
