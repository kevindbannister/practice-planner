// Share capital for one company: what the classes entitle holders to, who owns what (worked out, never typed), certificates and dividends.
// The rules live in lib/cosecShares, lib/cosecCertificates and lib/cosecDividends; this file is the screens.
import { useMemo, useState } from "react";
import { fmtDate, todayIso } from "../lib/domain";
import { readEntry, replay } from "../lib/shareLedger";
import { BAND_LABEL, owners, pscCheck, rightsMap } from "../lib/cosecShares";
import { CERT_LABEL, Cert, cancel, certificatePdf, certsFor, coverage, issue, readCert, replace, reissue } from "../lib/cosecCertificates";
import { Basis, DIV_LABEL, Waiver, calculate, declare, dividendDocs, draft, markPaid, pounds, readDividend, review, verify } from "../lib/cosecDividends";
import { officerName } from "../lib/cosecForms";
import { Row } from "../lib/schema";
import { downloadFile } from "./commsKit";
import { useCoSec } from "./cosecKit";
import { useData } from "./data";
import { useFiling } from "./EngagementsPage";

const s = (v: unknown) => (v == null ? "" : String(v));
const say = (e: unknown) => (e instanceof Error && e.message ? e.message : "That didn't save. Try again.");
const now = () => new Date().toISOString();
type Msg = { ok: boolean; text: string } | undefined;
const Note = ({ m }: { m: Msg }) => (m ? <p role={m.ok ? "status" : "alert"} style={{ margin: 0, color: m.ok ? "var(--green)" : "var(--red-ink)" }}>{m.text}</p> : null);

function useCapital(client: Row) {
  const k = useCoSec(); const ck = s(client.Key);
  const entries = useMemo(() => k.data.cosecLedger.filter((r) => r.ClientKey === ck).map(readEntry), [k.data.cosecLedger, ck]);
  const classes = useMemo(() => k.data.cosecShareClasses.filter((c) => c.ClientKey === ck), [k.data.cosecShareClasses, ck]);
  const rights = useMemo(() => rightsMap(classes, ck), [classes, ck]);
  return { k, ck, entries, classes, rights, company: { name: s(client.Title), number: s(client.CompanyNumber) } };
}

// ------------------------------------------------------------------ ownership and the PSC check

export function OwnershipCheck({ client }: { client: Row }) {
  const { k, ck, entries, classes } = useCapital(client);
  const [asOf, setAsOf] = useState(todayIso());
  const own = useMemo(() => owners(entries, classes, ck, asOf), [entries, classes, ck, asOf]);
  const check = useMemo(() => pscCheck(own, k.data.cosecPscs.filter((p) => p.ClientKey === ck)), [own, k.data.cosecPscs, ck]);
  if (!entries.length) return <section className="card pad stack" aria-label="Ownership"><h3 style={{ margin: 0 }}>Ownership</h3><p className="muted" style={{ margin: 0 }}>Nothing on the share ledger yet, so there is no ownership to work out.</p></section>;
  return (
    <section className="card pad stack" aria-label="Ownership">
      <div className="row-wrap" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>Ownership</h3>
        <label className="row-wrap" style={{ gap: 6, fontSize: 13 }}>As at <input className="input" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></label>
      </div>
      <p className="muted" style={{ margin: 0 }}>Worked out from the share ledger and each class's voting rights. {own.issued.toLocaleString("en-GB")} shares in issue carrying {own.votes.toLocaleString("en-GB")} votes.</p>
      {own.problems.length > 0 && <p className="alert amber" role="status" style={{ margin: 0 }}>The ledger has a problem: {own.problems[0]}</p>}
      <div className="table-wrap"><table className="grid" style={{ minWidth: 520 }}>
        <thead><tr><th scope="col">Holder</th><th scope="col">Shares</th><th scope="col">% of shares</th><th scope="col">% of votes</th></tr></thead>
        <tbody>{own.owners.map((o) => <tr key={o.id}><td>{o.name}<div className="cell-sub">{o.classes.map((c) => `${c.number.toLocaleString("en-GB")} ${c.cls}`).join(", ")}</div></td><td>{o.shares.toLocaleString("en-GB")}</td><td>{o.sharePercent}%</td><td>{o.votePercent}%</td></tr>)}</tbody>
      </table></div>
      <h4 style={{ margin: "4px 0 0" }}>People with significant control</h4>
      {check.findings.length === 0
        ? <p style={{ margin: 0 }} role="status">{check.thresholds.length ? "The PSC register matches the shareholdings." : "Nobody holds more than 25% of the shares or votes directly."} Control through another company, or by other means, still needs a person's judgment.</p>
        : <ul className="plain" role="status">{check.findings.map((f, i) => <li key={i}><strong>{f.who}</strong>: {f.detail}</li>)}</ul>}
      {check.thresholds.length > 0 && <p className="muted" style={{ margin: 0 }}>{check.thresholds.map((t) => `${t.name}: shares ${BAND_LABEL[t.shares].toLowerCase()}, votes ${BAND_LABEL[t.votes].toLowerCase()}`).join(" · ")}</p>}
      <p className="muted" style={{ margin: 0 }}>This is a prompt to review, not a filing: nothing is changed for you.</p>
    </section>
  );
}

