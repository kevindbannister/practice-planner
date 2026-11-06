// Practice: one read-only page for how the whole firm is doing. Work and deadlines, capacity, who carries what, the money,
// fees against recorded time, compliance gaps and growth. Every figure links to the screen with the detail. See lib/practice.ts.
import { ReactNode, useMemo, useState } from "react";
import { clientHoursOn } from "../lib/dayTypes";
import { fmtDate, fmtHours, todayIso } from "../lib/domain";
import { PRACTICE_RATE_KEY, monthLabel, practiceView, readTargetRate } from "../lib/practice";
import { href } from "./bits";
import { readSetting, useData } from "./data";
import { useSales } from "./salesKit";

const gbp = (n: number) => "£" + Math.round(n).toLocaleString("en-GB");
const gbp2 = (n: number) => "£" + n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function Tile({ label, value, sub, to, tone }: { label: string; value: string; sub?: string; to: string; tone?: "red" | "amber" }) {
  return <a role="listitem" className="tl-sum" href={to}><span className="tl-sum-label">{label}</span><strong className={tone ? "warn" : ""}>{value}</strong><span className="muted tl-sum-sub">{sub || ""}</span></a>;
}
function Card({ title, to, link, children }: { title: string; to?: string; link?: string; children: ReactNode }) {
  return (
    <section className="card pad stack" style={{ gap: 10, breakInside: "avoid", marginBottom: 16 }} aria-label={title}>
      <div className="card-title-row"><h2 className="sec-h">{title}</h2>{to && <a className="linkbtn" href={to}>{link || "Open"}</a>}</div>
      {children}
    </section>
  );
}
const Bar = ({ pct, over, label }: { pct: number; over?: boolean; label: string }) => <div className="meter" role="img" aria-label={label}><span className={over ? "over" : ""} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></div>;

