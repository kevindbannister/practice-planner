import { test } from "node:test";
import assert from "node:assert/strict";
import { ageLabel, fetchInvoices, filterInvoices, parseInvoice, pickContact, summarise } from "../src/lib/xeroInvoices.ts";

const today = "2026-10-27";
const inv = (o: Record<string, unknown>) => ({ InvoiceID: "i1", InvoiceNumber: "INV-1", Type: "ACCREC", Status: "AUTHORISED", DateString: "2026-09-01T00:00:00", DueDateString: "2026-09-15T00:00:00", Total: 1200, AmountDue: 1200, AmountPaid: 0, Contact: { ContactID: "c1", Name: "Adam French" }, ...o });

test("an invoice is paid, awaiting payment, overdue, draft or voided", () => {
  assert.equal(parseInvoice(inv({}), today).state, "overdue");
  assert.equal(parseInvoice(inv({ DueDateString: "2026-11-15T00:00:00" }), today).state, "outstanding");
  assert.equal(parseInvoice(inv({ Status: "PAID", AmountDue: 0, AmountPaid: 1200, FullyPaidOnDate: "2026-09-20T00:00:00" }), today).state, "paid");
  assert.equal(parseInvoice(inv({ Status: "DRAFT" }), today).state, "draft");
  assert.equal(parseInvoice(inv({ Status: "VOIDED" }), today).state, "voided");
  assert.equal(parseInvoice(inv({}), today).url, "https://go.xero.com/app/invoicing/view/i1");
});

test("balance falls back to total less paid when Xero gives no amount due", () => {
  const r = parseInvoice({ ...inv({ AmountPaid: 200 }), AmountDue: undefined }, today);
  assert.equal(r.balance, 1000);
});

test("how long ago", () => {
  assert.equal(ageLabel("2026-10-27", today), "today");
  assert.equal(ageLabel("2026-10-20", today), "7 days ago");
  assert.equal(ageLabel("2026-09-01", today), "8 weeks ago");
  assert.equal(ageLabel("2026-07-01", today), "3+ months ago");
  assert.equal(ageLabel("2025-01-01", today), "1+ year ago");
});

test("filters and summary", () => {
  const rows = [inv({}), inv({ InvoiceID: "i2", InvoiceNumber: "INV-2", Status: "PAID", AmountDue: 0, AmountPaid: 600, Total: 600, DateString: "2025-05-01T00:00:00" }), inv({ InvoiceID: "i3", InvoiceNumber: "INV-3", Status: "VOIDED" })].map((x) => parseInvoice(x, today));
  assert.deepEqual(filterInvoices(rows, { state: "open" }, today).map((r) => r.number), ["INV-1"]);
  assert.deepEqual(filterInvoices(rows, { months: 6 }, today).map((r) => r.number), ["INV-1", "INV-3"]);
  assert.deepEqual(filterInvoices(rows, { q: "inv-2" }, today).map((r) => r.number), ["INV-2"]);
  const s = summarise(rows, today);
  assert.equal(s.owed, 1200); assert.equal(s.overdue, 1200); assert.equal(s.billed12, 1200); assert.equal(s.oldestOverdue?.number, "INV-1");
});

test("contact matching ignores Ltd and punctuation, and needs one clear match", () => {
  const c = (id: string, name: string) => ({ id, name, email: "", balance: 0 });
  assert.equal(pickContact("A.D. Bannister Roofing Ltd", [c("1", "A D Bannister Roofing Limited"), c("2", "Bannister Farms")])?.id, "1");
  assert.equal(pickContact("Smith", [c("1", "Smith & Co"), c("2", "Smith Bros")]), undefined);
});

test("pages are read until the last", async () => {
  const pages: Record<number, any[]> = { 1: Array.from({ length: 100 }, (_, i) => inv({ InvoiceID: `a${i}`, InvoiceNumber: `N${i}` })), 2: [inv({ InvoiceID: "z", InvoiceNumber: "Z" })] };
  const api = { get: async (_t: string, _a: string, _p: string, q: any) => ({ Invoices: pages[q.page] || [] }) } as any;
  assert.equal((await fetchInvoices(api, { tenantId: "t" }, "c1", today)).length, 101);
});
