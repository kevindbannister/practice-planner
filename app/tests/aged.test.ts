import assert from "node:assert/strict";
import { test } from "node:test";
import { agedBook, fetchOpenInvoices } from "../src/lib/aged";

const inv = (id: string, contact: string, due: string, balance: number, status = "AUTHORISED") => ({ InvoiceID: id, InvoiceNumber: id, Status: status, Total: balance, AmountDue: balance, AmountPaid: 0, DueDateString: `${due}T00:00:00`, DateString: "2026-01-01T00:00:00", Contact: { ContactID: contact, Name: contact } });
const { parseInvoice } = await import("../src/lib/xeroInvoices");
const rows = (xs: ReturnType<typeof inv>[]) => xs.map((x) => parseInvoice(x, "2026-11-05"));

test("aged book groups by contact into columns and totals", () => {
  const b = agedBook(rows([inv("1", "Acme", "2026-11-20", 100), inv("2", "Acme", "2026-10-20", 200), inv("3", "Acme", "2026-07-01", 50), inv("4", "Bolt", "2026-09-01", 400)]), "2026-11-05");
  assert.deepEqual(b.contacts.map((c) => c.contact), ["Bolt", "Acme"]);
  const acme = b.contacts[1];
  assert.equal(acme.current, 100); assert.equal(acme.d30, 200); assert.equal(acme.d90p, 50); assert.equal(acme.total, 350);
  assert.equal(b.contacts[0].d90, 400); // 65 days late
  assert.equal(b.totals.total, 750); assert.equal(b.overdue, 650); assert.equal(b.overduePct, 86.67); assert.equal(b.count, 4);
  assert.equal(b.oldestLate, 127);
  assert.equal(acme.invoices[0].late, 127); // oldest first
});
test("aged book ignores drafts, voids and nothing owing", () => {
  const b = agedBook(rows([inv("1", "A", "2026-10-01", 0), inv("2", "A", "2026-10-01", 10, "DRAFT"), inv("3", "A", "2026-10-01", 10, "VOIDED")]), "2026-11-05");
  assert.equal(b.count, 0); assert.equal(b.totals.total, 0); assert.equal(b.overduePct, 0);
});
test("open invoices are read page by page", async () => {
  const calls: any[] = [];
  const api = { get: async (_t: string, _a: string, _p: string, q: any) => { calls.push(q); return { Invoices: q.page === 1 ? Array.from({ length: 100 }, (_, i) => inv(`a${i}`, "A", "2026-10-01", 5)) : [inv("z", "B", "2026-10-01", 7)] }; } };
  const out = await fetchOpenInvoices(api as never, "t", "ACCPAY", "2026-11-05");
  assert.equal(out.length, 101); assert.equal(calls.length, 2);
  assert.ok(calls[0].where.includes("ACCPAY") && calls[0].Statuses === "AUTHORISED");
});
