// Phase 10: migration, safety and performance checks across the whole task / dependency / planning area.
import test from "node:test";
import assert from "node:assert/strict";
import { readTask } from "../src/lib/work/model";
import { changeTask, bulkChange } from "../src/lib/work/tasks";
import { Dependency } from "../src/lib/work/dependencies";
import { World, assess, chain, integrity, syncPlan } from "../src/lib/work/readiness";
import { Facts, Risk, risk, touchesDeadline, impacts } from "../src/lib/work/risk";
import { buildItems, counts, heatmap, workload as heat, columns } from "../src/lib/work/overview";
import { reminders, newlyUnblocked } from "../src/lib/work/planning";
import { taskCompletion, clientActions, dependencies as depReport, workload, planningReliability } from "../src/lib/work/reports";
import { spawnNext } from "../src/lib/work/recurrence";

type Row = Record<string, unknown>;
const TODAY = "2026-11-11";
const hoursOn = (d: string) => { const w = new Date(`${d}T00:00:00Z`).getUTCDay(); return w >= 1 && w <= 5 ? 7.5 : 0; };
const dep = (i: number, pre: Dependency["prerequisite"], dependent: Dependency["dependent"], o: Partial<Dependency> = {}): Dependency => ({ key: `d${i}`, prerequisite: pre, dependent, type: "finish_to_start", outcome: "done", verificationRequired: false, status: "active", expectedCompletion: "", resolvedAt: "", resolvedBy: "", overrideReason: "", templateKey: "", version: 1, ...o } as Dependency);
const world = (jobs: Row[], tasks: Row[], deps: Dependency[]): World => ({ deps, tasks: new Map(tasks.map((t) => [String(t.Key), readTask(t)])), jobs: new Map(jobs.map((j) => [String(j.Key), { key: String(j.Key), title: String(j.Title), status: String(j.Status || "Open"), stageNo: 1, stageCount: 3, onHold: false, clientKey: String(j.ClientKey), deadline: String(j.Deadline || "") }])), verified: () => false });

// ------------------------------------------------------------ migration: records from before any of this existed
const LEGACY_TASKS: Row[] = [
  { Key: "old1", Title: "Chase P60s", Status: "Open", DueDate: "2026-11-05", AssignedUser: "kevin", ClientKey: "c1" },
  { Key: "old2", Title: "Tidy files", Status: "Done", CompletedDate: "2026-10-30", Subtasks: JSON.stringify([{ t: "a", d: true }]) },
  { Key: "old3", Title: "", Status: "", DueDate: "not a date" },
];
test("migration: tasks with none of the new columns still read, change and report", () => {
  for (const r of LEGACY_TASKS) { const t = readTask(r); assert.equal(typeof t.version, "number"); assert.ok(t.version >= 0); assert.equal(t.ownerType, "user"); }
  const c = changeTask(LEGACY_TASKS, "old1", { priority: "high" }, { user: "k", now: "2026-11-11T09:00:00Z" }) as { patch: Row };
  assert.equal(c.patch.Priority, "high"); assert.equal(c.patch.Version, readTask(LEGACY_TASKS[0]).version + 1);
  const w = world([], LEGACY_TASKS, []);
  assert.equal(assess("task", "old1", w).readiness, "ready");
  assert.doesNotThrow(() => { taskCompletion(LEGACY_TASKS.map(readTask), { from: "2026-10-01", to: "2026-11-30" }, TODAY); clientActions(LEGACY_TASKS.map(readTask), [], { from: "2026-10-01", to: "2026-11-30" }, TODAY); reminders({ tasks: LEGACY_TASKS.map(readTask), events: [], deps: [], world: w, today: TODAY, names: () => "" }); });
});
test("migration: a legacy task with no repeat rule never spawns anything", () => {
  assert.equal(spawnNext({ ...LEGACY_TASKS[1], Status: "Done" }, LEGACY_TASKS, { now: "x", today: TODAY, key: () => "n" }).row, undefined);
});

