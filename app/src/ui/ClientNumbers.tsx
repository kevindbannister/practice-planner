// Numbers for one client, read live from Xero: pick a date range, see the headline figures against
// the same period last year, and drill down from a figure to its accounts and then to the transactions.
// Internal: it's the practice's view of the business, not something the client sees.
import { useEffect, useMemo, useState } from "react";
import { Client, fmtDate, todayIso } from "../lib/domain";
import { money } from "../lib/papers";
import { LedgerLine, XeroError, r2 } from "../lib/xero";
import { Glance, Range, Txns, cached, keyOfPl, rangesFor, readGlance, readTransactions, shiftYear } from "../lib/xeroGlance";
import { typeName } from "./XeroLedger";
import { useXero, useXeroLinks } from "./XeroSettings";

type Group = "sales" | "cos" | "expense" | "other" | "net" | "cash" | "debtors" | "creditors";
type Drill = { group: Group; account?: { key: string; code: string; name: string; sign: 1 | -1; plAmount?: number; pl: boolean } };

const GROUP_LABEL: Record<Group, string> = { sales: "Sales", cos: "Cost of sales", expense: "Overheads", other: "Other income", net: "Profit and loss", cash: "Cash at the end", debtors: "Debtors at the end", creditors: "Creditors at the end" };

