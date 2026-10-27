// Professional clearance for one client: who the previous accountant is, the letter asking them
// (built from the client's record, editable), what we have asked for and received, and the reply.
// The Overview card summarises it; this is the full tab. See lib/clearance.ts.
import { useMemo, useState } from "react";
import { Client, fmtDate, todayIso } from "../lib/domain";
import { DOCX_TYPE, NotWordFile, letterDocx } from "../lib/docx";
import { Item, STATUS_CHIP, STATUS_LABEL, STANDARD_ITEMS, asStatus, clearanceLetter, defaultItems, greeting, latest, previousOf, problems, readItems } from "../lib/clearance";
import { letterFileName, longDate } from "../lib/comms";
import { newKey } from "../lib/planning";
import { readOnboardingSettings, readStates, setStage, isLiveOnboarding } from "../lib/onboarding";
import { Row } from "../lib/schema";
import { getLetterhead } from "./Comms";
import { downloadFile, outlookDraft, useCommsPrefs, mailAllowed } from "./commsKit";
import { useData } from "./data";
import { useSales } from "./salesKit";

const nowIso = () => new Date().toISOString();

export function ClearanceTab({ client }: { client: Client }) {
  const { data, store, user, create, update, remove } = useData();
  const prefs = useCommsPrefs();
  const s = useSales();
  const today = todayIso();
  const rows = useMemo(() => data.clearances.filter((r) => r.ClientKey === client.Key).sort((a, b) => String(b.Created).localeCompare(String(a.Created))), [data.clearances, client.Key]);
  const ready = store.hasList("Clearances");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const start = async () => {
    setBusy("start"); setError("");
    try { await create("Clearances", { Key: newKey("CL"), PracticeId: s.ctx().pid, ClientKey: client.Key, Status: "draft", Items: JSON.stringify(defaultItems(client)), Created: nowIso(), CreatedBy: user || "", Updated: nowIso() }); }
    catch { setError("Couldn't start that. Try again."); } finally { setBusy(""); }
  };
  return (
    <div className="stack">
      <div className="row-wrap" style={{ justifyContent: "space-between" }}>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>Ask {client.Title}'s previous accountant whether there is any reason we shouldn't act, and for their records.</p>
        <button type="button" className="btn primary" disabled={!ready || busy === "start" || rows.some((r) => ["draft", "requested"].includes(asStatus(r.Status)))} onClick={() => void start()}>{rows.length ? "Start another request" : "Start a clearance request"}</button>
      </div>
      {!ready && <p className="import-list warn" role="alert">The clearance list isn't set up yet. It is added automatically when the planner starts.</p>}
      {error && <p className="error-text" role="alert">{error}</p>}
      {!rows.length && <div className="card empty">No clearance request for {client.Title} yet. Start one when you're taking the client over from another accountant.</div>}
      {rows.map((r) => <Request key={String(r.Key)} client={client} row={r} update={update} remove={remove} create={create} prefs={prefs} today={today} user={user || ""} s={s} />)}
    </div>
  );
}

function Request({ client, row, update, remove, create, prefs, today, user, s }: { client: Client; row: Row; update: (l: "Clearances", r: Row, p: Row) => Promise<unknown>; remove: (l: "Clearances", r: Row) => Promise<unknown>; create: (l: "Activities", r: Row) => Promise<unknown>; prefs: ReturnType<typeof useCommsPrefs>; today: string; user: string; s: ReturnType<typeof useSales> }) {
  const { data, store } = useData();
  const status = asStatus(row.Status);
  const items = readItems(row.Items, client);
  const prev = previousOf(row);
  const [form, setForm] = useState(prev);
  const [letter, setLetter] = useState(String(row.Letter || ""));
  const [reply, setReply] = useState(String(row.Reply || ""));
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const editable = status === "draft" || status === "requested";
  const dirty = form.firm !== prev.firm || form.contact !== prev.contact || form.email !== prev.email || form.address !== prev.address;
  const g = greeting(form.contact);

  const run = async (id: string, work: () => Promise<string | void>) => {
    setBusy(id); setError(""); setNote("");
    try { const m = await work(); if (m) setNote(m); } catch (e) { setError(e instanceof NotWordFile ? `Your letterhead couldn't be used: ${e.message}` : e instanceof Error && e.message ? e.message : "That didn't work. Try again."); } finally { setBusy(""); }
  };
  const patch = (p: Row) => update("Clearances", row, { ...p, Updated: nowIso() });
  const activity = (type: string, title: string, summary = "") => create("Activities", { Key: newKey("A"), ClientKey: client.Key, Type: type, Title: title, Summary: summary, At: nowIso(), Actor: user, Source: "clearance", SourceKey: String(row.Key), EventKey: `clearance:${row.Key}:${type}:${Date.now()}`, Created: nowIso() });

  const saveDetails = () => run("details", async () => { await patch({ PrevFirm: form.firm.trim(), PrevContact: form.contact.trim(), PrevEmail: form.email.trim(), PrevAddress: form.address.trim() }); return "Saved."; });
  const toggle = (key: string, field: "asked" | "got", v: boolean) => run("items", async () => { await patch({ Items: JSON.stringify(items.map((i) => (i.key === key ? { ...i, [field]: v } : i))) }); });
  const build = () => {
    if (letter.trim() && String(row.GeneratedOn) && letter !== String(row.Letter || "")) { if (!window.confirm("Replace the edited letter with a fresh one built from the record?")) return; }
    const l = clearanceLetter({ client, clientName: String(client.Title), previous: form, items, practice: prefs.signTitle, person: prefs.signName || user, date: longDate(today) });
    return run("build", async () => { setLetter(l.body); await patch({ Letter: l.body, GeneratedOn: nowIso(), PrevFirm: form.firm.trim(), PrevContact: form.contact.trim(), PrevEmail: form.email.trim(), PrevAddress: form.address.trim() }); return "Letter built. Read it and change anything you want before it goes."; });
  };
  const asLetter = () => ({ ...clearanceLetter({ client, clientName: String(client.Title), previous: form, items, practice: prefs.signTitle, person: prefs.signName || user, date: longDate(today) }), body: letter });
  const word = () => run("word", async () => {
    if (!letter.trim()) throw new Error("Build the letter first.");
    const head = await getLetterhead(store.graph, prefs);
    const bytes = await letterDocx(asLetter(), head);
    downloadFile(bytes, letterFileName(today, `Professional clearance ${client.Title}`), DOCX_TYPE);
    return "Word letter downloaded.";
  });
  const draft = () => run("draft", async () => {
    if (!letter.trim()) throw new Error("Build the letter first.");
    if (!form.email.trim()) throw new Error("Add the previous accountant's email first.");
    if (!mailAllowed()) throw new Error("Outlook hasn't been allowed yet. Allow it from the Letters and emails page, then try again.");
    const l = asLetter();
    await outlookDraft(store.graph, { to: form.email, subject: l.subject, body: `${l.salutation}\n\n${letter}\n\n${l.signOff}\n${l.signName}`, signature: prefs.emailSignature });
    return "Email saved to your Outlook drafts. Send it from there, then press Mark as sent.";
  });
  const stage = async (done: boolean, text: string) => {
    const onb = data.onboardings.find((o) => o.ClientKey === client.Key && isLiveOnboarding(o));
    if (!onb) return;
    const def = readOnboardingSettings(data.settings).stages.find((d) => d.key === "clearance");
    if (!def || readStates(onb.Stages)["clearance"]?.status === (done ? "done" : "doing")) return;
    const w = setStage(onb, def, done ? "done" : "doing", text, data.clients.find((c) => c.Key === client.Key) as unknown as Row, s.pcan, s.ctx());
    if (!("error" in w)) await s.apply(w);
  };
  const sent = () => run("sent", async () => {
    const p = problems(form);
    if (p.length) throw new Error(p[0]);
    if (!letter.trim()) throw new Error("Build the letter first.");
    await patch({ Status: "requested", SentOn: nowIso(), SentBy: user, PrevFirm: form.firm.trim(), PrevContact: form.contact.trim(), PrevEmail: form.email.trim(), PrevAddress: form.address.trim(), Letter: letter });
    await activity("clearance-asked", `Clearance requested from ${form.firm}`, `Sent to ${form.contact || "Sir/Madam"}${form.email ? ` (${form.email})` : ""}`);
    await stage(false, `Asked ${form.firm}`);
    return "Marked as sent. It now shows as waiting for a reply.";
  });
  const outcome = (to: "received" | "refused" | "notneeded", label: string) => run(to, async () => {
    if (to === "refused" && !reply.trim()) throw new Error("Say why in the reply box first.");
    await patch({ Status: to, ReceivedOn: nowIso(), Reply: reply.trim() });
    if (to !== "notneeded") await activity(to === "received" ? "clearance-received" : "clearance-refused", `${label}: ${form.firm || "previous accountant"}`, reply.trim().slice(0, 300));
    if (to === "received") await stage(true, `Cleared by ${form.firm}`);
    return `${label}.`;
  });
  const reopen = () => run("reopen", async () => { await patch({ Status: row.SentOn ? "requested" : "draft", ReceivedOn: "" }); });
  const del = () => { if (window.confirm("Delete this clearance request? Activity already recorded on the timeline stays.")) void run("del", async () => { await remove("Clearances", row); }); };

  return (
    <section className="card pad stack" aria-label="Clearance request">
      <div className="row-wrap" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>{form.firm || prev.firm || "Previous accountant"}</h2>
        <span className={`chip ${STATUS_CHIP[status]}`}>{STATUS_LABEL[status]}</span>
      </div>
      <div className="muted" style={{ fontSize: 13 }}>Started {fmtDate(String(row.Created).slice(0, 10))}{row.SentOn ? ` · sent ${fmtDate(String(row.SentOn).slice(0, 10))}` : ""}{row.ReceivedOn && status !== "requested" ? ` · answered ${fmtDate(String(row.ReceivedOn).slice(0, 10))}` : ""}{row.GeneratedOn ? ` · letter built ${fmtDate(String(row.GeneratedOn).slice(0, 10))}` : ""}</div>

      <div className="tl-form">
        <label className="doc-field"><span>Firm</span><input className="input" value={form.firm} disabled={!editable} onChange={(e) => setForm({ ...form, firm: e.target.value })} /></label>
        <label className="doc-field"><span>Contact (blank: Sir/Madam)</span><input className="input" value={form.contact} disabled={!editable} onChange={(e) => setForm({ ...form, contact: e.target.value })} /></label>
        <label className="doc-field"><span>Email</span><input className="input" type="email" value={form.email} disabled={!editable} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
        <label className="doc-field" style={{ gridColumn: "1 / -1" }}><span>Address</span><textarea className="input" rows={2} value={form.address} disabled={!editable} onChange={(e) => setForm({ ...form, address: e.target.value })} /></label>
      </div>
      {editable && dirty && <div><button type="button" className="btn small" disabled={busy === "details"} onClick={() => void saveDetails()}>Save details</button></div>}

      <fieldset className="stack" style={{ gap: 4, border: "1px solid var(--line)", borderRadius: 8, padding: "8px 12px" }}>
        <legend>What we are asking for{status !== "draft" ? " and what has come back" : ""}</legend>
        {items.map((i: Item) => (
          <div key={i.key} className="row-wrap" style={{ justifyContent: "space-between" }}>
            <label className="row-wrap"><input type="checkbox" checked={i.asked} disabled={!editable || busy === "items"} onChange={(e) => void toggle(i.key, "asked", e.target.checked)} /> {i.label}</label>
            {i.asked && status !== "draft" && <label className="row-wrap muted"><input type="checkbox" checked={i.got} disabled={busy === "items"} onChange={(e) => void toggle(i.key, "got", e.target.checked)} /> Received</label>}
          </div>
        ))}
        {STANDARD_ITEMS.length === 0 && null}
      </fieldset>

      <div className="stack" style={{ gap: 6 }}>
        <div className="row-wrap" style={{ justifyContent: "space-between" }}>
          <strong>Letter</strong>
          {editable && <button type="button" className="btn small" disabled={busy === "build"} onClick={() => void build()}>{letter ? "Rebuild from the record" : "Build the letter"}</button>}
        </div>
        {letter ? <>
          <div className="muted" style={{ fontSize: 13 }}>{g.salutation}</div>
          <textarea className="input" rows={12} value={letter} disabled={!editable} aria-label="Letter text" onChange={(e) => setLetter(e.target.value)} onBlur={() => { if (letter !== String(row.Letter || "")) void patch({ Letter: letter }); }} />
          <div className="muted" style={{ fontSize: 13 }}>{g.signOff} {prefs.signName || user}</div>
          <div className="row-wrap">
            <button type="button" className="btn small" disabled={busy === "word"} onClick={() => void word()}>Download Word letter</button>
            <button type="button" className="btn small" disabled={busy === "draft" || !editable} onClick={() => void draft()}>Email draft in Outlook</button>
          </div>
        </> : <p className="muted" style={{ margin: 0 }}>Press Build the letter to write it from {client.Title}'s record and the list above. It's a starting point: check the wording before it goes.</p>}
      </div>

      {(status === "requested" || status === "received" || status === "refused") && (
        <label className="doc-field"><span>Their reply (notes)</span><textarea className="input" rows={3} value={reply} disabled={status !== "requested"} onChange={(e) => setReply(e.target.value)} placeholder="Anything they said, or why they haven't cleared us." /></label>
      )}

      {error && <p className="error-text" role="alert">{error}</p>}
      {note && <p role="status" style={{ margin: 0 }}>{note}</p>}
      <div className="row-wrap">
        {status === "draft" && <button type="button" className="btn primary" disabled={!!busy} onClick={() => void sent()}>Mark as sent</button>}
        {status === "requested" && <><button type="button" className="btn primary" disabled={!!busy} onClick={() => void outcome("received", "Clearance received")}>Clearance received</button><button type="button" className="btn" disabled={!!busy} onClick={() => void outcome("refused", "Not cleared")}>Not cleared</button></>}
        {status === "draft" && <button type="button" className="btn" disabled={!!busy} onClick={() => void outcome("notneeded", "Not needed")}>Not needed</button>}
        {(status === "received" || status === "refused" || status === "notneeded") && <button type="button" className="btn" disabled={!!busy} onClick={() => void reopen()}>Reopen</button>}
        <button type="button" className="linkbtn danger-link" disabled={!!busy} onClick={del}>Delete</button>
      </div>
    </section>
  );
}

/** The Overview card: where the clearance stands, with a link to the tab. */
export function ClearanceCard({ client, openHref }: { client: Client; openHref: string }) {
  const { data } = useData();
  const sum = latest(data.clearances, client.Key, todayIso());
  return (
    <section className="card pad stack" aria-label="Professional clearance">
      <div className="card-title-row"><h2 style={{ margin: 0, fontSize: 16 }}>Professional clearance</h2>{sum.status !== "none" && <span className={`chip ${STATUS_CHIP[sum.status]}`}>{STATUS_LABEL[sum.status]}</span>}</div>
      <p className="muted" style={{ margin: 0 }}>{sum.line}</p>
      <div><a className="btn small" href={openHref}>{sum.status === "none" ? "Start a request" : "Open"}</a></div>
    </section>
  );
}
