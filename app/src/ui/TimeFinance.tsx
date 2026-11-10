// Time reports, billing, rates, team and the data check: one page under Plan with a row of sections. What each person sees follows their role
// (lib/permissions.ts); a section they may not use is not shown.
import { useMemo, useState } from "react";
import { fmtDate, fmtHours, todayIso } from "../lib/domain";
import { addDays, mondayOf } from "../lib/planning";
import { PlanTabs } from "./bits";
import { TimeFinance as Model, useTimeFinance } from "./useTimeFinance";
import { TimeBilling } from "./TimeBilling";
import { TimeSetup } from "./TimeSetup";
import { downloadFile } from "./commsKit";
import { estimatingAccuracy, hoursText, myTime, plannedVsActual, pounds, profitability, reschedulingReport, toCsv, utilisation, Group } from "../lib/timeReports";
import { penceToPounds } from "../lib/rates";
import { BILLABLE_LABEL } from "../lib/timesheet";
import { workbook, XLSX_TYPE } from "../lib/xlsx";
import { STATUS_LABEL } from "../lib/planSessions";

export type Kind = "text" | "mins" | "pence" | "pct" | "num";
export type Table = { title: string; head: string[]; kinds: Kind[]; rows: (string | number | null)[][]; notes: string[] };
const show = (v: string | number | null, k: Kind) => (v === null || v === "" ? "—" : k === "mins" ? fmtHours((v as number) / 60) || "0m" : k === "pence" ? penceToPounds(v as number) : k === "pct" ? `${v}%` : String(v));
const raw = (v: string | number | null, k: Kind): string | number => (v === null ? "" : k === "mins" ? Number(hoursText(v as number)) : k === "pence" ? Number(pounds(v as number)) : v);

export function TimeFinance({ tab }: { tab: string }) {
  const m = useTimeFinance();
  const tabs: [string, string, boolean][] = [
    ["", "Reports", true], ["billing", "Billing", m.may("billing.manage")], ["rates", "Rates", m.may("rates.charge") || m.may("rates.cost")],
    ["team", "Team and approval", true], ["check", "Data check", m.may("team.manage")],
  ];
  const ok = tabs.filter((t) => t[2]);
  const current = ok.some((t) => t[0] === tab) ? tab : "";
  return (
    <main className="page stack" style={{ gap: 16 }}>
      <PlanTabs current="time" />
      <nav className="subtabs" aria-label="Time sections">
        {ok.map(([k, label]) => <a key={k} href={k ? `#/plan/time/${k}` : "#/plan/time"} aria-current={current === k ? "page" : undefined}>{label}</a>)}
      </nav>
      {current === "" && <Reports m={m} />}
      {current === "billing" && <TimeBilling m={m} />}
      {(current === "rates" || current === "team" || current === "check") && <TimeSetup m={m} part={current} />}
    </main>
  );
}

type Period = "week" | "lastweek" | "month" | "lastmonth" | "custom";
function range(p: Period, today: string, custom: [string, string]): [string, string] {
  const mon = mondayOf(today), first = today.slice(0, 7) + "-01";
  if (p === "week") return [mon, addDays(mon, 6)];
  if (p === "lastweek") return [addDays(mon, -7), addDays(mon, -1)];
  if (p === "month") return [first, addDays(addDays(first, 32).slice(0, 7) + "-01", -1)];
  if (p === "lastmonth") { const prev = addDays(first, -1); return [prev.slice(0, 7) + "-01", prev]; }
  return custom;
}
const REPORTS = [["my", "My time"], ["pva", "Planned against actual"], ["moves", "Rescheduling"], ["util", "Utilisation"], ["profit", "Profitability"], ["est", "Estimating accuracy"]] as const;
type R = (typeof REPORTS)[number][0];

