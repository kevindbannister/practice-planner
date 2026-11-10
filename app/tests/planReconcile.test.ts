import assert from "node:assert/strict";
import { test } from "node:test";
import { acceptSuggestion, dayReview, drift, recordDrift, suggest } from "../src/lib/planReconcile";
import { Plan, Session, applyPlan, committedMinutes, createSessions, undoBatch, undoable, PlanEvent } from "../src/lib/planSessions";
import { manualEntry, readEntry } from "../src/lib/timesheet";

let n = 0;
const ctx = () => ({ now: "2026-11-10T18:00:00Z", user: "kevin", newKey: (p: string) => `${p}${++n}` });
const now = new Date("2026-11-10T18:00:00Z");
const mk = (over: Partial<Session> & { key: string }): Session => ({ kind: "job", itemKey: "J1", clientKey: "C1", title: "Accounts", userKey: "kevin", date: "2026-11-10", start: "", minutes: 120, actualMinutes: 0, status: "planned", outcome: "", originalKey: "", replacedByKey: "", reason: "", notes: "", created: "2026-11-09T09:00:00Z", createdBy: "kevin", updated: "", updatedBy: "", version: 1, ...over });
const entry = (o: any) => readEntry(manualEntry({ date: "2026-11-10", ...o }, "kevin", (p) => `${p}${++n}`, now).row!);

test("the end of day picture: planned, recorded, on plan, unplanned, no time, and what is not yet accounted for", () => {
  const s = [mk({ key: "A", minutes: 180 }), mk({ key: "B", itemKey: "J2", title: "VAT", minutes: 60 }), mk({ key: "C", itemKey: "J3", title: "Done one", minutes: 60, status: "completed", actualMinutes: 60 }), mk({ key: "X", itemKey: "J4", date: "2026-11-11" })];
  const e = [entry({ minutes: 120, sessionKey: "A", jobKey: "J1" }), entry({ minutes: 35, activityKey: "telephone-calls" }), entry({ minutes: 60, sessionKey: "C", jobKey: "J3" })];
  const r = dayReview(s, e, "2026-11-10", 7.5, now);
  assert.equal(r.planned.length, 3); // the one for tomorrow is not part of today
  assert.deepEqual([r.plannedMinutes, r.recordedMinutes, r.onPlanMinutes, r.unplannedMinutes], [300, 215, 180, 35]);
  assert.deepEqual(r.noTime.map((x) => x.key), ["B"]); // planned, still open, nothing recorded
  assert.deepEqual([r.completed, r.partial, r.notDone, r.stillOpen], [1, 0, 0, 2]);
  assert.equal(r.unaccountedMinutes, 450 - 215);
  assert.equal(dayReview(s, [], "2026-11-10", 0, now).unaccountedMinutes, 0);
});

test("a session moved away still counts as what was planned that day; an undone creation does not", () => {
  const s = [mk({ key: "A", status: "rescheduled", replacedByKey: "A2" }), mk({ key: "A2", date: "2026-11-11", originalKey: "A" }), mk({ key: "U", status: "cancelled", outcome: "Undone" })];
  const r = dayReview(s, [], "2026-11-10", 7.5, now);
  assert.deepEqual(r.planned.map((x) => x.key), ["A"]);
  assert.equal(r.notDone, 1);
});

