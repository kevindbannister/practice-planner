// Mapping a trial balance to IRIS codes and the working paper schedules.
import assert from "node:assert/strict";
import { test } from "node:test";
import { linesFor } from "../src/lib/papers";
import { DEST_BY_KEY, IRIS_BUILT_IN, accountsFigures, guessDest, guessIris, irisOf, irisRangeDest, mapTb, paperAccounts, parseChart, tbTotals } from "../src/lib/tbMap";

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
    ["Loan from a lender", "Non-current Liability", -100, "creditors/loan"],
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

test("mapping learns from last year and other companies, and totals each schedule", () => {
  const all = [
    tbRow("p1", "1100", "Debtors Control", "Current Asset", 50, undefined, { dest: "debtors/other", iris: "999" }, "2025-03-31"),
    tbRow("o1", "7", "Website costs", "Overheads", 10, undefined, { dest: "expenditure/accountancy" }, "2026-03-31", "C2"),
    tbRow("a", "1100", "Debtors Control", "Current Asset", 120),
    tbRow("b", "2109", "Accruals", "Current Liability", undefined, 500),
    tbRow("c", "8000", "Website costs", "Overheads", 30),
    tbRow("d", "0050", "Motor Vehicles Cost", "Fixed Asset", 20000),
    tbRow("e", "3000", "Ordinary Shares", "Equity", undefined, 2, { dest: "capital/shares" }),
  ];
  const rows = paperAccounts(all, "C1", "2026-03-31");
  const maps = mapTb(rows, { lines: all, papers: [] }, "C1", "2026-03-31", []);
  const by = Object.fromEntries(maps.map((m) => [m.acct.code, m]));
  assert.equal(by["1100"].dest, "debtors/other"); // as last year
  assert.equal(by["1100"].iris, "999");
  assert.equal(by["8000"].dest, "expenditure/accountancy"); // as at another company
  assert.equal(by["2109"].dest, "creditors/accruals");
  assert.equal(by["3000"].saved, true);
  const totals = tbTotals(maps);
  assert.equal(totals.get("fixed/motor#cost"), 20000);
  assert.equal(totals.get("expenditure/accountancy"), 30);
  assert.equal(totals.get("creditors/accruals"), 500); // a liability shows as a positive credit
});

test("IRIS: codes go by the IRIS numbering, names are looked up on the chart", () => {
  assert.equal(irisRangeDest("523/21", "", -5), "fixed/plant#dep");
  assert.equal(irisRangeDest("525/2", "", 5), "fixed/motor#cost");
  assert.equal(irisRangeDest("1", "", -5), "income/sales");
  assert.equal(irisRangeDest("27", "", 5), "expenditure/cos");
  assert.equal(irisRangeDest("285", "", 5), "expenditure/accountancy");
  assert.equal(irisRangeDest("390/14", "", 5), "expenditure/tb");
  assert.equal(irisRangeDest("442", "", 5), "taxation/current");
  assert.equal(irisRangeDest("471/1", "", 5), "capital/dividends");
  assert.equal(irisRangeDest("715/1", "", 5), "debtors/group");
  assert.equal(irisRangeDest("727/21*1", "", 5), "creditors/dla");
  assert.equal(irisRangeDest("770", "", -5), "creditors/card");
  assert.equal(irisRangeDest("931/1", "", 5), "provisions/deferred");
  assert.equal(irisRangeDest("968/1", "", -5), "capital/reserves");
  // one IRIS name, two codes: the account's own name decides
  assert.equal(irisOf("Tax", "Corporation Tax", IRIS_BUILT_IN).code, "747");
  assert.equal(irisOf("Tax", "Corporation Tax P&L", IRIS_BUILT_IN).code, "442");
  // a longer name than the chart's shortened one
  assert.equal(irisOf("Plant & machin Depreciation b/wd", "x", IRIS_BUILT_IN).code, "523/21");
  assert.equal(irisOf("Directors' remuneration - French    Mr A", "x", IRIS_BUILT_IN).code, "254/1*1");
  assert.equal(irisOf("526/1", "x", IRIS_BUILT_IN).name, "Computer equipmt Cost/valuatio");
  // IRIS names with no code known go by the name
  assert.equal(guessDest("Bank loans - 1-2 years", "", -5), "creditors/loan#after");
  assert.equal(guessDest("HP - gross - More than 1 yr", "", -5), "creditors/hp#after");
  assert.equal(guessDest("Other investments other than loans - Unlisted investments", "", 5), "investments/main");
  assert.equal(guessDest("Accrued expenses", "", -5), "creditors/accruals");
  assert.equal(guessDest("Motor vehicles  Eliminated on disposal", "", 5), "fixed/motor#dep");
  assert.equal(guessDest("Computer equipment Charge for year", "", -5), "fixed/computer#dep");
});

test("journals reach the trial balance account, codes repeat, new accounts are added", () => {
  const L = (Key: string, sec: string, Code: string, Detail: string, f: any) => ({ Key, ClientKey: "C", PeriodEnd: "2026-04-30", SectionKey: sec, SubKey: "main", Code, Detail, Seq: 1, Figures: JSON.stringify(f) });
  const all = [
    L("t1", "tb", "525a", "Motor Vehicles", { dr: 1000, iris: "Motor vehicles Cost/valuation" }),
    L("t2", "tb", "525a", "Motor Vehicles - Addition", { dr: 500, iris: "Motor vehicles  Additions" }),
    L("t3", "tb", "1", "Sales", { cr: 1500, iris: "Sales" }),
    L("j1", "journals", "", "Motor Vehicles - Addition", { no: 1, cr: 100 }),
    L("j2", "journals", "", "Operating lease", { no: 1, dr: 100 }),
  ];
  const rows = paperAccounts(all, "C", "2026-04-30");
  assert.deepEqual(rows.map((r) => [r.account, r.dr, r.cr, r.inTb]), [
    ["Motor Vehicles", 1000, 0, true], ["Motor Vehicles - Addition", 400, 0, true], ["Sales", 0, 1500, true], ["Operating lease", 100, 0, false],
  ]);
  const maps = mapTb(rows, { lines: all, papers: [] }, "C", "2026-04-30", IRIS_BUILT_IN);
  assert.deepEqual(maps.map((m) => m.dest), ["fixed/motor#cost", "fixed/motor#cost", "income/sales", "expenditure/tb"]);
  const f = accountsFigures(maps);
  assert.equal(f.turnover, 1500);
  assert.equal(f.pbt, 1400);
  assert.equal(f.fixed, 1400);
  assert.equal(f.difference, 0);
});
