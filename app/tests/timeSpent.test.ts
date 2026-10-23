import assert from "node:assert/strict";
import { test } from "node:test";
import { Job, Task } from "../src/lib/domain";
import { finishedWithoutTime, parseDuration, timeGapText, timePatch, timeSkipPatch } from "../src/lib/timeSpent";

test("times can be typed the way people say them", () => {
  for (const [text, hours] of [
    ["1.5", 1.5], ["1,5", 1.5], [".5", 0.5], ["2", 2], ["1:30", 1.5], ["0:45", 0.75], ["1h30", 1.5], ["1h 30m", 1.5],
    ["1 hr 15 mins", 1.25], ["2 hours", 2], ["2h", 2], ["90m", 1.5], ["45 mins", 0.75], ["1.5h", 1.5], [" 3 ", 3],
  ] as [string, number][]) assert.equal(parseDuration(text), hours, text);
  for (const bad of ["", "abc", "0", "-1", "25", "1:75", "1h75", "about two"]) assert.equal(parseDuration(bad), undefined, bad);
});

const job = (o: Partial<Job>): Job => ({ Key: "J1", Title: "VAT return", ClientKey: "C1", ServiceKey: "VAT", Status: "Complete", CompletedDate: "2026-10-22", ...o } as Job);
const task = (o: Partial<Task>): Task => ({ Key: "T1", Title: "Call", Status: "Done", CompletedDate: "2026-10-22", ...o } as Task);

test("finished work with no time is listed, newest first, with its estimate", () => {
  const list = finishedWithoutTime(
    [job({ Key: "A", CompletedDate: "2026-10-20" }), job({ Key: "B", CompletedDate: "2026-10-22", EstimateHours: 3 }), job({ Key: "C", ActualHours: 2 }), job({ Key: "D", Status: "Open" })],
    [task({ Key: "E", CompletedDate: "2026-10-21", EstimateHours: 0.5 }), task({ Key: "F", ActualHours: 1 })],
    [],
  );
  assert.deepEqual(list.map((f) => f.key), ["B", "E", "A"]);
  assert.equal(list[0].estimate, 3);
  assert.equal(list[1].estimate, 0.5);
  assert.equal(list[2].estimate, 1.5); // the VAT default
});

test("work marked 'don't know' stops being asked about, and logging time clears that", () => {
  const skipped = job({ Key: "S", ...timeSkipPatch() });
  assert.equal(finishedWithoutTime([skipped], [], []).length, 0);
  assert.deepEqual(timePatch(1.5), { ActualHours: 1.5, TimeSkipped: "" });
  assert.equal(finishedWithoutTime([{ ...skipped, ...timePatch(1) } as Job], [], []).length, 0);
});

test("the catch-up looks back only as far as asked", () => {
  const jobs = [job({ Key: "OLD", CompletedDate: "2026-09-01" }), job({ Key: "NEW", CompletedDate: "2026-10-22" })];
  assert.deepEqual(finishedWithoutTime(jobs, [], [], { since: "2026-10-09" }).map((f) => f.key), ["NEW"]);
  assert.deepEqual(finishedWithoutTime(jobs, [], []).map((f) => f.key), ["NEW", "OLD"]);
});

test("the prompt says yesterday when it was all yesterday", () => {
  const l = finishedWithoutTime([job({ Key: "A" }), job({ Key: "B" })], [task({})], []);
  assert.equal(timeGapText(l, "2026-10-23"), "Yesterday you finished 3 things with no time logged.");
  assert.equal(timeGapText(l.slice(0, 1), "2026-10-23"), "Yesterday you finished 1 thing with no time logged.");
  const mixed = finishedWithoutTime([job({ Key: "A" }), job({ Key: "B", CompletedDate: "2026-10-16" })], [], []);
  assert.match(timeGapText(mixed, "2026-10-23"), /^You finished 2 things since Fri 16 Oct with no time logged\.$/);
  assert.equal(timeGapText([], "2026-10-23"), "");
});
