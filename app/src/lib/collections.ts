// From invoice to money in the bank. Billing (lib/billing.ts) makes recurring invoices; this adds the rest of the chain:
//  - invoicing an agreed one-off charge (an Adfin payment request, delivered by a person, never sent by the app);
//  - seeing what is paid, owed and overdue across the whole practice (read from Xero, which holds every invoice);
//  - chasing overdue invoices with a ladder of reminders, promises to pay and disputes, all as Outlook drafts and a log;
//  - collection health (direct debit billing with no working mandate) and billed-against-agreed-fee checks.
// The app never edits an invoice, marks one paid or writes one off: that stays in Xero and Adfin.
import { AdfinApi, AdfinCustomer } from "./adfin";
import { AdfinSettings, BillingLink, isLive, mandateOf, readLink } from "./billing";
import { readCharge, readFeeLine } from "./fees";
import { ProposalAction } from "./proposals";
import { Ctx, Written, activityRow } from "./sales";
import { Row } from "./schema";
import { XeroApi } from "./xero";
import { InvoiceRow, parseInvoice } from "./xeroInvoices";

const str = (v: unknown): string => (v === undefined || v === null ? "" : String(v));
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r2 = (n: number) => Math.round(n * 100) / 100;
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
const NO = "Only a manager or partner can do that.";
const gbp = (n: number) => "£" + n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (d: string) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "");

// ------------------------------------------------------------------ invoicing an agreed one-off charge

export type BillState = "none" | "draft" | "unpaid" | "paid" | "void";
export type ChargeBill = { id: string; no: string; url: string; status: BillState; billedOn: string; paidOn: string; amount: number; customer: string };
export const BILL_LABEL: Record<BillState, string> = { none: "Not invoiced", draft: "Draft in Adfin", unpaid: "Invoiced, awaiting payment", paid: "Paid", void: "Voided" };
export function readChargeBill(r: Row): ChargeBill {
  const s = str(r.BillStatus);
  return { id: str(r.BillId), no: str(r.BillNo), url: str(r.BillUrl), status: !str(r.BillId) ? "none" : (["draft", "unpaid", "paid", "void"] as const).find((x) => x === s) || "unpaid", billedOn: str(r.BilledOn), paidOn: str(r.PaidOn), amount: num(r.BillAmount), customer: str(r.BillCustomer) };
}
const fromRequest = (s: string): BillState => { const u = s.toUpperCase(); return u === "PAID" || u === "SETTLED" ? "paid" : u === "VOID" || u === "VOIDED" ? "void" : u === "DRAFT" ? "draft" : "unpaid"; };
/** A charge that is agreed, has not been invoiced (or the invoice was voided), and is waiting to be billed. */
export const toInvoice = (charges: Row[]): Row[] => charges.filter((r) => { const c = readCharge(r); const b = readChargeBill(r); return c.status === "agreed" && c.amount > 0 && (b.status === "none" || b.status === "void"); });

export type ChargeBillInput = { charge: Row; clientName: string; customerId: string; customerName: string; settings: AdfinSettings; today: string };
export const chargeVatRate = (vat: string, s: AdfinSettings) => (vat === "standard" ? s.vatRate : 0);
export const chargeGross = (net: number, rate: number) => r2(net * (1 + rate / 100));

export function chargeProblems(i: ChargeBillInput): string[] {
  const out: string[] = [];
  const c = readCharge(i.charge), b = readChargeBill(i.charge);
  if (c.status === "proposed") out.push("This charge is waiting for approval. Approve it first.");
  else if (c.status === "cancelled") out.push("This charge has been cancelled.");
  if (b.status !== "none" && b.status !== "void") out.push(`This charge has already been invoiced (${b.no || "payment request"}). Void it in Adfin first if it has to be redone.`);
  if (!(c.amount > 0)) out.push("The charge has to be more than nothing.");
  if (c.vat !== "standard" && c.vat !== "zero") out.push(c.vat ? "Exempt and outside-the-scope charges can't be invoiced here yet, because Adfin needs a matching tax rate. Invoice it in Xero." : "Record the VAT treatment on the charge first (standard or zero rated).");
  if (!i.customerId) out.push("Choose the Adfin customer for this client (on the fee schedule, under Billing through Adfin).");
  if (!c.label.trim()) out.push("Say what the charge is for.");
  return out;
}

/** The reference Adfin shows: letters, digits, spaces and full stops only, 22 characters at most. */
export const paymentReference = (charge: Row) => `PP ${str(charge.Key)}`.replace(/[^A-Za-z0-9 .]/g, "").slice(0, 22);

