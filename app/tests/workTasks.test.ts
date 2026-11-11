import test from "node:test";
import assert from "node:assert/strict";
import { archive, bulkChange, changeTask, childProgress, complete, filterCounts, filterTasks, groupTasks, inbox, parentProblems, reopen, sortTasks, undoChange } from "../src/lib/work/tasks";
import { readTask } from "../src/lib/work/model";
import { Row } from "../src/lib/schema";

const ctx = { user: "kev", now: "2026-11-11T09:00:00Z" };
const T = "2026-11-11";
const mk = (o: Row): Row => ({ Status: "Open", Version: 1, Created: "2026-11-01T00:00:00Z", ...o });
const rows: Row[] = [
  mk({ Key: "A", Title: "Inbox one", Area: "inbox", Created: "2026-11-05T00:00:00Z" }), mk({ Key: "B", Title: "Inbox two", Area: "inbox", Created: "2026-11-09T00:00:00Z" }),
  mk({ Key: "C", Title: "Child of A", Area: "inbox", ParentTaskKey: "A" }), mk({ Key: "D", Title: "Done", Area: "inbox", Status: "Done" }),
  mk({ Key: "E", Title: "Our VAT", Area: "client", ClientKey: "C1", DueDate: "2026-11-05", Priority: "high" }),
  mk({ Key: "F", Title: "Client to send", Area: "client", ClientKey: "C1", OwnerType: "contact", AssignedContact: "Director", Status: "Requested", DueDate: "2026-11-20" }),
  mk({ Key: "G", Title: "Held", Area: "client", ClientKey: "C1", Status: "On hold", BlockedReason: "waiting for stock" }), mk({ Key: "H", Title: "Finished", Area: "client", ClientKey: "C1", Status: "Done" }),
];
const cl = rows.filter((r) => r.ClientKey === "C1").map(readTask);

