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

test("invoice stages are taken out of every type of work, and jobs and client settings follow", async () => {
  const { withoutInvoiceStages, isInvoiceStage, bundleWithoutInvoiceStages } = await import("../src/lib/invoicing.ts");
  assert.equal(isInvoiceStage("Raise invoice"), true);
  assert.equal(isInvoiceStage("Invoicing"), true);
  assert.equal(isInvoiceStage("Billing"), true);
  assert.equal(isInvoiceStage("Bill client"), true);
  assert.equal(isInvoiceStage("Bookkeeping"), false);
  assert.equal(isInvoiceStage("Review purchase invoices"), false);
  assert.equal(isInvoiceStage("Invoice client"), true);
  assert.equal(isInvoiceStage("Send invoice"), true);
  assert.equal(isInvoiceStage("Raise an invoice"), true);
  assert.equal(isInvoiceStage("Sales invoices to Xero"), false);
  const st = [
    { Key: "a1", ServiceKey: "ACCS", StageNo: 1, Title: "Prepare" }, { Key: "a2", ServiceKey: "ACCS", StageNo: 2, Title: "Raise invoice" },
    { Key: "a3", ServiceKey: "ACCS", StageNo: 3, Title: "File" }, { Key: "v1", ServiceKey: "VAT", StageNo: 1, Title: "Prepare" },
  ];
  const jobs = [
    { Key: "j1", ServiceKey: "ACCS", StageNo: 1 }, { Key: "j2", ServiceKey: "ACCS", StageNo: 2 }, { Key: "j3", ServiceKey: "ACCS", StageNo: 3 },
    { Key: "j4", ServiceKey: "VAT", StageNo: 1 },
  ];
  const cs = [{ Key: "c2", ServiceKey: "ACCS", StageNo: 2, Who: "Sam" }, { Key: "c3", ServiceKey: "ACCS", StageNo: 3, Who: "Ann" }];
  const t = withoutInvoiceStages(st, jobs, cs);
  assert.deepEqual(t.removeStages.map((s) => s.Key), ["a2"]);
  assert.deepEqual(t.stagePatches.map((p) => [p.row.Key, p.patch.StageNo]), [["a3", 2]]);
  assert.deepEqual(t.jobPatches.map((p) => [p.row.Key, p.patch.StageNo, p.patch.StageName]), [["j2", 1, "Prepare"], ["j3", 2, "File"]]);
  assert.deepEqual(t.removeClientStages.map((r) => r.Key), ["c2"]);
  assert.deepEqual(t.clientStagePatches.map((p) => [p.row.Key, p.patch.StageNo]), [["c3", 2]]);
  // the last stage
  const last = withoutInvoiceStages([{ Key: "x1", ServiceKey: "S", StageNo: 1, Title: "Do" }, { Key: "x2", ServiceKey: "S", StageNo: 2, Title: "Invoice" }], [{ Key: "k", ServiceKey: "S", StageNo: 2 }], []);
  assert.deepEqual(last.jobPatches.map((p) => [p.patch.StageNo, p.patch.StageName]), [[1, "Do"]]);
  assert.deepEqual(last.stagePatches, []);
  // a bundle
  const b = bundleWithoutInvoiceStages({ lists: { StageTemplates: st, Jobs: jobs, ClientServiceStages: cs } });
  assert.deepEqual(b.lists.StageTemplates!.map((s) => [s.Key, s.StageNo]), [["a1", 1], ["a3", 2], ["v1", 1]]);
  assert.deepEqual(b.lists.Jobs!.map((j) => j.StageNo), [1, 1, 2, 1]);
  assert.deepEqual(b.lists.ClientServiceStages!.map((r) => [r.Key, r.StageNo]), [["c3", 2]]);
  // nothing to do: the same bundle back
  const plain = { lists: { StageTemplates: [st[0]] } };
  assert.equal(bundleWithoutInvoiceStages(plain), plain);
});
