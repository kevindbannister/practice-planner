// Request receipts: drop a spreadsheet of transactions (Excel or CSV), tick the ones you need paperwork for, and the planner writes
// the email to the client asking for the invoices and receipts, with the list attached as a spreadsheet they can fill in and send
// back. It goes into your Outlook drafts to check and send, is kept on the client's record, and can add a task to chase it.
import { useMemo, useRef, useState } from "react";
import { addScope } from "../lib/auth";
import { emailGreeting, toBase64 } from "../lib/comms";
import { Client, fmtDate, todayIso } from "../lib/domain";
import { newKey } from "../lib/planning";
import { ColumnMap, Grid, NO_COLUMN, Txn, findHeader, gbp, guessColumns, parseCsv, requestEmail, requestFileName, requestSheet, toTransactions } from "../lib/receiptRequest";
import { toHtml } from "../lib/richText";
import { XLSX_TYPE, workbook } from "../lib/xlsx";
import { readXlsx } from "../lib/xlsxRead";
import { Icon, href, useRoute } from "./bits";
import { CommsTabs, MAIL_SCOPE, downloadFile, mailAllowed, useCommsPrefs } from "./commsKit";
import { useData } from "./data";

type Loaded = { name: string; rows: Grid; header: number; map: ColumnMap };

/** The first sheet of an Excel file, or a CSV file, as rows of cells. */
async function readFile(file: File): Promise<Grid> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (/\.csv$|\.txt$/i.test(file.name) || file.type === "text/csv") return parseCsv(new TextDecoder().decode(bytes));
  const book = await readXlsx(bytes);
  const sheet = book.sheet(book.names[0]);
  if (!sheet) return [];
  const rows: Grid = [];
  for (let r = 1; r <= sheet.maxRow; r++) {
    const row: Grid[number] = [];
    for (let c = 1; c <= 30; c++) { const v = sheet.cell(r, c)?.v; row.push(typeof v === "boolean" ? String(v) : v); }
    while (row.length && (row[row.length - 1] === undefined || row[row.length - 1] === "")) row.pop();
    rows.push(row);
  }
  return rows;
}

