import test from "node:test";
import assert from "node:assert/strict";
import { checkImport, readImport, yearIn } from "../src/lib/taxImport";

// The text pdf.js reads from IRIS Elements' prints (names and figures made up, layout as IRIS prints them).
const summaries = { name: "Schedules.pdf", pages: [[
  "Mr Sam Example UTR: 1234567890", "Detailed summaries for year ended 5 April 2021", "UK Dividends etc", "Shares Date Dividend", "held paid",
  "EXAMPLE ROOFING & BUILDING LTD 4 £40,520.00", "£40,520.00 Total", "Employment income: EXAMPLE ROOFING & BUI", "PAYE reference: 577/X1234",
  "Gross pay £9,480.00", "£9,480.00 Net taxable income", "03/11/2026 14:04:42",
]] };
const calculation = { name: "Tax calculation.pdf", pages: [[
  "Mr Sam Example UTR: 1234567890", "Tax calculation for 2020-21 (year ended 5 April 2021)", "Income received (before tax taken off)",
  "Pay from all employments £9,480", "Dividends from UK companies £40,520", "£50,000 Total income received", "minus Personal Allowance £12,500",
  "£37,500 Total income on which tax is due", "How I have worked out your Income Tax", "Dividends from companies etc.",
  "Basic rate band at nil rate £2,000x 0% = £0.00", "Basic rate £35,500x 7.5% = £2,662.50", "Total income on which tax has been charged £37,500",
  "£2,662.50 Income Tax due after allowances and reliefs", "Payments due", "Total tax due £2,662.50", "1st payment on account made (£1,501.55)",
  "2nd payment on account made (£1,160.95)", "Total adjustments to tax due (£2,662.50)", "Balancing payment due 31st January 2022 £0.00",
  "Payment on account due 31st January 2022 £1,331.25", "Payment on account due 31st July 2022 £1,331.25", "SA302 (Substitute) 03/11/2026 14:05:03",
]] };

test("tax year from IRIS's headings", () => {
  assert.equal(yearIn(["Tax calculation for 2020-21 (year ended 5 April 2021)"]), 2021);
  assert.equal(yearIn(["Tax year 6 April 2024 to 5 April 2025 (2024–25)"]), 2025);
});

test("summaries and calculation together", () => {
  const res = readImport([summaries, calculation]);
  assert.equal(res.year, 2021); assert.equal(res.utr, "1234567890"); assert.equal(res.name, "Mr Sam Example");
  assert.deepEqual(res.kinds, ["summaries", "calculation"]);
  const r = res.ret;
  assert.equal(r.employments.length, 1);
  assert.equal(r.employments[0].name, "EXAMPLE ROOFING & BUILDING LTD", "the cut-short name completed from the dividend company");
  assert.equal(r.employments[0].paye, "577/X1234"); assert.equal(r.employments[0].pay, 9480);
  assert.equal(r.dividends.length, 1, "the calculation's dividend total doesn't double up"); assert.equal(r.dividends[0].amount, 40520);
  assert.equal(r.payments.poa1, 1501.55); assert.equal(r.payments.poa2, 1160.95); assert.equal(r.payments.paidDifferent, true);
  assert.equal(r.front.utr, "1234567890");
  assert.deepEqual(res.theirs, { totalTax: 2662.5, incomeTax: 2662.5, balancing: 0, poaNext: 1331.25 });
  const chk = checkImport(res);
  assert.equal(chk.matches, true); assert.equal(chk.poaOurs, 1331.25);
  assert.deepEqual(res.warnings, []);
});

test("the calculation alone gives totals as single lines", () => {
  const res = readImport([calculation]);
  assert.equal(res.ret.employments[0].pay, 9480); assert.match(res.ret.employments[0].name, /from the calculation/);
  assert.equal(res.ret.dividends[0].amount, 40520);
  assert.equal(checkImport(res).matches, true);
});

test("names cut short are completed from known companies", () => {
  const res = readImport([summaries], ["Other Ltd", "Example Roofing & Building Ltd"]);
  assert.equal(res.ret.employments[0].name, "Example Roofing & Building Ltd");
});

test("other files are reported, not guessed at", () => {
  const res = readImport([{ name: "bank.pdf", pages: [["Statement", "Balance £100.00"]] }]);
  assert.equal(res.warnings.length, 3);
});

test("the summaries give each bank account's interest, foreign interest and self-employment breakdown", () => {
  const detail = { name: "Detailed summaries.pdf", pages: [[
    "Mr Sam Example UTR: 1234567890", "Detailed summaries for year ended 5 April 2025",
    "Untaxed UK Interest etc", "Example Bank Ltd £1,200.00", "Sample Savings plc £300.50", "£1,500.50 Total",
    "Foreign savings interest", "Example Country", "Overseas Bank £400.00 £40.00",
    "Self-employment Sole trader - year ended 5 April 2025", "Turnover £50,000.00", "Cost of goods £10,000.00",
    "Business travel £1,000.00", "Business insurance £500.00", "Total expenses £11,500.00", "Transitional profit carried forward £0.00",
    "Net profit £38,500.00", "Reconciliation", "Taxable profit £38,500.00",
  ]] };
  const res = readImport([detail]);
  assert.deepEqual(res.ret.interest.map((i) => [i.payer, i.untaxed]), [["Example Bank Ltd", 1200], ["Sample Savings plc", 300.5], ["Overseas Bank (Example Country)", 400]]);
  const trade = res.ret.selfEmployments[0];
  assert.equal(trade.name, "Sole trader");
  assert.equal(trade.turnover, 50000);
  assert.equal(trade.expenses, 11500);
  assert.deepEqual(trade.expenseItems?.map((x) => [x.label, x.amount]), [["Cost of goods", 10000], ["Business travel", 1000], ["Business insurance", 500]]);
});
