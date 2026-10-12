// Letters and emails: addressing and what the AI is told.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_COMMS, addressLines, aiContext, letterFileName, longDate, readCommsPrefs, salutationFor, signOffFor } from "../src/lib/comms";

const company: any = { Key: "C1", Title: "Acme Ltd", Kind: "Ltd", CompanyNumber: "01234567", ContactTitle: "Mr", ContactFirst: "Thomas", ContactPreferred: "Tom", ContactLast: "Smith",
  TradingAddress: "Unit 2, Mill Lane, Leeds, LS1 1AA", UTR: "1234567890", NINumber: "AB123456C", DateOfBirth: "1980-01-01" };
const person: any = { Key: "C2", Title: "Jane Doe", Kind: "Individual", ContactFirst: "Jane", ContactLast: "Doe", HomeAddress: "1 High St,, York, YO1 1AA" };

test("addresses and how to start and end", () => {
  assert.deepEqual(addressLines(company), ["Mr T Smith", "Acme Ltd", "Unit 2", "Mill Lane", "Leeds", "LS1 1AA"]);
  assert.deepEqual(addressLines(person), ["Jane Doe", "1 High St", "York", "YO1 1AA"]);
  assert.equal(salutationFor(company), "Dear Tom,");
  assert.equal(salutationFor({ Title: "X Ltd", Kind: "Ltd" } as any), "Dear Sir or Madam,");
  assert.equal(signOffFor("Dear Sir or Madam,", DEFAULT_COMMS), "Yours faithfully,");
  assert.equal(signOffFor("Dear Tom,", { ...DEFAULT_COMMS, signOff: "Kind regards," }), "Kind regards,");
  assert.equal(longDate("2026-10-12"), "12 October 2026");
  assert.equal(letterFileName("2026-10-12", 'Accounts: "final" / v2?'), "2026-10-12 Accounts final v2.docx");
});

test("the AI gets names and open work, not tax references or dates of birth", () => {
  const job: any = { Key: "J1", Title: "Limited company accounts", ServiceKey: "ACCS_LTD", PeriodEnd: "2026-03-31", Deadline: "2026-12-31", StageNo: 9 };
  const ctx = aiContext({ client: company, jobs: [job], job, stageName: () => "Final amendments", serviceName: () => "Limited company accounts",
    prefs: { ...DEFAULT_COMMS, signName: "Kevin" }, today: "2026-10-12", kind: "letter", salutation: "Dear Tom," });
  const text = JSON.stringify(ctx);
  assert.match(text, /Acme Ltd/);
  assert.match(text, /Final amendments/);
  assert.equal((ctx.about as any).deadline, "2026-12-31");
  assert.equal(ctx.sender, "Kevin");
  for (const secret of ["1234567890", "AB123456C", "1980-01-01"]) assert.ok(!text.includes(secret), secret);
});

test("settings read with defaults", () => {
  assert.equal(readCommsPrefs([]).signOff, "Yours sincerely,");
  assert.equal(readCommsPrefs([{ Key: "comms", Value: JSON.stringify({ signName: "Kevin" }) }]).signName, "Kevin");
});
