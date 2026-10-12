// Waiting for the client, then finalising.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  adoptWaitingJobs, finaliseDefault, firstWaitStage, initialWaitStages, looksLikeWaitStage, planHours, unwaitPatch, waitPatch, waitState, waitingForClient,
} from "../src/lib/waiting";

const services = [{ Key: "ACCS_LTD", DefaultHours: 6 }, { Key: "SA100", DefaultHours: 2 }, { Key: "VAT", DefaultHours: 1.5, FinaliseHours: 0.75 }];

test("stage names that mean the client has it", () => {
  const yes = ["Sent to Client for approval", "Client approval / confirmation request", "Send for approval", "Request client confirmation"];
  const no = ["Approval received / ready to file", "Client approved VAT return", "Client approved / ready to file", "Send to Client", "Send Reports to Client", "Preparation", "Filing"];
  for (const t of yes) assert.equal(looksLikeWaitStage(t), true, t);
  for (const t of no) assert.equal(looksLikeWaitStage(t), false, t);
  const stages = [{ Title: "Preparation", StageNo: 1 }, { Title: "Send for approval", StageNo: 2 }, { Title: "Filing", StageNo: 3, WaitClient: false }];
  assert.deepEqual(initialWaitStages(stages).map((s) => s.StageNo), [2]);
});

test("waiting stages, finalising hours", () => {
  const stages = [{ StageNo: 1, Title: "Prep" }, { StageNo: 2, Title: "Sent", WaitClient: true }, { StageNo: 3, Title: "File" }];
  assert.equal(firstWaitStage(stages), 2);
  assert.equal(waitingForClient({ StageNo: 2 }, stages), true);
  assert.equal(waitingForClient({ StageNo: 3 }, stages), false);
  assert.equal(finaliseDefault("ACCS_LTD", services), 1);
  assert.equal(finaliseDefault("SA100", services), 0.5);
  assert.equal(finaliseDefault("VAT", services), 0.75);
  assert.equal(planHours({ ServiceKey: "ACCS_LTD" }, services), 6);
  assert.equal(planHours({ ServiceKey: "ACCS_LTD", WaitingSince: "2026-10-12" }, services), 1);
  assert.equal(planHours({ ServiceKey: "ACCS_LTD", WaitingSince: "2026-10-12", FinaliseHours: 1.5 }, services), 1.5);
});

test("moving onto a waiting stage records the preparing and clears the plan", () => {
  const job = { ServiceKey: "ACCS_LTD", EstimateHours: 5, PlannedDate: "2026-10-09", StageNo: 9 };
  const p = waitPatch(job, { StageNo: 10, StageName: "Sent" }, "2026-10-19", 1, "2026-10-12", services);
  assert.deepEqual(p, {
    StageNo: 10, StageName: "Sent", WaitingSince: "2026-10-12", SpeakOn: "2026-10-19", FinaliseHours: 1,
    PreparedOn: "2026-10-09", PreparedHours: 4, PlannedDate: "",
  });
  // planned for later than today: the preparing happened today
  assert.equal(waitPatch({ ...job, PlannedDate: "2026-10-15" }, {}, "", 1, "2026-10-12", services).PreparedOn, "2026-10-12");
  assert.equal(unwaitPatch().WaitingSince, "");
  assert.equal(waitState({ SpeakOn: "2026-10-12" }, "2026-10-12"), "today");
  assert.equal(waitState({ SpeakOn: "2026-10-01" }, "2026-10-12"), "passed");
  assert.equal(waitState({}, "2026-10-12"), "nodate");
});

test("jobs already at a with-client stage are taken as prepared", () => {
  const stages = [{ ServiceKey: "ACCS_LTD", StageNo: 1 }, { ServiceKey: "ACCS_LTD", StageNo: 2, WaitClient: true }, { ServiceKey: "SA100", StageNo: 2 }];
  const jobs = [
    { Key: "a", ServiceKey: "ACCS_LTD", StageNo: 2, Status: "Open" },
    { Key: "b", ServiceKey: "ACCS_LTD", StageNo: 1, Status: "Open" },
    { Key: "c", ServiceKey: "SA100", StageNo: 2, Status: "Open" },
    { Key: "d", ServiceKey: "ACCS_LTD", StageNo: 2, Status: "Open", WaitingSince: "2026-10-01" },
  ];
  const r = adoptWaitingJobs(jobs, stages, services, "2026-10-12");
  assert.deepEqual(r.map((x) => [x.row.Key, x.patch]), [["a", { WaitingSince: "2026-10-12", FinaliseHours: 1 }]]);
});
