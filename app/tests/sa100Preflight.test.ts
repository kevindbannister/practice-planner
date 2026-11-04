import test from "node:test";
import assert from "node:assert/strict";
import { coverage, preflight } from "../src/lib/sa100Preflight";
import { emptyReturn, newId } from "../src/lib/tax";

const base = () => { const r = emptyReturn(); r.front = { region: "england", utr: "2896484001", nino: "NM155105D", dob: "1963-06-14" }; return r; };

test("a complete front page passes the planner's checks", () => {
  const v = preflight(base(), 2024, "now", "h");
  assert.deepEqual(v.errors, []); assert.match(v.schema, /not HMRC's own validation/); assert.equal(v.payloadHash, "h");
});

test("a missing UTR, a bad National Insurance number and a missing date of birth are errors", () => {
  const r = base(); r.front = { region: "england", utr: "123", nino: "ZZ123456A" };
  const v = preflight(r, 2024, "now", "h");
  assert.equal(v.errors.length, 3);
  assert.ok(v.errors.some((e) => /UTR/.test(e))); assert.ok(v.errors.some((e) => /National Insurance/.test(e))); assert.ok(v.errors.some((e) => /date of birth/.test(e)));
});

test("unnamed businesses are errors; unsplit expenses and unlinked company dividends are warnings", () => {
  const r = base();
  r.selfEmployments.push({ id: newId(), name: "", turnover: 100, expenses: 50 } as any);
  r.selfEmployments.push({ id: newId(), name: "Shop", turnover: 100, expenses: 50 } as any);
  r.employments.push({ id: newId(), name: "", paye: "", pay: 1, tax: 0, benefits: {}, expenses: {} } as any);
  const v = preflight(r, 2024, "now", "h", { codivs: 2 });
  assert.deepEqual(v.errors, ["Self-employment 1 has no business name."]);
  assert.equal(v.warnings.length, 4);
  assert.ok(v.warnings.some((w) => /2 dividends from Company Secretarial/.test(w)));
});

test("coverage says which SA100 pages the planner has and which this return uses", () => {
  const r = base(); r.employments.push({ id: newId(), name: "A", pay: 1, tax: 0 } as any);
  const c = coverage(r);
  assert.equal(c.find((x) => x.page === "SA102")!.used, true);
  assert.equal(c.find((x) => x.page === "SA103")!.used, false);
  assert.deepEqual(c.filter((x) => x.support === "none").map((x) => x.page), ["SA101", "SA107", "SA109"]);
});

test("the version text ignores status, import details and payments, and the order of keys", async () => {
  const { payloadText } = await import("../src/lib/sa100Preflight");
  const a = base(), b = base();
  b.status = { state: "submitted" } as any; b.payments = { expectedPoa1: 5 } as any; b.imported = { from: "x", on: "y", files: [] };
  assert.equal(payloadText(a), payloadText(b));
  b.front = { dob: "1963-06-14", nino: "NM155105D", utr: "2896484001", region: "england" };
  assert.equal(payloadText(a), payloadText(b));
  b.front.utr = "2896484002";
  assert.notEqual(payloadText(a), payloadText(b));
});