// ------------------------------------------------------------------ certificates

export function CertificatesTab({ client }: { client: Row }) {
  const { k, ck, entries, classes, company } = useCapital(client);
  const { create, update } = useData();
  const [show, setShow] = useState(false);
  const [f, setF] = useState({ holder: "", cls: "", shares: "", date: todayIso() });
  const [act, setAct] = useState<{ key: string; kind: "cancel" | "replace" | "exchange" } | null>(null);
  const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<Msg>();
  const [split, setSplit] = useState<{ holder: string; shares: string }[]>([{ holder: "", shares: "" }]);
  const rows = k.data.cosecCertificates.filter((r) => r.ClientKey === ck);
  const certs = useMemo(() => certsFor(rows, ck), [rows, ck]);
  const holdings = useMemo(() => replay(entries).holdings.filter((h) => h.number > 0), [entries]);
  const cov = useMemo(() => coverage(certs, holdings), [certs, holdings]);
  const file = useFiling();
  const nominalOf = (cls: string) => Number(classes.find((c) => s(c.Name).toLowerCase() === cls.toLowerCase())?.NominalValue) || 1;
  const rightsOf = (cls: string) => s(classes.find((c) => s(c.Name).toLowerCase() === cls.toLowerCase())?.Rights);
  const holderOpts = holdings.map((h) => ({ id: `${h.id}|${h.cls}`, h }));
  const write = async (w: ReturnType<typeof issue>, ok: string) => {
    if (w.error) return setMsg({ ok: false, text: w.error });
    setBusy(true); setMsg(undefined);
    try { for (const p of w.patches) await update("CoSecCertificates", p.row, p.patch); for (const r of w.creates) await create("CoSecCertificates", r); setMsg({ ok: true, text: ok }); setShow(false); setAct(null); setReason(""); }
    catch (e) { setMsg({ ok: false, text: say(e) }); } finally { setBusy(false); }
  };
  const pick = holderOpts.find((o) => o.id === f.holder)?.h;
  const doIssue = () => { if (!pick) return setMsg({ ok: false, text: "Choose who the certificate is for." }); void write(issue([{ holder: pick.name, holderKey: pick.key, cls: pick.cls, shares: Number(f.shares), issuedOn: f.date }], rows, ck, holdings, k.me, now()), "Certificate issued."); };
  const rowOf = (c: Cert) => rows.find((r) => s(r.Key) === c.key)!;
  const doAct = (c: Cert) => {
    if (act?.kind === "cancel") return void write(cancel(rowOf(c), reason, now()), "Certificate cancelled.");
    if (act?.kind === "replace") return void write(replace(rowOf(c), rows, reason, todayIso(), k.me, now()), "Replacement issued; the old certificate is marked replaced.");
    const items = split.filter((x) => x.holder).map((x) => { const h = holderOpts.find((o) => o.id === x.holder)!.h; return { holder: h.name, holderKey: h.key, cls: h.cls, shares: Number(x.shares), issuedOn: todayIso() }; });
    void write(reissue(rowOf(c), rows, items, reason, holdings, k.me, now()), "Old certificate cancelled and new certificates issued.");
  };
  const pdf = async (c: Cert) => downloadFile(await certificatePdf(company, c, nominalOf(c.cls), s(classes.find((x) => s(x.Name).toLowerCase() === c.cls.toLowerCase())?.Currency) || "GBP", rightsOf(c.cls)), `Share certificate ${c.number} ${c.holder}.pdf`, "application/pdf");
  const save = async (c: Cert) => { setBusy(true); setMsg(undefined); try { await file(await certificatePdf(company, c, nominalOf(c.cls), "GBP", rightsOf(c.cls)), `Share certificate ${c.number} ${c.holder}.pdf`, `Share certificate ${c.number}`, company.name, ck, `CERT-${c.number}`, { Category: "Company secretarial", TemplateName: "Share certificate" }); setMsg({ ok: true, text: "Saved to the client's documents." }); } catch (e) { setMsg({ ok: false, text: say(e) }); } finally { setBusy(false); } };
  return (
    <section className="card pad stack" aria-label="Share certificates">
      <div className="row-wrap" style={{ justifyContent: "space-between" }}><h3 style={{ margin: 0 }}>Share certificates</h3><button type="button" className="btn" disabled={!k.can("edit") || !holdings.length} onClick={() => setShow(!show)}>Issue certificate</button></div>
      {!holdings.length && <p className="muted" style={{ margin: 0 }}>No shares on the ledger yet. Certificates can only be issued for shares someone holds.</p>}
      {cov.over.length > 0 && <p className="alert red" role="alert" style={{ margin: 0 }}>Too many shares are on certificates: {cov.over.map((g) => `${g.holder} holds ${g.held} ${g.cls} but ${g.certified} are certified`).join("; ")}. Cancel or exchange the certificate that no longer matches.</p>}
      {cov.orphan.length > 0 && <p className="alert amber" role="status" style={{ margin: 0 }}>Certificate{cov.orphan.length > 1 ? "s" : ""} {cov.orphan.map((c) => c.number).join(", ")} in force for someone who no longer holds those shares.</p>}
      {cov.uncertificated.length > 0 && <p className="muted" style={{ margin: 0 }}>Not yet on a certificate: {cov.uncertificated.map((g) => `${g.holder} ${g.held - g.certified} ${g.cls}`).join(", ")}.</p>}
      {show && <div className="card pad stack" role="group" aria-label="Issue certificate">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>
          <label className="doc-field"><span>Holder and class</span><select className="input" value={f.holder} onChange={(e) => { const o = holderOpts.find((x) => x.id === e.target.value); setF({ ...f, holder: e.target.value, shares: o ? String(o.h.number) : "" }); }}><option value="">Choose…</option>{holderOpts.map((o) => <option key={o.id} value={o.id}>{o.h.name}: {o.h.number} {o.h.cls}</option>)}</select></label>
          <label className="doc-field"><span>Number of shares</span><input className="input" inputMode="numeric" value={f.shares} onChange={(e) => setF({ ...f, shares: e.target.value })} /></label>
          <label className="doc-field"><span>Date of issue</span><input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
        </div>
        <div className="row-wrap"><button type="button" className="btn primary" disabled={busy} onClick={doIssue}>Issue</button></div>
      </div>}
      <div className="table-wrap"><table className="grid" style={{ minWidth: 640 }}>
        <thead><tr><th scope="col">No.</th><th scope="col">Holder</th><th scope="col">Shares</th><th scope="col">Issued</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{certs.length ? certs.map((c) => (
          <tr key={c.key}><td>{c.number}</td><td>{c.holder}<div className="cell-sub">{c.cls}{c.replaces ? ` · replaces ${c.replaces}` : ""}</div></td><td>{c.shares.toLocaleString("en-GB")}</td><td>{fmtDate(c.issuedOn)}</td>
            <td>{CERT_LABEL[c.status]}{c.reason ? <div className="cell-sub">{c.reason}</div> : null}</td>
            <td><span className="row-wrap" style={{ gap: 8 }}>
              <button type="button" className="linkbtn" onClick={() => void pdf(c)}>PDF</button>
              <button type="button" className="linkbtn" disabled={busy} onClick={() => void save(c)}>Save to documents</button>
              {c.status === "issued" && k.can("edit") && <>
                <button type="button" className="linkbtn" onClick={() => { setAct({ key: c.key, kind: "replace" }); setReason(""); setMsg(undefined); }}>Replace</button>
                <button type="button" className="linkbtn" onClick={() => { setAct({ key: c.key, kind: "exchange" }); setReason(""); setSplit([{ holder: "", shares: "" }]); setMsg(undefined); }}>Exchange</button>
                <button type="button" className="linkbtn" onClick={() => { setAct({ key: c.key, kind: "cancel" }); setReason(""); setMsg(undefined); }}>Cancel</button></>}
            </span></td></tr>)) : <tr><td colSpan={6} className="muted">No certificates yet.</td></tr>}</tbody>
      </table></div>
      {act && (() => { const c = certs.find((x) => x.key === act.key)!; return (
        <div className="card pad stack" role="group" aria-label={`${act.kind} certificate ${c.number}`}>
          <strong>{act.kind === "cancel" ? "Cancel" : act.kind === "replace" ? "Replace" : "Exchange"} certificate {c.number}</strong>
          <label className="doc-field"><span>Reason</span><input className="input" placeholder={act.kind === "replace" ? "Lost, damaged…" : "Why"} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
          {act.kind === "exchange" && <>
            <p className="muted" style={{ margin: 0 }}>Who the shares on this certificate now go to. The new certificates must match the ledger.</p>
            {split.map((x, i) => <div key={i} className="row-wrap"><select className="input" aria-label="Holder" value={x.holder} onChange={(e) => setSplit(split.map((y, j) => (j === i ? { ...y, holder: e.target.value } : y)))}><option value="">Choose…</option>{holderOpts.map((o) => <option key={o.id} value={o.id}>{o.h.name}: {o.h.number} {o.h.cls}</option>)}</select><input className="input" aria-label="Shares" inputMode="numeric" placeholder="Shares" value={x.shares} onChange={(e) => setSplit(split.map((y, j) => (j === i ? { ...y, shares: e.target.value } : y)))} /></div>)}
            <button type="button" className="linkbtn" onClick={() => setSplit([...split, { holder: "", shares: "" }])}>Add another certificate</button></>}
          <div className="row-wrap"><button type="button" className="btn primary" disabled={busy} onClick={() => doAct(c)}>Confirm</button><button type="button" className="btn" onClick={() => setAct(null)}>Back</button></div>
        </div>); })()}
      <Note m={msg} />
    </section>
  );
}

