// The practice's own regulatory risk: the firm's recurring dates, data requests, breaches and complaints, ceasing a client and
// reviewing its records for deletion, a practice-wide AML picture, and one audit trail over the logs the app keeps.
// The app records decisions and deadlines. It never deletes data and never contacts the ICO, a client or anyone else.
import { position } from "./amlAssessment";
import { daysBetween } from "./domain";
import { ProposalAction } from "./proposals";
import { addDays, addMonths } from "./planning";
import { Ctx, Written, activityRow } from "./sales";
import { Row } from "./schema";

const str = (v: unknown): string => (v === undefined || v === null ? "" : String(v));
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const NO = "Only a manager or partner can do that.";
const fmt = (d: string) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "");

// ------------------------------------------------------------------ requests, breaches and complaints

export type Kind = "sar" | "erasure" | "breach" | "complaint";
export const KINDS: { key: Kind; label: string; rule: string }[] = [
  { key: "sar", label: "Data access request", rule: "one month to reply (can be extended by two months for complex requests)" },
  { key: "erasure", label: "Erasure request", rule: "one month to reply" },
  { key: "breach", label: "Personal data breach", rule: "72 hours to tell the ICO if people could be harmed" },
  { key: "complaint", label: "Complaint", rule: "eight weeks for a full reply" },
];
export const kindLabel = (k: string) => KINDS.find((x) => x.key === k)?.label || k;
/** The usual deadline for a kind of entry, counted from the day it was received (a breach, from the day the practice became aware). */
export function dueFor(kind: Kind, opened: string): string {
  return kind === "breach" ? addDays(opened, 3) : kind === "complaint" ? addDays(opened, 56) : addMonths(opened, 1, false);
}
export type Reported = "" | "yes" | "no-risk";
export type Entry = { key: string; kind: Kind; clientKey: string; person: string; opened: string; due: string; status: "open" | "closed"; owner: string; summary: string; outcome: string; closed: string; reported: Reported };
export const readEntry = (r: Row): Entry => ({
  key: str(r.Key), kind: (["sar", "erasure", "breach", "complaint"] as const).find((k) => k === str(r.Kind)) || "complaint", clientKey: str(r.ClientKey), person: str(r.Person), opened: str(r.Opened), due: str(r.Due),
  status: str(r.Status) === "closed" ? "closed" : "open", owner: str(r.Owner), summary: str(r.Summary), outcome: str(r.Outcome), closed: str(r.Closed), reported: str(r.Reported) === "yes" ? "yes" : str(r.Reported) === "no-risk" ? "no-risk" : "",
});
export const isEntryKind = (r: Row) => ["sar", "erasure", "breach", "complaint"].includes(str(r.Kind));
export type EntryState = "closed" | "overdue" | "soon" | "open";
export function entryState(e: Entry, today: string): { state: EntryState; days: number } {
  if (e.status === "closed") return { state: "closed", days: 0 };
  const days = e.due ? daysBetween(today, e.due) : 99;
  return { state: days < 0 ? "overdue" : days <= (e.kind === "breach" ? 1 : 7) ? "soon" : "open", days };
}
/** A breach nobody has yet decided whether to report. */
export const breachUndecided = (e: Entry) => e.kind === "breach" && e.status === "open" && e.reported === "";

