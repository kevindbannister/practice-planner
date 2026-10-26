// Engagements (Phase 3): letters made from accepted proposals or filed from outside, sent for signature through the portal,
// and followed to their review date. Rules live in lib/engagements.ts; this file is the screens.
import { useMemo, useRef, useState } from "react";
import { getAccessToken } from "../lib/auth";
import { fmtDate, todayIso } from "../lib/domain";
import { DEFAULT_LAYOUT, DocLayout } from "../lib/docModel";
import {
  DECISION_LABEL, ENG_CHIP, ENG_LABEL, advanceEng, asEng, coverageGaps, decide, editDraft, generate, isInForce, isLive, letterFor, markSigned, readBody, readDecisions, readList, recall, regenerate, requestReview,
  reviewStatus, reviewYears, sealHash, intact, sendOut, uploadExternal, daysBetween,
} from "../lib/engagements";
import { ClientType, clientTypeFor } from "../lib/proposals";
import { newKey } from "../lib/planning";
import { Row } from "../lib/schema";
import { href } from "./bits";
import { useData } from "./data";
import { EmailPanel } from "./DocsCreate";
import { LETTERS_FOLDER, clientFolder, documentFileName, makePdf, snapshotOf, useDocs } from "./docsKit";
import { say, usePortal } from "./portalKit";
import { useSales } from "./salesKit";

const PDF_TYPE = "application/pdf";
const chip = (e: Row) => <span className={`chip ${ENG_CHIP[asEng(e.Status)]}`}>{ENG_LABEL[asEng(e.Status)]}</span>;
const msgOf = (e: unknown) => (e instanceof Error && e.message ? e.message : "That didn't work. Try again.");
const b64 = (bytes: Uint8Array) => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const reviewLabel = (e: Row, today: string) => {
  if (!isInForce(e) || !e.ReviewDate) return "";
  const d = daysBetween(today, String(e.ReviewDate));
  return d < 0 ? `review overdue by ${-d} day${d === -1 ? "" : "s"}` : d === 0 ? "review due today" : `review ${fmtDate(String(e.ReviewDate))} (${d} days)`;
};

/** Files a PDF in the client's OneDrive folder and records it with their documents. */
function useFiling() {
  const docs = useDocs();
  const s = useSales();
  return async (bytes: Uint8Array, fileName: string, title: string, clientName: string, clientKey: string, reference: string, extra: Row = {}) => {
    let url = "";
    try {
      const path = `/me/drive/root:/${encodeURIComponent(LETTERS_FOLDER)}/${encodeURIComponent(clientFolder(clientName || "Clients"))}/${encodeURIComponent(fileName)}:/content`;
      const item = await docs.store.graph.put<{ webUrl?: string }>(path, bytes, PDF_TYPE);
      url = item.webUrl || "";
    } catch { throw new Error("Couldn't save the PDF to OneDrive. Nothing was sent. Try again."); }
    const row = await docs.create("Documents", { Key: newKey("D"), Title: title, ClientKey: clientKey, TemplateName: "Engagement letter", Category: "Engagement letters", Reference: reference, Created: new Date().toISOString(), CreatedBy: s.me, FileUrl: url, FileName: fileName, Status: "Saved", ...extra });
    return { row, url };
  };
}

// ------------------------------------------------------------------ list

