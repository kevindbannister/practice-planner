import { test } from "node:test";
import assert from "node:assert/strict";
import { isDissolved, pillFor, portfolioRows } from "../src/lib/portfolio.ts";

test("pills say how far off a date is and go red, amber or green", () => {
  const t = "2026-10-27";
  assert.deepEqual(pillFor("2026-10-17", t)?.text, "10 days overdue");
  assert.equal(pillFor("2026-10-17", t)?.tone, "red");
  assert.equal(pillFor("2026-11-16", t)?.text, "in 20 days");
  assert.equal(pillFor("2026-11-16", t)?.tone, "amber");
  assert.equal(pillFor("2026-11-07", t)?.tone, "red");
  assert.equal(pillFor("2027-01-27", t)?.text, "in 3 months");
  assert.equal(pillFor("2027-07-31", t)?.text, "in 9 months");
  assert.equal(pillFor("2027-07-31", t)?.tone, "green");
  assert.equal(pillFor("2027-11-30", t)?.text, "in a year");
  assert.equal(pillFor("", t), undefined);
});

const ch = { accDue: "2027-07-31", csDue: "2027-05-22", csTo: "2027-05-08", status: "Active", ard: "31 Oct", at: "2026-10-01T00:00:00Z" };
const clients = [
  { Key: "C1", Title: "Acme Ltd", Kind: "Ltd", CompanyNumber: "123", VATNumber: "GB1", CHVerified: JSON.stringify(ch) },
  { Key: "C2", Title: "Bee Ltd", Kind: "Ltd", CompanyNumber: "456", CHVerified: "{}" },
  { Key: "C3", Title: "Sole Trader", Kind: "Individual" },
  { Key: "C4", Title: "Gone Ltd", Kind: "Ltd", CompanyNumber: "789", CHStatus: "Dissolved" },
];
const jobs = [
  { ClientKey: "C1", ServiceKey: "CT600", Deadline: "2027-10-31", Status: "Open" },
  { ClientKey: "C1", ServiceKey: "ACCS", Deadline: "2027-01-01", Status: "Open" },
  { ClientKey: "C2", ServiceKey: "ACCS", Deadline: "2027-02-01", Status: "Open" },
  { ClientKey: "C2", ServiceKey: "VAT", Deadline: "2026-11-07", Status: "Open" },
  { ClientKey: "C2", ServiceKey: "CS01", Deadline: "2027-03-01", PeriodEnd: "2027-02-15", Status: "Complete" },
];

test("portfolio rows take accounts and confirmation dates from Companies House, the rest from the app", () => {
  const rows = portfolioRows(clients as any, jobs as any, [], [], "2026-10-27");
  assert.deepEqual(rows.map((r) => r.name), ["Acme Ltd", "Bee Ltd", "Gone Ltd"]);
  const a = rows[0];
  assert.equal(a.accounts.date, "2027-07-31"); assert.equal(a.accounts.from, "ch");
  assert.equal(a.cs.date, "2027-05-22"); assert.equal(a.csDate, "2027-05-08");
  assert.equal(a.ct.date, "2027-10-31"); assert.equal(a.ct.from, "app");
  assert.equal(a.vatNumber, "GB1");
});

test("until Companies House has been checked the app's open job fills in, and completed jobs are ignored", () => {
  const b = portfolioRows(clients as any, jobs as any, [], [], "2026-10-27")[1];
  assert.equal(b.accounts.date, "2027-02-01"); assert.equal(b.accounts.from, "app");
  assert.equal(b.cs.date, "");
  assert.equal(b.vat.date, "2026-11-07"); assert.equal(b.vat.pill?.tone, "red");
});

test("dissolved or struck-off companies are told apart", () => {
  assert.ok(isDissolved(clients[3] as any));
  assert.ok(!isDissolved(clients[0] as any));
  assert.ok(isDissolved({ CHVerified: JSON.stringify({ status: "Active, proposal to strike off" }) } as any));
});
