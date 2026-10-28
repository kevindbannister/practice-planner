import test from "node:test";
import assert from "node:assert/strict";
import * as D from "../src/lib/cosecDormant.ts";
import { readEntry } from "../src/lib/shareLedger.ts";

const e = (k: string, o: any) => readEntry({ Key: k, ClientKey: "C1", Status: "active", Created: k, Class: "Ordinary", Type: "allotment", EffectiveDate: "2024-03-10", Number: 100, Nominal: 1, PaidPerShare: 0, ToHolder: "Ann Able", ...o });
const client: any = { Key: "C1", Title: "Test Ltd", CompanyNumber: "01234567" };
const conf = { neverTraded: true, noTransactions: true, qualifies: true, by: "Kev", at: "2025-04-01T10:00:00Z", director: "Ann Able" };
const base = (o: any = {}) => ({ client, verified: { status: "active", accTo: "2025-03-31", accDue: "2025-12-31" }, period: { start: "2024-03-10", end: "2025-03-31", incorporated: "2024-03-10" }, entries: [e("1", {})], classes: [{ Name: "Ordinary", NominalValue: 1, ClientKey: "C1" }], dividends: [], officers: [{ ClientKey: "C1", Status: "current", Role: "Director", First: "Ann", Last: "Able" }], conf, today: "2025-06-01", others: [], ...o });