// ------------------------------------------------------------------ dividends

export function DividendsTab({ client }: { client: Row }) {
  const { k, ck, entries, rights, company } = useCapital(client);
  const { create, update, remove } = useData();
  const file = useFiling();
  const rows = k.data.cosecDividends.filter((r) => r.ClientKey === ck).sort((a, b) => s(b.Created).localeCompare(s(a.Created)));
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState<"interim" | "final">("interim");
  const [rec, setRec] = useState(todayIso());
  const [mode, setMode] = useState<"per-share" | "aggregate">("per-share");
  const [rates, setRates] = useState<Record<string, string>>({}); const [total, setTotal] = useState("");
  const [waivers, setWaivers] = useState<Waiver[]>([]);
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<Msg>();
  const classNames = useMemo(() => [...new Set(replay(entries.filter((e) => e.date <= rec)).holdings.filter((h) => h.number > 0 && (rights.get(h.cls.toLowerCase())?.dividends ?? true)).map((h) => h.cls))], [entries, rec, rights]);
  const basis: Basis = mode === "per-share" ? { mode, rates } : { mode, total };
  const preview = useMemo(() => calculate(entries, ck, rec, basis, rights, waivers), [entries, ck, rec, mode, rates, total, waivers, rights]); // eslint-disable-line react-hooks/exhaustive-deps
  const holders = useMemo(() => replay(entries.filter((e) => e.date <= rec)).holdings.filter((h) => h.number > 0), [entries, rec]);
  const directors = k.data.cosecOfficers.filter((o) => o.ClientKey === ck && o.Status === "current" && /director/i.test(s(o.Role))).map((o) => officerName(o));
  const run = async (fn: () => Promise<void>, ok: string) => { setBusy(true); setMsg(undefined); try { await fn(); setMsg({ ok: true, text: ok }); } catch (e) { setMsg({ ok: false, text: say(e) }); } finally { setBusy(false); } };
  const create_ = () => {
    const d = draft({ type, recordDate: rec, basis, waivers }, k.data.cosecDividends, ck, entries, rights, k.me, now());
    if (d.error || !d.row) return setMsg({ ok: false, text: d.error || "Nothing to save." });
    void run(async () => { await create("CoSecDividends", { ...d.row! , PracticeId: k.ctx().pid }); setAdding(false); }, "Draft saved. Nothing is declared yet.");
  };
  return (
    <section className="card pad stack" aria-label="Dividends">
      <div className="row-wrap" style={{ justifyContent: "space-between" }}><h3 style={{ margin: 0 }}>Dividends</h3><button type="button" className="btn" disabled={!k.can("edit") || !entries.length} onClick={() => setAdding(!adding)}>New dividend</button></div>
      <p className="muted" style={{ margin: 0 }}>Amounts come from who held shares on the record date. Whether the company has enough distributable profits is for a person to confirm before a dividend can be declared, and tax is not worked out here.</p>
      {adding && (
        <div className="card pad stack" role="group" aria-label="New dividend">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>
            <label className="doc-field"><span>Type</span><select className="input" value={type} onChange={(e) => setType(e.target.value as "interim" | "final")}><option value="interim">Interim</option><option value="final">Final</option></select></label>
            <label className="doc-field"><span>Record date</span><input className="input" type="date" value={rec} onChange={(e) => setRec(e.target.value)} /></label>
            <label className="doc-field"><span>How is it set?</span><select className="input" value={mode} onChange={(e) => setMode(e.target.value as "per-share" | "aggregate")}><option value="per-share">A rate per share, by class</option><option value="aggregate">A total, shared across the shares</option></select></label>
          </div>
          {mode === "per-share" ? classNames.map((c) => <label key={c} className="doc-field"><span>{c}: £ per share</span><input className="input" inputMode="decimal" placeholder="0.00" value={rates[c] || ""} onChange={(e) => setRates({ ...rates, [c]: e.target.value })} /></label>) : <label className="doc-field"><span>Total dividend (£)</span><input className="input" inputMode="decimal" placeholder="0.00" value={total} onChange={(e) => setTotal(e.target.value)} /></label>}
          <div className="stack" style={{ gap: 6 }}><strong>Waivers</strong>
            {waivers.map((w, i) => <div key={i} className="row-wrap"><select className="input" aria-label="Waiving holder" value={w.holderId ? `${w.holderId}|${w.cls}` : ""} onChange={(e) => { const h = holders.find((x) => `${x.id}|${x.cls}` === e.target.value); setWaivers(waivers.map((y, j) => (j === i ? { ...y, holderId: h?.id || "", holder: h?.name || "", cls: h?.cls || "" } : y))); }}><option value="">Choose…</option>{holders.map((h) => <option key={`${h.id}|${h.cls}`} value={`${h.id}|${h.cls}`}>{h.name} ({h.cls})</option>)}</select>
              <input className="input" aria-label="Waiver document reference" placeholder="Reference to the signed waiver" value={w.docRef} onChange={(e) => setWaivers(waivers.map((y, j) => (j === i ? { ...y, docRef: e.target.value } : y)))} />
              <button type="button" className="linkbtn" onClick={() => setWaivers(waivers.filter((_, j) => j !== i))}>Remove</button></div>)}
            <button type="button" className="linkbtn" style={{ alignSelf: "start" }} onClick={() => setWaivers([...waivers, { holderId: "", holder: "", cls: "", docRef: "" }])}>Add a waiver</button></div>
          {preview.problems.length > 0 && <p className="alert amber" role="status" style={{ margin: 0 }}>{preview.problems[0]}</p>}
          {preview.lines.length > 0 && <div className="table-wrap"><table className="grid" style={{ minWidth: 420 }}><thead><tr><th scope="col">Shareholder</th><th scope="col">Shares</th><th scope="col">Payable</th></tr></thead><tbody>
            {preview.lines.map((l, i) => <tr key={i}><td>{l.holder} <span className="cell-sub">{l.cls}</span></td><td>{l.shares.toLocaleString("en-GB")}</td><td>{l.waived ? `Waived (${l.waiverRef})` : pounds(BigInt(l.paidPence))}</td></tr>)}
            <tr><td colSpan={2}><strong>Total</strong></td><td><strong>{pounds(BigInt(preview.totalPence))}</strong></td></tr></tbody></table></div>}
          {preview.excluded.length > 0 && <p className="muted" style={{ margin: 0 }}>Not included: {preview.excluded.map((x) => `${x.shares} ${x.cls} (${x.why.toLowerCase()})`).join("; ")}</p>}
          <div className="row-wrap"><button type="button" className="btn primary" disabled={busy} onClick={create_}>Save draft</button><button type="button" className="btn" onClick={() => setAdding(false)}>Cancel</button></div>
        </div>)}
      {rows.length === 0 && !adding && <p className="muted" style={{ margin: 0 }}>No dividends yet.</p>}
      {rows.map((r) => <DividendCard key={s(r.Key)} row={r} entries={entries} rights={rights} company={company} directors={directors} busy={busy} run={run} update={update} remove={remove} file={file} />)}
      <Note m={msg} />
    </section>
  );
}

