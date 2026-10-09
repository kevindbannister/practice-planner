// Suggest a plan.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Candidate, PlanOptions, suggestPlan } from "../src/lib/autoplan";

const week = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"];
const opts = (o: Partial<PlanOptions> = {}): PlanOptions => ({
  today: "2026-10-12", days: week, capacity: Object.fromEntries(week.map((d) => [d, 7.5])), load: {}, fillPct: 0.85, lookAheadDays: 60, ...o,
});
const c = (key: string, o: Partial<Candidate> = {}): Candidate => ({ key, kind: "job", hours: 2, urgent: false, held: false, waitingForRecords: false, ...o });

test("late first, then urgent, then nearest deadline; earliest day with room", () => {
  const { suggestions } = suggestPlan([
    c("later", { deadline: "2026-11-30" }),
    c("urgent", { deadline: "2026-12-15", urgent: true }),
    c("late", { deadline: "2026-09-30" }),
    c("soon", { deadline: "2026-10-20" }),
  ], opts());
  assert.deepEqual(suggestions.map((s) => s.key), ["late", "urgent", "soon", "later"]);
  // 6.375h of room a day: three 2h jobs on Monday, the fourth on Tuesday
  assert.deepEqual(suggestions.map((s) => s.day), ["2026-10-12", "2026-10-12", "2026-10-12", "2026-10-13"]);
  assert.deepEqual(suggestions.map((s) => s.reason), ["Late", "Urgent", "Next deadline", "Next deadline"]);
});

test("leaves out on hold, already planned, far-off and waiting-for-records work", () => {
  const { suggestions, skipped } = suggestPlan([
    c("held", { deadline: "2026-10-30", held: true }),
    c("planned", { deadline: "2026-10-30", planned: "2026-10-14" }),
    c("missed", { deadline: "2026-10-30", planned: "2026-10-01" }), // planned in the past: counts as unplanned
    c("far", { deadline: "2027-03-31" }),
    c("records", { deadline: "2026-10-30", waitingForRecords: true }),
    c("nodate", {}),
  ], opts());
  assert.deepEqual(suggestions.map((s) => s.key), ["missed"]);
  assert.deepEqual(skipped, [{ key: "records", reason: "Waiting for records" }]);
});

test("uses last year's slot when it's this week", () => {
  const { suggestions } = suggestPlan([c("vat", { deadline: "2026-11-07", suggestedSlot: "2026-10-15" })], opts());
  assert.deepEqual(suggestions[0], { key: "vat", day: "2026-10-15", reason: "Same time as last year" });
  // far-off work comes in if its slot from last year is this week
  assert.equal(suggestPlan([c("accs", { deadline: "2027-07-31", suggestedSlot: "2026-10-13" })], opts()).suggestions[0].day, "2026-10-13");
});

test("respects what's already planned, the fill level, deadlines and days already gone", () => {
  const { suggestions, skipped } = suggestPlan([
    c("a", { deadline: "2026-10-13", hours: 3 }),
    c("b", { deadline: "2026-10-13", hours: 3 }),
  ], opts({ today: "2026-10-13", load: { "2026-10-13": 4 } }));
  // Tuesday has 6.375 - 4 = 2.375h of room, Monday has gone, and both are due Tuesday
  assert.deepEqual(suggestions, []);
  assert.deepEqual(skipped.map((s) => s.reason), ["No room left this week", "No room left this week"]);
});

test("work bigger than a day goes on an empty day by itself", () => {
  const { suggestions } = suggestPlan([
    c("small", { deadline: "2026-10-20", hours: 1 }),
    c("big", { deadline: "2026-10-30", hours: 9.25 }),
  ], opts());
  assert.deepEqual(suggestions.map((s) => [s.key, s.day]), [["small", "2026-10-12"], ["big", "2026-10-13"]]);
  assert.match(suggestions[1].reason, /A full day's work/);
});
