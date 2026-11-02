import test from "node:test";
import assert from "node:assert/strict";
import { accountsFigures, Mapping } from "../src/lib/tbMap";
import { ACCOUNT_TYPES, AccountsInput, assemble, balanceSheet, buildSections, checkAccounts, detailGroups, emptySetup, fmt, hasErrors, incomeStatement, noteList, policyList, readAccSetup, withType } from "../src/lib/accounts";

const m = (dest: string, balance: number, account = dest): Mapping => ({ acct: { key: account, code: account, account, iris: "", type: "", tbDr: 0, tbCr: 0, jDr: 0, jCr: 0, dr: 0, cr: 0, inTb: true, lines: [] }, balance, swBalance: balance, jBalance: 0, iris: "", irisName: "", dest, saved: true, why: "" });
// debit +, credit -
const maps: Mapping[] = [
  m("income/sales", -100000, "Sales"), m("expenditure/cos", 30000, "Materials"), m("expenditure/tb", 40000, "Wages"), m("expenditure/accountancy", 2000, "Accountancy"),
  m("taxation/current", 5000, "Corporation tax"),
  m("fixed/plant#cost", 20000), m("debtors/trade", 15000), m("bank/current", 25000), m("creditors/trade", -8000),
  m("capital/shares", -100), m("capital/reserves", -28900),
];
const facts = { name: "Test Ltd", number: "01234567", start: "2024-04-01", end: "2025-03-31", priorEnd: "2024-03-31", firm: "Firm LLP", firmAddress: "1 High St", kind: "Ltd" };
const input = (over: Partial<AccountsInput> = {}): AccountsInput => ({ facts, setup: { ...emptySetup("small"), signer: "A Director", approved: "2025-06-30", registeredOffice: "1 Road\nTown", directors: [{ name: "A Director", role: "Director", appointed: "", resigned: "" }], activity: "Trading", draft: false, employees: { now: "2", before: "2" } }, figures: accountsFigures(maps), maps, ...over });

test("figures cast: income statement and balance sheet agree", () => {
  const f = accountsFigures(maps);
  assert.equal(f.pbt, 28000); assert.equal(f.pat, 23000); assert.equal(f.difference, 0);
  const inc = incomeStatement(f, undefined, "small");
  assert.equal(inc[inc.length - 1].now, 23000);
  const bs = balanceSheet(f, undefined, "small");
  assert.equal(bs.find((r) => r.label === "Net assets")!.now, 52000);
  assert.equal(bs.find((r) => r.label === "Shareholders' funds")!.now, 52000);
  assert.equal(bs.find((r) => r.label === "Net current assets")!.now, 32000);
});
test("micro combines costs; dormant has no income statement; llp wording", () => {
  const f = accountsFigures(maps);
  assert.ok(incomeStatement(f, undefined, "micro").some((r) => r.label === "Cost of sales and other expenses"));
  assert.equal(incomeStatement(f, undefined, "dormant").length, 0);
  assert.ok(balanceSheet(f, undefined, "llp").some((r) => r.label === "Total members' interests"));
});
test("comparatives carry through and zero lines drop out", () => {
  const f = accountsFigures(maps), p = accountsFigures(maps.map((x) => (x.dest === "expenditure/cos" ? { ...x, balance: 0 } : x)));
  const cos = incomeStatement(f, p, "small").find((r) => r.label === "Cost of sales")!;
  assert.equal(cos.now, -30000); assert.equal(Math.abs(cos.prior as number), 0);
  const none = incomeStatement(p, p, "small");
  assert.ok(!none.some((r) => r.label === "Cost of sales"));
});
test("fmt", () => { assert.equal(fmt(0), "-"); assert.equal(fmt(-1234.4), "(1,234)"); assert.equal(fmt(1234567), "1,234,567"); });
test("setup is cleaned and the type changes the contents", () => {
  const s = readAccSetup({ type: "bogus", approved: "x", directors: [{ name: "A" }, { name: "" }], policies: { basis: { text: "t" } } });
  assert.equal(s.type, "small"); assert.equal(s.approved, ""); assert.equal(s.directors.length, 1); assert.equal(s.policies.basis.text, "t");
  const d = withType(s, "dormant");
  assert.equal(d.include.income, false); assert.equal(d.directors.length, 1);
});
test("detail groups list each account", () => {
  const g = detailGroups(maps);
  assert.equal(g.income[0].total, 100000); assert.equal(g.costs[0].total, 30000); assert.equal(g.expenses.reduce((n, x) => n + x.total, 0), 42000); assert.equal(g.tax[0].total, 5000);
});
test("every type builds sections, numbered notes and contents with page numbers", () => {
  for (const type of ACCOUNT_TYPES) {
    const inp = input({ setup: { ...input().setup, ...withType(emptySetup(type), type), signer: "A Director", approved: "2025-06-30", registeredOffice: "x", directors: input().setup.directors } });
    const secs = buildSections(inp);
    assert.ok(secs.length >= 3, type);
    const a = assemble(secs, true, facts, [1, 2, 3, 4, 5, 6, 7], 1);
    assert.equal(a.titles[0], "Contents");
    assert.equal(a.content.blocks.filter((b) => b.type === "break").length, secs.length);
  }
  const notes = noteList(input());
  assert.deepEqual(notes.map((n) => n.no), notes.map((_, k) => k + 1));
  assert.ok(notes.some((n) => n.key === "tangible"));
  assert.ok(policyList(input().setup).some((p) => p.key === "basis" && p.on));
});
test("checks catch a missing signer, approval date and an unbalanced sheet", () => {
  const ok = checkAccounts(input());
  assert.ok(!hasErrors(ok));
  const bad = checkAccounts(input({ setup: { ...input().setup, signer: "", approved: "2025-01-01" }, figures: { ...accountsFigures(maps), difference: 50 } }));
  assert.ok(bad.filter((c) => c.level === "error").length >= 3);
  assert.ok(checkAccounts(input({ setup: { ...input().setup, type: "dormant" } })).some((c) => c.level === "error" && /dormant/.test(c.text)));
  assert.ok(hasErrors(checkAccounts(input({ maps: undefined }))));
});
test("figures carry the working paper link they come from", () => {
  const secs = buildSections(input({ link: (s) => `https://x/#/papers/C1/2025-03-31?section=${s}` }));
  const bs = secs.find((x) => x.key === "balance")!.blocks.find((b) => b.type === "table") as { rows: { link?: string }[][] };
  const links = bs.rows.flat().map((c) => c.link).filter(Boolean) as string[];
  assert.ok(links.some((l) => l.endsWith("section=debtors")) && links.some((l) => l.endsWith("section=bank")) && links.some((l) => l.endsWith("section=capital")));
  const none = buildSections(input()).find((x) => x.key === "balance")!.blocks.find((b) => b.type === "table") as { rows: { link?: string }[][] };
  assert.ok(none.rows.flat().every((c) => !c.link));
});
