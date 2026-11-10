// Tax planning: salary and dividend planning for an owner-managed company, for one tax year. The list shows each company and
// whether it has a plan; one plan compares salary options for all its directors and shareholders, with and without Employment
// Allowance, using each person's own tax position. See lib/taxPlanning.ts.
import { useEffect, useMemo, useState } from "react";
import { Client, todayIso } from "../lib/domain";
import { readSetup, setupRow } from "../lib/papers";
import type { Row } from "../lib/schema";
import { officerName } from "../lib/cosecForms";
import { readEntry, replay } from "../lib/shareLedger";
import { readReturn } from "../lib/tax";
import { yearEnd, yearLabel, yearOf } from "../lib/taxRates";
import * as tp from "../lib/taxPlanning";
import { newKey } from "../lib/planning";
import { href, useRoute } from "./bits";
import { useData, useIndex } from "./data";
import { useSales } from "./salesKit";
import { TAX_ITEM } from "./TaxPage";
import { EXAMPLE_COMPANY, examplePlan } from "../lib/taxPlanExample";
import { planLetter } from "../lib/taxPlanLetter";
import { DEFAULT_LAYOUT } from "../lib/docModel";
import { displayName } from "../lib/docBranding";
import { makePdf, useDocs } from "./docsKit";

const gbp = (n: number) => (n < 0 ? "-£" : "£") + Math.round(Math.abs(n)).toLocaleString("en-GB");
const neg = (n: number) => (Math.round(n) ? `-${gbp(n)}` : "£0");
const isLtd = (c: Client) => c.Kind === "Ltd" || (!!c.CompanyNumber && c.Kind !== "LLP");
const defaultYear = (today: string) => Math.min(yearOf(today), Math.max(...tp.PLAN_YEARS));
const planFor = (rows: Record<string, unknown>[], ck: string, year: number) => rows.find((r) => r.ClientKey === ck && Number(r.TaxYear) === year);

/** Tax planning, under Advise: the list of companies, or one company's plan for a tax year. */
export function TaxPlanningPage() {
  const { parts } = useRoute();
  return parts[1] ? <TaxPlanView clientKey={parts[1]} year={Number(parts[2]) || undefined} /> : <TaxPlanningList />;
}

export function TaxPlanningList() {
  const { data } = useData();
  const [year, setYear] = useState(defaultYear(todayIso()));
  const [q, setQ] = useState("");
  const rows = (data.clients as Client[]).filter((c) => isLtd(c) && String(c.Status) !== "Archived" && (!q || String(c.Title).toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => String(a.Title).localeCompare(String(b.Title)));
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Tax planning</h1><p className="muted" style={{ margin: "4px 0 0" }}>Salary and dividends for each limited company's directors and shareholders.</p></div>
        <a className="btn" href={href("taxplan", "example", String(year))}>Worked example</a>
        <label className="row-wrap" style={{ gap: 6, fontSize: 13 }}>Tax year
          <select className="input" style={{ width: "auto" }} value={year} onChange={(e) => setYear(Number(e.target.value))}>{[...tp.PLAN_YEARS].reverse().map((y) => <option key={y} value={y}>{yearLabel(y)}</option>)}</select>
        </label>
      </div>
      <div className="row-wrap" style={{ gap: 8 }}><input className="input" style={{ maxWidth: 360 }} placeholder="Find a company" aria-label="Find a company" value={q} onChange={(e) => setQ(e.target.value)} /><span className="muted" style={{ marginLeft: "auto" }}>{rows.length} companies</span></div>
      <div className="card table-wrap"><table className="grid">
        <thead><tr><th>Company</th><th>Plan for {yearLabel(year)}</th><th>Updated</th></tr></thead>
        <tbody>{rows.map((c) => { const p = planFor(data.taxPlans, c.Key, year); return (
          <tr key={c.Key}><td><a href={href("taxplan", c.Key, String(year))}>{c.Title}</a></td>
            <td>{p ? <span className={`chip ${p.Status === "agreed" ? "green" : "amber"}`}>{p.Status === "agreed" ? "Agreed" : "Draft"}</span> : <span className="muted">Not started</span>}</td>
            <td className="muted">{p ? String(p.Updated || p.Created || "").slice(0, 10) : ""}</td></tr>); })}</tbody>
      </table></div>
    </div>
  );
}

