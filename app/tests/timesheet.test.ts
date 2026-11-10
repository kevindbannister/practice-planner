import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_ACTIVITIES, activitiesFrom, actualHours, billableOf, dayEntries, entryMinutes, forgotten, legacyEntries, londonDate, londonIso, londonTime, manualEntry, readEntry, sessionMinutes, setCell, stopAt, totalsByType, unaccounted, weekGrid } from "../src/lib/timesheet";
import { startRow, stopPatch, readTime, trackedHours } from "../src/lib/jobTime";

let n = 0;
const key = (p: string) => `${p}${++n}`;
const now = new Date("2026-11-10T16:00:00Z");
const job = { Key: "J1", ClientKey: "C1" };
const ent = (r: any) => readEntry(r);

test("Scenario C: an unplanned 35 minute call is recorded directly, with no planning session", () => {
  const m = manualEntry({ date: "2026-11-10", minutes: 35, clientKey: "C1", activityKey: "telephone-calls", note: "Client rang about VAT" }, "kevin", key, now);
  assert.ok(m.row && !m.error);
  const e = ent(m.row);
  assert.equal(entryMinutes(e, now), 35);
  assert.equal(e.sessionKey, "");
  assert.equal(e.workDate, "2026-11-10");
  assert.equal(billableOf(e, DEFAULT_ACTIVITIES), "nonbillable"); // the activity says so
});

test("an entry can be a length, or a start and end in UK time, and a bad one is refused with a reason", () => {
  const a = manualEntry({ date: "2026-07-01", start: "09:30", end: "11:00", jobKey: "J1" }, "k", key, now);
  assert.equal(a.row!.Hours, 1.5);
  assert.equal(a.row!.Started, "2026-07-01T08:30:00.000Z"); // summer time: an hour ahead of UTC
  assert.equal(londonTime(String(a.row!.Started)), "09:30");
  const w = manualEntry({ date: "2026-12-01", start: "09:30", end: "11:00" }, "k", key, now);
  assert.equal(w.row!.Started, "2026-12-01T09:30:00.000Z");
  assert.match(manualEntry({ date: "2026-07-01", start: "11:00", end: "10:00" }, "k", key, now).error!, /after the start/);
  assert.match(manualEntry({ date: "2026-07-01", start: "9am", end: "10:00" }, "k", key, now).error!, /like 09:30/);
  assert.match(manualEntry({ date: "2026-07-01" }, "k", key, now).error!, /how long/);
  assert.match(manualEntry({ date: "2026-07-01", minutes: 1500 }, "k", key, now).error!, /more than a day/);
  assert.match(manualEntry({ date: "", minutes: 30 }, "k", key, now).error!, /day/);
});

test("date boundaries: 23:30 on a summer evening belongs to that UK day, and 00:30 to the next", () => {
  assert.equal(londonDate("2026-07-01T22:30:00Z"), "2026-07-01"); // 23:30 BST
  assert.equal(londonDate("2026-07-01T23:30:00Z"), "2026-07-02"); // 00:30 BST
  assert.equal(londonDate("2026-12-01T23:30:00Z"), "2026-12-01");
  assert.equal(londonIso("2026-03-29", "01:30"), "2026-03-29T01:30:00.000Z"); // the clocks go forward at 01:00: 01:30 doesn't exist, the nearest reading is kept
  assert.equal(londonDate(londonIso("2026-10-25", "00:30")), "2026-10-25");
});

test("Scenario H: a timer run on a job and the timesheet are one record, counted once", () => {
  const t0 = new Date("2026-11-10T09:00:00Z");
  const start = startRow(job, 1, "Prepare", "kevin", t0, key);
  const stopped = { ...start, ...stopPatch(readTime(start), new Date("2026-11-10T10:30:00Z")) };
  const entries = [ent(stopped)];
  assert.equal(entries[0].workDate, "2026-11-10"); // legacy rows have no WorkDate: it comes from when it happened
  const g = weekGrid(entries, "2026-11-09", now);
  assert.equal(g.rows.length, 1);
  assert.equal(g.rows[0].cells[1].minutes, 90);
  assert.equal(g.total, 90);
  assert.equal(trackedHours(entries, "J1"), 1.5); // the job's actual hours
  assert.equal(actualHours(entries, "job", "J1"), 1.5);
  // the timesheet adds more time to the same job: the job's total moves by exactly that
  const more = ent(manualEntry({ date: "2026-11-10", minutes: 30, jobKey: "J1", clientKey: "C1" }, "k", key, now).row!);
  assert.equal(actualHours([...entries, more], "job", "J1"), 2);
  assert.equal(weekGrid([...entries, more], "2026-11-09", now).total, 120);
});

