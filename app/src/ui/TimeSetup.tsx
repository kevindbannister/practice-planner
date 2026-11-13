// Rates, the team (roles, approval, multi-person capacity) and the data check.
import { ChangeEvent, useMemo, useState } from "react";
import { fmtDate, fmtHours, todayIso } from "../lib/domain";
import { addDays, mondayOf } from "../lib/planning";
import { RATE_SETTING, Rate, addRate, penceToPounds, poundsToPence, rateProblems, resolveRate, specificity } from "../lib/rates";
import { ACTIONS, APPROVAL_SETTING, Action, DEFAULT_ROLES, Member, ROLES, ROLE_LABEL, ROLES_SETTING, Role, TEAM_SETTING, Denied, readRoles } from "../lib/permissions";
import { approve, returnTime, reopen, waiting, APPROVAL_LABEL } from "../lib/timeApproval";
import { TIME_EVENT_LABEL, readTimeEvent } from "../lib/timeBilling";
import { committedMinutes } from "../lib/planSessions";
import { checkTime } from "../lib/timeCheck";
import { toCsv } from "../lib/timeReports";
import { downloadFile } from "./commsKit";
import { entryMinutes } from "../lib/timesheet";
import { TimeFinance as Model, useApply } from "./useTimeFinance";
import { useData } from "./data";

export function TimeSetup({ m, part }: { m: Model; part: "rates" | "team" | "check" }) {
  return part === "rates" ? <Rates m={m} /> : part === "team" ? <><Approval m={m} /><Team m={m} /><Capacity m={m} /></> : <Check m={m} />;
}

// ------------------------------------------------------------------ rates

