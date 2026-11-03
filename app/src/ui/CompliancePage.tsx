// Compliance: the practice's own regulatory risk in one place. A risk register, the firm's recurring dates, data requests,
// breaches and complaints, ceased clients' records, AML across all clients and one audit trail. Nothing here is sent anywhere
// and nothing is deleted: the app records dates and decisions. See lib/compliance.ts.
import { ReactNode, useMemo, useState } from "react";
import { todayIso } from "../lib/domain";
import { position } from "../lib/amlAssessment";
import * as c from "../lib/compliance";
import { Row } from "../lib/schema";
import { href, useRoute } from "./bits";
import { readSetting, useData } from "./data";
import { useSales } from "./salesKit";

const s = (v: unknown) => (v === undefined || v === null ? "" : String(v));
const fmt = (d: string) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "");
const TABS: [string, string][] = [["overview", "Overview"], ["obligations", "Our dates"], ["requests", "Requests and incidents"], ["retention", "Retention"], ["aml", "AML"], ["audit", "Audit trail"]];
const dot = (l: c.Level) => <span aria-hidden="true" className={`chip ${l === "red" ? "red" : l === "amber" ? "amber" : "green"}`} style={{ marginRight: 8 }}>{l === "red" ? "Act" : l === "amber" ? "Watch" : "OK"}</span>;

function useRun() {
  const sales = useSales();
  const [error, setError] = useState("");
  const run = async (w: ReturnType<typeof c.addStarters>) => {
    if ("error" in w) { setError(w.error); return false; }
    setError("");
    try { await sales.apply(w); return true; } catch { setError("Couldn't save. Try again."); return false; }
  };
  return { run, error, setError, sales };
}
const Err = ({ text }: { text: string }) => (text ? <p role="alert" className="warn" style={{ margin: 0 }}>{text}</p> : null);
const Panel = ({ title, children }: { title: string; children: ReactNode }) => <section className="card pad stack" aria-label={title}><h2 style={{ margin: 0, fontSize: 16 }}>{title}</h2>{children}</section>;

export function CompliancePage() {
  const { parts } = useRoute();
  const tab = TABS.find(([k]) => k === parts[1])?.[0] || "overview";
  const { data } = useData();
  const today = todayIso();
  const years = c.readRetentionYears(readSetting<number>(data.settings, c.RETENTION_KEY));
  const name = (k: string) => (k ? s(data.clients.find((x) => x.Key === k)?.Title || k) : "");
  const clients = data.clients as Row[];
  return (
    <div className="page">
      <div className="page-head"><div><h1>Compliance</h1><p className="muted" style={{ margin: "4px 0 0" }}>The practice's own regulatory risk. The planner records dates and decisions; it never deletes anything or contacts anyone.</p></div></div>
      <div className="row-wrap" role="tablist" aria-label="Compliance" style={{ gap: 8 }}>
        {TABS.map(([k, l]) => <a key={k} role="tab" aria-selected={tab === k} className={`btn small${tab === k ? " primary" : ""}`} href={href("compliance", k)}>{l}</a>)}
      </div>
      {tab === "overview" && <Overview years={years} today={today} />}
      {tab === "obligations" && <Obligations today={today} />}
      {tab === "requests" && <Requests today={today} name={name} />}
      {tab === "retention" && <Retention today={today} years={years} name={name} />}
      {tab === "aml" && <Aml clients={clients} today={today} name={name} />}
      {tab === "audit" && <Audit name={name} />}
    </div>
  );
}

