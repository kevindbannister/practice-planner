import test from "node:test";
import assert from "node:assert/strict";
import { years, dividendYears, shareholders, officers } from "../src/lib/cosecOverview.ts";
import { readEntry } from "../src/lib/shareLedger.ts";

test("years line up with the accounts period end, whichever side of it today is", () => {
  assert.deepEqual([years("2026-03-31", "2025-10-01").current.end, years("2026-03-31", "2025-10-01").prior.end], ["2026-03-31", "2025-03-31"]);
  const late = years("2026-03-31", "2026-10-28"); assert.deepEqual([late.current.start, late.current.end, late.prior.end], ["2026-04-01", "2027-03-31", "2026-03-31"], "when the expected period has passed, today's year still comes first");
  const early = years("2028-03-31", "2026-10-28"); assert.equal(early.current.end, "2027-03-31");
  assert.deepEqual([years(undefined, "2026-10-28").current.start, years(undefined, "2026-10-28").prior.end], ["2026-01-01", "2025-12-31"]);
});
test("dividends by year: declared and paid only, by declaration date, drafts noted", () => {
  const rows: any[] = [
    { Key: "1", ClientKey: "C1", Status: "paid", DeclaredOn: "2026-05-01", TotalPence: "10000", Ref: "A", RecordDate: "2026-04-30" },
    { Key: "2", ClientKey: "C1", Status: "declared", DeclaredOn: "2025-12-01", TotalPence: "5050", Ref: "B", RecordDate: "2025-11-30" },
    { Key: "3", ClientKey: "C1", Status: "cancelled", DeclaredOn: "2026-06-01", TotalPence: "999", Ref: "C", RecordDate: "2026-06-01" },
    { Key: "4", ClientKey: "C1", Status: "draft", DeclaredOn: "", TotalPence: "1", Ref: "D", RecordDate: "2026-09-01" },
    { Key: "5", ClientKey: "C2", Status: "paid", DeclaredOn: "2026-05-01", TotalPence: "7", Ref: "E", RecordDate: "2026-05-01" },
  ];
  const d = dividendYears(rows, "C1", "2027-03-31", "2026-10-28");
  assert.deepEqual([d.current.rows.map((r) => r.ref), d.current.totalPence, d.current.drafts], [["A"], "10000", 1]);
  assert.deepEqual([d.prior.rows.map((r) => r.ref), d.prior.totalPence], [["B"], "5050"]);
});
test("shareholders: from the ledger with percentages, else the register", () => {
  const e = (k: string, o: any) => readEntry({ Key: k, ClientKey: "C1", Status: "active", Created: k, Class: "Ordinary", Type: "allotment", EffectiveDate: "2020-01-01", ...o });
  const a = shareholders([e("1", { Number: 75, ToHolder: "Ann" }), e("2", { Number: 25, ToHolder: "Bob" })], [], [], "C1", "2026-10-28");
  assert.deepEqual([a.source, a.issued, a.holders.map((h) => [h.name, h.shares, h.percent])], ["ledger", 100, [["Ann", 75, 75], ["Bob", 25, 25]]]);
  const r = shareholders([], [], [{ ClientKey: "C1", Status: "current", Holder: "Cy", Number: 1, Class: "Ordinary" }, { ClientKey: "C1", Status: "current", Holder: "Di", Number: 2, Class: "Ordinary" }, { ClientKey: "C1", Status: "former", Holder: "Ed", Number: 9, Class: "Ordinary" }], "C1", "2026-10-28");
  assert.deepEqual([r.source, r.holders.map((h) => [h.name, h.percent])], ["register", [["Di", 66.67], ["Cy", 33.33]]]);
  assert.equal(shareholders([], [], [], "C1", "2026-10-28").source, "none");
});
test("officers: current directors listed separately from others", () => {
  const o = officers([{ ClientKey: "C1", Status: "current", Role: "director", First: "Zed", Last: "Z" }, { ClientKey: "C1", Status: "current", Role: "director", First: "Amy", Last: "A" }, { ClientKey: "C1", Status: "current", Role: "secretary", First: "Sam", Last: "S" }, { ClientKey: "C1", Status: "resigned", Role: "director", First: "Old", Last: "O" }], "C1");
  assert.deepEqual([o.directors.map((p) => p.name), o.others.map((p) => p.name)], [["Amy A", "Zed Z"], ["Sam S"]]);
});