export type EntryInput = { kind: Kind; clientKey: string; person: string; opened: string; due: string; owner: string; summary: string };
export function openEntry(i: EntryInput, today: string, can: (x: ProposalAction) => boolean, o: Ctx): Written | { error: string } {
  if (!can("send")) return { error: NO };
  if (!isDate(i.opened)) return { error: "Give the date it was received." };
  if (i.opened > today) return { error: "That date is in the future." };
  if (!i.summary.trim()) return { error: i.kind === "breach" ? "Say what happened." : i.kind === "complaint" ? "Say what the complaint is." : "Say what is being asked for." };
  const due = i.due && isDate(i.due) ? i.due : dueFor(i.kind, i.opened);
  if (due < i.opened) return { error: "The deadline can't be before the day it was received." };
  const row: Row = { Key: o.newKey("CL"), PracticeId: o.pid, Kind: i.kind, ClientKey: i.clientKey, Person: i.person.trim(), Opened: i.opened, Due: due, Status: "open", Owner: i.owner.trim() || o.actor, Summary: i.summary.trim(), Outcome: "", Closed: "", Reported: "", Decision: "", ReviewOn: "", Created: o.now, CreatedBy: o.actor };
  return { patches: [], creates: [{ list: "ComplianceLog", row }], log: [], activities: i.clientKey ? [activityRow(o, "compliance", `${kindLabel(i.kind)} logged`, undefined, { clientKey: i.clientKey }, i.summary.trim().slice(0, 200))] : [] };
}
export function closeEntry(row: Row, i: { outcome: string; reported: Reported }, today: string, can: (x: ProposalAction) => boolean): Written | { error: string } {
  if (!can("send")) return { error: NO };
  const e = readEntry(row);
  if (e.status === "closed") return { error: "Already closed." };
  if (!i.outcome.trim()) return { error: "Say how it was dealt with." };
  const reported = i.reported || e.reported;
  if (e.kind === "breach" && !reported) return { error: "Record whether the ICO was told, or that it was not needed because people were unlikely to be harmed." };
  return { patches: [{ list: "ComplianceLog", row, patch: { Status: "closed", Outcome: i.outcome.trim(), Closed: today, Reported: reported } }], log: [], activities: [] };
}
export function setReported(row: Row, reported: Reported, can: (x: ProposalAction) => boolean): Written | { error: string } {
  if (!can("send")) return { error: NO };
  if (readEntry(row).kind !== "breach") return { error: "That only applies to a breach." };
  return { patches: [{ list: "ComplianceLog", row, patch: { Reported: reported } }], log: [], activities: [] };
}
export function changeDue(row: Row, due: string, can: (x: ProposalAction) => boolean): Written | { error: string } {
  if (!can("send")) return { error: NO };
  if (!isDate(due)) return { error: "Give a date." };
  if (due < readEntry(row).opened) return { error: "The deadline can't be before the day it was received." };
  return { patches: [{ list: "ComplianceLog", row, patch: { Due: due } }], log: [], activities: [] };
}

// ------------------------------------------------------------------ the practice's own dates

