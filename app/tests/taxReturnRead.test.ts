import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { compute, emptyReturn, newId } from "../src/lib/tax";
import { FORM_YEARS, FormMap, fillForm, fillPdf } from "../src/lib/sa100";
import { readIrisPdf } from "../src/lib/taxFile";
import { checkImport, readImport } from "../src/lib/taxImport";
import { ReadPage, readFormPages } from "../src/lib/taxReturnRead";

// A return, a form and back again: HMRC's blank form for each year is filled from a return (the same code as the Download PDF
// button) and read with the reader that brings in IRIS's printed returns. Every box the reader looks for must be found on every
// year's form, and what was written must come back.
const sample = () => {
  const r = emptyReturn();
  r.front = { region: "england", utr: "1234567890", nino: "AB123456C", dob: "1970-03-09" };
  r.dividends.push({ id: "d", company: "Roofing Ltd", amount: 40520 });
  r.interest.push({ id: "i", payer: "Bank", untaxed: 1060 });
  r.interest.push({ id: "n", payer: "Society", untaxed: 0, net: 800, taxTaken: 200 });
  r.pensions = { state: 9100, others: [{ id: "p", payer: "Scheme", amount: 5000, tax: 1000 }] };
  r.otherIncome = { amount: 1200, taxTaken: 240, description: "Royalties" };
  r.reliefs.giftAid = 100; r.reliefs.pensionRas = 2400; r.charityGifts = 500;
  r.allowances.blind = true;
  r.childBenefit = { amount: 2212, children: 2 };
  r.employments.push({ id: newId(), name: "Roofing Ltd", paye: "577/X1", pay: 9480, tax: 0, benefits: {}, expenses: {}, studentLoanDeducted: 120 });
  return r;
};
const ctx = { name: "Mr Sam Example", address: "1 High Street" };

for (const y of FORM_YEARS) {
  const json = `public/forms/sa100/SA100-${y}.json`;
  if (!existsSync(json)) continue;
  test(`SA100 ${y}: what the app writes into the form is read back`, async () => {
    const map = JSON.parse(readFileSync(json, "utf8")) as FormMap;
    const r = sample();
    const bytes = await fillPdf(new Uint8Array(readFileSync(`public/forms/sa100/SA100-${y}.pdf`)), map, fillForm(map, r, compute(r, y), ctx));
    const file = await readIrisPdf(`SA100-${y}.pdf`, bytes, pdfjs);
    assert.ok(file.forms?.length, "the form pages are recognised");
    const back = readFormPages(file.forms!).ret;
    assert.equal(back.front.dob, "1970-03-09");
    assert.equal(back.dividends.find((d) => !d.foreign)?.amount, 40520);
    assert.equal(back.interest.find((i) => i.untaxed)?.untaxed, 1060);
    const taxed = back.interest.find((i) => i.net);
    assert.equal(taxed?.net, 800);
    assert.equal(taxed?.taxTaken, 200, "tax on taxed interest worked out at 20% of the gross");
    assert.equal(back.pensions?.state, 9100);
    assert.equal(back.pensions?.others[0].amount, 5000); assert.equal(back.pensions?.others[0].tax, 1000);
    assert.equal(back.otherIncome?.amount, 1200); assert.equal(back.otherIncome?.taxTaken, 240);
    assert.equal(back.reliefs.giftAid, 100); assert.equal(back.reliefs.pensionRas, 2400);
    assert.equal(back.allowances.blind, true);
    assert.equal(back.childBenefit?.amount, 2212); assert.equal(back.childBenefit?.children, 2);
    assert.equal(back.charityGifts, 500);
  });
}