test("several entries in one cell: the cell shows the total, the entries stay separate, and a total can't be typed over them", () => {
  const a = ent(manualEntry({ date: "2026-11-10", minutes: 60, jobKey: "J1", clientKey: "C1", activityKey: "bookkeeping", note: "a" }, "k", key, now).row!);
  const b = ent(manualEntry({ date: "2026-11-10", minutes: 30, jobKey: "J1", clientKey: "C1", activityKey: "bookkeeping", note: "b" }, "k", key, now).row!);
  const g = weekGrid([a, b], "2026-11-09", now);
  const c = g.rows[0].cells[1];
  assert.equal(c.entries.length, 2);
  assert.equal(c.minutes, 90);
  assert.match(setCell(c, 120, { date: "2026-11-10", jobKey: "J1" }, "k", key, now).error!, /several entries/);
});

test("typing into a cell: none makes one, one is changed (or removed at zero), the same value changes nothing", () => {
  const tpl = { date: "2026-11-10", jobKey: "J1", clientKey: "C1", activityKey: "vat" };
  const empty = { minutes: 0, entries: [] };
  const made = setCell(empty, 90, tpl, "k", key, now);
  assert.equal(made.create!.Hours, 1.5);
  const e = ent(made.create!);
  const one = { minutes: 90, entries: [e] };
  assert.equal(setCell(one, 120, tpl, "k", key, now).patch!.patch.Hours, 2);
  assert.equal(setCell(one, 120, tpl, "k", key, now).patch!.patch.Version, 2);
  assert.deepEqual(setCell(one, 90, tpl, "k", key, now), {});
  assert.equal(setCell(one, 0, tpl, "k", key, now).remove, e.key);
  assert.deepEqual(setCell(empty, 0, tpl, "k", key, now), {});
});

test("a week's grid has a row for each client, job and activity, day and week totals, and ignores other weeks", () => {
  const rows = [
    manualEntry({ date: "2026-11-09", minutes: 60, jobKey: "J1", clientKey: "C1", activityKey: "vat" }, "k", key, now).row!,
    manualEntry({ date: "2026-11-11", minutes: 120, jobKey: "J2", clientKey: "C2", activityKey: "tax" }, "k", key, now).row!,
    manualEntry({ date: "2026-11-11", minutes: 30, activityKey: "training" }, "k", key, now).row!,
    manualEntry({ date: "2026-11-16", minutes: 45, jobKey: "J1", clientKey: "C1", activityKey: "vat" }, "k", key, now).row!, // next week
  ].map(ent);
  const g = weekGrid(rows, "2026-11-09", now);
  assert.equal(g.rows.length, 3);
  assert.deepEqual(g.dayTotals, [60, 0, 150, 0, 0, 0, 0]);
  assert.equal(g.total, 210);
  assert.equal(weekGrid(rows, "2026-11-09", now, [{ clientKey: "C3", jobKey: "", taskKey: "", activityKey: "" }]).rows.length, 4); // a row just added and still empty
});

test("a day is in time order, timed entries first", () => {
  const rows = [
    manualEntry({ date: "2026-11-10", minutes: 30 }, "k", key, now).row!,
    manualEntry({ date: "2026-11-10", start: "14:00", end: "15:00" }, "k", key, now).row!,
    manualEntry({ date: "2026-11-10", start: "09:00", end: "10:00" }, "k", key, now).row!,
  ].map(ent);
  assert.deepEqual(dayEntries(rows, "2026-11-10").map((e) => londonTime(e.started)), ["09:00", "14:00", ""]);
});

test("unaccounted capacity is never negative and isn't read as idle time; recorded time is not planned time", () => {
  assert.equal(unaccounted(300, 7.5), 150);
  assert.equal(unaccounted(500, 7.5), 0);
  assert.equal(unaccounted(0, 0), 0);
});