export function ClientNumbers({ client: c }: { client: Client }) {
  const api = useXero();
  const { tenantFor, connected } = useXeroLinks();
  const tenant = tenantFor(c.Key);
  const today = todayIso();
  const ranges = useMemo(() => rangesFor(today, c.YearEnd as string | undefined), [today, c.YearEnd]);
  const [pick, setPick] = useState("last-12");
  const [custom, setCustom] = useState({ from: "", to: today });
  const [compare, setCompare] = useState(true);
  const [drill, setDrill] = useState<Drill>();
  const [data, setData] = useState<{ cur?: Glance; prev?: Glance; error?: string; busy: boolean }>({ busy: false });
  const [txns, setTxns] = useState<{ busy: boolean; result?: Txns; error?: string }>({ busy: false });
  const [filter, setFilter] = useState("");

  const range: Range | undefined = pick === "custom" ? (custom.from && custom.to ? { key: "custom", label: "Custom", ...custom } : undefined) : ranges.find((r) => r.key === pick) || ranges[0];
  const prev = range && compare ? { from: shiftYear(range.from, -1), to: shiftYear(range.to, -1) } : undefined;
  const tenantId = tenant?.tenantId;
  const rangeFrom = range?.from, rangeTo = range?.to;
  const prevFrom = prev?.from, prevTo = prev?.to;

  useEffect(() => {
    if (!tenantId || !rangeFrom || !rangeTo || rangeFrom > rangeTo) return;
    let live = true;
    setData((d) => ({ ...d, busy: true, error: undefined }));
    const load = (from: string, to: string) => cached(`glance|${tenantId}|${from}|${to}`, () => readGlance(api, tenantId, from, to));
    Promise.all([load(rangeFrom, rangeTo), prevFrom && prevTo ? load(prevFrom, prevTo) : Promise.resolve(undefined)])
      .then(([cur, prior]) => live && setData({ cur, prev: prior, busy: false }))
      .catch((e) => live && setData({ busy: false, error: e instanceof XeroError ? e.message : "The figures couldn't be read from Xero. Try again." }));
    return () => {
      live = false;
    };
  }, [api, tenantId, rangeFrom, rangeTo, prevFrom, prevTo]);

  // transactions for the account being drilled into
  const accountKey = drill?.account?.key;
  useEffect(() => {
    if (!accountKey || !tenantId || !rangeFrom || !rangeTo || !data.cur) return;
    let live = true;
    setTxns({ busy: true });
    cached(`txn|${tenantId}|${rangeFrom}|${rangeTo}`, () => readTransactions(api, tenantId, data.cur!.accounts, rangeFrom, rangeTo))
      .then((result) => live && setTxns({ busy: false, result }))
      .catch((e) => live && setTxns({ busy: false, error: e instanceof XeroError ? e.message : "The transactions couldn't be read from Xero." }));
    return () => {
      live = false;
    };
  }, [api, accountKey, tenantId, rangeFrom, rangeTo, data.cur]);

  if (!tenant || !connected) {
    return (
      <div className="alert amber"><strong>Xero isn't linked to this client</strong><span>Connect Xero and choose this client in Settings › Xero, then the numbers appear here.</span></div>
    );
  }

  const cur = data.cur, prior = data.prev;
  const pct = (a?: number, b?: number) => (a !== undefined && b !== undefined && b !== 0 ? `${Math.round(((a - b) / Math.abs(b)) * 100)}%` : "");
  const tiles: { group: Group; label: string; value?: number; prior?: number; money?: boolean; text?: string; priorText?: string }[] = cur
    ? [
        { group: "sales", label: "Sales", value: cur.sales, prior: prior?.sales },
        { group: "cos", label: "Gross margin", text: cur.sales ? `${Math.round((cur.grossProfit / cur.sales) * 100)}%` : "–", priorText: prior?.sales ? `${Math.round((prior.grossProfit / prior.sales) * 100)}%` : undefined },
        { group: "expense", label: "Overheads", value: cur.overheads, prior: prior?.overheads },
        { group: "net", label: "Net profit", value: cur.netProfit, prior: prior?.netProfit },
        { group: "cash", label: "Cash at the end", value: cur.cash, prior: prior?.cash },
        { group: "debtors", label: "Debtors at the end", value: cur.debtors, prior: prior?.debtors },
        { group: "creditors", label: "Creditors at the end", value: cur.creditors, prior: prior?.creditors },
        { group: "debtors", label: "Debtor days", text: cur.debtorDays !== undefined ? `${cur.debtorDays}` : "–", priorText: prior?.debtorDays !== undefined ? `${prior.debtorDays}` : undefined },
      ]
    : [];

  // the accounts behind the chosen figure
  const accountsFor = (g: Group): { key: string; code: string; name: string; amount: number; prior?: number; sign: 1 | -1; pl: boolean }[] => {
    if (!cur) return [];
    const plSec: Record<string, "income" | "cos" | "other" | "expense" | undefined> = { sales: "income", cos: "cos", expense: "expense", other: "other", net: undefined, cash: undefined, debtors: undefined, creditors: undefined };
    if (g === "cash" || g === "debtors" || g === "creditors") {
      return cur.balances.filter((b) => b.group === g).map((b) => ({ key: b.key, code: b.code, name: b.name, amount: b.amount, prior: prior?.balances.find((x) => x.key === b.key)?.amount, sign: 1, pl: false }));
    }
    const sec = plSec[g];
    const rows = g === "net" ? cur.pl.rows : cur.pl.rows.filter((r) => r.section === sec);
    return rows.map((r) => {
      const key = keyOfPl(r.code, r.name);
      const pr = prior?.pl.rows.find((x) => x.code === r.code && x.name === r.name);
      const sign: 1 | -1 = r.section === "income" || r.section === "other" ? -1 : 1;
      return { key, code: r.code, name: r.name, amount: r.amounts[0] || 0, prior: pr?.amounts[0], sign, pl: true };
    });
  };

  const detail = drill && cur ? accountsFor(drill.group) : [];
  const trendMax = cur ? Math.max(1, ...cur.trend.map((t) => Math.max(Math.abs(t.sales), Math.abs(t.profit)))) : 1;

  return (
    <div className="stack" style={{ gap: 14 }} aria-label="Numbers from Xero">
      <div className="row-wrap" style={{ gap: 10, alignItems: "flex-end", justifyContent: "space-between" }}>
        <div className="row-wrap" style={{ gap: 10, alignItems: "flex-end" }}>
          <label className="stack" style={{ gap: 4, fontSize: 13 }}>
            <span className="muted">Period</span>
            <select className="input" value={pick} onChange={(e) => { setPick(e.target.value); setDrill(undefined); }} style={{ width: "auto" }}>
              {ranges.map((r) => <option key={r.key} value={r.key}>{r.label}{r.from ? ` (${fmtDate(r.from, { year: false })} to ${fmtDate(r.to, { year: false })})` : ""}</option>)}
              <option value="custom">Custom dates</option>
            </select>
          </label>
          {pick === "custom" && (
            <>
              <label className="stack" style={{ gap: 4, fontSize: 13 }}><span className="muted">From</span><input className="input" type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} style={{ width: "auto" }} /></label>
              <label className="stack" style={{ gap: 4, fontSize: 13 }}><span className="muted">To</span><input className="input" type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} style={{ width: "auto" }} /></label>
            </>
          )}
          <label className="row-wrap" style={{ gap: 6, fontSize: 13 }}>
            <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} /> Compare with the same period last year
          </label>
        </div>
        <span className="muted" style={{ fontSize: 13 }}>
          {data.busy ? "Reading from Xero…" : cur ? `Read from Xero ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} · kept for 15 minutes` : ""}
        </span>
      </div>

      {data.error && <div className="alert red"><strong>Couldn't read the figures</strong><span>{data.error}</span></div>}
      {!range && <p className="muted">Pick both dates to see the figures.</p>}

      {cur && (
        <>
          <div className="ov-three" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 10 }}>
            {tiles.map((t) => {
              const active = drill?.group === t.group && !drill.account;
              const shown = t.text ?? money(t.value ?? 0);
              const change = t.value !== undefined ? pct(t.value, t.prior) : "";
              return (
                <button key={t.label} type="button" className="card pad" aria-pressed={active} onClick={() => setDrill(active ? undefined : { group: t.group })}
                  style={{ textAlign: "left", cursor: "pointer", outline: active ? "2px solid var(--blue)" : "none", padding: "12px 14px" }}>
                  <span className="muted" style={{ fontSize: 13, display: "block" }}>{t.label}</span>
                  <strong className="mono" style={{ fontSize: 20 }}>{shown}</strong>
                  {compare && (t.prior !== undefined || t.priorText) && (
                    <span className="muted" style={{ display: "block", fontSize: 13 }}>
                      Last year {t.priorText ?? money(t.prior ?? 0)}{change ? ` · ${change}` : ""}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {cur.trend.length > 1 && (
            <div className="card pad stack" style={{ gap: 6 }} aria-label="Monthly sales and profit">
              <strong style={{ fontSize: 15 }}>By month: sales (blue) and net profit (teal)</strong>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 140, borderBottom: "1px solid var(--line)" }}>
                {cur.trend.map((t) => (
                  <div key={t.label} title={`${t.label}: sales ${money(t.sales)}, profit ${money(t.profit)}`} style={{ flex: "1 1 0", minWidth: 0, display: "flex", gap: 2, alignItems: "flex-end", height: "100%" }}>
                    <div style={{ flex: 1, height: `${(Math.max(0, t.sales) / trendMax) * 100}%`, background: "var(--blue)", borderRadius: "3px 3px 0 0", minHeight: 1 }} />
                    <div style={{ flex: 1, height: `${(Math.max(0, t.profit) / trendMax) * 100}%`, background: "#14a9bd", borderRadius: "3px 3px 0 0", minHeight: 1 }} />
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 6, fontSize: 11, color: "var(--muted)" }}>
                {cur.trend.map((t) => <span key={t.label} style={{ flex: "1 1 0", minWidth: 0, textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.label.slice(3)}</span>)}
              </div>
            </div>
          )}

          {drill && !drill.account && (
            <div className="card pad stack" style={{ gap: 6 }} aria-label={`${GROUP_LABEL[drill.group]} by account`}>
              <strong style={{ fontSize: 15 }}>{GROUP_LABEL[drill.group]} by account</strong>
              {detail.length === 0 ? <p className="muted" style={{ margin: 0 }}>Nothing in this period.</p> : (
                <table className="grid">
                  <thead><tr><th scope="col">Account</th><th scope="col" className="num">{pick === "custom" ? "Amount" : range?.label}</th>{compare && <th scope="col" className="num">Last year</th>}<th scope="col"><span className="sr-only">Transactions</span></th></tr></thead>
                  <tbody>
                    {detail.map((a) => (
                      <tr key={a.key}>
                        <td><span className="mono muted" style={{ marginRight: 6 }}>{a.code}</span>{a.name}</td>
                        <td className="num mono">{money(r2(a.amount * (a.pl ? a.sign : 1))) || "0.00"}</td>
                        {compare && <td className="num mono muted">{a.prior !== undefined ? money(r2(a.prior * (a.pl ? a.sign : 1))) || "0.00" : "–"}</td>}
                        <td style={{ textAlign: "right" }}><button type="button" className="linkbtn" onClick={() => { setFilter(""); setDrill({ group: drill.group, account: { key: a.key, code: a.code, name: a.name, sign: a.sign, plAmount: a.amount, pl: a.pl } }); }}>Transactions</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {drill?.account && (
            <Transactions acct={drill.account} txns={txns} filter={filter} setFilter={setFilter} onBack={() => setDrill({ group: drill.group })} period={range?.label || "the period"} />
          )}
        </>
      )}
    </div>
  );
}

function Transactions({ acct, txns, filter, setFilter, onBack, period }: { acct: NonNullable<Drill["account"]>; txns: { busy: boolean; result?: Txns; error?: string }; filter: string; setFilter: (s: string) => void; onBack: () => void; period: string }) {
  const lines: LedgerLine[] = useMemo(() => (txns.result ? txns.result.lines.filter((l) => l.a === acct.key) : []), [txns.result, acct.key]);
  const q = filter.trim().toLowerCase();
  const shown = useMemo(() => (q ? lines.filter((l) => [l.c, l.r, l.x, typeName(l.t), l.d, l.amt.toFixed(2)].some((v) => String(v || "").toLowerCase().includes(q))) : lines), [lines, q]);
  // a profit and loss account: the transactions, signed as the report shows them, should give the report's figure
  const signed = r2(lines.reduce((a, l) => a + l.amt * acct.sign, 0));
  const diff = acct.pl && acct.plAmount !== undefined ? r2((acct.plAmount ?? 0) - signed) : undefined;
  const running = (() => {
    let run = 0;
    return shown.map((l) => { run = r2(run + l.amt); return run; });
  })();
  return (
    <div className="card pad stack" style={{ gap: 8 }} aria-label={`Transactions in ${acct.name}`}>
      <div className="row-wrap" style={{ justifyContent: "space-between", gap: 10 }}>
        <div>
          <button type="button" className="linkbtn" onClick={onBack} style={{ fontSize: 13 }}>← Back</button>
          <strong style={{ fontSize: 15, marginLeft: 10 }}>{acct.code ? `${acct.code} · ` : ""}{acct.name}</strong>
          <span className="muted" style={{ fontSize: 13, marginLeft: 8 }}>{period}</span>
        </div>
        <input className="input" style={{ maxWidth: 240, minHeight: 32 }} placeholder="Find a transaction" aria-label="Find a transaction" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      {txns.busy && <p className="muted" style={{ margin: 0 }}>Reading the transactions from Xero…</p>}
      {txns.error && <div className="alert red"><strong>Couldn't read the transactions</strong><span>{txns.error}</span></div>}
      {txns.result && (
        <>
          {txns.result.gaps.length > 0 && (
            <div className="alert amber"><strong>Some transactions are missing</strong><span>Xero wouldn't let this connection read {txns.result.gaps.join(", ")}. {txns.result.why}</span></div>
          )}
          <div className="table-wrap ledger-wrap">
            <table className="grid lines ledger-table">
              <thead><tr><th scope="col">Date</th><th scope="col">Type</th><th scope="col">Contact</th><th scope="col">Reference</th><th scope="col">Description</th><th scope="col" className="num">Amount</th><th scope="col" className="num">Running</th></tr></thead>
              <tbody>
                {shown.map((l, i) => (
                  <tr key={`${l.j ?? ""}-${i}`}>
                    <td>{fmtDate(l.d, { year: false })}</td><td>{typeName(l.t)}</td><td>{l.c}</td><td>{l.r || ""}</td><td>{l.x}</td>
                    <td className="num mono">{money(r2(l.amt * (acct.pl ? acct.sign : 1)))}</td>
                    <td className="num mono muted">{q ? "" : money(r2(running[i] * (acct.pl ? acct.sign : 1)))}</td>
                  </tr>
                ))}
                {!shown.length && <tr><td colSpan={7} className="muted">{q ? "Nothing matches." : "No transactions in this period."}</td></tr>}
              </tbody>
              <tfoot>
                <tr className="lead-sub"><td colSpan={5}>{shown.length} transaction{shown.length === 1 ? "" : "s"}{q ? " found" : " in total"}</td><td className="num mono">{money(r2(shown.reduce((a, l) => a + l.amt * (acct.pl ? acct.sign : 1), 0))) || "0.00"}</td><td /></tr>
                {acct.pl && acct.plAmount !== undefined && !q && (
                  <>
                    <tr><td colSpan={5}>Per the profit and loss report</td><td className="num mono">{money(acct.plAmount) || "0.00"}</td><td /></tr>
                    <tr><td colSpan={5}>Difference</td><td className={`num mono ${diff ? "diff-bad" : "diff-ok"}`}>{diff ? money(diff) : "✔"}</td><td /></tr>
                  </>
                )}
              </tfoot>
            </table>
          </div>
          {diff ? (
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              The difference is usually something Xero posts itself, such as depreciation, payroll postings, currency revaluations or conversion balances, which the documents don't include.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
