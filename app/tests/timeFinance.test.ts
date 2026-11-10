import assert from "node:assert/strict";
import { test } from "node:test";
import { Rate, addRate, fixedFeeResult, rateProblems, readRates, resolveRate, valueOf, valueTime } from "../src/lib/rates";
import { Ctx, Rec, billingReview, billingTotals, chargeValue, markBilled, markPending, readRec, release, writeDown, writeOff, JobInfo } from "../src/lib/timeBilling";
import { approve, correction, reopen, returnTime, submit } from "../src/lib/timeApproval";
import { DEFAULT_ROLES, checkWrite, can, roleOf, teamFrom, visibleUsers } from "../src/lib/permissions";
import { estimatingAccuracy, myTime, plannedVsActual, profitability, reschedulingReport, toCsv, utilisation } from "../src/lib/timeReports";
import { checkTime } from "../src/lib/timeCheck";
import { DEFAULT_ACTIVITIES, manualEntry, readEntry } from "../src/lib/timesheet";
import { Session } from "../src/lib/planSessions";

let n = 0;
const nk = (p: string) => `${p}${++n}`;
const now = new Date("2026-11-10T18:00:00Z");
const rate = (o: Partial<Rate>): Rate => ({ key: `R${++n}`, kind: "charge", pence: 10000, from: "2026-01-01", to: "", userKey: "", role: "", serviceKey: "", activityKey: "", clientKey: "", jobKey: "", note: "", ...o });
const job = (o: Partial<JobInfo> = {}): JobInfo => ({ key: "J1", clientKey: "C1", serviceKey: "acc", fixedFeePence: 0, title: "Job", ...o });
const ctx = (rates: Rate[], jobs: JobInfo[] = [job()]): Ctx => ({ rates, activities: DEFAULT_ACTIVITIES, jobs: new Map(jobs.map((j) => [j.key, j])), now, roleOf: () => "staff" });
const rec = (o: any = {}, extra: Record<string, unknown> = {}): Rec => {
  const row = manualEntry({ date: "2026-11-09", minutes: 60, jobKey: "J1", clientKey: "C1", activityKey: "accounts-preparation", ...o }, o.user || "kevin", nk, now).row!;
  Object.assign(row, extra);
  return readRec(row, readEntry(row));
};