function Overview({ years, today }: { years: number; today: string }) {
  const { data } = useData();
  const reg = useMemo(() => c.riskRegister({
    clients: data.clients, log: data.complianceLog, obligations: data.obligations, assessments: data.amlAssessments, onboardings: data.onboardings,
    backupLast: readSetting<{ at: string }>(data.settings, "backup.last"), backupFailed: readSetting<{ at: string }>(data.settings, "backup.failed"), practiceYears: years, today,
  }), [data, years, today]);
  return (
    <div className="stack">
      <Panel title="Where the practice stands">
        <p style={{ margin: 0 }}>{dot(reg.overall)}<strong>{reg.overall === "red" ? "Something needs action" : reg.overall === "amber" ? "A few things to watch" : "Nothing needs attention"}</strong></p>
        <table style={{ width: "100%", display: "block", overflowX: "auto" }}><tbody>
          {reg.lines.map((l) => (
            <tr key={l.key}><td style={{ whiteSpace: "nowrap" }}>{dot(l.level)}</td><td><a href={l.to}>{l.label}</a></td><td className="muted">{l.detail}</td></tr>
          ))}
        </tbody></table>
      </Panel>
      <p className="muted" style={{ fontSize: 13, margin: 0 }}>Dates are reminders to check, not legal advice. Your supervisor and the ICO set the rules that apply to you.</p>
    </div>
  );
}

