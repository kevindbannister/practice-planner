// Client portal, staff side: the documents shared with one client. Staff add a document (kept as a
// draft until published), choose who it is for, and see what the client has sent. Nothing reaches
// the client until it is published.
import { useEffect, useRef, useState } from "react";
import { Client, fmtDate } from "../lib/domain";
import { StaffDoc, StaffSigning } from "../lib/portalAdmin";
import { ACCEPT, MAX_MB, readFile, save, size } from "../portal/files";
import { say, usePortal } from "./portalKit";

const STATUS: Record<string, [string, string]> = {
  draft: ["Draft (client can't see it)", "amber"], published: ["Published", "green"], received: ["Sent by client", "blue"], "awaiting-approval": ["Waiting for client approval", "amber"], approved: ["Approved by client", "green"], declined: ["Declined by client", "red"], archived: ["Archived", ""],
};

export function ClientDocuments({ client }: { client: Client }) {
  const portal = usePortal();
  const [docs, setDocs] = useState<StaffDoc[] | null>(null);
  const [cats, setCats] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const load = () => portal.run((a) => a.documents(client.Key)).then((r) => { setDocs(r.documents); setCats(r.categories); setErr(""); }).catch((e) => setErr(say(e)));
  useEffect(() => { void load(); }, [client.Key]);
  if (portal.status && !portal.status.configured) return null;
  const people = portal.forClient(client.Key).filter((r) => r.person.status === "active");
  const shown = (docs || []).filter((d) => showArchived || d.status !== "archived");
  return (
    <section className="card pad stack" aria-labelledby="pd-h">
      <div className="row-wrap" style={{ justifyContent: "space-between" }}>
        <h2 id="pd-h" style={{ margin: 0, fontSize: 16 }}>Documents shared with {client.Title}</h2>
        <button type="button" className="btn small primary" onClick={() => setAdding(!adding)}>{adding ? "Close" : "Add a document"}</button>
      </div>
      <p className="muted" style={{ margin: 0 }}>Only published documents are visible to the client in the portal. Drafts and your internal notes never are.</p>
      {adding && <AddForm client={client} cats={cats} people={people.map((p) => ({ id: p.person.id, name: p.person.name || p.person.email, level: p.levelLabel }))} onDone={() => { setAdding(false); void load(); }} />}
      {err && <p className="import-list warn" role="alert">{err}</p>}
      {!docs && !err && <p className="muted">Loading…</p>}
      {docs && !shown.length && <p className="muted" style={{ margin: 0 }}>No documents yet.</p>}
      {shown.map((d) => <Doc key={d.id} d={d} cats={cats} onChanged={load} />)}
      {docs && <SigningPanel client={client} docs={docs} people={people.map((p) => ({ id: p.person.id, name: p.person.name || p.person.email, level: p.levelLabel }))} onDocs={load} />}
      {docs && docs.some((d) => d.status === "archived") && <label className="row-wrap" style={{ fontSize: 13 }}><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived</label>}
    </section>
  );
}

