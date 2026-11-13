// Settings > Your firm > Morning email: switch the daily digest on, choose the days, and check what each person would get.
import { useState } from "react";
import { getAccessToken } from "../lib/auth";
import { readConfig } from "../lib/checklist";
import { DigestPreview, previewDigest, testDigest } from "../lib/serverCalls";
import { readSetting, useData } from "./data";

type DigestSettingsValue = { enabled?: boolean; days?: "weekdays" | "daily"; fallbackTo?: string; sendEmpty?: boolean };
type LastRun = { date?: string; at?: string; sent?: number; empty?: number; errors?: string[] };

export function DigestSettings() {
  const { data, saveSetting } = useData();
  const v = readSetting<DigestSettingsValue>(data.settings, "digest.settings") || {};
  const last = readSetting<LastRun>(data.settings, "digest.lastRun");
  const staff = readConfig(data.settings).staff;
  const withEmail = staff.filter((s) => s.email);
  const [preview, setPreview] = useState<DigestPreview[] | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const save = (p: Partial<DigestSettingsValue>) => void saveSetting("digest.settings", { ...v, ...p }).catch(() => setMsg("Couldn't save. Try again."));
  const ask = async (f: () => Promise<void>) => { setBusy(true); setMsg(""); try { await f(); } finally { setBusy(false); } };
  return (
    <section className="card pad stack" aria-label="Morning email">
      <h2 className="sec-h">Morning email</h2>
      <p className="muted tip" style={{ margin: 0 }}>Each morning the server emails each person what is overdue or due in the next 7 days on their clients' work (clients where they are the manager or partner). Managers and partners also get AML reviews, assessments in progress and sanctions re-screens. It is sent from the practice mailbox the client portal uses, and only when there is something to say.</p>
      <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={!!v.enabled} onChange={(e) => save({ enabled: e.target.checked })} /> Send the morning email</label>
      <label className="row" style={{ gap: 8 }}>Days
        <select className="input" style={{ maxWidth: 220 }} value={v.days || "weekdays"} onChange={(e) => save({ days: e.target.value as "weekdays" | "daily" })}><option value="weekdays">Monday to Friday</option><option value="daily">Every day</option></select>
      </label>
      <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={!!v.sendEmpty} onChange={(e) => save({ sendEmpty: e.target.checked })} /> Also send when there is nothing due</label>
      <div className="muted" style={{ fontSize: 13 }}>
        {withEmail.length ? `Goes to: ${withEmail.map((s) => s.name).join(", ")}.` : staff.length ? "Nobody in the staff roles list has an email address yet." : "There is no staff roles list, so it goes to one address with everything in it."}
        {" "}Email addresses are in Settings &gt; Checks, in the staff roles list.
      </div>
      {!staff.length && <label className="field"><span>Send to</span><input className="input" type="email" placeholder="you@practice.co.uk" defaultValue={v.fallbackTo || ""} onBlur={(e) => e.target.value !== (v.fallbackTo || "") && save({ fallbackTo: e.target.value.trim() })} /></label>}
      <div className="muted" style={{ fontSize: 13 }}>{last?.at ? `Last sent ${new Date(last.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}: ${last.sent || 0} email${last.sent === 1 ? "" : "s"}${last.empty ? `, ${last.empty} with nothing due (not sent)` : ""}${last.errors?.length ? `. Problems: ${last.errors.join("; ")}` : ""}.` : "Not sent yet. It needs DIGEST_KEY in Azure and the PORTAL_BASE_URL and DIGEST_KEY secrets on GitHub (see the Morning email workflow)."}</div>
      <div className="row-wrap">
        <button type="button" className="btn small" disabled={busy} onClick={() => void ask(async () => { const r = await previewDigest(getAccessToken); if (r.ok) setPreview(r.data.digests); else setMsg(r.message); })}>Preview what each person would get</button>
        <button type="button" className="btn small" disabled={busy} onClick={() => void ask(async () => { const r = await testDigest(getAccessToken); setMsg(r.ok ? `Sent your own digest to ${r.data.to}.` : r.message); })}>Send me a test</button>
      </div>
      {msg && <p className="muted" role="status" style={{ margin: 0 }}>{msg}</p>}
      {preview && (preview.length ? preview.map((g) => (
        <details key={g.to}><summary>{g.name || g.to}: {g.count} item{g.count === 1 ? "" : "s"}</summary>
          {g.sections.map((s) => <div key={s.title} style={{ marginTop: 6 }}><strong>{s.title}</strong><ul style={{ margin: "2px 0 0", paddingLeft: 18 }}>{s.items.map((i) => <li key={i}>{i}</li>)}</ul></div>)}
        </details>
      )) : <p className="muted" style={{ margin: 0 }}>Nobody would get one yet: add email addresses to the staff roles list.</p>)}
    </section>
  );
}
