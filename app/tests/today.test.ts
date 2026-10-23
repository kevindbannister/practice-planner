import test from "node:test";
import assert from "node:assert/strict";
import { buildToday, Work } from "../src/lib/today";

const W = (o: Partial<Work> = {}): Work => ({ key: "a", kind: "job", title: "Accounts", client: "Acme", hours: 2, urgent: false, importance: "normal", business: false, held: false, blocked: false, ...o });
// Wed 21 Oct 2026; Mon-Fri client except Thu/Fri business (7.5h days)
const today = "2026-10-21";
const typ = (d: string) => (["2026-10-22", "2026-10-23"].includes(d) ? { key: "business", name: "Business day", business: 7.5 } : { key: "client", name: "Client day", business: 0 });
const capacity = (d: string, asType?: string) => { const wd = new Date(d + "T00:00:00Z").getUTCDay(); if (wd === 0 || wd === 6) return 0; return asType === "client" || typ(d).key === "client" ? 7.5 : 0; };
const run = (work: Work[], day = { client: 7.5, business: 0, typeName: "Client day" }) => buildToday({ today, work, day, capacity, dayType: typ });

test("late and planned work come first, with reasons", () => {
  const t = run([W({ key: "p", planned: today, deadline: "2026-12-01" }), W({ key: "l", deadline: "2026-10-19" })]);
  assert.deepEqual(t.lines.map((l) => l.key), ["l", "p"]);
  assert.equal(t.lines[0].level, "red");
  assert.match(t.lines[0].reasons[0], /2 days late/);
});
test("suggestions fill the day by deadline, urgent and key clients lifted", () => {
  const t = run([
    W({ key: "far", deadline: "2026-11-30", hours: 3 }), W({ key: "near", deadline: "2026-10-28", hours: 3 }),
    W({ key: "key", deadline: "2026-11-08", hours: 3, importance: "key" }),
  ]);
  assert.equal(t.suggested[0].key, "near");
  assert.ok(t.suggested.length === 2); // 6h of 6.75h; the third doesn't fit
});
test("held work isn't planned; chase date work shows to chase", () => {
  const t = run([W({ key: "h", held: true, chaseOn: "2026-10-20", heldLabel: "Waiting on Client", deadline: "2026-11-01" })]);
  assert.equal(t.lines.length, 0); assert.equal(t.chase.length, 1);
});
test("business day shows business work against business hours", () => {
  const t = run([W({ key: "b", business: true, hours: 2, projectTitle: "Website" })], { client: 0, business: 7.5, typeName: "Business day" });
  assert.equal(t.business.length, 1); assert.match(t.business[0].reasons[0], /Website/);
});
test("work that can't fit suggests turning business days into client days", () => {
  const work = [W({ key: "x", hours: 14, deadline: "2026-10-24" }), W({ key: "b", business: true, planned: "2026-10-22", title: "Update website" })];
  const t = run(work);
  assert.equal(t.conflicts.length, 1);
  assert.deepEqual(t.conflicts[0].days.map((d) => d.date), ["2026-10-22"]);
  assert.deepEqual(t.conflicts[0].days[0].businessWork, ["Update website"]);
});
test("no conflict when it fits", () => assert.equal(run([W({ hours: 4, deadline: "2026-10-24" })]).conflicts.length, 0));

test("late work you put on a later day stays there", () => {
  const t = run([W({ key: "l", deadline: "2026-10-19", planned: "2026-10-26" })]);
  assert.equal(t.lines.length, 0);
});
test("work waiting on the client shows to chase when due soon, and counts in clashes", () => {
  const t = run([W({ key: "w", blocked: true, blockedWhy: "Records not in yet", deadline: "2026-10-27" }), W({ key: "far", blocked: true, deadline: "2026-12-28" })]);
  assert.deepEqual(t.chase.map((l) => l.key), ["w"]);
  assert.equal(t.chase[0].reasons[0], "Records not in yet");
  assert.equal(t.suggested.length, 0);
  const c = run([W({ key: "w", blocked: true, hours: 14, deadline: "2026-10-24" })]);
  assert.equal(c.conflicts.length, 1);
});
test("blocked work you planned for today still shows, with why", () => {
  const t = run([W({ key: "p", blocked: true, blockedWhy: "Records not in yet", planned: today })]);
  assert.equal(t.lines.length, 1); assert.ok(t.lines[0].reasons.includes("Records not in yet"));
});
test("long-late work doesn't raise a clash every day", () => {
  assert.equal(run([W({ key: "old", hours: 30, deadline: "2026-03-20" })]).conflicts.length, 0);
});
