import test from "node:test";
import assert from "node:assert/strict";
import { allocationYear, applyAccount, coveredBy, importedKeys, knownFor, parseAccount, parseBreakdown, placeholdersFor, planAccount, planBreakdown, removePlaceholders } from "../src/lib/hmrcAccount";
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

// A made-up breakdown in the layout HMRC copies (amounts and totals are invented)
const BREAKDOWN = [
  "27 Jan 2020\tFirst payment on account due 31 Jan 2020 (from payment/credit £1000.00)\t600.00",
  "27 Jan 2020\tSecond payment on account due 31 Jan 2021 (from payment/credit £1000.00)\t400.00",
  "23 Jan 2021\tBalancing payment due 31 Jan 2021 (from payment/credit £2000.00)\t500.00",
  "23 Jan 2021\tSecond payment on account due 31 Jan 2021 (from payment/credit £2000.00)\t1,500.00",
  "Total\t3,000.00",
].join("\n");

test("a breakdown is read line by line with its due date, the payment it came from and the total", () => {
  const b = parseBreakdown(BREAKDOWN);
  assert.equal(b.rows.length, 4);
  assert.equal(b.total, 3000);
  assert.deepEqual(b.rows.map((x) => x.alloc), ["poa1", "poa2", "balancing", "poa2"]);
  assert.equal(b.rows[1].due, "2021-01-31");
  assert.equal(b.rows[1].from, 1000);
});

test("each breakdown line goes to the tax year its due date belongs to, including a deferred second payment on account", () => {
  assert.equal(allocationYear("poa1", "2020-01-31"), 2020);
  assert.equal(allocationYear("poa2", "2021-01-31"), 2020); // deferred from July 2020
  assert.equal(allocationYear("poa2", "2020-07-31"), 2020);
  assert.equal(allocationYear("balancing", "2021-01-31"), 2020);
});

test("a payment whose breakdown adds up to it is covered, so the account line is not applied a second time", () => {
  const b = parseBreakdown(BREAKDOWN).rows;
  assert.deepEqual([...coveredBy(b)].sort(), ["2020-01-27|1000", "2021-01-23|2000"]);
  const { rows } = parseAccount("27 Jan 2020\tPayment\t1,000.00");
  assert.equal(planAccount(rows, new Map(), new Set(), {}, coveredBy(b))[0].status, "covered");
});

test("applying a breakdown replaces the unpaid placeholders with what was paid, and the payments add up to the total", () => {
  const returns = new Map<number, TaxReturn>([[2020, withPoas(2020, 600, 1500)]]);
  const plan = planBreakdown(parseBreakdown(BREAKDOWN).rows, returns, new Set());
  assert.ok(plan.every((p) => p.status === "match"));
  const out = applyAccount(plan, returns).get(2020)!;
  const lines = out.payments.lines!;
  assert.equal(lines.filter((l) => !l.paid).length, 0);
  assert.equal(lines.filter((l) => l.kind === "poa2").length, 2);
  assert.equal(Math.round(lines.reduce((a, l) => a + (l.paid ? l.amount || 0 : 0), 0) * 100) / 100, 3000);
  // bringing it in again adds nothing
  assert.equal(applyAccount(planBreakdown(parseBreakdown(BREAKDOWN).rows, new Map([[2020, out]]), importedKeys(new Map([[2020, out]]))), new Map([[2020, out]])).size, 0);
});

test("a breakdown payment already in the return is not added again", () => {
  const r = withPoas(2020, 600, 1500);
  r.payments.lines = [{ id: "a", kind: "poa1", label: "First payment on account", date: "2020-01-27", amount: 600, paid: true }];
  const plan = planBreakdown(parseBreakdown(BREAKDOWN).rows, new Map([[2020, r]]), new Set());
  assert.equal(plan[0].status, "system");
});

test("a placeholder payment on account is listed when the breakdown shows HMRC paid that kind for something else", () => {
  // the 2021 breakdown has a second payment on account paid, but no first: the 2021 first payment on account placeholder is not HMRC's
  const b = parseBreakdown("31 Jul 2021\tSecond payment on account due 31 Jul 2021 (from payment/credit £500.00)\t500.00").rows;
  const returns = new Map<number, TaxReturn>([[2021, withPoas(2021, 800, 800)]]);
  const ph = placeholdersFor(b, returns, "2026-11-03");
  assert.deepEqual(ph.map((x) => [x.year, x.id, x.overdue]), [[2021, "poa1", true]]);
  const out = removePlaceholders(new Map(), returns, ph.map((x) => ({ year: x.year, id: x.id })));
  const lines = out.get(2021)!.payments.lines!;
  assert.equal(lines.some((l) => l.id === "poa1"), false);
  assert.equal(lines.some((l) => l.id === "poa2"), true);
});

test("a placeholder that was paid, or came from the account, is not listed", () => {
  const b = parseBreakdown("31 Jul 2021\tSecond payment on account due 31 Jul 2021 (from payment/credit £500.00)\t500.00").rows;
  const r = withPoas(2021, 800, 800);
  r.payments.lines = [{ id: "x", kind: "poa1", label: "First payment on account", date: "2021-01-30", amount: 800, paid: true }, { id: "y", kind: "poa2", label: "Second", date: "2021-07-31", amount: 800, hmrcKey: "k" }];
  assert.deepEqual(placeholdersFor(b, new Map([[2021, r]]), "2026-11-03"), []);
});

test("each line from a breakdown remembers the whole payment it came from, so the part for this year is clear", () => {
  const returns = new Map<number, TaxReturn>([[2020, withPoas(2020, 600, 1500)]]);
  const out = applyAccount(planBreakdown(parseBreakdown(BREAKDOWN).rows, returns, new Set()), returns).get(2020)!;
  const first = out.payments.lines!.find((l) => l.kind === "poa1" && l.paid)!;
  assert.deepEqual(first.source, { date: "2020-01-27", amount: 1000 });
  const fromTwentyOne = out.payments.lines!.filter((l) => l.source?.amount === 2000).reduce((a, l) => a + (l.amount || 0), 0);
  assert.equal(fromTwentyOne, 2000);
});
