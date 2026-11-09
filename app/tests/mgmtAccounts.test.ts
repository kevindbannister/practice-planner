import assert from "node:assert/strict";
import { test } from "node:test";
import { FakeXero } from "../src/lib/fakeXero";
import { SCOPE_GROUPS } from "../src/lib/xero";
import { ReportData, bsStatement, periodCols, plStatement, readReportData, yearEndCol } from "../src/lib/reportData";
import { TEMPLATES, fromTemplate, nextCopy } from "../src/lib/reportBuilder";
import { movements, splitSeries, buckets } from "../src/lib/reportComponents";

const END = 4; // the demo company's year ends in April
let demo: ReportData;
const data = async () => {
  if (demo) return demo;
  const api = new FakeXero({ read: () => "demo:" + Buffer.from(JSON.stringify(SCOPE_GROUPS.flatMap((g) => g.scopes))).toString("base64"), write: async () => undefined } as never);
  const t = (await api.connections()).tenants[0];
  demo = await readReportData(api as never, t, "2026-04", 24);
  return demo;
};
const row = (rows: ReturnType<typeof plStatement>, label: string) => rows.find((r) => r.label === label)!;
const close = (a: number | undefined, b: number | undefined, msg = "") => assert.ok(a !== undefined && b !== undefined && Math.abs(a - b) < 0.02, `${msg} ${a} vs ${b}`);

test("the Monthly Management Accounts template: eight landscape monthly pages, with nothing in it that names a client, a date or an amount", () => {
  const t = TEMPLATES.find((x) => x.name === "Monthly Management Accounts")!;
  assert.ok(t);
  assert.equal(t.kind, "month"); assert.equal(t.orientation, "landscape");
  const doc = fromTemplate(t, "", "2026-01", "2026-02-01T00:00:00Z");
  assert.deepEqual(doc.sections.map((s) => s.title), ["Executive dashboard", "Profit and loss for the month", "Profit and loss for the year to date", "Profit and loss by month", "Monthly trends", "Balance sheet", "Cash and working capital", "Significant movements and commentary"]);
  assert.equal(doc.name, "Monthly Management Accounts"); assert.equal(doc.look, "management"); assert.equal(doc.anchor, "2026-01");
  const json = JSON.stringify(t.sections()).replace(/"id":"[^"]*"/g, "");
  assert.doesNotMatch(json, /20\d\d|£|Kent|Ltd|Limited/);
  assert.equal(doc.sections[0].blocks.filter((b) => b.type === "key").length, 6);
  // each use gets its own ids
  assert.notEqual(JSON.stringify(fromTemplate(t, "", "", "x").sections[0].blocks[0].id), JSON.stringify(doc.sections[0].blocks[0].id));
});

test("month, year to date and every month reconcile, and margins are worked from the totals", async () => {
  const d = await data();
  const anchor = "2026-01"; // nine months into the year to April 2026
  const month = plStatement(d, periodCols("month", anchor, END, "lastYear"), "summary", "management");
  const ytd = plStatement(d, periodCols("year", anchor, END, "lastYear"), "summary", "management");
  const cols = periodCols("year", anchor, END, "months");
  const byMonth = plStatement(d, cols, "summary", "management");
  // twelve financial months in order, then the total to date
  assert.deepEqual(cols.slice(0, 12).map((c) => c.key), ["2025-05", "2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04"]);
  assert.equal(cols[12].label, "Total to date");
  assert.deepEqual(cols.slice(9, 12).map((c) => c.months), [[], [], []]); // months after the reporting month are blank
  for (const label of ["Revenue", "Cost of sales", "Gross profit", "Overheads", "Operating profit", "Net profit"]) {
    const m = row(byMonth, label);
    close(m.vals[8], row(month, label).vals[0], `${label}: the January column is the month`);
    close(m.vals[12], row(ytd, label).vals[0], `${label}: the total is the year to date`);
    close(m.vals.slice(0, 9).reduce((a: number, v) => a + (v || 0), 0), m.vals[12], `${label}: the months add up to the total`);
    assert.equal(m.vals[10], undefined);
  }
  // net profit is the same as the standard layout's
  close(row(ytd, "Net profit").vals[0], row(plStatement(d, periodCols("year", anchor, END, "none"), "summary"), "Net Profit").vals[0], "net profit");
  // margins: gross profit over revenue in each column, not added up
  const gm = row(byMonth, "Gross margin %");
  close(gm.vals[12], (row(byMonth, "Gross profit").vals[12]! / row(byMonth, "Revenue").vals[12]!) * 100, "total margin");
  assert.ok(Math.abs(gm.vals[12]! - gm.vals.slice(0, 9).reduce((a: number, v) => a + (v || 0), 0)) > 1);
  // the year to date is set beside the same nine months a year earlier
  const ly = periodCols("year", anchor, END, "lastYear");
  assert.equal(ly[1].months.length, 9); assert.equal(ly[1].months[0], "2024-05"); assert.equal(ly[1].label, "FY 24/25 YTD");
});

