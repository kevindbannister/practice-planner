// Co Sec: company secretarial. Overview of what needs attention, every filing, and each company's statutory records.
// Everything that changes a record goes through lib/cosec.ts, which also writes the audit line and the timeline entry.
import { useEffect, useMemo, useState } from "react";
import { fmtDate } from "../lib/domain";
import { GROUP_LABEL, NOT_FILED, OPEN_STATUSES, SOURCE_LABEL, STATUS_LABEL, TxStatus, act, canSubmitVia, coSecItems, historyOf, isOpenTx, txIssues, txStatus, TxAction, TxInput } from "../lib/cosec";
import { Addr, BLANK_ADDR, addrIssues, addrText, formTitle } from "../lib/cosecForms";
import { GatewayError } from "../lib/cosecGateway";
import { Row } from "../lib/schema";
import { href, useRoute } from "./bits";
import { useCoSec, nameOfClient } from "./cosecKit";
import { CoSecCompany } from "./CoSecCompany";

const TABS: [string, string, string][] = [["", "Overview", "#/cosec"], ["filings", "Filings", "#/cosec/filings"], ["companies", "Companies", "#/cosec/companies"]];
const chipFor = (s: TxStatus) => (s === "accepted" || s === "external" ? "green" : s === "tested" ? "amber" : s === "rejected" ? "red" : s === "draft" || s === "info" ? "amber" : s === "declined" || s === "cancelled" ? "" : "blue");

export function CoSecPage() {
  const { parts } = useRoute();
  const k = useCoSec();
  const sub = parts[1] || "";
  if (!k.can("view")) return <div className="page"><div className="card empty"><p>Co Sec isn't open to your role. Ask a manager or partner if you need it.</p></div></div>;
  const current = sub === "filing" ? "filings" : sub === "company" ? "companies" : sub;
  return (
    <div className="page">
      <div className="plan-title">
        <h1>Co Sec</h1>
        <nav className="subtabs" aria-label="Co Sec views">
          {TABS.map(([key, label, to]) => <a key={key} href={to} aria-current={current === key ? "page" : undefined}>{label}</a>)}
        </nav>
      </div>
      {!sub && <Overview />}
      {sub === "filings" && <FilingsList />}
      {sub === "filing" && parts[2] && <FilingDetail txKey={parts[2]} />}
      {sub === "companies" && <Companies />}
      {sub === "company" && parts[2] && <CoSecCompany clientKey={parts[2]} tab={parts[3] || "details"} />}
    </div>
  );
}

