// Import from Xero, in a company's working papers for a year: read the books first and show what
// came in, then save the parts chosen into the papers (each replacing what's there for it).
import { useState } from "react";
import { Client } from "../lib/domain";
import { money, priorPeriod } from "../lib/papers";
import { newKey } from "../lib/planning";
import { Row } from "../lib/schema";
import { ImportPart, XeroError, XeroImport as Imported, ledgerItem, r2, readFromXero } from "../lib/xero";
import { href } from "./bits";
import { useData } from "./data";
import { useWriterState } from "./PaperSchedules";
import { BookMeta, primeBook } from "./XeroLedger";
import { useXero, useXeroLinks } from "./XeroSettings";

const PARTS: [ImportPart, string, string][] = [
  ["tb", "Trial balance", "The year end trial balance from Xero (and last year's, for comparatives, if the papers haven't got one)."],
  ["ledger", "Nominal ledger", "Every transaction in the year, shown behind each account in the schedules."],
  ["lists", "Debtors and creditors listings", "Each customer's and supplier's balance at the year end, into Trade debtors and Trade creditors."],
  ["bank", "Bank", "Xero's bank summary and the items not reconciled at the year end, shown under each bank account."],
  ["vat", "VAT by quarter", "Output VAT, input VAT and payments for each quarter, into the VAT return summary."],
  ["payroll", "Payroll", "Gross pay, PAYE, NI and pensions by month from Xero Payroll, into Wages records."],
];
const STAGGERS: [string, number[]][] = [["Quarters to Mar, Jun, Sep, Dec", [3, 6, 9, 12]], ["Quarters to Apr, Jul, Oct, Jan", [1, 4, 7, 10]], ["Quarters to May, Aug, Nov, Feb", [2, 5, 8, 11]], ["Monthly returns", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]]];

