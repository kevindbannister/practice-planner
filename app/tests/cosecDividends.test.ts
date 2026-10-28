import test from "node:test";
import assert from "node:assert/strict";
import { parseRate, parsePounds, pounds, calculate, draft, review, declare, markPaid, verify, readDividend, dividendDocs } from "../src/lib/cosecDividends.ts";
import { readEntry } from "../src/lib/shareLedger.ts";
import { readRights } from "../src/lib/cosecShares.ts";

const e = (k: string, o: any) => readEntry({ Key: k, ClientKey: "C1", Status: "active", Created: k, Class: "Ordinary", Type: "allotment", EffectiveDate: "2020-01-01", ...o });
const ledger = [e("1", { Number: 3, ToHolder: "Ann" }), e("2", { Number: 3, ToHolder: "Bob" }), e("3", { Number: 4, ToHolder: "Cy" }), e("4", { Class: "Pref", Number: 50, ToHolder: "Ann" })];
const rights = new Map([["ordinary", readRights({ Name: "Ordinary" })], ["pref", readRights({ Name: "Pref", Dividends: "no" })]]);

test("rates and amounts parse exactly, bad input is refused", () => {
  assert.equal(parseRate("0.0125"), 12500n); assert.equal(parseRate("£1"), 1000000n);
  assert.equal(parseRate("0.1234567"), null); assert.equal(parseRate("-1"), null); assert.equal(parseRate("abc"), null);
  assert.equal(parsePounds("1,250.50"), 125050n); assert.equal(parsePounds("10.505"), null);
  assert.equal(pounds(125050n), "£1,250.50"); assert.equal(pounds(5n), "£0.05");
});
test("per-share: shares x rate to the penny, halves round up, non-dividend classes excluded", () => {
  const c = calculate(ledger, "C1", "2025-01-01", { mode: "per-share", rates: { Ordinary: "0.125" } }, rights);
  assert.deepEqual(c.lines.map((l) => [l.holder, l.paidPence]), [["Ann", "38"], ["Bob", "38"], ["Cy", "50"]]); // 0.375 -> 38p, 0.5 -> 50p
  assert.equal(c.totalPence, "126"); assert.equal(c.excluded[0].cls, "Pref"); assert.deepEqual(c.problems, []);
  assert.match(calculate(ledger, "C1", "2025-01-01", { mode: "per-share", rates: {} }, rights).problems[0], /rate for Ordinary/);
});
test("aggregate: lines always add up exactly, leftover pence by largest remainder", () => {
  const c = calculate(ledger, "C1", "2025-01-01", { mode: "aggregate", total: "1.00" }, rights);
  // 100p over 10 shares: Ann 30, Bob 30, Cy 40 exactly
  assert.deepEqual(c.lines.map((l) => l.paidPence), ["30", "30", "40"]);
  const odd = calculate([e("1", { Number: 1, ToHolder: "A" }), e("2", { Number: 1, ToHolder: "B" }), e("3", { Number: 1, ToHolder: "C" })], "C1", "2025-01-01", { mode: "aggregate", total: "1.00" }, rights);
  assert.deepEqual(odd.lines.map((l) => l.paidPence), ["34", "33", "33"], "the extra penny goes to the first by name on a tie");
  assert.equal(odd.totalPence, "100");
  const big = calculate([e("1", { Number: 7, ToHolder: "A" }), e("2", { Number: 13, ToHolder: "B" }), e("3", { Number: 29, ToHolder: "C" })], "C1", "2025-01-01", { mode: "aggregate", total: "12345.67" }, rights);
  assert.equal(big.lines.reduce((s, l) => s + BigInt(l.paidPence), 0n), 1234567n);
});
test("holdings come from the record date, not today", () => {
  const moved = [...ledger, e("5", { Type: "transfer", EffectiveDate: "2025-06-01", Number: 3, FromHolder: "Ann", ToHolder: "Dee" })];
  const before = calculate(moved, "C1", "2025-01-01", { mode: "per-share", rates: { Ordinary: "1" } }, rights);
  const after = calculate(moved, "C1", "2025-07-01", { mode: "per-share", rates: { Ordinary: "1" } }, rights);
  assert.ok(before.lines.some((l) => l.holder === "Ann" && l.paidPence === "300"));
  assert.ok(after.lines.some((l) => l.holder === "Dee") && !after.lines.some((l) => l.holder === "Ann" && l.cls === "Ordinary"));
});
test("waivers need a document reference; waived money isn't paid and others aren't topped up", () => {
  const id = calculate(ledger, "C1", "2025-01-01", { mode: "per-share", rates: { Ordinary: "1" } }, rights).lines[0].holderId;
  const no = calculate(ledger, "C1", "2025-01-01", { mode: "per-share", rates: { Ordinary: "1" } }, rights, [{ holderId: id, holder: "Ann", cls: "Ordinary", docRef: " " }]);
  assert.match(no.problems[0], /needs a reference/);
  const w = calculate(ledger, "C1", "2025-01-01", { mode: "per-share", rates: { Ordinary: "1" } }, rights, [{ holderId: id, holder: "Ann", cls: "Ordinary", docRef: "Waiver 3 Jan" }]);
  assert.deepEqual([w.totalPence, w.waivedPence, w.lines[0].paidPence, w.lines[0].entitlementPence], ["700", "300", "0", "300"]);
  assert.match(calculate(ledger, "C1", "2025-01-01", { mode: "per-share", rates: { Ordinary: "1" } }, rights, [{ holderId: "n:nobody", holder: "Nobody", cls: "", docRef: "x" }]).problems[0], /does nothing/);
});
test("can't declare without the profits review; ledger drift blocks it; lifecycle is enforced", () => {
  const d = draft({ type: "interim", recordDate: "2025-01-01", basis: { mode: "per-share", rates: { Ordinary: "1" } }, waivers: [] }, [], "C1", ledger, rights, "me", "n");
  assert.equal(d.error, undefined); const row = d.row!; assert.equal(row.Ref, "DIV-2025-01");
  assert.match(declare(row, "2025-01-02", ledger, rights, "n").error!, /Review distributable profits/);
  assert.match(review(row, false, "x", "me", "n").error!, /Tick the box/);
  assert.match(review(row, true, " ", "me", "n").error!, /Note what was reviewed/);
  Object.assign(row, review(row, true, "Management accounts to 31 Dec show retained profits of £50k", "Kev", "2025-01-01T10:00").patch!);
  const drifted = [...ledger, e("9", { Type: "transfer", EffectiveDate: "2024-12-01", Number: 1, FromHolder: "Ann", ToHolder: "Bob" })];
  assert.match(declare(row, "2025-01-02", drifted, rights, "n").error!, /ledger has changed/);
  assert.equal(verify(row, ledger, rights).ok, true);
  Object.assign(row, declare(row, "2025-01-02", ledger, rights, "n").patch!);
  assert.match(declare(row, "2025-01-03", ledger, rights, "n").error!, /already declared/);
  assert.match(markPaid(row, "2025-01-01", "n").error!, /before it was declared/);
  Object.assign(row, markPaid(row, "2025-01-10", "n").patch!);
  assert.equal(draft({ type: "final", recordDate: "2025-03-01", basis: { mode: "per-share", rates: { Ordinary: "1" } }, waivers: [] }, [row], "C1", ledger, rights, "me", "n").row!.Ref, "DIV-2025-02");
});
test("draft refuses a dividend of nothing and a ledger with problems", () => {
  assert.match(draft({ type: "interim", recordDate: "2025-01-01", basis: { mode: "per-share", rates: { Ordinary: "0" } }, waivers: [] }, [], "C1", ledger, rights, "me", "n").error!, /nothing/);
  const bad = [...ledger, e("8", { Type: "transfer", Number: 99, FromHolder: "Ann", ToHolder: "Bob" })];
  assert.match(draft({ type: "interim", recordDate: "2025-01-01", basis: { mode: "per-share", rates: { Ordinary: "1" } }, waivers: [] }, [], "C1", bad, rights, "me", "n").error!, /ledger has a problem/);
});
test("documents are produced", async () => {
  const row = draft({ type: "final", recordDate: "2025-01-01", basis: { mode: "aggregate", total: "100" }, waivers: [] }, [], "C1", ledger, rights, "me", "n").row!;
  const docs = await dividendDocs({ name: "Test Ltd", number: "1" }, readDividend(row), ["Ann"]);
  for (const f of Object.values(docs)) assert.equal(Buffer.from(f.slice(0, 4)).toString(), "%PDF");
});
