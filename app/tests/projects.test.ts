import assert from "node:assert/strict";
import { test } from "node:test";
import { Task } from "../src/lib/domain";
import { categoryOf, isBusinessTask, lastMoved, nextAction, progressOf, projectAttention, sortProjects, statusOf, tasksOf } from "../src/lib/projects";
import { Row } from "../src/lib/schema";

const P = (o: Row = {}): Row => ({ Key: "P1", Title: "New website", Status: "Active", Touched: "2026-10-20", ...o });
const T = (o: Partial<Task> = {}): Task => ({ Key: "T" + Math.random(), Title: "x", ProjectKey: "P1", Status: "Open", ...o } as Task);

test("a task belongs to the business when it has a project", () => {
  assert.equal(isBusinessTask({ ProjectKey: "P1" }), true);
  assert.equal(isBusinessTask({ ProjectKey: "" }), false);
  assert.equal(isBusinessTask({}), false);
  assert.equal(tasksOf(P(), [T(), T({ ProjectKey: "P2" }), T({ ProjectKey: undefined })]).length, 1);
});

test("categories and statuses fall back sensibly", () => {
  assert.equal(categoryOf({ Category: "marketing" }).name, "Marketing");
  assert.equal(categoryOf({ Category: "nonsense" }).key, "other");
  assert.equal(categoryOf({}).key, "other");
  assert.equal(statusOf({}), "Active");
  assert.equal(statusOf({ Status: "Done" }), "Done");
  assert.equal(statusOf({ Status: "whatever" }), "Active");
});

test("progress counts done and open tasks and ignores cancelled ones", () => {
  const tasks = [T({ Status: "Done" }), T({ Status: "Done" }), T(), T({ Status: "Cancelled" }), T({ ProjectKey: "P9" })];
  assert.deepEqual(progressOf(P(), tasks), { done: 2, open: 1, total: 3 });
});

test("the next action is the soonest planned task, else the first open one", () => {
  const a = T({ Title: "a", PlannedDate: "2026-11-05" }), b = T({ Title: "b", PlannedDate: "2026-11-02" }), c = T({ Title: "c" });
  assert.equal(nextAction(P(), [a, b, c])?.Title, "b");
  assert.equal(nextAction(P(), [c])?.Title, "c");
  assert.equal(nextAction(P(), [T({ Status: "Done" })]), undefined);
  assert.equal(nextAction(P(), [T({ Status: "On hold", Title: "held" }), c])?.Title, "c");
});

test("a project last moved when it was edited or a task was finished", () => {
  assert.equal(lastMoved(P(), []), "2026-10-20");
  assert.equal(lastMoved(P(), [T({ Status: "Done", CompletedDate: "2026-10-22" })]), "2026-10-22");
  assert.equal(lastMoved(P({ Touched: undefined }), []), "");
});

test("projects needing a look, most serious reason first", () => {
  const today = "2026-10-23";
  const planned = T({ PlannedDate: "2026-10-28" });
  assert.equal(projectAttention(P(), [planned], today), null);
  assert.match(projectAttention(P({ TargetDate: "2026-10-01" }), [planned], today)!.text, /^Past its target date \(1 Oct\)$/);
  assert.equal(projectAttention(P({ TargetDate: "2026-10-01" }), [planned], today)!.level, "red");
  assert.match(projectAttention(P(), [], today)!.text, /No next step/);
  assert.match(projectAttention(P({ Touched: "2026-10-01" }), [planned], today)!.text, /^Not touched for 22 days$/);
  assert.match(projectAttention(P({ TargetDate: "2026-11-10" }), [T()], today)!.text, /Due soon, and nothing is planned/);
  assert.equal(projectAttention(P({ TargetDate: "2027-03-01" }), [T()], today), null); // far off and not stale
  assert.equal(projectAttention(P({ Status: "On hold", TargetDate: "2026-01-01" }), [], today), null);
  assert.equal(projectAttention(P({ Status: "Done" }), [], today), null);
});

test("projects sort active first by target date", () => {
  const list = sortProjects([P({ Key: "d", Title: "d", Status: "Done" }), P({ Key: "b", Title: "b", TargetDate: "2026-12-01" }), P({ Key: "h", Title: "h", Status: "On hold" }), P({ Key: "a", Title: "a", TargetDate: "2026-11-01" }), P({ Key: "n", Title: "n" })]);
  assert.deepEqual(list.map((p) => p.Key), ["a", "b", "n", "h", "d"]);
});
