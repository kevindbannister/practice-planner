// Historical import for one company: manual rows, a spreadsheet or CSV, or the text of a statutory register PDF. Everything is staged,
// checked and reviewed first; only what a person accepts, and then approves as a whole, is written to the company's records.
import { useMemo, useState } from "react";
import { fmtDate, todayIso } from "../lib/domain";
import { FIELDS, ImportItem, ItemKind, check, commit, compareOfficers, guessMapping, itemsFromPdfLines, itemsFromRows, missingMapping, norm, parseCsv, proposedRecord } from "../lib/cosecImport";
import { readEntry } from "../lib/shareLedger";
import { allRegisters, registersPdf, toCsv } from "../lib/cosecRegisters";
import { pdfPageText } from "../lib/pdfText";
import { readXlsx } from "../lib/xlsxRead";
import { newKey } from "../lib/planning";
import { Row } from "../lib/schema";
import { companyKind } from "../lib/cosec";
import { useCompaniesHouse } from "./CompaniesHouse";
import { downloadFile } from "./commsKit";
import { useCoSec } from "./cosecKit";

const s = (v: unknown) => (v == null ? "" : String(v));
const say = (e: unknown) => (e instanceof Error && e.message ? e.message : "That didn't work. Try again.");
const KINDS: [ItemKind, string][] = [["ledger", "Share transactions"], ["officer", "Officers"], ["psc", "People with significant control"]];

