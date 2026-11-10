import test from "node:test";
import assert from "node:assert/strict";
import * as D from "../src/lib/cosecDormant.ts";
import { approvableCopy, buildDormantModel, canonical, modelHash } from "../src/lib/accounts/model.ts";
import { errorsOf, validateModel } from "../src/lib/accounts/validate.ts";
import { readEntry } from "../src/lib/shareLedger.ts";

const e = (k: string, o: any = {}) => readEntry({ Key: k, ClientKey: "C1", Status: "active", Created: k, Class: "Ordinary", Type: "allotment", EffectiveDate: "2024-03-10", Number: 100, Nominal: 1, PaidPerShare: 1, ...o });
const classes: any[] = [{ ClientKey: "C1", Name: "Ordinary", NominalValue: 1 }];
const fig = (asAt: string, o: any = {}) => D.figuresAt([e("1", o)], "C1", asAt, classes);
const period = { start: "2025-04-01", end: "2026-03-31", incorporated: "2024-03-10" };
const mk = (o: any = {}) => buildDormantModel({ company: { name: "Test Ltd", number: "01234567" }, period, fig: fig("2026-03-31"), prior: fig("2025-03-31"), director: "Ann Able", approvedOn: "", confirmedBy: "Kev", confirmedAll: true, ...o });
const ids = (m: any) => errorsOf(validateModel(m)).map((x) => x.id);

test("a clean paid-up dormant company validates, in whole pence", () => {
  const m = mk(); assert.deepEqual(ids(m), []);
  assert.equal(m.current.cash, 10000); assert.equal(m.current.netAssets, 10000); assert.equal(m.current.calledUpNotPaid, 0);
});
test("unpaid shares are an asset, so the sheet still balances", () => {
  const m = mk({ fig: fig("2026-03-31", { PaidPerShare: 0 }), prior: fig("2025-03-31", { PaidPerShare: 0 }) });
  assert.equal(m.current.calledUpNotPaid, 10000); assert.equal(m.current.cash, 0); assert.deepEqual(ids(m), []);
});
test("the balance sheet is never forced to balance", () => {
  const m = mk(); m.current.cash += 1; // an asset the funds don't explain
  assert.ok(ids(m).includes("current-netassets"));
  const n = mk(); n.current.cash += 1; n.current.netAssets += 1; // net assets follow, but funds don't: it doesn't balance
  assert.ok(ids(n).includes("current-balance"));
});
test("comparatives: missing, present in a first period, wrong date, capital changed", () => {
  assert.ok(ids(mk({ prior: null })).includes("cmp-missing"));
  const first = mk({ period: { start: "2024-03-10", end: "2025-03-31", incorporated: "2024-03-10" }, fig: fig("2025-03-31"), prior: fig("2024-12-31") });
  assert.ok(ids(first).includes("cmp-first"));
  const m = mk(); m.comparative!.asAt = "2025-04-01"; assert.ok(ids(m).includes("cmp-date"));
  const grown = mk({ prior: D.figuresAt([e("1", { Number: 50 })], "C1", "2025-03-31", classes) });
  assert.ok(ids(grown).includes("cmp-capital"));
});
test("shares, nominal and paid agree with the totals", () => {
  const m = mk(); m.classes[0].shares = 99; assert.ok(ids(m).includes("product-Ordinary")); 
  const n = mk(); n.classes[0].unpaidPence = 20000; assert.ok(ids(n).includes("unpaid-Ordinary"));
  const t = mk(); t.current.shareCapital = 20000; t.current.shareholdersFunds = 20000; assert.ok(ids(t).includes("cap-total"));
});
test("statements need a person's confirmation; employees must be 0; dates", () => {
  assert.ok(ids(mk({ confirmedAll: false })).includes("statements"));
  assert.ok(ids(mk({ employees: 2 })).includes("employees"));
  assert.ok(ids(mk({ director: "" })).includes("director"));
  assert.ok(ids(mk({ approvedOn: "2026-03-31" })).includes("signdate-early"));
  assert.ok(ids(mk({ approvedOn: "2026-13-45" })).includes("signdate"));
  const bad = mk(); bad.current.asAt = "2026-03-30"; assert.ok(ids(bad).includes("bsdate"));
});
test("hash: stable, ignores who signed and when, changes when a figure changes", async () => {
  const a = await modelHash(approvableCopy(mk())), b = await modelHash(approvableCopy(mk({ approvedOn: "2026-06-01", director: "Bob" })));
  assert.equal(a, b); assert.equal(canonical({ b: 1, a: [2, { d: 1, c: 2 }] }), '{"a":[2,{"c":2,"d":1}],"b":1}');
  const changed = mk(); changed.current.cash = 9999; changed.current.netAssets = 9999;
  assert.notEqual(a, await modelHash(approvableCopy(changed)));
});
test("approval is stale when the accounts hash changes, and can be withdrawn with a reason", async () => {
  const h = await modelHash(approvableCopy(mk()));
  const row: any = { Key: "D1", ClientKey: "C1", Status: "approved", ApprovedHash: h, ApprovedBy: "Ann", ApprovedOn: "2026-06-01", PreparedOn: "2026-05-01", Confirmations: "{}" };
  assert.equal(D.approvalStale(row, h), false); assert.equal(D.approvalStale(row, "other"), true);
  assert.ok(D.withdrawApproval(row, "", "now").error);
  const w = D.withdrawApproval(row, "Figures changed", "now"); assert.equal(w.patches[0].patch.Status, "prepared"); assert.equal(w.patches[0].patch.ApprovedBy, "");
});
test("the PDF is made from the model: a changed model changes the document, with no other source of figures", async () => {
  const a = await D.accountsPdfFromModel(mk()), m = mk(); m.company.name = "Other Ltd";
  const b = await D.accountsPdfFromModel(m); assert.ok(a.length > 500); assert.notDeepEqual(a, b);
});
test("assess blocks an LLP number and carries the accounts checks", () => {
  const client: any = { Key: "C1", Title: "X LLP", CompanyNumber: "OC123456" };
  const a = D.assess({ client, verified: { status: "active", accTo: "2026-03-31" }, period, entries: [e("1")], classes, dividends: [], officers: [], conf: { neverTraded: true, noTransactions: true, qualifies: true, by: "K", at: "2026-04-01T00:00:00Z", director: "A" }, today: "2026-11-01", others: [] } as any);
  assert.ok(a.blockers.some((b) => b.id === "llp"));
});
