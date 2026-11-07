import { test } from "node:test";
import assert from "node:assert/strict";
import * as J from "../lib/jobs.js";

const at = new Date("2026-11-07T10:00:00Z");
test("parseDuration accepts the usual forms", () => {
  assert.equal(J.parseDuration("1.5"), 1.5);
  assert.equal(J.parseDuration("1h30"), 1.5);
  assert.equal(J.parseDuration("1:30"), 1.5);
  assert.equal(J.parseDuration("90m"), 1.5);
  assert.equal(J.parseDuration("abc"), undefined);
  assert.equal(J.parseDuration("30"), undefined);
});
test("only open jobs for the client, soonest deadline first", () => {
  const jobs = [
    { Key: "a", ClientKey: "C", Deadline: "2026-12-01", Status: "Open" },
    { Key: "b", ClientKey: "C", Deadline: "2026-11-10", Status: "Open" },
    { Key: "c", ClientKey: "C", Status: "Complete" },
    { Key: "d", ClientKey: "X", Status: "Open" },
  ];
  assert.deepEqual(J.jobsFor(jobs, "C").map((j) => j.Key), ["b", "a"]);
});
test("deadline states", () => {
  assert.equal(J.deadlineState({ Deadline: "2026-11-01" }, "2026-11-07"), "late");
  assert.equal(J.deadlineState({ Deadline: "2026-11-20" }, "2026-11-07"), "soon");
  assert.equal(J.deadlineState({ Deadline: "2027-03-01" }, "2026-11-07"), "");
});
test("hold then resume keeps a note of the wait", () => {
  const h = J.holdPatch("Needs bank statements", "2026-11-20", "2026-11-07", "Client");
  assert.equal(h.Status, "On hold");
  const r = J.resumePatch({ ...h, Notes: "" }, "2026-11-14");
  assert.equal(r.Status, "Open");
  assert.match(r.Notes, /Waiting on Client/);
  assert.match(r.Notes, /Needs bank statements/);
});
test("timer: one start row, stop closes it, forgotten timers cap at 12 hours", () => {
  const job = { Key: "J1", ClientKey: "C", StageNo: 2, StageName: "Prep" };
  const row = J.startRow(job, "Kevin", at, () => "JTX");
  const e = J.readTime({ ...row, _id: "9" });
  assert.equal(J.runningTimer([e]).key, "JTX");
  const later = new Date(at.getTime() + 90 * 60000);
  assert.equal(J.stopPatch(e, later).Hours, 1.5);
  const next = new Date(at.getTime() + 30 * 3600000);
  assert.equal(J.stopPatch(e, next).Hours, 12);
  assert.equal(J.runningTimer([{ ...e, ended: later.toISOString() }]), undefined);
});
test("notes are dated and appended", () => {
  assert.match(J.noteAppend("old", "hello", "Kev", at), /^old\n7 Nov 2026 \(Kev\): hello$/);
});
test("clock and lengths", () => {
  assert.equal(J.clock(1.5), "1:30:00");
  assert.equal(J.lengthText(1.5), "1h 30m");
  assert.equal(J.lengthText(0.25), "15m");
});
