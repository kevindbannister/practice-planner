// The unified client timeline. One event shape, built from records XProFlow already keeps: letters
// and emails (Communications), documents, meetings and calls, jobs, tasks, working papers, tax
// reminders, chase logs and the client's Outlook mail. Those records stay the source of truth; nothing
// is copied from them. Only things with no record of their own are stored, in the Activities list:
// calls, notes and other manual entries, a few meaningful changes to jobs (status, planned date,
// deadline, stage), and the choices made about which client an email belongs to.
//
// Every event has a stable id built from its source ("mail:<message id>", "comm:<key>:sent"), so a
// repeated sync, a retry or a page refresh can never show the same thing twice. Email bodies and
// document contents are never held here: an event carries a title, a short summary and a link.
import { Client } from "./domain";
import { emailsOf, PUBLIC_DOMAINS_FOR_TIMELINE as PUBLIC } from "./emailTasks";
import { Row } from "./schema";
import { SECTIONS } from "./papers";

export type ActivityType =
  | "email-in" | "email-out" | "email-draft" | "letter" | "doc-created" | "doc-sent"
  | "job-created" | "job-status" | "job-planned" | "job-deadline" | "job-completed"
  | "task-created" | "task-completed"
  | "paper-tb" | "paper-journal" | "paper-prepared" | "paper-reviewed" | "paper-done" | "paper-note" | "paper-note-resolved"
  | "call" | "meeting" | "note" | "conversation" | "follow-up"
  | "info-requested" | "info-received" | "query" | "chase"
  | "tax-reminder" | "tax-paid"
  | "lead-created" | "opp-created" | "opp-stage" | "opp-won" | "opp-outcome"
  | "proposal-created" | "proposal-sent" | "proposal-revised" | "proposal-accepted" | "proposal-rejected";

export type Group = "emails" | "documents" | "jobs" | "tasks" | "papers" | "notes" | "requests" | "sales";
export const GROUPS: { key: Group | "all"; label: string }[] = [
  { key: "all", label: "All activity" }, { key: "emails", label: "Emails" }, { key: "documents", label: "Documents" }, { key: "jobs", label: "Jobs" },
  { key: "tasks", label: "Tasks" }, { key: "papers", label: "Working papers" }, { key: "notes", label: "Notes and calls" }, { key: "requests", label: "Client requests" }, { key: "sales", label: "Sales" },
];

export const TYPE_INFO: Record<ActivityType, { label: string; group: Group; icon: string }> = {
  "email-in": { label: "Email received", group: "emails", icon: "mail" },
  "email-out": { label: "Email sent", group: "emails", icon: "mail" },
  "email-draft": { label: "Email drafted", group: "emails", icon: "mail" },
  letter: { label: "Letter", group: "documents", icon: "letter" },
  "doc-created": { label: "Document generated", group: "documents", icon: "letter" },
  "doc-sent": { label: "Document sent", group: "documents", icon: "letter" },
  "job-created": { label: "Job created", group: "jobs", icon: "list" },
  "job-status": { label: "Job status changed", group: "jobs", icon: "list" },
  "job-planned": { label: "Planned date changed", group: "jobs", icon: "clock" },
  "job-deadline": { label: "Deadline changed", group: "jobs", icon: "clock" },
  "job-completed": { label: "Job completed", group: "jobs", icon: "check" },
  "task-created": { label: "Task created", group: "tasks", icon: "list" },
  "task-completed": { label: "Task completed", group: "tasks", icon: "check" },
  "paper-tb": { label: "Trial balance imported", group: "papers", icon: "list" },
  "paper-journal": { label: "Journals", group: "papers", icon: "list" },
  "paper-prepared": { label: "Prepared", group: "papers", icon: "check" },
  "paper-reviewed": { label: "Reviewed and approved", group: "papers", icon: "check" },
  "paper-done": { label: "Working paper completed", group: "papers", icon: "check" },
  "paper-note": { label: "Review note added", group: "papers", icon: "list" },
  "paper-note-resolved": { label: "Review note resolved", group: "papers", icon: "check" },
  call: { label: "Phone call", group: "notes", icon: "groups" },
  meeting: { label: "Meeting", group: "notes", icon: "clock" },
  note: { label: "Note", group: "notes", icon: "list" },
  conversation: { label: "Client conversation", group: "notes", icon: "groups" },
  "follow-up": { label: "Follow-up", group: "notes", icon: "clock" },
  "info-requested": { label: "Information requested", group: "requests", icon: "flag" },
  "info-received": { label: "Information received", group: "requests", icon: "check" },
  query: { label: "Client query", group: "requests", icon: "alert" },
  chase: { label: "Chased", group: "requests", icon: "refresh" },
  "tax-reminder": { label: "Tax payment reminder", group: "requests", icon: "clock" },
  "tax-paid": { label: "Tax payment made", group: "requests", icon: "check" },
  "lead-created": { label: "Lead created", group: "sales", icon: "groups" },
  "opp-created": { label: "Opportunity created", group: "sales", icon: "list" },
  "opp-stage": { label: "Pipeline stage changed", group: "sales", icon: "refresh" },
  "opp-won": { label: "Opportunity won", group: "sales", icon: "check" },
  "opp-outcome": { label: "Opportunity closed", group: "sales", icon: "flag" },
  "proposal-created": { label: "Proposal started", group: "sales", icon: "letter" },
  "proposal-sent": { label: "Proposal sent", group: "sales", icon: "mail" },
  "proposal-revised": { label: "Proposal revised", group: "sales", icon: "refresh" },
  "proposal-accepted": { label: "Proposal accepted", group: "sales", icon: "check" },
  "proposal-rejected": { label: "Proposal turned down", group: "sales", icon: "flag" },
};

