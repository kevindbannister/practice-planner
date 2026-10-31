// The nominal ledger from Xero, behind each trial balance account in the schedules: every
// transaction in the year with a running balance, checked to the trial balance. Bank accounts also
// show Xero's bank summary and the items not reconciled at the year end.
import { useEffect, useMemo, useState } from "react";
import { money } from "../lib/papers";
import { LedgerLine, XeroBook, ledgerCheck, r2 } from "../lib/xero";
import { PayrollMonth, ReturnLine, controlMovement, filterLines, groupLines, GroupBy, payeRecon, vatRecon } from "../lib/xeroViews";
import { useData } from "./data";

export type BookMeta = { file?: string; at?: string; source?: string; tenantName?: string; lines?: number };

const cache = new Map<string, Promise<XeroBook>>();

/** The year's Xero ledger, if one has been imported (read from OneDrive once, then kept). */
export function useXeroBook(meta: BookMeta | undefined): { book?: XeroBook; error?: string } {
  const { store } = useData();
  const [state, setState] = useState<{ book?: XeroBook; error?: string }>({});
  const id = meta?.file ? `${meta.file}@${meta.at}` : "";
  useEffect(() => {
    if (!id || !meta?.file) {
      setState({});
      return;
    }
    let live = true;
    let p = cache.get(id);
    if (!p) {
      p = store.graph.download(meta.file).then((bytes) => JSON.parse(new TextDecoder().decode(bytes)) as XeroBook);
      cache.set(id, p);
      p.catch(() => cache.delete(id));
    }
    p.then((book) => live && setState({ book }), () => live && setState({ error: "The Xero ledger file couldn't be opened from OneDrive. Import from Xero again." }));
    return () => {
      live = false;
    };
  }, [id, store, meta?.file]);
  return state;
}

/** Put a freshly imported book in the cache so it shows without a download. */
export function primeBook(meta: BookMeta, book: XeroBook) {
  if (meta.file) cache.set(`${meta.file}@${meta.at}`, Promise.resolve(book));
}

/** The ledger account for a trial balance account: same code and name, or the only account with that code. */
export function bookKeyFor(book: XeroBook, key: string, code: string): string | undefined {
  if (book.accounts.some((a) => a.key === key) || book.lines.some((l) => l.a === key) || key in book.closing) return key;
  const c = code.trim().toLowerCase();
  if (!c) return undefined;
  const same = book.accounts.filter((a) => a.code.toLowerCase() === c);
  return same.length === 1 ? same[0].key : undefined;
}

const TYPES: Record<string, string> = {
  ACCREC: "Sales invoice", ACCPAY: "Bill", ACCRECCREDIT: "Credit note", ACCPAYCREDIT: "Supplier credit", ACCRECPAYMENT: "Receipt", ACCPAYPAYMENT: "Payment",
  ARCREDITPAYMENT: "Refund paid", APCREDITPAYMENT: "Refund received", SPEND: "Spend money", RECEIVE: "Receive money", MANJOURNAL: "Manual journal",
  TRANSFER: "Transfer", PAYRUN: "Pay run", CONVERSION: "Conversion balance", "RECEIVE-OVERPAYMENT": "Overpayment", "SPEND-OVERPAYMENT": "Overpayment",
  "RECEIVE-PREPAYMENT": "Prepayment", "SPEND-PREPAYMENT": "Prepayment",
};
export const typeName = (t?: string) => (t ? TYPES[t] || t.toLowerCase().replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "");
const fmtD = (d: string) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" }) : "");
const LIMIT = 250;

/** What the schedules can tell a ledger about its account, so it can offer the views that fit. */
export type LedgerExtras = { kind?: "debtors" | "creditors" | "vat" | "paye"; stagger?: number[]; vat?: ReturnLine[]; payroll?: PayrollMonth[] };
type Tab = "list" | "summary" | "control" | "recon";