function Reports({ m }: { m: Model }) {
  const today = todayIso();
  const [report, setReport] = useState<R>("my");
  const [period, setPeriod] = useState<Period>("month");
  const [custom, setCustom] = useState<[string, string]>([addDays(today, -30), today]);
  const [group, setGroup] = useState<Group>("client");
  const [who, setWho] = useState("");
  const [from, to] = range(period, today, custom);
  const avail = REPORTS.filter(([k]) => k !== "profit" || m.may("profit.view"));
  const table = useMemo<Table>(() => build(m, report, from, to, group, who), [m, report, from, to, group, who]); // eslint-disable-line react-hooks/exhaustive-deps
  const exportCsv = () => downloadFile(new TextEncoder().encode("﻿" + toCsv([table.head, ...table.rows.map((r) => r.map((v, i) => raw(v, table.kinds[i])))])), `${table.title} ${from} to ${to}.csv`, "text/csv;charset=utf-8");
  const exportXlsx = async () => downloadFile(await workbook([{ name: table.title.slice(0, 31), rows: [table.head, ...table.rows.map((r) => r.map((v, i) => raw(v, table.kinds[i])))] }]), `${table.title} ${from} to ${to}.xlsx`, XLSX_TYPE);
  return (
    <section className="card pad stack" aria-labelledby="tr-h">
      <div className="card-title-row"><h2 id="tr-h">{table.title}</h2>
        <span className="row-wrap">
          <button type="button" className="btn small" disabled={!table.rows.length} onClick={exportCsv}>Download CSV</button>
          <button type="button" className="btn small" disabled={!table.rows.length} onClick={() => void exportXlsx()}>Download Excel</button>
        </span>
      </div>
      <div className="row-wrap">
        <label className="field"><span>Report</span><select value={report} onChange={(e) => setReport(e.target.value as R)}>{avail.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="field"><span>Period</span><select value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
          <option value="week">This week</option><option value="lastweek">Last week</option><option value="month">This month</option><option value="lastmonth">Last month</option><option value="custom">Choose dates</option></select></label>
        {period === "custom" && <><label className="field"><span>From</span><input type="date" value={custom[0]} onChange={(e) => setCustom([e.target.value, custom[1]])} /></label><label className="field"><span>To</span><input type="date" value={custom[1]} onChange={(e) => setCustom([custom[0], e.target.value])} /></label></>}
        {report === "profit" && <label className="field"><span>Group by</span><select value={group} onChange={(e) => setGroup(e.target.value as Group)}><option value="client">Client</option><option value="service">Service</option><option value="job">Job</option><option value="user">Person</option><option value="month">Month</option></select></label>}
        {(report === "my" || report === "pva") && m.shown.length > 1 && <label className="field"><span>Person</span><select value={who} onChange={(e) => setWho(e.target.value)}><option value="">{report === "my" ? "Me" : "Everyone"}</option>{m.shown.map((u) => <option key={u} value={u}>{m.who(u)}</option>)}</select></label>}
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>{fmtDate(from)} – {fmtDate(to)}</p>
      {table.rows.length === 0 ? <p className="muted" style={{ margin: 0 }}>Nothing to show for these dates.</p> : (
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead><tr>{table.head.map((h, i) => <th key={h} scope="col" style={{ textAlign: table.kinds[i] === "text" ? "left" : "right" }}>{h}</th>)}</tr></thead>
            <tbody>{table.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} style={{ textAlign: table.kinds[j] === "text" ? "left" : "right" }}>{show(v, table.kinds[j])}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
      {table.notes.map((n) => <p key={n} className="muted" style={{ margin: 0, fontSize: 13 }}>{n}</p>)}
    </section>
  );
}

function build(m: Model, report: R, from: string, to: string, group: Group, who: string): Table {
  const { recs, ctx } = m;
  const person = (who || m.me).toLowerCase();
  if (report === "my") {
    const t = myTime(recs, person, from, to, ctx);
    return { title: "My time", head: ["Day", "Time"], kinds: ["text", "mins"], rows: [...t.days.map((d) => [fmtDate(d.date, { weekday: true, year: false }), d.minutes] as (string | number)[]), ["Total", t.total], ...(Object.keys(BILLABLE_LABEL) as (keyof typeof t.byType)[]).map((k) => [BILLABLE_LABEL[k], t.byType[k]]), ...t.byClient.slice(0, 10).map((c) => ["Client: " + m.client(c.clientKey), c.minutes]), ["Not yet approved", t.unapproved]] as (string | number)[][],
      notes: ["Time not recorded is not counted as lost time: recording every minute isn't expected."] };
  }
  if (report === "pva") {
    const s = plannedVsActual(m.sessions, recs, from, to, ctx, who);
    return { title: "Planned against actual", head: ["Day", "Client", "Work", "Outcome", "Planned time", "Actual time", "Difference"], kinds: ["text", "text", "text", "text", "mins", "mins", "mins"],
      rows: s.rows.length ? [...s.rows.map((r) => [r.date, m.client(r.clientKey), r.title, STATUS_LABEL[r.status as keyof typeof STATUS_LABEL] || r.status, r.plannedMinutes, r.actualMinutes, r.varianceMinutes]), ["Total", "", "", s.completedShare === null ? "" : `${s.completedShare}% completed`, s.planned, s.actual, s.actual - s.planned]] as (string | number)[][] : [],
      notes: [`Time on work that wasn't planned that day: ${fmtHours(s.unplannedMinutes / 60) || "none"}. Planned time is what was planned in the sessions as they stood on the day, kept even if the work was later moved.`] };
  }
  if (report === "moves") {
    const r = reschedulingReport(m.sessions, [], from, to);
    return { title: "Rescheduling", head: ["Work", "Times moved", "Time moved"], kinds: ["text", "num", "mins"],
      rows: [["All work", r.moves, r.minutesMoved], ...r.reasons.map((x) => ["Reason: " + x.reason, x.count, null]), ...r.byJob.map((j) => [j.title + (j.moves >= 3 ? " (repeatedly delayed)" : ""), j.moves, j.minutes])] as (string | number | null)[][],
      notes: ["A move is planned work put back to another day. Work moved three or more times is marked as repeatedly delayed."] };
  }
  if (report === "util") {
    const rows = utilisation(recs, m.shown, from, to, (d) => m.capacity(d), ctx);
    return { title: "Utilisation", head: ["Person", "Capacity", "Recorded", "Billable", "Non-billable", "Internal", "Not accounted for", "Utilisation", "Billable of capacity", "Billable of recorded"], kinds: ["text", "mins", "mins", "mins", "mins", "mins", "mins", "pct", "pct", "pct"],
      rows: rows.map((u) => [m.who(u.user), u.capacity, u.recorded, u.billable, u.nonbillable, u.internal, u.unaccounted, u.utilisationPct, u.billablePct, u.billableShare]),
      notes: ["Utilisation is recorded time ÷ capacity. Billable of capacity is billable time ÷ capacity; billable of recorded is billable ÷ recorded time. Capacity is the working hours in the day settings (less leave and days off), the same for everyone. Not accounted for is capacity with no time recorded, not unproductive time."] };
  }
  if (report === "profit") {
    const rows = profitability(recs, m.refs, group, from, to, ctx);
    const nm = (k: string) => (group === "client" ? m.client(k) : group === "service" ? m.service(k) : group === "job" ? m.jobTitle(k) : group === "user" ? m.who(k) : k) || "—";
    const miss = rows.reduce((t, r) => t + r.missingCost, 0), noRate = rows.reduce((t, r) => t + r.missingRate, 0);
    return { title: "Profitability", head: [group === "user" ? "Person" : group[0].toUpperCase() + group.slice(1), "Time", "Fixed fees", "Time-based value", "Labour cost", "Contribution", "Margin", "Effective rate per hour"], kinds: ["text", "mins", "pence", "pence", "pence", "pence", "pct", "pence"],
      rows: rows.map((r) => [nm(r.key), r.minutes, r.feePence, r.timeValuePence, r.costPence, r.contributionPence, r.marginPct, r.effectivePencePerHour]),
      notes: ["All figures are net of VAT. Fixed fees count for jobs completed in the period; time-based value is time done in the period at the charge rate, less write-downs and write-offs. Contribution is that less the labour cost (time × cost rate).",
        ...(miss ? [`${miss} entries have no cost rate, so their cost is missing and contribution is overstated. Add cost rates under Rates.`] : []), ...(noRate ? [`${noRate} billable entries have no charge rate, so they add no value.`] : [])] };
  }
  const a = estimatingAccuracy(recs, m.refs, from, to, ctx);
  return { title: "Estimating accuracy", head: ["Job", "Client", "Estimated", "Actual", "Difference", "Actual as % of estimate"], kinds: ["text", "text", "num", "num", "num", "pct"],
    rows: a.rows.map((r) => [r.title, m.client(r.clientKey), r.estimate, r.actual, r.varianceHours, r.ratioPct]), notes: [a.overall === null ? "No finished jobs have both an estimate and recorded time." : `Overall, finished jobs took ${a.overall}% of the hours estimated (hours, not money). Over 100% means longer than estimated.`] };
}
