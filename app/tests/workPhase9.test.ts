import test from "node:test";
import assert from "node:assert/strict";
import { suggestPlan, Candidate } from "../src/lib/autoplan";
import { plannable, timeRule, usesCapacity, reminders, newlyUnblocked } from "../src/lib/work/planning";
import { taskCompletion, clientActions, planningReliability, workload, dependencies } from "../src/lib/work/reports";
import { readTask } from "../src/lib/work/model";
import { World } from "../src/lib/work/readiness";

const T = (o: Record<string, unknown>) => readTask({ Key: "t", Title: "x", Status: "Open", OwnerType: "user", Area: "practice", Created: "2026-11-01T09:00:00Z", ...o });
const opts = { today: "2026-11-09", days: ["2026-11-09", "2026-11-10", "2026-11-11"], capacity: { "2026-11-09": 8, "2026-11-10": 8, "2026-11-11": 8 }, load: {}, fillPct: 0.85, lookAheadDays: 60 };
const C = (o: Partial<Candidate>): Candidate => ({ key: "k", kind: "job", hours: 4, urgent: false, held: false, waitingForRecords: false, deadline: "2026-11-12", ...o });

test("planner: blocked work is listed with its reason, never scheduled; partly ready is planned for its available hours only", () => {
  const r = suggestPlan([C({ key: "a", blocked: "Blocked: bookkeeping not done" }), C({ key: "b", hours: 6, actionableHours: 2 }), C({ key: "c" })], opts);
  assert.deepEqual(r.skipped.filter((s) => s.key === "a").map((s) => s.reason), ["Blocked: bookkeeping not done"]);
  assert.ok(!r.suggestions.some((s) => s.key === "a"));
  assert.match(r.suggestions.find((s) => s.key === "b")!.reason, /Available part only \(2h of 6h\)/);
});
test("plannable: client-owned work uses no capacity; blocked is flagged", () => {
  const a = { readiness: "blocked", reasons: ["Waiting for records"], blockers: [], held: [], unknownDates: [] } as never;
  assert.match(plannable(a, 3, 0).blocked!, /Waiting for records/);
  assert.ok(plannable({ readiness: "ready" } as never, 2, undefined, T({ OwnerType: "contact" })).clientOwned);
  assert.deepEqual(plannable({ readiness: "partly_ready" } as never, 6, 2), { hours: 2, actionableHours: 2, partial: true });
});
test("timesheet: client tasks take no staff time but chase time is allowed; personal is outside practice time", () => {
  const client = T({ OwnerType: "contact" });
  assert.equal(timeRule(client).allowed, false); assert.equal(timeRule(client, true).allowed, true); assert.equal(timeRule(client, true).chase, true);
  assert.equal(timeRule(T({ Area: "personal" })).practiceTime, false); assert.equal(usesCapacity(client), false); assert.equal(usesCapacity(T({})), true);
});
const none = { deps: [], tasks: new Map(), jobs: new Map(), verified: () => false } as unknown as World;
const ev = (taskKey: string, type: string, at: string) => ({ key: type + at, taskKey, type, at, by: "u", before: "", after: "", reason: "" }) as never;
test("reminders: cadence respected, escalation after repeated chases, nothing for personal or when already escalated", () => {
  const t = T({ Key: "c1", OwnerType: "contact", Status: "Requested", DueDate: "2026-11-08" });
  const base = { tasks: [t], deps: [], world: none, today: "2026-11-10", names: () => "Acme" };
  assert.equal(reminders({ ...base, events: [] })[0].suggest, "log_call");
  assert.equal(reminders({ ...base, events: [ev("c1", "chase-portal", "2026-11-09T10:00:00Z")] }).length, 0); // chased yesterday
  assert.equal(reminders({ ...base, events: [ev("c1", "chase-portal", "2026-11-05T10:00:00Z")] })[0].suggest, "send_reminder");
  const many = [1, 2, 3].map((n) => ev("c1", "chase-email", `2026-11-0${n}T10:00:00Z`));
  assert.equal(reminders({ ...base, events: many })[0].suggest, "escalate");
  assert.equal(reminders({ ...base, events: [...many, ev("c1", "escalated", "2026-11-04T10:00:00Z")] }).length, 0);
  assert.equal(reminders({ ...base, tasks: [T({ Key: "p", Area: "personal", DueDate: "2026-11-01" })], events: [] }).length, 0);
  assert.equal(reminders({ ...base, tasks: [T({ Key: "o", DueDate: "2026-11-01" })], events: [] })[0].kind, "overdue");
});
test("newly unblocked: only work that is now ready, only recent, only once", () => {
  const dep = { key: "d1", prerequisite: { kind: "task", key: "p" }, dependent: { kind: "task", key: "q" }, type: "finish_to_start", outcome: "done", verificationRequired: false, status: "satisfied", expectedCompletion: "", version: 1 } as never;
  const w = { deps: [dep], tasks: new Map([["p", T({ Key: "p", Title: "Bank feeds", Status: "Done" })], ["q", T({ Key: "q", Title: "Reconcile" })]]), jobs: new Map(), verified: () => true } as unknown as World;
  const e = { key: "e", dependencyKey: "d1", type: "satisfy", at: "2026-11-09T10:00:00Z", by: "u", before: "", after: "", reason: "" } as never;
  const r = newlyUnblocked(w, [e, e], "2026-11-10T10:00:00Z", 3, () => "kevin");
  assert.equal(r.length, 1); assert.equal(r[0].owner, "kevin"); assert.match(r[0].because, /Bank feeds/);
  assert.equal(newlyUnblocked(w, [e], "2026-11-20T10:00:00Z", 3, () => "k").length, 0);
});
const P = { from: "2026-11-01", to: "2026-11-30" };
test("reports: facts counted, personal excluded, unknowns reported not invented", () => {
  const tasks = [T({ Key: "a", Status: "Done", CompletedDate: "2026-11-05T09:00:00Z", Created: "2026-11-03T09:00:00Z", DueDate: "2026-11-04" }), T({ Key: "b", DueDate: "2026-11-02" }), T({ Key: "p", Area: "personal", DueDate: "2026-11-02" })];
  const g = taskCompletion(tasks, P, "2026-11-10"); const m = (k: string) => g.metrics.find((x) => x.key === k)!;
  assert.equal(m("created").value, 3 - 1); assert.equal(m("completed").value, 1); assert.equal(m("overdue").value, 1); assert.equal(m("avg_days").value, 2); assert.equal(m("late_pct").value, 100); assert.equal(m("created").basis, "fact");
  const cl = clientActions([T({ Key: "c", OwnerType: "contact", Status: "Submitted", DueDate: "2026-11-01" }), T({ Key: "d", OwnerType: "contact", Status: "Requested" })], [ev("c", "shared", "2026-11-02T09:00:00Z"), ev("c", "client-submitted", "2026-11-05T09:00:00Z"), ev("d", "shared", "2026-11-02T09:00:00Z"), ev("d", "chase-portal", "2026-11-06T09:00:00Z")], P, "2026-11-10");
  const c = (k: string) => cl.metrics.find((x) => x.key === k)!;
  assert.equal(c("outstanding").value, 2); assert.equal(c("awaiting").value, 1); assert.equal(c("response").value, 3); assert.equal(c("response").unknown, 1); assert.equal(c("reminders").value, 1);
});
test("planning reliability counts moved sessions on the original day; workload separates estimate, fact and projection", () => {
  const S = (o: Record<string, unknown>) => ({ key: "s", kind: "task", itemKey: "i", clientKey: "c", title: "", userKey: "u", date: "2026-11-03", start: "", minutes: 60, actualMinutes: 0, status: "completed", ...o }) as never;
  const g = planningReliability([S({}), S({ status: "rescheduled" }), S({ status: "planned" }), S({ status: "cancelled" })], P, "2026-11-10");
  const m = (k: string) => g.metrics.find((x) => x.key === k)!; assert.equal(m("planned").value, 3); assert.equal(m("rescheduled").value, 1); assert.equal(m("missed").value, 1); assert.equal(m("completed_pct").value, 33);
  const it = { kind: "task", key: "i1", clientKey: "c", state: "ready", remaining: 4, held: 0, ownerType: "user", partly: false, risk: "on_track" } as never;
  const w = workload({ items: [it], sessions: [S({ status: "planned", date: "2026-11-12", itemKey: "i1" })], capacityPerDay: () => 7, days: ["2026-11-10", "2026-11-11", "2026-11-12"], today: "2026-11-10", clientName: (k) => k, userName: (k) => k });
  const v = (k: string) => w.metrics.find((x) => x.key === k)!; assert.equal(v("unscheduled").value, 0); assert.equal(v("planned").value, 1); assert.equal(v("headroom").basis, "projection"); assert.equal(v("capacity").value, 21);
  assert.ok(dependencies({ deps: [], depEvents: [], items: [], titleOf: () => "" }, P).metrics.length > 3);
});
