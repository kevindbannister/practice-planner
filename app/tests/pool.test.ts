import { test } from "node:test";
import assert from "node:assert/strict";
import { mapPool } from "../src/lib/pool.ts";

test("results come back in order and never more than the limit run at once", async () => {
  let live = 0, peak = 0;
  const out = await mapPool([30, 5, 20, 1, 10, 2, 8], 3, async (ms, i) => {
    live++; peak = Math.max(peak, live);
    await new Promise((r) => setTimeout(r, ms));
    live--; return i * 2;
  });
  assert.deepEqual(out, [0, 2, 4, 6, 8, 10, 12]);
  assert.equal(peak, 3);
});

test("a failure rejects, and an empty list is fine", async () => {
  await assert.rejects(mapPool([1, 2, 3], 2, async (x) => { if (x === 2) throw new Error("boom"); return x; }), /boom/);
  assert.deepEqual(await mapPool([], 4, async (x) => x), []);
});
