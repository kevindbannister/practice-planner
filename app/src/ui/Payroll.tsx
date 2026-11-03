// Payroll: PAYE schemes run as agent. The list of payrolls; one payroll's year (paydays set in advance, planned pay, every month
// worked out ahead), its people, its pay runs and payslips, and what goes to HMRC. Approving a period queues its FPS to go on payday;
// months with no pay get a nil EPS. The server sends what is due each day (api/rti). See lib/payroll/*.
import { useEffect, useMemo, useRef, useState } from "react";
import { Client, todayIso } from "../lib/domain";
import { newKey } from "../lib/planning";
import { readSetup, setupRow } from "../lib/papers";
import { readReturn } from "../lib/tax";
import { yearEnd, yearLabel } from "../lib/taxRates";
import { chosenSalaries } from "../lib/taxPlanning";
import { FREQ_LABEL, Freq, LETTERS, PAYROLL_YEARS, PERIODS, taxYearOf } from "../lib/payroll/engine";
import * as rec from "../lib/payroll/records";
import { schemeProblems } from "../lib/payroll/rti";
import { FakeRti, HttpRti, RtiClient, RtiError, RtiResult } from "../lib/payroll/rtiClient";
import { getAccessToken } from "../lib/auth";
import { Row } from "../lib/schema";
import { href, useRoute } from "./bits";
import { useData, useIndex } from "./data";
import { useSales } from "./salesKit";
import { TAX_ITEM } from "./TaxPage";

let demo = false;
export const setPayrollDemo = (v: boolean) => { demo = v; };
const gbp = (n: number) => (n < 0 ? "-£" : "£") + Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (d: string) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "");
const s = (v: unknown) => (v === undefined || v === null ? "" : String(v));
const currentYear = () => { const y = taxYearOf(todayIso()); return PAYROLL_YEARS.includes(y) ? y : PAYROLL_YEARS[PAYROLL_YEARS.length - 1]; };
const STATUS_CHIP: Record<string, string> = { queued: "amber", sending: "amber", pending: "amber", accepted: "green", rejected: "red", failed: "red", cancelled: "" };
const STATUS_WORD: Record<string, string> = { queued: "Queued", sending: "Sending", pending: "Waiting for HMRC", accepted: "Accepted", rejected: "Rejected", failed: "Failed", cancelled: "Cancelled" };

function usePayroll() {
  const d = useData();
  const sales = useSales();
  const client = useRef<RtiClient>();
  if (!client.current) client.current = demo ? new FakeRti() : new HttpRti(getAccessToken);
  const ctx = (): rec.Ctx => ({ actor: d.user || "", now: new Date().toISOString(), pid: sales.ctx().pid, newKey });
  return { ...d, can: sales.pcan("send"), ctx, rti: client.current };
}

export function PayrollPage() {
  const { parts } = useRoute();
  return parts[1] ? <SchemePage schemeKey={parts[1]} tab={parts[2] || "year"} /> : <PayrollList />;
}

// ------------------------------------------------------------------ the list

