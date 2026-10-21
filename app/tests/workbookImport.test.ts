// Importing a working paper workbook: trial balances, opening balance differences, journals linked to
// the trial balance, asset registers with their depreciation, and the checks on the papers.
import assert from "node:assert/strict";
import { test } from "node:test";
import { KIND_COLS, depreciation, leadRows, pasteColumns, SECTIONS, yearShare } from "../src/lib/papers";
import { planImport } from "../src/lib/workbookImport";
import { workbook } from "../src/lib/xlsx";
import { readXlsx } from "../src/lib/xlsxRead";

const line = (f: any) => ({ Key: "", Code: "", Detail: "", Amount: undefined, Remark: "", Done: false, Seq: 0, f, row: {} });

test("depreciation: part years by days from the date bought, and a typed charge wins", () => {
  const s = { method: "sl", rate: 20, apportion: "days", _period: "2026-04-30" };
  // bought 22/9/25: 220 days of the year to 30/4/26
  assert.equal(depreciation(line({ date: "2025-09-22", add: 6250 }), s), 753.42);
  // bought before the year: a full year
  assert.equal(depreciation(line({ date: "2023-06-24", costBf: 343.25, depBf: 131.58 }), s), 68.65);
  // capped at what's left
  assert.equal(depreciation(line({ date: "2020-11-20", costBf: 10499, depBf: 9449.1 }), s), 1049.9);
  assert.equal(depreciation(line({ date: "2020-11-20", costBf: 10499, depBf: 9449.1, chargeOver: 7 }), s), 7);
  assert.equal(yearShare(line({ date: "2025-12-09" }), s).toFixed(4), (142 / 365).toFixed(4));
  assert.equal(yearShare(line({ months: 6 }), { method: "sl" }), 0.5);
});

test("pasting with a heading row fills columns by their headings, in any order", () => {
  const rows = [["XERO \nN/C", "Description", "IRIS Elements Chart of Accounts", "Dr", "Cr"], ["1", "Sales", "Sales", "", "100"]];
  const { start, order } = pasteColumns(rows, KIND_COLS.tb!);
  assert.equal(start, 1);
  assert.deepEqual(order.map((c) => c?.key), ["Code", "Detail", "iris", "dr", "cr"]);
  assert.deepEqual(KIND_COLS.tb!.map((c) => c.key), ["Code", "Detail", "type", "dr", "cr", "iris"]); // a 5-column Xero paste still fits
  // no headings: in order
  assert.equal(pasteColumns([["1", "Sales", "", "", "100"]], KIND_COLS.tb!).start, 0);
});

test("a lead schedule shows the trial balance figure until its schedule is filled in", () => {
  const cred = SECTIONS.find((x) => x.key === "creditors")!;
  const now = new Map([["creditors/hp", 6366.34], ["creditors/hp#after", 9018.97], ["creditors/trade", 500]]);
  const rows = leadRows(cred, [], [], "C", "2026-04-30", { now });
  const hp = rows.filter((r) => r.sub.key === "hp");
  assert.deepEqual(hp.map((r) => [r.after, r.now, r.fromTb]), [[false, 6366.34, true], [true, 9018.97, true]]);
  assert.equal(rows.find((r) => r.sub.key === "trade")?.now, 500);
});

