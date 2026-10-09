import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BUILT_IN_RULES, DEFAULT_SETTINGS, addMonths, describeRule, jobHours, mondayOf, nextPeriod as nextByRule, readSettings,
  rollForward as rollByRule, ruleFields, ruleFor, weekday, workingDay,
} from "../src/lib/planning";

const nextPeriod = (svc: string, pe?: string, dl?: string) => {
  const n = nextByRule(ruleFor(svc), pe, dl);
  return n && { PeriodEnd: n.PeriodEnd, Deadline: n.Deadline };
};
const rollForward = (job: any, on: string, key: string) => rollByRule(job, ruleFor(job.ServiceKey), on, key);

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
  assert.deepEqual(nextPeriod("CT600", "2025-10-31"), { PeriodEnd: "2026-10-31", Deadline: "2027-10-31" });
  assert.deepEqual(nextPeriod("CS01", "2026-05-08"), { PeriodEnd: "2027-05-08", Deadline: "2027-05-22" });
  assert.deepEqual(nextPeriod("CS01", "2027-02-28"), { PeriodEnd: "2028-02-28", Deadline: "2028-03-13" }, "CS01 keeps the exact day");
  assert.deepEqual(nextPeriod("SA100", "2026-04-05"), { PeriodEnd: "2027-04-05", Deadline: "2028-01-31" });
  assert.deepEqual(nextPeriod("VAT", "2026-09-30"), { PeriodEnd: "2026-12-31", Deadline: "2027-02-07" });
  assert.deepEqual(nextPeriod("PAYROLL", "2026-10-31", "2026-10-31"), { PeriodEnd: "2026-11-30", Deadline: "2026-11-30" });
  assert.deepEqual(nextPeriod("MGMT_ACCOUNTS", "2026-10-14", "2026-10-20"), { PeriodEnd: "2026-11-14", Deadline: "2026-11-20" });
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
  const d = (svc: string, pe: string) => deadlineFor(ruleFor(svc), pe);
  assert.equal(d("ACCS_LTD", "2026-03-31"), "2026-12-31");
  assert.equal(d("ACCS_LTD", "2026-03-29"), "2026-12-29");
  assert.equal(d("CS01", "2027-05-08"), "2027-05-22");
  assert.equal(d("SA100", "2026-04-05"), "2027-01-31");
  assert.equal(d("VAT", "2026-12-31"), "2027-02-07");
  assert.equal(d("MGMT_ACCOUNTS", "2026-10-14"), "2026-10-14");
});

test("rules saved in Settings override the built-in ones", () => {
  const services = [{ Key: "ACCS_LTD", ...ruleFields({ ...BUILT_IN_RULES.ACCS_LTD, months: 6 }) }];
  assert.equal(nextByRule(ruleFor("ACCS_LTD", services), "2025-12-31")!.Deadline, "2027-06-30");
  const custom = [{ Key: "PAYE_AE", RepeatMonths: 36, DeadlineMode: "after", DeadlineMonths: 5, DeadlineDays: 0, KeepMonthEnd: true }];
  const n = nextByRule(ruleFor("PAYE_AE", custom), "2026-01-31")!;
  assert.deepEqual([n.PeriodEnd, n.Deadline], ["2029-01-31", "2029-06-30"]);
  assert.equal(ruleFor("UNKNOWN").repeatMonths, 0, "unknown types are one-off");
  assert.equal(describeRule(BUILT_IN_RULES.ACCS_LTD), "Yearly · due 9 months after period end");
  assert.equal(describeRule(BUILT_IN_RULES.SA100), "Yearly · due 31 Jan after period end");
  assert.equal(describeRule(BUILT_IN_RULES.VAT), "Quarterly · due 1 month and 7 days after period end");
  assert.equal(describeRule(BUILT_IN_RULES.PAYROLL), "Monthly · due the same time after period end as last time");
});

import { holdAlert, holdPatch, resumePatch } from "../src/lib/domain";

test("on hold: reminders when the look-again date comes or the deadline gets close", () => {
  const held = { Status: "On hold", HoldReason: "Waiting for bank statements", HoldUntil: "2026-11-01", HeldOn: "2026-10-09" };
  assert.equal(holdAlert(held, "2027-01-31", "2026-10-20"), null);
  assert.equal(holdAlert(held, "2027-01-31", "2026-11-01")?.text, "On hold: time to look again (from 1 Nov 2026)");
  assert.deepEqual(holdAlert(held, "2026-10-30", "2026-10-20"), { level: "amber", text: "On hold, but due in 10 days" });
  assert.equal(holdAlert(held, "2026-10-19", "2026-10-20")?.level, "red");
  assert.equal(holdAlert({ Status: "Open" }, "2026-10-19", "2026-10-20"), null);
});

test("on hold: putting on and taking off keeps a note of the hold", () => {
  assert.deepEqual(holdPatch(" Client abroad ", "2026-12-01", "2026-10-09"), {
    Status: "On hold", HoldReason: "Client abroad", HoldUntil: "2026-12-01", HeldOn: "2026-10-09", PlannedDate: "",
  });
  const back = resumePatch({ Status: "On hold", HoldReason: "Client abroad", HeldOn: "2026-10-09", Notes: "Called 3 Oct" }, "2026-11-02");
  assert.equal(back.Status, "Open");
  assert.equal(back.Notes, "Called 3 Oct\nOn hold 9 Oct 2026 to 2 Nov 2026: Client abroad");
  assert.equal(resumePatch({ Status: "On hold" }, "2026-11-02").Notes, "On hold until 2 Nov 2026");
});