test("dates changed on the board are matched to their sessions: one live session moved, a taken-off card cancelled, several left alone, nothing else touched", () => {
  const sessions = [mk({ key: "A", itemKey: "J1" }), mk({ key: "B", itemKey: "J2" }), mk({ key: "C1", itemKey: "J3" }), mk({ key: "C2", itemKey: "J3", date: "2026-11-12" }), mk({ key: "D", itemKey: "J4" }), mk({ key: "E", itemKey: "J5", status: "completed" })];
  const jobs = [
    { Key: "J1", Title: "Accounts", PlannedDate: "2026-11-13", Status: "Open" }, // dragged to Friday
    { Key: "J2", Title: "VAT", PlannedDate: "", Status: "Open" }, // taken off
    { Key: "J3", Title: "Payroll", PlannedDate: "2026-11-20", Status: "Open" }, // two sessions
    { Key: "J4", Title: "Same", PlannedDate: "2026-11-10", Status: "Open" }, // unchanged
    { Key: "J5", Title: "Only history", PlannedDate: "2026-11-14", Status: "Open" }, // no live session: for the bring-in, not here
    { Key: "J6", Title: "Complete", PlannedDate: "2026-11-14", Status: "Complete" },
  ];
  const d = drift(jobs, [], sessions);
  assert.deepEqual(d.map((x) => [x.kind, x.itemKey]), [["moved", "J1"], ["taken-off", "J2"], ["ambiguous", "J3"]]);
  const plan = recordDrift(d, ctx());
  assert.equal(plan.problems.length, 1);
  const out = applyPlan(sessions, plan).sessions;
  assert.equal(out.find((x) => x.key === "A")!.status, "rescheduled");
  assert.equal(out.filter((x) => x.itemKey === "J1" && x.status === "planned")[0].date, "2026-11-13");
  assert.equal(out.find((x) => x.key === "B")!.status, "cancelled");
  assert.equal(out.find((x) => x.key === "B")!.reason, "Taken off the planner");
  assert.equal(out.find((x) => x.key === "C1")!.status, "planned"); // left alone
  // and it is one batch that can be undone, putting the sessions back
  const batch = plan.events[0].batchKey;
  assert.ok(plan.events.every((e) => e.batchKey === batch));
  const u = undoBatch(batch, plan.events as PlanEvent[], out, ctx());
  assert.equal(u.skipped.length, 0);
  assert.ok(undoable(batch, plan.events));
});

test("suggested sessions use the free time of the days ahead, from the earliest, in sessions of 30 minutes to 3 hours, and not beyond the deadline if they fit", () => {
  const cap = (d: string) => (["2026-11-14", "2026-11-15"].includes(d) ? 0 : 7.5); // weekend off
  const standing = createSessions([{ kind: "job", itemKey: "OTHER", title: "Other", date: "2026-11-10", minutes: 300 }], ctx()).creates; // 5h already on the first day
  const r = suggest({ minutes: 600, from: "2026-11-10", deadline: "2026-11-17", days: 30, capacity: cap, sessions: standing });
  assert.deepEqual(r.sessions, [{ date: "2026-11-10", minutes: 150 }, { date: "2026-11-11", minutes: 180 }, { date: "2026-11-12", minutes: 180 }, { date: "2026-11-13", minutes: 90 }]);
  assert.deepEqual([r.short, r.lateBy], [0, 0]);
  assert.equal(r.sessions.reduce((t, x) => t + x.minutes, 0), 600);
  assert.ok(r.sessions.every((x) => !["2026-11-14", "2026-11-15"].includes(x.date)));
});

test("work that can't be placed before the deadline is still offered after it, and said to be late; no room at all is said too", () => {
  const cap = (d: string) => (d <= "2026-11-11" ? 7.5 : d <= "2026-11-20" ? 2 : 0);
  const r = suggest({ minutes: 1200, from: "2026-11-10", deadline: "2026-11-11", days: 30, capacity: cap, sessions: [] });
  assert.equal(r.sessions[0].date, "2026-11-10");
  assert.ok(r.lateBy > 0);
  assert.equal(r.sessions.reduce((t, x) => t + x.minutes, 0) + r.short, 1200);
  const none = suggest({ minutes: 120, from: "2026-11-10", days: 10, capacity: () => 0, sessions: [] });
  assert.deepEqual([none.sessions.length, none.short], [0, 120]);
  assert.deepEqual(suggest({ minutes: 0, from: "2026-11-10", days: 10, capacity: () => 7, sessions: [] }).sessions, []);
});

test("accepting a suggestion makes real linked sessions in one batch; the days then show them as committed, and one undo removes them all", () => {
  const r = suggest({ minutes: 360, from: "2026-11-10", days: 5, capacity: () => 4, sessions: [] });
  const plan = acceptSuggestion({ kind: "job", itemKey: "J1", clientKey: "C1", title: "Accounts" }, r.sessions, ctx());
  const s = applyPlan([], plan).sessions;
  assert.equal(s.length, r.sessions.length);
  assert.equal(committedMinutes(s, "2026-11-10"), 180);
  assert.equal(new Set(plan.events.map((e) => e.batchKey)).size, 1);
  const u = undoBatch(plan.events[0].batchKey, plan.events as PlanEvent[], s, ctx());
  const after = applyPlan(s, u as Plan).sessions;
  assert.ok(after.every((x) => x.status === "cancelled"));
  assert.equal(after.length, s.length); // nothing deleted
});
