// The client's Signing requests tab: every signature or approval asked of this client in one table.
// Portal e-signatures, engagement letters and documents sent for approval; see lib/signingView.ts.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Client, fmtDate, todayIso } from "../lib/domain";
import { StaffDoc, StaffSigning } from "../lib/portalAdmin";
import { KIND_LABEL, STATE_CHIP, STATE_LABEL, SignRow, SignState, SignKind, counts, filterRows, signingRows, waitingDays } from "../lib/signingView";
import { useData } from "./data";
import { href } from "./bits";
import { say, usePortal } from "./portalKit";

const STATES: SignState[] = ["waiting", "signed", "declined", "expired", "cancelled", "unsigned"];
const when = (iso: string) => {
  if (!iso) return "";
  const d = fmtDate(iso.slice(0, 10), { year: true });
  return iso.length > 10 ? `${d}, ${new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : d;
};

export function SigningRequests({ client }: { client: Client }) {
  const { data } = useData();
  const portal = usePortal();
  const today = todayIso();
  const [signings, setSignings] = useState<StaffSigning[]>([]);
  const [docs, setDocs] = useState<StaffDoc[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [state, setState] = useState<SignState | "all">("all");
  const [kind, setKind] = useState<SignKind | "all">("all");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const configured = !!portal.status?.configured;

  const load = useCallback(async () => {
    if (!configured) { setLoaded(false); return; }
    try {
      const [s, d] = await Promise.all([portal.run((a) => a.signing(client.Key)), portal.run((a) => a.documents(client.Key))]);
      setSignings(s); setDocs(d.documents); setLoaded(true); setErr("");
    } catch (e) { setErr(say(e)); setLoaded(false); }
  }, [client.Key, configured]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(() => signingRows({ signings, docs, engagements: data.engagements, clientKey: client.Key, portalLoaded: loaded }), [signings, docs, data.engagements, client.Key, loaded]);
  const c = useMemo(() => counts(rows), [rows]);
  const shown = useMemo(() => filterRows(rows, { state, kind, q }), [rows, state, kind, q]);

  const act = async (r: SignRow, work: () => Promise<string | void>) => {
    setBusy(r.id); setErr(""); setNote("");
    try { const m = await work(); if (m) setNote(m); await load(); } catch (e) { setErr(say(e)); } finally { setBusy(""); }
  };
  const remind = (r: SignRow) => act(r, async () => { const x = await portal.run((a) => a.remindSigning(r.portalId!)); return `Reminder sent to ${x.request.reminded} ${x.request.reminded === 1 ? "person" : "people"}.`; });
  const cancel = (r: SignRow) => { if (window.confirm("Cancel this signing request? The signatories will no longer be able to sign it.")) void act(r, async () => { await portal.run((a) => a.cancelSigning(r.portalId!)); return "Cancelled."; }); };

  return (
    <div className="stack">
      <div className="tl-summary" role="list" aria-label="Signing summary">
        <div role="listitem" className="tl-sum"><span className="tl-sum-label">Waiting on {client.Title.split(" ")[0]}</span><strong className={c.waiting ? "warn" : ""}>{c.waiting}</strong><span className="muted tl-sum-sub">{rows.filter((r) => r.state === "waiting").map((r) => `${r.title} (${waitingDays(r, today)}d)`)[0] || "Nothing outstanding"}</span></div>
        <div role="listitem" className="tl-sum"><span className="tl-sum-label">Signed</span><strong>{c.signed}</strong><span className="muted tl-sum-sub">{rows.find((r) => r.state === "signed")?.title || "None yet"}</span></div>
        <div role="listitem" className="tl-sum"><span className="tl-sum-label">Declined or expired</span><strong className={c.declined + c.expired ? "warn" : ""}>{c.declined + c.expired}</strong><span className="muted tl-sum-sub">{rows.find((r) => r.state === "declined" || r.state === "expired")?.title || "None"}</span></div>
      </div>

      <div className="row-wrap tl-bar">
        <div className="row-wrap" role="group" aria-label="Status">
          <button type="button" className={`chip-btn${state === "all" ? " on" : ""}`} aria-pressed={state === "all"} onClick={() => setState("all")}>All <span className="muted">{rows.length}</span></button>
          {STATES.filter((s) => c[s] > 0 || s === state).map((s) => <button key={s} type="button" className={`chip-btn${state === s ? " on" : ""}`} aria-pressed={state === s} onClick={() => setState(s)}>{STATE_LABEL[s]} <span className="muted">{c[s]}</span></button>)}
        </div>
        <span style={{ flex: 1 }} />
        <a className="btn primary" href={href("clients", client.Key, "portal")}>Ask for signatures</a>
      </div>
      <div className="row-wrap tl-filters">
        <input className="input search" type="search" placeholder="Search by document, signee or creator" aria-label="Search signing requests" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" style={{ width: "auto" }} aria-label="Type" value={kind} onChange={(e) => setKind(e.target.value as SignKind | "all")}>
          <option value="all">All types</option>
          {(Object.keys(KIND_LABEL) as SignKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
      </div>

      {!configured && portal.status && <p className="muted" style={{ margin: 0 }}>The client portal isn't set up yet, so only engagement letters are listed here. Portal signatures and document approvals appear once it is.</p>}
      {err && <p className="import-list warn" role="alert">{err}</p>}
      {note && <p role="status" style={{ margin: 0 }}>{note}</p>}

      {shown.length ? (
        <div className="table-wrap">
          <table className="grid" style={{ minWidth: 760 }}>
            <thead><tr><th>Document</th><th>Created</th><th>Signee</th><th>Status</th><th>Signed or declined</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.title}</strong><div className="muted" style={{ fontSize: 12 }}>{KIND_LABEL[r.kind]}{r.ref ? ` · ${r.ref}` : ""}</div></td>
                  <td style={{ whiteSpace: "nowrap" }}>{when(r.createdAt)}<div className="muted" style={{ fontSize: 12 }}>{r.creator}</div></td>
                  <td>{r.signees.length ? r.signees.map((x) => <div key={x.name}>{x.name}</div>) : <span className="muted">{r.kind === "approval" ? client.Title : "—"}</span>}</td>
                  <td><span className={`chip ${STATE_CHIP[r.state]}`}>{STATE_LABEL[r.state]}</span><div className="muted" style={{ fontSize: 12 }}>{r.text}{r.state === "waiting" && waitingDays(r, today) ? ` · ${waitingDays(r, today)} days` : ""}</div></td>
                  <td style={{ whiteSpace: "nowrap" }}>{when(r.doneAt)}</td>
                  <td>
                    <span className="row-wrap">
                      {r.href && <a className="linkbtn" href={r.href}>Open</a>}
                      {r.chasable && <button type="button" className="btn small" disabled={busy === r.id} onClick={() => void remind(r)}>Remind</button>}
                      {r.chasable && <button type="button" className="linkbtn danger-link" disabled={busy === r.id} onClick={() => cancel(r)}>Cancel</button>}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <div className="card empty">{rows.length ? "Nothing matches these filters." : `Nothing has been sent to ${client.Title} to sign or approve yet.`}</div>}
    </div>
  );
}
