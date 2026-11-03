// Personal tax. The list is the clients with a Self Assessment return; open one and its return for a tax year is laid out like
// the working papers: the sections down the side (added from the same groups as IRIS Elements: UK income, foreign income,
// allowances, reliefs, miscellaneous), the section being entered in the middle, and the tax computation on the right, worked
// out again as each figure is typed. The return is kept with the client and year (WorkingPapers, period 5 April).
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Client, fmtDate, todayIso } from "../lib/domain";
import { PaperStatus, STATUS_LABEL, readSetup, setupRow, stateOf } from "../lib/papers";
import {
  Computation, Dividend, Employment, EXPENSE_BOXES, ExpenseBox, ExpenseLine, expenseBoxOf, Gain, Interest, NOT_YET, OtherPension, Partnership, ReturnState, SECTIONS, STATE_LABEL, SectionDef, SectionKey, SelfEmployment, TaxReturn,
  bringForward, compute, defaultPaymentLines, emptyReturn, hasSection, newId, outstandingPayments, paymentLines, PaymentLine, propertyProfit, readReturn, rollForward, tradeProfit, employmentIncome,
} from "../lib/tax";
import { ImportResult } from "../lib/taxImport";
import { brandOf, readBranding, displayName } from "../lib/docBranding";
import { Ask, ConfirmBox, ImportDialog, NewReturnDialog, ReturnViewer, Start, sendImport, takeImport } from "./TaxReturnView";
import { BulkImportDialog } from "./TaxBulkImport";
import { HmrcAccountDialog } from "./HmrcAccountImport";
import { YEARS, ratesFor, yearEnd, yearLabel, yearOf } from "../lib/taxRates";
import { Icon, href, useRoute } from "./bits";
import { TaxPlanView, TaxPlanningList } from "./TaxPlanning";
import { BannerMenu } from "./BannerMenu";
import { useEditor } from "./Editors";
import { useData, useIndex } from "./data";
import type { Row } from "../lib/schema";
import { PaperWriter, useWriterState } from "./PaperSchedules";

export const TAX_ITEM = "_tax";
const TABS = ["UK income", "Foreign income", "Allowances", "Reliefs", "Miscellaneous"] as const;
const isCompany = (c: Client) => c.Kind === "Ltd" || c.Kind === "LLP" || !!c.CompanyNumber;
const gbp = (v: number | undefined, dp = 2) => (v === undefined ? "" : `${v < 0 ? "-" : ""}£${Math.abs(v).toLocaleString("en-GB", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`);
const latestYear = (today: string) => { const y = yearOf(today); return Math.max(...YEARS.map((r) => r.year).filter((r) => r < y), YEARS[0].year); };

export function TaxPage() {
  const { parts } = useRoute();
  if (parts[1] === "planning") return parts[2] ? <TaxPlanView clientKey={parts[2]} year={Number(parts[3]) || undefined} /> : <TaxPlanningList />;
  return parts[1] ? <TaxView clientKey={parts[1]} year={Number(parts[2]) || undefined} start={parts[3] as Start | undefined} /> : <TaxList />;
}

// ------------------------------------------------------------------ the list