function AddForm({ client, cats, people, onDone }: { client: Client; cats: string[]; people: { id: string; name: string; level: string }[]; onDone: () => void }) {
  const portal = usePortal();
  const input = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("Accounts");
  const [message, setMessage] = useState("");
  const [note, setNote] = useState("");
  const [assigned, setAssigned] = useState<string[]>([]);
  const [approval, setApproval] = useState(false);
  const [publish, setPublish] = useState(true);
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async () => {
    const f = input.current?.files?.[0];
    if (!f) return setErr("Choose a file first.");
    setBusy(true); setErr("");
    try {
      const file = await readFile(f);
      await portal.run((a) => a.addDocument({ clientKey: client.Key, title, category, message, internalNote: note, assignedTo: assigned, requiresApproval: approval, publish, notify, ...file }));
      onDone();
    } catch (e) { setErr(say(e)); } finally { setBusy(false); }
  };
  return (
    <div className="stack" style={{ gap: 10 }}>
      <label className="stack" style={{ gap: 4 }}>File (PDF, Word, Excel, PNG, JPG, CSV or text, up to {MAX_MB} MB)<input ref={input} type="file" accept={ACCEPT} /></label>
      <div className="row-wrap">
        <input className="input" aria-label="Title" placeholder="Title (defaults to the file name)" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        <select className="input" aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>{cats.map((c) => <option key={c}>{c}</option>)}</select>
      </div>
      <input className="input" aria-label="Message to the client" placeholder="Message the client will see (optional)" value={message} maxLength={500} onChange={(e) => setMessage(e.target.value)} />
      <input className="input" aria-label="Internal note" placeholder="Internal note, never shown to the client (optional)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      <fieldset className="stack" style={{ gap: 4, border: "1px solid var(--line)", borderRadius: 8, padding: "8px 12px" }}>
        <legend>Who can see it</legend>
        <span className="muted" style={{ fontSize: 13 }}>{assigned.length ? "Only the people ticked, plus administrators." : "Nobody ticked: all administrators and standard users for this business."}</span>
        {people.map((p) => <label key={p.id} className="row-wrap"><input type="checkbox" checked={assigned.includes(p.id)} onChange={(e) => setAssigned(e.target.checked ? [...assigned, p.id] : assigned.filter((x) => x !== p.id))} /> {p.name} <span className="muted">({p.level})</span></label>)}
        {!people.length && <span className="muted">No one has portal access to this business yet.</span>}
      </fieldset>
      <label className="row-wrap"><input type="checkbox" checked={approval} onChange={(e) => setApproval(e.target.checked)} /> The client needs to approve this document</label>
      <label className="row-wrap"><input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} /> Publish now (otherwise it stays a draft)</label>
      {publish && <label className="row-wrap"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Email them that something is waiting (the email never includes the document)</label>}
      {err && <p className="import-list warn" role="alert">{err}</p>}
      <div><button type="button" className="btn small primary" disabled={busy} onClick={() => void submit()}>{busy ? "Saving…" : publish ? "Add and publish" : "Save as draft"}</button></div>
    </div>
  );
}

