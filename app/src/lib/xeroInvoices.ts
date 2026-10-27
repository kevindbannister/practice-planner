// The client's Invoices tab: what the practice has billed the client, read from the practice's own
// Xero organisation. Read only. Nothing is kept in Practice Planner except which Xero contact is
// the client (setting xero.contacts).
import { XeroApi, XeroTenant, xDate } from "./xero";

export const PRACTICE = "__practice__"; // the value in xero.links that marks the practice's own organisation
export type InvoiceState = "paid" | "outstanding" | "overdue" | "draft" | "voided";
export type InvoiceRow = {
  id: string; number: string; reference: string; date: string; due: string; total: number; paid: number; balance: number;
  currency: string; status: string; state: InvoiceState; paidOn: string; contactId: string; contact: string; url: string; sent: boolean;
};
export const STATE_LABEL: Record<InvoiceState, string> = { paid: "Paid", outstanding: "Awaiting payment", overdue: "Overdue", draft: "Draft", voided: "Voided" };
export const STATE_CHIP: Record<InvoiceState, string> = { paid: "green", outstanding: "amber", overdue: "red", draft: "", voided: "" };

const num = (v: unknown) => { const n = Number(String(v ?? "").replace(/,/g, "")); return Number.isFinite(n) ? n : 0; };
const r2 = (n: number) => Math.round(n * 100) / 100;

export function stateOf(status: string, balance: number, due: string, today: string): InvoiceState {
  const s = status.toUpperCase();
  if (s === "VOIDED" || s === "DELETED") return "voided";
  if (s === "DRAFT" || s === "SUBMITTED") return "draft";
  if (s === "PAID" || balance <= 0.004) return "paid";
  return due && due < today ? "overdue" : "outstanding";
}

export function parseInvoice(x: any, today: string): InvoiceRow {
  const status = String(x?.Status || "");
  const total = r2(num(x?.Total));
  const due = r2(num(x?.AmountDue));
  const paid = r2(num(x?.AmountPaid));
  const balance = status.toUpperCase() === "PAID" ? 0 : x?.AmountDue === undefined ? r2(total - paid) : due;
  const dueDate = xDate(x?.DueDateString || x?.DueDate);
  const id = String(x?.InvoiceID || "");
  return {
    id: id || String(x?.InvoiceNumber || ""), number: String(x?.InvoiceNumber || ""), reference: String(x?.Reference || ""), date: xDate(x?.DateString || x?.Date), due: dueDate,
    total, paid, balance, currency: String(x?.CurrencyCode || "GBP"), status, state: stateOf(status, balance, dueDate, today),
    paidOn: xDate(x?.FullyPaidOnDate), contactId: String(x?.Contact?.ContactID || ""), contact: String(x?.Contact?.Name || ""),
    url: id ? `https://go.xero.com/app/invoicing/view/${id}` : "", sent: !!x?.SentToContact,
  };
}

/** "3+ months ago", "2 weeks ago", "today" — how long ago something was raised. */
export function ageLabel(iso: string, today: string): string {
  if (!iso) return "";
  const days = Math.round((Date.parse(today) - Date.parse(iso)) / 86400000);
  if (days <= 0) return days === 0 ? "today" : "in the future";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  const months = Math.floor(days / 30.4);
  return months < 12 ? `${months}+ months ago` : `${Math.floor(months / 12)}+ year${months >= 24 ? "s" : ""} ago`;
}

export type InvoiceFilter = { state?: InvoiceState | "all" | "open"; months?: number; q?: string };
const monthsBack = (today: string, n: number) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - n); return d.toISOString().slice(0, 10); };
export function filterInvoices(rows: InvoiceRow[], f: InvoiceFilter, today: string): InvoiceRow[] {
  const q = (f.q || "").trim().toLowerCase();
  const since = f.months ? monthsBack(today, f.months) : "";
  return rows.filter((r) => (!f.state || f.state === "all" || (f.state === "open" ? r.state === "outstanding" || r.state === "overdue" : r.state === f.state))
    && (!since || r.date >= since) && (!q || `${r.number} ${r.reference} ${r.status}`.toLowerCase().includes(q)));
}

export type InvoiceSummary = { owed: number; overdue: number; overdueCount: number; openCount: number; billed12: number; paid12: number; oldestOverdue?: InvoiceRow };
export function summarise(rows: InvoiceRow[], today: string): InvoiceSummary {
  const since = monthsBack(today, 12);
  const live = rows.filter((r) => r.state !== "voided" && r.state !== "draft");
  const open = live.filter((r) => r.state === "outstanding" || r.state === "overdue");
  const od = open.filter((r) => r.state === "overdue").sort((a, b) => a.due.localeCompare(b.due));
  return {
    owed: r2(open.reduce((t, r) => t + r.balance, 0)), overdue: r2(od.reduce((t, r) => t + r.balance, 0)), overdueCount: od.length, openCount: open.length,
    billed12: r2(live.filter((r) => r.date >= since).reduce((t, r) => t + r.total, 0)), paid12: r2(live.filter((r) => r.date >= since).reduce((t, r) => t + r.paid, 0)), oldestOverdue: od[0],
  };
}

export const money = (n: number, cur = "GBP") => new Intl.NumberFormat("en-GB", { style: "currency", currency: cur }).format(n);

// ------------------------------------------------------------------ reading from Xero

export type XeroContact = { id: string; name: string; email: string; balance: number };
export const contactUrl = (id: string) => `https://go.xero.com/Contacts/View/${id}`;

export async function findContacts(api: XeroApi, tenantId: string, name: string): Promise<XeroContact[]> {
  const term = name.replace(/\b(limited|ltd|llp|plc)\b\.?/gi, "").replace(/[^\p{L}\p{N} &'.-]/gu, " ").replace(/\s+/g, " ").trim();
  const json: any = await api.get(tenantId, "accounting", "Contacts", { searchTerm: term || name, pageSize: 20, page: 1 });
  return (json?.Contacts || []).filter((c: any) => c?.ContactID && c.IsCustomer !== false).map((c: any) => ({ id: String(c.ContactID), name: String(c.Name || ""), email: String(c.EmailAddress || ""), balance: num(c.Balances?.AccountsReceivable?.Outstanding) }));
}

/** The best contact when there is only one clear match by name; otherwise nothing, so a person chooses. */
export function pickContact(name: string, found: XeroContact[]): XeroContact | undefined {
  const norm = (s: string) => s.toLowerCase().replace(/\b(limited|ltd|llp|plc)\b\.?/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const exact = found.filter((c) => norm(c.name) === norm(name));
  return exact.length === 1 ? exact[0] : found.length === 1 && norm(found[0].name).includes(norm(name)) ? found[0] : undefined;
}

export async function fetchInvoices(api: XeroApi, tenant: Pick<XeroTenant, "tenantId">, contactId: string, today: string, onPage?: (n: number) => void): Promise<InvoiceRow[]> {
  const out: any[] = [];
  for (let page = 1; page < 100; page++) {
    const json: any = await api.get(tenant.tenantId, "accounting", "Invoices", { ContactIDs: contactId, where: 'Type=="ACCREC"', order: "Date DESC", page, pageSize: 100 });
    const list: any[] = json?.Invoices || [];
    out.push(...list);
    onPage?.(out.length);
    const count = json?.pagination?.pageCount;
    if (!list.length || list.length < 100 || (count && page >= count)) break;
  }
  return out.map((x) => parseInvoice(x, today)).sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));
}
