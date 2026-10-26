// Client portal, staff side: identity documents. These belong to a person, not a business, and only
// that person and the practice can see them. Accepting a document records that a named member of
// staff checked it; it does not by itself complete the practice's legally required identity checks.
import { useEffect, useState } from "react";
import { fmtDate } from "../lib/domain";
import { PortalPerson, StaffIdentity } from "../lib/portalAdmin";
import { save } from "../portal/files";
import { say, usePortal } from "./portalKit";

const STATUS: Record<string, [string, string]> = {
  needed: ["Waiting for the client", "amber"], received: ["Sent: needs checking", "blue"], rejected: ["Rejected, waiting for another", "amber"], accepted: ["Accepted", "green"], expired: ["Expired, no replacement", "red"], none: ["No document yet", ""],
};
const d = (s: string) => (s ? fmtDate(s.slice(0, 10)) : "");

export function IdentityTab() {
  const portal = usePortal();
  const [items, setItems] = useState<StaffIdentity[] | null>(null);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const load = () => portal.run((a) => a.identity()).then((r) => { setItems(r.items); setErr(""); }).catch((e) => setErr(say(e)));
  useEffect(() => { void load(); }, []);
  const people = (portal.overview?.users || []).filter((u) => u.status === "active");
  const order = ["received", "rejected", "needed", "expired", "accepted", "none"];
  const sorted = [...(items || [])].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
  return (
    <div className="stack">
      <section className="card pad stack" aria-labelledby="id-h">
        <div className="row-wrap" style={{ justifyContent: "space-between" }}>
          <h2 id="id-h" style={{ margin: 0, fontSize: 16 }}>Identity documents</h2>
          <button type="button" className="btn small" onClick={() => void portal.run((a) => a.sweepIdentity()).then((r) => { setNote(`Checked. ${r.requested} new ${r.requested === 1 ? "request" : "requests"} made and ${r.reminded} ${r.reminded === 1 ? "reminder" : "reminders"} sent.`); return load(); }).catch((e) => setErr(say(e)))}>Run date checks now</button>
        </div>
        <p className="muted" style={{ margin: 0 }}>Only the person themselves can see their identity documents in the portal. Other people at their business, administrators included, can't. Accepting a document records that you checked it; it doesn't complete your anti-money-laundering identity checks on its own.</p>
        {note && <p role="status" style={{ margin: 0 }}>{note}</p>}
      </section>
      <RequestForm people={people} onDone={load} />
      {err && <p className="import-list warn" role="alert">{err}</p>}
      {!items && !err && <p className="muted">Loading…</p>}
      {items && !items.length && <p className="muted">No identity documents have been asked for yet.</p>}
      {sorted.map((it) => <Item key={it.id} it={it} showPerson onChanged={load} />)}
    </div>
  );
}

/** Used on an individual's own client record. */
export function IdentityFor({ person }: { person: PortalPerson }) {
  const portal = usePortal();
  const [items, setItems] = useState<StaffIdentity[] | null>(null);
  const [err, setErr] = useState("");
  const load = () => portal.run((a) => a.identity(person.id)).then((r) => { setItems(r.items); setErr(""); }).catch((e) => setErr(say(e)));
  useEffect(() => { void load(); }, [person.id]);
  return (
    <section className="card pad stack" aria-labelledby="idf-h">
      <h2 id="idf-h" style={{ margin: 0, fontSize: 16 }}>Identity documents</h2>
      <RequestForm people={[person]} fixed onDone={load} />
      {err && <p className="import-list warn" role="alert">{err}</p>}
      {items && !items.length && <p className="muted" style={{ margin: 0 }}>None asked for yet.</p>}
      {items?.map((it) => <Item key={it.id} it={it} onChanged={load} />)}
    </section>
  );
}

