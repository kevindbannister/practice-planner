import { test } from "node:test";
import assert from "node:assert/strict";
import * as b from "../src/lib/amlBuilder";

const get = (st: b.State, id: string) => b.build(st).find((x) => x.id === id)!;

test("an empty builder shows gaps rather than invented answers", () => {
  const all = b.build(b.EMPTY);
  assert.equal(all.length, b.STEPS.length);
  assert.ok(all.every((x) => !x.confirmed));
  assert.ok(get(b.EMPTY, "mlro").gaps.includes("MLRO name"));
  assert.ok(b.outstanding(all).gaps > 10);
});

test("a firm with no relevant employees is told independent review is not required, one with employees is", () => {
  const solo: b.State = { ...b.EMPTY, answers: { team: "alone", extraReview: "no", reportDue: "2027-06-01" } };
  assert.match(get(solo, "report").text, /does not require a written MLRO report/);
  assert.match(get(solo, "report").text, /independent review is not required/);
  const staff: b.State = { ...b.EMPTY, answers: { team: "relevant", reportTo: "the directors", independent: "senior" } };
  assert.match(get(staff, "report").text, /reports in writing to the directors/);
  assert.match(get(staff, "report").text, /not involved in the AML policies/);
});

test("questions follow the answers, and suggestions never overwrite what the person wrote", () => {
  const step = b.stepById("mlro")!;
  assert.ok(!b.shown(step, {}).some((q) => q.k === "deputyName"));
  assert.ok(b.shown(step, { deputy: "yes" }).some((q) => q.k === "deputyName"));
  const out = b.withSuggestions(step, { mlro: "Kim", mlroSkills: "Mine" });
  assert.equal(out.mlroSkills, "Mine");
  const out2 = b.withSuggestions(b.stepById("monitor")!, { high: "3 months" });
  assert.equal(out2.high, "3 months");
  assert.equal(out2.medium, "12 months");
});

test("service controls come from the services ticked, once each", () => {
  const t = get({ ...b.EMPTY, answers: { services: ["bookkeeping", "accounts", "payroll"] } }, "services").text;
  assert.equal((t.match(/Bookkeeping and accounts/g) || []).length, 1);
  assert.match(t, /Payroll:/);
  assert.doesNotMatch(t, /Company formation/);
});

test("a hand edit replaces the written text, and a labelled option reads properly", () => {
  const st: b.State = { ...b.EMPTY, answers: { highFactors: ["pep", "cash"], signoff: "The MLRO", lowUse: "never" }, edits: { sar: "My own wording" }, confirmed: {} };
  assert.equal(get(st, "sar").text, "My own wording");
  assert.equal(get(st, "sar").edited, true);
  assert.match(get(st, "clientrisk").text, /Politically exposed person/);
});