test("a working paper workbook comes in: TBs, OBD, journals linked to accounts, registers", async () => {
  const bytes = await workbook([
    { name: "Control Sheet", rows: [["Company Name:", "", "TEST TRADING LTD"], ["Year End:", "", "2026-04-30"], ["Nature of Business:", "", "Joinery"], ["VAT Registered:", "", "Yes"]] },
    {
      name: "TB 2026", rows: [
        ["XERO N/C", "Description", "IRIS Elements Chart of Accounts", "OBD", "", "Software TB - 2026", "", "Journal", "", "Closing TB - 2026"],
        ["", "", "", "Dr", "Cr", "Dr", "Cr", "Dr", "Cr", "Dr", "Cr"],
        ["525a", "Motor Vehicles", "Motor vehicles Cost/valuation", "", "", 10000, "", "", "", 10000, ""],
        ["525b", "Motor Vehicles Depreciation", "Motor vehicles Depreciation b/fwd", "", "", "", 4000, "", 2000, "", 6000],
        ["390c", "Vehicle Depreciation", "Depn of motor vehicles", "", "", "", "", 2000, "", 2000, ""],
        ["737", "Creditors Control Account", "Trade creditors", 50, "", "", 1000, "", "", "", 950],
        ["960", "Retained Earnings", "Profit and loss account - Brought forward", "", 50, "", 5000, "", "", "", 5050],
        ["1", "Sales", "Sales", "", "", "", 3000, "", "", "", 3000],
        ["692", "Bank Current Account", "Bank account no. 1", "", "", 3000, "", "", "", 3000, ""],
        ["Total"],
      ],
    },
    { name: "TB 2025", rows: [["N/C", "Description", "IRIS Elements Chart of Accounts", "Closing TB - 2025", "", "IRIS N/C"], ["", "", "", "Dr", "Cr"], ["525a", "Motor vehicles Cost/valuation", "Motor vehicles Cost/valuation", 10000, "", "525/1"], ["960", "P&L", "Profit and loss account - Brought forward", "", 10000, "968/1"], ["Total"]] },
    { name: "Journals", rows: [["S.No.", "Date", "Particulars", "Debit", "Credit"], [1, 46142, "Depreciation (P/L)", 2000, ""], ["", "", "Depreciation (B/S)", "", 2000], ["", "", "(Being depreciation for the year)"], ["", "", "Total", 2000, 2000]] },
    {
      name: "Fixed Assets", rows: [
        ["Motor Vehicles"], [],
        ["Particulars", "Date", "Cost", "", "", "", "Depreciation"],
        ["", "", "B/fwd", "Additions", "Deletions", "C/fwd", "B/fwd", "Charge on deletions reversed", "B/fwd excluding deletions", "Deprn. Rate", "SLM/WDV", "Charge drg the yr"],
        ["Van", 44000, 10000, "", "", 10000, 4000, "", 4000, 0.2, "SLM", 2000],
        ["Total"],
      ],
    },
  ]);
  const plan = planImport(await readXlsx(bytes), "2026-04-30");
  assert.equal(plan.company, "TEST TRADING LTD");
  assert.equal(plan.info.nature, "Joinery");
  assert.equal(plan.info.software, "Xero");
  assert.equal(plan.tb.length, 7);
  assert.deepEqual(plan.tb[0], { Code: "525a", Detail: "Motor Vehicles", f: { iris: "Motor vehicles Cost/valuation", dr: 10000, cr: undefined } });
  assert.deepEqual(plan.obd.map((l) => [l.Detail, l.f?.dr, l.f?.cr]), [["Creditors Control Account", 50, undefined], ["Retained Earnings", undefined, 50]]);
  // the journal lines find the TB accounts by amount (no formulas in this workbook), keep their wording and narrative
  assert.deepEqual(plan.journals.map((l) => [l.f?.no, l.Detail, l.f?.dr, l.f?.cr]), [[1, "Vehicle Depreciation", 2000, undefined], [1, "Motor Vehicles Depreciation", undefined, 2000]]);
  assert.equal(plan.journals[0].Remark, "Being depreciation for the year");
  assert.equal(plan.journals[0].f?.desc, "Depreciation (P/L)");
  assert.equal(plan.priorTb.length, 2);
  assert.equal(plan.priorTb[0].f?.iris, "525/1");
  assert.equal(plan.registers.length, 1);
  assert.deepEqual(plan.registers[0].setup, { method: "sl", rate: 20, apportion: undefined });
  assert.deepEqual(plan.registers[0].lines[0].f, { date: "2020-06-18", costBf: 10000, depBf: 4000, months: 12 });
  assert.deepEqual(plan.problems, []);
});
