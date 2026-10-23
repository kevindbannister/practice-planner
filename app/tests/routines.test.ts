import test from "node:test";
import assert from "node:assert/strict";
import { Routine, dueRoutines, occurrences, readRoutines, routineTask, describeRoutine } from "../src/lib/routines";

const r = (o: Partial<Routine> = {}): Routine => ({ id: "R1", title: "Bookkeeping", every: "week", weekday: 1, monthDay: 1, hours: 3, active: true, ...o });

test("weekly routine falls on its weekday in the window", () => {
  assert.deepEqual(occurrences(r(), "2026-10-19", "2026-10-23"), ["2026-10-19"]);
  assert.deepEqual(occurrences(r({ weekday: 1 }), "2026-10-21", "2026-10-23"), []);
  assert.deepEqual(occurrences(r({ weekday: 5 }), "2026-10-19", "2026-11-06"), ["2026-10-23", "2026-10-30", "2026-11-06"]);
});
test("monthly routine moves a weekend to Monday", () => {
  assert.deepEqual(occurrences(r({ every: "month", monthDay: 3 }), "2026-10-26", "2026-11-06"), ["2026-11-03"]);
  assert.deepEqual(occurrences(r({ every: "month", monthDay: 3 }), "2026-10-26", "2026-11-09"), ["2026-11-03"]);
  assert.deepEqual(occurrences(r({ every: "month", monthDay: 10 }), "2026-10-26", "2026-11-13"), ["2026-11-10"]);
  assert.deepEqual(occurrences(r({ every: "month", monthDay: 3 }), "2026-10-01", "2026-10-09"), ["2026-10-05"]);
});
test("tasks already made aren't offered again", () => {
  const tasks = [{ RoutineKey: "R1", RoutineDate: "2026-10-19" }];
  assert.equal(dueRoutines([r()], tasks, "2026-10-19", "2026-10-23").length, 0);
  assert.equal(dueRoutines([r()], tasks, "2026-10-19", "2026-10-30").length, 1);
  assert.equal(dueRoutines([r({ active: false })], [], "2026-10-19", "2026-10-23").length, 0);
});
test("task made from a routine", () => {
  const t = routineTask({ routine: r({ clientKey: "C1" }), date: "2026-10-19" }, "T1");
  assert.equal(t.PlannedDate, "2026-10-19"); assert.equal(t.RoutineKey, "R1"); assert.equal(t.EstimateHours, 3); assert.equal(t.ClientKey, "C1");
});
test("reading saved routines drops junk and tidies", () => {
  const out = readRoutines([{ id: "a", title: " Look at the business ", weekday: 9, every: "month", monthDay: 40, hours: -1 }, { id: "b", title: "" }, null]);
  assert.equal(out.length, 1); assert.equal(out[0].weekday, 5); assert.equal(out[0].monthDay, 28); assert.equal(out[0].hours, 1);
  assert.equal(describeRoutine(r()), "Every Monday");
  assert.equal(describeRoutine(r({ every: "month", monthDay: 2 })), "Monthly, on the 2nd");
});