export type Repeat = "none" | "yearly" | "6months" | "quarterly" | "monthly";
export const REPEATS: [Repeat, string][] = [["yearly", "Every year"], ["6months", "Every 6 months"], ["quarterly", "Every 3 months"], ["monthly", "Every month"], ["none", "Once"]];
const REPEAT_MONTHS: Record<Repeat, number> = { none: 0, yearly: 12, "6months": 6, quarterly: 3, monthly: 1 };
export type Obligation = { key: string; title: string; kind: string; due: string; repeat: Repeat; owner: string; status: "active" | "done" | "ended"; lastDone: string; notes: string };
export const readObligation = (r: Row): Obligation => ({
  key: str(r.Key), title: str(r.Title), kind: str(r.Kind), due: str(r.Due), repeat: (["yearly", "6months", "quarterly", "monthly"] as const).find((x) => x === str(r.Repeat)) || "none", owner: str(r.Owner),
  status: str(r.Status) === "done" ? "done" : str(r.Status) === "ended" ? "ended" : "active", lastDone: str(r.LastDone), notes: str(r.Notes),
});
export const SOON_DAYS = 30;
export type ObState = "undated" | "overdue" | "soon" | "ok" | "closed";
export function obligationState(o: Obligation, today: string): { state: ObState; days: number } {
  if (o.status !== "active") return { state: "closed", days: 0 };
  if (!isDate(o.due)) return { state: "undated", days: 0 };
  const days = daysBetween(today, o.due);
  return { state: days < 0 ? "overdue" : days <= SOON_DAYS ? "soon" : "ok", days };
}
export const STARTER_OBLIGATIONS: { title: string; kind: string; repeat: Repeat; notes: string }[] = [
  { title: "Professional indemnity insurance renewal", kind: "insurance", repeat: "yearly", notes: "Cover must be in force at all times." },
  { title: "ICO data protection fee", kind: "registration", repeat: "yearly", notes: "Paid to the Information Commissioner's Office each year." },
  { title: "AML supervision registration and annual return", kind: "registration", repeat: "yearly", notes: "With the practice's anti-money laundering supervisor." },
  { title: "Firm-wide AML risk assessment review", kind: "review", repeat: "yearly", notes: "The written risk assessment of the whole practice, kept up to date." },
  { title: "Staff AML and data protection training", kind: "training", repeat: "yearly", notes: "Record who attended and when." },
  { title: "CPD record review", kind: "training", repeat: "yearly", notes: "Check everyone's professional body hours." },
  { title: "HMRC agent services account and authorisations check", kind: "review", repeat: "yearly", notes: "Remove access for anyone who has left." },
  { title: "Data protection and retention policy review", kind: "review", repeat: "yearly", notes: "" },
  { title: "Complaints procedure review", kind: "review", repeat: "yearly", notes: "" },
  { title: "Backup restore test", kind: "backup", repeat: "quarterly", notes: "Open the latest backup and check a client's records are in it." },
];
/** The usual obligations not yet in the list (matched by title), as new rows with the date left blank for the practice to fill in. */
export function addStarters(existing: Row[], can: (x: ProposalAction) => boolean, o: Ctx): Written | { error: string } {
  if (!can("send")) return { error: NO };
  const have = new Set(existing.map((r) => str(r.Title).toLowerCase()));
  const fresh = STARTER_OBLIGATIONS.filter((s) => !have.has(s.title.toLowerCase()));
  if (!fresh.length) return { error: "The usual list is already there." };
  return { patches: [], creates: fresh.map((s) => ({ list: "Obligations" as const, row: { Key: o.newKey("OB"), PracticeId: o.pid, Title: s.title, Kind: s.kind, Due: "", Repeat: s.repeat, Owner: "", Status: "active", LastDone: "", Notes: s.notes, Created: o.now, CreatedBy: o.actor } })), log: [], activities: [] };
}
export function addObligation(i: { title: string; kind: string; due: string; repeat: Repeat; owner: string; notes: string }, can: (x: ProposalAction) => boolean, o: Ctx): Written | { error: string } {
  if (!can("send")) return { error: NO };
  if (!i.title.trim()) return { error: "Say what it is." };
  if (i.due && !isDate(i.due)) return { error: "Give the date as day, month and year." };
  return { patches: [], creates: [{ list: "Obligations", row: { Key: o.newKey("OB"), PracticeId: o.pid, Title: i.title.trim(), Kind: i.kind || "other", Due: i.due, Repeat: i.repeat, Owner: i.owner.trim(), Status: "active", LastDone: "", Notes: i.notes.trim(), Created: o.now, CreatedBy: o.actor } }], log: [], activities: [] };
}
/** The next date after `after` (and after `due`), stepping from the old date so the anniversary stays put. */
export function nextDue(due: string, repeat: Repeat, after: string): string {
  const step = REPEAT_MONTHS[repeat];
  if (!step || !isDate(due)) return "";
  let d = addMonths(due, step, false); // marking it done always moves it on at least one step, even when done early
  for (let n = 0; n < 600 && d <= after; n++) d = addMonths(d, step, false);
  return d;
}
export function completeObligation(row: Row, doneOn: string, can: (x: ProposalAction) => boolean): Written | { error: string } {
  if (!can("send")) return { error: NO };
  if (!isDate(doneOn)) return { error: "Give the date it was done." };
  const ob = readObligation(row);
  if (ob.status !== "active") return { error: "That one is finished." };
  const next = nextDue(ob.due || doneOn, ob.repeat, doneOn);
  return { patches: [{ list: "Obligations", row, patch: next ? { Due: next, LastDone: doneOn } : { Status: "done", LastDone: doneOn } }], log: [], activities: [] };
}
export function setObligation(row: Row, patch: { due?: string; owner?: string; repeat?: Repeat; ended?: boolean }, can: (x: ProposalAction) => boolean): Written | { error: string } {
  if (!can("send")) return { error: NO };
  const p: Row = {};
  if (patch.due !== undefined) { if (patch.due && !isDate(patch.due)) return { error: "Give the date as day, month and year." }; p.Due = patch.due; }
  if (patch.owner !== undefined) p.Owner = patch.owner.trim();
  if (patch.repeat !== undefined) p.Repeat = patch.repeat;
  if (patch.ended !== undefined) p.Status = patch.ended ? "ended" : "active";
  return { patches: [{ list: "Obligations", row, patch: p }], log: [], activities: [] };
}

