// Small additions to a client's Overview: dated memos, and the compliance lines for the previous
// accountant and signed engagement letters.
import { useState } from "react";
import { latest, STATUS_LABEL } from "../lib/clearance";
import { Client, fmtDate, todayIso } from "../lib/domain";
import { newKey } from "../lib/planning";
import { useData } from "./data";
import { href } from "./bits";

export function ComplianceExtras({ client }: { client: Client }) {
  const { data } = useData();
  const clr = latest(data.clearances, client.Key, todayIso());
  const eng = data.engagements.filter((e) => e.ClientKey === client.Key);
  const signed = eng.filter((e) => e.Status === "signed").sort((a, b) => String(b.SignedAt).localeCompare(String(a.SignedAt)));
  const out = eng.filter((e) => e.Status === "out");
  return (
    <>
      {clr.status !== "none" && <div className="kv"><span>Previous accountant</span><span><a href={href("clients", client.Key, "clearance")}>{clr.status === "received" ? "Cleared" : STATUS_LABEL[clr.status]}</a></span></div>}
      <div className="kv"><span>Signed letters</span><span>{signed.length ? `${signed.length}, latest ${fmtDate(String(signed[0].SignedAt).slice(0, 10))}` : "None"}</span></div>
      {out.length > 0 && <div className="kv"><span>Waiting to sign</span><span style={{ color: "var(--amber-ink)", fontWeight: 600 }}><a href={href("clients", client.Key, "signing")}>{out.length} letter{out.length === 1 ? "" : "s"}</a></span></div>}
    </>
  );
}

export function MemosCard({ client }: { client: Client }) {
  const { data, user, create, store } = useData();
  const memos = data.activities.filter((a) => a.ClientKey === client.Key && a.Type === "note" && a.Source === "manual").sort((a, b) => String(b.At).localeCompare(String(a.At)));
  const [text, setText] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [all, setAll] = useState(false);
  const save = async () => {
    if (!text.trim()) return;
    setBusy(true); setErr("");
    try {
      const key = newKey("A");
      const first = text.trim().split("\n")[0];
      await create("Activities", { Key: key, ClientKey: client.Key, Type: "note", Title: first.length > 90 ? `${first.slice(0, 89)}…` : first, Summary: text.trim().includes("\n") ? text.trim().split("\n").slice(1).join(" ").trim() : "", At: new Date().toISOString(), Actor: user || "", Source: "manual", SourceKey: key, EventKey: key, Status: "", Visibility: "normal", FollowUp: "", Created: new Date().toISOString() });
      setText(""); setAdding(false);
    } catch { setErr("Couldn't save that. Try again."); } finally { setBusy(false); }
  };
  const shown = all ? memos : memos.slice(0, 3);
  return (
    <section className="card pad stack" aria-labelledby="memos-h">
      <div className="card-title-row"><h2 id="memos-h" style={{ margin: 0 }}>Memos</h2>{!adding && store.hasList("Activities") && <button type="button" className="linkbtn" onClick={() => setAdding(true)}>Add a memo</button>}</div>
      {adding && (
        <div className="stack" style={{ gap: 6 }}>
          <textarea className="input" rows={3} aria-label="Memo" value={text} onChange={(e) => setText(e.target.value)} placeholder="Something to remember about this client" />
          {err && <span className="error-text" role="alert">{err}</span>}
          <div className="form-actions"><button type="button" className="btn small" onClick={() => { setAdding(false); setText(""); }}>Cancel</button><button type="button" className="btn small primary" disabled={busy || !text.trim()} onClick={() => void save()}>Save memo</button></div>
        </div>
      )}
      {shown.length ? shown.map((m) => (
        <div key={String(m.Key)} style={{ borderTop: "1px solid var(--line)", paddingTop: 6 }}>
          <div>{String(m.Title)}</div>
          {m.Summary ? <div className="muted" style={{ fontSize: 13 }}>{String(m.Summary)}</div> : null}
          <div className="muted" style={{ fontSize: 12 }}>{fmtDate(String(m.At).slice(0, 10))}{m.Actor ? ` · ${String(m.Actor)}` : ""}</div>
        </div>
      )) : !adding && <p className="muted" style={{ margin: 0 }}>No memos yet.</p>}
      {memos.length > 3 && <div><button type="button" className="linkbtn" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${memos.length}`}</button></div>}
    </section>
  );
}
