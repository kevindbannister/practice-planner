import { test } from "bun:test";
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
