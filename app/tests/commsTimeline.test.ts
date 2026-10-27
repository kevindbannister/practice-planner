import { test } from "node:test";
import assert from "node:assert/strict";
import { channelCounts, commEntries, groupByMonth } from "../src/lib/commsTimeline.ts";
import type { Activity, ActivityType } from "../src/lib/timeline.ts";

const act = (id: string, type: ActivityType, at: string, title = id, summary = ""): Activity => ({ id, clientKey: "C1", type, group: "notes", title, summary, at, dateOnly: false, actor: "", source: "x", sourceKey: id, confidential: false });

{
  const all = [act("a", "email-in", "2026-10-02T09:00:00"), act("b", "text-out", "2026-10-20T10:00:00", "Chased bank statements"), act("c", "job-created", "2026-10-21T10:00:00"), act("d", "call", "2026-09-30T10:00:00"), act("e", "meeting", "2026-09-01T10:00:00", "Year end meeting", "Location: office")];
  test("keeps only communications, newest first", () => {
    assert.deepEqual(commEntries(all).map((a) => a.id), ["b", "a", "d", "e"]);
  });
  test("filters by channel, date and text", () => {
    assert.deepEqual(commEntries(all, { channels: ["text", "call"] }).map((a) => a.id), ["b", "d"]);
    assert.deepEqual(commEntries(all, { from: "2026-10-01" }).map((a) => a.id), ["b", "a"]);
    assert.deepEqual(commEntries(all, { q: "bank" }).map((a) => a.id), ["b"]);
    assert.deepEqual(commEntries(all, { q: "boardroom", extra: (a) => (a.id === "e" ? "Boardroom" : "") }).map((a) => a.id), ["e"]);
  });
  test("groups by month", () => {
    assert.deepEqual(groupByMonth(commEntries(all)).map((g) => [g.label, g.items.length]), [["October 2026", 2], ["September 2026", 2]]);
  });
  test("counts channels", () => {
    assert.deepEqual(channelCounts(all), { email: 1, text: 1, call: 1, meeting: 1, letter: 0 });
  });
}