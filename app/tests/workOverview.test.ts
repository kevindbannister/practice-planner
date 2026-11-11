import test from "node:test";
import assert from "node:assert/strict";
import { Dependency } from "../src/lib/work/dependencies";
import { World, assess } from "../src/lib/work/readiness";
import { Facts, Risk, risk } from "../src/lib/work/risk";
import { buildItems, counts, heatmap, drill, filterItems, columns, workload, METRICS, inColumn, cellText, Item } from "../src/lib/work/overview";
import { readTask } from "../src/lib/work/model";

const TODAY = "2026-11-11";
const hoursOn = (d: string) => { const w = new Date(`${d}T00:00:00Z`).getUTCDay(); return w >= 1 && w <= 5 ? 7.5 : 0; };
const dep = (o: Partial<Dependency>): Dependency => ({ key: "d" + Math.random(), prerequisite: { kind: "task", key: "rec" }, dependent: { kind: "job", key: "j2" }, type: "finish_to_start", outcome: "done", verificationRequired: false, status: "active", expectedCompletion: "", resolvedAt: "", resolvedBy: "", overrideReason: "", templateKey: "", created: "", createdBy: "", version: 1, ...o });
function setup(jobs: Row[], tasks: Row[], deps: Dependency[] = [], hours: Record<string, number> = {}) {
  const world: World = { deps, tasks: new Map(tasks.map((t) => [String(t.Key), readTask(t)])), jobs: new Map(jobs.map((j) => [String(j.Key), { key: String(j.Key), title: String(j.Title), status: String(j.Status || "Open"), stageNo: Number(j.StageNo) || 1, stageCount: 5, onHold: j.Status === "On hold" }])), verified: () => false };
  const facts = new Map<string, Facts>(), risks = new Map<string, Risk>();
  for (const j of jobs) { const f: Facts = { key: String(j.Key), title: String(j.Title), clientKey: String(j.ClientKey), deadline: String(j.Deadline || ""), internalTarget: "", clientAgreed: "", planned: "", remaining: Number(j.rem ?? 4), actionable: Number(j.act ?? j.rem ?? 4), complete: false }; facts.set(f.key, f); risks.set(f.key, risk(f, assess("job", f.key, world), TODAY, hoursOn)); }
  return buildItems({ jobs, tasks, world, risks, facts, today: TODAY, user: "kevin", ownerOfJob: () => "kevin", groupsOf: () => [], importanceOf: () => "normal", hoursOnJob: (k) => hours[k] || 0 });
}
type Row = Record<string, unknown>;
const J = (key: string, o: Row = {}): Row => ({ Key: key, Title: `Job ${key}`, ClientKey: "c1", ServiceKey: "VAT", Status: "Open", Deadline: "2026-12-20", ...o });
const T = (key: string, o: Row = {}): Row => ({ Key: key, Title: `Task ${key}`, ClientKey: "c1", Status: "Open", ...o });