/** The request for Adfin's POST /payment_requests: the total INCLUDING VAT with the tax rate, pay-by date from the days-to-pay setting. */
export function paymentRequestBody(i: ChargeBillInput) {
  const c = readCharge(i.charge);
  const rate = chargeVatRate(c.vat, i.settings);
  return { customer: { id: i.customerId }, description: c.label.trim().slice(0, 200), currencyCode: "GBP", totalAmount: chargeGross(c.amount, rate), taxRate: rate, reference: paymentReference(i.charge), payByDate: addDays(i.today, i.settings.termDays) };
}

export function invoiceSummary(i: ChargeBillInput): string {
  const c = readCharge(i.charge);
  const rate = chargeVatRate(c.vat, i.settings);
  return `${i.clientName} will be invoiced ${gbp(c.amount)}${rate ? ` + VAT (${gbp(chargeGross(c.amount, rate))} in all)` : " (no VAT)"} for "${c.label}", payable by ${fmt(addDays(i.today, i.settings.termDays))}. Adfin makes a payment link; you send it to the client from an Outlook draft after checking it.`;
}

type PaymentRequest = { id: string; status?: string; reference?: string; paymentLink?: { url?: string }; totalAmount?: number };
export async function invoiceCharge(api: AdfinApi, client: Row, i: ChargeBillInput, can: (x: ProposalAction) => boolean, o: Ctx): Promise<Written | { error: string }> {
  if (!can("send")) return { error: NO };
  const bad = chargeProblems(i);
  if (bad.length) return { error: bad[0] };
  let r: PaymentRequest;
  try { r = await api.call<PaymentRequest>("POST", "payment_requests", { body: paymentRequestBody(i) }); } catch (e) { return { error: e instanceof Error ? e.message : "Adfin didn't accept that." }; }
  if (!r?.id) return { error: "Adfin didn't confirm the invoice. Check Adfin before trying again, so the client isn't invoiced twice." };
  const c = readCharge(i.charge);
  const body = paymentRequestBody(i);
  const patch: Row = { BillId: r.id, BillNo: str(r.reference) || body.reference, BillUrl: str(r.paymentLink?.url), BillStatus: fromRequest(str(r.status) || "UNPAID"), BilledOn: i.today, PaidOn: "", BillAmount: body.totalAmount, BillCustomer: i.customerName };
  return {
    patches: [{ list: "FeeCharges", row: i.charge, patch }],
    creates: [{ list: "FeeHistory", row: { Key: o.newKey("FH"), PracticeId: o.pid, ClientKey: str(client.Key), ServiceKey: c.serviceKey, At: o.now, Actor: o.actor, Action: "charge-invoiced", Old: "null", New: JSON.stringify({ label: c.label, amount: body.totalAmount, request: patch.BillNo }), Reason: "Invoiced through Adfin", Source: "Adfin" } }],
    log: [], activities: [activityRow(o, "fee-changed", `Charge invoiced: ${client.Title}`, undefined, { clientKey: str(client.Key) }, `${c.label}: ${gbp(body.totalAmount)}`)],
  };
}

/** Reads the payment request from Adfin and returns a patch if it changed. */
export async function syncCharge(api: AdfinApi, row: Row, today: string): Promise<{ patch?: Row; status: BillState; missing?: boolean }> {
  const b = readChargeBill(row);
  if (!b.id) return { status: "none" };
  try {
    const r = await api.call<PaymentRequest>("GET", `payment_requests/${b.id}`);
    const status = fromRequest(str(r?.status));
    const url = str(r?.paymentLink?.url) || b.url;
    if (status === b.status && url === b.url) return { status };
    return { patch: { BillStatus: status, BillUrl: url, ...(status === "paid" ? { PaidOn: b.paidOn || today } : {}) }, status };
  } catch (e) {
    if (e instanceof Error && (e as any).status === 404) return { status: b.status, missing: true };
    throw e;
  }
}

/** The email that carries the payment link. Written for a person to read and send; the app never sends it. */
export function chargeEmail(first: string, label: string, gross: number, url: string, due: string): { subject: string; body: string } {
  return {
    subject: `Our invoice: ${label}`,
    body: `Hello ${first || "there"},\n\nPlease find our invoice for ${label}, ${gbp(gross)} including VAT, due by ${fmt(due)}.\n\nYou can pay by card or bank transfer here:\n${url}\n\nIf anything looks wrong, just reply and we'll sort it out.\n\nThank you.`,
  };
}

