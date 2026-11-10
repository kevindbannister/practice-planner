import assert from "node:assert/strict";
import { test } from "node:test";
import { Plan, Session, applyPlan, chainOf, committedMinutes, conclude, createSessions, eventRow, historical, migrateLegacy, movedTo, operational, plannedAhead, projectDate, readEvent, readSession, reassign, reschedule, rescheduleMany, resize, sessionRow, split, toReview, undoBatch, undoable, PlanEvent } from "../src/lib/planSessions";

let n = 0;
const ctx = (user = "kevin", now = "2026-11-02T18:00:00Z") => ({ now, user, newKey: (p: string) => `${p}${++n}` });
const accounts = { kind: "job" as const, itemKey: "J1", clientKey: "C1", title: "Annual accounts", date: "2026-11-02", minutes: 180 };

/** A small in-memory run of the lists, so a test can do things the way the screens do. */
function world() {
  let sessions: Session[] = [], events: PlanEvent[] = [];
  const run = (p: Plan) => {
    const r = applyPlan(sessions, p);
    sessions = r.sessions;
    events = [...events, ...p.events.filter((e) => !r.conflicts.includes(e.sessionKey))];
    return r;
  };
  return { run, get sessions() { return sessions; }, get events() { return events; } };
}

test("Scenario A: three hours planned for Monday, not done, moved to Tuesday: Monday stays with its outcome and Tuesday holds the live session", () => {
  const w = world();
  w.run(createSessions([accounts], ctx()));
  const mon = w.sessions[0];
  w.run(reschedule(mon, { toDate: "2026-11-03", reason: "Client records late" }, ctx()));
  const [m, t] = w.sessions;
  assert.equal(m.status, "rescheduled");
  assert.equal(m.minutes, 180); // what was planned is kept
  assert.equal(m.date, "2026-11-02");
  assert.equal(m.actualMinutes, 0);
  assert.equal(m.reason, "Client records late");
  assert.equal(t.status, "planned");
  assert.equal(t.date, "2026-11-03");
  assert.equal(t.minutes, 180);
  assert.equal(t.originalKey, m.key);
  assert.equal(m.replacedByKey, t.key);
  assert.equal(movedTo(m, w.sessions)?.key, t.key);
  // history still shows Monday; the live view shows only Tuesday
  assert.deepEqual(historical(w.sessions, "2026-11-02", "2026-11-02").map((x) => x.key), [m.key]);
  assert.deepEqual(operational(w.sessions, "2026-11-01", "2026-11-30").map((x) => x.key), [t.key]);
});

test("Scenario B: three hours planned, one worked, the rest moved: Monday is partly completed and Tuesday holds only the two hours left", () => {
  const w = world();
  w.run(createSessions([accounts], ctx()));
  w.run(reschedule(w.sessions[0], { toDate: "2026-11-03", actualMinutes: 60, reason: "Ran out of time" }, ctx()));
  const [m, t] = w.sessions;
  assert.equal(m.status, "partial");
  assert.equal(m.actualMinutes, 60);
  assert.equal(m.minutes, 180);
  assert.equal(t.minutes, 120);
  // a revised estimate is the user's to give: it is not just the planned time less the time worked
  const w2 = world();
  w2.run(createSessions([accounts], ctx()));
  w2.run(reschedule(w2.sessions[0], { toDate: "2026-11-03", actualMinutes: 60, remainingMinutes: 240, reason: "Bigger than thought" }, ctx()));
  assert.equal(w2.sessions[1].minutes, 240);
});