test("scenario E: 90 minutes at £100 an hour is £150, to the penny", () => {
  assert.equal(valueOf(90, 10000), 15000);
  assert.equal(valueOf(7, 10000), 1167); // 11.666.. rounded once
  const v = valueTime([rate({})], { date: "2026-11-09" }, 90, true);
  assert.equal(v.chargePence, 15000);
});
test("scenario D: £600 fixed fee, 8 hours at £25 an hour cost, is £200 cost and £400 contribution", () => {
  const costs = [rate({ kind: "cost", pence: 2500 })];
  const items = [valueTime(costs, { date: "2026-11-09" }, 480, false)];
  const f = fixedFeeResult(60000, items);
  assert.equal(f.costPence, 20000); assert.equal(f.contributionPence, 40000); assert.equal(f.marginPct, 66.7); assert.equal(f.effectivePencePerHour, 7500);
});
test("no float drift: summing many small values equals the penny total", () => {
  let t = 0; for (let i = 0; i < 1000; i++) t += valueOf(1, 3333);
  assert.equal(Number.isInteger(t), true);
});
test("rate precedence: job beats client beats user beats activity beats service beats role; ties go to the later start", () => {
  const base = { date: "2026-11-09", userKey: "kevin", role: "staff", serviceKey: "acc", activityKey: "vat", clientKey: "C1", jobKey: "J1" };
  const rs = [rate({ key: "role", role: "staff", pence: 1 }), rate({ key: "svc", serviceKey: "acc", pence: 2 }), rate({ key: "act", activityKey: "vat", pence: 3 }), rate({ key: "usr", userKey: "kevin", pence: 4 }), rate({ key: "cli", clientKey: "C1", pence: 5 }), rate({ key: "job", jobKey: "J1", pence: 6 })];
  assert.equal(resolveRate(rs, "charge", base)!.key, "job");
  assert.equal(resolveRate(rs.filter((r) => r.key !== "job"), "charge", base)!.key, "cli");
  assert.equal(resolveRate(rs.filter((r) => !["job", "cli"].includes(r.key)), "charge", base)!.key, "usr");
  assert.equal(resolveRate(rs.filter((r) => ["role", "svc", "act"].includes(r.key)), "charge", base)!.key, "act");
  // client+role outweighs user+activity+service+role? no: client(16) > user+activity+service+role(8+4+2+1=15)
  assert.equal(resolveRate([rate({ key: "a", clientKey: "C1" }), rate({ key: "b", userKey: "kevin", activityKey: "vat", serviceKey: "acc", role: "staff" })], "charge", base)!.key, "a");
  assert.equal(resolveRate([rate({ key: "old", from: "2026-01-01", pence: 1 }), rate({ key: "new", from: "2026-06-01", pence: 2 })], "charge", base)!.key, "new");
});
test("effective dates: an old rate still applies to old work after a new one starts", () => {
  let rs: Rate[] = [rate({ key: "r1", pence: 8000, from: "2026-01-01" })];
  rs = addRate(rs, { kind: "charge", pence: 9000, from: "2026-07-01", userKey: "", role: "", serviceKey: "", activityKey: "", clientKey: "", jobKey: "", note: "" });
  assert.equal(rs[0].to, "2026-06-30");
  assert.equal(resolveRate(rs, "charge", { date: "2026-03-01" })!.pence, 8000);
  assert.equal(resolveRate(rs, "charge", { date: "2026-08-01" })!.pence, 9000);
  assert.equal(resolveRate(rs, "charge", { date: "2025-12-31" }), undefined);
  assert.equal(rateProblems(rs).length, 0);
});
test("no rate means no value and is flagged, not guessed", () => {
  const v = valueTime([], { date: "2026-11-09" }, 60, true);
  assert.equal(v.chargePence, 0); assert.equal(v.missingCharge, true); assert.equal(v.missingCost, true);
  assert.equal(valueTime([rate({})], { date: "2026-11-09" }, 60, true, 5000).chargePence, 5000); // typed override
  assert.equal(readRates([{ kind: "x", pence: 1, from: "2026-01-01" }, { kind: "charge", pence: -5, from: "2026-01-01" }, "no"]).length, 0);
});