function Rates({ m }: { m: Model }) {
  const { saveSetting } = useData();
  const today = todayIso();
  const [err, setErr] = useState("");
  const kinds = (["charge", "cost"] as const).filter((k) => m.may(k === "charge" ? "rates.charge" : "rates.cost"));
  const blank = { kind: kinds[0] || "charge", pounds: "", from: today, userKey: "", role: "", serviceKey: "", activityKey: "", clientKey: "", jobKey: "" };
  const [f, setF] = useState(blank);
  const [probe, setProbe] = useState({ date: today, userKey: "", clientKey: "", jobKey: "", activityKey: "" });
  const visible = m.rates.filter((r) => kinds.includes(r.kind));
  const save = async (next: Rate[]) => {
    setErr("");
    try { await saveSetting(RATE_SETTING, [...m.rates.filter((r) => !kinds.includes(r.kind)), ...next.filter((r) => kinds.includes(r.kind))]); }
    catch (e) { setErr(e instanceof Denied ? e.message : "That didn't save. Try again."); }
  };
  const add = () => {
    const p = Number(f.pounds);
    if (!(p >= 0) || f.pounds === "") { setErr("Say the rate per hour in pounds, like 95 or 27.50."); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.from)) { setErr("Say the day it starts."); return; }
    void save(addRate(visible, { kind: f.kind, pence: poundsToPence(p), from: f.from, userKey: f.userKey, role: f.role, serviceKey: f.serviceKey, activityKey: f.activityKey, clientKey: f.clientKey, jobKey: f.jobKey, note: "" })).then(() => setF({ ...blank, kind: f.kind }));
  };
  const scope = (r: Rate) => [r.jobKey && `job ${m.jobTitle(r.jobKey)}`, r.clientKey && m.client(r.clientKey), r.userKey && m.who(r.userKey), r.activityKey && m.activities.find((a) => a.key === r.activityKey)?.name, r.serviceKey && m.service(r.serviceKey), r.role && ROLE_LABEL[r.role as Role]].filter(Boolean).join(" · ") || "Everyone, everything";
  const which = probe.date ? resolveRate(m.rates.filter((r) => kinds.includes(r.kind)), kinds[0] || "charge", { date: probe.date, userKey: probe.userKey, role: probe.userKey ? m.ctx.roleOf(probe.userKey) : "", clientKey: probe.clientKey, jobKey: probe.jobKey, activityKey: probe.activityKey, serviceKey: m.jobs.get(probe.jobKey)?.serviceKey || "" }) : undefined;
  if (!kinds.length) return <div className="alert">You don't have access to rates.</div>;
  const set = (k: keyof typeof f) => (e: ChangeEvent<HTMLSelectElement | HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const problems = rateProblems(visible);
  return (
    <>
      {err && <div className="alert red" role="alert"><strong>{err}</strong></div>}
      <section className="card pad stack" aria-labelledby="rt-h">
        <h2 id="rt-h">Rates</h2>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          A <strong>charge-out rate</strong> is what an hour is worth to a client; a <strong>cost rate</strong> is what an hour costs you. Rates are per hour, net of VAT, and start on a date: a new rate ends the old one the day before, so past time keeps the rate it had.
          When several rates could apply, the most specific wins: a job beats a client, then a person, an activity, a service, a role. If none applies, the time has no value and is flagged, not guessed.
        </p>
        {problems.map((p) => <div key={p} className="alert" role="status">{p}</div>)}
        {visible.length === 0 ? <p className="muted" style={{ margin: 0 }}>No rates yet.</p> : (
          <div style={{ overflowX: "auto" }}><table className="table"><thead><tr><th scope="col" style={{ textAlign: "left" }}>Kind</th><th scope="col" style={{ textAlign: "left" }}>For</th><th scope="col">Per hour</th><th scope="col">From</th><th scope="col">Until</th><th scope="col"><span className="sr-only">End</span></th></tr></thead>
            <tbody>{[...visible].sort((a, b) => a.kind.localeCompare(b.kind) || specificity(b) - specificity(a) || b.from.localeCompare(a.from)).map((r) => (
              <tr key={r.key}><td>{r.kind === "charge" ? "Charge-out" : "Cost"}</td><td>{scope(r)}</td><td style={{ textAlign: "right" }}>{penceToPounds(r.pence)}</td><td style={{ textAlign: "right" }}>{fmtDate(r.from)}</td><td style={{ textAlign: "right" }}>{r.to ? fmtDate(r.to) : "Open"}</td>
                <td>{!r.to && <button type="button" className="btn small" onClick={() => void save(visible.map((x) => (x.key === r.key ? { ...x, to: todayIso() } : x)))}>End today</button>}</td></tr>))}</tbody></table></div>
        )}
        <h3 style={{ margin: "8px 0 0" }}>Add a rate</h3>
        <div className="row-wrap">
          <label className="field"><span>Kind</span><select value={f.kind} onChange={set("kind")}>{kinds.map((k) => <option key={k} value={k}>{k === "charge" ? "Charge-out" : "Cost"}</option>)}</select></label>
          <label className="field"><span>£ per hour</span><input inputMode="decimal" value={f.pounds} onChange={set("pounds")} /></label>
          <label className="field"><span>Starts</span><input type="date" value={f.from} onChange={set("from")} /></label>
        </div>
        <div className="row-wrap">
          <label className="field"><span>Person</span><select value={f.userKey} onChange={set("userKey")}><option value="">Anyone</option>{m.people.map((u) => <option key={u} value={u}>{m.who(u)}</option>)}</select></label>
          <label className="field"><span>Role</span><select value={f.role} onChange={set("role")}><option value="">Any</option>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></label>
          <label className="field"><span>Service</span><select value={f.serviceKey} onChange={set("serviceKey")}><option value="">Any</option>{m.data.services.map((s) => <option key={String(s.Key)} value={String(s.Key)}>{String(s.Title)}</option>)}</select></label>
          <label className="field"><span>Activity</span><select value={f.activityKey} onChange={set("activityKey")}><option value="">Any</option>{m.activities.filter((a) => a.active).map((a) => <option key={a.key} value={a.key}>{a.name}</option>)}</select></label>
          <label className="field"><span>Client</span><select value={f.clientKey} onChange={set("clientKey")}><option value="">Any</option>{m.data.clients.map((c) => <option key={String(c.Key)} value={String(c.Key)}>{String(c.Title)}</option>)}</select></label>
          <label className="field"><span>Job</span><select value={f.jobKey} onChange={set("jobKey")}><option value="">Any</option>{m.data.jobs.filter((j) => !j.CompletedDate).map((j) => <option key={String(j.Key)} value={String(j.Key)}>{String(j.Title)}</option>)}</select></label>
        </div>
        <div><button type="button" className="btn primary" onClick={add}>Add rate</button></div>
      </section>
      <section className="card pad stack" aria-labelledby="wr-h">
        <h2 id="wr-h">Which rate applies?</h2>
        <div className="row-wrap">
          <label className="field"><span>Day</span><input type="date" value={probe.date} onChange={(e) => setProbe({ ...probe, date: e.target.value })} /></label>
          <label className="field"><span>Person</span><select value={probe.userKey} onChange={(e) => setProbe({ ...probe, userKey: e.target.value })}><option value="">Anyone</option>{m.people.map((u) => <option key={u} value={u}>{m.who(u)}</option>)}</select></label>
          <label className="field"><span>Client</span><select value={probe.clientKey} onChange={(e) => setProbe({ ...probe, clientKey: e.target.value })}><option value="">Any</option>{m.data.clients.map((c) => <option key={String(c.Key)} value={String(c.Key)}>{String(c.Title)}</option>)}</select></label>
        </div>
        <p style={{ margin: 0 }}>{which ? <>{kinds[0] === "charge" ? "Charge-out" : "Cost"}: <strong>{penceToPounds(which.pence)} an hour</strong> ({scope(which)}, from {fmtDate(which.from)})</> : "No rate applies, so this time would have no value."}</p>
      </section>
    </>
  );
}

