import assert from "node:assert/strict";
import { test } from "node:test";
import { DEST_BY_KEY, EXPENSE_RULES, guessDest } from "../src/lib/tbMap";

// BCK Interiors Ltd's own trial balance accounts at 30 September 2025 and 2026 (Xero names, type Overhead / Direct Costs)
const BCK: [string, number, string][] = [
  ["Cost of sales", 1, "expenditure/cos"], ["Purchases", 1, "expenditure/cos"], ["Subcontractor Costs", 1, "expenditure/cos"],
  ["Rent", 1, "expenditure/premises"], ["Business Rates", 1, "expenditure/premises"], ["Waste & Cleaning", 1, "expenditure/premises"], ["Utilities", 1, "expenditure/premises"],
  ["Miscellaneous Premises Costs", 1, "expenditure/premises"], ["Premises Improvements", 1, "expenditure/premises"],
  ["Staff Salaries", 1, "expenditure/employee"], ["Employers National Insurance", 1, "expenditure/employee"], ["Pensions Costs", 1, "expenditure/employee"],
  ["HR, Training & Staff Entertainment", 1, "expenditure/employee"], ["Employment Costs: Directors' remuneration", 1, "expenditure/directors"],
  ["Marketing Management", 1, "expenditure/advertising"], ["Social Advertising", 1, "expenditure/advertising"], ["Search Engine Advertising", 1, "expenditure/advertising"],
  ["Print Advertising", 1, "expenditure/advertising"], ["Miscellaneous Advertising", 1, "expenditure/advertising"], ["Events & Entertainment", 1, "expenditure/entertainment"],
  ["Travel & Subsistence - National", 1, "expenditure/travel"], ["Travel & Subsistence - International", 1, "expenditure/travel"], ["Travel Costs", 1, "expenditure/travel"],
  ["Vehicle & Maintenance", 1, "expenditure/motor"], ["Audit & Accountancy fees", 1, "expenditure/accountancy"], ["Legal Expenses", 1, "expenditure/legal"],
  ["Telephone, Mobiles & Internet", 1, "expenditure/office"], ["Office Supplies, Postage & Stationary", 1, "expenditure/office"], ["Insurance", 1, "expenditure/insurance"],
  ["IT System Costs: Subscriptions", 1, "expenditure/it"], ["Administration Costs: IT System Costs", 1, "expenditure/it"], ["General Expenses", 1, "expenditure/tb"],
  ["Administration Costs: Bank Charges", 1, "expenditure/bank"], ["Bank Charges: Merchant Rental", 1, "expenditure/bank"], ["Bank Charges: Credit card charges", 1, "expenditure/bank"],
  ["Courier and delivery charges", 1, "expenditure/distribution"], ["Depreciation", 1, "expenditure/depreciation"], ["UK Corporation Tax", 1, "taxation/current"],
  ["Computer equipment P&L", -1, "expenditure/tb"], ["Sundry income", -1, "income/other"], ["Bank interest - received", -1, "income/interest"],
];

test("BCK Interiors' costs each go to their own heading, not general expenses", () => {
  for (const [name, sign, want] of BCK) {
    const type = want.startsWith("income") ? "Other Income" : want === "expenditure/cos" ? "Direct Costs" : "Overhead";
    assert.equal(guessDest(name, type, sign * 100), want, name);
  }
});

test("credit card balances are still creditors, but credit card charges are a cost", () => {
  assert.equal(guessDest("Credit card", "Current Liability", -500), "creditors/card");
  assert.equal(guessDest("Credit card charges", "Overhead", 50), "expenditure/bank");
  assert.equal(guessDest("Corporation tax payable", "Current Liability", -26989), "creditors/tax");
});

test("every rule points at a real heading", () => {
  for (const r of EXPENSE_RULES) assert.ok(DEST_BY_KEY.has(r.dest), r.dest);
});

import { irisFallback } from "../src/lib/tbMap";
test("an account with no IRIS code gets one from its name and place, only from the IRIS chart", () => {
  assert.equal(irisFallback("Telephone & Internet", "expenditure/tb"), "263");
  assert.equal(irisFallback("Motor Vehicle Expenses", "expenditure/tb"), "267");
  assert.equal(irisFallback("Bank Fees", "expenditure/tb"), "378");
  assert.equal(irisFallback("Accountancy", "expenditure/tb"), "285");
  assert.equal(irisFallback("Trade Debtors", "debtors/trade"), "586");
  assert.equal(irisFallback("Something odd", "expenditure/tb"), "280");
});