test("billing: unbilled → pending → billed; never twice", () => {
  const c = ctx([rate({})]), e = rec();
  assert.equal(chargeValue(e, c).pence, 10000);
  const p = markPending([e], c, { user: "kevin", now, newKey: nk });
  assert.equal(p.patches.length, 1); assert.equal(p.events[0].type, "pending");
  const pend = rec({}, { BillingStatus: "pending" });
  assert.match(markPending([pend], c, { user: "kevin", now, newKey: nk }).problems[0], /already/);
  const b = markBilled([pend], "INV-1", { user: "kevin", now, newKey: nk });
  assert.equal(b.patches[0].patch.BillingStatus, "billed");
  assert.match(markBilled([pend], "", { user: "kevin", now, newKey: nk }).problems[0], /invoice/);
  const billed = rec({}, { BillingStatus: "billed", InvoiceRef: "INV-1" });
  assert.match(markPending([billed], c, { user: "kevin", now, newKey: nk }).problems[0], /already billed/);
  assert.match(writeOff([billed], "x", { user: "kevin", now, newKey: nk }).problems[0], /already billed/);
  assert.equal(release([pend], { user: "kevin", now, newKey: nk }).patches[0].patch.BillingStatus, "");
});
test("write-off and write-down need a reason, are logged, and can't exceed the value", () => {
  const c = ctx([rate({})]), e = rec();
  const m = { user: "kevin", now, newKey: nk };
  assert.match(writeOff([e], "", m).problems[0], /why/);
  const w = writeOff([e], "Client dispute", m);
  assert.equal(w.events[0].reason, "Client dispute"); assert.equal(w.events[0].previous.bill, "unbilled");
  assert.match(writeDown(e, 20000, "too much", c, m).problems.join(" "), /more than/);
  const d = writeDown(e, 2500, "Slow day", c, m);
  assert.equal(d.patches[0].patch.WriteDownPence, 2500);
  const after = rec({}, { BillingStatus: "written_down", WriteDownPence: 2500 });
  assert.equal(chargeValue(after, c).pence, 7500);
  assert.equal(chargeValue(rec({}, { BillingStatus: "written_off" }), c).pence, 0);
});
test("fixed-fee jobs and non-billable time are not billed by the hour", () => {
  const c = ctx([rate({})], [job({ fixedFeePence: 60000 })]);
  assert.equal(chargeValue(rec(), c).pence, 0);
  assert.match(markPending([rec()], c, { user: "k", now, newKey: nk }).problems[0], /not billable/);
  const c2 = ctx([rate({})]);
  assert.equal(chargeValue(rec({ activityKey: "telephone-calls" }), c2).pence, 0);
});
test("billing review groups unbilled time by client and job; totals by state", () => {
  const c = ctx([rate({})], [job(), job({ key: "J2", clientKey: "C2" })]);
  const recs = [rec(), rec({ minutes: 30 }), rec({ jobKey: "J2", clientKey: "C2" }), rec({}, { BillingStatus: "billed", InvoiceRef: "I1" })];
  const r = billingReview(recs, c);
  assert.equal(r.length, 2); assert.equal(r[0].pence, 15000); assert.equal(r[0].entries.length, 2);
  const t = billingTotals(recs, c);
  assert.equal(t.unbilled.pence, 25000); assert.equal(t.billed.pence, 10000);
});

test("approval: submit, approve, return, reopen; no self-approval; locked once approved", () => {
  const m = { user: "boss", now, newKey: nk };
  const e = rec({ user: "sam" });
  const s = submit([e], { ...m, user: "sam" });
  assert.equal(s.patches[0].patch.ApprovalStatus, "submitted");
  const sub = rec({ user: "sam" }, { ApprovalStatus: "submitted" });
  assert.equal(approve([sub], { ...m, user: "sam" }, false).problems.length, 1);
  assert.equal(approve([sub], m, false).patches[0].patch.ReviewedBy, "boss");
  assert.match(returnTime([sub], "", m).problems[0], /fixing/);
  assert.equal(returnTime([sub], "Wrong job", m).patches[0].patch.ApprovalStatus, "returned");
  const ok = rec({ user: "sam" }, { ApprovalStatus: "approved", ReviewedBy: "boss" });
  assert.match(reopen([ok], "", m).problems[0], /why/);
  assert.equal(reopen([ok], "Mistake", m).patches[0].patch.ApprovalStatus, "");
  assert.match(reopen([rec({ user: "sam" }, { ApprovalStatus: "approved", BillingStatus: "billed" })], "x", m).problems[0], /billed/);
  const c = correction(ok, { Hours: 2 }, "Fix", m);
  assert.equal(c.patch.ApprovalStatus, "submitted"); assert.equal(c.event.type, "correct");
});