// ------------------------------------------------------------------ approval

function Approval({ m }: { m: Model }) {
  const { saveSetting, data } = useData();
  const { run, busy, note } = useApply();
  const [msg, setMsg] = useState("");
  const [open, setOpen] = useState("");
  const [err, setErr] = useState("");
  const queue = useMemo(() => waiting(m.recs), [m.recs]);
  const log = useMemo(() => data.timeEvents.map(readTimeEvent).sort((a, b) => b.created.localeCompare(a.created)).slice(0, 12), [data.timeEvents]);
  const approved = m.recs.filter((e) => e.approval === "approved" && e.bill !== "billed").slice(0, 200);
  const sole = !m.team.members.length || m.team.members.filter((x) => x.role === "owner").length === 1;
  const toggle = async () => { setErr(""); try { await saveSetting(APPROVAL_SETTING, { on: !m.approval }); } catch (e) { setErr(e instanceof Denied ? e.message : "That didn't save."); } };
  return (
    <section className="card pad stack" aria-labelledby="ap-h">
      <div className="card-title-row"><h2 id="ap-h">Timesheet approval</h2>
        {m.may("team.manage") && <button type="button" className="btn small" onClick={() => void toggle()}>{m.approval ? "Turn off" : "Turn on"}</button>}
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>{m.approval ? "On. People submit their week; a reviewer approves it or sends it back with a note. Approved time is locked: changing it needs the permission to change approved time, and sends it back for approval again." : "Off. Time is simply recorded. Turn it on if someone needs to check timesheets before they count."}</p>
      {err && <div className="alert red" role="alert"><strong>{err}</strong></div>}
      {note && <div className={`alert${note.bad ? " red" : ""}`} role="status"><strong>{note.text}</strong></div>}
      {m.approval && m.may("time.approve") && (queue.length === 0 ? <p className="muted" style={{ margin: 0 }}>Nothing is waiting for approval.</p> : queue.map((q) => (
        <div key={q.user} className="row-wrap" style={{ justifyContent: "space-between" }}>
          <span><strong>{m.who(q.user)}</strong> · {q.entries.length} entries · {fmtHours(q.entries.reduce((t, e) => t + entryMinutes(e, m.ctx.now), 0) / 60)} · {fmtDate(q.entries.map((e) => e.workDate).sort()[0], { year: false })} on</span>
          <span className="row-wrap">
            <button type="button" className="btn small primary" disabled={busy} onClick={() => void run((k) => approve(q.entries, k, sole && q.user.toLowerCase() === m.me.toLowerCase()), "Approved.")}>Approve</button>
            {open === q.user ? <><input aria-label="What needs fixing" placeholder="What needs fixing" value={msg} onChange={(e) => setMsg(e.target.value)} /><button type="button" className="btn small" disabled={busy} onClick={() => void run((k) => returnTime(q.entries, msg, k), "Sent back.").then(() => { setOpen(""); setMsg(""); })}>Send back</button></> : <button type="button" className="btn small" onClick={() => setOpen(q.user)}>Return…</button>}
          </span>
        </div>
      )))}
      {m.approval && m.may("time.edit_approved") && approved.length > 0 && (
        <details><summary>Reopen approved time ({approved.length})</summary>
          <div className="row-wrap" style={{ marginTop: 8 }}>
            <input aria-label="Why reopen" placeholder="Why it is being reopened" value={msg} onChange={(e) => setMsg(e.target.value)} />
            <button type="button" className="btn small" disabled={busy} onClick={() => void run((k) => reopen(approved, msg, k), "Reopened.").then(() => setMsg(""))}>Reopen all of it</button>
          </div>
          <p className="muted" style={{ fontSize: 13 }}>Billed time can't be reopened. The original approval stays in the log.</p>
        </details>
      )}
      {log.length > 0 && (
        <details><summary>Recent billing and approval log</summary>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13 }}>{log.map((e) => <li key={e.key} style={{ marginBottom: 2 }}>{TIME_EVENT_LABEL[e.type] || e.type} · {m.who(e.createdBy)} · {new Date(e.created).toLocaleString("en-GB")}{e.reason ? ` · ${e.reason}` : ""}</li>)}</ul>
        </details>
      )}
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>States: {Object.values(APPROVAL_LABEL).join(", ")}.</p>
    </section>
  );
}