// ------------------------------------------------------------------ ceasing a client and reviewing its records

export const DEFAULT_RETENTION_YEARS = 6;
export const MIN_RETENTION_YEARS = 5; // money laundering records: five years after the relationship ends
export const RETENTION_KEY = "compliance.retentionYears";
export const readRetentionYears = (v: unknown): number => { const n = Math.floor(num(v)); return n >= MIN_RETENTION_YEARS && n <= 30 ? n : DEFAULT_RETENTION_YEARS; };
export const clientRetentionYears = (c: Row, practiceYears: number): number => { const n = Math.floor(num(c.RetentionYears)); return n >= MIN_RETENTION_YEARS && n <= 30 ? n : practiceYears; };
export const isCeased = (c: Row) => str(c.Status) === "Archived";
export const DATA_PLACES = ["The client record and its notes, papers and jobs in the planner", "The client's folder in OneDrive and any emails kept for them", "Xero, the accounting file and the practice's invoices to them (only what the law no longer requires)", "Xama, the client's AML record", "The client portal and anything shared through it", "Paper files and any scanned identity documents"];

export function ceaseClient(client: Row, on: string, reason: string, today: string, can: (x: ProposalAction) => boolean, o: Ctx): Written | { error: string } {
  if (!can("send")) return { error: NO };
  if (isCeased(client)) return { error: "This client has already ceased." };
  if (!isDate(on)) return { error: "Give the last day the practice acted." };
  if (on > today) return { error: "That date is in the future. Mark the client as ceased on or after the last day you act." };
  if (!reason.trim()) return { error: "Say why they are leaving." };
  return { patches: [{ list: "Clients", row: client, patch: { Status: "Archived", CeasedOn: on, CeasedReason: reason.trim() } }], log: [], activities: [activityRow(o, "client-ceased", `Client ceased: ${client.Title}`, undefined, { clientKey: str(client.Key) }, `Last day ${fmt(on)}: ${reason.trim()}`)] };
}
export function reinstateClient(client: Row, can: (x: ProposalAction) => boolean, o: Ctx): Written | { error: string } {
  if (!can("send")) return { error: NO };
  if (!isCeased(client)) return { error: "This client hasn't ceased." };
  return { patches: [{ list: "Clients", row: client, patch: { Status: "", CeasedOn: "", CeasedReason: "" } }], log: [], activities: [activityRow(o, "client-ceased", `Client reinstated: ${client.Title}`, undefined, { clientKey: str(client.Key) }, "Ceased status removed")] };
}

