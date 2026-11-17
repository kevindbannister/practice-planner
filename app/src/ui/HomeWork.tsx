// The Home work tiles: one tile for all the work in view and one for each type of work, with the jobs counted by how close they are
// (overdue, due very soon, due soon, OK, on hold). The chart button on a tile opens the breakdown, where the number of days can be
// changed for that tile. A switch picks whose work is counted: for a partner everyone's or their own, for a manager the jobs they own
// or their own work, for everyone else the work assigned to them. See lib/jobBands.ts for the rules.
import { useEffect, useMemo, useRef, useState } from "react";
import { Row } from "../lib/schema";
import { todayIso } from "../lib/domain";
import { stageAt } from "../lib/waiting";
import { svcClass } from "../lib/serviceColour";
import { BANDS, BAND_LABEL, Band, Counts, DEFAULT_WINDOW, SCOPE_LABEL, Scope, accessFor, bandsOf, emptyCounts, inScope, tally } from "../lib/jobBands";
import { Icon } from "./bits";
import { useData, useIndex } from "./data";
import { useStaff } from "./staffKit";

const STORE = "pp.home.work.v1";
type Saved = { scope?: Scope; hold?: boolean; days?: Record<string, number> };
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
  const [ignoreHolds, setIgnoreHolds] = useState(saved.hold !== false); // on unless it was turned off
  const [days, setDays] = useState<Record<string, number>>(saved.days || {});
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { write(user || "", { scope, hold: ignoreHolds, days }); }, [user, scope, ignoreHolds, days]);
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
  const win = (k: string) => days[k] ?? DEFAULT_WINDOW;
  const counts = (list: Row[], k: string): Counts => tally(list, stagesFor, today, win(k), ignoreHolds);
  const withCounts = types.map((t) => ({ ...t, c: counts(t.jobs, t.key) })).sort((a, b) => b.c.overdue - a.c.overdue || a.name.localeCompare(b.name));
  const allCounts = tally(jobs, stagesFor, today, win(ALL), ignoreHolds);
  const label = SCOPE_LABEL[scope === "everyone" ? "everyone" : scope];
  const allName = scope === "everyone" ? "All work" : label;

  return (
    <section className="card pad stack hw" aria-labelledby="hw-h">
      <div className="row-wrap" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h2 id="hw-h" style={{ margin: 0 }}>Work</h2>
        {access.scopes.length > 1 ? (
          <span className="seg" role="group" aria-label="Whose work to show">
            {access.scopes.map((s) => <button key={s} type="button" aria-pressed={scope === s} onClick={() => setScope(s)}>{SCOPE_LABEL[s]}</button>)}
          </span>
        ) : <span className="muted" style={{ fontSize: 13 }}>Showing {label.toLowerCase()}</span>}
      </div>
      {jobs.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          {scope === "mine" ? "No work is assigned to you yet. Whoever does each stage is set on the client's Work tab." : scope === "jobs" ? "No jobs are yours yet. A job's owner is set on the job, or comes from the client's manager." : "No open work."}
        </p>
      ) : (
        <div className="hw-tiles">
          <Tile name={allName} total c={allCounts} days={win(ALL)} onOpen={() => setOpen(ALL)} />
          {withCounts.map((t) => <Tile key={t.key} name={t.name} serviceKey={t.key} c={t.c} days={win(t.key)} onOpen={() => setOpen(t.key)} />)}
        </div>
      )}
      {open && (
        <Breakdown
          title={open === ALL ? `Breakdown by job type: ${allName.toLowerCase()}` : `Breakdown: ${idx.serviceName.get(open) || open}`}
          days={win(open)} onDays={(n) => setDays({ ...days, [open]: n })}
          ignoreHolds={ignoreHolds} onIgnoreHolds={setIgnoreHolds}
          rows={open === ALL
            ? withCounts.map((t) => ({ label: t.name, c: tally(t.jobs, stagesFor, today, win(ALL), ignoreHolds) }))
            : stageRows(types.find((t) => t.key === open)?.jobs || [], stagesFor(open), today, win(open), ignoreHolds)}
          total={open === ALL ? allCounts : counts(types.find((t) => t.key === open)?.jobs || [], open)}
          rowHeading={open === ALL ? "Service" : "Stage"}
          onClose={() => setOpen(null)}
        />
      )}
    </section>
  );
}