// ------------------------------------------------------------------ the whole practice's invoices, read from Xero

export type Debt = InvoiceRow & { clientKey: string };
const xeroDate = (iso: string) => `DateTime(${iso.slice(0, 4)},${Number(iso.slice(5, 7))},${Number(iso.slice(8, 10))})`;

/** Every sales invoice raised in the last 12 months plus anything still unpaid however old. One pass over Xero, paged. */
export async function fetchLedger(api: XeroApi, tenantId: string, today: string, onPage?: (n: number) => void): Promise<InvoiceRow[]> {
  const out = new Map<string, InvoiceRow>();
  const since = addDays(today, -366);
  const pull = async (where: string, extra: Record<string, string> = {}) => {
    for (let page = 1; page < 200; page++) {
      const json: any = await api.get(tenantId, "accounting", "Invoices", { where, order: "Date DESC", page, pageSize: 100, ...extra });
      const list: any[] = json?.Invoices || [];
      for (const x of list) { const r = parseInvoice(x, today); out.set(r.id || r.number, r); }
      onPage?.(out.size);
      const count = json?.pagination?.pageCount;
      if (!list.length || list.length < 100 || (count && page >= count)) break;
    }
  };
  await pull(`Type=="ACCREC" AND Date>=${xeroDate(since)}`);
  await pull(`Type=="ACCREC" AND AmountDue>0`, { Statuses: "AUTHORISED" });
  return [...out.values()].sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));
}

const norm = (s: string) => s.toLowerCase().replace(/\b(limited|ltd|llp|plc)\b\.?/g, "").replace(/[^a-z0-9]+/g, " ").trim();
/** Which client an invoice belongs to: the Xero contact chosen on the client's Invoices tab, otherwise an exact name match. */
export function matchClients(rows: InvoiceRow[], clients: Row[], contacts: Record<string, { id: string; name: string }>): { debts: Debt[]; unmatched: InvoiceRow[] } {
  const byContact = new Map<string, string>();
  for (const [ck, c] of Object.entries(contacts || {})) if (c?.id) byContact.set(c.id, ck);
  const byName = new Map<string, string>();
  const seen = new Set<string>();
  for (const c of clients) { const n = norm(str(c.Title)); if (!n) continue; if (byName.has(n)) seen.add(n); else byName.set(n, str(c.Key)); }
  const debts: Debt[] = [], unmatched: InvoiceRow[] = [];
  for (const r of rows) {
    const n = norm(r.contact);
    const ck = byContact.get(r.contactId) || (n && !seen.has(n) ? byName.get(n) : undefined);
    if (ck) debts.push({ ...r, clientKey: ck }); else unmatched.push(r);
  }
  return { debts, unmatched };
}

export type Bucket = "current" | "d30" | "d60" | "d90" | "d90p";
export const BUCKET_LABEL: Record<Bucket, string> = { current: "Not yet due", d30: "1 to 30 days late", d60: "31 to 60 days late", d90: "61 to 90 days late", d90p: "Over 90 days late" };
export const daysLate = (r: Pick<InvoiceRow, "due">, today: string) => (r.due ? Math.max(0, daysBetween(r.due, today)) : 0);
export function bucketOf(r: Pick<InvoiceRow, "due">, today: string): Bucket { const d = daysLate(r, today); return d <= 0 ? "current" : d <= 30 ? "d30" : d <= 60 ? "d60" : d <= 90 ? "d90" : "d90p"; }
const isOpen = (r: InvoiceRow) => r.state === "outstanding" || r.state === "overdue";

export type Ageing = Record<Bucket, number> & { total: number; count: number };
export function ageing(rows: InvoiceRow[], today: string): Ageing {
  const a: Ageing = { current: 0, d30: 0, d60: 0, d90: 0, d90p: 0, total: 0, count: 0 };
  for (const r of rows.filter(isOpen)) { a[bucketOf(r, today)] += r.balance; a.total += r.balance; a.count++; }
  for (const k of Object.keys(a) as (keyof Ageing)[]) if (k !== "count") a[k] = r2(a[k]);
  return a;
}