export function EngagementsList() {
  const s = useSales();
  const { data } = useData();
  const today = todayIso();
  const [show, setShow] = useState<"live" | "all">("live");
  const [adding, setAdding] = useState(false);
  const rows = useMemo(() => s.engagements.filter((e) => show === "all" || isLive(e)).sort((a, b) => String(a.ReviewDate || "9999").localeCompare(String(b.ReviewDate || "9999"))), [s.engagements, show]);
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row-wrap" style={{ justifyContent: "space-between" }}>
        <p className="muted" style={{ margin: 0 }}>Engagement letters for every client. A client can have several. Letters are made from accepted proposals (open the proposal) or filed here when made elsewhere.</p>
        <div className="row-wrap">
          <label className="row-wrap"><input type="checkbox" checked={show === "all"} onChange={(e) => setShow(e.target.checked ? "all" : "live")} /> Include superseded and ended</label>
          {s.pcan("edit") && <button type="button" className="btn primary" onClick={() => setAdding(!adding)}>{adding ? "Close" : "File a letter made elsewhere"}</button>}
        </div>
      </div>
      {adding && <UploadEngagement onDone={() => setAdding(false)} />}
      {!rows.length ? <div className="card empty"><p>No engagement letters yet.</p></div> : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="tbl">
            <thead><tr><th>Letter</th><th>Client</th><th>Services</th><th>Status</th><th>Review</th></tr></thead>
            <tbody>{rows.map((e) => (
              <tr key={String(e.Key)}>
                <td><a href={href("sales", "engagement", String(e.Key))}>{String(e.Ref)}</a></td>
                <td>{(() => { const c = data.clients.find((x) => x.Key === e.ClientKey); return c ? <a href={href("clients", c.Key)}>{c.Title}</a> : "—"; })()}</td>
                <td>{(() => { try { return (JSON.parse(String(e.ServiceNames || "[]")) as string[]).join(", "); } catch { return ""; } })()}</td>
                <td>{chip(e)}{e.Source === "uploaded" ? <span className="muted"> filed</span> : null}</td>
                <td>{reviewLabel(e, today) || "—"}{e.ReviewRequest ? <span className="chip amber" style={{ marginLeft: 6 }}>early review asked</span> : null}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ filing a letter made elsewhere

export function UploadEngagement({ clientKey, replaces, onDone }: { clientKey?: string; replaces?: Row; onDone: () => void }) {
  const s = useSales();
  const { data } = useData();
  const file = useFiling();
  const input = useRef<HTMLInputElement>(null);
  const today = todayIso();
  const [ck, setCk] = useState(clientKey || String(replaces?.ClientKey || ""));
  const [f, setF] = useState({ title: "", documentDate: today, effectiveDate: today, signed: true, signatories: "", reviewDate: "", reviewYears: "", notes: "" });
  const [svc, setSvc] = useState<string[]>(replaces ? readList(replaces.ServiceKeys) : []);
  const [rep, setRep] = useState(String(replaces?.Key || ""));
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const client = data.clients.find((c) => c.Key === ck);
  const type: ClientType = clientTypeFor(String(client?.Kind || ""));
  const live = s.engagements.filter((e) => e.ClientKey === ck && isLive(e));
  const set = (k: keyof typeof f, v: string | boolean) => setF({ ...f, [k]: v });
  const go = async () => {
    setBusy(true); setErr(undefined);
    try {
      const pdf = input.current?.files?.[0];
      if (!pdf) throw new Error("Choose the PDF first.");
      if (pdf.type !== PDF_TYPE && !pdf.name.toLowerCase().endsWith(".pdf")) throw new Error("The letter has to be a PDF.");
      if (pdf.size > 15 * 1048576) throw new Error("That file is too large (the limit is 15 MB).");
      if (!ck || !client) throw new Error("Choose the client.");
      const o = s.ctx();
      const old = s.engagements.find((e) => e.Key === rep);
      const bytes = new Uint8Array(await pdf.arrayBuffer());
      const names = s.catalogue.filter((c) => svc.includes(c.key)).map((c) => c.name);
      // check everything first, so nothing is filed if the details are wrong
      const dry = uploadExternal({ clientKey: ck, title: f.title, documentDate: f.documentDate, effectiveDate: f.effectiveDate, signatories: f.signatories.split(/[,\n]/).map((x) => x.trim()).filter(Boolean), signed: f.signed, serviceKeys: svc, serviceNames: names, reviewDate: f.reviewDate || undefined, reviewYears: f.reviewYears, notes: f.notes, docKey: "x", fileUrl: "", fileName: pdf.name, replaces: old, clientType: type }, s.engagements, s.eng, s.pcan, today, client, o);
      if ("error" in dry) throw new Error(dry.error);
      const name = documentFileName(`Engagement ${client.Title} ${f.documentDate}`, today, "");
      const { row, url } = await file(bytes, name, f.title.trim() || `Engagement letter (filed) – ${client.Title}`, client.Title, ck, "", {});
      const w = uploadExternal({ clientKey: ck, title: f.title, documentDate: f.documentDate, effectiveDate: f.effectiveDate, signatories: f.signatories.split(/[,\n]/).map((x) => x.trim()).filter(Boolean), signed: f.signed, serviceKeys: svc, serviceNames: names, reviewDate: f.reviewDate || undefined, reviewYears: f.reviewYears, notes: f.notes, docKey: String(row.Key), fileUrl: url, fileName: pdf.name, replaces: old, clientType: type }, s.engagements, s.eng, s.pcan, today, client, o);
      if ("error" in w) throw new Error(w.error);
      await s.apply(w);
      onDone();
    } catch (e) { setErr(msgOf(e)); } finally { setBusy(false); }
  };
  return (
    <section className="card pad stack" aria-label="File an engagement letter">
      <h3 style={{ margin: 0 }}>{replaces ? "Upload a replacement letter" : "File an engagement letter made outside the planner"}</h3>
      <div className="form-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
        <label className="doc-field"><span>Client</span><select className="input" disabled={!!clientKey || !!replaces} value={ck} onChange={(e) => { setCk(e.target.value); setRep(""); }}><option value="">Choose…</option>{[...data.clients].sort((a, b) => a.Title.localeCompare(b.Title)).map((c) => <option key={c.Key} value={c.Key}>{c.Title}</option>)}</select></label>
        <label className="doc-field"><span>PDF</span><input ref={input} type="file" accept=".pdf,application/pdf" /></label>
        <label className="doc-field"><span>Title (optional)</span><input className="input" value={f.title} onChange={(e) => set("title", e.target.value)} /></label>
        <label className="doc-field"><span>Date on the letter</span><input className="input" type="date" value={f.documentDate} onChange={(e) => set("documentDate", e.target.value)} /></label>
        <label className="doc-field"><span>Effective date</span><input className="input" type="date" value={f.effectiveDate} onChange={(e) => set("effectiveDate", e.target.value)} /></label>
        <label className="doc-field"><span>Renewal date (blank: {s.eng.years} years from effective, or your interval)</span><input className="input" type="date" value={f.reviewDate} onChange={(e) => set("reviewDate", e.target.value)} /></label>
        <label className="doc-field"><span>Review interval (years, optional)</span><input className="input" type="number" min={1} max={10} value={f.reviewYears} onChange={(e) => set("reviewYears", e.target.value)} /></label>
        {!replaces && <label className="doc-field"><span>Replaces</span><select className="input" value={rep} onChange={(e) => setRep(e.target.value)}><option value="">Nothing: it's a new engagement</option>{live.map((e) => <option key={String(e.Key)} value={String(e.Key)}>{String(e.Ref)}: {String(e.Title)}</option>)}</select></label>}
      </div>
      <label className="row-wrap"><input type="checkbox" checked={f.signed} onChange={(e) => set("signed", e.target.checked)} /> It has been signed</label>
      <label className="doc-field"><span>{f.signed ? "Who signed (names, separated by commas)" : "Who is to sign (names, optional)"}</span><input className="input" value={f.signatories} onChange={(e) => set("signatories", e.target.value)} /></label>
      <fieldset style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 10 }}><legend>Services it covers</legend>
        <div className="row-wrap" style={{ gap: 12 }}>{s.catalogue.filter((c) => c.active).map((c) => <label key={c.key} className="row-wrap"><input type="checkbox" checked={svc.includes(c.key)} onChange={(e) => setSvc(e.target.checked ? [...svc, c.key] : svc.filter((x) => x !== c.key))} /> {c.name}</label>)}</div>
      </fieldset>
      <label className="doc-field"><span>Notes</span><textarea className="input" rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></label>
      {err && <p role="alert" style={{ color: "var(--red-ink)", margin: 0 }}>{err}</p>}
      <div className="row-wrap"><button type="button" className="btn primary" disabled={busy} onClick={go}>{busy ? "Filing…" : "File the letter"}</button><button type="button" className="btn" disabled={busy} onClick={onDone}>Cancel</button></div>
    </section>
  );
}

// ------------------------------------------------------------------ one engagement

export function EngagementDetail({ engKey }: { engKey: string }) {
  const s = useSales();
  const { data } = useData();
  const docs = useDocs();
  const portal = usePortal();
  const file = useFiling();
  const today = todayIso();
  const e = s.engagements.find((x) => x.Key === engKey);
  const [err, setErr] = useState<string>();
  const [info, setInfo] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<"" | "portal" | "paper" | "signed" | "extend" | "none" | "early" | "end" | "replace">("");
  const [form, setForm] = useState({ effective: "", years: "", signatories: "", notes: "", note: "", date: "", by: "", evidence: "", at: today });
  const [picked, setPicked] = useState<string[]>([]);
  const [saved, setSaved] = useState<{ name: string; bytes: Uint8Array; row: Row; title: string }>();
  const [sealOk, setSealOk] = useState<boolean>();
  const signedPdf = useRef<HTMLInputElement>(null);

  const client = data.clients.find((c) => c.Key === e?.ClientKey);
  const proposal = data.proposals.find((p) => p.Key === e?.ProposalKey);
  const version = data.proposalVersions.find((v) => v.ProposalKey === e?.ProposalKey && Number(v.Version) === Number(e?.ProposalVersion));
  const brand = docs.brand(s.template.brandingId || undefined);
  const practice = brand.tradingName || brand.practiceName || "Our practice";
  const previous = e && s.engagements.find((x) => x.Key === e.PreviousKey);
  const successors = e ? s.engagements.filter((x) => x.PreviousKey === e.Key) : [];
  const [seal, setSeal] = useState<string>();
  if (e && e.Hash && seal !== String(e.Key) + String(e.Updated)) { setSeal(String(e.Key) + String(e.Updated)); void intact(e).then(setSealOk); }
  if (!e) return <div className="card empty"><p>That engagement isn't here. <a href="#/sales/engagements">Back to engagements</a></p></div>;

  const status = asEng(e.Status);
  const body = readBody(e.Body);
  const ctxWho = { independent: s.cfg.independentReview };
  const type = (String(e.ClientType) as ClientType) || "limited";
  const people = portal.forClient(String(e.ClientKey)).filter((r) => r.person.status === "active");
  const run = async (fn: () => Promise<void | boolean | string>) => {
    setErr(undefined); setInfo(undefined); setBusy(true);
    try { const r = await fn(); if (typeof r === "string") setInfo(r); return r; } catch (x) { setErr(say(x) || msgOf(x)); return false; } finally { setBusy(false); }
  };
  const apply = async (w: ReturnType<typeof advanceEng>) => { if ("error" in w) { setErr(w.error); return false; } await s.apply(w); return true; };
  const ctxIn = () => proposal && version && client ? { proposal, version, client, settings: s.eng, catalogue: s.catalogue, practice, today } : undefined;

  const buildPdf = async () => {
    const layout: DocLayout = { ...DEFAULT_LAYOUT, header: brand.header || "", footer: brand.footer || "" };
    const title = `${e.Title}`;
    return { title, ...(await makePdf({ content: body, layout, branding: brand, title, reference: String(e.Ref), author: s.me })), doc: body, layout };
  };
  const preview = () => run(async () => { const out = await buildPdf(); const url = URL.createObjectURL(new Blob([out.bytes as BlobPart], { type: PDF_TYPE })); window.open(url, "_blank", "noopener"); window.setTimeout(() => URL.revokeObjectURL(url), 60000); });

  const f = { effective: form.effective || String(e.EffectiveDate || ""), years: form.years !== "" ? form.years : String(e.ReviewYears || ""), signatories: form.signatories !== "" ? form.signatories : readList(e.Signatories).join(", "), notes: form.notes !== "" ? form.notes : String(e.Notes || "") };
  const saveDraft = () => run(async () => {
    const inp = ctxIn();
    const w = editDraft(e, { effectiveDate: f.effective, reviewYears: f.years, signatories: f.signatories.split(/[,\n]/).map((x) => x.trim()).filter(Boolean), notes: f.notes }, s.eng, (eff, yrs, sig) => inp ? letterFor(e, inp, eff, yrs, sig) : undefined, s.pcan, s.ctx());
    if (!(await apply(w))) return false;
    setForm({ ...form, effective: "", years: "", signatories: "", notes: "" });
    return "Saved.";
  });
  const rebuild = () => run(async () => { const inp = ctxIn(); if (!inp) return setErr("This letter wasn't made from a proposal."), false; return apply(regenerate(e, { ...inp, can: s.pcan }, s.ctx())); });
  const step = (to: "review" | "approved" | "draft") => run(async () => apply(advanceEng(e, to, "", ctxWho.independent, s.pcan, s.ctx())));

  // ---- sending
  const prepare = () => run(async () => {
    const out = await buildPdf();
    const name = documentFileName(`${e.Ref} ${client?.Title || ""}`, today, "");
    const { row } = await file(out.bytes, name, out.title, client?.Title || "", String(e.ClientKey), String(e.Ref), { BrandingId: brand.id, Pages: out.pages, Snapshot: snapshotOf(out.doc, out.layout, { engagement: e.Ref }) });
    setSaved({ name, bytes: out.bytes, row, title: out.title });
  });
  const sendPortal = () => run(async () => {
    if (!picked.length) throw new Error("Choose who signs.");
    if (!s.pcan("send")) throw new Error("Only a manager or partner can send engagement letters.");
    const out = await buildPdf();
    const hash = await sealHash(String(e.Body));
    const name = documentFileName(`${e.Ref} ${client?.Title || ""}`, today, "");
    const { row } = await file(out.bytes, name, out.title, client?.Title || "", String(e.ClientKey), String(e.Ref), { BrandingId: brand.id, Pages: out.pages, Snapshot: snapshotOf(out.doc, out.layout, { engagement: e.Ref }) });
    const cats = await portal.run((a) => a.documents(String(e.ClientKey)));
    const category = cats.categories.find((c) => /engagement/i.test(c)) || cats.categories[0] || "Other";
    const d = await portal.run((a) => a.addDocument({ clientKey: String(e.ClientKey), title: out.title, category, fileName: `${name}.pdf`.replace(/\.pdf\.pdf$/, ".pdf"), content: b64(out.bytes), publish: false, notify: false, assignedTo: [], requiresApproval: false }));
    const req = await portal.run((a) => a.createSigning({ clientKey: String(e.ClientKey), docId: d.document.id, title: out.title, signatoryIds: picked, sequential: false, message: "Please read and sign our engagement letter.", expiresInDays: 30 }));
    const names = req.request.signatories.map((x) => x.name);
    const ok = await apply(sendOut(e, { hash, portalDocId: d.document.id, signingId: req.request.id, docKey: String(row.Key), signatories: names, method: "portal" }, client, s.pcan, today, s.ctx()));
    if (ok) setPanel("");
    return ok;
  });
  const sendPaper = (to?: string) => run(async () => {
    const hash = await sealHash(String(e.Body));
    const sig = f.signatories.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
    const ok = await apply(sendOut(e, { hash, docKey: saved ? String(saved.row.Key) : String(e.DocKey || ""), signatories: sig, method: "paper" }, client, s.pcan, today, s.ctx()));
    if (ok) { setPanel(""); setSaved(undefined); if (to) setInfo(`Sent to ${to}.`); }
    return ok;
  });

  // ---- signature
  const checkSigning = () => run(async () => {
    const list = await portal.run((a) => a.signing(String(e.ClientKey)));
    const r = list.find((x) => x.id === e.SigningId);
    if (!r) return setErr("The signing request wasn't found on the portal."), false;
    if (r.status === "completed") {
      const who = r.signatories.filter((x) => x.status === "signed");
      const ok = await apply(markSigned(e, { by: who.map((x) => x.name).join(", "), at: r.completedAt || new Date().toISOString(), method: "portal", evidence: `Portal signing ${r.ref}`, sealedDocId: r.sealedDocId }, previous, client, s.eng, s.pcan, today, s.ctx()));
      return ok ? "Everyone has signed. The letter is now in force." : false;
    }
    if (r.status === "out") {
      const signedN = r.signatories.filter((x) => x.status === "signed").length;
      const progress = signedN ? `${signedN} of ${r.signatories.length}` : "";
      if (progress !== String(e.SignProgress || "")) await apply({ patches: [{ list: "Engagements", row: e, patch: { SignProgress: progress } }], log: [], activities: [] });
    }
    return r.status === "out" ? `Still waiting: ${r.signatories.filter((x) => x.status !== "signed").map((x) => x.name).join(", ")}.` : (setErr(`The signing request is ${r.status}. You can take the letter back and send it again.`), false);
  });
  const remind = () => run(async () => { const r = await portal.run((a) => a.remindSigning(String(e.SigningId))); return `Reminder sent to ${r.request.reminded}.`; });
  const recallIt = () => run(async () => { try { if (e.SigningId) await portal.run((a) => a.cancelSigning(String(e.SigningId))); } catch { /* it may already be closed */ } return apply(recall(e, "taken back", s.pcan, s.ctx())); });
  const recordSigned = () => run(async () => {
    let docKey: string | undefined;
    const pdf = signedPdf.current?.files?.[0];
    if (pdf) {
      if (!pdf.name.toLowerCase().endsWith(".pdf")) throw new Error("The signed copy has to be a PDF.");
      const { row } = await file(new Uint8Array(await pdf.arrayBuffer()), documentFileName(`${e.Ref} signed ${client?.Title || ""}`, today, ""), `${e.Title} (signed copy)`, client?.Title || "", String(e.ClientKey), String(e.Ref));
      docKey = String(row.Key);
    }
    const ok = await apply(markSigned(e, { by: form.by, at: `${form.at}T12:00:00.000Z`, method: status === "unsigned" ? "external" : "paper", evidence: form.evidence + (pdf ? " (signed copy filed)" : ""), docKey }, previous, client, s.eng, s.pcan, today, s.ctx()));
    if (ok) setPanel("");
    return ok;
  });

  // ---- renewal
  const startRenewal = () => run(async () => {
    const inp = ctxIn();
    if (!proposal || !version || !client || !inp) throw new Error("This letter wasn't made from a proposal here, so upload a replacement letter instead.");
    const g = generate({ ...inp, existing: s.engagements, previousKey: String(e.Key), effectiveDate: today, can: s.pcan, signatories: readList(e.Signatories) }, s.ctx());
    if ("error" in g) throw new Error(g.error);
    await s.apply({ patches: [], creates: [{ list: "Engagements", row: g.engagement }], log: [g.log as never], activities: [g.activity] });
    window.location.hash = `/sales/engagement/${g.engagement.Key}`;
  });
  const decideIt = (kind: "extend" | "no-new-letter" | "end") => run(async () => { const ok = await apply(decide(e, kind, { note: form.note, newDate: form.date }, s.eng, s.ecan, today, s.ctx())); if (ok) { setPanel(""); setForm({ ...form, note: "", date: "" }); } return ok; });
  const early = () => run(async () => { const ok = await apply(requestReview(e, form.note, s.pcan, s.ctx())); if (ok) { setPanel(""); setForm({ ...form, note: "" }); } return ok; });

  const decisions = readDecisions(e.Decisions);
  const draftEditable = status === "draft" && s.pcan("edit") && e.Source === "generated";
  const pending = successors.find((x) => isLive(x) && !isInForce(x));
  const gaps = coverageGaps(String(e.ClientKey), data.proposals, data.proposalVersions, s.engagements, s.catalogue);
  const rv = reviewStatus(s.eng, type);
  const yrs = reviewYears(s.eng, { engagementYears: e.ReviewYears, clientKey: String(e.ClientKey), type });

  return (
    <>
      <p><a href="#/sales/engagements">← Engagements</a></p>
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div className="row-wrap" style={{ justifyContent: "space-between", gap: 8 }}>
          <h2 style={{ margin: 0 }}>{String(e.Ref)}: {String(e.Title)}</h2>
          <span>{chip(e)}</span>
        </div>
        <p className="muted" style={{ margin: "6px 0 0" }}>
          For {client ? <a href={href("clients", client.Key)}>{client.Title}</a> : "—"}
          {proposal ? <> · from proposal <a href={href("sales", "proposal", String(proposal.Key))}>{String(proposal.Ref)}</a></> : e.Source === "uploaded" ? " · filed from outside the planner" : ""}
          {e.EffectiveDate ? <> · effective {fmtDate(String(e.EffectiveDate))}</> : null}
          {isInForce(e) && e.ReviewDate ? <> · {reviewLabel(e, today)}</> : null}
        </p>
        {previous && <p className="muted" style={{ margin: "4px 0 0" }}>Replaces <a href={href("sales", "engagement", String(previous.Key))}>{String(previous.Ref)}</a>.</p>}
        {successors.length > 0 && <p className="muted" style={{ margin: "4px 0 0" }}>Followed by {successors.map((x, i) => <span key={String(x.Key)}>{i ? ", " : ""}<a href={href("sales", "engagement", String(x.Key))}>{String(x.Ref)}</a> ({ENG_LABEL[asEng(x.Status)].toLowerCase()})</span>)}.</p>}
        {e.Hash && sealOk !== undefined && <p role={sealOk ? "status" : "alert"} style={{ margin: "8px 0 0", fontSize: 13, color: sealOk ? "var(--green)" : "var(--red-ink)" }}>{sealOk ? "This is exactly the letter that went out: its content matches the seal taken when it was sent." : "Warning: this letter no longer matches what was sent."}</p>}
        {status === "signed" && <div className="card" style={{ padding: 12, marginTop: 12, borderColor: "var(--green)" }}>Signed by {String(e.SignedBy)} on {fmtDate(String(e.SignedAt).slice(0, 10))} ({e.SignMethod === "portal" ? "through the client portal" : e.SignMethod === "external" ? "made outside the planner" : "on paper"}).{e.SignEvidence ? <div>Evidence: {String(e.SignEvidence)}</div> : null}</div>}
        {e.ReviewRequest ? <p role="status" style={{ marginBottom: 0, color: "var(--amber-ink)" }}>Early review requested: {String(e.ReviewRequest)}</p> : null}
        {status === "draft" && !rv.ok && e.Source === "generated" && <p role="alert" style={{ color: "var(--amber-ink)" }}>{rv.reason}</p>}
        {err && <p role="alert" style={{ color: "var(--red-ink)" }}>{err}</p>}
        {info && <p role="status" style={{ color: "var(--green)" }}>{info}</p>}

        <div className="row-wrap" style={{ gap: 8, marginTop: 12, alignItems: "center" }}>
          {status === "draft" && s.pcan("edit") && e.Source === "generated" && <button type="button" className="btn primary" disabled={busy} onClick={() => step("review")}>Submit for review</button>}
          {status === "draft" && s.pcan("approve") && e.Source === "generated" && <button type="button" className="btn" disabled={busy} onClick={() => step("approved")}>Approve now</button>}
          {status === "review" && s.pcan("approve") && <button type="button" className="btn primary" disabled={busy} onClick={() => step("approved")}>Approve</button>}
          {status === "review" && s.pcan("approve") && <button type="button" className="btn" disabled={busy} onClick={() => step("draft")}>Return to draft</button>}
          {status === "approved" && s.pcan("send") && <>
            <button type="button" className="btn primary" disabled={!people.length} title={people.length ? "" : "Nobody has portal access to this client yet"} onClick={() => { setPanel("portal"); setPicked([]); }}>Send for e-signature…</button>
            <button type="button" className="btn" onClick={() => { setPanel("paper"); setSaved(undefined); void prepare(); }}>Send another way…</button>
          </>}
          {status === "approved" && s.pcan("edit") && <button type="button" className="btn" disabled={busy} onClick={() => step("draft")}>Withdraw approval</button>}
          {status === "out" && e.SignMethod === "portal" && <><button type="button" className="btn primary" disabled={busy} onClick={checkSigning}>Check signing status</button><button type="button" className="btn" disabled={busy} onClick={remind}>Send a reminder</button></>}
          {(status === "out" || status === "unsigned") && s.pcan("record-acceptance") && <button type="button" className="btn" onClick={() => { setPanel("signed"); setForm({ ...form, by: readList(e.Signatories).join(", "), evidence: "" }); }}>Record that it was signed…</button>}
          {status === "out" && s.pcan("send") && <button type="button" className="btn" disabled={busy} onClick={recallIt}>Take it back</button>}
          {body.blocks.length > 0 && <button type="button" className="btn" disabled={busy} onClick={preview}>Preview PDF</button>}
        </div>

        {panel === "portal" && (
          <div className="card" style={{ padding: 12, marginTop: 12 }} role="group" aria-label="Send for e-signature">
            <p style={{ marginTop: 0 }}>The letter goes to the client's portal for the people you tick, and they sign it there. Only the people you name can sign. The signed copy and certificate are filed with the client's documents.</p>
            {people.map((p) => <label key={p.person.id} className="row-wrap"><input type="checkbox" checked={picked.includes(p.person.id)} onChange={(x) => setPicked(x.target.checked ? [...picked, p.person.id] : picked.filter((y) => y !== p.person.id))} /> {p.person.name || p.person.email} <span className="muted">({p.levelLabel})</span></label>)}
            <div className="row-wrap" style={{ marginTop: 10 }}><button type="button" className="btn primary" disabled={busy || !picked.length} onClick={sendPortal}>{busy ? "Sending…" : "Send for signature"}</button><button type="button" className="btn" onClick={() => setPanel("")}>Cancel</button></div>
          </div>
        )}
        {panel === "paper" && (
          <div className="card" style={{ padding: 12, marginTop: 12 }} role="group" aria-label="Send another way">
            {saved ? (
              <>
                <p style={{ marginTop: 0 }}>The PDF is filed in OneDrive and with the client's documents. Email it below, or mark it as sent if you've sent it another way. Record the signature when it comes back.</p>
                <label className="doc-field"><span>Who is to sign (names, separated by commas)</span><input className="input" value={f.signatories} onChange={(x) => setForm({ ...form, signatories: x.target.value })} /></label>
                {client && <EmailPanel client={client as never} saved={saved} signatory={s.me} intro={`Please find attached our engagement letter (${e.Ref}). Please sign and return it, or let us know if anything needs changing.`} onSent={async (to) => { await sendPaper(to); }} />}
                <div className="row-wrap" style={{ marginTop: 10 }}><button type="button" className="btn" disabled={busy} onClick={() => sendPaper()}>I've sent it another way: mark as sent</button><button type="button" className="btn" onClick={() => { setPanel(""); setSaved(undefined); }}>Close</button></div>
              </>
            ) : <p style={{ margin: 0 }}>{busy ? "Preparing the PDF…" : "Preparing…"}</p>}
          </div>
        )}
        {panel === "signed" && (
          <div className="card" style={{ padding: 12, marginTop: 12 }} role="group" aria-label="Record signature">
            <div className="form-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
              <label className="doc-field"><span>Who signed</span><input className="input" value={form.by} onChange={(x) => setForm({ ...form, by: x.target.value })} /></label>
              <label className="doc-field"><span>Date signed</span><input className="input" type="date" value={form.at} onChange={(x) => setForm({ ...form, at: x.target.value })} /></label>
              <label className="doc-field"><span>Signed copy (PDF, optional)</span><input ref={signedPdf} type="file" accept=".pdf,application/pdf" /></label>
            </div>
            <label className="doc-field" style={{ marginTop: 8 }}><span>How you know (for example, "Signed copy returned by email 3 Nov")</span><input className="input" value={form.evidence} onChange={(x) => setForm({ ...form, evidence: x.target.value })} /></label>
            <div className="row-wrap" style={{ marginTop: 10 }}><button type="button" className="btn primary" disabled={busy || !form.by.trim() || !form.evidence.trim()} onClick={recordSigned}>Record signature</button><button type="button" className="btn" onClick={() => setPanel("")}>Cancel</button></div>
          </div>
        )}
      </div>

      {draftEditable && (
        <section className="card pad stack" style={{ marginBottom: 16 }} aria-label="Letter details">
          <h3 style={{ margin: 0 }}>Details</h3>
          <div className="form-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
            <label className="doc-field"><span>Takes effect on</span><input className="input" type="date" value={f.effective} onChange={(x) => setForm({ ...form, effective: x.target.value })} /></label>
            <label className="doc-field"><span>Review after (years; blank uses {yrs})</span><input className="input" type="number" min={1} max={10} value={f.years} onChange={(x) => setForm({ ...form, years: x.target.value })} /></label>
            <label className="doc-field"><span>Who signs (names, separated by commas)</span><input className="input" value={f.signatories} onChange={(x) => setForm({ ...form, signatories: x.target.value })} /></label>
          </div>
          <label className="doc-field"><span>Notes (not in the letter)</span><textarea className="input" rows={2} value={f.notes} onChange={(x) => setForm({ ...form, notes: x.target.value })} /></label>
          <div className="row-wrap"><button type="button" className="btn primary" disabled={busy} onClick={saveDraft}>Save details</button><button type="button" className="btn" disabled={busy} onClick={rebuild}>Rebuild from the current wording</button></div>
          <p className="muted" style={{ margin: 0 }}>The wording below is built from your reviewed engagement settings and the accepted proposal. To change the wording itself, change it in Settings › Engagement letters (it has to be reviewed again).</p>
        </section>
      )}

      {isInForce(e) && (
        <section className="card pad stack" style={{ marginBottom: 16 }} aria-label="Review and renewal">
          <h3 style={{ margin: 0 }}>Review and renewal</h3>
          <p style={{ margin: 0 }}>Review date {e.ReviewDate ? fmtDate(String(e.ReviewDate)) : "not set"} ({yrs}-year interval). {pending ? <>A new letter is already in progress: <a href={href("sales", "engagement", String(pending.Key))}>{String(pending.Ref)}</a>.</> : null}</p>
          {gaps.length > 0 && <p role="status" style={{ margin: 0, color: "var(--amber-ink)" }}>Agreed but not covered by any engagement letter: {gaps.map((g) => g.name).join(", ")}. Consider an early review.</p>}
          <div className="row-wrap">
            {!pending && e.Source === "generated" && s.pcan("edit") && <button type="button" className="btn primary" disabled={busy} onClick={startRenewal}>Make a revised letter</button>}
            {!pending && s.pcan("edit") && <button type="button" className="btn" onClick={() => setPanel("replace")}>Upload a replacement letter</button>}
            {s.ecan("renewal-decision") && <button type="button" className="btn" onClick={() => { setPanel("extend"); setForm({ ...form, note: "", date: "" }); }}>Extend the review date…</button>}
            {s.ecan("renewal-decision") && <button type="button" className="btn" onClick={() => { setPanel("none"); setForm({ ...form, note: "" }); }}>No new letter needed for now…</button>}
            {s.pcan("edit") && <button type="button" className="btn" onClick={() => { setPanel("early"); setForm({ ...form, note: "" }); }}>Review early…</button>}
            {s.ecan("renewal-decision") && <button type="button" className="btn" onClick={() => { setPanel("end"); setForm({ ...form, note: "" }); }}>End this engagement…</button>}
          </div>
          {(panel === "extend" || panel === "none" || panel === "early" || panel === "end") && (
            <div className="card" style={{ padding: 12 }} role="group" aria-label="Decision">
              {panel === "extend" && <label className="doc-field"><span>New review date</span><input className="input" type="date" value={form.date} onChange={(x) => setForm({ ...form, date: x.target.value })} /></label>}
              {panel === "none" && <p style={{ marginTop: 0 }}>The current letter stays in force and the next review moves {yrs} years on from today.</p>}
              <label className="doc-field"><span>{panel === "early" ? "What has changed?" : "Reason (kept with the engagement)"}</span><textarea className="input" rows={2} value={form.note} onChange={(x) => setForm({ ...form, note: x.target.value })} /></label>
              <div className="row-wrap" style={{ marginTop: 10 }}>
                <button type="button" className="btn primary" disabled={busy || !form.note.trim()} onClick={() => (panel === "early" ? early() : decideIt(panel === "extend" ? "extend" : panel === "none" ? "no-new-letter" : "end"))}>Record</button>
                <button type="button" className="btn" onClick={() => setPanel("")}>Cancel</button>
              </div>
            </div>
          )}
          {panel === "replace" && <UploadEngagement replaces={e} onDone={() => setPanel("")} />}
        </section>
      )}

      {body.blocks.length > 0 && (
        <section className="card pad" aria-label="Letter" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>The letter</h3>
          <div className="doc-preview">{body.blocks.map((b, i) => <Block key={i} b={b} />)}</div>
        </section>
      )}
      {e.Source === "uploaded" && (
        <section className="card pad" style={{ marginBottom: 16 }}>
          <p style={{ margin: 0 }}>Made outside the planner. {e.FileUrl ? <a href={String(e.FileUrl)} target="_blank" rel="noreferrer noopener">Open the filed PDF</a> : null}</p>
          {readList(e.Signatories).length > 0 && <p className="muted" style={{ margin: "4px 0 0" }}>Signatories: {readList(e.Signatories).join(", ")}</p>}
          {e.Notes ? <p className="muted" style={{ margin: "4px 0 0" }}>{String(e.Notes)}</p> : null}
        </section>
      )}
      <section className="card pad" aria-label="History">
        <h3 style={{ marginTop: 0 }}>Decisions and history</h3>
        {!decisions.length && <p className="muted" style={{ margin: 0 }}>No renewal decisions yet.</p>}
        <ul className="plain">{decisions.map((d, i) => <li key={i}><strong>{DECISION_LABEL[d.decision] || d.decision}</strong> by {d.by} on {fmtDate(d.at.slice(0, 10))}{d.to && d.from !== d.to ? ` (review ${d.from} → ${d.to})` : ""}: {d.note}</li>)}</ul>
        <p className="muted" style={{ margin: 0 }}>Every change to this letter is also in the sales audit trail.</p>
      </section>
    </>
  );
}

function Block({ b }: { b: ReturnType<typeof readBody>["blocks"][number] }) {
  const runs = (rs: { t: string; b?: boolean; i?: boolean }[]) => rs.map((r, i) => <span key={i} style={{ fontWeight: r.b ? 700 : undefined, fontStyle: r.i ? "italic" : undefined }}>{r.t}</span>);
  if (b.type === "h") return b.level === 1 ? <h2>{runs(b.runs)}</h2> : b.level === 2 ? <h3>{runs(b.runs)}</h3> : <h4>{runs(b.runs)}</h4>;
  if (b.type === "p") return <p>{runs(b.runs)}</p>;
  if (b.type === "list") return <ul>{b.items.map((it, i) => <li key={i}>{runs(it)}</li>)}</ul>;
  if (b.type === "break") return <hr />;
  if (b.type === "table") return <div style={{ overflowX: "auto" }}><table className="tbl"><tbody>{b.rows.map((row, i) => <tr key={i}>{row.map((c, j) => (b.header && i === 0 ? <th key={j}>{runs(c.runs)}</th> : <td key={j} style={{ textAlign: c.align === "right" ? "right" : undefined }}>{runs(c.runs)}</td>))}</tr>)}</tbody></table></div>;
  return null;
}

// ------------------------------------------------------------------ on a client, and from a proposal

export function ClientEngagements({ clientKey }: { clientKey: string }) {
  const s = useSales();
  const { data } = useData();
  const [adding, setAdding] = useState(false);
  if (!s.can("view")) return null;
  const mine = s.engagements.filter((e) => e.ClientKey === clientKey && isLive(e));
  const gaps = coverageGaps(clientKey, data.proposals, data.proposalVersions, s.engagements, s.catalogue);
  const today = todayIso();
  return (
    <section className="card pad stack" aria-label="Engagements">
      <div className="row-wrap" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>Engagement letters</h2>
        {s.pcan("edit") && <button type="button" className="btn small" onClick={() => setAdding(!adding)}>{adding ? "Close" : "File a letter"}</button>}
      </div>
      {!mine.length && <p className="muted" style={{ margin: 0 }}>No engagement letters on file.</p>}
      <ul className="plain">{mine.map((e) => <li key={String(e.Key)}><a href={href("sales", "engagement", String(e.Key))}>{String(e.Ref)}</a> {chip(e)} {(() => { try { return (JSON.parse(String(e.ServiceNames || "[]")) as string[]).join(", "); } catch { return ""; } })()}{reviewLabel(e, today) ? <span className="muted"> · {reviewLabel(e, today)}</span> : null}</li>)}</ul>
      {gaps.length > 0 && <p role="status" style={{ margin: 0, color: "var(--amber-ink)" }}>Agreed but not in any letter: {gaps.map((g) => g.name).join(", ")}.</p>}
      {adding && <UploadEngagement clientKey={clientKey} onDone={() => setAdding(false)} />}
    </section>
  );
}

/** On an accepted proposal: make the engagement letter, or open the one that exists. */
export function ProposalEngagement({ proposal, version }: { proposal: Row; version: Row }) {
  const s = useSales();
  const { data } = useData();
  const docs = useDocs();
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const existing = s.engagements.filter((e) => e.ProposalKey === proposal.Key && Number(e.ProposalVersion) === Number(version.Version) && isLive(e));
  const client = data.clients.find((c) => c.Key === proposal.ClientKey);
  const brand = docs.brand(s.template.brandingId || undefined);
  const make = async () => {
    setBusy(true); setErr(undefined);
    try {
      if (!client) throw new Error("Make this lead a client first, then create the letter.");
      const g = generate({ proposal, version, client, settings: s.eng, catalogue: s.catalogue, existing: s.engagements, practice: brand.tradingName || brand.practiceName || "Our practice", today: todayIso(), can: s.pcan }, s.ctx());
      if ("error" in g) throw new Error(g.error);
      await s.apply({ patches: [], creates: [{ list: "Engagements", row: g.engagement }], log: [g.log as never], activities: [g.activity] });
      window.location.hash = `/sales/engagement/${g.engagement.Key}`;
    } catch (e) { setErr(msgOf(e)); } finally { setBusy(false); }
  };
  return (
    <div className="card" style={{ padding: 12, marginTop: 12 }} role="group" aria-label="Engagement letter">
      <strong>Engagement letter</strong>
      {existing.length ? <ul className="plain">{existing.map((e) => <li key={String(e.Key)}><a href={href("sales", "engagement", String(e.Key))}>{String(e.Ref)}</a> {chip(e)}</li>)}</ul> : (
        <>
          <p className="muted" style={{ margin: "4px 0 8px" }}>The accepted proposal agrees the services and fees. The engagement letter formalises scope, responsibilities and terms, and still has to be reviewed and signed.</p>
          {s.pcan("edit") && <button type="button" className="btn primary" disabled={busy} onClick={make}>Create the engagement letter</button>}
        </>
      )}
      {err && <p role="alert" style={{ color: "var(--red-ink)", marginBottom: 0 }}>{err}</p>}
    </div>
  );
}