function Overview() {
  const k = useCoSec();
  const today = new Date().toISOString().slice(0, 10);
  const items = useMemo(() => coSecItems(k.data.cosecTx, k.data.clients, k.data.chFlags, today), [k.data.cosecTx, k.data.clients, k.data.chFlags, today]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const groups = (Object.keys(GROUP_LABEL) as (keyof typeof GROUP_LABEL)[]).map((g) => ({ g, items: items.filter((i) => i.group === g) })).filter((x) => x.items.length);
  return (
    <div className="stack" style={{ gap: 14 }}>
      <section className="card pad stack" aria-label="What needs attention">
        <div className="row-wrap" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>What needs attention</h2>
          <button type="button" className="btn" disabled={busy || !k.can("edit")} onClick={async () => { setBusy(true); setMsg(""); try { const n = await k.scan(); setMsg(n ? `${n} difference${n === 1 ? "" : "s"} found; draft${n === 1 ? "" : "s"} prepared.` : "No new differences from Companies House."); } catch { setMsg("Couldn't check. Try again."); } finally { setBusy(false); } }}>{busy ? "Checking…" : "Look for changes"}</button>
        </div>
        <p className="muted" style={{ margin: 0 }}>Change a company's details anywhere in the planner and anything that affects the statutory record is prepared here as a draft. Nothing is sent to Companies House until a manager or partner approves it.</p>
        {msg && <p role="status" style={{ margin: 0 }}>{msg}</p>}
        {!groups.length ? <p className="muted" style={{ margin: 0 }}>Nothing waiting. All statutory changes are dealt with.</p> : groups.map(({ g, items: list }) => (
          <div key={g}>
            <h3 style={{ margin: "8px 0 4px" }}>{GROUP_LABEL[g]} <span className="chip">{list.length}</span></h3>
            <ul className="plain">{list.map((i) => (
              <li key={i.key}><a href={i.txKey ? href("cosec", "filing", i.txKey) : href("cosec", "company", i.clientKey)}><strong>{i.clientName}</strong>: {i.title}</a><div className="cell-sub">{i.detail}</div></li>
            ))}</ul>
          </div>
        ))}
      </section>
    </div>
  );
}

function FilingsList() {
  const k = useCoSec();
  const [show, setShow] = useState<"open" | "all" | TxStatus>("open");
  const rows = useMemo(() => k.data.cosecTx.filter((t) => (show === "all" ? true : show === "open" ? isOpenTx(t) : txStatus(t) === show)).sort((a, b) => String(b.Created).localeCompare(String(a.Created))), [k.data.cosecTx, show]);
  return (
    <section className="card pad stack" aria-label="Filings">
      <div className="row-wrap">
        <select className="input" aria-label="Which filings" value={show} onChange={(e) => setShow(e.target.value as typeof show)}>
          <option value="open">Needing attention</option><option value="all">All</option>
          {(Object.keys(STATUS_LABEL) as TxStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <span className="muted">{rows.length} filing{rows.length === 1 ? "" : "s"}</span>
      </div>
      {!rows.length ? <p className="muted">No filings to show.</p> : (
        <div className="table-wrap"><table className="grid" style={{ minWidth: 720 }}>
          <thead><tr><th scope="col">Ref</th><th scope="col">Company</th><th scope="col">Form</th><th scope="col">What</th><th scope="col">Status</th><th scope="col">Prepared</th></tr></thead>
          <tbody>{rows.map((t) => (
            <tr key={String(t.Key)}>
              <td><a href={href("cosec", "filing", String(t.Key))}>{String(t.Ref)}</a></td>
              <td><a href={href("cosec", "company", String(t.ClientKey))}>{nameOfClient(k.data, t.ClientKey)}</a></td>
              <td>{String(t.Form)}</td><td>{String(t.Title)}</td>
              <td><span className={`chip ${chipFor(txStatus(t))}`}>{STATUS_LABEL[txStatus(t)]}</span></td>
              <td>{fmtDate(String(t.Created).slice(0, 10))}</td>
            </tr>))}</tbody>
        </table></div>
      )}
    </section>
  );
}

function Companies() {
  const k = useCoSec();
  const [q, setQ] = useState("");
  const rows = k.companies.filter((c) => !q.trim() || `${c.Title} ${c.CompanyNumber}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <section className="card pad stack" aria-label="Companies">
      <input className="input" placeholder="Search by name or number" aria-label="Search companies" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="table-wrap"><table className="grid" style={{ minWidth: 640 }}>
        <thead><tr><th scope="col">Company</th><th scope="col">Number</th><th scope="col">Officers</th><th scope="col">Filings open</th><th scope="col">Checked at Companies House</th></tr></thead>
        <tbody>{rows.map((c) => {
          const open = k.data.cosecTx.filter((t) => t.ClientKey === c.Key && isOpenTx(t)).length;
          let at = ""; try { at = JSON.parse(String(c.CHVerified || "{}")).at || ""; } catch { /* none */ }
          return (
            <tr key={String(c.Key)}>
              <td><a href={href("cosec", "company", String(c.Key))}>{String(c.Title)}</a></td><td>{String(c.CompanyNumber)}</td>
              <td>{k.data.cosecOfficers.filter((o) => o.ClientKey === c.Key && o.Status === "current").length}</td>
              <td>{open ? <span className="chip amber">{open}</span> : "None"}</td>
              <td>{at ? fmtDate(at.slice(0, 10)) : <span className="muted">Not yet</span>}</td>
            </tr>);
        })}</tbody>
      </table></div>
    </section>
  );
}

// ------------------------------------------------------------------ the review screen

const Field = ({ label, value, onChange, disabled, type = "text", wide }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean; type?: string; wide?: boolean }) => (
  <label className="doc-field" style={wide ? { gridColumn: "1 / -1" } : undefined}><span>{label}</span><input className="input" type={type} disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} /></label>
);

export function AddressEditor({ value, onChange, disabled }: { value: Partial<Addr>; onChange: (a: Addr) => void; disabled?: boolean }) {
  const a = { ...BLANK_ADDR, ...value };
  const set = (f: keyof Addr, v: string) => onChange({ ...a, [f]: v });
  return (
    <div className="form-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10 }}>
      <Field label="Building name or number" value={a.premises} disabled={disabled} onChange={(v) => set("premises", v)} />
      <Field label="Street (first line)" value={a.line1} disabled={disabled} onChange={(v) => set("line1", v)} />
      <Field label="Second line" value={a.line2} disabled={disabled} onChange={(v) => set("line2", v)} />
      <Field label="Town" value={a.town} disabled={disabled} onChange={(v) => set("town", v)} />
      <Field label="County" value={a.county} disabled={disabled} onChange={(v) => set("county", v)} />
      <Field label="Postcode" value={a.postcode} disabled={disabled} onChange={(v) => set("postcode", v)} />
      <Field label="Country" value={a.country} disabled={disabled} onChange={(v) => set("country", v)} />
    </div>
  );
}

const DETAIL_FIELDS: [string, string][] = [["Title", "Title"], ["First", "First names"], ["Last", "Last name"], ["CorporateName", "Corporate name"], ["DOB", "Date of birth (YYYY-MM-DD)"], ["Nationality", "Nationality"], ["Occupation", "Occupation"], ["CountryOfResidence", "Country of residence"], ["ServiceAddress", "Service address"], ["ResidentialAddress", "Residential address"]];

function FilingDetail({ txKey }: { txKey: string }) {
  const k = useCoSec();
  const tx = k.data.cosecTx.find((t) => t.Key === txKey);
  const [payload, setPayload] = useState<Record<string, any> | null>(null);
  const [note, setNote] = useState("");
  const [ref, setRef] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const [busy, setBusy] = useState(false);
  useEffect(() => { setPayload(null); setNote(""); setRef(""); setMsg(undefined); }, [txKey]);
  if (!tx) return <div className="card empty"><p>That filing isn't here. <a href={href("cosec", "filings")}>Back to filings</a></p></div>;
  const st = txStatus(tx);
  const client = k.data.clients.find((c) => c.Key === tx.ClientKey);
  const stored = (() => { try { return JSON.parse(String(tx.Payload || "{}")); } catch { return {}; } })();
  const p = payload ?? stored;
  const editable = ["draft", "info", "approved", "rejected"].includes(st) && k.can("edit");
  const dirty = payload !== null && JSON.stringify(payload) !== JSON.stringify(stored);
  const form = String(tx.Form);
  const run = async (what: () => Promise<void>) => { setBusy(true); setMsg(undefined); try { await what(); } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "That didn't save." }); } finally { setBusy(false); } };
  const doAct = (action: TxAction, input: TxInput = {}, ok = "Done.") => run(async () => {
    if (dirty && (action === "approve" || action === "external")) return setMsg({ ok: false, text: "Save the changes before approval or recording a filing." });
    const w = act(tx, action, input, k.cfg, k.ctx(), k.snap());
    if ("error" in w) return setMsg({ ok: false, text: w.error });
    await k.apply(w); setPayload(null); setNote(""); setMsg({ ok: true, text: ok });
  });
  const save = () => run(async () => {
    const w = act(tx, "edit", { payload: p }, k.cfg, k.ctx(), k.snap());
    if ("error" in w) return setMsg({ ok: false, text: w.error });
    await k.apply(w); setPayload(null); setMsg({ ok: true, text: "Saved. It needs approving again." });
  });
  const issues = txIssues({ ...tx, Payload: JSON.stringify(p) });
  const submit = () => run(async () => {
    if (dirty || !tx.ApprovedPayload || tx.ApprovedPayload !== tx.Payload) return setMsg({ ok: false, text: "Save and approve the current draft before submitting." });
    if (!client) return setMsg({ ok: false, text: "The company isn't in the planner." });
    const auth = String(client.CHAuthCode || "").trim();
    if (!auth) return setMsg({ ok: false, text: "Add the company's Companies House authentication code first (on its client record)." });
    const sent = await k.gateway.submit(tx, { number: String(client.CompanyNumber), name: String(client.Title), authCode: auth });
    const w = act(tx, "submitted", { gatewayRef: sent.gatewayRef, test: sent.test }, k.cfg, k.ctx(), k.snap());
    if ("error" in w) return setMsg({ ok: false, text: w.error });
    await k.apply(w); setMsg({ ok: true, text: sent.test ? `Sent to the Companies House TEST service (${sent.gatewayRef}). Nothing is filed for real until the practice is approved to go live.` : `Submitted to Companies House (${sent.gatewayRef}).` });
  });
  const check = () => run(async () => {
    if (tx.GatewayEnvironment !== "live" && tx.GatewayEnvironment !== "test") return setMsg({ ok: false, text: "Unknown original gateway environment. Verify this filing manually." });
    const r = await k.gateway.status(String(tx.GatewayRef), tx.GatewayEnvironment === "test");
    const w = act(tx, "result", { result: { status: r.status, chRef: r.chRef, reason: r.reason } }, k.cfg, k.ctx(), k.snap());
    if ("error" in w) return setMsg({ ok: false, text: w.error });
    await k.apply(w);
    setMsg({ ok: true, text: r.status === "pending" ? "Companies House hasn't answered yet." : r.status === "accepted" ? tx.GatewayEnvironment === "test" ? "TEST accepted. No live filing; statutory records unchanged." : "Accepted. The statutory record is updated." : "Rejected. The draft is kept so you can fix it." });
  });
  const setP = (patch: Record<string, unknown>) => setPayload({ ...p, ...patch });
  const details = (p.details || {}) as Row;
  return (
    <div className="stack" style={{ gap: 14 }}>
      <section className="card pad stack" aria-label="Filing">
        <div className="row-wrap" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>{form}: {formTitle(form)}</h2>
          <span className={`chip ${chipFor(st)}`}>{STATUS_LABEL[st]}</span>
        </div>
        {(st !== "accepted" && st !== "external") && <p role="note" className="chip amber" style={{ alignSelf: "flex-start" }}>{NOT_FILED}</p>}
        <dl className="kv" style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "6px 16px", margin: 0 }}>
          <dt>Company</dt><dd><a href={href("cosec", "company", String(tx.ClientKey))}>{nameOfClient(k.data, tx.ClientKey)}</a></dd>
          <dt>Reference</dt><dd>{String(tx.Ref)}</dd>
          <dt>Transaction</dt><dd>{form} · {String(tx.Title)}</dd>
          {String(tx.Before) && <><dt>Previous</dt><dd>{String(tx.Before)}</dd></>}
          <dt>Proposed</dt><dd>{String(tx.After)}</dd>
          <dt>Source</dt><dd>{SOURCE_LABEL[String(tx.Source)] || String(tx.Source)}</dd>
          <dt>Changed by</dt><dd>{String(tx.CreatedBy) || "System"}</dd>
          <dt>Change date</dt><dd>{String(tx.Created).slice(0, 16).replace("T", " ")}</dd>
          <dt>Assigned to</dt><dd>{String(tx.Assignee) || "Nobody yet"}</dd>
          {String(tx.Clarification) && <><dt>Question</dt><dd>{String(tx.Clarification)}</dd></>}
          {String(tx.RejectReason) && <><dt>Rejected because</dt><dd>{String(tx.RejectReason)}</dd></>}
          {String(tx.GatewayEnvironment || "") && <><dt>Environment</dt><dd>{tx.GatewayEnvironment === "test" ? "TEST — not filed" : "LIVE"}</dd></>}
          {String(tx.GatewayRef) && <><dt>Gateway reference</dt><dd>{String(tx.GatewayRef)}</dd></>}
          {String(tx.ChRef) && <><dt>Companies House reference</dt><dd>{String(tx.ChRef)}</dd></>}
        </dl>
      </section>

      <section className="card pad stack" aria-label="Draft details">
        <h3 style={{ margin: 0 }}>Draft details</h3>
        {form === "AD01" && <AddressEditor value={p.address || {}} disabled={!editable} onChange={(a) => setP({ address: a })} />}
        {form === "NM01" && <Field label="New company name" value={String(p.newName || "")} disabled={!editable} onChange={(v) => setP({ newName: v })} />}
        {form === "AA01" && <Field label="New accounting reference date (for example 30 June)" value={String(p.newDate || "")} disabled={!editable} onChange={(v) => setP({ newDate: v })} />}
        {(form.startsWith("AP") || form.startsWith("LLAP") || form === "SH01" || form.startsWith("PSC0") && p.op === "appoint") && (
          <div className="form-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
            <Field label="Date" type="date" value={String(p.date || "")} disabled={!editable} onChange={(v) => setP({ date: v })} />
            {form !== "SH01" && DETAIL_FIELDS.map(([f, l]) => <Field key={f} label={l} value={String(details[f] ?? "")} disabled={!editable} onChange={(v) => setP({ details: { ...details, [f]: v } })} />)}
            {form === "SH01" && [["Holder", "Holder"], ["Class", "Class"], ["Number", "Number of shares"], ["NominalValue", "Nominal value"], ["PaidPerShare", "Paid per share"], ["Currency", "Currency"]].map(([f, l]) => <Field key={f} label={l} value={String(details[f] ?? "")} disabled={!editable} onChange={(v) => setP({ details: { ...details, [f]: v } })} />)}
          </div>
        )}
        {(/^(TM|LLTM)/.test(form) || form === "PSC07") && <Field label="Date it ended" type="date" value={String(p.date || "")} disabled={!editable} onChange={(v) => setP({ date: v })} />}
        {p.changes && Object.keys(p.changes).length > 0 && (
          <div className="table-wrap"><table className="grid"><thead><tr><th scope="col">Detail</th><th scope="col">Was</th><th scope="col">Now</th></tr></thead>
            <tbody>{Object.entries(p.changes as Record<string, string>).map(([f, v]) => <tr key={f}><td>{f}</td><td>{String(p.before?.[f] || "")}</td><td>{v}</td></tr>)}</tbody></table></div>
        )}
        {issues.length > 0 && <p role="alert" style={{ margin: 0, color: "var(--amber-ink)" }}>Still needed before approval: {issues.join(", ")}.</p>}
        {!formTitle(form) && null}
        {!canSubmitVia(tx) && <p className="muted" style={{ margin: 0 }}>{form} can't be sent from the planner yet. Approve it, file it at Companies House, then record it as filed externally.</p>}
      </section>

      <section className="card pad stack" aria-label="Actions">
        <h3 style={{ margin: 0 }}>Actions</h3>
        <div className="row-wrap">
          {dirty && <><button type="button" className="btn" disabled={busy || !editable} onClick={save}>Save changes to the draft</button><span role="status" className="muted">Unsaved changes — save before approval.</span></>}
          {(st === "draft" || st === "rejected") && <button type="button" className="btn primary" disabled={busy || dirty || !k.can("approve")} onClick={() => doAct("approve", {}, "Approved. It has not been submitted yet.")}>Approve</button>}
          {st === "approved" && canSubmitVia(tx) && <button type="button" className="btn primary" disabled={busy || dirty || !tx.ApprovedPayload || tx.ApprovedPayload !== tx.Payload || !k.can("submit")} onClick={submit}>{busy ? "Sending…" : "Submit to Companies House"}</button>}
          {st === "submitted" && <button type="button" className="btn" disabled={busy} onClick={check}>Check the answer from Companies House</button>}
          {st === "info" && <button type="button" className="btn" disabled={busy} onClick={() => doAct("answer", { note }, "Marked as answered.")}>Mark as answered</button>}
          {(st === "declined" || st === "cancelled" || st === "rejected" || st === "tested") && <button type="button" className="btn" disabled={busy} onClick={() => doAct("reopen", {}, "Reopened as a draft.")}>Reopen as a draft</button>}
        </div>
        {["draft", "info", "approved", "rejected", "submitted"].includes(st) && (
          <div className="row-wrap" style={{ alignItems: "end" }}>
            <label className="doc-field" style={{ flex: "1 1 260px" }}><span>Note, question or reason</span><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></label>
            {["draft", "info", "approved", "rejected"].includes(st) && <>
              <button type="button" className="btn" disabled={busy || !note.trim()} onClick={() => doAct("clarify", { note }, "Question recorded. It stays open until it is answered.")}>Request clarification</button>
              <button type="button" className="btn" disabled={busy || !note.trim() || !k.can("approve")} onClick={() => doAct("decline", { note }, "Declined.")}>Reject</button>
              <button type="button" className="btn" disabled={busy} onClick={() => doAct("cancel", { note }, "Cancelled.")}>Cancel the draft</button>
            </>}
          </div>
        )}
        {["draft", "info", "approved", "rejected", "submitted"].includes(st) && (
          <div className="row-wrap" style={{ alignItems: "end" }}>
            <label className="doc-field" style={{ flex: "1 1 260px" }}><span>Already filed another way: your reference</span><input className="input" value={ref} onChange={(e) => setRef(e.target.value)} /></label>
            <button type="button" className="btn" disabled={busy || dirty || !k.can("approve")} onClick={() => doAct("external", { ref, note: "Filed outside the planner" }, "Recorded as filed externally. The register is updated.")}>Mark as already filed externally</button>
          </div>
        )}
        {msg && <p role={msg.ok ? "status" : "alert"} style={{ margin: 0, color: msg.ok ? "var(--green)" : "var(--red-ink)" }}>{msg.text}</p>}
        {!k.can("approve") && <p className="muted" style={{ margin: 0 }}>Only a manager or partner can approve, reject or submit.</p>}
      </section>

      <section className="card pad stack" aria-label="History">
        <h3 style={{ margin: 0 }}>History</h3>
        <ul className="plain">{historyOf(tx).slice().reverse().map((h, i) => <li key={i}><strong>{h.what}</strong> · {h.by} · {h.at.slice(0, 16).replace("T", " ")}{h.note ? <div className="cell-sub">{h.note}</div> : null}</li>)}</ul>
      </section>
    </div>
  );
}
export { chipFor };