test("versions count up and the export has a contents list and a version table", () => {
  assert.equal(b.nextVersion([]), "1.0");
  assert.equal(b.nextVersion([{ v: "1.0", date: "", note: "", by: "", approved: false }, { v: "1.1", date: "", note: "", by: "", approved: false }]), "1.2");
  const blocks = b.policyBlocks([{ title: "Training", text: "## Training\nOne.\n- a\n- b" }], { firm: "X", version: "1.0", updated: "", approvedBy: "" }, [{ v: "1.0", date: "2026-11-01", note: "First", by: "K", approved: true }]);
  assert.ok(blocks.some((x) => x.t === "table"));
  assert.ok(blocks.some((x) => x.t === "bullets"));
  assert.ok(!blocks.some((x) => x.t === "p" && /\[\[/.test(x.text)));
});

import { FWRA_STEPS } from "../src/lib/amlFwra";
const fw = (a: b.Answers, id: string) => b.build({ ...b.EMPTY, answers: a }, FWRA_STEPS).find((x) => x.id === id)!;

test("the risk assessment reuses policy answers and works out client percentages from the facts", () => {
  const t = fw({ _n: "10", _high: "1", _med: "6", _low: "3", _unrated: "0", f_overallRating: "Medium", f_newRisks: "none" }, "f_overall").text;
  assert.match(t, /10% are rated high risk, 60% medium and 30% low/);
  const geo = fw({ overseas: "none", f_geoPlace: "UK", f_geoHigh: "no", f_geoRating: "Low" }, "f_geo").text;
  assert.match(geo, /No clients are known to have links outside the UK/);
  assert.match(geo, /Rating: Low/);
});

test("risk areas without a rating show a gap, and unrated clients are never guessed", () => {
  assert.ok(fw({}, "f_client").gaps.includes("client risk rating"));
  assert.ok(fw({ _n: "4", _high: "0", _med: "0", _low: "0", _unrated: "4" }, "f_overall").gaps.some((g) => /client risk ratings/.test(g)));
});

test("a firm with no client money says so, and one with client money asks how it is used", () => {
  assert.match(fw({ clientMoney: "none", f_payroll: "no", f_transRating: "Low" }, "f_trans").text, /No client money passes through/);
  assert.ok(fw({ clientMoney: "some" }, "f_trans").gaps.includes("what client money is used for"));
});

import { returnLive } from "../src/lib/amlReturn";
import * as pk from "../src/lib/amlPack";

test("the new policy areas exist, start with gaps, and depend on the answers", () => {
  for (const id of ["staff", "reliance", "ch", "tcsp", "trustreg", "cfa", "dp"]) assert.ok(b.stepById(id), id);
  assert.match(get({ ...b.EMPTY, answers: { team: "alone", future: "The MLRO" } }, "staff").text, /no relevant employees, so there is nobody to screen/);
  assert.match(get({ ...b.EMPTY, answers: { team: "relevant", screen: ["id", "refs"], screenOngoing: "Yearly", contractors: "yes" } }, "staff").text, /identity and right to work; references/);
  const ch = get({ ...b.EMPTY, answers: { files: "yes", acsp: "applied", idMethod: "own", codes: "Locked away", discrep: "Report it" } }, "ch").text;
  assert.match(ch, /will not rely on that status until it is confirmed/);
  assert.match(ch, /seven years/);
  assert.match(get({ ...b.EMPTY, answers: { files: "no", discrep: "x" } }, "ch").text, /does not file at Companies House/);
  assert.match(get({ ...b.EMPTY, answers: { tcspWhich: ["formation"], tcspSup: "no" } }, "tcsp").text, /does not register separately with HMRC/);
  assert.match(get({ ...b.EMPTY, answers: { trusts: "no" } }, "trustreg").text, /does not act for trusts/);
  assert.ok(get(b.EMPTY, "cfa").gaps.length > 0);
});

test("the ACCA return takes only figures the planner holds, and never invents a risk percentage", () => {
  const ctx = { clients: [{ Key: "A", CeasedOn: "" }, { Key: "B", CeasedOn: "2020-01-01" }] as never, clientServices: [{ ClientKey: "A", ServiceKey: "S1" }] as never, services: [{ Key: "S1", Title: "Payroll" }] as never, amlAssessments: [], onboardings: [], today: "2026-11-07", policy: { services: ["formation"], portal: "yes", clientMoney: "none" }, policyVersions: 2, fwraVersions: 0, trainingTwoYears: "Yes" };
  const l = returnLive(ctx);
  assert.equal(l.clients12.value, "1");
  assert.equal(l.payroll.value, "1");
  assert.equal(l.form.value, "Yes");
  assert.equal(l.portal.value, "Yes");
  assert.equal(l.pol.value, "Yes, updated periodically");
  assert.equal(l.mlroTrain.value, "Yes");
  assert.equal(l.highPct, undefined);
  assert.equal(l.fwra, undefined);
});

test("the registrations register and the ACCA return are real forms that export", async () => {
  const reg = pk.formById("registrations")!;
  assert.ok(reg.stored && reg.single);
  const rows = (reg.seed!().items as { item: string }[]).map((r) => r.item).join("|");
  assert.match(rows, /ACCA supervision/);
  assert.match(rows, /authorised corporate service provider/);
  const ret = pk.formById("annualreturn")!;
  const keys = ret.sections.flatMap((s) => s.fields.map((f) => f.k));
  for (const k of ["clients12", "highPct", "fwra", "onboard", "c_pep", "formN"]) assert.ok(keys.includes(k), k);
});

test("a firm that only submits clients' codes gets wording that fits, and the chosen date is used", () => {
  const t = get({ ...b.EMPTY, answers: { files: "yes", acsp: "no", idMethod: "chservice", codeUse: "Check the code", codes: "Locked", discrep: "Report" } }, "ch").text;
  assert.match(t, /not registered as an authorised corporate service provider/);
  assert.match(t, /does not verify identities for Companies House/);
  assert.doesNotMatch(t, /seven years/);
  const f = fw({ _date: "2026-12-01", f_by: "The MLRO", f_shared: "The director", f_next: "2027-12-01" }, "f_actions").text;
  assert.match(f, /Completed on 1 December 2026/);
  assert.ok(fw({ f_by: "x" }, "f_actions").gaps.some((g) => /assessment date/.test(g)));
  assert.equal(b.readState({ date: "2026-12-01" }).date, "2026-12-01");
  assert.equal(b.readState({ date: "nonsense" }).date, undefined);
});
