// Working papers: periods, totals, last year's figures and pasted lines.
import assert from "node:assert/strict";
import { test } from "node:test";
import { SECTIONS, carryForward, leadTotals, linesFor, money, parseAmount, parsePasted, priorFor, priorPeriod, progress, stateOf, total, yearEnds } from "../src/lib/papers";

const line = (o: any) => ({ ClientKey: "C1", PeriodEnd: "2026-03-31", SectionKey: "debtors", SubKey: "trade", Order: 1, ...o });

test("year ends: newest past ones, and the next to come", () => {
  assert.deepEqual(yearEnds("03-31", "2026-10-19", 2), ["2027-03-31", "2026-03-31", "2025-03-31"]);
  assert.deepEqual(yearEnds(undefined, "2026-10-19"), []);
  assert.equal(yearEnds("02-28", "2024-06-01", 1)[1], "2024-02-29");
});

test("the prior period keeps month ends, leap years included", () => {
  assert.equal(priorPeriod("2026-03-31"), "2025-03-31");
  assert.equal(priorPeriod("2025-02-28"), "2024-02-29");
  assert.equal(priorPeriod("2024-02-29"), "2023-02-28");
  assert.equal(priorPeriod("2026-04-05"), "2025-04-05");
});

test("amounts are typed freely", () => {
  assert.equal(parseAmount("£1,234.50"), 1234.5);
  assert.equal(parseAmount("(200)"), -200);
  assert.equal(parseAmount("-5.5"), -5.5);
  assert.equal(parseAmount(""), undefined);
  assert.equal(parseAmount("abc"), undefined);
  assert.equal(money(-1234.5), "(1,234.50)");
  assert.equal(money(undefined), "");
});

test("totals add pence correctly and last year's figures match on the detail", () => {
  assert.equal(total([{ Amount: 0.1 }, { Amount: 0.2 }, { Amount: undefined }]), 0.3);
  const rows = [
    line({ Key: "a", Detail: "Acme Ltd", Amount: 100 }),
    line({ Key: "b", Detail: "Bolt Ltd", Amount: 50.5, Order: 2 }),
    line({ Key: "p", PeriodEnd: "2025-03-31", Detail: "ACME LTD", Amount: 80 }),
    line({ Key: "q", PeriodEnd: "2025-03-31", Detail: "Cog Ltd", Amount: 20, Order: 2 }),
    line({ Key: "o", ClientKey: "C2", Detail: "Other client", Amount: 999 }),
  ];
  assert.deepEqual(linesFor(rows, "C1", "2026-03-31", "debtors", "trade").map((l) => l.Detail), ["Acme Ltd", "Bolt Ltd"]);
  assert.equal(priorFor(rows, "C1", "2026-03-31", "debtors", "trade", "acme ltd"), 80);
  assert.equal(priorFor(rows, "C1", "2026-03-31", "debtors", "trade", "Bolt Ltd"), undefined);
  assert.deepEqual(carryForward(rows, "C1", "2026-03-31", "debtors", "trade").map((l) => l.Detail), ["Cog Ltd"]);
  const lead = leadTotals(SECTIONS.find((x) => x.key === "debtors")!, rows, "C1", "2026-03-31");
  assert.deepEqual(lead.map((x) => [x.sub.key, x.now, x.before]), [["trade", 150.5, 100], ["prepayments", 0, 0], ["accrued", 0, 0], ["other", 0, 0]]);
});

test("progress and sign-off live on the section row", () => {
  const rows = [
    { ClientKey: "C1", PeriodEnd: "2026-03-31", ItemKey: "bank", Status: "done", PreparedBy: "KB", ReviewedBy: "" },
    { ClientKey: "C1", PeriodEnd: "2026-03-31", ItemKey: "debtors", Status: "doing" },
  ];
  assert.deepEqual(progress("C1", "2026-03-31", rows), { done: 1, started: 1, total: SECTIONS.length });
  assert.equal(stateOf(rows, "C1", "2026-03-31", "bank").preparedBy, "KB");
  assert.equal(stateOf(rows, "C1", "2025-03-31", "bank").status, "todo");
});

test("pasted rows from Excel", () => {
  assert.deepEqual(parsePasted("Acme Ltd\t1,200.00\nBolt Ltd\t(50)\n\n"), [
    { Code: "", Detail: "Acme Ltd", Amount: 1200 }, { Code: "", Detail: "Bolt Ltd", Amount: -50 },
  ]);
  assert.deepEqual(parsePasted("4000\tSales\t300"), [{ Code: "4000", Detail: "Sales", Amount: 300 }]);
  assert.deepEqual(parsePasted("Just a name"), [{ Code: "", Detail: "Just a name", Amount: undefined }]);
});