// ------------------------------------------------------------------ team and roles

function Team({ m }: { m: Model }) {
  const { saveSetting } = useData();
  const [err, setErr] = useState("");
  const [f, setF] = useState({ user: "", name: "", role: "staff" as Role });
  const manage = m.may("team.manage");
  const roles = readRoles(Object.fromEntries(ROLES.map((r) => [r, m.team.roles[r]])));
  const saveMembers = async (list: Member[]) => { setErr(""); try { await saveSetting(TEAM_SETTING, list); } catch (e) { setErr(e instanceof Denied ? e.message : "That didn't save."); } };
  const add = () => {
    const user = f.user.trim().toLowerCase();
    if (!user.includes("@")) { setErr("Use the person's sign-in email address."); return; }
    // the first person added makes everyone else count as listed: keep the person doing it as an owner so they can't lock themselves out
    const base = m.team.members.length ? m.team.members : [{ user: m.me.toLowerCase(), name: "", role: "owner" as Role }];
    void saveMembers([...base.filter((x) => x.user !== user), { user, name: f.name.trim(), role: f.role }]).then(() => setF({ user: "", name: "", role: "staff" }));
  };
  const toggle = async (role: Role, a: Action, on: boolean) => {
    setErr("");
    try { await saveSetting(ROLES_SETTING, { ...roles, [role]: on ? [...roles[role], a] : roles[role].filter((x) => x !== a) }); } catch (e) { setErr(e instanceof Denied ? e.message : "That didn't save."); }
  };
  return (
    <section className="card pad stack" aria-labelledby="tm-h">
      <h2 id="tm-h">Team and permissions</h2>
      {err && <div className="alert red" role="alert"><strong>{err}</strong></div>}
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>{m.team.members.length ? "Anyone not listed here can only record their own time." : "Nobody is listed, so you are the only user and can do everything. Add people to give them roles."} The rules are applied by the app on every save. SharePoint itself still lets anyone with edit rights on the lists change them directly, so only give people the SharePoint access they need.</p>
      {m.team.members.map((p) => (
        <div key={p.user} className="row-wrap" style={{ justifyContent: "space-between" }}>
          <span>{p.name || p.user} <span className="muted">· {p.user}</span></span>
          <span className="row-wrap">
            <select aria-label={`Role for ${p.user}`} disabled={!manage} value={p.role} onChange={(e) => void saveMembers(m.team.members.map((x) => (x.user === p.user ? { ...x, role: e.target.value as Role } : x)))}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
            {manage && <button type="button" className="btn small" disabled={p.user === m.me.toLowerCase() && p.role === "owner" && m.team.members.filter((x) => x.role === "owner").length < 2} onClick={() => void saveMembers(m.team.members.filter((x) => x.user !== p.user))}>Remove</button>}
          </span>
        </div>
      ))}
      {manage && (
        <div className="row-wrap">
          <label className="field"><span>Email</span><input value={f.user} onChange={(e) => setF({ ...f, user: e.target.value })} /></label>
          <label className="field"><span>Name</span><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label className="field"><span>Role</span><select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></label>
          <button type="button" className="btn primary" onClick={add}>Add person</button>
        </div>
      )}
      <details><summary>What each role can do</summary>
        <div style={{ overflowX: "auto", marginTop: 8 }}><table className="table"><thead><tr><th scope="col" style={{ textAlign: "left" }}>Permission</th>{ROLES.map((r) => <th key={r} scope="col">{ROLE_LABEL[r]}</th>)}</tr></thead>
          <tbody>{ACTIONS.map(([a, label]) => <tr key={a}><td>{label}</td>{ROLES.map((r) => <td key={r} style={{ textAlign: "center" }}><input type="checkbox" aria-label={`${ROLE_LABEL[r]}: ${label}`} checked={roles[r].includes(a)} disabled={!manage || r === "owner"} onChange={(e) => void toggle(r, a, e.target.checked)} /></td>)}</tr>)}</tbody></table></div>
        <p className="muted" style={{ fontSize: 13 }}>Suggested defaults: {ROLES.map((r) => `${ROLE_LABEL[r]} ${DEFAULT_ROLES[r].length}`).join(", ")} permissions. An owner always has all of them.</p>
      </details>
    </section>
  );
}

