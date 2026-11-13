// Emails to the client when a stage is finished: the offer that appears in the job panel, and where each stage's email is switched on and worded.
import { useMemo, useState } from "react";
import { bulkValues, emailLog, planEmails } from "../lib/bulk";
import { brandOf, readBranding } from "../lib/docBranding";
import { Row } from "../lib/schema";
import { todayIso } from "../lib/domain";
import { newKey } from "../lib/planning";
import { STAGE_MAIL_KEY, StageRule, readRules, ruleFor, stageEmail, withRule } from "../lib/stageMail";
import { mailAllowed, outlookDraft, useCommsPrefs } from "./commsKit";
import { readSetting, useData } from "./data";

export const useStageRules = (): StageRule[] => {
  const { data } = useData();
  return useMemo(() => readRules(readSetting<unknown>(data.settings, STAGE_MAIL_KEY)), [data.settings]);
};

/** "Stage finished: email the client?" with the wording to check. Makes an Outlook draft, never sends. */
export function StageMailOffer({ job, rule, stageName, onClose }: { job: Row; rule: StageRule; stageName: string; onClose: () => void }) {
  const { data, create, store } = useData();
  const prefs = useCommsPrefs();
  const client = data.clients.find((c) => c.Key === job.ClientKey);
  const branding = useMemo(() => brandOf(readBranding(data.settings)), [data.settings]);
  const svc = String(data.services.find((s) => s.Key === job.ServiceKey)?.Title || job.Title || "");
  const mail = useMemo(() => (client ? stageEmail(rule, { ...bulkValues(client as never, branding, todayIso()), "job.type": svc }, stageName) : null), [client, rule, branding, svc, stageName]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  if (!client || !mail) return null;
  const to = String(client.Email || "").trim();
  const unfilled = [...new Set([...`${mail.subject}\n${mail.body}`.matchAll(/\{\{\s*[a-z0-9_.]+\s*\}\}/gi)].map((m) => m[0]))];
  const make = async () => {
    setBusy(true); setErr("");
    try {
      const msg = await outlookDraft(store.graph, { to, subject: mail.subject, body: mail.body, signature: prefs.emailSignature });
      const d = planEmails([client as never], mail.subject, mail.body, branding, todayIso(), []).drafts[0];
      try { if (d) await create("Communications", { ...emailLog({ ...d, subject: mail.subject, body: mail.body }, newKey("M"), msg.webLink || "", new Date().toISOString()), JobKey: String(job.Key), Brief: `Stage finished: ${stageName}` }); } catch { /* the draft exists; the log entry is a nicety */ }
      setNote("Saved to your Outlook drafts. Check it there before sending.");
    } catch {
      setErr("Couldn't make the draft. Check Outlook has been allowed, then try again.");
    } finally { setBusy(false); }
  };
  return (
    <section className="card pad stack" role="group" aria-label="Email the client" style={{ gap: 8, borderColor: "var(--blue-ink, #2563eb)" }}>
      <strong>"{stageName}" is done. Email {String(client.Title)}?</strong>
      <div className="import-list" style={{ whiteSpace: "pre-wrap", fontSize: 13 }}><div><b>To:</b> {to || "no email address on the client"}</div><div><b>Subject:</b> {mail.subject}</div><br />{mail.body}</div>
      {unfilled.length > 0 && <p className="import-list warn" role="status" style={{ margin: 0 }}>Not filled in yet: {unfilled.join(", ")}. Fix it in the draft before sending, or set the practice details under Settings.</p>}
      {!mailAllowed() && <p className="import-list warn" style={{ margin: 0 }}>Outlook drafts need permission to your mailbox. Allow it under Settings › Email first.</p>}
      {note && <p role="status" style={{ margin: 0 }}>{note}</p>}
      {err && <p className="error-text" role="alert" style={{ margin: 0 }}>{err}</p>}
      <div className="row-wrap" style={{ gap: 8 }}>
        {!note && <button type="button" className="btn primary small" disabled={busy || !to || !mailAllowed()} onClick={() => void make()}>{busy ? "Working…" : "Create Outlook draft"}</button>}
        <button type="button" className="btn small" onClick={onClose}>{note ? "Done" : "Not now"}</button>
      </div>
    </section>
  );
}

/** Switch each stage's email on and word it. Applies to every job of this type of work. */
export function StageMailSettings({ job, stages }: { job: Row; stages: Row[] }) {
  const { saveSetting } = useData();
  const rules = useStageRules();
  const [edit, setEdit] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const service = String(job.ServiceKey || "");
  const on = stages.filter((s) => ruleFor(rules, service, Number(s.StageNo))?.enabled).length;
  const save = async (next: StageRule[]) => { setBusy(true); setErr(""); try { await saveSetting(STAGE_MAIL_KEY, next); } catch { setErr("That didn't save. Try again."); } finally { setBusy(false); } };
  if (!stages.length) return null;
  return (
    <details>
      <summary className="muted" style={{ cursor: "pointer", fontSize: 13 }}>Emails to the client when a stage is done{on ? ` · ${on} on` : ""}</summary>
      <div className="stack" style={{ gap: 6, marginTop: 6 }}>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>For every job of this type. Finishing a stage offers the email as an Outlook draft for you to check; nothing is sent automatically. Use {"{{client.greeting}}, {{client.name}}, {{job.type}}, {{stage}}, {{practice.name}}"}.</p>
        {stages.map((s) => {
          const no = Number(s.StageNo), r = ruleFor(rules, service, no);
          return (
            <div key={String(s.Key)} className="stack" style={{ gap: 4 }}>
              <div className="row-wrap" style={{ justifyContent: "space-between" }}>
                <label className="row-wrap"><input type="checkbox" disabled={busy} checked={!!r?.enabled} onChange={(e) => void save(withRule(rules, service, no, { enabled: e.target.checked }))} /> {no}. {String(s.Title)}</label>
                {r?.enabled && <button type="button" className="linkbtn" onClick={() => setEdit(edit === no ? 0 : no)}>{edit === no ? "Close" : "Edit wording"}</button>}
              </div>
              {r?.enabled && edit === no && <Wording rule={r} busy={busy} onSave={(p) => save(withRule(rules, service, no, p))} />}
            </div>
          );
        })}
        {err && <p className="error-text" role="alert" style={{ margin: 0 }}>{err}</p>}
      </div>
    </details>
  );
}

function Wording({ rule, busy, onSave }: { rule: StageRule; busy: boolean; onSave: (p: Partial<StageRule>) => Promise<void> }) {
  const [subject, setSubject] = useState(rule.subject);
  const [body, setBody] = useState(rule.body);
  const dirty = subject !== rule.subject || body !== rule.body;
  return (
    <div className="stack" style={{ gap: 6, paddingLeft: 22 }}>
      <input className="input" aria-label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
      <textarea className="input" aria-label="Message" rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
      <div><button type="button" className="btn small" disabled={busy || !dirty || !subject.trim() || !body.trim()} onClick={() => void onSave({ subject: subject.trim(), body })}>Save wording</button></div>
    </div>
  );
}