/** Types a person can record by hand. */
export const MANUAL_TYPES: ActivityType[] = ["call", "meeting", "note", "conversation", "follow-up", "info-requested", "info-received", "query"];
/** Manual types that stay open until dealt with. */
export const OPENABLE: ActivityType[] = ["info-requested", "query", "follow-up"];

export type Activity = {
  id: string; // stable: the source and what happened, so it can't be shown twice
  clientKey: string;
  jobKey?: string;
  type: ActivityType;
  group: Group;
  title: string;
  summary: string;
  at: string; // ISO date or date-time
  dateOnly: boolean; // the source only knows the day
  actor: string;
  source: string; // comms, documents, meetings, jobs, tasks, papers, mail, tax, activity
  sourceKey: string;
  status?: string;
  href?: string; // a place in the app
  url?: string; // outside: Outlook, OneDrive
  confidential: boolean;
  manual?: boolean; // a stored entry that can be edited or removed
  rowKey?: string; // its Activities row
  followUp?: string;
  hasAttachments?: boolean;
  practiceId?: string;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const asDate = (v: unknown): string => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : "");
const text = (v: unknown) => String(v ?? "").trim();
const clip = (s: string, n = 160) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
/** A day (or date-time) as a sortable date-time; a bare day sorts at midday so it falls between that day's timed events. */
const when = (v: unknown): { at: string; dateOnly: boolean } | undefined => {
  const s = text(v);
  if (!s) return undefined;
  if (DAY.test(s)) return { at: `${s}T12:00:00`, dateOnly: true };
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return { at: s, dateOnly: false };
  return undefined;
};

function make(clientKey: string, type: ActivityType, id: string, o: Omit<Partial<Activity>, "at"> & { at: unknown; title: string; source: string; sourceKey: string }): Activity | undefined {
  const w = when(o.at);
  if (!w) return undefined;
  return {
    clientKey, type, group: TYPE_INFO[type].group, id, summary: "", actor: "", confidential: false, ...o, at: w.at, dateOnly: o.dateOnly ?? w.dateOnly,
  };
}

// ------------------------------------------------------------------ what the timeline reads

export type Sources = {
  comms: Row[]; documents: Row[]; meetings: Row[]; jobs: Row[]; history: Row[]; tasks: Row[]; papers: Row[]; paperLines: Row[]; taxPayments: Row[]; activities: Row[];
  serviceName: Map<string, string>;
};
const PAPER_SERVICES = new Set(["ACCS_LTD", "ACCS_LLP", "CT600"]);
const sectionTitle = (key: string) => SECTIONS.find((s) => s.key === key)?.title || key;

