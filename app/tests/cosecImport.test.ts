import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, readDate, readNumber, normType, guessMapping, itemsFromRows, itemsFromPdfLines, check, commit, compareOfficers, missingMapping } from "../src/lib/cosecImport";
import { readEntry } from "../src/lib/shareLedger";

const ex = { entries: [], officers: [], pscs: [], classes: [] as string[] };
const meta = { batch: "B1", doc: "registers.csv", method: "csv", by: "kevin", now: "2026-10-28T00:00:00Z" };
const accept = <T extends { status: string }>(xs: T[]) => xs.map((x) => ({ ...x, status: "accepted" }));

test("csv handles quotes, semicolons and BOM", () => {
  assert.deepEqual(parseCsv('﻿a,b\n"x, y",2\n'), [["a", "b"], ["x, y", "2"]]);
  assert.deepEqual(parseCsv("a;b\n1;2"), [["a", "b"], ["1", "2"]]);
});
test("dates are read day first, and unreadable ones are left empty", () => {
  assert.equal(readDate("03/04/2020").date, "2020-04-03"); assert.equal(readDate("03/04/2020").ambiguous, true);
  assert.equal(readDate("13/04/2020").ambiguous, false);
  assert.equal(readDate("1st January 2020").date, "2020-01-01");
  assert.equal(readDate("2020-02-30").date, "");
  assert.equal(readDate("sometime").date, "");
  assert.equal(readDate("43831").date, "2020-01-01");
  assert.equal(readNumber("1,000"), 1000); assert.equal(readNumber("abc"), undefined);
  assert.equal(normType("Share transfer"), "transfer"); assert.equal(normType("Allotment of shares"), "allotment"); assert.equal(normType("??"), "");
});
const csv = parseCsv("Date,Transaction,Class,Shares,From,To\n01/01/2018,Allotment,Ordinary,100,,Alice Smith\n01/06/2020,Transfer,Ordinary,40,Alice Smith,Bob Jones\n");
test("mapping and rows become reviewable items", () => {
  const m = guessMapping(csv[0], "ledger");
  assert.deepEqual(missingMapping("ledger", m), []);
  const items = itemsFromRows(csv.slice(1), m, "ledger", "registers.csv");
  assert.equal(items.length, 2); assert.equal(items[1].fields.from, "Alice Smith"); assert.equal(items[0].fields.date, "2018-01-01");
  assert.equal(items[0].source.row, 2); assert.equal(items.every((i) => i.status === "pending"), true);
});
test("nothing is committed until accepted; accepted rows are committed with their source", () => {
  const items = itemsFromRows(csv.slice(1), guessMapping(csv[0], "ledger"), "ledger", "registers.csv");
  assert.match(commit(items, ex, "C1", meta).error || "", /Nothing has been accepted/);
  const c = commit(accept(items) as typeof items, ex, "C1", meta);
  assert.equal(c.error, undefined); assert.equal(c.counts.ledger, 2);
  const rows = c.creates.filter((x) => x.list === "CoSecLedger").map((x) => x.row);
  assert.equal(rows[0].Source, "import:B1"); assert.equal(rows[0].ClientKey, "C1");
  assert.equal(c.creates.some((x) => x.list === "CoSecImports"), true);
  assert.match(String(c.creates.at(-1)!.row.Summary), /No Companies House filings/);
});
test("a transfer of shares nobody holds blocks the whole batch", () => {
  const bad = itemsFromRows(parseCsv("Date,Transaction,Class,Shares,From,To\n01/06/2020,Transfer,Ordinary,40,Alice Smith,Bob Jones").slice(1), guessMapping(["Date", "Transaction", "Class", "Shares", "From", "To"], "ledger"), "ledger", "x.csv");
  const r = commit(accept(bad) as typeof bad, ex, "C1", meta);
  assert.match(r.error || "", /would not balance/);
});
test("a row with an unreadable type or date has errors and can't be committed", () => {
  const items = itemsFromRows([["x", "Mystery", "Ordinary", "10", "", "Alice"]], { date: 0, type: 1, cls: 2, number: 3, from: 4, to: 5 }, "ledger", "x.csv");
  const v = check(items, ex).items[items[0].id];
  assert.ok(v.errors.length >= 2);
  assert.match(commit(accept(items) as typeof items, ex, "C1", meta).error || "", /problems to fix/);
});
test("a row already in the ledger is flagged as a duplicate", () => {
  const items = itemsFromRows(csv.slice(1, 2), guessMapping(csv[0], "ledger"), "ledger", "r.csv");
  const e = readEntry({ Key: "e1", ClientKey: "C1", Type: "allotment", EffectiveDate: "2018-01-01", Class: "Ordinary", Number: 100, ToHolder: "Alice Smith", Status: "active", Created: "x" });
  assert.match(check(items, { ...ex, entries: [e] }).items[items[0].id].warnings.join(" "), /already has an entry/);
});
test("officers: dates, duplicates, merging and overlap", () => {
  const rows = parseCsv("Name,Role,Appointed,Resigned\nJane Doe,Director,01/02/2015,\nJane Doe,Director,01/02/2016,\nTom Old,Director,01/01/2010,31/12/2012");
  const items = itemsFromRows(rows.slice(1), guessMapping(rows[0], "officer"), "officer", "o.csv");
  const verdict = check(items, ex);
  assert.match(verdict.items[items[0].id].warnings.join(" "), /overlapping/);
  const existing = { ...ex, officers: [{ Key: "O1", First: "Jane", Last: "Doe", Role: "director", Status: "current", DOB: "" }] };
  const merged = items.slice(0, 1).map((i) => ({ ...i, status: "accepted" as const, mergeWith: "O1", fields: { ...i.fields, dob: "1980-05-05" } }));
  const r = commit(merged, existing, "C1", meta);
  assert.equal(r.counts.merged, 1); assert.equal(r.creates.filter((x) => x.list === "CoSecOfficers").length, 0);
  assert.equal(r.patches[0].patch.DOB, "1980-05-05"); assert.equal(r.patches[0].patch.First, undefined);
  const old = commit([{ ...items[2], status: "accepted" }], ex, "C1", meta);
  assert.equal(old.creates[0].row.Status, "resigned");
});
test("PDF text: proposes only lines with a date and a recognisable event, marked low confidence with the page", () => {
  const items = itemsFromPdfLines([["REGISTER OF MEMBERS", "Some heading text here", "12/03/2019 Transfer of 500 Ordinary shares"], ["Jane Doe Director appointed 01/02/2015", "Resigned director Tom Old 31/12/2012"]], "reg.pdf");
  assert.equal(items.length, 3);
  assert.equal(items[0].kind, "ledger"); assert.equal(items[0].confidence, "low"); assert.equal(items[0].source.page, 1);
  assert.equal(items[0].fields.number, "500"); assert.equal(items[0].fields.from, "");
  assert.match(items[0].ambiguity.join(" "), /enter who is involved/);
  assert.equal(items[1].fields.name, "Jane Doe"); assert.equal(items[1].fields.appointedOn, "2015-02-01");
  assert.equal(items[2].fields.appointedOn, ""); assert.equal(items[2].fields.resignedOn, "2012-12-31");
  // an unaccepted PDF row can't reach the ledger, and a row missing its holders can't be accepted
  assert.ok(check(items, ex).items[items[0].id].errors.length > 0);
});
test("compare officers against Companies House", () => {
  const r = compareOfficers([{ First: "Jane", Last: "Doe", Status: "current" }, { First: "Gone", Last: "Person", Status: "current" }], [{ name: "DOE, Jane" }, { name: "NEW, Person" }]);
  assert.deepEqual(r.onlyHere, ["Gone Person"]); assert.deepEqual(r.onlyAtCh, ["NEW, Person"]); assert.equal(r.matched, 1);
});