// ------------------------------------------------------------------ everyone's capacity

function Capacity({ m }: { m: Model }) {
  const today = todayIso();
  const [week, setWeek] = useState(mondayOf(today));
  if (!m.may("time.view_others") && !m.may("plan.others")) return null;
  const days = [0, 1, 2, 3, 4].map((i) => addDays(week, i));
  const users = m.people.length ? m.people : [m.me];
  return (
    <section className="card pad stack" aria-labelledby="cp-h">
      <div className="card-title-row"><h2 id="cp-h">Everyone's planned time</h2>
        <span className="row-wrap"><button type="button" className="btn small" onClick={() => setWeek(addDays(week, -7))}>Earlier</button><span>{fmtDate(week, { year: false })}</span><button type="button" className="btn small" onClick={() => setWeek(addDays(week, 7))}>Later</button></span>
      </div>
      <div style={{ overflowX: "auto" }}><table className="table"><thead><tr><th scope="col" style={{ textAlign: "left" }}>Person</th>{days.map((d) => <th key={d} scope="col">{fmtDate(d, { weekday: true, year: false })}</th>)}</tr></thead>
        <tbody>{users.map((u) => <tr key={u}><th scope="row" style={{ textAlign: "left", fontWeight: 500 }}>{m.who(u)}</th>{days.map((d) => { const planned = committedMinutes(m.sessions, d, u), cap = m.capacity(d); return <td key={d} style={{ textAlign: "center", color: cap && planned > cap ? "var(--red)" : undefined }}>{planned ? fmtHours(planned / 60) : "–"}<span className="muted" style={{ fontSize: 11 }}> / {cap ? fmtHours(cap / 60) : "off"}</span></td>; })}</tr>)}</tbody></table></div>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>Planned sessions against each person's day (capacity comes from the practice's day settings). Red means planned beyond capacity. Sessions with nobody named count for no one here.</p>
    </section>
  );
}

