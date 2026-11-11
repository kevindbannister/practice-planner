import test from "node:test";
import assert from "node:assert/strict";
import { Dependency } from "../src/lib/work/dependencies";
import { World, assess } from "../src/lib/work/readiness";
import { Facts, Risk, DEFAULT_RISK, risk, workingDays, impacts, riskItems, readRiskConfig, touchesDeadline } from "../src/lib/work/risk";
import { readTask } from "../src/lib/work/model";

const hoursOn = (d: string) => { const wd = new Date(`${d}T00:00:00Z`).getUTCDay(); return wd >= 1 && wd <= 5 ? 7.5 : 0; };
const dep = (o: Partial<Dependency>): Dependency => ({ key: "d" + Math.random(), prerequisite: { kind: "task", key: "rec" }, dependent: { kind: "job", key: "j" }, type: "finish_to_start", outcome: "done", verificationRequired: false, status: "active", expectedCompletion: "", resolvedAt: "", resolvedBy: "", overrideReason: "", templateKey: "", created: "", createdBy: "", version: 1, ...o });
const world = (deps: Dependency[], tasks: Record<string, unknown>[] = [], jobs: Record<string, unknown>[] = []): World => ({ deps, tasks: new Map(tasks.map((t) => [String(t.Key), readTask({ Title: `Task ${t.Key}`, Status: "Open", ...t })])), jobs: new Map(jobs.map((j) => [String(j.key), { title: `Job ${j.key}`, status: "Open", stageNo: 1, stageCount: 5, onHold: false, ...j } as never])), verified: () => false });
const facts = (o: Partial<Facts> = {}): Facts => ({ key: "j", title: "VAT return", clientKey: "c", deadline: "2026-12-31", internalTarget: "", clientAgreed: "", planned: "", remaining: 6, actionable: 6, complete: false, ...o });
const TODAY = "2026-11-11"; // a Wednesday