// ------------------------------------------------------------ safety
test("statutory deadlines are never in any patch, whatever is changed", () => {
  const rows: Row[] = [{ Key: "t", Title: "x", Status: "Open", Version: 1 }];
  const specs = [{ status: "Done" }, { due: "2026-12-01" }, { target: "2026-12-01" }, { followUp: "2026-12-02" }, { repeat: "weekly:mon" }, { owner: "a" }, { status: "Cancelled" }] as const;
  for (const sp of specs) { const c = changeTask(rows, "t", sp as never, { user: "u", now: "2026-11-11T00:00:00Z" }) as { patch?: Row }; if (c.patch) assert.equal(touchesDeadline(c.patch), false, JSON.stringify(sp)); }
  const b = bulkChange(rows, ["t"], { status: "Done" }, { user: "u", now: "x" }); for (const c of b.changes) assert.equal(touchesDeadline(c.patch), false);
  const s = spawnNext({ Key: "r", Title: "x", Status: "Done", RecurrenceRule: "weekly:mon", DueDate: "2026-11-09", Deadline: "2026-12-31" }, [], { now: "x", today: TODAY, key: () => "n" });
  assert.equal(s.row?.Deadline, undefined); assert.equal(s.row?.CHDeadline, undefined);
});
test("cycles and self-dependencies terminate and are reported", () => {
  const tasks: Row[] = ["a", "b", "c"].map((k) => ({ Key: k, Title: k, Status: "Open" }));
  const deps = [dep(1, { kind: "task", key: "a" }, { kind: "task", key: "b" }), dep(2, { kind: "task", key: "b" }, { kind: "task", key: "c" }), dep(3, { kind: "task", key: "c" }, { kind: "task", key: "a" }), dep(4, { kind: "task", key: "a" }, { kind: "task", key: "a" })];
  const w = world([], tasks, deps);
  assert.doesNotThrow(() => { for (const k of ["a", "b", "c"]) { assess("task", k, w); chain("task", k, w); } syncPlan(w, { by: "u", now: "x", key: () => "k" }); });
  assert.ok(integrity(w).some((i) => i.kind === "cycle"));
});
test("personal and private tasks appear in no Phase 9 output", () => {
  const priv = [readTask({ Key: "p1", Title: "Dentist", Area: "personal", Status: "Open", DueDate: "2026-11-01", Created: "2026-11-02T00:00:00Z" }), readTask({ Key: "p2", Title: "Salary", PrivacyLevel: "private", Status: "Done", CompletedDate: "2026-11-05", Created: "2026-11-01T00:00:00Z" })];
  const P = { from: "2026-11-01", to: "2026-11-30" };
  assert.equal(reminders({ tasks: priv, events: [], deps: [], world: world([], [], []), today: TODAY, names: () => "" }).length, 0);
  const g = taskCompletion(priv, P, TODAY); for (const m of g.metrics) if (m.unit === "count") assert.equal(m.value, 0, m.key);
  const items = buildItems({ jobs: [], tasks: [{ Key: "p1", Area: "personal", Status: "Open" }, { Key: "p2", PrivacyLevel: "private", Status: "Open" }], world: world([], [], []), risks: new Map(), facts: new Map(), today: TODAY, user: "k", ownerOfJob: () => "", groupsOf: () => [], importanceOf: () => "", hoursOnJob: () => 0 });
  assert.equal(items.length, 0);
});
test("a prerequisite expected date that has passed is a reminder, never a changed deadline", () => {
  const w = world([{ Key: "j", Title: "VAT", ClientKey: "c", Deadline: "2026-12-01" }], [{ Key: "p", Title: "Records", Status: "Open", OwnerType: "contact" }], [dep(1, { kind: "task", key: "p" }, { kind: "job", key: "j" }, { expectedCompletion: "2026-11-05" })]);
  const r = reminders({ tasks: [], events: [], deps: w.deps, world: w, today: TODAY, names: () => "" });
  assert.equal(r.length, 1); assert.equal(r[0].kind, "dependency_followup"); assert.equal(w.jobs.get("j")!.deadline, "2026-12-01");
});

