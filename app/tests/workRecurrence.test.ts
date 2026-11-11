import test from "node:test";
import assert from "node:assert/strict";
import { parseRule, formatRule, nextAfter, preview, spawnNext, describeRule, Rule } from "../src/lib/work/recurrence";

const R = (t: string) => { const r = parseRule(t); assert.ok(!("error" in r), t); return r as Rule; };
test("parsing and canonical text", () => {
  assert.equal(formatRule(R("weekly:mon,thu")), "weekly:mon,thu"); assert.equal(formatRule(R("every monday")), "weekly:mon"); assert.equal(formatRule(R("weekdays")), "weekly:mon,tue,wed,thu,fri");
  assert.equal(formatRule(R("monthly:-1fri;until=2027-01-01")), "monthly:-1fri;until=2027-01-01");
  for (const bad of ["", "weekly", "monthly:40", "yearly:13-01", "fortnightly", "daily:1", "weekly/0:mon"]) assert.ok("error" in parseRule(bad), bad);
  assert.equal(describeRule(R("weekly/2:mon")), "Every 2 weeks on Monday");
});
test("weekly: every Monday, and every second Monday from an anchor", () => {
  assert.equal(nextAfter(R("weekly:mon"), "2026-11-11"), "2026-11-16"); assert.equal(nextAfter(R("weekly:mon"), "2026-11-16"), "2026-11-23");
  assert.equal(nextAfter(R("weekly/2:mon"), "2026-11-16", "2026-11-16"), "2026-11-30");
  assert.equal(nextAfter(R("weekly:mon,thu"), "2026-11-16"), "2026-11-19");
});
test("monthly: day, clamped to short months, last day, nth weekday", () => {
  assert.equal(nextAfter(R("monthly:31"), "2026-01-31"), "2026-02-28"); assert.equal(nextAfter(R("monthly:last"), "2026-02-28"), "2026-03-31");
  assert.equal(nextAfter(R("monthly:1mon"), "2026-11-02"), "2026-12-07"); assert.equal(nextAfter(R("monthly:-1fri"), "2026-11-11"), "2026-11-27");
  assert.equal(nextAfter(R("monthly/3:15"), "2026-01-15", "2026-01-15"), "2026-04-15");
});
test("daily and yearly, leap day, until", () => {
  assert.equal(nextAfter(R("daily/3"), "2026-11-11", "2026-11-11"), "2026-11-14"); assert.equal(nextAfter(R("yearly:02-29"), "2026-03-01"), "2027-02-28");
  assert.equal(nextAfter(R("weekly:mon;until=2026-11-20"), "2026-11-16"), undefined);
  assert.deepEqual(preview(R("weekly:mon"), "2026-11-11", 3), ["2026-11-16", "2026-11-23", "2026-11-30"]);
});
const base = { Key: "t1", Title: "Review bank feeds", RecurrenceRule: "weekly:mon", DueDate: "2026-11-09", Status: "Done", AssignedUser: "kevin", OwnerType: "user", ClientKey: "", Area: "practice" };
const ctx = (today = "2026-11-11") => { let n = 0; return { now: `${today}T09:00:00Z`, today, key: () => `n${++n}` }; };
test("finishing makes exactly the next one, after today if finished late", () => {
  const r = spawnNext(base, [base], ctx()); assert.equal(r.row!.DueDate, "2026-11-16"); assert.equal(r.row!.Status, "Open"); assert.equal(r.row!.SeriesKey, "t1"); assert.equal(r.row!.Title, "Review bank feeds"); assert.equal(r.row!.CaptureKey, "rec:t1:2026-11-16");
  assert.equal(spawnNext({ ...base, DueDate: "2026-11-23" }, [base], ctx()).row!.DueDate, "2026-11-30"); // finished early: not skipped
});
test("no duplicates: repeat, reopen and finish again, retry", () => {
  const first = spawnNext(base, [base], ctx()).row!;
  assert.equal(spawnNext(base, [base, first], ctx()).row, undefined);
  const afterReopen = [{ ...base, Status: "Done" }, first];
  assert.match(spawnNext(base, afterReopen, ctx()).reason, /already exists/);
  const doneFirst = { ...first, Status: "Done" };
  assert.equal(spawnNext(doneFirst, [base, doneFirst], ctx("2026-11-16")).row!.DueDate, "2026-11-23");
});
test("only finished occurrences spawn; ended series and bad rules do not; outside owner starts Not requested", () => {
  assert.equal(spawnNext({ ...base, Status: "Open" }, [base], ctx()).row, undefined); assert.equal(spawnNext({ ...base, Status: "Cancelled" }, [base], ctx()).row, undefined);
  assert.equal(spawnNext({ ...base, RecurrenceRule: "weekly:mon;until=2026-11-10" }, [base], ctx()).row, undefined);
  assert.equal(spawnNext({ ...base, RecurrenceRule: "nonsense" }, [base], ctx()).row, undefined);
  assert.equal(spawnNext({ ...base, OwnerType: "contact" }, [base], ctx()).row!.Status, "Not requested");
});
import { changeTask } from "../src/lib/work/tasks";
test("repeat rule is validated and canonicalised when saved on a task", () => {
  const rows = [{ Key: "a", Title: "x", Status: "Open", OwnerType: "user", Version: 1 }];
  const ok = changeTask(rows, "a", { repeat: "every monday" }, { user: "u", now: "2026-11-10T00:00:00Z" }) as { patch: Record<string, unknown> };
  assert.equal(ok.patch.RecurrenceRule, "weekly:mon");
  assert.ok("error" in changeTask(rows, "a", { repeat: "sometimes" }, { user: "u", now: "x" }));
});
