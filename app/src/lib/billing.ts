// Billing through Adfin: turning a client's recurring fee line into an Adfin recurring invoice, which collects by direct debit (or
// card / bank) and goes into Xero through Adfin. The fee schedule stays the source of truth for what a client pays; Adfin holds the
// recurring invoice; BillingLinks records which fee line has which one.
//
// Safe by design, because this moves real money:
//  - a schedule is made as a DRAFT in Adfin and nothing is invoiced until it is started on purpose, one at a time;
//  - one live schedule per fee line, and a double press refuses;
//  - the amount is checked against the fee line before starting, and drift is shown afterwards;
//  - a changed fee is a NEW draft that replaces the old schedule (the new one is made first, so there is never a gap or a double);
//  - every step is written to Fee History with who and why.
import { AdfinApi, AdfinCustomer, AdfinMandate, AdfinSchedule } from "./adfin";
import { FeeLine, periodsPerYear } from "./fees";
import { ProposalAction } from "./proposals";
import { Ctx, Written, activityRow } from "./sales";
import { Row } from "./schema";

const str = (v: unknown): string => (v === undefined || v === null ? "" : String(v));
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const money = (n: number) => Math.round(n * 100) / 100;
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export const ADFIN_SETTINGS_KEY = "adfin.settings";
export const ADFIN_CUSTOMERS_KEY = "adfin.customers";
export const ADFIN_CONNECTION_KEY = "adfin.connection";
export type AdfinSettings = { vatRate: number; accountCodeId: string; termDays: number };
export const DEFAULT_ADFIN: AdfinSettings = { vatRate: 20, accountCodeId: "", termDays: 14 };
export function readAdfinSettings(raw: unknown): AdfinSettings {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rate = num(o.vatRate), days = Math.floor(num(o.termDays));
  return { vatRate: rate > 0 && rate <= 100 ? rate : 20, accountCodeId: /^[0-9a-f-]{36}$/i.test(str(o.accountCodeId).trim()) ? str(o.accountCodeId).trim() : "", termDays: days >= 0 && days <= 120 && o.termDays !== undefined ? days : DEFAULT_ADFIN.termDays };
}
export type CustomerLink = { id: string; name: string };
export function readCustomerLinks(raw: unknown): Record<string, CustomerLink> {
  const out: Record<string, CustomerLink> = {};
  if (raw && typeof raw === "object") for (const [k, v] of Object.entries(raw as Record<string, any>)) if (v && str(v.id)) out[k] = { id: str(v.id), name: str(v.name) };
  return out;
}

// ------------------------------------------------------------------ the record of a schedule

export type LinkStatus = "draft" | "active" | "finished" | "cancelled";
export type Method = "direct-debit" | "on-demand";
export type BillingLink = { key: string; clientKey: string; serviceKey: string; feeKey: string; customerId: string; customerName: string; scheduleId: string; scheduleNo: string; status: LinkStatus; method: Method; amount: number; vatRate: number; period: string; startDate: string; description: string; nextDate: string; syncedAt: string; notes: string };
export const readLink = (r: Row): BillingLink => ({
  key: str(r.Key), clientKey: str(r.ClientKey), serviceKey: str(r.ServiceKey), feeKey: str(r.FeeKey), customerId: str(r.CustomerId), customerName: str(r.CustomerName), scheduleId: str(r.ScheduleId), scheduleNo: str(r.ScheduleNo),
  status: (["draft", "active", "finished", "cancelled"] as const).find((s) => s === str(r.Status)) || "draft", method: str(r.Method) === "on-demand" ? "on-demand" : "direct-debit", amount: num(r.Amount), vatRate: num(r.VatRate), period: str(r.Period), startDate: str(r.StartDate), description: str(r.Description), nextDate: str(r.NextDate), syncedAt: str(r.SyncedAt), notes: str(r.Notes),
});
export const isLive = (l: BillingLink) => l.status === "draft" || l.status === "active";
/** The live link for a fee line, if any. A cancelled or finished one doesn't count. */
export const liveLinkFor = (links: Row[], feeKey: string): Row | undefined => links.find((r) => str(r.FeeKey) === feeKey && isLive(readLink(r)));
export const LINK_LABEL: Record<LinkStatus, string> = { draft: "Draft (not started)", active: "Billing", finished: "Finished", cancelled: "Cancelled" };
const fromAdfin = (s: string): LinkStatus => (s === "ACTIVE" ? "active" : s === "FINISHED" ? "finished" : s === "CANCELLED" ? "cancelled" : "draft");

