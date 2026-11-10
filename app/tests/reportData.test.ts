import assert from "node:assert/strict";
import { test } from "node:test";
import { bsStatement, addMonths, lastCompleteMonth, parseBalanceSheet, periodCols, periodMonths, plStatement, readReportData, yearOf } from "../src/lib/reportData";

const rowPl = (title: string, rows: [string, number[]][]) => ({ RowType: "Section", Title: title, Rows: rows.map(([n, a]) => ({ RowType: "Row", Cells: [{ Value: n }, ...a.map((v) => ({ Value: String(v) }))] })) });
const header = (n: number) => ({ RowType: "Header", Cells: [{ Value: "" }, ...Array.from({ length: n }, (_, i) => ({ Value: `M${i}` }))] });

test("months add across year ends and the last complete month is last month", () => {
  assert.equal(addMonths("2026-11", 3), "2027-02");
  assert.equal(addMonths("2026-01", -1), "2025-12");
  assert.equal(lastCompleteMonth("2026-11-05"), "2026-10");
});

test("the financial year, quarter and year to date follow the year end month", () => {
  assert.deepEqual(yearOf("2026-10", 9), { first: "2026-10", last: "2027-09" });
  assert.deepEqual(yearOf("2026-09", 9), { first: "2025-10", last: "2026-09" });
  assert.deepEqual(periodMonths("quarter", "2026-11", 9), ["2026-10", "2026-11"]);
  assert.deepEqual(periodMonths("quarter", "2027-03", 9), ["2027-01", "2027-02", "2027-03"]);
  assert.equal(periodMonths("year", "2026-12", 9).length, 3);
  assert.deepEqual(periodMonths("month", "2026-10", 9), ["2026-10"]);
});

test("columns: prior period, same period last year, and every month of the year with a total", () => {
  const prior = periodCols("month", "2026-10", 9, "prior");
  assert.deepEqual(prior.map((c) => c.months), [["2026-10"], ["2026-09"]]);
  const ly = periodCols("quarter", "2027-03", 9, "lastYear");
  assert.deepEqual(ly[1].months, ["2026-01", "2026-02", "2026-03"]);
  const yr = periodCols("year", "2027-03", 9, "prior");
  assert.equal(yr[0].months.length, 6);
  assert.equal(yr[1].months.length, 6);
  assert.equal(yr[1].months[0], "2025-10");
  const all = periodCols("year", "2027-03", 9, "months");
  assert.equal(all.length, 13);
  assert.equal(all[12].total, true);
  assert.equal(all[12].months.length, 6);
  assert.deepEqual(all[8].months, []); // a month still to come has no figure
});

const months = ["2026-08", "2026-09", "2026-10"];
const data = {
  months,
  pl: [
    { code: "200", name: "Sales", group: "income", amounts: [100, 120, 140] },
    { code: "310", name: "Purchases", group: "cos", amounts: [40, 50, 60] },
    { code: "400", name: "Rent", group: "expense", amounts: [10, 10, 10] },
    { code: "460", name: "Wages", group: "expense", amounts: [20, 20, 30] },
    { code: "270", name: "Interest", group: "other", amounts: [0, 1, 1] },
  ],
};

test("profit and loss adds the months of a period and reaches net profit", () => {
  const cols = periodCols("quarter", "2026-10", 9, "none");
  assert.deepEqual(cols[0].months, ["2026-10"]);
  const m = plStatement(data, periodCols("month", "2026-10", 12, "prior"), "summary");
  const val = (l: string, i = 0) => m.find((r) => r.label === l)!.vals[i];
  assert.equal(val("Revenue"), 140);
  assert.equal(val("Revenue", 1), 120);
  assert.equal(val("Gross Profit"), 80);
  assert.equal(val("Operating Profit"), 40);
  assert.equal(val("Net Profit"), 41);
  const y = plStatement(data, periodCols("year", "2026-10", 12, "none"), "summary");
  assert.equal(y.find((r) => r.label === "Revenue")!.vals[0], 360);
  assert.equal(y.find((r) => r.label === "Net Profit")!.vals[0], 360 - 150 - 100 + 2);
});

test("detailed profit and loss lists the accounts under each heading with totals", () => {
  const d = plStatement(data, periodCols("month", "2026-10", 12, "none"), "detailed");
  const labels = d.map((r) => r.label);
  assert.ok(labels.indexOf("Rent") > labels.indexOf("Expenses") && labels.indexOf("Rent") < labels.indexOf("Total expenses"));
  assert.equal(d.find((r) => r.label === "Total expenses")!.vals[0], 40);
});

test("every month of the year gives a column for each month and a total", () => {
  const s = plStatement(data, periodCols("year", "2026-10", 9, "months"), "summary");
  const rev = s.find((r) => r.label === "Revenue")!;
  assert.equal(rev.vals.length, 13);
  assert.equal(rev.vals[0], 140); // October is the first month of this year
  assert.equal(rev.vals[1], undefined); // November has not happened
  assert.equal(rev.vals[12], 140);
});

