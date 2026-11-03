import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_TARGET_RATE, practiceView, readTargetRate } from "../src/lib/practice.ts";

const TODAY = "2026-11-03";
const cl = (k: string, o: any = {}): any => ({ Key: k, Title: `Client ${k}`, Kind: "Ltd", Status: "", Manager: "Sam", Partner: "Kevin", LoEStatus: "Finalised", ...o });
const job = (k: string, c: string, o: any = {}): any => ({ Key: k, ClientKey: c, Title: `Job ${k}`, ServiceKey: "VAT", Status: "In progress", Deadline: "2026-12-07", EstimateHours: 2, ...o });
const fee = (k: string, c: string, o: any = {}): any => ({ Key: k, ClientKey: c, ServiceKey: "BOOK", Fee: 100, FeePeriod: "monthly", AnnualFee: 1200, OneOff: false, ...o });
const time = (c: string, hours: number, o: any = {}): any => ({ Key: `T${Math.random()}`, JobKey: "J", ClientKey: c, Started: "2026-09-01T09:00:00Z", Ended: "2026-09-01T12:00:00Z", Hours: hours, Kind: "manual", ...o });
const input = (o: any = {}): any => ({ clients: [], jobs: [], tasks: [], services: [], clientServices: [], charges: [], costs: [], time: [], billingLinks: [], amlAssessments: [], onboardings: [], leads: [], opps: [], proposals: [], versions: [], capacity: () => 6, today: TODAY, targetRate: 75, ...o });

test("an empty practice reads as nothing, not as an error", () => {
  const v = practiceView(input());
  assert.equal(v.clients.active, 0); assert.equal(v.work.open, 0); assert.equal(v.money.arr, 0); assert.equal(v.profit.rows.length, 0); assert.equal(v.work.deadlines.length, 6); assert.equal(v.capacity.months.length, 6);
});

test("archived clients and their work are left out everywhere", () => {
  const v = practiceView(input({ clients: [cl("A"), cl("Z", { Status: "Archived" })], jobs: [job("1", "A"), job("2", "Z")], clientServices: [fee("f1", "A"), fee("f2", "Z")] }));
  assert.equal(v.clients.active, 1); assert.equal(v.work.open, 1); assert.equal(v.money.arr, 1200);
});

test("work is sorted into overdue, tight, on track and held, with the oldest overdue first", () => {
  const v = practiceView(input({
    clients: [cl("A")],
    jobs: [job("1", "A", { Deadline: "2026-10-01" }), job("2", "A", { Deadline: "2026-10-20" }), job("3", "A", { Deadline: "2026-11-05" }), job("4", "A", { Deadline: "2027-03-01" }), job("5", "A", { Status: "On hold", HoldKind: "Client", Deadline: "2026-09-01" }), job("6", "A", { Status: "Complete", Deadline: "2026-01-01" })],
  }));
  assert.equal(v.work.open, 5); assert.equal(v.work.overdue, 2); assert.equal(v.work.held, 1); assert.equal(v.work.waiting, 1);
  assert.deepEqual(v.work.oldest.map((j) => j.key), ["1", "2"]); assert.equal(v.work.oldest[0].days, 33);
  assert.equal(v.work.tight + v.work.onTrack, 2);
});

test("deadlines are counted by month for the next six months, statutory ones apart", () => {
  const v = practiceView(input({ clients: [cl("A")], jobs: [job("1", "A", { Deadline: "2026-11-20" }), job("2", "A", { Deadline: "2026-12-07", ServiceKey: "SOMETHING" }), job("3", "A", { Deadline: "2027-04-30" }), job("4", "A", { Deadline: "2028-01-01" })] }));
  assert.deepEqual(v.work.deadlines.map((m) => m.key), ["2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04"]);
  assert.deepEqual(v.work.deadlines.map((m) => m.total), [1, 1, 0, 0, 0, 1]);
  assert.deepEqual(v.work.deadlines.map((m) => m.statutory), [1, 0, 0, 0, 0, 1]);
});

test("capacity: hours due against hours available, the three-month total and the peak month", () => {
  const v = practiceView(input({ clients: [cl("A")], jobs: [job("1", "A", { Deadline: "2026-11-20", EstimateHours: 200 })], capacity: () => 4 }));
  assert.equal(v.capacity.months[0].key, "2026-11");
  assert.ok(v.capacity.months[0].pct > 100);
  assert.equal(v.capacity.peak?.key, "2026-11");
  assert.ok(v.capacity.next3Due >= v.capacity.months[0].due);
});

