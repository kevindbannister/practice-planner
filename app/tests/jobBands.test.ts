import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SOON, DEFAULT_VERY_SOON, StartRule, accessFor, assigneeOf, bandsOf, bandsShown, inScope, isAssignedTo, ownerOf, readStartRules, readyOn, startRuleFor, tally, thresholds } from "../src/lib/jobBands.ts";
import type { Config } from "../src/lib/checklist.ts";

const today = "2026-11-17";
const day = (n: number) => { const d = new Date(Date.parse(`${today}T00:00:00Z`) + n * 86400000); return d.toISOString().slice(0, 10); };
const job = (over: Record<string, unknown> = {}) => ({ Key: "J1", ClientKey: "C1", ServiceKey: "VAT", StageNo: 1, Deadline: day(10), ...over });
const cfg = (staff: { name: string; role: string }[]): Config => ({ staff: staff as never, overriders: [], independentReview: false, auto: true });

test("each stage can set its own very soon and due soon days, with sensible defaults", () => {
  assert.deepEqual(thresholds(undefined), { verySoon: DEFAULT_VERY_SOON, soon: DEFAULT_SOON });
  assert.deepEqual(thresholds({ VerySoonDays: 5, SoonDays: 10 }), { verySoon: 5, soon: 10 });
  assert.deepEqual(thresholds({ VerySoonDays: "2" }), { verySoon: 2, soon: DEFAULT_SOON });
  // due soon can never be shorter than very soon
  assert.deepEqual(thresholds({ VerySoonDays: 9, SoonDays: 4 }), { verySoon: 9, soon: 9 });
  assert.deepEqual(thresholds({ VerySoonDays: -1, SoonDays: "x" }), { verySoon: DEFAULT_VERY_SOON, soon: DEFAULT_SOON });
});

test("a job lands in overdue, very soon, soon or OK by its deadline and its stage", () => {
  const stage = { StageNo: 1, VerySoonDays: 3, SoonDays: 7 };
  const b = (n: number) => bandsOf(job({ Deadline: day(n) }), stage, today, 14, true);
  assert.deepEqual(b(-1), ["overdue"]);
  assert.deepEqual(b(0), ["verySoon"]);
  assert.deepEqual(b(3), ["verySoon"]);
  assert.deepEqual(b(4), ["soon"]);
  assert.deepEqual(b(7), ["soon"]);
  assert.deepEqual(b(8), ["ok"]);
  assert.deepEqual(b(14), ["ok"]);
  assert.deepEqual(b(15), [], "beyond the window counts nowhere");
});

test("the same deadline is more urgent at a stage that wants earlier warning", () => {
  const early = { StageNo: 1, VerySoonDays: 12, SoonDays: 20 };
  const late = { StageNo: 4, VerySoonDays: 2, SoonDays: 5 };
  assert.deepEqual(bandsOf(job({ Deadline: day(10) }), early, today, 30, true), ["verySoon"]);
  assert.deepEqual(bandsOf(job({ Deadline: day(10) }), late, today, 30, true), ["ok"]);
});

test("overdue always counts, whatever the window; no deadline counts nowhere", () => {
  assert.deepEqual(bandsOf(job({ Deadline: day(-90) }), undefined, today, 7, true), ["overdue"]);
  assert.deepEqual(bandsOf(job({ Deadline: "" }), undefined, today, 14, true), []);
});

test("held work counts only as on hold, and only when held work is included", () => {
  const held = job({ Status: "On hold", Deadline: day(-2) });
  assert.deepEqual(bandsOf(held, undefined, today, 14, true), ["hold"]);
  assert.deepEqual(bandsOf(held, undefined, today, 14, false), []);
  assert.deepEqual(bandsShown(false).includes("hold"), false);
  assert.deepEqual(bandsShown(true).includes("hold"), true);
});

test("work that can't be started yet is not ready, whatever the window", () => {
  const period: StartRule = { kind: "period" };
  // period still running: not ready, even though the deadline is a long way off
  assert.deepEqual(bandsOf(job({ PeriodEnd: day(5), Deadline: day(60) }), undefined, today, 14, false, period), ["notYet"]);
  // the period ended yesterday: ready, so counted by its deadline as usual
  assert.deepEqual(bandsOf(job({ PeriodEnd: day(-1), Deadline: day(2) }), undefined, today, 14, false, period), ["verySoon"]);
  // the period ends today: the work starts tomorrow
  assert.deepEqual(bandsOf(job({ PeriodEnd: day(0), Deadline: day(10) }), undefined, today, 14, false, period), ["notYet"]);
  // payroll: can start 7 days before pay day
  const payroll = startRuleFor({}, "PAYROLL");
  assert.deepEqual(payroll, { kind: "days", days: 7 });
  assert.deepEqual(bandsOf(job({ Deadline: day(24) }), undefined, today, 14, false, payroll), ["notYet"]);
  assert.deepEqual(bandsOf(job({ Deadline: day(7) }), undefined, today, 14, false, payroll), ["soon"]);
  // overdue wins, and "any time" never waits
  assert.deepEqual(bandsOf(job({ PeriodEnd: day(5), Deadline: day(-1) }), undefined, today, 14, false, period), ["overdue"]);
  assert.deepEqual(bandsOf(job({ PeriodEnd: day(5), Deadline: day(3) }), undefined, today, 14, false, { kind: "any" }), ["verySoon"]);
  // no period end to go on: ready
  assert.deepEqual(bandsOf(job({ Deadline: day(3) }), undefined, today, 14, false, period), ["verySoon"]);
  assert.equal(readyOn(job({ PeriodEnd: "2026-01-31" }), period), "2026-02-01");
});

