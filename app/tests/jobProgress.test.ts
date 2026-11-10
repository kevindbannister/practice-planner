import assert from "node:assert/strict";
import { test } from "node:test";
import { progress, progressPatch, readinessOf, remainingSet } from "../src/lib/jobProgress";
import { planHours } from "../src/lib/waiting";
import { finishedWithoutTime } from "../src/lib/timeSpent";

const open = { Key: "J1", Status: "Open" };

test("with no figure from you, what is left is the estimate less the time recorded", () => {
  const p = progress(open, { estimate: 6, actual: 2.5, plannedAhead: 1 });
  assert.deepEqual([p.remaining, p.remainingIsOwn, p.revisedTotal, p.unscheduled, p.toPlan], [3.5, false, 6, 2.5, 2.5]);
});

test("a revised estimate is yours: it is not reduced by the time recorded, and the job's size is what has been done plus what is left", () => {
  const p = progress({ ...open, RemainingHours: 5 }, { estimate: 6, actual: 2.5, plannedAhead: 0 });
  assert.deepEqual([p.remaining, p.remainingIsOwn, p.revisedTotal, p.estimate], [5, true, 7.5, 6]); // the original estimate stays at 6
  assert.equal(progress({ ...open, RemainingHours: 0 }, { estimate: 6, actual: 2, plannedAhead: 0 }).remaining, 0); // none left is a figure too
  assert.equal(remainingSet({ RemainingHours: "" }), undefined);
  assert.equal(remainingSet({ RemainingHours: -1 }), undefined);
});

test("over budget is not finished: it asks how much is left, and stays open", () => {
  const p = progress(open, { estimate: 6, actual: 9, plannedAhead: 0 });
  assert.equal(p.readiness, "ready");
  assert.equal(p.overBudget, true);
  assert.equal(p.needsRemaining, true);
  const said = progress({ ...open, RemainingHours: 1 }, { estimate: 6, actual: 9, plannedAhead: 0 });
  assert.deepEqual([said.overBudget, said.needsRemaining, said.remaining, said.revisedTotal], [true, false, 1, 10]);
  assert.equal(progress({ Status: "Complete" }, { estimate: 6, actual: 9, plannedAhead: 0 }).overBudget, false);
});

test("readiness: ready, partly ready, waiting (on someone), on hold, complete, kept apart from the workflow stage", () => {
  assert.equal(readinessOf({ ...open, Stage: "Review" }, 4), "ready");
  assert.equal(readinessOf({ ...open, ReadyHours: 1 }, 4), "partly");
  assert.equal(readinessOf({ ...open, ReadyHours: 0 }, 4), "waiting");
  assert.equal(readinessOf({ ...open, ReadyHours: 4 }, 4), "ready"); // all of it can be done
  assert.equal(readinessOf({ Status: "On hold", HoldKind: "HMRC" }, 4), "waiting");
  assert.equal(readinessOf({ Status: "On hold", HoldKind: "Team member" }, 4), "waiting");
  assert.equal(readinessOf({ Status: "On hold", HoldKind: "" }, 4), "hold");
  assert.equal(readinessOf({ Status: "Complete" }, 4), "complete");
  assert.equal(readinessOf({ Status: "Done" }, 4), "complete");
});

test("partly ready: only the part that can be done now is offered for planning; the rest is blocked", () => {
  const p = progress({ ...open, ReadyHours: 1.5, ReadyNote: "bank statements" }, { estimate: 5, actual: 0, plannedAhead: 0.5 });
  assert.deepEqual([p.readiness, p.actionable, p.blocked, p.unscheduled, p.toPlan], ["partly", 1.5, 3.5, 4.5, 1]);
});

test("waiting and on hold work takes no planning capacity", () => {
  const w = progress({ Status: "On hold", HoldKind: "Client" }, { estimate: 5, actual: 1, plannedAhead: 0 });
  assert.deepEqual([w.actionable, w.blocked, w.toPlan, w.remaining], [0, 4, 0, 4]);
  assert.equal(progress({ Status: "On hold", HoldKind: "" }, { estimate: 5, actual: 0, plannedAhead: 0 }).toPlan, 0);
});

test("the planner's hours for a job follow what is left and what can be done now, and are unchanged without them", () => {
  const services = [{ Key: "S1", DefaultHours: 6 }];
  const base = { ServiceKey: "S1", EstimateHours: 6 };
  assert.equal(planHours(base, services), 6);
  assert.equal(planHours({ ...base, RemainingHours: 2.5 }, services), 2.5);
  assert.equal(planHours({ ...base, RemainingHours: 4, ReadyHours: 1 }, services), 1);
  assert.equal(planHours({ ...base, ReadyHours: 2 }, services), 2);
  assert.equal(planHours({ ...base, RemainingHours: "", ReadyHours: "" }, services), 6);
});

test("saving: blank clears back to the estimate; bad figures and 'more now than is left' are refused with a reason", () => {
  assert.deepEqual(progressPatch({ remaining: "", ready: "", note: "" }).patch, { RemainingHours: "", ReadyHours: "", ReadyNote: "" });
  assert.deepEqual(progressPatch({ remaining: "2.5h", ready: "1", note: " the bank statements " }).patch, { RemainingHours: 2.5, ReadyHours: 1, ReadyNote: "the bank statements" });
  assert.match(progressPatch({ remaining: "lots", ready: "" , note: "" }).error!, /Work left/);
  assert.match(progressPatch({ remaining: "", ready: "-1", note: "" }).error!, /done now/);
  assert.match(progressPatch({ remaining: "1", ready: "2", note: "" }).error!, /More can't/);
});

test("finished work with time entries behind it isn't asked for its time again", () => {
  const jobs = [{ Key: "J1", Title: "A", Status: "Complete", CompletedDate: "2026-11-09", ActualHours: 0 }, { Key: "J2", Title: "B", Status: "Complete", CompletedDate: "2026-11-09" }] as never;
  const tasks = [{ Key: "T1", Title: "C", Status: "Done", CompletedDate: "2026-11-09" }] as never;
  assert.equal(finishedWithoutTime(jobs, tasks, []).length, 3);
  const some = finishedWithoutTime(jobs, tasks, [], { tracked: (k, key) => (key === "J1" || key === "T1" ? 1.5 : 0) });
  assert.deepEqual(some.map((f) => f.key), ["J2"]);
});
