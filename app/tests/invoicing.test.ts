import { test } from "node:test";
import assert from "node:assert/strict";
import { INVOICE_SERVICE, billedJobKey, invoiceJobFor, invoiceServiceRow, isInvoiceJob, readAmount, workGroupOf } from "../src/lib/invoicing.ts";

const job = { Key: "J1", ClientKey: "C1", ClientName: "Acme Ltd", ServiceKey: "ACCS_LTD", Title: "Accounts 2026", PeriodEnd: "2026-03-31", Fee: 950, FeePeriod: "annual", Owner: "Sam" };

test("an invoice job carries the client, the work it bills, the period, the fee and a deadline a week out", () => {
  const inv = invoiceJobFor(job, { key: "J9", today: "2026-11-18", amount: 950, note: "Add the VAT return too" });
  assert.equal(inv.ServiceKey, INVOICE_SERVICE);
  assert.equal(inv.ClientKey, "C1");
  assert.equal(inv.Title, "Invoice: Accounts 2026");
  assert.equal(inv.PeriodEnd, "2026-03-31");
  assert.equal(inv.Deadline, "2026-11-25");
  assert.equal(inv.Fee, 950);
  assert.equal(inv.Owner, "Sam");
  assert.equal(inv.Status, "Open");
  assert.match(String(inv.Notes), /period to 2026-03-31/);
  assert.match(String(inv.Notes), /£950\.00 \(annual\)/);
  assert.match(String(inv.Notes), /Add the VAT return too/);
  assert.equal(billedJobKey(inv), "J1");
  assert.equal(isInvoiceJob(inv), true);
  assert.equal(isInvoiceJob(job), false);
  assert.equal(billedJobKey(job), undefined);
});

test("no amount is fine; amounts are read with or without a pound sign", () => {
  const inv = invoiceJobFor(job, { key: "J9", today: "2026-12-30" });
  assert.equal(inv.Fee, undefined);
  assert.equal(inv.Deadline, "2027-01-06");
  assert.match(String(inv.Notes), /Amount: not set/);
  assert.equal(readAmount("£1,250.5"), 1250.5);
  assert.equal(readAmount(""), undefined);
  assert.equal(readAmount("abc"), undefined);
  assert.equal(readAmount("-5"), undefined);
});

test("invoices are their own group, apart from statutory and other work", () => {
  assert.equal(workGroupOf(INVOICE_SERVICE, [invoiceServiceRow()]), "invoice");
  assert.equal(workGroupOf("VAT", []), "statutory");
  assert.equal(workGroupOf("BOOKKEEPING", []), "other");
  assert.equal(invoiceServiceRow().RepeatMonths, 0);
});
