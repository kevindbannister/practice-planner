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

test("interest lines keep their account number, and a capital gain is read with its costs and relief", () => {
  const detail = { name: "Detailed summaries.pdf", pages: [[
    "Mr Sam Example UTR: 1234567890", "Detailed summaries for year ended 5 April 2025",
    "Untaxed UK Interest etc", "Account Number", "Gross interest",
    "Example Bank 12345678 1,200.00", "Sample Savings plc 300.50", "Total 1,500.50",
    "Capital Gains Tax computation for year ended 5 April 2025", "Property",
    "Disposal proceeds (12/03/2025) 100,000", "Cost 60,000", "Legal Fees 500", "Private Residence Relief 10,000",
    "(70,500)", "Chargeable gain liable to rates for residential property and carried interest 29,500",
    "Summary of disposals Loss Gain", "Residential property and carried interest", "Property 29,500",
  ]] };
  const res = readImport([detail]);
  assert.deepEqual(res.ret.interest.map((i) => [i.payer, i.accountNumber, i.untaxed]), [["Example Bank", "12345678", 1200], ["Sample Savings plc", undefined, 300.5]]);
  assert.equal(res.ret.gains.length, 1);
  const g = res.ret.gains[0];
  assert.equal(g.kind, "residential");
  assert.equal(g.date, "2025-03-12");
  assert.equal(g.proceeds, 100000);
  assert.equal(g.cost, 70500);
  assert.equal(g.proceeds - g.cost, 29500);
});

test("expense lines go to their SA103 boxes", () => {
  const detail = { name: "Detailed summaries.pdf", pages: [[
    "Mr Sam Example UTR: 1234567890", "Detailed summaries for year ended 5 April 2025",
    "Self employment: Sample Trader - year ended 05/04/2025", "Turnover 10,000.00", "Less: expenses",
    "Cost of goods 1,000.00", "Car, van and travel expenses 500.00", "Office stationery 200.00", "Accountancy fees 300.00",
    "Bank charges 50.00", "Something else 150.00", "Net profit 7,800.00",
  ]] };
  const trade = readImport([detail]).ret.selfEmployments[0];
  assert.deepEqual(trade.expenseItems?.map((x) => [x.label, x.box]), [
    ["Cost of goods", "11"], ["Car, van and travel expenses", "12"], ["Office stationery", "18"],
    ["Accountancy fees", "16"], ["Bank charges", "17"], ["Something else", "19"],
  ]);
  assert.equal(trade.expenses, 2200);
});

test("a pension line gives its name, gross, tax and net", () => {
  const detail = { name: "Detailed summaries.pdf", pages: [[
    "Mr Sam Example UTR: 1234567890", "Detailed summaries for year ended 5 April 2025",
    "Pensions (other than state pension)", "Example Teachers Pension Scheme 12,000.00 2,400.00 9,600.00", "Total 12,000.00",
  ]] };
  const p = readImport([detail]).ret.pensions!.others;
  assert.deepEqual(p.map((x) => [x.payer, x.amount, x.tax, x.net]), [["Example Teachers Pension Scheme", 12000, 2400, 9600]]);
});

test("a named pension with gross, tax and net rows under its heading", () => {
  const detail = { name: "Detailed summaries.pdf", pages: [[
    "Mr Sam Example UTR: 1234567890", "Detailed summaries for year ended 5 April 2025",
    "Pension: Example Personal Pension", "Gross 5,000.00", "Tax 1,000.00", "Net 4,000.00", "Total 5,000.00",
  ]] };
  const p = readImport([detail]).ret.pensions!.others;
  assert.deepEqual(p.map((x) => [x.payer, x.amount, x.tax, x.net]), [["Example Personal Pension", 5000, 1000, 4000]]);
});

test("import check: IRIS's total tax is compared with the tax still due after tax deducted at source", async () => {
  const { compute, emptyReturn, newId } = await import("../src/lib/tax");
  const ret = emptyReturn();
  ret.employments.push({ id: newId(), name: "Employer", pay: 50000, tax: 6000 } as any);
  const c = compute(ret, 2025);
  const due = Math.round((c.totalLiability - c.deducted) * 100) / 100;
  assert.ok(c.deducted > 0 && due < c.totalLiability);
  const chk = checkImport({ ret, year: 2025, theirs: { totalTax: due }, warnings: [] } as any);
  assert.equal(chk.ours, due); assert.equal(chk.matches, true);
  assert.equal(checkImport({ ret, year: 2025, theirs: { totalTax: c.totalLiability } } as any).matches, false);
});

test("import: CIS deducted by contractors is tax already paid, not an expense", async () => {
  const { readImport } = await import("../src/lib/taxImport");
  const txt = [
    "Detailed summaries", "UTR: 1234567890", "Tax year 6 April 2024 to 5 April 2025",
    "Self-employment - Building Co 01/04/2024 to 05/04/2025",
    "Turnover 20,000.00", "Construction industry - payments to subcontractors 2,000.00", "Business travel 500.00",
    "Net profit 17,500.00", "CIS deductions 1,200.00",
  ];
  const res = readImport([{ name: "s.pdf", pages: [txt.map((x) => x)] } as any], []);
  const s = res.ret.selfEmployments[0];
  assert.equal(s.cis, 1200);
  assert.equal(s.expenseItems!.length, 2);
  assert.equal(s.expenses, 2500);
});