test("the management balance sheet is balances at the month end, adds down to net assets, and agrees to capital and reserves", async () => {
  const d = await data();
  for (const anchor of ["2025-10", "2026-01", "2026-04"]) {
    const cols = [...periodCols("month", anchor, END, "prior"), yearEndCol(anchor, END)];
    const bs = bsStatement(d, cols, "summary", "management");
    const v = (l: string) => row(bs, l).vals;
    for (let j = 0; j < cols.length; j++) {
      if (v("Net assets")[j] === undefined) continue;
      close(v("Net assets")[j], v("Capital and reserves")[j], `${anchor} col ${j}: net assets and capital`);
      const parts = ["Fixed assets", "Stock", "Trade debtors", "Cash", "Other current assets", "Current liabilities", "Long-term liabilities"].map((l) => bs.find((r) => r.label === l)?.vals[j] || 0);
      close(parts.reduce((a, x) => a + x, 0), v("Net assets")[j], `${anchor}: the lines add down`);
    }
    // point in time: the same as the standard balance sheet's net assets at that month end
    const std = bsStatement(d, cols, "summary");
    close(v("Net assets")[0], row(std, "Net Assets").vals[0], "net assets agree to the standard layout");
    assert.equal(cols[2].months[0], anchor >= "2025-05" ? "2025-04" : "2024-04");
  }
});

test("significant movements keep only changes past the threshold, biggest first", () => {
  const d = { months: ["2026-09", "2026-10"], bsMonths: [], bs: [], pl: [
    { code: "1", name: "Rent", group: "expense", amounts: [50000, 51200] }, // £1,200 but only 2.4%
    { code: "2", name: "Wages", group: "expense", amounts: [20000, 24000] },
    { code: "3", name: "Repairs", group: "expense", amounts: [200, 1500] },
    { code: "4", name: "Travel", group: "expense", amounts: [9000, 9900] }, // £900: under £1,000
    { code: "5", name: "Consultancy", group: "expense", amounts: [0, 3000] },
  ] } as never;
  const m = movements(d, "expense", ["2026-10"], ["2026-09"], 10, 1000, 10);
  assert.deepEqual(m.map((x) => [x.name, x.change, x.pct]), [["Wages", 4000, 20], ["Consultancy", 3000, undefined], ["Repairs", 1300, 650]]);
  assert.equal(movements(d, "expense", ["2026-10"], ["2026-09"], 1, 1000, 10).length, 1);
});

test("overheads split by account add up to the overheads in the management profit and loss each month", async () => {
  const d = await data();
  const bk = buckets("month", "2026-04", END, 12, d.months);
  const s = splitSeries(d, "expense", bk, 5);
  assert.ok(s.labels.length <= 6);
  bk.forEach((b, i) => {
    const over = plStatement(d, [{ key: "m", label: "", months: b.months }], "summary", "management").find((r) => r.label === "Overheads")!.vals[0];
    close(s.series.reduce((a, x) => a + (x[i] || 0), 0), over, `month ${b.label}`);
  });
  assert.ok(!s.labels.some((l) => /interest/i.test(l)));
});

test("next month's copy of the template clears the comments against movements", () => {
  const t = TEMPLATES[0];
  const doc = fromTemplate(t, "", "2026-01", "x");
  const mv = doc.sections[7].blocks.find((b) => b.type === "movements")!;
  if (mv.type === "movements") mv.notes = { Wages: "New starter" };
  const n = nextCopy(doc, "y", "2026-03");
  assert.equal(n.anchor, "2026-02");
  const m2 = n.sections[7].blocks.find((b) => b.type === "movements")!;
  assert.equal(m2.type === "movements" && m2.notes, undefined);
});
