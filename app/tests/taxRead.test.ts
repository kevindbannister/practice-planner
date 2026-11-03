import { test } from "node:test";
import assert from "node:assert/strict";
import { printedNumbers, readWithAi, sanitiseRead } from "../src/lib/taxRead";
import { ImportFile } from "../src/lib/taxImport";

const file = (lines: string[]): ImportFile => ({ name: "Detailed summaries.pdf", pages: [[
  "Mr Sam Example UTR: 1234567890", "Detailed summaries for year ended 5 April 2025", ...lines,
]] });

test("printed numbers are the figures in the text, pounds and pence, brackets and commas taken out", () => {
  const n = printedNumbers([file(["Gross pay £12,480.00", "Tax (1,234.5)", "Dividends 44,081"])]);
  assert.ok(n.has(12480), "12,480.00");
  assert.ok(n.has(1234.5), "(1,234.5)");
  assert.ok(n.has(44081), "44,081");
  assert.ok(!n.has(999), "a figure that isn't printed");
});

test("a figure the AI gives that isn't printed is left out and reported", () => {
  const printed = printedNumbers([file(["Gross pay 12,480.00"])]);
  const { ret, dropped } = sanitiseRead({
    employments: [{ name: "Acme", pay: 12480, tax: 999 }],
    interest: [{ payer: "Bank", untaxed: 1234 }],
  }, printed);
  assert.equal(ret.employments[0].pay, 12480);
  assert.equal(ret.employments[0].tax, 0);
  assert.equal(ret.interest[0].untaxed, 0);
  assert.deepEqual(dropped, ["employments[1].tax", "interest[1].untaxed"]);
});

test("texts must fit their field: a region, a date or a plan that isn't allowed is left out", () => {
  const { ret } = sanitiseRead({
    front: { region: "Scotland-ish", dob: "20/05/1960", utr: "1234567890" },
    studentLoan: { plans: ["plan2", "plan9"], postgrad: true },
    gains: [{ description: "Flat", kind: "land", date: "2025-03-12", proceeds: 0, cost: 0 }],
  }, new Set());
  assert.equal(ret.front.region, "england");
  assert.equal(ret.front.dob, undefined);
  assert.equal(ret.front.utr, "1234567890");
  assert.deepEqual(ret.studentLoan.plans, ["plan2"]);
  assert.equal(ret.gains[0].kind, "other");
  assert.equal(ret.gains[0].date, "2025-03-12");
});

test("when the planner's tax agrees with the document's, the read says so", () => {
  const answer = { ret: { employments: [{ name: "Acme", paye: "948/400", pay: 12480, tax: 0 }] }, totals: { incomeTaxDue: 0 } };
  const res = readWithAi([file(["Gross pay 12,480.00"])], answer);
  assert.equal(res.year, 2025);
  assert.ok(res.found.some((f) => /Income tax agrees/.test(f)), res.found.join(" | "));
  assert.ok(!res.warnings.some((w) => /prints income tax/.test(w)), res.warnings.join(" | "));
});

test("when the document's income tax doesn't match, the read warns and says both figures", () => {
  const answer = { ret: { employments: [{ name: "Acme", pay: 12480, tax: 0 }] }, totals: { incomeTaxDue: 500 } };
  const res = readWithAi([file(["Gross pay 12,480.00"])], answer);
  assert.ok(res.warnings.some((w) => /prints income tax of £500\.00, but these figures give £0\.00/.test(w)), res.warnings.join(" | "));
});

test("without the document's income tax figure, the read says it can't be checked", () => {
  const res = readWithAi([file(["Gross pay 12,480.00"])], { ret: { employments: [{ name: "Acme", pay: 12480 }] }, totals: {} });
  assert.ok(res.warnings.some((w) => /can't be checked/.test(w)));
});
