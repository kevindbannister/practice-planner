import test from "node:test";
import assert from "node:assert/strict";
import { startJobRow } from "../src/lib/onboarding.ts";
import { planServiceEdit } from "../src/lib/fees.ts";

const client: any = { Key: "C1", Title: "Acme Ltd", YearEnd: "31 March" };
const services: any[] = [{ Key: "PAYROLL", Title: "Payroll" }, { Key: "ACCS_LTD", Title: "Limited company accounts" }];
const stages: any[] = [{ ServiceKey: "PAYROLL", StageNo: 2, Title: "Process" }, { ServiceKey: "PAYROLL", StageNo: 1, Title: "Records in" }];
let n = 0;
const newKey = (p: string) => `${p}${++n}`;
const base = { services, stageTemplates: stages, client, jobs: [] as any[], today: "2026-11-13", newKey };

test("adding a service by hand starts its first job, planned by the type's rule", () => {
  const j = startJobRow({ ...base, serviceKey: "PAYROLL" })!;
  assert.equal(j.ServiceKey, "PAYROLL");
  assert.equal(j.Status, "Open");
  assert.equal(j.StageName, "Records in", "the first stage");
  assert.equal(j.PeriodEnd, "2026-11-30", "this month's end");
  assert.ok(j.PlannedDate && String(j.PlannedDate) <= String(j.Deadline), "payroll plans a few working days before the deadline");
  const a = startJobRow({ ...base, serviceKey: "ACCS_LTD" })!;
  assert.equal(a.PeriodEnd, "2027-03-31", "from the client's year end");
});

test("no job when one is already open, or the service isn't a type of work", () => {
  assert.equal(startJobRow({ ...base, serviceKey: "PAYROLL", jobs: [{ ClientKey: "C1", ServiceKey: "PAYROLL", Status: "Open" }] }), null);
  assert.ok(startJobRow({ ...base, serviceKey: "PAYROLL", jobs: [{ ClientKey: "C1", ServiceKey: "PAYROLL", Status: "Complete" }] }));
  assert.equal(startJobRow({ ...base, serviceKey: "NOPE" }), null);
});

test("saving a new service in Edit services creates the job in the same save", () => {
  let k = 0;
  const w: any = planServiceEdit({
    client, schedule: [], edits: [{ serviceKey: "PAYROLL", on: true, fee: "50", period: "monthly" }], today: "2026-11-13", reviewMonths: 12, reason: "",
    startJob: (sk, fee, period) => startJobRow({ ...base, serviceKey: sk, fee, period }), can: () => true,
  }, { actor: "Kevin", now: "2026-11-13T10:00:00Z", pid: "default", newKey: (p: string) => `${p}x${++k}` });
  assert.ok(!w.error, w.error);
  assert.deepEqual(w.creates.filter((c: any) => c.list === "Jobs").map((c: any) => c.row.ServiceKey), ["PAYROLL"]);
  assert.equal(w.creates.find((c: any) => c.list === "Jobs").row.Fee, 50);
});
