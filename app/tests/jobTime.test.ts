import { test } from "node:test";
import assert from "node:assert/strict";
import { budgets, clock, lengthText, manualRow, readTime, runningTimer, startRow, stopPatch, summarise, trackedHours } from "../src/lib/jobTime.ts";

const t0 = new Date("2026-11-02T09:00:00Z");
const at = (m: number) => new Date(t0.getTime() + m * 60000);
let k = 0; const key = (p: string) => `${p}${++k}`;
const job = { Key: "J1", ClientKey: "C1" };
const templates = [{ Key: "s1", StageNo: 1, Title: "Records in", DefaultBudget: 0.5 }, { Key: "s2", StageNo: 2, Title: "Prepare", DefaultBudget: 3 }, { Key: "s3", StageNo: 3, Title: "Review", DefaultBudget: 0 }];

test("a client's own stage budget overrides the practice default", () => {
  const b = budgets(templates, [{ StageNo: 2, BudgetHours: 4 }, { StageNo: 1, BudgetHours: 0 }]);
  assert.equal(b.get(1), 0.5); assert.equal(b.get(2), 4); assert.equal(b.get(3), 0);
});

test("a timer runs, stops with its length, and only one can be running", () => {
  const r = readTime(startRow(job, 2, "Prepare", "Kevin", t0, key));
  assert.equal(runningTimer([r])?.key, r.key);
  const p = stopPatch(r, at(90));
  assert.equal(p.Hours, 1.5);
  const done = readTime({ ...startRow(job, 2, "Prepare", "K", t0, key), ...p });
  assert.equal(runningTimer([done]), undefined);
  assert.equal(stopPatch(r, at(0)).Hours, 0.01); // never a zero-length entry
  assert.equal(stopPatch(r, at(60 * 40)).Hours, 12); // forgotten timer is capped
});

test("budget against actual by stage, with a running timer counted and warnings", () => {
  const e = [
    readTime({ ...startRow(job, 1, "Records in", "K", t0, key), Ended: "x", Hours: 0.6 }),
    readTime(manualRow(job, 2, "Prepare", 2.5, "bank recs", "K", t0, key)),
    readTime(startRow(job, 2, "Prepare", "K", t0, key)), // running, 30 minutes in
    readTime({ ...manualRow({ Key: "J2", ClientKey: "C1" }, 2, "Prepare", 9, "", "K", t0, key) }), // another job
    readTime(manualRow(job, 9, "Old stage", 1, "", "K", t0, key)), // a stage the job no longer has
  ];
  const sm = summarise(templates, [], e, "J1", at(30));
  assert.equal(sm.stages[0].status, "over"); // 0.6 of 0.5
  assert.equal(sm.stages[1].actual, 3); // 2.5 + 0.5 running
  assert.equal(sm.stages[1].status, "near"); // exactly at budget is a warning, not yet over
  assert.equal(sm.stages[2].status, "none"); // no budget, no judgement
  assert.equal(sm.other, 1);
  assert.equal(sm.actual, 4.6);
  assert.equal(sm.budget, 3.5);
  assert.equal(sm.status, "over");
});

test("tracked hours counts finished entries for one job only", () => {
  const e = [readTime(manualRow(job, 1, "", 1.25, "", "K", t0, key)), readTime(startRow(job, 1, "", "K", t0, key)), readTime(manualRow({ Key: "J2" }, 1, "", 5, "", "K", t0, key))];
  assert.equal(trackedHours(e, "J1"), 1.25);
});

test("the clock and the length read naturally", () => {
  assert.equal(clock(1 + 5 / 60 + 9 / 3600), "1:05:09");
  assert.equal(lengthText(2.25), "2h 15m"); assert.equal(lengthText(2), "2h"); assert.equal(lengthText(0.75), "45m");
});
