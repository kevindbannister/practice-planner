import test from "node:test";
import assert from "node:assert/strict";
import { policyMonths } from "../src/lib/amlPolicy";
import { TRIGGER_KINDS, isTriggerSource, lastApprovedAt, raiseReview, readReviewPolicy, seenTriggers, triggerOf } from "../src/lib/amlReview";
import { readOnboardingSettings, readAml } from "../src/lib/onboarding";
import * as b from "../src/lib/amlBuilder";

const setting = (answers: Record<string, unknown>) => [{ Key: "aml.builder", Value: JSON.stringify({ answers }) }] as never;
let n = 0;
const o = { actor: "Kim", now: "2026-11-08T10:00:00.000Z", pid: "P", newKey: (p: string) => `${p}${++n}` };
const client = { Key: "C1", Title: "Acme" } as never;
const can = () => true;

test("the review periods come from the policy and override the old onboarding setting", () => {
  assert.deepEqual(policyMonths(setting({ mHigh: "6", mMed: "12" })), { high: 6, medium: 12 });
  assert.deepEqual(policyMonths(setting({ mHigh: "abc" })), {});
  assert.deepEqual(policyMonths([]), {});
  const s = readOnboardingSettings([...(setting({ mHigh: "6", mMed: "18", mLow: "30" }) as never[]), { Key: "onboarding.settings", Value: JSON.stringify({ amlMonths: { low: 36, medium: 24, high: 12 } }) } as never]);
  assert.deepEqual(s.amlMonths, { low: 30, medium: 18, high: 6 });
  assert.deepEqual(readOnboardingSettings([]).amlMonths, { low: 36, medium: 24, high: 12 });
});

test("the policy's triggers and days are read, with every trigger on and 14 days when it has not said", () => {
  const f = { low: 36, medium: 24, high: 12 };
  const p = readReviewPolicy(setting({ mHigh: "6", mMed: "12", triggers: ["owners", "bank", "nonsense"], triggerDays: "7" }), f);
  assert.deepEqual(p.triggers, ["owners", "bank"]);
  assert.equal(p.triggerDays, 7);
  assert.equal(p.fromPolicy, true);
  const d = readReviewPolicy([], f);
  assert.equal(d.triggers.length, TRIGGER_KINDS.length);
  assert.equal(d.triggerDays, 14);
  assert.equal(d.fromPolicy, false);
  assert.equal(d.high, 12);
});

test("raising a review opens one with a due date, and a second trigger is added rather than duplicated", () => {
  const w = raiseReview(client, [], "bank", "New bank details given", 14, "2026-11-08", can, o);
  assert.ok(!("error" in w));
  if ("error" in w) return;
  const row = w.creates![0].row;
  assert.equal(row.Status, "inprogress");
  assert.ok(isTriggerSource(row.Source));
  const t = triggerOf(row)!;
  assert.equal(t.kind, "bank");
  assert.equal(t.raised, "2026-11-08");
  assert.equal(t.due, "2026-11-22");
  assert.match(t.reason, /New bank details/);
  const again = raiseReview(client, [row], "unusual", "Odd payments", 14, "2026-11-09", can, o);
  assert.ok(!("error" in again));
  if ("error" in again) return;
  assert.equal(again.creates, undefined);
  assert.match(String(again.patches[0].patch.Notes), /New bank details[\s\S]*Odd payments/);
  assert.equal(again.patches[0].patch.Source, row.Source);
});

test("a trigger needs a reason and a permitted person", () => {
  assert.ok("error" in raiseReview(client, [], "bank", "  ", 14, "2026-11-08", can, o));
  assert.ok("error" in raiseReview(client, [], "nope", "x", 14, "2026-11-08", can, o));
  assert.ok("error" in raiseReview(client, [], "bank", "x", 14, "2026-11-08", () => false, o));
});

test("changes seen in the data are reported only after the last approval, and only if the policy lists them", () => {
  const data = {
    amlAssessments: [], onboardings: [],
    cosecEvents: [{ ClientKey: "C1", Entity: "psc", Field: "appointed", At: "2026-10-01T09:00:00.000Z" }, { ClientKey: "C1", Entity: "officer", Field: "resigned", At: "2026-05-01T09:00:00.000Z" }, { ClientKey: "C2", Entity: "psc", At: "2026-10-01T09:00:00.000Z" }],
    clientServices: [{ ClientKey: "C1", EffectiveFrom: "2026-09-01" }, { ClientKey: "C1", EffectiveFrom: "2026-01-01" }, { ClientKey: "C1", EffectiveFrom: "2026-10-10", EndedOn: "2026-10-20" }],
  } as never;
  const all = readReviewPolicy([], { low: 36, medium: 24, high: 12 });
  const since = "2026-06-01T00:00:00.000Z";
  const seen = seenTriggers(client, data, all, since);
  assert.deepEqual(seen.map((s) => s.kind).sort(), ["owners", "service"]);
  assert.equal(seenTriggers(client, data, all, "").length, 0);
  const ownersOnly = readReviewPolicy(setting({ triggers: ["owners"] }), { low: 36, medium: 24, high: 12 });
  assert.deepEqual(seenTriggers(client, data, ownersOnly, since).map((s) => s.kind), ["owners"]);
});

test("the last approval date is the newest across assessments and onboarding", () => {
  const rows = [{ ClientKey: "C1", Status: "approved", ApprovedAt: "2026-03-01T00:00:00.000Z" }, { ClientKey: "C1", Status: "superseded", ApprovedAt: "2025-03-01T00:00:00.000Z" }, { ClientKey: "C2", Status: "approved", ApprovedAt: "2026-09-01T00:00:00.000Z" }] as never;
  assert.equal(lastApprovedAt(client, rows, [], readAml as never), "2026-03-01T00:00:00.000Z");
});

test("the monitoring step asks for each frequency and writes them into the policy", () => {
  const st: b.State = { ...b.EMPTY, answers: { lowUse: "never", mHigh: "6", mMed: "12", checks: ["id"], triggers: ["owners", "bank"], triggerDays: "10" } };
  const t = b.build(st).find((x) => x.id === "monitor")!.text;
  assert.match(t, /high-risk clients at least every 6 months, medium-risk clients at least every 12 months\./);
  assert.match(t, /A change in directors, owners or persons with significant control/);
  assert.match(t, /within 10 days/);
  assert.ok(b.build(b.EMPTY).find((x) => x.id === "monitor")!.gaps.includes("months between high-risk reviews"));
});
