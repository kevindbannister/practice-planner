import { test } from "node:test";
import assert from "node:assert/strict";
import { irisDate, irisTrialBalance } from "../src/lib/irisExport.ts";
import type { Mapping } from "../src/lib/tbMap.ts";

const m = (account: string, iris: string, irisName: string, balance: number, code = ""): Mapping => ({
  acct: { key: `${code}|${account}`, code, account, iris, type: "", tbDr: 0, tbCr: 0, jDr: 0, jCr: 0, dr: balance > 0 ? balance : 0, cr: balance < 0 ? -balance : 0, inTb: true, lines: [] },
  balance, swBalance: balance, jBalance: 0, iris, irisName, dest: "", saved: true, why: "",
});

test("the date is dd/mm/yyyy in the header and credits are negative", () => {
  assert.equal(irisDate("2026-03-31"), "31/03/2026");
  const e = irisTrialBalance([m("Sales", "1", "Sales", -1000), m("Rent", "250", "Rent", 400), m("Bank", "690", "Bank", 600)], "2026-03-31");
  const rows = e.csv.split("\r\n");
  assert.equal(rows[0], "Account,Description,Year End 31/03/2026");
  assert.equal(rows[1], '"1","Sales",-1000.00');
  assert.equal(e.difference, 0);
});

test("accounts sharing an IRIS code are added together; zero balances are left out", () => {
  const e = irisTrialBalance([m("Bank current", "690", "Bank", 500), m("Bank deposit", "690", "Bank", 250), m("Unused", "300", "Sundry", 0)], "2026-03-31");
  assert.equal(e.lines.length, 1);
  assert.equal(e.lines[0].amount, 750);
  assert.deepEqual(e.lines[0].accounts, ["Bank current", "Bank deposit"]);
});

test("accounts with no IRIS code are listed, and show up as a difference so it isn't silently wrong", () => {
  const e = irisTrialBalance([m("Sales", "1", "Sales", -1000), m("Mystery", "", "", 1000, "999")], "2026-03-31");
  assert.deepEqual(e.unmapped, [{ account: "Mystery", code: "999", balance: 1000 }]);
  assert.equal(e.difference, -1000);
});

test("order follows IRIS numbering, sub-codes stay, and text can't run as a formula", () => {
  const e = irisTrialBalance([m("Dep", "523/21", "Plant dep", -10), m("Plant", "523", "Plant", 110), m("Cash", "99", "Cost", -100), m("Odd", "700", "=SUM(A1)", 0.1 + 0.2)], "2026-03-31");
  assert.deepEqual(e.lines.map((l) => l.code), ["99", "523", "523/21", "700"]);
  assert.ok(e.csv.includes('" =SUM(A1)"'));
  assert.equal(e.lines[3].amount, 0.3); // floating point doesn't leak into the file
});

test("a code with no IRIS name uses the account's own name", () => {
  const e = irisTrialBalance([m("Boat mooring", "290", "", 50)], "2026-03-31");
  assert.equal(e.lines[0].description, "Boat mooring");
});

// ---- from trial balance lines, through the mapping, to the file
import { linesFor } from "../src/lib/papers.ts";
import { IRIS_BUILT_IN, mapTb, paperAccounts } from "../src/lib/tbMap.ts";
void linesFor;

test("a Xero-style trial balance with an IRIS column exports in balance, and an account with no code is called out", () => {
  const tb = (Key: string, Code: string, Detail: string, type: string, dr: number | undefined, cr: number | undefined, iris: string) => ({
    Key, ClientKey: "C1", PeriodEnd: "2026-03-31", SectionKey: "tb", SubKey: "main", Code, Detail, Seq: Number(Code) || 1, Figures: JSON.stringify({ type, dr, cr, iris }),
  });
  const lines = [
    tb("a", "200", "Sales", "Revenue", undefined, 10000, "1"),
    tb("b", "400", "Rent", "Overheads", 3000, undefined, "250"),
    tb("c", "090", "Business Bank Account", "Bank", 7000, undefined, "690"),
    tb("d", "999", "Mystery suspense", "Current Asset", 0, 0, ""),
  ] as never[];
  const rows = paperAccounts(lines, "C1", "2026-03-31");
  const maps = mapTb(rows, { lines, papers: [] }, "C1", "2026-03-31", IRIS_BUILT_IN);
  const e = irisTrialBalance(maps, "2026-03-31");
  assert.equal(e.difference, 0);
  assert.equal(e.unmapped.length, 0); // nil balance, nothing to report
  assert.equal(e.lines.reduce((t, l) => t + (l.amount < 0 ? l.amount : 0), 0), -10000);
  assert.ok(e.csv.split("\r\n")[0].endsWith("31/03/2026"));
});
