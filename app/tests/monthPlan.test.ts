import test from "node:test";
import assert from "node:assert/strict";
import { buildMonth, shiftMonth, weeksOf, MonthItem } from "../src/lib/monthPlan";

const I = (o: Partial<MonthItem>): MonthItem => ({ key: "k", kind: "job", title: "VAT", client: "Acme", hours: 2, planned: "", deadline: "", statutory: true, held: false, done: false, doneOn: "", ...o });
const cap = (d: string) => { const w = new Date(`${d}T00:00:00Z`).getUTCDay(); return w >= 1 && w <= 5 ? 6 : 0; };
test("weeks cover the month Monday to Sunday", () => {
  const w = weeksOf("2026-11"); assert.equal(w.length, 6); assert.equal(w[0][0], "2026-10-26"); assert.equal(w[5][0], "2026-11-30"); assert.equal(weeksOf("2027-02").length, 4);
  assert.equal(shiftMonth("2026-12", 1), "2027-01"); assert.equal(shiftMonth("2026-01", -1), "2025-12");
});
test("planned work, hours against capacity, due dates and finished work land on the right days", () => {
  const m = buildMonth("2026-11", [I({ key: "a", planned: "2026-11-10", hours: 4 }), I({ key: "b", planned: "2026-11-10", hours: 3, statutory: false }), I({ key: "c", deadline: "2026-11-12" }), I({ key: "d", done: true, doneOn: "2026-11-05" }), I({ key: "h", planned: "2026-11-10", held: true })], cap, "2026-11-11");
  const cell = (d: string) => m.weeks.flat().find((c) => c.date === d)!;
  assert.equal(cell("2026-11-10").planned.length, 2); assert.equal(cell("2026-11-10").plannedHours, 7); assert.equal(cell("2026-11-10").over, true); assert.equal(cell("2026-11-10").capacity, 6);
  assert.equal(cell("2026-11-12").due.length, 1); assert.equal(cell("2026-11-05").done.length, 1); assert.equal(cell("2026-11-11").today, true); assert.equal(cell("2026-11-14").weekend, true);
  assert.equal(m.totals.due, 1); assert.equal(m.totals.unplanned, 1); assert.equal(m.totals.planned, 7);
});
test("statutory and other filters; days outside the month are shown but not totalled", () => {
  const items = [I({ key: "s", planned: "2026-11-10" }), I({ key: "o", planned: "2026-11-10", statutory: false }), I({ key: "x", planned: "2026-10-28", hours: 5 })];
  assert.equal(buildMonth("2026-11", items, cap, "2026-11-01", "statutory").weeks.flat().find((c) => c.date === "2026-11-10")!.planned.length, 1);
  assert.equal(buildMonth("2026-11", items, cap, "2026-11-01", "other").weeks.flat().find((c) => c.date === "2026-11-10")!.planned[0].key, "o");
  const all = buildMonth("2026-11", items, cap, "2026-11-01"); assert.equal(all.weeks[0].find((c) => c.date === "2026-10-28")!.planned.length, 1); assert.equal(all.totals.planned, 4);
});
import { unplannedOf } from "../src/lib/monthPlan";
test("unplanned: only open, unheld, unplanned work, earliest deadline first, undated last; follows filter and search", () => {
  const list = [I({ key: "a", deadline: "2026-12-01", client: "Zed" }), I({ key: "b", deadline: "2026-11-20", client: "Amy" }), I({ key: "c", client: "Bob", statutory: false }), I({ key: "p", planned: "2026-11-10" }), I({ key: "h", held: true }), I({ key: "d", done: true })];
  assert.deepEqual(unplannedOf(list).map((i) => i.key), ["b", "a", "c"]);
  assert.deepEqual(unplannedOf(list, "statutory").map((i) => i.key), ["b", "a"]); assert.deepEqual(unplannedOf(list, "other").map((i) => i.key), ["c"]);
  assert.deepEqual(unplannedOf(list, "all", "zed").map((i) => i.key), ["a"]);
});

test("the unplanned list can be narrowed by deadline, type of work and client", async () => {
  const { unplannedOf } = await import("../src/lib/monthPlan");
  const mk = (o: any) => ({ key: o.key, kind: o.kind || "job", title: "T", client: o.client, serviceKey: o.serviceKey, hours: 1, planned: "", deadline: o.deadline || "", statutory: true, held: false, done: false, doneOn: "" });
  const items: any[] = [
    mk({ key: "a", client: "Acme", serviceKey: "ACCS_LTD", deadline: "2026-11-01" }),
    mk({ key: "b", client: "Beta", serviceKey: "CS01", deadline: "2026-11-30" }),
    mk({ key: "c", client: "Acme", kind: "task" }),
    mk({ key: "d", client: "Beta", serviceKey: "ACCS_LTD", deadline: "2027-06-01" }),
  ];
  const ids = (f: any) => unplannedOf(items, "all", "", f, "2026-11-13").map((i) => i.key);
  assert.deepEqual(ids({}), ["a", "b", "d", "c"]);
  assert.deepEqual(ids({ due: "overdue" }), ["a"]);
  assert.deepEqual(ids({ due: "30" }), ["a", "b"]);
  assert.deepEqual(ids({ due: "none" }), ["c"]);
  assert.deepEqual(ids({ type: "ACCS_LTD" }), ["a", "d"]);
  assert.deepEqual(ids({ type: "TASK" }), ["c"]);
  assert.deepEqual(ids({ client: "Acme", due: "overdue" }), ["a"]);
});

test("a rolling view is six whole weeks from this week's Monday, all counted", async () => {
  const { rollingWeeks, buildMonth } = await import("../src/lib/monthPlan");
  const w = rollingWeeks("2026-11-13", 6);
  assert.equal(w.length, 6);
  assert.equal(w[0][0], "2026-11-09");
  assert.equal(w[5][6], "2026-12-20");
  const item: any = { key: "a", kind: "job", title: "T", client: "C", hours: 2, planned: "2026-12-18", deadline: "", statutory: true, held: false, done: false, doneOn: "" };
  const r = buildMonth("2026-11", [item], () => 7, "2026-11-13", "all", w);
  assert.equal(r.weeks.length, 6);
  assert.ok(r.weeks.flat().every((c) => c.inMonth), "none greyed out as another month");
  assert.equal(r.totals.planned, 2, "work planned in December counts in a view that starts in November");
});
