import test from "node:test";
import assert from "node:assert/strict";
import { controlMovement, filterLines, groupLines, payeRecon, vatRecon } from "../src/lib/xeroViews";
import type { LedgerLine } from "../src/lib/xero";

const L = (d: string, amt: number, more: Partial<LedgerLine> = {}): LedgerLine => ({ d, a: "A", amt, ...more });

test("filter and group: by type, contact, month; months in date order", () => {
  const lines = [L("2026-01-10", 100, { t: "ACCREC", c: "Acme" }), L("2026-01-20", -40, { t: "ACCRECCREDIT", c: "Acme" }), L("2025-12-05", 50, { t: "ACCREC", c: "Bolt" })];
  assert.equal(filterLines(lines, { type: "ACCREC" }).length, 2);
  assert.equal(filterLines(lines, { contact: "Acme", from: "2026-01-15" }).length, 1);
  assert.equal(filterLines(lines, { q: "bolt" }).length, 1);
  const m = groupLines(lines, "month");
  assert.deepEqual(m.map((x) => [x.label, x.dr, x.cr, x.net]), [["Dec 2025", 50, 0, 50], ["Jan 2026", 100, 40, 60]]);
  assert.deepEqual(groupLines(lines, "contact").map((x) => [x.label, x.net]), [["Acme", 60], ["Bolt", 50]]);
});

test("control account movement agrees opening plus movements to the closing balance, on the normal side", () => {
  const deb = [L("2026-01-10", 1200, { t: "ACCREC" }), L("2026-01-20", -200, { t: "ACCRECCREDIT" }), L("2026-02-01", -700, { t: "ACCRECPAYMENT" }), L("2026-03-01", 50, { t: "MANJOURNAL" })];
  const d = controlMovement(deb, "debtors", 300, 650);
  assert.deepEqual(d.rows.map((r) => r.amount), [300, 1200, -200, -700, 50, 650]);
  assert.equal(d.difference, 0);
  const cred = [L("2026-01-10", -500, { t: "ACCPAY" }), L("2026-02-01", 200, { t: "ACCPAYPAYMENT" })];
  const c = controlMovement(cred, "creditors", -100, -400); // trial balance is a credit of 400 as a negative debit-signed figure
  assert.deepEqual(c.rows.map((r) => r.amount), [100, 500, 0, -200, 0, 400]);
  assert.equal(c.difference, 0);
  assert.equal(controlMovement(deb, "debtors", 300, 600).difference, 50);
});

test("VAT reconciliation compares each quarter's ledger figures with the return schedule", () => {
  const lines = [
    L("2026-05-10", -200, { t: "ACCREC", x: "VAT", rate: "20% (VAT on Income)" }),
    L("2026-06-10", 50, { t: "ACCPAY", x: "VAT", rate: "20% (VAT on Expenses)" }),
    L("2026-08-10", 150, { t: "SPEND", x: "VAT payment" }),
  ];
  const r = vatRecon(lines, "A", "2026-04-01", "2026-09-30", [3, 6, 9, 12], [{ Detail: "Apr–Jun 2026", out: 200, inp: 40, paid: 0 }], 0);
  assert.ok(r.rows.length >= 2);
  const q = r.rows[0];
  assert.deepEqual([q.ledger.out, q.ledger.inp], [200, 50]);
  assert.ok(q.owedEnd !== undefined);
});

test("PAYE reconciliation runs payroll due against ledger payments month by month", () => {
  const lines = [L("2026-05-22", 1000), L("2026-06-22", 1100)];
  const r = payeRecon(lines, "2026-04-01", "2026-06-30", [{ Detail: "Apr 2026", due: 1000 }, { Detail: "May 2026", due: 1100 }, { Detail: "Jun 2026", due: 1200 }], 0);
  assert.deepEqual(r.rows.map((x) => x.label), ["Apr 2026", "May 2026", "Jun 2026"]);
  assert.deepEqual(r.rows.map((x) => x.owedPayroll), [1000, 1100, 1200]);
  assert.deepEqual(r.rows.map((x) => x.paid), [0, 1000, 1100]);
  assert.equal(r.rows[2].diff, 1200 + 0 - r.rows[2].owedLedger);
});
