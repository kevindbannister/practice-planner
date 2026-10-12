// Tax payments: Self Assessment and corporation tax dates, the usual amounts, reminders.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_REMINDER, calcSa, ctDue, fillReminder, paymentLabel, paymentsForAi, poasFor, reminderGroups, saDates, saRows, taxYearLabel, taxYearOf,
} from "../src/lib/taxPayments";

test("tax years and Self Assessment due dates", () => {
  assert.equal(taxYearLabel(2025), "2025/26");
  assert.equal(taxYearLabel(2099), "2099/00");
  assert.equal(taxYearOf("2026-04-05"), 2025);
  assert.equal(taxYearOf("2026-04-06"), 2026);
  assert.deepEqual(saDates(2025), { balancing: "2027-01-31", poa1: "2027-01-31", poa2: "2027-07-31" });
});

test("corporation tax is due 9 months and a day after the period", () => {
  assert.equal(ctDue("2026-03-31"), "2027-01-01");
  assert.equal(ctDue("2026-06-30"), "2027-04-01");
  assert.equal(ctDue("2026-02-28"), "2026-12-01");
  assert.equal(ctDue("2026-05-15"), "2027-02-16");
});

test("the usual amounts", () => {
  assert.deepEqual(calcSa({ bill: 5000, other: 300, poaPaid: 4000, mostlyAtSource: false }), { balancing: 1300, poa1: 2500, poa2: 2500, refund: 0, why: "Each payment on account is half of this year's bill." });
  const small = calcSa({ bill: 900, other: 0, poaPaid: 0, mostlyAtSource: false });
  assert.equal(small.poa1, 0);
  assert.match(small.why, /under £1,000/);
  assert.equal(calcSa({ bill: 3000, other: 0, poaPaid: 0, mostlyAtSource: true }).poa2, 0);
  const refund = calcSa({ bill: 2000, other: 0, poaPaid: 3000, mostlyAtSource: false });
  assert.deepEqual([refund.balancing, refund.refund, refund.poa1], [0, 1000, 1000]);
  assert.equal(calcSa({ bill: 1234.57, other: 0, poaPaid: 0, mostlyAtSource: false }).poa1, 617.28); // rounded down to the penny
});

test("a year's three payments, and last year's payments on account", () => {
  let n = 0;
  const rows = saRows("C1", 2025, { balancing: 1300, poa1: 2500, poa2: 2500 }, () => `P${++n}`);
  assert.deepEqual(rows.map((r) => [r.Kind, r.TaxYear, r.DueDate, r.Amount]), [
    ["balancing", "2025/26", "2027-01-31", 1300], ["poa1", "2026/27", "2027-01-31", 2500], ["poa2", "2026/27", "2027-07-31", 2500],
  ]);
  assert.equal(paymentLabel(rows[1]), "2026/27 first payment on account");
  assert.equal(poasFor(rows, "C1", "2026/27"), 5000);
  assert.equal(poasFor(rows, "C1", "2025/26"), 0);
  assert.equal(paymentLabel({ Key: "x", ClientKey: "C", Tax: "CT", Kind: "ct", TaxYear: "2026-03-31" }), "Corporation tax for the period to 31 March 2026");
});

test("reminders: one per client and date, unpaid and due soon", () => {
  const p = (o: any) => ({ Key: Math.random().toString(), ClientKey: "C1", Tax: "SA", Kind: "balancing", ...o });
  const pays = [
    p({ Kind: "balancing", TaxYear: "2025/26", Amount: 1300, DueDate: "2027-01-31" }),
    p({ Kind: "poa1", TaxYear: "2026/27", Amount: 2500, DueDate: "2027-01-31" }),
    p({ Kind: "poa2", TaxYear: "2026/27", Amount: 2500, DueDate: "2027-07-31" }), // too far off
    p({ ClientKey: "C2", Kind: "poa1", Amount: 100, DueDate: "2027-01-31", PaidOn: "2027-01-10" }), // paid
    p({ ClientKey: "C3", Kind: "poa1", Amount: 0, DueDate: "2027-01-31" }), // nothing to pay
    p({ ClientKey: "C4", Tax: "CT", Kind: "ct", TaxYear: "2026-03-31", Amount: 800, DueDate: "2027-01-01", RemindedOn: "2026-12-10" }),
  ];
  const g = reminderGroups(pays, "2027-01-05", 30);
  assert.deepEqual(g.map((x) => [x.clientKey, x.due, x.total, x.overdue, x.reminded]), [
    ["C4", "2027-01-01", 800, true, "2026-12-10"], ["C1", "2027-01-31", 3800, false, undefined],
  ]);
  const mail = fillReminder(DEFAULT_REMINDER, g[1], { greeting: "Hi Tom,", utr: "12345 67890", sender: "Kevin" });
  assert.equal(mail.subject, "Tax to pay by 31 January 2027");
  assert.match(mail.body, /^Hi Tom,/);
  assert.match(mail.body, /- 2025\/26 balancing payment: £1,300\.00\n- 2026\/27 first payment on account: £2,500\.00/);
  assert.match(mail.body, /Total: \*\*£3,800\.00\*\*/);
  assert.match(mail.body, /\*\*1234567890K\*\*/);
  assert.match(fillReminder(DEFAULT_REMINDER, g[0], { greeting: "Hi", sender: "K" }).body, /17-character/);
  const ai = paymentsForAi(pays, "C1", "2027-01-05");
  assert.deepEqual(ai[0], { payment: "2025/26 balancing payment", amount: "£1,300.00", due: "2027-01-31", paid: "not paid yet" });
});