test("balance sheet takes the balance at the end of the period and balances to equity", () => {
  const bs = {
    bsMonths: months,
    bs: [
      { code: "610", name: "Debtors", group: "curAsset", amounts: [10, 20, 30] },
      { code: "090", name: "Bank", group: "bank", amounts: [5, 6, 7] },
      { code: "800", name: "Creditors", group: "curLiab", amounts: [4, 5, 6] },
      { code: "960", name: "Retained earnings", group: "equity", amounts: [11, 21, 31] },
    ],
  };
  const st = bsStatement(bs, periodCols("quarter", "2026-10", 12, "prior"), "summary");
  const v = (l: string, i = 0) => st.find((r) => r.label === l)!.vals[i];
  assert.equal(v("Total Assets"), 37);
  assert.equal(v("Net Assets"), 31);
  assert.equal(v("Equity"), 31);
});

test("a balance sheet report is read by section, newest column first", () => {
  const report = { Reports: [{ Rows: [
    { RowType: "Header", Cells: [{ Value: "" }, { Value: "31 Oct 2026" }, { Value: "30 Sep 2026" }] },
    { RowType: "Section", Title: "Assets", Rows: [
      { RowType: "Section", Title: "Bank", Rows: [{ RowType: "Row", Cells: [{ Value: "Current account" }, { Value: "1,000.00" }, { Value: "(200.00)" }] }] },
      { RowType: "Section", Title: "Fixed Assets", Rows: [{ RowType: "Row", Cells: [{ Value: "Van" }, { Value: "5000" }, { Value: "5000" }] }] },
    ] },
    { RowType: "Section", Title: "Liabilities", Rows: [{ RowType: "Section", Title: "Current Liabilities", Rows: [{ RowType: "Row", Cells: [{ Value: "Trade creditors" }, { Value: "300" }, { Value: "250" }] }] }] },
    { RowType: "Section", Title: "Equity", Rows: [{ RowType: "Row", Cells: [{ Value: "Retained earnings" }, { Value: "5700" }, { Value: "4550" }] }] },
  ] }] };
  const { rows, columns } = parseBalanceSheet(report, []);
  assert.equal(columns, 2);
  assert.deepEqual(rows.map((r) => [r.name, r.group, r.amounts]), [
    ["Current account", "bank", [1000, -200]], ["Van", "fixed", [5000, 5000]], ["Trade creditors", "curLiab", [300, 250]], ["Retained earnings", "equity", [5700, 4550]],
  ]);
});

test("reading from Xero asks for a year of months at a time, newest column first, and keeps the profit and loss if the balance sheet is refused", async () => {
  const asked: any[] = [];
  const api: any = {
    async get(_id: string, _api: string, path: string, q: any = {}) {
      if (path === "Accounts") return { Accounts: [] };
      if (path === "Reports/ProfitAndLoss") {
        asked.push(q);
        const n = Number(q.periods) + 1;
        const labels = Array.from({ length: n }, (_, i) => `${addMonths(String(q.toDate).slice(0, 7), -i)}-28`); // newest first, as Xero gives them
        const head = { RowType: "Header", Cells: [{ Value: "" }, ...labels.map((l) => ({ Value: l }))] };
        const sales = Array.from({ length: n }, (_, i) => n - i); // the oldest month is 1, the newest is n
        return { Reports: [{ Rows: [head, rowPl("Trading Income", [["Sales (200)", sales]]), { RowType: "Section", Title: "", Rows: [{ RowType: "Row", Cells: [{ Value: "Gross Profit" }, { Value: "9" }] }] }] }] };
      }
      throw Object.assign(new Error("no"), { code: "not-found" });
    },
  };
  const d = await readReportData(api, { tenantId: "t", tenantName: "T" }, "2026-10", 15);
  assert.equal(d.months.length, 15);
  assert.equal(d.months[0], "2025-08");
  assert.equal(asked[0].periods, 11);
  assert.equal(asked[0].fromDate, "2026-07-01"); // every column is as long as the dates asked for: one month
  assert.equal(asked[0].toDate, "2026-07-31");
  assert.equal(asked[0].timeframe, "MONTH");
  assert.equal(asked[1].periods, 2);
  const sales = d.pl.find((r) => r.name === "Sales")!;
  assert.deepEqual(sales.amounts, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3]);
  assert.ok(!d.pl.some((r) => /gross profit/i.test(r.name)), "Xero's own subtotals are not accounts");
  assert.equal(d.bs.length, 0);
  assert.ok(d.notes.length > 0);
});

