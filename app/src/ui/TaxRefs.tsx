// The client's tax references: grouped by tax, sensitive codes hidden until shown, copy buttons, a
// format check while editing, and the HMRC agent authorisation for each tax. See lib/taxRefs.ts.
import { useState } from "react";
import { Client, fmtDate, todayIso } from "../lib/domain";
import { newKey } from "../lib/planning";
import { AUTH_LABEL, AUTH_STATE_CHIP, AUTH_STATE_LABEL, RefGroup, allFields, authRow, authState, check, groupsFor, mask } from "../lib/taxRefs";
import { CopyButton } from "./bits";
import { useData } from "./data";

export function TaxRefsCard({ client }: { client: Client }) {
  const { data, update } = useData();
  const groups = groupsFor(client);
  const fields = allFields(client);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const today = todayIso();
  const all = Object.keys(shown).length > 0 && fields.every(([k]) => shown[k] || !client[k]);

  const start = () => { setDraft(Object.fromEntries(fields.map(([k]) => [k, String(client[k] ?? "")]))); setError(""); setEditing(true); };
  const save = async () => {
    const patch: Record<string, string> = {};
    for (const [k] of fields) { const v = (draft[k] || "").trim(); if (v !== String(client[k] ?? "")) patch[k] = v; }
    if (!Object.keys(patch).length) return setEditing(false);
    setBusy(true);
    try { await update("Clients", client, patch); setEditing(false); } catch { setError("Couldn't save. Your changes are still here; try again."); } finally { setBusy(false); }
  };
  const toggleAll = () => setShown(all ? {} : Object.fromEntries(fields.map(([k]) => [k, true])));

  return (
    <section className="card pad stack" aria-labelledby="taxrefs-h">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <h2 id="taxrefs-h">Tax references</h2>
        <span className="row-wrap" style={{ gap: 10 }}>
          {!editing && <button type="button" className="linkbtn" onClick={toggleAll}>{all ? "Hide all codes" : "Show all codes"}</button>}
          {!editing && <button type="button" className="linkbtn" onClick={start}>Edit</button>}
        </span>
      </div>
      {editing ? (
        <>
          {groups.map((g) => (
            <fieldset key={g.key} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
              <legend style={{ fontWeight: 600, fontSize: 13 }}>{g.label}</legend>
              <div className="form" style={{ gridTemplateColumns: "1fr" }}>
                {g.fields.map((f) => { const bad = check(f.key, draft[f.key]); return (
                  <label key={f.key}>{f.label}
                    <input className="input" value={draft[f.key] || ""} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} aria-invalid={bad ? true : undefined} />
                    {bad && <span className="muted" style={{ fontSize: 12, color: "var(--amber-ink)" }}>{bad} You can still save it.</span>}
                  </label>
                ); })}
              </div>
            </fieldset>
          ))}
          {error && <p className="error-text" role="alert">{error}</p>}
          <div className="form-actions"><button type="button" className="btn" onClick={() => setEditing(false)} disabled={busy}>Cancel</button><button type="button" className="btn primary" onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : "Save"}</button></div>
        </>
      ) : groups.map((g) => (
        <div key={g.key} className="stack" style={{ gap: 4, borderTop: "1px solid var(--line)", paddingTop: 8 }}>
          <div className="row-wrap" style={{ justifyContent: "space-between" }}>
            <strong style={{ fontSize: 13 }}>{g.label}</strong>
            {g.auth && <AuthChip client={client} group={g} today={today} rows={data.authorisations} />}
          </div>
          {g.fields.map((f) => {
            const v = String(client[f.key] ?? "").trim();
            const bad = check(f.key, v);
            const open = !f.sensitive || shown[f.key];
            return (
              <div className="kv" key={f.key}>
                <span>{f.label}</span>
                <span className="copy-val">
                  <span className="mono">{v ? (open ? v : mask(v)) : <span style={{ color: "var(--muted)", fontFamily: "var(--sans)" }}>—</span>}</span>
                  {v && f.sensitive && <button type="button" className="linkbtn" aria-pressed={!!shown[f.key]} aria-label={`${shown[f.key] ? "Hide" : "Show"} ${f.label}`} onClick={() => setShown({ ...shown, [f.key]: !shown[f.key] })}>{shown[f.key] ? "Hide" : "Show"}</button>}
                  {v ? <CopyButton value={v} label={f.label.toLowerCase()} /> : null}
                  {bad && <span title={bad} aria-label={bad} style={{ color: "var(--amber-ink)", cursor: "help" }}>⚠</span>}
                </span>
              </div>
            );
          })}
          {g.note && <span className="muted" style={{ fontSize: 12 }}>{g.note}</span>}
        </div>
      ))}
    </section>
  );
}

function AuthChip({ client, group, today, rows }: { client: Client; group: RefGroup; today: string; rows: ReturnType<typeof useData>["data"]["authorisations"] }) {
  const { create, update, store } = useData();
  const row = authRow(rows, client.Key, group.auth!);
  const st = authState(row, today);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(String(row?.Status || ""));
  const [expiry, setExpiry] = useState(String(row?.Expiry || "").slice(0, 10));
  const [sent, setSent] = useState(String(row?.LinkSent || "").slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  if (!store.hasList("Authorisations")) return null;
  const save = async () => {
    setBusy(true); setErr("");
    try {
      const f = { Status: status, Expiry: expiry, LinkSent: sent };
      if (row) await update("Authorisations", row, f);
      else await create("Authorisations", { Key: newKey("AU"), ClientKey: client.Key, Service: group.auth!, ...f });
      setOpen(false);
    } catch { setErr("Couldn't save that."); } finally { setBusy(false); }
  };
  return (
    <span className="row-wrap" style={{ gap: 6 }}>
      <span className={`chip ${AUTH_STATE_CHIP[st]}`} title={`HMRC agent authorisation for ${AUTH_LABEL[group.auth!]}`}>{AUTH_STATE_LABEL[st]}{row?.Expiry && st !== "none" ? ` · to ${fmtDate(String(row.Expiry).slice(0, 10))}` : ""}</span>
      <button type="button" className="linkbtn" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Close" : "Update"}</button>
      {open && (
        <span className="row-wrap" style={{ gap: 6, flexBasis: "100%", justifyContent: "flex-end" }}>
          <select className="input" style={{ width: "auto" }} aria-label={`${AUTH_LABEL[group.auth!]} authorisation status`} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Not authorised</option><option value="requested">Link sent</option><option value="authorised">Authorised</option><option value="refused">Refused</option></select>
          <label className="muted" style={{ fontSize: 12 }}>Link sent <input className="input" type="date" value={sent} onChange={(e) => setSent(e.target.value)} /></label>
          <label className="muted" style={{ fontSize: 12 }}>Expires <input className="input" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} /></label>
          <button type="button" className="btn small primary" disabled={busy} onClick={() => void save()}>Save</button>
          {err && <span className="error-text">{err}</span>}
        </span>
      )}
    </span>
  );
}
