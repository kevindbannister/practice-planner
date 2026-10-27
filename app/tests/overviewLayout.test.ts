import test from "node:test";
import assert from "node:assert/strict";
import { COLS, columnsLayout, serialise, parseSaved, defaultLayout, moveItem, resizeItem, settle, reconcile, parseLayout, autoHeight, readingOrder, rowsFor, Layout } from "../src/lib/overviewLayout";

const M = { a: 20, b: 30, c: 10, d: 25 };
const overlaps = (l: Layout) => {
  for (const p of l) for (const q of l) if (p.id < q.id) {
    const hp = p.h ?? (M as any)[p.id], hq = q.h ?? (M as any)[q.id];
    if (p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + hq && q.y < p.y + hp) return true;
  }
  return false;
};

test("the default layout is three stacked columns in the given order", () => {
  const l = settle(defaultLayout([{ w: 20, ids: ["a", "b"] }, { w: 20, ids: ["c"] }, { w: 20, ids: ["d"] }]), M);
  const by = Object.fromEntries(l.map((i) => [i.id, i]));
  assert.deepEqual([by.a.x, by.a.y, by.b.x, by.b.y], [0, 0, 0, 20]);
  assert.deepEqual([by.c.x, by.c.y, by.d.x, by.d.y], [20, 0, 40, 0]);
  assert.equal(overlaps(l), false);
});

test("moving a card never overlaps another and keeps cards inside the grid", () => {
  const l0 = settle(defaultLayout([{ w: 10, ids: ["a", "b"] }, { w: 7, ids: ["c"] }, { w: 7, ids: ["d"] }]), M);
  const l1 = moveItem(l0, M, "c", 2, 5);
  assert.equal(overlaps(l1), false);
  const c = l1.find((i) => i.id === "c")!;
  assert.deepEqual([c.x, c.y], [2, 5]);
  const l2 = moveItem(l1, M, "d", 99, -4);
  const d = l2.find((i) => i.id === "d")!;
  assert.ok(d.x + d.w <= COLS && d.x >= 0 && d.y >= 0);
  assert.equal(overlaps(l2), false);
});

test("a card dragged into a gap pulls the cards below it up", () => {
  const l0 = settle(defaultLayout([{ w: 12, ids: ["a", "b"] }, { w: 12, ids: ["c"] }]), M);
  const l1 = moveItem(l0, M, "b", 12, 0);
  assert.equal(l1.find((i) => i.id === "b")!.y, 0);
  assert.equal(overlaps(l1), false);
});

test("resizing sets width and a fixed height, with limits", () => {
  const l0 = settle(defaultLayout([{ w: 12, ids: ["a"] }, { w: 12, ids: ["b"] }]), M);
  const l1 = resizeItem(l0, M, "a", 3, 2);
  const a = l1.find((i) => i.id === "a")!;
  assert.ok(a.w >= 5 && (a.h as number) >= 6);
  const l2 = resizeItem(l1, M, "a", 24, 40);
  assert.equal(l2.find((i) => i.id === "a")!.w, 24);
  assert.equal(overlaps(l2), false);
  assert.equal(autoHeight(l2, M, "a").find((i) => i.id === "a")!.h, undefined);
});

test("a resized card pushes the one beside it out of the way", () => {
  const l0 = settle(defaultLayout([{ w: 12, ids: ["a"] }, { w: 12, ids: ["b"] }]), M);
  const l1 = resizeItem(l0, M, "a", 20, undefined);
  assert.equal(overlaps(l1), false);
  assert.ok(l1.find((i) => i.id === "b")!.y >= 20);
});

test("reconcile drops cards that are gone and puts new ones at the bottom", () => {
  const fallback = defaultLayout([{ w: 12, ids: ["a", "b", "c"] }]);
  const saved: Layout = [{ id: "a", x: 0, y: 0, w: 12 }, { id: "gone", x: 12, y: 0, w: 12 }];
  const l = settle(reconcile(saved, ["a", "b", "c"], fallback), M);
  assert.deepEqual(l.map((i) => i.id).sort(), ["a", "b", "c"]);
  assert.equal(overlaps(l), false);
  assert.deepEqual(readingOrder(l)[0], "a");
});

test("parseLayout rejects rubbish and keeps good rows", () => {
  assert.equal(parseLayout("x"), null);
  assert.equal(parseLayout([{ id: 3 }]), null);
  assert.deepEqual(parseLayout([{ id: "a", x: 1, y: 2, w: 8, h: 12 }, { nope: 1 }]), [{ id: "a", x: 1, y: 2, w: 8, h: 12 }]);
  assert.ok(rowsFor(100) >= 6);
});

test("columnsLayout deals cards into 2 to 6 equal columns, balancing heights", () => {
  const ids = ["a", "b", "c", "d"];
  for (const n of [2, 3, 4, 5, 6]) {
    const l = settle(columnsLayout(n, ids, M), M);
    assert.equal(overlaps(l), false);
    assert.ok(l.every((i) => i.w === COLS / n && i.x % (COLS / n) === 0 && i.x + i.w <= COLS));
  }
  const two = columnsLayout(2, ids, M);
  assert.deepEqual(two.map((i) => i.x), [0, 30, 0, 30]); // a left, b right, c to the shorter left, d to the now-shorter right
});

test("saved layouts round-trip and the old 24-column format is ignored", () => {
  const items: Layout = [{ id: "a", x: 0, y: 0, w: 30, h: 12 }, { id: "b", x: 30, y: 0, w: 30 }];
  assert.deepEqual(parseSaved(JSON.parse(JSON.stringify(serialise(items, 3)))), { items, n: 3 });
  assert.deepEqual(parseSaved(serialise(items)), { items });
  assert.equal(parseSaved([{ id: "a", x: 0, y: 0, w: 12 }]), null);
  assert.equal(parseSaved(null), null);
  assert.deepEqual(parseSaved({ v: 2, n: 9, items }), { items });
});
