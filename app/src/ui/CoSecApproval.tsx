// Client approval on a Co Sec transaction: the question, the approval document, sending it through the portal (the existing signing) or
// signing on paper, and recording the outcome. All state lives on the transaction (see lib/cosecApproval.ts).
import { useState } from "react";
import { APPROVAL_CHIP, APPROVAL_LABEL, approvalOf, decide, defaultApproval, fromSigning, recordManual, sendForApproval, summaryOf, approvalPdf, withdrawApproval } from "../lib/cosecApproval";
import { formTitle } from "../lib/cosecForms";
import { Row } from "../lib/schema";
import { downloadFile } from "./commsKit";
import { useFiling } from "./EngagementsPage";
import { say, usePortal } from "./portalKit";
import { useCoSec } from "./cosecKit";

const s = (v: unknown) => (v == null ? "" : String(v));
const b64 = (bytes: Uint8Array) => { let t = ""; for (let i = 0; i < bytes.length; i += 0x8000) t += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(t); };
const OPEN = ["draft", "info", "approved", "rejected"];

export function ApprovalPanel({ tx, client }: { tx: Row; client?: Row }) {
  const k = useCoSec();
  const portal = usePortal();
  const file = useFiling();
  const st = approvalOf(tx);
  const form = s(tx.Form);
  const def = defaultApproval(form);
  const [note, setNote] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [manual, setManual] = useState({ by: "", at: new Date().toISOString().slice(0, 10), evidence: "" });
  const [signed, setSigned] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const open = OPEN.includes(s(tx.Status) || "draft");
  const canEdit = k.can("edit");
  const people = portal.forClient(s(tx.ClientKey)).filter((r) => r.person.status === "active");
  const run = async (work: () => Promise<string | void>) => { setBusy(true); setMsg(undefined); try { const t = await work(); if (t) setMsg({ ok: true, text: t }); } catch (e) { setMsg({ ok: false, text: say(e) }); } finally { setBusy(false); } };
  const write = async (w: ReturnType<typeof decide>) => { if ("error" in w) throw new Error(w.error); await k.apply(w as never); };
  if (!st) return null;

  const names = (ids: string[]) => ids.map((id) => people.find((p) => p.person.id === id)?.person.name || "").filter(Boolean);
  const summary = (signatories: string[]) => summaryOf(tx, { name: s(client?.Title), number: s(client?.CompanyNumber) }, formTitle(form), signatories, "");
  const pdfName = () => `${s(client?.Title)} ${s(tx.Ref)} approval`.replace(/[^\w .-]/g, "");

  const answer = (required: boolean) => run(async () => { await write(decide(tx, required, note, canEdit, k.ctx())); setNote(""); return required ? "Saved. Send it to the client for approval." : "Saved. It can now go for internal review."; });
  const download = () => run(async () => { downloadFile(await approvalPdf(summary(names(picked))), `${pdfName()}.pdf`, "application/pdf"); });
  const sendPortal = () => run(async () => {
    if (!picked.length) throw new Error("Choose who approves.");
    const bytes = await approvalPdf(summary(names(picked)));
    const name = `${pdfName()}.pdf`;
    const { row } = await file(bytes, name, `Approval: ${s(tx.Title)}`, s(client?.Title), s(tx.ClientKey), s(tx.Ref), { Category: "Company secretarial", TemplateName: "Co Sec approval" });
    const cats = await portal.run((a) => a.documents(s(tx.ClientKey)));
    const category = cats.categories.find((c) => /secretar|statutory|other/i.test(c)) || cats.categories[0] || "Other";
    const d = await portal.run((a) => a.addDocument({ clientKey: s(tx.ClientKey), title: `Approval: ${s(tx.Title)}`, category, fileName: name, content: b64(bytes), publish: false, notify: false, assignedTo: [], requiresApproval: false }));
    const req = await portal.run((a) => a.createSigning({ clientKey: s(tx.ClientKey), docId: d.document.id, title: `Approval: ${s(tx.Title)}`, signatoryIds: picked, sequential: false, message: "Please read and sign to approve this change to the company's records.", expiresInDays: 30 }));
    await write(sendForApproval(tx, { method: "portal", signingId: req.request.id, portalDocId: d.document.id, docKey: s(row.Key), signatories: req.request.signatories.map((x) => x.name) }, canEdit, k.ctx()));
    return "Sent. The people you chose have been emailed.";
  });
  const preparePaper = () => run(async () => {
    const bytes = await approvalPdf(summary(manual.by.split(/[,\n]/).map((x) => x.trim()).filter(Boolean)));
    const { row } = await file(bytes, `${pdfName()}.pdf`, `Approval: ${s(tx.Title)}`, s(client?.Title), s(tx.ClientKey), s(tx.Ref), { Category: "Company secretarial", TemplateName: "Co Sec approval" });
    downloadFile(bytes, `${pdfName()}.pdf`, "application/pdf");
    await write(sendForApproval(tx, { method: "manual", docKey: s(row.Key), signatories: manual.by.split(/[,\n]/).map((x) => x.trim()).filter(Boolean) }, canEdit, k.ctx()));
    return "The approval is downloaded and filed. Print it, have it signed, then upload the signed copy here.";
  });
  const check = () => run(async () => {
    const list = await portal.run((a) => a.signing(s(tx.ClientKey)));
    const r = list.find((x) => x.id === s(tx.ApprovalSigningId));
    if (!r) throw new Error("The signing request wasn't found on the portal.");
    const out = fromSigning(tx, { id: r.id, ref: r.ref, status: r.status, completedAt: r.completedAt, sealedDocId: r.sealedDocId, signatories: r.signatories.map((x) => ({ name: x.name, status: x.status, signedAt: x.signedAt })) }, k.ctx());
    if (out.written) await k.apply(out.written as never);
    return out.written ? (r.status === "completed" ? "Approved. The signed copy and certificate are with the client's documents." : `The request is ${r.status}.`) : `Still waiting: ${out.progress}.`;
  });
  const remind = () => run(async () => { const r = await portal.run((a) => a.remindSigning(s(tx.ApprovalSigningId))); return `Reminder sent to ${r.request.reminded}.`; });
  const withdraw = () => run(async () => { try { if (tx.ApprovalSigningId) await portal.run((a) => a.cancelSigning(s(tx.ApprovalSigningId))); } catch { /* it may already be closed */ } await write(withdrawApproval(tx, canEdit, k.ctx())); return "Withdrawn."; });
  const record = () => run(async () => {
    let docKey: string | undefined;
    if (signed) {
      if (!signed.name.toLowerCase().endsWith(".pdf")) throw new Error("The signed copy has to be a PDF.");
      const { row } = await file(new Uint8Array(await signed.arrayBuffer()), `${pdfName()} signed.pdf`, `Approval (signed): ${s(tx.Title)}`, s(client?.Title), s(tx.ClientKey), s(tx.Ref), { Category: "Company secretarial", TemplateName: "Co Sec approval" });
      docKey = s(row.Key);
    }
    await write(recordManual(tx, { by: manual.by, at: manual.at, evidence: manual.evidence, docKey }, canEdit, k.ctx()));
    return "Recorded. The signed copy is filed.";
  });

  return (
    <section className="card pad stack" aria-label="Client approval">
      <div className="row-wrap" style={{ justifyContent: "space-between" }}><h3 style={{ margin: 0 }}>Client approval</h3><span className={`chip ${APPROVAL_CHIP[st]}`}>{APPROVAL_LABEL[st]}</span></div>
      {st === "undecided" && open && (
        <div className="stack" style={{ gap: 8 }}>
          <strong>Does this transaction require client approval?</strong>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>{def.reason || "Usually not needed for this kind of transaction."} {def.mandatory ? "This is a legal requirement: choosing No means recording where the decision was made." : "Choose No only if the company's decision is already recorded elsewhere."}</p>
          <label className="doc-field"><span>{def.mandatory ? "If No: where the decision was recorded (required)" : "Note (optional)"}</span><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></label>
          <div className="row-wrap"><button type="button" className={`btn${def.required ? " primary" : ""}`} disabled={busy || !canEdit} onClick={() => void answer(true)}>Yes, needs client approval</button><button type="button" className={`btn${!def.required ? " primary" : ""}`} disabled={busy || !canEdit} onClick={() => void answer(false)}>No</button></div>
        </div>
      )}
      {st === "not-required" && <p style={{ margin: 0 }}>Decided by {s(tx.ApprovalDecidedBy)} on {s(tx.ApprovalDecidedAt).slice(0, 10)}. {s(tx.ApprovalNote)}</p>}
      {(st === "required" || st === "declined") && open && (
        <div className="stack" style={{ gap: 10 }}>
          {st === "declined" && <p className="error-text" style={{ margin: 0 }}>The client declined. Change the draft if needed, then ask again.</p>}
          <strong>Through the portal</strong>
          {people.length ? <div className="stack" style={{ gap: 4 }}>{people.map((p) => <label key={p.person.id} className="row-wrap"><input type="checkbox" checked={picked.includes(p.person.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, p.person.id] : picked.filter((x) => x !== p.person.id))} /> {p.person.name || p.person.email} <span className="muted">({p.levelLabel})</span></label>)}</div> : <p className="muted" style={{ margin: 0 }}>Nobody has portal access to this company yet. Use a printed copy instead.</p>}
          <div className="row-wrap"><button type="button" className="btn primary" disabled={busy || !picked.length || !canEdit} onClick={() => void sendPortal()}>{busy ? "Sending…" : "Send for approval"}</button><button type="button" className="btn" disabled={busy || !picked.length} onClick={() => void download()}>Preview the PDF</button></div>
          <strong>Or on paper</strong>
          <label className="doc-field"><span>Who will sign (names, separated by commas)</span><input className="input" value={manual.by} onChange={(e) => setManual({ ...manual, by: e.target.value })} /></label>
          <div><button type="button" className="btn" disabled={busy || !canEdit} onClick={() => void preparePaper()}>Download the approval to print</button></div>
        </div>
      )}
      {st === "awaiting" && (
        <div className="stack" style={{ gap: 8 }}>
          <p style={{ margin: 0 }}>{s(tx.ApprovalMethod) === "portal" ? `Sent through the portal to ${s(tx.ApprovalSignatories)} on ${s(tx.ApprovalSentAt).slice(0, 10)}.` : `A printed copy was prepared for ${s(tx.ApprovalSignatories) || "the signatories"}.`}</p>
          {s(tx.ApprovalMethod) === "portal" && <div className="row-wrap"><button type="button" className="btn" disabled={busy} onClick={() => void check()}>Check whether it has been signed</button><button type="button" className="btn" disabled={busy} onClick={() => void remind()}>Send a reminder</button></div>}
        </div>
      )}
      {(st === "awaiting" && s(tx.ApprovalMethod) === "manual" || ((st === "required" || st === "declined") && open)) && (
        <details><summary>Record a signed copy</summary>
          <div className="stack" style={{ gap: 8, marginTop: 8 }}>
            <div className="tl-form">
              <label className="doc-field"><span>Who signed</span><input className="input" value={manual.by} onChange={(e) => setManual({ ...manual, by: e.target.value })} /></label>
              <label className="doc-field"><span>Date signed</span><input className="input" type="date" value={manual.at} onChange={(e) => setManual({ ...manual, at: e.target.value })} /></label>
              <label className="doc-field"><span>Where the signed copy is kept (if not uploaded)</span><input className="input" value={manual.evidence} onChange={(e) => setManual({ ...manual, evidence: e.target.value })} /></label>
              <label className="doc-field"><span>Signed copy (PDF)</span><input type="file" accept="application/pdf,.pdf" onChange={(e) => setSigned(e.target.files?.[0] || null)} /></label>
            </div>
            <div><button type="button" className="btn primary" disabled={busy || !canEdit} onClick={() => void record()}>Record the approval</button></div>
          </div>
        </details>
      )}
      {st === "awaiting" && <div><button type="button" className="linkbtn" disabled={busy || !canEdit} onClick={() => void withdraw()}>Withdraw this request</button></div>}
      {st === "approved" && <p style={{ margin: 0 }}>Approved by {s(tx.ApprovalBy)} on {s(tx.ApprovalAt).slice(0, 10)} ({s(tx.ApprovalMethod) === "portal" ? "portal signature" : "signed copy"}). {s(tx.ApprovalEvidence)}</p>}
      {msg && <p className={msg.ok ? undefined : "error-text"} role={msg.ok ? "status" : "alert"} style={{ margin: 0 }}>{msg.text}</p>}
    </section>
  );
}
