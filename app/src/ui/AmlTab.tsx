// A client's AML: the manual risk assessment (risk, beneficial owners, checks, evidence, approval and
// review date) and, separately, what Xama holds. The Overview card summarises it. See lib/amlAssessment.ts.
import { useEffect, useMemo, useRef, useState } from "react";
import { Client, amlLabel, fmtDate, todayIso } from "../lib/domain";
import { Evidence, POSITION_CHIP, POSITION_LABEL, asStatus, approveAssessment, declineAssessment, position, readAssessment, saveAssessment, startAssessment, withdrawAssessment } from "../lib/amlAssessment";
import { CHECK_KINDS, Check, Owner, Risk, amlProblems, onboardingCan } from "../lib/onboarding";
import { clientFolder } from "../lib/comms";
import { clientTypeFor } from "../lib/proposals";
import { readOnboardingSettings } from "../lib/onboarding";
import { Row } from "../lib/schema";
import { useData } from "./data";
import { useSales } from "./salesKit";
import { XamaClientPanel } from "./XamaClientPanel";
import { href } from "./bits";

const FOLDER = "Practice Planner AML";
const RISK: Record<string, string> = { low: "Low", medium: "Medium", high: "High", "": "Not assessed" };

export function AmlTab({ client }: { client: Client }) {
  const { data } = useData();
  const s = useSales();
  const today = todayIso();
  const settings = useMemo(() => readOnboardingSettings(data.settings), [data.settings]);
  const pos = position(client as unknown as Row, data.amlAssessments, data.onboardings, today);
  const mine = data.amlAssessments.filter((r) => r.ClientKey === client.Key).sort((a, b) => String(b.Created).localeCompare(String(a.Created)));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const canEdit = s.pcan("edit");
  const xama = amlLabel(client.XamaStatus);
  const clientRow = () => data.clients.find((c) => c.Key === client.Key) as unknown as Row;

  const go = async (w: ReturnType<typeof startAssessment>) => { setError(""); if ("error" in w) return setError(w.error); setBusy(true); try { await s.apply(w); } catch { setError("Couldn't save that. Try again."); } finally { setBusy(false); } };
  const open = pos.row;
  return (
    <div className="stack">
      <section className="card pad stack" aria-label="AML status">
        <div className="card-title-row"><h2 style={{ margin: 0, fontSize: 16 }}>Manual AML assessment</h2><span className={`chip ${POSITION_CHIP[pos.state]}`}>{POSITION_LABEL[pos.state]}</span></div>
        <div className="kv"><span>Risk rating</span><span>{RISK[pos.risk]}</span></div>
        <div className="kv"><span>Assessment done</span><span>{pos.doneOn ? `${fmtDate(pos.doneOn)}${pos.by ? ` · approved by ${pos.by}` : ""}` : "—"}</span></div>
        <div className="kv"><span>Next review</span><span style={pos.state === "overdue" || pos.state === "soon" ? { color: pos.state === "overdue" ? "var(--red-ink, #b42318)" : "var(--amber-ink)", fontWeight: 600 } : undefined}>{pos.reviewDate ? `${fmtDate(pos.reviewDate)}${pos.daysToReview !== null ? (pos.daysToReview < 0 ? ` (${-pos.daysToReview} days overdue)` : ` (in ${pos.daysToReview} days)`) : ""}` : "—"}</span></div>
        {pos.source && <div className="kv"><span>Source</span><span>{pos.source === "onboarding" ? "Approved during onboarding" : pos.source === "client record" ? "Review date on the client record only" : "Recorded here"}</span></div>}
        {error && <p className="error-text" role="alert">{error}</p>}
        {!open && canEdit && <div><button type="button" className="btn primary" disabled={busy} onClick={() => void go(startAssessment(clientRow(), data.amlAssessments, s.ctx()))}>{pos.current || pos.source === "onboarding" || pos.source === "client record" ? "Start a review" : "Start an assessment"}</button></div>}
      </section>

      {open && <Editor client={client} row={open} all={data.amlAssessments} settings={settings} independent={s.cfg.independentReview} today={today} s={s} clientRow={clientRow()} />}

      <section className="card pad stack" aria-label="Xama">
        <div className="card-title-row"><h2 style={{ margin: 0, fontSize: 16 }}>Xama</h2><span className={`chip ${xama.warn ? "amber" : "green"}`}>{xama.text}</span></div>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>Identity verification through Xama is kept separate from the manual assessment above. Either can be the record you rely on.</p>
        <XamaClientPanel client={client} />
      </section>

      {mine.some((r) => !open || r.Key !== open.Key) && (
        <section className="card pad stack" aria-label="Earlier assessments">
          <h2 style={{ margin: 0, fontSize: 16 }}>History</h2>
          {mine.filter((r) => !open || r.Key !== open.Key).map((r) => { const a = readAssessment(r); const st = asStatus(r.Status); return (
            <div key={String(r.Key)} className="row-wrap" style={{ justifyContent: "space-between" }}>
              <span>{RISK[a.risk]} risk · {a.doneOn ? `done ${fmtDate(a.doneOn)}` : `started ${fmtDate(String(r.Created).slice(0, 10))}`}{a.approvedBy ? ` · approved by ${a.approvedBy}` : ""}{a.evidence.length ? ` · ${a.evidence.length} file${a.evidence.length === 1 ? "" : "s"}` : ""}</span>
              <span className={`chip ${st === "approved" ? "green" : st === "declined" ? "red" : ""}`}>{st === "superseded" ? "Replaced by a newer review" : st === "approved" ? "Current" : st === "declined" ? "Not approved" : "In progress"}</span>
            </div>
          ); })}
          {mine.filter((r) => asStatus(r.Status) === "approved").map((r) => <WithdrawRow key={String(r.Key)} row={r} s={s} clientRow={clientRow()} onGo={go} />)}
        </section>
      )}
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>Review periods for each risk rating are set in <a href={href("settings", "onboarding")}>Settings › Onboarding</a>. {onboardingCan(s.cfg, s.me, "approve") ? "" : "Approving AML work needs a manager or partner."}</p>
    </div>
  );
}