export function ImportHistory({ client }: { client: Row }) {
  const k = useCoSec();
  const ck = s(client.Key);
  const [kind, setKind] = useState<ItemKind>("ledger");
  const [doc, setDoc] = useState("");
  const [method, setMethod] = useState("");
  const [table, setTable] = useState<string[][] | null>(null);
  const [map, setMap] = useState<Record<string, number>>({});
  const [items, setItems] = useState<ImportItem[]>([]);
  const [batch] = useState(() => newKey("IM"));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const ex = useMemo(() => ({
    entries: k.data.cosecLedger.filter((r) => r.ClientKey === ck).map(readEntry),
    officers: k.data.cosecOfficers.filter((r) => r.ClientKey === ck),
    pscs: k.data.cosecPscs.filter((r) => r.ClientKey === ck),
    classes: k.data.cosecShareClasses.filter((c) => c.ClientKey === ck && s(c.Status) !== "former").map((c) => s(c.Name)),
  }), [k.data, ck]);
  const verdict = useMemo(() => check(items, ex, batch), [items, ex, batch]);
  const pending = items.filter((i) => i.status === "pending").length;
  const accepted = items.filter((i) => i.status === "accepted").length;
  const canEdit = k.can("edit");
  const past = k.data.cosecImports.filter((r) => r.ClientKey === ck).sort((a, b) => s(b.Created).localeCompare(s(a.Created)));

  const reset = () => { setTable(null); setItems([]); setDoc(""); setMethod(""); setMsg(undefined); };
  const load = async (f: File) => {
    setBusy(true); setMsg(undefined); setItems([]); setTable(null); setDoc(f.name);
    try {
      if (/\.pdf$/i.test(f.name) || f.type === "application/pdf") {
        const pages = await pdfPageText(new Uint8Array(await f.arrayBuffer()));
        const found = itemsFromPdfLines(pages, f.name);
        setMethod("pdf"); setItems(found);
        setMsg(found.length ? { ok: true, text: `${found.length} possible record${found.length === 1 ? "" : "s"} found by reading the text of ${pages.length} page${pages.length === 1 ? "" : "s"}. This is plain text matching, not AI: check each one against the page, and enter anything it couldn't read.` } : { ok: false, text: "No rows with a date and a recognisable entry were found. A scanned PDF has no text to read; enter the rows by hand or use a spreadsheet." });
      } else {
        let rows: string[][];
        if (/\.xlsx$/i.test(f.name)) {
          const book = await readXlsx(new Uint8Array(await f.arrayBuffer()));
          const sh = book.sheet(book.names[0]);
          if (!sh) throw new Error("That workbook has no sheets.");
          rows = [];
          for (let r = 1; r <= sh.maxRow; r++) { const row: string[] = []; let any = false; for (let c = 1; c <= 20; c++) { const t = sh.text(r, c); row.push(t); if (t) any = true; } if (any) rows.push(row); }
          while (rows.length && rows.every((r) => !r[r.length - 1])) rows.forEach((r) => r.pop());
        } else rows = parseCsv(await f.text());
        if (rows.length < 2) throw new Error("There are no rows to read. The first row should be the column headings.");
        setMethod(/\.xlsx$/i.test(f.name) ? "xlsx" : "csv"); setTable(rows); setMap(guessMapping(rows[0], kind));
      }
    } catch (e) { setMsg({ ok: false, text: say(e) }); } finally { setBusy(false); }
  };
  const readRows = () => {
    if (!table) return;
    const miss = missingMapping(kind, map);
    if (miss.length) { setMsg({ ok: false, text: `Choose a column for: ${miss.join(", ")}.` }); return; }
    setItems(itemsFromRows(table.slice(1), map, kind, doc));
    setMsg({ ok: true, text: "Rows read. Nothing has been saved: review each row below." });
  };
  const edit = (id: string, patch: Partial<ImportItem>, field?: [string, string]) => setItems((xs) => xs.map((i) => i.id !== id ? i : { ...i, ...patch, fields: field ? { ...i.fields, [field[0]]: field[1] } : i.fields, ...(field ? { ambiguity: i.ambiguity } : {}) }));
  const all = (status: "accepted" | "excluded") => setItems((xs) => xs.map((i) => i.status === "pending" && (status === "excluded" || !verdict.items[i.id]?.errors.length) ? { ...i, status } : i));
  const addBlank = () => setItems((xs) => [...xs, { id: newKey("I"), kind, status: "pending", fields: Object.fromEntries(FIELDS[kind].map((f) => [f.key, ""])), source: { doc: "Entered by hand" }, confidence: "supplied", ambiguity: [] }]);

  const approve = async () => {
    setBusy(true); setMsg(undefined);
    try {
      const c = commit(items, ex, ck, { batch, doc: doc || "Entered by hand", method: method || "manual", by: k.me, now: new Date().toISOString() });
      if (c.error) throw new Error(c.error);
      const n = c.counts;
      await k.apply({ creates: c.creates, patches: c.patches, log: [], activities: [{ Key: newKey("A"), ClientKey: ck, Type: "cosec-flag", Title: `Historical records imported (${doc || "entered by hand"})`, Summary: `${n.ledger} share entries, ${n.officers} officers, ${n.pscs} PSCs added, ${n.merged} merged. No filings were created.`, At: new Date().toISOString(), Actor: k.me, Source: "cosec", SourceKey: batch, EventKey: `import:${batch}`, Visibility: "normal", Created: new Date().toISOString() }] } as never);
      setItems([]); setTable(null);
      setMsg({ ok: true, text: `Imported: ${n.ledger} share entries, ${n.officers} officers, ${n.pscs} PSCs, ${n.merged} merged with existing records. No Companies House filings were created.` });
    } catch (e) { setMsg({ ok: false, text: say(e) }); } finally { setBusy(false); }
  };

  const people = kind === "officer" ? ex.officers : ex.pscs;
  const nameOf = (r: Row) => [s(r.First), s(r.Last)].filter(Boolean).join(" ") || s(r.CorporateName);
  return (
    <div className="stack" style={{ gap: 14 }}>
      <section className="card pad stack" aria-label="Import history">
        <h3 style={{ margin: 0 }}>Import history</h3>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>Bring in a company's earlier records from a spreadsheet, a CSV, the text of a register PDF, or by typing them in. Nothing goes into the records until you have reviewed it and approved the import, and an import never creates a Companies House filing for something in the past. Where the history before a date isn't known, enter an opening balance rather than guessing.</p>
        <div className="row-wrap">{KINDS.filter(([key]) => key !== "ledger" || companyKind(client) === "limited").map(([key, label]) => <button key={key} type="button" className={`btn${kind === key ? " primary" : ""}`} disabled={!!items.length} onClick={() => { setKind(key); setTable(null); }}>{label}</button>)}</div>
        {canEdit && <div className="row-wrap">
          <label className="btn" style={{ cursor: "pointer" }}>Choose a file (.csv, .xlsx or .pdf)<input type="file" accept=".csv,.xlsx,.pdf,text/csv,application/pdf" style={{ display: "none" }} disabled={busy || !!items.length} onChange={(e) => { const f = e.target.files?.[0]; if (f) void load(f); e.target.value = ""; }} /></label>
          <button type="button" className="btn" disabled={busy || (!!items.length && method !== "")} onClick={() => { if (!items.length) { setMethod("manual"); setDoc("Entered by hand"); } addBlank(); }}>Add a row by hand</button>
          {(items.length > 0 || table) && <button type="button" className="linkbtn" onClick={reset}>Start again</button>}
        </div>}
        {table && !items.length && (
          <div className="stack" style={{ gap: 8 }}>
            <strong>Which column is which?</strong>
            <div className="tl-form">{FIELDS[kind].map((f) => <label key={f.key} className="doc-field"><span>{f.label}{f.required ? " *" : ""}</span><select className="input" value={map[f.key] ?? ""} onChange={(e) => setMap({ ...map, ...(e.target.value === "" ? (delete map[f.key], {}) : { [f.key]: Number(e.target.value) }) })}><option value="">Not in the file</option>{table[0].map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}</select></label>)}</div>
            <div><button type="button" className="btn primary" onClick={readRows}>Read {table.length - 1} row{table.length === 2 ? "" : "s"}</button></div>
          </div>
        )}
        {msg && <p className={msg.ok ? undefined : "error-text"} role={msg.ok ? "status" : "alert"} style={{ margin: 0 }}>{msg.text}</p>}
      </section>

      {items.length > 0 && (
        <section className="card pad stack" aria-label="Review the import">
          <div className="row-wrap" style={{ justifyContent: "space-between" }}>
            <h3 style={{ margin: 0 }}>Review <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>{items.length} rows · {accepted} accepted · {pending} to decide</span></h3>
            <span className="row-wrap"><button type="button" className="btn" onClick={() => all("accepted")}>Accept all that are fine</button><button type="button" className="btn" onClick={() => all("excluded")}>Exclude the rest</button></span>
          </div>
          {verdict.batch.length > 0 && <div className="alert red" role="alert"><strong>The ledger would not balance</strong><span>{verdict.batch[0]} Fix or exclude the rows involved.</span></div>}
          <div className="table-wrap"><table className="grid" style={{ minWidth: 900 }}>
            <thead><tr><th scope="col">Decision</th><th scope="col">What it would become</th>{FIELDS[kind].filter((f) => kind !== "ledger" || ["date", "type", "cls", "number", "from", "to"].includes(f.key)).map((f) => <th key={f.key} scope="col">{f.label}</th>)}<th scope="col">Source</th><th scope="col">Checks</th></tr></thead>
            <tbody>{items.map((i) => {
              const v = verdict.items[i.id] || { errors: [], warnings: [] };
              const cols = FIELDS[kind].filter((f) => kind !== "ledger" || ["date", "type", "cls", "number", "from", "to"].includes(f.key));
              return (
                <tr key={i.id} style={i.status === "excluded" ? { opacity: 0.5 } : undefined}>
                  <td><select className="input" aria-label="Decision" value={i.status} onChange={(e) => edit(i.id, { status: e.target.value as ImportItem["status"] })} style={{ width: "auto" }}><option value="pending">To decide</option><option value="accepted" disabled={v.errors.length > 0}>Accept</option><option value="excluded">Exclude</option></select></td>
                  <td style={{ fontSize: 12 }}>{proposedRecord(i)}<div><span className={`chip ${i.confidence === "supplied" ? "green" : i.confidence === "extracted" ? "amber" : "red"}`}>{i.confidence === "supplied" ? "From your data" : i.confidence === "extracted" ? "Read from text" : "Low confidence"}</span></div></td>
                  {cols.map((f) => <td key={f.key}><input className="input" aria-label={f.label} value={i.fields[f.key] || ""} onChange={(e) => edit(i.id, {}, [f.key, e.target.value])} style={{ minWidth: /date|On$/.test(f.key) ? 110 : 90 }} placeholder={/date|On$/.test(f.key) ? "yyyy-mm-dd" : ""} /></td>)}
                  <td style={{ fontSize: 12 }}>{i.source.doc}{i.source.page ? `, page ${i.source.page}` : i.source.row ? `, row ${i.source.row}` : ""}{i.source.text && <div className="muted" title={i.source.text}>"{i.source.text.slice(0, 50)}{i.source.text.length > 50 ? "…" : ""}"</div>}</td>
                  <td style={{ fontSize: 12, minWidth: 200 }}>
                    {v.errors.map((m, n) => <div key={"e" + n} className="error-text">{m}</div>)}
                    {v.warnings.map((m, n) => <div key={"w" + n} className="muted">{m}</div>)}
                    {kind !== "ledger" && people.some((p) => norm(nameOf(p)) === norm(i.fields.name || "")) && <label className="row-wrap" style={{ fontSize: 12 }}>Merge into <select className="input" value={i.mergeWith || ""} onChange={(e) => edit(i.id, { mergeWith: e.target.value || undefined })} style={{ width: "auto" }}><option value="">Keep separate</option>{people.filter((p) => norm(nameOf(p)) === norm(i.fields.name || "")).map((p) => <option key={s(p.Key)} value={s(p.Key)}>{nameOf(p)} ({s(p.Status)})</option>)}</select></label>}
                  </td>
                </tr>);
            })}</tbody>
          </table></div>
          <div className="row-wrap">
            <button type="button" className="btn primary" disabled={busy || pending > 0 || accepted === 0 || verdict.batch.length > 0 || !canEdit} onClick={() => void approve()}>{busy ? "Importing…" : `Approve the import (${accepted} record${accepted === 1 ? "" : "s"})`}</button>
            {pending > 0 && <span className="muted" style={{ fontSize: 13 }}>Decide the {pending} remaining row{pending === 1 ? "" : "s"} first.</span>}
          </div>
        </section>
      )}

      {kind === "officer" && <CompareOfficers client={client} />}

      {past.length > 0 && (
        <section className="card pad stack" aria-label="Earlier imports">
          <h3 style={{ margin: 0 }}>Earlier imports</h3>
          <ul className="plain">{past.map((r) => <li key={s(r.Key)}><strong>{s(r.SourceName)}</strong> <span className="muted">{fmtDate(s(r.ApprovedAt).slice(0, 10))} by {s(r.ApprovedBy)}</span><div className="muted" style={{ fontSize: 13 }}>{s(r.Summary)}</div></li>)}</ul>
        </section>
      )}
    </div>
  );
}

