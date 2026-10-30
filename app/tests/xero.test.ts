// Reading a year's books from Xero: the trial balance, the nominal ledger (from the Account Data
// API, or rebuilt from documents), debtors and creditors listings, bank, VAT and payroll. Runs the
// real import against the demo stand-in, which answers in Xero's formats with invented books.
import assert from "node:assert/strict";
import { test } from "node:test";
import { FakeXero } from "../src/lib/fakeXero";
import { acctKey } from "../src/lib/papers";
import {
  DEFAULT_OPTIONS, ImportPart, contactBalances, ledgerCheck, parseTrialBalance, payrollByMonth, r2, readFromXero, scopesFor, vatByQuarter, vatPeriods, xDate, yearStart, matchClient,
} from "../src/lib/xero";

const connected = (groups = [...DEFAULT_OPTIONS.groups, "ledger"]) => {
  let sealed: string | undefined = "demo:" + btoa(JSON.stringify(scopesFor({ groups, classic: false })));
  return new FakeXero({ read: () => sealed, write: (s) => void (sealed = s) });
};
const ALL: Set<ImportPart> = new Set(["tb", "ledger", "lists", "bank", "vat", "payroll"]);
const T = { tenantId: "d300d300-0000-4000-8000-000000000083", tenantName: "The Kent Stove Company Ltd (demo figures)" };

test("dates and years", () => {
  assert.equal(yearStart("2026-04-30"), "2025-05-01");
  assert.equal(yearStart("2026-12-31"), "2026-01-01");
  assert.equal(yearStart("2024-02-29"), "2023-03-01");
  assert.equal(xDate("/Date(1556035526223+0000)/"), "2019-04-23");
  assert.equal(xDate("2026-04-30T00:00:00"), "2026-04-30");
  assert.deepEqual(vatPeriods("2025-05-01", "2026-04-30", [3, 6, 9, 12]).map((p) => p.label), ["May 25 to Jun 25", "Jul 25 to Sep 25", "Oct 25 to Dec 25", "Jan 26 to Mar 26", "Apr 26"]);
});

test("scopes: granular by default, the older broad ones for older apps", () => {
  const s = scopesFor(DEFAULT_OPTIONS);
  assert.ok(s.includes("accounting.reports.trialbalance.read") && !s.includes("accountdata.transactions.read") && s.includes("payroll.payslip.read"));
  assert.ok(!s.includes("accounting.journals.read") && !s.includes("accounting.reports.aged.read") && !s.includes("payroll.employees.read"));
  assert.ok(scopesFor({ ...DEFAULT_OPTIONS, groups: [...DEFAULT_OPTIONS.groups, "ledger"] }).includes("accountdata.transactions.read"));
  const old = scopesFor({ ...DEFAULT_OPTIONS, classic: true });
  assert.ok(old.includes("accounting.reports.read") && old.includes("accounting.transactions.read") && !old.includes("accounting.invoices.read"));
});

test("the trial balance report reads codes, names, types and the YTD balance", () => {
  const report = { Reports: [{ Rows: [
    { RowType: "Header", Cells: [{ Value: "Account" }, { Value: "Debit" }, { Value: "Credit" }, { Value: "YTD Debit" }, { Value: "YTD Credit" }] },
    { RowType: "Section", Title: "Revenue", Rows: [
      { RowType: "Row", Cells: [{ Value: "Sales (200)", Attributes: [{ Id: "account", Value: "acc-1" }] }, { Value: "" }, { Value: "100.00" }, { Value: "" }, { Value: "1,250.50" }] },
      { RowType: "Row", Cells: [{ Value: "Business Bank Account" }, { Value: "5.00" }, { Value: "" }, { Value: "1,250.50" }, { Value: "" }] },
      { RowType: "SummaryRow", Cells: [{ Value: "Total" }, { Value: "" }, { Value: "" }, { Value: "1,250.50" }, { Value: "1,250.50" }] },
    ] },
  ] }] };
  const lines = parseTrialBalance(report, [{ id: "acc-1", code: "200", name: "Sales", type: "REVENUE", cls: "REVENUE", sys: "", key: "200|sales" }]);
  assert.deepEqual(lines, [
    { Code: "200", Detail: "Sales", f: { dr: undefined, cr: 1250.5, type: "Revenue", xid: "acc-1" } },
    { Code: "", Detail: "Business Bank Account", f: { dr: 1250.5, cr: undefined, type: "Revenue", xid: undefined } },
  ]);
});

