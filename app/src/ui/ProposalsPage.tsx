// Sales › Proposals: the list, the builder, the review and send steps, and recording what the client decided.
import { useEffect, useMemo, useState } from "react";
import { addDays } from "../lib/planning";
import { fmtDate } from "../lib/domain";
import {
  CLIENT_TYPES, calcLine, Content, Line, STATUS_CHIP, STATUS_LABEL, Status, VATS, FREQS, accept, advance, advanceOpp, asStatus, clientTypeFor, contentProblems, contentTotals, createProposal, customLine, editProblems,
  effectiveStatus, emptyContent, encodeContent, freqLabel, gbp, hashText, isFrozen, lineFromService, offeredFor, optionalLines, proposalDocument, readContent, reject, revise, reviewSummary, saveDraft,
  totalsFor, typeLabel, untouched, ClientType, Freq, Vat,
} from "../lib/proposals";
import { Opp, createOpp, isOpenOpp, outcomeOf } from "../lib/sales";
import { DEFAULT_LAYOUT, DocLayout } from "../lib/docModel";
import { todayIso } from "../lib/domain";
import { Row } from "../lib/schema";
import { href } from "./bits";
import { useData } from "./data";
import { EmailPanel } from "./DocsCreate";
import { LETTERS_FOLDER, clientFolder, documentFileName, makePdf, snapshotOf, useDocs } from "./docsKit";
import { money, useSales } from "./salesKit";
import { newKey } from "../lib/planning";

const PDF_TYPE = "application/pdf";
const chip = (s: Status) => <span className={`chip ${STATUS_CHIP[s]}`}>{STATUS_LABEL[s]}</span>;

// ------------------------------------------------------------------ list

export function ProposalsList() {
  const s = useSales();
  const { data } = useData();
  const [show, setShow] = useState<"live" | "all">("live");
  const today = todayIso();
  const rows = useMemo(() => data.proposals.map((p) => {
    const v = data.proposalVersions.filter((x) => x.ProposalKey === p.Key).sort((a, b) => Number(b.Version) - Number(a.Version))[0];
    return { p, v, status: v ? effectiveStatus(v, today) : asStatus(p.Status) };
  }).filter((r) => show === "all" || ["draft", "review", "approved", "sent", "accepted"].includes(r.status)).sort((a, b) => String(b.p.Updated || "").localeCompare(String(a.p.Updated || ""))), [data.proposals, data.proposalVersions, show, today]);
  const party = (p: Row) => (p.ClientKey ? data.clients.find((c) => c.Key === p.ClientKey)?.Title : s.leads.find((l) => l.Key === p.LeadKey)?.Title) || "";
  return (
    <>
      <div className="row-wrap" style={{ gap: 10, marginBottom: 12, alignItems: "center" }}>
        <div className="seg" role="group" aria-label="Show"><button type="button" aria-pressed={show === "live"} onClick={() => setShow("live")}>Current</button><button type="button" aria-pressed={show === "all"} onClick={() => setShow("all")}>All</button></div>
        <span className="muted" style={{ fontSize: 13 }}>Start a proposal from an opportunity, lead or client.</span>
        {s.pcan("configure") && <a className="btn" style={{ marginLeft: "auto" }} href="#/settings/services">Services & pricing</a>}
      </div>
      {rows.length ? (
        <div className="card table-wrap"><table className="table">
          <thead><tr><th>Reference</th><th>For</th><th>Title</th><th>Version</th><th>Status</th><th>First year (inc. VAT)</th><th>Valid until</th></tr></thead>
          <tbody>{rows.map(({ p, v, status }) => (
            <tr key={String(p.Key)}>
              <td><a href={href("sales", "proposal", String(p.Key))}>{String(p.Ref)}</a></td><td>{party(p)}</td><td>{String(p.Title || "")}</td><td>{v ? `v${v.Version}` : ""}</td>
              <td>{chip(status)}</td><td>{money(v?.FirstYearGross)}</td><td>{v?.ValidUntil ? fmtDate(String(v.ValidUntil)) : ""}</td>
            </tr>
          ))}</tbody>
        </table></div>
      ) : <div className="card empty"><p>{data.proposals.length ? "No current proposals." : "No proposals yet. Open an opportunity and choose New proposal."}</p></div>}
    </>
  );
}

