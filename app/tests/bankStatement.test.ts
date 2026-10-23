import test from "node:test";
import assert from "node:assert/strict";
import { Item, buildPapers, parseCsv, parseLines, ruleCategory, sortTxns, toAmount, toDate } from "../src/lib/bankStatement";

const row = (y: number, ...c: [number, string][]): Item[] => c.map(([x, text]) => ({ x, text, w: text.length * 4.5 }));
// laid out like Starling's transaction export: right-aligned money under VALUE and BALANCE, text wrapping onto a second line
const lines: Item[][] = [
  row(1, [40, "Transaction Export"]),
  row(2, [40, "DATE"], [110, "TYPE"], [200, "TRANSACTION"], [330, "CATEGORY"], [450, "VALUE"], [530, "BALANCE"]),
  row(3, [40, "01/10/2025"], [110, "Faster Payment"], [200, "SLam Starling (Lam"], [330, "Directors"], [440, "-£1,047.50"], [520, "+£2,292.71"]),
  row(4, [200, "Salary)"], [330, "Wages"]),
  row(5, [40, "17/10/2025"], [110, "Faster Payment"], [200, "INTEGRATED CARE BIN"], [330, "Revenue"], [445, "+£7,170.03"], [520, "+£9,462.74"]),
  row(6, [200, "(IC24)"]),
  row(7, [40, "Page 2 of 4"]),
  row(8, [40, "DATE"], [110, "TYPE"], [200, "TRANSACTION"], [330, "CATEGORY"], [450, "VALUE"], [530, "BALANCE"]),
  row(9, [40, "01/11/2025"], [110, "Faster Payment"], [200, "SLam Starling (Lam"], [330, "Directors"], [440, "-£1,047.50"], [520, "+£8,415.24"]),
  row(10, [200, "Salary)"], [330, "Wages"]),
];

test("reads a statement table: columns from the header, wrapped text joined, repeated headers skipped", () => {
  const s = parseLines(lines);
  assert.equal(s.txns.length, 3);
  assert.deepEqual(s.txns.map((t) => t.amount), [-1047.5, 7170.03, -1047.5]);
  assert.equal(s.txns[0].detail, "SLam Starling (Lam Salary)");
  assert.equal(s.txns[0].bankCategory, "Directors Wages");
  assert.equal(s.txns[1].detail, "INTEGRATED CARE BIN (IC24)");
  assert.equal(s.opening, 3340.21);
  assert.equal(s.closing, 8415.24);
  assert.equal(s.in, 7170.03);
  assert.equal(s.out, 2095);
  assert.deepEqual(s.problems, []);
});

test("a balance that doesn't follow is reported", () => {
  const bad = lines.map((l) => l.map((i) => (i.text === "+£9,462.74" ? { ...i, text: "+£9,000.00" } : i)));
  const s = parseLines(bad);
  assert.ok(s.problems.some((p) => /balance doesn't follow/.test(p)));
});

test("no table found says so", () => {
  assert.match(parseLines([row(1, [10, "Just some text"])]).problems[0], /No table of transactions/);
});

test("amounts and dates in the usual bank formats", () => {
  assert.equal(toAmount("-£1,047.50"), -1047.5);
  assert.equal(toAmount("+£7,170.03"), 7170.03);
  assert.equal(toAmount("(12.00)"), -12);
  assert.equal(toAmount("1,000.00 DR"), -1000);
  assert.equal(toAmount("abc"), undefined);
  assert.equal(toDate("01/10/2025"), "2025-10-01");
  assert.equal(toDate("1 Oct 2025"), "2025-10-01");
  assert.equal(toDate("2025-10-01"), "2025-10-01");
  assert.equal(toDate("Faster Payment"), undefined);
});

test("CSV with paid in and paid out columns, newest first", () => {
  const s = parseCsv('Date,Description,Paid out,Paid in,Balance\n03/11/2025,"ACME, LTD",,500.00,1400.00\n02/11/2025,RENT,100.00,,900.00\n01/11/2025,SHOP,50.00,,1000.00\n');
  assert.deepEqual(s.txns.map((t) => t.detail), ["SHOP", "RENT", "ACME, LTD"]);
  assert.equal(s.opening, 1050);
  assert.equal(s.closing, 1400);
  assert.deepEqual(s.problems, []);
});

test("rules sort the obvious, leave HMRC to a person, and remember choices", () => {
  const cat = (detail: string, amount: number, bankCategory = "") => ruleCategory({ detail, amount, bankCategory });
  assert.equal(cat("SLam Starling (Lam Salary)", -1047.5), "dirpay");
  assert.equal(cat("SLam Starling (Lam Dividends 2026)", -30000, "Dividends"), "dividends");
  assert.equal(cat("INTEGRATED CARE BIN (IC24)", 7170, "Revenue"), "sales");
  assert.equal(cat("HMRC Shipley", -6729.58), "suspense");
  assert.equal(cat("HMRC VAT", -1000), "vat");
  assert.equal(cat("Some unknown shop", -20), undefined);
  assert.equal(ruleCategory({ detail: "Some unknown shop 123", amount: -20 }, { "some unknown shop": "rent" }), "rent");
});

test("the trial balance balances, with the opening bank position as a balancing figure", () => {
  const s = parseLines(lines);
  const b = buildPapers(sortTxns(s.txns), s.opening, "Starling");
  const dr = b.tb.reduce((a, l) => a + (l.f.dr || 0), 0), cr = b.tb.reduce((a, l) => a + (l.f.cr || 0), 0);
  assert.equal(Math.round(dr * 100), Math.round(cr * 100));
  assert.equal(b.receipts, 7170.03);
  assert.equal(b.payments, 2095);
  const bank = b.tb.find((l) => l.Code === "BANK")!;
  assert.equal(bank.f.dr, 8415.24);
  assert.equal(bank.f.iris, "692");
  assert.equal(b.tb.find((l) => l.Code === "SALES")!.f.cr, 7170.03);
  assert.equal(b.tb.find((l) => l.Code === "DIRPAY")!.f.dr, 2095);
  assert.equal(b.balancingFigure, 3340.21);
});
