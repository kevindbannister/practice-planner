import test from "node:test";
import assert from "node:assert/strict";
import { applyAccount, importedKeys, knownFor, parseAccount, planAccount } from "../src/lib/hmrcAccount";
import { TaxReturn, emptyReturn } from "../src/lib/tax";

// Made-up lines in the layout the HMRC account page copies in (not a real client's figures)
const SAMPLE = [
  "30 Jul 2026\tPayment\t1,111.11",
  "30 Jan 2026\tPayment\t1,222.22",
  "31 Jan 2023\tRepayment supplement (interest)\t.08",
  "31 Jul 2021\tRepayment supplement (interest)\t.44",
  "09 Jan 2023\tPayment\t1,333.33",
  "01 Feb 2022\tPayment\t1,444.44",
  "14 Feb 2019\tPayment\t869.03",
  "31 Jul 2024\tLate payment interest\t12.34",
].join("\n");

const withPoas = (year: number, poa1: number, poa2: number): TaxReturn => {
  const r = emptyReturn();
  r.payments.expectedPoa1 = poa1;
  r.payments.expectedPoa2 = poa2;
  return r;
};

test("parseAccount reads date, description and amount, including a leading-point amount", () => {
  const { rows, skipped } = parseAccount(SAMPLE);
  assert.equal(rows.length, 8);
  assert.deepEqual(skipped, []);
  assert.deepEqual({ d: rows[0].date, k: rows[0].kind, a: rows[0].amount }, { d: "2026-07-30", k: "payment", a: 1111.11 });
  assert.equal(rows[2].kind, "interest");
  assert.equal(rows[2].amount, 0.08);
  assert.equal(rows[7].kind, "charge");
});

test("parseAccount keeps headings as skipped lines and numbers a repeated line", () => {
  const { rows, skipped } = parseAccount("Date Description Amount\n5 Jan 2025 Payment 100.00\n5 Jan 2025 Payment 100.00\n");
  assert.deepEqual(skipped, ["Date Description Amount"]);
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].key, rows[1].key);
});

test("a July payment is the second payment on account of the year ending that July", () => {
  const { rows } = parseAccount("30 Jul 2026\tPayment\t1,111.11");
  const plan = planAccount(rows, new Map([[2026, withPoas(2026, 900, 1111.11)]]), new Set());
  assert.equal(plan[0].status, "match");
  assert.deepEqual(plan[0].role, { kind: "poa2", year: 2026 });
});

test("a January payment matches the first payment on account of that year, else the balance of the year before", () => {
  const { rows } = parseAccount("30 Jan 2026\tPayment\t1,222.22");
  const returns = new Map([[2026, withPoas(2026, 1222.22, 900)]]);
  assert.deepEqual(planAccount(rows, returns, new Set())[0].role, { kind: "poa1", year: 2026 });
  const other = planAccount(rows, new Map([[2026, withPoas(2026, 500, 500)]]), new Set());
  assert.equal(other[0].status, "check");
  assert.deepEqual(other[0].role, { kind: "poa1", year: 2026 });
});

test("a February payment is the balance for the year before, and a line before the held years is left out", () => {
  const { rows } = parseAccount("01 Feb 2022\tPayment\t1,444.44\n14 Feb 2019\tPayment\t869.03");
  const plan = planAccount(rows, new Map(), new Set());
  assert.deepEqual(plan[0].role, { kind: "balancing", year: 2021 });
  assert.equal(plan[0].status, "check");
  assert.equal(plan[1].status, "outside");
});

test("interest goes to the tax year it falls in; a late payment interest line is a late increase", () => {
  const { rows } = parseAccount("31 Jul 2021\tRepayment supplement (interest)\t.44\n31 Jul 2024\tLate payment interest\t12.34");
  const plan = planAccount(rows, new Map(), new Set());
  assert.deepEqual(plan[0].role, { kind: "credit", year: 2022 });
  assert.deepEqual(plan[1].role, { kind: "charge", year: 2025 });
});

test("knownFor works out the balance a year owes once its payments on account are taken off", () => {
  const r = withPoas(2026, 1000, 1000);
  const k = knownFor(new Map([[2026, r]]), 2026);
  assert.equal(k.poa1, 1000);
  assert.equal(k.poa2, 1000);
  assert.equal(k.balancing, undefined); // no income, so nothing owed beyond the payments on account
});