function DividendCard({ row, entries, rights, company, directors, busy, run, update, remove, file }: { row: Row; entries: ReturnType<typeof readEntry>[]; rights: ReturnType<typeof rightsMap>; company: { name: string; number: string }; directors: string[]; busy: boolean; run: (fn: () => Promise<void>, ok: string) => Promise<void>; update: ReturnType<typeof useData>["update"]; remove: ReturnType<typeof useData>["remove"]; file: ReturnType<typeof useFiling> }) {
  const k = useCoSec();
  const d = readDividend(row);
  const [sure, setSure] = useState(false); const [note, setNote] = useState(""); const [date, setDate] = useState(todayIso()); const [err, setErr] = useState(""); const [del, setDel] = useState(false);
  const v = useMemo(() => (d.status === "draft" || d.status === "declared" ? verify(row, entries, rights) : { ok: true, problems: [] as string[] }), [row, entries, rights, d.status]);
  const apply = (r: { error?: string; patch?: Row }, ok: string) => { if (r.error || !r.patch) return setErr(r.error || ""); setErr(""); void run(() => update("CoSecDividends", row, r.patch!).then(() => undefined), ok); };
  const docs = async (save: boolean) => {
    const p = await dividendDocs(company, d, directors);
    const items: [string, Uint8Array][] = [["minutes", p.minutes], ["schedule", p.schedule], ["vouchers", p.vouchers]];
    for (const [n, b] of items) { const name = `${d.ref} dividend ${n}.pdf`; if (save) await file(b, name, `${d.ref} dividend ${n}`, company.name, d.clientKey, d.ref, { Category: "Company secretarial", TemplateName: `Dividend ${n}` }); else downloadFile(b, name, "application/pdf"); }
  };
  return (
    <div className="card pad stack" role="group" aria-label={`Dividend ${d.ref}`}>
      <div className="row-wrap" style={{ justifyContent: "space-between" }}><strong>{d.ref} · {d.type === "final" ? "Final" : "Interim"} · {pounds(BigInt(d.totalPence))}</strong><span className={`chip ${d.status === "paid" ? "green" : "amber"}`}>{DIV_LABEL[d.status]}</span></div>
      <span className="muted">Record date {fmtDate(d.recordDate)}{d.declaredOn ? ` · declared ${fmtDate(d.declaredOn)}` : ""}{d.paidOn ? ` · paid ${fmtDate(d.paidOn)}` : ""}</span>
      <div className="table-wrap"><table className="grid" style={{ minWidth: 420 }}><thead><tr><th scope="col">Shareholder</th><th scope="col">Shares</th><th scope="col">Payable</th></tr></thead><tbody>
        {d.lines.map((l, i) => <tr key={i}><td>{l.holder} <span className="cell-sub">{l.cls}</span></td><td>{l.shares.toLocaleString("en-GB")}</td><td>{l.waived ? `Waived (${l.waiverRef})` : pounds(BigInt(l.paidPence))}</td></tr>)}</tbody></table></div>
      {!v.ok && <p className="alert red" role="alert" style={{ margin: 0 }}>{v.problems[0]}</p>}
      {d.reviewedBy && <p className="muted" style={{ margin: 0 }}>Distributable profits reviewed by {d.reviewedBy} on {fmtDate(d.reviewedAt.slice(0, 10))}: {d.reviewNote}</p>}
      {d.status === "draft" && k.can("edit") && !d.reviewedBy && <div className="stack" style={{ gap: 6 }}>
        <label className="row-wrap" style={{ gap: 6 }}><input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} /> I have reviewed the company's distributable profits for this dividend</label>
        <input className="input" aria-label="What was reviewed" placeholder="What was reviewed (accounts or figures used, profits available)" value={note} onChange={(e) => setNote(e.target.value)} />
        <button type="button" className="btn" style={{ alignSelf: "start" }} disabled={busy} onClick={() => apply(review(row, sure, note, k.me, now()), "Review recorded.")}>Record review</button></div>}
      {(d.status === "draft" || d.status === "declared") && k.can("edit") && <div className="row-wrap">
        <input className="input" type="date" aria-label="Date" value={date} onChange={(e) => setDate(e.target.value)} />
        {d.status === "draft" && <button type="button" className="btn primary" disabled={busy} onClick={() => apply(declare(row, date, entries, rights, now()), "Dividend declared.")}>Declare dividend</button>}
        {d.status === "declared" && <button type="button" className="btn primary" disabled={busy} onClick={() => apply(markPaid(row, date, now()), "Marked paid.")}>Mark as paid</button>}
        </div>}
      {k.can("edit") && (del
        ? <div className="row-wrap" role="alert"><span>{d.status === "paid" ? "This dividend has been paid. Deleting it removes it completely and it can't be got back." : "Delete this dividend completely? It can't be got back."}</span><button type="button" className="btn" disabled={busy} onClick={() => void run(() => remove("CoSecDividends", row), "Deleted.")}>Yes, delete it</button><button type="button" className="btn" onClick={() => setDel(false)}>Keep it</button></div>
        : <div><button type="button" className="linkbtn" onClick={() => setDel(true)}>Delete dividend</button></div>)}
      {<div className="row-wrap"><button type="button" className="linkbtn" onClick={() => void run(() => docs(false), "Documents downloaded.")}>Download minutes, schedule and vouchers</button><button type="button" className="linkbtn" disabled={busy} onClick={() => void run(() => docs(true), "Saved to the client's documents.")}>Save to documents</button>{d.status === "draft" && <span className="muted">Marked as draft until declared.</span>}</div>}
      {err && <p role="alert" style={{ margin: 0, color: "var(--red-ink)" }}>{err}</p>}
    </div>
  );
}
