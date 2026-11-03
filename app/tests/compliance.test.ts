import test from "node:test";
import assert from "node:assert/strict";
import * as c from "../src/lib/compliance.ts";

const TODAY = "2026-11-03";
let n = 0;
const O = { actor: "Kevin", now: "2026-11-03T09:00:00.000Z", pid: "default", newKey: (p: string) => `${p}${++n}` };
const yes = () => true, no = () => false;
const cl = (k: string, o: any = {}): any => ({ Key: k, Title: `Client ${k}`, Status: "", LoEStatus: "Finalised", ...o });
const ok = <T,>(w: T | { error: string }): T => { assert.ok(!("error" in (w as any)), JSON.stringify(w)); return w as T; };
const bad = (w: any, re: RegExp) => { assert.ok("error" in w, "expected an error"); assert.match(w.error, re); };

test("default deadlines: a month, 72 hours, eight weeks", () => {
  assert.equal(c.dueFor("sar", "2026-01-31"), "2026-02-28");
  assert.equal(c.dueFor("erasure", "2026-10-03"), "2026-11-03");
  assert.equal(c.dueFor("breach", "2026-11-01"), "2026-11-04");
  assert.equal(c.dueFor("complaint", "2026-11-03"), "2026-12-29");
});

test("logging an entry needs a manager, a date not in the future and a summary", () => {
  const base = { kind: "sar" as const, clientKey: "A", person: "J Smith", opened: "2026-10-20", due: "", owner: "", summary: "Wants copies of everything" };
  bad(c.openEntry(base, TODAY, no, O), /manager or partner/);
  bad(c.openEntry({ ...base, opened: "2026-12-01" }, TODAY, yes, O), /future/);
  bad(c.openEntry({ ...base, summary: " " }, TODAY, yes, O), /Say what/);
  const w: any = ok(c.openEntry(base, TODAY, yes, O));
  assert.equal(w.creates[0].list, "ComplianceLog");
  assert.equal(w.creates[0].row.Due, "2026-11-20");
  assert.equal(w.creates[0].row.Owner, "Kevin");
  assert.equal(w.activities.length, 1);
  assert.equal(((ok(c.openEntry({ ...base, clientKey: "" }, TODAY, yes, O)) as any).activities).length, 0);
});

test("entry states: overdue, soon, open, closed", () => {
  const e = (due: string, kind = "sar", status = "open"): any => c.readEntry({ Key: "x", Kind: kind, Due: due, Status: status, Opened: "2026-10-01" });
  assert.equal(c.entryState(e("2026-11-02"), TODAY).state, "overdue");
  assert.equal(c.entryState(e("2026-11-10"), TODAY).state, "soon");
  assert.equal(c.entryState(e("2026-11-11"), TODAY).state, "open");
  assert.equal(c.entryState(e("2026-11-05", "breach"), TODAY).state, "open");
  assert.equal(c.entryState(e("2026-11-04", "breach"), TODAY).state, "soon");
  assert.equal(c.entryState(e("2026-01-01", "sar", "closed"), TODAY).state, "closed");
});

test("closing a breach needs a decision on telling the ICO", () => {
  const row: any = { Key: "L1", Kind: "breach", Status: "open", Opened: "2026-11-01", Due: "2026-11-04", Reported: "" };
  bad(c.closeEntry(row, { outcome: "Fixed", reported: "" }, TODAY, yes), /ICO/);
  bad(c.closeEntry(row, { outcome: " ", reported: "yes" }, TODAY, yes), /how it was dealt/);
  const w: any = ok(c.closeEntry(row, { outcome: "Fixed", reported: "no-risk" }, TODAY, yes));
  assert.equal(w.patches[0].patch.Status, "closed"); assert.equal(w.patches[0].patch.Reported, "no-risk"); assert.equal(w.patches[0].patch.Closed, TODAY);
  bad(c.closeEntry({ ...row, Status: "closed" }, { outcome: "x", reported: "yes" }, TODAY, yes), /Already/);
  const sar: any = { Key: "L2", Kind: "sar", Status: "open", Opened: "2026-10-01", Due: "2026-11-01" };
  ok(c.closeEntry(sar, { outcome: "Sent copies", reported: "" }, TODAY, yes));
});