function WithdrawRow({ row, s, clientRow, onGo }: { row: Row; s: ReturnType<typeof useSales>; clientRow: Row; onGo: (w: ReturnType<typeof startAssessment>) => Promise<void> }) {
  const [why, setWhy] = useState("");
  const [on, setOn] = useState(false);
  if (!s.pcan("approve")) return null;
  if (!on) return <div><button type="button" className="linkbtn" onClick={() => setOn(true)}>Withdraw the current approval…</button></div>;
  return (
    <div className="row-wrap">
      <input className="input" aria-label="Reason for withdrawing" placeholder="Reason" value={why} onChange={(e) => setWhy(e.target.value)} />
      <button type="button" className="btn small" onClick={() => void onGo(withdrawAssessment(row, why, clientRow, s.pcan, s.ctx()))}>Withdraw approval</button>
      <button type="button" className="linkbtn" onClick={() => setOn(false)}>Cancel</button>
    </div>
  );
}

function Editor({ client, row, all, settings, independent, today, s, clientRow }: { client: Client; row: Row; all: Row[]; settings: ReturnType<typeof readOnboardingSettings>; independent: boolean; today: string; s: ReturnType<typeof useSales>; clientRow: Row }) {
  const { store, user } = useData();
  const saved = readAssessment(row);
  const type = clientTypeFor(String(client.Kind));
  const [risk, setRisk] = useState<Risk>(saved.risk);
  const [basis, setBasis] = useState(saved.riskBasis);
  const [owners, setOwners] = useState<Owner[]>(saved.owners);
  const [noOwner, setNoOwner] = useState(saved.noOwnerNote);
  const [checks, setChecks] = useState<Check[]>(saved.checks);
  const [evidence, setEvidence] = useState<Evidence[]>(saved.evidence);
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { setRisk(saved.risk); setBasis(saved.riskBasis); setOwners(saved.owners); setNoOwner(saved.noOwnerNote); setChecks(saved.checks); setEvidence(saved.evidence); }, [row.Updated]); // eslint-disable-line react-hooks/exhaustive-deps
  const edit = s.pcan("edit");
  const cleanOwners = owners.filter((x) => x.name.trim());
  const draft = { ...saved, risk, riskBasis: basis, owners: cleanOwners, noOwnerNote: noOwner, checks };
  const problems = amlProblems(draft, type);
  const setCheck = (i: number, p: Partial<Check>) => setChecks(checks.map((c, j) => (j === i ? { ...c, ...p } : c)));
  const run = async (w: ReturnType<typeof saveAssessment> | (() => Promise<ReturnType<typeof saveAssessment>>), ok: string) => {
    setBusy(true); setMsg(null);
    try { const x = typeof w === "function" ? await w() : w; if ("error" in x) setMsg({ ok: false, text: x.error }); else { await s.apply(x); setMsg({ ok: true, text: ok }); } } catch { setMsg({ ok: false, text: "Couldn't save that. Try again." }); } finally { setBusy(false); }
  };
  const save = (ev = evidence) => run(saveAssessment(row, { risk, riskBasis: basis, owners: cleanOwners, noOwnerNote: noOwner, checks, evidence: ev }, s.pcan, s.ctx()), "Saved. Saving does not approve it.");
  const upload = async (f: File) => {
    setBusy(true); setMsg(null);
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const name = `${new Date().toISOString().slice(0, 10)} ${f.name}`.replace(/[\\/:*?"<>|#%{}~&]+/g, " ");
      const item = await store.graph.put<{ webUrl?: string }>(`/me/drive/root:/${encodeURIComponent(FOLDER)}/${encodeURIComponent(clientFolder(String(client.Title)))}/${encodeURIComponent(name)}:/content`, bytes, f.type || "application/octet-stream");
      const next = [...evidence, { id: `E${Date.now()}`, name: f.name, url: item.webUrl || "", at: new Date().toISOString(), by: user || "", note: "" }];
      setEvidence(next); await save(next);
    } catch { setMsg({ ok: false, text: "Couldn't file that in OneDrive. Check Outlook/OneDrive access and try again." }); setBusy(false); return; }
    setBusy(false);
  };

  return (
    <section className="card pad stack" aria-label="Assessment in progress">
      <div className="card-title-row"><h2 style={{ margin: 0, fontSize: 16 }}>{row.Source === "review" ? "Review in progress" : "Assessment in progress"}</h2>{asStatus(row.Status) === "declined" && <span className="chip red">Not approved: {saved.declinedReason}</span>}</div>
      <fieldset disabled={!edit || busy} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
        <div className="row-wrap">
          <label className="doc-field"><span>Risk rating</span><select className="input" value={risk} onChange={(e) => setRisk(e.target.value as Risk)}><option value="">Not assessed</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
          <label className="doc-field" style={{ flex: 1, minWidth: 260 }}><span>What the rating is based on</span><input className="input" value={basis} onChange={(e) => setBasis(e.target.value)} /></label>
        </div>

        <div className="stack" style={{ gap: 6 }}>
          <strong>Beneficial owners{type === "limited" || type === "llp" ? "" : " (if any)"}</strong>
          {owners.map((x, i) => (
            <div className="inline-form" key={i}>
              <input className="input" aria-label="Owner name" placeholder="Name" value={x.name} onChange={(e) => setOwners(owners.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} />
              <input className="input" style={{ width: 90 }} aria-label="Percentage held" type="number" min={0} max={100} placeholder="%" value={x.percent ?? ""} onChange={(e) => setOwners(owners.map((y, j) => (j === i ? { ...y, percent: e.target.value === "" ? null : Number(e.target.value) } : y)))} />
              <input className="input" aria-label="Owner note" placeholder="Note (control, nationality…)" value={x.note} onChange={(e) => setOwners(owners.map((y, j) => (j === i ? { ...y, note: e.target.value } : y)))} />
              <button type="button" className="linkbtn danger-link" onClick={() => setOwners(owners.filter((_, j) => j !== i))}>Remove</button>
            </div>
          ))}
          <div><button type="button" className="btn small" onClick={() => setOwners([...owners, { name: "", percent: null, note: "" }])}>Add an owner</button></div>
          {!cleanOwners.length && <input className="input" aria-label="Why there are none to record" placeholder="If there are none to record, say why" value={noOwner} onChange={(e) => setNoOwner(e.target.value)} />}
        </div>

        <div className="stack" style={{ gap: 6 }}>
          <strong>Checks</strong>
          {checks.map((c, i) => (
            <div className="inline-form" key={c.id || i}>
              <select className="input" aria-label="Kind of check" value={c.kind} onChange={(e) => setCheck(i, { kind: e.target.value })}>{CHECK_KINDS.map((k) => <option key={k}>{k}</option>)}</select>
              <select className="input" aria-label="Result" value={c.result} onChange={(e) => setCheck(i, { result: e.target.value as Check["result"] })}><option value="pending">Pending</option><option value="pass">Passed</option><option value="fail">Failed</option></select>
              <input className="input" aria-label="Check note" placeholder="Evidence or note" value={c.note} onChange={(e) => setCheck(i, { note: e.target.value })} />
              {c.by && <span className="muted">{c.by}{c.at ? `, ${fmtDate(c.at.slice(0, 10))}` : ""}</span>}
              <button type="button" className="linkbtn danger-link" onClick={() => setChecks(checks.filter((_, j) => j !== i))}>Remove</button>
            </div>
          ))}
          <div><button type="button" className="btn small" onClick={() => setChecks([...checks, { id: "", kind: CHECK_KINDS[0], result: "pending", by: "", at: "", note: "" }])}>Add a check</button></div>
        </div>

        <div className="stack" style={{ gap: 6 }}>
          <strong>Evidence files</strong>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>Filed in your OneDrive under {FOLDER}. A file is not a check until a person records it above.</p>
          {evidence.map((e) => <div key={e.id} className="row-wrap" style={{ justifyContent: "space-between" }}><span>{e.url ? <a href={e.url} target="_blank" rel="noopener noreferrer">{e.name}</a> : e.name} <span className="muted">· {e.by}, {fmtDate(e.at.slice(0, 10))}</span></span><button type="button" className="linkbtn danger-link" onClick={() => { const n = evidence.filter((x) => x.id !== e.id); setEvidence(n); void save(n); }}>Remove from record</button></div>)}
          <div><input ref={file} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} /><button type="button" className="btn small" onClick={() => file.current?.click()}>Add a file</button></div>
        </div>
        {edit && <div><button type="button" className="btn primary" onClick={() => void save()}>Save</button></div>}
      </fieldset>

      {problems.length > 0 && <div className="import-list warn"><strong>Before this can be approved:</strong><ul className="plain">{problems.map((x) => <li key={x}>{x}</li>)}</ul></div>}
      {asStatus(row.Status) === "inprogress" && s.pcan("approve") && (
        <div className="row-wrap">
          <button type="button" className="btn primary" disabled={busy} onClick={() => void run(approveAssessment(row, clientRow, all, settings, independent, s.pcan, today, s.ctx()), "Approved. The client's AML review date was set.")}>Approve</button>
          <input className="input" aria-label="Reason" placeholder="Reason (to decline)" value={why} onChange={(e) => setWhy(e.target.value)} />
          <button type="button" className="btn" disabled={busy} onClick={() => void run(declineAssessment(row, why, s.pcan, s.ctx()), "Marked as not approved.")}>Don't approve</button>
        </div>
      )}
      {independent && saved.preparedBy && <p className="muted" style={{ margin: 0 }}>Independent review is on: prepared by {saved.preparedBy}, so someone else approves.</p>}
      {msg && <p className={msg.ok ? undefined : "error-text"} role={msg.ok ? "status" : "alert"} style={{ margin: 0 }}>{msg.text}</p>}
    </section>
  );
}