test("inbox: open, unclassified, top-level, newest first", () => assert.deepEqual(inbox(rows).map((t) => t.key), ["B", "A"]));
test("client filters and counts use the right tasks", () => {
  const f = (x: Parameters<typeof filterTasks>[1]) => filterTasks(cl, x, T).map((t) => t.key).sort();
  assert.deepEqual(f("outstanding"), ["E", "F", "G"]); assert.deepEqual(f("ours"), ["E", "G"]); assert.deepEqual(f("client"), ["F"]);
  assert.deepEqual(f("waiting"), ["F", "G"]); assert.deepEqual(f("blocked"), ["G"]); assert.deepEqual(f("overdue"), ["E"]); assert.deepEqual(f("completed"), ["H"]);
  assert.deepEqual(filterTasks(cl, "blocked", T, new Set(["E"])).map((t) => t.key).sort(), ["E", "G"], "the dependency engine can add blocked tasks later");
  assert.equal(filterCounts(cl, T).overdue, 1);
});
test("grouping: by due bucket, status, responsible and priority; sorted by date then priority", () => {
  assert.deepEqual(groupTasks(cl.filter((t) => t.status !== "Done"), "due", { today: T }).map((g) => g.label), ["Overdue", "Later", "No due date"]);
  assert.deepEqual(groupTasks(cl, "responsible", { today: T }).map((g) => g.label), ["Us", "Director"]);
  assert.deepEqual(groupTasks(cl, "priority", { today: T }).map((g) => g.label), ["High", "No priority"]);
  assert.equal(groupTasks(cl, "status", { today: T }).at(-1)!.label, "Done");
  assert.deepEqual(sortTasks(cl).map((t) => t.key).slice(0, 2), ["E", "F"]);
});
test("quick triage: moving an Inbox task to a client files it; Version bumps; nothing else changes", () => {
  const c = changeTask(rows, "A", { client: "C1" }, ctx, { expected: 1 });
  assert.ok("patch" in c); assert.deepEqual(c.patch, { ClientKey: "C1", Area: "client", Version: 2, Updated: ctx.now });
  assert.equal(c.before.ClientKey, ""); assert.equal(c.before.Version, 1);
  assert.equal((changeTask(rows, "A", { project: "P1" }, ctx) as { patch: Row }).patch.Area, "project");
  assert.equal((changeTask(rows, "E", { client: null }, ctx) as { patch: Row }).patch.Area, "inbox", "taking the client off sends it back to the Inbox");
  assert.ok((changeTask(rows, "A", { due: "tomorrow" }, ctx) as { error: string }).error);
  assert.ok((changeTask(rows, "A", { title: "  " }, ctx) as { error: string }).error);
  assert.equal((changeTask(rows, "A", {}, ctx) as { error: string }).error, "Nothing to change.");
});
test("changes are refused when the task has moved on since it was read", () => {
  assert.match((changeTask(rows, "A", { priority: "high" }, ctx, { expected: 0 }) as { error: string }).error, /Someone else/);
  assert.match((changeTask(rows, "NOPE", { priority: "high" }, ctx) as { error: string }).error, /no longer exists/);
});
test("completing and reopening; a parent with open children needs a deliberate yes", () => {
  const blocked = complete(rows, "A", ctx); assert.match((blocked as { error: string }).error, /1 smaller task is still open/);
  const forced = complete(rows, "A", ctx, { force: true }) as { patch: Row }; assert.equal(forced.patch.Status, "Done"); assert.equal(forced.patch.CompletedBy, "kev");
  assert.ok((complete(rows, "C", ctx) as { patch: Row }).patch.CompletedDate);
  const r = reopen(rows, "D", ctx) as { patch: Row }; assert.equal(r.patch.Status, "Open"); assert.equal(r.patch.CompletedDate, "");
  const a = archive(rows, "B", ctx) as { patch: Row }; assert.equal(a.patch.Status, "Cancelled");
  assert.deepEqual(childProgress(rows, "A"), { done: 0, total: 1 });
});
test("parents: no self, loops, finished parents, other clients or too deep", () => {
  const rs: Row[] = [mk({ Key: "1", Title: "1", ClientKey: "C1" }), mk({ Key: "2", Title: "2", ParentTaskKey: "1", ClientKey: "C1" }), mk({ Key: "3", Title: "3", ParentTaskKey: "2" }), mk({ Key: "4", Title: "4" }), mk({ Key: "5", Title: "5", ClientKey: "C2" }), mk({ Key: "6", Title: "6", Status: "Done" })];
  assert.deepEqual(parentProblems(rs, "4", "1"), []);
  assert.match(parentProblems(rs, "1", "1")[0], /own parent/); assert.match(parentProblems(rs, "1", "3")[0], /own child/);
  assert.match(parentProblems(rs, "4", "3")[0], /levels deep/); assert.match(parentProblems(rs, "5", "1")[0], /same client/); assert.match(parentProblems(rs, "4", "6")[0], /finished/);
  assert.match(parentProblems(rs, "4", "NOPE")[0], /doesn't exist/);
  assert.deepEqual(parentProblems(rs, "3", ""), []);
});
test("bulk: each task judged on its own; skipped ones are named", () => {
  const b = bulkChange(rows, ["A", "B", "NOPE", "A"], { client: "C1", priority: "low" }, ctx);
  assert.deepEqual(b.changes.map((c) => c.key), ["A", "B"]); assert.equal(b.skipped.length, 1); assert.equal(b.skipped[0].key, "NOPE");
  const done = bulkChange(rows, ["A", "C"], { status: "Done" }, ctx); assert.deepEqual(done.changes.map((c) => c.key), ["C"]); assert.equal(done.skipped[0].key, "A");
});
test("undo puts the old values back, but never over someone else's later change", () => {
  const c = changeTask(rows, "E", { priority: "low", due: "2026-12-01" }, ctx) as { key: string; patch: Row; before: Row };
  const after = rows.map((r) => (r.Key === "E" ? { ...r, ...c.patch } : r));
  const u = undoChange(after, c, ctx); assert.deepEqual([u.patch!.Priority, u.patch!.DueDate, u.patch!.Version], ["high", "2026-11-05", 3]);
  const changedSince = after.map((r) => (r.Key === "E" ? { ...r, Version: 3 } : r));
  assert.match(undoChange(changedSince, c, ctx).error!, /changed since/);
  assert.match(undoChange([], c, ctx).error!, /no longer exists/);
});
test("setting the parent goes through the same checks as the editor", () => {
  assert.match((changeTask(rows, "A", { parent: "C" }, ctx) as { error: string }).error, /own child/);
  assert.equal((changeTask(rows, "B", { parent: "A" }, ctx) as { patch: Row }).patch.ParentTaskKey, "A");
});

test("a task with a client or project is filed even if an older screen left Area as inbox", () => {
  assert.equal(readTask({ Key: "x", Title: "t", Area: "inbox", ClientKey: "C1" }).area, "client");
  assert.equal(readTask({ Key: "x", Title: "t", Area: "inbox", ProjectKey: "P1" }).area, "project");
  assert.equal(readTask({ Key: "x", Title: "t", Area: "inbox" }).area, "inbox");
  assert.deepEqual(inbox([{ Key: "x", Title: "t", Area: "inbox", ClientKey: "C1", Status: "Open" }]), []);
});
test("client actions follow the request and check path; switching who does it sets a sensible status", () => {
  const rs: Row[] = [mk({ Key: "U", Title: "u" }), mk({ Key: "X", Title: "x", OwnerType: "contact", Status: "Requested" }), mk({ Key: "S", Title: "s", OwnerType: "contact", Status: "Submitted" })];
  assert.equal((changeTask(rs, "U", { ownerType: "contact" }, ctx) as { patch: Row }).patch.Status, "Not requested");
  assert.match((changeTask(rs, "X", { status: "Done" }, ctx) as { error: string }).error, /can't go from/);
  assert.equal((changeTask(rs, "S", { status: "Under review" }, ctx) as { patch: Row }).patch.Status, "Under review");
  assert.equal((changeTask(rs, "S", { status: "Done" }, ctx) as { patch: Row }).patch.Status, "Done");
  assert.equal((changeTask(rs, "X", { ownerType: "user" }, ctx) as { patch: Row }).patch.Status, "Open");
});
