// Client portal, staff side: information requests for one client, and the central reminders screen.
import { useEffect, useState } from "react";
import { Client, fmtDate } from "../lib/domain";
import { ReminderKind, RemindersOverview, StaffRequest } from "../lib/portalAdmin";
import { say, usePortal } from "./portalKit";

const STATUS: Record<string, [string, string]> = { open: ["Waiting for the client", "amber"], responded: ["Answered: needs you", "blue"], complete: ["Complete", "green"], cancelled: ["Cancelled", ""] };
const when = (iso: string) => (iso ? fmtDate(iso.slice(0, 10)) : "");

export function ClientRequests({ client }: { client: Client }) {
  const portal = usePortal();
  const [list, setList] = useState<StaffRequest[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState("");
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [due, setDue] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const load = () => portal.run((a) => a.requests(client.Key)).then((r) => { setList(r); setErr(""); }).catch((e) => setErr(say(e)));
  useEffect(() => { void load(); }, [client.Key]);
  if (portal.status && !portal.status.configured) return null;
  const people = portal.forClient(client.Key).filter((r) => r.person.status === "active");
  const send = async () => {
    setBusy(true); setErr(""); setNote("");
    try { const r = await portal.run((a) => a.createRequest({ clientKey: client.Key, title, details, dueDate: due, assignedTo: picked, notify })); setNote(`Sent. ${r.request.told} ${r.request.told === 1 ? "person was" : "people were"} emailed.`); setAdding(false); setTitle(""); setDetails(""); setDue(""); setPicked([]); await load(); } catch (e) { setErr(say(e)); } finally { setBusy(false); }
  };
  return (
    <section className="card pad stack" aria-labelledby="rq-h">
      <div className="row-wrap" style={{ justifyContent: "space-between" }}>
        <h2 id="rq-h" style={{ margin: 0, fontSize: 16 }}>Information requests for {client.Title}</h2>
        <button type="button" className="btn small primary" onClick={() => setAdding(!adding)}>{adding ? "Close" : "Ask for information"}</button>
      </div>
      {adding && (
        <div className="stack" style={{ gap: 8 }}>
          <input className="input" aria-label="What you need" placeholder="What do you need?" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
          <textarea className="input" aria-label="Details" rows={3} placeholder="Details (optional)" value={details} maxLength={2000} onChange={(e) => setDetails(e.target.value)} />
          <label className="row-wrap">Needed by (optional) <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
          <fieldset className="stack" style={{ gap: 4, border: "1px solid var(--line)", borderRadius: 8, padding: "8px 12px" }}>
            <legend>Who should answer</legend>
            <span className="muted" style={{ fontSize: 13 }}>{picked.length ? "Only the people ticked, plus administrators." : "Nobody ticked: all administrators and standard users for this business."}</span>
            {people.map((p) => <label key={p.person.id} className="row-wrap"><input type="checkbox" checked={picked.includes(p.person.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, p.person.id] : picked.filter((x) => x !== p.person.id))} /> {p.person.name || p.person.email} <span className="muted">({p.levelLabel})</span></label>)}
          </fieldset>
          <label className="row-wrap"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Email them that something is needed</label>
          <div><button type="button" className="btn small primary" disabled={busy || !title.trim()} onClick={() => void send()}>Send request</button></div>
        </div>
      )}
      {note && <p role="status" style={{ margin: 0 }}>{note}</p>}
      {err && <p className="import-list warn" role="alert">{err}</p>}
      {list && !list.length && <p className="muted" style={{ margin: 0 }}>No requests yet.</p>}
      {list?.map((r) => <Req key={r.id} r={r} onChanged={load} />)}
    </section>
  );
}

