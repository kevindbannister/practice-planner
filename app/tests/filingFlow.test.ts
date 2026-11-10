import test from "node:test";
import assert from "node:assert/strict";
import { Attempt, accountsItems, flowOf } from "../src/lib/accounts/filingFlow";
import { FakeGateway } from "../src/lib/cosecGateway";

const base = { jobStatus: "approved", approvalStale: false, modelErrors: [], mappingProblems: [], server: { available: true, reason: null, test: true }, attempts: [] as Attempt[] };
const att = (n: number, status: Attempt["status"], detail = ""): Attempt => ({ key: `attempt#J1#${n}`, attempt: n, status, test: true, at: "2026-11-01T10:00:00Z", detail, history: [] });

test("today's reality: the server says unavailable, so there is no way to send", () => {
  const f = flowOf({ ...base, mappingProblems: ["no entry point"], server: { available: false, reason: "spec-not-verified", test: true } });
  assert.equal(f.canSubmit, false); assert.equal(f.state, "manual"); assert.ok(f.blockers.some((b) => b.includes("technical specification")));
  assert.equal(flowOf({ ...base, server: null }).canSubmit, false, "an unreachable server never allows sending");
});
test("every precondition blocks sending on its own", () => {
  assert.equal(flowOf(base).canSubmit, true);
  for (const o of [{ jobStatus: "prepared" }, { approvalStale: true }, { modelErrors: ["x"] }, { mappingProblems: ["x"] }, { server: { available: false, reason: "storage-not-configured", test: true } }]) assert.equal(flowOf({ ...base, ...o }).canSubmit, false, JSON.stringify(o));
});
test("any earlier attempt (except a failed one) blocks another send and explains why", () => {
  for (const s of ["submitting", "acknowledged", "pending", "accepted", "rejected", "unknown"] as const) { const f = flowOf({ ...base, attempts: [att(1, s)] }); assert.equal(f.canSubmit, false, s); assert.equal(f.state, s); }
  assert.equal(flowOf({ ...base, attempts: [att(1, "failed")] }).canSubmit, true);
  assert.match(flowOf({ ...base, attempts: [att(1, "unknown")] }).headline, /Do not send again/);
  assert.match(flowOf({ ...base, attempts: [att(1, "acknowledged")] }).headline, /not acceptance/);
});
test("the latest attempt decides", () => {
  assert.equal(flowOf({ ...base, attempts: [att(1, "rejected"), att(2, "pending")] }).state, "pending");
});
test("the demo gateway never claims electronic filing is available", async () => {
  const i = await new FakeGateway().accountsInfo(); assert.equal(i!.available, false);
});

const job = (o: Record<string, string>) => ({ Key: "J1", ClientKey: "C1", Status: "prepared", Deadline: "2026-12-31", PeriodEnd: "2026-03-31", ApprovedHash: "", ...o });
const run = (j: ReturnType<typeof job>, a: Attempt[] = [], today = "2026-11-10", hashes: Record<string, string> = {}) => accountsItems([j], a, () => "Acme Ltd", today, hashes);
test("Action Centre items", () => {
  assert.deepEqual(run(job({})).map((i) => i.key), []);                                   // 51 days away
  assert.deepEqual(run(job({ Deadline: "2026-11-30" })).map((i) => i.key), ["acct:J1:soon"]);
  assert.equal(run(job({ Deadline: "2026-11-01" }))[0].priority, "high");
  assert.deepEqual(run(job({ Status: "approved", Deadline: "2026-11-30" })).map((i) => i.key), ["acct:J1:due"]);
  assert.deepEqual(run(job({ Status: "approved", Deadline: "2026-11-01" })).map((i) => i.key), ["acct:J1:late"]);
  assert.deepEqual(run(job({ Status: "rejected" })).map((i) => i.key), ["acct:J1:rejected"]);
  assert.deepEqual(run(job({ Status: "filed", FiledOn: "2026-11-01" })).map((i) => i.key), ["acct:J1:waiting"]);
  assert.deepEqual(run(job({ Status: "filed", FiledOn: "2026-11-08" })).map((i) => i.key), [], "recently filed is not nagged");
  assert.deepEqual(run(job({ Status: "complete", Deadline: "2020-01-01" })).map((i) => i.key), []);
  assert.deepEqual(run(job({ Status: "cancelled", Deadline: "2020-01-01" })).map((i) => i.key), []);
});
test("stale approval and uncertain attempts are high priority", () => {
  const stale = run(job({ Status: "approved", ApprovedHash: "aaa" }), [], "2026-11-10", { J1: "bbb" });
  assert.ok(stale.some((i) => i.key === "acct:J1:stale" && i.priority === "high"));
  assert.equal(run(job({ Status: "approved", ApprovedHash: "aaa" }), [], "2026-11-10", { J1: "aaa" }).some((i) => i.key.endsWith("stale")), false);
  const u = run(job({ Status: "approved" }), [att(1, "unknown")]); assert.ok(u.some((i) => i.key === "acct:J1:unknown" && i.detail.includes("Do not send again")));
  assert.ok(run(job({ Status: "filed", FiledOn: "2026-11-09" }), [att(1, "rejected", "Balance sheet date missing")]).some((i) => i.detail === "Balance sheet date missing"));
});
