// Order within a day, and subtasks.
import assert from "node:assert/strict";
import { test } from "node:test";
import { compareInDay, placeInDay } from "../src/lib/dayOrder";
import { progress, readSubtasks, writeSubtasks } from "../src/lib/subtasks";

const it = (key: string, o: any = {}) => ({ key, row: { DayOrder: o.order }, urgent: !!o.urgent, deadline: o.deadline });

test("ordered work first, then urgent, then deadline", () => {
  const list = [it("late", { deadline: "2026-12-01" }), it("first", { order: 1 }), it("urgent", { urgent: true }), it("soon", { deadline: "2026-10-20" })];
  assert.deepEqual(list.sort(compareInDay).map((x) => x.key), ["first", "urgent", "soon", "late"]);
});

test("moving within a day renumbers only what changes", () => {
  const a = it("a", { order: 1 }), b = it("b", { order: 2 }), c = it("c", { order: 3 });
  const r = placeInDay([a, b, c], c, 0);
  assert.deepEqual(r.order.map((x) => x.key), ["c", "a", "b"]);
  assert.deepEqual(r.changes.map((x) => [x.item.key, x.DayOrder]), [["c", 1], ["a", 2], ["b", 3]]);
  const down = placeInDay([a, b, c], a, 1); // a below b
  assert.deepEqual(down.order.map((x) => x.key), ["b", "a", "c"]);
  assert.deepEqual(down.changes.map((x) => [x.item.key, x.DayOrder]), [["b", 1], ["a", 2]]);
  // arriving from another day, dropped at the end
  const d = it("d", { order: 1 });
  assert.deepEqual(placeInDay([a, b], d).changes.map((x) => [x.item.key, x.DayOrder]), [["d", 3]]);
  // unordered work gets numbers once the day is arranged
  const u1 = it("u1", { deadline: "2026-10-20" }), u2 = it("u2", { deadline: "2026-10-21" });
  assert.deepEqual(placeInDay([u1, u2], u2, 0).changes.map((x) => [x.item.key, x.DayOrder]), [["u2", 1], ["u1", 2]]);
});

test("subtasks read, write and count", () => {
  const list = readSubtasks(JSON.stringify([{ id: "1", text: "Bank", done: true }, { id: "2", text: "Sales", done: false }, { text: " ", done: false }]));
  assert.deepEqual(progress(list), { done: 1, total: 2 });
  assert.equal(writeSubtasks(list), JSON.stringify([{ id: "1", text: "Bank", done: true }, { id: "2", text: "Sales", done: false }]));
  assert.deepEqual(readSubtasks("nonsense"), []);
});
