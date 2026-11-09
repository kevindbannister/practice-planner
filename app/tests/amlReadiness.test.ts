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

import { COMPANY, INDIVIDUAL } from "../src/lib/amlTemplates";
import { evaluate, templateProblems, templateFor, hints, basisFrom, questions } from "../src/lib/amlTemplate";
const qk = (t: typeof COMPANY, re: RegExp) => questions(t).find((q) => re.test(q.label))!.k;

test("templates load with the expected shape", () => {
  assert.equal(questions(COMPANY).length, 39); assert.equal(questions(INDIVIDUAL).length, 22);
  assert.equal(templateFor("limited").id, "company"); assert.equal(templateFor("individual").id, "individual"); assert.equal(templateFor("sole-trader").id, "company");
});
test("hidden questions show only when their condition holds, and required ones count as missing", () => {
  const trading = qk(COMPANY, /trading name different/), name = qk(COMPANY, /What is the trading name/);
  assert.ok(!evaluate(COMPANY, {}).shown.some((q) => q.k === name));
  assert.ok(evaluate(COMPANY, { [trading]: "Yes" }).shown.some((q) => q.k === name));
  assert.ok(evaluate(COMPANY, {}).missing.length > 0);
});
test("MUST and SHOULD rules produce findings, and only MUST blocks", () => {
  const pep = qk(INDIVIDUAL, /identified as a PEP/), id = qk(INDIVIDUAL, /Overall client identity risk/), cash = qk(INDIVIDUAL, /income in cash/), tx = qk(INDIVIDUAL, /Overall transactional risk/);
  const r = evaluate(INDIVIDUAL, { [pep]: "Yes", [id]: "Normal", [cash]: "Yes", [tx]: "Low" });
  assert.ok(r.findings.some((f) => f.strict === "MUST" && f.question === id));
  assert.ok(r.findings.some((f) => f.strict === "SHOULD" && f.question === tx));
  const ok = evaluate(INDIVIDUAL, { [pep]: "Yes", [id]: "High" });
  assert.ok(!ok.findings.some((f) => f.question === id));
  assert.ok(templateProblems(INDIVIDUAL, { [pep]: "Yes", [id]: "Normal" }).some((p) => /Overall client identity risk/.test(p) && /High/.test(p)));
});
test("the SDD rule says a client that does not qualify must not be rated low", () => {
  const sdd = qk(COMPANY, /simplified due diligence/), id = qk(COMPANY, /Overall client identity risk/);
  const r = evaluate(COMPANY, { [sdd]: "No", [id]: "Low" });
  assert.ok(r.findings.some((f) => f.strict === "MUST" && f.question === id && /anything but Low/.test(f.text)));
  assert.ok(!evaluate(COMPANY, { [sdd]: "No", [id]: "Normal" }).findings.some((f) => f.question === id));
});
test("highest section rating, basis wording and hints", () => {
  const a = { [qk(INDIVIDUAL, /Overall client identity risk/)]: "Low", [qk(INDIVIDUAL, /Overall geographical risk/)]: "High", [qk(INDIVIDUAL, /Overall transactional risk/)]: "Normal" };
  assert.equal(evaluate(INDIVIDUAL, a).highest, "high");
  assert.match(basisFrom(INDIVIDUAL, a), /identity low.*geography high/);
  const h = hints(COMPANY, { companyNumber: "123", owners: 2, passedIdentity: true, passedScreening: true, xamaIdDone: false, xamaAmlDone: false, ownershipAgrees: true, services: ["Annual accounts", "Payroll"] });
  assert.equal(h[qk(COMPANY, /registered with Companies House/)].value, "Yes");
  assert.deepEqual(h[qk(COMPANY, /services does our firm offer/)].value, ["Accounts", "Payroll"]);
  assert.equal(h[qk(COMPANY, /Sanctions screening result/)].value, "No");
  assert.ok(!h[qk(COMPANY, /passed the AML identity/)]);
});
