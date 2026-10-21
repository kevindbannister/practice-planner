// Working papers: periods, totals, last year's figures and pasted lines.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  KIND_COLS, SECTIONS, accountCf, carryLines, carrySetup, colTotal, depreciation, expenseCharge, finalTb, journalTotals, leadRows, linesFor, money,
  parseAmount, parseGrid, parsePasted, priorFor, priorPeriod, progress, registerTotals, sectionsOff, stateOf, subsFor, total, vatOwed, yearEnds,
} from "../src/lib/papers";

const line = (o: any) => ({ ClientKey: "C1", PeriodEnd: "2026-03-31", SectionKey: "debtors", SubKey: "trade", Seq: 1, ...o });

test("year ends: newest past ones, and the next to come", () => {
  assert.deepEqual(yearEnds("03-31", "2026-10-19", 2), ["2027-03-31", "2026-03-31", "2025-03-31"]);
  assert.deepEqual(yearEnds(undefined, "2026-10-19"), []);
  assert.equal(yearEnds("02-28", "2024-06-01", 1)[1], "2024-02-29");
});

test("the prior period keeps month ends, leap years included", () => {
  assert.equal(priorPeriod("2026-03-31"), "2025-03-31");
  assert.equal(priorPeriod("2025-02-28"), "2024-02-29");
  assert.equal(priorPeriod("2024-02-29"), "2023-02-28");
  assert.equal(priorPeriod("2026-04-05"), "2025-04-05");
});

test("amounts are typed freely", () => {
  assert.equal(parseAmount("£1,234.50"), 1234.5);
  assert.equal(parseAmount("(200)"), -200);
  assert.equal(parseAmount("-5.5"), -5.5);
  assert.equal(parseAmount(""), undefined);
  assert.equal(parseAmount("abc"), undefined);
  assert.equal(money(-1234.5), "(1,234.50)");
  assert.equal(money(undefined), "");
});

test("totals add pence correctly and last year's figures match on the detail", () => {
  assert.equal(total([{ Amount: 0.1 }, { Amount: 0.2 }, { Amount: undefined }]), 0.3);
  const rows = [
    line({ Key: "a", Detail: "Acme Ltd", Amount: 100 }),
    line({ Key: "b", Detail: "Bolt Ltd", Amount: 50.5, Seq: 2 }),
    line({ Key: "p", PeriodEnd: "2025-03-31", Detail: "ACME LTD", Amount: 80 }),
    line({ Key: "q", PeriodEnd: "2025-03-31", Detail: "Cog Ltd", Amount: 20, Seq: 2 }),
    line({ Key: "o", ClientKey: "C2", Detail: "Other client", Amount: 999 }),
  ];
  assert.deepEqual(linesFor(rows, "C1", "2026-03-31", "debtors", "trade").map((l) => l.Detail), ["Acme Ltd", "Bolt Ltd"]);
  assert.equal(priorFor(rows, "C1", "2026-03-31", "debtors", "trade", "acme ltd"), 80);
  assert.equal(priorFor(rows, "C1", "2026-03-31", "debtors", "trade", "Bolt Ltd"), undefined);
  const lead = leadRows(SECTIONS.find((x) => x.key === "debtors")!, [], rows, "C1", "2026-03-31");
  assert.deepEqual(lead.map((x) => [x.sub.key, x.now, x.before]), [["trade", 150.5, 100], ["prepayments", 0, undefined], ["accrued", 0, undefined], ["group", 0, undefined], ["other", 0, undefined]]);
});

const L = (o: any) => {
  const { f, ...rest } = o;
  return linesFor([{ ClientKey: "C", PeriodEnd: "P", SectionKey: "s", SubKey: "x", Figures: JSON.stringify(f || {}), ...rest }], "C", "P", "s", "x")[0];
};

test("depreciation: reducing balance, straight line, part years, never below nil", () => {
  const car = L({ Detail: "Van", f: { costBf: 20000, depBf: 5000, months: 12 } });
  assert.equal(depreciation(car, { method: "rb", rate: 25 }), 3750); // 25% of 15,000
  assert.equal(depreciation(car, { method: "sl", rate: 25 }), 5000); // 25% of cost
  assert.equal(depreciation(car, { method: "none", rate: 25 }), 0);
  const bought = L({ Detail: "Laptop", f: { add: 1200, months: 6 } });
  assert.equal(depreciation(bought, { method: "sl", rate: 33.33 }), 199.98);
  const nearlyGone = L({ Detail: "Old", f: { costBf: 1000, depBf: 900 } });
  assert.equal(depreciation(nearlyGone, { method: "sl", rate: 25 }), 100);
  const sold = L({ Detail: "Sold", f: { costBf: 1000, depBf: 400, disp: 1000, depDisp: 400 } });
  assert.equal(depreciation(sold, { method: "rb", rate: 25 }), 0);
  const t = registerTotals([car, bought], { method: "rb", rate: 25 });
  assert.deepEqual([t.costBf, t.add, t.costCf, t.depBf, t.charge, t.depCf, t.nbvCf, t.nbvBf], [20000, 1200, 21200, 5000, 3900, 8900, 12300, 15000]);
  // next year: still-held assets carry forward at cost and depreciation c/f
  const carried = carryLines("register", [car, sold], { method: "rb", rate: 25 });
  assert.deepEqual(carried.map((x) => [x.Detail, x.f?.costBf, x.f?.depBf]), [["Van", 20000, 8750]]);
});

