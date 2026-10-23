// Opening balances: the position at the start of the year. They flow from last year's working papers;
// for a company's first set, last year's trial balance from the accounting software is read in (from a
// spreadsheet or CSV, or pasted) and kept as last year's trial balance.
import { useMemo, useRef, useState } from "react";
import { Client } from "../lib/domain";
import { OpeningAcct, RollForward, TbImportLine, isProfitAndLoss, parseTbRows, rollForward, statutoryDest } from "../lib/openingBalances";
import { money, priorPeriod, setupOf } from "../lib/papers";
import { newKey } from "../lib/planning";
import { Row } from "../lib/schema";
import { parseCsvRows } from "../lib/bankStatement";
import { DESTS, DEST_BY_KEY, guessDest, mapTb, paperAccounts } from "../lib/tbMap";
import { readXlsx } from "../lib/xlsxRead";
import { useData } from "./data";
import { useChart, useWriterState } from "./PaperSchedules";

const dmy = (d: string) => d.split("-").reverse().join("/");

/** Last year's closing position rolled forward as this year's opening balances (undefined if there's no trial balance for last year). */
export function useOpeningBalances(client: Client, period: string): (RollForward & { prior: string; custom: boolean; derived: OpeningAcct[] }) | undefined {
  const { data } = useData();
  const chart = useChart();
  const prior = priorPeriod(period);
  return useMemo(() => {
    const rows = paperAccounts(data.paperLines, client.Key, prior);
    const custom = setupOf(data.papers, client.Key, period, "openbal/main").custom;
    if (!rows.length && !Array.isArray(custom)) return undefined;
    const maps = rows.length ? mapTb(rows, { lines: data.paperLines, papers: data.papers }, client.Key, prior, chart) : [];
    const rolled = rollForward(maps);
    // accounts you've changed by hand replace the figures worked out from last year
    const accounts = Array.isArray(custom) ? (custom as OpeningAcct[]) : rolled.accounts;
    return { ...rolled, accounts, prior, custom: Array.isArray(custom), derived: rolled.accounts };
  }, [data.paperLines, data.papers, chart, client.Key, period, prior]);
}

export type { OpeningAcct };