for (const y of FORM_YEARS) {
  if (!existsSync(`public/forms/sa100/SA100-${y}.pdf`)) continue;
  test(`SA100 ${y}: a blank form reads as nothing (printed words aren't taken as figures)`, async () => {
    const file = await readIrisPdf("blank.pdf", new Uint8Array(readFileSync(`public/forms/sa100/SA100-${y}.pdf`)), pdfjs);
    const res = readFormPages(file.forms!);
    assert.deepEqual(res.warnings, []); assert.deepEqual(res.notRead, []); assert.deepEqual(res.theirs, {});
    const r = res.ret;
    assert.equal(r.interest.length + r.dividends.length + r.employments.length, 0);
    assert.ok(!r.pensions && !r.benefits && !r.otherIncome && !r.childBenefit && !r.charityGifts && !r.front.dob);
    assert.deepEqual(r.reliefs, {}); assert.deepEqual(r.allowances, {});
  });
}

// IRIS's full return for 2019-20, the one real sample. It holds a client's personal details so it isn't kept in the repo:
// run with IRIS_RETURN_SAMPLE=/path/to/return.pdf to check against it.
const sampleFile = process.env.IRIS_RETURN_SAMPLE;
if (sampleFile && existsSync(sampleFile)) {
  test("IRIS's full return for 2019-20: every page read, and the total agrees with IRIS", async () => {
    const file = await readIrisPdf("return.pdf", new Uint8Array(readFileSync(sampleFile)), pdfjs);
    assert.deepEqual([...new Set(file.forms!.map((p) => `${p.form}${p.no}`))].sort(), ["E1", "TC1", "TC2", "TR1", "TR2", "TR3", "TR4", "TR5", "TR6", "TR7", "TR8"]);
    const res = readImport([file]);
    assert.equal(res.year, 2020); assert.ok(res.utr); assert.ok(res.irmark);
    assert.deepEqual(res.kinds, ["return", "calculation", "summaries"]);
    assert.ok(res.ret.employments.length >= 1 && res.ret.employments[0].paye, "the employment page is read");
    assert.ok(res.ret.dividends.length >= 1, "the dividends are read, with the company name from the summaries");
    assert.deepEqual(res.notRead, []); assert.deepEqual(res.warnings, []);
    // our computation against the total tax IRIS printed in the same file
    assert.ok(res.theirs.totalTax !== undefined);
    assert.equal(checkImport(res).matches, true, "our computation agrees with IRIS to the penny");
  });
}

test("supplementary pages the reader doesn't know yet are named, not dropped", () => {
  const page = (form: string, no: number, boxes: ReadPage["boxes"]): ReadPage => ({ form, no, boxes });
  const yes = (label: string, n: string) => ({ id: `TR2.${n}`, n, label, fields: [{ kind: "tick", sub: "Yes", value: "X" }, { kind: "tick", sub: "No", value: "" }] });
  const res = readFormPages([page("TR", 2, [yes("Self-employment If you worked", "2"), yes("UK property If you received", "4")]), page("SEF", 1, [])]);
  assert.deepEqual(res.notRead, ["Self-employment", "UK property", "Self-employment (full)"]);
});

test("income the form pages can't give comes from the schedules at the end of the file", () => {
  const yes = (label: string, n: string) => ({ id: `TR2.${n}`, n, label, fields: [{ kind: "tick", sub: "Yes", value: "X" }, { kind: "tick", sub: "No", value: "" }] });
  const forms: ReadPage[] = [{ form: "TR", no: 2, boxes: [yes("Self-employment If you worked", "2"), yes("UK property If you received", "4")] }];
  const pages = [["Mr Sam Example UTR: 1234567890", "Detailed summaries for year ended 5 April 2022", "Self-employment: Plumbing", "Net profit £12,000.00", "Total £12,000.00", "UK property", "Net profit £3,500.00", "Total £3,500.00"]];
  const res = readImport([{ name: "return.pdf", pages, forms }]);
  assert.equal(res.ret.selfEmployments[0]?.turnover, 12000);
  assert.equal(res.ret.property?.income, 3500);
  assert.deepEqual(res.notRead, []);
  assert.ok(res.warnings.some((w) => /profit only/.test(w)));
});