test("accounts, VAT, expenses and journals", () => {
  const dla = [L({ Detail: "Drawings", f: { dr: 300 } }), L({ Detail: "Introduced", f: { cr: 1000 } })];
  assert.equal(accountCf(dla, { bf: 500 }, "cr"), 1200);
  assert.equal(accountCf(dla, { bf: 500 }, "dr"), -200);
  assert.deepEqual(carrySetup({ key: "dla", title: "", kind: "account", normal: "cr" }, dla, { bf: 500 }), { bf: 1200 });
  const vat = [L({ Detail: "Q1", f: { out: 5000, in: 1000, paid: 4000 } }), L({ Detail: "Q2", f: { out: 3000, in: 500 } })];
  assert.equal(vatOwed(vat, { bf: 4000 }), 6500);
  const fees = [L({ Code: "123", Detail: "Year end", f: { gross: 1200, vat: 200 } })];
  assert.equal(expenseCharge(fees, { openingAccrual: 500, closingAccrual: 600 }), 1100);
  assert.equal(colTotal(fees, KIND_COLS.expense![4], {}), 1000);
  const j = [L({ Code: "7600", f: { no: 1, dr: 600 } }), L({ Code: "2109", f: { no: 1, cr: 600 } }), L({ Code: "0030", f: { no: 2, dr: 50 } })];
  assert.deepEqual(journalTotals(j), [{ no: 1, dr: 600, cr: 600 }, { no: 2, dr: 50, cr: 0 }]);
  const tb = [L({ Code: "2109", Detail: "Accruals", f: { cr: 500 } }), L({ Code: "7600", Detail: "Accountancy", f: { dr: 500 } })];
  const ftb = finalTb(tb, j.slice(0, 2));
  assert.deepEqual(ftb.map((r) => [r.code, r.dr, r.cr]), [["2109", 0, 1100], ["7600", 1100, 0]]);
});

test("sections: the usual ones on, a company's choice kept into next year; added schedules carry too", () => {
  const off = sectionsOff([], "C", "2026-03-31");
  assert.ok(off.has("goodwill") && off.has("wages") && !off.has("fixed"));
  const rows = [{ ClientKey: "C", PeriodEnd: "2025-03-31", ItemKey: "_sections", Setup: JSON.stringify({ off: ["vat"] }) }];
  assert.deepEqual([...sectionsOff(rows, "C", "2026-03-31")], ["vat"]);
  const exp = SECTIONS.find((x) => x.key === "expenditure")!;
  const setup = [{ ClientKey: "C", PeriodEnd: "2025-03-31", ItemKey: "expenditure", Setup: JSON.stringify({ extra: [{ key: "x1", title: "Rent", kind: "expense" }] }) }];
  assert.deepEqual(subsFor(exp, setup, "C", "2026-03-31").map((x) => x.title), ["Cost of sales", "Expenses per trial balance", "Accountancy", "Rent"]);
  // hire purchase splits between within and after one year on the creditors lead
  const cred = SECTIONS.find((x) => x.key === "creditors")!;
  const p = [{ ClientKey: "C", PeriodEnd: "2026-03-31", ItemKey: "creditors/hp", Setup: JSON.stringify({ bf: 9000, within: 3000 }) }];
  const hp = leadRows(cred, p, [], "C", "2026-03-31").filter((r) => r.sub.key === "hp");
  assert.deepEqual(hp.map((r) => [r.after, r.now]), [[false, 3000], [true, 6000]]);
});

test("pasted rows from Excel", () => {
  assert.deepEqual(parsePasted("Acme Ltd\t1,200.00\nBolt Ltd\t(50)\n\n"), [
    { Code: "", Detail: "Acme Ltd", Amount: 1200 }, { Code: "", Detail: "Bolt Ltd", Amount: -50 },
  ]);
  assert.deepEqual(parsePasted("4000\tSales\t300"), [{ Code: "4000", Detail: "Sales", Amount: 300 }]);
  assert.deepEqual(parsePasted("Just a name"), [{ Code: "", Detail: "Just a name", Amount: undefined }]);
  assert.deepEqual(parseGrid("a\tb\n\t\n c \t1"), [["a", "b"], ["c", "1"]]);
});
