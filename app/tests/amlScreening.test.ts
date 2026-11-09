import test from "node:test";
import assert from "node:assert/strict";
import { screening, lastScreened } from "../src/lib/amlScreening.ts";
import { screeningPolicy } from "../src/lib/amlPolicy.ts";

const settings = (answers: Record<string, unknown>) => [{ Key: "aml.builder", Value: JSON.stringify({ answers }) }] as any;
const review = { high: 6, medium: 12, low: 24 };

test("re-screen periods come from the policy's sanctions step, falling back to the review periods", () => {
  assert.deepEqual(screeningPolicy(settings({}), review), { high: 6, medium: 12, low: 24, monitor: false, fromPolicy: false });
  assert.deepEqual(screeningPolicy(settings({ sHigh: "12", sMed: "24", sLow: "36", monitor: "yes" }), review), { high: 12, medium: 24, low: 36, monitor: true, fromPolicy: true });
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