/** A service's jobs counted stage by stage, so each stage's own days show. Jobs at a stage that has gone count as "Other". */
function stageRows(jobs: Row[], stages: Row[], today: string, windowDays: number, ignoreHolds: boolean): { label: string; c: Counts }[] {
  const ordered = [...stages].sort((a, b) => Number(a.StageNo) - Number(b.StageNo));
  const rows = ordered.map((s) => ({ no: Number(s.StageNo), label: `${s.StageNo}. ${s.Title}`, c: emptyCounts() }));
  const other = { no: -1, label: "Other", c: emptyCounts() };
  for (const j of jobs) {
    const no = Number(j.StageNo || 1);
    const row = rows.find((r) => r.no === no) || other;
    for (const b of bandsOf(j, stageAt(ordered, no), today, windowDays, ignoreHolds)) row.c[b] += 1;
  }
  return [...rows, ...(BANDS.some((b) => other.c[b]) ? [other] : [])].map(({ label, c }) => ({ label, c }));
}

function Tile({ name, serviceKey, total, c, days, onOpen }: { name: string; serviceKey?: string; total?: boolean; c: Counts; days: number; onOpen: () => void }) {
  const chips: Band[] = ["verySoon", "soon", "ok", "hold"];
  return (
    <article className={`hw-tile${total ? " total" : ""} ${serviceKey ? svcClass(serviceKey) : ""}`}>
      <div className="hw-head">
        <a className="hw-name" href="#/plan/deadlines" title="Open the deadlines">{name}<Icon name="right" size={14} /></a>
        <button type="button" className="hw-info" onClick={onOpen} aria-label={`Breakdown of ${name}`} title="Breakdown, and how many days to look ahead"><Icon name="chart" size={16} /></button>
      </div>
      <div className="hw-body">
        <span className={`hw-pill overdue${c.overdue ? " on" : ""}`}>{c.overdue} overdue</span>
        <span className="hw-next">next {days} days:</span>
        <span className="hw-chips">
          {chips.map((b) => <span key={b} className={`hw-dot ${b}${c[b] ? " on" : ""}`} title={`${BAND_LABEL[b]}: ${c[b]}`} aria-label={`${BAND_LABEL[b]}: ${c[b]}`}>{c[b]}</span>)}
        </span>
      </div>
    </article>
  );
}

function Breakdown({ title, days, onDays, ignoreHolds, onIgnoreHolds, rows, total, rowHeading, onClose }: {
  title: string; days: number; onDays: (n: number) => void; ignoreHolds: boolean; onIgnoreHolds: (v: boolean) => void;
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
          <label className="row-wrap" style={{ gap: 6 }}><input type="checkbox" checked={ignoreHolds} onChange={(e) => onIgnoreHolds(e.target.checked)} /> Ignore holdups</label>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 13, textAlign: "center" }}>
          These settings also apply to the tile. "Due very soon" and "due soon" are set for each stage in Settings. A job on hold always counts under On hold; with holdups ignored it is not also counted by its deadline.
        </p>
        <div className="table-wrap">
          <table className="hw-table">
            <thead><tr><th scope="col">{rowHeading}</th>{BANDS.map((b) => <th key={b} scope="col">{BAND_LABEL[b]}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}><th scope="row">{r.label}</th>{BANDS.map((b) => <td key={b}><span className={`hw-cell ${b}${r.c[b] ? " on" : ""}`}>{r.c[b]}</span></td>)}</tr>
              ))}
            </tbody>
            <tfoot><tr><th scope="row">TOTAL</th>{BANDS.map((b) => <td key={b}>{jobs(total[b])}</td>)}</tr></tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
