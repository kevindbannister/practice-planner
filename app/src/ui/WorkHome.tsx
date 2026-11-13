// Work home: the client-work side of the practice at a glance. What is late, what is due, what is ready to start,
// and each kind of work (accounts, tax, Companies House, payroll and so on) with its next jobs.
import { useMemo } from "react";
import { Job, fmtDate, jobState, todayIso } from "../lib/domain";
import { addDays } from "../lib/planning";
import { FAMILY_NAMES, FAMILY_ORDER, serviceSlot, svcClass } from "../lib/serviceColour";
import { useIndex } from "./data";
import { useEditor } from "./Editors";
import { Icon, IconName } from "./bits";

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

  const families = useMemo(() => FAMILY_ORDER.map((f) => {
    const list = jobs.filter((j) => serviceSlot(j.ServiceKey) === f).sort(byDeadline);
    return { f, name: FAMILY_NAMES[f], list, late: list.filter((j) => jobState(j, today).state === "overdue").length, soon: list.filter((j) => j.Deadline && j.Deadline >= today && j.Deadline <= in30).length };
  }).filter((g) => g.list.length), [jobs, today]); // eslint-disable-line react-hooks/exhaustive-deps

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
              <span><strong>{g.list.length}</strong> open</span>
              <span className={g.soon ? "amber-text" : ""}><strong>{g.soon}</strong> due in 30 days</span>
              <span className={g.late ? "red-text" : ""}><strong>{g.late}</strong> late</span>
            </p>
            <ul className="home-list">{g.list.slice(0, 5).map(row)}</ul>
            {g.list.length > 5 && <p className="home-list more"><a href={FAMILY_PAGE[g.f]}>{g.list.length - 5} more</a></p>}
          </section>
        ))}
        {!families.length && <section className="card"><p style={{ margin: 0, padding: 22 }}>No open client work.</p></section>}
      </div>
    </div>
  );
}
