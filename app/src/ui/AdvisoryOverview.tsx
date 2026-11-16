// Advisory overview: the landing page of the Advisory workspace. Who the practice advises, what each client has
// (a Freedom Plan, a tax plan), what needs looking at, and the way in to the advisory tools.
//
// Every figure here is counted from records the practice already keeps (Freedom Plans, tax plans and tasks).
// Nothing is estimated and there is no financial analysis on this page yet: see OPPORTUNITIES at the end, which is
// where data-driven prompts (margins, cash, debtor days) will plug in once they can be worked out from real ledgers.
import { useMemo } from "react";
import { Task, fmtDate, todayIso } from "../lib/domain";
import { gap, readPlan } from "../lib/advisory";
import { useData, useIndex } from "./data";
import { useEditor } from "./Editors";
import { Icon, IconName, href } from "./bits";
import { pct } from "./advisoryKit";

/** A Freedom Plan or tax plan not touched for this long is listed for review. */
const REVIEW_MONTHS = 6;

/** One prompt on the overview, worked out from a client's real figures. None are produced yet. */
export interface AdvisoryOpportunity { clientKey: string; kind: string; title: string; detail: string; to: string }
/** Where data-driven opportunities will come from (falling gross margin, a weakening cash position, rising debtor
 *  days, revenue growing while profit falls, a forecast cash shortage, a jump in overheads). Each needs figures the
 *  app can verify, so for now this returns none and the overview says so plainly. */
export function advisoryOpportunities(): AdvisoryOpportunity[] { return []; }

type Line = { key: string; name: string; plan?: { updated: string; met?: number; why: string }; tax?: { year: number; status: string; updated: string }; updated: string; openTasks: number; next?: Task };

