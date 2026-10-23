import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPapers, sortTxns } from "../src/lib/bankStatement";
import { parseTbRows, rollForward, statutoryDest } from "../src/lib/openingBalances";
import { mapTb, paperAccounts } from "../src/lib/tbMap";

// Medifox Limited's trial balance for the year before, as the accounting software exports it
const SHEET: string[][] = [
  ["Name", "Debit", "Credit"],
  ["Turnover - Sales", "", "49738"],
  ["Administrative expenses - Employee costs - Directors' salaries", "12570", ""],
  ["Administrative expenses - Premises costs - Use of home", "624", ""],
  ["Administrative expenses - General - Sundry expenses", "47", ""],
  ["Administrative expenses - Legal & professional - Accountancy fees", "864", ""],
  ["Interest receivable", "", "90"],
  ["Taxation - Corporation tax", "6787", ""],
  ["Debtors less than 1 year - Accrued income and prepayments", "72", ""],
  ["Cash - Cash at bank and in hand", "3341", ""],
  ["Creditors less than 1 year - Corporation tax", "", "6730"],
  ["Creditors less than 1 year - Directors' loans", "4511", ""],
  ["Creditors less than 1 year - Accruals", "", "1048"],
  ["Share capital - Brought forward", "", "100"],
  ["Profit and loss account - Brought forward", "", "4010"],
  ["Profit and loss account - Equity dividends", "32900", ""],
];

const prior = "2025-09-30";
function priorMaps() {
  const { lines } = parseTbRows(SHEET);
  const rows = lines.map((l, i) => {
    const d = statutoryDest(l.Detail);
    return {
      Key: `L${i}`, ClientKey: "C1", PeriodEnd: prior, SectionKey: "tb", SubKey: "main", Code: l.Code, Detail: l.Detail, Seq: i + 1,
      Figures: JSON.stringify({ dr: l.dr || undefined, cr: l.cr || undefined, dest: d?.dest, iris: d?.iris }),
    };
  });
  return mapTb(paperAccounts(rows as never, "C1", prior), { lines: rows as never, papers: [] }, "C1", prior, []);
}

test("a trial balance sheet is read and checked", () => {
  const r = parseTbRows(SHEET);
  assert.equal(r.lines.length, 15);
  assert.deepEqual(r.problems, []);
  assert.equal(parseTbRows([["Name", "Debit", "Credit"], ["A", "10", ""], ["B", "", "4"]]).problems.length, 1);
  assert.match(parseTbRows([["nothing here"]]).problems[0], /No trial balance found/);
  // a single signed balance column and an account code
  const b = parseTbRows([["Code", "Account", "Balance"], ["100", "Sales", "-5.00"], ["200", "Bank", "5.00"], ["", "Total", "0"]]);
  assert.deepEqual(b.lines.map((l) => [l.Code, l.dr, l.cr]), [["100", 0, 5], ["200", 5, 0]]);
});

test("the headings in an accounts-style trial balance say where each account goes", () => {
  assert.equal(statutoryDest("Taxation - Corporation tax")?.dest, "taxation/current");
  assert.equal(statutoryDest("Creditors less than 1 year - Corporation tax")?.dest, "creditors/tax");
  assert.equal(statutoryDest("Creditors less than 1 year - Directors' loans")?.dest, "creditors/dla");
  assert.equal(statutoryDest("Profit and loss account - Equity dividends")?.dest, "capital/dividends");
  assert.equal(statutoryDest("Cash - Cash at bank and in hand")?.dest, "bank/current");
  assert.equal(statutoryDest("Sundry expenses"), undefined);
});

test("last year's profit and loss and dividends roll into reserves", () => {
  const r = rollForward(priorMaps());
  assert.equal(r.result, 28936);
  assert.equal(r.dividends, 32900);
  const by = Object.fromEntries(r.accounts.map((a) => [a.dest, a.balance]));
  assert.equal(by["capital/reserves"], -46);
  assert.equal(by["bank/current"], 3341);
  assert.equal(by["creditors/tax"], -6730);
  assert.equal(by["creditors/dla"], 4511);
  assert.equal(by["capital/shares"], -100);
  assert.equal(r.accounts.reduce((a, x) => a + x.balance, 0), 0);
});

test("this year's trial balance starts from the opening balances", () => {
  const { accounts } = rollForward(priorMaps());
  const items = sortTxns([
    { date: "2025-10-01", detail: "SLam Starling (Lam Salary)", amount: -1047.5, row: 1 },
    { date: "2025-10-17", detail: "INTEGRATED CARE BIN (IC24)", amount: 7170.03, bankCategory: "Revenue", row: 2 },
    { date: "2026-05-30", detail: "HMRC Shipley", amount: -6729.58, row: 3 },
  ]).map((t) => (t.detail.startsWith("HMRC") ? { ...t, cat: "ct", how: "you" as const } : t));
  const closing = 3340.21 - 1047.5 + 7170.03 - 6729.58;
  const b = buildPapers(items, 3340.21, "Starling", "692", accounts);
  const line = (n: RegExp) => b.tb.find((l) => n.test(l.Detail))!;
  // the corporation tax paid clears most of last year's liability instead of making a new account
  assert.equal(line(/Corporation tax/).f.cr, 0.42);
  assert.equal(b.tb.filter((l) => /tax/i.test(l.Detail) && l.f.type === "Balance sheet").length, 1);
  assert.equal(line(/Cash/).f.dr, Math.round(closing * 100) / 100);
  assert.equal(line(/Directors' loans/).f.dr, 4511);
  // the bank per the statement at the start is 0.79 less than last year's trial balance: shown, not hidden
  const diff = b.tb.find((l) => l.Code === "BFWD")!;
  assert.equal(diff.Detail, "Difference on opening balances");
  assert.equal(diff.f.dr, 0.79);
  const dr = b.tb.reduce((a, l) => a + (l.f.dr || 0), 0), cr = b.tb.reduce((a, l) => a + (l.f.cr || 0), 0);
  assert.equal(Math.round(dr * 100), Math.round(cr * 100));
});
