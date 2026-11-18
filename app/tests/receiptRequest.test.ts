import { test } from "node:test";
import assert from "node:assert/strict";
import { findHeader, guessColumns, parseCsv, readDate, readMoney, requestEmail, requestFileName, requestSheet, toTransactions, LIST_IN_EMAIL } from "../src/lib/receiptRequest.ts";

test("CSV: quotes, commas inside quotes, semicolons and blank lines", () => {
  assert.deepEqual(parseCsv('Date,Description,Amount\r\n01/02/2026,"Smith, J",-12.50\n\n'), [["Date", "Description", "Amount"], ["01/02/2026", "Smith, J", "-12.50"]]);
  assert.deepEqual(parseCsv('a;b\n"x ""y""";2'), [["a", "b"], ['x "y"', "2"]]);
});

test("dates and money in the forms banks and Xero use", () => {
  assert.equal(readDate("31/01/2026"), "2026-01-31");
  assert.equal(readDate("3-2-26"), "2026-02-03");
  assert.equal(readDate("5 Mar 2026"), "2026-03-05");
  assert.equal(readDate("2026-04-07T00:00:00"), "2026-04-07");
  assert.equal(readDate(46023), "2026-01-01");
  assert.equal(readDate("Opening balance"), "");
  assert.equal(readMoney("£1,234.50"), 1234.5);
  assert.equal(readMoney("(12.00)"), -12);
  assert.equal(readMoney("45.00 DR"), -45);
  assert.equal(readMoney("-3"), -3);
  assert.equal(readMoney(""), undefined);
  assert.equal(readMoney("n/a"), undefined);
});

test("a bank export with a title above the header, and money out and in columns", () => {
  const rows = [
    ["Acme Ltd current account"], [""],
    ["Date", "Transaction details", "Money out", "Money in", "Balance"],
    ["01/03/2026", "AMAZON MARKETPLACE", "45.99", "", "1000"],
    ["02/03/2026", "CLIENT PAYMENT", "", "500.00", "1500"],
    ["", "Closing balance", "", "", "1500"],
  ];
  const h = findHeader(rows);
  assert.equal(h, 2);
  const map = guessColumns(rows[h]);
  assert.deepEqual([map.date, map.description, map.out, map.in, map.amount], [0, 1, 2, 3, -1]);
  const t = toTransactions(rows, h, map);
  assert.deepEqual(t.map((x) => [x.date, x.description, x.amount, x.row]), [["2026-03-01", "AMAZON MARKETPLACE", -45.99, 4], ["2026-03-02", "CLIENT PAYMENT", 500, 5]]);
});

test("one signed amount column, with a reference", () => {
  const rows = [["Date", "Payee", "Reference", "Amount"], ["2026-01-05", "Staples", "INV-9", "-23.10"], ["2026-01-06", "Zero", "", "0"]];
  const map = guessColumns(rows[0]);
  assert.deepEqual([map.date, map.description, map.reference, map.amount], [0, 1, 2, 3]);
  assert.deepEqual(toTransactions(rows, 0, map).map((x) => [x.description, x.reference, x.amount]), [["Staples", "INV-9", -23.1]]);
});

test("the email lists up to ten, gives a reply date, and the attachment has a total", () => {
  const txns = Array.from({ length: 12 }, (_, i) => ({ row: i + 2, date: "2026-03-01", description: `Shop ${i + 1}`, reference: "", amount: -10 }));
  const e = requestEmail({ greeting: "Hi Sam,", txns, today: "2026-11-18", signName: "Kevin Smith", fileName: "x.xlsx" });
  assert.equal(e.subject, "Receipts and invoices needed: 12 transactions");
  assert.equal(e.replyBy, "2026-12-02");
  assert.match(e.body, /^Hi Sam,/);
  assert.match(e.body, /12 transactions, £120\.00 in all/);
  assert.match(e.body, /and 2 more in the spreadsheet/);
  assert.equal((e.body.match(/^- 1 Mar 2026/gm) || []).length, LIST_IN_EMAIL);
  assert.match(e.body, /by 2 Dec 2026/);
  assert.match(e.body, /Kevin$/);
  const one = requestEmail({ greeting: "Hi,", txns: txns.slice(0, 1), today: "2026-11-18", fileName: "x.xlsx" });
  assert.match(one.body, /one transaction, £10\.00 in all\. It's listed/);
  const sheet = requestSheet(txns.slice(0, 2));
  assert.equal(sheet.length, 4);
  assert.deepEqual(sheet[3], ["", "Total", "", -20, "", ""]);
  assert.equal(requestFileName("Smith / Jones", "2026-11-18"), "Receipts needed - Smith Jones - 2026-11-18.xlsx");
});
