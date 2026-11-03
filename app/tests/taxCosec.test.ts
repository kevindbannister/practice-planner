import test from "node:test";
import assert from "node:assert/strict";
import { cosecDividendsFor, taxYearWindow } from "../src/lib/taxCosec";

const line = (holderKey: string, paid: string, extra: Record<string, unknown> = {}) => ({ holderId: `k:${holderKey}`, holder: "Pat", holderKey, cls: "Ordinary", shares: 100, entitlementPence: paid, waived: false, paidPence: paid, waiverRef: "", ...extra });
const row = (o: Record<string, unknown>) => ({ Key: "x", ClientKey: "co1", Ref: "DIV-2024-01", Type: "interim", RecordDate: "2024-01-01", DeclaredOn: "2024-01-02", PaidOn: "2024-01-10", Rates: "null", Lines: "[]", TotalPence: "0", Waivers: "[]", Status: "paid", ...o });

test("tax year window runs 6 April to 5 April, named by the ending year", () => {
  assert.deepEqual(taxYearWindow(2024), { from: "2023-04-06", to: "2024-04-05" });
});

test("a shareholder's dividends are picked up by the tax year they were paid in, one line each", () => {
  const rows = [
    row({ Lines: JSON.stringify([line("pat", "1250000"), line("sam", "500000")]), TotalPence: "1750000" }),
    row({ Ref: "DIV-2024-02", Status: "declared", PaidOn: "", DeclaredOn: "2024-03-01", Lines: JSON.stringify([line("pat", "100000")]) }),
    row({ Ref: "DIV-2024-03", PaidOn: "2024-08-01", DeclaredOn: "2024-07-20", RecordDate: "2024-07-15", Lines: JSON.stringify([line("pat", "900000")]) }),
    row({ Ref: "DIV-2024-04", Status: "draft", Lines: JSON.stringify([line("pat", "700000")]) }),
    row({ Ref: "DIV-2024-05", Lines: JSON.stringify([line("pat", "300000", { waived: true })]) }),
  ];
  const got = cosecDividendsFor("pat", 2024, rows, () => "Acme Ltd");
  assert.deepEqual(got.map((x) => [x.ref, x.amount, x.company]), [["DIV-2024-01", 12500, "Acme Ltd"], ["DIV-2024-02", 1000, "Acme Ltd"]]);
  assert.deepEqual(cosecDividendsFor("pat", 2025, rows, () => "Acme Ltd").map((x) => x.ref), ["DIV-2024-03"]);
  assert.equal(cosecDividendsFor("", 2024, rows, () => "Acme Ltd").length, 0);
});