export function LedgerTable({ book, accountKey, name, normal, extras = {} }: { book: XeroBook; accountKey: string; name: string; normal: "dr" | "cr"; extras?: LedgerExtras }) {
  const [q, setQ] = useState("");
  const [typeF, setTypeF] = useState("");
  const [contactF, setContactF] = useState("");
  const [tab, setTab] = useState<Tab>("list");
  const [by, setBy] = useState<GroupBy>("month");
  const [all, setAll] = useState(false);
  const check = useMemo(() => ledgerCheck(book).get(accountKey), [book, accountKey]);
  const lines = useMemo(() => book.lines.filter((l) => l.a === accountKey), [book, accountKey]);
  const shown = useMemo(() => filterLines(lines, { q, type: typeF, contact: contactF }, typeName), [lines, q, typeF, contactF]);
  const filtered = !!(q.trim() || typeF || contactF);
  const types = useMemo(() => [...new Set(lines.map((l) => l.t || ""))].filter(Boolean).sort((a, b) => (typeName(a) < typeName(b) ? -1 : 1)), [lines]);
  const contacts = useMemo(() => [...new Set(lines.map((l) => l.c || ""))].filter(Boolean).sort((a, b) => a.localeCompare(b)), [lines]);
  const tabs: [Tab, string][] = [["list", "Transactions"], ["summary", "Summary"], ...(extras.kind === "debtors" || extras.kind === "creditors" ? [["control", "Control account"] as [Tab, string]] : []), ...(extras.kind === "vat" || extras.kind === "paye" ? [["recon", extras.kind === "vat" ? "VAT reconciliation" : "PAYE reconciliation"] as [Tab, string]] : [])];
  const opening = check?.opening ?? 0;
  const rows = useMemo(() => {
    let run = opening;
    return shown.map((l) => ({ l, run: (run = r2(run + l.amt)) }));
  }, [shown, opening]);
  const sign = (n: number) => (normal === "cr" ? -n : n);
  const bank = book.bank.find((b) => b.key === accountKey);
  const unrec = book.unreconciled.filter((u) => u.a === accountKey);
  const visible = all ? rows : rows.slice(0, LIMIT);
  const totalDr = r2(shown.reduce((a, l) => a + (l.amt > 0 ? l.amt : 0), 0)), totalCr = r2(shown.reduce((a, l) => a + (l.amt < 0 ? -l.amt : 0), 0));

  return (
    <div className="stack ledger" style={{ gap: 8 }} aria-label={`Transactions in ${name}`}>
      <div className="row-wrap" style={{ gap: 8, justifyContent: "space-between" }}>
        <strong style={{ fontSize: 13 }}>
          {lines.length} transaction{lines.length === 1 ? "" : "s"} in {name} from Xero{book.source === "rebuilt" ? " (rebuilt from documents)" : ""}
        </strong>
        {tab === "list" && lines.length > 8 && <input className="input" style={{ maxWidth: 240, minHeight: 32 }} placeholder="Find a transaction" aria-label={`Find a transaction in ${name}`} value={q} onChange={(e) => setQ(e.target.value)} />}
      </div>
      <div className="seg ledger-tabs" role="group" aria-label="How to look at this account">
        {tabs.map(([k, label]) => <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}>{label}</button>)}
      </div>
      {tab === "list" && lines.length > 8 && (
        <div className="row-wrap ledger-filters" style={{ gap: 8 }}>
          <select className="input" aria-label="Show only one type" value={typeF} onChange={(e) => setTypeF(e.target.value)}><option value="">All types</option>{types.map((t) => <option key={t} value={t}>{typeName(t)}</option>)}</select>
          <select className="input" aria-label="Show only one contact" value={contactF} onChange={(e) => setContactF(e.target.value)}><option value="">All contacts</option>{contacts.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          {filtered && <button type="button" className="linkbtn" onClick={() => { setQ(""); setTypeF(""); setContactF(""); }}>Clear filters</button>}
        </div>
      )}
      {tab === "summary" && <SummaryView lines={lines} by={by} setBy={setBy} sign={sign} onPick={(kind, v) => { if (kind === "contact") { setContactF(v); setTab("list"); } else if (kind === "type") { setTypeF(v); setTab("list"); } else { setQ(v); setTab("list"); } }} />}
      {tab === "control" && (extras.kind === "debtors" || extras.kind === "creditors") && <ControlView lines={lines} kind={extras.kind} opening={opening} closing={check?.closing ?? 0} hasTb={!!check} rebuilt={book.source === "rebuilt"} />}
      {tab === "recon" && extras.kind === "vat" && <VatView book={book} lines={lines} opening={opening} accountKey={accountKey} extras={extras} />}
      {tab === "recon" && extras.kind === "paye" && <PayeView book={book} lines={lines} opening={opening} closing={check?.closing ?? 0} extras={extras} />}
      {tab === "list" && <>
      {bank && (
        <div className="ledger-bank row-wrap" style={{ gap: 16, fontSize: 13 }}>
          <span>Bank summary:</span>
          <span>Opening <strong className="mono">{money(bank.opening)}</strong></span>
          <span>Received <strong className="mono">{money(bank.received)}</strong></span>
          <span>Spent <strong className="mono">{money(bank.spent)}</strong></span>
          <span>Closing <strong className="mono">{money(bank.closing)}</strong></span>
        </div>
      )}
      <div className="table-wrap ledger-wrap">
        <table className="grid lines ledger-table">
          <thead>
            <tr><th scope="col">Date</th><th scope="col">Type</th><th scope="col">Contact</th><th scope="col">Reference</th><th scope="col" className="wide">Description</th><th scope="col" className="num">Debit</th><th scope="col" className="num">Credit</th><th scope="col" className="num">Balance</th></tr>
          </thead>
          <tbody>
            {!filtered && (
              <tr className="ledger-open"><td colSpan={7}>{opening ? "Brought forward" : "Opening balance"}</td><td className="num mono">{money(sign(opening)) || "0.00"}</td></tr>
            )}
            {visible.map(({ l, run }, i) => <LedgerRow key={`${l.j ?? ""}-${i}`} l={l} run={filtered ? undefined : sign(run)} />)}
            {!all && rows.length > LIMIT && (
              <tr><td colSpan={8}><button type="button" className="linkbtn" onClick={() => setAll(true)}>Show all {rows.length} transactions</button></td></tr>
            )}
            {!shown.length && <tr><td colSpan={8} className="muted">{filtered ? "Nothing matches." : "No transactions in the year."}</td></tr>}
          </tbody>
          <tfoot>
            <tr className="lead-sub"><td colSpan={5}>{filtered ? `Total of the ${shown.length} found` : "Total for the year"}</td><td className="num mono">{money(totalDr) || "–"}</td><td className="num mono">{money(totalCr) || "–"}</td><td /></tr>
            {!filtered && check && (
              <>
                <tr><td colSpan={7}>Closing balance per the ledger</td><td className="num mono">{money(sign(r2(opening + check.movement))) || "0.00"}</td></tr>
                <tr><td colSpan={7}>Per the trial balance from Xero</td><td className="num mono">{money(sign(check.closing)) || "0.00"}</td></tr>
                <tr><td colSpan={7}>Difference</td><td className={`num mono ${check.diff ? "diff-bad" : "diff-ok"}`}>{check.diff ? money(sign(check.diff)) : "✔"}</td></tr>
              </>
            )}
          </tfoot>
        </table>
      </div>
      {check && check.diff !== 0 && (
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          {book.source === "rebuilt"
            ? "The ledger was rebuilt from Xero's documents, which leaves out payroll postings, fixed asset depreciation, currency revaluations and conversion balances. The difference is likely one of those."
            : "The transactions don't reach the trial balance figure. Check for entries dated outside the year, or import again."}
        </p>
      )}
      {unrec.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <strong style={{ fontSize: 13 }}>Not reconciled at the year end ({unrec.length})</strong>
          <div className="table-wrap">
            <table className="grid lines ledger-table">
              <thead><tr><th scope="col">Date</th><th scope="col">Type</th><th scope="col">Contact</th><th scope="col">Reference</th><th scope="col" className="num">Money in</th><th scope="col" className="num">Money out</th></tr></thead>
              <tbody>
                {unrec.map((u, i) => (
                  <tr key={i}><td>{fmtD(u.d)}</td><td>{typeName(u.t)}</td><td>{u.c}</td><td>{u.r || u.x}</td><td className="num mono">{u.amt > 0 ? money(u.amt) : ""}</td><td className="num mono">{u.amt < 0 ? money(-u.amt) : ""}</td></tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="lead-sub"><td colSpan={4}>Total</td><td className="num mono">{money(r2(unrec.reduce((a, u) => a + (u.amt > 0 ? u.amt : 0), 0))) || "–"}</td><td className="num mono">{money(r2(unrec.reduce((a, u) => a + (u.amt < 0 ? -u.amt : 0), 0))) || "–"}</td></tr>
              </tfoot>
            </table>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>Balance per the bank statement = balance per Xero, less money in and plus money out not yet on the statement. These are items Xero still shows as unreconciled today.</p>
        </div>
      )}
      </>}
    </div>
  );
}

function LedgerRow({ l, run }: { l: LedgerLine; run?: number }) {
  return (
    <tr>
      <td style={{ whiteSpace: "nowrap" }}>{fmtD(l.d)}</td>
      <td style={{ whiteSpace: "nowrap" }}>{typeName(l.t)}</td>
      <td>{l.c}</td>
      <td>{l.r}</td>
      <td>{l.x}{l.tax ? <span className="muted" style={{ fontSize: 11 }}> · VAT {money(Math.abs(l.tax))}</span> : null}</td>
      <td className="num mono">{l.amt > 0 ? money(l.amt) : ""}</td>
      <td className="num mono">{l.amt < 0 ? money(-l.amt) : ""}</td>
      <td className="num mono muted">{run === undefined ? "" : money(run) || "0.00"}</td>
    </tr>
  );
}

// ------------------------------------------------------------------ other ways of looking at an account

const DIFF = (n: number) => <td className={`num mono ${n ? "diff-bad" : "diff-ok"}`}>{n ? money(n) : "✔"}</td>;

function SummaryView({ lines, by, setBy, sign, onPick }: { lines: LedgerLine[]; by: GroupBy; setBy: (b: GroupBy) => void; sign: (n: number) => number; onPick: (kind: GroupBy, value: string) => void }) {
  const groups = useMemo(() => groupLines(lines, by, typeName), [lines, by]);
  const dr = r2(groups.reduce((a, g) => a + g.dr, 0)), cr = r2(groups.reduce((a, g) => a + g.cr, 0));
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row-wrap" style={{ gap: 8, fontSize: 13 }}>
        <span>Group by</span>
        <div className="seg" role="group" aria-label="Group by">
          {([["month", "Month"], ["contact", "Contact"], ["type", "Type"]] as [GroupBy, string][]).map(([k, label]) => <button key={k} type="button" aria-pressed={by === k} onClick={() => setBy(k)}>{label}</button>)}
        </div>
        {by !== "month" && <span className="muted">Click a line to see its transactions.</span>}
      </div>
      <div className="table-wrap ledger-wrap">
        <table className="grid lines ledger-table">
          <thead><tr><th scope="col">{by === "month" ? "Month" : by === "contact" ? "Contact" : "Type"}</th><th scope="col" className="num">Transactions</th><th scope="col" className="num">Debit</th><th scope="col" className="num">Credit</th><th scope="col" className="num">Movement</th></tr></thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.key}>
                <td>{by === "month" ? g.label : <button type="button" className="linkbtn" onClick={() => onPick(by, by === "type" ? g.key : g.label === "(no contact)" ? "" : g.label)}>{g.label}</button>}</td>
                <td className="num mono">{g.count}</td><td className="num mono">{money(g.dr) || "–"}</td><td className="num mono">{money(g.cr) || "–"}</td><td className="num mono">{money(sign(g.net)) || "0.00"}</td>
              </tr>
            ))}
            {!groups.length && <tr><td colSpan={5} className="muted">No transactions in the year.</td></tr>}
          </tbody>
          <tfoot><tr className="lead-sub"><td>Total</td><td className="num mono">{groups.reduce((a, g) => a + g.count, 0)}</td><td className="num mono">{money(dr) || "–"}</td><td className="num mono">{money(cr) || "–"}</td><td className="num mono">{money(sign(r2(dr - cr))) || "0.00"}</td></tr></tfoot>
        </table>
      </div>
    </div>
  );
}

