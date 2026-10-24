// The client's Activity tab: everything that has happened with a client in one place, newest first,
// grouped by day. It reads the records the app already keeps (see lib/timeline.ts); only calls, notes,
// a few job changes and email-to-client choices are stored, in the Activities list.
import { useCallback, useEffect, useMemo, useState } from "react";
import { addScope } from "../lib/auth";
import { Client, fmtDate, todayIso } from "../lib/domain";
import { newKey } from "../lib/planning";
import { Row } from "../lib/schema";
import {
  Activity, ActivityType, Filter, GROUPS, Group, MANUAL_TYPES, MailMsg, OPENABLE, TYPE_INFO, buildTimeline, clientAddresses, filterActivities, groupByDay, mailActivities, summarise,
} from "../lib/timeline";
import { fetchClientMail } from "../lib/timelineMail";
import { Icon } from "./bits";
import { MAIL_SCOPE, mailAllowed } from "./commsKit";
import { useData, useIndex } from "./data";
import type { IconName } from "./bits";

const PAGE = 50;
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const localInput = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export function ClientTimeline({ client }: { client: Client }) {
  const { data, store, user, create, update, remove } = useData();
  const idx = useIndex();
  const today = todayIso();

  const [group, setGroup] = useState<Group | "all">("all");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [jobKey, setJobKey] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [adding, setAdding] = useState(false);
  const [mail, setMail] = useState<{ state: "idle" | "loading" | "done" | "error"; msgs: MailMsg[]; error?: string }>({ state: "idle", msgs: [] });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const addresses = useMemo(() => clientAddresses(client, data.contacts, data.members), [client, data.contacts, data.members]);
  const addrKey = addresses.join("|");
  const ready = store.hasList("Activities");
  const canMail = mailAllowed();

  const loadMail = useCallback(async () => {
    if (!canMail || !addresses.length) { setMail({ state: "done", msgs: [] }); return; }
    setMail((m) => ({ ...m, state: "loading" }));
    try {
      setMail({ state: "done", msgs: await fetchClientMail(store.graph, addresses) });
    } catch {
      setMail((m) => ({ ...m, state: "error", error: "Couldn't read your Outlook mail just now. The rest of the timeline is shown." }));
    }
  }, [canMail, addrKey, store]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadMail(); }, [loadMail]);

  const sources = useMemo(() => ({
    comms: data.comms, documents: data.documents, meetings: data.meetings, jobs: data.jobs, history: data.history, tasks: data.tasks, papers: data.papers, paperLines: data.paperLines,
    taxPayments: data.taxPayments, activities: data.activities, serviceName: idx.serviceName,
  }), [data.comms, data.documents, data.meetings, data.jobs, data.history, data.tasks, data.papers, data.paperLines, data.taxPayments, data.activities, idx.serviceName]);

  const { events, confirm } = useMemo(() => mailActivities(client.Key, mail.msgs, data.clients, data.contacts, data.members, data.activities), [mail.msgs, client.Key, data.clients, data.contacts, data.members, data.activities]);
  const all = useMemo(() => {
    const base = buildTimeline(client.Key, sources);
    const ids = new Set(base.map((a) => a.id));
    return [...base, ...events.filter((e) => !ids.has(e.id))].sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
  }, [client.Key, sources, events]);
  const summary = useMemo(() => summarise(client.Key, all.filter((a) => a.at.slice(0, 10) <= today || a.followUp || a.type === "info-requested"), sources, today), [client.Key, all, sources, today]);

  const jobs = useMemo(() => data.jobs.filter((j) => j.ClientKey === client.Key), [data.jobs, client.Key]);
  const jobName = (k?: string) => { const j = data.jobs.find((x) => x.Key === k); return j ? `${idx.serviceName.get(String(j.ServiceKey || "")) || j.Title}${j.PeriodEnd ? `, ${fmtDate(String(j.PeriodEnd))}` : ""}` : ""; };

  const filter: Filter = { group, q, from, to, jobKey };
  const visible = useMemo(() => filterActivities(all, filter).filter((a) => a.at.slice(0, 10) <= today || a.type === "follow-up" || a.type === "meeting"), [all, group, q, from, to, jobKey, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const days = useMemo(() => groupByDay(visible.slice(0, shown), today), [visible, shown, today]);

  const act = async (id: string, work: () => Promise<unknown>, fail: string) => {
    setBusy(id);
    setError("");
    try { await work(); } catch { setError(fail); } finally { setBusy(""); }
  };
  const row = (a: Activity) => data.activities.find((r) => r.Key === a.rowKey);
  const setStatus = (a: Activity, status: string) => act(a.id, async () => { const r = row(a); if (r) await update("Activities", r, { Status: status }); }, "Couldn't change that.");
  const del = (a: Activity) => { if (window.confirm("Delete this entry from the timeline?")) act(a.id, async () => { const r = row(a); if (r) await remove("Activities", r); }, "Couldn't delete it."); };
  const linkMail = (id: string, clientKey: string, status: "linked" | "unlinked") => act(`mail:${id}`, () => create("Activities", {
    Key: newKey("A"), ClientKey: clientKey, Type: "email-link", SourceKey: id, Status: status, Source: "mail", EventKey: `link:${id}:${clientKey}:${status}:${Date.now()}`, Created: new Date().toISOString(), Actor: user || "",
  }), "Couldn't save that choice.");

  const summaryItems: { label: string; value: string; sub?: string; href?: string; onClick?: () => void; warn?: boolean }[] = [
    { label: "Last contact", value: summary.lastContact ? fmtDate(summary.lastContact.at.slice(0, 10)) : "None yet", sub: summary.lastContact?.title, href: summary.lastContact?.href, onClick: summary.lastContact ? () => { setGroup("all"); setQ(summary.lastContact!.title); } : undefined },
    { label: "Next planned action", value: summary.nextAction ? fmtDate(summary.nextAction.date, { weekday: true, year: false }) : "Nothing planned", sub: summary.nextAction?.label, href: summary.nextAction?.href },
    { label: "Information requests", value: String(summary.openRequests.length), sub: summary.openRequests[0]?.title || "None outstanding", onClick: () => { setGroup("requests"); setQ(""); }, warn: summary.openRequests.length > 0 },
    { label: "Overdue tasks", value: String(summary.overdueTasks.length), sub: summary.overdueTasks[0] ? String(summary.overdueTasks[0].Title) : "None", href: `#/clients/${encodeURIComponent(client.Key)}/work`, warn: summary.overdueTasks.length > 0 },
    { label: "Active jobs", value: String(summary.activeJobs.length), sub: summary.activeJobs[0] ? jobName(summary.activeJobs[0].Key as string) : "None", href: `#/clients/${encodeURIComponent(client.Key)}/work` },
    { label: "Latest document", value: summary.recentDocuments[0] ? fmtDate(summary.recentDocuments[0].at.slice(0, 10)) : "None", sub: summary.recentDocuments[0]?.title, href: summary.recentDocuments[0]?.url || summary.recentDocuments[0]?.href },
    { label: "Unresolved queries", value: String(summary.openQueries.length), sub: summary.openQueries[0]?.title || "None", onClick: () => { setGroup("requests"); setQ(""); }, warn: summary.openQueries.length > 0 },
  ];

  return (
    <div className="stack timeline">
      <div className="tl-summary" role="list" aria-label="Client summary">
        {summaryItems.map((s) => {
          const inner = (<><span className="tl-sum-label">{s.label}</span><strong className={s.warn ? "warn" : ""}>{s.value}</strong><span className="muted tl-sum-sub">{s.sub}</span></>);
          return s.href ? <a key={s.label} role="listitem" className="tl-sum" href={s.href} {...(s.href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{inner}</a>
            : s.onClick ? <button key={s.label} type="button" role="listitem" className="tl-sum" onClick={s.onClick}>{inner}</button>
            : <div key={s.label} role="listitem" className="tl-sum">{inner}</div>;
        })}
      </div>

      <div className="row-wrap tl-bar">
        <div className="row-wrap" role="group" aria-label="Show">
          {GROUPS.map((g) => <button key={g.key} type="button" className={`chip-btn${group === g.key ? " on" : ""}`} aria-pressed={group === g.key} onClick={() => { setGroup(g.key); setShown(PAGE); }}>{g.label}</button>)}
        </div>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn small" onClick={loadMail} disabled={!canMail || mail.state === "loading"} title="Look for new emails in Outlook">{mail.state === "loading" ? "Checking mail…" : "Refresh emails"}</button>
        <button type="button" className="btn primary" onClick={() => setAdding(true)} disabled={!ready}>Add activity</button>
      </div>
      <div className="row-wrap tl-filters">
        <input className="input search" type="search" placeholder="Search this timeline" aria-label="Search this timeline" value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }} />
        <label className="tl-date">From <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="tl-date">To <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <select className="input" aria-label="Job" value={jobKey} onChange={(e) => { setJobKey(e.target.value); setShown(PAGE); }}>
          <option value="">All activity for this client</option>
          {jobs.map((j) => <option key={j.Key as string} value={j.Key as string}>Only: {jobName(j.Key as string)}</option>)}
        </select>
        {(q || from || to || jobKey || group !== "all") && <button type="button" className="linkbtn" onClick={() => { setQ(""); setFrom(""); setTo(""); setJobKey(""); setGroup("all"); }}>Clear filters</button>}
      </div>

      {!ready && <p className="import-list warn" role="alert">The timeline's own list isn't set up yet. It is added automatically when the planner starts; until then calls and notes can't be saved.</p>}
      {!canMail && <p className="muted" style={{ margin: 0 }}>Emails aren't shown because Outlook hasn't been allowed. <button type="button" className="linkbtn" onClick={() => addScope(MAIL_SCOPE, true)}>Allow Outlook</button></p>}
      {mail.state === "error" && <p className="error-text" role="alert">{mail.error}</p>}
      {error && <p className="error-text" role="alert">{error}</p>}

      {confirm.length > 0 && (
        <section className="card pad stack" aria-label="Emails to confirm">
          <h3 style={{ margin: 0 }}>{confirm.length} email{confirm.length === 1 ? "" : "s"} might belong to {client.Title}</h3>
          <p className="muted" style={{ margin: 0 }}>The address is shared with another client or only matches a company domain, so nothing is linked until you say so.</p>
          {confirm.slice(0, 10).map((m) => (
            <div key={m.id} className="tl-confirm">
              <div><strong>{m.subject || "(no subject)"}</strong><div className="muted">{m.folder === "inbox" ? `From ${m.fromName || m.fromAddress}` : `To ${m.to.join(", ")}`} · {fmtDate(m.at.slice(0, 10))}</div></div>
              <span className="row-wrap">
                <button type="button" className="btn small primary" disabled={busy === `mail:${m.id}`} onClick={() => linkMail(m.id, client.Key, "linked")}>Yes, this client</button>
                <button type="button" className="btn small" disabled={busy === `mail:${m.id}`} onClick={() => linkMail(m.id, client.Key, "unlinked")}>Not this client</button>
              </span>
            </div>
          ))}
          {confirm.length > 10 && <p className="muted" style={{ margin: 0 }}>…and {confirm.length - 10} more after these.</p>}
        </section>
      )}

      {adding && <AddActivity client={client} jobs={jobs} jobName={jobName} onClose={() => setAdding(false)} />}

      {days.length ? days.map((d) => (
        <section key={d.day} aria-label={d.label} className="tl-day">
          <h3 className="tl-day-h">{d.label}</h3>
          <ul className="tl-list">
            {d.items.map((a) => (
              <li key={a.id} className="tl-item">
                <span className={`tl-icon g-${a.group}`} aria-hidden="true"><Icon name={TYPE_INFO[a.type].icon as IconName} size={15} /></span>
                <div className="tl-body">
                  <div className="tl-title">
                    {a.href || a.url ? <a href={a.url || a.href} {...(a.url ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{a.title}</a> : <span>{a.title}</span>}
                    {a.status && <span className={`chip ${/open/i.test(a.status) ? "amber" : /resolved|received|done|sent|approved|paid|complete/i.test(a.status) ? "green" : ""}`}>{a.status}</span>}
                    {a.confidential && <span className="chip red">Confidential</span>}
                    {a.hasAttachments && <span className="chip" title="Has attachments">Attachment</span>}
                  </div>
                  {a.summary && <div className="muted tl-sum-text">{a.summary}</div>}
                  <div className="muted tl-meta">
                    {TYPE_INFO[a.type].label}{a.dateOnly ? "" : ` · ${clock(a.at)}`}{a.actor ? ` · ${a.actor}` : ""}
                    {a.jobKey && jobName(a.jobKey) ? <> · <button type="button" className="linkbtn" onClick={() => { setJobKey(a.jobKey!); setShown(PAGE); }}>{jobName(a.jobKey)}</button></> : null}
                    {a.followUp ? ` · follow up ${fmtDate(a.followUp, { year: false })}` : ""}
                  </div>
                  <div className="row-wrap tl-actions">
                    {a.manual && OPENABLE.includes(a.type) && a.status === "Open" && <button type="button" className="btn small" disabled={busy === a.id} onClick={() => setStatus(a, a.type === "info-requested" ? "Received" : a.type === "query" ? "Resolved" : "Done")}>{a.type === "info-requested" ? "Mark received" : a.type === "query" ? "Mark resolved" : "Mark done"}</button>}
                    {a.manual && OPENABLE.includes(a.type) && a.status && a.status !== "Open" && <button type="button" className="linkbtn" disabled={busy === a.id} onClick={() => setStatus(a, "Open")}>Reopen</button>}
                    {a.manual && <button type="button" className="linkbtn danger-link" disabled={busy === a.id} onClick={() => del(a)}>Delete</button>}
                    {a.source === "mail" && <WrongClient a={a} client={client} clients={data.clients} busy={busy === `mail:${a.sourceKey}`} onMove={(k) => act(`mail:${a.sourceKey}`, async () => { if (k) await linkMail(a.sourceKey, k, "linked"); await linkMail(a.sourceKey, client.Key, "unlinked"); }, "Couldn't change the link.")} />}
                    {a.manual && <MoveEntry a={a} clients={data.clients} jobs={data.jobs} jobName={jobName} onMove={(clientKey, job) => act(a.id, async () => { const r = row(a); if (r) await update("Activities", r, { ClientKey: clientKey, JobKey: job }); }, "Couldn't move it.")} />}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )) : <div className="card empty">{all.length ? "Nothing matches these filters." : mail.state === "loading" ? "Looking for activity…" : `No activity recorded for ${client.Title} yet. Letters, meetings, jobs and tasks appear here as they happen, and you can add calls and notes.`}</div>}

      {visible.length > shown && <div className="row-wrap" style={{ justifyContent: "center" }}><button type="button" className="btn" onClick={() => setShown(shown + PAGE)}>Show more ({visible.length - shown} older)</button></div>}
    </div>
  );
}

function WrongClient({ a, client, clients, busy, onMove }: { a: Activity; client: Client; clients: Client[]; busy: boolean; onMove: (to: string | "") => void }) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  if (!open) return <button type="button" className="linkbtn" onClick={() => setOpen(true)} title={`Not ${a.title}?`}>Wrong client?</button>;
  return (
    <span className="row-wrap">
      <select className="input" aria-label="Move this email to" value={to} onChange={(e) => setTo(e.target.value)}>
        <option value="">Not any client (remove from here)</option>
        {clients.filter((c) => c.Key !== client.Key).map((c) => <option key={c.Key} value={c.Key}>Move to {c.Title}</option>)}
      </select>
      <button type="button" className="btn small" disabled={busy} onClick={() => { onMove(to); setOpen(false); }}>Apply</button>
      <button type="button" className="linkbtn" onClick={() => setOpen(false)}>Cancel</button>
    </span>
  );
}

function MoveEntry({ a, clients, jobs, jobName, onMove }: { a: Activity; clients: Client[]; jobs: Row[]; jobName: (k?: string) => string; onMove: (clientKey: string, jobKey: string) => void }) {
  const [open, setOpen] = useState(false);
  const [c, setC] = useState(a.clientKey);
  const [j, setJ] = useState(a.jobKey || "");
  if (!open) return <button type="button" className="linkbtn" onClick={() => setOpen(true)}>Change link</button>;
  return (
    <span className="row-wrap">
      <select className="input" aria-label="Client" value={c} onChange={(e) => { setC(e.target.value); setJ(""); }}>{clients.map((x) => <option key={x.Key} value={x.Key}>{x.Title}</option>)}</select>
      <select className="input" aria-label="Job" value={j} onChange={(e) => setJ(e.target.value)}>
        <option value="">No job</option>
        {jobs.filter((x) => x.ClientKey === c).map((x) => <option key={x.Key as string} value={x.Key as string}>{jobName(x.Key as string)}</option>)}
      </select>
      <button type="button" className="btn small" onClick={() => { onMove(c, j); setOpen(false); }}>Save</button>
      <button type="button" className="linkbtn" onClick={() => setOpen(false)}>Cancel</button>
    </span>
  );
}

const ADD_TYPES = MANUAL_TYPES;

function AddActivity({ client, jobs, jobName, onClose }: { client: Client; jobs: Row[]; jobName: (k?: string) => string; onClose: () => void }) {
  const { data, user, create } = useData();
  const [type, setType] = useState<ActivityType>("call");
  const [at, setAt] = useState(localInput());
  const [text, setText] = useState("");
  const [clientKey, setClientKey] = useState(client.Key);
  const [jobKey, setJobKey] = useState("");
  const [actor, setActor] = useState(user || "");
  const [followUp, setFollowUp] = useState("");
  const [task, setTask] = useState(false);
  const [conf, setConf] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const target = data.clients.find((c) => c.Key === clientKey) || client;
  const jobsFor = clientKey === client.Key ? jobs : data.jobs.filter((j) => j.ClientKey === clientKey);

  const save = async () => {
    if (!text.trim()) return setError("Write a short description first.");
    if (!at) return setError("Choose the date and time.");
    setBusy(true);
    setError("");
    try {
      const key = newKey("A");
      const first = text.trim().split("\n")[0];
      await create("Activities", {
        Key: key, ClientKey: clientKey, JobKey: jobKey, Type: type, Title: first.length > 90 ? `${first.slice(0, 89)}…` : first, Summary: text.trim().includes("\n") ? text.trim().split("\n").slice(1).join(" ").trim() : "",
        At: new Date(at).toISOString(), Actor: actor.trim(), Source: "manual", SourceKey: key, EventKey: key, Status: OPENABLE.includes(type) ? "Open" : "", Visibility: conf ? "confidential" : "normal", FollowUp: followUp,
        Created: new Date().toISOString(),
      });
      if (task && followUp) {
        await create("Tasks", { Key: newKey("T"), Title: `Follow up: ${first.slice(0, 80)}`, ClientKey: clientKey, ClientName: target.Title, Status: "Open", DueDate: followUp, PlannedDate: followUp, EstimateHours: 0.25, Notes: `From a ${TYPE_INFO[type].label.toLowerCase()} on the client timeline.` });
      }
      onClose();
    } catch {
      setError("Couldn't save that. Try again.");
      setBusy(false);
    }
  };

  return (
    <section className="card pad stack" aria-label="Add activity">
      <h3 style={{ margin: 0 }}>Add activity</h3>
      <div className="tl-form">
        <label className="doc-field"><span>Activity type</span>
          <select className="input" value={type} onChange={(e) => setType(e.target.value as ActivityType)}>{ADD_TYPES.map((t) => <option key={t} value={t}>{TYPE_INFO[t].label}</option>)}</select>
        </label>
        <label className="doc-field"><span>Date and time</span><input className="input" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></label>
        <label className="doc-field"><span>Client</span>
          <select className="input" value={clientKey} onChange={(e) => { setClientKey(e.target.value); setJobKey(""); }}>{data.clients.map((c) => <option key={c.Key} value={c.Key}>{c.Title}</option>)}</select>
        </label>
        <label className="doc-field"><span>Job (optional)</span>
          <select className="input" value={jobKey} onChange={(e) => setJobKey(e.target.value)}><option value="">Not linked to a job</option>{jobsFor.map((j) => <option key={j.Key as string} value={j.Key as string}>{jobName(j.Key as string)}</option>)}</select>
        </label>
        <label className="doc-field"><span>Who</span><input className="input" value={actor} onChange={(e) => setActor(e.target.value)} /></label>
        <label className="doc-field"><span>Follow-up date (optional)</span><input className="input" type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} /></label>
      </div>
      <label className="doc-field"><span>Description</span><textarea className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="What was said or done. The first line becomes the title." /></label>
      <div className="row-wrap">
        <label className="check"><input type="checkbox" checked={task} disabled={!followUp} onChange={(e) => setTask(e.target.checked)} /> Create a task for the follow-up</label>
        <label className="check"><input type="checkbox" checked={conf} onChange={(e) => setConf(e.target.checked)} /> Confidential (kept out of anything shared or summarised)</label>
      </div>
      <div className="form-actions">
        <button type="button" className="btn primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save activity"}</button>
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        {error && <span className="error-text" role="alert">{error}</span>}
      </div>
    </section>
  );
}
