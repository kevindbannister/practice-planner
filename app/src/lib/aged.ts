// Aged receivables and payables for the reporting centre: what customers owe the client, and what the client owes suppliers, by how late it is.
// Read from Xero as the open invoices (sales for receivables, bills for payables) as at the day it is read, then grouped by contact.
import { Bucket, bucketOf } from "./collections";
import { XeroApi, xDate } from "./xero";
import { InvoiceRow, parseInvoice } from "./xeroInvoices";

export type AgedKind = "rec" | "pay";
export type AgedData = { v: 1; at: string; asAt: string; tenantId: string; rec: InvoiceRow[]; pay: InvoiceRow[]; /** things the read couldn't include */ notes?: string[] };
export const AGED_BUCKETS: [Bucket, string][] = [["current", "Current"], ["d30", "1–30 days"], ["d60", "31–60 days"], ["d90", "61–90 days"], ["d90p", "Over 90 days"]];
export const AGED_TITLE: Record<AgedKind, string> = { rec: "Aged Receivables", pay: "Aged Payables" };
export const agedItem = (folder: string, clientKey: string) => `/me/drive/root:/${encodeURIComponent(folder)}/${encodeURIComponent(clientKey)}/${encodeURIComponent("aged.json")}`;

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Xero's amounts are in the invoice's own currency; the rate says how many of it make £1. */
export function inPounds(r: InvoiceRow, x: { CurrencyRate?: unknown }): InvoiceRow {
  const rate = Number(x?.CurrencyRate);
  if (!r.currency || r.currency === "GBP" || !Number.isFinite(rate) || rate <= 0 || rate === 1) return r;
  return { ...r, total: r2(r.total / rate), paid: r2(r.paid / rate), balance: r2(r.balance / rate) };
}

/** Credit notes still to be used, as negative rows (a customer's credit note reduces what they owe; a supplier's reduces what is owed to them). */
export async function fetchOpenCreditNotes(api: XeroApi, tenantId: string, type: "ACCRECCREDIT" | "ACCPAYCREDIT", today: string): Promise<InvoiceRow[]> {
  const out: InvoiceRow[] = [];
  for (let page = 1; page < 100; page++) {
    const json: any = await api.get(tenantId, "accounting", "CreditNotes", { where: `Type=="${type}" AND Status=="AUTHORISED"`, page, pageSize: 100 });
    const list: any[] = json?.CreditNotes || [];
    for (const x of list) {
      const left = Number(x?.RemainingCredit);
      if (!(left > 0)) continue;
      const date = xDate(x?.DateString || x?.Date);
      const r = inPounds({
        id: String(x?.CreditNoteID || x?.CreditNoteNumber || ""), number: String(x?.CreditNoteNumber || "Credit note"), reference: String(x?.Reference || ""), date, due: date,
        total: -r2(Number(x?.Total) || left), paid: 0, balance: -r2(left), currency: String(x?.CurrencyCode || "GBP"), status: String(x?.Status || ""), state: "outstanding", paidOn: "",
        contactId: String(x?.Contact?.ContactID || ""), contact: String(x?.Contact?.Name || ""), url: "", sent: false,
      }, x);
      out.push(r);
    }
    const count = json?.pagination?.pageCount;
    if (!list.length || list.length < 100 || (count && page >= count)) break;
  }
  return out;
}

/** Every authorised invoice of one kind that still has something owing (ACCREC are sales invoices, ACCPAY are bills). */
export async function fetchOpenInvoices(api: XeroApi, tenantId: string, type: "ACCREC" | "ACCPAY", today: string, onPage?: (n: number) => void): Promise<InvoiceRow[]> {
  const out = new Map<string, InvoiceRow>();
  for (let page = 1; page < 200; page++) {
    const json: any = await api.get(tenantId, "accounting", "Invoices", { where: `Type=="${type}" AND AmountDue>0`, Statuses: "AUTHORISED", order: "Date DESC", page, pageSize: 100 });
    const list: any[] = json?.Invoices || [];
    for (const x of list) { const r = inPounds(parseInvoice(x, today), x); if (r.balance > 0) out.set(r.id || r.number, r); }
    onPage?.(out.size);
    const count = json?.pagination?.pageCount;
    if (!list.length || list.length < 100 || (count && page >= count)) break;
  }
  return [...out.values()];
}

export type AgedContact = Record<Bucket, number> & { contact: string; total: number; invoices: (InvoiceRow & { late: number; bucket: Bucket })[] };
export type AgedBook = { contacts: AgedContact[]; totals: Record<Bucket, number> & { total: number }; count: number; overdue: number; overduePct: number; oldestLate: number };

const lateBy = (due: string, asAt: string) => (due ? Math.max(0, Math.round((Date.parse(`${asAt}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86400000)) : 0);

/** The open invoices grouped by contact with their balance in each ageing column, biggest first. */
export function agedBook(rows: InvoiceRow[], asAt: string): AgedBook {
  const by = new Map<string, AgedContact>();
  const totals = { current: 0, d30: 0, d60: 0, d90: 0, d90p: 0, total: 0 };
  let count = 0, oldestLate = 0;
  for (const r of rows) {
    if (r.balance === 0 || r.state === "voided" || r.state === "draft") continue;
    const name = r.contact || "(no contact)";
    const c = by.get(name) || { contact: name, current: 0, d30: 0, d60: 0, d90: 0, d90p: 0, total: 0, invoices: [] };
    const bucket = bucketOf(r, asAt), late = lateBy(r.due, asAt);
    c[bucket] += r.balance; c.total += r.balance; c.invoices.push({ ...r, late, bucket });
    totals[bucket] += r.balance; totals.total += r.balance; count++; oldestLate = Math.max(oldestLate, late);
    by.set(name, c);
  }
  const contacts = [...by.values()].map((c) => {
    for (const k of ["current", "d30", "d60", "d90", "d90p", "total"] as const) c[k] = r2(c[k]);
    c.invoices.sort((a, b) => b.late - a.late || b.balance - a.balance);
    return c;
  }).sort((a, b) => b.total - a.total || a.contact.localeCompare(b.contact));
  for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] = r2(totals[k]);
  const overdue = r2(totals.total - totals.current);
  return { contacts, totals, count, overdue, overduePct: totals.total ? r2((overdue / totals.total) * 100) : 0, oldestLate };
}