test("changing a deadline can't go before the day it was received", () => {
  const row: any = { Key: "L1", Kind: "sar", Opened: "2026-10-20" };
  bad(c.changeDue(row, "2026-10-01", yes), /before/);
  assert.equal((ok(c.changeDue(row, "2026-12-20", yes)) as any).patches[0].patch.Due, "2026-12-20");
});

test("nextDue keeps the anniversary and always lands after the day it was done", () => {
  assert.equal(c.nextDue("2026-10-15", "yearly", "2026-11-03"), "2027-10-15");
  assert.equal(c.nextDue("2025-01-10", "yearly", "2026-11-03"), "2027-01-10");
  assert.equal(c.nextDue("2026-11-30", "quarterly", "2026-11-03"), "2027-02-28");
  assert.equal(c.nextDue("2026-11-30", "none", "2026-11-03"), "");
});

test("completing a recurring date rolls it on; a one-off finishes", () => {
  const rec: any = { Key: "O1", Title: "PII", Due: "2026-11-01", Repeat: "yearly", Status: "active" };
  const w: any = ok(c.completeObligation(rec, TODAY, yes));
  assert.equal(w.patches[0].patch.Due, "2027-11-01"); assert.equal(w.patches[0].patch.LastDone, TODAY);
  const once: any = { Key: "O2", Title: "x", Due: "2026-11-01", Repeat: "none", Status: "active" };
  assert.equal((ok(c.completeObligation(once, TODAY, yes)) as any).patches[0].patch.Status, "done");
  bad(c.completeObligation(rec, TODAY, no), /manager or partner/);
  bad(c.completeObligation({ ...rec, Status: "done" }, TODAY, yes), /finished/);
});

test("obligation states", () => {
  const o = (due: string, status = "active"): any => c.readObligation({ Key: "x", Title: "t", Due: due, Status: status });
  assert.equal(c.obligationState(o(""), TODAY).state, "undated");
  assert.equal(c.obligationState(o("2026-11-02"), TODAY).state, "overdue");
  assert.equal(c.obligationState(o("2026-12-03"), TODAY).state, "soon");
  assert.equal(c.obligationState(o("2026-12-04"), TODAY).state, "ok");
  assert.equal(c.obligationState(o("2026-01-01", "ended"), TODAY).state, "closed");
});

test("the starter list adds only what is missing, with no dates", () => {
  const w: any = ok(c.addStarters([{ Title: "Complaints procedure review" }], yes, O));
  assert.equal(w.creates.length, c.STARTER_OBLIGATIONS.length - 1);
  assert.ok(w.creates.every((x: any) => x.row.Due === ""));
  bad(c.addStarters(c.STARTER_OBLIGATIONS.map((s) => ({ Title: s.title })), yes, O), /already/);
});

test("retention years never go under five", () => {
  assert.equal(c.readRetentionYears(3), 6); assert.equal(c.readRetentionYears(7), 7); assert.equal(c.readRetentionYears("x"), 6);
  assert.equal(c.clientRetentionYears(cl("A", { RetentionYears: 4 }), 6), 6);
  assert.equal(c.clientRetentionYears(cl("A", { RetentionYears: 8 }), 6), 8);
});