/** Proposals of a party or opportunity, with a button to start one. Used on opportunity, lead and client pages. */
export function ProposalLinks({ oppKey, leadKey, clientKey, opps, only }: { oppKey?: string; leadKey?: string; clientKey?: string; opps?: Opp[]; only?: boolean }) {
  const s = useSales();
  const { data } = useData();
  const [starting, setStarting] = useState(false);
  const mine = data.proposals.filter((p) => (only && oppKey ? p.OppKey === oppKey : (oppKey && p.OppKey === oppKey) || (leadKey && p.LeadKey === leadKey) || (clientKey && p.ClientKey === clientKey)));
  const today = todayIso();
  const can = s.pcan("edit");
  const pool = opps || s.opps.filter((o) => o.Key === oppKey);
  return (
    <div style={{ marginTop: 12 }}>
      <div className="row-wrap" style={{ justifyContent: "space-between" }}>
        <strong>Proposals</strong>
        {can && !starting && <button type="button" className="btn small" onClick={() => setStarting(true)}>+ New proposal</button>}
      </div>
      {starting && <NewProposal oppKey={oppKey} leadKey={leadKey} clientKey={clientKey} opps={pool} onClose={() => setStarting(false)} />}
      {mine.length ? <ul className="plain" style={{ marginTop: 8 }}>{mine.map((p) => {
        const v = data.proposalVersions.filter((x) => x.ProposalKey === p.Key).sort((a, b) => Number(b.Version) - Number(a.Version))[0];
        return <li key={String(p.Key)} style={{ marginBottom: 4 }}><a href={href("sales", "proposal", String(p.Key))}>{String(p.Ref)}: {String(p.Title)}</a> {chip(v ? effectiveStatus(v, today) : asStatus(p.Status))} {v && money(v.FirstYearGross) ? <span className="muted">{money(v.FirstYearGross)} first year</span> : null}</li>;
      })}</ul> : <p className="muted" style={{ margin: "6px 0 0" }}>None yet.</p>}
    </div>
  );
}

// ------------------------------------------------------------------ start one