function CompareOfficers({ client }: { client: Row }) {
  const k = useCoSec();
  const ch = useCompaniesHouse();
  const [res, setRes] = useState<ReturnType<typeof compareOfficers> | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true); setErr("");
    try {
      const n = s(client.CompanyNumber).trim();
      if (!n) throw new Error("This company has no registration number.");
      const l = await ch.get(`company/${n}/officers`);
      const items = ((l?.items || []) as { name: string; officer_role?: string; resigned_on?: string }[]).filter((o) => !o.resigned_on);
      setRes(compareOfficers(k.data.cosecOfficers.filter((o) => o.ClientKey === client.Key), items.map((o) => ({ name: o.name, role: o.officer_role }))));
    } catch (e) { setErr(say(e)); } finally { setBusy(false); }
  };
  return (
    <section className="card pad stack" aria-label="Compare with Companies House">
      <h3 style={{ margin: 0 }}>Compare current officers with Companies House</h3>
      <div><button type="button" className="btn" disabled={busy} onClick={() => void run()}>{busy ? "Checking…" : "Compare"}</button></div>
      {err && <p className="error-text" role="alert" style={{ margin: 0 }}>{err}</p>}
      {res && (res.onlyHere.length + res.onlyAtCh.length === 0 ? <p style={{ margin: 0 }}>The {res.matched} current officer{res.matched === 1 ? "" : "s"} on file match Companies House.</p> : <>
        {res.onlyHere.length > 0 && <p style={{ margin: 0 }}>On file here but not current at Companies House: {res.onlyHere.join(", ")}.</p>}
        {res.onlyAtCh.length > 0 && <p style={{ margin: 0 }}>Current at Companies House but not on file here: {res.onlyAtCh.join(", ")}.</p>}
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>Nothing has been changed. Names are compared ignoring titles and order.</p></>)}
    </section>
  );
}

