// Dormant (never traded) accounts for one company: a guided job from eligibility to acceptance by Companies House. Nothing here files accounts;
// the job only finishes when Companies House has accepted them, never because a PDF was produced. The rules are in lib/cosecDormant.
import { useMemo, useState } from "react";
import { fmtDate, todayIso } from "../lib/domain";
import { verifiedOf } from "../lib/cosec";
import * as D from "../lib/cosecDormant";
import { readEntry } from "../lib/shareLedger";
import { Row } from "../lib/schema";
import { downloadFile } from "./commsKit";
import { useCoSec } from "./cosecKit";
import { useData } from "./data";
import { useFiling } from "./EngagementsPage";

const s = (v: unknown) => (v == null ? "" : String(v));
const say = (e: unknown) => (e instanceof Error && e.message ? e.message : "That didn't save. Try again.");
type Msg = { ok: boolean; text: string } | undefined;
const mark = (st: D.CheckState) => (st === "ok" ? "✓" : st === "blocked" ? "✗" : "!");
const color = (st: D.CheckState) => (st === "ok" ? "var(--green)" : st === "blocked" ? "var(--red-ink)" : "var(--amber-ink, #8a5a00)");

export function AccountsTab({ client }: { client: Row }) {
  const k = useCoSec(); const ck = s(client.Key);
  const { create } = useData();
  const ver = verifiedOf(client);
  const rows = k.data.cosecAccounts.filter((r) => r.ClientKey === ck).sort((a, b) => s(b.PeriodEnd).localeCompare(s(a.PeriodEnd)));
  const inc = s(client.Incorporated).slice(0, 10);
  const guessEnd = ver.accTo || "";
  const guessStart = guessEnd ? (() => { const st = D.addMonths(guessEnd, -12); const d = new Date(`${st}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); const x = d.toISOString().slice(0, 10); return inc && x < inc ? inc : x; })() : "";
  const [start, setStart] = useState(guessStart); const [end, setEnd] = useState(guessEnd);
  const [msg, setMsg] = useState<Msg>(); const [busy, setBusy] = useState(false);
  const begin = async () => {
    const w = D.start(client, { start, end, incorporated: inc }, k.data.cosecAccounts, k.me, new Date().toISOString());
    if (w.error) return setMsg({ ok: false, text: w.error });
    setBusy(true); setMsg(undefined);
    try { for (const r of w.creates) await create("CoSecAccounts", { ...r, PracticeId: k.ctx().pid }); } catch (e) { setMsg({ ok: false, text: say(e) }); } finally { setBusy(false); }
  };
  return (
    <div className="stack" style={{ gap: 14 }}>
      <section className="card pad stack" aria-label="Dormant accounts">
        <h3 style={{ margin: 0 }}>Dormant accounts</h3>
        <p className="muted" style={{ margin: 0 }}>For a company that has never traded. This prepares the accounts for a director to sign and tracks the job until Companies House accepts them. It doesn't file anything, and it isn't for companies that have traded.</p>
        {k.can("edit") && !rows.some((r) => D.isOpen(D.readDormant(r))) && (
          <div className="row-wrap" style={{ alignItems: "flex-end" }}>
            <label className="doc-field"><span>Period starts</span><input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
            <label className="doc-field"><span>Period ends</span><input className="input" type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
            <button type="button" className="btn primary" disabled={busy} onClick={() => void begin()}>Start the accounts</button>
          </div>)}
        {!ver.accTo && <p className="muted" style={{ margin: 0 }}>Companies House's expected period isn't recorded for this company. Refresh it from Companies House on the Details tab to prefill the dates.</p>}
        <Note m={msg} />
      </section>
      {rows.map((r) => <Job key={s(r.Key)} row={r} client={client} />)}
    </div>
  );
}
const Note = ({ m }: { m: Msg }) => (m ? <p role={m.ok ? "status" : "alert"} style={{ margin: 0, color: m.ok ? "var(--green)" : "var(--red-ink)" }}>{m.text}</p> : null);

function Job({ row, client }: { row: Row; client: Row }) {
  const k = useCoSec(); const ck = s(client.Key);
  const { update } = useData(); const file = useFiling();
  const d = D.readDormant(row); const ver = verifiedOf(client);
  const today = todayIso(); const now = () => new Date().toISOString();
  const [c, setC] = useState({ neverTraded: d.conf.neverTraded, noTransactions: d.conf.noTransactions, qualifies: d.conf.qualifies, director: d.conf.director });
  const [ap, setAp] = useState({ director: d.conf.director, date: today, ref: "" });
  const [fl, setFl] = useState({ date: today, via: "webfiling", ref: "" });
  const [ac, setAc] = useState({ date: today, evidence: "" });
  const [why, setWhy] = useState(""); const [msg, setMsg] = useState<Msg>(); const [busy, setBusy] = useState(false);
  const period = { start: d.start, end: d.end, incorporated: s(client.Incorporated).slice(0, 10) };
  const a = useMemo(() => D.assess({ client, verified: ver, period, entries: k.data.cosecLedger.filter((x) => x.ClientKey === ck).map(readEntry), classes: k.data.cosecShareClasses.filter((x) => x.ClientKey === ck), dividends: k.data.cosecDividends, officers: k.data.cosecOfficers, conf: { ...d.conf, ...(d.status === "draft" || d.status === "confirmed" ? { neverTraded: c.neverTraded && d.conf.neverTraded, noTransactions: c.noTransactions && d.conf.noTransactions, qualifies: c.qualifies && d.conf.qualifies } : {}) }, today, others: k.data.cosecAccounts.filter((x) => x.ClientKey === ck && x.Key !== row.Key).map(D.readDormant) }), [row, client, k.data, c, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const pen = D.penalty(a.due, today, d.lateLastYear);
  const run = async (w: D.Written, ok: string, after?: () => Promise<void>) => {
    if (w.error) return setMsg({ ok: false, text: w.error });
    setBusy(true); setMsg(undefined);
    try { for (const p of w.patches) await update("CoSecAccounts", p.row, p.patch); if (after) await after(); setMsg({ ok: true, text: ok }); } catch (e) { setMsg({ ok: false, text: say(e) }); } finally { setBusy(false); }
  };
  const docIn = (): D.DocIn => ({ company: { name: s(client.Title), number: s(client.CompanyNumber) }, d, fig: a.figures, prior: a.prior, period, director: d.conf.director || c.director, approvedOn: d.approvedOn });
  const downloads = async () => { downloadFile(await D.accountsPdf(docIn()), `Dormant accounts ${d.end}${d.approvedOn ? "" : " DRAFT"}.pdf`, "application/pdf"); downloadFile(await D.coverPdf(docIn(), a), `Dormant accounts note for the director ${d.end}.pdf`, "application/pdf"); };
  const saveDocs = async () => { setBusy(true); setMsg(undefined); try { const di = docIn(); await file(await D.accountsPdf(di), `Dormant accounts ${d.end}${d.approvedOn ? "" : " DRAFT"}.pdf`, `Dormant accounts to ${fmtDate(d.end)}${d.approvedOn ? "" : " (draft)"}`, s(client.Title), ck, `DORM-${d.end}`, { Category: "Company secretarial", TemplateName: "Dormant accounts" }); await file(await D.coverPdf(di, a), `Dormant accounts note for the director ${d.end}.pdf`, `Note for the director: dormant accounts to ${fmtDate(d.end)}`, s(client.Title), ck, `DORM-${d.end}`, { Category: "Company secretarial", TemplateName: "Dormant accounts note" }); setMsg({ ok: true, text: "Saved to the client's documents." }); } catch (e) { setMsg({ ok: false, text: say(e) }); } finally { setBusy(false); } };
  const uploadSigned = async (f: File) => { setBusy(true); setMsg(undefined); try { await file(new Uint8Array(await f.arrayBuffer()), `Dormant accounts ${d.end} signed.pdf`, `Dormant accounts to ${fmtDate(d.end)} (signed)`, s(client.Title), ck, `DORM-${d.end}`, { Category: "Company secretarial", TemplateName: "Dormant accounts (signed)" }); setAp({ ...ap, ref: `Dormant accounts ${d.end} signed.pdf` }); setMsg({ ok: true, text: "Signed copy saved to the client's documents." }); } catch (e) { setMsg({ ok: false, text: say(e) }); } finally { setBusy(false); } };
  const edit = k.can("edit");
  const early = d.status === "draft" || d.status === "confirmed";
  return (
    <section className="card pad stack" aria-label={`Dormant accounts to ${d.end}`}>
      <div className="row-wrap" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>Accounts for {fmtDate(d.start)} to {fmtDate(d.end)}</h3>
        <span className={`chip ${d.status === "complete" ? "green" : d.status === "cancelled" ? "" : d.status === "rejected" ? "red" : "amber"}`}>{D.STATUS_LABEL[d.status]}</span>
      </div>
      {D.isOpen(d) && a.due && <p style={{ margin: 0 }}>Due at Companies House by <strong>{fmtDate(a.due)}</strong>{a.due < today ? `. ${D.daysBetween(a.due, today)} days late: the penalty so far is £${pen.pounds} (${pen.tier.toLowerCase()}), and it grows the longer it is late.` : `, ${D.daysBetween(today, a.due)} days from now.`}</p>}
      {d.status === "complete" && <p style={{ margin: 0 }} role="status">Accepted by Companies House on {fmtDate(d.acceptedOn)}. {d.evidence}</p>}
      <ul className="plain" aria-label="Eligibility checks">{a.checks.map((x) => (
        <li key={x.id}><span aria-hidden style={{ color: color(x.state), fontWeight: 700 }}>{mark(x.state)}</span> <span className="sr-only">{x.state}: </span><strong>{x.title}.</strong> {x.detail}</li>))}</ul>

      {early && edit && (
        <div className="card pad stack" role="group" aria-label="Confirmations">
          <strong>A person has to confirm these. The system can't tell whether the company has traded.</strong>
          {D.STATEMENTS.map(([key, text]) => <label key={key} className="row-wrap" style={{ gap: 8, alignItems: "flex-start" }}><input type="checkbox" checked={c[key]} onChange={(e) => setC({ ...c, [key]: e.target.checked })} /> <span>{text}</span></label>)}
          <label className="doc-field"><span>Director who will sign</span><select className="input" value={c.director} onChange={(e) => setC({ ...c, director: e.target.value })}><option value="">Choose…</option>{a.directors.map((n) => <option key={n}>{n}</option>)}</select></label>
          <div><button type="button" className="btn" disabled={busy} onClick={() => void run(D.confirm(row, c, k.me, now()), "Confirmed.")}>Record confirmation</button></div>
        </div>)}
      {d.conf.by && !early && <p className="muted" style={{ margin: 0 }}>Confirmed by {d.conf.by} on {fmtDate(d.conf.at.slice(0, 10))}. Signing director: {d.conf.director}.</p>}

      {["confirmed", "prepared"].includes(d.status) && edit && <div className="row-wrap">
        <button type="button" className="btn primary" disabled={busy} onClick={() => void run(D.prepare(row, a, now()), d.status === "prepared" ? "Figures refreshed." : "Accounts prepared. They still need the director's approval.")}>{d.status === "prepared" ? "Prepare again (refresh the figures)" : "Prepare the accounts"}</button>
        {d.status === "prepared" && D.drifted(row, a) && <span role="alert" style={{ color: "var(--red-ink)" }}>The share ledger has changed since these were prepared. Prepare again before approval.</span>}</div>}
      {["prepared", "approved", "filed", "rejected", "complete"].includes(d.status) && <div className="row-wrap">
        <button type="button" className="linkbtn" onClick={() => void downloads()}>Download the draft accounts and note for the director</button>
        <button type="button" className="linkbtn" disabled={busy} onClick={() => void saveDocs()}>Save to the client's documents</button></div>}
      {d.status === "prepared" && <p className="muted" style={{ margin: 0 }}>Producing these documents does not finish the job. The director has to sign, then the accounts have to be filed and accepted.</p>}

      {d.status === "prepared" && edit && (
        <div className="card pad stack" role="group" aria-label="Director's approval">
          <strong>Director's approval</strong>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10 }}>
            <label className="doc-field"><span>Director who signed</span><select className="input" value={ap.director} onChange={(e) => setAp({ ...ap, director: e.target.value })}><option value="">Choose…</option>{a.directors.map((n) => <option key={n}>{n}</option>)}</select></label>
            <label className="doc-field"><span>Date signed</span><input className="input" type="date" value={ap.date} onChange={(e) => setAp({ ...ap, date: e.target.value })} /></label>
            <label className="doc-field"><span>Signed copy (PDF)</span><input className="input" type="file" accept="application/pdf" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadSigned(f); }} /></label>
          </div>
          {ap.ref && <p className="muted" style={{ margin: 0 }}>Signed copy saved as {ap.ref}.</p>}
          <div><button type="button" className="btn" disabled={busy} onClick={() => void run(D.approve(row, a, ap.director, ap.date, ap.ref, today, now()), "Director's approval recorded.")}>Record approval</button></div>
        </div>)}
      {d.approvedBy && <p className="muted" style={{ margin: 0 }}>Approved by {d.approvedBy} on {fmtDate(d.approvedOn)}. Signed copy: {d.signedRef}.</p>}

      {["approved", "rejected"].includes(d.status) && edit && (
        <div className="card pad stack" role="group" aria-label="Record filing">
          <strong>Record that the accounts have been filed at Companies House</strong>
          <p className="muted" style={{ margin: 0 }}>File them with Companies House yourself, then record it here. This system doesn't submit accounts.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10 }}>
            <label className="doc-field"><span>Date filed</span><input className="input" type="date" value={fl.date} onChange={(e) => setFl({ ...fl, date: e.target.value })} /></label>
            <label className="doc-field"><span>How</span><select className="input" value={fl.via} onChange={(e) => setFl({ ...fl, via: e.target.value })}>{D.FILED_VIA.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label className="doc-field"><span>Reference (optional)</span><input className="input" value={fl.ref} onChange={(e) => setFl({ ...fl, ref: e.target.value })} /></label>
          </div>
          <div><button type="button" className="btn" disabled={busy} onClick={() => void run(D.filed(row, fl.date, fl.via, fl.ref, today, now()), "Recorded as filed. It isn't finished until Companies House accepts it.")}>Record as filed</button></div>
        </div>)}
      {d.status === "filed" && <p style={{ margin: 0 }}>Filed on {fmtDate(d.filedOn)} ({D.FILED_VIA.find(([x]) => x === d.filedVia)?.[1] || d.filedVia}){d.filedRef ? `, reference ${d.filedRef}` : ""}. Waiting for Companies House.</p>}
      {d.status === "filed" && edit && (
        <div className="card pad stack" role="group" aria-label="Acceptance">
          <strong>Has Companies House accepted it?</strong>
          {ver.accTo && ver.accTo > d.end
            ? <><p style={{ margin: 0 }} role="status">Companies House's record now expects the next accounts (period ending {fmtDate(ver.accTo)}), which shows these were accepted.</p><div><button type="button" className="btn primary" disabled={busy} onClick={() => void run(D.accepted(row, ver, null, today, now()), "Accepted. This job is finished.")}>Mark accepted</button></div></>
            : <><p className="muted" style={{ margin: 0 }}>Companies House's record still shows these accounts as outstanding. Refresh from Companies House on the Details tab, or record the acceptance yourself with the evidence.</p>
              <div className="row-wrap"><input className="input" type="date" aria-label="Date accepted" value={ac.date} onChange={(e) => setAc({ ...ac, date: e.target.value })} /><input className="input" aria-label="Evidence" placeholder="Acceptance email or filing history entry" value={ac.evidence} onChange={(e) => setAc({ ...ac, evidence: e.target.value })} style={{ minWidth: 280 }} />
                <button type="button" className="btn" disabled={busy} onClick={() => void run(D.accepted(row, ver, ac, today, now()), "Accepted. This job is finished.")}>Record acceptance</button></div></>}
          <div className="row-wrap"><input className="input" aria-label="Reason it was rejected" placeholder="If Companies House rejected it, why" value={why} onChange={(e) => setWhy(e.target.value)} style={{ minWidth: 280 }} /><button type="button" className="btn" disabled={busy} onClick={() => void run(D.rejected(row, why, now()), "Marked rejected: file it again and record it.")}>Mark rejected</button></div>
        </div>)}
      {D.isOpen(d) && d.status !== "filed" && edit && <div className="row-wrap"><input className="input" aria-label="Reason to cancel" placeholder="Reason to cancel this job" value={why} onChange={(e) => setWhy(e.target.value)} style={{ minWidth: 280 }} /><button type="button" className="btn" disabled={busy} onClick={() => void run(D.cancel(row, why, now()), "Cancelled.")}>Cancel the job</button></div>}
      <Note m={msg} />
    </section>
  );
}
