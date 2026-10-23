// Accounts working papers: for clients whose records are manual. A bank statement goes in (PDF or
// CSV); every transaction is listed with a category (rules first, then AI, then you), and the year's
// trial balance is created from them. Three tabs: Reconciliation, Receipts and Payments.
import { useMemo, useRef, useState } from "react";
import { AiError } from "../lib/ai";
import { CATEGORIES, CATEGORY_BY_KEY, Txn, buildPapers, finish, merchantKey, parseCsv, parseLines, sortTxns } from "../lib/bankStatement";
import type { Sorted, Statement } from "../lib/bankStatement";
import { Client } from "../lib/domain";
import { Line, linesFor, money, priorPeriod, setupKey, setupOf } from "../lib/papers";
import { pdfLines } from "../lib/pdfText";
import { newKey } from "../lib/planning";
import { Row } from "../lib/schema";
import { useData } from "./data";
import { downloadFile, useAi } from "./commsKit";
import { useWriterState } from "./PaperSchedules";

const SEC = "accwp", SUB = "main", KEY = setupKey(SEC, SUB);
const dmy = (d?: string) => (d ? d.split("-").reverse().join("/") : "");
const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (s: string) => Number(s.replace(/[£,\s]/g, ""));
type Tab = "rec" | "in" | "out";
type Tx = Txn & { line: Line; cat: string; how: string; why: string };

/** A saved line as a transaction. */
function txOf(l: Line): Tx {
  return {
    line: l, date: String(l.f.date || ""), detail: l.Detail, amount: l.Amount || 0, balance: typeof l.f.balance === "number" ? l.f.balance : undefined,
    type: l.f.type ? String(l.f.type) : undefined, bankCategory: l.f.bank ? String(l.f.bank) : undefined, row: l.Seq, cat: l.Code, how: String(l.f.how || ""), why: l.Remark,
  };
}

