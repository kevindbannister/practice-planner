// "Ceasing to act" tab: choose why, when and what happens next, check the letter, then open it in Letters and
// emails to edit, make as Word or put in Outlook drafts.
import { useMemo, useState } from "react";
import { Client, fmtDate, isOpen, todayIso } from "../lib/domain";
import { longDate, addressLines, salutationFor, signOffFor } from "../lib/comms";
import { REASONS, Reason, defaultInput, disengageLetter, problems } from "../lib/disengage";
import { newKey } from "../lib/planning";
import { go } from "./bits";
import { useCommsPrefs } from "./commsKit";
import { ceaseClient, reinstateClient } from "../lib/compliance";
import { useData, useIndex } from "./data";
import { useSales } from "./salesKit";

export function DisengageTab({ client }: { client: Client }) {
  const { create, user, store } = useData();
  const idx = useIndex();
  const prefs = useCommsPrefs();
  const today = todayIso();
  const jobs = (idx.jobsByClient.get(client.Key) || []).filter((j) => isOpen(j));
  const [reason, setReason] = useState<Reason>("client");
  const [end, setEnd] = useState("");
  const [owing, setOwing] = useState("");
  const [returnRecords, setReturn] = useState(true);
  const [authorities, setAuth] = useState(true);
  const [newAccountant, setNew] = useState(true);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [extra, setExtra] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sales = useSales();
  const [ceasedOn, setCeasedOn] = useState(today);
  const [ceasedWhy, setCeasedWhy] = useState("");
  const [ceaseError, setCeaseError] = useState("");
  const ceased = String(client.Status) === "Archived";
  const markCeased = async (reinstate: boolean) => {
    const w = reinstate ? reinstateClient(client, sales.pcan, sales.ctx()) : ceaseClient(client, ceasedOn, ceasedWhy, today, sales.pcan, sales.ctx());
    if ("error" in w) { setCeaseError(w.error); return; }
    setCeaseError("");
    try { await sales.apply(w); } catch { setCeaseError("Couldn't save. Try again."); }
  };

  const input = useMemo(() => ({
    ...defaultInput(client), reason, endDate: end ? longDate(end) : "", owing: Number(owing.replace(/[£,]/g, "")) || 0, returnRecords, authorities, newAccountant, extra,
    deadlines: jobs.filter((j) => !skip.has(String(j.Key))).map((j) => ({ title: String(j.Title), date: j.Deadline ? fmtDate(String(j.Deadline)) : "" })),
  }), [client, reason, end, owing, returnRecords, authorities, newAccountant, extra, jobs, skip]);
  const letter = disengageLetter(input);
  const issues = problems(input);
  const ready = store.hasList("Communications");

  const make = async () => {
    setBusy(true);
    setError("");
    try {
      const sal = salutationFor(client);
      const key = newKey("M");
      const now = new Date().toISOString();
      await create("Communications", {
        Key: key, ClientKey: client.Key, JobKey: "", Kind: "letter", Status: "draft", Subject: letter.subject, Title: letter.subject, Body: letter.body, Brief: "Ending our engagement",
        ToEmail: String(client.Email || ""), Address: addressLines(client).join("\n"), Salutation: sal, SignOff: signOffFor(sal, prefs), LetterDate: today, Created: now, Updated: now,
      });
      await create("Activities", { Key: newKey("A"), ClientKey: client.Key, Type: "disengagement-letter", Title: "Letter ending our engagement prepared", Summary: `Stopping ${input.endDate}`, At: now, Actor: user || "", Source: "comms", SourceKey: key, EventKey: `comms:${key}:disengage`, Visibility: "normal", Created: now });
      go(`#/comms/${encodeURIComponent(key)}`);
    } catch {
      setError("Couldn't make the letter. Try again.");
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ maxWidth: 820 }}>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>A letter to {client.Title} confirming we are stopping. Choose what applies; you can edit every word afterwards. The wording is a starting point to check, not legal advice.</p>
      <section className="card pad stack" aria-label="Mark as ceased">
        <h2 className="sec-h">{ceased ? "This client has ceased" : "Mark as ceased"}</h2>
        {ceased ? (
          <>
            <p style={{ margin: 0 }}>Last day {String(client.CeasedOn || "not recorded")}{client.CeasedReason ? `: ${String(client.CeasedReason)}` : ""}. They are left out of the active client counts. Their records can be reviewed for deletion under <a href="#/compliance/retention">Compliance › Retention</a>.</p>
            {sales.pcan("send") && <div><button className="btn" type="button" onClick={() => markCeased(true)}>Reinstate as a client</button></div>}
          </>
        ) : (
          <>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>Do this once the last day has passed. The client moves out of the active list and the clock starts on how long their records are kept. Nothing is deleted.</p>
            <div className="cf-grid">
              <label className="field"><span>Last day we acted</span><input className="input" type="date" value={ceasedOn} onChange={(e) => setCeasedOn(e.target.value)} /></label>
              <label className="field"><span>Why they left</span><input className="input" value={ceasedWhy} onChange={(e) => setCeasedWhy(e.target.value)} placeholder="For example, sold the business" /></label>
            </div>
            {sales.pcan("send") ? <div><button className="btn" type="button" onClick={() => markCeased(false)}>Mark as ceased</button></div> : <p className="muted" style={{ margin: 0 }}>Only a manager or partner can do this.</p>}
          </>
        )}
        {ceaseError && <p role="alert" className="warn" style={{ margin: 0 }}>{ceaseError}</p>}
      </section>
      <section className="card pad stack" aria-label="Ending the engagement">
        <div className="cf-grid">
          <label className="field"><span>Why</span><select className="input" value={reason} onChange={(e) => setReason(e.target.value as Reason)}>{REASONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select></label>
          <label className="field"><span>Last day we act</span><input className="input" type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
          <label className="field"><span>Fees outstanding (£){reason === "fees" ? "" : ", if any"}</span><input className="input" inputMode="decimal" value={owing} onChange={(e) => setOwing(e.target.value)} /></label>
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <label className="row-wrap"><input type="checkbox" checked={returnRecords} onChange={(e) => setReturn(e.target.checked)} /> Say we will return their records</label>
          <label className="row-wrap"><input type="checkbox" checked={authorities} onChange={(e) => setAuth(e.target.checked)} /> Explain that HMRC{client.Kind === "Ltd" || client.Kind === "LLP" ? " and Companies House" : ""} access ends</label>
          <label className="row-wrap"><input type="checkbox" checked={newAccountant} onChange={(e) => setNew(e.target.checked)} /> Offer to help a new accountant</label>
        </div>
        {jobs.length > 0 && (
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="muted" style={{ fontSize: 12 }}>Open work that stays with the client (untick any to leave out)</legend>
            {jobs.map((j) => (
              <label key={String(j.Key)} className="row-wrap"><input type="checkbox" checked={!skip.has(String(j.Key))} onChange={(e) => { const n = new Set(skip); if (e.target.checked) n.delete(String(j.Key)); else n.add(String(j.Key)); setSkip(n); }} /> {String(j.Title)}{j.Deadline ? <span className="muted"> · due {fmtDate(String(j.Deadline))}</span> : null}</label>
            ))}
          </fieldset>
        )}
        <label className="field"><span>Anything else to add (optional)</span><textarea className="input" rows={3} value={extra} onChange={(e) => setExtra(e.target.value)} /></label>
      </section>
      <section className="import-list" aria-label="Preview">
        <strong>{letter.subject}</strong>
        <div style={{ whiteSpace: "pre-wrap", fontSize: 13, marginTop: 6 }}>{letter.body}</div>
      </section>
      {issues.map((p) => <p key={p} className="error-text" role="alert" style={{ margin: 0 }}>{p}</p>)}
      {error && <p className="error-text" role="alert" style={{ margin: 0 }}>{error}</p>}
      <div><button type="button" className="btn primary" disabled={busy || !ready || issues.length > 0} onClick={() => void make()}>{busy ? "Making…" : "Make the letter"}</button></div>
    </div>
  );
}