export function OpeningBalances({ client, period }: { client: Client; period: string }) {
  const { data, createMany, removeMany } = useData();
  const w = useWriterState();
  const opening = useOpeningBalances(client, period);
  const file = useRef<HTMLInputElement>(null);
  const prior = priorPeriod(period);
  const [plan, setPlan] = useState<{ lines: TbImportLine[]; problems: string[]; name: string }>();
  const [paste, setPaste] = useState("");
  const [pasting, setPasting] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();
  const old = data.paperLines.filter((r) => r.ClientKey === client.Key && r.PeriodEnd === prior && r.SectionKey === "tb" && (r.SubKey || "main") === "main");
  const info = w.setup("openbal/main") as { from?: string; at?: string };

  const read = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    setError(undefined);
    setDone(undefined);
    try {
      let rows: string[][];
      if (/\.csv$|\.txt$/i.test(f.name)) rows = parseCsvRows(await f.text());
      else {
        const book = await readXlsx(new Uint8Array(await f.arrayBuffer()));
        const sheet = book.sheet(book.names[0]);
        if (!sheet) throw new Error("empty");
        rows = [];
        for (let r = 1; r <= sheet.maxRow; r++) rows.push(Array.from({ length: 8 }, (_, c) => sheet.text(r, c + 1)));
      }
      const p = parseTbRows(rows);
      if (!p.lines.length) setError(p.problems[0]);
      else { setPlan({ ...p, name: f.name }); setConfirm(false); }
    } catch {
      setError("That file couldn't be read. It needs to be an Excel workbook (.xlsx) or a CSV with the accounts' names and their debit and credit balances.");
    } finally {
      if (file.current) file.current.value = "";
    }
  };
  const readPaste = () => {
    setError(undefined);
    const p = parseTbRows(paste.split(/\r?\n/).filter((l) => l.trim()).map((l) => (l.includes("\t") ? l.split("\t") : parseCsvRows(l)[0] || [])));
    if (!p.lines.length) setError(p.problems[0]);
    else { setPlan({ ...p, name: "pasted" }); setConfirm(false); }
  };

  const save = async () => {
    if (!plan) return;
    setBusy(true);
    setError(undefined);
    try {
      const now = new Date().toISOString();
      const rows: Row[] = plan.lines.map((l, i) => {
        const d = statutoryDest(l.Detail);
        const f = Object.fromEntries(Object.entries({ dr: l.dr || undefined, cr: l.cr || undefined, dest: d?.dest, iris: d?.iris }).filter(([, v]) => v !== undefined));
        return { Key: newKey("PL"), ClientKey: client.Key, PeriodEnd: prior, SectionKey: "tb", SubKey: "main", Code: l.Code || undefined, Detail: l.Detail, Figures: JSON.stringify(f), Seq: i + 1, Updated: now };
      });
      if (old.length) await removeMany("PaperLines", old);
      await createMany("PaperLines", rows);
      await w.writeSetup("openbal/main", { from: plan.name, at: now });
      setDone(`Saved ${rows.length} accounts as the trial balance for the year to ${dmy(prior)}. The opening balances below come from it.`);
      setPlan(undefined);
    } catch {
      setError("Not everything saved. Try again; saving replaces what it put in.");
    } finally {
      setBusy(false);
    }
  };

  const destOptions = DESTS.filter((d) => d.key !== "ignore" && !isProfitAndLoss(d.key));
  const saveRows = (next: OpeningAcct[]) => w.writeSetup("openbal/main", { custom: next.filter((a) => a.Detail.trim() || a.balance) });
  const accounts = opening?.accounts || [];
  const change = (i: number, patch: Partial<OpeningAcct>) => void saveRows(accounts.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const amount = (raw: string) => { const n = Number(raw.replace(/[£,\s]/g, "")); return Number.isFinite(n) ? Math.round(Math.abs(n) * 100) / 100 : 0; };
  const where = (a: { dest: string }) => DEST_BY_KEY.get(a.dest)?.label || a.dest;
  const diffOf = (lines: TbImportLine[]) => Math.round(lines.reduce((a, l) => a + l.dr - l.cr, 0) * 100) / 100;

  return (
    <div className="stack" style={{ gap: 14 }}>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        The opening balances are last year's closing balance sheet, with last year's profit and loss and dividends added to reserves. After the first year they flow from the previous working papers. For a first set, read in last year's trial balance from the accounting software.
      </p>

      <div className="stack" style={{ gap: 8 }}>
        <strong style={{ fontSize: 14 }}>{old.length ? `Trial balance for the year to ${dmy(prior)}` : `Last year's trial balance (year to ${dmy(prior)})`}</strong>
        {old.length > 0 && <span className="muted" style={{ fontSize: 13 }}>{old.length} accounts{info.from ? ` from ${info.from}` : " in last year's working papers"}. Reading in another replaces them.</span>}
        <div className="row-wrap" style={{ gap: 10 }}>
          <input ref={file} type="file" accept=".xlsx,.csv,.txt" aria-label="Last year's trial balance file" disabled={busy} onChange={(e) => void read(e.target.files)} />
          <button type="button" className="linkbtn" onClick={() => setPasting((x) => !x)}>{pasting ? "Hide paste box" : "Paste it instead"}</button>
        </div>
        {pasting && (
          <div className="stack" style={{ gap: 6 }}>
            <textarea className="input" rows={6} aria-label="Paste the trial balance" placeholder={"Name\tDebit\tCredit\nTurnover - Sales\t\t49738\n…"} value={paste} onChange={(e) => setPaste(e.target.value)} />
            <div><button type="button" className="btn small" disabled={!paste.trim()} onClick={readPaste}>Read it</button></div>
          </div>
        )}
        {error && <p className="error-text" role="alert" style={{ margin: 0 }}>{error}</p>}
        {done && <p className="muted" role="status" style={{ margin: 0 }}>{done}</p>}
      </div>

      {plan && (
        <div className="stack" style={{ gap: 8 }}>
          <strong style={{ fontSize: 14 }}>Read from {plan.name}: {plan.lines.length} accounts</strong>
          <table className="bank-table">
            <thead><tr><th>Account</th><th>Goes to</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
            <tbody>
              {plan.lines.map((l, i) => {
                const d = statutoryDest(l.Detail)?.dest || guessDest(l.Detail, "", l.dr - l.cr);
                return <tr key={i}><td>{l.Detail}</td><td className="muted">{DEST_BY_KEY.get(d)?.label || d}</td><td className="num">{l.dr ? money(l.dr) : ""}</td><td className="num">{l.cr ? money(l.cr) : ""}</td></tr>;
              })}
            </tbody>
            <tfoot><tr><td colSpan={2}>Total</td><td className="num">{money(plan.lines.reduce((a, l) => a + l.dr, 0))}</td><td className="num">{money(plan.lines.reduce((a, l) => a + l.cr, 0))}</td></tr></tfoot>
          </table>
          {plan.problems.length > 0 && <ul className="import-list warn">{plan.problems.map((x) => <li key={x}>{x}</li>)}</ul>}
          {diffOf(plan.lines) === 0 && <p className="muted" style={{ margin: 0, fontSize: 13 }}>✓ Debits equal credits.</p>}
          <div className="row-wrap">
            {!confirm ? (
              <button type="button" className="btn primary" disabled={busy} onClick={() => (old.length ? setConfirm(true) : void save())}>Save as last year's trial balance</button>
            ) : (
              <span className="row-wrap" style={{ gap: 8 }} role="alert">
                <span>This replaces the {old.length} accounts already there.</span>
                <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>Replace them</button>
                <button type="button" className="btn" onClick={() => setConfirm(false)}>Cancel</button>
              </span>
            )}
            <button type="button" className="btn" disabled={busy} onClick={() => setPlan(undefined)}>Cancel</button>
          </div>
        </div>
      )}

      {opening ? (
        <div className="stack" style={{ gap: 6 }}>
          <strong style={{ fontSize: 14 }}>Opening balances for the year to {dmy(period)}</strong>
          <table className="bank-table">
            <thead><tr><th>Account</th><th>Goes to</th><th className="num">Debit</th><th className="num">Credit</th><th /></tr></thead>
            <tbody>
              {accounts.map((a, i) => (
                <tr key={`${i}|${a.Detail}|${a.balance}|${a.dest}`}>
                  <td><input className="input" style={{ width: "100%", minWidth: 200 }} aria-label={`Account ${i + 1} name`} defaultValue={a.Detail} onBlur={(e) => e.target.value !== a.Detail && change(i, { Detail: e.target.value })} /></td>
                  <td>
                    <select className="input" aria-label={`Where ${a.Detail} goes`} value={a.dest} onChange={(e) => change(i, { dest: e.target.value })}>
                      {!destOptions.some((d) => d.key === a.dest) && <option value={a.dest}>{where(a)}</option>}
                      {destOptions.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
                    </select>
                  </td>
                  <td className="num"><input className="input" style={{ width: 110, textAlign: "right" }} inputMode="decimal" aria-label={`${a.Detail} debit`} defaultValue={a.balance > 0 ? a.balance.toFixed(2) : ""} onBlur={(e) => { const v = amount(e.target.value); if (v > 0 && v !== a.balance) change(i, { balance: v }); else if (v === 0 && a.balance > 0) change(i, { balance: 0 }); }} /></td>
                  <td className="num"><input className="input" style={{ width: 110, textAlign: "right" }} inputMode="decimal" aria-label={`${a.Detail} credit`} defaultValue={a.balance < 0 ? (-a.balance).toFixed(2) : ""} onBlur={(e) => { const v = amount(e.target.value); if (v > 0 && -v !== a.balance) change(i, { balance: -v }); else if (v === 0 && a.balance < 0) change(i, { balance: 0 }); }} /></td>
                  <td><button type="button" className="linkbtn" aria-label={`Remove ${a.Detail}`} onClick={() => void saveRows(accounts.filter((_, j) => j !== i))}>Remove</button></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={2}>Total</td><td className="num">{money(accounts.reduce((a, x) => a + Math.max(0, x.balance), 0))}</td><td className="num">{money(-accounts.reduce((a, x) => a + Math.min(0, x.balance), 0))}</td><td /></tr>
            </tfoot>
          </table>
          <div className="row-wrap" style={{ gap: 10 }}>
            <button type="button" className="btn small" onClick={() => void saveRows([...accounts, { Code: "", Detail: "New account", balance: 0, iris: "", dest: "debtors/other" }])}>Add an account</button>
            {opening.custom && <button type="button" className="btn small" onClick={() => void w.writeSetup("openbal/main", { custom: undefined })}>Go back to last year's figures</button>}
            {opening.custom && <span className="muted" style={{ fontSize: 12 }}>Changed by hand: these no longer follow last year's trial balance.</span>}
          </div>
          <ul className="import-list">
            <li>Last year's result: {opening.result >= 0 ? "profit" : "loss"} of {money(Math.abs(opening.result))} after tax, dividends of {money(opening.dividends)}. Together they {opening.toReserves >= 0 ? "added" : "took"} {money(Math.abs(opening.toReserves))} {opening.toReserves >= 0 ? "to" : "from"} reserves.</li>
            {Math.abs(accounts.reduce((a, x) => a + x.balance, 0)) > 0.004 && <li style={{ color: "var(--red-ink)" }}>The opening balances don't balance: they're out by {money(Math.abs(accounts.reduce((a, x) => a + x.balance, 0)))}.</li>}
          </ul>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>Change an account's name, where it goes or its balance, add one, or remove one. Edits are saved as you leave each box. These balances are used when the Accounts working papers create this year's trial balance.</p>
        </div>
      ) : (
        <p className="muted" style={{ margin: 0 }}>No trial balance for last year yet, so there are no opening balances. Read one in above.</p>
      )}
    </div>
  );
}