function RequestForm({ people, fixed, onDone }: { people: PortalPerson[]; fixed?: boolean; onDone: () => void }) {
  const portal = usePortal();
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState(fixed ? people[0]?.id || "" : "");
  const [kind, setKind] = useState("passport");
  const [label, setLabel] = useState("");
  const [biz, setBiz] = useState<string[]>([]);
  const [auto, setAuto] = useState(true);
  const [months, setMonths] = useState(0);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [again, setAgain] = useState(false);
  const [busy, setBusy] = useState(false);
  const person = people.find((p) => p.id === userId);
  const send = async (force: boolean) => {
    setBusy(true); setErr("");
    try { await portal.run((a) => a.requestIdentity({ userId, kind, label, businesses: biz, autoRenew: auto, reviewMonths: months, note, force })); setOpen(false); setAgain(false); onDone(); } catch (e) { const m = say(e); setErr(m); setAgain(/already has an accepted/.test(m)); onDone(); } finally { setBusy(false); }
  };
  if (!open) return <div><button type="button" className="btn small primary" onClick={() => setOpen(true)}>Ask for a document</button></div>;
  return (
    <div className="card pad stack" style={{ gap: 8 }}>
      {!fixed && <select className="input" aria-label="Person" value={userId} onChange={(e) => { setUserId(e.target.value); setBiz([]); }}><option value="">Choose a person with a portal login</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name || p.email}</option>)}</select>}
      <div className="row-wrap">
        <select className="input" aria-label="Type of document" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="passport">Passport</option><option value="driving-licence">Driving licence</option><option value="national-id">National identity card</option><option value="proof-of-address">Proof of residential address</option><option value="custom">Other document</option>
        </select>
        {kind === "custom" && <input className="input" aria-label="What is it" placeholder="What is the document?" value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} />}
      </div>
      {person && person.businesses.length > 0 && (
        <fieldset className="stack" style={{ gap: 4, border: "1px solid var(--line)", borderRadius: 8, padding: "8px 12px" }}>
          <legend>Used for these businesses</legend>
          {person.businesses.map((b) => <label key={b.clientKey} className="row-wrap"><input type="checkbox" checked={biz.includes(b.clientKey)} onChange={(e) => setBiz(e.target.checked ? [...biz, b.clientKey] : biz.filter((x) => x !== b.clientKey))} /> {b.name}</label>)}
        </fieldset>
      )}
      <label className="row-wrap"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Ask for a replacement automatically one calendar month before it expires</label>
      <label className="row-wrap">If it has no expiry date, ask again every <input className="input" type="number" min={0} max={120} style={{ width: 80 }} value={months} onChange={(e) => setMonths(Number(e.target.value))} /> months (0 = never)</label>
      <input className="input" aria-label="Note to the client" placeholder="Note the client will see (optional)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      {err && <p className="import-list warn" role="alert">{err}</p>}
      <div className="row-wrap">
        <button type="button" className="btn small primary" disabled={busy || !userId} onClick={() => void send(false)}>Send request</button>
        {again && <button type="button" className="btn small" disabled={busy} onClick={() => void send(true)}>Ask again anyway</button>}
        <button type="button" className="btn small" onClick={() => setOpen(false)}>Close</button>
      </div>
    </div>
  );
}