/** A calendar day from "12 October 2026: chased by email". */
function chaseDay(line: string): { day: string; how: string } | undefined {
  const m = /^(.+?):\s*chased by (.+)$/.exec(line.trim());
  if (!m) return undefined;
  const d = new Date(`${m[1]} 12:00:00 UTC`);
  if (Number.isNaN(d.getTime())) return undefined;
  return { day: d.toISOString().slice(0, 10), how: m[2].trim() };
}

/** Everything recorded in the app about one client, newest first. */
export function buildTimeline(clientKey: string, s: Sources, now = new Date()): Activity[] {
  const out = new Map<string, Activity>();
  const add = (a: Activity | undefined) => { if (a && !out.has(a.id)) out.set(a.id, a); };
  const mine = (rows: Row[]) => rows.filter((r) => r.ClientKey === clientKey);
  const jobFor = (period: unknown) => mine(s.jobs).find((j) => PAPER_SERVICES.has(text(j.ServiceKey)) && text(j.PeriodEnd) === text(period))?.Key as string | undefined;
  const svc = (j: Row) => s.serviceName.get(text(j.ServiceKey)) || text(j.Title) || "Job";

  // letters and emails written in the app
  for (const c of mine(s.comms)) {
    const key = text(c.Key), subject = text(c.Subject) || (c.Kind === "email" ? "Email" : "Letter");
    const href = `#/comms/${encodeURIComponent(key)}`;
    const base = { source: "comms", sourceKey: key, jobKey: text(c.JobKey) || undefined, href, title: subject, actor: "", status: undefined as string | undefined };
    if (c.Kind === "email") {
      if (c.SentOn) add(make(clientKey, "email-out", `comm:${key}:sent`, { ...base, at: c.SentOn, status: "Sent", url: text(c.OutlookUrl) || undefined, summary: `To ${text(c.ToEmail)}` }));
      else if (c.Status === "outlook") add(make(clientKey, "email-draft", `comm:${key}:draft`, { ...base, at: c.Updated || c.Created, status: "In Outlook drafts", url: text(c.OutlookUrl) || undefined, summary: text(c.ToEmail) ? `To ${text(c.ToEmail)}` : "" }));
    } else {
      add(make(clientKey, "letter", `comm:${key}:letter`, { ...base, at: c.LetterDate && !c.Created ? c.LetterDate : c.Created || c.LetterDate, status: c.Status === "word" ? "Word letter made" : c.Status === "outlook" ? "In Outlook drafts" : "Draft", url: text(c.FileUrl) || undefined, summary: clip(text(c.Brief)) }));
      if (c.SentOn) add(make(clientKey, "email-out", `comm:${key}:sent`, { ...base, at: c.SentOn, status: "Sent", title: `${subject} (sent)`, url: text(c.OutlookUrl) || undefined }));
    }
  }

  // documents made in Documents
  for (const d of mine(s.documents)) {
    const key = text(d.Key), title = text(d.Title) || "Document";
    const base = { source: "documents", sourceKey: key, jobKey: text(d.JobKey) || undefined, title, actor: text(d.CreatedBy), url: text(d.FileUrl) || undefined, href: `#/comms/documents/history` };
    add(make(clientKey, "doc-created", `doc:${key}:created`, { ...base, at: d.Created, status: text(d.Status) || "Saved", summary: `${text(d.TemplateName)}${d.TemplateVersion ? ` (version ${d.TemplateVersion})` : ""}${d.Pages ? ` · ${d.Pages} page${Number(d.Pages) === 1 ? "" : "s"}` : ""}` }));
    if (d.SentOn) add(make(clientKey, "doc-sent", `doc:${key}:sent`, { ...base, at: d.SentOn, status: "Sent", title: `${title} (sent)`, summary: text(d.SentTo) ? `To ${text(d.SentTo)}` : "" }));
  }

  // meetings and calls
  for (const m of mine(s.meetings)) {
    const key = text(m.Key);
    const isCall = m.Kind === "call";
    add(make(clientKey, isCall ? "call" : "meeting", `meeting:${key}`, {
      source: "meetings", sourceKey: key, jobKey: text(m.JobKey) || undefined, at: m.When, title: text(m.Title) || (isCall ? "Phone call" : "Meeting"),
      summary: clip(text(m.Summary) || text(m.Agenda)), status: text(m.Status) || undefined, href: `#/comms/meetings/${encodeURIComponent(key)}`,
    }));
  }

  // jobs
  for (const j of mine(s.jobs)) {
    const key = text(j.Key);
    const base = { source: "jobs", sourceKey: key, jobKey: key, href: `#/clients/${encodeURIComponent(clientKey)}/work` };
    if (j.CompletedDate || j.Status === "Complete") add(make(clientKey, "job-completed", `job:${key}:completed`, { ...base, at: j.CompletedDate, title: `${svc(j)} completed`, status: "Complete", summary: text(j.PeriodEnd) ? `Period ending ${text(j.PeriodEnd)}` : "" }));
    if (j.RecordsReceived) add(make(clientKey, "info-received", `job:${key}:records`, { ...base, at: j.RecordsReceived, title: `Records received for ${svc(j)}`, status: "Received" }));
    let any = false;
    for (const line of text(j.ChaseLog).split("\n")) {
      const c = chaseDay(line);
      if (!c) continue;
      any = true;
      add(make(clientKey, "chase", `job:${key}:chase:${c.day}:${c.how}`, { ...base, at: c.day, title: `Chased for ${svc(j)}`, summary: `By ${c.how}` }));
    }
    if (!any && j.LastChased) add(make(clientKey, "chase", `job:${key}:chase:${text(j.LastChased)}`, { ...base, at: j.LastChased, title: `Chased for ${svc(j)}` }));
  }
  for (const h of mine(s.history)) {
    const key = text(h.Key);
    add(make(clientKey, "job-completed", `history:${key}`, { source: "jobs", sourceKey: key, at: h.Completed, title: `${s.serviceName.get(text(h.ServiceKey)) || "Job"} completed`, status: "Complete", summary: "From your imported history" }));
  }

  // tasks
  for (const t of mine(s.tasks)) {
    if (t.Status === "Done" || t.CompletedDate) {
      const key = text(t.Key);
      add(make(clientKey, "task-completed", `task:${key}:completed`, { source: "tasks", sourceKey: key, at: t.CompletedDate, title: text(t.Title) || "Task", status: "Done", summary: text(t.Type), href: `#/clients/${encodeURIComponent(clientKey)}/work` }));
    }
  }

  // working papers: sign-offs, and what was imported or raised
  for (const p of mine(s.papers)) {
    const item = text(p.ItemKey), period = text(p.PeriodEnd), label = sectionTitle(item.split("/")[0]);
    const base = { source: "papers", sourceKey: `${period}/${item}`, jobKey: jobFor(period), href: `#/papers/${encodeURIComponent(clientKey)}/${encodeURIComponent(period)}`, summary: `Period ending ${period}` };
    if (p.PreparedOn) add(make(clientKey, "paper-prepared", `paper:${period}:${item}:prepared:${text(p.PreparedOn)}`, { ...base, at: p.PreparedOn, title: `${label}: prepared`, actor: text(p.PreparedBy), status: "Prepared" }));
    if (p.ReviewedOn) add(make(clientKey, "paper-reviewed", `paper:${period}:${item}:reviewed:${text(p.ReviewedOn)}`, { ...base, at: p.ReviewedOn, title: `${label}: reviewed and approved`, actor: text(p.ReviewedBy), status: "Approved" }));
    else if (p.Status === "done" && !p.PreparedOn) add(make(clientKey, "paper-done", `paper:${period}:${item}:done`, { ...base, at: p.Updated, title: `${label}: completed`, status: "Done" }));
  }
  const batches = new Map<string, { type: ActivityType; period: string; day: string; n: number; section: string }>();
  for (const l of mine(s.paperLines)) {
    const section = text(l.SectionKey), period = text(l.PeriodEnd), day = asDate(l.Updated);
    if (!day) continue;
    const link = `#/papers/${encodeURIComponent(clientKey)}/${encodeURIComponent(period)}`;
    if (section === "tb" || section === "journals") {
      const type: ActivityType = section === "tb" ? "paper-tb" : "paper-journal";
      const k = `${type}:${period}:${text(l.SubKey)}:${day}`;
      const b = batches.get(k) || { type, period, day, n: 0, section: section === "tb" ? "Trial balance" : sectionTitle("journals") };
      b.n++;
      batches.set(k, b);
    } else if (section === "review-notes" || section === "queries") {
      const key = text(l.Key);
      const kind = section === "queries" ? "Query" : "Review note";
      const base = { source: "papers", sourceKey: key, jobKey: jobFor(period), href: link, title: `${kind}: ${clip(text(l.Detail) || text(l.Remark), 90)}`, summary: `Period ending ${period}` };
      add(make(clientKey, section === "queries" ? "query" : "paper-note", `paper:line:${key}:added`, { ...base, at: l.Updated, status: l.Done ? "Resolved" : "Open" }));
      if (l.Done) add(make(clientKey, "paper-note-resolved", `paper:line:${key}:resolved`, { ...base, at: l.Updated, title: `${kind} resolved: ${clip(text(l.Detail) || text(l.Remark), 80)}`, status: "Resolved" }));
    }
  }
  for (const [k, b] of batches) {
    add(make(clientKey, b.type, `paper:${k}`, { source: "papers", sourceKey: k, jobKey: jobFor(b.period), at: b.day, title: b.type === "paper-tb" ? `Trial balance imported (${b.n} line${b.n === 1 ? "" : "s"})` : `Journals updated (${b.n} line${b.n === 1 ? "" : "s"})`, summary: `Period ending ${b.period}`, href: `#/papers/${encodeURIComponent(clientKey)}/${encodeURIComponent(b.period)}` }));
  }

  // tax payment reminders and payments
  for (const t of mine(s.taxPayments)) {
    const key = text(t.Key), label = text(t.Label) || text(t.Tax) || "Tax payment";
    if (t.RemindedOn) add(make(clientKey, "tax-reminder", `tax:${key}:reminded:${text(t.RemindedOn)}`, { source: "tax", sourceKey: key, at: t.RemindedOn, title: `Reminder: ${label}`, href: `#/clients/${encodeURIComponent(clientKey)}/tax` }));
    if (t.PaidOn) add(make(clientKey, "tax-paid", `tax:${key}:paid`, { source: "tax", sourceKey: key, at: t.PaidOn, title: `Paid: ${label}`, status: "Paid", href: `#/clients/${encodeURIComponent(clientKey)}/tax` }));
  }

  // entries stored in the Activities list
  for (const r of mine(s.activities)) {
    const type = text(r.Type) as ActivityType;
    if (!TYPE_INFO[type]) continue; // email-link rows and anything unknown are not events
    const key = text(r.Key);
    const meta = parseMeta(r.Meta);
    add(make(clientKey, type, `act:${text(r.EventKey) || key}`, {
      source: text(r.Source) || "activity", sourceKey: text(r.SourceKey) || key, jobKey: text(r.JobKey) || undefined, at: r.At || r.Created, title: text(r.Title) || TYPE_INFO[type].label,
      summary: text(r.Summary), actor: text(r.Actor), status: text(r.Status) || undefined, confidential: text(r.Visibility) === "confidential", manual: text(r.Source) === "manual", rowKey: key,
      followUp: text(r.FollowUp) || undefined, href: meta.href, dateOnly: false,
    }));
  }

  void now;
  return sortActivities([...out.values()]);
}

