// The at-a-glance numbers: date ranges, the profit and loss from Xero's report, balances, the monthly
// trend, and the transactions behind each account. Runs against the demo stand-in.
import assert from "node:assert/strict";
import { test } from "node:test";
import { FakeXero } from "../src/lib/fakeXero";
import { DEFAULT_OPTIONS, scopesFor, parseAccounts, parseProfitAndLoss, rebuildLedger } from "../src/lib/xero";
import { addDays, rangesFor, readGlance, readTransactions, shiftYear } from "../src/lib/xeroGlance";

const connected = () => {
  let sealed: string | undefined = "demo:" + btoa(JSON.stringify(scopesFor({ groups: [...DEFAULT_OPTIONS.groups, "ledger"], classic: false })));
  return new FakeXero({ read: () => sealed, write: (s) => void (sealed = s) });
};
const ID = "d300d300-0000-4000-8000-000000000083";

test("date ranges: calendar ones always, financial years from the year end", () => {
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(shiftYear("2026-04-30", -1), "2025-04-30");
  const r = rangesFor("2026-10-31", "04-30");
  const get = (k: string) => r.find((x) => x.key === k)!;
  assert.deepEqual([get("month").from, get("month").to], ["2026-10-01", "2026-10-31"]);
  assert.deepEqual([get("last-month").from, get("last-month").to], ["2026-09-01", "2026-09-30"]);
  assert.deepEqual([get("quarter").from], ["2026-10-01"]);
  assert.deepEqual([get("ytd").from, get("ytd").to], ["2026-05-01", "2026-10-31"]);
  assert.deepEqual([get("last-fy").from, get("last-fy").to], ["2025-05-01", "2026-04-30"]);
  assert.deepEqual([get("prior-fy").from, get("prior-fy").to], ["2024-05-01", "2025-04-30"]);
  assert.ok(!rangesFor("2026-10-31").some((x) => x.key === "ytd"), "no financial years without a year end");
});

test("the profit and loss parses into sections, and the totals follow", async () => {
  const api = connected();
  const g = await readGlance(api, ID, "2025-05-01", "2026-04-30");
  assert.ok(g.sales > 0, "sales");
  assert.equal(g.grossProfit, Math.round((g.sales - g.costOfSales) * 100) / 100);
  assert.equal(g.netProfit, Math.round((g.grossProfit + g.otherIncome - g.overheads) * 100) / 100);
  assert.ok(g.pl.rows.some((r) => r.section === "income" && r.code === "200"), "sales account present");
  assert.ok(g.cash > 0, "bank balances at the end date");
  assert.ok(g.debtors > 0 && g.debtorDays && g.debtorDays > 0, "debtor days");
  assert.equal(g.trend.length, 12, "twelve months of trend");
  const trendSales = Math.round(g.trend.reduce((a, t) => a + t.sales, 0) * 100) / 100;
  assert.ok(Math.abs(trendSales - g.sales) < 0.05, `trend adds up to the year: ${trendSales} vs ${g.sales}`);
});

test("a shorter range reads fewer sales than the year it sits in", async () => {
  const api = connected();
  const year = await readGlance(api, ID, "2025-05-01", "2026-04-30");
  const quarter = await readGlance(api, ID, "2026-02-01", "2026-04-30");
  assert.ok(quarter.sales > 0 && quarter.sales < year.sales);
  assert.equal(quarter.trend.length, 3);
});

test("transactions behind an income account add up to what the report shows for it", async () => {
  const api = connected();
  const g = await readGlance(api, ID, "2025-05-01", "2026-04-30");
  const txns = await readTransactions(api, ID, g.accounts, "2025-05-01", "2026-04-30");
  const sales = g.pl.rows.find((r) => r.section === "income" && r.code === "200")!;
  const key = g.accounts.find((a) => a.code === "200")!.key;
  const total = Math.round(-txns.lines.filter((l) => l.a === key).reduce((a, l) => a + l.amt, 0) * 100) / 100;
  assert.ok(Math.abs(total - sales.amounts[0]) < 0.05, `transactions ${total} vs report ${sales.amounts[0]}`);
});

test("the report's accounts line up with the accounts list (the drill-down key)", async () => {
  const api = connected();
  const accounts = parseAccounts(await api.get(ID, "accounting", "Accounts"));
  const pl = parseProfitAndLoss(await api.get(ID, "accounting", "Reports/ProfitAndLoss", { fromDate: "2025-05-01", toDate: "2026-04-30", standardLayout: true }), accounts);
  assert.ok(pl.rows.length > 5);
  assert.ok(pl.rows.every((r) => r.code), "every row has an account code");
  const lines = rebuildLedger({ invoices: [], creditNotes: [], payments: [], bankTransactions: [], bankTransfers: [], manualJournals: [] }, accounts, "2025-05-01", "2026-04-30");
  assert.deepEqual(lines, []);
});