test("money: fees a year, concentration, services, and clients with work but no fee", () => {
  const v = practiceView(input({
    clients: [cl("A"), cl("B"), cl("C")], jobs: [job("1", "C"), job("2", "C"), job("3", "A")],
    clientServices: [fee("f1", "A", { Fee: 900, AnnualFee: 10800 }), fee("f2", "B", { Fee: 100, AnnualFee: 1200, ServiceKey: "VAT" }), fee("f3", "B", { Fee: 50, FeePeriod: "quarterly", AnnualFee: 200, ServiceKey: "VAT" })],
    charges: [{ Key: "X", ClientKey: "B", Amount: 400, Status: "agreed", Vat: "standard" }],
  }));
  assert.equal(v.money.arr, 12200); assert.equal(v.money.oneOff, 400);
  assert.equal(v.money.top[0].clientKey, "A"); assert.equal(v.money.top[0].pct, 89);
  assert.equal(v.money.top5Pct, 100);
  assert.deepEqual(v.money.noFee, [{ clientKey: "C", openJobs: 2 }]);
  assert.equal(v.money.byService[0].serviceKey, "BOOK");
});

test("billing coverage counts recurring fee lines by their schedule state", () => {
  const v = practiceView(input({
    clients: [cl("A")], clientServices: [fee("f1", "A"), fee("f2", "A", { ServiceKey: "VAT" }), fee("f3", "A", { ServiceKey: "PAYROLL" }), fee("f4", "A", { ServiceKey: "ONE", OneOff: true, FeePeriod: "" })],
    billingLinks: [{ Key: "b1", FeeKey: "f1", Status: "active" }, { Key: "b2", FeeKey: "f2", Status: "draft" }, { Key: "b3", FeeKey: "f3", Status: "cancelled" }],
  }));
  assert.deepEqual(v.money.billing, { lines: 3, active: 1, draft: 1, none: 1 });
});

test("the team view groups clients by manager, else partner, with their fees and overdue work", () => {
  const v = practiceView(input({
    clients: [cl("A"), cl("B", { Manager: "", Partner: "Kevin" }), cl("C", { Manager: "", Partner: "" })],
    jobs: [job("1", "A", { Deadline: "2026-10-01" }), job("2", "B")], clientServices: [fee("f1", "A"), fee("f2", "B", { Fee: 50, AnnualFee: 600 })],
  }));
  const by = Object.fromEntries(v.team.map((t) => [t.owner, t]));
  assert.deepEqual([by.Sam.clients, by.Sam.arr, by.Sam.overdue], [1, 1200, 1]);
  assert.deepEqual([by.Kevin.clients, by.Kevin.arr, by.Kevin.open], [1, 600, 1]);
  assert.equal(by["(no manager or partner)"].clients, 1);
});

test("effective rate: fees a year over hours recorded in 12 months, thin time left out, lowest first", () => {
  const v = practiceView(input({
    clients: [cl("A"), cl("B"), cl("C"), cl("D")],
    clientServices: [fee("f1", "A", { Fee: 100, AnnualFee: 1200 }), fee("f2", "B", { Fee: 100, AnnualFee: 1200 }), fee("f3", "C", { Fee: 100, AnnualFee: 1200 }), fee("f4", "D", { Fee: 100, AnnualFee: 1200 })],
    time: [time("A", 10), time("A", 10), time("B", 40), time("C", 2), time("D", 100, { Started: "2024-01-01T09:00:00Z", Ended: "2024-01-01T12:00:00Z" }), time("B", 5, { Ended: "" })],
  }));
  assert.deepEqual(v.profit.rows.map((r) => [r.clientKey, r.rate, r.below]), [["B", 30, true], ["A", 60, true]]);
  assert.equal(v.profit.rated, 2); assert.equal(v.profit.withFees, 4); assert.equal(v.profit.trackedHours, 60); assert.equal(v.profit.practiceRate, 40);
  assert.equal(practiceView(input({ targetRate: 20, clients: [cl("B")], clientServices: [fee("f", "B")], time: [time("B", 40)] })).profit.rows[0].below, false);
});

test("compliance: no assessment, reviews overdue or soon, and letters not signed", () => {
  const v = practiceView(input({
    clients: [cl("A"), cl("B", { AMLReview: "2026-01-01" }), cl("C", { AMLReview: "2026-12-15" }), cl("D", { AMLReview: "2027-09-01", LoEStatus: "Active" }), cl("E", { LoEStatus: "" })],
  }));
  assert.deepEqual(v.compliance.amlNone, ["A", "E"]); assert.deepEqual(v.compliance.amlOverdue, ["B"]); assert.deepEqual(v.compliance.amlSoon, ["C"]);
  assert.deepEqual(v.compliance.noLetter, ["D", "E"]); assert.equal(v.compliance.gaps, 3);
});

test("the target rate setting is read safely", () => {
  assert.equal(readTargetRate(undefined), DEFAULT_TARGET_RATE); assert.equal(readTargetRate("abc"), DEFAULT_TARGET_RATE); assert.equal(readTargetRate(-5), DEFAULT_TARGET_RATE); assert.equal(readTargetRate(5000), DEFAULT_TARGET_RATE); assert.equal(readTargetRate("90"), 90);
});