export type ClientBook = { clientKey: string; owed: number; overdue: number; oldestLate: number; open: Debt[]; late: Debt[]; billed12: number; paid12: number; avgDaysToPay?: number };
export function clientBooks(debts: Debt[], today: string): ClientBook[] {
  const since = addDays(today, -366);
  const by = new Map<string, Debt[]>();
  for (const d of debts) by.set(d.clientKey, [...(by.get(d.clientKey) || []), d]);
  return [...by.entries()].map(([clientKey, rows]) => {
    const live = rows.filter((r) => r.state !== "voided" && r.state !== "draft");
    const open = live.filter(isOpen), late = open.filter((r) => r.state === "overdue").sort((a, b) => a.due.localeCompare(b.due));
    const paidRows = live.filter((r) => r.state === "paid" && r.paidOn && r.date);
    const pay = paidRows.slice(0, 12).map((r) => daysBetween(r.date, r.paidOn)).filter((n) => n >= 0);
    return {
      clientKey, open, late, owed: r2(open.reduce((t, r) => t + r.balance, 0)), overdue: r2(late.reduce((t, r) => t + r.balance, 0)), oldestLate: late.length ? daysLate(late[0], today) : 0,
      billed12: r2(live.filter((r) => r.date >= since).reduce((t, r) => t + r.total, 0)), paid12: r2(live.filter((r) => r.date >= since).reduce((t, r) => t + r.paid, 0)),
      avgDaysToPay: pay.length ? Math.round(pay.reduce((a, b) => a + b, 0) / pay.length) : undefined,
    };
  }).sort((a, b) => b.overdue - a.overdue || b.owed - a.owed);
}

/** Cash in the last `days` days: what was paid on invoices fully settled in that time. */
export function collectedSince(debts: InvoiceRow[], today: string, days = 30): number {
  const from = addDays(today, -days);
  return r2(debts.filter((r) => r.state === "paid" && r.paidOn >= from && r.paidOn <= today).reduce((t, r) => t + r.paid, 0));
}

// ------------------------------------------------------------------ chasing

export type ChaseStep = { level: 1 | 2 | 3; after: number; label: string };
export const CHASE_STEPS: ChaseStep[] = [{ level: 1, after: 7, label: "Friendly reminder" }, { level: 2, after: 21, label: "Second reminder" }, { level: 3, after: 35, label: "Final reminder" }];
export const CHASE_GAP_DAYS = 7; // never chase the same client twice in a week
export type Chase = { key: string; clientKey: string; kind: "chase" | "promise" | "dispute" | "note"; invoiceNos: string; level: number; amount: number; at: string; actor: string; promiseOn: string; status: string; note: string };
export const readChase = (r: Row): Chase => ({ key: str(r.Key), clientKey: str(r.ClientKey), kind: (["chase", "promise", "dispute", "note"] as const).find((k) => k === str(r.Kind)) || "note", invoiceNos: str(r.InvoiceNos), level: num(r.Level), amount: num(r.Amount), at: str(r.At), actor: str(r.Actor), promiseOn: str(r.PromiseOn), status: str(r.Status), note: str(r.Note) });

export type ChaseState =
  | { state: "none" }
  | { state: "disputed"; note: string }
  | { state: "promised"; on: string; note: string }
  | { state: "wait"; reason: string }
  | { state: "chase"; level: 1 | 2 | 3; label: string; again: boolean };
/** What to do about a client's overdue invoices today. A dispute or a live promise to pay holds chasing; otherwise it is the next step up the ladder. */
export function chaseState(book: ClientBook | undefined, history: Row[], today: string): ChaseState {
  if (!book || !book.late.length) return { state: "none" };
  const h = history.map(readChase).sort((a, b) => b.at.localeCompare(a.at));
  const dispute = h.find((x) => x.kind === "dispute");
  if (dispute && dispute.status === "open") return { state: "disputed", note: dispute.note };
  const promise = h.find((x) => x.kind === "promise" && x.status !== "kept" && x.status !== "broken");
  if (promise && promise.promiseOn >= today) return { state: "promised", on: promise.promiseOn, note: promise.note };
  const eligible = [...CHASE_STEPS].reverse().find((s) => book.oldestLate >= s.after);
  if (!eligible) return { state: "none" };
  const last = h.find((x) => x.kind === "chase");
  // the first chaser is always the friendly one, however old the debt: climbing starts from there
  if (!last) return { state: "chase", level: 1, label: CHASE_STEPS[0].label, again: false };
  const since = daysBetween(last.at.slice(0, 10), today);
  if (since < CHASE_GAP_DAYS) return { state: "wait", reason: `Chased ${since === 0 ? "today" : since === 1 ? "yesterday" : `${since} days ago`}` };
  const up = CHASE_STEPS.find((s) => s.level === Math.min(3, last.level + 1) && s.after <= book.oldestLate);
  const step = up || CHASE_STEPS[Math.max(0, Math.min(2, last.level - 1))];
  return { state: "chase", level: step.level, label: step.label, again: step.level === last.level };
}