function TaxList() {
  const { data } = useData();
  const idx = useIndex();
  const today = todayIso();
  const [year, setYear] = useState(latestYear(today));
  const [q, setQ] = useState("");
  const [starting, setStarting] = useState(false);
  const [bulk, setBulk] = useState(false);
  const rows = useMemo(() => {
    const out: { c: Client; job?: { Title: string; Deadline?: string; Status?: string }; comp?: Computation; state?: ReturnState; imported?: boolean; owed?: number; late?: boolean }[] = [];
    for (const c of data.clients as Client[]) {
      if (isCompany(c)) continue;
      const jobs = (idx.jobsByClient.get(c.Key) || []).filter((j) => j.ServiceKey === "SA100");
      const saved = setupRow(data.papers, c.Key, yearEnd(year), TAX_ITEM);
      if (!jobs.length && !saved) continue;
      const job = jobs.find((j) => j.PeriodEnd === yearEnd(year)) || undefined;
      const sr = saved ? readReturn(readSetup(saved).r) : undefined;
      const comp = sr ? compute(sr, year) : undefined;
      const due = sr ? outstandingPayments(sr, year) : undefined;
      out.push({ c, job: job as never, comp, state: sr ? sr.status?.state || "draft" : undefined, imported: !!sr?.imported, owed: due?.lines.length ? due.total : undefined, late: due?.lines.some((l) => l.overdue) });
    }
    return out.filter((x) => !q || String(x.c.Title).toLowerCase().includes(q.toLowerCase())).sort((a, b) => String(a.c.Title).localeCompare(String(b.c.Title)));
  }, [data.clients, data.papers, idx, year, q]);
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Personal tax</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>Self Assessment returns and tax computations for each client and tax year.</p>
        </div>
        <a className="btn" href="#/tax/planning">Tax planning</a>
        <button type="button" className="btn" title="Bring in a client's past returns from IRIS Elements, one PDF for each year" onClick={() => setBulk(true)}><Icon name="download" size={15} /> Import past returns</button>
        <button type="button" className="btn primary" onClick={() => setStarting(true)}><Icon name="plus" size={15} /> New tax return</button>
        <label className="row-wrap" style={{ gap: 6, fontSize: 13 }}>Tax year
          <select className="input" value={year} style={{ width: "auto" }} onChange={(e) => setYear(Number(e.target.value))}>{[...YEARS].reverse().map((y) => <option key={y.year} value={y.year}>{y.label}</option>)}</select>
        </label>
      </div>
      <div className="row-wrap" style={{ gap: 8 }}><input className="input" style={{ maxWidth: 360 }} placeholder="Find a client" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a client" /><span className="muted" style={{ marginLeft: "auto" }}>{rows.length} client{rows.length === 1 ? "" : "s"}</span></div>
      <div className="card table-wrap">
        <table className="grid">
          <thead><tr><th>Client</th><th>Return</th><th className="num">Total tax</th><th className="num">To pay / repay</th><th className="num">Payments on account</th><th className="num">Still to pay</th><th>Filing deadline</th></tr></thead>
          <tbody>
            {rows.map(({ c, job, comp, state, imported, owed, late }) => (
              <tr key={c.Key} className="clickable" onClick={() => (window.location.hash = href("tax", String(c.Key), String(year)))}>
                <td><a href={href("tax", String(c.Key), String(year))} onClick={(e) => e.stopPropagation()}>{c.Title}</a>{c.UTR ? <div className="muted mono" style={{ fontSize: 12 }}>{String(c.UTR)}</div> : null}</td>
                <td>{state ? <span className={`chip${state === "submitted" ? " green" : state === "final" ? " blue" : ""}`}>{STATE_LABEL[state]}</span> : <span className="muted">Not started</span>}{imported && <span className="muted" style={{ fontSize: 12, marginLeft: 6 }}>from IRIS</span>}</td>
                <td className="num mono">{comp ? gbp(comp.totalLiability) : "-"}</td>
                <td className="num mono">{comp ? (comp.balancing >= 0 ? gbp(comp.balancing) : `${gbp(-comp.balancing)} back`) : "-"}</td>
                <td className="num mono">{comp?.poaNext ? `2 × ${gbp(comp.poaNext)}` : "-"}</td>
                <td className={`num mono${late ? " red-ink" : ""}`}>{owed ? gbp(owed) : state ? "Nothing" : "-"}{late ? <div style={{ fontSize: 12 }}>overdue</div> : null}</td>
                <td>{job?.Deadline ? fmtDate(job.Deadline) : fmtDate(`${year + 1}-01-31`)}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={7} className="muted" style={{ textAlign: "center", padding: 24 }}>No clients with a Self Assessment return{q ? " match" : ""}.</td></tr>}
          </tbody>
        </table>
      </div>
      {bulk && <BulkImportDialog clients={(data.clients as Client[]).filter((c) => !isCompany(c)).sort((a, b) => String(a.Title).localeCompare(String(b.Title)))} onClose={() => setBulk(false)} />}
      {starting && <NewReturnDialog clients={(data.clients as Client[]).filter((c) => !isCompany(c)).sort((a, b) => String(a.Title).localeCompare(String(b.Title)))} year={year}
        has={(ck, y) => !!setupRow(data.papers, ck, yearEnd(y), TAX_ITEM)} onClose={() => setStarting(false)}
        onGo={(ck, y, start) => { setStarting(false); window.location.hash = href("tax", ck, String(y), start); }} />}
    </div>
  );
}

// ------------------------------------------------------------------ one client and year

type View = "inputs" | "return" | "summary";
const readView = (): View => { try { const v = localStorage.getItem("pp.tax.view"); return v === "return" || v === "summary" ? v : "inputs"; } catch { return "inputs"; } };

/** The client's name, which opens a list of the other clients to jump to their return for the same year. */
function ClientSwitcher({ current, year }: { current: Client; year: number }) {
  const { data } = useData();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const list = useMemo(() => (data.clients as Client[])
    .filter((c) => !isCompany(c) && c.Key !== current.Key && (!q || String(c.Title).toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => String(a.Title).localeCompare(String(b.Title)))
    .slice(0, 200), [data.clients, current.Key, q]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [open]);
  return (
    <div className="tax-switcher">
      <button type="button" className="tax-switcher-name" aria-haspopup="listbox" aria-expanded={open} title="Switch to another client" onClick={() => setOpen((o) => !o)}>
        <span className="tax-switcher-title">{current.Title}</span><span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="tax-switcher-panel" role="presentation" onClick={() => setOpen(false)}>
          <div className="tax-switcher-card" role="listbox" aria-label="Switch client" onClick={(e) => e.stopPropagation()}>
            <input className="input" autoFocus placeholder="Find a client" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a client" />
            <ul>
              {list.map((c) => (
                <li key={c.Key}>
                  <button type="button" role="option" aria-selected={false} onClick={() => { setOpen(false); window.location.hash = href("tax", String(c.Key), String(year)); }}>
                    {c.Title}{c.UTR ? <span className="muted mono"> · {String(c.UTR)}</span> : null}
                  </button>
                </li>
              ))}
              {!list.length && <li className="muted" style={{ padding: 8 }}>No client matches.</li>}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function TaxView({ clientKey, year: yearParam, start }: { clientKey: string; year?: number; start?: Start }) {
  const idx = useIndex();
  const { data } = useData();
  const [view, setView0] = useState<View>(readView);
  const setView = (v: View) => { setView0(v); try { localStorage.setItem("pp.tax.view", v); } catch { /* this visit only */ } };
  const [starting, setStarting] = useState(false);
  const [bulk, setBulk] = useState(false);
  const [account, setAccount] = useState(false);
  const [rev, setRev] = useState(0); // bumped after an import so the page reloads what was saved
  const editor = useEditor();
  const c = idx.clientByKey.get(clientKey) as Client | undefined;
  const today = todayIso();
  const year = yearParam || latestYear(today);
  if (!c) return <div className="page"><a className="crumb" href="#/tax">Personal tax</a><div className="card empty">That client couldn't be found.</div></div>;
  const jobs = (idx.jobsByClient.get(c.Key) || []).filter((j) => j.ServiceKey === "SA100" && j.PeriodEnd === yearEnd(year));
  const savedRow = setupRow(data.papers, c.Key, yearEnd(year), TAX_ITEM);
  const state = savedRow ? readReturn(readSetup(savedRow).r).status?.state || "draft" : undefined;
  return (
    <div className="page paper-page tax-page">
      <header className="paper-top">
        <a className="paper-top-icon" href="#/tax" title="Back to all tax returns" aria-label="Back to all tax returns"><Icon name="book" size={20} /></a>
        <ClientSwitcher current={c} year={year} />
        <span className="chip">SA100 {yearLabel(year)}</span>
        {state && <span className={`chip${state === "submitted" ? " green" : state === "final" ? " blue" : ""}`}>{STATE_LABEL[state]}</span>}
        {c.UTR && <span className="chip mono" title="Self Assessment UTR">{String(c.UTR)}</span>}
        <a className="chip blue chip-fixed" href={href("clients", c.Key)}>Client page</a>
        {jobs.map((j) => <button key={j.Key} type="button" className="chip blue" style={{ cursor: "pointer" }} onClick={() => editor.open({ kind: "job", key: j.Key as string })}>{j.Title}{j.Deadline ? ` · due ${fmtDate(j.Deadline as string, { year: false })}` : ""}</button>)}
        <div className="paper-tools">
          <div className="seg tax-views" role="group" aria-label="What to show">
            <button type="button" aria-pressed={view === "inputs"} title="Enter the figures, with the computation" onClick={() => setView("inputs")}><Icon name="edit" size={15} /> Inputs</button>
            <button type="button" aria-pressed={view === "return"} title="The computation beside the SA100 return" onClick={() => setView("return")}><Icon name="form" size={15} /> Return</button>
            <button type="button" aria-pressed={view === "summary"} title="The tax due for this year beside every year's position" onClick={() => setView("summary")}><Icon name="book" size={15} /> Summary</button>
          </div>
          <button type="button" className="btn small" title="Start a return for another tax year, or bring in a past one" onClick={() => setStarting(true)}><Icon name="plus" size={14} /> New return</button>
          <button type="button" className="btn small" title="Bring in this client's past returns from IRIS Elements, one PDF for each year" onClick={() => setBulk(true)}><Icon name="download" size={14} /> Import past returns</button>
          <button type="button" className="btn small" title="Paste the payments, interest and penalties from this client's HMRC account" onClick={() => setAccount(true)}><Icon name="download" size={14} /> HMRC account</button>
          <label className="row-wrap paper-year" style={{ gap: 6, fontSize: 13 }}>
            <span>Tax year</span>
            <select className="input" value={year} style={{ width: "auto", minHeight: 32, padding: "2px 8px" }} onChange={(e) => (window.location.hash = href("tax", c.Key, e.target.value))}>
              {[...YEARS].reverse().map((y) => <option key={y.year} value={y.year}>{y.label}</option>)}
            </select>
          </label>
          <BannerMenu />
        </div>
      </header>
      <PaperWriter key={year} client={c} period={yearEnd(year)}>
        <TaxScreen key={`${year}-${start || ""}-${rev}`} client={c} year={year} view={view} setView={setView} start={start} frozen={bulk || account} />
      </PaperWriter>
      {bulk && <BulkImportDialog clients={[c]} clientKey={c.Key} onClose={() => { setBulk(false); setRev((n) => n + 1); }} />}
      {account && <HmrcAccountDialog client={c} onClose={() => { setAccount(false); setRev((n) => n + 1); }} />}
      {starting && <NewReturnDialog clientKey={c.Key} year={year} has={(ck, y) => !!setupRow(data.papers, ck, yearEnd(y), TAX_ITEM)} onClose={() => setStarting(false)}
        onGo={(ck, y, s) => { setStarting(false); window.location.hash = href("tax", ck, String(y), s); }} />}
    </div>
  );
}

type NavItem = { key: string; section: SectionDef; title: string; id?: string };

function navItems(r: TaxReturn): NavItem[] {
  const out: NavItem[] = [];
  for (const s of SECTIONS) {
    if (!hasSection(r, s.key) && !s.always) continue;
    const many = (list: { id: string }[], name: (x: never) => string) => list.forEach((x) => out.push({ key: `${s.key}:${x.id}`, section: s, title: `${s.title}: ${name(x as never) || "unnamed"}`, id: x.id }));
    if (s.key === "employment") many(r.employments, (x: Employment) => x.name);
    else if (s.key === "selfEmployment") many(r.selfEmployments, (x: SelfEmployment) => x.name);
    else if (s.key === "partnership") many(r.partnerships, (x: Partnership) => x.name);
    else out.push({ key: s.key, section: s, title: s.key === "interest" || s.key === "dividends" ? s.title : s.title });
  }
  return out;
}

function TaxScreen({ client: c, year, view, setView, start, frozen }: { client: Client; year: number; view: View; setView: (v: View) => void; start?: Start; frozen?: boolean }) {
  const { data, updateMany } = useData();
  const [ask, setAsk] = useState<Ask | null>(null);
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState<{ section: SectionKey; title: string } | null>(null);
  const w = useWriterState();
  const saved = w.setup(TAX_ITEM) as { r?: unknown };
  const [ret, setRet] = useState<TaxReturn>(() => readReturn(saved.r));
  const [savedAt, setSavedAt] = useState("");
  const timer = useRef<number>();
  const pending = useRef<TaxReturn | null>(null);
  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    const r = pending.current;
    pending.current = null;
    if (r) void w.writeSetup(TAX_ITEM, { r }).then(() => setSavedAt(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })));
  }, [w]);
  // while returns are being imported behind this page it must not save its own copy over them (it is shown again afterwards)
  const frozenNow = useRef(false);
  frozenNow.current = !!frozen;
  const update = useCallback((f: (r: TaxReturn) => TaxReturn) => {
    if (frozenNow.current) return;
    setRet((prev) => {
      const next = f(prev);
      pending.current = next;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, 900);
      return next;
    });
  }, [flush]);
  useEffect(() => () => flush(), [flush]);
  const fromClient = useCallback((r: TaxReturn): TaxReturn => ({ ...r, front: { ...r.front, utr: r.front.utr || String(c.UTR || ""), nino: r.front.nino || String(c.NINumber || ""), dob: r.front.dob || String(c.DateOfBirth || "") || undefined } }), [c]);
  // first open: front page from the client record
  useEffect(() => {
    if (saved.r) return;
    update((r) => ({ ...fromClient(r), status: r.status || { state: "draft" } }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // payments on account expected for this year: rolled forward from last year's return, kept in step if last year changes
  const prevRow = setupRow(data.papers, c.Key, yearEnd(year - 1), TAX_ITEM);
  const rolled = useMemo(() => (prevRow ? rollForward(readReturn(readSetup(prevRow).r), year - 1) : null), [prevRow, year]);
  useEffect(() => {
    if (!rolled) return;
    const p = ret.payments;
    if (p.expectedPoa1 === rolled.expectedPoa1 && p.expectedPoa2 === rolled.expectedPoa2 && p.expectedFrom === `the ${yearLabel(year - 1)} return`) return;
    // the payments still to pay follow the new amounts; a payment already ticked as paid keeps what was paid
    update((r) => ({ ...r, payments: { ...r.payments, expectedPoa1: rolled.expectedPoa1, expectedPoa2: rolled.expectedPoa2, expectedFrom: `the ${yearLabel(year - 1)} return`, priorLiability: r.payments.priorLiability ?? rolled.liability,
      ...(r.payments.lines ? { lines: r.payments.lines.map((l) => (l.paid || l.kind === "other" ? l : { ...l, amount: l.kind === "poa1" ? rolled.expectedPoa1 : rolled.expectedPoa2 })) } : {}) } }));
  }, [rolled?.expectedPoa1, rolled?.expectedPoa2]); // eslint-disable-line react-hooks/exhaustive-deps

  const comp = useMemo(() => compute(ret, year), [ret, year]);
  const prevRet = useMemo(() => (prevRow ? readReturn(readSetup(prevRow).r) : null), [prevRow]);
  // figures typed in (the payments on account rolled forward from last year don't count)
  const hasContent = (r: TaxReturn) => SECTIONS.some((s) => s.key !== "front" && s.key !== "payments" && hasSection(r, s.key)) || !!(r.payments.poa1 || r.payments.poa2 || r.payments.earlierYearInCode || r.payments.nextYearInCode || r.payments.propertyReturnTax)
    || (r.payments.lines || []).some((l) => l.paid || l.kind === "other" || !!l.late);
  const keepRolled = (r: TaxReturn): TaxReturn => (rolled ? { ...r, payments: { ...r.payments, expectedPoa1: rolled.expectedPoa1, expectedPoa2: rolled.expectedPoa2, expectedFrom: `the ${yearLabel(year - 1)} return`, priorLiability: r.payments.priorLiability ?? rolled.liability } } : r);
  const sectionRows = () => (data.papers as Row[]).filter((r) => r.ClientKey === c.Key && r.PeriodEnd === yearEnd(year) && String(r.ItemKey || "").startsWith("tax/"));
  const clearSections = () => { const rows = sectionRows(); return rows.length ? updateMany("WorkingPapers", rows.map((row) => ({ row, patch: { Status: "todo", Note: "", Setup: "{}" } }))) : Promise.resolve(); };

  /** Start again: everything on this year's return cleared, with the client's details and the payments on account rolled forward. */
  const resetAll = () => setAsk({
    title: `Reset the ${yearLabel(year)} return?`, danger: true, yes: "Reset everything",
    body: ["Every section and figure on this return is cleared, with the section statuses and notes. The front page is filled again from the client record.", "This can't be undone."],
    onYes: () => { update(() => keepRolled(fromClient({ ...emptyReturn(), status: { state: "draft" } }))); void clearSections(); setPick("front"); },
  });
  /** Start from last year's return. Warn when last year isn't marked as submitted, and when this year already has figures. */
  const broughtForward = () => {
    if (!prevRet) return;
    const st = prevRet.status?.state || "draft";
    const body: string[] = [`The people, employers, businesses, payers and claims on the ${yearLabel(year - 1)} return come across with their figures cleared. Losses, unused finance costs and capital losses carry forward, and the payments on account roll forward.`];
    if (st !== "submitted") body.unshift(`The ${yearLabel(year - 1)} return isn't marked as submitted (it's ${STATE_LABEL[st].toLowerCase()}). Anything carried forward from it may still change.`);
    if (hasContent(ret)) body.push(`Everything already on the ${yearLabel(year)} return is replaced.`);
    setAsk({
      title: st !== "submitted" ? `${yearLabel(year - 1)} isn't submitted yet` : `Bring forward from ${yearLabel(year - 1)}?`, danger: st !== "submitted" || hasContent(ret), yes: st !== "submitted" ? "Bring forward anyway" : "Bring forward",
      body, onYes: () => { update(() => keepRolled(fromClient(bringForward(prevRet, year - 1, todayIso())))); void clearSections(); setPick("front"); },
    });
  };
  /** A past return read from IRIS's PDFs. */
  const applyImport = (res: ImportResult, submitted: boolean) => {
    const apply = () => {
      update(() => {
        const r = fromClient({ ...res.ret, front: { ...res.ret.front, region: res.regionFound ? res.ret.front.region : ret.front.region, overSpa: ret.front.overSpa } });
        return { ...(r.payments.paidDifferent ? r : keepRolled(r)), status: submitted ? { state: "submitted", irmark: res.irmark } : { state: "draft" }, imported: { from: "IRIS Elements", on: todayIso(), files: [] } };
      });
      void clearSections();
      setPick("front");
    };
    if (hasContent(ret)) setAsk({ title: `Replace the ${yearLabel(year)} return?`, danger: true, yes: "Replace it", body: [`There are already figures on the ${yearLabel(year)} return. Bringing in the IRIS return replaces all of them.`], onYes: apply });
    else apply();
  };
  // arriving from "New tax return" or an import for this year
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const handed = takeImport(c.Key, year);
    if (handed) applyImport(handed.res, handed.submitted);
    else if (start === "bf") { if (prevRet) broughtForward(); }
    else if (start === "import") setImporting(true);
    if (start) window.history.replaceState(null, "", href("tax", c.Key, String(year)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const branding = useMemo(() => brandOf(readBranding(data.settings)), [data.settings]);
  const ctx = useMemo(() => ({
    name: String(c.Title || ""), address: String(c.CorrespondenceAddress || c.HomeAddress || ""), phone: String(c.Phone || c.Mobile || "") || undefined,
    agent: { name: displayName(branding) || undefined, phone: branding.phone || undefined, address: (branding.correspondenceAddress || branding.registeredAddress || "").split(/\n|,/)[0]?.trim() || undefined, ref: String(c.Code || c.Key || "") || undefined },
  }), [c, branding]);
  const companyNames = useMemo(() => (data.clients as Client[]).filter(isCompany).map((x) => String(x.Title || "")), [data.clients]);
  const items = navItems(ret);
  const [pick, setPick] = useState<string>("front");
  const [adding, setAdding] = useState(false);
  const cur = items.find((x) => x.key === pick) || items[0];
  const period = yearEnd(year);
  const st = (key: string) => stateOf(data.papers, c.Key, period, `tax/${key}`);
  const done = items.filter((x) => st(x.key).status === "done" || st(x.key).status === "na").length;
  const i = items.findIndex((x) => x.key === cur.key);

  const add = (k: SectionKey) => {
    const id = newId();
    update((r0) => {
      const r = { ...r0, added: [...new Set([...(r0.added || []), k])] };
      switch (k) {
        case "employment": return { ...r, employments: [...r.employments, { id, name: "", paye: "", pay: 0, tax: 0, benefits: {}, expenses: {} }] };
        case "selfEmployment": return { ...r, selfEmployments: [...r.selfEmployments, { id, name: "", turnover: 0, expenses: 0 }] };
        case "partnership": return { ...r, partnerships: [...r.partnerships, { id, name: "", profit: 0 }] };
        case "interest": return { ...r, interest: r.interest.length ? r.interest : [{ id, payer: "", untaxed: 0 }] };
        case "dividends": return { ...r, dividends: r.dividends.length ? r.dividends : [{ id, company: "", amount: 0 }] };
        case "otherDividends": return { ...r, otherDividends: r.otherDividends || {} };
        case "property": return { ...r, property: r.property || { income: 0, finance: 0 } };
        case "pensions": return { ...r, pensions: r.pensions || { others: [] } };
        case "benefits": return { ...r, benefits: r.benefits || {} };
        case "otherIncome": return { ...r, otherIncome: r.otherIncome || { amount: 0 } };
        case "foreign": return { ...r, foreign: r.foreign || {} };
        case "gains": return { ...r, gains: r.gains.length ? r.gains : [{ id, description: "", kind: "shares", proceeds: 0, cost: 0 }] };
        case "nic": return { ...r, nic: { ...r.nic, voluntaryClass2: r.nic.voluntaryClass2 ?? false, exempt: r.nic.exempt ?? false } };
        case "marriage": return { ...r, allowances: { ...r.allowances, marriage: "transfer" } };
        case "blind": return { ...r, allowances: { ...r.allowances, blind: true } };
        case "pensionContributions": return { ...r, reliefs: { ...r.reliefs, pensionRas: r.reliefs.pensionRas } };
        case "giftAid": return { ...r, reliefs: { ...r.reliefs, giftAid: r.reliefs.giftAid } };
        case "investments": return { ...r, reliefs: { ...r.reliefs, eis: r.reliefs.eis } };
        case "otherReliefs": return { ...r, reliefs: { ...r.reliefs, loanInterest: r.reliefs.loanInterest } };
        case "studentLoan": return { ...r, studentLoan: { ...r.studentLoan, plans: r.studentLoan.plans.length ? r.studentLoan.plans : ["plan2"] } };
        case "childBenefit": return { ...r, childBenefit: r.childBenefit || {} };
        case "winterFuel": return { ...r, winterFuel: r.winterFuel || {} };
        case "payments": return { ...r, payments: { ...r.payments, poa1: r.payments.poa1 } };
        default: return r;
      }
    });
    setPick(SECTIONS.find((s) => s.key === k)?.multi ? `${k}:${id}` : k);
    setAdding(false);
  };

  if (view === "summary") return <SummaryView client={c} year={year} ret={ret} comp={comp} update={update} />;

  if (view === "return") {
    const eItems = editing ? items.filter((x) => x.section.key === editing.section) : [];
    return (
      <div className="tax-split tax-split-return">
        <aside className="tax-comp hero-wash" aria-label="Tax computation"><CompPanel comp={comp} year={year} client={c} /></aside>
        <ReturnViewer year={year} ret={ret} comp={comp} ctx={ctx} onPick={(section, title) => setEditing({ section, title })} />
        {editing && (
          <div className="tax-edit-sheet" role="presentation" onClick={() => setEditing(null)}>
            <div className="tax-edit-card" role="dialog" aria-modal="true" aria-label={`Change: ${editing.title}`} onClick={(e) => e.stopPropagation()}>
              <div className="quick-journal-head">
                <strong><Icon name="edit" size={16} /> {editing.title}</strong>
                <button type="button" className="quick-journal-x" onClick={() => setEditing(null)} aria-label="Close"><Icon name="close" size={16} /></button>
              </div>
              {eItems.length === 0 ? (
                <div className="stack" style={{ gap: 10 }}>
                  <p className="muted" style={{ margin: 0 }}>{SECTIONS.find((x) => x.key === editing.section)?.title} isn't on this return yet.</p>
                  <button type="button" className="btn primary" style={{ alignSelf: "flex-start" }} onClick={() => add(editing.section)}><Icon name="plus" size={15} /> Add {SECTIONS.find((x) => x.key === editing.section)?.title}</button>
                </div>
              ) : eItems.map((it) => (
                <div key={it.key} className="stack tax-form" style={{ gap: 10 }}>
                  {eItems.length > 1 && <h3 className="tax-sub">{it.title}</h3>}
                  {it.section.key === "front" && <FrontStatus ret={ret} update={update} />}
                  <SectionForm item={it} ret={ret} update={update} year={year} />
                </div>
              ))}
              <div className="row-wrap" style={{ gap: 8, marginTop: 12 }}>
                <button type="button" className="btn primary" onClick={() => setEditing(null)}><Icon name="check" size={15} /> Done</button>
                {eItems[0] && <button type="button" className="btn" onClick={() => { setPick(eItems[0].key); setEditing(null); setView("inputs"); }}>Open in the inputs</button>}
              </div>
            </div>
          </div>
        )}
        {ask && <ConfirmBox ask={ask} onClose={() => setAsk(null)} />}
      </div>
    );
  }

  return (
    <div className="tax-split">
      <div className="paper">
        <nav className="paper-side" aria-label="Sections of the tax return">
          <div className="paper-side-head">
            <button type="button" className="quick-journal-btn" title="Add a section" aria-label="Add a section" onClick={() => setAdding(true)}><Icon name="plus" size={16} /></button>
            <strong>{done} of {items.length} done</strong>
            <span className="muted" style={{ fontSize: 12, marginLeft: "auto" }}>{w.busy ? "Saving…" : savedAt ? `Saved ${savedAt}` : ""}</span>
            <span className="paper-bar" aria-hidden="true"><span style={{ width: `${items.length ? (done / items.length) * 100 : 0}%` }} /></span>
          </div>
          {["Return", ...TABS].map((t) => {
            const list = items.filter((x) => (t === "Return" ? x.section.key === "front" : x.section.tab === t && x.section.key !== "front"));
            if (!list.length) return null;
            return (
              <div key={t} className="paper-group">
                <span className="paper-group-name">{t === "Return" ? "Return" : t}</span>
                <ul>
                  {list.map((it) => {
                    const s = st(it.key);
                    return (
                      <li key={it.key}>
                        <button type="button" className={`paper-item ${s.status}${it.key === cur.key ? " on" : ""}`} aria-current={it.key === cur.key ? "true" : undefined} onClick={() => setPick(it.key)}>
                          <span className="paper-dot" aria-hidden="true">{s.status === "done" ? <Icon name="check" size={11} /> : s.status === "na" ? "–" : ""}</span>
                          <span className="paper-name">{it.title}</span>
                          {s.note && <span className="paper-note-flag" title="Has a note" aria-label="Has a note" />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
          <button type="button" className="btn small" style={{ margin: "6px 8px" }} onClick={() => setAdding(true)}>+ Add a section</button>
        </nav>
        <section className="paper-main stack" aria-labelledby="tax-h">
          <SectionHead item={cur} clientKey={c.Key} period={period} onRemove={cur.section.always ? undefined : () => { remove(cur); setPick("front"); }} />
          {cur.section.key === "front" && (
            <div className="card pad stack">
              <FrontStatus ret={ret} update={update} />
              <div className="row-wrap" style={{ gap: 8 }}>
                <button type="button" className="btn" disabled={!prevRet} title={prevRet ? `Start from the ${yearLabel(year - 1)} return` : `There's no ${yearLabel(year - 1)} return here to bring forward`} onClick={broughtForward}><Icon name="refresh" size={15} /> Bring forward from {yearLabel(year - 1)}</button>
                <button type="button" className="btn" onClick={() => setImporting(true)}><Icon name="download" size={15} /> Bring in from IRIS</button>
                <button type="button" className="btn danger" style={{ marginLeft: "auto" }} onClick={resetAll}><Icon name="refresh" size={15} /> Reset</button>
              </div>
              {!prevRet && <p className="muted" style={{ margin: 0, fontSize: 12 }}>No {yearLabel(year - 1)} return here to bring forward. Start one with New return (it can be brought in from IRIS).</p>}
              {prevRet && prevRet.status?.state !== "submitted" && <p className="warn" style={{ margin: 0, fontSize: 12 }}>The {yearLabel(year - 1)} return isn't marked as submitted yet.</p>}
              {ret.broughtForward && <p className="muted" style={{ margin: 0, fontSize: 12 }}>Brought forward from {yearLabel(ret.broughtForward.from)} on {fmtDate(ret.broughtForward.on)}.</p>}
              {ret.imported && <p className="muted" style={{ margin: 0, fontSize: 12 }}>Brought in from {ret.imported.from} on {fmtDate(ret.imported.on)}.</p>}
            </div>
          )}
          <div className="card pad stack tax-form">
            <SectionForm item={cur} ret={ret} update={update} year={year} />
          </div>
          <SectionFoot item={cur} clientKey={c.Key} period={period} onNext={i < items.length - 1 ? () => setPick(items[i + 1].key) : undefined} />
          {w.error && <p className="error-text" role="alert">{w.error}</p>}
        </section>
      </div>
      <aside className="tax-comp hero-wash" aria-label="Tax computation"><CompPanel comp={comp} year={year} client={c} /></aside>
      {adding && <AddSection ret={ret} onAdd={add} onClose={() => setAdding(false)} />}
      {ask && <ConfirmBox ask={ask} onClose={() => setAsk(null)} />}
      {importing && <ImportDialog client={c} year={year} names={companyNames} onClose={() => setImporting(false)}
        onUse={(res, y, submitted) => { setImporting(false); if (y === year) applyImport(res, submitted); else sendImport(c.Key, y, res, submitted, () => { window.location.hash = href("tax", c.Key, String(y)); }); }} />}
    </div>
  );

  function remove(it: NavItem) {
    if (!window.confirm(`Remove "${it.title}" and its figures from this return?`)) return;
    update((r0) => {
      const r = { ...r0, added: (r0.added || []).filter((x) => x !== it.section.key || it.section.multi) };
      switch (it.section.key) {
        case "employment": return { ...r, employments: r.employments.filter((x) => x.id !== it.id) };
        case "selfEmployment": return { ...r, selfEmployments: r.selfEmployments.filter((x) => x.id !== it.id) };
        case "partnership": return { ...r, partnerships: r.partnerships.filter((x) => x.id !== it.id) };
        case "interest": return { ...r, interest: [] };
        case "dividends": return { ...r, dividends: [] };
        case "otherDividends": return { ...r, otherDividends: undefined };
        case "property": return { ...r, property: undefined };
        case "pensions": return { ...r, pensions: undefined };
        case "benefits": return { ...r, benefits: undefined };
        case "otherIncome": return { ...r, otherIncome: undefined };
        case "foreign": return { ...r, foreign: undefined };
        case "gains": return { ...r, gains: [], gainsLossesBf: undefined };
        case "nic": return { ...r, nic: {} };
        case "marriage": return { ...r, allowances: { ...r.allowances, marriage: "none" } };
        case "blind": return { ...r, allowances: { ...r.allowances, blind: false } };
        case "pensionContributions": return { ...r, reliefs: { ...r.reliefs, pensionRas: undefined, pensionGross: undefined } };
        case "giftAid": return { ...r, reliefs: { ...r.reliefs, giftAid: undefined, giftAidCarriedBack: undefined } };
        case "investments": return { ...r, reliefs: { ...r.reliefs, eis: undefined, seis: undefined, vct: undefined } };
        case "otherReliefs": return { ...r, reliefs: { ...r.reliefs, loanInterest: undefined, maintenance: undefined }, charityGifts: undefined };
        case "studentLoan": return { ...r, studentLoan: { plans: [] } };
        case "childBenefit": return { ...r, childBenefit: undefined };
        case "winterFuel": return { ...r, winterFuel: undefined };
        case "payments": return { ...r, payments: {} };
        default: return r;
      }
    });
  }
}

// ------------------------------------------------------------------ where the return has got to

function FrontStatus({ ret, update }: { ret: TaxReturn; update: (f: (r: TaxReturn) => TaxReturn) => void }) {
  const st = ret.status || { state: "draft" as ReturnState };
  const set = (p: Partial<NonNullable<TaxReturn["status"]>>) => update((r) => ({ ...r, status: { ...(r.status || { state: "draft" }), ...p } }));
  return (
    <div className="tax-grid">
      <label className="tax-field"><span>Return status</span>
        <select className="input" value={st.state} onChange={(e) => set({ state: e.target.value as ReturnState, date: e.target.value === "submitted" ? st.date || todayIso() : st.date })}>
          {(Object.keys(STATE_LABEL) as ReturnState[]).map((k) => <option key={k} value={k}>{STATE_LABEL[k]}</option>)}
        </select>
      </label>
      {st.state === "submitted" && <>
        <label className="tax-field"><span>Submitted on</span><input className="input" type="date" value={st.date || ""} onChange={(e) => set({ date: e.target.value || undefined })} /></label>
        <label className="tax-field"><span>IRmark (HMRC receipt)</span><input className="input mono" value={st.irmark || ""} placeholder="Optional" onChange={(e) => set({ irmark: e.target.value || undefined })} /></label>
      </>}
    </div>
  );
}

// ------------------------------------------------------------------ the head and foot of a section (status, notes, next)

function SectionHead({ item, clientKey, period, onRemove }: { item: NavItem; clientKey: string; period: string; onRemove?: () => void }) {
  const { data } = useData();
  const w = useWriterState();
  const st = stateOf(data.papers, clientKey, period, `tax/${item.key}`);
  return (
    <div className="card pad stack">
      <div>
        <span className="eyebrow">{item.section.tab}</span>
        <h2 id="tax-h" className="tax-head-title">{item.title}</h2>
      </div>
      <div className="row-wrap" style={{ gap: 12 }}>
        <div className="seg" role="group" aria-label="Status">
          {(Object.keys(STATUS_LABEL) as PaperStatus[]).map((k) => (
            <button key={k} type="button" aria-pressed={st.status === k} onClick={() => void w.writeSetup(`tax/${item.key}`, {}, { Status: k })}>{STATUS_LABEL[k]}</button>
          ))}
        </div>
        {onRemove && <button type="button" className="btn small" style={{ marginLeft: "auto" }} onClick={onRemove}>Remove section</button>}
      </div>
    </div>
  );
}

function SectionFoot({ item, clientKey, period, onNext }: { item: NavItem; clientKey: string; period: string; onNext?: () => void }) {
  const { data } = useData();
  const w = useWriterState();
  const st = stateOf(data.papers, clientKey, period, `tax/${item.key}`);
  const [note, setNote] = useState(st.note);
  useEffect(() => setNote(st.note), [st.note, item.key]);
  return (
    <div className="card pad stack">
      <label className="doc-field"><strong>Notes on this section</strong>
        <textarea className="input" rows={3} value={note} placeholder="Where the figures came from, what to ask the client" onChange={(e) => setNote(e.target.value)} onBlur={() => note !== st.note && void w.writeSetup(`tax/${item.key}`, {}, { Note: note })} />
      </label>
      <div className="row-wrap" style={{ gap: 8 }}>
        <button type="button" className="btn primary" onClick={() => { void w.writeSetup(`tax/${item.key}`, {}, { Status: "done" }); onNext?.(); }}><Icon name="check" size={15} /> {onNext ? "Done, next section" : "Done"}</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ the gallery of sections

function AddSection({ ret, onAdd, onClose }: { ret: TaxReturn; onAdd: (k: SectionKey) => void; onClose: () => void }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("UK income");
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); document.addEventListener("keydown", k); return () => document.removeEventListener("keydown", k); }, [onClose]);
  const list = SECTIONS.filter((s) => s.tab === tab && !s.always);
  const groups = [...new Set(list.map((s) => s.group))];
  return (
    <div className="tax-add-sheet" role="presentation" onClick={onClose}>
      <div className="tax-add-card" role="dialog" aria-label="Choose a section to add" onClick={(e) => e.stopPropagation()}>
        <div className="quick-journal-head">
          <strong><Icon name="plus" size={16} /> Add a section</strong>
          <span className="quick-journal-note">Choose what goes on this return</span>
          <button type="button" className="quick-journal-x" onClick={onClose} aria-label="Close"><Icon name="close" size={16} /></button>
        </div>
        <nav className="tax-add-tabs" aria-label="Kinds of section">{TABS.map((t) => <button key={t} type="button" aria-current={tab === t ? "page" : undefined} onClick={() => setTab(t)}>{t}</button>)}</nav>
        <div className="tax-add-cols">
          {groups.map((g) => (
            <div key={g} className="stack" style={{ gap: 6 }}>
              <h3>{g}</h3>
              {list.filter((s) => s.group === g).map((s) => {
                const added = hasSection(ret, s.key) && !s.multi;
                return <button key={s.key} type="button" className="tax-add-item" disabled={added} title={added ? "Already on this return" : undefined} onClick={() => onAdd(s.key)}>{added ? <s>{s.title}</s> : s.title}{s.multi && hasSection(ret, s.key) ? " (add another)" : ""}</button>;
              })}
            </div>
          ))}
          {NOT_YET.some((x) => x.tab === tab) && (
            <div className="stack" style={{ gap: 6 }}>
              <h3>Not worked out here yet</h3>
              {NOT_YET.filter((x) => x.tab === tab).map((x) => <span key={x.title} className="tax-add-later">{x.title}</span>)}
              <span className="quick-journal-note">Enter these in IRIS Elements for now.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ inputs

const blank = (v: number | undefined) => (v === undefined || Math.abs(v) < 0.001 ? "" : Math.abs(Math.round(v * 100) / 100 - v) < 1e-9 ? v.toFixed(2) : String(v));
/** The payments to and from HMRC for the year: the two payments on account (unticked until paid), any others added, and what is still to pay. */
function PaymentLines({ ret, year, update }: { ret: TaxReturn; year: number; update: (f: (r: TaxReturn) => TaxReturn) => void }) {
  const lines = paymentLines(ret, year);
  const today = todayIso();
  const out = outstandingPayments(ret, year, today);
  const setLines = (f: (ls: PaymentLine[]) => PaymentLine[]) => update((r) => ({ ...r, payments: { ...r.payments, lines: f(paymentLines(r, year)) } }));
  const edit = (id: string, patch: Partial<PaymentLine>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const money = (v: number | undefined) => gbp(v ?? 0);
  return (
    <div className="tax-group tax-pay-group"><h3>Payments on account and other payments</h3><div className="tax-pay-stack">
      {ret.payments.expectedFrom && <p className="muted" style={{ margin: 0, fontSize: 13 }}>The payments on account are expected from {ret.payments.expectedFrom}. Each one counts against the tax once it is ticked as paid.</p>}
      <div className={`tax-outstanding${out.lines.some((l) => l.overdue) ? " late" : ""}`} aria-live="polite">
        <strong>{out.lines.length ? `Still to pay: ${money(out.total)}` : "Nothing outstanding"}</strong>
        {out.lines.map((l) => (
          <div key={l.id} className="tax-outstanding-row">
            <span>{l.label || "Payment"}</span>
            <span className="muted">{fmtDate(l.date)}{l.overdue && <b className="red-ink"> · overdue</b>}</span>
            <span className="mono">{money(l.owed)}{l.late ? <small className="muted"> incl. {money(l.late)} late</small> : null}</span>
          </div>
        ))}
      </div>
      {lines.map((l) => (
        <div key={l.id} className={`tax-pay-line${l.paid ? " paid" : ""}`}>
          <label className="tax-pay-tick"><input type="checkbox" checked={!!l.paid} onChange={(e) => edit(l.id, { paid: e.target.checked })} /> Paid</label>
          {l.kind === "other"
            ? <input className="input" aria-label="Payment" value={l.label} placeholder="What it is" onChange={(e) => edit(l.id, { label: e.target.value })} />
            : <span className="tax-pay-name">{l.label}{l.source ? <small className="muted"> · part of the {gbp(l.source.amount)} paid {fmtDate(l.source.date)}</small> : null}</span>}
          <label className="tax-pay-date"><span>{l.paid ? "Paid on" : "Due"}</span><input className="input" type="date" value={l.date} onChange={(e) => e.target.value && edit(l.id, { date: e.target.value })} /></label>
          <Money label={l.paid ? "Amount paid" : "Amount"} value={l.amount} onChange={(v) => edit(l.id, { amount: v })} />
          <Money label="Late payment increase" hint="(interest or penalty)" value={l.late} onChange={(v) => edit(l.id, { late: v })} />
          <button type="button" className="btn small" onClick={() => update((r) => ({ ...r, payments: { ...r.payments, lines: paymentLines(r, year).filter((x) => x.id !== l.id), imported: l.hmrcKey ? (r.payments.imported || []).filter((k) => k !== l.hmrcKey) : r.payments.imported } }))} aria-label={`Remove ${l.label || "this payment"}`}>Remove</button>
        </div>
      ))}
      <div className="row-wrap" style={{ gap: 8 }}>
        <button type="button" className="btn small" onClick={() => setLines((ls) => [...ls, { id: newId(), kind: "other", label: "", date: today, amount: undefined, paid: false }])}><Icon name="plus" size={14} /> Add a payment</button>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>Ticked payments come off the tax on the summary. Change the date to the day it was paid. If it was paid late, enter the interest or penalty under late payment increase.</p>
    </div></div>
  );
}

/** Each payment HMRC received, with what it was allocated to this year, and any part that went to another year. */
function PaymentSources({ lines, year }: { lines: PaymentLine[]; year: number }) {
  const groups = new Map<string, { date: string; amount: number; lines: PaymentLine[] }>();
  const loose: PaymentLine[] = [];
  for (const l of lines) {
    if (!l.source) { if (l.amount) loose.push(l); continue; }
    const k = `${l.source.date}|${l.source.amount}`;
    const g = groups.get(k) ?? { date: l.source.date, amount: l.source.amount, lines: [] };
    g.lines.push(l);
    groups.set(k, g);
  }
  if (!groups.size && !loose.length) return null;
  const total = (xs: PaymentLine[]) => Math.round(xs.reduce((a, l) => a + (l.amount || 0), 0) * 100) / 100;
  return (
    <section className="card" style={{ padding: 16 }}>
      <h3 style={{ margin: "0 0 4px" }}>How each payment was allocated</h3>
      <p className="muted" style={{ margin: "0 0 10px", fontSize: 13 }}>HMRC's payment comes first. Part of it is allocated to {yearLabel(year)}; any rest went to another year.</p>
      <div className="stack" style={{ gap: 12 }}>
        {[...groups.values()].map((g) => {
          const here = total(g.lines);
          const rest = Math.round((g.amount - here) * 100) / 100;
          return (
            <div key={`${g.date}|${g.amount}`} className="stack" style={{ gap: 4 }}>
              <div className="row-wrap" style={{ justifyContent: "space-between", gap: 8 }}>
                <strong>Payment of {gbp(g.amount)} on {fmtDate(g.date)}</strong>
                <span className="mono">{gbp(here)} to {yearLabel(year)}{rest > 0.004 ? `, ${gbp(rest)} to another year` : ""}</span>
              </div>
              <table className="grid"><tbody>{g.lines.map((l) => <tr key={l.id}><td>{l.label}</td><td className="num mono">{gbp(l.amount)}</td></tr>)}</tbody></table>
              {rest > 0.004 && <p className="muted" style={{ margin: 0, fontSize: 12 }}>{gbp(rest)} of this payment was allocated to another tax year. Paste that year's breakdown to see which.</p>}
            </div>
          );
        })}
        {loose.map((l) => (
          <div key={l.id} className="row-wrap" style={{ justifyContent: "space-between", gap: 8 }}>
            <span>{l.label} (entered by hand)</span><span className="mono">{gbp(l.amount)} on {fmtDate(l.date)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Money({ label, value, onChange, hint }: { label: string; value: number | undefined; onChange: (v: number | undefined) => void; hint?: string }) {
  const [t, setT] = useState(blank(value));
  useEffect(() => { if (Number(t.replace(/[£,\s]/g, "") || 0) !== (value || 0)) setT(blank(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <label className="tax-field"><span>{label}{hint && <small className="muted"> {hint}</small>}</span>
      <input className="input mono" inputMode="decimal" value={t} placeholder="0.00" onChange={(e) => { setT(e.target.value); const x = e.target.value.replace(/[£,\s]/g, ""); const v = x === "" ? undefined : Number(x); if (x === "" || Number.isFinite(v)) onChange(v); }} />
    </label>
  );
}
const Text = ({ label, value, onChange, placeholder }: { label: string; value: string | undefined; onChange: (v: string) => void; placeholder?: string }) => (
  <label className="tax-field"><span>{label}</span><input className="input" value={value || ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} /></label>
);
const DateIn = ({ label, value, onChange }: { label: string; value: string | undefined; onChange: (v: string) => void }) => (
  <label className="tax-field"><span>{label}</span><input className="input" type="date" value={value || ""} onChange={(e) => onChange(e.target.value)} /></label>
);
const Tick = ({ label, value, onChange }: { label: string; value: boolean | undefined; onChange: (v: boolean) => void }) => (
  <label className="tax-tick"><input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} /> {label}</label>
);
const Group = ({ title, children }: { title: string; children: ReactNode }) => <div className="tax-group"><h3>{title}</h3><div className="tax-grid">{children}</div></div>;
const Readout = ({ label, value, strong }: { label: string; value: number; strong?: boolean }) => <div className={`tax-readout${strong ? " strong" : ""}`}><span>{label}</span><span className="mono">{gbp(value)}</span></div>;

// ------------------------------------------------------------------ the forms

function SectionForm({ item, ret, update, year }: { item: NavItem; ret: TaxReturn; update: (f: (r: TaxReturn) => TaxReturn) => void; year: number }) {
  const R = ratesFor(year);
  const k = item.section.key;
  const patchList = <K extends "employments" | "selfEmployments" | "partnerships">(list: K, id: string, p: Partial<TaxReturn[K][number]>) =>
    update((r) => ({ ...r, [list]: (r[list] as { id: string }[]).map((x) => (x.id === id ? { ...x, ...p } : x)) }));

  if (k === "front") {
    const f = ret.front, set = (p: Partial<TaxReturn["front"]>) => update((r) => ({ ...r, front: { ...r.front, ...p } }));
    const age = f.dob ? Math.floor((Date.parse(`${year - 1}-04-06`) - Date.parse(f.dob)) / (365.25 * 864e5)) : undefined;
    return (<>
      <Group title="Taxpayer">
        <Text label="UTR" value={f.utr} onChange={(v) => set({ utr: v })} />
        <Text label="National Insurance number" value={f.nino} onChange={(v) => set({ nino: v })} />
        <DateIn label="Date of birth" value={f.dob} onChange={(v) => set({ dob: v })} />
        <label className="tax-field"><span>Where they live for tax</span>
          <select className="input" value={f.region} onChange={(e) => set({ region: e.target.value as TaxReturn["front"]["region"] })}>
            <option value="england">England or Northern Ireland</option><option value="scotland">Scotland (Scottish rates)</option><option value="wales">Wales (Welsh rates)</option>
          </select>
        </label>
      </Group>
      <Tick label={`Over State Pension age at 6 April ${year - 1} (no Class 4 NIC)${age !== undefined ? `: aged ${age} then` : ""}`} value={f.overSpa} onChange={(v) => set({ overSpa: v })} />
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>Tax year {R.label}: 6 April {year - 1} to 5 April {year}. Online filing deadline 31 January {year + 1}.</p>
    </>);
  }
  if (k === "employment" && item.id) {
    const e = ret.employments.find((x) => x.id === item.id)!;
    if (!e) return null;
    const set = (p: Partial<Employment>) => patchList("employments", e.id, p);
    const ben = (p: Partial<Employment["benefits"]>) => set({ benefits: { ...e.benefits, ...p } }), exp = (p: Partial<Employment["expenses"]>) => set({ expenses: { ...e.expenses, ...p } });
    return (<>
      <Group title="Employer">
        <Text label="Employer's name" value={e.name} onChange={(v) => set({ name: v })} />
        <Text label="PAYE reference" value={e.paye} onChange={(v) => set({ paye: v })} placeholder="123/AB45678" />
      </Group>
      <div className="row-wrap" style={{ gap: 16 }}><Tick label="Director" value={e.director} onChange={(v) => set({ director: v })} /><Tick label="Close company" value={e.closeCompany} onChange={(v) => set({ closeCompany: v })} /></div>
      <Group title="Pay and tax (P60 or P45)">
        <Money label="Pay from this employment" value={e.pay} onChange={(v) => set({ pay: v || 0 })} />
        <Money label="UK tax taken off" value={e.tax} onChange={(v) => set({ tax: v || 0 })} />
        <Money label="Tips and other payments" value={e.tips} onChange={(v) => set({ tips: v })} />
      </Group>
      <Group title="Benefits (P11D)">
        <Money label="Company cars" value={e.benefits.car} onChange={(v) => ben({ car: v })} /><Money label="Fuel for company cars" value={e.benefits.fuel} onChange={(v) => ben({ fuel: v })} />
        <Money label="Company vans" value={e.benefits.van} onChange={(v) => ben({ van: v })} /><Money label="Fuel for company vans" value={e.benefits.vanFuel} onChange={(v) => ben({ vanFuel: v })} />
        <Money label="Private medical and dental" value={e.benefits.medical} onChange={(v) => ben({ medical: v })} /><Money label="Beneficial loans" value={e.benefits.loans} onChange={(v) => ben({ loans: v })} />
        <Money label="Accommodation" value={e.benefits.accommodation} onChange={(v) => ben({ accommodation: v })} /><Money label="Excess mileage allowance" value={e.benefits.mileage} onChange={(v) => ben({ mileage: v })} />
        <Money label="Other benefits" value={e.benefits.other} onChange={(v) => ben({ other: v })} />
      </Group>
      <Group title="Expenses">
        <Money label="Business travel and subsistence" value={e.expenses.travel} onChange={(v) => exp({ travel: v })} /><Money label="Fixed deductions (uniforms, tools)" value={e.expenses.fixed} onChange={(v) => exp({ fixed: v })} />
        <Money label="Professional fees and subscriptions" value={e.expenses.professional} onChange={(v) => exp({ professional: v })} /><Money label="Other expenses and capital allowances" value={e.expenses.other} onChange={(v) => exp({ other: v })} />
      </Group>
      <Group title="Student loan deducted by this employer">
        <Money label="Student loan" value={e.studentLoanDeducted} onChange={(v) => set({ studentLoanDeducted: v })} /><Money label="Postgraduate loan" value={e.postgradDeducted} onChange={(v) => set({ postgradDeducted: v })} />
      </Group>
      <Readout label="Taxable employment income" value={employmentIncome(e)} strong />
    </>);
  }
  if (k === "selfEmployment" && item.id) {
    const s = ret.selfEmployments.find((x) => x.id === item.id)!;
    if (!s) return null;
    const set = (p: Partial<SelfEmployment>) => patchList("selfEmployments", s.id, p);
    const t = tradeProfit(s);
    const items = s.expenseItems || [];
    const boxTotal = (b: ExpenseBox) => Math.round(items.filter((x) => expenseBoxOf(x) === b).reduce((a, x) => a + x.amount, 0) * 100) / 100;
    // each expense line as the accounts show it, with its SA103 box; the total is their sum, so the lines and the total can't disagree
    // the total and the disallowable total are the sums of the lines, so the boxes, the totals and the return can't disagree
    const setItems = (next: ExpenseLine[]) => set({
      expenseItems: next.length ? next : undefined,
      expenses: Math.round(next.reduce((a, x) => a + x.amount, 0) * 100) / 100,
      ...(next.length ? { disallowable: Math.round(next.reduce((a, x) => a + (x.disallowable || 0), 0) * 100) / 100 } : {}),
    });
    return (<>
      <Group title="Business">
        <Text label="Business name" value={s.name} onChange={(v) => set({ name: v })} /><Text label="Description" value={s.description} onChange={(v) => set({ description: v })} />
        <DateIn label="Started (if in the year)" value={s.start} onChange={(v) => set({ start: v })} /><DateIn label="Ceased (if in the year)" value={s.end} onChange={(v) => set({ end: v })} />
      </Group>
      <Group title="Income">
        <Money label="Turnover" value={s.turnover} onChange={(v) => set({ turnover: v || 0 })} /><Money label="Other business income" value={s.otherIncome} onChange={(v) => set({ otherIncome: v })} />
      </Group>
      <Tick label={`Claim the £${R.tradingAllowance.toLocaleString("en-GB")} trading allowance instead of expenses`} value={s.tradingAllowance} onChange={(v) => set({ tradingAllowance: v })} />
      {!s.tradingAllowance && <Group title="Expenses and adjustments">
        {items.length
          ? <Readout label="Allowable expenses (total of the lines below)" value={s.expenses} />
          : <Money label="Allowable expenses (total)" value={s.expenses} onChange={(v) => set({ expenses: v || 0 })} />}
        {items.length
          ? <Readout label="Disallowable expenses added back (total of the lines below)" value={s.disallowable || 0} />
          : <Money label="Disallowable expenses added back" value={s.disallowable} onChange={(v) => set({ disallowable: v })} />}
        <Money label="Capital allowances" value={s.capitalAllowances} onChange={(v) => set({ capitalAllowances: v })} /><Money label="Balancing charges" value={s.balancingCharges} onChange={(v) => set({ balancingCharges: v })} />
      </Group>}
      {!s.tradingAllowance && <Group title="Expense breakdown by SA103 box">
        {EXPENSE_BOXES.map((b) => {
          const mine = items.map((x, i) => ({ x, i })).filter(({ x }) => expenseBoxOf(x) === b.box);
          const disTotal = Math.round(mine.reduce((a, { x }) => a + (x.disallowable || 0), 0) * 100) / 100;
          return (<div key={b.box} className="tax-box-group">
            <div className="tax-box-head"><strong>Box {b.box}: {b.label}</strong><span className="mono">{gbp(boxTotal(b.box))}</span>{disTotal > 0 && <span className="muted mono">disallowable {gbp(disTotal)}</span>}</div>
            {mine.map(({ x, i }) => <div key={x.id} className="tax-expense-row">
              <Text label="Expense" value={x.label} onChange={(v) => setItems(items.map((y, j) => (j === i ? { ...y, label: v || "" } : y)))} />
              <Money label="Amount" value={x.amount} onChange={(v) => setItems(items.map((y, j) => (j === i ? { ...y, amount: v || 0 } : y)))} />
              <Money label="Disallowable" value={x.disallowable} onChange={(v) => setItems(items.map((y, j) => (j === i ? { ...y, disallowable: v } : y)))} />
              <label className="tax-expense-box"><span>SA103 box</span><select value={expenseBoxOf(x)} onChange={(e) => setItems(items.map((y, j) => (j === i ? { ...y, box: e.target.value as ExpenseBox } : y)))}>
                {EXPENSE_BOXES.map((o) => <option key={o.box} value={o.box}>{o.box}: {o.label}</option>)}
              </select></label>
              <button type="button" className="btn small" onClick={() => setItems(items.filter((_, j) => j !== i))}>Remove</button>
            </div>)}
            <button type="button" className="btn small" onClick={() => setItems([...items, { id: newId(), label: b.label, amount: 0, box: b.box }])}><Icon name="plus" size={14} /> Add a line to box {b.box}</button>
          </div>);
        })}
        {items.length > 0 && <div className="tax-expense-totals"><Readout label="Total expenses" value={s.expenses} strong />{(s.disallowable || 0) > 0 && <Readout label="Total disallowable" value={s.disallowable || 0} />}</div>}
      </Group>}
      <Group title="Tax return boxes (SA103)">
        <Readout label="Box 9 Turnover" value={s.turnover} />
        <Readout label="Box 10 Other business income" value={s.otherIncome || 0} />
        {s.tradingAllowance && <Readout label="Box 10.1 Trading income allowance" value={R.tradingAllowance} />}
        {!s.tradingAllowance && EXPENSE_BOXES.map((b) => <Readout key={b.box} label={`Box ${b.box} ${b.label}`} value={boxTotal(b.box)} />)}
        {!s.tradingAllowance && <Readout label="Box 20 Total allowable expenses" value={s.expenses} strong />}
        {!s.tradingAllowance && !items.length && <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>Add the expense lines to split the total across boxes 11 to 19.</p>}
      </Group>
      <Group title="Profits and losses">
        {year >= 2025 && year <= 2028 && <Money label="Transition profit taxable this year" hint="(basis period reform)" value={s.transitionProfit} onChange={(v) => set({ transitionProfit: v })} />}
        <Money label="Losses brought forward" value={s.lossesBf} onChange={(v) => set({ lossesBf: v })} />
        {t.loss > 0 && <Money label="Loss to set against other income this year" value={s.lossSideways} onChange={(v) => set({ lossSideways: v })} />}
      </Group>
      <Group title="Tax already deducted">
        <Money label="CIS deductions" value={s.cis} onChange={(v) => set({ cis: v })} /><Money label="Other tax taken off trading income" value={s.taxDeducted} onChange={(v) => set({ taxDeducted: v })} />
      </Group>
      <div className="stack" style={{ gap: 2 }}>
        <Readout label="Adjusted profit (loss)" value={t.adjusted} />
        {t.lossUsed > 0 && <Readout label="Losses brought forward used" value={-t.lossUsed} />}
        <Readout label="Taxable profit" value={t.profit} strong />
        {t.lossCf > 0 && <Readout label="Losses to carry forward" value={t.lossCf} />}
      </div>
    </>);
  }
  if (k === "partnership" && item.id) {
    const x = ret.partnerships.find((y) => y.id === item.id)!;
    if (!x) return null;
    const set = (p: Partial<Partnership>) => patchList("partnerships", x.id, p);
    return (<>
      <Group title="Partnership">
        <Text label="Partnership name" value={x.name} onChange={(v) => set({ name: v })} /><Text label="Partnership UTR" value={x.utr} onChange={(v) => set({ utr: v })} />
      </Group>
      <Group title="Your share (from the partnership statement)">
        <Money label="Share of profit (loss)" value={x.profit} onChange={(v) => set({ profit: v || 0 })} />
        {year >= 2025 && year <= 2028 && <Money label="Transition profit taxable this year" value={x.transitionProfit} onChange={(v) => set({ transitionProfit: v })} />}
        <Money label="Losses brought forward" value={x.lossesBf} onChange={(v) => set({ lossesBf: v })} />
        <Money label="Share of untaxed savings income" value={x.savings} onChange={(v) => set({ savings: v })} /><Money label="Share of dividend income" value={x.dividends} onChange={(v) => set({ dividends: v })} />
        <Money label="Share of tax taken off" value={x.taxDeducted} onChange={(v) => set({ taxDeducted: v })} /><Money label="Share of CIS deductions" value={x.cis} onChange={(v) => set({ cis: v })} />
      </Group>
    </>);
  }
  if (k === "nic") {
    const set = (p: Partial<TaxReturn["nic"]>) => update((r) => ({ ...r, nic: { ...r.nic, ...p } }));
    return (<>
      <Tick label="Exempt from Class 4 (non-resident, or over State Pension age at the start of the year)" value={ret.nic.exempt} onChange={(v) => set({ exempt: v })} />
      <Tick label={`Pay voluntary Class 2 (£${R.class2Weekly.toFixed(2)} a week)${R.class2Compulsory ? "" : `: only when profits are under £${R.smallProfitsThreshold.toLocaleString("en-GB")}`}`} value={ret.nic.voluntaryClass2} onChange={(v) => set({ voluntaryClass2: v })} />
      <Group title="Also employed?"><Money label="Class 1 earnings (P60, NIC table column d)" value={ret.nic.class1Earnings} onChange={(v) => set({ class1Earnings: v })} /></Group>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>Class 4: {Math.round(R.class4Main * 100)}% on profits from £{R.class4Lower.toLocaleString("en-GB")} to £{R.class4Upper.toLocaleString("en-GB")}, {Math.round(R.class4Additional * 100)}% above.</p>
    </>);
  }
  if (k === "interest") {
    const set = (list: Interest[]) => update((r) => ({ ...r, interest: list }));
    return <ListTable<Interest> rows={ret.interest} onChange={set} blank={() => ({ id: newId(), payer: "", untaxed: 0 })} cols={[
      { label: "Bank or society", text: "payer" }, { label: "Account number", text: "accountNumber" }, { label: "Untaxed interest", money: "untaxed" }, { label: "Taxed interest (net)", money: "net" }, { label: "Tax taken off", money: "taxTaken" }, { label: "Foreign", tick: "foreign" }, { label: "Foreign tax", money: "foreignTax" },
    ]} />;
  }
  if (k === "dividends") {
    const set = (list: Dividend[]) => update((r) => ({ ...r, dividends: list }));
    return <ListTable<Dividend> rows={ret.dividends} onChange={set} blank={() => ({ id: newId(), company: "", amount: 0 })} cols={[
      { label: "Company", text: "company" }, { label: "Dividends received", money: "amount" }, { label: "Foreign", tick: "foreign" }, { label: "Foreign tax", money: "foreignTax" },
    ]} />;
  }
  if (k === "otherDividends") {
    const o = ret.otherDividends || {}, set = (p: Partial<NonNullable<TaxReturn["otherDividends"]>>) => update((r) => ({ ...r, otherDividends: { ...o, ...p } }));
    return <Group title="Other dividends"><Money label="Stock dividends (cash equivalent)" value={o.stock} onChange={(v) => set({ stock: v })} /><Money label="Bonus issues of redeemable shares" value={o.bonus} onChange={(v) => set({ bonus: v })} /><Money label="Close company loans written off" value={o.loansWrittenOff} onChange={(v) => set({ loansWrittenOff: v })} /></Group>;
  }
  if (k === "property") {
    const p = ret.property!, set = (x: Partial<NonNullable<TaxReturn["property"]>>) => update((r) => ({ ...r, property: { ...p, ...x } }));
    if (!p) return null;
    const pp = propertyProfit(ret);
    return (<>
      <Tick label={`Claim the £${R.propertyAllowance.toLocaleString("en-GB")} property allowance instead of expenses`} value={p.propertyAllowance} onChange={(v) => set({ propertyAllowance: v })} />
      <Group title="Income">
        <Money label="Rents and other income" value={p.income} onChange={(v) => set({ income: v || 0 })} /><Money label="Other income from property" value={p.otherIncome} onChange={(v) => set({ otherIncome: v })} />
        <Money label="Premiums for the grant of a lease" value={p.premiums} onChange={(v) => set({ premiums: v })} /><Money label="Tax taken off (non-resident landlord)" value={p.taxTaken} onChange={(v) => set({ taxTaken: v })} />
      </Group>
      {!p.propertyAllowance && <>
        <Group title="Expenses">
          <Money label="Rent, rates, insurance, ground rents" value={p.rates} onChange={(v) => set({ rates: v })} /><Money label="Repairs and maintenance" value={p.repairs} onChange={(v) => set({ repairs: v })} />
          <Money label="Legal, management and professional fees" value={p.legal} onChange={(v) => set({ legal: v })} /><Money label="Costs of services, including wages" value={p.services} onChange={(v) => set({ services: v })} />
          <Money label="Travel costs" value={p.travel} onChange={(v) => set({ travel: v })} /><Money label="Other allowable expenses" value={p.other} onChange={(v) => set({ other: v })} />
          <Money label="Replacing domestic items" value={p.replacingItems} onChange={(v) => set({ replacingItems: v })} /><Money label="Capital allowances" value={p.capitalAllowances} onChange={(v) => set({ capitalAllowances: v })} />
          <Money label="Private use adjustment" value={p.privateUse} onChange={(v) => set({ privateUse: v })} /><Money label="Balancing charges" value={p.balancingCharges} onChange={(v) => set({ balancingCharges: v })} />
        </Group>
        <Group title="Residential finance costs (20% tax credit)">
          <Money label="Loan interest and other finance costs" value={p.finance} onChange={(v) => set({ finance: v || 0 })} /><Money label="Unused finance costs brought forward" value={p.financeBf} onChange={(v) => set({ financeBf: v })} />
        </Group>
      </>}
      <Group title="Losses"><Money label="Property losses brought forward" value={p.lossesBf} onChange={(v) => set({ lossesBf: v })} /></Group>
      <div className="stack" style={{ gap: 2 }}><Readout label="Taxable property profit" value={pp.profit} strong />{pp.lossCf > 0 && <Readout label="Losses to carry forward" value={pp.lossCf} />}</div>
    </>);
  }
  if (k === "pensions") {
    const p = ret.pensions || { others: [] }, set = (x: Partial<NonNullable<TaxReturn["pensions"]>>) => update((r) => ({ ...r, pensions: { ...p, ...x } }));
    return (<>
      <Group title="State Pension"><Money label="State Pension for the year" value={p.state} onChange={(v) => set({ state: v })} /><Money label="State Pension lump sum" value={p.stateLumpSum} onChange={(v) => set({ stateLumpSum: v })} /><Money label="Tax taken off the lump sum" value={p.stateLumpSumTax} onChange={(v) => set({ stateLumpSumTax: v })} /></Group>
      <h3 className="tax-sub">Other UK pensions and annuities</h3>
      <ListTable<OtherPension> rows={p.others} onChange={(list) => set({ others: list })} blank={() => ({ id: newId(), payer: "", amount: 0, tax: 0 })} cols={[{ label: "Pension", text: "payer" }, { label: "Gross", money: "amount" }, { label: "Tax taken off", money: "tax" }, { label: "Net", money: "net" }]} />
    </>);
  }
  if (k === "benefits") {
    const b = ret.benefits || {}, set = (x: Partial<NonNullable<TaxReturn["benefits"]>>) => update((r) => ({ ...r, benefits: { ...b, ...x } }));
    return <Group title="Taxable state benefits"><Money label="Jobseeker's Allowance" value={b.jsa} onChange={(v) => set({ jsa: v })} /><Money label="Employment and Support Allowance" value={b.esa} onChange={(v) => set({ esa: v })} /><Money label="Taxable Incapacity Benefit" value={b.incapacity} onChange={(v) => set({ incapacity: v })} /><Money label="Tax taken off Incapacity Benefit" value={b.incapacityTax} onChange={(v) => set({ incapacityTax: v })} /><Money label="Carer's Allowance" value={b.carers} onChange={(v) => set({ carers: v })} /><Money label="Bereavement Allowance" value={b.bereavement} onChange={(v) => set({ bereavement: v })} /><Money label="Other taxable benefits (SSP, SMP...)" value={b.other} onChange={(v) => set({ other: v })} /></Group>;
  }
  if (k === "otherIncome") {
    const o = ret.otherIncome || { amount: 0 }, set = (x: Partial<NonNullable<TaxReturn["otherIncome"]>>) => update((r) => ({ ...r, otherIncome: { ...o, ...x } }));
    return <Group title="Other UK income"><Text label="Description" value={o.description} onChange={(v) => set({ description: v })} /><Money label="Amount (before tax)" value={o.amount} onChange={(v) => set({ amount: v || 0 })} /><Money label="Tax taken off" value={o.taxTaken} onChange={(v) => set({ taxTaken: v })} /></Group>;
  }
  if (k === "foreign") {
    const f = ret.foreign || {}, set = (x: Partial<NonNullable<TaxReturn["foreign"]>>) => update((r) => ({ ...r, foreign: { ...f, ...x } }));
    return (<>
      <Group title="Foreign income (in sterling)"><Money label="Land and property abroad (profit)" value={f.property} onChange={(v) => set({ property: v })} /><Money label="Overseas pensions" value={f.pensions} onChange={(v) => set({ pensions: v })} /><Money label="Other overseas income" value={f.other} onChange={(v) => set({ other: v })} /><Money label="Foreign tax paid on this income" value={f.foreignTax} onChange={(v) => set({ foreignTax: v })} /></Group>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>Foreign interest and dividends go under Interest and Dividends (tick Foreign). Residence, the FIG regime and Overseas Workday Relief are not worked out here.</p>
    </>);
  }
  if (k === "gains") {
    return (<>
      <ListTable<Gain> rows={ret.gains} onChange={(list) => update((r) => ({ ...r, gains: list }))} blank={() => ({ id: newId(), description: "", kind: "shares", proceeds: 0, cost: 0 })} cols={[
        { label: "Asset", text: "description" }, { label: "Kind", select: "kind", options: [["shares", "Shares"], ["residential", "UK residential property"], ["other", "Other assets"], ["crypto", "Cryptoassets"]] },
        { label: "Date sold", date: "date" }, { label: "Proceeds", money: "proceeds" }, { label: "Cost", money: "cost" }, { label: "BADR", tick: "badr" }, { label: "Investors' Relief", tick: "ir" },
      ]} />
      <Group title="Losses"><Money label="Capital losses brought forward" value={ret.gainsLossesBf} onChange={(v) => update((r) => ({ ...r, gainsLossesBf: v }))} /></Group>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>Annual exempt amount £{R.cgt.exempt.toLocaleString("en-GB")}. Rates {Math.round(R.cgt.basic * 100)}% and {Math.round(R.cgt.higher * 100)}%{R.cgt.early ? " (10% and 20% for disposals other than residential property before 30 October 2024)" : ""}; Business Asset Disposal Relief {Math.round(R.cgt.badr * 100)}%.</p>
    </>);
  }
  if (k === "marriage") {
    return (<label className="tax-field" style={{ maxWidth: 420 }}><span>Marriage Allowance</span>
      <select className="input" value={ret.allowances.marriage || "none"} onChange={(e) => update((r) => ({ ...r, allowances: { ...r.allowances, marriage: e.target.value as "none" } }))}>
        <option value="none">Not claimed</option><option value="transfer">Transfer £{R.marriageAllowance.toLocaleString("en-GB")} to spouse or civil partner</option><option value="receive">Receive £{R.marriageAllowance.toLocaleString("en-GB")} from spouse or civil partner</option>
      </select></label>);
  }
  if (k === "blind") return <Tick label={`Registered blind: claim Blind Person's Allowance (£${R.blindAllowance.toLocaleString("en-GB")})`} value={ret.allowances.blind} onChange={(v) => update((r) => ({ ...r, allowances: { ...r.allowances, blind: v } }))} />;
  const rel = (p: Partial<TaxReturn["reliefs"]>) => update((r) => ({ ...r, reliefs: { ...r.reliefs, ...p } }));
  if (k === "pensionContributions") return (<>
    <Group title="Pension payments">
      <Money label="Paid to schemes under relief at source (net paid)" hint="basic rate band extended by the gross" value={ret.reliefs.pensionRas} onChange={(v) => rel({ pensionRas: v })} />
      <Money label="Paid gross, relief not given at source" value={ret.reliefs.pensionGross} onChange={(v) => rel({ pensionGross: v })} />
    </Group>
    <p className="muted" style={{ margin: 0, fontSize: 13 }}>Workplace pensions taken from pay before tax (net pay) are already in the P60 pay figure.</p>
  </>);
  if (k === "giftAid") return <Group title="Gift Aid"><Money label="Gift Aid payments made in the year (net)" value={ret.reliefs.giftAid} onChange={(v) => rel({ giftAid: v })} /><Money label="Of which treated as paid in the previous year" value={ret.reliefs.giftAidCarriedBack} onChange={(v) => rel({ giftAidCarriedBack: v })} /></Group>;
  if (k === "investments") return <Group title="Amounts subscribed"><Money label="EIS (30%)" value={ret.reliefs.eis} onChange={(v) => rel({ eis: v })} /><Money label="SEIS (50%)" value={ret.reliefs.seis} onChange={(v) => rel({ seis: v })} /><Money label="Venture Capital Trusts (30%)" value={ret.reliefs.vct} onChange={(v) => rel({ vct: v })} /></Group>;
  if (k === "otherReliefs") return <Group title="Other reliefs"><Money label="Qualifying loan interest" value={ret.reliefs.loanInterest} onChange={(v) => rel({ loanInterest: v })} /><Money label="Gifts of shares or land to charity" value={ret.charityGifts} onChange={(v) => update((r) => ({ ...r, charityGifts: v }))} /><Money label="Maintenance payments" hint="(only if born before 6 April 1935)" value={ret.reliefs.maintenance} onChange={(v) => rel({ maintenance: v })} /></Group>;
  if (k === "studentLoan") {
    const sl = ret.studentLoan, set = (p: Partial<TaxReturn["studentLoan"]>) => update((r) => ({ ...r, studentLoan: { ...r.studentLoan, ...p } }));
    const plans = [["plan1", "Plan 1"], ["plan2", "Plan 2"], ["plan4", "Plan 4 (Scotland)"], ["plan5", "Plan 5"]] as const;
    return (<>
      <div className="row-wrap" style={{ gap: 16 }}>{plans.map(([p, l]) => <Tick key={p} label={`${l}${R.studentLoan[p] ? ` (from £${R.studentLoan[p]!.toLocaleString("en-GB")})` : ""}`} value={sl.plans.includes(p)} onChange={(v) => set({ plans: v ? [...sl.plans, p] : sl.plans.filter((x) => x !== p) })} />)}</div>
      <Tick label={`Postgraduate loan (6% over £${R.studentLoan.postgrad.toLocaleString("en-GB")})`} value={sl.postgrad} onChange={(v) => set({ postgrad: v })} />
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>Amounts deducted by an employer go on the employment section.</p>
    </>);
  }
  if (k === "childBenefit") {
    const b = ret.childBenefit || {}, set = (p: Partial<NonNullable<TaxReturn["childBenefit"]>>) => update((r) => ({ ...r, childBenefit: { ...b, ...p } }));
    return (<>
      <Group title="Child Benefit received by the household">
        <Money label="Total Child Benefit received in the year" value={b.amount} onChange={(v) => set({ amount: v })} />
        <label className="tax-field"><span>Or: number of children</span><input className="input mono" type="number" min={0} value={b.children ?? ""} onChange={(e) => set({ children: e.target.value === "" ? undefined : Number(e.target.value) })} /></label>
        <label className="tax-field"><span>Weeks received</span><input className="input mono" type="number" min={0} max={53} value={b.weeks ?? ""} placeholder="52" onChange={(e) => set({ weeks: e.target.value === "" ? undefined : Number(e.target.value) })} /></label>
      </Group>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>The charge is {R.hicbc.per1pc === 200 ? "1% for every £200" : "1% for every £100"} of adjusted net income over £{R.hicbc.from.toLocaleString("en-GB")}. It falls on the partner with the higher income.</p>
    </>);
  }
  if (k === "winterFuel") return <Group title="Winter Fuel Payment"><Money label="Winter Fuel Payment received" value={ret.winterFuel?.amount} onChange={(v) => update((r) => ({ ...r, winterFuel: { amount: v } }))} /></Group>;
  if (k === "payments") {
    const p = ret.payments, set = (x: Partial<TaxReturn["payments"]>) => update((r) => ({ ...r, payments: { ...r.payments, ...x } }));
    return (<>
      <PaymentLines ret={ret} year={year} update={update} />
      <Group title="PAYE coding"><Money label="Earlier years' tax collected in this year's code" value={p.earlierYearInCode} onChange={(v) => set({ earlierYearInCode: v })} /><Money label="To be collected through next year's code" value={p.nextYearInCode} onChange={(v) => set({ nextYearInCode: v })} /></Group>
      <Group title="Other"><Money label="Tax paid on UK property disposal returns" value={p.propertyReturnTax} onChange={(v) => set({ propertyReturnTax: v })} /></Group>
    </>);
  }
  return <p className="muted">Nothing to enter here.</p>;
}

// ------------------------------------------------------------------ a small editable table for repeating lines

type Col<T> = { label: string; text?: keyof T; money?: keyof T; tick?: keyof T; date?: keyof T; select?: keyof T; options?: [string, string][] };
function ListTable<T extends { id: string }>({ rows, onChange, blank: make, cols }: { rows: T[]; onChange: (rows: T[]) => void; blank: () => T; cols: Col<T>[] }) {
  const set = (id: string, p: Partial<T>) => onChange(rows.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const total = (k: keyof T) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  return (
    <div className="table-wrap">
      <table className="grid lines tax-lines">
        <thead><tr>{cols.map((c) => <th key={c.label} className={c.money ? "num" : undefined}>{c.label}</th>)}<th aria-label="Remove" /></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              {cols.map((c) => (
                <td key={c.label} className={c.money ? "num" : undefined}>
                  {c.text && <input className="input cell" value={String(r[c.text] ?? "")} aria-label={c.label} onChange={(e) => set(r.id, { [c.text!]: e.target.value } as Partial<T>)} />}
                  {c.money && <CellMoney value={Number(r[c.money]) || undefined} label={c.label} onChange={(v) => set(r.id, { [c.money!]: v ?? 0 } as Partial<T>)} />}
                  {c.tick && <input type="checkbox" aria-label={c.label} checked={!!r[c.tick]} onChange={(e) => set(r.id, { [c.tick!]: e.target.checked } as Partial<T>)} />}
                  {c.date && <input className="input cell" type="date" aria-label={c.label} value={String(r[c.date] ?? "")} onChange={(e) => set(r.id, { [c.date!]: e.target.value } as Partial<T>)} />}
                  {c.select && <select className="input cell" aria-label={c.label} value={String(r[c.select] ?? "")} onChange={(e) => set(r.id, { [c.select!]: e.target.value } as Partial<T>)}>{c.options!.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>}
                </td>
              ))}
              <td><button type="button" className="deck-mini" aria-label="Remove this line" onClick={() => onChange(rows.filter((x) => x.id !== r.id))}>×</button></td>
            </tr>
          ))}
        </tbody>
        {rows.length > 1 && <tfoot><tr>{cols.map((c, i) => <td key={c.label} className={c.money ? "num mono" : undefined}>{i === 0 ? "Total" : c.money ? gbp(total(c.money)) : ""}</td>)}<td /></tr></tfoot>}
      </table>
      <button type="button" className="btn small" style={{ marginTop: 8 }} onClick={() => onChange([...rows, make()])}>+ Add a line</button>
    </div>
  );
}
function CellMoney({ value, onChange, label }: { value: number | undefined; onChange: (v: number | undefined) => void; label: string }) {
  const [t, setT] = useState(blank(value));
  useEffect(() => { if (Number(t.replace(/[£,\s]/g, "") || 0) !== (value || 0)) setT(blank(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return <input className="input cell mono money" inputMode="decimal" aria-label={label} value={t} placeholder="0.00" onChange={(e) => { setT(e.target.value); const x = e.target.value.replace(/[£,\s]/g, ""); const v = x === "" ? undefined : Number(x); if (x === "" || Number.isFinite(v)) onChange(v); }} />;
}

// ------------------------------------------------------------------ the computation on the right

function CompPanel({ comp, year, client }: { comp: Computation; year: number; client: Client }) {
  const R = ratesFor(year);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const print = () => {
    document.body.classList.add("tax-printing");
    const done = () => document.body.classList.remove("tax-printing");
    window.addEventListener("afterprint", done, { once: true });
    window.print();
  };
  return (
    <div className="tax-comp-inner">
      <div className="tax-comp-head">
        <span className="eyebrow">Tax computation {R.label}</span>
        <div className="tax-comp-due">
          <div><span>Total tax</span><strong className="mono">{gbp(comp.totalLiability)}</strong></div>
          <div className={comp.balancing < 0 ? "repay" : undefined}><span>{comp.balancing >= 0 ? "To pay 31 Jan" : "Repayment"}</span><strong className="mono">{gbp(Math.abs(comp.balancing))}</strong></div>
          <div><span>Payments on account</span><strong className="mono">{comp.poaNext ? `2 × ${gbp(comp.poaNext)}` : "None"}</strong></div>
        </div>
        <button type="button" className="btn small" onClick={print}><Icon name="print" size={14} /> Print</button>
      </div>
      <div className="tax-print-title">{client.Title}: tax computation {R.label}</div>
      {comp.blocks.map((b) => {
        const shut = open[b.title] === false;
        return (
          <section key={b.title} className="tax-block">
            <button type="button" className="tax-block-head" aria-expanded={!shut} onClick={() => setOpen({ ...open, [b.title]: shut })}><span aria-hidden="true">{shut ? "▸" : "▾"}</span> {b.title}{b.total && shut && <span className="mono" style={{ marginLeft: "auto" }}>{gbp(b.total.amount)}</span>}</button>
            {!shut && <table className="tax-comp-table"><tbody>
              {b.rows.map((r, i) => (
                <tr key={i} className={r.strong ? "strong" : r.sub ? "sub" : undefined}>
                  <td>{r.label}{r.note && <div className="muted" style={{ fontSize: 11 }}>{r.note}</div>}</td>
                  <td className="rate">{r.rate !== undefined ? `${+(r.rate * 100).toFixed(2)}%` : ""}</td>
                  <td className="num mono">{r.amount === undefined ? "" : gbp(r.amount)}</td>
                </tr>
              ))}
              {b.total && <tr className="total"><td>{b.total.label}</td><td /><td className="num mono">{gbp(b.total.amount)}</td></tr>}
            </tbody></table>}
          </section>
        );
      })}
      {comp.warnings.length > 0 && <ul className="tax-warn">{comp.warnings.map((x) => <li key={x}>{x}</li>)}</ul>}
      <p className="muted" style={{ fontSize: 11, margin: "8px 4px 0" }}>A working computation from the figures entered, using the {R.label} rates. File from IRIS Elements and compare the two.</p>
    </div>
  );
}

// ------------------------------------------------------------------ the summary: the tax due for the year, and every year's position

type YearLine = { y: number; r?: TaxReturn; cc?: Computation; due?: ReturnType<typeof outstandingPayments> };

/** The computation for the year beside every year held for the client: what was due, paid, still to pay and received back. */
function SummaryView({ client: c, year, ret, comp, update }: { client: Client; year: number; ret: TaxReturn; comp: Computation; update: (f: (r: TaxReturn) => TaxReturn) => void }) {
  const { data } = useData();
  const [ask, setAsk] = useState<Ask | null>(null);
  // puts the year's payments back to the two payments on account still to pay, and forgets what was brought in for it
  const resetPayments = () => update((r) => ({
    ...r,
    payments: { ...r.payments, lines: defaultPaymentLines(year, r.payments.expectedPoa1, r.payments.expectedPoa2), imported: [], credits: [], paidDifferent: undefined },
  }));
  const years = useMemo((): YearLine[] => [...YEARS].reverse().map(({ year: y }) => {
    if (y === year) return { y, r: ret, cc: comp, due: outstandingPayments(ret, y) };
    const row = setupRow(data.papers, c.Key, yearEnd(y), TAX_ITEM);
    if (!row) return { y };
    const r = readReturn(readSetup(row).r);
    return { y, r, cc: compute(r, y), due: outstandingPayments(r, y) };
  }), [data.papers, c.Key, year, ret, comp]);
  const credits = ret.payments.credits || [];
  const lines = paymentLines(ret, year);
  return (
    <div className="tax-split tax-split-return">
      <aside className="tax-comp hero-wash" aria-label="Tax computation"><CompPanel comp={comp} year={year} client={c} /></aside>
      <div className="tax-summary">
        <section className="card table-wrap">
          <table className="grid">
            <thead><tr><th>Tax year</th><th>Return</th><th className="num">Total tax</th><th className="num">Payments made</th><th className="num">To pay / repay</th><th className="num">Still to pay</th><th className="num">Late interest</th></tr></thead>
            <tbody>
              {years.map(({ y, r, cc, due }) => (
                <tr key={y} className={`clickable${y === year ? " selected" : ""}`} onClick={() => (window.location.hash = href("tax", c.Key, String(y)))}>
                  <td>{yearLabel(y)}</td>
                  <td>{r ? <span className={`chip${r.status?.state === "submitted" ? " green" : r.status?.state === "final" ? " blue" : ""}`}>{STATE_LABEL[r.status?.state || "draft"]}</span> : <span className="muted">Not started</span>}</td>
                  <td className="num mono">{cc ? gbp(cc.totalLiability) : "-"}</td>
                  <td className="num mono">{cc ? gbp(cc.poaPaid) : "-"}</td>
                  <td className="num mono">{cc ? (cc.balancing >= 0 ? gbp(cc.balancing) : `${gbp(-cc.balancing)} back`) : "-"}</td>
                  <td className={`num mono${due?.lines.some((l) => l.overdue) ? " red-ink" : ""}`}>{due?.lines.length ? gbp(due.total) : r ? "Nothing" : "-"}</td>
                  <td className="num mono">{cc?.lateInterest ? gbp(cc.lateInterest) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="card" style={{ padding: 16 }}>
          <div className="row-wrap" style={{ gap: 8, justifyContent: "space-between", marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>Payments for {yearLabel(year)}</h3>
            <button type="button" className="btn small danger" onClick={() => setAsk({
              title: `Reset the ${yearLabel(year)} payments?`, danger: true, yes: "Reset payments",
              body: ["This removes every payment, credit and late increase for this year, including any brought in from the HMRC account.", "The two payments on account are put back as still to pay."],
              onYes: resetPayments,
            })}>Reset payments</button>
          </div>
          <PaymentSources lines={lines} year={year} />
          <PaymentLines ret={ret} year={year} update={update} />
          {ask && <ConfirmBox ask={ask} onClose={() => setAsk(null)} />}
        </section>
        {credits.length > 0 && (
          <section className="card" style={{ padding: 16 }}>
            <h3 style={{ margin: "0 0 8px" }}>Received from HMRC for {yearLabel(year)}</h3>
            <table className="grid">
              <tbody>
                {credits.map((x) => (
                  <tr key={x.key}>
                    <td>{x.description}</td>
                    <td className="mono">{fmtDate(x.date)}</td>
                    <td className="num mono">{gbp(x.amount)}</td>
                    <td><button type="button" className="btn small" aria-label={`Remove ${x.description} on ${fmtDate(x.date)}`} onClick={() => update((r) => ({ ...r, payments: { ...r.payments, credits: (r.payments.credits || []).filter((c2) => c2.key !== x.key), imported: (r.payments.imported || []).filter((k) => k !== x.key) } }))}>Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted" style={{ margin: "8px 0 0", fontSize: 12 }}>Interest and repayments are not part of the tax.</p>
          </section>
        )}
      </div>
    </div>
  );
}