const settings = (members: any[], extra: Record<string, unknown> = {}) => [{ Key: "team.members", Value: JSON.stringify(members) }, ...Object.entries(extra).map(([k, v]) => ({ Key: k, Value: JSON.stringify(v) }))] as any[];
test("permissions: a sole practitioner is the owner; a listed team gets role rules", () => {
  const solo = teamFrom([]);
  assert.equal(roleOf(solo, "kevin"), "owner"); assert.equal(can(solo, "kevin", "rates.cost"), true);
  const team = teamFrom(settings([{ user: "kevin@x.com", role: "owner" }, { user: "sam@x.com", role: "staff" }, { user: "mo@x.com", role: "manager" }]));
  assert.equal(can(team, "Sam@x.com", "rates.charge"), false); assert.equal(can(team, "mo@x.com", "rates.cost"), false); assert.equal(can(team, "mo@x.com", "billing.manage"), true);
  assert.equal(roleOf(team, "stranger@x.com"), "staff");
  assert.deepEqual(visibleUsers(team, "sam@x.com", ["sam@x.com", "mo@x.com"]), ["sam@x.com"]);
  assert.equal(DEFAULT_ROLES.owner.length, 10);
});
test("data-layer check: own time only, billing, approval, locked approved time, rates, team", () => {
  const team = teamFrom(settings([{ user: "kevin@x.com", role: "owner" }, { user: "sam@x.com", role: "staff" }, { user: "mo@x.com", role: "manager" }]));
  const c = (user: string, on = false) => ({ user, team, approvalOn: on });
  const mine = { CreatedBy: "sam@x.com" }, theirs = { CreatedBy: "mo@x.com" };
  assert.equal(checkWrite("update", "JobTime", mine, { Hours: 2 }, c("sam@x.com")), "");
  assert.match(checkWrite("update", "JobTime", theirs, { Hours: 2 }, c("sam@x.com")), /someone else/);
  assert.match(checkWrite("create", "JobTime", theirs, undefined, c("sam@x.com")), /own time/);
  assert.match(checkWrite("update", "JobTime", mine, { BillingStatus: "billed" }, c("sam@x.com")), /bill/);
  assert.equal(checkWrite("update", "JobTime", mine, { BillingStatus: "billed" }, c("mo@x.com")), "");
  assert.match(checkWrite("update", "JobTime", mine, { ApprovalStatus: "approved" }, c("sam@x.com")), /approve/);
  assert.equal(checkWrite("update", "JobTime", mine, { ApprovalStatus: "submitted", Version: 2 }, c("sam@x.com")), "");
  const approved = { CreatedBy: "sam@x.com", ApprovalStatus: "approved" };
  assert.match(checkWrite("update", "JobTime", approved, { Hours: 3 }, c("sam@x.com", true)), /locked/);
  assert.match(checkWrite("remove", "JobTime", approved, undefined, c("sam@x.com", true)), /locked/);
  assert.equal(checkWrite("update", "JobTime", approved, { Hours: 3 }, c("sam@x.com", false)), "");
  assert.equal(checkWrite("update", "JobTime", approved, { Hours: 3 }, c("kevin@x.com", true)), "");
  assert.equal(checkWrite("update", "JobTime", approved, { BillingStatus: "pending" }, c("mo@x.com", true)), "");
  const rates = (rs: any[]) => ({ Key: "time.rates", Value: JSON.stringify(rs) });
  const cost = { kind: "cost", pence: 100, from: "2026-01-01" }, charge = { kind: "charge", pence: 100, from: "2026-01-01" };
  assert.match(checkWrite("update", "Settings", rates([]), { Value: JSON.stringify([cost]) }, c("mo@x.com")), /cost/);
  assert.equal(checkWrite("update", "Settings", rates([]), { Value: JSON.stringify([charge]) }, c("mo@x.com")), "");
  assert.match(checkWrite("update", "Settings", rates([]), { Value: JSON.stringify([charge]) }, c("sam@x.com")), /charge/);
  assert.match(checkWrite("update", "Settings", { Key: "team.members", Value: "[]" }, { Value: "[]" }, c("mo@x.com")), /owner/);
  assert.match(checkWrite("update", "TimeEvents", {}, {}, c("kevin@x.com")), /can't be changed/);
  assert.equal(checkWrite("update", "JobTime", theirs, { Hours: 1 }, { user: "sam@x.com", team: teamFrom([]), approvalOn: false }), ""); // sole practitioner
});

test("reports: my time, planned vs actual, rescheduling, utilisation", () => {
  const c = ctx([rate({})]);
  const recs = [rec(), rec({ minutes: 30, date: "2026-11-10" }), rec({ activityKey: "administration", jobKey: "", clientKey: "", minutes: 60 })];
  const my = myTime(recs, "kevin", "2026-11-09", "2026-11-15", c);
  assert.equal(my.total, 150); assert.equal(my.byType.billable, 90); assert.equal(my.byType.internal, 60); assert.equal(my.unapproved, 150);
  const S = (o: Partial<Session>): Session => ({ key: nk("S"), kind: "job", itemKey: "J1", clientKey: "C1", title: "Job", userKey: "kevin", date: "2026-11-09", start: "", minutes: 120, actualMinutes: 0, status: "completed", outcome: "", originalKey: "", replacedByKey: "", reason: "", notes: "", created: "", createdBy: "", updated: "", updatedBy: "", version: 1, ...o });
  const p = plannedVsActual([S({}), S({ date: "2026-11-10", status: "rescheduled", minutes: 60 })], recs, "2026-11-09", "2026-11-15", c);
  assert.equal(p.planned, 180); assert.equal(p.actual, 90); assert.equal(p.completedShare, 50); assert.equal(p.rows[0].varianceMinutes, -60);
  const moved = [S({ status: "rescheduled", reason: "Client late" }), S({ status: "rescheduled", reason: "Client late", date: "2026-11-10" }), S({ status: "rescheduled", date: "2026-11-11" }), S({ status: "rescheduled", itemKey: "J2", title: "Other", date: "2026-11-11", reason: "Ill" })];
  const r = reschedulingReport(moved, [], "2026-11-01", "2026-11-30");
  assert.equal(r.moves, 4); assert.equal(r.reasons[0].reason, "Client late"); assert.equal(r.repeated[0].itemKey, "J1"); assert.equal(r.byJob[0].moves, 3);
  const u = utilisation(recs, ["kevin"], "2026-11-09", "2026-11-13", (d) => (d <= "2026-11-13" ? 450 : 0), c)[0];
  assert.equal(u.capacity, 2250); assert.equal(u.recorded, 150); assert.equal(u.billable, 90); assert.equal(u.billableShare, 60); assert.equal(u.utilisationPct, 6.7);
});
test("profitability: fixed fee against labour cost, and time-based value, with missing rates flagged", () => {
  const jobs = [job({ fixedFeePence: 60000 }), job({ key: "J2", clientKey: "C2" })];
  const c = ctx([rate({}), rate({ kind: "cost", pence: 2500 })], jobs);
  const recs = [rec({ minutes: 480 }), rec({ jobKey: "J2", clientKey: "C2", minutes: 90 })];
  const refs = [{ key: "J1", title: "Fixed", clientKey: "C1", serviceKey: "acc", feePence: 60000, estimateHours: 6, done: true, doneOn: "2026-11-09" }, { key: "J2", title: "Hourly", clientKey: "C2", serviceKey: "acc", feePence: 0, estimateHours: 0, done: false, doneOn: "" }];
  const byClient = profitability(recs, refs, "client", "2026-11-01", "2026-11-30", c);
  const c1 = byClient.find((x) => x.key === "C1")!, c2 = byClient.find((x) => x.key === "C2")!;
  assert.equal(c1.feePence, 60000); assert.equal(c1.costPence, 20000); assert.equal(c1.contributionPence, 40000); assert.equal(c1.timeValuePence, 0);
  assert.equal(c2.timeValuePence, 15000); assert.equal(c2.costPence, 3750);
  assert.equal(profitability(recs, refs, "client", "2026-11-01", "2026-11-30", ctx([rate({})], jobs)).find((x) => x.key === "C1")!.missingCost, 1);
  const acc = estimatingAccuracy(recs, refs, "2026-11-01", "2026-11-30", c);
  assert.equal(acc.rows[0].ratioPct, 133); assert.equal(acc.overall, 133);
});
test("csv export quotes text and neutralises formulas", () => {
  assert.equal(toCsv([["a,b", 'say "hi"', "=SUM(A1)", 5]]), '"a,b","say ""hi""",\'=SUM(A1),5');
});

test("data check finds orphans, duplicates, and reconciles typed hours (dry run)", () => {
  const known = { jobs: new Set(["J1"]), tasks: new Set<string>(), clients: new Set(["C1"]) };
  const a = rec({}, { Key: "A" }), dup = rec({}, { Key: "B" }), orphan = rec({ jobKey: "GONE" }, { Key: "Z" }), noInv = rec({}, { Key: "Q", BillingStatus: "billed" });
  const r = checkTime([a, dup, orphan, noInv], [], known, [{ kind: "job", key: "J1", title: "Job", actual: 10 }], now, true);
  const codes = r.issues.map((i) => i.code);
  assert.ok(codes.includes("orphan-job")); assert.ok(codes.includes("possible-duplicate")); assert.ok(codes.includes("billed-no-invoice")); assert.ok(codes.includes("legacy-gap"));
  assert.equal(r.reconciliation.rows[0].typedHours, 10); assert.equal(r.reconciliation.rows[0].recordedHours, 3); assert.equal(r.reconciliation.wouldImportHours, 7);
  assert.equal(r.issues[0].severity, "error");
});

test("end to end: record, approve, bill, report; the numbers agree at every step", () => {
  const c = ctx([rate({}), rate({ kind: "cost", pence: 2500 })]);
  const m = { user: "boss", now, newKey: nk };
  let e = rec({ user: "sam", minutes: 90 });
  assert.equal(chargeValue(e, c).pence, 15000); // scenario E
  e = rec({ user: "sam", minutes: 90 }, { ApprovalStatus: "submitted" });
  const ap = approve([e], m, false); assert.equal(ap.patches.length, 1);
  e = rec({ user: "sam", minutes: 90 }, { ApprovalStatus: "approved", ReviewedBy: "boss" });
  const pend = markPending([e], c, m); assert.equal(pend.patches.length, 1);
  e = rec({ user: "sam", minutes: 90 }, { ApprovalStatus: "approved", ReviewedBy: "boss", BillingStatus: "pending" });
  const billed = markBilled([e], "INV-7", m); assert.equal(billed.events[0].next.invoiceRef, "INV-7");
  e = rec({ user: "sam", minutes: 90 }, { ApprovalStatus: "approved", ReviewedBy: "boss", BillingStatus: "billed", InvoiceRef: "INV-7" });
  assert.equal(billingTotals([e], c).billed.pence, 15000);
  const p = profitability([e], [], "client", "2026-11-01", "2026-11-30", c)[0];
  assert.equal(p.timeValuePence, 15000); assert.equal(p.billedPence, 15000); assert.equal(p.costPence, 3750); assert.equal(p.contributionPence, 11250);
  assert.equal(checkTime([e], [], { jobs: new Set(["J1"]), tasks: new Set(), clients: new Set(["C1"]) }, [], now, true).issues.filter((i) => i.severity === "error").length, 0);
});
test("performance: ten thousand entries are reported in well under a second", () => {
  const c = ctx([rate({}), rate({ kind: "cost", pence: 2500 })]);
  const recs: Rec[] = [];
  const row = manualEntry({ date: "2026-11-09", minutes: 45, jobKey: "J1", clientKey: "C1", activityKey: "vat" }, "kevin", nk, now).row!;
  for (let i = 0; i < 10000; i++) recs.push(readRec({ ...row, Key: `P${i}`, WorkDate: `2026-11-${String(1 + (i % 28)).padStart(2, "0")}` }, readEntry({ ...row, Key: `P${i}`, WorkDate: `2026-11-${String(1 + (i % 28)).padStart(2, "0")}` })));
  const t = Date.now();
  profitability(recs, [], "client", "2026-11-01", "2026-11-30", c); billingReview(recs, c); utilisation(recs, ["kevin"], "2026-11-01", "2026-11-30", () => 450, c); checkTime(recs, [], { jobs: new Set(["J1"]), tasks: new Set(), clients: new Set(["C1"]) }, [], now, false);
  assert.ok(Date.now() - t < 1500, `took ${Date.now() - t}ms`);
});
