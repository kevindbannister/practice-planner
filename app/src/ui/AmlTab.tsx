// A client's AML: the manual risk assessment (risk, beneficial owners, checks, evidence, approval and
// review date) and, separately, what Xama holds. The Overview card summarises it. See lib/amlAssessment.ts.
import { useEffect, useMemo, useRef, useState } from "react";
import { Client, amlLabel, fmtDate, todayIso } from "../lib/domain";
import { Evidence, POSITION_CHIP, POSITION_LABEL, asStatus, approveAssessment, assessmentExtras, declineAssessment, discardAssessment, REASONS, reasonLabel, position, readAssessment, saveAssessment, startAssessment, withdrawAssessment } from "../lib/amlAssessment";
import { CHECK_KINDS, Check, Owner, Risk, amlProblems, onboardingCan, readAml } from "../lib/onboarding";
import { Choice } from "./Choice";
import { completeShortReview, readShortReviews, shortFacts, shortQuestions } from "../lib/amlShortReview";
import { TRIGGER_KINDS, isTriggerSource, lastApprovedAt, raiseReview, readReviewPolicy, seenTriggers, triggerOf } from "../lib/amlReview";
import { Ans, LEVEL_LABEL, basisFrom, evaluate, ratingProblems, templateFor, templateProblems } from "../lib/amlTemplate";
import { AmlRiskForm } from "./AmlRiskForm";
import { amlStampRead, idStampRead } from "../lib/xamaActions";
import { cosecOwnership, mergeOwners } from "../lib/amlCosec";
import { PEP_KINDS, Pep, PepPerson, blankPep, pepUntil } from "../lib/amlPep";
import { policyAnswers } from "../lib/amlPolicy";
import { alsoCovers, contactCover, isIndividual, ownerChecks, ownerCover, ownersCovered } from "../lib/amlPeople";
import { timeline } from "../lib/amlTimeline";
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
  const [shortOn, setShortOn] = useState(false);
  const [rk, setRk] = useState("");
  const [rwhy, setRwhy] = useState("");
  const canEdit = s.pcan("edit");
  const xama = amlLabel(client.XamaStatus);
  const clientRow = () => data.clients.find((c) => c.Key === client.Key) as unknown as Row;

  const go = async (w: ReturnType<typeof startAssessment>) => { setError(""); if ("error" in w) return setError(w.error); setBusy(true); try { await s.apply(w); } catch { setError("Couldn't save that. Try again."); } finally { setBusy(false); } };
  const open = pos.row;
  const hasApproved = !!pos.current || pos.source === "onboarding" || pos.source === "client record";
  const [reason, setReason] = useState(hasApproved ? "periodic" : "new");
  const policy = readReviewPolicy(data.settings, settings.amlMonths);
  const trig = triggerOf(open);
  const seen = trig ? [] : seenTriggers(clientRow(), data as never, policy, lastApprovedAt(clientRow(), data.amlAssessments, data.onboardings, readAml));
  const raise = (kind: string, why: string) => go(raiseReview(clientRow(), data.amlAssessments, kind, why, policy.triggerDays, today, s.pcan as never, s.ctx()));
  return (
    <div className="stack">
      <section className="card pad stack" aria-label="AML status">
        <div className="card-title-row"><h2 className="sec-h">Manual AML assessment</h2><span className={`chip ${POSITION_CHIP[pos.state]}`}>{POSITION_LABEL[pos.state]}</span></div>
        <div className="kv"><span>Risk rating</span><span>{RISK[pos.risk]}</span></div>
        <div className="kv"><span>Assessment done</span><span>{pos.doneOn ? `${fmtDate(pos.doneOn)}${pos.by ? ` · approved by ${pos.by}` : ""}` : "—"}</span></div>
        <div className="kv"><span>Next review</span><span style={pos.state === "overdue" || pos.state === "soon" ? { color: pos.state === "overdue" ? "var(--red-ink, #b42318)" : "var(--amber-ink)", fontWeight: 600 } : undefined}>{pos.reviewDate ? `${fmtDate(pos.reviewDate)}${pos.daysToReview !== null ? (pos.daysToReview < 0 ? ` (${-pos.daysToReview} days overdue)` : ` (in ${pos.daysToReview} days)`) : ""}` : "—"}</span></div>
        {pos.source && <div className="kv"><span>Source</span><span>{pos.source === "onboarding" ? "Approved during onboarding" : pos.source === "client record" ? "Review date on the client record only" : "Recorded here"}</span></div>}
        {error && <p className="error-text" role="alert">{error}</p>}
        {!open && canEdit && <div className="row-wrap">
          <label className="stack" style={{ gap: 2 }}><span className="muted" style={{ fontSize: 12 }}>Why is this being done?</span>
            <select className="input" aria-label="Reason for the assessment" value={reason} onChange={(e) => setReason(e.target.value)}>{REASONS.map((r) => <option key={r.v} value={r.v}>{r.label}</option>)}</select></label>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void go(startAssessment(clientRow(), data.amlAssessments, s.ctx(), reason))}>{pos.current || pos.source === "onboarding" || pos.source === "client record" ? "Start a full review" : "Start an assessment"}</button>
          {pos.current && <button type="button" className="btn" disabled={busy} onClick={() => setShortOn(!shortOn)}>{shortOn ? "Close short review" : "Short review"}</button>}</div>}
        {(() => { const last = readShortReviews(pos.current).slice(-1)[0]; return last ? <div className="kv"><span>Last short review</span><span>{fmtDate(last.date)} · {last.by}{last.outcome === "escalated" ? " · full assessment opened" : ""}</span></div> : null; })()}
      </section>
      {shortOn && !open && pos.current && <ShortReviewForm client={clientRow()} cur={pos.current} rows={data.amlAssessments} settings={settings} independent={s.cfg.independentReview} changes={seen.length > 0} seen={seen} today={today} s={s} onDone={() => setShortOn(false)} />}

      <section className="card pad stack" aria-label="Review triggers">
        <h2 className="sec-h">Reviews outside the schedule</h2>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          {policy.fromPolicy ? `Your policy reviews high-risk clients every ${policy.high} months, medium every ${policy.medium}${policy.low ? ` and low every ${policy.low}` : ""}.` : "Your policy hasn't set review periods yet, so the Settings values are used."} A review is also opened when something happens that your policy lists as a trigger, due within {policy.triggerDays} days.
        </p>
        {trig && (
          <div className="warn" role="status">
            <strong>Review triggered: {trig.label}.</strong> Raised {trig.raised ? fmtDate(trig.raised) : "—"}, due {trig.due ? fmtDate(trig.due) : "—"}{trig.due && trig.due < today ? ", overdue" : ""}.
            {trig.reason && <div style={{ whiteSpace: "pre-wrap" }}>{trig.reason}</div>}
          </div>
        )}
        {seen.map((t, i) => (
          <div key={i} className="row-wrap" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <span><strong>{t.label}</strong> on {fmtDate(t.at)}. {t.detail}</span>
            {canEdit && <span className="row-wrap">{pos.current && !open && <button type="button" className="btn small" disabled={busy} onClick={() => setShortOn(true)}>Short review</button>}<button type="button" className="btn small primary" disabled={busy} onClick={() => void raise(t.kind, t.detail)}>Open a full review</button></span>}
          </div>
        ))}
        {canEdit && pos.state !== "none" && (
          <div className="inline-form">
            <select className="input" aria-label="What happened" value={rk} onChange={(e) => setRk(e.target.value)}>
              <option value="">What happened?</option>
              {TRIGGER_KINDS.filter((t) => policy.triggers.includes(t.v)).map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
            </select>
            <input className="input" aria-label="Short description" placeholder="In a line. Don't record details of a suspicion" value={rwhy} onChange={(e) => setRwhy(e.target.value)} />
            <button type="button" className="btn small" disabled={busy || !rk} onClick={() => void raise(rk, rwhy).then(() => { setRk(""); setRwhy(""); })}>Open a review</button>
          </div>
        )}
      </section>

      {open && <Editor client={client} row={open} all={data.amlAssessments} settings={settings} independent={s.cfg.independentReview} today={today} s={s} clientRow={clientRow()} />}

      <section className="card pad stack" aria-label="Xama">
        <div className="card-title-row"><h2 className="sec-h">Xama</h2><span className={`chip ${xama.warn ? "amber" : "green"}`}>{xama.text}</span></div>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>Identity verification through Xama is kept separate from the manual assessment above. Either can be the record you rely on.</p>
        {(() => {
          const me = clientRow();
          const also = isIndividual(me) ? alsoCovers(me, data.clients as Row[], data.amlAssessments) : [];
          const cc = !isIndividual(me) ? contactCover(me, data.clients as Row[]) : null;
          const cur = pos.row || pos.current;
          const oc2 = !isIndividual(me) && cur ? ownerCover(readAssessment(cur).owners, data.clients as Row[], String(me.Key)).filter((x) => x.client && x.cover.done) : [];
          return <>
            {also.length > 0 && <div className="note" role="status" style={{ fontSize: 13 }}>This person's Xama check here also covers them on: {also.map((a, i) => <span key={String(a.client.Key)}>{i ? ", " : ""}<a href={href("clients", String(a.client.Key), "aml")}>{String(a.client.Title)}</a> ({a.as})</span>)}. Re-check them here, not there.</div>}
            {oc2.length > 0 && <div className="note" role="status" style={{ fontSize: 13 }}>Already checked on their own client records: {oc2.map((x, i) => <span key={i}>{i ? ", " : ""}{x.owner.name} ({x.cover.on ? fmtDate(x.cover.on) : "done"})</span>)}. You don't need to check them again through this client.</div>}
            {cc && cc.cover.done && <div className="warn" role="status" style={{ fontSize: 13 }}>Xama's main contact on this client, {String(cc.client.Title)}, is already checked on their own client record ({cc.cover.how}, {cc.cover.on ? fmtDate(cc.cover.on) : "done"}). Running the AML check here would check them twice.</div>}
          </>;
        })()}
        <XamaClientPanel client={client} />
      </section>

      {(() => { const tl = timeline(client.Key, data.amlAssessments, data.onboardings); return tl.length > 0 && (
        <section className="card pad stack" aria-label="AML timeline">
          <h2 className="sec-h">Timeline</h2>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>Every check and review for this client, newest first. It is read from the reviews, so to add or correct an entry, edit the check's date in a review.</p>
          <table className="table"><thead><tr><th scope="col">Date</th><th scope="col">What</th><th scope="col">Result</th><th scope="col">Note</th><th scope="col">By</th><th scope="col">From</th></tr></thead>
            <tbody>{tl.map((e, i) => <tr key={i}><td>{e.date ? fmtDate(e.date) : "—"}</td><td>{e.title}</td><td>{e.result === "pass" ? "Passed" : e.result === "fail" ? "Failed" : "Pending"}</td><td>{e.note}</td><td>{e.by}</td><td>{e.where}</td></tr>)}</tbody></table>
        </section>
      ); })()}

      {mine.some((r) => !open || r.Key !== open.Key) && (
        <section className="card pad stack" aria-label="Earlier assessments" id="aml-history">
          <h2 className="sec-h">History</h2>
          {mine.filter((r) => !open || r.Key !== open.Key).map((r) => { const a = readAssessment(r); const st = asStatus(r.Status); return (
            <div key={String(r.Key)} className="row-wrap" style={{ justifyContent: "space-between" }}>
              <span>{RISK[a.risk]} risk · {a.doneOn ? `done ${fmtDate(a.doneOn)}` : `started ${fmtDate(String(r.Created).slice(0, 10))}`}{a.reason ? ` · ${reasonLabel(a.reason)}` : ""}{a.approvedBy ? ` · approved by ${a.approvedBy}` : ""}{a.evidence.length ? ` · ${a.evidence.length} file${a.evidence.length === 1 ? "" : "s"}` : ""}</span>
              <span className={`chip ${st === "approved" ? "green" : st === "declined" ? "red" : ""}`}>{st === "discarded" ? "Discarded" : st === "superseded" ? "Replaced by a newer review" : st === "approved" ? "Current" : st === "declined" ? "Not approved" : "In progress"}</span>
            </div>
          ); })}
          {mine.filter((r) => asStatus(r.Status) === "approved").map((r) => <WithdrawRow key={String(r.Key)} row={r} s={s} clientRow={clientRow()} onGo={go} />)}
        </section>
      )}
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>Review periods and triggers come from your <a href={href("aml", "policies")}>AML policy</a> (monitoring step). {onboardingCan(s.cfg, s.me, "approve") ? "" : "Approving AML work needs a manager or partner."}</p>
    </div>
  );
}

/** A short review: four or five Yes/No questions against the current assessment. All Yes records it and moves the next review on; any No opens a full assessment. */
function ShortReviewForm({ client, cur, rows, settings, independent, changes, seen, today, s, onDone }: { client: Row; cur: Row; rows: Row[]; settings: ReturnType<typeof readOnboardingSettings>; independent: boolean; changes: boolean; seen: ReturnType<typeof seenTriggers>; today: string; s: ReturnType<typeof useSales>; onDone: () => void }) {
  const a = readAssessment(cur);
  const qs = shortQuestions(a.doneOn ? fmtDate(a.doneOn) : "", RISK[a.risk] || "", changes);
  const { data } = useData();
  const co = useMemo(() => cosecOwnership(String(client.Key), data as never, today), [data, client.Key, today]);
  const facts = shortFacts({ client, cur, seen, co, today, fmt: fmtDate, open: rows.filter((r) => r.ClientKey === client.Key && asStatus(r.Status) === "inprogress"),
    services: (data.clientServices as Row[]).filter((x) => x.ClientKey === client.Key && !x.EndedOn).map((x) => String((data.services as Row[]).find((y) => y.Key === x.ServiceKey)?.Title || x.ServiceKey || "")) });
  const [ans, setAns] = useState<Record<string, boolean | undefined>>({});
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const anyNo = qs.some((q) => ans[q.k] === false);
  const submit = async () => {
    setErr("");
    const w = completeShortReview(client, cur, rows, { date, answers: ans, notes, changes }, settings, independent, s.pcan, today, s.ctx());
    if ("error" in w) return setErr(w.error);
    setBusy(true); try { await s.apply(w); onDone(); } catch { setErr("Couldn't save that. Try again."); } finally { setBusy(false); }
  };
  return (
    <section className="card pad stack" aria-label="Short review">
      <h2 className="sec-h">Short review</h2>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>A quick look at the current assessment, without redoing it. If everything is still right, record it and the next review moves on. If anything isn't, answer No and a full assessment is opened.{independent ? " Independent review is on, so this needs someone with approval rights." : ""}</p>
      {qs.map((q) => (
        <div key={q.k} className="row-wrap" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <span style={{ flex: "1 1 320px" }}>{q.label}{q.help && <span className="muted" style={{ display: "block", fontSize: 12 }}>{q.help}</span>}
            {(facts[q.k] || []).length > 0 && <span className="muted" style={{ display: "block", fontSize: 13, marginTop: 4 }}><strong>The planner knows:</strong> {(facts[q.k] || []).map((t, i) => <span key={i} style={{ display: "block" }}>· {t}</span>)}</span>}</span>
          <Choice label={q.label} options={["Yes", "No"]} value={ans[q.k] === undefined ? "" : ans[q.k] ? "Yes" : "No"} onChange={(x) => setAns({ ...ans, [q.k]: x === "" ? undefined : x === "Yes" })} />
        </div>
      ))}
      <div className="row-wrap">
        <label className="stack" style={{ gap: 2 }}><span className="muted" style={{ fontSize: 12 }}>Date of review</span><input type="date" className="input" value={date} max={today} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="stack" style={{ gap: 2, flex: "1 1 260px" }}><span className="muted" style={{ fontSize: 12 }}>Notes (optional). Don't record details of a suspicion</span><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      </div>
      {err && <p className="error-text" role="alert">{err}</p>}
      <div className="row-wrap">
        <button type="button" className="btn primary" disabled={busy} onClick={() => void submit()}>{anyNo ? "Record and open a full assessment" : "Complete short review"}</button>
        <button type="button" className="btn" disabled={busy} onClick={onDone}>Cancel</button>
      </div>
    </section>
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
  const { store, user, data } = useData();
  const saved = readAssessment(row);
  const [answers, setAnswers] = useState<Ans>(saved.answers);
  const [rsn, setRsn] = useState(saved.reason);
  const co = useMemo(() => cosecOwnership(String(client.Key), data as never, today), [data, client.Key, today]);
  const type = clientTypeFor(String(client.Kind));
  const isCo = type === "limited" || type === "llp";
  const tpl = templateFor(type);
  const tres = useMemo(() => evaluate(tpl, answers), [tpl, answers]);
  const [risk, setRisk] = useState<Risk>(saved.risk);
  const [basis, setBasis] = useState(saved.riskBasis);
  const [owners, setOwners] = useState<Owner[]>(saved.owners);
  const [noOwner, setNoOwner] = useState(saved.noOwnerNote);
  const [pep, setPep] = useState<Pep>(saved.pep);
  const setPerson = (i: number, p: Partial<PepPerson>) => setPep({ ...pep, people: pep.people.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const policySof = (() => { const ed = policyAnswers(data.settings).edd; return Array.isArray(ed) ? ed.includes("sof") : true; })();
  const [checks, setChecks] = useState<Check[]>(saved.checks);
  const xamaStamp = idStampRead(client.XamaIdCheck), xamaAml = amlStampRead(client.XamaAmlCheck);
  const xamaDone = xamaStamp.state === "done" || xamaAml.state === "done";
  const xamaOn = xamaAml.state === "done" ? xamaAml.on : xamaStamp.on;
  const xamaKinds = xamaAml.state === "done" ? ["Identity verified", "Address verified", "Sanctions and PEP screening"] : ["Identity verified"];
  const xamaNote = xamaAml.state === "done" ? "Xama: AML check + identity & address checks (inc PEP/Sanctions), on the client's main contact" : "Xama: ID verification on the client's main contact";
  const [evidence, setEvidence] = useState<Evidence[]>(saved.evidence);
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { setRisk(saved.risk); setBasis(saved.riskBasis); setOwners(saved.owners); setNoOwner(saved.noOwnerNote); setChecks(saved.checks); setPep(saved.pep); setEvidence(saved.evidence); setAnswers(saved.answers); }, [row.Updated]); // eslint-disable-line react-hooks/exhaustive-deps
  const edit = s.pcan("edit");
  const cleanOwners = owners.filter((x) => x.name.trim());
  const people = (data.clients as Row[]);
  const oc = ownerCover(cleanOwners, people, String(client.Key));
  const ocAll = ownersCovered(oc);
  const toAdd = ownerChecks(oc, checks, today);
  const individuals = people.filter((c) => isIndividual(c) && c.Key !== client.Key).sort((a, b) => String(a.Title).localeCompare(String(b.Title)));
  const link = (i: number, key: string) => setOwners(owners.map((y, j) => (j === i ? (key ? { ...y, clientKey: key } : (({ clientKey: _k, ...rest }) => rest)(y)) : y)));
  const draft = { ...saved, risk, riskBasis: basis, owners: cleanOwners, noOwnerNote: noOwner, checks, pep };
  const problems = [...amlProblems(draft, type), ...templateProblems(tpl, answers), ...ratingProblems(tpl, answers, risk), ...assessmentExtras({ risk, answers, checks, pep }, tpl, policySof)];
  const setCheck = (i: number, p: Partial<Check>) => setChecks(checks.map((c, j) => (j === i ? { ...c, ...p } : c)));
  const run = async (w: ReturnType<typeof saveAssessment> | (() => Promise<ReturnType<typeof saveAssessment>>), ok: string) => {
    setBusy(true); setMsg(null);
    try { const x = typeof w === "function" ? await w() : w; if ("error" in x) setMsg({ ok: false, text: x.error }); else { await s.apply(x); setMsg({ ok: true, text: ok }); } } catch { setMsg({ ok: false, text: "Couldn't save that. Try again." }); } finally { setBusy(false); }
  };
  const save = (ev = evidence) => run(saveAssessment(row, { risk, riskBasis: basis, owners: cleanOwners, noOwnerNote: noOwner, checks, evidence: ev, answers, reason: rsn, pep }, s.pcan, s.ctx()), "Saved. Saving does not approve it.");
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
      <div className="card-title-row"><h2 className="sec-h">{row.Source === "review" ? "Review in progress" : "Assessment in progress"}</h2>{asStatus(row.Status) === "declined" && <span className="chip red">Not approved: {saved.declinedReason}</span>}</div>
      <fieldset disabled={!edit || busy} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
        {!isTriggerSource(row.Source) && <label className="stack" style={{ gap: 2, maxWidth: 420 }}><span style={{ fontWeight: 600 }}>Why is this assessment being done?</span>
          <select className="input" aria-label="Reason for this assessment" value={rsn} onChange={(e) => setRsn(e.target.value)}><option value="">Not recorded</option>{REASONS.map((r) => <option key={r.v} value={r.v}>{r.label}</option>)}</select></label>}
        <AmlRiskForm tpl={tpl} answers={answers} setAnswers={setAnswers} ctx={{
          companyNumber: String(client.CompanyNumber || "").trim(), owners: cleanOwners.length,
          passedIdentity: checks.some((c) => c.result === "pass" && /identity/i.test(c.kind)), passedScreening: checks.some((c) => c.result === "pass" && /sanction|pep/i.test(c.kind)),
          xamaIdDone: idStampRead(client.XamaIdCheck).state === "done", xamaAmlDone: amlStampRead(client.XamaAmlCheck).state === "done", ownersCovered: ocAll, pep: pep.status,
          ownershipAgrees: isCo && co.hasData ? co.findings.filter((f) => /ownership|shareholder|PSC|significant control|share ledger/i.test(f)).length === 0 : null,
          services: (data.clientServices as Row[]).filter((x) => x.ClientKey === client.Key && !x.EndedOn).map((x) => String((data.services as Row[]).find((y) => y.Key === x.ServiceKey)?.Title || x.ServiceKey || "")),
        }} />

        <div className="row-wrap">
          <label className="doc-field"><span>Risk rating</span><select className="input" value={risk} onChange={(e) => setRisk(e.target.value as Risk)}><option value="">Not assessed</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
          {tres.highest && <span className="row-wrap" style={{ alignItems: "center", gap: 6 }}><span className="muted" style={{ fontSize: 13 }}>Highest section rating: <strong>{LEVEL_LABEL[tres.highest]}</strong></span>{(risk !== tres.highest || !basis.trim()) && <button type="button" className="btn small" onClick={() => { setRisk(tres.highest as Risk); if (!basis.trim()) setBasis(basisFrom(tpl, answers)); }}>Use it{!basis.trim() ? " and the wording" : ""}</button>}</span>}
          <label className="doc-field" style={{ flex: 1, minWidth: 260 }}><span>What the rating is based on</span><input className="input" value={basis} onChange={(e) => setBasis(e.target.value)} /></label>
        </div>

        {isCo && (
          <div className="stack" style={{ gap: 6 }}>
            <strong>From company secretarial</strong>
            {!co.hasData ? <p className="muted" style={{ margin: 0, fontSize: 13 }}>Nothing is recorded for this company in Company Secretarial yet (shareholdings, directors or people with significant control).</p> : (
              <>
                <table className="table"><thead><tr><th scope="col">Name</th><th scope="col">Role</th><th scope="col">Shares</th><th scope="col">Votes</th><th scope="col">Companies House ID</th></tr></thead>
                  <tbody>{co.people.map((p) => <tr key={p.name}><td>{p.name}</td><td>{p.roles.join(", ")}{p.natures ? <div className="muted" style={{ fontSize: 12 }}>{p.natures}</div> : null}</td><td>{p.sharePercent !== null ? `${p.sharePercent}%` : "—"}</td><td>{p.votePercent !== null ? `${p.votePercent}%` : "—"}</td><td>{p.corporate ? "—" : p.id === "verified" ? `Verified${p.idOn ? ` ${fmtDate(p.idOn)}` : ""}` : p.id === "exempt" ? "Exempt" : p.id === "pending" ? "Not yet verified" : "Not recorded"}</td></tr>)}</tbody></table>
                {co.findings.length > 0 && <div className="import-list warn"><strong>Check these:</strong><ul className="plain">{co.findings.map((x) => <li key={x}>{x}</li>)}</ul></div>}
                {co.suggested.length > 0 && <div><button type="button" className="btn small" onClick={() => setOwners(mergeOwners(owners.filter((o) => o.name.trim()), co.suggested))}>Add these as beneficial owners ({co.suggested.length})</button> <span className="muted" style={{ fontSize: 12 }}>People with significant control and anyone over 25% of shares or votes. Direct holdings only: you judge control through other companies or other means.</span></div>}
              </>
            )}
          </div>
        )}

        <div className="stack" style={{ gap: 6 }}>
          <strong>Beneficial owners{type === "limited" || type === "llp" ? "" : " (if any)"}</strong>
          {owners.map((x, i) => (
            <div className="inline-form" key={i}>
              <input className="input" aria-label="Owner name" placeholder="Name" value={x.name} onChange={(e) => setOwners(owners.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} />
              <input className="input" style={{ width: 90 }} aria-label="Percentage held" type="number" min={0} max={100} placeholder="%" value={x.percent ?? ""} onChange={(e) => setOwners(owners.map((y, j) => (j === i ? { ...y, percent: e.target.value === "" ? null : Number(e.target.value) } : y)))} />
              <input className="input" aria-label="Owner note" placeholder="Note (control, nationality…)" value={x.note} onChange={(e) => setOwners(owners.map((y, j) => (j === i ? { ...y, note: e.target.value } : y)))} />
              <button type="button" className="linkbtn danger-link" onClick={() => setOwners(owners.filter((_, j) => j !== i))}>Remove</button>
              {x.name.trim() && (() => { const c = oc.find((y) => y.owner === x) || ownerCover([x], people, String(client.Key))[0]; return (
                <div className="muted" style={{ flexBasis: "100%", fontSize: 13 }}>
                  {c.client ? <>Same person as your client <a href={href("clients", String(c.client.Key), "aml")}>{String(c.client.Title)}</a>: {c.cover.done ? <span style={{ color: "var(--green-ink, #1a7f37)" }}>{c.cover.how}, {c.cover.on ? fmtDate(c.cover.on) : "done"}. No need to check them again here.</span> : <span style={{ color: "var(--amber-ink)" }}>{c.cover.how || "no Xama check on their own record yet"}. Check them there once and it covers both.</span>} <button type="button" className="linkbtn" onClick={() => link(i, "")}>Unlink</button></>
                    : <>{c.suggest.length > 0 && <>Looks like your client <strong>{String(c.suggest[0].Title)}</strong>. <button type="button" className="btn small" onClick={() => link(i, String(c.suggest[0].Key))}>Link</button> </>}
                      <select className="input" style={{ maxWidth: 260 }} aria-label={`Link ${x.name} to their own client`} value="" onChange={(e) => e.target.value && link(i, e.target.value)}><option value="">{c.suggest.length ? "Or choose another client…" : "Also your client? Link them…"}</option>{individuals.map((p) => <option key={String(p.Key)} value={String(p.Key)}>{String(p.Title)}</option>)}</select></>}
                </div>
              ); })()}
            </div>
          ))}
          {toAdd.length > 0 && <div><button type="button" className="btn small primary" onClick={() => setChecks([...checks, ...toAdd])}>Add the owners' checks from their own client records ({new Set(toAdd.map((c) => c.note)).size})</button></div>}
          <div><button type="button" className="btn small" onClick={() => setOwners([...owners, { name: "", percent: null, note: "" }])}>Add an owner</button></div>
          {!cleanOwners.length && <input className="input" aria-label="Why there are none to record" placeholder="If there are none to record, say why" value={noOwner} onChange={(e) => setNoOwner(e.target.value)} />}
        </div>

        <div className="stack" style={{ gap: 6 }} aria-label="Politically exposed persons">
          <strong>Politically exposed persons</strong>
          <span>Is the client, an owner or anyone acting for them a politically exposed person (PEP), a family member of one, or a known close associate?</span>
          <Choice label="PEP" options={["No", "Yes"]} value={pep.status === "yes" ? "Yes" : pep.status === "no" ? "No" : ""} onChange={(v) => setPep(v === "Yes" ? { status: "yes", people: pep.people.length ? pep.people : [blankPep()] } : v === "No" ? { ...pep, status: "no" } : { ...pep, status: "" })} />
          {pep.status === "yes" && <>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>The law (MLR 2017 reg 35) requires enhanced due diligence: senior management approval of the relationship (approving this assessment is that approval, so it needs a manager or partner), the source of wealth and source of funds, and closer monitoring (the High rating sets the shorter review period). Keep the measures for at least 12 months after they leave office, longer if the risk remains. Record facts only, never a suspicion.</p>
            {pep.people.map((p, i) => (
              <div key={i} className="stack" style={{ gap: 6, borderLeft: "3px solid var(--line, #ddd)", paddingLeft: 10 }}>
                <div className="inline-form">
                  <input className="input" list="aml-pep-names" aria-label="Name" placeholder="Name" value={p.name} onChange={(e) => setPerson(i, { name: e.target.value })} />
                  <select className="input" aria-label="Type" value={p.kind} onChange={(e) => setPerson(i, { kind: e.target.value as PepPerson["kind"] })}>{PEP_KINDS.map((k) => <option key={k.v} value={k.v}>{k.label}</option>)}</select>
                  <select className="input" aria-label="UK or abroad" value={p.where} onChange={(e) => setPerson(i, { where: e.target.value as PepPerson["where"] })}><option value="">UK or abroad?</option><option value="uk">UK public role</option><option value="abroad">Public role abroad</option></select>
                  <label className="row-wrap" style={{ gap: 4, fontSize: 13 }}>Left office <input className="input" type="date" aria-label="Left office" value={p.left} onChange={(e) => setPerson(i, { left: e.target.value })} /></label>
                  <button type="button" className="linkbtn danger-link" onClick={() => setPep({ ...pep, people: pep.people.filter((_, j) => j !== i) })}>Remove</button>
                </div>
                <input className="input" aria-label="Public role" placeholder={p.kind === "pep" ? "Public role (for example MP, senior official, judge, board of a state-owned company)" : "The PEP they are connected to, and that person's public role"} value={p.role} onChange={(e) => setPerson(i, { role: e.target.value })} />
                <textarea spellCheck lang="en-GB" className="input" rows={2} aria-label="Source of wealth" placeholder="Source of wealth: how they built up their overall wealth, and the evidence seen" value={p.sow} onChange={(e) => setPerson(i, { sow: e.target.value })} />
                <textarea spellCheck lang="en-GB" className="input" rows={2} aria-label="Source of funds" placeholder="Source of funds: where the money in this relationship comes from, and the evidence seen" value={p.sof} onChange={(e) => setPerson(i, { sof: e.target.value })} />
                {pepUntil(p.left) && <span className="muted" style={{ fontSize: 12 }}>Left office {fmtDate(p.left)}: PEP measures continue until at least {fmtDate(pepUntil(p.left))}.</span>}
              </div>
            ))}
            <datalist id="aml-pep-names">{[String(client.Title), ...cleanOwners.map((o) => o.name)].map((n) => <option key={n} value={n} />)}</datalist>
            <div><button type="button" className="btn small" onClick={() => setPep({ ...pep, people: [...pep.people, blankPep()] })}>Add another person</button></div>
          </>}
        </div>

        <div className="stack" style={{ gap: 6 }}>
          <strong>Checks</strong>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>Each check has its own date. It starts as today. Change it to the real date when you are recording something done earlier or in another system.</p>
          {checks.map((c, i) => (
            <div className="inline-form" key={c.id || i}>
              <select className="input" aria-label="Kind of check" value={c.kind} onChange={(e) => setCheck(i, { kind: e.target.value })}>{CHECK_KINDS.map((k) => <option key={k}>{k}</option>)}</select>
              <select className="input" aria-label="Result" value={c.result} onChange={(e) => setCheck(i, { result: e.target.value as Check["result"] })}><option value="pending">Pending</option><option value="pass">Passed</option><option value="fail">Failed</option></select>
              <input className="input" aria-label="Check note" placeholder="Evidence or note" value={c.note} onChange={(e) => setCheck(i, { note: e.target.value })} />
              <input className="input" type="date" aria-label="Date of check" max={todayIso()} value={c.at ? c.at.slice(0, 10) : todayIso()} onChange={(e) => setCheck(i, { at: e.target.value })} />
              {c.by && <span className="muted">{c.by}</span>}
              <button type="button" className="linkbtn danger-link" onClick={() => setChecks(checks.filter((_, j) => j !== i))}>Remove</button>
            </div>
          ))}
          <div className="row-wrap">
            <button type="button" className="btn small" onClick={() => setChecks([...checks, { id: "", kind: CHECK_KINDS[0], result: "pending", by: "", at: "", note: "" }])}>Add a check</button>
            {xamaDone && !checks.some((c) => /^Xama/.test(c.note)) && <button type="button" className="btn small primary" onClick={() => setChecks([...checks, ...xamaKinds.map((kind) => ({ id: "", kind, result: "pass" as const, by: "Xama", at: xamaOn || today, note: xamaNote }))])}>{xamaAml.state === "done" ? "Add the Xama AML check" : "Add the Xama ID check"} ({xamaOn ? fmtDate(xamaOn) : "done"})</button>}
          </div>
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
          <button type="button" className="btn primary" disabled={busy} onClick={() => void run(approveAssessment(row, clientRow, all, settings, independent, s.pcan, today, s.ctx(), { sof: policySof }), "Approved. The client's AML review date was set.")}>Approve</button>
          <input className="input" aria-label="Reason" placeholder="Reason (to decline)" value={why} onChange={(e) => setWhy(e.target.value)} />
          <button type="button" className="btn" disabled={busy} onClick={() => void run(declineAssessment(row, why, s.pcan, s.ctx()), "Marked as not approved.")}>Don't approve</button>
        </div>
      )}
      {edit && (asStatus(row.Status) === "inprogress" || asStatus(row.Status) === "declined") && (
        <div className="row-wrap">
          <button type="button" className="btn" disabled={busy} onClick={() => { if (!window.confirm("Discard this assessment? Nothing is deleted: it stays in the history marked as discarded, and the client's AML position stays as it was. You can start a new one afterwards.")) return; void run(discardAssessment(row, s.pcan, s.ctx()), "Discarded. It is listed under History.").then(() => window.setTimeout(() => document.getElementById("aml-history")?.scrollIntoView({ behavior: "smooth", block: "start" }), 200)); }}>Discard this assessment</button>
          <span className="muted" style={{ fontSize: 13 }}>Goes back to the list of earlier assessments. Unsaved answers on this form are lost.</span>
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
      <div className="card-title-row"><h2 className="sec-h">AML</h2><span className={`chip ${POSITION_CHIP[pos.state]}`}>{POSITION_LABEL[pos.state]}</span></div>
      <div className="kv"><span>Risk</span><span>{RISK[pos.risk]}</span></div>
      <div className="kv"><span>Done</span><span>{pos.doneOn ? fmtDate(pos.doneOn) : "—"}</span></div>
      <div className="kv"><span>Next review</span><span style={pos.state === "overdue" ? { color: "var(--red-ink, #b42318)", fontWeight: 600 } : pos.state === "soon" ? { color: "var(--amber-ink)", fontWeight: 600 } : undefined}>{pos.reviewDate ? fmtDate(pos.reviewDate) : "—"}</span></div>
      <div className="kv"><span>Xama</span><span style={xama.warn ? { color: "var(--amber-ink)", fontWeight: 600 } : undefined}>{xama.text}</span></div>
      <div><a className="btn small" href={href("clients", client.Key, "aml")}>{pos.state === "none" ? "Start an assessment" : "Open"}</a></div>
    </section>
  );
}
