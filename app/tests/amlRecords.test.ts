import test from "node:test";
import assert from "node:assert/strict";
import { storeFrom, storeWrites, legacyStore } from "../src/lib/amlPack.ts";
import { tooLong } from "../src/lib/textLimit.ts";

const rec = (id: string, created: string, v: Record<string, unknown> = {}) => ({ id, created, status: "Draft" as const, values: v });
const legacy = [{ Key: "aml.screening", Value: JSON.stringify({ records: [rec("r1", "2026-01-01", { client: "C1" })] }) }];
const o = { now: "2026-11-09T10:00:00Z", actor: "Kevin", pid: "P1" };

test("registers read from the AmlRecords list, falling back to the old Settings row until moved", () => {
  assert.equal(storeFrom([], legacy, "screening").records[0].id, "r1");
  const rows = [{ Key: "r2", Form: "screening", Data: JSON.stringify(rec("r2", "2026-02-01")) }, { Key: "x", Form: "training", Data: JSON.stringify(rec("x", "2026-01-01")) }, { Key: "bad", Form: "screening", Data: "{" }];
  assert.deepEqual(storeFrom(rows, legacy, "screening").records.map((r) => r.id), ["r2"]);
  assert.deepEqual(storeFrom(rows, [], "actions").records, []);
  assert.deepEqual(legacyStore([{ Key: "aml.screening", Value: "not json" }], "screening").records, []);
});

test("saving writes one row per record: creates new ones, updates changed ones, removes deleted ones, and empties the old Settings row once", () => {
  const first = storeWrites([], legacy, "screening", { records: [rec("r1", "2026-01-01", { client: "C1" }), rec("r2", "2026-02-01")] }, o);
  assert.deepEqual(first.creates.map((r) => [r.Key, r.Form, r.PracticeId]), [["r1", "screening", "P1"], ["r2", "screening", "P1"]]);
  assert.equal(first.clearLegacy, true);
  const rows = first.creates;
  const second = storeWrites(rows, [{ Key: "aml.screening", Value: JSON.stringify({ records: [], movedTo: "AmlRecords" }) }], "screening", { records: [rec("r1", "2026-01-01", { client: "C2" })] }, o);
  assert.equal(second.creates.length, 0); assert.equal(second.updates.length, 1); assert.equal(second.updates[0].row.Key, "r1");
  assert.deepEqual(second.removes.map((r) => r.Key), ["r2"]); assert.equal(second.clearLegacy, false);
  const same = storeWrites(rows.slice(0, 1), [], "screening", { records: [rec("r1", "2026-01-01", { client: "C1" })] }, o);
  assert.equal(same.updates.length + same.creates.length + same.removes.length, 0);
});

test("text over the SharePoint limit is refused with a clear message", () => {
  assert.doesNotThrow(() => tooLong("Settings", { Value: "x".repeat(60000) }));
  assert.throws(() => tooLong("Settings", { Value: "x".repeat(60001) }), /too long to save in SharePoint \(Value in Settings/);
});
