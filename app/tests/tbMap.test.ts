// Mapping a trial balance to IRIS codes and the working paper schedules.
import assert from "node:assert/strict";
import { test } from "node:test";
import { linesFor } from "../src/lib/papers";
import { DEST_BY_KEY, guessDest, guessIris, mapTb, parseChart, postings, tbTotals } from "../src/lib/tbMap";

const tbRow = (Key: string, Code: string, Detail: string, type: string, dr?: number, cr?: number, extra: any = {}, period = "2026-03-31", client = "C1") => ({
  Key, ClientKey: client, PeriodEnd: period, SectionKey: "tb", SubKey: "main", Code, Detail, Seq: Number(Code) || 1,
  Figures: JSON.stringify({ type, dr, cr, ...extra }),
});

test("accounts go to the right schedule from their name and type", () => {
  const cases: [string, string, number, string][] = [
    ["Debtors Control Account", "Current Asset", 100, "debtors/trade"],
    ["Prepayments", "Current Asset", 100, "debtors/prepayments"],
    ["Accrued Income", "Current Asset", 100, "debtors/accrued"],
    ["Creditors Control Account", "Current Liability", -100, "creditors/trade"],
    ["Accruals", "Current Liability", -100, "creditors/accruals"],
    ["VAT Liability", "Current Liability", -100, "creditors/ssot"],
    ["PAYE and NI", "Current Liability", -100, "creditors/ssot"],
    ["Corporation Tax", "Current Liability", -100, "creditors/tax"],
    ["Directors loan account", "Current Liability", -100, "creditors/dla"],
    ["Hire Purchase - Van", "Non-current Liability", -100, "creditors/hp"],
    ["Ordinary Shares", "Equity", -2, "capital/shares"],
    ["Profit and Loss Account", "Equity", -100, "capital/reserves"],
    ["Business Current Account", "Bank", 100, "bank/current"],
    ["Petty Cash", "Current Asset", 10, "bank/cash"],
    ["Motor Vehicles - Cost", "Fixed Asset", 100, "fixed/motor#cost"],
    ["Motor Vehicles - Accumulated Depreciation", "Fixed Asset", -100, "fixed/motor#dep"],
    ["Office Equipment", "Fixed Asset", 100, "fixed/plant#cost"],
    ["Sales", "Revenue", -100, "income/sales"],
    ["Bank Interest Received", "Other Income", -1, "income/interest"],
    ["Accountancy Fees", "Overheads", 100, "expenditure/accountancy"],
    ["Rent", "Overheads", 100, "expenditure/tb"],
    ["Cost of Sales", "Direct Costs", 100, "expenditure/cos"],
    ["Purchases", "Expense", 100, "expenditure/cos"],
    ["Motor Expenses", "Overheads", 100, "expenditure/tb"],
    ["Loan to another company", "Current Asset", 100, "debtors/other"],
    ["Loan from a lender", "Non-current Liability", -100, "creditors/other"],
  ];
  for (const [name, type, bal, want] of cases) {
    assert.equal(guessDest(name, type, bal), want, name);
    assert.ok(DEST_BY_KEY.has(want), want);
  }
});

test("the IRIS chart: pasted or CSV, codes matched by name", () => {
  const chart = parseChart("Code,Name\n500,Trade debtors\n\"560\",\"Prepayments and accrued income\"\n620\tAccruals\tcreditors/accruals");
  assert.deepEqual(chart.map((c) => c.code), ["500", "560", "620"]);
  assert.equal(chart[2].dest, "creditors/accruals");
  assert.equal(guessIris("Accruals", chart)?.code, "620");
  assert.equal(guessIris("Trade Debtors", chart)?.code, "500");
  assert.equal(guessIris("Sales", chart), undefined);
});

test("mapping learns from last year and other companies, then posts balances to lists", () => {
  const all = [
    tbRow("p1", "1100", "Debtors Control", "Current Asset", 50, undefined, { dest: "debtors/other", iris: "999" }, "2025-03-31"),
    tbRow("o1", "7", "Website costs", "Overheads", 10, undefined, { dest: "expenditure/accountancy" }, "2026-03-31", "C2"),
    tbRow("a", "1100", "Debtors Control", "Current Asset", 120),
    tbRow("b", "2109", "Accruals", "Current Liability", undefined, 500),
    tbRow("c", "8000", "Website costs", "Overheads", 30),
    tbRow("d", "0050", "Motor Vehicles Cost", "Fixed Asset", 20000),
    tbRow("e", "3000", "Ordinary Shares", "Equity", undefined, 2, { dest: "capital/shares" }),
  ];
  const tb = linesFor(all, "C1", "2026-03-31", "tb", "main");
  const maps = mapTb(tb, all, "C1", "2026-03-31", []);
  const by = Object.fromEntries(maps.map((m) => [m.line.Code, m]));
  assert.equal(by["1100"].dest, "debtors/other"); // as last year
  assert.equal(by["1100"].iris, "999");
  assert.equal(by["8000"].dest, "expenditure/accountancy"); // as at another company
  assert.equal(by["2109"].dest, "creditors/accruals");
  assert.equal(by["3000"].saved, true);
  const posts = postings(maps);
  // liabilities and equity show as positive credits; registers aren't posted (they're checked)
  assert.deepEqual(posts.map((p) => [p.dest.key, p.Amount]), [["debtors/other", 120], ["creditors/accruals", 500], ["capital/shares", 2]]);
  const totals = tbTotals(maps);
  assert.equal(totals.get("fixed/motor#cost"), 20000);
  assert.equal(totals.get("expenditure/accountancy"), 30);
});