function PayrollList() {
  const { data, create, can, ctx, rti } = usePayroll();
  const year = currentYear();
  const [info, setInfo] = useState<{ configured: boolean; live: boolean; missing: string[] } | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { rti.info().then(setInfo).catch((e) => setErr(e instanceof RtiError ? e.message : "Couldn't check HMRC filing.")); }, [rti]);
  const schemes = data.payrollSchemes.map(rec.readScheme).filter((x) => x.status !== "removed");
  const companies = (data.clients as Client[]).filter((c) => (c.Kind === "Ltd" || c.Kind === "LLP" || c.CompanyNumber) && String(c.Status) !== "Archived").sort((a, b) => String(a.Title).localeCompare(String(b.Title)));
  const [f, setF] = useState({ clientKey: "", paye: "", ao: "", utr: "", freq: "M1" as Freq, ea: false });
  const [msg, setMsg] = useState("");
  const add = async () => {
    const m = f.paye.trim().toUpperCase().match(/^(\d{3})\s*\/\s*([A-Z0-9]{1,10})$/);
    const c = companies.find((x) => x.Key === f.clientKey);
    if (!c) { setMsg("Choose the client."); return; }
    if (!m) { setMsg("Enter the PAYE reference as 123/AB45678."); return; }
    const sc = { officeNo: m[1], payeRef: m[2], aoRef: f.ao.trim().toUpperCase().replace(/\s/g, ""), cotaxRef: f.utr.trim(), name: String(c.Title) };
    const p = schemeProblems(sc); if (p.length) { setMsg(p.join(" ")); return; }
    const o = ctx();
    const key = o.newKey("PS");
    await create("PayrollSchemes", { Key: key, PracticeId: o.pid, ClientKey: c.Key, Name: c.Title, OfficeNo: sc.officeNo, PayeRef: sc.payeRef, AORef: sc.aoRef, COTAXRef: sc.cotaxRef, Freq: f.freq, ClaimEA: f.ea ? "yes" : "no", SmallEmployer: "yes", Status: "active", Created: o.now, CreatedBy: o.actor, Updated: o.now });
    window.location.hash = href("payroll", key, "people");
  };
  return (
    <div className="page">
      <div className="page-head"><div><h1>Payroll</h1><p className="muted" style={{ margin: "4px 0 0" }}>PAYE schemes the practice runs as agent. Each FPS goes to HMRC on payday; months with no pay get a nil EPS. The client pays HMRC.</p></div></div>
      <section className="card pad" aria-label="HMRC filing">
        {err ? <p className="warn" style={{ margin: 0 }}>{err}</p> : !info ? <p className="muted" style={{ margin: 0 }}>Checking HMRC filing…</p>
          : info.configured ? <p style={{ margin: 0 }}><span className={`chip ${info.live ? "green" : "amber"}`}>{info.live ? "Live" : "HMRC test service"}</span> Filing as agent is set up{info.live ? "" : ": submissions go to HMRC's test service until RTI_LIVE is switched on"}.</p>
          : <p className="warn" style={{ margin: 0 }}>Filing to HMRC isn't set up on the server yet ({info.missing.join(", ")}). Runs can be prepared and queued; nothing is sent until it is.</p>}
      </section>
      <div className="card table-wrap"><table className="grid">
        <thead><tr><th>Client</th><th>PAYE reference</th><th>Pay</th><th>Next payday</th><th>Waiting to go</th><th>Problems</th></tr></thead>
        <tbody>
          {schemes.length === 0 && <tr><td colSpan={6} className="muted">No payrolls yet.</td></tr>}
          {schemes.map((x) => {
            const y = rec.readYear(data.payYears.find((r) => r.SchemeKey === x.key && Number(r.TaxYear) === year), x.key, year, x.freq);
            const next = y.paydays.filter((d) => d && d >= todayIso()).sort()[0];
            const waiting = data.rtiSubmissions.filter((r) => r.SchemeKey === x.key && ["queued", "pending", "sending"].includes(s(r.Status))).length;
            const bad = data.rtiSubmissions.filter((r) => r.SchemeKey === x.key && ["rejected", "failed"].includes(s(r.Status))).length;
            return (
              <tr key={x.key}><td><a href={href("payroll", x.key)}>{x.name}</a></td><td className="mono">{x.officeNo}/{x.payeRef}</td><td>{FREQ_LABEL[x.freq]}</td><td>{next ? fmt(next) : <span className="muted">Set paydays</span>}</td><td>{waiting || ""}</td><td>{bad ? <span className="chip red">{bad} to fix</span> : ""}</td></tr>
            );
          })}
        </tbody>
      </table></div>
      {can && (
        <section className="card pad stack" aria-label="Set up a payroll">
          <h2 style={{ margin: 0, fontSize: 16 }}>Set up a payroll</h2>
          <div className="cf-grid">
            <label className="field"><span>Client</span><select className="input" value={f.clientKey} onChange={(e) => setF({ ...f, clientKey: e.target.value })}><option value="">Choose</option>{companies.map((c) => <option key={c.Key} value={c.Key}>{c.Title}</option>)}</select></label>
            <label className="field"><span>PAYE reference</span><input className="input" placeholder="123/AB45678" value={f.paye} onChange={(e) => setF({ ...f, paye: e.target.value })} /></label>
            <label className="field"><span>Accounts Office reference</span><input className="input" placeholder="123PA00045678" value={f.ao} onChange={(e) => setF({ ...f, ao: e.target.value })} /></label>
            <label className="field"><span>Company UTR (optional)</span><input className="input" value={f.utr} onChange={(e) => setF({ ...f, utr: e.target.value })} /></label>
            <label className="field"><span>Paid</span><select className="input" value={f.freq} onChange={(e) => setF({ ...f, freq: e.target.value as Freq })}>{(Object.keys(FREQ_LABEL) as Freq[]).map((k) => <option key={k} value={k}>{FREQ_LABEL[k]}</option>)}</select></label>
          </div>
          <label className="row-wrap"><input type="checkbox" checked={f.ea} onChange={(e) => setF({ ...f, ea: e.target.checked })} /> Claim Employment Allowance (sent on an EPS with the first payment of the year)</label>
          <div className="row-wrap" style={{ gap: 8 }}><button className="btn primary" type="button" onClick={add}>Set up payroll</button><span role="status" className="warn">{msg}</span></div>
        </section>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ one payroll

const TABS: [string, string][] = [["year", "The year"], ["runs", "Pay runs"], ["people", "People"], ["hmrc", "HMRC"], ["settings", "Settings"]];

function SchemePage({ schemeKey, tab }: { schemeKey: string; tab: string }) {
  const P = usePayroll();
  const { data } = P;
  const row = data.payrollSchemes.find((r) => r.Key === schemeKey);
  const [year, setYear] = useState(currentYear());
  if (!row) return <div className="page"><a className="crumb" href="#/payroll">Payroll</a><div className="card empty">That payroll couldn't be found.</div></div>;
  const scheme = rec.readScheme(row);
  const people = data.payrollPeople.filter((r) => r.SchemeKey === schemeKey && s(r.Status) !== "removed").map(rec.readPerson);
  const yearRow = data.payYears.find((r) => r.SchemeKey === schemeKey && Number(r.TaxYear) === year);
  const y = rec.readYear(yearRow, schemeKey, year, scheme.freq);
  const runs = data.payRuns.filter((r) => r.SchemeKey === schemeKey).map(rec.readRun).filter((r) => r.year === year);
  const subs = data.rtiSubmissions.filter((r) => r.SchemeKey === schemeKey);
  const view = rec.yearView(scheme, people, y, runs);
  const t = TABS.find(([k]) => k === tab)?.[0] || "year";
  return (
    <div className="page">
      <div className="page-head">
        <div><a className="crumb" href="#/payroll">Payroll</a><h1>{scheme.name}</h1><p className="muted mono" style={{ margin: "4px 0 0" }}>{scheme.officeNo}/{scheme.payeRef} · {scheme.aoRef} · {FREQ_LABEL[scheme.freq]}</p></div>
        <select className="input" style={{ width: "auto" }} aria-label="Tax year" value={year} onChange={(e) => setYear(Number(e.target.value))}>{[...PAYROLL_YEARS].reverse().map((v) => <option key={v} value={v}>{yearLabel(v)}</option>)}</select>
      </div>
      <div className="row-wrap" role="tablist" aria-label="Payroll" style={{ gap: 8 }}>{TABS.map(([k, l]) => <a key={k} role="tab" aria-selected={t === k} className={`btn small${t === k ? " primary" : ""}`} href={href("payroll", schemeKey, k)}>{l}</a>)}</div>
      {view.errors.length > 0 && <section className="card pad">{view.errors.map((e) => <p key={e} className="warn" style={{ margin: 0 }}>{e}</p>)}</section>}
      {t === "year" && <YearTab P={P} scheme={scheme} people={people} y={y} yearRow={yearRow} view={view} />}
      {t === "runs" && <RunsTab P={P} scheme={scheme} people={people} y={y} runs={runs} subs={subs} view={view} />}
      {t === "people" && <PeopleTab P={P} scheme={scheme} people={people} year={year} />}
      {t === "hmrc" && <HmrcTab P={P} scheme={scheme} people={people} y={y} runs={runs} subs={subs} />}
      {t === "settings" && <SettingsTab P={P} row={row} scheme={scheme} />}
    </div>
  );
}
type PP = ReturnType<typeof usePayroll>;

// ------------------------------------------------------------------ the year: paydays, planned pay, every month ahead

function YearTab({ P, scheme, people, y, yearRow, view }: { P: PP; scheme: rec.SchemeRec; people: rec.PersonRec[]; y: rec.PayYear; yearRow?: Row; view: ReturnType<typeof rec.yearView> }) {
  const { data, create, update, can, ctx } = P;
  const [paydays, setPaydays] = useState<string[]>(y.paydays);
  const [amounts, setAmounts] = useState<Record<string, (number | null)[]>>(y.amounts);
  const [day, setDay] = useState(28);
  const [msg, setMsg] = useState("");
  const [pattern, setPattern] = useState<"spread" | "yearEnd">("spread");
  useEffect(() => { setPaydays(y.paydays); setAmounts(y.amounts); /* eslint-disable-next-line */ }, [yearRow?.Key, yearRow?.Updated, y.year]);
  const n = PERIODS[scheme.freq];
  const locked = new Set(view.periods.filter((p) => p.run).map((p) => p.period));
  const dirty = JSON.stringify(paydays) !== JSON.stringify(y.paydays) || JSON.stringify(amounts) !== JSON.stringify(y.amounts);
  const problems = rec.paydayProblems(y.year, scheme.freq, paydays);
  const draft = { ...y, paydays, amounts };
  const preview = rec.yearView(scheme, people, draft, data.payRuns.filter((r) => r.SchemeKey === scheme.key).map(rec.readRun).filter((r) => r.year === y.year));
  const save = async (extra: Row = {}) => {
    if (problems.length) { setMsg(problems[0]); return; }
    const o = ctx();
    const fields = { Paydays: JSON.stringify(paydays), Amounts: JSON.stringify(amounts), Updated: o.now, UpdatedBy: o.actor, ...extra };
    try {
      if (yearRow) await update("PayYears", yearRow, fields);
      else await create("PayYears", { Key: o.newKey("PY"), PracticeId: o.pid, SchemeKey: scheme.key, TaxYear: y.year, Source: "", Pattern: "", Status: "", ...fields });
      setMsg("Saved.");
    } catch { setMsg("That didn't save. Try again."); }
  };
  const fromPlan = () => {
    const plan = data.taxPlans.find((r) => r.ClientKey === scheme.clientKey && Number(r.TaxYear) === y.year && r.Status === "agreed");
    if (!plan) { setMsg(`There's no agreed tax plan for ${yearLabel(y.year)}. Agree one under Tax planning first.`); return; }
    const saved = (p: { clientKey: string }) => { if (!p.clientKey) return undefined; const r = setupRow(data.papers, p.clientKey, yearEnd(y.year), TAX_ITEM); return r ? readReturn(readSetup(r).r) : undefined; };
    const chosen = chosenSalaries(plan.Inputs, s(plan.Chosen), y.year, saved);
    const norm = (x: string) => x.trim().toLowerCase().replace(/\s+/g, " ");
    const matched: { personKey: string; annual: number }[] = [], missing: string[] = [];
    for (const c of chosen) {
      const p = people.find((x) => (c.person.clientKey && x.personClientKey === c.person.clientKey) || norm(rec.fullName(x)) === norm(c.person.name) || norm(`${x.first} ${x.last}`) === norm(c.person.name));
      if (p) matched.push({ personKey: p.key, annual: c.salary }); else missing.push(c.person.name);
    }
    if (!matched.length) { setMsg(`None of the plan's directors are on this payroll yet${missing.length ? ` (${missing.join(", ")})` : ""}. Add them under People.`); return; }
    const filled = rec.planAmounts(matched, { ...y, paydays }, pattern);
    setAmounts({ ...amounts, ...filled });
    setMsg(`Filled from the agreed plan${missing.length ? `; not on the payroll: ${missing.join(", ")}` : ""}. Check, then save.`);
  };
  const setCell = (pk: string, i: number, v: string) => {
    const base = amounts[pk] ? [...amounts[pk]] : Array.from({ length: n }, () => null as number | null);
    base[i] = v === "" ? null : Number(v.replace(/[£,\s]/g, "")) || 0;
    setAmounts({ ...amounts, [pk]: base });
  };
  const spreadRest = (pk: string, annual: number) => {
    const arr = amounts[pk] ? [...amounts[pk]] : Array.from({ length: n }, () => null as number | null);
    const fixedTotal = arr.reduce<number>((a, v, i) => a + (locked.has(i + 1) ? Number(v || 0) : 0), 0);
    const open = paydays.map((d, i) => (d && !locked.has(i + 1) ? i : -1)).filter((i) => i >= 0);
    const each = open.length ? Math.floor((annual - fixedTotal) / open.length * 100) / 100 : 0;
    open.forEach((i, k) => { arr[i] = k === open.length - 1 ? Math.round((annual - fixedTotal - each * (open.length - 1)) * 100) / 100 : each; });
    setAmounts({ ...amounts, [pk]: arr });
  };
  const planned = people.filter((p) => p.basis === "plan" || amounts[p.key]);
  return (
    <div className="stack">
      <section className="card pad stack" aria-label="Paydays">
        <div className="card-title-row"><h2 style={{ margin: 0, fontSize: 16 }}>Paydays for {yearLabel(y.year)}</h2>
          {can && <div className="row-wrap" style={{ gap: 6 }}>
            {scheme.freq === "M1" && <><label className="row-wrap" style={{ gap: 4, fontSize: 13 }}>Usual day <input className="input" type="number" min={6} max={31} value={day} onChange={(e) => setDay(Number(e.target.value) || 28)} style={{ width: 70 }} /></label>
              <button className="btn small" type="button" onClick={() => setPaydays(paydays.map((d, i) => (locked.has(i + 1) ? d : rec.defaultPaydays(y.year, scheme.freq, { kind: "day", day })[i])))}>Fill usual paydays</button>
              <button className="btn small" type="button" onClick={() => setPaydays(paydays.map((d, i) => (locked.has(i + 1) ? d : rec.defaultPaydays(y.year, scheme.freq, { kind: "last-working" })[i])))}>Last working day</button></>}
            {scheme.freq !== "M1" && <button className="btn small" type="button" onClick={() => setPaydays(rec.defaultPaydays(y.year, scheme.freq, { kind: "day", weekday: 5 }))}>Every Friday</button>}
          </div>}
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>Set every payday for the year in advance. Each FPS is sent to HMRC on its payday. Clear a date for a month with no pay: that month gets a nil EPS instead.</p>
        <div className="row-wrap" style={{ gap: 8 }}>
          {paydays.map((d, i) => (
            <label key={i} className="field" style={{ width: 150 }}><span>{scheme.freq === "M1" ? `Month ${i + 1}` : `Week ${i + 1}`}{locked.has(i + 1) ? " (approved)" : ""}</span>
              <input className="input" type="date" disabled={!can || locked.has(i + 1)} value={d} onChange={(e) => setPaydays(paydays.map((x, j) => (j === i ? e.target.value : x)))} /></label>
          ))}
        </div>
        {problems.map((p) => <p key={p} className="warn" style={{ margin: 0 }}>{p}</p>)}
      </section>

      <section className="card pad stack" aria-label="Planned pay">
        <div className="card-title-row"><h2 style={{ margin: 0, fontSize: 16 }}>Planned pay</h2>
          {can && <div className="row-wrap" style={{ gap: 6 }}>
            <select className="input" style={{ width: "auto" }} aria-label="How the salary is paid" value={pattern} onChange={(e) => setPattern(e.target.value as typeof pattern)}><option value="spread">Spread across the paydays</option><option value="yearEnd">All in the last month</option></select>
            <button className="btn small" type="button" onClick={fromPlan}>Fill from agreed tax plan</button>
          </div>}
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>Directors paid from a plan are set here. Type over any month to change it; people on a salary or hours are paid their usual amount unless you type one in.</p>
        {planned.length === 0 ? <p className="muted" style={{ margin: 0 }}>No one is paid from a plan. Set a person's pay to "Planned amounts" under People, or fill from the agreed tax plan.</p> : (
          <div className="table-wrap"><table className="grid">
            <thead><tr><th>Person</th>{paydays.map((d, i) => <th key={i} className="num" style={{ minWidth: 92 }}>{scheme.freq === "M1" ? `M${i + 1}` : `W${i + 1}`}</th>)}<th className="num">Year</th><th /></tr></thead>
            <tbody>{planned.map((p) => {
              const arr = amounts[p.key] || [];
              const total = arr.reduce<number>((a, v, i) => a + (paydays[i] ? Number(v || 0) : 0), 0);
              return (
                <tr key={p.key}><td>{rec.fullName(p)}</td>
                  {paydays.map((d, i) => <td key={i}><input className="input num" aria-label={`${rec.fullName(p)} period ${i + 1}`} style={{ width: 88 }} disabled={!can || !d || locked.has(i + 1)} value={arr[i] === null || arr[i] === undefined ? "" : String(arr[i])} placeholder={d ? "0" : "-"} onChange={(e) => setCell(p.key, i, e.target.value)} /></td>)}
                  <td className="num"><strong>{gbp(total)}</strong></td>
                  <td>{can && <button className="linkbtn" type="button" onClick={() => { const v = prompt("Annual salary to spread over the months not yet approved", String(Math.round(total))); if (v) spreadRest(p.key, Number(v.replace(/[£,\s]/g, "")) || 0); }}>Re-spread</button>}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
        {can && <div className="row-wrap" style={{ gap: 8 }}><button className="btn primary" type="button" disabled={!dirty} onClick={() => save()}>Save the year</button><span role="status" className="muted">{msg}</span></div>}
      </section>

      <section className="card pad stack" aria-label="The year ahead">
        <h2 style={{ margin: 0, fontSize: 16 }}>The year ahead</h2>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>Every period worked out now from the paydays and pay above, carrying the year to date from one to the next. Approved periods show what was approved.</p>
        <div className="table-wrap"><table className="grid">
          <thead><tr><th>Period</th><th>Payday</th><th className="num">Gross</th><th className="num">Tax</th><th className="num">Employee NI</th><th className="num">Employer NI</th><th className="num">Loans</th><th className="num">Net pay</th><th className="num">Due to HMRC</th><th>State</th></tr></thead>
          <tbody>{preview.periods.map((p) => (
            <tr key={p.period}><td>{p.period}</td><td>{p.payday ? fmt(p.payday) : <span className="muted">No pay</span>}</td>
              {p.nil ? <td colSpan={7} className="muted">{p.payday ? "Nobody paid: nil EPS" : "Nil EPS"}</td> : <>
                <td className="num">{gbp(p.totals.gross)}</td><td className="num">{gbp(p.totals.tax)}</td><td className="num">{gbp(p.totals.ee)}</td><td className="num">{gbp(p.totals.er)}</td><td className="num">{gbp(p.totals.sl)}</td><td className="num">{gbp(p.totals.net)}</td><td className="num">{gbp(p.totals.due)}</td></>}
              <td>{p.run ? <span className="chip green">Approved</span> : ""}</td></tr>
          ))}
            <tr><td colSpan={2}><strong>Year</strong></td>{(["gross", "tax", "ee", "er", "sl", "net", "due"] as const).map((k) => <td key={k} className="num"><strong>{gbp(preview.periods.reduce((a, p) => a + p.totals[k], 0))}</strong></td>)}<td /></tr>
          </tbody>
        </table></div>
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>The client pays HMRC by the 22nd after each tax month (the 19th by post). Employer NI shown before any Employment Allowance.</p>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ pay runs and payslips

function RunsTab({ P, scheme, people, y, runs, subs, view }: { P: PP; scheme: rec.SchemeRec; people: rec.PersonRec[]; y: rec.PayYear; runs: rec.RunRec[]; subs: Row[]; view: ReturnType<typeof rec.yearView> }) {
  const { create, updateMany, data, can, ctx } = P;
  const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  const [slip, setSlip] = useState<{ period: rec.PeriodView; personKey: string } | null>(null);
  const next = view.periods.find((p) => !p.nil && !p.run);
  const approve = async (period: number) => {
    setBusy(true); setMsg("");
    const r = rec.approveRun(scheme, people, y, runs, subs, period, can, ctx());
    if ("error" in r) { setMsg(r.error); setBusy(false); return; }
    try { if (r.runRow) await create("PayRuns", r.runRow); for (const x of r.submissions) await create("RtiSubmissions", x); setMsg(`Approved. The FPS is queued to go to HMRC on ${fmt(String(r.submissions[0].SendOn))}.`); }
    catch { setMsg("That didn't save. Try again."); } finally { setBusy(false); }
  };
  const cancel = async (run: rec.RunRec) => {
    const runRow = data.payRuns.find((x) => x.Key === run.key)!;
    const sub = data.rtiSubmissions.find((x) => x.Key === run.submissionKey);
    const r = rec.cancelRun(run, sub, can);
    if ("error" in r) { setMsg(r.error); return; }
    if (sub) await updateMany("RtiSubmissions", [{ row: sub, patch: { Status: "cancelled" } }]);
    await updateMany("PayRuns", [{ row: runRow, patch: { Status: "cancelled", Updated: new Date().toISOString() } }]);
    setMsg("Approval undone. Nothing was sent to HMRC.");
  };
  const subOf = (run?: rec.RunRec) => (run ? data.rtiSubmissions.find((x) => x.Key === run.submissionKey) : undefined);
  return (
    <div className="stack">
      <section className="card pad stack" aria-label="Pay runs">
        <div className="card-title-row"><h2 style={{ margin: 0, fontSize: 16 }}>Pay runs for {yearLabel(y.year)}</h2>
          {can && next && <button className="btn primary" type="button" disabled={busy} onClick={() => approve(next.period)}>Approve period {next.period} (paid {fmt(next.payday)})</button>}
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>Approving a period fixes its figures and queues its FPS to be sent on payday. Until it is sent, the approval can be undone.</p>
        <span role="status" className={/didn't|first|Only|Set|Nobody|add|choose|doesn't|isn't|look/i.test(msg) ? "warn" : "muted"}>{msg}</span>
        <div className="table-wrap"><table className="grid">
          <thead><tr><th>Period</th><th>Payday</th><th>People</th><th className="num">Gross</th><th className="num">Net</th><th className="num">Due to HMRC</th><th>FPS</th><th /></tr></thead>
          <tbody>{view.periods.filter((p) => !p.nil || p.payday).map((p) => {
            const sub = subOf(p.run);
            return (
              <tr key={p.period}><td>{p.period}</td><td>{p.payday ? fmt(p.payday) : ""}</td>
                <td>{p.nil ? <span className="muted">Nobody paid</span> : p.lines.map((l) => <button key={l.personKey} className="linkbtn" type="button" onClick={() => setSlip({ period: p, personKey: l.personKey })}>{l.name}</button>).reduce((a: JSX.Element[], b, i) => (i ? [...a, <span key={`s${i}`}>, </span>, b] : [b]), [])}</td>
                <td className="num">{p.nil ? "" : gbp(p.totals.gross)}</td><td className="num">{p.nil ? "" : gbp(p.totals.net)}</td><td className="num">{p.nil ? "" : gbp(p.totals.due)}</td>
                <td>{sub ? <span className={`chip ${STATUS_CHIP[s(sub.Status)] || ""}`}>{STATUS_WORD[s(sub.Status)] || s(sub.Status)}</span> : p.run ? "" : p.nil ? "" : <span className="muted">Not approved</span>}</td>
                <td>{p.run && can && (!sub || ["queued", "failed", "rejected"].includes(s(sub.Status))) && <button className="linkbtn" type="button" onClick={() => cancel(p.run!)}>Undo approval</button>}</td></tr>
            );
          })}</tbody>
        </table></div>
      </section>
      {slip && <Payslip scheme={scheme} period={slip.period} line={slip.period.lines.find((l) => l.personKey === slip.personKey)!} person={people.find((x) => x.key === slip.personKey)} year={y.year} onClose={() => setSlip(null)} />}
    </div>
  );
}

function Payslip({ scheme, period, line, person, year, onClose }: { scheme: rec.SchemeRec; period: rec.PeriodView; line: rec.RunLine; person?: rec.PersonRec; year: number; onClose: () => void }) {
  const l = line.line;
  const rows: [string, number][] = [["Pay", l.gross - l.statutory], ...(l.statutory ? [["Statutory pay", l.statutory] as [string, number]] : []), ["Income tax", -l.tax], ["National Insurance", -l.ee], ...(l.sl ? [["Student loan", -l.sl] as [string, number]] : []), ...(l.pgl ? [["Postgraduate loan", -l.pgl] as [string, number]] : []), ...(l.eePension ? [["Pension (net pay)", -l.eePension] as [string, number]] : []), ...(l.eePensionRas ? [["Pension", -l.eePensionRas] as [string, number]] : []), ...(l.deductions ? [["Other deductions", -l.deductions] as [string, number]] : []), ...(l.nonTaxable ? [["Expenses and other", l.nonTaxable] as [string, number]] : [])];
  return (
    <section className="card pad stack payslip" aria-label="Payslip" style={{ maxWidth: 620 }}>
      <div className="card-title-row"><h2 style={{ margin: 0, fontSize: 16 }}>Payslip</h2><div className="row-wrap" style={{ gap: 6 }}><button className="btn small" type="button" onClick={() => window.print()}>Print</button><button className="btn small" type="button" onClick={onClose}>Close</button></div></div>
      <div className="row-wrap" style={{ justifyContent: "space-between" }}><div><strong>{scheme.name}</strong><div className="muted" style={{ fontSize: 12 }}>PAYE {scheme.officeNo}/{scheme.payeRef}</div></div><div style={{ textAlign: "right" }}><strong>{line.name}</strong><div className="muted" style={{ fontSize: 12 }}>{person?.nino || ""} · Tax code {l.code.regime}{l.code.fps}{l.code.nonCum ? " M1" : ""} · NI {person?.niLetter || "A"}</div></div></div>
      <div className="muted" style={{ fontSize: 13 }}>Paid {fmt(period.payday)} · {yearLabel(year)} period {period.period}</div>
      <table className="grid"><tbody>{rows.map(([k, v]) => <tr key={k}><td>{k}</td><td className="num">{gbp(v)}</td></tr>)}<tr><td><strong>Net pay</strong></td><td className="num"><strong>{gbp(l.net)}</strong></td></tr></tbody></table>
      <table className="grid"><thead><tr><th>Year to date</th><th className="num" /></tr></thead><tbody>
        <tr><td>Taxable pay</td><td className="num">{gbp(l.ytd.taxablePay)}</td></tr><tr><td>Tax</td><td className="num">{gbp(l.ytd.tax)}</td></tr><tr><td>Employee NI</td><td className="num">{gbp(l.ytd.ee)}</td></tr>
        {l.ytd.sl ? <tr><td>Student loan</td><td className="num">{gbp(l.ytd.sl)}</td></tr> : null}<tr><td>Employer NI</td><td className="num">{gbp(l.ytd.er)}</td></tr>
      </tbody></table>
      {l.warnings.map((w) => <p key={w} className="warn" style={{ margin: 0 }}>{w}</p>)}
    </section>
  );
}

// ------------------------------------------------------------------ people

const blankPerson = { Title: "", First: "", Middle: "", Last: "", NINO: "", DOB: "", Gender: "", Address: "", Postcode: "", PayId: "", StartDate: "", StartDec: "", LeavingDate: "", Director: "no", NicMethod: "AN", AppointedOn: "", TaxCode: "1257L", NiLetter: "A", StudentPlan: "", Postgrad: "no", Pension: JSON.stringify({ kind: "none", eePct: 5, erPct: 3, basis: "qualifying" }), Hours: "D", PayBasis: "salary", AnnualSalary: 0, HourlyRate: 0, UsualHours: 0, PersonClientKey: "" };
function PeopleTab({ P, scheme, people, year }: { P: PP; scheme: rec.SchemeRec; people: rec.PersonRec[]; year: number }) {
  const { data, create, update, can, ctx } = P;
  const idx = useIndex();
  const [edit, setEdit] = useState<Row | null>(null);
  const [msg, setMsg] = useState("");
  const officers = data.cosecOfficers.filter((o) => o.ClientKey === scheme.clientKey && String(o.Role) === "director" && String(o.Status) !== "resigned" && !o.ResignedOn);
  const startEdit = (r?: Row) => setEdit(r ? { ...r } : { ...blankPerson, PayId: String(people.length + 1).padStart(3, "0") });
  const fromOfficer = (o: Row) => {
    const person = o.PersonClientKey ? idx.clientByKey.get(String(o.PersonClientKey)) : undefined;
    setEdit({ ...blankPerson, PayId: String(people.length + 1).padStart(3, "0"), Title: s(o.Title), First: s(o.First), Last: s(o.Last), DOB: s(o.DOB).length === 10 ? s(o.DOB) : "", Director: "yes", NicMethod: "AN", AppointedOn: s(o.AppointedOn), Hours: "E", PayBasis: "plan", PersonClientKey: s(o.PersonClientKey), NINO: s(person?.NINO || person?.NiNumber || ""), Address: s(o.ResidentialAddress || "").split(/,\s*/).slice(0, 4).join("\n") });
  };
  const save = async () => {
    if (!edit) return;
    const p = rec.readPerson({ ...edit, SchemeKey: scheme.key });
    const probs = rec.personMissing(p, year);
    const o = ctx();
    try {
      if (edit.Key) await update("PayrollPeople", data.payrollPeople.find((x) => x.Key === edit.Key)!, { ...edit, Updated: o.now });
      else await create("PayrollPeople", { ...edit, Key: o.newKey("PP"), PracticeId: o.pid, SchemeKey: scheme.key, Status: "active", Created: o.now, Updated: o.now });
      setEdit(null); setMsg(probs.length ? `Saved. Still needed before paying: ${probs.join(" ")}` : "Saved.");
    } catch { setMsg("That didn't save. Try again."); }
  };
  const field = (k: string, label: string, type = "text", extra: Partial<React.InputHTMLAttributes<HTMLInputElement>> = {}) => <label className="field"><span>{label}</span><input className="input" type={type} value={s(edit?.[k])} onChange={(e) => setEdit({ ...edit!, [k]: type === "number" ? Number(e.target.value) || 0 : e.target.value })} {...extra} /></label>;
  const pension = edit ? JSON.parse(s(edit.Pension) || "{}") : {};
  return (
    <div className="stack">
      <section className="card pad stack" aria-label="People">
        <div className="card-title-row"><h2 style={{ margin: 0, fontSize: 16 }}>People on this payroll</h2>{can && <button className="btn small" type="button" onClick={() => startEdit()}>Add a person</button>}</div>
        {can && officers.filter((o) => !people.some((p) => (o.PersonClientKey && p.personClientKey === o.PersonClientKey) || `${p.first} ${p.last}`.toLowerCase() === `${s(o.First)} ${s(o.Last)}`.toLowerCase())).map((o) => (
          <div key={s(o.Key)} className="row-wrap" style={{ gap: 8 }}><span className="muted">Director in Co Sec, not on the payroll:</span> {s(o.First)} {s(o.Last)} <button className="linkbtn" type="button" onClick={() => fromOfficer(o)}>Add</button></div>
        ))}
        <div className="table-wrap"><table className="grid">
          <thead><tr><th>Name</th><th>Pay ID</th><th>NI number</th><th>Tax code</th><th>NI</th><th>Pay</th><th>Ready</th><th /></tr></thead>
          <tbody>{people.length === 0 && <tr><td colSpan={8} className="muted">No one yet.</td></tr>}
            {people.map((p) => { const m = rec.personMissing(p, year); return (
              <tr key={p.key}><td>{rec.fullName(p)}{p.director && <span className="chip" style={{ marginLeft: 6 }}>Director ({p.nicMethod})</span>}{p.leavingDate && <span className="chip" style={{ marginLeft: 6 }}>Left {fmt(p.leavingDate)}</span>}</td><td>{p.payId}</td><td className="mono">{p.nino}</td><td>{p.taxCode}</td><td>{p.niLetter}</td>
                <td>{p.basis === "plan" ? "Planned amounts" : p.basis === "hourly" ? `£${p.hourlyRate}/hr × ${p.usualHours}` : `${gbp(p.annualSalary)} a year`}</td>
                <td>{m.length ? <span className="chip red" title={m.join(" ")}>Details missing</span> : <span className="chip green">Ready</span>}</td>
                <td>{can && <button className="linkbtn" type="button" onClick={() => startEdit(data.payrollPeople.find((x) => x.Key === p.key))}>Edit</button>}</td></tr>); })}
          </tbody>
        </table></div>
        <span role="status" className="muted">{msg}</span>
      </section>
      {edit && (
        <section className="card pad stack" aria-label="Person">
          <h2 style={{ margin: 0, fontSize: 16 }}>{edit.Key ? "Edit" : "Add"} a person</h2>
          <div className="cf-grid">
            {field("Title", "Title")}{field("First", "First name")}{field("Middle", "Middle name")}{field("Last", "Surname")}
            {field("NINO", "NI number")}{field("DOB", "Date of birth", "date")}
            <label className="field"><span>Gender (as on their NI record)</span><select className="input" value={s(edit.Gender)} onChange={(e) => setEdit({ ...edit, Gender: e.target.value })}><option value="">Choose</option><option value="F">F</option><option value="M">M</option></select></label>
            {field("PayId", "Payroll ID")}
          </div>
          <label className="field"><span>Address (one line each)</span><textarea className="input" rows={3} value={s(edit.Address)} onChange={(e) => setEdit({ ...edit, Address: e.target.value })} /></label>
          <div className="cf-grid">{field("Postcode", "Postcode")}{field("StartDate", "Start date", "date")}
            <label className="field"><span>Starter declaration</span><select className="input" value={s(edit.StartDec)} onChange={(e) => setEdit({ ...edit, StartDec: e.target.value })}><option value="">Not needed / P45</option><option value="A">A: first job since 6 April</option><option value="B">B: only job now</option><option value="C">C: another job or pension</option></select></label>
            {field("LeavingDate", "Leaving date", "date")}</div>
          <div className="cf-grid">
            {field("TaxCode", "Tax code")}
            <label className="field"><span>NI category</span><select className="input" value={s(edit.NiLetter)} onChange={(e) => setEdit({ ...edit, NiLetter: e.target.value })}>{Object.entries(LETTERS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
            <label className="field"><span>Student loan</span><select className="input" value={s(edit.StudentPlan)} onChange={(e) => setEdit({ ...edit, StudentPlan: e.target.value })}><option value="">None</option><option value="plan1">Plan 1</option><option value="plan2">Plan 2</option><option value="plan4">Plan 4</option><option value="plan5">Plan 5</option></select></label>
            <label className="field"><span>Postgraduate loan</span><select className="input" value={s(edit.Postgrad)} onChange={(e) => setEdit({ ...edit, Postgrad: e.target.value })}><option value="no">No</option><option value="yes">Yes</option></select></label>
          </div>
          <div className="cf-grid">
            <label className="field"><span>Director</span><select className="input" value={s(edit.Director)} onChange={(e) => setEdit({ ...edit, Director: e.target.value, Hours: e.target.value === "yes" ? "E" : s(edit.Hours) })}><option value="no">No</option><option value="yes">Yes</option></select></label>
            {edit.Director === "yes" && <label className="field"><span>Director's NI</span><select className="input" value={s(edit.NicMethod)} onChange={(e) => setEdit({ ...edit, NicMethod: e.target.value })}><option value="AN">Annual (AN)</option><option value="AL">Alternative (AL)</option></select></label>}
            {edit.Director === "yes" && field("AppointedOn", "Appointed director on", "date")}
            <label className="field"><span>Hours worked a week</span><select className="input" value={s(edit.Hours)} onChange={(e) => setEdit({ ...edit, Hours: e.target.value })}><option value="A">Under 16</option><option value="B">16 to 23.99</option><option value="C">24 to 29.99</option><option value="D">30 or more</option><option value="E">Other (directors, irregular)</option></select></label>
          </div>
          <div className="cf-grid">
            <label className="field"><span>Pay</span><select className="input" value={s(edit.PayBasis)} onChange={(e) => setEdit({ ...edit, PayBasis: e.target.value })}><option value="salary">Annual salary</option><option value="hourly">Hourly</option><option value="plan">Planned amounts (set on The year)</option></select></label>
            {edit.PayBasis === "salary" && field("AnnualSalary", "Annual salary (£)", "number")}
            {edit.PayBasis === "hourly" && field("HourlyRate", "Hourly rate (£)", "number")}
            {edit.PayBasis === "hourly" && field("UsualHours", `Hours each ${scheme.freq === "M1" ? "month" : "pay period"}`, "number")}
          </div>
          <div className="cf-grid">
            <label className="field"><span>Workplace pension</span><select className="input" value={pension.kind || "none"} onChange={(e) => setEdit({ ...edit, Pension: JSON.stringify({ ...pension, kind: e.target.value }) })}><option value="none">None</option><option value="netpay">Net pay arrangement</option><option value="ras">Relief at source</option></select></label>
            {pension.kind && pension.kind !== "none" && <>
              <label className="field"><span>Employee %</span><input className="input" type="number" value={pension.eePct ?? 5} onChange={(e) => setEdit({ ...edit, Pension: JSON.stringify({ ...pension, eePct: Number(e.target.value) || 0 }) })} /></label>
              <label className="field"><span>Employer %</span><input className="input" type="number" value={pension.erPct ?? 3} onChange={(e) => setEdit({ ...edit, Pension: JSON.stringify({ ...pension, erPct: Number(e.target.value) || 0 }) })} /></label>
              <label className="field"><span>On</span><select className="input" value={pension.basis || "qualifying"} onChange={(e) => setEdit({ ...edit, Pension: JSON.stringify({ ...pension, basis: e.target.value }) })}><option value="qualifying">Qualifying earnings</option><option value="total">All pay</option></select></label></>}
          </div>
          <div className="row-wrap" style={{ gap: 8 }}><button className="btn primary" type="button" onClick={save}>Save</button><button className="linkbtn" type="button" onClick={() => setEdit(null)}>Cancel</button>
            {edit.Key && <button className="linkbtn" type="button" onClick={async () => { await update("PayrollPeople", data.payrollPeople.find((x) => x.Key === edit.Key)!, { Status: "removed" }); setEdit(null); }}>Remove from payroll</button>}</div>
        </section>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ what goes to HMRC

function HmrcTab({ P, scheme, people, y, runs, subs }: { P: PP; scheme: rec.SchemeRec; people: rec.PersonRec[]; y: rec.PayYear; runs: rec.RunRec[]; subs: Row[] }) {
  const { create, updateMany, can, ctx, rti } = P;
  const [msg, setMsg] = useState(""); const [busy, setBusy] = useState("");
  const [open, setOpen] = useState("");
  const list = [...subs].filter((r) => Number(r.TaxYear) === y.year).sort((a, b) => s(a.SendOn).localeCompare(s(b.SendOn)) || Number(a.Period) - Number(b.Period));
  const queueNil = async () => {
    const r = rec.queueNilEps(scheme, people, y, runs, subs, can, ctx());
    if ("error" in r) { setMsg(r.error); return; }
    for (const x of r.submissions) await create("RtiSubmissions", x);
    setMsg(`${r.submissions.length} nil EPS queued, each to go the day after its tax month ends.`);
  };
  const record = async (row: Row, r: RtiResult) => {
    await updateMany("RtiSubmissions", [{ row, patch: { Status: r.state, CorrelationID: r.correlationId || s(row.CorrelationID), PollUrl: r.pollUrl || s(row.PollUrl), IRmark: r.irmark || s(row.IRmark), Response: s(r.receipt || r.response).slice(0, 60000), Errors: r.errors?.length ? JSON.stringify(r.errors) : "", SubmittedAt: s(row.SubmittedAt) || new Date().toISOString(), Live: r.live ? "yes" : "no", ...(r.state === "pending" ? {} : { AnsweredAt: new Date().toISOString() }) } }]);
  };
  const sendNow = async (row: Row) => {
    if (!can) return;
    setBusy(s(row.Key)); setMsg("");
    try { await record(row, await rti.send(s(row.Kind) as "FPS", s(row.OfficeNo), s(row.PayeRef), s(row.Body))); }
    catch (e) { setMsg(e instanceof RtiError ? e.message : "Sending failed."); } finally { setBusy(""); }
  };
  const check = async (row: Row) => {
    setBusy(s(row.Key));
    try { await record(row, await rti.poll(s(row.Kind) as "FPS", s(row.CorrelationID), s(row.PollUrl))); }
    catch (e) { setMsg(e instanceof RtiError ? e.message : "Checking failed."); } finally { setBusy(""); }
  };
  const cancel = async (row: Row) => { await updateMany("RtiSubmissions", [{ row, patch: { Status: "cancelled" } }]); };
  const requeue = async (row: Row) => { await updateMany("RtiSubmissions", [{ row, patch: { Status: "queued", Errors: "", Attempts: 0 } }]); };
  return (
    <div className="stack">
      <section className="card pad stack" aria-label="Submissions">
        <div className="card-title-row"><h2 style={{ margin: 0, fontSize: 16 }}>Submissions for {yearLabel(y.year)}</h2>{can && scheme.freq === "M1" && <button className="btn small" type="button" onClick={queueNil}>Queue nil EPS for months with no pay</button>}</div>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>Queued submissions go automatically on their date (checked every half hour from early morning). "Send now" sends straight away. Every submission is sent as agent.</p>
        <span role="status" className="warn">{msg}</span>
        <div className="table-wrap"><table className="grid">
          <thead><tr><th>Goes on</th><th>What</th><th>State</th><th>HMRC</th><th /></tr></thead>
          <tbody>{list.length === 0 && <tr><td colSpan={5} className="muted">Nothing queued. Approve a pay run, or queue the nil EPS.</td></tr>}
            {list.map((r) => {
              const errs: { number: string; text: string }[] = (() => { try { return JSON.parse(s(r.Errors) || "[]"); } catch { return []; } })();
              const st = s(r.Status);
              return (
                <tr key={s(r.Key)}>
                  <td>{fmt(s(r.SendOn))}</td>
                  <td><strong>{s(r.Kind)}</strong> {s(r.Summary)}{open === s(r.Key) && <pre style={{ whiteSpace: "pre-wrap", fontSize: 11, maxHeight: 240, overflow: "auto" }}>{s(r.Body).replace(/></g, ">\n<")}</pre>}</td>
                  <td><span className={`chip ${STATUS_CHIP[st] || ""}`}>{STATUS_WORD[st] || st}</span>{r.Live === "no" && st === "accepted" ? <div className="muted" style={{ fontSize: 11 }}>test service</div> : null}</td>
                  <td style={{ fontSize: 12 }}>{s(r.CorrelationID) && <div className="mono">{s(r.CorrelationID)}</div>}{errs.map((e, i) => <div key={i} className="warn">{e.number ? `${e.number}: ` : ""}{e.text}</div>)}{st === "accepted" && s(r.Response) ? <div className="muted">{s(r.Response).slice(0, 200)}</div> : null}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="linkbtn" type="button" onClick={() => setOpen(open === s(r.Key) ? "" : s(r.Key))}>{open === s(r.Key) ? "Hide" : "View"}</button>
                    {can && st === "queued" && <> <button className="linkbtn" type="button" disabled={!!busy} onClick={() => sendNow(r)}>{busy === s(r.Key) ? "Sending…" : "Send now"}</button> <button className="linkbtn" type="button" onClick={() => cancel(r)}>Cancel</button></>}
                    {st === "pending" && <> <button className="linkbtn" type="button" disabled={!!busy} onClick={() => check(r)}>Check</button></>}
                    {can && (st === "failed" || st === "rejected") && <> <button className="linkbtn" type="button" onClick={() => requeue(r)}>Try again</button></>}
                  </td>
                </tr>
              );
            })}</tbody>
        </table></div>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ settings

function SettingsTab({ P, row, scheme }: { P: PP; row: Row; scheme: rec.SchemeRec }) {
  const { update, can } = P;
  const [f, setF] = useState({ paye: `${scheme.officeNo}/${scheme.payeRef}`, ao: scheme.aoRef, utr: scheme.cotaxRef || "", ea: scheme.claimEA, small: scheme.smallEmployer, freq: scheme.freq });
  const [msg, setMsg] = useState("");
  const save = async () => {
    const m = f.paye.trim().toUpperCase().match(/^(\d{3})\s*\/\s*([A-Z0-9]{1,10})$/);
    if (!m) { setMsg("Enter the PAYE reference as 123/AB45678."); return; }
    const p = schemeProblems({ officeNo: m[1], payeRef: m[2], aoRef: f.ao.toUpperCase().replace(/\s/g, ""), cotaxRef: f.utr, name: scheme.name });
    if (p.length) { setMsg(p.join(" ")); return; }
    await update("PayrollSchemes", row, { OfficeNo: m[1], PayeRef: m[2], AORef: f.ao.toUpperCase().replace(/\s/g, ""), COTAXRef: f.utr.trim(), ClaimEA: f.ea ? "yes" : "no", SmallEmployer: f.small ? "yes" : "no", Freq: f.freq, Updated: new Date().toISOString() });
    setMsg("Saved. Submissions already queued keep the references they were built with.");
  };
  return (
    <section className="card pad stack" aria-label="Settings" style={{ maxWidth: 720 }}>
      <div className="cf-grid">
        <label className="field"><span>PAYE reference</span><input className="input" disabled={!can} value={f.paye} onChange={(e) => setF({ ...f, paye: e.target.value })} /></label>
        <label className="field"><span>Accounts Office reference</span><input className="input" disabled={!can} value={f.ao} onChange={(e) => setF({ ...f, ao: e.target.value })} /></label>
        <label className="field"><span>Company UTR</span><input className="input" disabled={!can} value={f.utr} onChange={(e) => setF({ ...f, utr: e.target.value })} /></label>
        <label className="field"><span>Paid</span><select className="input" disabled={!can} value={f.freq} onChange={(e) => setF({ ...f, freq: e.target.value as Freq })}>{(Object.keys(FREQ_LABEL) as Freq[]).map((k) => <option key={k} value={k}>{FREQ_LABEL[k]}</option>)}</select></label>
      </div>
      <label className="row-wrap"><input type="checkbox" disabled={!can} checked={f.ea} onChange={(e) => setF({ ...f, ea: e.target.checked })} /> Claim Employment Allowance</label>
      <label className="row-wrap"><input type="checkbox" disabled={!can} checked={f.small} onChange={(e) => setF({ ...f, small: e.target.checked })} /> Small employer for statutory pay recovery (Class 1 NI of £45,000 or less last year)</label>
      {can && <div className="row-wrap" style={{ gap: 8 }}><button className="btn primary" type="button" onClick={save}>Save</button><span role="status" className="muted">{msg}</span></div>}
    </section>
  );
}