const parseMeta = (v: unknown): { href?: string } => { try { const o = JSON.parse(text(v) || "{}"); return o && typeof o === "object" ? o : {}; } catch { return {}; } };

export const sortActivities = (list: Activity[]) => list.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));

// ------------------------------------------------------------------ email

/** An Outlook message as the timeline needs it. Bodies are never kept. */
export type MailMsg = {
  id: string; subject: string; preview: string; at: string; folder: "inbox" | "sent" | "draft" | "other";
  fromName: string; fromAddress: string; to: string[]; webLink?: string; hasAttachments: boolean;
};

/** Which clients a message could belong to, by the other person's address. "strong": an address recorded for the client or a linked contact. "weak": only a company email domain that one client uses. */
export function candidateClients(m: MailMsg, clients: Client[], contacts: Row[], links: Row[]): { strong: string[]; weak: string[] } {
  const addrs = (m.folder === "inbox" ? [m.fromAddress] : m.folder === "sent" || m.folder === "draft" ? m.to : [m.fromAddress, ...m.to]).map((a) => a.toLowerCase()).filter((a) => a.includes("@"));
  const strong = new Set<string>(), weak = new Set<string>();
  for (const a of addrs) {
    for (const c of clients) if (emailsOf(c.Email).includes(a)) strong.add(c.Key);
    const contact = contacts.filter((c) => text(c.Email).toLowerCase().split(/[;,\s]+/).includes(a));
    for (const ct of contact) for (const l of links) if ((l.MemberKey === ct.Key || l.ContactKey === ct.Key) && text(l.ClientKey)) strong.add(text(l.ClientKey));
    const dom = a.split("@")[1];
    if (!dom || PUBLIC.has(dom)) continue;
    const same = clients.filter((c) => emailsOf(c.Email).some((e) => e.split("@")[1] === dom));
    if (same.length === 1) weak.add(same[0].Key);
  }
  for (const k of strong) weak.delete(k);
  return { strong: [...strong], weak: [...weak] };
}