export function TaxPlanView({ clientKey, year: yearParam }: { clientKey: string; year?: number }) {
  const { data, create, update, user } = useData();
  const idx = useIndex();
  const sales = useSales();
  const year = yearParam && tp.PLAN_YEARS.includes(yearParam) ? yearParam : defaultYear(todayIso());
  const isExample = clientKey === "example";
  const c = (isExample ? { Key: "example", Title: EXAMPLE_COMPANY, Kind: "Ltd" } : idx.clientByKey.get(clientKey)) as Client | undefined;
  const row = isExample ? undefined : planFor(data.taxPlans, clientKey, year);
  const docs = useDocs();
  const start = (): tp.PlanInput => {
    if (isExample) return examplePlan(year);
    if (row) return tp.readPlan(row.Inputs, year, String(c?.Title || ""));
    const directors = data.cosecOfficers.filter((o) => o.ClientKey === clientKey && String(o.Role) === "director" && String(o.Status) !== "resigned" && !o.ResignedOn).map((o) => ({ name: officerName(o), clientKey: String(o.PersonClientKey || "") }));
    const holdings = replay(data.cosecLedger.filter((r) => r.ClientKey === clientKey).map(readEntry)).holdings.filter((h) => h.number > 0);
    return { ...tp.blankPlan(year, String(c?.Title || "")), dividendSplit: tp.hasAlphabetShares(holdings) ? "classes" : "same", people: tp.startingPeople(directors, holdings, () => newKey("TP")) };
  };
  const [plan, setPlan] = useState<tp.PlanInput>(start);
  const [chosen, setChosen] = useState<tp.OptionKey>((row?.Chosen as tp.OptionKey) || "best");
  const [ea, setEa] = useState<"likely" | "with" | "without">("likely");
  const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { setPlan(start()); setChosen((row?.Chosen as tp.OptionKey) || "best"); /* eslint-disable-next-line */ }, [clientKey, year, row?.Key]);

  const savedReturn = (p: tp.Person) => { if (!p.clientKey) return undefined; const r = setupRow(data.papers, p.clientKey, yearEnd(year), TAX_ITEM); return r ? readReturn(readSetup(r).r) : undefined; };
  const problems = tp.planProblems(plan);
  const ctx = useMemo(() => tp.context(plan, savedReturn), [plan, data.papers, year]); // eslint-disable-line
  const options = useMemo(() => (problems.length ? [] : tp.assess(plan, ctx)), [plan, ctx]); // eslint-disable-line
  const best = tp.recommended(options);
  const pick = options.find((o) => o.key === chosen) || best;
  const shown = pick ? (ea === "with" ? pick.withEa : ea === "without" ? pick.withoutEa : pick.likely) : undefined;
  const dirty = !row || JSON.stringify(tp.readPlan(row.Inputs, year)) !== JSON.stringify(plan) || row.Chosen !== chosen;
  const agreed = row?.Status === "agreed" && !dirty;

  if (!c) return <div className="page"><a className="crumb" href="#/taxplan">Tax planning</a><div className="card empty">That company couldn't be found.</div></div>;
  const set = (p: Partial<tp.PlanInput>) => setPlan({ ...plan, ...p });
  const setPerson = (id: string, p: Partial<tp.Person>) => setPlan({ ...plan, people: plan.people.map((x) => (x.id === id ? { ...x, ...p } : x)) });
  const setOther = (id: string, p: Partial<tp.OtherIncome>) => setPlan({ ...plan, people: plan.people.map((x) => (x.id === id ? { ...x, other: { ...x.other, ...p } } : x)) });
  const copySalaries = (o: tp.OptionResult) => { setPlan({ ...plan, people: plan.people.map((x) => ({ ...x, customSalary: o.salaries[x.id] || 0 })) }); setChosen("custom"); };
  const save = async (status: "draft" | "agreed") => {
    if (status === "agreed" && !sales.pcan("send")) { setMsg("Only a manager or partner can agree a plan."); return; }
    setBusy(true); setMsg("");
    const now = new Date().toISOString();
    const fields = { Inputs: JSON.stringify(plan), Chosen: chosen, Status: status, Updated: now, UpdatedBy: user || "", ...(status === "agreed" ? { AgreedBy: user || "", AgreedOn: now.slice(0, 10) } : { AgreedBy: "", AgreedOn: "" }) };
    try {
      if (row) await update("TaxPlans", row as Row, fields as Row);
      else await create("TaxPlans", { Key: newKey("TPL"), PracticeId: sales.ctx().pid, ClientKey: clientKey, TaxYear: year, Notes: "", Created: now, CreatedBy: user || "", ...fields });
      setMsg(status === "agreed" ? "Plan agreed." : "Saved.");
    } catch { setMsg("That didn't save. Try again."); } finally { setBusy(false); }
  };
  const letter = async () => {
    if (!pick || !shown) return;
    setBusy(true); setMsg("");
    try {
      const brand = docs.brand();
      const content = planLetter({ plan, chosen: pick, options, outcome: shown, clientName: String(c.Title), practiceName: displayName(brand), signatory: brand.signatoryName || displayName(brand), date: todayIso() });
      const made = await makePdf({ content, layout: DEFAULT_LAYOUT, branding: brand, title: `Salary and dividend plan ${yearLabel(year)}`, reference: "", docType: "adhoc", client: String(c.Title), date: todayIso() });
      const url = URL.createObjectURL(new Blob([made.bytes as BlobPart], { type: "application/pdf" }));
      const a = document.createElement("a"); a.href = url; a.download = `${todayIso()} ${String(c.Title)} salary and dividend plan ${yearLabel(year)}.pdf`; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 10000);
      setMsg("Client letter made.");
    } catch { setMsg("Couldn't make the letter. Try again."); } finally { setBusy(false); }
  };
  const scheme = data.payrollSchemes.find((r) => r.ClientKey === clientKey && r.Status !== "removed");
  const money = (label: string, v: number, onChange: (n: number) => void, hint?: string) => (
    <label className="field"><span>{label}</span><input className="input" inputMode="decimal" value={v ? String(v) : ""} placeholder="0" onChange={(e) => onChange(Number(e.target.value.replace(/[£,\s]/g, "")) || 0)} />{hint && <small className="muted">{hint}</small>}</label>
  );
  const names = (o: tp.OptionResult) => plan.people.filter((x) => x.salaried).map((x) => `${x.name.split(" ")[0] || "?"} ${gbp(o.salaries[x.id] || 0)}`).join(" · ") || "No one salaried";

  return (
    <div className="page">
      <div className="page-head">
        <div><a className="crumb" href="#/taxplan">Tax planning</a><h1>{c.Title}</h1><p className="muted" style={{ margin: "4px 0 0" }}>Salary and dividends for {yearLabel(year)} (6 April {year - 1} to 5 April {year}). Planning figures for the practice to review, not advice.</p></div>
        <div className="row-wrap" style={{ gap: 8 }}>
          <select className="input" style={{ width: "auto" }} aria-label="Tax year" value={year} onChange={(e) => { window.location.hash = href("taxplan", clientKey, e.target.value); }}>{[...tp.PLAN_YEARS].reverse().map((y) => <option key={y} value={y}>{yearLabel(y)}</option>)}</select>
          {agreed ? <span className="chip green">Agreed by {String(row?.AgreedBy)} on {String(row?.AgreedOn)}</span> : row ? <span className="chip amber">Draft</span> : null}
          {isExample ? <span className="chip">Worked example: nothing is saved</span> : <>
          <button className="btn" type="button" disabled={busy || !dirty} onClick={() => save("draft")}>Save</button>
          <button className="btn primary" type="button" disabled={busy || !!problems.length || agreed} onClick={() => save("agreed")}>Agree this plan</button></>}
          <button className="btn" type="button" disabled={busy || !shown} onClick={letter}>Client letter (PDF)</button>
          {agreed && <a className="btn" href={scheme ? href("payroll", String(scheme.Key), "year") : "#/payroll"}>{scheme ? "Payroll for this plan" : "Set up payroll"}</a>}
          <button className="btn" type="button" onClick={() => window.print()}>Print</button>
          <span role="status" className="muted">{msg}</span>
        </div>
      </div>

      <div className="tp-layout" style={{ display: "grid", gridTemplateColumns: "minmax(280px, 360px) minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
        <div className="stack">
          <section className="card pad stack" aria-label="The company">
            <h2 className="sec-h">The company</h2>
            {money("Profit before directors' pay and corporation tax (£)", plan.profit, (n) => set({ profit: n }), "After all other costs, including other staff.")}
            {money("Profits kept from earlier years (£)", plan.reservesBf, (n) => set({ reservesBf: n }), "From the latest balance sheet. Used to check dividends can be paid.")}
            <label className="field"><span>Associated companies</span><input className="input" type="number" min={0} value={plan.associated} onChange={(e) => set({ associated: Math.max(0, Number(e.target.value) || 0) })} /><small className="muted">Other companies under the same control. They share the £50,000 and £250,000 limits.</small></label>
            <label className="field"><span>Other staff paid over £5,000 this year</span><input className="input" type="number" min={0} value={plan.staffAboveSt} onChange={(e) => set({ staffAboveSt: Math.max(0, Number(e.target.value) || 0) })} /></label>
            {money("Employer NI on other staff (£)", plan.staffErNi, (n) => set({ staffErNi: n }), "Uses up Employment Allowance first.")}
            <label className="row-wrap"><input type="checkbox" checked={plan.connectedClaims} onChange={(e) => set({ connectedClaims: e.target.checked })} /> A connected company claims Employment Allowance</label>
            <label className="field"><span>Aim</span><select className="input" value={plan.aim} onChange={(e) => set({ aim: e.target.value as tp.Aim })}>{tp.AIMS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select><small className="muted">{tp.AIMS.find((a) => a[0] === plan.aim)?.[2]}</small></label>
            {plan.aim === "amount" && money("Total dividends to pay (£)", plan.amount, (n) => set({ amount: n }))}
            <label className="field"><span>Dividends</span><select className="input" value={plan.dividendSplit} onChange={(e) => set({ dividendSplit: e.target.value as tp.PlanInput["dividendSplit"] })}><option value="same">One rate on every share</option><option value="classes">Different classes of share (alphabet shares)</option></select><small className="muted">{plan.dividendSplit === "classes" ? "Each class can be paid a different dividend. The articles must allow it." : "Everyone is paid by their shareholding."}</small></label>
            <label className="field"><span>HMRC official rate of interest (%)</span><input className="input" inputMode="decimal" value={plan.officialRate} onChange={(e) => set({ officialRate: Number(e.target.value) || tp.DEFAULT_OFFICIAL_RATE })} /><small className="muted">Used for a director's loan over £10,000.</small></label>
          </section>

          <section className="card pad stack" aria-label="Directors and shareholders">
            <div className="card-title-row"><h2 className="sec-h">Directors and shareholders</h2><button className="btn small" type="button" onClick={() => set({ people: [...plan.people, tp.newPerson(newKey("TP"))] })}>Add a person</button></div>
            {plan.people.length === 0 && <p className="muted" style={{ margin: 0 }}>No directors or shareholders found in Co Sec. Add them here.</p>}
            {plan.people.map((x) => {
              const removed = ctx.removed.get(x.id) || [];
              const hasReturn = !!x.clientKey && !!savedReturn(x);
              return (
                <fieldset key={x.id} className="stack" style={{ border: "1px solid var(--line, #ddd)", borderRadius: 8, padding: 10, gap: 8 }}>
                  <div className="row-wrap" style={{ gap: 8 }}>
                    <input className="input" aria-label="Name" placeholder="Name" value={x.name} onChange={(e) => setPerson(x.id, { name: e.target.value })} style={{ flex: 1, minWidth: 140 }} />
                    <button className="linkbtn" type="button" onClick={() => set({ people: plan.people.filter((y) => y.id !== x.id) })}>Remove</button>
                  </div>
                  <div className="row-wrap" style={{ gap: 12, fontSize: 13 }}>
                    <label className="row-wrap"><input type="checkbox" checked={x.director} onChange={(e) => setPerson(x.id, { director: e.target.checked, salaried: e.target.checked ? true : x.salaried })} /> Director</label>
                    <label className="row-wrap"><input type="checkbox" checked={x.salaried} onChange={(e) => setPerson(x.id, { salaried: e.target.checked })} /> Paid a salary</label>
                    <label className="row-wrap"><input type="checkbox" checked={x.overSpa} onChange={(e) => setPerson(x.id, { overSpa: e.target.checked })} /> Over State Pension age</label>
                    <label className="row-wrap"><input type="checkbox" checked={x.hasContract} onChange={(e) => setPerson(x.id, { hasContract: e.target.checked })} /> Employment contract</label>
                  </div>
                  <div className="cf-grid">
                    <label className="field"><span>{plan.dividendSplit === "classes" ? "Shares of their class (%)" : "Shares (%)"}</span><input className="input" inputMode="decimal" value={x.sharesPct || ""} placeholder="0" onChange={(e) => setPerson(x.id, { sharesPct: Number(e.target.value) || 0 })} /></label>
                    {plan.dividendSplit === "classes" && <label className="field"><span>Share class</span><input className="input" value={x.shareClass} onChange={(e) => setPerson(x.id, { shareClass: e.target.value })} /></label>}
                    {plan.aim === "target" && money("Take-home wanted (£)", x.targetTakeHome, (n) => setPerson(x.id, { targetTakeHome: n }))}
                    {x.salaried && money("Your salary (£)", x.customSalary, (n) => { setPerson(x.id, { customSalary: n }); setChosen("custom"); })}
                    {money("Employer pension (£)", x.employerPension, (n) => setPerson(x.id, { employerPension: n }))}
                    {x.director && money("Benefits in kind (£)", x.bik, (n) => setPerson(x.id, { bik: n }))}
                    {x.director && <label className="field"><span>Loan account at year end (£)</span><input className="input" inputMode="decimal" value={x.loanBalance ? String(x.loanBalance) : ""} placeholder="0" onChange={(e) => setPerson(x.id, { loanBalance: Number(e.target.value.replace(/[£,\s]/g, "")) || 0 })} /><small className="muted">Owed to them: plus. Overdrawn: minus.</small></label>}
                    <label className="field"><span>Marriage Allowance</span><select className="input" value={x.marriage} onChange={(e) => setPerson(x.id, { marriage: e.target.value as tp.Person["marriage"] })}><option value="none">None</option><option value="transfer">Gives it to their spouse</option><option value="receive">Receives it from their spouse</option></select></label>
                    <label className="field"><span>Lives in</span><select className="input" value={x.region} onChange={(e) => setPerson(x.id, { region: e.target.value as tp.Person["region"] })}><option value="england">England or Northern Ireland</option><option value="wales">Wales</option><option value="scotland">Scotland</option></select></label>
                  </div>
                  <label className="field"><span>Their other income</span>
                    <select className="input" value={x.source} onChange={(e) => setPerson(x.id, { source: e.target.value as tp.Person["source"] })}>
                      <option value="return" disabled={!hasReturn}>From their {yearLabel(year)} tax return{hasReturn ? "" : " (none found)"}</option>
                      <option value="typed">Type it in</option>
                    </select>
                  </label>
                  {x.source === "return" && hasReturn && <p className="muted" style={{ margin: 0, fontSize: 12 }}>Using their return{removed.length ? `, leaving out ${removed.join(", ")} (this company's own figures)` : ""}. <a href={href("tax", x.clientKey, String(year))}>Open the return</a></p>}
                  {(x.source === "typed" || !hasReturn) && (
                    <details><summary style={{ fontSize: 13 }}>Other income: {gbp(x.other.nonSavings + x.other.savings + x.other.dividends)}{x.other.children ? `, Child Benefit for ${x.other.children}` : ""}</summary>
                    <div className="cf-grid" style={{ marginTop: 8 }}>
                      {money("Other earnings, pensions, rents (£)", x.other.nonSavings, (n) => setOther(x.id, { nonSavings: n }))}
                      {money("Savings interest (£)", x.other.savings, (n) => setOther(x.id, { savings: n }))}
                      {money("Dividends from elsewhere (£)", x.other.dividends, (n) => setOther(x.id, { dividends: n }))}
                      {money("Personal pension paid, net (£)", x.other.pensionNet, (n) => setOther(x.id, { pensionNet: n }))}
                      <label className="field"><span>Children claimed for (Child Benefit)</span><input className="input" type="number" min={0} value={x.other.children} onChange={(e) => setOther(x.id, { children: Math.max(0, Number(e.target.value) || 0) })} /></label>
                    </div></details>
                  )}
                </fieldset>
              );
            })}
          </section>
        </div>

        <div className="stack">
          {problems.length > 0 && <section className="card pad">{problems.map((p) => <p key={p} className="warn" style={{ margin: 0 }}>{p}</p>)}</section>}
          {options.length > 0 && (
            <section className="card pad stack" aria-label="Salary options">
              <h2 className="sec-h">Salary options</h2>
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>Take-home is everyone's salary and dividends from this company after their income tax and NI, on whether Employment Allowance can be claimed (at least two people paid over £5,000); the other case is shown underneath. "Kept" is profit left in the company after corporation tax.</p>
              <div className="table-wrap"><table className="grid">
                <thead><tr><th /><th>Option</th><th>Salaries</th><th>Employment Allowance</th><th className="num">Take-home</th><th className="num">Kept in company</th><th className="num">All tax</th></tr></thead>
                <tbody>{options.map((o) => (
                  <tr key={o.key} style={o.key === best?.key ? { background: "var(--tint, #eef7ee)" } : undefined}>
                    <td><input type="radio" name="tp-option" aria-label={`Choose ${o.label}`} checked={pick?.key === o.key} onChange={() => setChosen(o.key)} /></td>
                    <td><strong>{o.label}</strong>{o.key === best?.key && <div><span className="chip green">Best on these figures</span></div>}{o.key !== "custom" && <div><button className="linkbtn" type="button" onClick={() => copySalaries(o)}>Edit these</button></div>}</td>
                    <td style={{ fontSize: 12 }}>{names(o)}</td>
                    <td>{o.eligible ? <span className="chip green">Can claim</span> : <span className="chip">Can't claim</span>}</td>
                    <td className="num"><strong>{gbp(o.likely.takeHome)}</strong><div className="muted" style={{ fontSize: 11, whiteSpace: "nowrap" }}>{o.eligible ? `without it ${gbp(o.withoutEa.takeHome)}` : `if claimed ${gbp(o.withEa.takeHome)}`}</div></td>
                    <td className="num">{gbp(o.likely.company.retained)}</td>
                    <td className="num">{gbp(o.likely.totalTax)}</td>
                  </tr>
                ))}</tbody>
              </table></div>
              {best?.key === "best" && plan.people.filter((x) => x.salaried).length > 1 && <p className="muted" style={{ margin: 0, fontSize: 12 }}>"Best found" leaves the most for everyone together, so it can favour one person. Use "Edit these" to balance it.</p>}
            </section>
          )}

          {pick && shown && (
            <section className="card pad stack" aria-label="The chosen option">
              <div className="card-title-row">
                <h2 className="sec-h">{pick.label}</h2>
                <select className="input" style={{ width: "auto" }} aria-label="Employment Allowance" value={ea} onChange={(e) => setEa(e.target.value as typeof ea)}>
                  <option value="likely">{pick.eligible ? "With Employment Allowance (can claim)" : "Without Employment Allowance (can't claim)"}</option>
                  <option value="with">If Employment Allowance is claimed</option>
                  <option value="without">If it isn't claimed</option>
                </select>
              </div>
              <div className="table-wrap"><table className="grid">
                <thead><tr><th>Person</th><th className="num">Salary</th><th className="num">Dividends</th>{shown.company.loansRepaid > 0 && <th className="num">Loan repaid</th>}<th className="num">Income tax</th><th className="num">Employee NI</th><th className="num">Take-home</th>{plan.aim === "target" && <th className="num">Wanted</th>}{shown.company.pensions > 0 && <th className="num">Pension</th>}<th className="num">Total income</th></tr></thead>
                <tbody>{shown.people.map((x) => (
                  <tr key={x.id}><td>{x.name}{x.warnings.map((w) => <div key={w} className="warn" style={{ fontSize: 12 }}>{w}</div>)}</td><td className="num">{gbp(x.salary)}</td><td className="num">{gbp(x.dividends)}</td>{shown.company.loansRepaid > 0 && <td className="num">{gbp(x.loanCash)}</td>}<td className="num">{gbp(x.incomeTax)}</td><td className="num">{gbp(x.employeeNi)}</td><td className="num"><strong>{gbp(x.takeHome)}</strong></td>{plan.aim === "target" && <td className="num">{gbp(x.target)}</td>}{shown.company.pensions > 0 && <td className="num">{gbp(x.employerPension)}</td>}<td className="num">{gbp(x.totalIncome)}</td></tr>
                ))}
                  <tr><td><strong>Total</strong></td><td className="num">{gbp(shown.company.salaries)}</td><td className="num">{gbp(shown.company.dividends - shown.company.dividendsToOthers)}</td>{shown.company.loansRepaid > 0 && <td className="num">{gbp(shown.company.loansRepaid)}</td>}<td className="num">{gbp(shown.people.reduce((a, x) => a + x.incomeTax, 0))}</td><td className="num">{gbp(shown.people.reduce((a, x) => a + x.employeeNi, 0))}</td><td className="num"><strong>{gbp(shown.takeHome)}</strong></td>{plan.aim === "target" && <td />}{shown.company.pensions > 0 && <td className="num">{gbp(shown.company.pensions)}</td>}<td /></tr>
                </tbody>
              </table></div>
              <table className="grid" style={{ maxWidth: 520 }}><tbody>
                <tr><td>Profit before directors' pay</td><td className="num">{gbp(shown.company.profit)}</td></tr>
                <tr><td>Salaries</td><td className="num">{neg(shown.company.salaries)}</td></tr>
                <tr><td>Employer NI{shown.company.eaUsed ? ` (after £${Math.round(shown.company.eaUsed).toLocaleString("en-GB")} Employment Allowance)` : ""}</td><td className="num">{neg(shown.company.employerNi)}</td></tr>
                {shown.company.pensions > 0 && <tr><td>Employer pension</td><td className="num">{neg(shown.company.pensions)}</td></tr>}
                {shown.company.class1A > 0 && <tr><td>Class 1A NI on benefits</td><td className="num">{neg(shown.company.class1A)}</td></tr>}
                <tr><td>Taxable profit</td><td className="num">{gbp(shown.company.taxable)}</td></tr>
                <tr><td>Corporation tax</td><td className="num">{neg(shown.company.ct)}</td></tr>
                <tr><td>Dividends{shown.company.dividendsToOthers ? ` (${gbp(shown.company.dividendsToOthers)} to others)` : ""}</td><td className="num">{neg(shown.company.dividends)}</td></tr>
                <tr><td><strong>Kept in the company</strong></td><td className="num"><strong>{gbp(shown.company.retained)}</strong></td></tr>
              </tbody></table>
              {shown.warnings.map((w) => <p key={w} className="warn" style={{ margin: 0 }}>{w}</p>)}
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>Assumes a 12-month accounting period in line with the tax year, salary paid in the year, directors' NI on the annual basis and {plan.dividendSplit === "classes" ? "dividends set for each class of share" : "one class of share (dividends shared by shareholding)"}. Rates for {yearLabel(year)}.</p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
