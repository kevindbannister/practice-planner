import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_RECEIPT_TEMPLATE, fillReceiptTemplate, readReceiptTemplate } from "../src/lib/receiptRequest.ts";

test("the template's gaps are filled in for the client", () => {
  const e = fillReceiptTemplate(DEFAULT_RECEIPT_TEMPLATE, { greeting: "Hi Sam,", client: "Acme Ltd", file: "October bank.xlsx", today: "2026-11-18", sender: "Kevin Smith" });
  assert.equal(e.subject, "Receipts and invoices needed");
  assert.equal(e.replyBy, "2026-12-02");
  assert.match(e.body, /^Hi Sam,/);
  assert.match(e.body, /\(October bank\.xlsx\)/);
  assert.match(e.body, /by 2 December 2026\?/);
  assert.match(e.body, /Kevin$/);
});

test("the practice's own template, with unknown gaps left showing and a missing file named plainly", () => {
  const t = readReceiptTemplate({ subject: "Receipts for {{client}}", body: "{{greeting}} please see {{file}}. {{nonsense}}", replyDays: 7 });
  const e = fillReceiptTemplate(t, { greeting: "Dear Sir or Madam,", client: "Brown & Co", file: "", today: "2026-12-28", sender: "" });
  assert.equal(e.subject, "Receipts for Brown & Co");
  assert.equal(e.body, "Dear Sir or Madam, please see the attached spreadsheet. {{nonsense}}");
  assert.equal(e.replyBy, "2027-01-04");
});

test("a saved template is checked: blanks and silly reply times fall back to the default", () => {
  assert.deepEqual(readReceiptTemplate(undefined), DEFAULT_RECEIPT_TEMPLATE);
  const t = readReceiptTemplate({ subject: "  ", body: "", replyDays: 500 });
  assert.deepEqual(t, DEFAULT_RECEIPT_TEMPLATE);
  assert.equal(readReceiptTemplate({ replyDays: "10" }).replyDays, 10);
});