export type MailChoice = "linked" | "confirm" | "none";
/** Whether a message belongs on this client's timeline: by a person's choice first, otherwise only when exactly one client has the address. */
export function mailChoice(m: MailMsg, clientKey: string, clients: Client[], contacts: Row[], links: Row[], overrides: Row[]): MailChoice {
  const mine = overrides.filter((o) => o.Type === "email-link" && o.SourceKey === m.id).sort((a, b) => text(a.Created).localeCompare(text(b.Created)));
  const decided = new Map<string, string>();
  for (const o of mine) decided.set(text(o.ClientKey), text(o.Status)); // the latest choice for each client wins
  if (decided.get(clientKey) === "linked") return "linked";
  if (decided.get(clientKey) === "unlinked") return "none";
  if ([...decided.values()].includes("linked")) return "none"; // it was moved to another client
  const { strong, weak } = candidateClients(m, clients, contacts, links);
  if (strong.includes(clientKey)) return strong.length === 1 ? "linked" : "confirm";
  if (weak.includes(clientKey)) return "confirm";
  return "none";
}

/** Timeline events for the messages that belong to this client, and the ones waiting to be confirmed. */
export function mailActivities(clientKey: string, msgs: MailMsg[], clients: Client[], contacts: Row[], links: Row[], overrides: Row[]): { events: Activity[]; confirm: MailMsg[] } {
  const events: Activity[] = [], confirm: MailMsg[] = [];
  const seen = new Set<string>();
  for (const m of msgs) {
    if (seen.has(m.id) || m.folder === "draft") continue; // drafts made here are shown from the letter or document they came from
    seen.add(m.id);
    const c = mailChoice(m, clientKey, clients, contacts, links, overrides);
    if (c === "confirm") { confirm.push(m); continue; }
    if (c === "none") continue;
    const incoming = m.folder === "inbox";
    const a = make(clientKey, incoming ? "email-in" : "email-out", `mail:${m.id}`, {
      source: "mail", sourceKey: m.id, at: m.at, title: m.subject || "(no subject)", summary: clip(m.preview), actor: incoming ? m.fromName || m.fromAddress : "You",
      status: incoming ? "Received" : "Sent", url: m.webLink, hasAttachments: m.hasAttachments,
    });
    if (a) { a.summary = `${incoming ? `From ${m.fromName || m.fromAddress}` : `To ${m.to.join(", ")}`}${a.summary ? ` · ${a.summary}` : ""}`; events.push(a); }
  }
  return { events, confirm };
}

