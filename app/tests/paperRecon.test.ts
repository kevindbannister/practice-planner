// The fixed asset summary's columns, this year's additions, the depreciation journal and per-section reconciliation to the trial balance.
import assert from "node:assert/strict";
import { test } from "node:test";
import { SECTIONS, linesFor, registerTotals, setupOf, setupKey } from "../src/lib/papers";
import { IRIS_BUILT_IN, mappedWithout, paperAccounts, mapTb, tbTotals } from "../src/lib/tbMap";
import { additionsFromRegisters, classShown, disposalsFromRegisters, depreciationJournal, journalSignature, sectionRecon } from "../src/lib/paperRecon";

const P = "2026-03-31", C = "C1";
const tb = (Key: string, Code: string, Detail: string, type: string, dr?: number, cr?: number) => ({
  Key, ClientKey: C, PeriodEnd: P, SectionKey: "tb", SubKey: "main", Code, Detail, Seq: Number(Key.slice(1)) || 1, Figures: JSON.stringify({ type, dr, cr }),
});
const reg = (Key: string, sub: string, Detail: string, f: Record<string, unknown>, seq: number) => ({ Key, ClientKey: C, PeriodEnd: P, SectionKey: "fixed", SubKey: sub, Detail, Seq: seq, Figures: JSON.stringify(f) });
const setup = (ItemKey: string, s: Record<string, unknown>) => ({ Key: `S${ItemKey}`, ClientKey: C, PeriodEnd: P, ItemKey, Setup: JSON.stringify(s) });

test("a class column shows unless the trial balance has nothing for it", () => {
  assert.equal(classShown({ hasTb: false, hasFigures: false }), true, "no trial balance yet: show everything");
  assert.equal(classShown({ hasTb: true, tbCost: 100, hasFigures: false }), true);
  assert.equal(classShown({ hasTb: true, tbDep: -5, hasFigures: false }), true);
  assert.equal(classShown({ hasTb: true, hasFigures: false }), false);
  assert.equal(classShown({ hasTb: true, tbCost: 0, tbDep: 0, hasFigures: false }), false);
  assert.equal(classShown({ hasTb: true, hasFigures: true }), true, "a register with figures but no trial balance stays on show: that is a difference");
  assert.equal(classShown({ hasTb: true, hasFigures: false, override: true }), true, "ticked on by the user");
  assert.equal(classShown({ hasTb: true, tbCost: 100, hasFigures: true, override: false }), false, "ticked off by the user");
});

test("every asset in a register's breakdown with an addition is in this year's additions", () => {
  const rows = additionsFromRegisters([
    { key: "plant", title: "Plant and machinery", lines: linesFor([reg("L1", "plant", "Lathe", { add: 5000, date: "2025-06-01" }, 1), reg("L2", "plant", "Old press", { costBf: 900 }, 2)], C, P, "fixed", "plant") },
    { key: "motor", title: "Motor vehicles", lines: linesFor([reg("L3", "motor", "Van", { add: 12000.5, date: "2025-09-10" }, 1)], C, P, "fixed", "motor") },
  ]);
  assert.deepEqual(rows.map((r) => [r.cls, r.asset, r.amount]), [["Plant and machinery", "Lathe", 5000], ["Motor vehicles", "Van", 12000.5]]);
});

test("the depreciation journal credits each class and debits the charge, and brings the trial balance into line with the registers", () => {
  const papers = [
    setup("fixed/plant", { method: "sl", rate: 20 }),
    setup("fixed/motor", { method: "none" }),
    setup("tb/main", { maps: {} }),
  ];
  const lines = [
    tb("T1", "230", "Plant and machinery - cost", "Fixed Asset", 10000, undefined),
    tb("T2", "231", "Plant and machinery - accumulated depreciation", "Fixed Asset", undefined, 2000),
    tb("T3", "200", "Sales", "Revenue", undefined, 20000),
    tb("T4", "310", "Wages", "Overheads", 10000, undefined),
    tb("T5", "090", "Business bank", "Bank", 2000, undefined),
    reg("R1", "plant", "Lathe", { costBf: 10000, depBf: 2000 }, 1),
  ];
  const chart = IRIS_BUILT_IN;
  const before = mappedWithout(lines, papers, C, P, chart, "dep");
  const totals = tbTotals(before);
  assert.equal(totals.get("fixed/plant#dep"), 2000);
  const regT = registerTotals(linesFor(lines, C, P, "fixed", "plant"), { ...setupOf(papers, C, P, setupKey("fixed", "plant")), _period: P });
  assert.equal(regT.charge, 2000);
  const plantDep = before.find((m) => m.dest === "fixed/plant#dep")!;
  const j = depreciationJournal([{ key: "plant", title: "Plant and machinery", depCf: regT.depCf, tbDep: totals.get("fixed/plant#dep") || 0, creditAcct: { code: plantDep.acct.code, name: plantDep.acct.account } }], undefined, "31/03/2026");
  assert.deepEqual(j.lines.map((l) => [l.Detail, l.dr, l.cr]), [["Depreciation", 2000, 0], ["Plant and machinery - accumulated depreciation", 0, 2000]]);
  assert.ok(j.newAccounts.some((a) => a.name === "Depreciation" && a.dest === "expenditure/tb"));
  assert.match(j.lines[0].Remark || "", /Being depreciation charge/);

  // put the journal through: the final trial balance still balances and the depreciation now agrees to the register
  const jl = j.lines.map((l, i) => ({ Key: `J${i}`, ClientKey: C, PeriodEnd: P, SectionKey: "journals", SubKey: "dep", Code: l.Code, Detail: l.Detail, Seq: i + 1, Figures: JSON.stringify({ no: 1, dr: l.dr || undefined, cr: l.cr || undefined }) }));
  const all = [...lines, ...jl];
  const fin = paperAccounts(all, C, P);
  assert.equal(Math.round(fin.reduce((a, r) => a + r.dr - r.cr, 0) * 100) / 100, 0);
  const after = tbTotals(mapTb(fin, { lines: all, papers }, C, P, chart));
  assert.equal(after.get("fixed/plant#dep"), regT.depCf);

  // and asking again finds nothing more to journal
  const again = mappedWithout(all, papers, C, P, chart, "dep");
  assert.equal(tbTotals(again).get("fixed/plant#dep"), 2000);
});

