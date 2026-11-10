// Billing recorded time. An entry of billable time is either UNBILLED (nothing done yet), PENDING (put on an invoice being made, so nobody else
// bills it too), BILLED (on an invoice), WRITTEN OFF (all of its value given up) or WRITTEN DOWN (part given up, the rest billed in the usual way).
// Non-billable and internal time never appears here. Time on a job with a fixed fee is covered by the fee and is not billed by the hour.
//
// Every change goes in the append-only TimeEvents list with who, when, what it was and what it became, and a reason for a write-off or write-down.
// Nothing is deleted, and an entry already billed or written off cannot be put on another invoice or written off again.
import { Row } from "./schema";
import { Entry, Billable, Activity, billableOf, entryMinutes } from "./timesheet";
import { Rate, valueTime } from "./rates";

const s = (v: unknown) => String(v ?? "").trim();
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export type BillState = "unbilled" | "pending" | "billed" | "written_off" | "written_down";
export const BILL_LABEL: Record<BillState, string> = { unbilled: "Unbilled", pending: "On an invoice being made", billed: "Billed", written_off: "Written off", written_down: "Written down" };
export type Approval = "" | "submitted" | "approved" | "returned";

export type Rec = Entry & {
  bill: BillState; chargeOverride: number | undefined; writeDown: number; invoiceRef: string; billedAt: string;
  approval: Approval; reviewedBy: string; reviewedAt: string; reviewNote: string; created: string;
};
export const readRec = (r: Row, base: Entry): Rec => {
  const st = s(r.BillingStatus) as BillState;
  const ap = s(r.ApprovalStatus) as Approval;
  const co = s(r.ChargePence);
  return {
    ...base, bill: (["pending", "billed", "written_off", "written_down"] as string[]).includes(st) ? st : "unbilled", chargeOverride: co !== "" && num(co) >= 0 ? Math.round(num(co)) : undefined,
    writeDown: Math.max(0, Math.round(num(r.WriteDownPence))), invoiceRef: s(r.InvoiceRef), billedAt: s(r.BilledAt),
    approval: (["submitted", "approved", "returned"] as string[]).includes(ap) ? ap : "", reviewedBy: s(r.ReviewedBy), reviewedAt: s(r.ReviewedAt).slice(0, 19), reviewNote: s(r.ReviewNote), created: s(r.Created),
  };
};

export type JobInfo = { key: string; clientKey: string; serviceKey: string; fixedFeePence: number; title: string };
export type Ctx = { rates: Rate[]; activities: Activity[]; jobs: Map<string, JobInfo>; now: Date; roleOf: (user: string) => string };

/** Time that is paid for by a fixed fee: it is for a job that has one. */
export const inFixedFee = (e: Entry, jobs: Map<string, JobInfo>): boolean => !!e.jobKey && (jobs.get(e.jobKey)?.fixedFeePence || 0) > 0;
export const billableByTime = (e: Entry, c: Ctx): boolean => !!e.ended && billableOf(e, c.activities) === "billable" && !inFixedFee(e, c.jobs);

export function rateContext(e: Entry, c: Ctx) {
  const j = e.jobKey ? c.jobs.get(e.jobKey) : undefined;
  return { date: e.workDate, userKey: e.by, role: c.roleOf(e.by), serviceKey: j?.serviceKey || "", activityKey: e.activityKey, clientKey: e.clientKey || j?.clientKey || "", jobKey: e.jobKey };
}
/** What an entry is worth at the charge rate, less anything written down; a written-off entry is worth nothing. Fixed-fee and non-billable time is worth nothing by the hour. */
export function chargeValue(e: Rec, c: Ctx): { pence: number; gross: number; missingRate: boolean } {
  if (!billableByTime(e, c)) return { pence: 0, gross: 0, missingRate: false };
  const v = valueTime(c.rates, rateContext(e, c), entryMinutes(e, c.now), true, e.chargeOverride);
  return { gross: v.chargePence, pence: e.bill === "written_off" ? 0 : Math.max(0, v.chargePence - e.writeDown), missingRate: v.missingCharge };
}

// ------------------------------------------------------------------ the log