export type ChaseEmailInput = { level: 1 | 2 | 3; first: string; invoices: Pick<Debt, "number" | "date" | "due" | "balance" | "reference">[]; hasDirectDebit: boolean; payUrls: string[]; today: string };
export function chaseEmail(i: ChaseEmailInput): { subject: string; body: string } {
  const total = r2(i.invoices.reduce((t, x) => t + x.balance, 0));
  const lines = i.invoices.map((x) => `  ${x.number}, dated ${fmt(x.date)}, due ${fmt(x.due)}: ${gbp(x.balance)}${x.reference ? ` (${x.reference})` : ""}`).join("\n");
  const pay = i.payUrls.length ? `\n\nYou can pay online here:\n${i.payUrls.join("\n")}` : "";
  const dd = i.hasDirectDebit ? "\n\nAs you pay by direct debit, if a collection has failed please let us know so we can get it re-run." : "";
  const hi = `Hello ${i.first || "there"},`;
  const tail = "\n\nThank you.";
  if (i.level === 1) return { subject: `A reminder about our invoice${i.invoices.length > 1 ? "s" : ""}`, body: `${hi}\n\nA quick reminder that ${i.invoices.length > 1 ? "these invoices are" : "this invoice is"} now past its due date, ${gbp(total)} in all:\n\n${lines}${pay}${dd}\n\nIf you have already paid, thank you, and please ignore this. If anything is wrong with ${i.invoices.length > 1 ? "them" : "it"}, just reply and we will sort it out.${tail}` };
  if (i.level === 2) return { subject: `Overdue: ${i.invoices.map((x) => x.number).join(", ")}`, body: `${hi}\n\nWe wrote recently about the following overdue ${i.invoices.length > 1 ? "invoices" : "invoice"}, ${gbp(total)} in all, and have not yet received payment:\n\n${lines}${pay}${dd}\n\nPlease pay by return, or tell us when we can expect payment. If there is a problem, please call or reply so we can help.${tail}` };
  return { subject: `Final reminder: ${gbp(total)} overdue`, body: `${hi}\n\nDespite our earlier reminders, the following ${gbp(total)} is still unpaid:\n\n${lines}${pay}${dd}\n\nPlease pay within 7 days or contact us to agree a plan. Until the account is settled we may have to pause further work.${tail}` };
}

const hist = (o: Ctx, clientKey: string, kind: Chase["kind"], v: Partial<Record<string, string | number>>): Row => ({ Key: o.newKey("BC"), PracticeId: o.pid, ClientKey: clientKey, Kind: kind, InvoiceNos: "", Level: 0, Amount: 0, At: o.now, Actor: o.actor, PromiseOn: "", Status: "", Note: "", ...v });

export function recordChase(client: Row, level: 1 | 2 | 3, invoices: Pick<Debt, "number" | "balance">[], note: string, can: (x: ProposalAction) => boolean, o: Ctx): Written | { error: string } {
  if (!can("send")) return { error: NO };
  if (!invoices.length) return { error: "There is nothing overdue to chase." };
  const total = r2(invoices.reduce((t, x) => t + x.balance, 0));
  const nos = invoices.map((x) => x.number).join(", ");
  return { patches: [], creates: [{ list: "BillingChases", row: hist(o, str(client.Key), "chase", { InvoiceNos: nos, Level: level, Amount: total, Status: "drafted", Note: note }) }], log: [], activities: [activityRow(o, "chase-sent", `Payment chaser (${CHASE_STEPS[level - 1].label.toLowerCase()}) drafted: ${client.Title}`, undefined, { clientKey: str(client.Key) }, `${nos}: ${gbp(total)}`)] };
}
export function recordPromise(client: Row, on: string, amount: number, note: string, today: string, can: (x: ProposalAction) => boolean, o: Ctx): Written | { error: string } {
  if (!can("send")) return { error: NO };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(on)) return { error: "Give the date the client says they will pay by." };
  if (on < today) return { error: "That date has already passed." };
  return { patches: [], creates: [{ list: "BillingChases", row: hist(o, str(client.Key), "promise", { PromiseOn: on, Amount: r2(amount), Status: "open", Note: note.trim() }) }], log: [], activities: [activityRow(o, "chase-sent", `Promise to pay: ${client.Title}`, undefined, { clientKey: str(client.Key) }, `By ${fmt(on)}${note.trim() ? `: ${note.trim()}` : ""}`)] };
}
export function recordDispute(client: Row, invoiceNos: string, note: string, can: (x: ProposalAction) => boolean, o: Ctx): Written | { error: string } {
  if (!can("send")) return { error: NO };
  if (!note.trim()) return { error: "Say what the client disputes." };
  return { patches: [], creates: [{ list: "BillingChases", row: hist(o, str(client.Key), "dispute", { InvoiceNos: invoiceNos, Status: "open", Note: note.trim() }) }], log: [], activities: [activityRow(o, "chase-sent", `Invoice disputed: ${client.Title}`, undefined, { clientKey: str(client.Key) }, note.trim())] };
}
export function resolveChase(row: Row, status: "resolved" | "kept" | "broken", can: (x: ProposalAction) => boolean): Written | { error: string } {
  if (!can("send")) return { error: NO };
  return { patches: [{ list: "BillingChases", row, patch: { Status: status } }], log: [], activities: [] };
}

