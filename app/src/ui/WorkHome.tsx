// Work home: the client-work side of the practice at a glance. What is late, what is due, what is ready to start,
// and each kind of work (accounts, tax, Companies House, payroll and so on) with its next jobs.
import { useMemo } from "react";
import { Job, fmtDate, jobState, todayIso } from "../lib/domain";
import { addDays } from "../lib/planning";
import { FAMILY_NAMES, FAMILY_ORDER, serviceSlot, svcClass } from "../lib/serviceColour";
import { useData, useIndex } from "./data";
import { isOpenTx } from "../lib/cosec";
import { useEditor } from "./Editors";
import { Icon, IconName } from "./bits";
import { PlanCard, usePlanItems } from "./PlanTray";
import { useCardFields } from "./CardOptions";

/** Where each kind of work is done. */
const FAMILY_PAGE: Record<number, string> = { 1: "#/papers", 2: "#/tax", 3: "#/cosec", 4: "#/papers", 5: "#/papers", 6: "#/payroll", 7: "#/tax", 0: "#/plan/deadlines" };

export function WorkHome() {
  const idx = useIndex();
  const { open } = useEditor();
  const today = todayIso();
  const in30 = addDays(today, 30);
  const jobs = idx.openJobs as Job[];

  const client = (j: Job) => idx.clientByKey.get(j.ClientKey)?.Title || (j.ClientName as string) || "";
  const byDeadline = (a: Job, b: Job) => String(a.Deadline || "9999").localeCompare(String(b.Deadline || "9999"));

  const late = jobs.filter((j) => jobState(j, today).state === "overdue");
  const due30 = jobs.filter((j) => j.Deadline && j.Deadline >= today && j.Deadline <= in30);
  const ready = jobs.filter((j) => j.RecordsReceived && !j.PlannedDate);
  const waiting = jobs.filter((j) => !j.RecordsReceived && j.RecordsExpected && String(j.RecordsExpected) < today);

  // the planner's cards, with the same fields
  const { items: planItems } = usePlanItems();
  const [cardFields] = useCardFields();
  const itemByKey = useMemo(() => new Map(planItems.map((i) => [i.key, i])), [planItems]);
  // work with a statutory deadline only (not management accounts or bookkeeping, nor other work)
  const STATUTORY = FAMILY_ORDER.filter((f) => f !== 0 && f !== 4);
  // a job is listed once it has been started, or when it is due within 30 days (or late)
  // "started" means the work itself has begun: working papers or a tax return for the job's period have something in
  // them, a Companies House filing is being prepared, or the job has moved on a stage or had time logged against it
  const { data } = useData();
  const workBegun = useMemo(() => {
    const s = new Set<string>();
    for (const r of [...data.papers, ...data.paperLines]) if (r.ClientKey && r.PeriodEnd) s.add(`${r.ClientKey}|${String(r.PeriodEnd).slice(0, 10)}`);
    return s;
  }, [data.papers, data.paperLines]);
  const filing = useMemo(() => new Set(data.cosecTx.filter((x) => isOpenTx(x as never)).map((x) => String(x.ClientKey))), [data.cosecTx]);
  const started = (j: Job) => {
    if (j.PeriodEnd && workBegun.has(`${j.ClientKey}|${String(j.PeriodEnd).slice(0, 10)}`)) return true;
    if (serviceSlot(j.ServiceKey) === 3 && filing.has(String(j.ClientKey))) return true;
    return Number(j.StageNo || 1) > 1 || Number(j.ActualHours || 0) > 0;
  };
  const listed = (j: Job) => started(j) || (!!j.Deadline && j.Deadline <= in30);

  const families = useMemo(() => STATUTORY.map((f) => {
    const list = jobs.filter((j) => serviceSlot(j.ServiceKey) === f && listed(j)).sort(byDeadline);
    const begun = list.filter(started), soon = list.filter((j) => !started(j));
    return { f, name: FAMILY_NAMES[f], list, begun, soonList: soon, late: list.filter((j) => jobState(j, today).state === "overdue").length };
  }).filter((g) => g.list.length), [jobs, today, workBegun, filing]); // eslint-disable-line react-hooks/exhaustive-deps

  const cards = (list: Job[], limit: number) => list.slice(0, limit).map((j) => {
    const item = itemByKey.get(j.Key);
    return item
      ? <PlanCard key={j.Key} item={item} today={today} fields={cardFields} dragging={false} onOpen={() => open({ kind: "job", key: j.Key })} />
      : <ul key={j.Key} className="home-list">{row(j)}</ul>;
  });

  const tile = (label: string, value: number, sub: string, icon: IconName, hue: string, tone: string, to: string) => (
    <a className={`tile home-tile${tone && value ? ` ${tone}` : ""}`} href={to}>
      <span className={`h-icon ${hue}`} aria-hidden="true"><Icon name={icon} size={16} /></span>
      <span className="label">{label}</span>
      <span className="value">{value}</span>
      <span className="sub">{sub}</span>
    </a>
  );

  const row = (j: Job) => {
    const st = jobState(j, today);
    return (
      <li key={j.Key}>
        <button type="button" onClick={() => open({ kind: "job", key: j.Key })}>
          <span className="stack" style={{ gap: 1, minWidth: 0 }}>
            <strong className="ellipsis">{client(j) || j.Title}</strong>
            {client(j) && <span className="muted ellipsis">{j.Title}{j.PeriodEnd ? `, period to ${fmtDate(String(j.PeriodEnd), { year: false })}` : ""}</span>}
          </span>
          {j.Deadline && (
            <span className={`chip ${st.state === "overdue" ? "red" : st.state === "tight" ? "amber" : ""}`}>
              {st.state === "overdue" ? `${-st.days!}d late` : `Due ${fmtDate(j.Deadline, { year: false })}`}
            </span>
          )}
        </button>
      </li>
    );
  };

  return (
    <div className="page home work-home">
      <section className="home-hero" aria-label="Client work summary">
        <div className="hero-top">
          <div>
            <div className="hero-date">{fmtDate(today, { weekday: true })}</div>
            <h1>Client work</h1>
            <p className="hero-sum">{jobs.length} open job{jobs.length === 1 ? "" : "s"}{late.length ? `, ${late.length} late` : ""}</p>
          </div>
          <div className="row-wrap">
            <a className="btn" href="#/papers">Working papers</a>
            <a className="btn" href="#/tax">Tax</a>
            <a className="btn" href="#/payroll">Payroll</a>
            <a className="btn" href="#/cosec">Co Sec</a>
            <a className="btn primary" href="#/plan/deadlines">All deadlines</a>
          </div>
        </div>
        <div className="home-tiles">
          {tile("Late", late.length, late.length ? "past their deadline" : "All on time", "alert", "hue-red", "red", "#/plan/deadlines")}
          {tile("Due in 30 days", due30.length, "deadlines coming up", "clock", "hue-amber", "amber", "#/plan/deadlines")}
          {tile("Records in, not planned", ready.length, "ready to start", "check", "hue-green", "green", "#/plan")}
          {tile("Waiting for records", waiting.length, "past the date expected", "mail", "hue-pink", "amber", "#/chase")}
        </div>
      </section>

      <div className="work-families">
        {families.map((g) => (
          <section key={g.f} className={`card work-family ${svcClass(g.list[0].ServiceKey)}`} aria-labelledby={`wf-${g.f}`}>
            <div className="card-head">
              <h2 id={`wf-${g.f}`}>{g.name}</h2>
              <a href={FAMILY_PAGE[g.f]} style={{ fontSize: 13 }}>Open</a>
            </div>
            <p className="work-family-sum">
              <span><strong>{g.begun.length}</strong> started</span>
              <span className={g.soonList.length ? "amber-text" : ""}><strong>{g.soonList.length}</strong> due soon, not started</span>
              <span className={g.late ? "red-text" : ""}><strong>{g.late}</strong> late</span>
            </p>
            {g.begun.length > 0 && (
              <div className="work-group">
                <h3 className="work-group-head"><span className="work-tag started">Started</span><span className="muted">work under way</span></h3>
                <div className="home-today-cards">{cards(g.begun, 4)}</div>
                {g.begun.length > 4 && <p className="home-list more"><a href={FAMILY_PAGE[g.f]}>{g.begun.length - 4} more started</a></p>}
              </div>
            )}
            {g.soonList.length > 0 && (
              <div className="work-group">
                <h3 className="work-group-head"><span className="work-tag soon">Due soon</span><span className="muted">not started, due in the next 30 days</span></h3>
                <div className="home-today-cards">{cards(g.soonList, 4)}</div>
                {g.soonList.length > 4 && <p className="home-list more"><a href={FAMILY_PAGE[g.f]}>{g.soonList.length - 4} more due soon</a></p>}
              </div>
            )}
          </section>
        ))}
        {!families.length && <section className="card"><p style={{ margin: 0, padding: 22 }}>No statutory work started or due in the next 30 days.</p></section>}
      </div>
    </div>
  );
}
