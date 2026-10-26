import test from "node:test";
import assert from "node:assert/strict";
import { CIS_HELPLINE, EMPLOYER_HELPLINE, EMPTY_FIRM, agentNeeds, cisStatus, isIsoDate, needs, summary } from "../src/lib/cis.ts";

const ltd: any = { Key: "C1", Title: "Acme Building Ltd", Kind: "Ltd", CompanyNumber: "01234567", CTUTR: "1234567890", RegisteredOffice: "1 High St\nLeeds\nLS1 4AB", Email: "a@acme.test" };
const sole: any = { Key: "S1", Title: "Bob Builder", TradingName: "Bob's Bricks", Kind: "Individual", UTR: "9876543210", NINumber: "JS022198C", HomeAddress: "2 Low Rd, Ripon", PAYERef: "123/AB456", AccountsOfficeRef: "123PA00012345", Mobile: "07700 900123" };
const get = (list: ReturnType<typeof needs>, label: string) => list.find((n) => n.label === label)!;

test("the helpline numbers are the ones shown", () => {
  assert.equal(EMPLOYER_HELPLINE, "0300 200 3200");
  assert.equal(CIS_HELPLINE, "0300 200 3210");
});

test("a company is asked for its CT UTR, company number and registered office", () => {
  const n = needs(ltd);
  assert.equal(get(n, "Legal name").value, "Acme Building Ltd");
  assert.equal(get(n, "Registered office").value, "1 High St, Leeds, LS1 4AB");
  assert.equal(get(n, "Corporation tax UTR").value, "1234567890");
  assert.equal(get(n, "Company number").value, "01234567");
  assert.ok(!n.some((x) => x.label === "National Insurance number"));
});

test("missing items are empty so they can be flagged, and PAYE explains itself", () => {
  const n = needs(ltd);
  assert.equal(get(n, "Employer PAYE reference").value, "");
  assert.match(get(n, "Employer PAYE reference").note!, /sets up a PAYE scheme/);
  assert.equal(get(n, "Contact telephone").value, "");
  assert.equal(get(n, "Contact email").value, "a@acme.test");
});

test("a sole trader is asked for their own UTR and NI number, and shows the trading name", () => {
  const n = needs(sole);
  assert.equal(get(n, "Self Assessment UTR").value, "9876543210");
  assert.equal(get(n, "National Insurance number").value, "JS022198C");
  assert.equal(get(n, "Business address").value, "2 Low Rd, Ripon");
  assert.equal(get(n, "Legal name").note, "Trading as Bob's Bricks");
  assert.equal(get(n, "Employer PAYE reference").value, "123/AB456");
  assert.equal(get(n, "Employer PAYE reference").note, undefined);
  assert.equal(get(n, "Accounts Office reference").value, "123PA00012345");
});

test("agent details come from the firm's settings, with gaps flagged", () => {
  assert.ok(agentNeeds(EMPTY_FIRM).every((n) => !n.value));
  const a = agentNeeds({ ...EMPTY_FIRM, firmName: "Bannister & Co", agentRef: "ARN1234", address: "9 Mill Lane\nRipon", authorisation: "64-8 on file" });
  assert.equal(a.find((n) => n.label === "Agent firm")!.value, "Bannister & Co");
  assert.equal(a.find((n) => n.label === "Firm address")!.value, "9 Mill Lane, Ripon");
  assert.equal(a.find((n) => n.label === "Authorisation to act")!.value, "64-8 on file");
});

test("the copy-all text lists everything, marks gaps and the first payment date", () => {
  const t = summary(ltd, { ...EMPTY_FIRM, firmName: "Bannister & Co" }, "2026-12-01", (d) => `date ${d}`);
  assert.match(t, /Legal name: Acme Building Ltd/);
  assert.match(t, /Employer PAYE reference: \(missing\)/);
  assert.match(t, /First payment to a subcontractor expected: date 2026-12-01/);
  assert.match(t, /Agent firm: Bannister & Co/);
  assert.ok(!/Firm telephone/.test(t));
  assert.match(summary(ltd, EMPTY_FIRM, "", String), /expected: \(not set\)/);
});

test("registration status and dates are read safely", () => {
  assert.equal(cisStatus({ CISStatus: "registered" } as any), "registered");
  assert.equal(cisStatus({ CISStatus: "not-contractor" } as any), "not-contractor");
  assert.equal(cisStatus({ CISStatus: "whatever" } as any), "");
  assert.equal(cisStatus({} as any), "");
  assert.equal(isIsoDate("2026-12-01"), true);
  for (const bad of ["", "01/12/2026", "2026-13-40", "x", undefined]) assert.equal(isIsoDate(bad), false);
});
