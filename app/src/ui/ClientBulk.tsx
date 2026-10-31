// Email each, and send a form to each, for the clients shown or ticked on the Clients list.
// Emails go into your Outlook drafts (nothing is sent from here); forms are made as requests on each client.
import { useMemo, useState } from "react";
import { emailLog, planEmails, planForms } from "../lib/bulk";
import { EMAIL_STARTERS } from "../lib/comms";
import { brandOf, readBranding } from "../lib/docBranding";
import { Client, todayIso } from "../lib/domain";
import { readTemplate } from "../lib/forms";
import { newKey } from "../lib/planning";
import { mailAllowed, outlookDraft, useCommsPrefs } from "./commsKit";
import { useData } from "./data";

const nowIso = () => new Date().toISOString();
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const FIELD_HELP = ["{{client.greeting}}", "{{client.name}}", "{{client.first_name}}", "{{practice.name}}", "{{client.company_number}}"];

function Skipped({ noEmail, already }: { noEmail: Client[]; already: Client[] }) {
  return (
    <>
      {noEmail.length > 0 && <p className="muted" style={{ margin: 0 }}>No email address, so left out: {noEmail.slice(0, 6).map((c) => c.Title).join(", ")}{noEmail.length > 6 ? ` and ${noEmail.length - 6} more` : ""}.</p>}
      {already.length > 0 && <p className="muted" style={{ margin: 0 }}>Already has this email drafted, so left out: {plural(already.length, "client")}.</p>}
    </>
  );
}

