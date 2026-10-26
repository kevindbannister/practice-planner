// Documents › Create: pick a client (and a job), pick a template, check the merge fields, change the
// text for this one document if needed, preview the actual PDF, then download it or save it to the
// client's record (OneDrive and the Documents list). Fields with no value are flagged and left visible
// as {{field}} so a letter can't go out with a gap nobody noticed; unknown fields stop the document.
// Documents › History: everything made so far.
import { useEffect, useMemo, useRef, useState } from "react";
import { addScope } from "../lib/auth";
import { LETTERS_FOLDER, clientFolder, emailGreeting, oneLine, toBase64 } from "../lib/comms";
import { DOCX_TYPE } from "../lib/docx";
import { renderDocx } from "../lib/docWord";
import { toHtml as emailHtml } from "../lib/richText";
import { Client } from "../lib/domain";
import { Row } from "../lib/schema";
import { Category, DocTemplate, CATEGORIES } from "../lib/docTemplates";
import { DocContent, DocLayout, readContent } from "../lib/docModel";
import { FieldDef, checkFields, fieldsFor, fieldsUsed, fillContent, fillText, resolveValues } from "../lib/docFields";
import { fmtDate, isOpen, todayIso } from "../lib/domain";
import { newKey } from "../lib/planning";
import { useRoute } from "./bits";
import { MAIL_SCOPE, MAIL_SEND_SCOPE, downloadFile, mailAllowed, sendAllowed, useCommsPrefs } from "./commsKit";
import { DocEditor } from "./DocEditor";
import { PdfPreview } from "./DocsPreview";
import { DocRecord, documentFileName, makePdf, nextReference, snapshotOf, useDocs, useFieldCtx, useLeaveGuard } from "./docsKit";
import { useData, useIndex } from "./data";

const PDF_TYPE = "application/pdf";
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