test("applying a plan ticks the payment on account, adds the balance and late charge, and stores the credit once", () => {
  const { rows } = parseAccount("30 Jul 2026\tPayment\t1,111.11\n31 Jul 2024\tLate payment interest\t12.34\n31 Jul 2021\tRepayment supplement (interest)\t.44");
  const returns = new Map<number, TaxReturn>([[2026, withPoas(2026, 900, 1111.11)]]);
  const plan = planAccount(rows, returns, new Set());
  const out = applyAccount(plan, returns);

  const r26 = out.get(2026)!;
  const poa2 = r26.payments.lines!.find((l) => l.kind === "poa2")!;
  assert.equal(poa2.paid, true);
  assert.equal(poa2.date, "2026-07-30");
  assert.equal(poa2.amount, 1111.11);
  assert.ok(r26.payments.imported!.includes(rows[0].key));

  const late = out.get(2025)!.payments.lines!.find((l) => l.late);
  assert.equal(late?.late, 12.34);
  assert.equal(out.get(2025)!.payments.lines!.length, 3); // the created return keeps the two payments on account and the charge
  assert.equal(out.get(2022)!.payments.credits![0].amount, 0.44);

  // the inputs are not changed, and a second apply adds nothing
  assert.equal(returns.get(2026)!.payments.lines, undefined);
  const again = applyAccount(planAccount(rows, out, importedKeys(out)), out);
  assert.equal(again.size, 0);
});

test("a line the person sets to a year, or skips, is applied or left out", () => {
  const { rows } = parseAccount("13 Jul 2019\tPayment\t819.81");
  const plan = planAccount(rows, new Map(), new Set(), { 0: { kind: "payment", year: 2020 } });
  assert.equal(plan[0].status, "check");
  const out = applyAccount(plan, new Map());
  assert.ok(out.get(2020));
  const skipped = planAccount(rows, new Map(), new Set(), { 0: null });
  assert.equal(skipped[0].status, "skip");
  assert.equal(applyAccount(skipped, new Map()).size, 0);
});


test("a payment already in the return is not added again, even though it was entered by hand", () => {
  const r = withPoas(2026, 1222.22, 1111.11);
  // the first payment on account was ticked by hand, with the same amount and date as the account shows
  r.payments.lines = [{ id: "poa1", kind: "poa1", label: "First payment on account", date: "2026-01-30", amount: 1222.22, paid: true }];
  const returns = new Map([[2026, r]]);
  const { rows } = parseAccount("30 Jan 2026\tPayment\t1,222.22");
  const plan = planAccount(rows, returns, new Set());
  assert.equal(plan[0].status, "system");
  assert.equal(applyAccount(plan, returns).size, 0);
});

test("a paid payment on account with a different amount is flagged, not skipped", () => {
  const r = withPoas(2026, 1222.22, 1111.11);
  r.payments.lines = [{ id: "poa1", kind: "poa1", label: "First payment on account", date: "2026-01-30", amount: 1000, paid: true }];
  const plan = planAccount(parseAccount("30 Jan 2026\tPayment\t1,222.22").rows, new Map([[2026, r]]), new Set());
  assert.equal(plan[0].status, "check");
});

test("an unpaid payment on account is ticked by the HMRC line, and the line remembers where it came from", () => {
  const returns = new Map([[2026, withPoas(2026, 1222.22, 1111.11)]]);
  const { rows } = parseAccount("30 Jan 2026\tPayment\t1,222.22");
  const out = applyAccount(planAccount(rows, returns, new Set()), returns).get(2026)!;
  const lines = out.payments.lines!.filter((l) => l.kind === "poa1");
  assert.equal(lines.length, 1);
  assert.equal(lines[0].paid, true);
  assert.equal(lines[0].hmrcKey, rows[0].key);
});

test("a line left out of the approved plan is not applied", () => {
  const returns = new Map([[2026, withPoas(2026, 1222.22, 1111.11)]]);
  const { rows } = parseAccount("30 Jan 2026\tPayment\t1,222.22");
  const plan = planAccount(rows, returns, new Set()).map((p) => ({ ...p, role: undefined }));
  assert.equal(applyAccount(plan, returns).size, 0);
});
