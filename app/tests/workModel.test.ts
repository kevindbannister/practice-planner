import test from "node:test";
import assert from "node:assert/strict";
import { areaOf, bulkCaptureKeys, canMove, isFinished, newTaskRow, notYetCreated, readTask, splitBulk } from "../src/lib/work/model";
import { Dependency, Known, createsCycle, dependencyRow, missingPrerequisites, readDependency, transition, validateDependency } from "../src/lib/work/dependencies";
import { canSee, countsTowardPractice, portalVisible, portalView, visibleTo } from "../src/lib/work/privacy";
import { planMigration, rollbackFor } from "../src/lib/work/migrate";

const ctx = { user: "kev@x.co", now: "2026-11-11T09:00:00Z", key: "T1" };

test("quick add needs only a title and lands in the Inbox", () => {
  const r = newTaskRow({ title: "  Call   director " }, ctx).row!;
  assert.equal(r.Title, "Call director"); assert.equal(r.Area, "inbox"); assert.equal(r.Status, "Open"); assert.equal(r.AssignedUser, ctx.user); assert.equal(r.ClientKey, ""); assert.equal(r.DueDate, "");
  assert.ok(newTaskRow({ title: "   " }, ctx).error); assert.ok(newTaskRow({ title: "x".repeat(301) }, ctx).error);
});
test("context decides the area; personal is private by default", () => {
  assert.equal(newTaskRow({ title: "a", clientKey: "C1" }, ctx).row!.Area, "client");
  assert.equal(newTaskRow({ title: "a", projectKey: "P1" }, ctx).row!.Area, "project");
  const p = newTaskRow({ title: "Book dentist", area: "personal" }, ctx).row!; assert.equal(p.PrivacyLevel, "private");
  assert.equal(readTask(p).privacy, "private");
});
test("old tasks are read without rewriting: area, title, hours and notes come from the old fields", () => {
  const old = { Key: "T9", Type: "VAT query", ClientKey: "C1", EstimateHours: 1.5, RemainingHours: 0.5, PlannedDate: "2026-11-12T00:00:00Z", Notes: "n", Status: "Open" };
  const t = readTask(old); assert.equal(t.area, "client"); assert.equal(t.title, "VAT query"); assert.equal(t.estimateMinutes, 90); assert.equal(t.remainingMinutes, 30); assert.equal(t.legacyPlanned, "2026-11-12"); assert.equal(t.description, "n"); assert.equal(t.legacy, true); assert.equal(t.ownerType, "user");
  assert.equal(areaOf({ ProjectKey: "P1", ClientKey: "C1" }), "project"); assert.equal(areaOf({}), "inbox"); assert.equal(areaOf({ Area: "bogus", ClientKey: "C" }), "client");
});
test("status model: external actions follow request and verify; submitted is not finished", () => {
  assert.equal(isFinished("Submitted"), false); assert.equal(isFinished("Under review"), false); assert.equal(isFinished("Done"), true);
  assert.equal(canMove("Submitted", "Done", "contact"), true);
  assert.equal(canMove("Requested", "Done", "contact"), false, "can't skip the practice's check");
  assert.equal(canMove("Open", "Submitted", "user"), false, "a person's own work has no client statuses");
  assert.equal(canMove("Done", "Open", "user"), true);
});
test("bulk paste: one task per line, bullets stripped, repeats dropped, retry is idempotent", () => {
  const titles = splitBulk("- Call director about stock\n2. Request bank statements\n\n• Review VAT adjustments\nrequest bank statements\n  Send engagement letter  \n* Update payroll details");
  assert.deepEqual(titles, ["Call director about stock", "Request bank statements", "Review VAT adjustments", "Send engagement letter", "Update payroll details"]);
  const keys = bulkCaptureKeys("B1", titles); assert.equal(new Set(keys).size, 5);
  assert.deepEqual(notYetCreated(keys, []), [0, 1, 2, 3, 4]);
  assert.deepEqual(notYetCreated(keys, [keys[0], keys[1], keys[3]]), [2, 4], "a retry after a partial failure creates only what's missing");
  assert.deepEqual(bulkCaptureKeys("B1", titles), keys, "same paste, same keys");
});

