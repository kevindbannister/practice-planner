import test from "node:test";
import assert from "node:assert/strict";
import { afterSync, cleanTranscript, contextFromHash, discard, enqueue, looksOffline, parseQueue, parseShare, quickDate, serializeQueue, syncPlan, MAX_ATTEMPTS } from "../src/lib/work/capture";

test("quick dates: never in the past; weekend rolls forward", () => {
  // Wed 2026-11-11
  assert.deepEqual(["today", "tomorrow", "this_week", "next_week"].map((k) => quickDate(k as never, "2026-11-11")), ["2026-11-11", "2026-11-12", "2026-11-13", "2026-11-16"]);
  assert.equal(quickDate("this_week", "2026-11-13"), "2026-11-13", "on Friday it is today");
  assert.equal(quickDate("this_week", "2026-11-14"), "2026-11-14", "Saturday: not a past Friday");
  assert.equal(quickDate("next_week", "2026-11-15"), "2026-11-16", "Sunday: tomorrow is next Monday");
  assert.equal(quickDate("next_week", "2026-11-09"), "2026-11-16", "Monday: the Monday after");
  assert.equal(quickDate("tomorrow", "2026-12-31"), "2027-01-01");
});
test("where a new task goes follows the screen; anything else is the Inbox", () => {
  const n = { client: (k: string) => (k === "C1" ? "BCK Interiors" : "") };
  assert.deepEqual(contextFromHash("#/clients/C1/tasks", n), { clientKey: "C1", label: "BCK Interiors" });
  assert.equal(contextFromHash("#/clients/C1/meetings", n).clientKey, "C1");
  assert.equal(contextFromHash("#/clients?c=C1", n).clientKey, "C1");
  for (const h of ["#/plan/today", "#/clients/all", "", "#/home", "#/settings"]) assert.deepEqual(contextFromHash(h), { label: "Inbox" }, h);
});
test("shared links and text become a task and keep everything shared", () => {
  assert.deepEqual(parseShare("?title=Article&text=Read%20this&url=https%3A%2F%2Fx.co%2Fa"), { title: "Article", notes: "Article\nRead this\nhttps://x.co/a" });
  assert.deepEqual(parseShare("?url=https%3A%2F%2Fx.co%2Fa"), { title: "https://x.co/a", notes: "" });
  assert.equal(parseShare("?text=Line%20one%0ALine%20two")!.title, "Line one");
  assert.equal(parseShare("?foo=1"), null); assert.equal(parseShare(""), null);
  assert.equal(parseShare("?title=" + "x".repeat(500))!.title.length, 300);
});
test("speech is tidied but still needs the person's confirmation", () => {
  assert.equal(cleanTranscript("  book the dentist next tuesday. "), "Book the dentist next tuesday"); assert.equal(cleanTranscript(" . "), "");
});

const row = (id: string, t = "A") => ({ Key: "T" + id, Title: t, CaptureKey: id });
test("queue: dedupes by capture key; sync creates only what isn't saved; never twice", () => {
  let q = enqueue([], row("a"), "t1"); q = enqueue(q, row("b"), "t2"); q = enqueue(q, row("a", "again"), "t3");
  assert.equal(q.length, 2); assert.equal(q[0].row.Title, "A");
  const plan = syncPlan(q, ["a"]); assert.deepEqual([plan.create.map((x) => x.id), plan.drop.map((x) => x.id)], [["b"], ["a"]]);
  const after = afterSync(q, ["b"], []); assert.deepEqual(after.map((x) => x.id), ["a"], "saved ones leave the queue");
  assert.deepEqual(syncPlan(afterSync(q, ["a", "b"], []), []).create, [], "running sync again does nothing");
  assert.throws(() => enqueue([], { Key: "x", Title: "no key" }, "t"));
});
test("failures are counted, kept, and eventually held back for the person to see", () => {
  let q = enqueue([], row("a"), "t");
  for (let i = 0; i < MAX_ATTEMPTS; i++) q = afterSync(q, [], [{ id: "a", error: "403" }]);
  assert.equal(q[0].attempts, MAX_ATTEMPTS); assert.equal(q[0].error, "403");
  const p = syncPlan(q, []); assert.deepEqual([p.create.length, p.stuck.length], [0, 1]);
  assert.deepEqual(discard(q, "a"), []);
});
test("a damaged or tampered stored queue is dropped, not trusted", () => {
  const good = serializeQueue(enqueue([], row("a"), "t")); assert.equal(parseQueue(good).length, 1);
  for (const bad of ["", "nope", "{}", "[1,2]", JSON.stringify([{ id: "a", row: { Title: "x", CaptureKey: "other" } }]), JSON.stringify([{ id: "a", row: { Title: " ", CaptureKey: "a" } }]), null as never]) assert.deepEqual(parseQueue(bad), []);
});
test("offline detection: offline browser or a network failure queues; a refusal does not", () => {
  assert.equal(looksOffline(false, new Error("x")), true); assert.equal(looksOffline(true, new TypeError("Failed to fetch")), true);
  assert.equal(looksOffline(true, new Error("403 Forbidden")), false); assert.equal(looksOffline(true, new Error("Request timed out")), true);
});