test("a full import from the Account Data API agrees to the trial balance, account by account", async () => {
  const x = await readFromXero(connected(), T, "2026-04-30", ALL, { quarterEnds: [3, 6, 9, 12] });
  assert.deepEqual(x.problems, []);
  assert.equal(x.book.source, "accountdata");
  // the trial balance balances
  const dr = r2(x.tb.reduce((a, l) => a + (l.f.dr || 0), 0)), cr = r2(x.tb.reduce((a, l) => a + (l.f.cr || 0), 0));
  assert.equal(dr, cr);
  assert.ok(x.tb.length > 20 && x.priorTb.length > 20);
  // every account's transactions reach its trial balance figure
  const off = [...ledgerCheck(x.book).entries()].filter(([, c]) => Math.abs(c.diff) > 0.005);
  assert.deepEqual(off.map(([k]) => k), []);
  // listings agree to the control accounts
  const sum = (l: { balance: number }[]) => r2(l.reduce((a, b) => a + b.balance, 0));
  assert.equal(sum(x.debtors), x.book.closing[acctKey("610", "Accounts Receivable")]);
  assert.equal(sum(x.creditors), -x.book.closing[acctKey("800", "Accounts Payable")]);
  assert.ok(x.debtors.length >= 2);
  // the bank summary closes on the trial balance
  const bank = x.book.bank.find((b) => b.account === "Business Bank Account")!;
  assert.equal(r2(bank.closing), x.book.closing[acctKey("090", "Business Bank Account")]);
  assert.equal(r2(bank.opening + bank.received - bank.spent), r2(bank.closing));
  assert.ok(x.book.unreconciled.length >= 1);
  // VAT: owed at the year end = the VAT account's balance
  assert.equal(x.vat.length, 5);
  const owed = r2(x.vat.reduce((a, q) => a + q.out - q.inp - q.paid, 0) - x.book.opening[acctKey("820", "VAT")]);
  assert.equal(owed, -x.book.closing[acctKey("820", "VAT")]);
  assert.ok(x.vat.every((q) => q.other === 0));
  // payroll: twelve months
  assert.equal(x.payroll.length, 12);
  assert.equal(x.payroll[0].label, "May 2025");
  assert.equal(x.payroll[0].gross, 4850);
});

test("without the Account Data API the ledger is rebuilt from documents, and says where it falls short", async () => {
  const x = await readFromXero(connected(DEFAULT_OPTIONS.groups.filter((g) => g !== "ledger")), T, "2026-04-30", ALL, { quarterEnds: [3, 6, 9, 12] });
  assert.equal(x.book.source, "rebuilt");
  assert.deepEqual(x.problems, []);
  const off = new Set([...ledgerCheck(x.book).entries()].filter(([, c]) => Math.abs(c.diff) > 0.005).map(([k]) => k));
  // sales, purchases, overheads, VAT and the control accounts are complete
  for (const k of [acctKey("200", "Sales"), acctKey("310", "Cost of Goods Sold"), acctKey("445", "Light, Power, Heating"), acctKey("610", "Accounts Receivable"), acctKey("800", "Accounts Payable"), acctKey("820", "VAT"), acctKey("810", "Accruals")]) assert.ok(!off.has(k), k);
  // payroll isn't a document, so wages and the bank (which pays them) fall short
  assert.ok(off.has(acctKey("477", "Salaries")));
  assert.ok(x.book.notes.some((n) => /payroll postings/.test(n)));
  // the listings come from invoices instead, and still agree
  const sum = (l: { balance: number }[]) => r2(l.reduce((a, b) => a + b.balance, 0));
  assert.equal(sum(x.debtors), x.book.closing[acctKey("610", "Accounts Receivable")]);
});

test("a part Xero won't give is reported, not fatal", async () => {
  const x = await readFromXero(connected(["core", "reports"]), T, "2026-04-30", new Set<ImportPart>(["tb", "payroll"]), { quarterEnds: [3, 6, 9, 12] });
  assert.ok(x.tb.length > 0);
  assert.equal(x.payroll.length, 0);
  assert.ok(x.problems.some((p) => /Payroll/.test(p)));
});

test("contact balances, VAT and payroll from their own lines", () => {
  const lines = [
    { d: "2026-01-02", a: "610|ar", amt: 120, c: "A" }, { d: "2026-01-20", a: "610|ar", amt: -120, c: "A" }, { d: "2026-02-02", a: "610|ar", amt: 60, c: "B" },
  ];
  assert.deepEqual(contactBalances(lines, "610|ar"), [{ contact: "B", balance: 60 }]);
  const v = vatByQuarter([
    { d: "2026-01-05", a: "v", amt: -20, t: "ACCREC", x: "VAT" }, { d: "2026-01-06", a: "v", amt: 8, t: "ACCPAY", x: "VAT" },
    { d: "2026-02-07", a: "v", amt: 30, t: "SPEND", rate: "No VAT" }, { d: "2026-03-31", a: "v", amt: 1, t: "MANJOURNAL" },
  ], "v", "2026-01-01", "2026-03-31", [3, 6, 9, 12]);
  assert.deepEqual(v.map((q) => [q.out, q.inp, q.paid, q.other]), [[20, 8, 30, 1]]);
  const p = payrollByMonth([{ paymentDate: "2026-01-25", slips: [{ grossEarnings: 2000, totalPay: 1600, employeeTaxLines: [{ description: "PAYE", amount: 200 }, { description: "Student Loan", amount: 50 }, { description: "National Insurance", amount: 100 }], employerTaxLines: [{ amount: 150 }], deductionLines: [{ amount: 50 }], benefitLines: [{ displayName: "Pension", amount: 30 }] }] }]);
  assert.deepEqual(p.map((m) => [m.label, m.gross, m.paye, m.studentLoan, m.eeni, m.erni, m.eepen, m.erpen, m.net]), [["Jan 2026", 2000, 200, 50, 100, 150, 50, 30, 1600]]);
});

test("a Xero organisation finds its client by name", () => {
  const clients = [{ Key: "C1", Title: "Kent Stove Company Limited" }, { Key: "C2", Title: "Rye Builders Ltd" }];
  assert.equal(matchClient("The Kent Stove Company Ltd (demo figures)", clients)?.Key, "C1");
  assert.equal(matchClient("RYE BUILDERS LIMITED", clients)?.Key, "C2");
  assert.equal(matchClient("Someone Else Ltd", clients), undefined);
});