function Req({ r, onChanged }: { r: StaffRequest; onChanged: () => void }) {
  const portal = usePortal();
  const [open, setOpen] = useState(r.status === "responded");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [label, tone] = STATUS[r.status];
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setErr(""); try { await fn(); setText(""); onChanged(); } catch (e) { setErr(say(e)); } finally { setBusy(false); } };
  return (
    <div className="stack" style={{ gap: 6, borderTop: "1px solid var(--line)", paddingTop: 8 }}>
      <div className="row-wrap" style={{ justifyContent: "space-between" }}><button type="button" className="linkbtn" aria-expanded={open} onClick={() => setOpen(!open)}>{r.title}</button><span className={`chip ${tone}`}>{label}</span></div>
      <div className="muted" style={{ fontSize: 13 }}>Asked {when(r.createdAt)} by {r.createdByName}{r.dueDate ? ` · needed by ${when(r.dueDate)}` : ""}{r.assignedNames.length ? ` · for ${r.assignedNames.join(", ")}` : ""}</div>
      {open && (
        <div className="stack" style={{ gap: 8 }}>
          {r.details && <p style={{ margin: 0 }}>{r.details}</p>}
          {r.thread.map((t, i) => <div key={i} style={{ borderLeft: `3px solid ${t.from === "client" ? "var(--blue, #2563eb)" : "var(--line)"}`, paddingLeft: 10 }}><strong>{t.name}</strong> <span className="muted">{when(t.at)}</span><div>{t.text}</div>{t.docs.length > 0 && <div className="muted" style={{ fontSize: 13 }}>Attached to the client's documents: {t.docs.map((d) => d.title).join(", ")}</div>}</div>)}
          {r.status !== "complete" && r.status !== "cancelled" && (
            <div className="stack" style={{ gap: 6 }}>
              <input className="input" aria-label="Reply to the client" placeholder="Reply to the client (they will see this)" value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} />
              <div className="row-wrap">
                <button type="button" className="btn small" disabled={busy || !text.trim()} onClick={() => void run(() => portal.run((a) => a.replyRequest(r.id, text)))}>Send reply</button>
                <button type="button" className="btn small primary" disabled={busy} onClick={() => void run(() => portal.run((a) => a.completeRequest(r.id)))}>Mark complete</button>
                <button type="button" className="btn small" disabled={busy} onClick={() => void run(() => portal.run((a) => a.cancelRequest(r.id)))}>Cancel request</button>
              </div>
            </div>
          )}
        </div>
      )}
      {err && <p className="import-list warn" role="alert">{err}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- the reminders screen

export function RemindersTab() {
  const portal = usePortal();
  const [o, setO] = useState<RemindersOverview | null>(null);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const load = () => portal.run((a) => a.reminders()).then((r) => { setO(r); setErr(""); }).catch((e) => setErr(say(e)));
  useEffect(() => { void load(); }, []);
  const act = async (fn: () => Promise<string | void>) => { setErr(""); setNote(""); try { const m = await fn(); if (m) setNote(m); await load(); } catch (e) { setErr(say(e)); } };
  if (!o) return err ? <p className="import-list warn" role="alert">{err}</p> : <p className="muted">Loading…</p>;
  const stale = !o.lastSweepAt || Date.now() - Date.parse(o.lastSweepAt) > 3 * 3600 * 1000;
  return (
    <div className="stack">
      <section className="card pad stack" aria-labelledby="rm-h">
        <div className="row-wrap" style={{ justifyContent: "space-between" }}>
          <h2 id="rm-h" style={{ margin: 0, fontSize: 16 }}>Reminders</h2>
          <div className="row-wrap">
            <label className="row-wrap"><input type="checkbox" checked={o.paused} onChange={(e) => void act(() => portal.run((a) => a.reminderSettings({ paused: e.target.checked })))} /> Pause all reminders</label>
            <button type="button" className="btn small" onClick={() => void act(async () => { const r = await portal.run((a) => a.runReminders()); return r.skipped ? `Nothing sent: ${r.skipped}.` : `Done. ${r.sent} ${r.sent === 1 ? "reminder" : "reminders"} sent to ${r.people} ${r.people === 1 ? "person" : "people"}; ${r.identity.requested} identity renewals asked for.`; })}>Run now</button>
          </div>
        </div>
        <p className="muted" style={{ margin: 0 }}>Reminders go out as one gentle email per person, between 7am and 7pm UK time, and stop by themselves when the thing is done. Emails only say something is waiting; they never name a document.</p>
        <p className={stale ? "import-list warn" : "muted"} role="status" style={{ margin: 0 }}>{o.lastSweepAt ? `Last ran ${new Date(o.lastSweepAt).toLocaleString("en-GB")}.` : "Reminders have never run."}{stale ? " They should run every hour. If this is out of date, the scheduled trigger isn't set up: see Set-up." : ""}</p>
        {note && <p role="status" style={{ margin: 0 }}>{note}</p>}
        {err && <p className="import-list warn" role="alert">{err}</p>}
      </section>
      <section className="card pad stack" aria-labelledby="rp-h">
        <h2 id="rp-h" style={{ margin: 0, fontSize: 16 }}>How often</h2>
        {(Object.entries(o.kinds) as [string, ReminderKind][]).map(([k, v]) => <Policy key={k} kind={k} v={v} onSave={(patch) => act(() => portal.run((a) => a.reminderSettings({ kinds: { [k]: patch } })).then(() => "Saved."))} />)}
        <p className="muted" style={{ margin: 0 }}>{o.identityNote}</p>
      </section>
      <section className="card pad stack" aria-labelledby="ri-h">
        <h2 id="ri-h" style={{ margin: 0, fontSize: 16 }}>What is being chased</h2>
        {!o.items.length && <p className="muted" style={{ margin: 0 }}>Nothing is waiting on a client right now.</p>}
        {o.items.map((i) => (
          <div key={i.key} className="stack" style={{ gap: 4, borderTop: "1px solid var(--line)", paddingTop: 8 }}>
            <div className="row-wrap" style={{ justifyContent: "space-between" }}><strong>{i.client}: {i.title}</strong><span className={`chip ${i.cancelled ? "" : i.paused ? "amber" : i.nextDue ? "blue" : ""}`}>{i.cancelled ? "Cancelled" : i.paused ? "Paused" : i.exhausted ? "All reminders sent" : i.nextDue ? `Next ${when(i.nextDue)}` : "Not scheduled"}</span></div>
            <div className="muted" style={{ fontSize: 13 }}>{i.kindLabel} · waiting on {i.recipients.join(", ") || "nobody with access"} · {i.sentCount} sent{i.lastSentAt ? `, last ${when(i.lastSentAt)}` : ""}</div>
            <div className="row-wrap">
              <button type="button" className="btn small" onClick={() => void act(() => portal.run((a) => a.reminderItem(i.key, { paused: !i.paused })))}>{i.paused ? "Resume" : "Pause"}</button>
              <button type="button" className="btn small" onClick={() => void act(() => portal.run((a) => a.reminderItem(i.key, { cancelled: !i.cancelled })))}>{i.cancelled ? "Restart" : "Stop reminding"}</button>
              <label className="row-wrap">Send next on <input className="input" type="date" aria-label={`Reschedule ${i.title}`} onChange={(e) => e.target.value && void act(() => portal.run((a) => a.reminderItem(i.key, { nextAt: e.target.value + "T09:00:00Z" })))} /></label>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

function Policy({ kind, v, onSave }: { kind: string; v: ReminderKind; onSave: (p: Partial<ReminderKind>) => void }) {
  const [first, setFirst] = useState(v.firstAfterDays);
  const [every, setEvery] = useState(v.repeatEveryDays);
  const [max, setMax] = useState(v.max);
  const [on, setOn] = useState(v.enabled);
  useEffect(() => { setFirst(v.firstAfterDays); setEvery(v.repeatEveryDays); setMax(v.max); setOn(v.enabled); }, [v.firstAfterDays, v.repeatEveryDays, v.max, v.enabled]);
  const num = (val: number, set: (n: number) => void, label: string) => <label className="row-wrap">{label} <input className="input" type="number" min={1} max={90} style={{ width: 70 }} value={val} onChange={(e) => set(Number(e.target.value))} /></label>;
  return (
    <div className="row-wrap" style={{ borderTop: "1px solid var(--line)", paddingTop: 8 }} role="group" aria-label={v.label}>
      <label className="row-wrap" style={{ minWidth: 280 }}><input type="checkbox" checked={on} onChange={(e) => { setOn(e.target.checked); onSave({ enabled: e.target.checked }); }} /> <strong>{v.label}</strong></label>
      {num(first, setFirst, "first after (days)")}{num(every, setEvery, "then every (days)")}{num(max, setMax, "at most")}
      <button type="button" className="btn small" onClick={() => onSave({ firstAfterDays: first, repeatEveryDays: every, max })} data-kind={kind}>Save</button>
    </div>
  );
}