export function BulkEmail({ clients, done }: { clients: Client[]; done: (note: string) => void }) {
  const { data, create, store } = useData();
  const prefs = useCommsPrefs();
  const branding = useMemo(() => brandOf(readBranding(data.settings)), [data.settings]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("{{client.greeting}}\n\n");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [failed, setFailed] = useState<string[]>([]);
  const today = todayIso();
  const plan = useMemo(() => planEmails(clients, subject, body, branding, today, data.comms), [clients, subject, body, branding, today, data.comms]);
  const first = plan.drafts[0];
  const blanks = [...new Set(plan.drafts.flatMap((d) => d.blanks))];
  const allowed = mailAllowed();

  const make = async () => {
    setBusy(true);
    setFailed([]);
    const bad: string[] = [];
    let ok = 0;
    for (const [i, d] of plan.drafts.entries()) {
      setProgress(`Drafting ${i + 1} of ${plan.drafts.length}…`);
      try {
        const msg = await outlookDraft(store.graph, { to: d.to, subject: d.subject, body: d.body, signature: prefs.emailSignature });
        try {
          await create("Communications", emailLog(d, newKey("M"), msg.webLink || "", nowIso()));
        } catch { /* the draft exists in Outlook; the log entry can be missed without harm */ }
        ok++;
      } catch {
        bad.push(String(d.client.Title));
      }
    }
    setProgress("");
    setBusy(false);
    setFailed(bad);
    if (!bad.length) done(`${plural(ok, "draft")} put in your Outlook drafts. Check them there before sending.`);
    else if (ok) done(`${plural(ok, "draft")} put in your Outlook drafts. ${bad.length} failed (${bad.slice(0, 4).join(", ")}${bad.length > 4 ? "…" : ""}). Press the button again to try just those.`);
  };

  return (
    <>
      <label className="field"><span>Subject</span><input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Your records for the year end" list="bulk-starters" />
        <datalist id="bulk-starters">{EMAIL_STARTERS.map((s) => <option key={s} value={s} />)}</datalist></label>
      <label className="field"><span>Message</span><textarea className="input" rows={7} value={body} onChange={(e) => setBody(e.target.value)} /></label>
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>Merge fields fill in each client's own details: {FIELD_HELP.join("  ")}. Your email signature is added.</p>
      {plan.problems.map((p) => <p key={p} className="error-text" role="alert" style={{ margin: 0 }}>{p}</p>)}
      {first && !plan.problems.length && (
        <div className="import-list" aria-label="Preview">
          <strong>Preview for {String(first.client.Title)}</strong>
          <div style={{ whiteSpace: "pre-wrap", fontSize: 13 }}><div><b>To:</b> {first.to}</div><div><b>Subject:</b> {first.subject}</div><br />{first.body}</div>
        </div>
      )}
      {blanks.length > 0 && <p className="import-list warn" style={{ margin: 0 }}>Some clients have nothing for {blanks.map((k) => `{{${k}}}`).join(", ")}; it stays in the draft as written so you can spot it.</p>}
      <Skipped noEmail={plan.noEmail} already={plan.already} />
      {!allowed && <p className="import-list warn" role="alert" style={{ margin: 0 }}>Outlook drafts need permission to your mailbox. Allow it under Settings › Email, then come back.</p>}
      {failed.length > 0 && <p className="error-text" role="alert" style={{ margin: 0 }}>Couldn't draft: {failed.join(", ")}.</p>}
      <p className="muted" style={{ margin: 0 }}>{plural(plan.drafts.length, "draft")} will be created in Outlook. Nothing is sent from here.</p>
      <div><button type="button" className="btn primary" disabled={busy || !allowed || !plan.drafts.length || plan.problems.length > 0} onClick={() => void make()}>{busy ? progress || "Working…" : `Create ${plural(plan.drafts.length, "draft")} in Outlook`}</button></div>
    </>
  );
}

export function BulkForm({ clients, done }: { clients: Client[]; done: (note: string) => void }) {
  const { data, user, createMany, store } = useData();
  const templates = useMemo(() => data.formTemplates.map(readTemplate).filter((t) => !t.archived).sort((a, b) => a.name.localeCompare(b.name)), [data.formTemplates]);
  const [tpl, setTpl] = useState("");
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ready = store.hasList("FormRequests");
  const t = templates.find((x) => x.key === tpl);
  const plan = useMemo(() => planForms(clients, t, title, due, data.formRequests, user || "", nowIso(), newKey), [clients, t, title, due, data.formRequests, user]);

  const make = async () => {
    setBusy(true);
    setError("");
    try {
      await createMany("FormRequests", plan.requests);
      try { await createMany("Activities", plan.activities); } catch { /* the requests exist; the history entries are a nicety */ }
      done(`Made ${plural(plan.requests.length, "form request")}. Each client's own details are filled in where the form asks for them. Open a client's Documents › Forms tab to enter answers.`);
    } catch {
      setError("That didn't save. Nothing was changed, or only some of it was. Check the clients' Forms tabs, then try again: clients who already have it are skipped.");
    } finally {
      setBusy(false);
    }
  };

  if (!ready) return <p className="import-list warn" role="alert" style={{ margin: 0 }}>The forms lists aren't set up yet. They are added automatically when the planner starts.</p>;
  if (!templates.length) return <p style={{ margin: 0 }}>There are no forms yet. <a href="#/settings/forms">Add the starter forms or build your own in Settings › Forms.</a></p>;
  return (
    <>
      <div className="cf-grid">
        <label className="field"><span>Form</span>
          <select className="input" value={tpl} onChange={(e) => setTpl(e.target.value)}><option value="">Choose a form…</option>{templates.map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}</select></label>
        <label className="field"><span>Title (optional)</span><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t?.name || "e.g. Information for 2026 accounts"} /></label>
        <label className="field"><span>Due (optional)</span><input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
      </div>
      {t && <p className="muted" style={{ margin: 0 }}>{plural(plan.requests.length, "request")} will be made{plan.already.length ? `; ${plural(plan.already.length, "client")} already ha${plan.already.length === 1 ? "s" : "ve"} this form waiting for answers` : ""}.</p>}
      {error && <p className="error-text" role="alert" style={{ margin: 0 }}>{error}</p>}
      <div><button type="button" className="btn primary" disabled={busy || !plan.requests.length} onClick={() => void make()}>{busy ? "Working…" : `Send ${plural(plan.requests.length, "form")}`}</button></div>
    </>
  );
}
