import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultInput, disengageLetter, problems } from "../src/lib/disengage.ts";

const co = { Title: "Anna Ltd", Kind: "Ltd", CompanyNumber: "123" } as never;
const person = { Title: "Bob Smith", Kind: "Individual" } as never;

test("it needs an end date, and an amount when the reason is unpaid fees", () => {
  assert.equal(problems(defaultInput(co)).length, 1);
  assert.equal(problems({ ...defaultInput(co), endDate: "30 November 2026" }).length, 0);
  assert.equal(problems({ ...defaultInput(co), endDate: "x", reason: "fees" }).length, 1);
  assert.equal(problems({ ...defaultInput(co), endDate: "x", reason: "fees", owing: 450 }).length, 0);
});

test("the letter says why, from when, and lists what stays with the client", () => {
  const l = disengageLetter({ ...defaultInput(co), endDate: "30 November 2026", reason: "fees", owing: 1250.5, deadlines: [{ title: "VAT return", date: "7 December 2026" }] });
  assert.ok(l.body.includes("with effect from 30 November 2026"));
  assert.ok(l.body.includes("£1,250.50"));
  assert.ok(l.body.includes("- VAT return, due 7 December 2026"));
  assert.ok(l.subject.includes("Anna Ltd"));
});

test("Companies House is only mentioned for companies, and unchecked sections are left out", () => {
  const a = disengageLetter({ ...defaultInput(co), endDate: "d" }).body;
  const b = disengageLetter({ ...defaultInput(person), endDate: "d" }).body;
  assert.ok(a.includes("Companies House"));
  assert.ok(!b.includes("Companies House"));
  const none = disengageLetter({ ...defaultInput(co), endDate: "d", returnRecords: false, authorities: false, newAccountant: false }).body;
  assert.ok(!none.includes("HMRC") && !none.includes("return your original records") && !none.includes("another accountant"));
});

test("services named narrow the scope of the letter", () => {
  const l = disengageLetter({ ...defaultInput(co), endDate: "d", services: ["payroll"] });
  assert.ok(l.body.includes("in relation to payroll"));
});
