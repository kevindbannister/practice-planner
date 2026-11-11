import test from "node:test";
import assert from "node:assert/strict";
import { shareDraft, afterShare, portalSync, verifyPlan, chasePlan, isVerified, clientActionItems, meetingActionTask, meetingProgress, suggestFromNotes, eventsForChange, historyOf, taskEventRow, readTaskEvent } from "../src/lib/work/clientActions";
import { readTask } from "../src/lib/work/model";

let n = 0;
const c = (now = "2026-11-10T09:00:00Z") => ({ user: "kevin", now, key: () => `e${++n}` });
const row = (o: Record<string, unknown> = {}) => ({ Key: "t1", Title: "Send bank statements", ClientKey: "c1", OwnerType: "contact", AssignedContact: "Sam", Status: "Requested", Version: 1, PrivacyLevel: "shared", PortalRequestId: "r1", DueDate: "2026-11-05", ...o });

test("share: only outside-party, filed, non-private tasks", () => {
  assert.ok("error" in shareDraft(readTask(row({ OwnerType: "user" })), []));
  assert.ok("error" in shareDraft(readTask(row({ ClientKey: "" })), []));
  assert.ok("error" in shareDraft(readTask(row({ PrivacyLevel: "private" })), []));
  assert.ok(!("error" in shareDraft(readTask(row()), ["p1"])));
});
test("afterShare moves to Requested and logs", () => {
  const r = afterShare(row({ Status: "Not requested", PortalRequestId: "" }), "r9", c());
  assert.equal(r.patch.Status, "Requested"); assert.equal(r.patch.PortalRequestId, "r9"); assert.equal(r.event.type, "shared");
});
test("portal response only sets Submitted, never Done", () => {
  const s = portalSync([row()], [{ id: "r1", status: "responded", thread: [{ at: "x", from: "client", text: "here", docs: [{ id: "d", title: "a" }] }] }], c());
  assert.equal(s.patches[0].patch.Status, "Submitted");
  const done = portalSync([row()], [{ id: "r1", status: "complete", thread: [] }], c());
  assert.equal(done.patches.length, 0); assert.equal(done.notes.length, 1);
});
test("sync ignores finished tasks and flags missing requests", () => {
  assert.equal(portalSync([row({ Status: "Done" })], [], c()).notes.length, 0);
  assert.equal(portalSync([row()], [], c()).notes.length, 1);
});
test("verify: accept needs Submitted; reopen needs reason; corrections needs note", () => {
  assert.ok("error" in verifyPlan(row(), "accept", c()));
  const a = verifyPlan(row({ Status: "Submitted" }), "accept", c()); assert.ok(!("error" in a));
  if (!("error" in a)) { assert.equal(a.patch.Status, "Done"); assert.equal(a.event.type, "verified"); assert.equal(a.portal.op, "complete"); }
  assert.ok("error" in verifyPlan(row({ Status: "Submitted" }), "corrections", c()));
  const k = verifyPlan(row({ Status: "Submitted" }), "corrections", c(), "Page 2 missing");
  if (!("error" in k)) { assert.equal(k.patch.Status, "Needs more"); assert.equal(k.portal.op, "reply-reopen"); }
  assert.ok("error" in verifyPlan(row({ Status: "Done" }), "reopen", c()));
  assert.ok("error" in verifyPlan(row({ OwnerType: "user", Status: "Submitted" }), "accept", c()));
});
test("isVerified needs the verified event for outside work", () => {
  const t = readTask(row({ Status: "Done" }));
  assert.equal(isVerified(t, []), false);
  assert.equal(isVerified(t, [{ key: "x", taskKey: "t1", type: "verified", at: "", by: "", before: "", after: "", reason: "" }]), true);
  assert.equal(isVerified(readTask(row({ Status: "Done", OwnerType: "user" })), []), true);
});
test("chase: reminder rate limit and validation", () => {
  assert.ok("error" in chasePlan(row({ PortalRequestId: "" }), "portal", c()));
  const first = chasePlan(row(), "portal", c("2026-11-10T09:00:00Z")); assert.ok(!("error" in first));
  const ev = !("error" in first) ? [first.event] : [];
  assert.ok("error" in chasePlan(row(), "portal", c("2026-11-11T09:00:00Z"), { events: ev }));
  assert.ok(!("error" in chasePlan(row(), "portal", c("2026-11-14T09:00:00Z"), { events: ev })));
  assert.ok("error" in chasePlan(row(), "note", c()));
  assert.ok("error" in chasePlan(row(), "call", c(), { followUp: "tomorrow" }));
  const call = chasePlan(row(), "call", c(), { followUp: "2026-11-20" });
  if (!("error" in call)) { assert.equal(call.portal.op, "none"); assert.equal(call.patch?.FollowUpDate, "2026-11-20"); }
  assert.ok("error" in chasePlan(row({ Status: "Done" }), "call", c()));
});
test("action centre: submitted, overdue, private excluded", () => {
  const items = clientActionItems([row({ Key: "a", Status: "Submitted" }), row({ Key: "b" }), row({ Key: "c", PrivacyLevel: "private" }), row({ Key: "d", OwnerType: "user" })], () => "Acme", "2026-11-10");
  assert.deepEqual(items.map((i) => i.key.split(":")[2]).sort(), ["chase", "verify"]);
});
test("meeting action task: idempotent key, owner mapping, validation", () => {
  const m = { key: "m1", clientKey: "c1", title: "Year end" };
  const a = meetingActionTask({ text: " Send  records ", who: "Client", due: "2026-12-01" }, m, 0, { user: "k", now: "n", taskKey: "t" }) as any;
  const b = meetingActionTask({ text: "send records", who: "Client", due: "" }, m, 0, { user: "k", now: "n", taskKey: "t2" }) as any;
  assert.equal(a.CaptureKey, b.CaptureKey); assert.equal(a.OwnerType, "contact"); assert.equal(a.Status, "Not requested");
  const me = meetingActionTask({ text: "Do it", who: "Me", due: "" }, m, 1, { user: "k", now: "n", taskKey: "t" }) as any;
  assert.equal(me.OwnerType, "user"); assert.equal(me.Status, "Open");
  assert.ok("error" in (meetingActionTask({ text: "", who: "", due: "" }, m, 0, { user: "k", now: "n", taskKey: "t" }) as any));
  assert.ok("error" in (meetingActionTask({ text: "x", who: "", due: "1/2/26" }, m, 0, { user: "k", now: "n", taskKey: "t" }) as any));
});
test("meeting progress reads linked tasks", () => {
  const p = meetingProgress([{ text: "a", who: "", due: "", taskKey: "t1" }, { text: "b", who: "", due: "", taskKey: "t2" }, { text: "c", who: "", due: "" }], [{ Key: "t1", Status: "Done" }, { Key: "t2", Status: "Open" }]);
  assert.deepEqual(p, { agreed: 3, done: 1, outstanding: 2, unlinked: 1 });
});
test("notes suggestions", () => {
  const s = suggestFromNotes("Action: client to send P60s\n- Sam will send the invoices.\n[ ] Book VAT call\nrandom chat\nAction: Client to send P60s");
  assert.equal(s.length, 3); assert.equal(s[1].who, "Sam");
});
test("events: change diff and history roundtrip", () => {
  const e = eventsForChange(row(), { Status: "In progress", FollowUpDate: "2026-11-20" }, c());
  assert.deepEqual(e.map((x) => x.type), ["status", "follow-up"]);
  const rows = e.map((x) => taskEventRow(x, "p"));
  assert.equal(readTaskEvent(rows[0]).type, "status");
  assert.equal(historyOf(rows, "t1").length, 2);
});