export type RetentionState = "held" | "soon" | "due" | "approved" | "done";
export type RetentionRow = { clientKey: string; ceasedOn: string; reason: string; years: number; reviewOn: string; state: RetentionState; days: number; note: string; decidedBy: string; decidedOn: string };
export const RETENTION_SOON_DAYS = 90;
const isRetention = (r: Row) => str(r.Kind) === "retention";
/** Ceased clients with the date their records can be reviewed, and what has been decided so far. */
export function retentionRows(clients: Row[], log: Row[], practiceYears: number, today: string): RetentionRow[] {
  return clients.filter((c) => isCeased(c) && isDate(str(c.CeasedOn))).map((c) => {
    const ck = str(c.Key), years = clientRetentionYears(c, practiceYears);
    const mine = log.filter((r) => isRetention(r) && str(r.ClientKey) === ck).sort((a, b) => str(b.Created).localeCompare(str(a.Created)));
    const keep = mine.find((r) => str(r.Decision) === "keep");
    const last = mine[0];
    const base = addMonths(str(c.CeasedOn), years * 12, false);
    // a later "keep" moves the review date on; anything decided after it (approve, deleted) wins
    const reviewOn = keep && isDate(str(keep.ReviewOn)) && str(keep.ReviewOn) > base ? str(keep.ReviewOn) : base;
    const days = daysBetween(today, reviewOn);
    const decision = str(last?.Decision);
    const state: RetentionState = decision === "deleted" ? "done" : decision === "delete" ? "approved" : days < 0 || days === 0 ? "due" : days <= RETENTION_SOON_DAYS ? "soon" : "held";
    return { clientKey: ck, ceasedOn: str(c.CeasedOn), reason: str(c.CeasedReason), years, reviewOn, state, days, note: str(last?.Summary), decidedBy: str(last?.CreatedBy), decidedOn: str(last?.Created).slice(0, 10) };
  }).sort((a, b) => a.reviewOn.localeCompare(b.reviewOn));
}
export function retentionDecision(client: Row, row: RetentionRow | undefined, decision: "keep" | "delete" | "deleted", i: { note: string; reviewOn: string }, today: string, can: (x: ProposalAction) => boolean, o: Ctx): Written | { error: string } {
  if (!can("send")) return { error: NO };
  if (!row) return { error: "This client hasn't been marked as ceased." };
  if (row.state === "done") return { error: "This client's records have already been deleted." };
  if (decision === "deleted" && row.state !== "approved") return { error: "Approve the deletion first." };
  if (decision !== "deleted" && row.state === "approved") return { error: "Deletion is already approved. Mark it deleted once it is done, or reinstate the client." };
  if (decision !== "deleted" && row.reviewOn > today) return { error: `The records can't be reviewed until ${fmt(row.reviewOn)}.` };
  if (decision === "keep") {
    if (!i.note.trim()) return { error: "Say why the records are being kept (for example a dispute, an investigation or a legal duty)." };
    if (!isDate(i.reviewOn) || i.reviewOn <= today) return { error: "Give a date in the future to look at them again." };
  }
  if (decision === "delete" && !i.note.trim()) return { error: "Note who checked that nothing needs keeping." };
  const summary = decision === "deleted" ? (i.note.trim() || "Records deleted") : i.note.trim();
  const row2: Row = { Key: o.newKey("CL"), PracticeId: o.pid, Kind: "retention", ClientKey: str(client.Key), Person: "", Opened: today, Due: "", Status: decision === "delete" ? "open" : "closed", Owner: o.actor, Summary: summary, Outcome: "", Closed: decision === "delete" ? "" : today, Reported: "", Decision: decision, ReviewOn: decision === "keep" ? i.reviewOn : "", Created: o.now, CreatedBy: o.actor };
  const title = decision === "keep" ? "Records kept after review" : decision === "delete" ? "Deletion of records approved" : "Records deleted";
  return { patches: [], creates: [{ list: "ComplianceLog", row: row2 }], log: [], activities: [activityRow(o, "retention", `${title}: ${client.Title}`, undefined, { clientKey: str(client.Key) }, summary.slice(0, 200))] };
}

// ------------------------------------------------------------------ AML across the practice

export type AmlRow = { clientKey: string; state: ReturnType<typeof position>["state"]; risk: string; reviewDate: string; days: number | null };
export function amlTable(clients: Row[], assessments: Row[], onboardings: Row[], today: string): AmlRow[] {
  return clients.filter((c) => !isCeased(c)).map((c) => { const p = position(c, assessments, onboardings, today); return { clientKey: str(c.Key), state: p.state, risk: str(p.risk), reviewDate: p.reviewDate, days: p.daysToReview }; });
}

// ------------------------------------------------------------------ the risk register