test("the demo Xero gives a year of months and a balance sheet that balances every month, so the whole of Reporting can be tried", async () => {
  const { FakeXero } = await import("../src/lib/fakeXero");
  const { SCOPE_GROUPS } = await import("../src/lib/xero");
  const scopes = SCOPE_GROUPS.flatMap((g) => g.scopes);
  const api = new FakeXero({ read: () => "demo:" + Buffer.from(JSON.stringify(scopes)).toString("base64"), write: async () => undefined } as any);
  const t = (await api.connections()).tenants[0];
  const d = await readReportData(api as any, t, "2026-04", 24);
  assert.deepEqual(d.notes, []);
  assert.equal(d.months.filter((m, i) => d.pl.some((r) => r.amounts[i])).length, 24);
  assert.ok(d.bs.length > 5);
  const cols = periodCols("month", "2026-04", 4, "none");
  const bs = bsStatement(d, cols, "summary");
  const val = (label: string) => bs.find((r) => r.label === label)?.vals[0] as number;
  assert.ok(Math.abs(val("Net Assets") - val("Equity")) < 0.05, `net assets ${val("Net Assets")} vs equity ${val("Equity")}`);
  for (const m of d.months.slice(2)) {
    const b = bsStatement(d, periodCols("month", m, 4, "none"), "summary");
    const v = (l: string) => b.find((r) => r.label === l)?.vals[0] as number;
    assert.ok(Math.abs(v("Net Assets") - v("Equity")) < 0.05, `${m}: ${v("Net Assets")} vs ${v("Equity")}`);
  }
});

test("a part year or part quarter says so, and a part quarter is set beside the same part of the quarter before", () => {
  const ytd = periodCols("year", "2026-01", 4, "lastYear").map((c) => c.label);
  assert.deepEqual(ytd, ["FY 25/26 YTD", "FY 24/25 YTD"]);
  assert.equal(periodCols("year", "2026-04", 4, "lastYear")[1].label, "FY 24/25");
  // the year ends in April, so the quarters are May–Jul, Aug–Oct, Nov–Jan and Feb–Apr
  const q = periodCols("quarter", "2026-03", 4, "prior");
  assert.deepEqual(q.map((c) => c.months), [["2026-02", "2026-03"], ["2025-11", "2025-12"]]);
  assert.equal(periodCols("quarter", "2026-02", 4, "prior")[0].label, "Feb 26 (quarter to date)");
  assert.deepEqual(periodCols("quarter", "2026-04", 4, "prior")[1].months, ["2025-11", "2025-12", "2026-01"]);
});

test("a balance sheet that doesn't balance is flagged, and one that does is not", async () => {
  const { balanceProblem } = await import("../src/lib/reportData");
  const row = (group: string, v: number) => ({ code: "", name: group, group, amounts: [v] });
  assert.equal(balanceProblem(["2026-04"], [row("bank", 1000), row("curLiab", 300), row("equity", 700)]), undefined);
  assert.match(balanceProblem(["2026-04"], [row("bank", 1000), row("curLiab", 300), row("equity", 500)])!, /doesn't balance.*£200/);
});

test("if an older year of the balance sheet is refused, the newer months are kept", async () => {
  let calls = 0;
  const api: any = {
    async get(_id: string, _api: string, path: string, q: any = {}) {
      if (path === "Accounts") return { Accounts: [] };
      if (path === "Reports/ProfitAndLoss") { const n = Number(q.periods) + 1; return { Reports: [{ Rows: [{ RowType: "Header", Cells: [{ Value: "" }, ...Array.from({ length: n }, (_, i) => ({ Value: `${addMonths(String(q.toDate).slice(0, 7), -i)}-28` }))] }] }] }; }
      if (path === "Reports/BalanceSheet") {
        if (++calls > 1) throw Object.assign(new Error("no"), { code: "not-found" });
        const n = Number(q.periods) + 1;
        const head = { RowType: "Header", Cells: [{ Value: "" }, ...Array.from({ length: n }, (_, i) => ({ Value: `${i}` }))] };
        return { Reports: [{ Rows: [head, { RowType: "Section", Title: "Bank", Rows: [{ RowType: "Row", Cells: [{ Value: "Current" }, ...Array.from({ length: n }, () => ({ Value: "100" }))] }] }, { RowType: "Section", Title: "Equity", Rows: [{ RowType: "Row", Cells: [{ Value: "Capital" }, ...Array.from({ length: n }, () => ({ Value: "100" }))] }] }] }] };
      }
      throw Object.assign(new Error("no"), { code: "not-found" });
    },
  };
  const d = await readReportData(api, { tenantId: "t", tenantName: "T" }, "2026-10", 24);
  assert.equal(d.bsMonths.length, 12);
  assert.equal(d.bsMonths[11], "2026-10");
  assert.ok(d.bs[0].amounts.length === 12 && d.bs[0].amounts.every((v) => v === 100));
  assert.ok(d.notes.some((n) => /only read back to/.test(n)));
});

test("a December year end is labelled as the calendar year, others as the two years they span", () => {
  assert.equal(periodCols("year", "2026-10", 12, "lastYear").map((c) => c.label).join(" | "), "FY 2026 YTD | FY 2025 YTD");
  assert.equal(periodCols("year", "2026-12", 12, "none")[0].label, "FY 2026");
  assert.equal(periodCols("year", "2026-10", 3, "none")[0].label, "FY 26/27 YTD");
});