function Doc({ d, cats, onChanged }: { d: StaffDoc; cats: string[]; onChanged: () => void }) {
  const portal = usePortal();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const replace = useRef<HTMLInputElement>(null);
  const [label, tone] = STATUS[d.status] || [d.status, ""];
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setErr(""); setNote(""); try { await fn(); onChanged(); } catch (e) { setErr(say(e)); } finally { setBusy(false); } };
  const download = (n?: number) => run(async () => { save(await portal.run((a) => a.downloadDocument(d.id, n))); if (d.from === "client") await portal.run((a) => a.documentSeen(d.id)); });
  const publish = () => run(async () => { const r = await portal.run((a) => a.publishDocument(d.id, { notify: true })); setNote(r.document.told ? `Published. ${r.document.told} ${r.document.told === 1 ? "person was" : "people were"} emailed.` : "Published."); });
  const newVersion = () => run(async () => { const f = replace.current?.files?.[0]; if (!f) throw new Error("Choose a file first."); await portal.run(async (a) => a.documentVersion(d.id, { ...(await readFile(f)), notify: d.published })); });
  return (
    <div className="stack" style={{ gap: 6, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
      <div className="row-wrap" style={{ justifyContent: "space-between" }}>
        <button type="button" className="linkbtn" aria-expanded={open} onClick={() => setOpen(!open)}>{d.title}</button>
        <span className={`chip ${tone}`}>{label}</span>
      </div>
      <div className="muted" style={{ fontSize: 13 }}>{d.category} · {d.ext.toUpperCase()} · {size(d.size)} · {d.from === "client" ? `Sent by ${d.uploadedBy}` : `Added by ${d.uploadedBy}`} · {fmtDate(d.updatedAt.slice(0, 10))}{d.assignedNames.length ? ` · For ${d.assignedNames.join(", ")}` : ""}{d.versions.length > 1 ? ` · ${d.versions.length} versions` : ""}</div>
      {open && (
        <div className="stack" style={{ gap: 8 }}>
          {d.message && <p style={{ margin: 0 }}>Message to client: {d.message}</p>}
          {d.internalNote && <p style={{ margin: 0 }}>Internal note: {d.internalNote}</p>}
          {d.approval && <p className="muted" style={{ margin: 0 }}>{d.approval.status === "approved" ? "Approved" : "Declined"} by {d.approval.by} on {fmtDate(d.approval.at.slice(0, 10))}{d.approval.note ? `: ${d.approval.note}` : ""}.</p>}
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>File check: {d.scan === "scanned" ? "scanned" : "type and content checked (no virus scanner connected)"}.</p>
          <div className="row-wrap">
            <button type="button" className="btn small" disabled={busy} onClick={() => void download()}>Download</button>
            {d.from === "practice" && d.status === "draft" && <button type="button" className="btn small primary" disabled={busy} onClick={() => void publish()}>Publish</button>}
            {d.from === "practice" && d.published && d.status !== "archived" && <button type="button" className="btn small" disabled={busy} onClick={() => void run(() => portal.run((a) => a.unpublishDocument(d.id)))}>Unpublish</button>}
            {d.status !== "archived" && <button type="button" className="btn small" disabled={busy} onClick={() => void run(() => portal.run((a) => a.archiveDocument(d.id)))}>Archive</button>}
            {d.from === "client" && d.status === "received" && <button type="button" className="btn small" disabled={busy} onClick={() => void run(() => portal.run((a) => a.documentSeen(d.id)))}>Mark as seen</button>}
          </div>
          {d.from === "practice" && d.status !== "archived" && (
            <div className="row-wrap"><input ref={replace} type="file" accept={ACCEPT} aria-label="New version file" /><button type="button" className="btn small" disabled={busy} onClick={() => void newVersion()}>Upload a new version</button></div>
          )}
          {d.versions.length > 1 && <ul style={{ margin: 0, paddingLeft: 18 }}>{d.versions.map((v) => <li key={v.n}>Version {v.n}: {v.fileName} ({v.by}, {fmtDate(v.at.slice(0, 10))}) <button type="button" className="linkbtn" onClick={() => void download(v.n)}>Download</button></li>)}</ul>}
          <label className="row-wrap">Category <select className="input" value={d.category} disabled={busy} onChange={(e) => void run(() => portal.run((a) => a.editDocument(d.id, { category: e.target.value })))}>{cats.map((c) => <option key={c}>{c}</option>)}</select></label>
        </div>
      )}
      {note && <p role="status" style={{ margin: 0 }}>{note}</p>}
      {err && <p className="import-list warn" role="alert">{err}</p>}
    </div>
  );
}

const SIGN_STATUS: Record<string, [string, string]> = { out: ["Waiting for signatures", "amber"], completed: ["Signed by everyone", "green"], cancelled: ["Cancelled", ""], declined: ["Declined", "red"], expired: ["Expired", "red"] };
const SIGNER: Record<string, string> = { signed: "Signed", declined: "Declined", pending: "Waiting for them", waiting: "Waiting for earlier signatories", closed: "Not signed" };

/** Ask named people to sign a PDF, follow who has signed, and check a finished one. */
function SigningPanel({ client, docs, people, onDocs }: { client: Client; docs: StaffDoc[]; people: { id: string; name: string; level: string }[]; onDocs: () => void }) {
  const portal = usePortal();
  const [list, setList] = useState<StaffSigning[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const load = () => portal.run((a) => a.signing(client.Key)).then((r) => { setList(r); setErr(""); }).catch((e) => setErr(say(e)));
  useEffect(() => { void load(); }, [client.Key, docs.length]);
  const pdfs = docs.filter((d) => d.ext === "pdf" && d.from === "practice" && !d.locked && d.status !== "archived");
  const [docId, setDocId] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [ordered, setOrdered] = useState(false);
  const [message, setMessage] = useState("");
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<string | void>) => { setBusy(true); setErr(""); setNote(""); try { const m = await fn(); if (m) setNote(m); await load(); onDocs(); } catch (e) { setErr(say(e)); } finally { setBusy(false); } };
  const send = () => act(async () => { await portal.run((a) => a.createSigning({ clientKey: client.Key, docId: docId || pdfs[0]?.id, signatoryIds: picked, sequential: ordered, message, expiresInDays: days })); setAdding(false); setPicked([]); setMessage(""); return "Sent. The first signatories have been emailed."; });
  const nameOf = (id: string) => docs.find((d) => d.id === id)?.title || "";
  return (
    <div className="stack" style={{ gap: 8, borderTop: "2px solid var(--line)", paddingTop: 12 }}>
      <div className="row-wrap" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>Signatures</h3>
        <button type="button" className="btn small" disabled={!pdfs.length || !people.length} onClick={() => setAdding(!adding)}>{adding ? "Close" : "Ask for signatures"}</button>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>Only the people you name can sign, whatever access they have. Being an administrator isn't enough. {!pdfs.length ? "Add a PDF above first." : ""}</p>
      {adding && (
        <div className="stack" style={{ gap: 8 }}>
          <select className="input" aria-label="Document to sign" value={docId || pdfs[0]?.id} onChange={(e) => setDocId(e.target.value)}>{pdfs.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}</select>
          <fieldset className="stack" style={{ gap: 4, border: "1px solid var(--line)", borderRadius: 8, padding: "8px 12px" }}>
            <legend>Who signs (in the order ticked)</legend>
            {people.map((p) => <label key={p.id} className="row-wrap"><input type="checkbox" checked={picked.includes(p.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, p.id] : picked.filter((x) => x !== p.id))} /> {p.name} <span className="muted">({p.level}){picked.includes(p.id) && ordered ? ` · signs ${picked.indexOf(p.id) + 1}${["st", "nd", "rd"][picked.indexOf(p.id)] || "th"}` : ""}</span></label>)}
          </fieldset>
          <label className="row-wrap"><input type="checkbox" checked={ordered} onChange={(e) => setOrdered(e.target.checked)} /> One after another, in that order</label>
          <input className="input" aria-label="Message to signatories" placeholder="Message they will see (optional)" value={message} maxLength={500} onChange={(e) => setMessage(e.target.value)} />
          <label className="row-wrap">Valid for <input className="input" type="number" min={1} max={365} style={{ width: 80 }} value={days} onChange={(e) => setDays(Number(e.target.value))} /> days</label>
          <div><button type="button" className="btn small primary" disabled={busy || !picked.length} onClick={() => void send()}>Send for signing</button></div>
        </div>
      )}
      {err && <p className="import-list warn" role="alert">{err}</p>}
      {note && <p role="status" style={{ margin: 0 }}>{note}</p>}
      {list && !list.length && <p className="muted" style={{ margin: 0 }}>Nothing has been sent for signing.</p>}
      {list?.map((r) => {
        const [label, tone] = SIGN_STATUS[r.status];
        return (
          <section key={r.id} className="stack" style={{ gap: 4, borderTop: "1px solid var(--line)", paddingTop: 8 }} aria-label={`Signing ${r.ref}`}>
            <div className="row-wrap" style={{ justifyContent: "space-between" }}><strong>{r.title}</strong><span className={`chip ${tone}`}>{label}</span></div>
            <div className="muted" style={{ fontSize: 13 }}>Reference {r.ref} · sent {fmtDate(r.createdAt.slice(0, 10))} by {r.createdByName}{r.status === "out" ? ` · expires ${fmtDate(r.expiresAt.slice(0, 10))}` : ""}{r.status === "completed" ? ` · completed ${fmtDate(r.completedAt.slice(0, 10))}` : ""}{nameOf(r.docId) ? "" : ""}</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>{r.signatories.map((s) => <li key={s.id}>{r.sequential ? `${s.order}. ` : ""}{s.name}: {SIGNER[s.status]}{s.signedAt ? ` on ${fmtDate(s.signedAt.slice(0, 10))}` : s.viewedAt ? " (has opened it)" : ""}</li>)}</ul>
            {r.declineReason && <p style={{ margin: 0 }}>Reason given: {r.declineReason}</p>}
            {r.status === "completed" && <p className="muted" style={{ margin: 0, fontSize: 13 }}>The signed copy and the certificate are filed with this client's documents above.</p>}
            <div className="row-wrap">
              {r.status === "out" && <button type="button" className="btn small" disabled={busy} onClick={() => void act(async () => { const x = await portal.run((a) => a.remindSigning(r.id)); return `Reminder sent to ${x.request.reminded} ${x.request.reminded === 1 ? "person" : "people"}.`; })}>Send reminder</button>}
              {r.status === "out" && <button type="button" className="btn small" disabled={busy} onClick={() => void act(() => portal.run((a) => a.cancelSigning(r.id)))}>Cancel request</button>}
              {r.status === "completed" && <button type="button" className="btn small" disabled={busy} onClick={() => void act(async () => { const v = await portal.run((a) => a.verifySigning(r.id)); return v.ok ? "Checked: the signed copy, certificate, original and record are exactly as they were when sealed." : `Problem found: ${v.checks.filter((c) => !c.ok).map((c) => c.what).join(", ")} no longer matches what was sealed.`; })}>Check integrity</button>}
            </div>
          </section>
        );
      })}
    </div>
  );
}