// ------------------------------------------------------------------ registers

export function RegistersTab({ client }: { client: Row }) {
  const k = useCoSec();
  const llp = companyKind(client) === "llp";
  const [asOf, setAsOf] = useState(todayIso());
  const sensitive = k.can("approve");
  const [withSensitive, setWithSensitive] = useState(false);
  const regs = useMemo(() => allRegisters({ ledger: k.data.cosecLedger, officers: k.data.cosecOfficers, pscs: k.data.cosecPscs, clientKey: s(client.Key), llp }, asOf, sensitive && withSensitive), [k.data, client.Key, llp, asOf, sensitive, withSensitive]);
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const on = (id: string) => chosen[id] !== false;
  const picked = regs.filter((r) => on(r.id));
  const ledgerEmpty = !llp && !k.data.cosecLedger.some((r) => r.ClientKey === client.Key);
  const name = `${s(client.Title)} registers ${asOf}`;
  const pack = async () => downloadFile(await registersPdf({ name: s(client.Title), number: s(client.CompanyNumber) }, picked, asOf, k.me), `${name}.pdf`, "application/pdf");
  return (
    <section className="card pad stack" aria-label="Registers">
      <div className="row-wrap" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>Registers</h3>
        <span className="row-wrap">
          <label className="row-wrap muted" style={{ fontSize: 13 }}>As at <input className="input" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} style={{ width: "auto" }} /></label>
          <button type="button" className="btn primary" disabled={!picked.length} onClick={() => void pack()}>Download PDF pack</button>
        </span>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>Worked out from the company's records for the date you choose. Since 18 November 2025 only the register of members must still be kept by the company; the other registers are the company's own record, because Companies House holds the official information.</p>
      {ledgerEmpty && <div className="alert amber" role="status"><strong>The share ledger is empty</strong><span>The register of members is built from the ledger. Add or import the shareholdings first.</span></div>}
      {sensitive ? <label className="row-wrap" style={{ fontSize: 13 }}><input type="checkbox" checked={withSensitive} onChange={(e) => setWithSensitive(e.target.checked)} /> Include dates of birth and residential addresses (restricted; keep the file secure)</label> : <p className="muted" style={{ margin: 0, fontSize: 13 }}>Dates of birth show month and year only and residential addresses are left out. A manager or partner can export them.</p>}
      {regs.map((r) => (
        <div key={r.id} className="stack" style={{ gap: 6 }}>
          <div className="row-wrap" style={{ justifyContent: "space-between" }}>
            <label className="row-wrap"><input type="checkbox" checked={on(r.id)} onChange={(e) => setChosen({ ...chosen, [r.id]: e.target.checked })} /> <strong>{r.title}</strong> {r.required ? <span className="chip green">Must be kept</span> : <span className="chip">Company's own record</span>}</label>
            <button type="button" className="linkbtn" onClick={() => downloadFile(new TextEncoder().encode(toCsv(r)), `${name} ${r.id}.csv`, "text/csv")}>Download CSV</button>
          </div>
          <div className="table-wrap"><table className="grid" style={{ minWidth: 560 }}><thead><tr>{r.columns.map((c) => <th key={c} scope="col">{c}</th>)}</tr></thead>
            <tbody>{r.rows.length ? r.rows.map((row, i) => <tr key={i}>{row.map((c, j) => <td key={j}>{c}</td>)}</tr>) : <tr><td colSpan={r.columns.length} className="muted">No entries at this date.</td></tr>}</tbody></table></div>
        </div>
      ))}
    </section>
  );
}
