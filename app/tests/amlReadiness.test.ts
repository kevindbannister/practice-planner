import test from "node:test";
import assert from "node:assert/strict";
import { readiness, Facts } from "../src/lib/amlReadiness";

const b = (c: number, t: number, v = "", a = false, d = "") => ({ confirmed: c, total: t, version: v, approved: a, date: d, steps: {} as Record<string, boolean> });
const base = (): Facts => ({
  today: "2026-11-09", policy: b(20, 20, "2", true, "2026-06-01"), fwra: b(8, 8, "1", true, "2026-06-01"), mlro: "Kevin Bannister", deputy: "",
  standing: { mlro: { state: "ok", text: "Approved" }, training: { state: "ok", text: "Started" }, independent: { state: "ok", text: "Approved" }, annualreturn: { state: "ok", text: "Approved" }, reviews: { state: "ok", text: "Approved" } },
  trainingNext: "2027-03-01", screeningLast: "2026-09-01",
  clients: { total: 10, none: 0, overdue: 0, soon: 1, triggered: 0 }, regs: { count: 8, late: 0, open: 0 }, actions: { open: 0, late: 0 },
});
const allSteps = (f: Facts) => { for (const k of ["staff", "monitor", "dd", "clientrisk", "sanctions", "sar", "records", "dp", "ch", "tcsp"]) f.policy.steps[k] = true; return f; };
const by = (f: Facts) => Object.fromEntries(readiness(f).map((i) => [i.id, i]));

test("a firm with everything in place has no items needing work", () => {
  const r = readiness(allSteps(base()));
  assert.deepEqual(r.filter((i) => i.state !== "done").map((i) => i.id), []);
});
test("an empty firm is all not started or needs work", () => {
  const f = base(); f.policy = b(0, 20); f.fwra = b(0, 8); f.mlro = ""; f.clients = { total: 5, none: 5, overdue: 0, soon: 0, triggered: 0 };
  f.standing.mlro = { state: "none", text: "Not started" }; f.screeningLast = ""; f.regs = { count: 0, late: 0, open: 0 };
  const r = by(f);
  assert.equal(r.fwra.state, "start"); assert.equal(r["mlro-named"].state, "work"); assert.equal(r.cdd.state, "work"); assert.equal(r["mlro-report"].state, "start"); assert.equal(r.registrations.state, "start");
});
test("an unapproved or stale policy needs work, and says why", () => {
  const f = allSteps(base()); f.policy = { ...f.policy, approved: false };
  assert.equal(by(f).policy.state, "work"); assert.match(by(f).policy.detail, /not marked approved/);
  const g = allSteps(base()); g.policy.date = "2025-01-01";
  assert.equal(by(g)["policy-fresh"].state, "work");
});
test("clients, triggers, training and screening are judged on the dates", () => {
  const f = allSteps(base()); f.clients = { total: 10, none: 2, overdue: 1, soon: 0, triggered: 3 }; f.trainingNext = "2026-10-01"; f.screeningLast = "2025-01-01"; f.regs = { count: 8, late: 1, open: 0 }; f.actions = { open: 3, late: 1 };
  const r = by(f);
  assert.match(r.cdd.detail, /2 with no assessment and 1 overdue/);
  for (const k of ["cdd", "triggers", "training", "sanctions", "registrations", "actions"]) assert.equal(r[k].state, "work", k);
});
