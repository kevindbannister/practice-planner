import { useEffect, useState } from "react";
import { ApiError, ChangeRequest, Editable } from "./api";
import type { Ctx } from "./PortalApp";

const STATUS: Record<string, [string, string]> = {
  pending: ["Waiting for us", "warn"], clarification: ["We've asked you a question", "attn"], approved: ["Approved", "ok"], "partly approved": ["Partly approved", "ok"], rejected: ["Not approved", "bad"], withdrawn: ["Withdrawn", "muted"],
};
export const statusOf = (r: ChangeRequest): [string, string] => (r.status === "decided" ? STATUS[r.outcome] || ["Done", "muted"] : STATUS[r.status]);
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** Ask for changes, and follow what happened to earlier requests. Only shown to people who may ask. */
export function Changes({ ctx, details, editable, onChanged }: { ctx: Ctx; details: Record<string, string>; editable: Editable[]; onChanged: () => void }) {
  const { api, biz } = ctx;
  const [list, setList] = useState<ChangeRequest[] | null>(null);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState("");
  const load = () => api.changes(biz.clientKey).then((r) => setList(r.requests)).catch((e) => setErr(e instanceof ApiError ? e.message : "Couldn't load your requests."));
  useEffect(() => { void load(); }, [biz.clientKey]);
  return (
    <section className="px-card px-stack" aria-labelledby="ch-h" style={{ gap: 12 }}>
      <div className="px-row"><h2 id="ch-h" style={{ margin: 0 }}>Changes to these details</h2>{!open && <button type="button" className="px-btn small" onClick={() => setOpen(true)}>Ask for a change</button>}</div>
      <p className="px-muted" style={{ margin: 0 }}>If something here is out of date, tell us what it should say. We check every change before we update our records.</p>
      {open && <ChangeForm ctx={ctx} details={details} editable={editable} onDone={() => { setOpen(false); void load(); onChanged(); }} onCancel={() => setOpen(false)} />}
      {err && <p className="px-error" role="alert">{err}</p>}
      {list && list.length > 0 && <div className="px-stack" style={{ gap: 10 }}>{list.map((r) => <Request key={r.id} ctx={ctx} r={r} onChanged={() => { void load(); onChanged(); }} />)}</div>}
    </section>
  );
}

function ChangeForm({ ctx, details, editable, onDone, onCancel }: { ctx: Ctx; details: Record<string, string>; editable: Editable[]; onDone: () => void; onCancel: () => void }) {
  const [vals, setVals] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const current = (f: Editable) => (f.noted ? "" : details[f.key] ?? "");
  const value = (f: Editable) => (f.key in vals ? vals[f.key] : current(f));
  const changed = editable.filter((f) => f.key in vals && vals[f.key].trim() !== current(f).trim() && (f.noted ? vals[f.key].trim() : true));
  const statutory = [...new Set(changed.filter((f) => f.statutory).map((f) => f.statutory))];
  const submit = async () => {
    setBusy(true); setErr("");
    try { await ctx.api.propose(ctx.biz.clientKey, changed.map((f) => ({ key: f.key, value: vals[f.key] })), note); onDone(); } catch (e) { setErr(e instanceof ApiError ? e.message : "Couldn't send that."); setBusy(false); }
  };
  return (
    <form className="px-form" onSubmit={(e) => { e.preventDefault(); void submit(); }} aria-label="Ask for a change">
      <p className="px-muted" style={{ margin: 0 }}>Change only what's wrong; leave the rest as it is.</p>
      {editable.map((f) => (
        <label key={f.key}>{f.label}{f.noted ? <span className="px-fine"> (describe the change)</span> : null}
          {f.multiline ? <textarea rows={f.noted ? 3 : 3} maxLength={f.max} value={value(f)} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} />
            : <input maxLength={f.max} value={value(f)} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} />}
        </label>
      ))}
      <label>Anything we should know? <span className="px-fine">(optional)</span><textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      {statutory.length > 0 && <p className="px-notice" role="note">Changes to {changed.filter((f) => f.statutory).map((f) => f.label.toLowerCase()).join(" and ")} also have to be filed with {statutory.join(" and ")}. We'll look after that with you. Approving the change on our side doesn't update {statutory.join(" or ")} by itself.</p>}
      {err && <p className="px-error" role="alert">{err}</p>}
      <div className="px-actions"><button type="submit" className="px-btn" disabled={busy || !changed.length}>{busy ? "Sending…" : `Send ${changed.length || ""} change${changed.length === 1 ? "" : "s"}`}</button><button type="button" className="px-btn secondary" onClick={onCancel}>Cancel</button></div>
    </form>
  );
}

function Request({ ctx, r, onChanged }: { ctx: Ctx; r: ChangeRequest; onChanged: () => void }) {
  const [label, tone] = statusOf(r);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async (work: () => Promise<unknown>) => { setBusy(true); setErr(""); try { await work(); setText(""); onChanged(); } catch (e) { setErr(e instanceof ApiError ? e.message : "That didn't work."); } finally { setBusy(false); } };
  return (
    <article className="px-req" aria-label={`Request of ${day(r.createdAt)}`}>
      <div className="px-row"><strong>Asked {day(r.createdAt)}</strong><span className={`px-tag ${tone}`}>{label}</span></div>
      <table className="px-table"><thead><tr><th scope="col">What</th><th scope="col">Was</th><th scope="col">You asked for</th><th scope="col">Result</th></tr></thead>
        <tbody>{r.items.map((i) => (
          <tr key={i.key}><td>{i.label}</td><td>{i.old || "—"}</td><td>{i.new}</td><td>{i.decision === "approved" ? "Approved" : i.decision === "rejected" ? "Not approved" : i.decision === "withdrawn" ? "Withdrawn" : "Waiting"}{i.note ? ` — ${i.note}` : ""}</td></tr>
        ))}</tbody></table>
      {r.thread.map((m, n) => <p key={n} className={`px-msg ${m.from}`}><strong>{m.from === "staff" ? ctx.cfg.practiceName : "You"}:</strong> {m.text}</p>)}
      {r.status === "clarification" && (
        <div className="px-form"><label>Your answer<textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} /></label>
          <div className="px-actions"><button type="button" className="px-btn small" disabled={busy || !text.trim()} onClick={() => go(() => ctx.api.reply(r.clientKey, r.id, text))}>Send answer</button></div></div>
      )}
      {r.status !== "decided" && <div><button type="button" className="px-link" disabled={busy} onClick={() => go(() => ctx.api.withdraw(r.clientKey, r.id))}>Withdraw this request</button></div>}
      {r.status === "decided" && r.items.some((i) => i.decision === "approved" && i.statutory) && <p className="px-fine">Approved changes to {[...new Set(r.items.filter((i) => i.decision === "approved" && i.statutory).map((i) => i.label.toLowerCase()))].join(" and ")} update our records only. They also need filing with {[...new Set(r.items.filter((i) => i.decision === "approved" && i.statutory).map((i) => i.statutory))].join(" and ")}, and we'll be in touch about that.</p>}
      {err && <p className="px-error" role="alert">{err}</p>}
    </article>
  );
}