test("ceasing a client archives them and records why", () => {
  bad(c.ceaseClient(cl("A"), "2026-10-01", "Sold up", TODAY, no, O), /manager or partner/);
  bad(c.ceaseClient(cl("A"), "2026-12-01", "Sold up", TODAY, yes, O), /future/);
  bad(c.ceaseClient(cl("A"), "2026-10-01", " ", TODAY, yes, O), /why/);
  bad(c.ceaseClient(cl("A", { Status: "Archived" }), "2026-10-01", "x", TODAY, yes, O), /already/);
  const w: any = ok(c.ceaseClient(cl("A"), "2026-10-01", "Sold up", TODAY, yes, O));
  assert.deepEqual(w.patches[0].patch, { Status: "Archived", CeasedOn: "2026-10-01", CeasedReason: "Sold up" });
  const r: any = ok(c.reinstateClient(cl("A", { Status: "Archived" }), yes, O));
  assert.equal(r.patches[0].patch.Status, ""); assert.equal(r.patches[0].patch.CeasedOn, "");
  bad(c.reinstateClient(cl("A"), yes, O), /hasn't ceased/);
});

test("retention review: held, soon, due, then decisions", () => {
  const clients = [cl("A", { Status: "Archived", CeasedOn: "2020-10-01" }), cl("B", { Status: "Archived", CeasedOn: "2020-12-01" }), cl("C", { Status: "Archived", CeasedOn: "2024-01-01" }), cl("D"), cl("E", { Status: "Archived", CeasedOn: "" })];
  const rows = c.retentionRows(clients, [], 6, TODAY);
  assert.deepEqual(rows.map((r) => [r.clientKey, r.state]), [["A", "due"], ["B", "soon"], ["C", "held"]]);
  assert.equal(rows[0].reviewOn, "2026-10-01");
  // a keep decision moves the date on
  const log = [{ Key: "L", Kind: "retention", ClientKey: "A", Decision: "keep", ReviewOn: "2027-06-01", Created: "2026-11-01T00:00:00Z", Summary: "Dispute" }];
  const after = c.retentionRows(clients, log, 6, TODAY).find((r) => r.clientKey === "A")!;
  assert.equal(after.reviewOn, "2027-06-01"); assert.equal(after.state, "held");
});

test("retention decisions follow the order: review, approve, then mark deleted", () => {
  const A = cl("A", { Status: "Archived", CeasedOn: "2020-10-01", Title: "Alpha" });
  const rowOf = (log: any[] = []) => c.retentionRows([A], log, 6, TODAY)[0];
  bad(c.retentionDecision(A, rowOf(), "deleted", { note: "", reviewOn: "" }, TODAY, yes, O), /Approve/);
  bad(c.retentionDecision(A, rowOf(), "keep", { note: "", reviewOn: "2027-01-01" }, TODAY, yes, O), /why/);
  bad(c.retentionDecision(A, rowOf(), "keep", { note: "Dispute", reviewOn: "2026-01-01" }, TODAY, yes, O), /future/);
  bad(c.retentionDecision(A, rowOf(), "delete", { note: "", reviewOn: "" }, TODAY, yes, O), /who checked/);
  const approve: any = ok(c.retentionDecision(A, rowOf(), "delete", { note: "Checked by Kevin", reviewOn: "" }, TODAY, yes, O));
  assert.equal(approve.creates[0].row.Decision, "delete");
  const approvedRow = rowOf([{ ...approve.creates[0].row }]);
  assert.equal(approvedRow.state, "approved");
  ok(c.retentionDecision(A, approvedRow, "deleted", { note: "", reviewOn: "" }, TODAY, yes, O));
  const done = c.retentionRows([A], [approve.creates[0].row, { Key: "z", Kind: "retention", ClientKey: "A", Decision: "deleted", Created: "2026-11-03T10:00:00Z" }], 6, TODAY)[0];
  assert.equal(done.state, "done");
  // too early
  const B = cl("B", { Status: "Archived", CeasedOn: "2024-01-01" });
  bad(c.retentionDecision(B, c.retentionRows([B], [], 6, TODAY)[0], "keep", { note: "x", reviewOn: "2027-01-01" }, TODAY, yes, O), /can't be reviewed until/);
});

test("risk register rates the practice and ignores ceased clients", () => {
  const base: any = { clients: [cl("A"), cl("Z", { Status: "Archived", CeasedOn: "2026-09-01" })], log: [], obligations: [], assessments: [], onboardings: [], backupLast: { at: "2026-11-03T02:00:00Z" }, practiceYears: 6, today: TODAY };
  const r = c.riskRegister(base);
  const line = (k: string) => r.lines.find((l) => l.key === k)!;
  assert.equal(line("aml").count, 1); assert.equal(line("aml").level, "red"); assert.equal(r.overall, "red");
  assert.equal(line("letters").count, 0); assert.equal(line("backup").level, "green");
  assert.equal(line("restore").level, "amber");
  // overdue obligation and undecided breach
  const r2 = c.riskRegister({ ...base, obligations: [{ Key: "O", Title: "PII", Due: "2026-10-01", Status: "active", Repeat: "yearly" }], log: [{ Key: "L", Kind: "breach", Status: "open", Opened: "2026-11-02", Due: "2026-11-05", Reported: "" }] });
  assert.equal(r2.lines.find((l) => l.key === "obligations")!.level, "red");
  assert.equal(r2.lines.find((l) => l.key === "breaches")!.count, 1);
  // no backup at all is red
  assert.equal(c.riskRegister({ ...base, backupLast: undefined }).lines.find((l) => l.key === "backup")!.level, "red");
  // a recent restore test is green
  const r3 = c.riskRegister({ ...base, obligations: [{ Key: "O", Title: "Backup restore test", Kind: "backup", Due: "2027-01-01", LastDone: "2026-10-20", Status: "active", Repeat: "quarterly" }] });
  assert.equal(r3.lines.find((l) => l.key === "restore")!.level, "green");
});

test("audit trail merges every log, newest first, and filters and exports", () => {
  const rows = c.auditTrail({
    salesLog: [{ Key: "s1", At: "2026-11-01T10:00:00Z", Actor: "Sam", Action: "created", EntityType: "lead", ClientKey: "", Detail: '{"name":"Acme"}' }],
    feeHistory: [{ Key: "f1", At: "2026-11-02T10:00:00Z", Actor: "Kevin", Action: "fee-changed", ClientKey: "A", Reason: "Annual review", Old: "100", New: "110" }],
    checklistLog: [], billingChases: [{ Key: "b1", At: "2026-11-03T08:00:00Z", Actor: "Kevin", Kind: "chase", ClientKey: "A", InvoiceNos: "INV-1", Note: "" }],
    complianceLog: [{ Key: "c1", Created: "2026-10-30T10:00:00Z", CreatedBy: "Kevin", Kind: "sar", Status: "open", ClientKey: "A", Summary: "Copies, please" }, { Key: "c0", Created: "", Kind: "sar" }],
  });
  assert.deepEqual(rows.map((r) => r.key), ["b1", "f1", "s1", "c1"]);
  assert.equal(c.filterAudit(rows, { area: "Fees" }).length, 1);
  assert.equal(c.filterAudit(rows, { actor: "Sam" }).length, 1);
  assert.equal(c.filterAudit(rows, { from: "2026-11-02" }).length, 2);
  assert.equal(c.filterAudit(rows, { q: "client a" }, (k) => (k ? `Client ${k}` : "")).length, 3);
  const csv = c.auditCsv(rows, (k) => k);
  assert.equal(csv.split("\r\n").length, 5); assert.match(csv, /^When,Who,Area,Action,Client,Detail/);
  assert.match(csv, /"Annual review; from 100; to 110"|Annual review; from 100; to 110/);
});

test("AML table skips ceased clients", () => {
  const t = c.amlTable([cl("A"), cl("Z", { Status: "Archived" })], [], [], TODAY);
  assert.equal(t.length, 1); assert.equal(t[0].state, "none");
});