function NewProposal({ oppKey, leadKey, clientKey, opps, onClose }: { oppKey?: string; leadKey?: string; clientKey?: string; opps: Opp[]; onClose: () => void }) {
  const s = useSales();
  const { data, create } = useData();
  const open = opps.filter(isOpenOpp).filter((o) => (!leadKey || o.LeadKey === leadKey) && (!clientKey || o.ClientKey === clientKey));
  const [pick, setPick] = useState(oppKey || open[0]?.Key || "new");
  const [title, setTitle] = useState("");
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const chosen = open.find((o) => o.Key === pick);
  const party = chosen || { LeadKey: leadKey, ClientKey: clientKey };
  const client = data.clients.find((c) => c.Key === (party.ClientKey || clientKey));
  const lead = s.leads.find((l) => l.Key === (party.LeadKey || leadKey));
  const make = async () => {
    setErr(undefined); setBusy(true);
    try {
      const o = s.ctx();
      let opp = chosen;
      const name = client?.Title || lead?.Title || "";
      if (!opp) {
        const r = createOpp({ title: title.trim() || `${name} proposal`, leadKey: lead?.Key, clientKey: client?.Key, stage: s.stages.find((x) => x.key === "preparing")?.key || s.stages[0].key, owner: s.me }, s.opps, o);
        if ("error" in r) { setErr(r.error); return; }
        await create("Opportunities", r.opp); await create("SalesLog", r.log); await create("Activities", r.activity);
        opp = r.opp as Opp;
      }
      const content: Content = {
        ...emptyContent(), title: title.trim() || `Proposal for ${name}`, clientType: client ? clientTypeFor(String(client.Kind || "")) : lead?.Kind === "individual" ? "individual" : "limited",
        recipientName: String(lead?.ContactName || client?.Title || ""), recipientEmail: String(lead?.Email || client?.Email || ""), validUntil: addDays(o.now.slice(0, 10), 30), vatRate: s.vatRate,
      };
      const r = createProposal(opp, content, data.proposals, o);
      if ("error" in r) { setErr(r.error); return; }
      await create("Proposals", r.proposal); await create("ProposalVersions", r.version); await create("SalesLog", r.log); await create("Activities", r.activity);
      const moved = advanceOpp(opp, s.stages.find((x) => x.key === "preparing")?.key || "", s.opps, s.stages, o);
      if (moved) await s.apply(moved);
      window.location.hash = href("sales", "proposal", String(r.proposal.Key));
    } catch { setErr("That didn't save. Try again."); } finally { setBusy(false); }
  };
  return (
    <div className="card" style={{ padding: 14, marginTop: 8 }}>
      <div className="row-wrap" style={{ gap: 10, alignItems: "flex-end" }}>
        {!oppKey && (
          <label className="doc-field"><span>Opportunity</span>
            <select className="input" value={pick} onChange={(e) => setPick(e.target.value)}>
              {open.map((o) => <option key={o.Key} value={o.Key}>{o.Title}</option>)}<option value="new">A new opportunity</option>
            </select></label>
        )}
        <label className="doc-field" style={{ flex: 1, minWidth: 240 }}><span>Proposal title</span><input className="input" value={title} placeholder={`Proposal for ${client?.Title || lead?.Title || ""}`} onChange={(e) => setTitle(e.target.value)} /></label>
        <button type="button" className="btn primary" disabled={busy} onClick={make}>Start proposal</button>
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
      </div>
      {err && <p role="alert" style={{ color: "var(--red-ink)", marginBottom: 0 }}>{err}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ one proposal

export function ProposalDetail({ propKey }: { propKey: string }) {
  const s = useSales();
  const { data, create, update } = useData();
  const docs = useDocs();
  const today = todayIso();
  const proposal = data.proposals.find((p) => p.Key === propKey);
  const versions = useMemo(() => data.proposalVersions.filter((v) => v.ProposalKey === propKey).sort((a, b) => Number(a.Version) - Number(b.Version)), [data.proposalVersions, propKey]);
  const [viewing, setViewing] = useState<number>();
  const current = versions[versions.length - 1];
  const version = (viewing && versions.find((v) => Number(v.Version) === viewing)) || current;
  const isCurrent = version === current;
  const status: Status = version ? effectiveStatus(version, today) : "draft";
  const [content, setContent] = useState<Content>(() => readContent(version?.Body));
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState<string>();
  const [info, setInfo] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<"" | "send" | "accept" | "reject" | "return">("");
  const [sealed, setSealed] = useState<boolean | undefined>();
  const vkey = version ? `${version.Key}:${version.Updated}` : "";
  useEffect(() => { if (version && !dirty) setContent(readContent(version.Body)); }, [vkey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setDirty(false); setPanel(""); setErr(undefined); setInfo(undefined); if (version) setContent(readContent(version.Body)); }, [version?.Key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { let live = true; setSealed(undefined); if (version?.Hash) void untouched(version).then((ok) => live && setSealed(ok)); return () => { live = false; }; }, [version?.Key, version?.Body, version?.Hash]);

  if (!proposal || !version) return <div className="card empty"><p>That proposal isn't here. <a href="#/sales/proposals">Back to proposals</a></p></div>;
  const opp = s.opps.find((o) => o.Key === proposal.OppKey);
  const client = data.clients.find((c) => c.Key === proposal.ClientKey);
  const lead = s.leads.find((l) => l.Key === proposal.LeadKey);
  const partyName = client?.Title || lead?.Title || "";
  const editable = isCurrent && status === "draft" && s.pcan("edit");
  const who = { can: s.pcan, independent: s.cfg.independentReview };
  const totals = contentTotals(content);
  const optTotals = totalsFor(optionalLines(content), content.vatRate);
  const type = content.clientType;
  const offered = offeredFor(s.catalogue, type);

  const run = async (fn: () => Promise<void | boolean>) => {
    setErr(undefined); setInfo(undefined); setBusy(true);
    try { return await fn(); } catch (e) { setErr(e instanceof Error && e.message ? e.message : "That didn't save. Try again."); return false; } finally { setBusy(false); }
  };
  const change = (patch: Partial<Content>) => { setContent((c) => ({ ...c, ...patch })); setDirty(true); };
  const setLine = (id: string, patch: Partial<Line>) => change({ lines: content.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
  const move = (i: number, d: number) => { const a = [...content.lines]; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; change({ lines: a }); };

  const problemsForSave = () => {
    const wrong = editProblems(readContent(version.Body), content, s.pcan, s.discountLimit);
    return wrong[0];
  };
  const doSave = () => run(async () => {
    const bad = problemsForSave();
    if (bad) { setErr(bad); return false; }
    const w = saveDraft(proposal, version, content, s.ctx());
    if ("error" in w) { setErr(w.error); return false; }
    await s.apply(w); setDirty(false); setInfo("Saved.");
  });
  const step = (to: Status, extra: { note?: string } = {}) => run(async () => {
    if (dirty) { const ok = await doSave(); if (ok === false) return false; }
    if (to === "review" || to === "approved") { const bad = contentProblems(content, today, true); if (bad.length) { setErr(bad[0]); return false; } }
    const w = advance(proposal, { ...version, Body: dirty ? encodeContent(content) : version.Body }, { to, note: extra.note }, who, today, s.ctx());
    if ("error" in w) { setErr(w.error); return false; }
    await s.apply(w); setPanel("");
  });
  const doRevise = () => run(async () => {
    const w = revise(proposal, version, versions, s.ctx(), s.pcan);
    if ("error" in w) { setErr(w.error); return false; }
    await s.apply(w); setViewing(undefined);
  });

  // ---- the document
  const brand = docs.brand(s.template.brandingId || undefined);
  const buildPdf = async (c: Content, v: Row) => {
    const doc = proposalDocument(c, s.template, { client: partyName || c.recipientName, practice: brand.tradingName || brand.practiceName || "Our practice", contact: c.recipientName, reference: String(proposal.Ref), date: today, version: Number(v.Version) });
    const layout: DocLayout = { ...DEFAULT_LAYOUT, header: brand.header || "", footer: brand.footer || "" };
    const title = `${c.title || "Proposal"} – ${partyName}`;
    return { doc, layout, title, ...(await makePdf({ content: doc, layout, branding: brand, title, reference: String(proposal.Ref), author: s.me })) };
  };
  const view = () => run(async () => {
    const out = await buildPdf(content, version);
    const url = URL.createObjectURL(new Blob([out.bytes as BlobPart], { type: PDF_TYPE }));
    window.open(url, "_blank", "noopener");
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  });

  // ---- sending
  const [saved, setSaved] = useState<{ name: string; bytes: Uint8Array; row: Row; title: string }>();
  const prepareSend = () => run(async () => {
    const out = await buildPdf(readContent(version.Body), version);
    const name = documentFileName(`${proposal.Ref} v${version.Version} ${partyName}`, today, "");
    let url = "";
    try {
      const path = `/me/drive/root:/${encodeURIComponent(LETTERS_FOLDER)}/${encodeURIComponent(clientFolder(partyName || "Prospects"))}/${encodeURIComponent(name)}:/content`;
      const item = await docs.store.graph.put<{ webUrl?: string }>(path, out.bytes, PDF_TYPE);
      url = item.webUrl || "";
    } catch { throw new Error("Couldn't save the PDF to OneDrive. Nothing was sent. Try again."); }
    const row = await docs.create("Documents", {
      Key: newKey("D"), Title: out.title, ClientKey: client?.Key || "", TemplateName: "Proposal", Category: "Fee proposals", Reference: String(proposal.Ref), Created: new Date().toISOString(), CreatedBy: s.me,
      BrandingId: brand.id, FileUrl: url, FileName: name, Pages: out.pages, Status: "Saved", ProposalKey: String(proposal.Key), OppKey: String(proposal.OppKey || ""), LeadKey: String(proposal.LeadKey || ""),
      Snapshot: snapshotOf(out.doc, out.layout, { proposal: proposal.Ref, version: version.Number }),
    });
    setSaved({ name, bytes: out.bytes, row, title: out.title });
  });
  const markSent = (to: string) => run(async () => {
    const body = String(version.Body);
    const w = advance(proposal, version, { to: "sent", hash: await hashText(body), sentTo: to, docKey: saved ? String(saved.row.Key) : undefined }, who, today, s.ctx());
    if ("error" in w) { setErr(w.error); return false; }
    await s.apply(w);
    if (opp) { const m = advanceOpp(opp, s.stages.find((x) => x.key === "sent")?.key || "", s.opps, s.stages, s.ctx()); if (m) await s.apply(m); }
    setPanel(""); setSaved(undefined);
  });

  return (
    <>
      <p><a href="#/sales/proposals">← Proposals</a></p>
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div className="row-wrap" style={{ justifyContent: "space-between", gap: 8 }}>
          <h2 style={{ margin: 0 }}>{String(proposal.Ref)}: {content.title || String(proposal.Title)}</h2>
          <span>{chip(status)}</span>
        </div>
        <p className="muted" style={{ margin: "6px 0 0" }}>
          For {client ? <a href={href("clients", client.Key)}>{client.Title}</a> : lead ? <a href={href("sales", "lead", lead.Key)}>{lead.Title}</a> : "—"}
          {opp ? <> · opportunity <a href={href("sales", "opp", opp.Key)}>{opp.Title}</a></> : null}
          {version.SentOn ? <> · sent {fmtDate(String(version.SentOn).slice(0, 10))} to {String(version.SentTo)}</> : null}
        </p>
        {versions.length > 1 && (
          <div className="row-wrap" style={{ gap: 6, marginTop: 10, alignItems: "center" }}>
            <span className="muted">Versions</span>
            {versions.map((v) => <button key={String(v.Key)} type="button" className="btn small" aria-pressed={v === version} style={v === version ? { fontWeight: 700 } : undefined} onClick={() => setViewing(Number(v.Version))}>v{String(v.Version)} {STATUS_LABEL[effectiveStatus(v, today)].toLowerCase()}</button>)}
          </div>
        )}
        {!isCurrent && <p role="status" className="muted" style={{ marginBottom: 0 }}>You're looking at an earlier version. It can't be changed. <button type="button" className="btn small" onClick={() => setViewing(undefined)}>Back to the latest</button></p>}
        {version.Hash && sealed !== undefined && <p style={{ margin: "8px 0 0", fontSize: 13, color: sealed ? "var(--green)" : "var(--red-ink)" }} role={sealed ? "status" : "alert"}>{sealed ? "This is exactly what was sent: its content matches the seal taken when it went out." : "Warning: this version no longer matches what was sent."}</p>}
        {status === "accepted" && (
          <div className="card" style={{ padding: 12, marginTop: 12, borderColor: "var(--green)" }}>
            <strong>Accepted by {String(version.AcceptedBy)}</strong> on {fmtDate(String(version.AcceptedAt).slice(0, 10))} ({String(version.AcceptMethod) === "link" ? "through the secure link" : "recorded by staff"}).
            {version.AcceptEvidence ? <div>Evidence: {String(version.AcceptEvidence)}</div> : null}
            <p className="muted" style={{ margin: "6px 0 0" }}>Accepting the proposal agrees the services and fees only. The identity and AML checks and the signed engagement letter are separate steps and still to do.</p>
          </div>
        )}
        {status === "rejected" && <p style={{ marginBottom: 0 }}>Turned down: {String(version.RejectedReason || "")}</p>}
        {status === "draft" && version.ReturnNote ? <p style={{ marginBottom: 0 }}>Returned with a note: {String(version.ReturnNote)}</p> : null}
        {err && <p role="alert" style={{ color: "var(--red-ink)" }}>{err}</p>}
        {info && <p role="status" style={{ color: "var(--green)" }}>{info}</p>}
        {isCurrent && (
          <div className="row-wrap" style={{ gap: 8, marginTop: 12, alignItems: "center" }}>
            {status === "draft" && s.pcan("edit") && <button type="button" className="btn" disabled={busy || !dirty} onClick={doSave}>Save draft</button>}
            {status === "draft" && s.pcan("edit") && <button type="button" className="btn primary" disabled={busy} onClick={() => step("review")}>Submit for review</button>}
            {status === "draft" && s.pcan("approve") && <button type="button" className="btn" disabled={busy} onClick={() => step("approved")}>Approve now</button>}
            {status === "review" && s.pcan("approve") && <button type="button" className="btn primary" disabled={busy} onClick={() => step("approved")}>Approve</button>}
            {status === "review" && s.pcan("approve") && <button type="button" className="btn" onClick={() => setPanel("return")}>Return to draft…</button>}
            {status === "approved" && s.pcan("send") && <button type="button" className="btn primary" onClick={() => { setPanel("send"); void prepareSend(); }}>Send…</button>}
            {status === "approved" && s.pcan("edit") && <button type="button" className="btn" disabled={busy} onClick={() => step("draft")}>Withdraw approval</button>}
            {status === "sent" && s.pcan("record-acceptance") && <button type="button" className="btn primary" onClick={() => setPanel("accept")}>Record acceptance…</button>}
            {(status === "sent" || status === "expired") && s.pcan("record-acceptance") && <button type="button" className="btn" onClick={() => setPanel("reject")}>Record that it was turned down…</button>}
            {["sent", "rejected", "expired"].includes(status) && s.pcan("edit") && <button type="button" className="btn" disabled={busy} onClick={doRevise}>Make a revision</button>}
            <button type="button" className="btn" disabled={busy} onClick={view}>Preview PDF</button>
          </div>
        )}
        {status === "review" && <ul className="plain muted" style={{ marginTop: 10 }}>{reviewSummary(content, totals).map((x) => <li key={x}>{x}</li>)}</ul>}

        {panel === "return" && <ReasonForm label="What needs changing?" action="Return to draft" onCancel={() => setPanel("")} onGo={(t) => step("draft", { note: t })} />}
        {panel === "reject" && <ReasonForm label="Why was it turned down?" action="Record" required onCancel={() => setPanel("")} onGo={(t) => run(async () => { const w = reject(proposal, version, t, who, today, s.ctx()); if ("error" in w) { setErr(w.error); return false; } await s.apply(w); setPanel(""); })} />}
        {panel === "accept" && <AcceptForm content={content} defaultName={content.recipientName} defaultEmail={content.recipientEmail} onCancel={() => setPanel("")} onGo={(a) => run(async () => {
          if (!(await untouched(version))) { setErr("This version no longer matches what was sent, so it can't be accepted. Make a revision."); return false; }
          const w = accept(proposal, version, { ...a, method: "recorded" }, who, today, opp, s.opps, s.stages, s.ctx());
          if ("error" in w) { setErr(w.error); return false; }
          await s.apply(w); setPanel("");
        })} />}
        {panel === "send" && (
          <div className="card" style={{ padding: 12, marginTop: 12 }}>
            {saved ? (
              <>
                <p style={{ marginTop: 0 }}>The PDF is filed in OneDrive and recorded with the client's documents. Email it below, or mark it as sent if you've sent it another way.</p>
                <EmailPanel
                  client={{ Key: "", Title: content.recipientName || partyName, Email: content.recipientEmail } as never}
                  saved={saved} signatory={s.me} intro={`Please find attached our proposal (${proposal.Ref}). It is valid until ${content.validUntil ? new Date(content.validUntil + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "the date shown"}.`}
                  onSent={async (to) => { await markSent(to); }}
                />
                <div className="row-wrap" style={{ gap: 8, marginTop: 10 }}>
                  <button type="button" className="btn" disabled={busy} onClick={() => markSent(content.recipientEmail || "sent separately")}>I've sent it another way: mark as sent</button>
                  <button type="button" className="btn" onClick={() => { setPanel(""); setSaved(undefined); }}>Close</button>
                </div>
              </>
            ) : <p style={{ margin: 0 }}>{busy ? "Preparing the PDF…" : "Preparing…"}</p>}
          </div>
        )}
      </div>

      <div className="cols">
        <section className="card pad stack" style={{ flex: "2 1 520px" }} aria-label="Proposal">
          <h2 style={{ margin: 0 }}>{editable ? "Proposal" : "What was offered"}</h2>
          <div className="form-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12 }}>
            <label className="doc-field"><span>Title</span><input className="input" disabled={!editable} value={content.title} onChange={(e) => change({ title: e.target.value })} /></label>
            <label className="doc-field"><span>Client type</span><select className="input" disabled={!editable} value={content.clientType} onChange={(e) => change({ clientType: e.target.value as ClientType })}>{CLIENT_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label className="doc-field"><span>Sent to (name)</span><input className="input" disabled={!editable} value={content.recipientName} onChange={(e) => change({ recipientName: e.target.value })} /></label>
            <label className="doc-field"><span>Sent to (email)</span><input className="input" type="email" disabled={!editable} value={content.recipientEmail} onChange={(e) => change({ recipientEmail: e.target.value })} /></label>
            <label className="doc-field"><span>Proposed start date</span><input className="input" type="date" disabled={!editable} value={content.startDate} onChange={(e) => change({ startDate: e.target.value })} /></label>
            <label className="doc-field"><span>Valid until</span><input className="input" type="date" disabled={!editable} value={content.validUntil} onChange={(e) => change({ validUntil: e.target.value })} /></label>
            <label className="doc-field"><span>VAT rate (%)</span><input className="input" inputMode="decimal" disabled={!editable} value={String(Math.round(content.vatRate * 1000) / 10)} onChange={(e) => { const n = Number(e.target.value); if (n >= 0 && n <= 100) change({ vatRate: n / 100 }); }} /></label>
          </div>
          <label className="doc-field"><span>Introduction (leave blank to use your standard wording)</span><textarea className="input" rows={3} disabled={!editable} value={content.introduction} onChange={(e) => change({ introduction: e.target.value })} /></label>
          <label className="doc-field"><span>What the client has asked for</span><textarea className="input" rows={3} disabled={!editable} value={content.requirements} onChange={(e) => change({ requirements: e.target.value })} /></label>

          <h3 style={{ marginBottom: 0 }}>Services</h3>
          {content.lines.map((l, i) => <LineEditor key={l.id} line={l} editable={editable} rate={content.vatRate} onChange={(p) => setLine(l.id, p)} onRemove={() => change({ lines: content.lines.filter((x) => x.id !== l.id) })} onMove={(d) => move(i, d)} first={i === 0} last={i === content.lines.length - 1} />)}
          {!content.lines.length && <p className="muted" style={{ margin: 0 }}>No services yet.</p>}
          {editable && (
            <div className="row-wrap" style={{ gap: 8, alignItems: "center" }}>
              <select className="input" style={{ maxWidth: 320 }} aria-label="Add a service from the catalogue" value="" onChange={(e) => { const svc = offered.find((x) => x.key === e.target.value); if (svc) change({ lines: [...content.lines, lineFromService(svc, type, newKey("ln"))] }); }}>
                <option value="">Add a service from the catalogue…</option>
                {offered.map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}
              </select>
              <button type="button" className="btn" onClick={() => change({ lines: [...content.lines, customLine(newKey("ln"))] })}>+ Custom line</button>
              {!offered.length && <span className="muted" style={{ fontSize: 12 }}>Nothing is offered yet for {typeLabel(type).toLowerCase()}. Set services up under Settings › Services & pricing.</span>}
            </div>
          )}
          <label className="doc-field"><span>Internal notes (never shown to the client)</span><textarea className="input" rows={2} disabled={!editable} value={content.notes} onChange={(e) => change({ notes: e.target.value })} /></label>
        </section>

        <aside className="card pad stack" style={{ flex: "1 1 280px", maxWidth: 380, alignSelf: "flex-start" }} aria-label="Totals">
          <h2 style={{ margin: 0 }}>Totals</h2>
          <TotalsTable t={totals} />
          {optionalLines(content).length > 0 && <><h3 style={{ marginBottom: 0 }}>Optional services (not included above)</h3><TotalsTable t={optTotals} /></>}
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>Amounts excluding VAT are shown as "net". VAT is worked out at {Math.round(content.vatRate * 1000) / 10}% on standard-rated services. These are agreed fees, not invoices or money received.</p>
        </aside>
      </div>
    </>
  );
}

function TotalsTable({ t }: { t: ReturnType<typeof contentTotals> }) {
  const rows: [string, string, boolean?][] = [
    ["Monthly recurring (net)", gbp(t.monthlyRecurring)], ["Annual recurring (net)", gbp(t.annualRecurringNet)], ["One-off and set-up (net)", gbp(t.oneOffNet)], ["Discounts, first year", gbp(t.discounts)],
    ["First year (net)", gbp(t.firstYearNet)], ["VAT, first year", gbp(t.firstYearVat)], ["First year (inc. VAT)", gbp(t.firstYearGross), true],
    ["Each year after (net)", gbp(t.ongoingNet)], ["Each year after (inc. VAT)", gbp(t.ongoingGross), true],
  ];
  return <table className="table"><tbody>{rows.map(([k, v, b]) => <tr key={k}><td style={b ? { fontWeight: 700 } : undefined}>{k}</td><td style={{ textAlign: "right", fontWeight: b ? 700 : 400 }}>{v}</td></tr>)}</tbody></table>;
}

function LineEditor({ line: l, editable, rate, onChange, onRemove, onMove, first, last }: { line: Line; editable: boolean; rate: number; onChange: (p: Partial<Line>) => void; onRemove: () => void; onMove: (d: number) => void; first: boolean; last: boolean }) {
  const overridden = l.catalogPrice !== undefined && l.catalogPrice !== l.price;
  return (
    <div className="card" style={{ padding: 12 }} role="group" aria-label={l.name || "New line"}>
      <div className="row-wrap" style={{ gap: 8, alignItems: "flex-end" }}>
        <label className="doc-field" style={{ flex: "2 1 200px" }}><span>Service</span><input className="input" disabled={!editable} value={l.name} onChange={(e) => onChange({ name: e.target.value })} /></label>
        <label className="doc-field" style={{ flex: "1 1 130px" }}><span>Charged</span><select className="input" disabled={!editable} value={l.frequency} onChange={(e) => onChange({ frequency: e.target.value as Freq })}>{FREQS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
        <label className="doc-field" style={{ flex: "1 1 100px" }}><span>Price (£ net)</span><input className="input" inputMode="decimal" disabled={!editable} value={String(l.price)} onChange={(e) => onChange({ price: Math.max(0, Number(e.target.value) || 0) })} /></label>
        <label className="doc-field" style={{ flex: "1 1 100px" }}><span>Set-up (£)</span><input className="input" inputMode="decimal" disabled={!editable} value={String(l.setupFee)} onChange={(e) => onChange({ setupFee: Math.max(0, Number(e.target.value) || 0) })} /></label>
        <label className="doc-field" style={{ flex: "1 1 140px" }}><span>VAT</span><select className="input" disabled={!editable} value={l.vat} onChange={(e) => onChange({ vat: e.target.value as Vat })}>{VATS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
      </div>
      <div className="row-wrap" style={{ gap: 8, alignItems: "flex-end", marginTop: 8 }}>
        <label className="doc-field" style={{ width: 130 }}><span>Discount</span>
          <select className="input" disabled={!editable} value={l.discount?.kind || ""} onChange={(e) => onChange({ discount: e.target.value ? { kind: e.target.value as "pct" | "amount", value: l.discount?.value || 0, reason: l.discount?.reason } : undefined })}>
            <option value="">None</option><option value="pct">Percent</option><option value="amount">Amount (£)</option></select></label>
        {l.discount && <label className="doc-field" style={{ width: 100 }}><span>{l.discount.kind === "pct" ? "%" : "£"}</span><input className="input" inputMode="decimal" disabled={!editable} value={String(l.discount.value)} onChange={(e) => onChange({ discount: { ...l.discount!, value: Math.max(0, Number(e.target.value) || 0) } })} /></label>}
        {l.discount && <label className="doc-field" style={{ flex: "1 1 180px" }}><span>Reason (internal)</span><input className="input" disabled={!editable} value={l.discount.reason || ""} onChange={(e) => onChange({ discount: { ...l.discount!, reason: e.target.value } })} /></label>}
        <label className="row-wrap" style={{ gap: 6 }}><input type="checkbox" disabled={!editable} checked={!!l.optional} onChange={(e) => onChange({ optional: e.target.checked || undefined })} /> Optional</label>
        <span className="muted" style={{ marginLeft: "auto", fontSize: 13 }}>{gbp(calcLine(l, rate).net)} net {l.frequency === "one-off" || l.frequency === "fixed" ? "once" : freqLabel(l.frequency).toLowerCase()}{calcLine(l, rate).annualNet ? ` · ${gbp(calcLine(l, rate).annualNet)} a year` : ""}</span>
      </div>
      {overridden && <p className="muted" style={{ margin: "6px 0 0", fontSize: 12 }}>Catalogue price is £{l.catalogPrice}. This proposal changes it.</p>}
      <details style={{ marginTop: 8 }}>
        <summary style={{ cursor: "pointer" }}>Wording, scope and responsibilities</summary>
        {([["description", "What the client reads"], ["scope", "Included (one per line)"], ["exclusions", "Not included (one per line)"], ["clientResp", "Client responsibilities"], ["practiceResp", "Our responsibilities"]] as [keyof Line, string][]).map(([k, label]) => (
          <label key={k} className="doc-field" style={{ marginTop: 8 }}><span>{label}</span><textarea className="input" rows={k === "description" ? 3 : 2} disabled={!editable} value={String(l[k] ?? "")} onChange={(e) => onChange({ [k]: e.target.value } as Partial<Line>)} /></label>
        ))}
      </details>
      {editable && <div className="row-wrap" style={{ gap: 6, marginTop: 8 }}>
        <button type="button" className="btn small" disabled={first} onClick={() => onMove(-1)} aria-label={`Move ${l.name || "line"} up`}>↑</button>
        <button type="button" className="btn small" disabled={last} onClick={() => onMove(1)} aria-label={`Move ${l.name || "line"} down`}>↓</button>
        <button type="button" className="btn small" onClick={onRemove}>Remove</button>
      </div>}
    </div>
  );
}

function ReasonForm({ label, action, required, onGo, onCancel }: { label: string; action: string; required?: boolean; onGo: (t: string) => void; onCancel: () => void }) {
  const [t, setT] = useState("");
  return (
    <div className="card" style={{ padding: 12, marginTop: 12 }}>
      <label className="doc-field"><span>{label}</span><textarea className="input" rows={2} value={t} onChange={(e) => setT(e.target.value)} autoFocus /></label>
      <div className="row-wrap" style={{ gap: 8, marginTop: 8 }}><button type="button" className="btn primary" disabled={required && !t.trim()} onClick={() => onGo(t)}>{action}</button><button type="button" className="btn" onClick={onCancel}>Cancel</button></div>
    </div>
  );
}

function AcceptForm({ content, defaultName, defaultEmail, onGo, onCancel }: { content: Content; defaultName: string; defaultEmail: string; onGo: (a: { name: string; email: string; evidence: string; optional: string[] }) => void; onCancel: () => void }) {
  const [name, setName] = useState(defaultName);
  const [email, setEmail] = useState(defaultEmail);
  const [evidence, setEvidence] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const opt = optionalLines(content);
  return (
    <div className="card" style={{ padding: 12, marginTop: 12 }} role="group" aria-label="Record acceptance">
      <p style={{ marginTop: 0 }}>Record that the client accepted this version. Keep the evidence (the email or a note of the call) with the client's documents.</p>
      <div className="form-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
        <label className="doc-field"><span>Who accepted</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="doc-field"><span>Their email</span><input className="input" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      </div>
      <label className="doc-field" style={{ marginTop: 8 }}><span>How you know (for example, "Email from Ann on 25 Oct")</span><input className="input" value={evidence} onChange={(e) => setEvidence(e.target.value)} /></label>
      {opt.length > 0 && <fieldset style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 10, marginTop: 8 }}><legend>Optional services they chose</legend>
        {opt.map((l) => <label key={l.id} className="row-wrap" style={{ gap: 6 }}><input type="checkbox" checked={chosen.includes(l.id)} onChange={(e) => setChosen(e.target.checked ? [...chosen, l.id] : chosen.filter((x) => x !== l.id))} /> {l.name}</label>)}</fieldset>}
      <div className="row-wrap" style={{ gap: 8, marginTop: 10 }}>
        <button type="button" className="btn primary" disabled={!name.trim() || !evidence.trim()} onClick={() => onGo({ name, email, evidence, optional: chosen })}>Record acceptance</button>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