export type TimeEventType = "pending" | "released" | "billed" | "write_off" | "write_down" | "submit" | "approve" | "return" | "reopen" | "correct" | "delete";
export const TIME_EVENT_LABEL: Record<TimeEventType, string> = { pending: "Put on an invoice", released: "Taken off an invoice", billed: "Billed", write_off: "Written off", write_down: "Written down", submit: "Submitted for approval", approve: "Approved", return: "Returned", reopen: "Reopened", correct: "Changed after approval", delete: "Deleted" };
export type TimeEvent = { key: string; batchKey: string; entryKey: string; type: TimeEventType; previous: Record<string, unknown>; next: Record<string, unknown>; reason: string; created: string; createdBy: string };
export const timeEventRow = (e: TimeEvent, pid = ""): Row => ({ Key: e.key, PracticeId: pid, BatchKey: e.batchKey, EntryKey: e.entryKey, EventType: e.type, PreviousState: JSON.stringify(e.previous), NewState: JSON.stringify(e.next), Reason: e.reason, Created: e.created, CreatedBy: e.createdBy });
const parse = (v: string): Record<string, unknown> => { try { const o = JSON.parse(v); return o && typeof o === "object" ? o : {}; } catch { return {}; } };
export const readTimeEvent = (r: Row): TimeEvent => ({ key: s(r.Key), batchKey: s(r.BatchKey), entryKey: s(r.EntryKey), type: s(r.EventType) as TimeEventType, previous: parse(s(r.PreviousState)), next: parse(s(r.NewState)), reason: s(r.Reason), created: s(r.Created), createdBy: s(r.CreatedBy) });

export type Change = { patches: { key: string; patch: Row }[]; events: TimeEvent[]; problems: string[] };
type Mk = { user: string; now: Date; newKey: (p: string) => string; batch?: string };
const mkEvent = (m: Mk, batch: string, e: Rec, type: TimeEventType, previous: Record<string, unknown>, next: Record<string, unknown>, reason = ""): TimeEvent => ({ key: m.newKey("TE"), batchKey: batch, entryKey: e.key, type, previous, next, reason, created: m.now.toISOString(), createdBy: m.user });
const snap = (e: Rec) => ({ bill: e.bill, invoiceRef: e.invoiceRef, writeDown: e.writeDown });

