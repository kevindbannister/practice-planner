// Sales and onboarding reports (Phase 5): basic, from the records already in the planner.
import { useMemo, useState } from "react";
import { addDays } from "../lib/planning";
import { todayIso } from "../lib/domain";
import { onboardingReport, reportCsv, salesReport } from "../lib/reports";
import { href } from "./bits";
import { useData } from "./data";
import { useOnboarding } from "./OnboardingPage";
import { useSales } from "./salesKit";
import { Lead, Opp } from "../lib/sales";

const gbp = (n: number) => "£" + n.toLocaleString("en-GB", { maximumFractionDigits: 0 });
const pc = (n?: number) => (n === undefined ? "—" : `${n}%`);

export function ReportsPage() {
  const s = useSales();
  const { data } = useData();
  const o = useOnboarding();
  const today = todayIso();
  const [range, setRange] = useState<"12m" | "year" | "all">("12m");
  const from = range === "12m" ? addDays(today, -365) : range === "year" ? `${today.slice(0, 4)}-01-01` : "";
  const sr = useMemo(() => salesReport({ leads: s.leads as Lead[], opps: s.opps as Opp[], proposals: data.proposals, versions: data.proposalVersions, onboardings: data.onboardings, from, to: "" }), [s.leads, s.opps, data.proposals, data.proposalVersions, data.onboardings, from]);
  const or = useMemo(() => onboardingReport({ onboardings: data.onboardings, viewFor: o.viewFor, today, from }), [data.onboardings, o.viewFor, today, from]); // eslint-disable-line react-hooks/exhaustive-deps
  const download = () => {
    const url = URL.createObjectURL(new Blob([reportCsv(sr, or)], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = `sales-report-${today}.csv`; a.click(); URL.revokeObjectURL(url);
  };
  const f = sr.funnel;
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="row-wrap" style={{ justifyContent: "space-between" }}>
        <div className="row-wrap">
          {([["12m", "Last 12 months"], ["year", "This year"], ["all", "All time"]] as const).map(([k, l]) => <button key={k} type="button" className="btn" aria-pressed={range === k} onClick={() => setRange(k)}>{l}</button>)}
        </div>
        <button type="button" className="btn" onClick={download}>Download as CSV</button>
      </div>
      <p className="muted" style={{ margin: 0 }}>Counts records created in the period. Values are contracted fees before VAT, from what proposals agreed: not invoices and not cash. Fee and revenue totals are under Fees & revenue.</p>

      <section className="card pad stack" aria-label="Sales funnel">
        <h2 style={{ margin: 0, fontSize: 16 }}>Sales funnel</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 10 }}>
          {([["Leads", f.leads], ["Opportunities", f.opportunities], ["Proposals made", f.proposalsMade], ["Proposals sent", f.proposalsSent], ["Accepted", f.proposalsAccepted], ["Onboarding started", f.onboardingStarted], ["Activated", f.activated]] as [string, number][]).map(([k, v]) => <div key={k} className="card" style={{ padding: 12 }}><div className="muted" style={{ fontSize: 12 }}>{k}</div><div style={{ fontSize: 22, fontWeight: 700 }}>{v}</div></div>)}
        </div>
        <p style={{ margin: 0 }}>Opportunities won {pc(sr.rates.oppWon)} of those decided · proposals accepted {pc(sr.rates.proposalAccepted)} of those decided · leads reaching activation {pc(sr.rates.leadToActivated)}.</p>
        <p style={{ margin: 0 }}>Average {sr.timing.daysOppToAccepted ?? "—"} days from opportunity to accepted proposal; {sr.timing.daysAcceptedToActivated ?? "—"} days from accepted to activated. Accepted proposals agreed {gbp(sr.acceptedValue.recurring)} a year recurring and {gbp(sr.acceptedValue.oneOff)} one-off.</p>
        <p style={{ margin: 0 }}>Opportunities: {sr.opps.won} won ({gbp(sr.opps.wonValue)}), {sr.opps.lost} lost ({gbp(sr.opps.lostValue)}), {sr.opps.deferred} deferred, {sr.opps.open} open ({gbp(sr.opps.openValue)}).</p>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 14 }}>
        <section className="card pad stack" aria-label="By source">
          <h2 style={{ margin: 0, fontSize: 16 }}>Leads by source</h2>
          {!sr.bySource.length ? <p className="muted" style={{ margin: 0 }}>No leads in this period.</p> : <table className="tbl"><thead><tr><th>Source</th><th>Leads</th><th>Won</th><th>Won value</th></tr></thead><tbody>{sr.bySource.map((x) => <tr key={x.source}><td>{x.source}</td><td>{x.leads}</td><td>{x.won}</td><td>{x.wonValue ? gbp(x.wonValue) : "—"}</td></tr>)}</tbody></table>}
        </section>
        <section className="card pad stack" aria-label="Lost reasons">
          <h2 style={{ margin: 0, fontSize: 16 }}>Why opportunities were lost</h2>
          {!sr.lostReasons.length ? <p className="muted" style={{ margin: 0 }}>None lost in this period.</p> : <table className="tbl"><tbody>{sr.lostReasons.map((x) => <tr key={x.reason}><td>{x.reason}</td><td>{x.count}</td></tr>)}</tbody></table>}
        </section>
      </div>

      <section className="card pad stack" aria-label="Onboarding report">
        <h2 style={{ margin: 0, fontSize: 16 }}>Onboarding</h2>
        <p style={{ margin: 0 }}>{or.inProgress} in progress ({or.blocked} blocked, {or.awaitingApproval} awaiting approval, {or.readyToActivate} ready to activate) · {or.activated} activated in the period{or.avgDaysToActivate !== undefined ? `, averaging ${or.avgDaysToActivate} days` : ""} · {or.heldServices} service{or.heldServices === 1 ? "" : "s"} held for an authorisation.</p>
        {!!or.stageCounts.length && <p className="muted" style={{ margin: 0 }}>Waiting on: {or.stageCounts.map((x) => `${x.label} (${x.waiting})`).join(", ")}.</p>}
        {!or.open.length ? <p className="muted" style={{ margin: 0 }}>Nobody is being onboarded.</p> : <table className="tbl"><thead><tr><th>Onboarding</th><th>Client</th><th>Days open</th><th>Waiting on</th></tr></thead><tbody>{or.open.map((x) => <tr key={x.key}><td><a href={href("sales", "onboard", x.key)}>{x.ref}</a></td><td>{x.client}</td><td>{x.days}</td><td>{x.blocked ? <span className="chip red">Blocked</span> : null} {x.waitingOn}</td></tr>)}</tbody></table>}
      </section>
    </div>
  );
}
