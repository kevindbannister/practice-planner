// The working papers from the client page: every year's papers in one list, with how far each has got,
// the Prepared and Reviewed sign-offs, the accounts job and its due date, and whether Xero has been read.
// Each year opens its papers; a year that isn't in the list can be started from the date box.
import { useState } from "react";
import { Client, Job, fmtDate, todayIso } from "../lib/domain";
import { addYears } from "../lib/engagements";
import { SECTIONS, progress, sectionsOff, setupOf, stateOf } from "../lib/papers";
import { href } from "./bits";
import { useData } from "./data";
import { periodsFor } from "./PapersPage";

const ACCOUNTS = new Set(["ACCS_LTD", "ACCS_LLP"]);

export function ClientPapers({ client: c, jobs }: { client: Client; jobs: Job[] }) {
  const { data } = useData();
  const today = todayIso();
  const { all } = periodsFor(c, jobs, today);
  const [start, setStart] = useState(() => (all[0] ? addYears(all[0], 1) : ""));

  const rows = all.map((period) => {
    const p = progress(c.Key, period, data.papers);
    const off = sectionsOff(data.papers, c.Key, period);
    const used = SECTIONS.filter((s) => !off.has(s.key));
    const prepared = used.filter((s) => stateOf(data.papers, c.Key, period, s.key).preparedBy).length;
    const reviewed = used.filter((s) => stateOf(data.papers, c.Key, period, s.key).reviewedBy).length;
    const started = data.papers.some((r) => r.ClientKey === c.Key && r.PeriodEnd === period);
    const job = jobs.find((j) => ACCOUNTS.has(String(j.ServiceKey || "")) && j.PeriodEnd === period);
    const xero = String(setupOf(data.papers, c.Key, period, "xero/main").at || "");
    const status = p.total > 0 && p.done === p.total ? "Complete" : p.done || p.started || started ? "In progress" : "Not started";
    return { period, p, prepared, reviewed, total: used.length, job, xero, status, current: period === all.find((d) => d <= today) };
  });

  const openHref = (period: string) => href("papers", c.Key, period);
  const startOk = !!start && !all.includes(start);

  return (
    <div className="stack" style={{ gap: 12 }} aria-label="Working papers for this client">
      <div className="row-wrap" style={{ justifyContent: "space-between", gap: 12 }}>
        <div>
          <strong style={{ fontSize: 16 }}>Working papers</strong>
          <p className="muted" style={{ margin: "2px 0 0", fontSize: 13 }}>Each year's papers. Open one to work on it; last year's lines come across as each schedule is opened.</p>
        </div>
        <a className="btn small" href={href("papers")}>All working papers</a>
      </div>

      {!all.length ? (
        <div className="alert amber"><strong>No year end on this client</strong><span>Add it in the client settings (or Companies House will fill it in) and the years will appear here.</span></div>
      ) : (
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th scope="col">Year to</th><th scope="col">Status</th><th scope="col" className="num">Sections</th>
                <th scope="col">Prepared</th><th scope="col">Reviewed</th><th scope="col">Accounts due</th><th scope="col">Xero</th><th scope="col"><span className="sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.period}>
                  <td><strong>{fmtDate(r.period)}</strong>{r.current && <span className="chip blue" style={{ marginLeft: 6 }}>Current</span>}</td>
                  <td><span className={`chip ${r.status === "Complete" ? "green" : r.status === "In progress" ? "amber" : ""}`}>{r.status}</span></td>
                  <td className="num mono">{r.p.done} / {r.p.total}</td>
                  <td className="mono">{r.prepared} / {r.total}</td>
                  <td className="mono">{r.reviewed} / {r.total}</td>
                  <td>{r.job?.Deadline ? fmtDate(String(r.job.Deadline), { year: false }) : <span className="muted">–</span>}</td>
                  <td>{r.xero ? <span className="muted" style={{ fontSize: 12 }}>Read {fmtDate(r.xero)}</span> : <span className="muted">–</span>}</td>
                  <td style={{ textAlign: "right" }}><a className="btn small" href={openHref(r.period)}>{r.status === "Not started" ? "Start" : "Open"}</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card pad stack" style={{ gap: 8 }}>
        <strong style={{ fontSize: 14 }}>Start another year</strong>
        <div className="row-wrap" style={{ gap: 8, alignItems: "flex-end" }}>
          <label className="stack" style={{ gap: 4, fontSize: 12 }}>
            <span className="muted">Year to</span>
            <input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} style={{ width: "auto" }} />
          </label>
          {startOk ? (
            <a className="btn primary" href={openHref(start)}>Start papers to {fmtDate(start)}</a>
          ) : (
            <span className="muted" style={{ fontSize: 13 }}>{start && all.includes(start) ? "Those papers are already in the list above." : "Pick the year end."}</span>
          )}
        </div>
      </div>
    </div>
  );
}