export function ReceiptRequestPage() {
  const { data, user, store, create } = useData();
  const prefs = useCommsPrefs();
  const { query } = useRoute();
  const today = todayIso();
  const clients = useMemo(() => [...data.clients].sort((a, b) => String(a.Title).localeCompare(String(b.Title))), [data.clients]);
  const [clientKey, setClientKey] = useState(query.get("client") || "");
  const client = data.clients.find((c) => c.Key === clientKey) as Client | undefined;
  const [file, setFile] = useState<Loaded | null>(null);
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const [outOnly, setOutOnly] = useState(false);
  const [edited, setEdited] = useState<{ subject?: string; body?: string; to?: string }>({});
  const [chase, setChase] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ to: string; n: number; task: boolean } | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const all: Txn[] = useMemo(() => (file ? toTransactions(file.rows, file.header, file.map) : []), [file]);
  const shown = all.filter((t) => !outOnly || t.amount < 0);
  const chosen = shown.filter((t) => !skip.has(t.row));
  const fileName = requestFileName(String(client?.Title || "client"), today);
  const draft = useMemo(() => requestEmail({ greeting: client ? emailGreeting(client) : "Hi,", txns: chosen, today, signName: prefs.signName || user || "", fileName }),
    [client, chosen.map((t) => t.row).join(","), prefs.signName, user, fileName]); // eslint-disable-line react-hooks/exhaustive-deps
  const subject = edited.subject ?? draft.subject;
  const body = edited.body ?? draft.body;
  const to = edited.to ?? String(client?.Email || "");

  const load = async (f: File | undefined) => {
    if (!f) return;
    setError(""); setDone(null); setSkip(new Set()); setEdited((e) => ({ to: e.to }));
    try {
      const rows = await readFile(f);
      if (!rows.length) { setError("That file is empty, or isn't a spreadsheet the planner can read. Use an Excel (.xlsx) or CSV file."); return; }
      const header = findHeader(rows);
      setFile({ name: f.name, rows, header, map: guessColumns(rows[header] || []) });
    } catch {
      setError("Couldn't read that file. Save it as Excel (.xlsx) or CSV and try again.");
    }
  };
  const setCol = (k: keyof ColumnMap, v: number) => file && setFile({ ...file, map: { ...file.map, [k]: v, ...(k === "amount" && v >= 0 ? { out: NO_COLUMN, in: NO_COLUMN } : {}), ...((k === "out" || k === "in") && v >= 0 ? { amount: NO_COLUMN } : {}) } });
  const headerCells = file ? (file.rows[file.header] || []).map((c, i) => String(c ?? "").trim() || `Column ${i + 1}`) : [];
  const toggle = (row: number) => setSkip((s) => { const n = new Set(s); if (n.has(row)) n.delete(row); else n.add(row); return n; });

  const attachment = async () => workbook([{ name: "Receipts needed", rows: requestSheet(chosen) }]);
  const download = async () => downloadFile(await attachment(), fileName, XLSX_TYPE);

  const toOutlook = async () => {
    if (!client) return setError("Choose the client first.");
    if (!chosen.length) return setError("Tick at least one transaction.");
    setBusy("outlook"); setError("");
    try {
      const msg = await store.graph.post<{ id: string; webLink?: string }>("/me/messages", {
        subject, body: { contentType: "HTML", content: toHtml(body, prefs.emailSignature) },
        toRecipients: to.trim() ? to.split(/[;,]\s*/).filter(Boolean).map((address) => ({ emailAddress: { address } })) : [],
      });
      await store.graph.post(`/me/messages/${encodeURIComponent(msg.id)}/attachments`, {
        "@odata.type": "#microsoft.graph.fileAttachment", name: fileName, contentType: XLSX_TYPE, contentBytes: toBase64(await attachment()),
      });
      const now = new Date().toISOString();
      await create("Communications", {
        Key: newKey("C"), Title: subject, ClientKey: client.Key, JobKey: "", Kind: "email", Status: "outlook", Subject: subject, Body: body,
        Brief: `Receipt request: ${chosen.length} transactions from ${file?.name || "a spreadsheet"}`, ToEmail: to, FileName: fileName, OutlookUrl: msg.webLink || "", Created: now, Updated: now,
      });
      if (chase) {
        await create("Tasks", {
          Key: newKey("T"), Title: `Chase receipts from ${client.Title} (${chosen.length})`, ClientKey: client.Key, DueDate: draft.replyBy, Status: "Open",
          Notes: `Asked for the invoices and receipts for ${chosen.length} transactions (${gbp(chosen.reduce((s, t) => s + Math.abs(t.amount), 0))}) on ${fmtDate(today)}. The list is in ${fileName}.`,
        });
      }
      setDone({ to, n: chosen.length, task: chase });
    } catch (e: any) {
      if (e?.status === 403 || e?.status === 401) setError("Outlook didn't allow it. Use Allow Outlook drafts below, then try again.");
      else setError("Couldn't put it in your Outlook drafts. Try again.");
    } finally {
      setBusy("");
    }
  };

  const total = chosen.reduce((s, t) => s + Math.abs(t.amount), 0);
  return (
    <div className="page rr-page">
      <CommsTabs current="letters" />
      <div className="page-head"><div>
        <h1>Request receipts</h1>
        <p className="muted tip" style={{ margin: "4px 0 0" }}>Drop a spreadsheet of transactions. Tick the ones you need paperwork for, and an email asking the client for the invoices and receipts goes into your Outlook drafts, with the list attached for them to fill in.</p>
      </div></div>

      <section className="card pad stack rr-step">
        <h2 className="rr-h"><span className="rr-n">1</span>Client and transactions</h2>
        <div className="form" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)" }}>
          <label>Client
            <select className="input" value={clientKey} onChange={(e) => { setClientKey(e.target.value); setEdited((x) => ({ ...x, to: undefined })); }}>
              <option value="">Choose a client…</option>
              {clients.map((c) => <option key={String(c.Key)} value={String(c.Key)}>{String(c.Title)}</option>)}
            </select>
          </label>
          <label>Send to
            <input className="input" type="email" value={to} placeholder={client ? "No email address on the client" : ""} onChange={(e) => setEdited((x) => ({ ...x, to: e.target.value }))} />
          </label>
        </div>
        <div className={`rr-drop${over ? " over" : ""}`} role="button" tabIndex={0}
          onClick={() => input.current?.click()} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); void load(e.dataTransfer.files[0]); }}>
          <Icon name="download" size={22} />
          <span><strong>{file ? file.name : "Drop the spreadsheet here"}</strong><span className="muted">{file ? ` · ${all.length} transactions found · click or drop to use another file` : " or click to choose one. Excel (.xlsx) or CSV, such as a bank export or Xero's missing receipts list."}</span></span>
          <input ref={input} type="file" accept=".xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e) => { void load(e.target.files?.[0]); e.target.value = ""; }} />
        </div>
        {file && (
          <div className="rr-cols">
            <span className="muted">Columns used:</span>
            {([["date", "Date"], ["description", "Description"], ["reference", "Reference"], ["amount", "Amount"], ["out", "Money out"], ["in", "Money in"]] as [keyof ColumnMap, string][]).map(([k, label]) => (
              <label key={k}>{label}
                <select className="input" value={file.map[k]} onChange={(e) => setCol(k, Number(e.target.value))}>
                  <option value={NO_COLUMN}>None</option>
                  {headerCells.map((h, i) => <option key={i} value={i}>{h}</option>)}
                </select>
              </label>
            ))}
          </div>
        )}
      </section>

      {file && (
        <section className="card pad stack rr-step">
          <div className="row-wrap" style={{ justifyContent: "space-between" }}>
            <h2 className="rr-h"><span className="rr-n">2</span>Which ones need a receipt or invoice?</h2>
            <span className="row-wrap" style={{ gap: 8 }}>
              <label className="row-wrap" style={{ gap: 6, fontSize: 14 }}><input type="checkbox" checked={outOnly} onChange={(e) => setOutOnly(e.target.checked)} /> Money out only</label>
              <button type="button" className="btn small" onClick={() => setSkip(new Set())}>Tick all</button>
              <button type="button" className="btn small" onClick={() => setSkip(new Set(shown.map((t) => t.row)))}>Untick all</button>
            </span>
          </div>
          {shown.length === 0 ? <p className="muted">No transactions with a date and an amount were found. Check the columns above.</p> : (
            <div className="table-wrap rr-table">
              <table className="grid">
                <thead><tr><th scope="col"><span className="sr-only">Ask about it</span></th><th scope="col">Date</th><th scope="col">Description</th><th scope="col">Reference</th><th scope="col" className="num">Amount</th></tr></thead>
                <tbody>
                  {shown.map((t) => (
                    <tr key={t.row} className={skip.has(t.row) ? "rr-off" : ""} onClick={() => toggle(t.row)}>
                      <td><input type="checkbox" checked={!skip.has(t.row)} onChange={() => toggle(t.row)} onClick={(e) => e.stopPropagation()} aria-label={`Ask about ${t.description || "this transaction"} on ${fmtDate(t.date)}`} /></td>
                      <td className="mono" style={{ whiteSpace: "nowrap" }}>{fmtDate(t.date)}</td>
                      <td>{t.description || <span className="muted">(none)</span>}</td>
                      <td className="muted">{t.reference}</td>
                      <td className={`num mono${t.amount < 0 ? "" : " rr-in"}`}>{t.amount < 0 ? "-" : ""}{gbp(t.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="rr-sum"><strong>{chosen.length}</strong> of {shown.length} ticked · {gbp(total)}</p>
        </section>
      )}

      {file && chosen.length > 0 && (
        <section className="card pad stack rr-step">
          <h2 className="rr-h"><span className="rr-n">3</span>The email</h2>
          <label>Subject<input className="input" value={subject} onChange={(e) => setEdited((x) => ({ ...x, subject: e.target.value }))} /></label>
          <label>Message<textarea className="input" rows={14} value={body} onChange={(e) => setEdited((x) => ({ ...x, body: e.target.value }))} /></label>
          {(edited.subject !== undefined || edited.body !== undefined) && <button type="button" className="linkbtn" style={{ alignSelf: "flex-start" }} onClick={() => setEdited((x) => ({ to: x.to }))}>Go back to the wording the planner wrote</button>}
          <p className="rr-attach"><Icon name="form" size={16} /> Attached: <strong>{fileName}</strong>, the {chosen.length} transaction{chosen.length === 1 ? "" : "s"} with columns for the client to say whether they've sent the receipt and what each one was for.
            <button type="button" className="linkbtn" onClick={() => void download()}>Download a copy</button></p>
          <label className="row-wrap" style={{ gap: 8, fontSize: 14 }}><input type="checkbox" checked={chase} onChange={(e) => setChase(e.target.checked)} /> Add a task to chase it on {fmtDate(draft.replyBy)}</label>
          {error && <p className="error-text" role="alert">{error}</p>}
          {done ? (
            <div className="alert" role="status" style={{ borderColor: "var(--green)", background: "var(--green-soft)", color: "var(--green)" }}>
              <strong>In your Outlook drafts{done.to ? ` to ${done.to}` : " (add who it's to in Outlook)"}, with the spreadsheet attached.</strong>
              <span>Check it and send it from Outlook. It's kept on {client?.Title}'s record{done.task ? `, and there's a task to chase it on ${fmtDate(draft.replyBy)}` : ""}. <a href={href("clients", String(client?.Key), "comms")}>Open their emails</a></span>
            </div>
          ) : (
            <div className="form-actions">
              {!mailAllowed() && <button type="button" className="btn" onClick={() => void addScope(MAIL_SCOPE, true)}>Allow Outlook drafts</button>}
              <button type="button" className="btn primary" disabled={!!busy || !client} onClick={() => void toOutlook()}><Icon name="mail" />{busy ? "Putting it in Outlook…" : "Put in my Outlook drafts"}</button>
            </div>
          )}
        </section>
      )}
      {!file && error && <p className="error-text" role="alert">{error}</p>}
    </div>
  );
}
