// The nominal ledger from Xero, behind each trial balance account in the schedules: every
// transaction in the year with a running balance, checked to the trial balance. Bank accounts also
// show Xero's bank summary and the items not reconciled at the year end.
import { useEffect, useMemo, useState } from "react";
import { money } from "../lib/papers";
import { LedgerLine, XeroBook, ledgerCheck, r2 } from "../lib/xero";
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

export function LedgerTable({ book, accountKey, name, normal }: { book: XeroBook; accountKey: string; name: string; normal: "dr" | "cr" }) {
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  const check = useMemo(() => ledgerCheck(book).get(accountKey), [book, accountKey]);
  const lines = useMemo(() => book.lines.filter((l) => l.a === accountKey), [book, accountKey]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? lines.filter((l) => [l.c, l.r, l.x, typeName(l.t), l.d, money(l.amt)].some((v) => String(v || "").toLowerCase().includes(s))) : lines;
  }, [lines, q]);
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
        {lines.length > 8 && <input className="input" style={{ maxWidth: 240, minHeight: 32 }} placeholder="Find a transaction" aria-label={`Find a transaction in ${name}`} value={q} onChange={(e) => setQ(e.target.value)} />}
      </div>
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
            {!q && (
              <tr className="ledger-open"><td colSpan={7}>{opening ? "Brought forward" : "Opening balance"}</td><td className="num mono">{money(sign(opening)) || "0.00"}</td></tr>
            )}
            {visible.map(({ l, run }, i) => <LedgerRow key={`${l.j ?? ""}-${i}`} l={l} run={q ? undefined : sign(run)} />)}
            {!all && rows.length > LIMIT && (
              <tr><td colSpan={8}><button type="button" className="linkbtn" onClick={() => setAll(true)}>Show all {rows.length} transactions</button></td></tr>
            )}
            {!shown.length && <tr><td colSpan={8} className="muted">{q ? "Nothing matches." : "No transactions in the year."}</td></tr>}
          </tbody>
          <tfoot>
            <tr className="lead-sub"><td colSpan={5}>{q ? `Total of the ${shown.length} found` : "Total for the year"}</td><td className="num mono">{money(totalDr) || "–"}</td><td className="num mono">{money(totalCr) || "–"}</td><td /></tr>
            {!q && check && (
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