test("saved start rules are checked, and the practice's choice wins over the built-in one", () => {
  const rules = readStartRules({ PAYROLL: { kind: "any" }, VAT: { kind: "days", days: "10" }, BAD: { kind: "soon" }, CIS: { kind: "days", days: -3 } });
  assert.deepEqual(rules, { PAYROLL: { kind: "any" }, VAT: { kind: "days", days: 10 }, CIS: { kind: "days", days: 7 } });
  assert.deepEqual(startRuleFor(rules, "PAYROLL"), { kind: "any" });
  assert.deepEqual(startRuleFor(rules, "SA100"), { kind: "period" });
});

test("tally counts jobs by band using each job's stage", () => {
  const stages: Record<string, Record<string, unknown>[]> = { VAT: [{ StageNo: 1, VerySoonDays: 3, SoonDays: 7 }], PAYE: [{ StageNo: 1, VerySoonDays: 10, SoonDays: 14 }] };
  const jobs = [
    job({ Key: "a", Deadline: day(-5) }), job({ Key: "b", Deadline: day(2) }), job({ Key: "c", Deadline: day(12) }),
    job({ Key: "d", ServiceKey: "PAYE", Deadline: day(9) }), job({ Key: "e", Status: "On hold" }),
  ];
  const c = tally(jobs, (k) => stages[k] || [], today, 14, true);
  assert.deepEqual(c, { overdue: 1, verySoon: 2, soon: 0, ok: 1, notYet: 0, hold: 1 });
});

test("a job's owner is the one set on it, else the client's manager, else partner", () => {
  assert.equal(ownerOf({ Owner: "Sam" }, { Manager: "Alex", Partner: "Pat" }), "Sam");
  assert.equal(ownerOf({}, { Manager: "Alex", Partner: "Pat" }), "Alex");
  assert.equal(ownerOf({}, { Partner: "Pat" }), "Pat");
  assert.equal(ownerOf({}, undefined), "");
});

test("who does a stage: set for the client, else the type of work's default", () => {
  const templates = [{ StageNo: 1, DefaultWho: "Sam" }, { StageNo: 2, DefaultWho: "Pat" }];
  const clientStages = [{ ClientKey: "C1", ServiceKey: "VAT", StageNo: 2, Who: "Alex" }];
  assert.equal(assigneeOf(clientStages, templates, "C1", "VAT", 1), "Sam");
  assert.equal(assigneeOf(clientStages, templates, "C1", "VAT", 2), "Alex");
  assert.equal(assigneeOf(clientStages, templates, "C2", "VAT", 2), "Pat");
});

test("assigned work is a job where you do the current stage or one still to come", () => {
  const templates = [{ StageNo: 1 }, { StageNo: 2 }, { StageNo: 3 }];
  const cs = [
    { ClientKey: "C1", ServiceKey: "VAT", StageNo: 1, Who: "Sam" }, { ClientKey: "C1", ServiceKey: "VAT", StageNo: 3, Who: "Pat" },
  ];
  assert.equal(isAssignedTo("Sam", job({ StageNo: 1 }), templates, cs), true);
  assert.equal(isAssignedTo("sam", job({ StageNo: 2 }), templates, cs), false, "Sam's stage is behind the job");
  assert.equal(isAssignedTo("Pat", job({ StageNo: 2 }), templates, cs), true, "Pat reviews later");
  assert.equal(isAssignedTo("Nobody", job(), templates, cs), false);
  assert.equal(isAssignedTo("", job(), templates, cs), false);
});

test("what each role may look at", () => {
  const c = cfg([{ name: "Pat", role: "partner" }, { name: "Alex", role: "manager" }, { name: "Sam", role: "preparer" }]);
  assert.deepEqual(accessFor(c, "Pat"), { scopes: ["everyone", "mine"], initial: "everyone" });
  assert.deepEqual(accessFor(c, "Alex"), { scopes: ["jobs", "mine"], initial: "jobs" });
  assert.deepEqual(accessFor(c, "Sam"), { scopes: ["mine"], initial: "mine" });
  assert.deepEqual(accessFor(c, "Stranger"), { scopes: ["mine"], initial: "mine" });
  assert.deepEqual(accessFor(cfg([]), "Anyone"), { scopes: ["everyone"], initial: "everyone" }, "a one-person practice sees everything");
});

test("scopes: everyone sees all, a manager their jobs and assigned work, others only assigned work", () => {
  const templates = [{ StageNo: 1 }];
  const cs = [{ ClientKey: "C1", ServiceKey: "VAT", StageNo: 1, Who: "Sam" }];
  const client = { Key: "C1", Manager: "Alex" };
  const j = job();
  assert.equal(inScope("everyone", "Pat", j, client, templates, cs), true);
  assert.equal(inScope("jobs", "Alex", j, client, templates, cs), true, "Alex manages the client");
  assert.equal(inScope("jobs", "Sam", j, client, templates, cs), true, "Sam is assigned");
  assert.equal(inScope("jobs", "Kim", j, client, templates, cs), false);
  assert.equal(inScope("mine", "Alex", j, client, templates, cs), false, "owning is not the same as being assigned");
  assert.equal(inScope("mine", "Sam", j, client, templates, cs), true);
});

test("the next 31 December and the next 31 January", async () => {
  const { nextOn } = await import("../src/lib/jobBands.ts");
  assert.equal(nextOn("2026-11-17", 12, 31), "2026-12-31");
  assert.equal(nextOn("2026-12-31", 12, 31), "2026-12-31", "on the day itself it is today");
  assert.equal(nextOn("2026-11-17", 1, 31), "2027-01-31");
  assert.equal(nextOn("2027-01-10", 1, 31), "2027-01-31");
  assert.equal(nextOn("2027-02-01", 1, 31), "2028-01-31");
});