function Item({ it, showPerson, onChanged }: { it: StaffIdentity; showPerson?: boolean; onChanged: () => void }) {
  const portal = usePortal();
  const [open, setOpen] = useState(it.status === "received");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [issue, setIssue] = useState(it.request?.upload?.declaredIssue || "");
  const [expiry, setExpiry] = useState(it.request?.upload?.declaredExpiry || "");
  const [noExp, setNoExp] = useState(false);
  const [note, setNote] = useState("");
  const [sure, setSure] = useState(false);
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [label, tone] = STATUS[it.status] || [it.status, ""];
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setErr(""); try { await fn(); onChanged(); } catch (e) { setErr(say(e)); onChanged(); } finally { setBusy(false); } };
  const open1 = (which: string | number) => run(async () => save(await portal.run((a) => a.downloadIdentity(it.id, which))));
  const viewed = Boolean(it.request?.upload?.viewedBy.length);
  return (
    <section className="card pad stack" style={{ gap: 6 }} aria-label={`${it.title} for ${it.person}`}>
      <div className="row-wrap" style={{ justifyContent: "space-between" }}>
        <button type="button" className="linkbtn" aria-expanded={open} onClick={() => setOpen(!open)}>{showPerson ? `${it.person}: ` : ""}{it.title}</button>
        <span className={`chip ${tone}`}>{label}</span>
      </div>
      <div className="muted" style={{ fontSize: 13 }}>
        {it.businesses.length ? `For ${it.businesses.map((b) => b.name).join(", ")} · ` : ""}{it.current ? `Accepted ${d(it.current.verifiedAt)} by ${it.current.verifiedBy}${it.current.expiryDate ? ` · expires ${d(it.current.expiryDate)}` : " · no expiry date"}` : "Nothing accepted yet"}{it.nextRenewal ? ` · next request ${d(it.nextRenewal)}` : ""}{it.paused ? " · reminders paused" : ""}
      </div>
      {open && (
        <div className="stack" style={{ gap: 8 }}>
          {it.request && <p style={{ margin: 0 }}>Asked {d(it.request.requestedAt)}{it.request.reason === "renewal" ? " (renewal)" : it.request.reason === "rejected" ? ` (rejected: ${it.request.rejectedReason})` : ""}. {it.request.remindersSent} {it.request.remindersSent === 1 ? "reminder" : "reminders"} sent.</p>}
          {it.request?.upload && (
            <div className="stack" style={{ gap: 8, border: "1px solid var(--line)", borderRadius: 8, padding: 10 }}>
              <div>Received {d(it.request.upload.receivedAt)}: {it.request.upload.fileName} ({Math.round(it.request.upload.size / 1024)} KB). {it.request.upload.scan === "scanned" ? "Scanned." : "Type and content checked; no virus scanner connected."}</div>
              <div><button type="button" className="btn small" disabled={busy} onClick={() => void open1("upload")}>Open the document</button> <span className="muted" style={{ fontSize: 13 }}>{viewed ? `Opened by ${it.request.upload.viewedBy.join(", ")}.` : "Every time it is opened is recorded. You have to open it before you can accept it."}</span></div>
              <div className="row-wrap">
                <label className="row-wrap">Issue date <input className="input" type="date" value={issue} onChange={(e) => setIssue(e.target.value)} /></label>
                <label className="row-wrap">Expiry date <input className="input" type="date" value={expiry} disabled={noExp} onChange={(e) => setExpiry(e.target.value)} /></label>
                <label className="row-wrap"><input type="checkbox" checked={noExp} onChange={(e) => setNoExp(e.target.checked)} /> It has no expiry date</label>
              </div>
              <input className="input" aria-label="How you checked it" placeholder="How you checked it, e.g. original seen (optional)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
              <label className="row-wrap"><input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} /> I have checked this document and the dates above. I understand this doesn't complete our anti-money-laundering checks on its own.</label>
              <div className="row-wrap">
                <button type="button" className="btn small primary" disabled={busy || !sure} onClick={() => void run(() => portal.run((a) => a.acceptIdentity(it.id, { issueDate: issue, expiryDate: noExp ? "" : expiry, noExpiry: noExp, note, confirmed: true })))}>Accept</button>
                <button type="button" className="btn small" disabled={busy} onClick={() => setRejecting(!rejecting)}>Reject</button>
              </div>
              {rejecting && <div className="row-wrap"><input className="input" aria-label="Why it is being rejected" placeholder="Tell the client what's wrong" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /><button type="button" className="btn small" disabled={busy || !reason.trim()} onClick={() => void run(() => portal.run((a) => a.rejectIdentity(it.id, reason)))}>Reject and ask for another</button></div>}
            </div>
          )}
          <div className="row-wrap">
            {it.current && <button type="button" className="btn small" disabled={busy} onClick={() => void open1("current")}>Open the accepted document</button>}
            <label className="row-wrap"><input type="checkbox" checked={it.renewal.auto} disabled={busy} onChange={(e) => void run(() => portal.run((a) => a.editIdentity(it.id, { autoRenew: e.target.checked })))} /> Renew automatically</label>
            <label className="row-wrap"><input type="checkbox" checked={it.paused} disabled={busy} onChange={(e) => void run(() => portal.run((a) => a.editIdentity(it.id, { paused: e.target.checked })))} /> Pause reminders and renewals</label>
            <button type="button" className="btn small" disabled={busy} onClick={() => void run(() => portal.run((a) => a.cancelIdentity(it.id)))}>{it.request ? "Cancel this request" : "No longer needed"}</button>
          </div>
          {it.history.length > 0 && (
            <details><summary>History ({it.history.length})</summary>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{it.history.map((h) => <li key={h.n}>{h.fileName}: {h.decision === "rejected" ? `rejected by ${h.decidedBy} on ${d(h.decidedAt)} (${h.note})` : `accepted by ${h.decidedBy} on ${d(h.decidedAt)}${h.expiryDate ? `, expired/expires ${d(h.expiryDate)}` : ""}, replaced ${d(h.decidedAt)}`} <button type="button" className="linkbtn" onClick={() => void open1(h.n)}>Open</button></li>)}</ul>
            </details>
          )}
        </div>
      )}
      {err && <p className="import-list warn" role="alert">{err}</p>}
    </section>
  );
}