// ------------------------------------------------------------------ collection health

export type Health = { clientKey: string; scheduleNo: string; problem: string; level: "red" | "amber" };
/** Schedules set to collect by direct debit where the client has no working mandate. Adfin waits for a mandate, so the money does not move. */
export function collectionProblems(links: Row[], customers: Record<string, AdfinCustomer | undefined>): Health[] {
  const out: Health[] = [];
  for (const row of links) {
    const l: BillingLink = readLink(row);
    if (!isLive(l) || l.method !== "direct-debit") continue;
    const c = customers[l.customerId];
    if (!c) continue;
    const m = mandateOf(c);
    if (m.state === "active") continue;
    out.push({ clientKey: l.clientKey, scheduleNo: l.scheduleNo, level: m.state === "ended" || m.state === "none" ? "red" : "amber", problem: m.state === "none" ? "Billed by direct debit but no direct debit has been requested." : m.state === "waiting" ? "Direct debit not signed yet, so nothing will be collected." : m.label });
  }
  return out;
}
/** Customers from Adfin a few at a time. */
export async function getCustomers(api: AdfinApi, ids: string[]): Promise<Record<string, AdfinCustomer>> {
  const out: Record<string, AdfinCustomer> = {};
  const uniq = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < uniq.length; i += 10) {
    const r = await api.call<{ customers?: AdfinCustomer[] }>("GET", "customers", { query: { customerIds: uniq.slice(i, i + 10).join(","), size: 10 } });
    for (const c of r?.customers || []) out[c.id] = c;
  }
  return out;
}

// ------------------------------------------------------------------ billed against what was agreed

export type Reconciled = { clientKey: string; expected: number; billed: number; diff: number; state: "ok" | "under" | "over" | "none" };
export const RECON_MIN = 50, RECON_PC = 0.1;
/** Agreed fees for a year (with VAT) against what was invoiced in the last 12 months. Approximate: a fee that began or ended during the year will show a difference. */
export function reconcile(schedule: Row[], charges: Row[], books: ClientBook[], vatRate: number, today: string): Reconciled[] {
  const since = addDays(today, -366);
  const expected = new Map<string, number>();
  const add = (k: string, v: number) => expected.set(k, r2((expected.get(k) || 0) + v));
  for (const row of schedule) { const l = readFeeLine(row); if (l.status === "active" && !l.oneOff) add(l.clientKey, l.annual * (l.vat === "standard" ? 1 + vatRate / 100 : 1)); }
  for (const row of charges) { const c = readCharge(row); if (c.status === "agreed" && c.agreedOn >= since && c.amount > 0) add(c.clientKey, c.amount * (c.vat === "standard" ? 1 + vatRate / 100 : 1)); }
  const billed = new Map(books.map((b) => [b.clientKey, b.billed12]));
  return [...new Set([...expected.keys(), ...billed.keys()])].map((clientKey) => {
    const e = expected.get(clientKey) || 0, b = billed.get(clientKey) || 0, diff = r2(b - e);
    const big = Math.abs(diff) > Math.max(RECON_MIN, e * RECON_PC);
    return { clientKey, expected: e, billed: b, diff, state: !e && !b ? "none" : !big ? "ok" : diff < 0 ? "under" : "over" } as Reconciled;
  }).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
}
