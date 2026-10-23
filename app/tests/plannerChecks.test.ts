import test from "node:test";
import assert from "node:assert/strict";
import { plannerChecks, statutoryDate } from "../src/lib/plannerChecks";
import { reconcile, isPlannerType } from "../src/lib/companiesHouse";
import { ruleFields } from "../src/lib/planning";

const c = (o: any = {}) => ({ Key: "C1", Title: "Acme", Status: "Active", ...o });
const j = (o: any = {}) => ({ Key: "J1", Title: "Accounts", ClientKey: "C1", ServiceKey: "CT600", PeriodEnd: "2026-03-31", Deadline: "2027-03-31", Status: "Open", ...o });
const run = (clients: any[], jobs: any[], services: any[] = [], today = "2026-10-23") => plannerChecks({ clients, jobs, services, today } as any);

test("statutory dates", () => {
  assert.equal(statutoryDate("ACCS_LTD", "2026-03-31"), "2000-01-01".replace("2000-01-01", "2026-12-31"));
  assert.equal(statutoryDate("CT600", "2026-03-31"), "2027-03-31");
  assert.equal(statutoryDate("VAT", "2026-06-30"), "2026-08-07");
  assert.equal(statutoryDate("SA100", "2026-04-05"), "2027-01-31");
  assert.equal(statutoryDate("PAYROLL", "2026-04-05"), undefined);
});
test("matching deadline gives nothing", () => assert.equal(run([c()], [j()]).length, 0));
test("wrong later deadline is red with apply", () => {
  const [p] = run([c()], [j({ Deadline: "2027-06-30" })]);
  assert.equal(p.type, "deadline-rule"); assert.equal(p.severity, "red");
  assert.deepEqual(p.action, { do: "deadline", jobKey: "J1", Deadline: "2027-03-31" });
});
test("earlier manual deadline is a deliberate buffer", () => assert.equal(run([c()], [j({ Deadline: "2027-02-01", DeadlineSource: "Manual" })]).length, 0));
test("missing deadline and before-period deadline", () => {
  assert.equal(run([c()], [j({ Deadline: "" })])[0].type, "deadline-missing");
  assert.equal(run([c()], [j({ Deadline: "2026-01-01" })])[0].type, "deadline-order");
});
test("Companies House governed accounts are left to it", () => assert.equal(run([c()], [j({ ServiceKey: "ACCS_LTD", Deadline: "2027-01-01", DeadlineSource: "Companies House" })]).length, 0));
test("duplicates", () => assert.equal(run([c()], [j(), j({ Key: "J2" })]).filter((p) => p.type === "duplicate").length, 1));
test("SA period must end 5 April", () => assert.ok(run([c()], [j({ ServiceKey: "SA100", PeriodEnd: "2026-03-31", Deadline: "2027-01-31" })]).some((p) => p.type === "period")));
test("custom rule that breaks statutory", () => {
  const svc = [{ Key: "CT600", Title: "CT600", ...ruleFields({ repeatMonths: 12, deadline: "after", months: 9, days: 0, keepMonthEnd: true }) }];
  const p = run([c()], [], svc).find((x) => x.type === "service-rule");
  assert.ok(p); assert.deepEqual(p!.action, { do: "service-rule", serviceKey: "CT600" });
});
test("AML and LoE before work due", () => {
  const out = run([c({ XamaStatus: "", LoEStatus: "" })], [j({ Deadline: "2026-11-30" })]);
  assert.ok(out.some((p) => p.type === "aml") || out.some((p) => p.type === "loe"));
  assert.equal(run([c({ XamaStatus: "", LoEStatus: "" })], [j({ Deadline: "2027-03-31" })]).filter((p) => p.type === "aml" || p.type === "loe").length, 0);
});
test("reconcile keeps CH and planner flags apart", () => {
  const flags = [{ Key: "C1|filed", ClientKey: "C1", Type: "filed", Status: "Open" }, { Key: "C1|aml", ClientKey: "C1", Type: "aml", Status: "Open" }];
  const w = reconcile([], flags as any, new Set(["C1"]), "2026-10-23");
  assert.deepEqual(w.update.map((u) => u.row.Key), ["C1|filed"]);
  const w2 = reconcile([], flags as any, new Set(["C1"]), "2026-10-23", isPlannerType);
  assert.deepEqual(w2.update.map((u) => u.row.Key), ["C1|aml"]);
});
