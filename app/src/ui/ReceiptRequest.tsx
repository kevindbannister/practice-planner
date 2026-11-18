// Request receipts: drop the client's spreadsheet of transactions and the planner writes the email asking for the invoices and
// receipts, from the practice's template, with the spreadsheet attached just as it is. It goes into your Outlook drafts to check
// and send, is kept on the client's record, and can add a task to chase it. The template is edited on the same page.
import { useMemo, useRef, useState } from "react";
import { addScope } from "../lib/auth";
import { emailGreeting, toBase64 } from "../lib/comms";
import { Client, fmtDate, todayIso } from "../lib/domain";
import { newKey } from "../lib/planning";
import { MAX_ATTACHMENT, RECEIPT_FIELDS, RECEIPT_TEMPLATE_KEY, ReceiptTemplate, fillReceiptTemplate, readReceiptTemplate } from "../lib/receiptRequest";
import { toHtml } from "../lib/richText";
import { Icon, href, useRoute } from "./bits";
import { CommsTabs, MAIL_SCOPE, mailAllowed, useCommsPrefs } from "./commsKit";
import { readSetting, useData } from "./data";

const TYPES: Record<string, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xls: "application/vnd.ms-excel", csv: "text/csv", pdf: "application/pdf",
};
const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function ReceiptRequestPage() {
  const { data, user, store, create, saveSetting } = useData();
  const prefs = useCommsPrefs();
  const { query } = useRoute();
  const today = todayIso();
  const saved = useMemo(() => readReceiptTemplate(readSetting(data.settings, RECEIPT_TEMPLATE_KEY)), [data.settings]);
  const clients = useMemo(() => [...data.clients].sort((a, b) => String(a.Title).localeCompare(String(b.Title))), [data.clients]);
  const [clientKey, setClientKey] = useState(query.get("client") || "");
  const client = data.clients.find((c) => c.Key === clientKey) as Client | undefined;
  const [file, setFile] = useState<{ name: string; type: string; bytes: Uint8Array } | null>(null);
  const [edited, setEdited] = useState<{ subject?: string; body?: string; to?: string }>({});
  const [chase, setChase] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ to: string; task: boolean } | null>(null);
  const [over, setOver] = useState(false);
  const [editing, setEditing] = useState<ReceiptTemplate | null>(null);
  const [tplNote, setTplNote] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const draft = fillReceiptTemplate(saved, { greeting: client ? emailGreeting(client) : "Hi,", client: String(client?.Title || ""), file: file?.name || "", today, sender: prefs.signName || user || "" });
  const subject = edited.subject ?? draft.subject;
  const body = edited.body ?? draft.body;
  const to = edited.to ?? String(client?.Email || "");

  const load = async (f: File | undefined) => {
    if (!f) return;
    setError(""); setDone(null);
    if (f.size > MAX_ATTACHMENT) { setError(`${f.name} is ${kb(f.size)}. Outlook drafts made from the planner can carry up to 3 MB; attach it in Outlook instead, or save a smaller copy.`); return; }
    const ext = (f.name.split(".").pop() || "").toLowerCase();
    setFile({ name: f.name, type: f.type || TYPES[ext] || "application/octet-stream", bytes: new Uint8Array(await f.arrayBuffer()) });
  };

  const toOutlook = async () => {
    if (!client) return setError("Choose the client first.");
    if (!file) return setError("Drop the spreadsheet to attach first.");
    setBusy("outlook"); setError("");
    try {
      const msg = await store.graph.post<{ id: string; webLink?: string }>("/me/messages", {
        subject, body: { contentType: "HTML", content: toHtml(body, prefs.emailSignature) },
        toRecipients: to.trim() ? to.split(/[;,]\s*/).filter(Boolean).map((address) => ({ emailAddress: { address } })) : [],
      });
      await store.graph.post(`/me/messages/${encodeURIComponent(msg.id)}/attachments`, {
        "@odata.type": "#microsoft.graph.fileAttachment", name: file.name, contentType: file.type, contentBytes: toBase64(file.bytes),
      });
      const now = new Date().toISOString();
      await create("Communications", {
        Key: newKey("C"), Title: subject, ClientKey: client.Key, JobKey: "", Kind: "email", Status: "outlook", Subject: subject, Body: body,
        Brief: `Receipt request, with ${file.name} attached`, ToEmail: to, FileName: file.name, OutlookUrl: msg.webLink || "", Created: now, Updated: now,
      });
      if (chase) {
        await create("Tasks", {
          Key: newKey("T"), Title: `Chase receipts from ${client.Title}`, ClientKey: client.Key, DueDate: draft.replyBy, Status: "Open",
          Notes: `Asked for the invoices and receipts for the transactions in ${file.name} on ${fmtDate(today)}.`,
        });
      }
      setDone({ to, task: chase });
    } catch (e: any) {
      if (e?.status === 403 || e?.status === 401) setError("Outlook didn't allow it. Use Allow Outlook drafts below, then try again.");
      else setError("Couldn't put it in your Outlook drafts. Try again.");
    } finally {
      setBusy("");
    }
  };

  const saveTemplate = async (t: ReceiptTemplate) => {
    try { await saveSetting(RECEIPT_TEMPLATE_KEY, t); setEditing(null); setEdited((x) => ({ to: x.to })); setTplNote("Template saved. Every receipt request uses it from now on."); }
    catch { setTplNote("Couldn't save the template. Try again."); }
  };

  return (
    <div className="page rr-page">
      <CommsTabs current="letters" />
      <div className="page-head"><div>
        <h1>Request receipts</h1>
        <p className="muted tip" style={{ margin: "4px 0 0" }}>Drop the client's spreadsheet of transactions. It's attached to an email asking for the invoices and receipts, written from your template, and put in your Outlook drafts.</p>
      </div></div>

      <section className="card pad stack rr-step">
        <h2 className="rr-h"><span className="rr-n">1</span>Client and spreadsheet</h2>
        <div className="form" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)" }}>
          <label>Client
            <select className="input" value={clientKey} onChange={(e) => { setClientKey(e.target.value); setEdited((x) => ({ ...x, to: undefined })); setDone(null); }}>
              <option value="">Choose a client…</option>
              {clients.map((c) => <option key={String(c.Key)} value={String(c.Key)}>{String(c.Title)}</option>)}
            </select>
          </label>
          <label>Send to
            <input className="input" type="email" value={to} placeholder={client ? "No email address on the client" : ""} onChange={(e) => setEdited((x) => ({ ...x, to: e.target.value }))} />
          </label>
        </div>
        <div className={`rr-drop${over ? " over" : ""}${file ? " has" : ""}`} role="button" tabIndex={0}
          onClick={() => input.current?.click()} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); void load(e.dataTransfer.files[0]); }}>
          <Icon name={file ? "check" : "download"} size={22} />
          <span><strong>{file ? file.name : "Drop the spreadsheet here"}</strong><span className="muted">{file ? ` · ${kb(file.bytes.length)} · attached as it is · click or drop to use another file` : " or click to choose it. It's attached to the email just as it is."}</span></span>
          <input ref={input} type="file" hidden onChange={(e) => { void load(e.target.files?.[0]); e.target.value = ""; }} />
        </div>
        {error && <p className="error-text" role="alert">{error}</p>}
      </section>

      <section className="card pad stack rr-step">
        <div className="row-wrap" style={{ justifyContent: "space-between" }}>
          <h2 className="rr-h"><span className="rr-n">2</span>The email</h2>
          {!editing && <button type="button" className="btn small" onClick={() => { setEditing(saved); setTplNote(""); }}><Icon name="edit" size={14} />Edit the template</button>}
        </div>
        {editing ? (
          <div className="rr-template stack">
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>The practice's wording for every receipt request. These gaps are filled in for each client:</p>
            <ul className="rr-fields">{RECEIPT_FIELDS.map(([k, what]) => <li key={k}><code>{`{{${k}}}`}</code> {what}</li>)}</ul>
            <label>Subject<input className="input" value={editing.subject} onChange={(e) => setEditing({ ...editing, subject: e.target.value })} /></label>
            <label>Message<textarea className="input" rows={12} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} /></label>
            <label style={{ maxWidth: 260 }}>Days the client has to reply<input className="input" type="number" min={1} max={90} value={editing.replyDays} onChange={(e) => setEditing({ ...editing, replyDays: Number(e.target.value) })} /></label>
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => setEditing(null)}>Cancel</button>
              <button type="button" className="btn primary" onClick={() => void saveTemplate(readReceiptTemplate(editing))}>Save the template</button>
            </div>
          </div>
        ) : (
          <>
            {tplNote && <p className="muted" role="status" style={{ margin: 0, fontSize: 13 }}>{tplNote}</p>}
            <label>Subject<input className="input" value={subject} onChange={(e) => setEdited((x) => ({ ...x, subject: e.target.value }))} /></label>
            <label>Message<textarea className="input" rows={11} value={body} onChange={(e) => setEdited((x) => ({ ...x, body: e.target.value }))} /></label>
            {(edited.subject !== undefined || edited.body !== undefined) && <button type="button" className="linkbtn" style={{ alignSelf: "flex-start" }} onClick={() => setEdited((x) => ({ to: x.to }))}>Go back to the template's wording</button>}
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>Changes here are for this email only. Your email signature (Settings, Letters and email) is added at the end.</p>
            <label className="row-wrap" style={{ gap: 8, fontSize: 14 }}><input type="checkbox" checked={chase} onChange={(e) => setChase(e.target.checked)} /> Add a task to chase it on {fmtDate(draft.replyBy)}</label>
            {done ? (
              <div className="alert" role="status" style={{ borderColor: "var(--green)", background: "var(--green-soft)", color: "var(--green)" }}>
                <strong>In your Outlook drafts{done.to ? ` to ${done.to}` : " (add who it's to in Outlook)"}, with {file?.name} attached.</strong>
                <span>Check it and send it from Outlook. It's kept on {client?.Title}'s record{done.task ? `, and there's a task to chase it on ${fmtDate(draft.replyBy)}` : ""}. <a href={href("clients", String(client?.Key), "comms")}>Open their emails</a></span>
              </div>
            ) : (
              <div className="form-actions">
                {!mailAllowed() && <button type="button" className="btn" onClick={() => void addScope(MAIL_SCOPE, true)}>Allow Outlook drafts</button>}
                <button type="button" className="btn primary" disabled={!!busy || !client || !file} onClick={() => void toOutlook()}><Icon name="mail" />{busy ? "Putting it in Outlook…" : "Put in my Outlook drafts"}</button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
