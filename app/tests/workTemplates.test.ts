import test from "node:test";
import assert from "node:assert/strict";
import { Template, JobLite, Env, match, plan, templateProblems, taxYearEnd, taskAndDependency, dependencyFor, readTemplate, templateRow, STARTERS, usage } from "../src/lib/work/templates";
import { Dependency } from "../src/lib/work/dependencies";

const tpl = (o: Partial<Template> = {}): Template => ({ key: "T1", title: "x", enabled: true, kind: "job", preService: "ACC", preTask: "", preStage: "", depService: "CT", depStage: "", relation: "same_period", type: "finish_to_start", verify: false, notes: "", version: 1, created: "", createdBy: "", ...o });
const job = (key: string, service: string, pe: string, o: Partial<JobLite> = {}): JobLite => ({ key, clientKey: "c1", serviceKey: service, periodEnd: pe, status: "Open", title: `${service} ${pe}`, ...o });
const env = (jobs: JobLite[], deps: Dependency[] = [], decisions: Env["decisions"] = []): Env => ({ jobs, deps, decisions, stages: (s) => (s === "ACC" ? ["Records in", "Prepared", "Approved", "Filed"] : ["Start", "Computation", "Finalise"]) });
const c = () => { let n = 0; return { user: "k", now: "2026-11-11T00:00:00Z", key: () => `k${++n}` }; };