export function CreateDocument() {
  const docs = useDocs();
  const { data, store } = useData();
  const idx = useIndex();
  const { query } = useRoute();
  const ctxFor = useFieldCtx();

  const [clientKey, setClientKey] = useState(query.get("client") || "");
  const [jobKey, setJobKey] = useState(query.get("job") || "");
  const firstTemplate = query.get("template") || "";
  const [templateId, setTemplateId] = useState(firstTemplate);
  const [clientText, setClientText] = useState(() => data.clients.find((c) => c.Key === (query.get("client") || ""))?.Title || "");
  const [draft, setDraft] = useState<DocContent | null>(null);
  const [layout, setLayout] = useState<DocLayout | null>(null);
  const [resetKey, setResetKey] = useState("0");
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [title, setTitle] = useState("");
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [pdf, setPdf] = useState<{ bytes: Uint8Array; pages: number } | null>(null);
  const [making, setMaking] = useState(false);
  const [ack, setAck] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ rev: number; url: string; name: string; bytes: Uint8Array; row: Row; title: string } | null>(null);
  const [rev, setRev] = useState(0);
  const reference = useRef("");
  const [touched, setTouched] = useState(false); // the text or a value was changed by hand since the last save
  useLeaveGuard(touched, "This document has changes that haven't been saved. Leave without saving?");

  const template: DocTemplate | undefined = templateId ? docs.find(templateId) : undefined;
  const client = data.clients.find((c) => c.Key === clientKey);
  const job = data.jobs.find((j) => j.Key === jobKey);
  const branding = docs.brand(template?.brandingId);
  if (!reference.current) reference.current = nextReference(docs.documents);
  const savedRev = useRef<number | null>(null);
  // an edit after saving makes a new document, so it gets the next reference
  const bump = () => setRev((r) => {
    if (savedRev.current === r) { reference.current = nextReference([...docs.documents, { reference: reference.current }]); savedRev.current = null; }
    return r + 1;
  });

  // choosing a template (or arriving with one) starts a working copy of it
  useEffect(() => {
    const t = templateId ? docs.find(templateId) : undefined;
    if (!t) return;
    setDraft(clone(t.content));
    setLayout(clone(t.layout));
    setResetKey(`${t.id}-${t.version}-${Date.now()}`);
    setOverrides({});
    setPdf(null);
    setAck(false);
    setTitle((old) => old || "");
    bump();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId, docs.all.length]);
  // wait for the lists when arriving by a link with a template
  useEffect(() => { if (firstTemplate && !templateId) setTemplateId(firstTemplate); }, [firstTemplate, templateId]);

  const jobs = useMemo(() => data.jobs.filter((j) => j.ClientKey === clientKey).sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)) || String(b.PeriodEnd || "").localeCompare(String(a.PeriodEnd || ""))), [data.jobs, clientKey]);
  const jobLabel = (j: (typeof jobs)[number]) => `${idx.serviceName.get(String(j.ServiceKey || "")) || j.Title}${j.PeriodEnd ? `, ${fmtDate(String(j.PeriodEnd))}` : ""}${isOpen(j) ? "" : " (done)"}`;

  const ctx = useMemo(() => ctxFor(clientKey, jobKey, branding, reference.current), [ctxFor, clientKey, jobKey, branding]);
  const computed = useMemo(() => resolveValues(ctx), [ctx]);
  const values = useMemo(() => ({ ...computed, ...Object.fromEntries(Object.entries(overrides).filter(([, v]) => String(v).trim())) }), [computed, overrides]);
  const headerText = (layout?.header || branding.header || "");
  const footerText = (layout?.footer || branding.footer || "");
  const used = useMemo(() => (draft ? fieldsUsed(draft, [headerText, footerText]) : []), [draft, headerText, footerText]);
  const check = useMemo(() => checkFields(used, values), [used, values]);
  const allFields = useMemo(() => fieldsFor(branding), [branding]);
  const label = (k: string) => allFields.find((f: FieldDef) => f.key === k)?.label || k;
  const blocked = !client || !draft || !!check.unknown.length || (!!check.missing.length && !ack);
  const docTitle = title.trim() || `${template?.name || "Document"}${client ? ` – ${client.Title}` : ""}`;

  const build = async () => {
    if (!draft || !layout) throw new Error("Choose a template first.");
    const filled = fillContent(draft, values);
    const lay: DocLayout = { ...layout, header: fillText(headerText, values), footer: fillText(footerText, values) };
    return { filled, lay, ...(await makePdf({ content: filled, layout: lay, branding, title: docTitle, reference: reference.current, author: docs.user })) };
  };
  // the preview follows the document while it is showing
  useEffect(() => {
    if (tab !== "preview" || !draft) return;
    let live = true;
    setMaking(true);
    setError("");
    const t = window.setTimeout(async () => {
      try {
        const out = await build();
        if (live) setPdf({ bytes: out.bytes, pages: out.pages });
      } catch {
        if (live) setError("The preview couldn't be made.");
      } finally {
        if (live) setMaking(false);
      }
    }, 300);
    return () => { live = false; window.clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, rev, values, layout]);

  const fileName = () => documentFileName(docTitle, todayIso(), reference.current);
  const download = async () => {
    setError("");
    try {
      const out = await build();
      downloadFile(out.bytes, fileName(), PDF_TYPE);
    } catch {
      setError("Couldn't make the PDF.");
    }
  };
  const downloadWord = async () => {
    setError("");
    try {
      const out = await build();
      downloadFile(await renderDocx({ content: out.filled, layout: out.lay, branding, title: docTitle }), fileName().replace(/\.pdf$/, ".docx"), DOCX_TYPE);
    } catch {
      setError("Couldn't make the Word file.");
    }
  };
  const save = async () => {
    if (!client || !template) return;
    setSaving(true);
    setError("");
    try {
      const out = await build();
      const name = fileName();
      let url = "";
      try {
        const path = `/me/drive/root:/${encodeURIComponent(LETTERS_FOLDER)}/${encodeURIComponent(clientFolder(client.Title))}/${encodeURIComponent(name)}:/content`;
        const item = await store.graph.put<{ webUrl?: string }>(path, out.bytes, PDF_TYPE);
        url = item.webUrl || "";
      } catch {
        throw new Error("Couldn't save the file to OneDrive. The document hasn't been recorded; download it, or try again.");
      }
      const row = await docs.create("Documents", {
        Key: newKey("D"), Title: docTitle, ClientKey: client.Key, JobKey: job?.Key || "", TemplateKey: template.id, TemplateVersion: template.version, TemplateName: template.name,
        Category: template.category, Reference: reference.current, Created: new Date().toISOString(), CreatedBy: docs.user || "", BrandingId: branding.id,
        FileUrl: url, FileName: name, Pages: out.pages, Status: "Saved", Snapshot: snapshotOf(out.filled, out.lay, { values, templateVersion: template.version }),
      });
      setSaved({ rev, url, name, bytes: out.bytes, row, title: docTitle });
      savedRev.current = rev;
      setTouched(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the document.");
    } finally {
      setSaving(false);
    }
  };

  const byCategory = (cat: Category) => docs.all.filter((t) => !t.archived && t.category === cat);
  const justSaved = saved && saved.rev === rev;

  return (
    <div className="create-grid">
      <aside className="card pad stack create-side">
        <label className="doc-field">
          <span>Client</span>
          <input className="input" list="doc-clients" value={clientText} placeholder="Start typing a client name" onChange={(e) => {
            setClientText(e.target.value);
            const c = data.clients.find((x) => x.Title === e.target.value);
            setClientKey(c?.Key || "");
            if (!c || c.Key !== clientKey) setJobKey("");
            setSaved(null);
            bump();
          }} />
          <datalist id="doc-clients">{data.clients.map((c) => <option key={c.Key} value={c.Title} />)}</datalist>
        </label>
        <label className="doc-field">
          <span>Job (optional)</span>
          <select className="input" value={jobKey} disabled={!client} onChange={(e) => { setJobKey(e.target.value); bump(); }}>
            <option value="">Not linked to a job</option>
            {jobs.map((j) => <option key={j.Key} value={j.Key}>{jobLabel(j)}</option>)}
          </select>
        </label>
        <label className="doc-field">
          <span>Template</span>
          <select className="input" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            <option value="">Choose a template…</option>
            {CATEGORIES.map((cat) => byCategory(cat).length ? (
              <optgroup key={cat} label={cat}>{byCategory(cat).map((t) => <option key={t.id} value={t.id}>{t.name}{t.isDefault ? " (default)" : ""}</option>)}</optgroup>
            ) : null)}
          </select>
        </label>
        <label className="doc-field">
          <span>Document title</span>
          <input className="input" value={title} placeholder={docTitle} onChange={(e) => { setTitle(e.target.value); bump(); }} />
        </label>
        <p className="muted" style={{ margin: 0 }}>Reference {reference.current}</p>

        {draft && (
          <div className="stack">
            <h3 style={{ margin: 0 }}>Merge fields</h3>
            {!used.length && <p className="muted" style={{ margin: 0 }}>This document uses no merge fields.</p>}
            {used.map((k) => {
              const known = k in computed;
              const empty = known && !(values[k] || "").trim();
              return (
                <label key={k} className="doc-field field-row">
                  <span>{label(k)} {!known && <span className="chip red">Unknown field</span>} {empty && <span className="chip amber">No value</span>}</span>
                  {known && (
                    (computed[k] || "").includes("\n") || (overrides[k] || "").includes("\n")
                      ? <textarea className="input" rows={3} value={overrides[k] ?? computed[k]} onChange={(e) => { setOverrides({ ...overrides, [k]: e.target.value }); setTouched(true); bump(); }} />
                      : <input className="input" value={overrides[k] ?? computed[k]} onChange={(e) => { setOverrides({ ...overrides, [k]: e.target.value }); setTouched(true); bump(); }} />
                  )}
                  {!known && <small className="muted">{`{{${k}}}`} isn't a field. Fix it in the text.</small>}
                </label>
              );
            })}
          </div>
        )}
      </aside>

      <section className="stack create-main">
        {!draft ? (
          <div className="card pad"><p className="muted" style={{ margin: 0 }}>Choose a template to begin. Every starter and your own templates are under <a href="#/comms/documents/templates">Templates</a>.</p></div>
        ) : (
          <>
            <div className="row-wrap">
              <div className="seg" role="group" aria-label="View">
                <button type="button" aria-pressed={tab === "edit"} onClick={() => setTab("edit")}>Edit text</button>
                <button type="button" aria-pressed={tab === "preview"} onClick={() => setTab("preview")}>Preview PDF</button>
              </div>
              {pdf && tab === "preview" && <span className="muted">{pdf.pages} page{pdf.pages === 1 ? "" : "s"}</span>}
              {making && <span className="muted">Making preview…</span>}
            </div>
            {!client && <p className="chip amber" role="status">Choose a client to make the document.</p>}
            {!!check.unknown.length && <p className="error-text" role="alert">The text uses fields that don't exist: {check.unknown.map((k) => `{{${k}}}`).join(", ")}. Correct or remove them before making the document.</p>}
            {!!check.missing.length && (
              <div className="import-list warn" role="alert">
                <strong>These fields have no value: {check.missing.map(label).join(", ")}.</strong>
                <div>Fill them in on the left, or they will appear in the document as {`{{field}}`}.</div>
                <label className="check"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> Make the document anyway</label>
              </div>
            )}
            <div hidden={tab !== "edit"}>
              <DocEditor value={draft} resetKey={resetKey} onChange={(c) => { setDraft(c); setTouched(true); bump(); }} layout={layout!} onLayout={(l) => { setLayout(l); bump(); }} fields={allFields} branding={branding} />
            </div>
            {tab === "preview" && <PdfPreview bytes={pdf?.bytes || null} />}
            <div className="form-actions">
              <button type="button" className="btn" disabled={blocked} onClick={download}>Download PDF</button>
              <button type="button" className="btn" disabled={blocked} onClick={downloadWord} title="An editable Word version of the same document">Download Word</button>
              <button type="button" className="btn primary" disabled={blocked || saving || !!justSaved} onClick={save}>{saving ? "Saving…" : justSaved ? "Saved to client" : "Save to client record"}</button>
              {justSaved && <span role="status" className="muted">Saved as {saved!.name}{saved!.url ? <> · <a href={saved!.url} target="_blank" rel="noopener noreferrer">Open in OneDrive</a></> : null} · <a href="#/comms/documents/history">See history</a></span>}
              {error && <span className="error-text" role="alert">{error}</span>}
            </div>
            {justSaved && client && <EmailPanel key={saved!.row.Key as string} client={client} saved={saved!} signatory={branding.signatoryName} />}
          </>
        )}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ history

export function DocumentHistory({ clientKey }: { clientKey?: string }) {
  const docs = useDocs();
  const { data } = useData();
  const [client, setClient] = useState(clientKey || "");
  const [cat, setCat] = useState("");
  const [q, setQ] = useState("");
  const name = (k: string) => data.clients.find((c) => c.Key === k)?.Title || "";
  const rows = docs.documents.filter((d: DocRecord) => (!client || d.clientKey === client) && (!cat || d.category === cat) && (!q.trim() || `${d.title} ${d.reference} ${name(d.clientKey)} ${d.templateName}`.toLowerCase().includes(q.trim().toLowerCase())));
  const jobText = (k: string) => { const j = data.jobs.find((x) => x.Key === k); return j ? j.Title : ""; };
  return (
    <div className="stack">
      {!clientKey && (
        <div className="row-wrap">
          <input className="input search" type="search" placeholder="Search documents" aria-label="Search documents" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input" aria-label="Client" value={client} onChange={(e) => setClient(e.target.value)}>
            <option value="">All clients</option>
            {data.clients.map((c) => <option key={c.Key} value={c.Key}>{c.Title}</option>)}
          </select>
          <select className="input" aria-label="Category" value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">All categories</option>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
      )}
      {rows.length ? (
        <div className="table-wrap">
          <table className="bank-table">
            <thead><tr><th>Date</th><th>Document</th><th>Client</th><th>Template</th><th className="num">Pages</th><th>Status</th><th /></tr></thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.key}>
                  <td>{d.created ? fmtDate(d.created.slice(0, 10)) : ""}</td>
                  <td><strong>{d.title}</strong><div className="muted">{d.reference}{d.jobKey && jobText(d.jobKey) ? ` · ${jobText(d.jobKey)}` : ""}</div></td>
                  <td>{name(d.clientKey)}</td>
                  <td>{d.templateName}{d.templateVersion ? ` (v${d.templateVersion})` : ""}</td>
                  <td className="num">{d.pages || ""}</td>
                  <td>{d.sentOn ? `Sent ${fmtDate(d.sentOn.slice(0, 10))}` : d.status}</td>
                  <td>{d.fileUrl && <a className="btn small" href={d.fileUrl} target="_blank" rel="noopener noreferrer">Open</a>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="muted">{docs.documents.length ? "No documents match." : "No documents have been made yet."}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ emailing a saved document

/** Email a saved document: a draft in Outlook with the PDF attached, and sending only after an explicit second step. */
export function EmailPanel({ client, saved, signatory, onSent, intro }: { client: Client; saved: { name: string; bytes: Uint8Array; row: Row; title: string }; signatory: string; onSent?: (to: string) => void | Promise<void>; intro?: string }) {
  const docs = useDocs();
  const prefs = useCommsPrefs();
  const [to, setTo] = useState(String(client.Email || ""));
  const [subject, setSubject] = useState(saved.title);
  const [message, setMessage] = useState(`${emailGreeting(client)}\n\n${intro || `Please find attached ${saved.title.split(" – ")[0].replace(/^./, (c) => c.toLowerCase())}.`}\n\nKind regards,\n${(signatory || prefs.signName || "").split(" ")[0]}`);
  const [step, setStep] = useState<"form" | "drafted" | "confirm" | "sent">("form");
  const [draft, setDraft] = useState<{ id: string; webLink?: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const recipients = to.split(/[;,]\s*/).map((x) => x.trim()).filter(Boolean);
  const valid = recipients.length > 0 && recipients.every((r) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r));

  const track = async (patch: Row) => { await docs.update("Documents", saved.row, patch); };
  const fail = (e: unknown, what: string) => {
    const status = (e as { status?: number })?.status;
    setError(status === 401 || status === 403 ? "Outlook didn't allow that. Use the Allow button, then try again." : `Couldn't ${what}. Try again.`);
  };
  const makeDraft = async () => {
    setBusy(true);
    setError("");
    try {
      const msg = await docs.store.graph.post<{ id: string; webLink?: string }>("/me/messages", {
        subject: oneLine(subject) || "Document",
        body: { contentType: "HTML", content: emailHtml(message, prefs.emailSignature) },
        toRecipients: recipients.map((address) => ({ emailAddress: { address } })),
      });
      await docs.store.graph.post(`/me/messages/${encodeURIComponent(msg.id)}/attachments`, {
        "@odata.type": "#microsoft.graph.fileAttachment", name: saved.name, contentType: "application/pdf", contentBytes: toBase64(saved.bytes),
      });
      setDraft(msg);
      setStep("drafted");
      await track({ Status: "In Outlook drafts", OutlookUrl: msg.webLink || "", SentTo: recipients.join("; ") });
    } catch (e) {
      fail(e, "make the Outlook draft");
    } finally {
      setBusy(false);
    }
  };
  const send = async () => {
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      await docs.store.graph.post(`/me/messages/${encodeURIComponent(draft.id)}/send`, {});
      setStep("sent");
      await track({ Status: "Sent", SentOn: new Date().toISOString(), SentTo: recipients.join("; ") });
      await onSent?.(recipients.join("; "));
    } catch (e) {
      fail(e, "send the email");
      setStep("drafted");
    } finally {
      setBusy(false);
    }
  };
  const allow = async (scope: string) => { await addScope(scope, true); };

  return (
    <div className="card pad stack">
      <h3 style={{ margin: 0 }}>Email this document</h3>
      {step === "form" && (
        <>
          <p className="muted" style={{ margin: 0 }}>This puts a draft in your Outlook with the PDF attached. Nothing is sent until you confirm.</p>
          <label className="doc-field"><span>To</span><input className="input" value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@example.com; another@example.com" /></label>
          <label className="doc-field"><span>Subject</span><input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
          <label className="doc-field"><span>Message</span><textarea className="input" rows={5} value={message} onChange={(e) => setMessage(e.target.value)} /></label>
          {to.trim() && !valid && <p className="error-text">Check the email address.</p>}
          <div className="form-actions">
            {mailAllowed() ? (
              <button type="button" className="btn primary" disabled={!valid || busy} onClick={makeDraft}>{busy ? "Making draft…" : "Create Outlook draft"}</button>
            ) : (
              <button type="button" className="btn primary" onClick={() => allow(MAIL_SCOPE)}>Allow Outlook drafts</button>
            )}
          </div>
        </>
      )}
      {(step === "drafted" || step === "confirm") && draft && (
        <>
          <p role="status" style={{ margin: 0 }}>The draft is in your Outlook drafts{draft.webLink ? <> · <a href={draft.webLink} target="_blank" rel="noopener noreferrer">Open it in Outlook</a></> : null}. Check it there, or send it from here.</p>
          {step === "drafted" && (
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => setStep("confirm")}>Send…</button>
            </div>
          )}
          {step === "confirm" && (
            <div className="import-list warn" role="alertdialog" aria-label="Confirm sending">
              <strong>Send this email now?</strong>
              <div>To: {recipients.join(", ")}</div>
              <div>Subject: {subject}</div>
              <div>Attachment: {saved.name}</div>
              <div className="form-actions">
                {sendAllowed() ? (
                  <button type="button" className="btn primary" disabled={busy} onClick={send}>{busy ? "Sending…" : "Yes, send it"}</button>
                ) : (
                  <button type="button" className="btn primary" onClick={() => allow(MAIL_SEND_SCOPE)}>Allow sending from here</button>
                )}
                <button type="button" className="btn" disabled={busy} onClick={() => setStep("drafted")}>Cancel</button>
              </div>
            </div>
          )}
        </>
      )}
      {step === "sent" && <p role="status" style={{ margin: 0 }}>Sent to {recipients.join(", ")}. It is recorded in the document history.</p>}
      {error && <p className="error-text" role="alert">{error}</p>}
    </div>
  );
}
