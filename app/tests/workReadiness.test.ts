import test from "node:test";
import assert from "node:assert/strict";
import { Dependency } from "../src/lib/work/dependencies";
import { World, JobInfo, assess, chain, evaluate, integrity, splitHours, syncPlan, blockedTaskKeys } from "../src/lib/work/readiness";
import { readTask, WorkTask } from "../src/lib/work/model";

const dep = (o: Partial<Dependency>): Dependency => ({ key: "d" + Math.random(), prerequisite: { kind: "task", key: "a" }, dependent: { kind: "task", key: "b" }, type: "finish_to_start", outcome: "done", verificationRequired: false, status: "active", expectedCompletion: "", resolvedAt: "", resolvedBy: "", overrideReason: "", templateKey: "", created: "", createdBy: "", version: 1, ...o });
const task = (key: string, o: Record<string, unknown> = {}): WorkTask => readTask({ Key: key, Title: `Task ${key}`, Status: "Open", ...o });
const job = (key: string, o: Partial<JobInfo> = {}): JobInfo => ({ key, title: `Job ${key}`, status: "Open", stageNo: 1, stageCount: 5, onHold: false, ...o });
const world = (deps: Dependency[], tasks: WorkTask[] = [], jobs: JobInfo[] = [], verified: string[] = []): World => ({ deps, tasks: new Map(tasks.map((t) => [t.key, t])), jobs: new Map(jobs.map((j) => [j.key, j])), verified: (k) => verified.includes(k), stageName: (_j, s) => ["", "Records in", "Prepared", "Reviewed", "Approved", "Filed"][s] });