/** The addresses to look for in Outlook for a client: theirs and their linked contacts'. */
export function clientAddresses(client: Client, contacts: Row[], links: Row[]): string[] {
  const out = new Set(emailsOf(client.Email));
  for (const l of links) {
    if (l.ClientKey !== client.Key) continue;
    const ct = contacts.find((c) => c.Key === l.MemberKey || c.Key === l.ContactKey);
    for (const e of emailsOf(ct?.Email as string | undefined)) out.add(e);
  }
  return [...out];
}

// ------------------------------------------------------------------ changes worth recording

const TRACKED: Record<string, { type: ActivityType; label: string }> = {
  Status: { type: "job-status", label: "Status" }, PlannedDate: { type: "job-planned", label: "Planned date" }, Deadline: { type: "job-deadline", label: "Deadline" }, StageName: { type: "job-status", label: "Stage" },
};
const dateText = (v: string) => (DAY.test(v) ? v.split("-").reverse().join("/") : v);

/** The Activities rows a change to a job should leave behind: status, stage, planned date and deadline only, and only when the value really changed. */
export function changeEvents(list: string, row: Row, patch: Row, o: { actor: string; now: string; newKey: (p: string) => string }): Row[] {
  if (list !== "Jobs") return [];
  const out: Row[] = [];
  const day = o.now.slice(0, 10);
  for (const [field, info] of Object.entries(TRACKED)) {
    if (!(field in patch)) continue;
    const before = text(row[field]), after = text(patch[field]);
    if (before === after) continue;
    if (field === "Status" && after === "Complete") continue; // completion is shown from the job itself
    const name = text(row.Title) || "Job";
    out.push({
      Key: o.newKey("A"), ClientKey: row.ClientKey, JobKey: row.Key, Type: info.type, Source: "jobs", SourceKey: row.Key,
      EventKey: `${info.type}:${field}:${text(row.Key)}:${after}:${day}`,
      Title: `${name}: ${info.label.toLowerCase()} ${after ? `now ${dateText(after)}` : "cleared"}`, Summary: before ? `Was ${dateText(before)}` : "", At: o.now, Actor: o.actor, Status: after, Visibility: "normal",
    });
  }
  return out;
}