export function PracticePage() {
  const { data, settings, saveSetting } = useData();
  const s = useSales();
  const today = todayIso();
  const money = s.can("view");
  const target = readTargetRate(readSetting<number>(data.settings, PRACTICE_RATE_KEY));
  const [rate, setRate] = useState(String(target));
  const [saved, setSaved] = useState("");
  const v = useMemo(() => practiceView({
    clients: data.clients, jobs: data.jobs, tasks: data.tasks, services: data.services, clientServices: data.clientServices, charges: data.feeCharges, costs: data.clientCosts, time: data.jobTime, billingLinks: data.billingLinks,
    amlAssessments: data.amlAssessments, onboardings: data.onboardings, leads: data.leads, opps: data.opportunities, proposals: data.proposals, versions: data.proposalVersions,
    capacity: (d) => clientHoursOn(d, settings), today, targetRate: target,
  }), [data, settings, today, target]);
  const name = (k: string) => String(data.clients.find((c) => c.Key === k)?.Title || k);
  const svc = (k: string) => String(data.services.find((x) => x.Key === k)?.Title || k);
  const maxMonth = Math.max(1, ...v.work.deadlines.map((m) => m.total));
  const g = v.compliance;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Practice</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>How the whole firm is doing today. Read only: every figure opens the screen with the detail.</p>
        </div>
      </div>

      <div className="tl-summary" role="list" aria-label="The practice in numbers">
        <Tile label="Active clients" value={String(v.clients.active)} sub={v.clients.byKind.slice(0, 3).map((k) => `${k.count} ${k.kind}`).join(", ")} to="#/clients/all" />
        {money && <Tile label="Recurring fees" value={gbp(v.money.arr)} sub={`${gbp(v.money.mrr)} a month`} to="#/sales/fees" />}
        <Tile label="Open jobs" value={String(v.work.open)} sub={`${v.work.held} on hold`} to="#/plan" />
        <Tile label="Overdue" value={String(v.work.overdue)} sub={`${v.work.tight} more due soon`} to="#/plan/deadlines" tone={v.work.overdue ? "red" : undefined} />
        <Tile label="Next 3 months" value={`${v.capacity.next3Pct}%`} sub={`${fmtHours(v.capacity.next3Due) || "0h"} due, ${fmtHours(v.capacity.next3Capacity) || "0h"} available`} to="#/plan/months" tone={v.capacity.next3Pct > 100 ? "red" : v.capacity.next3Pct > 85 ? "amber" : undefined} />
        <Tile label="Compliance gaps" value={String(g.gaps)} sub="no or overdue AML review" to="#/clients/all" tone={g.gaps ? "amber" : undefined} />
      </div>

      <div style={{ columnWidth: 420, columnGap: 16 }}>
        <Card title="Work and deadlines" to="#/plan/deadlines" link="Deadlines">
          <div className="row-wrap" style={{ gap: 8 }}>
            <span className={`chip ${v.work.overdue ? "red" : ""}`}>{v.work.overdue} overdue</span><span className={`chip ${v.work.tight ? "amber" : ""}`}>{v.work.tight} due soon</span><span className="chip green">{v.work.onTrack} on track</span>
            <span className="chip">{v.work.waiting} waiting on others</span><span className="chip">{v.work.held - v.work.waiting} on hold</span>
          </div>
          {v.work.oldest.length > 0 && (
            <div className="table-wrap"><table className="grid"><thead><tr><th>Oldest overdue</th><th>Client</th><th className="num">Days late</th></tr></thead>
              <tbody>{v.work.oldest.map((j) => <tr key={j.key}><td>{j.title}</td><td><a href={href("clients", j.clientKey)}>{name(j.clientKey)}</a></td><td className="num">{j.days}</td></tr>)}</tbody></table></div>
          )}
          <div className="stack" style={{ gap: 4 }}>
            <strong style={{ fontSize: 13 }}>Deadlines, next six months</strong>
            {v.work.deadlines.map((m) => <div key={m.key} className="row-wrap" style={{ gap: 8, flexWrap: "nowrap" }}><span style={{ width: 70 }}>{monthLabel(m.key)}</span><div style={{ flex: 1 }}><Bar pct={(m.total / maxMonth) * 100} label={`${m.total} deadlines`} /></div><span className="muted" style={{ width: 170, textAlign: "right", whiteSpace: "nowrap" }}>{m.total}{m.statutory ? ` (${m.statutory} statutory)` : ""}</span></div>)}
          </div>
        </Card>

        <Card title="Capacity" to="#/plan/months" link="Months ahead">
          {v.capacity.lateHours > 0 && <p className="import-list warn" role="note" style={{ margin: 0 }}>{fmtHours(v.capacity.lateHours)} of work is already late.</p>}
          {v.capacity.months.map((m) => <div key={m.key} className="row-wrap" style={{ gap: 8, flexWrap: "nowrap" }}><span style={{ width: 70 }}>{monthLabel(m.key)}</span><div style={{ flex: 1 }}><Bar pct={Math.min(100, m.pct)} over={m.pct > 100} label={`${m.pct}% of capacity`} /></div><span className={m.pct > 100 ? "warn" : "muted"} style={{ width: 190, textAlign: "right", whiteSpace: "nowrap" }}>{fmtHours(m.due) || "0h"} of {fmtHours(m.capacity) || "0h"} ({m.pct}%)</span></div>)}
          {v.capacity.peak && v.capacity.peak.pct > 100 && <p className="muted" style={{ margin: 0 }}>{monthLabel(v.capacity.peak.key)} is the most over-committed month, at {v.capacity.peak.pct}% of the hours available.</p>}
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>Counts open jobs by deadline and the recurring jobs still to come, against your working hours and leave.</p>
        </Card>

        <Card title="Who carries what">
          <div className="table-wrap"><table className="grid"><thead><tr><th>Manager or partner</th><th className="num">Clients</th>{money && <th className="num">Fees a year</th>}<th className="num">Open jobs</th><th className="num">Overdue</th></tr></thead>
            <tbody>{v.team.map((t) => <tr key={t.owner}><td>{t.owner}</td><td className="num">{t.clients}</td>{money && <td className="num">{gbp(t.arr)}</td>}<td className="num">{t.open}</td><td className="num">{t.overdue ? <span className="chip red">{t.overdue}</span> : "0"}</td></tr>)}</tbody></table></div>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>By the client's manager, or partner where there is none. Jobs aren't assigned to people, so this is by client.</p>
        </Card>

        {money && (
          <Card title="Money" to="#/sales/fees" link="Fees & revenue">
            <div className="row-wrap" style={{ gap: 8 }}><span className="chip">{gbp(v.money.arr)} a year</span><span className="chip">{gbp(v.money.oneOff)} one-off agreed</span>{v.money.heldArr > 0 && <span className="chip amber">{gbp(v.money.heldArr)} on hold</span>}{v.money.reviewsDue > 0 && <a className="chip amber" href="#/sales/fees">{plural(v.money.reviewsDue, "fee review")} due</a>}</div>
            {v.money.top.length > 0 && <>
              <p style={{ margin: 0 }}>The biggest five clients are <strong>{v.money.top5Pct}%</strong> of recurring fees{v.money.top5Pct >= 50 ? ". That is a lot resting on a few clients." : "."}</p>
              <div className="table-wrap"><table className="grid"><tbody>{v.money.top.map((c) => <tr key={c.clientKey}><td><a href={href("clients", c.clientKey)}>{name(c.clientKey)}</a></td><td className="num">{gbp(c.arr)}</td><td className="num muted">{c.pct}%</td></tr>)}</tbody></table></div>
            </>}
            {v.money.byService.length > 0 && <div className="stack" style={{ gap: 2 }}><strong style={{ fontSize: 13 }}>By service</strong>{v.money.byService.map((x) => <div key={x.serviceKey} className="row-wrap" style={{ justifyContent: "space-between" }}><span>{svc(x.serviceKey)} <span className="muted">· {plural(x.clients, "client")}</span></span><span>{gbp(x.arr)}</span></div>)}</div>}
            <div className="row-wrap" style={{ gap: 8 }}>
              <a className="chip" href="#/sales/billing">{v.money.billing.active} of {v.money.billing.lines} recurring fees billing through Adfin</a>
              {v.money.billing.draft > 0 && <a className="chip amber" href="#/sales/billing">{v.money.billing.draft} drafts to start</a>}
            </div>
            {v.money.noFee.length > 0 && <p className="import-list warn" role="note" style={{ margin: 0 }}><span><strong>Open work, no fee on file:</strong> {v.money.noFee.map((c, i) => <span key={c.clientKey}>{i ? ", " : ""}<a href={href("clients", c.clientKey)}>{name(c.clientKey)}</a> ({plural(c.openJobs, "job")})</span>)}.</span></p>}
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>What is owed and overdue is on the <a href="#/sales/billing">Billing</a> tab, because it is read from Xero.</p>
          </Card>
        )}

        {money && (
          <Card title="Fees against time" >
            <div className="row-wrap" style={{ gap: 8, alignItems: "flex-end" }}>
              <label className="doc-field" style={{ width: 150 }}><span>Target, £ an hour</span><input className="input" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} disabled={!s.pcan("send")} /></label>
              {s.pcan("send") && <button type="button" className="btn small" onClick={() => { void saveSetting(PRACTICE_RATE_KEY, readTargetRate(rate)).then(() => setSaved("Saved.")); }}>Save</button>}
              {saved && <span role="status" className="muted">{saved}</span>}
              {v.profit.practiceRate !== undefined && <span className={`chip ${v.profit.practiceRate < target ? "amber" : "green"}`}>Practice: {gbp2(v.profit.practiceRate)} an hour</span>}
            </div>
            {v.profit.rows.length === 0 ? <p className="muted" style={{ margin: 0 }}>No client has {5} hours or more of recorded time in the last 12 months, so none can be rated yet. Record time on jobs (the timer or by hand) and this fills in.</p> : (
              <div className="table-wrap"><table className="grid"><thead><tr><th>Client (lowest first)</th><th className="num">Fees a year</th><th className="num">Hours</th><th className="num">An hour</th></tr></thead>
                <tbody>{v.profit.rows.slice(0, 10).map((r) => <tr key={r.clientKey}><td><a href={href("clients", r.clientKey)}>{name(r.clientKey)}</a></td><td className="num">{gbp(r.arr)}</td><td className="num">{r.hours}</td><td className="num">{r.below ? <span className="chip amber">{gbp2(r.rate)}</span> : gbp2(r.rate)}</td></tr>)}</tbody></table></div>
            )}
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>Recurring fees over hours recorded in the last 12 months. {v.profit.rated} of {v.profit.withFees} clients with fees have enough time recorded to rate. Time that hasn't been recorded counts for nothing, so treat this as a guide, not a verdict.</p>
          </Card>
        )}

        <Card title="Compliance" to="#/compliance" link="Risk register">
          <div className="stack" style={{ gap: 6 }}>
            <Line n={g.amlNone.length} text="clients with no approved AML assessment" tone="red" keys={g.amlNone} name={name} tab="aml" />
            <Line n={g.amlOverdue.length} text="AML reviews overdue" tone="red" keys={g.amlOverdue} name={name} tab="aml" />
            <Line n={g.amlSoon.length} text="AML reviews due within 60 days" tone="amber" keys={g.amlSoon} name={name} tab="aml" />
            <Line n={g.noLetter.length} text="clients without a signed engagement letter" tone="amber" keys={g.noLetter} name={name} tab="" />
            <Line n={v.work.overdue} text="jobs past their deadline" tone="red" keys={[]} name={name} tab="" to="#/plan/deadlines" />
          </div>
        </Card>

        {money && (
          <Card title="Growth" to="#/sales" link="Sales">
            <div className="row-wrap" style={{ gap: 8 }}><span className="chip">{plural(v.growth.openOpps, "open opportunity", "open opportunities")}, {gbp(v.growth.openValue)}</span><span className="chip green">{plural(v.growth.wonRecent, "win")} in 90 days, {gbp(v.growth.wonRecentValue)}</span></div>
            <p className="muted" style={{ margin: 0 }}>Proposals accepted in the last 90 days agreed {gbp(v.growth.acceptedRecurring)} a year in recurring fees. Figures as at {fmtDate(today)}.</p>
          </Card>
        )}
      </div>
    </div>
  );
}

function Line({ n, text, tone, keys, name, tab, to }: { n: number; text: string; tone: "red" | "amber"; keys: string[]; name: (k: string) => string; tab: string; to?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="row-wrap" style={{ gap: 8 }}>
        <span className={`chip ${n ? tone : "green"}`}>{n}</span><span>{text}</span>
        {n > 0 && keys.length > 0 && <button type="button" className="linkbtn" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Hide" : "Show"}</button>}
        {n > 0 && to && <a className="linkbtn" href={to}>Open</a>}
      </div>
      {open && <div className="row-wrap" style={{ gap: 6, paddingLeft: 8 }}>{keys.slice(0, 40).map((k) => <a key={k} className="chip" href={tab ? `#/clients/${k}/${tab}` : href("clients", k)}>{name(k)}</a>)}{keys.length > 40 && <span className="muted">and {keys.length - 40} more</span>}</div>}
    </div>
  );
}