test("finish-to-start: blocked until prerequisite done", () => {
  const d = dep({});
  assert.equal(assess("task", "b", world([d], [task("a"), task("b")])).readiness, "blocked");
  assert.equal(assess("task", "b", world([d], [task("a", { Status: "Done" }), task("b")])).readiness, "ready");
});
test("information from the client: done but unchecked is not met (Scenario D)", () => {
  const d = dep({ type: "information", verificationRequired: true });
  const a = task("a", { OwnerType: "contact", Status: "Done" });
  assert.equal(evaluate(d, world([d], [a, task("b")])).state, "unmet");
  assert.equal(assess("task", "b", world([d], [a, task("b")], [], ["a"])).readiness, "ready");
});
test("stage dependency: names the stage in the reason (Scenario E)", () => {
  const d = dep({ prerequisite: { kind: "job", key: "acc", stage: 4 }, dependent: { kind: "job", key: "ct" }, type: "stage", outcome: "stage" });
  const w = world([d], [], [job("acc", { stageNo: 3 }), job("ct")]);
  assert.match(assess("job", "ct", w).reasons[0], /Job acc has not reached Approved/);
  assert.equal(assess("job", "ct", world([d], [], [job("acc", { stageNo: 4 }), job("ct")])).readiness, "ready");
});
test("partial: job stays partly ready until it reaches the held stage (Scenario F)", () => {
  const d = dep({ type: "partial", prerequisite: { kind: "task", key: "a" }, dependent: { kind: "job", key: "sa", stage: 4 } });
  const a1 = assess("job", "sa", world([d], [task("a")], [job("sa", { stageNo: 2 })]));
  assert.equal(a1.readiness, "partly_ready"); assert.deepEqual(a1.held, [4]);
  assert.equal(assess("job", "sa", world([d], [task("a")], [job("sa", { stageNo: 4 })])).readiness, "blocked");
});
test("outside-owned task is waiting, finished is complete, hold wins", () => {
  assert.equal(assess("task", "a", world([], [task("a", { OwnerType: "contact", Status: "Requested" })])).readiness, "waiting");
  assert.equal(assess("task", "a", world([], [task("a", { Status: "Done" })])).readiness, "complete");
  assert.equal(assess("job", "j", world([], [], [job("j", { onHold: true })])).readiness, "on_hold");
});
test("cancelled or missing prerequisites block and are never treated as met", () => {
  const d = dep({});
  assert.equal(evaluate(d, world([d], [task("a", { Status: "Cancelled" }), task("b")])).state, "conflict");
  assert.equal(evaluate(d, world([d], [task("b")])).state, "missing");
  assert.equal(assess("task", "b", world([d], [task("b")])).readiness, "blocked");
});
test("override counts as met; cancelled link ignored", () => {
  assert.equal(assess("task", "b", world([dep({ status: "overridden", overrideReason: "ok", resolvedBy: "k" })], [task("a"), task("b")])).readiness, "ready");
  assert.equal(assess("task", "b", world([dep({ status: "cancelled" })], [task("a"), task("b")])).readiness, "ready");
});
test("reopened prerequisite re-blocks and is flagged", () => {
  const d = dep({ status: "satisfied" });
  const w = world([d], [task("a", { Status: "Open" }), task("b")]);
  assert.equal(assess("task", "b", w).readiness, "blocked");
  assert.ok(integrity(w).some((i) => i.kind === "reopened"));
  const plan = syncPlan(w, { by: "k", now: "n", key: () => "e" });
  assert.equal(plan[0].dep.status, "active");
});
test("sync satisfies only when truly met", () => {
  const d = dep({ type: "information", verificationRequired: true });
  const a = task("a", { OwnerType: "contact", Status: "Done" });
  assert.equal(syncPlan(world([d], [a, task("b")]), { by: "k", now: "n", key: () => "e" }).length, 0);
  assert.equal(syncPlan(world([d], [a, task("b")], [], ["a"]), { by: "k", now: "n", key: () => "e" })[0].dep.status, "satisfied");
});
test("chain finds the earliest actionable step (Scenario K)", () => {
  const d1 = dep({ prerequisite: { kind: "task", key: "records" }, dependent: { kind: "job", key: "acc" } });
  const d2 = dep({ prerequisite: { kind: "job", key: "acc", stage: 4 }, dependent: { kind: "job", key: "ct" }, type: "stage", outcome: "stage" });
  const w = world([d1, d2], [task("records", { OwnerType: "contact", Status: "Requested" })], [job("acc"), job("ct")]);
  const c = chain("job", "ct", w);
  assert.deepEqual(c.nodes.map((n) => n.key), ["acc", "records"]);
  assert.deepEqual(c.earliest.map((n) => n.key), ["records"]);
});
test("chain survives a legacy cycle", () => {
  const w = world([dep({ prerequisite: { kind: "task", key: "a" }, dependent: { kind: "task", key: "b" } }), dep({ prerequisite: { kind: "task", key: "b" }, dependent: { kind: "task", key: "a" } })], [task("a"), task("b")]);
  assert.ok(chain("task", "a", w).nodes.length <= 2);
  assert.ok(integrity(w).some((i) => i.kind === "cycle"));
});
test("hours split: eight-hour job (Scenario: partial readiness)", () => {
  const hrs = new Map([[2, 2], [3, 3], [4, 3]]);
  assert.deepEqual(splitHours(5, hrs, [4], 2), { actionable: 3.12, blocked: 1.88, split: true });
  assert.equal(splitHours(5, new Map(), [4], 2).split, false);
  assert.deepEqual(splitHours(5, hrs, [], 2), { actionable: 5, blocked: 0, split: true });
});
test("integrity: past held stage, missing, dup", () => {
  const d = dep({ type: "partial", dependent: { kind: "job", key: "sa", stage: 2 } });
  const w = world([d, { ...d, key: "dup" }], [task("a")], [job("sa", { stageNo: 3 })]);
  const kinds = integrity(w).map((i) => i.kind);
  assert.ok(kinds.includes("past-held") && kinds.includes("duplicate"));
  assert.ok(integrity(world([dep({})], [task("b")])).some((i) => i.kind === "missing"));
});
test("blockedTaskKeys feeds the task lists", () => {
  assert.deepEqual([...blockedTaskKeys(world([dep({})], [task("a"), task("b")]))], ["b"]);
});
