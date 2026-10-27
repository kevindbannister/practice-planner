import test from "node:test";
import assert from "node:assert/strict";
import { isStatutory, sectionJobs, statutoryRank, waitingOnClient } from "../src/lib/workGroups";

const name = (k: string) => ({ ACCS_LTD: "Limited company accounts", CT600: "Corporation tax return", VAT: "VAT return", PAYROLL: "Payroll", CS01: "Confirmation statement", SA100: "Self Assessment return", MGMT_ACCOUNTS: "Management accounts", BOOKKEEPING: "Bookkeeping", P11D: "P11D" } as Record<string, string>)[k] || k;

test("statutory work is decided from the setting, else from the type of work", () => {
  assert.equal(isStatutory(undefined, "VAT"), true);
  assert.equal(isStatutory(undefined, "BOOKKEEPING"), false);
  assert.equal(isStatutory({ Key: "BOOKKEEPING", Statutory: "yes" }, "BOOKKEEPING"), true);
  assert.equal(isStatutory({ Key: "VAT", Statutory: "no" }, "VAT"), false);
});

test("statutory jobs come first in the agreed order, others after, nothing invented", () => {
  const jobs = [
    { Key: "1", ServiceKey: "BOOKKEEPING", Deadline: "2026-12-01" }, { Key: "2", ServiceKey: "SA100", Deadline: "2027-01-31" },
    { Key: "3", ServiceKey: "CS01", Deadline: "2027-05-22" }, { Key: "4", ServiceKey: "VAT", Deadline: "2026-12-07" },
    { Key: "5", ServiceKey: "ACCS_LTD", Deadline: "2027-07-31" }, { Key: "6", ServiceKey: "CT600", Deadline: "2026-10-31" },
    { Key: "7", ServiceKey: "MGMT_ACCOUNTS", Deadline: "2026-11-05" }, { Key: "8", ServiceKey: "PAYROLL", Deadline: "2026-11-30" },
    { Key: "9", ServiceKey: "P11D", Deadline: "2026-07-06" }, { Key: "10", ServiceKey: "VAT", Deadline: "2026-09-07" },
  ];
  const s = sectionJobs(jobs, [], name);
  assert.deepEqual(s.statutory.map((j) => j.Key), ["5", "6", "10", "4", "8", "9", "3", "2"]);
  assert.deepEqual(s.other.map((j) => j.Key), ["1", "7"].sort((a, b) => name(jobs.find((j) => j.Key === a)!.ServiceKey).localeCompare(name(jobs.find((j) => j.Key === b)!.ServiceKey))));
  assert.equal(s.statutory.length + s.other.length, jobs.length);
  assert.ok(statutoryRank("ACCS_LTD") < statutoryRank("CT600"));
});

test("waiting on the client: with-client stage, prepared, or records chased", () => {
  const stages = [{ StageNo: 1, Title: "Request records" }, { StageNo: 2, Title: "Waiting for client approval", WaitClient: true }];
  const jobs = [
    { Key: "a", StageNo: 2 }, { Key: "b", StageNo: 1, WaitingSince: "2026-10-20", SpeakOn: "2026-10-30" },
    { Key: "c", StageNo: 1, ChaseCount: 2, RecordsExpected: "2026-10-25" }, { Key: "d", StageNo: 1 }, { Key: "e", StageNo: 2, Status: "Complete" },
  ];
  const w = waitingOnClient(jobs, () => stages);
  assert.deepEqual(w.map((x) => x.job.Key), ["a", "b", "c"]);
  assert.equal(w[1].chaseOn, "2026-10-30");
});