export function AdvisoryOverview() {
  const { data } = useData();
  const idx = useIndex();
  const { open } = useEditor();
  const today = todayIso();
  const cutoff = useMemo(() => { const d = new Date(`${today}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - REVIEW_MONTHS); return d.toISOString().slice(0, 10); }, [today]);

  const lines = useMemo(() => {
    const by = new Map<string, Line>();
    const line = (clientKey: string): Line | undefined => {
      const c = idx.clientByKey.get(clientKey);
      if (!c) return undefined;
      if (!by.has(clientKey)) by.set(clientKey, { key: clientKey, name: String(c.Title || clientKey), updated: "", openTasks: 0 });
      return by.get(clientKey);
    };
    for (const r of data.advisoryPlans) {
      if (r.Kind !== "plan") continue;
      const l = line(String(r.ClientKey));
      if (!l) continue;
      const plan = readPlan(r.Json);
      const updated = String(r.Updated || r.Created || "").slice(0, 10);
      let met: number | undefined;
      try { met = gap(plan).total.metNow; } catch { met = undefined; }
      l.plan = { updated, met, why: String(plan.why || "") };
    }
    for (const r of data.taxPlans) {
      const l = line(String(r.ClientKey));
      if (!l) continue;
      const year = Number(r.TaxYear) || 0;
      if (l.tax && l.tax.year > year) continue; // keep the latest year
      l.tax = { year, status: String(r.Status) === "agreed" ? "agreed" : "draft", updated: String(r.Updated || r.Created || "").slice(0, 10) };
    }
    const tasks = (idx.openTasks as Task[]).filter((t) => t.ClientKey && by.has(String(t.ClientKey)));
    for (const t of tasks) {
      const l = by.get(String(t.ClientKey))!;
      l.openTasks += 1;
      const due = String(t.DueDate || t.PlannedDate || "9999");
      if (!l.next || due < String(l.next.DueDate || l.next.PlannedDate || "9999")) l.next = t;
    }
    for (const l of by.values()) l.updated = [l.plan?.updated || "", l.tax?.updated || ""].sort().pop() || "";
    return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [data.advisoryPlans, data.taxPlans, idx.clientByKey, idx.openTasks]);

  const plans = lines.filter((l) => l.plan);
  const taxPlans = lines.filter((l) => l.tax);
  const stale = lines.filter((l) => l.updated && l.updated < cutoff);
  const drafts = taxPlans.filter((l) => l.tax!.status === "draft");
  const overdue = useMemo(() => (idx.openTasks as Task[])
    .filter((t) => t.ClientKey && lines.some((l) => l.key === String(t.ClientKey)) && t.DueDate && String(t.DueDate) < today)
    .sort((a, b) => String(a.DueDate).localeCompare(String(b.DueDate))), [idx.openTasks, lines, today]);
  const openTasks = lines.reduce((n, l) => n + l.openTasks, 0);
  const opportunities = advisoryOpportunities();

  const tile = (label: string, value: number, sub: string, to?: string) => {
    const inner = <><span className="label">{label}</span><span className="value">{value}</span><span className="sub">{sub}</span></>;
    return to ? <a className="tile adv-tile" href={to}>{inner}</a> : <div className="tile adv-tile">{inner}</div>;
  };
  const tool = (icon: IconName, title: string, text: string, to: string) => (
    <a className="adv-tool" href={to}>
      <span className="adv-tool-icon" aria-hidden="true"><Icon name={icon} size={20} /></span>
      <span><strong>{title}</strong><span className="muted">{text}</span></span>
      <Icon name="right" size={16} />
    </a>
  );
  const status = (l: Line) => (l.updated && l.updated < cutoff ? <span className="chip amber">Review due</span> : l.plan && l.tax ? <span className="chip green">Plan and tax plan</span> : l.plan ? <span className="chip blue">Freedom Plan</span> : <span className="chip">Tax plan</span>);
  const nextAction = (l: Line) => {
    if (l.next) return <button type="button" className="linklike" onClick={() => open({ kind: "task", key: l.next!.Key })}>{l.next.Title}{l.next.DueDate ? `, due ${fmtDate(String(l.next.DueDate), { year: false })}` : ""}</button>;
    if (l.tax?.status === "draft") return <a href={href("taxplan", l.key)}>Agree the {l.tax.year ? `${l.tax.year}/${String(l.tax.year + 1).slice(2)} ` : ""}tax plan</a>;
    if (l.updated && l.updated < cutoff) return <a href={l.plan ? href("advisory", l.key) : href("taxplan", l.key)}>Review with the client</a>;
    return <span className="muted">Nothing outstanding</span>;
  };

  return (
    <div className="page adv-overview">
      <div className="page-head">
        <div>
          <h1>Advisory overview</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>The clients you advise, what each has in place and what needs looking at. Counted from your Freedom Plans, tax plans and tasks.</p>
        </div>
        <div className="row-wrap"><a className="btn primary" href="#/advisory">Start a Freedom Plan</a></div>
      </div>

      <section className="adv-tiles" aria-label="Advisory in numbers">
        {tile("Advisory clients", lines.length, "with a Freedom Plan or a tax plan", "#/clients/all")}
        {tile("Freedom Plans", plans.length, plans.length === 1 ? "client with a plan" : "clients with a plan", "#/advisory")}
        {tile("Tax plans", taxPlans.length, `${taxPlans.length - drafts.length} agreed, ${drafts.length} in draft`, "#/taxplan")}
        {tile("Open tasks", openTasks, `for advisory clients${overdue.length ? `, ${overdue.length} overdue` : ""}`, "#/plan/today")}
        {tile("Review due", stale.length, `not updated in ${REVIEW_MONTHS} months`)}
      </section>

      <div className="adv-cols">
        <section className="card" aria-labelledby="adv-port-h">
          <div className="card-head"><h2 id="adv-port-h">Client advisory portfolio</h2><span className="muted">{lines.length} client{lines.length === 1 ? "" : "s"}</span></div>
          {lines.length ? (
            <div className="table-wrap">
              <table className="table grid adv-table">
                <thead><tr><th>Client</th><th>Status</th><th>Freedom Plan</th><th>Tax plan</th><th>Last updated</th><th>Next action</th></tr></thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.key}>
                      <td><a href={href("clients", l.key)}>{l.name}</a></td>
                      <td>{status(l)}</td>
                      <td>{l.plan ? <a href={href("advisory", l.key)}>{l.plan.met === undefined ? "Open plan" : `${pct(l.plan.met)} of Freedom Number met`}</a> : <span className="muted">None</span>}</td>
                      <td>{l.tax ? <a href={href("taxplan", l.key)}>{l.tax.year ? `${l.tax.year}/${String(l.tax.year + 1).slice(2)}, ` : ""}{l.tax.status === "agreed" ? "agreed" : "draft"}</a> : <span className="muted">None</span>}</td>
                      <td>{l.updated ? fmtDate(l.updated) : <span className="muted">Not recorded</span>}</td>
                      <td>{nextAction(l)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="adv-empty">
              <p><strong>No advisory records yet.</strong> A client appears here once they have a Freedom Plan or a tax plan.</p>
              <div className="row-wrap"><a className="btn primary" href="#/advisory">Start a Freedom Plan</a><a className="btn" href="#/taxplan">Start a tax plan</a></div>
            </div>
          )}
        </section>

        <div className="adv-side">
          <section className="card" aria-labelledby="adv-att-h">
            <div className="card-head"><h2 id="adv-att-h">Needs attention</h2></div>
            {overdue.length + drafts.length + stale.length === 0 ? (
              <p className="adv-empty">{lines.length ? "Nothing needs attention: no overdue tasks, no tax plans waiting to be agreed and no plans due a review." : "Overdue tasks, tax plans waiting to be agreed and plans due a review will be listed here."}</p>
            ) : (
              <ul className="adv-list">
                {overdue.slice(0, 6).map((t) => (
                  <li key={`t${t.Key}`}><button type="button" onClick={() => open({ kind: "task", key: t.Key })}>
                    <span><strong>{idx.clientByKey.get(String(t.ClientKey))?.Title}</strong><span className="muted">{t.Title}</span></span>
                    <span className="chip red">Due {fmtDate(String(t.DueDate), { year: false })}</span>
                  </button></li>
                ))}
                {overdue.length > 6 && <li className="adv-more"><a href="#/plan/today">{overdue.length - 6} more overdue tasks</a></li>}
                {drafts.map((l) => (
                  <li key={`d${l.key}`}><a href={href("taxplan", l.key)}>
                    <span><strong>{l.name}</strong><span className="muted">Tax plan in draft, not yet agreed</span></span>
                    <span className="chip amber">Draft</span>
                  </a></li>
                ))}
                {stale.map((l) => (
                  <li key={`s${l.key}`}><a href={l.plan ? href("advisory", l.key) : href("taxplan", l.key)}>
                    <span><strong>{l.name}</strong><span className="muted">Last updated {fmtDate(l.updated)}</span></span>
                    <span className="chip amber">Review due</span>
                  </a></li>
                ))}
              </ul>
            )}
          </section>

          <section className="card" aria-labelledby="adv-tools-h">
            <div className="card-head"><h2 id="adv-tools-h">Advisory tools</h2></div>
            <div className="adv-tools">
              {tool("chart", "Reporting", "Management reports, KPIs and analysis", "#/reporting")}
              {tool("flag", "Freedom Plans", "What life costs and what the business must deliver", "#/advisory")}
              {tool("calc", "Tax planning", "Salary and dividend planning", "#/taxplan")}
              {tool("clients", "Client records", "Every client, with their work and contacts", "#/clients/all")}
            </div>
          </section>
        </div>
      </div>

      <section className="card" aria-labelledby="adv-opp-h">
        <div className="card-head"><h2 id="adv-opp-h">Opportunities</h2></div>
        {opportunities.length ? (
          <ul className="adv-list">{opportunities.map((o) => <li key={`${o.clientKey}${o.kind}`}><a href={o.to}><span><strong>{o.title}</strong><span className="muted">{o.detail}</span></span></a></li>)}</ul>
        ) : (
          <p className="adv-empty">Nothing is flagged here yet. This is where prompts worked out from a client's own figures will appear, such as a falling margin or a tightening cash position. Until those can be calculated from verified ledgers, the page shows none rather than guess. For a client's figures today, open <a href="#/reporting">Reporting</a>.</p>
        )}
      </section>
    </div>
  );
}