// ------------------------------------------------------------------ what a fee line can be billed as

export type SetupInput = {
  line: FeeLine; clientName: string; customerId: string; method: Method; startDate: string; description: string; today: string; settings: AdfinSettings;
};

/** What stops a fee line being set up, in plain words. */
export function setupProblems(i: SetupInput): string[] {
  const out: string[] = [];
  const l = i.line;
  if (l.status !== "active") out.push(l.status === "held" ? "This fee is on hold. Start it before billing it." : l.status === "ended" ? "This fee has ended." : "This service is included in a package and has no fee to bill.");
  else if (l.oneOff || !periodsPerYear(l.period)) out.push("Only a monthly, quarterly or annual fee can be a recurring invoice. Use a one-off invoice for a one-off charge.");
  if (!(l.fee > 0)) out.push("The fee has to be more than nothing.");
  if (l.vat !== "standard" && l.vat !== "zero") out.push(l.vat ? "Exempt and outside-the-scope fees can't be set up here yet, because Adfin needs a matching tax rate. Set the VAT on the fee line, or invoice it in Xero." : "Record the VAT treatment on the fee line first (standard or zero rated).");
  if (!i.customerId) out.push("Choose the Adfin customer for this client.");
  if (!isDate(i.startDate)) out.push("Give the date the first invoice is due.");
  else if (i.startDate < i.today) out.push("The first invoice date can't be in the past. Adfin would not know what to do with the months already gone; add a catch-up fee for those.");
  if (!i.description.trim()) out.push("Say what the invoice is for.");
  if (i.description.length > 200) out.push("Keep the invoice wording under 200 characters.");
  return out;
}

const cadenceOf = (period: string) => { const p = periodsPerYear(period); return p === 12 ? { timeUnit: "MONTH", frequency: 1 } : p === 4 ? { timeUnit: "MONTH", frequency: 3 } : { timeUnit: "YEAR", frequency: 1 }; };
export const vatRateOf = (i: Pick<SetupInput, "line" | "settings">) => (i.line.vat === "standard" ? i.settings.vatRate : 0);

/** The request for Adfin's POST /schedules/invoices. Net amount, tax added on top. Adfin wants the start date with milliseconds. */
export function scheduleBody(i: SetupInput) {
  const item: Record<string, unknown> = { description: i.description.trim(), quantity: 1, unitAmount: money(i.line.fee), taxRate: vatRateOf(i) };
  if (i.settings.accountCodeId) item.accountCodeId = i.settings.accountCodeId;
  return {
    cadence: { ...cadenceOf(i.line.period), startDate: `${i.startDate}T00:00:00.000Z` },
    invoiceDetails: {
      customer: { id: i.customerId },
      distribution: { collectionMethod: i.method === "direct-debit" ? "AUTO_COLLECT" : "ON_DEMAND", approvedForSending: true },
      paymentTerm: { timeUnit: "DAY", value: i.settings.termDays },
      currencyCode: "GBP",
      itemsTaxType: "EXCLUSIVE",
      items: [item],
      description: i.description.trim().slice(0, 200),
    },
  };
}

/** Plain-words summary of what starting would do, shown before the person confirms. */
export function startSummary(l: BillingLink, clientName: string): string {
  const per = periodsPerYear(l.period);
  const every = per === 12 ? "every month" : per === 4 ? "every 3 months" : "every year";
  const gross = money(l.amount * (1 + l.vatRate / 100));
  return `${clientName} will be invoiced £${l.amount.toFixed(2)} + VAT (£${gross.toFixed(2)} in all) ${every} from ${l.startDate}, "${l.description}". ${l.method === "direct-debit" ? "Collected by direct debit once there is an active mandate; until then collection waits." : "The client pays by card or bank from the invoice link."} Adfin sends each invoice to the client.`;
}

// ------------------------------------------------------------------ billing state and drift

