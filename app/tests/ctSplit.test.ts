import { test } from "node:test";
import assert from "node:assert/strict";
import { ctPaymentDate, ctPeriods, isEarlierPart, isLongFirstPeriod, isoDate, splitFirstYear, splitPart } from "../src/lib/ctSplit.ts";
import { BUILT_IN_RULES, rollForward } from "../src/lib/planning.ts";

test("Fired Up BBQ Global Ltd: accounts 5 Mar 2025 to 31 Mar 2026 give two Corporation Tax periods", () => {
  assert.deepEqual(ctPeriods("2025-03-05", "2026-03-31"), [{ start: "2025-03-05", end: "2026-03-04" }, { start: "2026-03-05", end: "2026-03-31" }]);
  assert.equal(isLongFirstPeriod("2025-03-05", "2026-03-31"), true);
  assert.equal(isLongFirstPeriod("2025-03-05", "2026-03-04"), false); // exactly 12 months
  assert.equal(isLongFirstPeriod("2025-03-05", "2027-03-31"), false); // past 18 months: not the first accounts
  assert.equal(isLongFirstPeriod("", "2026-03-31"), false);
  assert.equal(ctPaymentDate("2026-03-04"), "2026-12-05");
  assert.equal(ctPaymentDate("2026-03-31"), "2027-01-01");
  assert.equal(isoDate("05/03/2025"), "2025-03-05");
});

test("the open CT job becomes the first 12 months and a second job covers the rest, both due 12 months after the accounts", () => {
  const job = { Key: "J1", ClientKey: "C9", ClientName: "Fired Up BBQ Global Ltd", ServiceKey: "CT600", Title: "Corporation Tax", PeriodEnd: "2026-03-31", Deadline: "2027-03-31", StageNo: 1, StageName: "Records in", Owner: "Sam" };
  const client = { Key: "C9", Incorporated: "2025-03-05" };
  let n = 0;
  const r = splitFirstYear(job, client, () => `NEW${++n}`)!;
  assert.equal(r.patch.PeriodStart, "2025-03-05");
  assert.equal(r.patch.PeriodEnd, "2026-03-04");
  assert.equal(r.patch.Deadline, "2027-03-31");
  assert.equal(r.patch.Title, "Corporation Tax - 5 Mar 2025 to 4 Mar 2026");
  assert.equal(r.patch.Source, "ct-split:1/2");
  assert.match(String(r.patch.Notes), /Tax due 5 Dec 2026/);
  assert.equal(r.create.length, 1);
  const two = r.create[0];
  assert.deepEqual([two.Key, two.PeriodStart, two.PeriodEnd, two.Deadline, two.Title, two.Source, two.Owner, two.StageNo], ["NEW1", "2026-03-05", "2026-03-31", "2027-03-31", "Corporation Tax - 5 Mar 2026 to 31 Mar 2026", "ct-split:2/2", "Sam", 1]);
  assert.match(String(two.Notes), /Tax due 1 Jan 2027/);
  // already split, or not needed: nothing to do
  assert.equal(splitFirstYear({ ...job, ...r.patch }, client, () => "X"), undefined);
  assert.equal(splitFirstYear({ ...job, PeriodEnd: "2026-03-04" }, client, () => "X"), undefined);
  assert.equal(splitFirstYear({ ...job, ServiceKey: "ACCS_LTD" }, client, () => "X"), undefined);
  assert.equal(splitFirstYear(job, { Incorporated: "" }, () => "X"), undefined);
});

test("completing the first part doesn't roll forward; the last part rolls on to a normal 12-month year", () => {
  assert.deepEqual(splitPart({ Source: "ct-split:1/2" }), { n: 1, of: 2 });
  assert.equal(isEarlierPart({ Source: "ct-split:1/2" }), true);
  assert.equal(isEarlierPart({ Source: "ct-split:2/2" }), false);
  const last = { Key: "J2", ClientKey: "C9", ServiceKey: "CT600", Title: "Corporation Tax - 5 Mar 2026 to 31 Mar 2026", PeriodEnd: "2026-03-31", Deadline: "2027-03-31", Source: "ct-split:2/2" };
  const next = rollForward(last as never, BUILT_IN_RULES.CT600, "2027-01-10", "J3")!;
  assert.equal(next.PeriodEnd, "2027-03-31");
  assert.equal(next.Deadline, "2028-03-31");
  assert.equal(next.Title, "Corporation Tax");
  assert.equal(rollForward({ ...last, Source: "ct-split:1/2" } as never, BUILT_IN_RULES.CT600, "2027-01-10", "J3"), null);
});