export type Level = "red" | "amber" | "green";
export type RiskLine = { key: string; label: string; count: number; level: Level; detail: string; to: string };
export type BackupLast = { at: string } | undefined;
export type RiskInput = { clients: Row[]; log: Row[]; obligations: Row[]; assessments: Row[]; onboardings: Row[]; backupLast: BackupLast; backupFailed?: { at: string }; practiceYears: number; today: string };
export function riskRegister(i: RiskInput): { lines: RiskLine[]; overall: Level } {
  const t = i.today;
  const obs = i.obligations.map(readObligation).filter((o) => o.status === "active");
  const obState = obs.map((o) => ({ o, ...obligationState(o, t) }));
  const od = obState.filter((x) => x.state === "overdue"), soon = obState.filter((x) => x.state === "soon"), undated = obState.filter((x) => x.state === "undated");
  const entries = i.log.filter(isEntryKind).map(readEntry).filter((e) => e.status === "open");
  const eState = entries.map((e) => ({ e, ...entryState(e, t) }));
  const eOver = eState.filter((x) => x.state === "overdue"), eSoon = eState.filter((x) => x.state === "soon");
  const undecided = entries.filter(breachUndecided);
  const active = i.clients.filter((c) => !isCeased(c));
  const aml = amlTable(i.clients, i.assessments, i.onboardings, t);
  const gaps = aml.filter((a) => a.state === "none" || a.state === "declined" || a.state === "overdue");
  const soonAml = aml.filter((a) => a.state === "soon");
  const noLetter = active.filter((c) => str(c.LoEStatus) !== "Finalised");
  const ret = retentionRows(i.clients, i.log, i.practiceYears, t);
  const retDue = ret.filter((r) => r.state === "due"), retSoon = ret.filter((r) => r.state === "soon");
  const lvl = (red: number, amber = 0): Level => (red > 0 ? "red" : amber > 0 ? "amber" : "green");
  const backupDays = i.backupLast ? daysBetween(i.backupLast.at.slice(0, 10), t) : undefined;
  const restore = obs.filter((o) => o.kind === "backup").map((o) => o.lastDone).filter(isDate).sort().pop();
  const restoreDays = restore ? daysBetween(restore, t) : undefined;
  const lines: RiskLine[] = [
    { key: "obligations", label: "The practice's own dates", count: od.length + soon.length, level: lvl(od.length, soon.length + undated.length), detail: od.length ? `${od.length} overdue: ${od.slice(0, 3).map((x) => x.o.title).join(", ")}` : soon.length ? `${soon.length} due within ${SOON_DAYS} days` : undated.length ? `${undated.length} have no date yet` : obs.length ? "All up to date" : "None set up yet", to: "#/compliance/obligations" },
    { key: "requests", label: "Requests, breaches and complaints", count: eOver.length + eSoon.length, level: lvl(eOver.length, eSoon.length + entries.length), detail: eOver.length ? `${eOver.length} past the deadline` : eSoon.length ? `${eSoon.length} due this week` : entries.length ? `${entries.length} open, none urgent` : "None open", to: "#/compliance/requests" },
    { key: "breaches", label: "Breaches not yet decided on", count: undecided.length, level: lvl(undecided.length), detail: undecided.length ? "Decide whether the ICO must be told (72 hours)" : "None", to: "#/compliance/requests" },
    { key: "aml", label: "Clients with an AML gap", count: gaps.length, level: lvl(gaps.length, soonAml.length), detail: gaps.length ? `${aml.filter((a) => a.state === "none" || a.state === "declined").length} with no approved assessment, ${aml.filter((a) => a.state === "overdue").length} overdue` : soonAml.length ? `${soonAml.length} reviews due within 60 days` : "None", to: "#/compliance/aml" },
    { key: "letters", label: "Engagement letters not signed", count: noLetter.length, level: lvl(0, noLetter.length), detail: noLetter.length ? `${noLetter.length} of ${active.length} active clients` : "All signed", to: "#/clients/all" },
    { key: "retention", label: "Ceased clients' records to review", count: retDue.length + retSoon.length, level: lvl(retDue.length, retSoon.length), detail: retDue.length ? `${retDue.length} past their retention period` : retSoon.length ? `${retSoon.length} within 90 days` : ret.length ? "None due" : "No ceased clients recorded", to: "#/compliance/retention" },
    { key: "backup", label: "Backups", count: backupDays === undefined || backupDays > 2 ? 1 : 0, level: backupDays === undefined || backupDays > 7 ? "red" : backupDays > 2 || i.backupFailed ? "amber" : "green", detail: backupDays === undefined ? "No backup has been made" : `Last backup ${backupDays === 0 ? "today" : `${backupDays} days ago`}`, to: "#/settings/backups" },
    { key: "restore", label: "Backup restore test", count: restoreDays === undefined || restoreDays > 120 ? 1 : 0, level: restoreDays !== undefined && restoreDays > 240 ? "red" : restoreDays === undefined || restoreDays > 120 ? "amber" : "green", detail: restoreDays === undefined ? "No test recorded. Add 'Backup restore test' to the dates and mark it done after opening a backup." : `Last tested ${restoreDays} days ago`, to: "#/compliance/obligations" },
  ];
  return { lines, overall: lines.some((l) => l.level === "red") ? "red" : lines.some((l) => l.level === "amber") ? "amber" : "green" };
}