/** Puts entries on an invoice being made. Only unbilled ones that are billable by the hour can go; one already pending, billed or written off is refused, which is what stops it being billed twice. */
export function markPending(entries: Rec[], c: Ctx, m: Mk): Change {
  const out: Change = { patches: [], events: [], problems: [] };
  const batch = m.batch || m.newKey("TB");
  for (const e of entries) {
    if (!billableByTime(e, c)) { out.problems.push(`${e.key}: not billable by the hour.`); continue; }
    if (e.bill !== "unbilled" && e.bill !== "written_down") { out.problems.push(`${e.key}: already ${BILL_LABEL[e.bill].toLowerCase()}.`); continue; }
    out.patches.push({ key: e.key, patch: { BillingStatus: "pending", Version: e.version + 1 } });
    out.events.push(mkEvent(m, batch, e, "pending", snap(e), { ...snap(e), bill: "pending" }));
  }
  return out;
}
/** Takes entries off an invoice that was not made. Only pending ones. */
export function release(entries: Rec[], m: Mk, reason = ""): Change {
  const out: Change = { patches: [], events: [], problems: [] };
  const batch = m.batch || m.newKey("TB");
  for (const e of entries) {
    if (e.bill !== "pending") { out.problems.push(`${e.key}: not waiting on an invoice.`); continue; }
    out.patches.push({ key: e.key, patch: { BillingStatus: e.writeDown > 0 ? "written_down" : "", Version: e.version + 1 } });
    out.events.push(mkEvent(m, batch, e, "released", snap(e), { ...snap(e), bill: e.writeDown > 0 ? "written_down" : "unbilled" }, reason));
  }
  return out;
}
/** Records that pending entries are on a real invoice (its number or reference is needed, so it can be found later). */
export function markBilled(entries: Rec[], invoiceRef: string, m: Mk): Change {
  const out: Change = { patches: [], events: [], problems: [] };
  if (!s(invoiceRef)) { out.problems.push("Say which invoice (its number or reference)."); return out; }
  const batch = m.batch || m.newKey("TB");
  for (const e of entries) {
    if (e.bill !== "pending") { out.problems.push(`${e.key}: only time on an invoice being made can be marked billed.`); continue; }
    out.patches.push({ key: e.key, patch: { BillingStatus: "billed", InvoiceRef: s(invoiceRef), BilledAt: m.now.toISOString(), Version: e.version + 1 } });
    out.events.push(mkEvent(m, batch, e, "billed", snap(e), { ...snap(e), bill: "billed", invoiceRef: s(invoiceRef) }));
  }
  return out;
}
/** Gives up the whole value of unbilled time. A reason is needed. */
export function writeOff(entries: Rec[], reason: string, m: Mk): Change {
  const out: Change = { patches: [], events: [], problems: [] };
  if (!s(reason)) { out.problems.push("Say why the time is being written off."); return out; }
  const batch = m.batch || m.newKey("TB");
  for (const e of entries) {
    if (e.bill !== "unbilled" && e.bill !== "written_down") { out.problems.push(`${e.key}: already ${BILL_LABEL[e.bill].toLowerCase()}.`); continue; }
    out.patches.push({ key: e.key, patch: { BillingStatus: "written_off", Version: e.version + 1 } });
    out.events.push(mkEvent(m, batch, e, "write_off", snap(e), { ...snap(e), bill: "written_off" }, s(reason)));
  }
  return out;
}
/** Gives up part of the value (pence), still billing the rest. Can't be more than the entry is worth, and a reason is needed. */
export function writeDown(e: Rec, pence: number, reason: string, c: Ctx, m: Mk): Change {
  const out: Change = { patches: [], events: [], problems: [] };
  const v = chargeValue(e, c);
  if (!s(reason)) out.problems.push("Say why the time is being written down.");
  if (e.bill !== "unbilled" && e.bill !== "written_down") out.problems.push(`Already ${BILL_LABEL[e.bill].toLowerCase()}.`);
  if (!(pence > 0) || !Number.isInteger(pence)) out.problems.push("An amount in pence above nothing.");
  else if (pence > v.gross - e.writeDown) out.problems.push("That is more than the time is worth.");
  if (out.problems.length) return out;
  const total = e.writeDown + pence, batch = m.batch || m.newKey("TB");
  out.patches.push({ key: e.key, patch: { BillingStatus: "written_down", WriteDownPence: total, Version: e.version + 1 } });
  out.events.push(mkEvent(m, batch, e, "write_down", snap(e), { ...snap(e), bill: "written_down", writeDown: total }, s(reason)));
  return out;
}

// ------------------------------------------------------------------ the billing review

export type ReviewLine = { clientKey: string; jobKey: string; entries: Rec[]; minutes: number; gross: number; pence: number; missingRate: number };
/** Unbilled (and written-down) time by client and job, with what it is worth: the list to work from when billing. */
export function billingReview(recs: Rec[], c: Ctx, from = "", to = "9999-12-31"): ReviewLine[] {
  const by = new Map<string, ReviewLine>();
  for (const e of recs) {
    if (!billableByTime(e, c) || (e.bill !== "unbilled" && e.bill !== "written_down") || e.workDate < from || e.workDate > to) continue;
    const k = `${e.clientKey}|${e.jobKey}`;
    const l = by.get(k) || { clientKey: e.clientKey, jobKey: e.jobKey, entries: [], minutes: 0, gross: 0, pence: 0, missingRate: 0 };
    const v = chargeValue(e, c);
    l.entries.push(e); l.minutes += entryMinutes(e, c.now); l.gross += v.gross; l.pence += v.pence; if (v.missingRate) l.missingRate++;
    by.set(k, l);
  }
  return [...by.values()].sort((a, b) => a.clientKey.localeCompare(b.clientKey) || a.jobKey.localeCompare(b.jobKey));
}
export type Totals = Record<BillState, { minutes: number; pence: number }>;
export function billingTotals(recs: Rec[], c: Ctx): Totals {
  const t = Object.fromEntries((Object.keys(BILL_LABEL) as BillState[]).map((k) => [k, { minutes: 0, pence: 0 }])) as Totals;
  for (const e of recs) {
    if (!billableByTime(e, c)) continue;
    const v = chargeValue(e, c);
    t[e.bill].minutes += entryMinutes(e, c.now);
    t[e.bill].pence += e.bill === "written_off" ? v.gross : v.pence;
  }
  return t;
}
export type { Billable };
