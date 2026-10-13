// The hour-by-hour view's layout.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_CAL } from "../src/lib/calendar";
import { gridRange, layoutDay, offHours, snap } from "../src/lib/dayGrid";

const prefs = { ...DEFAULT_CAL, dayStart: "09:00", dayEnd: "17:30", lunchStart: "13:00", lunchMins: 60 };

test("work fills the day in order, around lunch and meetings", () => {
  const busy: [number, number][] = [[600, 660]]; // meeting 10:00–11:00
  const r = layoutDay([{ key: "a", hours: 1 }, { key: "b", hours: 2.5 }, { key: "c", hours: 3 }, { key: "d", hours: 3 }], prefs, busy);
  const at = (k: string) => r.placed.find((p) => p.key === k)!.segments;
  assert.deepEqual(at("a"), [[540, 600]]); // 9–10
  assert.deepEqual(at("b"), [[660, 780], [840, 870]]); // 11–1, then 2–2:30 after lunch
  assert.deepEqual(at("c"), [[870, 1050]]); // 2:30–5:30
  assert.deepEqual(r.unfitted, ["d"]); // no room left
});

test("a start time puts work there; the rest flows round it", () => {
  const r = layoutDay([{ key: "a", hours: 2 }, { key: "b", hours: 1, start: "09:30" }], prefs, []);
  assert.deepEqual(r.placed.find((p) => p.key === "b")!.segments, [[570, 630]]);
  assert.equal(r.placed.find((p) => p.key === "b")!.pinned, true);
  assert.deepEqual(r.placed.find((p) => p.key === "a")!.segments, [[630, 750]]); // 9:00–9:30 is too short to start a 2-hour job in
});

test("clashes are flagged; range and shading", () => {
  const r = layoutDay([{ key: "x", hours: 1, start: "10:30" }], prefs, [[600, 660]]);
  assert.equal(r.placed[0].clash, true);
  assert.deepEqual(gridRange(prefs, []), [480, 1140]); // 8:00–19:00
  assert.deepEqual(gridRange(prefs, [[420, 450], [1200, 1230]]), [420, 1260]);
  assert.deepEqual(offHours(prefs, [480, 1140]), [[480, 540], [780, 840], [1050, 1140]]);
  assert.equal(snap(547), 540);
  assert.equal(snap(553), 555);
});

test("short gaps are left for short work", () => {
  const r = layoutDay([{ key: "pin", hours: 0.5, start: "09:30" }, { key: "long", hours: 2 }, { key: "short", hours: 0.5 }], prefs, []);
  assert.deepEqual(r.placed.find((p) => p.key === "long")!.segments, [[600, 720]]);
  assert.deepEqual(r.placed.find((p) => p.key === "short")!.segments, [[540, 570]]);
});
