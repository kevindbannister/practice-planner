// Working papers: year ends and progress.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_ITEMS, progress, readItems, statusOf, yearEnds } from "../src/lib/papers";

test("year ends: newest past ones, and the next to come", () => {
  assert.deepEqual(yearEnds("03-31", "2026-10-19", 2), ["2027-03-31", "2026-03-31", "2025-03-31"]);
  assert.deepEqual(yearEnds("12-31", "2026-12-31", 1), ["2027-12-31", "2026-12-31"]); // year end today counts as past
  assert.deepEqual(yearEnds(undefined, "2026-10-19"), []);
});

test("a February month-end follows leap years", () => {
  assert.equal(yearEnds("02-28", "2024-06-01", 1)[0], "2025-02-28");
  assert.equal(yearEnds("02-28", "2024-06-01", 1)[1], "2024-02-29");
});

test("progress counts done and not needed as finished", () => {
  const items = DEFAULT_ITEMS.slice(0, 4);
  const rows = [
    { ClientKey: "C1", PeriodEnd: "2026-03-31", ItemKey: items[0].key, Status: "done" },
    { ClientKey: "C1", PeriodEnd: "2026-03-31", ItemKey: items[1].key, Status: "na" },
    { ClientKey: "C1", PeriodEnd: "2026-03-31", ItemKey: items[2].key, Status: "doing" },
    { ClientKey: "C2", PeriodEnd: "2026-03-31", ItemKey: items[3].key, Status: "done" },
  ];
  assert.deepEqual(progress(items, rows, "C1", "2026-03-31"), { done: 2, started: 1, total: 4 });
  assert.equal(statusOf(rows, "C1", "2025-03-31", items[0].key).status, "todo"); // a different year is a different paper
});

test("saved sections, or the standard list", () => {
  assert.equal(readItems(undefined), DEFAULT_ITEMS);
  assert.deepEqual(readItems([{ key: "a", title: "One" }, { key: "b", title: " " }]), [{ key: "a", title: "One" }]);
});