function ControlView({ lines, kind, opening, closing, hasTb, rebuilt }: { lines: LedgerLine[]; kind: "debtors" | "creditors"; opening: number; closing: number; hasTb: boolean; rebuilt: boolean }) {
  const r = useMemo(() => controlMovement(lines, kind, opening, closing), [lines, kind, opening, closing]);
  const sign = kind === "creditors" ? -1 : 1;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="table-wrap ledger-wrap">
        <table className="grid lines ledger-table">
          <thead><tr><th scope="col">{kind === "debtors" ? "Debtors control account" : "Creditors control account"}: the year's movement</th><th scope="col" className="num">Entries</th><th scope="col" className="num">Amount</th></tr></thead>
          <tbody>
            {r.rows.map((x) => (
              <tr key={x.label} className={x.strong ? "lead-sub" : undefined}><td>{x.label}</td><td className="num mono muted">{x.count || ""}</td><td className="num mono">{money(x.amount) || "0.00"}</td></tr>
            ))}
          </tbody>
          {hasTb && (
            <tfoot>
              <tr><td colSpan={2}>Per the trial balance from Xero</td><td className="num mono">{money(sign * closing) || "0.00"}</td></tr>
              <tr><td colSpan={2}>Difference</td>{DIFF(r.difference)}</tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>
        {kind === "debtors" ? "Amounts owed by customers." : "Amounts owed to suppliers."} The customers or suppliers behind the closing balance are in the {kind === "debtors" ? "Trade debtors" : "Trade creditors"} listing.
        {rebuilt && r.difference ? " The ledger was rebuilt from Xero's documents, so a difference can be a journal posted straight to this account." : ""}
      </p>
    </div>
  );
}

function VatView({ book, lines, opening, accountKey, extras }: { book: XeroBook; lines: LedgerLine[]; opening: number; accountKey: string; extras: LedgerExtras }) {
  const r = useMemo(() => vatRecon(lines, accountKey, book.from, book.to, extras.stagger || [3, 6, 9, 12], extras.vat || [], opening), [lines, accountKey, book.from, book.to, extras.stagger, extras.vat, opening]);
  const has = !!(extras.vat && extras.vat.length);
  const cell = (n?: number) => <td className="num mono">{n === undefined ? "–" : money(n) || "0.00"}</td>;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="table-wrap ledger-wrap">
        <table className="grid lines ledger-table">
          <thead>
            <tr><th scope="col" rowSpan={2}>Quarter</th><th scope="colgroup" colSpan={4} className="num">Per the ledger</th>{has && <><th scope="colgroup" colSpan={3} className="num">Per the VAT return schedule</th><th scope="colgroup" colSpan={3} className="num">Difference</th></>}<th scope="col" rowSpan={2} className="num">Owed at the end</th></tr>
            <tr><th scope="col" className="num">Output</th><th scope="col" className="num">Input</th><th scope="col" className="num">Paid</th><th scope="col" className="num">Other</th>{has && <><th scope="col" className="num">Output</th><th scope="col" className="num">Input</th><th scope="col" className="num">Paid</th><th scope="col" className="num">Output</th><th scope="col" className="num">Input</th><th scope="col" className="num">Paid</th></>}</tr>
          </thead>
          <tbody>
            <tr className="ledger-open"><td colSpan={has ? 11 : 5}>Owed at the start of the year</td><td className="num mono">{money(r.owedStart) || "0.00"}</td></tr>
            {r.rows.map((x) => (
              <tr key={x.label}>
                <td>{x.label}</td>{cell(x.ledger.out)}{cell(x.ledger.inp)}{cell(x.ledger.paid)}{cell(x.ledger.other)}
                {has && <>{cell(x.ret?.out)}{cell(x.ret?.inp)}{cell(x.ret?.paid)}{x.diff ? <>{DIFF(x.diff.out)}{DIFF(x.diff.inp)}{DIFF(x.diff.paid)}</> : <><td /><td /><td /></>}</>}
                <td className="num mono">{money(x.owedEnd) || "0.00"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>
        Owed is a credit balance on the VAT account (positive here); a negative figure is VAT due back from HMRC. "Other" is journals and anything else on the account.
        {has ? "" : " No VAT return schedule has been filled in for this year, so there is nothing to compare with yet: import VAT by quarter from Xero or type the returns in."}
      </p>
    </div>
  );
}

function PayeView({ book, lines, opening, closing, extras }: { book: XeroBook; lines: LedgerLine[]; opening: number; closing: number; extras: LedgerExtras }) {
  const r = useMemo(() => payeRecon(lines, book.from, book.to, extras.payroll || [], opening), [lines, book.from, book.to, extras.payroll, opening]);
  const has = !!(extras.payroll && extras.payroll.length);
  const last = r.rows[r.rows.length - 1];
  // a ledger rebuilt from documents has no payroll postings, so its own balance means nothing: compare the payroll basis with the trial balance instead
  const posted = r.rows.reduce((a, x) => a + x.posted, 0) > 0;
  const showLedger = posted || book.source !== "rebuilt";
  const tbOwed = r2(-closing);
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="table-wrap ledger-wrap">
        <table className="grid lines ledger-table">
          <thead><tr><th scope="col">Month</th><th scope="col" className="num">Due per payroll</th>{showLedger && <th scope="col" className="num">Posted in the ledger</th>}<th scope="col" className="num">Paid to HMRC</th><th scope="col" className="num">Owed per payroll</th>{showLedger && <><th scope="col" className="num">Owed per ledger</th><th scope="col" className="num">Difference</th></>}</tr></thead>
          <tbody>
            <tr className="ledger-open"><td colSpan={showLedger ? 4 : 3}>Owed at the start of the year</td><td className="num mono">{money(r.owedStart) || "0.00"}</td>{showLedger && <><td className="num mono">{money(r.owedStart) || "0.00"}</td><td /></>}</tr>
            {r.rows.map((x) => (
              <tr key={x.month}><td>{x.label}</td><td className="num mono">{money(x.due) || "–"}</td>{showLedger && <td className="num mono">{money(x.posted) || "–"}</td>}<td className="num mono">{money(x.paid) || "–"}</td><td className="num mono">{money(x.owedPayroll) || "0.00"}</td>{showLedger && <><td className="num mono">{money(x.owedLedger) || "0.00"}</td>{DIFF(x.diff)}</>}</tr>
            ))}
          </tbody>
          {last && has && (
            <tfoot>
              <tr><td colSpan={showLedger ? 4 : 3}>Owed at the year end per payroll</td><td className="num mono">{money(last.owedPayroll) || "0.00"}</td>{showLedger && <><td className="num mono">{money(last.owedLedger) || "0.00"}</td><td /></>}</tr>
              <tr><td colSpan={showLedger ? 4 : 3}>Per the trial balance from Xero</td><td className="num mono">{money(tbOwed) || "0.00"}</td>{showLedger && <><td className="num mono">{money(tbOwed) || "0.00"}</td><td /></>}</tr>
              <tr><td colSpan={showLedger ? 4 : 3}>Difference</td>{DIFF(r2(last.owedPayroll - tbOwed))}{showLedger && <>{DIFF(r2(last.owedLedger - tbOwed))}<td /></>}</tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>
        Due is PAYE, employee NI and employer NI from the Wages records for the month's pay; payments to HMRC usually fall in the month after, so compare the running balances.
        {has ? "" : " There are no Wages records for this year yet: import payroll from Xero to fill in what's due."}
        {!showLedger ? " The ledger was rebuilt from documents, so it has no payroll postings; the payroll figures are compared with the trial balance instead." : ""}
      </p>
    </div>
  );
}