/** The row left behind when a job or task is created by hand. */
export function createdEvent(list: string, row: Row, o: { actor: string; now: string; newKey: (p: string) => string }): Row | undefined {
  if ((list !== "Jobs" && list !== "Tasks") || !text(row.ClientKey)) return undefined;
  const isJob = list === "Jobs";
  return {
    Key: o.newKey("A"), ClientKey: row.ClientKey, JobKey: isJob ? row.Key : "", Type: isJob ? "job-created" : "task-created", Source: isJob ? "jobs" : "tasks", SourceKey: row.Key,
    EventKey: `created:${list}:${text(row.Key)}`, Title: `${isJob ? "Job" : "Task"} created: ${text(row.Title) || (isJob ? "Job" : "Task")}`, Summary: "", At: o.now, Actor: o.actor, Status: "", Visibility: "normal",
  };
}

// ------------------------------------------------------------------ filtering, grouping

export type Filter = { group?: Group | "all"; from?: string; to?: string; q?: string; jobKey?: string; includeConfidential?: boolean };

export function filterActivities(list: Activity[], f: Filter): Activity[] {
  const q = (f.q || "").trim().toLowerCase();
  return list.filter((a) => {
    if (f.group && f.group !== "all" && a.group !== f.group) return false;
    if (f.jobKey && a.jobKey !== f.jobKey) return false;
    if (f.from && a.at.slice(0, 10) < f.from) return false;
    if (f.to && a.at.slice(0, 10) > f.to) return false;
    if (a.confidential && f.includeConfidential === false) return false;
    if (q && !`${a.title} ${a.summary} ${a.actor} ${TYPE_INFO[a.type].label} ${a.status || ""}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function dayLabel(day: string, today: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const long = `${DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MONTHS[m - 1]}${y === Number(today.slice(0, 4)) ? "" : ` ${y}`}`;
  const diff = Math.round((Date.UTC(...(today.split("-").map(Number) as [number, number, number]).map((v, i) => (i === 1 ? v - 1 : v)) as [number, number, number]) - Date.UTC(y, m - 1, d)) / 86400000);
  return diff === 0 ? `Today · ${long}` : diff === 1 ? `Yesterday · ${long}` : long;
}
export function groupByDay(list: Activity[], today: string): { day: string; label: string; items: Activity[] }[] {
  const out: { day: string; label: string; items: Activity[] }[] = [];
  for (const a of list) {
    const day = a.at.slice(0, 10);
    const last = out[out.length - 1];
    if (last && last.day === day) last.items.push(a);
    else out.push({ day, label: dayLabel(day, today), items: [a] });
  }
  return out;
}

// ------------------------------------------------------------------ the summary at the top

export type Summary = {
  lastContact?: Activity;
  nextAction?: { label: string; date: string; href?: string };
  openRequests: Activity[];
  overdueTasks: Row[];
  activeJobs: Row[];
  recentDocuments: Activity[];
  openQueries: Activity[];
};
export function summarise(clientKey: string, list: Activity[], s: Pick<Sources, "jobs" | "tasks">, today: string): Summary {
  const contact = new Set<ActivityType>(["email-in", "email-out", "call", "meeting", "conversation"]);
  const past = (a: Activity) => a.at.slice(0, 10) <= today;
  const lastContact = list.find((a) => contact.has(a.type) && past(a));
  const openRequests = list.filter((a) => a.type === "info-requested" && a.status !== "Received" && a.status !== "Closed");
  const openQueries = list.filter((a) => (a.type === "query" || a.type === "paper-note") && a.status === "Open");
  const tasks = s.tasks.filter((t) => t.ClientKey === clientKey && t.Status !== "Done" && t.Status !== "Cancelled");
  const overdueTasks = tasks.filter((t) => { const d = text(t.DueDate) || text(t.PlannedDate); return d && d < today; });
  const jobs = s.jobs.filter((j) => j.ClientKey === clientKey && j.Status !== "Complete" && j.Status !== "Done" && j.Status !== "Cancelled");
  const upcoming: { label: string; date: string; href?: string }[] = [];
  for (const t of tasks) { const d = text(t.PlannedDate); if (d && d >= today) upcoming.push({ label: text(t.Title), date: d, href: `#/clients/${encodeURIComponent(clientKey)}/work` }); }
  for (const j of jobs) { const d = text(j.PlannedDate); if (d && d >= today) upcoming.push({ label: text(j.Title) || "Job", date: d, href: `#/clients/${encodeURIComponent(clientKey)}/work` }); }
  for (const a of list) if (a.followUp && a.followUp >= today && a.status !== "Closed" && a.status !== "Done") upcoming.push({ label: `Follow up: ${a.title}`, date: a.followUp });
  upcoming.sort((a, b) => a.date.localeCompare(b.date));
  return {
    lastContact, nextAction: upcoming[0], openRequests, overdueTasks, activeJobs: jobs,
    recentDocuments: list.filter((a) => (a.type === "doc-created" || a.type === "letter") && past(a)).slice(0, 3), openQueries,
  };
}

// ------------------------------------------------------------------ for a future assistant

/**
 * What an assistant may be given about a client: structured, no confidential entries, no bodies (an event
 * only has a title, a short summary and a type), newest first, limited to the last `days` days.
 */
export function forAssistant(list: Activity[], o: { days?: number; today: string; includeConfidential?: boolean; limit?: number }) {
  const cutoff = o.days ? new Date(Date.parse(`${o.today}T00:00:00Z`) - o.days * 86400000).toISOString().slice(0, 10) : "";
  return list
    .filter((a) => (o.includeConfidential || !a.confidential) && (!cutoff || a.at.slice(0, 10) >= cutoff))
    .slice(0, o.limit ?? 200)
    .map((a) => ({ id: a.id, when: a.at, type: a.type, group: a.group, title: a.title, summary: a.summary, who: a.actor, status: a.status || "", job: a.jobKey || "", source: a.source, open: a.status === "Open" }));
}