test("a job is one item however it is planned; jobs and tasks are counted apart", () => {
  const items = setup([J("j1"), J("j2", { Deadline: "2026-11-01" })], [T("t1"), T("t2", { OwnerType: "contact", Status: "Requested" }), T("t3", { Status: "Done", CompletedDate: "2026-11-05" })]);
  const c = counts(items, { from: "2026-11-01", to: "2026-11-30" });
  assert.equal(c.jobs.open, 2); assert.equal(c.tasks.open, 2); assert.equal(c.jobs.overdue, 1); assert.equal(c.tasks.waitingClient, 1); assert.equal(c.tasks.completed, 1); assert.equal(c.jobs.completed, 0);
  assert.equal(c.jobs.ready, 2);
});
test("blocked, waiting and in progress states", () => {
  const items = setup([J("j1"), J("j2", { Status: "On hold", HoldKind: "Client" }), J("j3", { StageNo: 2 }), J("j4")], [T("rec", { OwnerType: "contact", Status: "Requested" })], [dep({ dependent: { kind: "job", key: "j4" } })], { j1: 2 });
  const st = Object.fromEntries(items.map((i) => [i.key, i.state]));
  assert.deepEqual([st.j1, st.j2, st.j3, st.j4, st.rec], ["in_progress", "waiting", "in_progress", "blocked", "waiting"]);
  assert.equal(items.find((i) => i.key === "j2")!.waitingClient, true);
});
test("private and personal tasks never appear", () => {
  const items = setup([], [T("a", { PrivacyLevel: "private" }), T("b", { Area: "personal" }), T("c")]);
  assert.deepEqual(items.map((i) => i.key), ["c"]);
});
test("heatmap cells drill down to the underlying items, with sorting", () => {
  const items = setup([J("j1", { ClientKey: "c1", Deadline: "2026-11-01" }), J("j2", { ClientKey: "c2" })], [T("t1", { ClientKey: "c2", DueDate: "2026-11-02" })]);
  const rows = heatmap(items, (k) => k);
  assert.equal(rows[0].clientKey, "c1"); // overdue job is the worst risk
  assert.deepEqual(drill(rows[0], "overdue").map((i) => i.key), ["j1"]);
  const c2 = rows.find((r) => r.clientKey === "c2")!;
  assert.equal(cellText(c2.cells.ready), "1 job, 1 task"); assert.equal(cellText(c2.cells.overdue), "1 task");
  assert.deepEqual(heatmap(items, (k) => k, "name").map((r) => r.clientKey), ["c1", "c2"]);
});
test("filters: user, service, period", () => {
  const items = setup([J("j1", { ServiceKey: "VAT", Deadline: "2026-11-20" }), J("j2", { ServiceKey: "ACC", Deadline: "2027-02-01" })], [T("t1")]);
  assert.deepEqual(filterItems(items, { service: "ACC" }).map((i) => i.key), ["j2"]);
  assert.deepEqual(filterItems(items, { period: { from: "2026-11-01", to: "2026-11-30" } }).map((i) => i.key).sort(), ["j1", "t1"]);
  assert.equal(filterItems(items, { user: "nobody" }).length, 0);
});
test("columns", () => {
  assert.equal(columns("week", "2026-11-11", 4)[0].from, "2026-11-09");
  assert.equal(columns("month", "2026-11-11", 3)[1].from, "2026-12-01");
  assert.deepEqual(columns("day", "2026-11-13", 3).map((c) => c.from), ["2026-11-13", "2026-11-16", "2026-11-17"]);
});
test("planned (current) excludes moved and finished sessions; history keeps them; actual only from entries", () => {
  const cols = columns("week", "2026-11-09", 2);
  const sessions = [{ itemKey: "j1", clientKey: "c1", userKey: "kevin", date: "2026-11-10", minutes: 120, status: "rescheduled" }, { itemKey: "j1", clientKey: "c1", userKey: "kevin", date: "2026-11-17", minutes: 120, status: "planned" }, { itemKey: "j2", clientKey: "c1", userKey: "kevin", date: "2026-11-11", minutes: 60, status: "completed" }, { itemKey: "j3", clientKey: "c1", userKey: "kevin", date: "2026-11-11", minutes: 60, status: "cancelled" }];
  const base = { rowBy: "client" as const, items: [], sessions, entries: [{ clientKey: "c1", user: "kevin", date: "2026-11-11", minutes: 90 }], cols, today: TODAY };
  assert.deepEqual(workload({ ...base, metric: "planned" }).rows[0].cells, [0, 2]);
  assert.deepEqual(workload({ ...base, metric: "planned_history" }).rows[0].cells, [3, 2]);
  assert.deepEqual(workload({ ...base, metric: "actual" }).rows[0].cells, [1.5, 0]);
  // ticking a task off records no time
  const items = setup([], [T("t1", { Status: "Done" })]);
  assert.equal(workload({ ...base, items, metric: "actual", entries: [] }).rows.length, 0);
});
test("due-based metrics: earlier, later and no-date columns; blocked and overdue hours", () => {
  const items = setup([J("j1", { Deadline: "2026-11-01", rem: 3 }), J("j2", { Deadline: "2027-05-01", rem: 5 }), J("j3", { Deadline: "", rem: 2 }), J("j4", { Deadline: "2026-11-12", rem: 4, act: 0 })], [T("rec", { OwnerType: "contact", Status: "Requested" })], [dep({ dependent: { kind: "job", key: "j4" } })]);
  const base = { rowBy: "client" as const, items, sessions: [], entries: [], cols: columns("week", "2026-11-09", 2), today: TODAY };
  const rem = workload({ ...base, metric: "remaining" });
  assert.deepEqual(rem.cols.map((c) => c.key).slice(0, 1).concat(rem.cols.slice(-2).map((c) => c.key)), ["earlier", "later", "none"]);
  assert.deepEqual(rem.rows[0].cells, [3, 4, 0, 5, 2]);
  assert.equal(workload({ ...base, metric: "overdue" }).rows[0].total, 3);
  assert.equal(workload({ ...base, metric: "blocked" }).rows[0].total, 4);
  assert.equal(workload({ ...base, metric: "open_tasks" }).rows[0].total, 1); // tasks only
  assert.ok(METRICS.every((m) => m.note.length > 10));
});
test("at-risk column and inColumn", () => {
  const items = setup([J("j1", { Deadline: "2026-11-13", rem: 20 })], []);
  assert.equal(inColumn(items[0], "at_risk"), true); assert.equal(inColumn(items[0], "overdue"), false);
});
