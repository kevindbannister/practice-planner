import test from "node:test";
import assert from "node:assert/strict";
import { idRecheckDue, idRefreshPolicy } from "../src/lib/amlPolicy.ts";
import { reviewDateSuspect } from "../src/lib/amlReviewDate.ts";
import { AML_STOPPED, setupProblems } from "../src/lib/billing.ts";

test("ID re-check dates follow the policy by risk; 0 means only when something changes", () => {
  const p = idRefreshPolicy([{ Key: "aml.builder", Value: JSON.stringify({ answers: { idHigh: "24", idMed: "0", idLow: "x" } }) }] as any);
  assert.deepEqual(p, { high: 24, medium: 0, low: 0 });
  assert.equal(idRecheckDue("2025-03-31", "high", p), "2027-03-31");
  assert.equal(idRecheckDue("2025-03-31", "medium", p), "");
  assert.equal(idRecheckDue("", "high", p), "");
});

test("a review date equal to Xama's own date, with no planner assessment, is flagged as probably overwritten", () => {
  assert.equal(reviewDateSuspect({ AMLReview: "2025-04-01", XamaAssessedOn: "2025-04-01" } as any, "client record"), true);
  assert.equal(reviewDateSuspect({ AMLReview: "2027-04-01", XamaAssessedOn: "2025-04-01" } as any, "client record"), false);
  assert.equal(reviewDateSuspect({ AMLReview: "2025-04-01", XamaAssessedOn: "2025-04-01" } as any, "assessment"), false);
});

test("billing can't be set up for a client whose AML due diligence wasn't completed", () => {
  const line: any = { key: "F1", status: "active", period: "monthly", fee: 100, vat: "standard", oneOff: false };
  const base: any = { line, clientName: "X", customerId: "c", method: "dd", startDate: "2026-12-01", description: "Fee", today: "2026-11-09", settings: {} };
  assert.ok(!setupProblems(base).includes(AML_STOPPED));
  assert.equal(setupProblems({ ...base, amlStopped: true })[0], AML_STOPPED);
});