const known: Known = { tasks: new Set(["T1", "T2", "T3"]), jobs: new Set(["J1", "J2"]), stages: new Map([["J1", new Set([1, 2, 3])]]) };
const dep = ({ p, d, ...o }: Partial<Dependency> & { p: [string, string, number?]; d: [string, string, number?] }): Dependency => ({ key: o.key || `${p.join("")}>${d.join("")}`, prerequisite: { kind: p[0] as never, key: p[1], stage: p[2] }, dependent: { kind: d[0] as never, key: d[1], stage: d[2] }, type: "finish_to_start", outcome: "done", verificationRequired: false, status: "active", expectedCompletion: "", resolvedAt: "", resolvedBy: "", overrideReason: "", templateKey: "", created: "", createdBy: "", version: 1, ...o });
const v = (o: Parameters<typeof dep>[0], existing: Dependency[] = []) => { const d = dep(o); return validateDependency(d, existing, known); };

test("dependencies: self, missing, duplicate and cycles are refused", () => {
  assert.ok(v({ p: ["task", "T1"], d: ["task", "T1"] }).some((x) => /itself/.test(x)));
  assert.ok(v({ p: ["task", "NOPE"], d: ["task", "T1"] }).some((x) => /doesn't exist/.test(x)));
  assert.deepEqual(v({ p: ["task", "T1"], d: ["task", "T2"] }), []);
  const a = dep({ p: ["task", "T1"], d: ["task", "T2"] }), b = dep({ p: ["task", "T2"], d: ["job", "J1"] });
  assert.ok(v({ p: ["task", "T1"], d: ["task", "T2"] }, [a]).some((x) => /already exists/.test(x)));
  assert.ok(v({ p: ["job", "J1"], d: ["task", "T1"] }, [a, b]).some((x) => /wait on itself/.test(x)), "T1 <- ... J1 would close the loop");
  assert.equal(createsCycle({ kind: "task", key: "T3" }, { kind: "task", key: "T1" }, [a, b]), false);
  assert.equal(createsCycle({ kind: "task", key: "T1" }, { kind: "task", key: "T3" }, [a, b]), false);
});
test("cancelled dependencies don't count towards a cycle", () => {
  const a = dep({ p: ["task", "T1"], d: ["task", "T2"], status: "cancelled" });
  assert.equal(createsCycle({ kind: "task", key: "T2" }, { kind: "task", key: "T1" }, [a]), false);
});
test("stage and partial dependencies need real stages; only jobs have stages", () => {
  assert.deepEqual(v({ type: "stage", outcome: "stage", p: ["job", "J1", 3], d: ["job", "J2"] }), []);
  assert.ok(v({ type: "stage", outcome: "stage", p: ["job", "J1", 9], d: ["job", "J2"] }).some((x) => /no such stage/.test(x)));
  assert.ok(v({ type: "stage", outcome: "stage", p: ["job", "J1"], d: ["job", "J2"] }).length > 0);
  assert.ok(v({ p: ["task", "T1", 2], d: ["job", "J1"] }).some((x) => /Only a job has stages/.test(x)));
  assert.deepEqual(v({ type: "partial", p: ["task", "T1"], d: ["job", "J2", undefined] }).length > 0, true, "partial needs the one stage held back");
  assert.deepEqual(v({ type: "partial", p: ["task", "T1"], d: ["job", "J1", 3] }), []);
});
test("transitions keep history, require a reason to override, and never edit the past", () => {
  const d = dep({ p: ["task", "T1"], d: ["task", "T2"] });
  const i = { by: "k", now: "2026-11-11T10:00:00Z", eventKey: "E1" };
  assert.ok(transition(d, "overridden", i).error);
  const o = transition(d, "overridden", { ...i, reason: "Client confirmed by phone" }); assert.equal(o.dep!.status, "overridden"); assert.equal(o.dep!.version, 2); assert.equal(o.event!.before, "active"); assert.equal(o.event!.after, "overridden");
  const re = transition(o.dep!, "active", i); assert.equal(re.dep!.overrideReason, ""); assert.equal(re.event!.type, "reopen");
  const c = transition(d, "cancelled", i); assert.ok(transition(c.dep!, "satisfied", i).error);
  assert.ok(transition(d, "active", i).error);
});
test("dependencies survive round-trip through list rows; missing ends are reported, not dropped", () => {
  const d = dep({ p: ["job", "J1", 2], d: ["task", "T2"], type: "stage", outcome: "stage", verificationRequired: true });
  assert.deepEqual(readDependency(dependencyRow(d)), d);
  const gone = missingPrerequisites([dep({ p: ["task", "GONE"], d: ["task", "T2"] })], known); assert.equal(gone[0].side, "prerequisite");
});

const viewer = { user: "kev@x.co", seesAllShared: true };
test("personal tasks are private even from managers, portal and reports", () => {
  const mine = { Key: "P1", Title: "Dentist", Area: "personal", AssignedUser: "kev@x.co", CreatedBy: "kev@x.co" };
  const shared = { Key: "S1", Title: "VAT", ClientKey: "C1" };
  assert.deepEqual(visibleTo([mine, shared], viewer).map((r) => r.Key), ["P1", "S1"]);
  assert.deepEqual(visibleTo([mine, shared], { user: "boss@x.co", seesAllShared: true }).map((r) => r.Key), ["S1"], "not even a partner sees it");
  assert.equal(canSee(readTask(shared), { user: "c", seesAllShared: false, portalContact: "c" }), false);
  assert.equal(countsTowardPractice(readTask(mine)), false); assert.equal(countsTowardPractice(readTask(shared)), true);
  assert.equal(readTask({ ...shared, PrivacyLevel: "private", AssignedUser: "kev@x.co" }).privacy, "private");
});
test("portal sees only actions explicitly shared with that client, and only safe fields", () => {
  const t = readTask({ Key: "A1", Title: "Send invoices", ClientKey: "C1", OwnerType: "contact", Notes: "internal: they always late", InternalTargetDate: "2026-11-01", Tags: "x" });
  assert.equal(portalVisible(t, "C1", true), true); assert.equal(portalVisible(t, "C1", false), false); assert.equal(portalVisible(t, "C2", true), false);
  assert.equal(portalVisible(readTask({ Key: "A2", Title: "Ours", ClientKey: "C1" }), "C1", true), false, "our own internal tasks are never portal items");
  assert.equal(portalVisible(readTask({ Key: "A3", Title: "x", Area: "personal", ClientKey: "C1", OwnerType: "contact" }), "C1", true), false);
  assert.deepEqual(Object.keys(portalView(t)).sort(), ["description", "dueDate", "key", "status", "title"]);
});

test("migration dry run: keys and links untouched, subtasks kept as checklists, problems reported", () => {
  const tasks = [
    { Key: "T1", Type: "A", ClientKey: "C1", Subtasks: JSON.stringify([{ id: "a", text: "x", done: false }, { id: "b", text: "y", done: true }]) },
    { Key: "T2", Title: "B", ProjectKey: "P1", ClientKey: "C1" }, { Key: "T3", Title: "C" }, { Key: "T3", Title: "dup" },
    { Key: "T4", Title: "D", ClientKey: "GONE", ParentTaskKey: "T4" }, { Key: "T5", Title: "E", Area: "practice", Version: 3 },
  ];
  const r = planMigration(tasks, { clients: new Set(["C1"]), projects: new Set(["P1"]), jobs: new Set() }, [{ Actions: JSON.stringify([{ text: "a" }, { text: "b", taskKey: "T1" }]) }]);
  const codes = r.findings.map((f) => f.code);
  for (const c of ["duplicate-key", "orphan-parent", "orphan-client", "client-and-project", "no-title"].filter((c) => c !== "no-title")) assert.ok(codes.includes(c), c);
  assert.equal(r.subtaskItems, 2); assert.ok(r.findings.some((f) => f.code === "subtasks-kept"));
  assert.equal(r.meetingActionsNotTasks, 1, "meeting actions are counted but never converted automatically");
  assert.equal(r.tasks, 6); assert.equal(r.byArea.client, 2); assert.equal(r.byArea.project, 1);
  const t5 = r.backfill.find((b) => b.key === "T5"); assert.equal(t5, undefined, "a fully migrated row is left alone");
  const t1 = r.backfill.find((b) => b.key === "T1")!; assert.deepEqual(t1.patch, { Area: "client", Version: 1 });
  assert.ok(!r.backfill.some((b) => "Key" in b.patch || "ClientKey" in b.patch || "ProjectKey" in b.patch || "Subtasks" in b.patch));
});
test("backfill has an exact undo, and doesn't clear anything changed since", () => {
  const tasks = [{ Key: "T1", Title: "a", ClientKey: "C1" }, { Key: "T2", Title: "b" }];
  const r = planMigration(tasks, { clients: new Set(["C1"]), projects: new Set(), jobs: new Set() });
  const after = tasks.map((t) => ({ ...t, ...(r.backfill.find((b) => b.key === t.Key)?.patch || {}) }));
  after[1] = { ...after[1], Area: "personal" } as never; // the user re-filed T2 since
  const undo = rollbackFor(r, after); const t1 = undo.find((u) => u.key === "T1")!; assert.deepEqual(t1.patch, { Area: "", Version: "" });
  const t2 = undo.find((u) => u.key === "T2")!; assert.deepEqual(t2.patch, { Version: "" }, "Area was changed by a person, so it's left");
  // running the plan again on migrated rows finds nothing to do
  assert.equal(planMigration(after, { clients: new Set(["C1"]), projects: new Set(), jobs: new Set() }).backfill.length, 0);
});