test("month arithmetic keeps month-ends and clamps", () => {
  assert.equal(D.addMonths("2025-01-31", 1), "2025-02-28"); assert.equal(D.addMonths("2025-02-28", 9), "2025-11-30"); assert.equal(D.addMonths("2025-04-04", 9), "2026-01-04"); assert.equal(D.addMonths("2024-01-01", 21), "2025-10-01");
});
test("deadlines: standard, month-end and first accounts over 12 months (Companies House's own example)", () => {
  assert.equal(D.deadline({ start: "2024-04-01", end: "2025-03-31", incorporated: "2020-01-01" }), "2025-12-31");
  assert.equal(D.deadline({ start: "2024-04-05", end: "2025-04-04", incorporated: "2020-01-01" }), "2026-01-04");
  assert.equal(D.deadline({ start: "2025-01-01", end: "2026-01-31", incorporated: "2025-01-01" }), "2026-10-01");
  assert.equal(D.deadline({ start: "2025-01-01", end: "2025-12-31", incorporated: "2025-01-01" }), "2026-09-30", "first accounts of 12 months or less use nine months");
});
test("penalty tiers and doubling", () => {
  assert.equal(D.penalty("2025-12-31", "2025-12-31").pounds, 0);
  assert.deepEqual([D.penalty("2025-12-31", "2026-01-15").pounds, D.penalty("2025-12-31", "2026-02-15").pounds, D.penalty("2025-12-31", "2026-05-01").pounds, D.penalty("2025-12-31", "2026-08-01").pounds], [150, 375, 750, 1500]);
  assert.equal(D.penalty("2025-12-31", "2026-02-15", true).pounds, 750);
});
test("figures: unpaid shares, paid shares, unknown paid flagged", () => {
  const f = D.figuresAt([e("1", {})], "C1", "2025-03-31", base().classes as any);
  assert.deepEqual([f.calledUp, f.unpaid, f.paid, f.unknownPaid], ["10000", "10000", "0", true]);
  const p = D.figuresAt([e("1", { PaidPerShare: 1 })], "C1", "2025-03-31", base().classes as any);
  assert.deepEqual([p.unpaid, p.paid, p.unknownPaid], ["0", "10000", false]);
  const half = D.figuresAt([e("1", { PaidPerShare: 0.4 })], "C1", "2025-03-31", base().classes as any);
  assert.deepEqual([half.unpaid, half.paid], ["6000", "4000"]);
  assert.equal(D.figuresAt([e("1", {})], "C1", "2024-01-01", base().classes as any).classes.length, 0, "nothing before allotment");
});
test("clean company has no blockers; first period has no comparatives", () => {
  const a = D.assess(base());
  assert.deepEqual(a.blockers.map((b) => b.id), []); assert.equal(a.prior, null); assert.equal(a.due, "2025-12-10", "13-month first period: 21 months after incorporation");
  assert.ok(a.checks.find((c) => c.id === "route")!.detail.includes("doesn't file"));
});
test("things that stop it being dormant are blockers", () => {
  const ids = (i: any) => D.assess(base(i)).blockers.map((b) => b.id);
  assert.ok(ids({ entries: [e("1", {}), e("2", { EffectiveDate: "2024-09-01", Number: 50 })] }).includes("shares"));
  assert.ok(!ids({ entries: [e("1", {}), e("2", { Type: "transfer", EffectiveDate: "2024-09-01", Number: 10, FromHolder: "Ann Able", ToHolder: "Bob" })] }).includes("shares"));
  assert.ok(ids({ dividends: [{ ClientKey: "C1", Status: "paid", DeclaredOn: "2024-12-01", RecordDate: "2024-12-01" }] }).includes("dividends"));
  assert.ok(ids({ entries: [e("1", { Premium: 1 })] }).includes("premium"));
  assert.ok(ids({ entries: [] }).includes("capital"));
  assert.ok(ids({ officers: [] }).includes("directors"));
  assert.ok(ids({ conf: { ...conf, neverTraded: false } }).includes("confirm"));
  assert.ok(ids({ verified: { status: "dissolved", accTo: "2025-03-31" } }).includes("active"));
  assert.ok(ids({ verified: { status: "active", accTo: "2026-03-31" } }).includes("accepted"));
  assert.ok(ids({ period: { start: "2024-03-10", end: "2026-12-31", incorporated: "2024-03-10" }, today: "2027-01-01" }).includes("period"));
  assert.ok(ids({ today: "2025-01-01" }).includes("today"));
  assert.ok(ids({ others: [D.readDormant({ ClientKey: "C1", PeriodStart: "2024-03-10", PeriodEnd: "2025-03-31", Status: "prepared" })] }).includes("dup"));
});
test("workflow: can't skip steps; approval needs signed copy; complete only on evidence", () => {
  const now = "2025-06-01T09:00:00Z"; const per = base().period;
  const s = D.start(client, per, [], "me", now); assert.equal(s.error, undefined); const row: any = s.creates[0];
  assert.equal(D.start(client, per, [row], "me", now).error, "There is already a dormant accounts job for that period.");
  const apply = (w: D.Written) => { assert.equal(w.error, undefined, w.error); w.patches.forEach((p) => Object.assign(p.row, p.patch)); };
  const a = () => D.assess(base({ conf: D.readDormant(row).conf }));
  assert.match(D.prepare(row, a(), now).error!, /Confirm the statements first/);
  assert.match(D.confirm(row, { neverTraded: true, noTransactions: false, qualifies: true, director: "Ann Able" }, "Kev", now).error!, /Tick all three/);
  apply(D.confirm(row, { neverTraded: true, noTransactions: true, qualifies: true, director: "Ann Able" }, "Kev", now));
  assert.match(D.approve(row, a(), "Ann Able", "2025-06-01", "x.pdf", "2025-06-01", now).error!, /Prepare the accounts first/);
  apply(D.prepare(row, a(), now));
  assert.match(D.approve(row, a(), "Ann Able", "2025-06-01", "", "2025-06-01", now).error!, /signed copy/);
  const changed = D.assess(base({ conf: D.readDormant(row).conf, entries: [e("1", { PaidPerShare: 1 })] }));
  assert.match(D.approve(row, changed, "Ann Able", "2025-06-01", "x.pdf", "2025-06-01", now).error!, /ledger has changed/);
  assert.match(D.approve(row, a(), "Ann Able", "2025-07-01", "x.pdf", "2025-06-01", now).error!, /future/);
  apply(D.approve(row, a(), "Ann Able", "2025-06-01", "Signed accounts.pdf", "2025-06-01", now));
  assert.match(D.accepted(row, {}, null, "2025-06-02", now).error!, /hasn't been filed/);
  assert.match(D.filed(row, "2025-05-30", "webfiling", "", "2025-06-02", now).error!, /before the director approved/);
  assert.match(D.filed(row, "2028-04-02", "webfiling", "", "2028-05-01", now).error!, /commercial software/);
  apply(D.filed(row, "2025-06-02", "webfiling", "ref1", "2025-06-02", now));
  assert.equal(row.Status, "filed");
  assert.match(D.cancel(row, "x", now).error!, /can't be cancelled/);
  assert.match(D.accepted(row, { accTo: "2025-03-31" }, null, "2025-06-03", now).error!, /still shows these accounts as outstanding/);
  assert.match(D.accepted(row, {}, { date: "2025-06-03", evidence: " " }, "2025-06-03", now).error!, /evidence/);
  apply(D.rejected(row, "Wrong form", now)); assert.equal(row.Status, "rejected");
  apply(D.filed(row, "2025-06-04", "webfiling", "ref2", "2025-06-05", now));
  apply(D.accepted(row, { accTo: "2026-03-31", at: "2025-06-10T00:00:00Z" }, null, "2025-06-10", now));
  assert.deepEqual([row.Status, row.AcceptedOn], ["complete", "2025-06-10"]);
});
test("producing the PDFs never advances the status", async () => {
  const a = D.assess(base());
  const di = { company: { name: "Test Ltd", number: "1" }, d: D.readDormant({ Status: "prepared" }), fig: a.figures, prior: a.prior, period: base().period, director: "Ann Able", approvedOn: "" };
  for (const f of [await D.accountsPdf(di), await D.coverPdf(di, a)]) assert.equal(Buffer.from(f.slice(0, 4)).toString(), "%PDF");
  assert.equal(di.d.status, "prepared");
});