// ------------------------------------------------------------ performance: a large practice
function big(nJobs: number, nTasks: number) {
  const jobs: Row[] = Array.from({ length: nJobs }, (_, i) => ({ Key: `j${i}`, Title: `Job ${i}`, ClientKey: `c${i % 400}`, ServiceKey: `S${i % 8}`, Status: "Open", Deadline: `2026-${String(11 + (i % 2)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}` }));
  const tasks: Row[] = Array.from({ length: nTasks }, (_, i) => ({ Key: `t${i}`, Title: `Task ${i}`, ClientKey: `c${i % 400}`, Status: i % 7 === 0 ? "Done" : "Open", OwnerType: i % 5 === 0 ? "contact" : "user", EstimateMinutes: 30 + (i % 6) * 15, DueDate: `2026-11-${String(1 + (i % 28)).padStart(2, "0")}`, CompletedDate: i % 7 === 0 ? "2026-11-05" : "", Created: "2026-10-20T09:00:00Z" }));
  const deps: Dependency[] = Array.from({ length: Math.floor(nTasks * 0.6) }, (_, i) => dep(i, { kind: "task", key: `t${i}` }, i % 3 ? { kind: "task", key: `t${(i + 1) % nTasks}` } : { kind: "job", key: `j${i % nJobs}` }));
  return { jobs, tasks, deps };
}
test("performance: 2,000 jobs, 8,000 tasks and 4,800 dependencies are assessed and reported within seconds", () => {
  const { jobs, tasks, deps } = big(2000, 8000);
  const w = world(jobs, tasks, deps); const t0 = Date.now();
  const facts = new Map<string, Facts>(), risks = new Map<string, Risk>();
  for (const j of jobs) { const a = assess("job", String(j.Key), w); const f: Facts = { key: String(j.Key), title: String(j.Title), clientKey: String(j.ClientKey), deadline: String(j.Deadline), internalTarget: "", clientAgreed: "", planned: "", remaining: 4, actionable: 4, complete: false }; facts.set(f.key, f); risks.set(f.key, risk(f, a, TODAY, hoursOn)); }
  const t1 = Date.now();
  const items = buildItems({ jobs, tasks, world: w, risks, facts, today: TODAY, user: "k", ownerOfJob: () => "k", groupsOf: () => [], importanceOf: () => "normal", hoursOnJob: () => 0 });
  const t2 = Date.now();
  counts(items); heatmap(items, (k) => k, "risk"); heat({ metric: "remaining", rowBy: "client", items, sessions: [], entries: [], cols: columns("week", TODAY, 8), today: TODAY }); impacts(w, facts, risks);
  const t3 = Date.now();
  const ts = tasks.map(readTask); const P = { from: "2026-11-01", to: "2026-11-30" };
  taskCompletion(ts, P, TODAY); clientActions(ts, [], P, TODAY); depReport({ deps, depEvents: [], items, titleOf: () => "" }, P); planningReliability([], P, TODAY); workload({ items, sessions: [], capacityPerDay: () => 7, days: [TODAY], today: TODAY, clientName: (k) => k, userName: (k) => k });
  reminders({ tasks: ts, events: [], deps, world: w, today: TODAY, names: (k) => k }); newlyUnblocked(w, [], "2026-11-11T00:00:00Z", 3, () => "");
  const t4 = Date.now();
  console.log(`# perf ms: assess+risk ${t1 - t0}, items ${t2 - t1}, overview ${t3 - t2}, reports+reminders ${t4 - t3}`);
  assert.ok(t1 - t0 < 4000, `assess+risk took ${t1 - t0}ms`); assert.ok(t2 - t1 < 4000, `items ${t2 - t1}ms`); assert.ok(t3 - t2 < 4000, `overview ${t3 - t2}ms`); assert.ok(t4 - t3 < 4000, `reports ${t4 - t3}ms`);
});
test("performance: a long dependency chain does not blow the stack or hang", () => {
  const n = 3000; const tasks: Row[] = Array.from({ length: n }, (_, i) => ({ Key: `t${i}`, Title: `t${i}`, Status: "Open" }));
  const deps = Array.from({ length: n - 1 }, (_, i) => dep(i, { kind: "task", key: `t${i}` }, { kind: "task", key: `t${i + 1}` }));
  const w = world([], tasks, deps); const t0 = Date.now();
  assert.equal(assess("task", `t${n - 1}`, w).readiness, "blocked"); const c = chain("task", `t${n - 1}`, w);
  assert.ok(c.nodes.length <= 100, "the chain view is bounded"); assert.ok(Date.now() - t0 < 3000);
});
