import test from "node:test";
import assert from "node:assert/strict";
import { screening, lastScreened } from "../src/lib/amlScreening.ts";
import { screeningPolicy } from "../src/lib/amlPolicy.ts";

const settings = (answers: Record<string, unknown>) => [{ Key: "aml.builder", Value: JSON.stringify({ answers }) }] as any;
const review = { high: 6, medium: 12, low: 24 };

test("re-screen periods come from the policy's sanctions step, falling back to the review periods", () => {
  assert.deepEqual(screeningPolicy(settings({}), review), { high: 6, medium: 12, low: 24, monitor: [], fromPolicy: false });
  assert.deepEqual(screeningPolicy(settings({ sHigh: "12", sMed: "24", sLow: "36", monitor: "yes" }), review), { high: 12, medium: 24, low: 36, monitor: ["high", "medium", "low"], fromPolicy: true });
  assert.deepEqual(screeningPolicy(settings({ monitorRisk: ["high", "none"] }), review).monitor, ["high"]);
});

test("the last screening is the latest of Xama, an assessment check and the register; due follows the client's risk", () => {
  const sp = screeningPolicy(settings({ sHigh: "12", sMed: "24", sLow: "36" }), review);
  const client: any = { Key: "C1", XamaAmlCheck: "done|2025-01-10|0|0" };
  const rows: any[] = [{ ClientKey: "C1", Status: "approved", Checks: JSON.stringify([{ kind: "Sanctions and PEP screening", result: "pass", at: "2024-05-01T10:00:00Z", note: "" }]) }];
  const reg = [{ values: { client: "C2", on: "2026-01-01" } }];
  assert.equal(lastScreened(client, rows, reg).via, "Xama");
  const low = screening(client, "low", sp, rows, reg, "2026-11-09");
  assert.equal(low.due, "2028-01-10"); assert.ok((low.days as number) > 0);
  const high = screening(client, "high", sp, rows, reg, "2026-11-09");
  assert.equal(high.due, "2026-01-10"); assert.ok((high.days as number) < 0);
  const reg2 = [{ values: { client: "C1", on: "2026-06-01", result: "No match" } }];
  assert.equal(lastScreened(client, rows, reg2).via, "Screening register");
  assert.equal(screening({ Key: "C9" } as any, "", sp, rows, reg, "2026-11-09").days, null);
  assert.equal(lastScreened({ Key: "C1", XamaAmlCheck: "check|2026-02-01|1|0" } as any, [], []).match, true);
});

test("approval needs a screening within the policy period, and a company needs the company itself screened", async () => {
  const { screeningProblems } = await import("../src/lib/amlScreening.ts");
  const sp = screeningPolicy(settings({ sHigh: "12", sMed: "24", sLow: "36" }), review);
  const none: any = { Key: "N1" };
  assert.match(screeningProblems(none, "low", sp, [], [], "2026-11-09", { company: false })[0], /Screen the client/);
  const old: any = { Key: "O1", XamaAmlCheck: "done|2024-01-01|0|0" };
  assert.match(screeningProblems(old, "high", sp, [], [], "2026-11-09", { company: false })[0], /older than your policy allows/);
  const ok: any = { Key: "K1", XamaAmlCheck: "done|2026-10-01|0|0" };
  assert.deepEqual(screeningProblems(ok, "high", sp, [], [], "2026-11-09", { company: false }), []);
  assert.match(screeningProblems(ok, "high", sp, [], [], "2026-11-09", { company: true })[0], /company itself/);
  const draft = [{ kind: "Company sanctions screening", result: "pass", at: "2026-11-01", note: "UK Sanctions List" }];
  assert.deepEqual(screeningProblems(ok, "high", sp, [], [], "2026-11-09", { company: true, draftChecks: draft }), []);
  const reg = [{ values: { client: "K1", on: "2026-11-02", role: "Client", result: "No match" } }];
  assert.deepEqual(screeningProblems(ok, "high", sp, [], reg, "2026-11-09", { company: true }), []);
});

test("a possible Xama match blocks until the register clears it; a confirmed match always blocks", async () => {
  const { matchProblems } = await import("../src/lib/amlScreening.ts");
  const c: any = { Key: "M1", XamaAmlCheck: "check|2026-11-01|1|0" };
  assert.match(matchProblems(c, [])[0], /possible PEP or sanctions match/);
  assert.match(matchProblems(c, [{ values: { client: "M1", on: "2026-11-02", result: "No match", resolution: "" } }])[0], /possible/);
  assert.deepEqual(matchProblems(c, [{ values: { client: "M1", on: "2026-11-02", result: "No match", resolution: "Different date of birth" } }]), []);
  assert.match(matchProblems({ Key: "M2" } as any, [{ values: { client: "M2", on: "2026-11-02", result: "Confirmed match" } }])[0], /confirmed/);
  assert.match(matchProblems({ Key: "M3" } as any, [{ values: { client: "M3", on: "2026-11-02", result: "Possible match" } }])[0], /under review/);
  assert.deepEqual(matchProblems({ Key: "M4", XamaAmlCheck: "done|2026-11-01|0|0" } as any, []), []);
});

test("screening status: green when current, amber in the last 30 days, red when overdue, never done or a possible match", async () => {
  const { screeningStatus } = await import("../src/lib/amlScreening");
  const f = (iso: string) => iso;
  const base = { on: "2026-01-10", via: "Xama", due: "2027-01-10", days: 61, months: 12, match: false };
  assert.deepEqual([screeningStatus(base, f).tone, screeningStatus(base, f).label], ["green", "Up to date"]);
  assert.match(screeningStatus(base, f).line, /Next due 2027-01-10 \(in 61 days\)/);
  assert.deepEqual([screeningStatus({ ...base, days: 30 }, f).tone, screeningStatus({ ...base, days: 30 }, f).label], ["amber", "Due in 30 days"]);
  assert.equal(screeningStatus({ ...base, days: 0 }, f).tone, "amber");
  assert.equal(screeningStatus({ ...base, days: 1 }, f).label, "Due in 1 day");
  const late = screeningStatus({ ...base, days: -3 }, f);
  assert.deepEqual([late.tone, late.label], ["red", "Overdue 3 days"]);
  assert.equal(screeningStatus({ ...base, on: "", due: "", days: null }, f).tone, "red");
  assert.equal(screeningStatus({ ...base, match: true }, f).label, "Possible match");
});
