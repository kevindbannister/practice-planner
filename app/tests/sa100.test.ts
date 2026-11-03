import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { compute, emptyReturn, newId } from "../src/lib/tax";
import { FORM_YEARS, FormMap, fillForm, formYearFor, layout } from "../src/lib/sa100";

const mapFor = (y: number): FormMap | undefined => { const f = `public/forms/sa100/SA100-${y}.json`; return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : undefined; };
const sample = () => {
  const r = emptyReturn();
  r.front = { region: "england", utr: "1234567890", nino: "ab123456c", dob: "1970-03-09" };
  r.employments.push({ id: newId(), name: "Roofing Ltd", paye: "577/X1", pay: 9480, tax: 0, benefits: {}, expenses: {}, studentLoanDeducted: 120.4 });
  r.dividends.push({ id: "d", company: "Roofing Ltd", amount: 40520.99 });
  r.interest.push({ id: "i", payer: "Bank", untaxed: 10.6 });
  r.reliefs.giftAid = 99.2;
  r.studentLoan.plans.push("plan2");
  return r;
};

test("a later year uses the newest form held", () => {
  assert.equal(formYearFor(2026), 2026); assert.equal(formYearFor(2027), 2026); assert.equal(formYearFor(2019), undefined);
});

for (const y of FORM_YEARS) {
  const map = mapFor(y);
  if (!map) continue;
  test(`SA100 ${y}: the main boxes are found and filled`, () => {
    const r = sample();
    const filled = fillForm(map, r, compute(r, y), { name: "Mr Sam Example", address: "1 High Street\nTown\nAB1 2CD", agent: { name: "Practice Ltd", ref: "C001" } });
    const byTitle = (t: string) => [...filled.values()].find((f) => f.title.startsWith(t));
    assert.equal(byTitle("UTR")?.values[0], "12345 67890");
    assert.equal(byTitle("Name and address")?.values[0], "Mr Sam Example\n1 High Street\nTown\nAB1 2CD");
    assert.deepEqual(byTitle("Date of birth")?.values, ["09", "03", "1970"]);
    assert.deepEqual(byTitle("Employment pages")?.values, ["X", undefined, "1"]);
    assert.equal(byTitle("Dividends from UK companies")?.values[0], "40520", "income rounded down");
    assert.equal(byTitle("Untaxed UK interest")?.values[0], "10");
    assert.equal(byTitle("Gift Aid payments")?.values[0], "100", "payments rounded up");
    assert.equal(byTitle("Student loan deducted by employers")?.values[0], "121");
    assert.equal(byTitle("Student loan repayments due")?.values[0], "X");
    assert.equal(byTitle("Tax adviser's name")?.values[0], "Practice Ltd");
    assert.equal(byTitle("Supplementary pages enclosed")?.values[0], "X");
    // every page has clickable boxes
    const pages = new Set(map.pages.filter((p) => p.boxes.some((b) => filled.has(b.id))).map((p) => p.tr));
    assert.deepEqual([...pages].sort(), [1, 2, 3, 4, 5, 6, 7, 8]);
  });
}

test("pounds are written right-aligned up to the decimal point", () => {
  const f = { kind: "money" as const, rect: [66, 689, 243, 705] as [number, number, number, number], cells: [[66, 80], [82, 95], [97, 111], [113, 126], [128, 142], [213, 227], [229, 243]] as [number, number][], dec: 208 };
  const out = layout(f, "123");
  assert.deepEqual(out.map((o) => [o.text, o.x]), [["1", 104], ["2", 119.5], ["3", 135]]);
});