function Obligations({ today }: { today: string }) {
  const { data } = useData();
  const { run, error, sales } = useRun();
  const can = sales.pcan("send");
  const rows = data.obligations.map((r) => ({ r, o: c.readObligation(r) })).map((x) => ({ ...x, st: c.obligationState(x.o, today) }))
    .sort((a, b) => (a.o.status === "active" ? 0 : 1) - (b.o.status === "active" ? 0 : 1) || (a.o.due || "9999").localeCompare(b.o.due || "9999"));
  const [title, setTitle] = useState(""); const [due, setDue] = useState(""); const [repeat, setRepeat] = useState<c.Repeat>("yearly");
  return (
    <div className="stack">
      <Panel title="The practice's own dates">
        {rows.length === 0 && <p className="muted" style={{ margin: 0 }}>Nothing here yet. The usual list covers insurance, the ICO fee, AML supervision, training, policy reviews and the backup restore test.</p>}
        {rows.length > 0 && (
          <table style={{ width: "100%", display: "block", overflowX: "auto" }}>
            <thead><tr><th align="left">What</th><th align="left">Due</th><th align="left">Repeats</th><th align="left">Who</th><th align="left">Last done</th><th /></tr></thead>
            <tbody>{rows.map(({ r, o, st }) => (
              <tr key={o.key} style={o.status !== "active" ? { opacity: 0.6 } : undefined}>
                <td><strong>{o.title}</strong>{o.notes && <div className="muted" style={{ fontSize: 12 }}>{o.notes}</div>}</td>
                <td>{can && o.status === "active" ? <input className="input" type="date" aria-label={`Due date for ${o.title}`} value={o.due} onChange={(e) => run(c.setObligation(r, { due: e.target.value }, sales.pcan))} /> : fmt(o.due)}{" "}
                  {st.state === "overdue" && <span className="chip red">{-st.days} days late</span>}{st.state === "soon" && <span className="chip amber">{st.days} days</span>}{st.state === "undated" && <span className="chip">Set a date</span>}</td>
                <td>{c.REPEATS.find(([k]) => k === o.repeat)?.[1]}</td>
                <td>{can && o.status === "active" ? <input className="input" aria-label={`Who looks after ${o.title}`} defaultValue={o.owner} onBlur={(e) => e.target.value !== o.owner && run(c.setObligation(r, { owner: e.target.value }, sales.pcan))} /> : o.owner}</td>
                <td>{fmt(o.lastDone)}</td>
                <td style={{ whiteSpace: "nowrap" }}>{can && o.status === "active" && <><button className="btn small" type="button" onClick={() => run(c.completeObligation(r, today, sales.pcan))}>Done today</button>{" "}<button className="linkbtn" type="button" onClick={() => run(c.setObligation(r, { ended: true }, sales.pcan))}>Stop</button></>}{can && o.status === "ended" && <button className="linkbtn" type="button" onClick={() => run(c.setObligation(r, { ended: false }, sales.pcan))}>Restart</button>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
        <Err text={error} />
        {can ? (
          <div className="row-wrap" style={{ gap: 8, alignItems: "flex-end" }}>
            <label className="field"><span>Add one</span><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="For example, fire safety check" /></label>
            <label className="field"><span>Due</span><input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
            <label className="field"><span>Repeats</span><select className="input" value={repeat} onChange={(e) => setRepeat(e.target.value as c.Repeat)}>{c.REPEATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <button className="btn" type="button" onClick={async () => { if (await run(c.addObligation({ title, kind: "other", due, repeat, owner: "", notes: "" }, sales.pcan, sales.ctx()))) { setTitle(""); setDue(""); } }}>Add</button>
            <button className="btn" type="button" onClick={() => run(c.addStarters(data.obligations, sales.pcan, sales.ctx()))}>Add the usual list</button>
          </div>
        ) : <p className="muted" style={{ margin: 0 }}>Only a manager or partner can change these.</p>}
      </Panel>
    </div>
  );
}

function Requests({ today, name }: { today: string; name: (k: string) => string }) {
  const { data } = useData();
  const { run, error, sales } = useRun();
  const can = sales.pcan("send");
  const [kind, setKind] = useState<c.Kind>("sar");
  const [clientKey, setClientKey] = useState(""); const [person, setPerson] = useState(""); const [opened, setOpened] = useState(today); const [due, setDue] = useState(""); const [owner, setOwner] = useState(""); const [summary, setSummary] = useState("");
  const [closing, setClosing] = useState(""); const [outcome, setOutcome] = useState(""); const [reported, setReported] = useState<c.Reported>("");
  const entries = data.complianceLog.filter(c.isEntryKind).map((r) => ({ r, e: c.readEntry(r) })).map((x) => ({ ...x, st: c.entryState(x.e, today) }))
    .sort((a, b) => (a.e.status === "open" ? 0 : 1) - (b.e.status === "open" ? 0 : 1) || a.e.due.localeCompare(b.e.due));
  return (
    <div className="stack">
      <Panel title="Requests, breaches and complaints">
        {entries.length === 0 && <p className="muted" style={{ margin: 0 }}>None logged.</p>}
        {entries.map(({ r, e, st }) => (
          <div key={e.key} className="stack" style={{ gap: 4, borderTop: "1px solid var(--line, #ddd)", paddingTop: 8 }}>
            <div className="row-wrap" style={{ gap: 8 }}>
              <strong>{c.kindLabel(e.kind)}</strong>{e.clientKey && <a href={href("clients", e.clientKey)}>{name(e.clientKey)}</a>}{e.person && <span>{e.person}</span>}
              {st.state === "overdue" && <span className="chip red">{-st.days} days late</span>}{st.state === "soon" && <span className="chip amber">due {fmt(e.due)}</span>}{st.state === "open" && <span className="chip">due {fmt(e.due)}</span>}{st.state === "closed" && <span className="chip green">Closed {fmt(e.closed)}</span>}
              {c.breachUndecided(e) && <span className="chip red">ICO decision needed</span>}
            </div>
            <div>{e.summary}</div>
            <div className="muted" style={{ fontSize: 12 }}>Received {fmt(e.opened)} · looked after by {e.owner || "nobody yet"}{e.kind === "breach" && e.reported ? ` · ${e.reported === "yes" ? "ICO told" : "ICO not told: people unlikely to be harmed"}` : ""}{e.outcome ? ` · ${e.outcome}` : ""}</div>
            {can && e.status === "open" && closing !== e.key && (
              <div className="row-wrap" style={{ gap: 8 }}>
                <button className="btn small" type="button" onClick={() => { setClosing(e.key); setOutcome(""); setReported(e.reported); }}>Close</button>
                <label className="muted" style={{ fontSize: 12 }}>Deadline <input className="input" type="date" value={e.due} onChange={(ev) => run(c.changeDue(r, ev.target.value, sales.pcan))} /></label>
                {e.kind === "breach" && <label className="muted" style={{ fontSize: 12 }}>ICO <select className="input" value={e.reported} onChange={(ev) => run(c.setReported(r, ev.target.value as c.Reported, sales.pcan))}><option value="">Not decided</option><option value="yes">Told the ICO</option><option value="no-risk">Not needed</option></select></label>}
              </div>
            )}
            {closing === e.key && (
              <div className="stack" style={{ gap: 6 }}>
                <label className="field"><span>How it was dealt with</span><textarea className="input" rows={2} value={outcome} onChange={(ev) => setOutcome(ev.target.value)} /></label>
                {e.kind === "breach" && <label className="field"><span>The ICO</span><select className="input" value={reported} onChange={(ev) => setReported(ev.target.value as c.Reported)}><option value="">Choose</option><option value="yes">We told the ICO</option><option value="no-risk">Not needed: people were unlikely to be harmed</option></select></label>}
                <div className="row-wrap" style={{ gap: 8 }}><button className="btn" type="button" onClick={async () => { if (await run(c.closeEntry(r, { outcome, reported }, today, sales.pcan))) setClosing(""); }}>Save and close</button><button className="linkbtn" type="button" onClick={() => setClosing("")}>Cancel</button></div>
              </div>
            )}
          </div>
        ))}
        <Err text={error} />
      </Panel>
      {can && (
        <Panel title="Log something new">
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>{c.KINDS.find((k) => k.key === kind)?.rule}. The deadline is filled in for you; change it if you need to.</p>
          <div className="cf-grid">
            <label className="field"><span>What</span><select className="input" value={kind} onChange={(e) => setKind(e.target.value as c.Kind)}>{c.KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select></label>
            <label className="field"><span>Client (if any)</span><select className="input" value={clientKey} onChange={(e) => setClientKey(e.target.value)}><option value="">None</option>{data.clients.map((x) => <option key={s(x.Key)} value={s(x.Key)}>{s(x.Title)}</option>)}</select></label>
            <label className="field"><span>Who it concerns</span><input className="input" value={person} onChange={(e) => setPerson(e.target.value)} /></label>
            <label className="field"><span>{kind === "breach" ? "Date we found out" : "Date received"}</span><input className="input" type="date" value={opened} onChange={(e) => setOpened(e.target.value)} /></label>
            <label className="field"><span>Deadline</span><input className="input" type="date" value={due || (opened ? c.dueFor(kind, opened) : "")} onChange={(e) => setDue(e.target.value)} /></label>
            <label className="field"><span>Looked after by</span><input className="input" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Me" /></label>
          </div>
          <label className="field"><span>{kind === "breach" ? "What happened" : kind === "complaint" ? "The complaint" : "What is being asked for"}</span><textarea className="input" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} /></label>
          <div><button className="btn" type="button" onClick={async () => { if (await run(c.openEntry({ kind, clientKey, person, opened, due: due || c.dueFor(kind, opened), owner, summary }, today, sales.pcan, sales.ctx()))) { setSummary(""); setPerson(""); setDue(""); } }}>Log it</button></div>
        </Panel>
      )}
    </div>
  );
}

function Retention({ today, years, name }: { today: string; years: number; name: (k: string) => string }) {
  const { data, saveSetting } = useData();
  const { run, error, sales } = useRun();
  const can = sales.pcan("send");
  const rows = useMemo(() => c.retentionRows(data.clients, data.complianceLog, years, today), [data, years, today]);
  const [open, setOpen] = useState(""); const [note, setNote] = useState(""); const [reviewOn, setReviewOn] = useState("");
  const label: Record<c.RetentionState, string> = { held: "Held", soon: "Review soon", due: "Review due", approved: "Deletion approved", done: "Deleted" };
  return (
    <div className="stack">
      <Panel title="Ceased clients' records">
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>Records are normally kept for {years} years after a client leaves (never under {c.MIN_RETENTION_YEARS} for anyone who had AML checks). When the date comes, decide to keep them and why, or approve deletion. Deleting is done by hand in each system below; here you record that it was decided and done.</p>
        {rows.length === 0 && <p className="muted" style={{ margin: 0 }}>No ceased clients yet. Mark a client as ceased on their Ceasing to act tab.</p>}
        {rows.map((r) => {
          const client = data.clients.find((x) => x.Key === r.clientKey)!;
          return (
            <div key={r.clientKey} className="stack" style={{ gap: 4, borderTop: "1px solid var(--line, #ddd)", paddingTop: 8 }}>
              <div className="row-wrap" style={{ gap: 8 }}>
                <a href={href("clients", r.clientKey)}><strong>{name(r.clientKey)}</strong></a>
                <span className={`chip ${r.state === "due" ? "red" : r.state === "soon" || r.state === "approved" ? "amber" : r.state === "done" ? "green" : ""}`}>{label[r.state]}</span>
                <span className="muted">Left {fmt(r.ceasedOn)} ({r.reason}) · {r.years} years · review {fmt(r.reviewOn)}</span>
              </div>
              {r.note && <div className="muted" style={{ fontSize: 12 }}>{r.decidedBy} on {fmt(r.decidedOn)}: {r.note}</div>}
              {can && r.state !== "done" && open !== r.clientKey && <div className="row-wrap" style={{ gap: 8 }}>
                {r.state === "approved" ? <button className="btn small" type="button" onClick={() => run(c.retentionDecision(client, r, "deleted", { note: "", reviewOn: "" }, today, sales.pcan, sales.ctx()))}>Mark as deleted</button> : (r.state === "due" || r.state === "soon") && <button className="btn small" type="button" onClick={() => { setOpen(r.clientKey); setNote(""); setReviewOn(""); }}>Review</button>}
              </div>}
              {open === r.clientKey && (
                <div className="stack" style={{ gap: 6 }}>
                  <p style={{ margin: 0, fontSize: 13 }}>Before deleting, check each of these:</p>
                  <ul style={{ margin: 0, fontSize: 13 }}>{c.DATA_PLACES.map((d) => <li key={d}>{d}</li>)}</ul>
                  <label className="field"><span>Note (why keep them, or who checked nothing needs keeping)</span><textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></label>
                  <label className="field"><span>If keeping: look again on</span><input className="input" type="date" value={reviewOn} onChange={(e) => setReviewOn(e.target.value)} /></label>
                  <div className="row-wrap" style={{ gap: 8 }}>
                    <button className="btn" type="button" onClick={async () => { if (await run(c.retentionDecision(client, r, "keep", { note, reviewOn }, today, sales.pcan, sales.ctx()))) setOpen(""); }}>Keep them</button>
                    <button className="btn" type="button" onClick={async () => { if (await run(c.retentionDecision(client, r, "delete", { note, reviewOn }, today, sales.pcan, sales.ctx()))) setOpen(""); }}>Approve deletion</button>
                    <button className="linkbtn" type="button" onClick={() => setOpen("")}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        <Err text={error} />
      </Panel>
      {can && <Panel title="Retention period"><label className="field" style={{ maxWidth: 240 }}><span>Years to keep records after a client leaves</span><input className="input" type="number" min={c.MIN_RETENTION_YEARS} max={30} defaultValue={years} onBlur={(e) => saveSetting(c.RETENTION_KEY, c.readRetentionYears(e.target.value))} /></label><p className="muted" style={{ margin: 0, fontSize: 12 }}>A single client can have their own period on their client page. Nothing under {c.MIN_RETENTION_YEARS} is accepted.</p></Panel>}
    </div>
  );
}

function Aml({ clients, today, name }: { clients: Row[]; today: string; name: (k: string) => string }) {
  const { data } = useData();
  const [f, setF] = useState("gaps");
  const rows = useMemo(() => c.amlTable(clients, data.amlAssessments, data.onboardings, today), [clients, data, today]);
  const shown = rows.filter((r) => f === "all" || (f === "gaps" ? r.state === "none" || r.state === "declined" || r.state === "overdue" : f === "soon" ? r.state === "soon" : String(r.risk).toLowerCase() === "high"));
  const word: Record<string, string> = { none: "No assessment", inprogress: "In progress", declined: "Declined", current: "Current", soon: "Review soon", overdue: "Overdue" };
  void position;
  return (
    <Panel title="AML across the practice">
      <label className="field" style={{ maxWidth: 260 }}><span>Show</span><select className="input" value={f} onChange={(e) => setF(e.target.value)}><option value="gaps">Gaps (none, declined or overdue)</option><option value="soon">Review due soon</option><option value="high">High risk</option><option value="all">Everyone</option></select></label>
      <p className="muted" style={{ margin: 0 }}>{shown.length} of {rows.length} active clients</p>
      <table style={{ width: "100%", display: "block", overflowX: "auto" }}><tbody>{shown.map((r) => (
        <tr key={r.clientKey}><td><a href={href("clients", r.clientKey, "aml")}>{name(r.clientKey)}</a></td><td><span className={`chip ${r.state === "current" ? "green" : r.state === "soon" || r.state === "inprogress" ? "amber" : "red"}`}>{word[r.state] || r.state}</span></td><td>{r.risk ? `${r.risk} risk` : ""}</td><td className="muted">{r.reviewDate ? `review ${fmt(r.reviewDate)}` : ""}</td></tr>
      ))}</tbody></table>
    </Panel>
  );
}

function Audit({ name }: { name: (k: string) => string }) {
  const { data } = useData();
  const all = useMemo(() => c.auditTrail({ salesLog: data.salesLog, feeHistory: data.feeHistory, checklistLog: data.checklistLog, billingChases: data.billingChases, complianceLog: data.complianceLog }), [data]);
  const [area, setArea] = useState(""); const [actor, setActor] = useState(""); const [q, setQ] = useState(""); const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const [limit, setLimit] = useState(100);
  const rows = useMemo(() => c.filterAudit(all, { area, actor, q, from, to }, name), [all, area, actor, q, from, to]);
  const actors = [...new Set(all.map((r) => r.actor).filter(Boolean))].sort();
  const download = () => {
    const url = URL.createObjectURL(new Blob(["﻿" + c.auditCsv(rows, name)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `audit-trail-${todayIso()}.csv`; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  return (
    <Panel title="Audit trail">
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>Everything the planner has recorded about who did what: sales, fee changes, checklists, chasing and the items on this page. Read only.</p>
      <div className="row-wrap" style={{ gap: 8, alignItems: "flex-end" }}>
        <label className="field"><span>Area</span><select className="input" value={area} onChange={(e) => setArea(e.target.value)}><option value="">All</option>{["Sales", "Fees", "Checklists", "Chasing", "Compliance"].map((a) => <option key={a}>{a}</option>)}</select></label>
        <label className="field"><span>Who</span><select className="input" value={actor} onChange={(e) => setActor(e.target.value)}><option value="">Anyone</option>{actors.map((a) => <option key={a}>{a}</option>)}</select></label>
        <label className="field"><span>From</span><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="field"><span>To</span><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label className="field"><span>Search</span><input className="input" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <button className="btn" type="button" onClick={download} disabled={!rows.length}>Download CSV</button>
      </div>
      <p className="muted" style={{ margin: 0 }}>{rows.length} entries</p>
      <table style={{ width: "100%", display: "block", overflowX: "auto" }}><tbody>{rows.slice(0, limit).map((r) => (
        <tr key={`${r.area}${r.key}`}><td style={{ whiteSpace: "nowrap" }}>{new Date(r.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</td><td>{r.actor}</td><td>{r.area}</td><td>{r.action}</td><td>{name(r.clientKey)}</td><td className="muted">{r.detail}</td></tr>
      ))}</tbody></table>
      {rows.length > limit && <div><button className="btn small" type="button" onClick={() => setLimit(limit + 200)}>Show more</button></div>}
    </Panel>
  );
}
