import { test } from "node:test";
import assert from "node:assert/strict";
import { ACCOUNTS_STATUSES, accountsStatusOf, asStatus, matchesStatus, productionRows, statusCounts, statusSetup } from "../src/lib/accountsStatus.ts";

const today = "2026-11-02";
const client = (k: string, t: string) => ({ Key: k, Title: t, Kind: "Ltd" } as any);
const job = (k: string, c: string, o: any = {}) => ({ Key: k, Title: "Accounts", ClientKey: c, ServiceKey: "ACCS_LTD", PeriodEnd: "2025-09-30", Deadline: "2026-06-30", Status: "Open", ...o } as any);
const clients = new Map([["C1", client("C1", "Alpha Ltd")], ["C2", client("C2", "Beta Ltd")], ["C3", client("C3", "Gamma Ltd")]]);
const papers = [{ ClientKey: "C1", PeriodEnd: "2025-09-30", ItemKey: "_accounts", Setup: JSON.stringify({ status: "sent", at: "2026-10-01T10:00:00Z", by: "Kevin" }) }] as any;

test("the statuses are the seven Elements uses, in order", () => {
  assert.deepEqual(ACCOUNTS_STATUSES.map((s) => s.label), ["Draft", "Final", "Ready for client", "Sent to client", "Awaiting signature", "Approved", "Submitted to CH"]);
  assert.equal(asStatus("ch"), "ch"); assert.equal(asStatus("bogus"), "");
});
test("a status is read from the year's papers, and none means not started", () => {
  assert.deepEqual(accountsStatusOf(papers, "C1", "2025-09-30"), { status: "sent", at: "2026-10-01T10:00:00Z", by: "Kevin" });
  assert.equal(accountsStatusOf(papers, "C1", "2024-09-30").status, "");
  assert.equal(accountsStatusOf(papers, "C2", "2025-09-30").status, "");
});
test("changing the status keeps other settings and clearing removes it", () => {
  const s = statusSetup({ other: 1 }, "approved", "Kevin", "2026-11-02T09:00:00Z");
  assert.deepEqual(s, { other: 1, status: "approved", at: "2026-11-02T09:00:00Z", by: "Kevin" });
  const c = statusSetup(s, "", "Kevin", "x");
  assert.equal(c.status, undefined); assert.equal(c.other, 1);
});
test("rows are only accounts jobs, soonest deadline first, completed ones hidden unless asked", () => {
  const jobs = [job("J1", "C1"), job("J2", "C2", { Deadline: "2026-01-31" }), job("J3", "C3", { ServiceKey: "CT600" }), job("J4", "C3", { Status: "Complete", CompletedDate: "2026-05-01" })];
  const rows = productionRows({ jobs, clients, papers, stagesByService: new Map(), today });
  assert.deepEqual(rows.map((r) => r.job.Key), ["J2", "J1"]);
  assert.equal(rows[0].late, true);
  assert.equal(rows[1].status, "sent");
  assert.equal(productionRows({ jobs, clients, papers, stagesByService: new Map(), today, showComplete: true }).length, 3);
});
test("counts and filters", () => {
  const rows = productionRows({ jobs: [job("J1", "C1"), job("J2", "C2")], clients, papers, stagesByService: new Map(), today });
  const c = statusCounts(rows);
  assert.equal(c.sent, 1); assert.equal(c.none, 1); assert.equal(c.draft, 0);
  assert.equal(rows.filter((r) => matchesStatus(r, "none")).length, 1);
  assert.equal(rows.filter((r) => matchesStatus(r, "soon")).length, 2); // both past their deadline
});
