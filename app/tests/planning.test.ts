import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_SETTINGS, addMonths, jobHours, mondayOf, nextPeriod, readSettings, rollForward, weekday, workingDay,
} from "../src/lib/planning";

test("month arithmetic keeps month ends", () => {
  assert.equal(addMonths("2026-02-28", 12), "2027-02-28");
  assert.equal(addMonths("2026-02-28", 1), "2026-03-31");
  assert.equal(addMonths("2026-10-31", 9), "2027-07-31");
  assert.equal(addMonths("2026-03-29", 9), "2026-12-29");
  assert.equal(addMonths("2024-02-29", 12), "2025-02-28");
  assert.equal(addMonths("2026-05-08", 12, false), "2027-05-08");
});

test("week helpers", () => {
  assert.equal(weekday("2026-10-09"), 5);
  assert.equal(mondayOf("2026-10-09"), "2026-10-05");
  assert.equal(mondayOf("2026-10-11"), "2026-10-05");
  assert.equal(workingDay("2026-10-10"), "2026-10-09");
  assert.equal(workingDay("2026-10-12"), "2026-10-12");
});

test("next periods follow the statutory rules", () => {
  assert.deepEqual(nextPeriod("ACCS_LTD", "2025-10-31")!.Deadline, "2027-07-31");
  assert.equal(nextPeriod("ACCS_LTD", "2025-10-31")!.PeriodEnd, "2026-10-31");
  assert.equal(nextPeriod("ACCS_LTD", "2026-03-29")!.Deadline, "2027-12-29");
  assert.deepEqual(nextPeriod("CT600", "2025-10-31"), { PeriodEnd: "2026-10-31", Deadline: "2027-10-31", rule: "Year end + 12 months" });
  assert.deepEqual(nextPeriod("CS01", "2026-05-08"), { PeriodEnd: "2027-05-08", Deadline: "2027-05-22", rule: "Made-up date + 14 days" });
  assert.deepEqual(nextPeriod("SA100", "2026-04-05"), { PeriodEnd: "2027-04-05", Deadline: "2028-01-31", rule: "31 January after the tax year" });
  assert.deepEqual(nextPeriod("VAT", "2026-09-30"), { PeriodEnd: "2026-12-31", Deadline: "2027-02-07", rule: "Quarter end + 1 month + 7 days" });
  assert.deepEqual(nextPeriod("PAYROLL", "2026-10-31", "2026-10-31"), { PeriodEnd: "2026-11-30", Deadline: "2026-11-30", rule: "Monthly" });
  assert.equal(nextPeriod("ONBOARDING", "2026-07-31"), null);
  assert.equal(nextPeriod("ACCS_LTD", undefined), null);
});

test("completing a job creates next period's job", () => {
  const job = {
    Key: "J1", Title: "Limited company accounts", ClientKey: "C1", ClientName: "Acme Ltd", ServiceKey: "ACCS_LTD",
    PeriodEnd: "2025-10-31", Deadline: "2026-07-31", PlannedDate: "2026-03-14", RecordsReceived: "2026-02-02",
    EstimateHours: 6, ActualHours: 7.5, Status: "Open",
  };
  const next = rollForward(job as any, "2026-03-16", "J2")!;
  assert.equal(next.PeriodEnd, "2026-10-31");
  assert.equal(next.Deadline, "2027-07-31");
  assert.equal(next.StageNo, 1);
  assert.equal(next.RecordsExpected, "2027-02-02");
  assert.equal(next.SuggestedSlot, "2027-03-12", "planned 14 Mar 2027 is a Sunday, so the Friday before");
  assert.equal(next.EstimateHours, 7.5, "uses this year's actual time");
  assert.equal(next.Status, "Open");
  assert.equal(rollForward({ ...job, ServiceKey: "ONBOARDING" } as any, "2026-03-16", "J3"), null);
});

test("hours per job and settings", () => {
  const services = [{ Key: "VAT", DefaultHours: 2 }];
  assert.equal(jobHours({ ServiceKey: "VAT" }, services), 2, "service setting wins over built-in default");
  assert.equal(jobHours({ ServiceKey: "SA100" }, services), 2);
  assert.equal(jobHours({ ServiceKey: "CS01", EstimateHours: 0.75 }, services), 0.75);
  assert.equal(jobHours({ ServiceKey: "WHATEVER" }, services), 1);
  assert.deepEqual(readSettings([]), DEFAULT_SETTINGS);
  const s = readSettings([{ Key: "hours", Value: '{"5":4}' }, { Key: "tightDays", Value: "14" }, { Key: "x", Value: "{bad" }]);
  assert.equal(s.hours["5"], 4);
  assert.equal(s.hours["1"], 7.5);
  assert.equal(s.tightDays, 14);
});

test("deadlines for new jobs", async () => {
  const { deadlineFor } = await import("../src/lib/planning");
  assert.equal(deadlineFor("ACCS_LTD", "2026-03-31"), "2026-12-31");
  assert.equal(deadlineFor("CS01", "2027-05-08"), "2027-05-22");
  assert.equal(deadlineFor("SA100", "2026-04-05"), "2027-01-31");
  assert.equal(deadlineFor("VAT", "2026-12-31"), "2027-02-07");
  assert.equal(deadlineFor("MGMT_ACCOUNTS", "2026-10-14"), "2026-10-14");
});
