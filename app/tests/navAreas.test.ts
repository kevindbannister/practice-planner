import test from "node:test";
import assert from "node:assert/strict";
import { AREAS, MODULE_LABELS, areaOf, isAreaId, navKeyOf } from "../src/lib/navAreas";

test("every module sits in exactly one area and has a label", () => {
  const all = AREAS.flatMap((a) => a.modules);
  assert.equal(new Set(all).size, all.length);
  for (const m of all) assert.ok(MODULE_LABELS[m], m);
});

test("the old top-menu items are all still reachable", () => {
  const old = ["plan", "clients", "sales", "cosec", "advisory", "comms", "papers", "tax", "payroll", "reporting", "practice"];
  for (const k of old) assert.ok(areaOf(k), k);
  assert.equal(areaOf("home"), undefined);
  assert.equal(areaOf("settings"), undefined);
});

test("sub-screens belong to their parent item", () => {
  assert.equal(navKeyOf("groups"), "clients");
  assert.equal(areaOf("groups"), "run");
  assert.equal(areaOf("chase"), "run");
  assert.equal(areaOf("compliance"), "run");
  assert.equal(areaOf("checklists"), undefined);
  assert.equal(areaOf("portal"), undefined);
  assert.equal(areaOf("cosec"), "deliver");
  assert.equal(areaOf("reporting"), "grow");
});

test("area ids are checked", () => {
  assert.ok(isAreaId("run"));
  assert.ok(!isAreaId("tax"));
  assert.ok(!isAreaId(null));
});

test("tax planning sits under Advise, next to Advisory", () => {
  assert.equal(areaOf("taxplan"), "grow");
  assert.equal(MODULE_LABELS.taxplan, "Tax planning");
  assert.equal(areaOf("tax"), "deliver");
});