test("working days", () => { assert.equal(workingDays("2026-11-09", "2026-11-15", hoursOn), 5); assert.equal(workingDays("2026-11-15", "2026-11-09", hoursOn), 0); });
test("unblocked job: slack decides the category", () => {
  const w = world([], [], [{ key: "j" }]); const a = assess("job", "j", w);
  assert.equal(risk(facts({ deadline: "2026-12-31" }), a, TODAY, hoursOn).category, "on_track");
  assert.equal(risk(facts({ deadline: "2026-11-13", remaining: 30, actionable: 30 }), a, TODAY, hoursOn).category, "critical");
  assert.equal(risk(facts({ deadline: "2026-11-16", remaining: 6, actionable: 6 }), a, TODAY, hoursOn).category, "at_risk");
  assert.equal(risk(facts({ deadline: "2026-11-10" }), a, TODAY, hoursOn).category, "overdue");
  assert.equal(risk(facts({ deadline: "" }), a, TODAY, hoursOn).noDeadline, true);
});
test("blocked with an unknown date is never 'low priority' and escalates as the deadline nears (Scenario G)", () => {
  const w = world([dep({})], [{ Key: "rec", OwnerType: "contact", Status: "Requested" }], [{ key: "j" }]); const a = assess("job", "j", w);
  const far = risk(facts({ deadline: "2027-03-31", actionable: 0 }), a, TODAY, hoursOn); assert.equal(far.uncertain, true); assert.equal(far.lastExpected, "");
  assert.equal(far.category, "on_track");
  assert.equal(risk(facts({ deadline: "2026-11-17", actionable: 0 }), a, TODAY, hoursOn).category, "critical");
  assert.equal(risk(facts({ deadline: "2026-11-24", actionable: 0 }), a, TODAY, hoursOn).category, "at_risk");
  assert.equal(risk(facts({ deadline: "2026-12-04", actionable: 0 }), a, TODAY, hoursOn).category, "attention");
});
test("known expected date: after the deadline is critical; otherwise slack", () => {
  const mk = (expected: string) => { const w = world([dep({ expectedCompletion: expected })], [{ Key: "rec", OwnerType: "contact", Status: "Requested" }], [{ key: "j" }]); return risk(facts({ deadline: "2026-12-04", actionable: 0 }), assess("job", "j", w), TODAY, hoursOn); };
  assert.equal(mk("2026-12-10").category, "critical");
  assert.equal(mk("2026-11-13").category, "on_track");
  assert.equal(mk("2026-12-02").category, "at_risk");
  assert.equal(mk("2026-11-13").lastExpected, "2026-11-13");
});
test("internal target passed raises attention", () => {
  const a = assess("job", "j", world([], [], [{ key: "j" }]));
  assert.equal(risk(facts({ internalTarget: "2026-11-01" }), a, TODAY, hoursOn).category, "attention");
});
test("config reads safely", () => {
  assert.deepEqual(readRiskConfig([]), DEFAULT_RISK);
  assert.equal(readRiskConfig([{ Key: "work.risk", Value: JSON.stringify({ leadDays: 5, focusHours: 0 }) }]).leadDays, 5);
  assert.equal(readRiskConfig([{ Key: "work.risk", Value: "not json" }]).leadDays, DEFAULT_RISK.leadDays);
});
test("impact: direct, indirect, hours, deadlines, ranking (Scenario K)", () => {
  const w = world([dep({ prerequisite: { kind: "task", key: "rec" }, dependent: { kind: "job", key: "acc" } }), dep({ prerequisite: { kind: "job", key: "acc", stage: 4 }, dependent: { kind: "job", key: "ct" }, type: "stage", outcome: "stage" }), dep({ prerequisite: { kind: "task", key: "other" }, dependent: { kind: "task", key: "t2" } })],
    [{ Key: "rec", OwnerType: "contact", AssignedContact: "Sam", FollowUpDate: "2026-11-20", Status: "Requested" }, { Key: "other", Status: "Open" }, { Key: "t2", EstimateMinutes: 30 }], [{ key: "acc" }, { key: "ct" }]);
  const fs = new Map([["acc", facts({ key: "acc", title: "Accounts", deadline: "2026-12-04", remaining: 8, actionable: 0 })], ["ct", facts({ key: "ct", title: "CT", deadline: "2026-12-31", remaining: 3, actionable: 0 })]]);
  const rs = new Map<string, Risk>(); for (const [k, f] of fs) rs.set(k, risk(f, assess("job", k, w), TODAY, hoursOn));
  const im = impacts(w, fs, rs);
  assert.equal(im[0].prerequisite.key, "rec");
  assert.deepEqual(im[0].direct.map((x) => x.key), ["acc"]); assert.deepEqual(im[0].indirect.map((x) => x.key), ["ct"]);
  assert.equal(im[0].hours, 11); assert.equal(im[0].responsible, "Sam"); assert.equal(im[0].followUp, "2026-11-20"); assert.equal(im[0].deadlines[0].date, "2026-12-04");
  assert.equal(im[0].expectedKnown, false);
  assert.ok(im.some((x) => x.prerequisite.key === "other"));
});
test("action centre items: blocked and short of time, naming the prerequisite; none for healthy or overdue", () => {
  const w = world([dep({})], [{ Key: "rec", OwnerType: "contact", AssignedContact: "Sam", Status: "Requested" }], [{ key: "j" }]);
  const f = facts({ deadline: "2026-11-24", actionable: 0 }); const fs = new Map([["j", f]]); const rs = new Map([["j", risk(f, assess("job", "j", w), TODAY, hoursOn)]]);
  const items = riskItems(fs, rs, w, TODAY); assert.equal(items.length, 1); assert.match(items[0].detail, /Waiting on Task rec \(Sam\), no date known/); assert.equal(items[0].href, "editor:task:rec");
  const healthy = new Map([["j", risk(facts(), assess("job", "j", world([], [], [{ key: "j" }])), TODAY, hoursOn)]]);
  assert.equal(riskItems(new Map([["j", facts()]]), healthy, w, TODAY).length, 0);
});
test("nothing here writes a statutory deadline", () => {
  assert.equal(touchesDeadline({ PlannedDate: "x" }), false); assert.equal(touchesDeadline({ Deadline: "x" }), true); assert.equal(touchesDeadline({ CHDeadline: "x" }), true);
});