export function XeroImport({ client, period }: { client: Client; period: string }) {
  const { data, createMany, removeMany, store } = useData();
  const w = useWriterState();
  const xero = useXero();
  const { tenantFor, connected } = useXeroLinks();
  const tenant = tenantFor(client.Key);
  const saved = w.setup("xero/main") as BookMeta & { stagger?: number[] };
  const [open, setOpen] = useState(false);
  const [parts, setParts] = useState<Set<ImportPart>>(new Set(PARTS.map(([k]) => k)));
  const [stagger, setStagger] = useState<number[]>(saved.stagger || [3, 6, 9, 12]);
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<Imported>();
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();
  const [busy, setBusy] = useState(false);
  const prior = priorPeriod(period);

  const mine = (p: string, sec: string, sub: string) => data.paperLines.filter((r) => r.ClientKey === client.Key && r.PeriodEnd === p && r.SectionKey === sec && (r.SubKey || "main") === sub);

  if (!tenant) {
    return (
      <span className="muted" style={{ fontSize: 13 }}>
        {connected ? "Not linked to a Xero organisation." : "Xero isn't connected."} <a href={href("settings", "xero")}>Set up Xero</a>
      </span>
    );
  }

  const read = async () => {
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    setDone(undefined);
    try {
      setResult(await readFromXero(xero, tenant, period, parts, { quarterEnds: stagger, progress: setProgress }));
    } catch (e) {
      setError(e instanceof XeroError ? e.message : "Reading from Xero stopped. Try again.");
    } finally {
      setProgress("");
      setBusy(false);
    }
  };

  const rowsOf = (p: string, sec: string, sub: string, list: { Code?: string; Detail?: string; Amount?: number; Remark?: string; f?: Record<string, unknown> }[]): Row[] => {
    const now = new Date().toISOString();
    return list.map((x, i) => {
      const f = Object.fromEntries(Object.entries(x.f || {}).filter(([, v]) => v !== undefined && v !== "" && v !== 0));
      return {
        Key: newKey("PL"), ClientKey: client.Key, PeriodEnd: p, SectionKey: sec, SubKey: sub, Code: x.Code || undefined, Detail: x.Detail || undefined, Amount: x.Amount,
        Remark: x.Remark || undefined, Figures: Object.keys(f).length ? JSON.stringify(f) : undefined, Seq: i + 1, Updated: now,
      };
    });
  };

  const save = async () => {
    if (!result) return;
    setBusy(true);
    setError(undefined);
    try {
      const out: Row[] = [], old: Row[] = [];
      const put = (p: string, sec: string, sub: string, list: Parameters<typeof rowsOf>[3]) => {
        old.push(...mine(p, sec, sub));
        out.push(...rowsOf(p, sec, sub, list));
      };
      const r = result;
      if (parts.has("tb") && r.tb.length) {
        put(period, "tb", "main", r.tb);
        if (r.priorTb.length && !mine(prior, "tb", "main").length) put(prior, "tb", "main", r.priorTb);
      }
      if (parts.has("lists")) {
        if (r.debtors.length) put(period, "debtors", "trade", r.debtors.map((d) => ({ Detail: d.contact, Amount: d.balance, Remark: "Balance in Xero at the year end" })));
        if (r.creditors.length) put(period, "creditors", "trade", r.creditors.map((d) => ({ Detail: d.contact, Amount: d.balance, Remark: "Balance in Xero at the year end" })));
      }
      const vatAcct = r.book.accounts.find((a) => a.sys === "GST");
      if (parts.has("vat") && r.vat.length && vatAcct) await w.writeSetup("vat/returns", { bf: r2(-(r.book.opening[vatAcct.key] || 0)) });
      if (parts.has("vat") && r.vat.length) {
        put(period, "vat", "returns", r.vat.map((q) => ({ Detail: q.label, f: { out: q.out, in: q.inp, paid: q.paid }, Remark: q.other ? `Other entries on the VAT account (journals): ${money(q.other)}` : "" })));
      }
      if (parts.has("payroll") && r.payroll.length) {
        put(period, "wages", "records", r.payroll.map((m) => ({ Detail: m.label, f: { gross: m.gross, paye: r2(m.paye + m.studentLoan), eeni: m.eeni, eepen: m.eepen, erni: m.erni, erpen: m.erpen }, Remark: m.studentLoan ? `PAYE includes student loan ${money(m.studentLoan)}` : "" })));
      }
      if (old.length) await removeMany("PaperLines", old);
      if (out.length) await createMany("PaperLines", out);

      // the ledger and bank detail go to OneDrive as one file
      if (r.book.lines.length || r.book.bank.length || r.book.unreconciled.length) {
        const file = ledgerItem(client.Key, period);
        await store.graph.put(`${file}:/content`, new TextEncoder().encode(JSON.stringify(r.book)), "application/json");
        const meta: BookMeta = { file, at: r.book.at, source: r.book.source, tenantName: r.book.tenantName, lines: r.book.lines.length };
        primeBook(meta, r.book);
        await w.writeSetup("xero/main", { ...meta, stagger, tenantId: r.book.tenantId, notes: r.book.notes.join(" ") });
      } else await w.writeSetup("xero/main", { stagger });
      await w.writeSetup("info/main", { software: "Xero" });
      setDone(`Saved ${out.length} lines${r.book.lines.length ? ` and ${r.book.lines.length} ledger transactions` : ""} from Xero. Open a schedule's trial balance accounts to see their transactions; the Accounts summary shows whether everything agrees.`);
      setResult(undefined);
    } catch {
      setError("Not everything saved. Try again; saving replaces what it put in.");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className="row-wrap" style={{ gap: 8 }}>
        <button type="button" className="btn small" onClick={() => setOpen(true)}>Import from Xero</button>
        {saved.at && <span className="muted" style={{ fontSize: 12 }}>Ledger from Xero {new Date(saved.at).toLocaleDateString("en-GB")}{saved.source === "rebuilt" ? " (rebuilt)" : ""}</span>}
        {done && <span className="muted" role="status" style={{ fontSize: 13 }}>{done}</span>}
      </div>
    );
  }

  const replaces: Partial<Record<ImportPart, number>> = {
    tb: mine(period, "tb", "main").length,
    lists: mine(period, "debtors", "trade").length + mine(period, "creditors", "trade").length,
    vat: mine(period, "vat", "returns").length,
    payroll: mine(period, "wages", "records").length,
  };
  return (
    <section className="card pad stack import-panel" aria-label="Import from Xero">
      <div className="row-wrap" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>Import from Xero: {tenant.tenantName}</h3>
        <button type="button" className="linkbtn" onClick={() => { setOpen(false); setResult(undefined); }}>Close</button>
      </div>
      {!result && (
        <>
          <fieldset className="import-parts" disabled={busy}>
            <legend>Read for the year to {new Date(`${period}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}</legend>
            {PARTS.map(([k, label, hint]) => (
              <label key={k} className="row-wrap" style={{ gap: 8, alignItems: "flex-start" }}>
                <input type="checkbox" style={{ marginTop: 3 }} checked={parts.has(k)} onChange={(e) => setParts((s) => { const n = new Set(s); if (e.target.checked) n.add(k); else n.delete(k); return n; })} />
                <span className="stack" style={{ gap: 0 }}>
                  <span>{label}{replaces[k] ? <span className="muted" style={{ fontSize: 12 }}> · replaces {replaces[k]} line{replaces[k] === 1 ? "" : "s"} already there</span> : null}</span>
                  <span className="muted" style={{ fontSize: 12 }}>{hint}</span>
                </span>
              </label>
            ))}
            {parts.has("vat") && (
              <label className="row-wrap" style={{ gap: 8 }}>
                <span>VAT periods</span>
                <select className="input" style={{ width: "auto" }} value={stagger.join(",")} onChange={(e) => setStagger(e.target.value.split(",").map(Number))}>
                  {STAGGERS.map(([l, m]) => <option key={l} value={m.join(",")}>{l}</option>)}
                </select>
              </label>
            )}
          </fieldset>
          <div className="row-wrap">
            <button type="button" className="btn primary" disabled={busy || !parts.size} onClick={() => void read()}>{busy ? "Reading…" : "Read from Xero"}</button>
            {progress && <span className="muted" role="status" style={{ fontSize: 13 }}>{progress}</span>}
          </div>
        </>
      )}
      {error && <p className="error-text" role="alert" style={{ margin: 0 }}>{error}</p>}
      {done && <p className="muted" role="status" style={{ margin: 0 }}>{done}</p>}
      {result && (
        <div className="stack" style={{ gap: 10 }}>
          <div>
            <strong style={{ fontSize: 14 }}>Read from Xero</strong>
            <ul className="import-list">{result.log.map((x) => <li key={x}>{x}</li>)}</ul>
          </div>
          {(result.problems.length > 0 || result.book.notes.length > 0) && (
            <div>
              <strong style={{ fontSize: 14 }}>Worth a look</strong>
              <ul className="import-list warn">{[...result.problems, ...result.book.notes].map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
          )}
          <div className="row-wrap">
            <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save to the papers"}</button>
            <button type="button" className="btn" disabled={busy} onClick={() => setResult(undefined)}>Back</button>
          </div>
        </div>
      )}
    </section>
  );
}