export type Billing = { state: "none" | LinkStatus; link?: BillingLink; drift: string[] };
/** Where a fee line stands, and anything that no longer matches between the fee and the schedule. */
export function billingState(line: FeeLine, linkRow: Row | undefined): Billing {
  if (!linkRow) return { state: "none", drift: [] };
  const l = readLink(linkRow);
  const drift: string[] = [];
  if (isLive(l)) {
    if (money(l.amount) !== money(line.fee)) drift.push(`The schedule bills £${l.amount.toFixed(2)} but the fee is now £${line.fee.toFixed(2)}.`);
    if (periodsPerYear(l.period) !== periodsPerYear(line.period)) drift.push("The fee is no longer charged on the same cycle as the schedule.");
    if (line.status === "ended") drift.push("This fee has ended but the schedule is still set up. Cancel it.");
    else if (line.status === "held") drift.push("This fee is on hold but the schedule is still set up.");
    if ((line.vat === "standard" ? l.vatRate > 0 : l.vatRate === 0) === false) drift.push("The VAT treatment has changed since the schedule was made.");
  }
  return { state: l.status, link: l, drift };
}

/** Does the client's name appear among Xero's existing repeating invoices? Helps avoid billing the same client twice. */
export function xeroOverlaps(clientName: string, repeating: { contact: string; total: number; status: string }[]): { contact: string; total: number; status: string }[] {
  const norm = (s: string) => s.toLowerCase().replace(/\b(limited|ltd|llp|plc)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const n = norm(clientName);
  if (!n) return [];
  return repeating.filter((r) => r.status !== "DELETED" && norm(r.contact) === n);
}
export type RepeatingInvoice = { contact: string; total: number; status: string };
export function readRepeating(data: any): RepeatingInvoice[] {
  const list = Array.isArray(data?.RepeatingInvoices) ? data.RepeatingInvoices : [];
  return list.filter((r: any) => str(r.Type) !== "ACCPAY").map((r: any) => ({ contact: str(r.Contact?.Name), total: num(r.Total), status: str(r.Status) }));
}

// ------------------------------------------------------------------ customers and mandates

export function mandateOf(c: AdfinCustomer | undefined): { state: "none" | "waiting" | "active" | "ended"; label: string; mandate?: AdfinMandate } {
  const m = c?.directDebitMandate;
  if (!m) return { state: "none", label: "No direct debit set up" };
  switch (m.status) {
    case "ACTIVE": return { state: "active", label: "Direct debit active", mandate: m };
    case "CREATED": case "PENDING": case "MIGRATING": return { state: "waiting", label: m.status === "CREATED" ? "Direct debit requested, waiting for the client to sign" : "Direct debit signed, waiting for the bank", mandate: m };
    default: return { state: "ended", label: `Direct debit ${m.status === "PENDING_CANCELLATION" ? "being cancelled" : "cancelled"}${m.statusReason ? ` (${m.statusReason})` : ""}`, mandate: m };
  }
}

export async function searchCustomers(api: AdfinApi, text: string): Promise<AdfinCustomer[]> {
  const r = await api.call<{ customers?: AdfinCustomer[] }>("GET", "customers", { query: { searchText: text.trim() || undefined, size: 20, sort: "name,asc" } });
  return (r?.customers || []).filter((c) => c.status !== "ARCHIVED");
}
export async function getCustomer(api: AdfinApi, id: string): Promise<AdfinCustomer | undefined> {
  const r = await api.call<{ customers?: AdfinCustomer[] }>("GET", "customers", { query: { customerIds: id, size: 1 } });
  return r?.customers?.[0];
}
export async function createCustomer(api: AdfinApi, name: string, email: string): Promise<AdfinCustomer> {
  if (!name.trim()) throw new Error("The customer needs a name.");
  return api.call<AdfinCustomer>("POST", "customers", { body: { name: name.trim(), ...(email.trim() ? { people: [{ name: name.trim(), email: email.trim() }] } : {}) } });
}
/** Asks Adfin for a direct debit mandate. Returns the link the client opens to authorise it (bank details never pass through us). */
export async function requestMandate(api: AdfinApi, customerId: string): Promise<{ url: string; status: string }> {
  const m = await api.call<AdfinMandate>("PUT", `customers/${customerId}/directdebitmandates`, { body: {} });
  if (!m?.url) throw new Error("Adfin didn't give a sign-up link for the direct debit.");
  return { url: m.url, status: m.status };
}

// ------------------------------------------------------------------ actions on a schedule

const hist = (o: Ctx, clientKey: string, serviceKey: string, action: string, before: unknown, after: unknown, reason: string): Row => ({
  Key: o.newKey("FH"), PracticeId: o.pid, ClientKey: clientKey, ServiceKey: serviceKey, At: o.now, Actor: o.actor, Action: action, Old: JSON.stringify(before ?? null), New: JSON.stringify(after ?? null), Reason: reason, Source: "Adfin",
});
const act = (o: Ctx, client: Row, title: string, summary: string) => activityRow(o, "fee-changed", `${title}: ${client.Title}`, undefined, { clientKey: str(client.Key) }, summary);
const NO = "Only a manager or partner can set up billing.";

function newLinkRow(i: SetupInput, s: AdfinSchedule, clientKey: string, customerName: string, o: Ctx): Row {
  return {
    Key: o.newKey("BL"), PracticeId: o.pid, ClientKey: clientKey, ServiceKey: i.line.serviceKey, FeeKey: i.line.key, CustomerId: i.customerId, CustomerName: customerName, ScheduleId: s.id, ScheduleNo: str(s.recurringInvoiceNo), Status: fromAdfin(s.status),
    Method: i.method, Amount: money(i.line.fee), VatRate: vatRateOf(i), Period: i.line.period, StartDate: i.startDate, Description: i.description.trim(), NextDate: str(s.nextIssueDate).slice(0, 10), Created: o.now, CreatedBy: o.actor, Updated: o.now, SyncedAt: o.now, Notes: "",
  };
}

/** Makes the recurring invoice in Adfin as a DRAFT and records it. Nothing is invoiced or sent. */
export async function setupSchedule(api: AdfinApi, client: Row, i: SetupInput, linkRows: Row[], customerName: string, can: (x: ProposalAction) => boolean, o: Ctx): Promise<Written | { error: string }> {
  if (!can("send")) return { error: NO };
  const bad = setupProblems(i);
  if (bad.length) return { error: bad[0] };
  if (liveLinkFor(linkRows, i.line.key)) return { error: "This fee already has a billing schedule. Cancel it first, or replace it if the fee has changed." };
  let s: AdfinSchedule;
  try { s = await api.call<AdfinSchedule>("POST", "schedules/invoices", { body: scheduleBody(i) }); } catch (e) { return { error: e instanceof Error ? e.message : "Adfin didn't accept that." }; }
  if (!s?.id) return { error: "Adfin didn't confirm the schedule. Check Adfin before trying again, so it isn't made twice." };
  const row = newLinkRow(i, s, str(client.Key), customerName, o);
  return {
    patches: [], creates: [{ list: "BillingLinks", row }, { list: "FeeHistory", row: hist(o, str(client.Key), i.line.serviceKey, "billing-draft", null, { amount: row.Amount, schedule: row.ScheduleNo, start: i.startDate }, `Billing set up through Adfin as a draft, from ${i.startDate}`) }],
    log: [], activities: [act(o, client, "Billing drafted", `${i.description.trim()}: £${row.Amount}`)],
  };
}

/** Starts a draft. Refuses if the amount no longer matches the fee. */
export async function startSchedule(api: AdfinApi, client: Row, linkRow: Row, line: FeeLine, can: (x: ProposalAction) => boolean, o: Ctx): Promise<Written | { error: string }> {
  if (!can("send")) return { error: NO };
  const l = readLink(linkRow);
  if (l.status !== "draft") return { error: "Only a draft can be started." };
  const b = billingState(line, linkRow);
  if (b.drift.length) return { error: `${b.drift[0]} Replace the schedule first.` };
  let s: AdfinSchedule;
  try { s = await api.call<AdfinSchedule>("PUT", `schedules/invoices/${l.scheduleId}:activate`, { body: {} }); } catch (e) { return { error: e instanceof Error ? e.message : "Adfin didn't start it." }; }
  return {
    patches: [{ list: "BillingLinks", row: linkRow, patch: { Status: fromAdfin(str(s?.status) || "ACTIVE"), NextDate: str(s?.nextIssueDate).slice(0, 10) || l.nextDate, Updated: o.now, SyncedAt: o.now } }],
    creates: [{ list: "FeeHistory", row: hist(o, str(client.Key), l.serviceKey, "billing-started", { status: "draft" }, { status: "active", amount: l.amount, schedule: l.scheduleNo }, "Billing started through Adfin") }],
    log: [], activities: [act(o, client, "Billing started", `${l.description}: £${l.amount}`)],
  };
}

export async function cancelSchedule(api: AdfinApi, client: Row, linkRow: Row, reason: string, can: (x: ProposalAction) => boolean, o: Ctx): Promise<Written | { error: string }> {
  if (!can("send")) return { error: NO };
  if (!reason.trim()) return { error: "Say why." };
  const l = readLink(linkRow);
  if (!isLive(l)) return { error: "That schedule isn't running." };
  try { await api.call("PUT", `schedules/invoices/${l.scheduleId}:cancel`, { body: {} }); } catch (e) { return { error: e instanceof Error ? e.message : "Adfin didn't cancel it." }; }
  return {
    patches: [{ list: "BillingLinks", row: linkRow, patch: { Status: "cancelled", Updated: o.now, SyncedAt: o.now, Notes: `Cancelled: ${reason.trim()}` } }],
    creates: [{ list: "FeeHistory", row: hist(o, str(client.Key), l.serviceKey, "billing-cancelled", { status: l.status, amount: l.amount }, { status: "cancelled" }, reason.trim()) }],
    log: [], activities: [act(o, client, "Billing cancelled", `${l.description}: ${reason.trim()}`)],
  };
}

/** The fee has changed: make the new draft first (a draft bills nothing), then cancel the old schedule. The new one is started separately. */
export async function replaceSchedule(api: AdfinApi, client: Row, oldRow: Row, i: SetupInput, customerName: string, can: (x: ProposalAction) => boolean, o: Ctx): Promise<Written | { error: string }> {
  if (!can("send")) return { error: NO };
  const bad = setupProblems(i);
  if (bad.length) return { error: bad[0] };
  const old = readLink(oldRow);
  if (!isLive(old)) return { error: "That schedule isn't running." };
  let s: AdfinSchedule;
  try { s = await api.call<AdfinSchedule>("POST", "schedules/invoices", { body: scheduleBody(i) }); } catch (e) { return { error: e instanceof Error ? e.message : "Adfin didn't accept that." }; }
  if (!s?.id) return { error: "Adfin didn't confirm the new schedule, so the old one has been left as it was." };
  const row = newLinkRow(i, s, str(client.Key), customerName, o);
  try { await api.call("PUT", `schedules/invoices/${old.scheduleId}:cancel`, { body: {} }); } catch (e) {
    return { error: `The new draft (${row.ScheduleNo}) was made in Adfin but the old schedule ${old.scheduleNo} could not be cancelled: ${e instanceof Error ? e.message : "Adfin refused"}. Cancel the old one in Adfin, then refresh here. The draft bills nothing.` };
  }
  return {
    patches: [{ list: "BillingLinks", row: oldRow, patch: { Status: "cancelled", Updated: o.now, SyncedAt: o.now, Notes: `Replaced by ${row.ScheduleNo}` } }],
    creates: [{ list: "BillingLinks", row }, { list: "FeeHistory", row: hist(o, str(client.Key), i.line.serviceKey, "billing-replaced", { schedule: old.scheduleNo, amount: old.amount }, { schedule: row.ScheduleNo, amount: row.Amount }, "Fee changed: billing schedule replaced (new one is a draft until started)") }],
    log: [], activities: [act(o, client, "Billing replaced", `${old.scheduleNo} to ${row.ScheduleNo}: £${old.amount} to £${row.Amount}`)],
  };
}

/** Reads the schedule from Adfin and returns a patch if its status or next date differ from what is recorded. */
export async function syncLink(api: AdfinApi, linkRow: Row, now: string): Promise<{ patch?: Row; status: LinkStatus; missing?: boolean }> {
  const l = readLink(linkRow);
  try {
    const s = await api.call<AdfinSchedule>("GET", `schedules/invoices/${l.scheduleId}`);
    const status = fromAdfin(str(s?.status));
    const next = str(s?.nextIssueDate).slice(0, 10);
    const changed = status !== l.status || (next && next !== l.nextDate);
    return { patch: { ...(changed ? { Status: status, NextDate: next || l.nextDate } : {}), SyncedAt: now, Updated: changed ? now : str(linkRow.Updated) }, status };
  } catch (e) {
    if (e instanceof Error && (e as any).status === 404) return { status: l.status, missing: true };
    throw e;
  }
}