test("a class that already agrees, or has more depreciation in the trial balance, has no journal line", () => {
  const j = depreciationJournal([
    { key: "plant", title: "Plant", depCf: 500, tbDep: 500 },
    { key: "motor", title: "Motor vehicles", depCf: 100, tbDep: 400 },
  ], undefined, "31/03/2026");
  assert.deepEqual(j.lines, []);
  assert.match(j.notes.join(" "), /Motor vehicles: the trial balance has £300.00 more/);
});

test("accounts the journal needs are named when the trial balance has none", () => {
  const j = depreciationJournal([{ key: "motor", title: "Motor vehicles", depCf: 300, tbDep: 0 }, { key: "freehold", title: "Freehold property", depCf: 50, tbDep: 0 }], { code: "415", name: "Depreciation charge" }, "31/03/2026");
  assert.deepEqual(j.lines.map((l) => [l.Code, l.Detail, l.dr, l.cr]), [["415", "Depreciation charge", 350, 0], ["525/21", "Motor vehicles depreciation", 0, 300], ["", "Freehold property depreciation", 0, 50]]);
  assert.equal(j.newAccounts.length, 2);
});

test("the stored journal's signature changes when the amounts do", () => {
  const a = journalSignature([{ Code: "1", Detail: "A", dr: 5, cr: 0 }, { Code: "2", Detail: "B", dr: 0, cr: 5 }]);
  assert.equal(a, journalSignature([{ Code: "2", Detail: "b", dr: 0, cr: 5 }, { Code: "1", Detail: "a", dr: 5, cr: 0 }]));
  assert.notEqual(a, journalSignature([{ Code: "1", Detail: "A", dr: 6, cr: 0 }, { Code: "2", Detail: "B", dr: 0, cr: 6 }]));
});

test("a section reconciles to the trial balance, or shows the difference", () => {
  const sec = SECTIONS.find((s) => s.key === "fixed")!;
  const papers = [setup("fixed/plant", { method: "none" })];
  const lines = [reg("R1", "plant", "Lathe", { costBf: 10000, depBf: 2000 }, 1)];
  const agree = sectionRecon(sec, papers, lines, C, P, new Map([["fixed/plant#cost", 10000], ["fixed/plant#dep", 2000]]));
  assert.deepEqual([agree.checked, agree.diffs], [2, []]);
  const off = sectionRecon(sec, papers, lines, C, P, new Map([["fixed/plant#cost", 10000], ["fixed/plant#dep", 1500]]));
  assert.deepEqual(off.diffs, [{ label: "Plant and machinery: depreciation", diff: 500 }]);
  assert.equal(sectionRecon(sec, papers, lines, C, P, undefined).checked, 0, "no trial balance: nothing to agree to");

  const vat = SECTIONS.find((s) => s.key === "vat")!;
  const vl = [{ Key: "V1", ClientKey: C, PeriodEnd: P, SectionKey: "vat", SubKey: "control", Detail: "x", Seq: 1, Figures: JSON.stringify({ cr: 300 }) }];
  assert.deepEqual(sectionRecon(vat, [], vl, C, P, new Map([["vat/control", 300]])).diffs, []);
  assert.equal(sectionRecon(vat, [], vl, C, P, new Map([["vat/control", 250]])).diffs[0].diff, 50);
});

test("disposals come from the register lines and the profit or loss is proceeds less NBV", () => {
  const lines = linesFor([
    reg("D1", "plant", "Drill", { disp: 3000, depDisp: 2500, proceeds: 800, disposedOn: "2025-12-01" }, 1),
    reg("D2", "plant", "Saw", { disp: 500, depDisp: 500 }, 2),
    reg("D3", "plant", "Lathe", { costBf: 9000 }, 3),
  ], C, P, "fixed", "plant");
  const rows = disposalsFromRegisters([{ key: "plant", title: "Plant and machinery", lines }]);
  assert.deepEqual(rows.map((r) => [r.asset, r.nbv, r.proceeds, r.profit]), [["Drill", 500, 800, 300], ["Saw", 0, undefined, undefined]]);
  assert.equal(rows[0].disposedOn, "2025-12-01");
});
