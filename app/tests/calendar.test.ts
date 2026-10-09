// Outlook calendar: busy time, capacity, fitting blocks, and keeping them in step.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CalEvent, DEFAULT_CAL, busyOn, capacityOn, diffBlocks, eventBody, freeGaps, layoutBlocks, localDay, meetingHours } from "../src/lib/calendar";

const at = (day: string, hm: string) => new Date(localDay(day).getTime() + (Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3))) * 60000);
const ev = (o: Partial<CalEvent> & { day: string; from: string; to: string }): CalEvent => ({
  id: o.id || Math.random().toString(36), subject: o.subject || "Meeting", start: at(o.day, o.from), end: at(o.day, o.to),
  allDay: false, showAs: o.showAs || "busy", cancelled: !!o.cancelled, block: o.block,
});
const D = "2026-10-12";

test("busy time: meetings count, free/cancelled/our own blocks don't", () => {
  const events = [
    ev({ day: D, from: "10:00", to: "11:00" }),
    ev({ day: D, from: "10:30", to: "11:30" }), // overlaps: merged
    ev({ day: D, from: "15:00", to: "16:00", showAs: "free" }),
    ev({ day: D, from: "16:00", to: "17:00", cancelled: true }),
    ev({ day: D, from: "09:00", to: "10:00", block: "J1#1" }),
    ev({ day: "2026-10-13", from: "10:00", to: "11:00" }),
  ];
  assert.deepEqual(busyOn(D, events), [[600, 690]]);
});

test("free gaps and capacity around lunch and meetings", () => {
  assert.deepEqual(freeGaps(DEFAULT_CAL, []), [[540, 780], [840, 1050]]); // 9-1, 2-5:30
  const busy = busyOn(D, [ev({ day: D, from: "10:00", to: "11:30" }), ev({ day: D, from: "12:45", to: "14:15" })]);
  assert.deepEqual(freeGaps(DEFAULT_CAL, busy), [[540, 600], [690, 765], [855, 1050]]);
  assert.equal(meetingHours(DEFAULT_CAL, busy), 1.5 + 0.5); // lunch doesn't count as a meeting
  assert.equal(capacityOn(7.5, DEFAULT_CAL, busy), 5.5);
  // an all-day out-of-office leaves nothing
  const away = busyOn(D, [{ ...ev({ day: D, from: "00:00", to: "00:00" }), start: localDay(D), end: localDay("2026-10-13"), allDay: true, showAs: "oof" }]);
  assert.equal(capacityOn(7.5, DEFAULT_CAL, away), 0);
});

test("blocks fit around meetings, splitting across a meeting, and skip work that won't fit", () => {
  const busy = { [D]: busyOn(D, [ev({ day: D, from: "10:00", to: "11:00" })]) };
  const { blocks, unfitted } = layoutBlocks([
    { key: "A", day: D, hours: 2, subject: "Acme: Accounts", note: "" },
    { key: "B", day: D, hours: 1.5, subject: "Beta: VAT", note: "" },
    { key: "C", day: D, hours: 9, subject: "Big", note: "" },
  ], DEFAULT_CAL, busy);
  assert.deepEqual(blocks.map((b) => [b.id, b.start, b.end]), [["A#1", 540, 600], ["A#2", 660, 720], ["B#1", 720, 780], ["B#2", 840, 870]]);
  assert.deepEqual(unfitted, ["C"]);
});

test("keeping the calendar in step: create, move, remove only our blocks from today", () => {
  const wanted = [
    { id: "A#1", day: D, start: 540, end: 660, subject: "Acme: Accounts", note: "" },
    { id: "B#1", day: D, start: 660, end: 720, subject: "Beta: VAT", note: "" },
  ];
  const existing = [
    ev({ id: "e1", day: D, from: "09:00", to: "11:00", block: "A#1", subject: "Acme: Accounts" }), // unchanged
    ev({ id: "e2", day: D, from: "14:00", to: "15:00", block: "B#1", subject: "Beta: VAT" }), // moved
    ev({ id: "e3", day: D, from: "15:00", to: "16:00", block: "OLD#1" }), // no longer planned
    ev({ id: "e4", day: "2026-10-09", from: "09:00", to: "10:00", block: "PAST#1" }), // before today: left alone
    ev({ id: "e5", day: D, from: "16:00", to: "17:00" }), // not ours
  ];
  const c = diffBlocks(wanted, existing, D);
  assert.deepEqual(c.create, []);
  assert.deepEqual(c.update.map((u) => u.id), ["e2"]);
  assert.deepEqual(c.remove, ["e3"]);
});

test("event body is tagged as the planner's", () => {
  const body = eventBody({ id: "A#1", day: D, start: 540, end: 600, subject: "Acme: Accounts", note: "Due 31 Oct" }, DEFAULT_CAL);
  assert.equal(body.categories[0], "Practice Planner");
  assert.equal(body.singleValueExtendedProperties[0].value, "A#1");
  assert.equal(body.start.timeZone, "UTC");
  assert.equal(new Date(body.start.dateTime + "Z").getTime(), at(D, "09:00").getTime());
});