// ------------------------------------------------------------------ data check

function Check({ m }: { m: Model }) {
  const { data } = useData();
  const r = useMemo(() => checkTime(m.all, m.sessions, { jobs: new Set(data.jobs.map((j) => String(j.Key))), tasks: new Set(data.tasks.map((t) => String(t.Key))), clients: new Set(data.clients.map((c) => String(c.Key))) },
    [...data.jobs.filter((j) => Number(j.ActualHours) > 0).map((j) => ({ kind: "job" as const, key: String(j.Key), title: String(j.Title), actual: Number(j.ActualHours) })), ...data.tasks.filter((t) => Number(t.ActualHours) > 0).map((t) => ({ kind: "task" as const, key: String(t.Key), title: String(t.Title), actual: Number(t.ActualHours) }))], new Date(), m.approval), [m, data.jobs, data.tasks, data.clients]);
  const title = (kind: string, key: string) => (kind === "job" ? data.jobs : data.tasks).find((x) => String(x.Key) === key)?.Title || key;
  const csv = () => downloadFile(new TextEncoder().encode("﻿" + toCsv([["Severity", "Check", "Problem", "Keys"], ...r.issues.map((i) => [i.severity, i.code, i.message, i.keys.join(" ")])])), "Time data check.csv", "text/csv;charset=utf-8");
  const gaps = r.reconciliation.rows.filter((x) => x.wouldImport || x.gapHours < -0.05);
  return (
    <section className="card pad stack" aria-labelledby="dc-h">
      <div className="card-title-row"><h2 id="dc-h">Data check</h2><button type="button" className="btn small" onClick={csv}>Download CSV</button></div>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>Reads {r.counts.entries} time entries and {r.counts.sessions} planned sessions and changes nothing. Run it before and after bringing in old hours.</p>
      {r.issues.length === 0 ? <div className="alert" role="status"><strong>No problems found.</strong></div> : (
        <ul style={{ margin: 0, paddingLeft: 18 }}>{r.issues.map((i) => <li key={i.code} style={{ marginBottom: 4 }}><strong style={{ color: i.severity === "error" ? "var(--red)" : undefined }}>{i.severity === "error" ? "Fix: " : i.severity === "warning" ? "Check: " : "Note: "}</strong>{i.message} <span className="muted" style={{ fontSize: 13 }}>({i.keys.slice(0, 3).join(", ")}{i.keys.length > 3 ? "…" : ""})</span></li>)}</ul>
      )}
      <h3 style={{ margin: "8px 0 0" }}>Typed hours against recorded time</h3>
      <p style={{ margin: 0 }}>Typed on jobs and tasks: <strong>{r.reconciliation.typedTotal}h</strong> · in time entries: <strong>{r.reconciliation.recordedTotal}h</strong> · bringing the rest in would add <strong>{r.reconciliation.wouldImportHours}h</strong> (a dry run: nothing has been added).</p>
      {gaps.length > 0 && <div style={{ overflowX: "auto" }}><table className="table"><thead><tr><th scope="col" style={{ textAlign: "left" }}>Work</th><th scope="col">Typed</th><th scope="col">Recorded</th><th scope="col">Gap</th></tr></thead><tbody>{gaps.slice(0, 40).map((g) => <tr key={g.key}><td>{String(title(g.kind, g.key))}</td><td style={{ textAlign: "right" }}>{g.typedHours}</td><td style={{ textAlign: "right" }}>{g.recordedHours}</td><td style={{ textAlign: "right" }}>{g.gapHours}</td></tr>)}</tbody></table></div>}
    </section>
  );
}