test("a template must be finished before it does anything", () => {
  assert.ok(templateProblems(tpl({ depService: "" })).length);
  assert.ok(templateProblems(tpl({ type: "stage" })).length);
  assert.ok(templateProblems(tpl({ type: "partial" })).length);
  assert.equal(templateProblems(tpl()).length, 0);
  assert.equal(match(tpl({ enabled: false }), job("ct", "CT", "2026-12-31"), env([])).kind, "skip");
  assert.equal(match(tpl({ depService: "" }), job("ct", "CT", "2026-12-31"), env([])).kind, "skip");
});
test("same period: one exact match links, none is 'none', several is a review", () => {
  const ct = job("ct", "CT", "2026-12-31");
  assert.equal(match(tpl(), ct, env([ct, job("a", "ACC", "2026-12-31")])).kind, "link");
  assert.equal(match(tpl(), ct, env([ct, job("a", "ACC", "2025-12-31")])).kind, "none");
  assert.equal(match(tpl(), ct, env([ct, job("a", "ACC", "2026-12-31"), job("b", "ACC", "2026-12-31")])).kind, "review");
  assert.equal(match(tpl(), ct, env([ct, job("a", "ACC", "2026-12-31", { clientKey: "c2" })])).kind, "none");
});
test("covering: accounts longer than 12 months is a review, never an automatic link", () => {
  const ctFirst = job("ct1", "CT", "2025-12-31"); // first tax period of an 18 month accounts period
  const acc = job("a", "ACC", "2026-06-30");
  const o = match(tpl({ relation: "covering" }), ctFirst, env([ctFirst, acc]));
  assert.equal(o.kind, "review");
  const ctLast = job("ct2", "CT", "2026-06-30");
  assert.equal(match(tpl({ relation: "covering" }), ctLast, env([ctLast, acc])).kind, "link");
  assert.equal(match(tpl({ relation: "covering" }), ctFirst, env([ctFirst, job("a", "ACC", "2028-06-30")])).kind, "none");
});
test("tax year matching", () => {
  assert.equal(taxYearEnd("2026-04-05"), "2026-04-05"); assert.equal(taxYearEnd("2025-06-30"), "2026-04-05"); assert.equal(taxYearEnd("2026-04-06"), "2027-04-05");
  const sa = job("sa", "CT", "2026-04-05");
  assert.equal(match(tpl({ relation: "tax_year" }), sa, env([sa, job("a", "ACC", "2025-09-30")])).kind, "link");
  assert.equal(match(tpl({ relation: "tax_year" }), sa, env([sa, job("a", "ACC", "2026-09-30")])).kind, "none");
});
test("different client (partnership to partner) is always a review", () => {
  const sa = job("sa", "CT", "2026-04-05");
  const o = match(tpl({ relation: "other_client" }), sa, env([sa, job("p", "ACC", "2025-12-31", { clientKey: "c9" })]));
  assert.equal(o.kind, "review");
  assert.equal(match(tpl({ relation: "other_client" }), sa, env([sa])).kind, "none");
});
test("missing period end, missing stage names and cycles go to review", () => {
  assert.equal(match(tpl(), job("ct", "CT", ""), env([])).kind, "review");
  assert.equal(match(tpl({ depStage: "Gone" }), job("ct", "CT", "2026-12-31"), env([])).kind, "review");
  const ct = job("ct", "CT", "2026-12-31"), a = job("a", "ACC", "2026-12-31");
  const existing: Dependency = { key: "d", prerequisite: { kind: "job", key: "ct" }, dependent: { kind: "job", key: "a" }, type: "finish_to_start", outcome: "complete", verificationRequired: false, status: "active", expectedCompletion: "", resolvedAt: "", resolvedBy: "", overrideReason: "", templateKey: "", created: "", createdBy: "", version: 1 };
  const p = plan([tpl()], [ct], env([ct, a], [existing]));
  assert.equal(p.links.length, 0); assert.equal(p.reviews.length, 1);
});
test("stage names resolve to current numbers", () => {
  const ct = job("ct", "CT", "2026-12-31"), a = job("a", "ACC", "2026-12-31");
  const o = match(tpl({ type: "stage", preStage: "Approved", depStage: "Finalise" }), ct, env([ct, a]));
  assert.equal(o.kind, "link");
  if (o.kind === "link") { assert.equal(o.preStage, 3); assert.equal(o.depStage, 3); const d = dependencyFor(o, o.prerequisite, o.preStage, env([ct, a]), c()); assert.ok(!("error" in d)); if (!("error" in d)) { assert.equal(d.outcome, "stage"); assert.equal(d.templateKey, "T1"); } }
  assert.equal(match(tpl({ type: "stage", preStage: "Nope" }), ct, env([ct, a])).kind, "review");
});
test("existing, removed or declined: never created again; finished jobs untouched", () => {
  const ct = job("ct", "CT", "2026-12-31"), a = job("a", "ACC", "2026-12-31");
  const d = { key: "d", prerequisite: { kind: "job", key: "a" }, dependent: { kind: "job", key: "ct" }, type: "finish_to_start", outcome: "complete", verificationRequired: false, status: "cancelled", expectedCompletion: "", resolvedAt: "", resolvedBy: "", overrideReason: "", templateKey: "T1", created: "", createdBy: "", version: 1 } as Dependency;
  assert.equal(match(tpl(), ct, env([ct, a], [d])).kind, "skip");
  assert.equal(match(tpl(), ct, env([ct, a], [], [{ templateKey: "T1", dependentKey: "ct" }])).kind, "skip");
  assert.equal(match(tpl(), { ...ct, status: "Complete" }, env([ct, a])).kind, "skip");
});
test("information template makes an unshared client task and an information dependency, idempotently keyed", () => {
  const t = tpl({ kind: "task", preService: "", preTask: "VAT records for {period}", type: "information", verify: true, depService: "CT" });
  assert.deepEqual(templateProblems(t), []);
  const ct = job("ct", "CT", "2026-12-31");
  const o = match(t, ct, env([ct]));
  assert.equal(o.kind, "task");
  if (o.kind === "task") { const r = taskAndDependency(o, { ...c(), taskKey: "T9" }); assert.equal(r.task.Title, "VAT records for 2026-12-31"); assert.equal(r.task.OwnerType, "contact"); assert.equal(r.task.Status, "Not requested"); assert.equal(r.task.CaptureKey, "tpl:T1:ct"); assert.equal(r.dependency.verificationRequired, true); assert.equal(r.dependency.prerequisite.key, "T9"); }
});
test("starters are drafts that cannot run until completed; rows round trip; usage", () => {
  assert.ok(STARTERS.length >= 6);
  for (const s of STARTERS) assert.ok(templateProblems({ ...s, key: "x", enabled: true, version: 1, created: "", createdBy: "" }).length > 0);
  const t = readTemplate(templateRow(tpl({ preStage: "Approved" })));
  assert.equal(t.preStage, "Approved"); assert.equal(t.enabled, true);
  assert.equal(usage(tpl(), [{ templateKey: "T1" } as Dependency, { templateKey: "" } as Dependency]).length, 1);
});