export function AccountsWorkingPapers({ client, period }: { client: Client; period: string }) {
  const { data, createMany, removeMany, updateMany } = useData();
  const w = useWriterState();
  const ai = useAi();
  const file = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<Tab>("rec");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<string>();
  const [note, setNote] = useState<string>();
  const [consent, setConsent] = useState(false);
  const [append, setAppend] = useState(false);
  const [confirmTb, setConfirmTb] = useState(false);
  const [onlyOpen, setOnlyOpen] = useState(false);

  const lines = linesFor(data.paperLines, client.Key, period, SEC, SUB);
  const txs: Tx[] = useMemo(() => lines.map(txOf), [lines]);
  const s = w.setup(KEY) as { bankName?: string; opening?: number; closing?: number; openBal?: string; files?: string; problems?: string[]; from?: string; to?: string };
  const prior = setupOf(data.papers, client.Key, priorPeriod(period), KEY) as { rules?: Record<string, string> };
  const rules = { ...(prior.rules || {}), ...((s as { rules?: Record<string, string> }).rules || {}) };
  const tbLines = data.paperLines.filter((r) => r.ClientKey === client.Key && r.PeriodEnd === period && r.SectionKey === "tb" && (r.SubKey || "main") === "main");
  const bankName = s.bankName || "Bank current account";
  const start = (() => { const d = new Date(Date.parse(`${priorPeriod(period)}T00:00:00Z`) + 864e5); return d.toISOString().slice(0, 10); })();

  const receipts = txs.filter((t) => t.amount > 0), payments = txs.filter((t) => t.amount < 0);
  const sum = (l: Tx[]) => r2(l.reduce((a, t) => a + t.amount, 0));
  const unsorted = txs.filter((t) => !t.cat || t.cat === "suspense");
  const openingStmt = typeof s.opening === "number" ? s.opening : undefined;
  const openingUsed = s.openBal !== undefined && s.openBal !== "" && Number.isFinite(num(s.openBal)) ? num(s.openBal) : openingStmt;
  const closingBooks = r2((openingUsed ?? 0) + sum(txs));
  const closingStmt = typeof s.closing === "number" ? s.closing : undefined;
  const diff = closingStmt === undefined ? undefined : r2(closingBooks - closingStmt);
  const built = useMemo(() => buildPapers(txs.map((t) => ({ ...t, cat: t.cat || undefined })) as Sorted[], openingUsed, bankName), [txs, openingUsed, bankName]);
  const outside = txs.filter((t) => t.date < start || t.date > period).length;

  const byCat = useMemo(() => {
    const m = new Map<string, { n: number; in: number; out: number }>();
    for (const t of txs) {
      const k = t.cat || "";
      const e = m.get(k) || { n: 0, in: 0, out: 0 };
      e.n++;
      if (t.amount > 0) e.in = r2(e.in + t.amount); else e.out = r2(e.out - t.amount);
      m.set(k, e);
    }
    return [...m.entries()].sort((a, b) => Number(a[0] === "") - Number(b[0] === "") || b[1].in + b[1].out - (a[1].in + a[1].out));
  }, [txs]);

  // ---------------------------------------------------------------- reading a statement
  const readFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(undefined);
    setNote(undefined);
    setBusy("Reading the statement…");
    try {
      const parts: Statement[] = [];
      for (const f of Array.from(files)) {
        if (/\.pdf$/i.test(f.name) || f.type === "application/pdf") parts.push(parseLines(await pdfLines(new Uint8Array(await f.arrayBuffer()))));
        else if (/\.(csv|txt)$/i.test(f.name)) parts.push(parseCsv(await f.text()));
        else throw new Error(`${f.name} isn't a PDF or CSV.`);
      }
      parts.sort((a, b) => (a.from || "").localeCompare(b.from || ""));
      const problems: string[] = parts.flatMap((p, i) => p.problems.map((x) => (parts.length > 1 ? `${Array.from(files)[i]?.name}: ${x}` : x)));
      for (let i = 1; i < parts.length; i++) if (parts[i].from && parts[i - 1].to && parts[i].from! <= parts[i - 1].to!) problems.push("Two of the files cover some of the same dates: transactions may be counted twice.");
      const fresh: Txn[] = parts.flatMap((p) => p.txns);
      if (!fresh.length) { setError(problems[0] || "No transactions found in that file."); return; }
      const all = append ? [...txs.map(({ line: _l, cat: _c, how: _h, why: _w, ...t }) => t as Txn), ...fresh] : fresh;
      const st = parts.length === 1 && !append ? parts[0] : finish(all, []);
      const merged = parts.length === 1 && !append ? parts[0] : { ...st, problems: [...problems.filter((x) => !/balance doesn't follow/.test(x)), ...st.problems] };
      await save(merged, Array.from(files).map((f) => f.name).join(", "));
    } catch (e) {
      setError(e instanceof Error ? e.message : "That file couldn't be read.");
    } finally {
      setBusy("");
      if (file.current) file.current.value = "";
    }
  };

  const save = async (st: Statement, names: string) => {
    setBusy("Saving…");
    const now = new Date().toISOString();
    const prev = new Map(txs.map((t) => [`${t.date}|${t.amount}|${t.detail}`, t]));
    const sortedTx = sortTxns(st.txns, rules);
    const rows: Row[] = sortedTx.map((t, i) => {
      const old = append ? prev.get(`${t.date}|${t.amount}|${t.detail}`) : undefined;
      const cat = old?.cat || t.cat || "";
      const how = old?.how || (t.cat ? (rules[merchantKey(t.detail)] === t.cat ? "saved" : "rule") : "");
      return {
        Key: newKey("PL"), ClientKey: client.Key, PeriodEnd: period, SectionKey: SEC, SubKey: SUB, Code: cat || undefined, Detail: t.detail || "(no description)", Amount: t.amount,
        Remark: old?.why || undefined, Seq: i + 1, Updated: now,
        Figures: JSON.stringify(Object.fromEntries(Object.entries({ date: t.date, balance: t.balance, type: t.type, bank: t.bankCategory, how }).filter(([, v]) => v !== undefined && v !== ""))),
      };
    });
    if (lines.length) await removeMany("PaperLines", lines.map((l) => l.row));
    await createMany("PaperLines", rows);
    const files = append && s.files ? `${s.files}, ${names}` : names;
    await w.writeSetup(KEY, { opening: st.opening, closing: st.closing, from: st.from, to: st.to, problems: st.problems, files, openBal: append ? s.openBal : "" });
    await w.writeSetup("info/main", { software: "Bank statements (manual records)" });
    setNote(`${rows.length} transactions read from ${names}.`);
    setTab("rec");
  };

  // ---------------------------------------------------------------- categories
  const setCats = async (changes: { t: Tx; cat: string; how: string; why?: string }[]) => {
    if (!changes.length) return;
    const now = new Date().toISOString();
    await updateMany("PaperLines", changes.map(({ t, cat, how, why }) => ({
      row: t.line.row,
      patch: { Code: cat || undefined, Remark: why ?? (how === "you" ? undefined : t.why || undefined), Figures: JSON.stringify({ ...t.line.f, how }), Updated: now },
    })));
  };
  const pick = async (t: Tx, cat: string) => {
    await setCats([{ t, cat, how: "you" }]);
    // remembered for this client's later statements, if every payment to them has been put the same way
    const k = merchantKey(t.detail);
    const same = txs.filter((x) => merchantKey(x.detail) === k && Math.sign(x.amount) === Math.sign(t.amount));
    if (cat && same.every((x) => x === t || x.cat === cat)) await w.writeSetup(KEY, { rules: { ...rules, [k]: cat } });
  };
  const sameAs = async (t: Tx) => {
    const k = merchantKey(t.detail);
    await setCats(txs.filter((x) => x !== t && merchantKey(x.detail) === k && Math.sign(x.amount) === Math.sign(t.amount) && x.cat !== t.cat).map((x) => ({ t: x, cat: t.cat, how: "you" })));
    if (t.cat) await w.writeSetup(KEY, { rules: { ...rules, [k]: t.cat } });
  };

  const askAi = async () => {
    const todo = unsorted;
    if (!todo.length) return;
    setBusy("Asking the AI to categorise…");
    setError(undefined);
    try {
      const groups = new Map<string, Tx[]>();
      for (const t of todo) groups.set(`${merchantKey(t.detail)}|${Math.sign(t.amount)}`, [...(groups.get(`${merchantKey(t.detail)}|${Math.sign(t.amount)}`) || []), t]);
      const items = [...groups.entries()].map(([id, l]) => ({ id, detail: l[0].detail, type: l[0].type, bankCategory: l[0].bankCategory, amount: l[0].amount }));
      const changes: { t: Tx; cat: string; how: string; why?: string }[] = [];
      for (let i = 0; i < items.length; i += 60) {
        const r = await ai.bank({ company: client.Title, categories: CATEGORIES.map((c) => ({ key: c.key, name: c.name, hint: c.hint })), items: items.slice(i, i + 60) });
        for (const v of r.items) for (const t of groups.get(v.id) || []) changes.push({ t, cat: v.cat, how: "ai", why: v.why });
      }
      await setCats(changes);
      setNote(`The AI categorised ${changes.length} transaction${changes.length === 1 ? "" : "s"}. Check them, then create the trial balance.`);
    } catch (e) {
      setError(e instanceof AiError ? e.message : "The AI couldn't categorise those. Try again.");
    } finally {
      setBusy("");
    }
  };

  // ---------------------------------------------------------------- the trial balance
  const createTb = async () => {
    setBusy("Creating the trial balance…");
    setError(undefined);
    try {
      const now = new Date().toISOString();
      const rows: Row[] = built.tb.map((l, i) => ({
        Key: newKey("PL"), ClientKey: client.Key, PeriodEnd: period, SectionKey: "tb", SubKey: "main", Code: l.Code, Detail: l.Detail, Seq: i + 1, Updated: now,
        Figures: JSON.stringify(Object.fromEntries(Object.entries(l.f).filter(([, v]) => v !== undefined && v !== 0 && v !== ""))),
      }));
      if (tbLines.length) await removeMany("PaperLines", tbLines);
      await createMany("PaperLines", rows);
      await w.writeSetup(KEY, { tbAt: now, rules });
      setConfirmTb(false);
      setNote(`Trial balance created: ${rows.length} accounts from ${txs.length} transactions. Open "Year end trial balance" to map it into the schedules.`);
    } catch {
      setError("The trial balance didn't save. Try again; creating it replaces what it put in.");
    } finally {
      setBusy("");
    }
  };

  const csv = () => {
    const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const out = ["Date,Description,Type,Receipt,Payment,Category"].concat(txs.map((t) => [t.date, q(t.detail), q(t.type), t.amount > 0 ? t.amount.toFixed(2) : "", t.amount < 0 ? (-t.amount).toFixed(2) : "", q(CATEGORY_BY_KEY.get(t.cat)?.name || "")].join(",")));
    downloadFile(new TextEncoder().encode(out.join("\r\n")), `${client.Title} bank transactions ${period}.csv`, "text/csv");
  };

  // ---------------------------------------------------------------- the three tabs
  const catSelect = (t: Tx) => (
    <select className="input" aria-label={`Category for ${t.detail} on ${dmy(t.date)}`} value={t.cat} onChange={(e) => void pick(t, e.target.value)} disabled={!!busy}>
      <option value="">Choose…</option>
      {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
    </select>
  );

  const list = (items: Tx[], paid: boolean) => {
    const shown = onlyOpen ? items.filter((t) => !t.cat || t.cat === "suspense") : items;
    if (!items.length) return <p className="muted" style={{ margin: 0 }}>No {paid ? "payments" : "receipts"} yet. Import a bank statement on the Reconciliation tab.</p>;
    return (
      <div className="stack" style={{ gap: 8 }}>
        <div className="row-wrap" style={{ justifyContent: "space-between" }}>
          <span><strong>{items.length}</strong> {paid ? "payments" : "receipts"}, total <strong>{money(Math.abs(sum(items)))}</strong></span>
          <label className="row-wrap" style={{ gap: 6, fontSize: 13 }}><input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />Only ones to sort ({items.filter((t) => !t.cat || t.cat === "suspense").length})</label>
        </div>
        <div className="table-wrap">
          <table className="bank-table">
            <thead><tr><th>Date</th><th>Description</th><th className="num">{paid ? "Paid out" : "Received"}</th><th>Category</th><th /></tr></thead>
            <tbody>
              {shown.map((t) => (
                <tr key={t.line.Key} className={!t.cat || t.cat === "suspense" ? "needs" : ""}>
                  <td className="mono" style={{ whiteSpace: "nowrap" }}>{dmy(t.date)}</td>
                  <td>{t.detail}{t.bankCategory ? <span className="muted" style={{ fontSize: 11 }}> · bank says {t.bankCategory}</span> : null}</td>
                  <td className="num">{money(Math.abs(t.amount))}</td>
                  <td>
                    {catSelect(t)}
                    {t.how === "ai" && <span className="chip" title={t.why || "Suggested by the AI"}>AI</span>}
                    {t.how === "saved" && <span className="chip" title="From an earlier statement for this client">remembered</span>}
                  </td>
                  <td>{t.cat && t.how === "you" && txs.some((x) => x !== t && merchantKey(x.detail) === merchantKey(t.detail) && Math.sign(x.amount) === Math.sign(t.amount) && x.cat !== t.cat) && <button type="button" className="linkbtn" onClick={() => void sameAs(t)}>Same for all {merchantKey(t.detail)}</button>}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={2}>Total{onlyOpen ? " (all, not just those shown)" : ""}</td><td className="num">{money(Math.abs(sum(items)))}</td><td colSpan={2} /></tr></tfoot>
          </table>
        </div>
      </div>
    );
  };

  const reconciliation = (
    <div className="stack" style={{ gap: 14 }}>
      <div className="stack" style={{ gap: 8 }}>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Drop in the bank statement or a transaction export (a PDF from the bank's app or website, or a CSV). It's read in your browser and checked against the running balance. Nothing is sent anywhere until you ask the AI to categorise. Scanned or photographed statements can't be read yet.
        </p>
        <div className="row-wrap" style={{ gap: 12 }}>
          <input ref={file} type="file" accept=".pdf,.csv,.txt,application/pdf,text/csv" multiple disabled={!!busy} aria-label="Bank statement file" onChange={(e) => void readFiles(e.target.files)} />
          {txs.length > 0 && (
            <span className="row-wrap" style={{ gap: 12, fontSize: 13 }}>
              <label className="row-wrap" style={{ gap: 4 }}><input type="radio" name="bank-mode" checked={!append} onChange={() => setAppend(false)} />Replace what's here</label>
              <label className="row-wrap" style={{ gap: 4 }}><input type="radio" name="bank-mode" checked={append} onChange={() => setAppend(true)} />Add to it (another statement)</label>
            </span>
          )}
        </div>
      </div>
      {busy && <p className="muted" role="status" style={{ margin: 0 }}>{busy}</p>}
      {error && <p className="error-text" role="alert" style={{ margin: 0 }}>{error}</p>}
      {note && <p className="muted" role="status" style={{ margin: 0 }}>{note}</p>}

      {txs.length > 0 && (
        <>
          <div className="stack" style={{ gap: 6 }}>
            <strong style={{ fontSize: 14 }}>Bank reconciliation</strong>
            <div className="row-wrap" style={{ gap: 12, fontSize: 13 }}>
              <label className="row-wrap" style={{ gap: 6 }}>Bank account
                <input className="input" style={{ width: 220 }} defaultValue={bankName} aria-label="Bank account name" onBlur={(e) => e.target.value !== bankName && void w.writeSetup(KEY, { bankName: e.target.value })} />
              </label>
              <span className="muted">{s.files}</span>
            </div>
            <table className="bank-table rec-table">
              <tbody>
                <tr>
                  <td>Balance at the start{openingStmt !== undefined && s.openBal ? <span className="muted" style={{ fontSize: 11 }}> (statement says {money(openingStmt)})</span> : null}</td>
                  <td className="num"><input className="input" style={{ width: 120, textAlign: "right" }} inputMode="decimal" aria-label="Balance at the start" placeholder={openingStmt !== undefined ? openingStmt.toFixed(2) : "0.00"} defaultValue={s.openBal || ""} onBlur={(e) => e.target.value !== (s.openBal || "") && void w.writeSetup(KEY, { openBal: e.target.value })} /></td>
                </tr>
                <tr><td>Receipts ({receipts.length})</td><td className="num">{money(sum(receipts))}</td></tr>
                <tr><td>Payments ({payments.length})</td><td className="num">{money(sum(payments))}</td></tr>
                <tr className="total"><td>Balance at the end, per the transactions</td><td className="num">{money(closingBooks)}</td></tr>
                <tr><td>Balance at the end, per the statement</td><td className="num">{closingStmt !== undefined ? money(closingStmt) : "not shown"}</td></tr>
                <tr className={diff === undefined || diff === 0 ? "" : "needs"}><td>Difference</td><td className="num">{diff === undefined ? "–" : money(diff) || "0.00"}</td></tr>
              </tbody>
            </table>
            {(s.problems || []).length === 0 && txs.some((t) => t.balance !== undefined) && diff === 0 && <p className="muted" style={{ margin: 0, fontSize: 13 }}>✓ Every balance follows from the one before, and the transactions agree to the closing balance.</p>}
            <ul className="import-list warn">
              {(s.problems || []).map((x) => <li key={x}>{x}</li>)}
              {diff !== undefined && diff !== 0 && <li>The transactions don't agree to the closing balance by {money(Math.abs(diff))}. Check the balance at the start, or whether a statement is missing.</li>}
              {outside > 0 && <li>{outside} transaction{outside === 1 ? " is" : "s are"} outside the year {dmy(start)} to {dmy(period)}. They're included here; remove them from the file if they shouldn't be.</li>}
            </ul>
          </div>

          <div className="stack" style={{ gap: 6 }}>
            <div className="row-wrap" style={{ justifyContent: "space-between" }}>
              <strong style={{ fontSize: 14 }}>Categories{unsorted.length ? ` · ${unsorted.length} to sort` : " · all sorted"}</strong>
              {unsorted.length > 0 && (
                <span className="row-wrap" style={{ gap: 8 }}>
                  <label className="row-wrap" style={{ gap: 6, fontSize: 12 }}>
                    <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                    OK to send descriptions and amounts (no account details) to OpenAI
                  </label>
                  <button type="button" className="btn small" disabled={!consent || !!busy} onClick={() => void askAi()}>Ask the AI to categorise {unsorted.length}</button>
                </span>
              )}
            </div>
            <table className="bank-table">
              <thead><tr><th>Category</th><th className="num">Transactions</th><th className="num">Receipts</th><th className="num">Payments</th></tr></thead>
              <tbody>
                {byCat.map(([k, e]) => (
                  <tr key={k || "none"} className={!k || k === "suspense" ? "needs" : ""}>
                    <td>{k ? CATEGORY_BY_KEY.get(k)?.name || k : "Not sorted yet"}</td><td className="num">{e.n}</td><td className="num">{e.in ? money(e.in) : ""}</td><td className="num">{e.out ? money(e.out) : ""}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td>Total</td><td className="num">{txs.length}</td><td className="num">{money(sum(receipts))}</td><td className="num">{money(-sum(payments))}</td></tr></tfoot>
            </table>
          </div>

          <div className="stack" style={{ gap: 6 }}>
            <strong style={{ fontSize: 14 }}>Trial balance created from these</strong>
            <table className="bank-table">
              <thead><tr><th>Account</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
              <tbody>
                {built.tb.map((l) => <tr key={l.Code}><td>{l.Detail}</td><td className="num">{l.f.dr ? money(l.f.dr) : ""}</td><td className="num">{l.f.cr ? money(l.f.cr) : ""}</td></tr>)}
              </tbody>
            </table>
            <ul className="import-list warn">
              {built.balancingFigure !== 0 && <li>"Opening position" of {money(Math.abs(built.balancingFigure))} is a balancing figure: it makes the trial balance agree. Replace it with last year's balance sheet figures when you have them.</li>}
              {built.uncategorised > 0 && <li>{built.uncategorised} transaction{built.uncategorised === 1 ? " is" : "s are"} not categorised yet and sit in "Unknown / query for client".</li>}
              <li>This is a cash-basis trial balance: no debtors, creditors, accruals, VAT split, depreciation or tax. Those come from journals and the schedules.</li>
            </ul>
            <div className="row-wrap">
              {!confirmTb ? (
                <button type="button" className="btn primary" disabled={!!busy} onClick={() => (tbLines.length ? setConfirmTb(true) : void createTb())}>Create the trial balance</button>
              ) : (
                <span className="row-wrap" style={{ gap: 8 }} role="alert">
                  <span>This replaces the {tbLines.length} lines in "Year end trial balance".</span>
                  <button type="button" className="btn primary" disabled={!!busy} onClick={() => void createTb()}>Replace them</button>
                  <button type="button" className="btn" onClick={() => setConfirmTb(false)}>Cancel</button>
                </span>
              )}
              <button type="button" className="btn" disabled={!!busy} onClick={csv}>Download transactions (CSV)</button>
            </div>
          </div>
        </>
      )}
    </div>
  );

  return (
    <div className="stack" style={{ gap: 12 }}>
      <nav className="subtabs" aria-label="Accounts working papers">
        <button type="button" className="subtab" aria-pressed={tab === "rec"} onClick={() => setTab("rec")}>Reconciliation</button>
        <button type="button" className="subtab" aria-pressed={tab === "in"} onClick={() => setTab("in")}>Receipts{receipts.length ? ` (${receipts.length})` : ""}</button>
        <button type="button" className="subtab" aria-pressed={tab === "out"} onClick={() => setTab("out")}>Payments{payments.length ? ` (${payments.length})` : ""}</button>
      </nav>
      {tab === "rec" ? reconciliation : tab === "in" ? list(receipts, false) : list(payments, true)}
    </div>
  );
}
