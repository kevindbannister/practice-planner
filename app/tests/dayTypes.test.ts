import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_DAY_TYPES, clientHoursOn, dayHours, mergeDayTypes, typeOn, usualTypeKey } from "../src/lib/dayTypes";
import { DEFAULT_SETTINGS, readSettings } from "../src/lib/planning";
import { capacityBetween } from "../src/lib/forecast";
import { IMPORTANCE, WAIT_KINDS, holdAlert, holdLabel, holdPatch, importanceOf, isHoldText, resumePatch, waitingOn } from "../src/lib/domain";

const S = DEFAULT_SETTINGS;
// 2026-10-26 is a Monday
test("every weekday is a client day with the full hours until changed", () => {
  assert.equal(clientHoursOn("2026-10-26", S), 7.5);
  assert.equal(clientHoursOn("2026-10-30", S), 7.5);
  assert.equal(clientHoursOn("2026-10-31", S), 0); // Saturday
  assert.equal(typeOn("2026-10-31", S).key, "off");
});

test("a business day gives no client hours but has business hours", () => {
  const s = readSettings([{ Key: "week", Value: JSON.stringify({ "4": "business" }) } as any]);
  const thu = dayHours("2026-10-29", s);
  assert.equal(thu.type.key, "business");
  assert.equal(thu.client, 0);
  assert.equal(thu.business, 7.5);
  assert.equal(dayHours("2026-10-28", s).client, 7.5);
});

test("a mixed day splits the hours and the buffer is held back", () => {
  const s = readSettings([
    { Key: "dayTypes", Value: JSON.stringify([{ key: "mixed", client: 60, business: 40, buffer: 20 }, { key: "client", buffer: 10 }]) } as any,
    { Key: "week", Value: JSON.stringify({ "5": "mixed" }) } as any,
  ]);
  const fri = dayHours("2026-10-30", s);
  assert.equal(fri.client, 3.6); // 7.5 x 60% x 80%
  assert.equal(fri.business, 2.4);
  assert.equal(dayHours("2026-10-27", s).client, 6.75); // 7.5 less 10%
});

test("a change to one day beats the usual week, and going back clears it", () => {
  const s = readSettings([{ Key: "dayOverrides", Value: JSON.stringify({ "2026-10-28": "off", "2026-10-29": "business" }) } as any]);
  assert.equal(clientHoursOn("2026-10-28", s), 0);
  assert.equal(clientHoursOn("2026-10-29", s), 0);
  assert.equal(clientHoursOn("2026-10-30", s), 7.5);
  assert.equal(usualTypeKey(3, s), "client");
});

test("bad saved day types fall back to the built-in ones", () => {
  const t = mergeDayTypes([{ key: "client", name: " ", colour: "red", client: "x", buffer: 500 }, { nonsense: true }]);
  assert.equal(t.length, DEFAULT_DAY_TYPES.length);
  const c = t.find((x) => x.key === "client")!;
  assert.equal(c.name, "Client day");
  assert.equal(c.colour, "#0a84ff");
  assert.equal(c.client, 100);
  assert.equal(c.buffer, 100); // clamped
  assert.deepEqual(mergeDayTypes(undefined), DEFAULT_DAY_TYPES);
});

test("capacity between dates follows each day's type", () => {
  const s = readSettings([{ Key: "week", Value: JSON.stringify({ "4": "business", "5": "off" }) } as any]);
  // Mon 26 Oct to Sun 1 Nov: Mon, Tue, Wed client = 22.5
  assert.equal(capacityBetween("2026-10-26", "2026-11-01", (d) => clientHoursOn(d, s)), 22.5);
  // the old hours-per-weekday form still works
  assert.equal(capacityBetween("2026-10-26", "2026-11-01", S.hours), 37.5);
});

test("waiting on someone is a kind of hold with a chase date", () => {
  const patch = holdPatch("bank statements", "2026-11-05", "2026-10-23", "HMRC");
  const item = { ...patch };
  assert.equal(item.Status, "On hold");
  assert.equal(waitingOn(item), "HMRC");
  assert.equal(holdLabel(item), "Waiting on HMRC");
  assert.equal(holdAlert(item, "2027-01-31", "2026-11-04"), null);
  const due = holdAlert(item, "2027-01-31", "2026-11-05")!;
  assert.equal(due.level, "amber");
  assert.match(due.text, /^Waiting on HMRC: time to chase/);
  assert.ok(isHoldText(due.text));
  // close to the deadline it still shouts, and says who it's waiting on
  assert.match(holdAlert(item, "2026-11-10", "2026-11-01")!.text, /^Waiting on HMRC, but due in 9 days/);
  assert.match(holdAlert(item, "2026-10-01", "2026-11-01")!.text, /^Waiting on HMRC and past its deadline/);
});

test("parked work keeps its wording, and coming off hold clears who it was waiting on", () => {
  const parked = holdPatch("away", "2026-11-05", "2026-10-23");
  assert.equal(waitingOn(parked), "");
  assert.equal(holdLabel(parked), "On hold");
  assert.match(holdAlert(parked, undefined, "2026-11-06")!.text, /^On hold: time to look again/);
  const waiting = holdPatch("records", "", "2026-10-23", WAIT_KINDS[0]);
  const back = resumePatch(waiting, "2026-10-30");
  assert.equal(back.HoldKind, "");
  assert.equal(back.Status, "Open");
  assert.match(String(back.Notes), /Waiting on Client .* to 30 Oct 2026: records/);
  assert.equal(waitingOn({ Status: "Open", HoldKind: "Client" }), ""); // not on hold, not waiting
});

test("client importance defaults to normal", () => {
  assert.equal(importanceOf({}), "normal");
  assert.equal(importanceOf({ Importance: "key" }), "key");
  assert.equal(importanceOf({ Importance: "low" }), "low");
  assert.equal(importanceOf({ Importance: "whatever" }), "normal");
  assert.equal(IMPORTANCE.length, 3);
});