test("Scenario F: rescheduled three times, every session is traceable and only the live one takes capacity", () => {
  const w = world();
  w.run(createSessions([accounts], ctx()));
  for (const d of ["2026-11-03", "2026-11-04", "2026-11-05"]) {
    const live = w.sessions.find((x) => x.status === "planned")!;
    w.run(reschedule(live, { toDate: d, reason: "Moved" }, ctx()));
  }
  assert.equal(w.sessions.length, 4);
  assert.deepEqual(chainOf(w.sessions, w.sessions[3].key).map((x) => x.date), ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"]);
  assert.equal(chainOf(w.sessions, w.sessions[0].key).length, 4);
  for (const d of ["2026-11-02", "2026-11-03", "2026-11-04"]) assert.equal(committedMinutes(w.sessions, d), 0, d);
  assert.equal(committedMinutes(w.sessions, "2026-11-05"), 180);
  assert.equal(plannedAhead(w.sessions, "J1", "2026-11-01"), 180); // not 720
});

test("a six hour job can have several sessions, all on the one job", () => {
  const w = world();
  w.run(createSessions([120, 90, 120, 30].map((m, i) => ({ ...accounts, date: `2026-11-0${[2, 3, 5, 6][i]}`, minutes: m })), ctx()));
  assert.equal(w.sessions.length, 4);
  assert.equal(plannedAhead(w.sessions, "J1", "2026-11-01"), 360);
  assert.equal(projectDate(w.sessions, "J1", "2026-11-04"), "2026-11-05"); // the next one still to come
  assert.equal(projectDate(w.sessions, "J1", "2026-11-01"), "2026-11-02");
  assert.equal(projectDate(w.sessions, "NOPE", "2026-11-01"), "");
});

test("a session still to be reviewed is one that is planned for today or earlier; finishing one doesn't finish the job", () => {
  const w = world();
  w.run(createSessions([accounts, { ...accounts, date: "2026-11-09" }], ctx()));
  assert.deepEqual(toReview(w.sessions, "2026-11-03").map((x) => x.date), ["2026-11-02"]);
  w.run(conclude(w.sessions[0], { outcome: "completed", actualMinutes: 200 }, ctx()));
  assert.equal(w.sessions[0].status, "completed");
  assert.equal(w.sessions[0].actualMinutes, 200); // more than planned is fine; nothing is completed for the user
  assert.equal(toReview(w.sessions, "2026-11-03").length, 0);
  assert.equal(projectDate(w.sessions, "J1", "2026-11-03"), "2026-11-09"); // the later session carries on
});

test("a session that is history can't be moved, finished or changed again", () => {
  const w = world();
  w.run(createSessions([accounts], ctx()));
  w.run(conclude(w.sessions[0], { outcome: "cancelled", reason: "Client left" }, ctx()));
  const x = w.sessions[0];
  for (const p of [reschedule(x, { toDate: "2026-11-09", reason: "" }, ctx()), conclude(x, { outcome: "completed" }, ctx()), resize(x, 60, ctx()), split(x, [{ date: "2026-11-04", minutes: 60 }, { date: "2026-11-05", minutes: 60 }], ctx()), reassign(x, "sam", ctx())]) {
    assert.equal(p.creates.length + p.patches.length + p.events.length, 0);
    assert.ok(p.problems.length);
  }
});

test("hours, person and splitting change a session that is still to happen and are logged with before and after", () => {
  const w = world();
  w.run(createSessions([accounts], ctx()));
  w.run(resize(w.sessions[0], 240, ctx(), "More to do"));
  assert.equal(w.sessions[0].minutes, 240);
  w.run(reassign(w.sessions[0], "sam", ctx()));
  assert.equal(w.sessions[0].userKey, "sam");
  const ev = w.events.filter((e) => e.type === "resize")[0];
  assert.deepEqual([ev.previous.minutes, ev.next.minutes, ev.reason], [180, 240, "More to do"]);
  w.run(split(w.sessions[0], [{ date: "2026-11-02", minutes: 120 }, { date: "2026-11-03", minutes: 120 }], ctx()));
  assert.deepEqual(w.sessions.map((x) => [x.date, x.minutes, x.status]), [["2026-11-02", 120, "planned"], ["2026-11-03", 120, "planned"]]);
  assert.equal(plannedAhead(w.sessions, "J1", "2026-11-01"), 240);
  assert.ok(split(w.sessions[0], [{ date: "2026-11-02", minutes: 120 }], ctx()).problems.length, "one part is not a split");
});

test("undo puts a reschedule back: the original is live again, the replacement is cancelled, nothing is deleted, and it is logged", () => {
  const w = world();
  w.run(createSessions([accounts], ctx()));
  w.run(reschedule(w.sessions[0], { toDate: "2026-11-03", actualMinutes: 60, reason: "x" }, ctx()));
  const batch = w.events.find((e) => e.type === "reschedule")!.batchKey;
  assert.ok(undoable(batch, w.events));
  const u = undoBatch(batch, w.events, w.sessions, ctx());
  assert.equal(u.skipped.length, 0);
  w.run(u);
  assert.equal(w.sessions.length, 2); // history kept
  assert.equal(w.sessions[0].status, "planned");
  assert.equal(w.sessions[0].actualMinutes, 0);
  assert.equal(w.sessions[0].replacedByKey, "");
  assert.equal(w.sessions[1].status, "cancelled");
  assert.equal(committedMinutes(w.sessions, "2026-11-02"), 180);
  assert.equal(committedMinutes(w.sessions, "2026-11-03"), 0);
  assert.ok(w.events.some((e) => e.type === "undo" && e.relatedKey));
  assert.ok(w.events.filter((e) => e.type === "reschedule").length === 1, "the original event is still there");
  assert.equal(undoable(batch, w.events), false);
});

test("asking to undo again, or after a reload, does nothing: no duplicate sessions", () => {
  const w = world();
  w.run(createSessions([accounts], ctx()));
  w.run(reschedule(w.sessions[0], { toDate: "2026-11-03", reason: "x" }, ctx()));
  const batch = w.events.find((e) => e.type === "reschedule")!.batchKey;
  w.run(undoBatch(batch, w.events, w.sessions, ctx()));
  const reload = { sessions: w.sessions.map((x) => readSession(sessionRow(x))), events: w.events.map((e) => readEvent(eventRow(e))) };
  const again = undoBatch(batch, reload.events, reload.sessions, ctx());
  assert.equal(again.alreadyUndone, true);
  assert.equal(again.creates.length + again.patches.length + again.events.length, 0);
});

test("undo leaves alone a change made since, and says why, rather than overwriting it", () => {
  const w = world();
  w.run(createSessions([accounts], ctx()));
  w.run(reschedule(w.sessions[0], { toDate: "2026-11-03", reason: "x" }, ctx()));
  const batch = w.events.find((e) => e.type === "reschedule")!.batchKey;
  w.run(resize(w.sessions[1], 90, ctx())); // Tuesday's session was shortened afterwards
  const u = undoBatch(batch, w.events, w.sessions, ctx());
  assert.equal(u.patches.length, 0);
  assert.equal(u.skipped.length, 1);
  assert.match(u.skipped[0].why, /changed since/);
  assert.equal(undoable(batch, w.events), true);
});

test("undoing a bulk move puts back what it can and reports the rest", () => {
  const w = world();
  w.run(createSessions([accounts, { ...accounts, itemKey: "J2", title: "VAT" }, { ...accounts, itemKey: "J3", title: "Payroll" }], ctx()));
  w.run(rescheduleMany(w.sessions.slice(0, 3), { toDate: "2026-11-03", reason: "Roll forward" }, ctx()));
  const batch = w.events.find((e) => e.type === "reschedule")!.batchKey;
  assert.equal(w.events.filter((e) => e.batchKey === batch && e.type === "reschedule").length, 3);
  const second = w.sessions.find((x) => x.itemKey === "J2" && x.status === "planned")!;
  w.run(conclude(second, { outcome: "completed", actualMinutes: 100 }, ctx())); // finished on Tuesday since
  const u = undoBatch(batch, w.events, w.sessions, ctx());
  assert.equal(u.skipped.length, 1);
  w.run(u);
  assert.equal(w.sessions.filter((x) => x.status === "planned" && x.date === "2026-11-02").length, 2);
  assert.equal(w.sessions.find((x) => x.key === second.originalKey)!.status, "rescheduled"); // the finished one stays moved
});

test("a plan applied twice, or on a session changed by someone else, does not double-apply", () => {
  const w = world();
  w.run(createSessions([accounts], ctx()));
  const p = resize(w.sessions[0], 240, ctx());
  const r1 = applyPlan(w.sessions, p);
  assert.equal(r1.sessions[0].version, 2);
  const r2 = applyPlan(r1.sessions, p); // the same request again
  assert.deepEqual(r2.conflicts, [w.sessions[0].key]);
  assert.equal(r2.sessions[0].minutes, 240);
  const c = applyPlan(w.sessions.map((x) => ({ ...x, version: 5 })), p); // someone else changed it meanwhile
  assert.equal(c.conflicts.length, 1);
  assert.equal(c.sessions[0].minutes, 180);
});

test("the old planner's planned dates become sessions once, with no invented history", () => {
  const jobs = [
    { Key: "J1", Title: "Accounts", ClientKey: "C1", PlannedDate: "2026-11-04", Status: "Open" },
    { Key: "J2", Title: "Done", PlannedDate: "2026-11-03", Status: "Complete" },
    { Key: "J3", Title: "No date", Status: "Open" },
    { Key: "J4", Title: "Bad", PlannedDate: "soon", Status: "Open" },
    { Key: "J5", Title: "Already", PlannedDate: "2026-11-05", Status: "Open" },
  ];
  const tasks = [{ Key: "T1", Title: "Call", PlannedDate: "2026-11-04", Status: "Open" }];
  const existing = [readSession({ Key: "x", ItemKey: "J5", PlannedDate: "2026-11-05", PlannedMinutes: 60, Status: "planned" })];
  const input = { jobs, tasks, sessions: existing, hoursOf: (k: string, r: any) => (r.Key === "J4" ? 0 : k === "job" ? 1.5 : 0.5), now: "2026-11-02T09:00:00Z", user: "kevin" };
  const m = migrateLegacy(input);
  assert.deepEqual(m.report, { migrated: 2, skippedHasSessions: 1, skippedDone: 1, skippedNoDate: 1, rejected: [{ key: "J4", why: "no estimate to plan" }], minutes: 120 });
  assert.deepEqual(m.rows.map((x) => [x.itemKey, x.minutes, x.status, x.originalKey]), [["J1", 90, "planned", ""], ["T1", 30, "planned", ""]]);
  assert.ok(m.events.every((e) => e.type === "migrate"));
  // running it again after the sessions are saved brings in nothing
  const again = migrateLegacy({ ...input, sessions: [...existing, ...m.rows] });
  assert.equal(again.rows.length, 0);
  assert.equal(again.report.skippedHasSessions, 3);
  assert.equal(again.report.migrated, 0);
});

test("sessions and events survive being saved as list rows and read back", () => {
  const w = world();
  w.run(createSessions([accounts], ctx()));
  w.run(reschedule(w.sessions[0], { toDate: "2026-11-03", actualMinutes: 45, reason: "Because" }, ctx()));
  assert.deepEqual(w.sessions.map((x) => readSession(sessionRow(x, "P1"))), w.sessions);
  assert.deepEqual(w.events.map((e) => readEvent(eventRow(e, "P1"))), w.events);
});

test("applying a plan: a session changed meanwhile keeps its whole group out, others go ahead, and the item's date follows the next live session", async () => {
  const { writesFor } = await import("../src/lib/planApply");
  const w = world();
  w.run(createSessions([accounts, { ...accounts, itemKey: "J2", title: "VAT" }], ctx()));
  const plan = rescheduleMany(w.sessions, { toDate: "2026-11-03", reason: "Roll" }, ctx());
  // someone changed VAT's session since the plan was made
  const fresh = w.sessions.map((x) => (x.itemKey === "J2" ? { ...x, version: 2 } : x));
  const planned = new Map([["J1", "2026-11-02"], ["J2", "2026-11-02"]]);
  const out = writesFor(plan, fresh, planned, "2026-11-02");
  assert.equal(out.skipped.length, 1);
  assert.equal(out.patches.length, 1);
  assert.equal(out.creates.length, 1);
  assert.equal(out.creates[0].itemKey, "J1");
  assert.ok(out.events.every((e) => e.itemKey === "J1"));
  assert.deepEqual(out.dates, [{ kind: "job", itemKey: "J1", date: "2026-11-03" }]);
  // nothing stale: both go ahead, and a date already right isn't written again
  const all = writesFor(plan, w.sessions, new Map([["J1", "2026-11-03"], ["J2", "2026-11-02"]]), "2026-11-02");
  assert.equal(all.skipped.length, 0);
  assert.deepEqual(all.dates, [{ kind: "job", itemKey: "J2", date: "2026-11-03" }]);
});