/** The Overview card: where AML stands, manual assessment and Xama side by side, with a link to the tab. */
export function AmlCard({ client }: { client: Client }) {
  const { data } = useData();
  const pos = position(client as unknown as Row, data.amlAssessments, data.onboardings, todayIso());
  const xama = amlLabel(client.XamaStatus);
  return (
    <section className="card pad stack" aria-label="AML">
      <div className="card-title-row"><h2 style={{ margin: 0, fontSize: 16 }}>AML</h2><span className={`chip ${POSITION_CHIP[pos.state]}`}>{POSITION_LABEL[pos.state]}</span></div>
      <div className="kv"><span>Risk</span><span>{RISK[pos.risk]}</span></div>
      <div className="kv"><span>Done</span><span>{pos.doneOn ? fmtDate(pos.doneOn) : "—"}</span></div>
      <div className="kv"><span>Next review</span><span style={pos.state === "overdue" ? { color: "var(--red-ink, #b42318)", fontWeight: 600 } : pos.state === "soon" ? { color: "var(--amber-ink)", fontWeight: 600 } : undefined}>{pos.reviewDate ? fmtDate(pos.reviewDate) : "—"}</span></div>
      <div className="kv"><span>Xama</span><span style={xama.warn ? { color: "var(--amber-ink)", fontWeight: 600 } : undefined}>{xama.text}</span></div>
      <div><a className="btn small" href={href("clients", client.Key, "aml")}>{pos.state === "none" ? "Start an assessment" : "Open"}</a></div>
    </section>
  );
}