// ------------------------------------------------------------------ one audit trail

export type AuditArea = "Sales" | "Fees" | "Checklists" | "Chasing" | "Compliance";
export type AuditItem = { key: string; at: string; actor: string; area: AuditArea; action: string; clientKey: string; detail: string };
const brief = (v: unknown): string => {
  const s = str(v);
  if (!s || s === "null") return "";
  let out = s;
  try { const j = JSON.parse(s); if (j && typeof j === "object") out = Object.entries(j).map(([k, x]) => `${k}: ${typeof x === "object" ? JSON.stringify(x) : x}`).join(", "); } catch { /* plain text */ }
  return out.length > 220 ? `${out.slice(0, 217)}...` : out;
};
export function auditTrail(i: { salesLog: Row[]; feeHistory: Row[]; checklistLog: Row[]; billingChases: Row[]; complianceLog: Row[] }): AuditItem[] {
  const out: AuditItem[] = [];
  for (const r of i.salesLog) out.push({ key: str(r.Key), at: str(r.At), actor: str(r.Actor), area: "Sales", action: `${str(r.Action)} ${str(r.EntityType)}`.trim(), clientKey: str(r.ClientKey), detail: brief(r.Detail) });
  for (const r of i.feeHistory) out.push({ key: str(r.Key), at: str(r.At), actor: str(r.Actor), area: "Fees", action: str(r.Action), clientKey: str(r.ClientKey), detail: [str(r.Reason), brief(r.Old) && `from ${brief(r.Old)}`, brief(r.New) && `to ${brief(r.New)}`].filter(Boolean).join("; ") });
  for (const r of i.checklistLog) out.push({ key: str(r.Key), at: str(r.At), actor: str(r.Actor), area: "Checklists", action: str(r.Action), clientKey: str(r.ClientKey), detail: brief(r.Detail) });
  for (const r of i.billingChases) out.push({ key: str(r.Key), at: str(r.At), actor: str(r.Actor), area: "Chasing", action: str(r.Kind), clientKey: str(r.ClientKey), detail: [str(r.InvoiceNos), str(r.Note), str(r.PromiseOn) && `pay by ${str(r.PromiseOn)}`].filter(Boolean).join("; ") });
  for (const r of i.complianceLog) out.push({ key: str(r.Key), at: str(r.Created), actor: str(r.CreatedBy), area: "Compliance", action: isEntryKind(r) ? `${kindLabel(str(r.Kind))} ${str(r.Status)}` : `${str(r.Kind)} ${str(r.Decision)}`.trim(), clientKey: str(r.ClientKey), detail: [str(r.Summary), str(r.Outcome)].filter(Boolean).join("; ").slice(0, 220) });
  return out.filter((x) => x.at).sort((a, b) => b.at.localeCompare(a.at));
}
export type AuditFilter = { area?: string; actor?: string; q?: string; from?: string; to?: string; clientKey?: string };
export function filterAudit(rows: AuditItem[], f: AuditFilter, nameOf: (k: string) => string = (k) => k): AuditItem[] {
  const q = (f.q || "").trim().toLowerCase();
  return rows.filter((r) => (!f.area || r.area === f.area) && (!f.actor || r.actor === f.actor) && (!f.clientKey || r.clientKey === f.clientKey) && (!f.from || r.at.slice(0, 10) >= f.from) && (!f.to || r.at.slice(0, 10) <= f.to)
    && (!q || `${r.action} ${r.detail} ${r.actor} ${nameOf(r.clientKey)}`.toLowerCase().includes(q)));
}
const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
export function auditCsv(rows: AuditItem[], nameOf: (k: string) => string): string {
  return ["When,Who,Area,Action,Client,Detail", ...rows.map((r) => [r.at, r.actor, r.area, r.action, nameOf(r.clientKey), r.detail].map(csvCell).join(","))].join("\r\n");
}