test("time is split into billable, non-billable and internal, from the entry if set, else its activity, else whether it is for a client", () => {
  const rows = [
    manualEntry({ date: "2026-11-10", minutes: 60, jobKey: "J1", clientKey: "C1", activityKey: "vat" }, "k", key, now).row!,
    manualEntry({ date: "2026-11-10", minutes: 30, clientKey: "C1", activityKey: "telephone-calls" }, "k", key, now).row!,
    manualEntry({ date: "2026-11-10", minutes: 45, activityKey: "training" }, "k", key, now).row!,
    manualEntry({ date: "2026-11-10", minutes: 15, clientKey: "C1", activityKey: "telephone-calls", billable: "billable" }, "k", key, now).row!, // overridden
    manualEntry({ date: "2026-11-10", minutes: 20, clientKey: "C1" }, "k", key, now).row!, // no activity: for a client
    manualEntry({ date: "2026-11-10", minutes: 10 }, "k", key, now).row!, // no activity, no client
  ].map(ent);
  const t = totalsByType(rows, DEFAULT_ACTIVITIES, "2026-11-10", "2026-11-10", now);
  assert.deepEqual(t, { billable: 95, nonbillable: 30, internal: 55, all: 180 });
  assert.equal(totalsByType(rows, DEFAULT_ACTIVITIES, "2026-11-11", "2026-11-12", now).all, 0);
});

test("the practice's own activity list is used when it has one, and falls back to the suggested ones", () => {
  assert.equal(activitiesFrom(undefined).length, 16);
  assert.equal(activitiesFrom([]).length, 16);
  const own = activitiesFrom([{ name: "Audit", category: "billable" }, { name: "Lunch", category: "weird", active: false }, { name: "" }]);
  assert.deepEqual(own.map((a) => [a.key, a.category, a.active]), [["audit", "billable", true], ["lunch", "internal", false]]);
});

test("a forgotten timer is corrected by stopping it at a time you give, never before it began", () => {
  const start = startRow(job, 1, "Prepare", "kevin", new Date("2026-11-09T09:00:00Z"), key);
  const e = ent(start);
  assert.equal(forgotten(e, now), true);
  assert.equal(entryMinutes(e, new Date("2026-11-09T10:00:00Z")), 60); // a running timer counts to now
  assert.match(stopAt(e, "2026-11-09T08:00:00Z").error!, /after the start/);
  assert.match(stopAt(e, "2026-11-12T09:00:00Z").error!, /more than a day/);
  const ok = stopAt(e, "2026-11-09T11:30:00Z");
  assert.deepEqual([ok.patch!.Hours, ok.patch!.WorkDate, ok.patch!.Version], [2.5, "2026-11-09", 2]);
  assert.equal(forgotten(ent({ ...start, Ended: "2026-11-09T11:00:00Z", Hours: 2 }), now), false);
});

test("time linked to a planned session adds up; time with no session is untouched by it", () => {
  const a = ent(manualEntry({ date: "2026-11-10", minutes: 60, jobKey: "J1", sessionKey: "PS1" }, "k", key, now).row!);
  const b = ent(manualEntry({ date: "2026-11-10", minutes: 30, jobKey: "J1", sessionKey: "PS1" }, "k", key, now).row!);
  const c = ent(manualEntry({ date: "2026-11-10", minutes: 45, jobKey: "J1" }, "k", key, now).row!);
  assert.equal(sessionMinutes([a, b, c], "PS1", now), 90);
  assert.equal(actualHours([a, b, c], "job", "J1"), 2.25);
});

test("hours typed in on finished work come in once as time entries; the total stays the same and a second run adds nothing", () => {
  const items = [
    { kind: "job" as const, key: "J1", clientKey: "C1", title: "Accounts", actual: 8, doneOn: "2026-10-30" },
    { kind: "job" as const, key: "J2", clientKey: "C1", title: "VAT", actual: 3, doneOn: "2026-10-31" },
    { kind: "task" as const, key: "T1", clientKey: "C2", title: "Call", actual: 0.5, doneOn: "" },
    { kind: "job" as const, key: "J3", clientKey: "C1", title: "None", actual: 0, doneOn: "" },
  ];
  const timed = ent(manualEntry({ date: "2026-10-29", minutes: 60, jobKey: "J2", clientKey: "C1" }, "k", key, now).row!);
  const first = legacyEntries(items, [timed], "kevin", now);
  assert.equal(first.rows.length, 3);
  assert.deepEqual(first.rows.map((r) => [r.Key, r.Hours]), [["JT-legacy-J1", 8], ["JT-legacy-J2", 2], ["JT-legacy-T1", 0.5]]); // J2 only gets what the timer doesn't hold
  const all = [timed, ...first.rows.map(ent)];
  assert.equal(actualHours(all, "job", "J1"), 8);
  assert.equal(actualHours(all, "job", "J2"), 3);
  assert.equal(actualHours(all, "task", "T1"), 0.5);
  assert.equal(legacyEntries(items, all, "kevin", now).rows.length, 0);
});
