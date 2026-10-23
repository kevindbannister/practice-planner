// Bank statements in, working papers out: for clients whose records are manual. Drop in a statement
// (PDF or CSV); it's read and checked against the running balance, sorted into categories (rules,
// then AI for the rest, then you), and the trial balance is built from it.
import { useMemo, useRef, useState } from "react";
import { AiError } from "../lib/ai";
import {
  Built, CATEGORIES, CATEGORY_BY_KEY, Sorted, Statement, Txn, buildPapers, finish, merchantKey, parseCsv, parseLines, sortTxns,
} from "../lib/bankStatement";
import { Client } from "../lib/domain";
import { money, priorPeriod } from "../lib/papers";
import { pdfLines } from "../lib/pdfText";
import { newKey } from "../lib/planning";
import { Row } from "../lib/schema";
import { useData } from "./data";
import { downloadFile, useAi } from "./commsKit";
import { useWriterState } from "./PaperSchedules";

const dmy = (d?: string) => (d ? d.split("-").reverse().join("/") : "");
const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 864e5).toISOString().slice(0, 10);

type Group = { key: string; label: string; items: Sorted[]; total: number; cat?: string; how?: Sorted["how"]; bank?: string };

export function BankImport({ client, period }: { client: Client; period: string }) {
  const { data, createMany, removeMany } = useData();
  const w = useWriterState();
  const ai = useAi();
  const file = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();
  const [stmt, setStmt] = useState<Statement>();
  const [names, setNames] = useState<string[]>([]);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [aiSaid, setAiSaid] = useState<Record<string, { cat: string; why?: string }>>({});
  const [bankName, setBankName] = useState("Bank current account");
  const [opening, setOpening] = useState("");
  const [consent, setConsent] = useState(false);
  const saved = (w.setup("bank/main").rules || {}) as Record<string, string>;
  const existing = data.paperLines.filter((r) => r.ClientKey === client.Key && r.PeriodEnd === period && r.SectionKey === "tb" && (r.SubKey || "main") === "main");
  const start = nextDay(priorPeriod(period));

  const gkey = (t: Txn, rule?: string) => `${merchantKey(t.detail)}|${Math.sign(t.amount)}|${rule || ""}`;
  const sorted: (Sorted & { g: string })[] = useMemo(() => {
    if (!stmt) return [];
    return sortTxns(stmt.txns, saved).map((t) => {
      const g = gkey(t, t.cat);
      if (picked[g]) return { ...t, g, cat: picked[g], how: "you" as const };
      if (!t.cat && aiSaid[g]) return { ...t, g, cat: aiSaid[g].cat, how: "ai" as const };
      return { ...t, g };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stmt, picked, aiSaid, data.papers]);

  const groups: Group[] = useMemo(() => {
    const m = new Map<string, Group>();
    for (const t of sorted) {
      const key = t.g;
      const g = m.get(key) || { key, label: t.detail || "(no description)", items: [], total: 0, bank: t.bankCategory };
      g.items.push(t);
      g.total = Math.round((g.total + t.amount) * 100) / 100;
      g.cat = t.cat;
      g.how = t.how;
      m.set(key, g);
    }
    return [...m.values()].sort((a, b) => Number(!!a.cat && a.cat !== "suspense") - Number(!!b.cat && b.cat !== "suspense") || Math.abs(b.total) - Math.abs(a.total));
  }, [sorted]);

  const openingNum = opening.trim() === "" ? stmt?.opening : Number(opening.replace(/,/g, ""));
  const built: Built | undefined = stmt ? buildPapers(sorted, Number.isFinite(openingNum as number) ? openingNum : stmt.opening, bankName) : undefined;
  const outside = stmt ? stmt.txns.filter((t) => t.date < start || t.date > period).length : 0;

  const readFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(undefined);
    setDone(undefined);
    setBusy("Reading the statement…");
    try {
      const parts: Statement[] = [];
      for (const f of Array.from(files)) {
        if (/\.pdf$/i.test(f.name) || f.type === "application/pdf") parts.push(parseLines(await pdfLines(new Uint8Array(await f.arrayBuffer()))));
        else if (/\.(csv|txt)$/i.test(f.name)) parts.push(parseCsv(await f.text()));
        else throw new Error(`${f.name} isn't a PDF or CSV.`);
      }
      parts.sort((a, b) => (a.from || "").localeCompare(b.from || ""));
      const problems = parts.flatMap((p, i) => p.problems.map((x) => (parts.length > 1 ? `${files[i]?.name || `File ${i + 1}`}: ${x}` : x)));
      for (let i = 1; i < parts.length; i++) if (parts[i].from && parts[i - 1].to && parts[i].from! <= parts[i - 1].to!) problems.push("Two of the statements cover some of the same dates: transactions may be counted twice.");
      const all: Txn[] = parts.flatMap((p) => p.txns).map((t, i) => ({ ...t, row: i + 1 }));
      const merged = parts.length === 1 ? parts[0] : (() => { const m = finish(all, []); return { ...m, problems: [...problems.filter((x) => !/^.*balance doesn't follow/.test(x)), ...m.problems] }; })();
      if (!merged.txns.length) { setError(merged.problems[0] || "No transactions found in that file."); setBusy(""); return; }
      setStmt(merged);
      setNames(Array.from(files).map((f) => f.name));
      setPicked({});
      setAiSaid({});
      setOpening("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "That file couldn't be read.");
    } finally {
      setBusy("");
      if (file.current) file.current.value = "";
    }
  };

  const askAi = async () => {
    const todo = groups.filter((g) => !g.cat);
    if (!todo.length) return;
    setBusy("Asking the AI…");
    setError(undefined);
    try {
      const items = todo.map((g) => ({ id: g.key, detail: g.label, type: g.items[0].type, bankCategory: g.bank, amount: g.items[0].amount }));
      const out: Record<string, { cat: string; why?: string }> = {};
      for (let i = 0; i < items.length; i += 60) {
        const r = await ai.bank({ company: client.Title, categories: CATEGORIES.map((c) => ({ key: c.key, name: c.name, hint: c.hint })), items: items.slice(i, i + 60) });
        for (const v of r.items) out[v.id] = { cat: v.cat, why: v.why };
      }
      setAiSaid((s) => ({ ...s, ...out }));
    } catch (e) {
      setError(e instanceof AiError ? e.message : "The AI couldn't sort those. Try again.");
    } finally {
      setBusy("");
    }
  };

  const save = async () => {
    if (!stmt || !built) return;
    setBusy("Saving…");
    setError(undefined);
    try {
      const now = new Date().toISOString();
      const rows: Row[] = built.tb.map((l, i) => ({
        Key: newKey("PL"), ClientKey: client.Key, PeriodEnd: period, SectionKey: "tb", SubKey: "main", Code: l.Code, Detail: l.Detail, Seq: i + 1, Updated: now,
        Figures: JSON.stringify(Object.fromEntries(Object.entries(l.f).filter(([, v]) => v !== undefined && v !== 0 && v !== ""))),
      }));
      if (existing.length) await removeMany("PaperLines", existing);
      await createMany("PaperLines", rows);
      // what you chose is remembered for this client's next statement
      const rules = { ...saved };
      const perMerchant = new Map<string, number>();
      for (const g of groups) perMerchant.set(merchantKey(g.items[0].detail), (perMerchant.get(merchantKey(g.items[0].detail)) || 0) + 1);
      for (const g of groups) if (g.cat && (g.how === "you" || g.how === "ai") && perMerchant.get(merchantKey(g.items[0].detail)) === 1) rules[merchantKey(g.items[0].detail)] = g.cat;
      await w.writeSetup("bank/main", { rules, files: names.join(", "), from: stmt.from, to: stmt.to, at: now });
      await w.writeSetup("info/main", { software: "Bank statements (manual records)" });
      setDone(`Saved a trial balance of ${rows.length} accounts built from ${stmt.txns.length} transactions. Map it in Trial balance to put the figures into the schedules.`);
      setStmt(undefined);
    } catch {
      setError("Not everything saved. Try again; saving replaces what it put in.");
    } finally {
      setBusy("");
    }
  };

  const csv = () => {
    const q = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;
    const lines = ["Date,Description,Type,Amount,Balance,Category"].concat(sorted.map((t) => [t.date, q(t.detail), q(t.type), t.amount.toFixed(2), t.balance?.toFixed(2) ?? "", q(CATEGORY_BY_KEY.get(t.cat || "")?.name || "")].join(",")));
    downloadFile(new TextEncoder().encode(lines.join("\r\n")), `${client.Title} bank transactions ${period}.csv`, "text/csv");
  };

  if (!open) {
    const rules = w.setup("bank/main");
    return (
      <div className="row-wrap" style={{ gap: 8 }}>
        <button type="button" className="btn small" onClick={() => setOpen(true)}>Import bank statement</button>
        {rules.at ? <span className="muted" style={{ fontSize: 12 }}>Bank statement {dmy(String(rules.from))} to {dmy(String(rules.to))} imported</span> : null}
        {done && <span className="muted" role="status" style={{ fontSize: 13 }}>{done}</span>}
      </div>
    );
  }

  const open_ = groups.filter((g) => !g.cat || g.cat === "suspense").length;
  return (
    <section className="card pad stack import-panel" aria-label="Import bank statement">
      <div className="row-wrap" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>Bank statement: {client.Title}</h3>
        <button type="button" className="linkbtn" onClick={() => { setOpen(false); setStmt(undefined); }}>Close</button>
      </div>
      {!stmt && (
        <div className="stack" style={{ gap: 8 }}>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Drop in the bank statement or transaction export (a PDF from the bank's app or website, or a CSV). It's read here in your browser and checked against the running balance; nothing is sent anywhere until you ask the AI to sort what the rules can't. Scanned or photographed statements can't be read yet.
          </p>
          <input ref={file} type="file" accept=".pdf,.csv,.txt,application/pdf,text/csv" multiple disabled={!!busy} aria-label="Bank statement file" onChange={(e) => void readFiles(e.target.files)} />
          {existing.length > 0 && <span className="muted" style={{ fontSize: 12 }}>Saving replaces the {existing.length} trial balance lines already in these papers.</span>}
        </div>
      )}
      {busy && <p className="muted" role="status" style={{ margin: 0 }}>{busy}</p>}
      {error && <p className="error-text" role="alert" style={{ margin: 0 }}>{error}</p>}
      {done && <p className="muted" role="status" style={{ margin: 0 }}>{done}</p>}
      {stmt && built && (
        <div className="stack" style={{ gap: 12 }}>
          <div className="row-wrap" style={{ gap: 18 }}>
            <span><strong>{stmt.txns.length}</strong> transactions, {dmy(stmt.from)} to {dmy(stmt.to)}</span>
            <span>Money in <strong>{money(stmt.in)}</strong></span>
            <span>Money out <strong>{money(stmt.out)}</strong></span>
            {stmt.closing !== undefined && <span>Closing balance <strong>{money(stmt.closing)}</strong></span>}
          </div>
          {stmt.problems.length === 0 && stmt.txns.some((t) => t.balance !== undefined) && <p className="muted" style={{ margin: 0, fontSize: 13 }}>✓ Every balance follows from the one before, so nothing has been missed or misread.</p>}
          {(stmt.problems.length > 0 || outside > 0) && (
            <ul className="import-list warn">
              {stmt.problems.map((x) => <li key={x}>{x}</li>)}
              {outside > 0 && <li>{outside} transaction{outside === 1 ? " is" : "s are"} outside the year {dmy(start)} to {dmy(period)}. They're included; remove them from the file if they shouldn't be.</li>}
            </ul>
          )}
          <div className="row-wrap" style={{ gap: 12 }}>
            <label className="row-wrap" style={{ gap: 6 }}>Bank account name
              <input className="input" style={{ width: 220 }} value={bankName} onChange={(e) => setBankName(e.target.value)} />
            </label>
            <label className="row-wrap" style={{ gap: 6 }}>Balance at the start
              <input className="input" style={{ width: 120 }} inputMode="decimal" placeholder={stmt.opening !== undefined ? stmt.opening.toFixed(2) : "0.00"} value={opening} onChange={(e) => setOpening(e.target.value)} />
            </label>
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <div className="row-wrap" style={{ justifyContent: "space-between" }}>
              <strong style={{ fontSize: 14 }}>Who it's with ({groups.length}){open_ ? ` · ${open_} to sort` : " · all sorted"}</strong>
              {open_ > 0 && (
                <span className="row-wrap" style={{ gap: 8 }}>
                  <label className="row-wrap" style={{ gap: 6, fontSize: 12 }}>
                    <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                    OK to send descriptions and amounts (no account details) to OpenAI
                  </label>
                  <button type="button" className="btn small" disabled={!consent || !!busy} onClick={() => void askAi()}>Ask the AI to sort the rest</button>
                </span>
              )}
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="bank-table">
                <thead><tr><th>Description</th><th className="num">Txns</th><th className="num">Total</th><th>Category</th></tr></thead>
                <tbody>
                  {groups.map((g) => (
                    <tr key={g.key} className={!g.cat || g.cat === "suspense" ? "needs" : ""}>
                      <td>{g.label}{g.bank ? <span className="muted" style={{ fontSize: 11 }}> · bank says {g.bank}</span> : null}</td>
                      <td className="num">{g.items.length}</td>
                      <td className="num">{money(g.total)}</td>
                      <td>
                        <select className="input" aria-label={`Category for ${g.label}`} value={g.cat || ""} onChange={(e) => setPicked((p) => ({ ...p, [g.key]: e.target.value }))}>
                          <option value="">Choose…</option>
                          {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
                        </select>
                        {g.how === "ai" && <span className="chip" title={aiSaid[g.key]?.why}>AI</span>}
                        {g.how === "saved" && <span className="chip" title="From an earlier statement for this client">remembered</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="stack" style={{ gap: 4 }}>
            <strong style={{ fontSize: 14 }}>Trial balance this builds</strong>
            <table className="bank-table">
              <thead><tr><th>Account</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
              <tbody>
                {built.tb.map((l) => <tr key={l.Code}><td>{l.Detail}</td><td className="num">{l.f.dr ? money(l.f.dr) : ""}</td><td className="num">{l.f.cr ? money(l.f.cr) : ""}</td></tr>)}
              </tbody>
            </table>
            <ul className="import-list warn">
              {built.balancingFigure !== 0 && <li>"Opening position" of {money(Math.abs(built.balancingFigure))} is a balancing figure: the bank balance at the start less nothing else known. Replace it with last year's balance sheet figures when you have them.</li>}
              {built.uncategorised > 0 && <li>{built.uncategorised} transaction{built.uncategorised === 1 ? " is" : "s are"} in "Unknown / query for client".</li>}
              <li>This is a cash-basis trial balance: no debtors, creditors, accruals, VAT split, depreciation or tax. Those come from your own adjustments, journals and the schedules.</li>
            </ul>
          </div>
          <div className="row-wrap">
            <button type="button" className="btn primary" disabled={!!busy} onClick={() => void save()}>Save as the trial balance</button>
            <button type="button" className="btn" disabled={!!busy} onClick={csv}>Download sorted transactions (CSV)</button>
            <button type="button" className="btn" disabled={!!busy} onClick={() => setStmt(undefined)}>Back</button>
          </div>
        </div>
      )}
    </section>
  );
}
