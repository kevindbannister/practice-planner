// Months ahead.
import assert from "node:assert/strict";
import { test } from "node:test";
import { capacityBetween, expectedAfter, forecast } from "../src/lib/forecast";
import { DEFAULT_SETTINGS } from "../src/lib/planning";
import { Job } from "../src/lib/domain";

const H = DEFAULT_SETTINGS.hours; // 7.5h Monday to Friday

test("capacity counts weekdays only", () => {
  assert.equal(capacityBetween("2026-10-05", "2026-10-11", H), 37.5); // Mon to Sun
  assert.equal(capacityBetween("2026-10-10", "2026-10-11", H), 0); // weekend
});

test("recurring work is rolled forward as expected work", () => {
  const vat: Job = { Key: "V", Title: "VAT return", ClientKey: "C1", ServiceKey: "VAT", PeriodEnd: "2026-09-30", Deadline: "2026-11-07" };
  const ex = expectedAfter(vat, [], "2027-06-30");
  assert.deepEqual(ex.map((e) => [e.periodEnd, e.deadline]), [["2026-12-31", "2027-02-07"], ["2027-03-31", "2027-05-07"]]);
  assert.equal(ex[0].kind, "expected");
  const oneOff: Job = { Key: "O", Title: "Onboarding", ClientKey: "C1", ServiceKey: "ONBOARDING", Deadline: "2026-11-01" };
  assert.deepEqual(expectedAfter(oneOff, [], "2027-06-30"), []);
});

test("forecast: late work, months, planned, on hold and running totals", () => {
  const jobs: Job[] = [
    { Key: "late", Title: "Self Assessment return", ClientKey: "C1", ServiceKey: "SA100", PeriodEnd: "2025-04-05", Deadline: "2026-01-31", Status: "Open" },
    { Key: "oct", Title: "VAT return", ClientKey: "C2", ServiceKey: "VAT", PeriodEnd: "2026-08-31", Deadline: "2026-10-07", Status: "Open" },
    { Key: "nov", Title: "VAT return", ClientKey: "C3", ServiceKey: "VAT", PeriodEnd: "2026-09-30", Deadline: "2026-11-07", Status: "Open", PlannedDate: "2026-10-20", EstimateHours: 2 },
    { Key: "held", Title: "Limited company accounts", ClientKey: "C4", ServiceKey: "ACCS_LTD", PeriodEnd: "2026-01-31", Deadline: "2026-11-30", Status: "On hold" },
    { Key: "done", Title: "Limited company accounts", ClientKey: "C5", ServiceKey: "ACCS_LTD", PeriodEnd: "2026-01-31", Deadline: "2026-11-30", Status: "Complete" },
  ];
  const f = forecast(jobs, [], [], H, "2026-10-09", 3);
  assert.deepEqual(f.late.map((i) => i.key), ["late", "oct"]);
  assert.equal(f.lateHours, 2 + 1.5);
  assert.deepEqual(f.months.map((m) => m.key), ["2026-10", "2026-11", "2026-12"]);
  const nov = f.months[1];
  assert.deepEqual(nov.items.map((i) => i.key), ["nov", "held"]);
  assert.equal(nov.due, 2); // on hold isn't counted
  assert.equal(nov.planned, 2);

  assert.equal(f.months[0].capacity, 16 * 7.5); // from today, Fri 9 Oct: 16 weekdays left
  // the October VAT job rolls forward into January, beyond these three months
  assert.equal(f.months[2].items.length, 0);
  assert.equal(f.months[1].cumulativeDue, 3.5 + 0 + 2);
});
