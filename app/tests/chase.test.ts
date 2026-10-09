// Chasing records.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_TEMPLATE, chaseItems, chasePatch, chaseSummary, fillTemplate, groupByClient, mailtoLink, recordsNeededBy, recordsRule,
} from "../src/lib/chase";
import { Client, Job } from "../src/lib/domain";

const today = "2026-10-09";
const job = (o: Partial<Job>): Job => ({ Key: "J", Title: "Limited company accounts", ClientKey: "C1", ServiceKey: "ACCS_LTD", Status: "Open", ...o });

test("which work needs records, and when", () => {
  assert.deepEqual(recordsRule("ACCS_LTD"), { needs: true, leadDays: 90 });
  assert.equal(recordsRule("CS01").needs, false);
  assert.deepEqual(recordsRule("CS01", [{ Key: "CS01", RecordsNeeded: "yes", RecordsLeadDays: 10 }]), { needs: true, leadDays: 10 });
  assert.equal(recordsRule("VAT", [{ Key: "VAT", RecordsNeeded: "no" }]).needs, false);
  // 90 days before a 31 Dec deadline
  assert.deepEqual(recordsNeededBy(job({ PeriodEnd: "2026-03-31", Deadline: "2026-12-31" }), recordsRule("ACCS_LTD")), { date: "2026-10-02", worked: true });
  // never before the period ends
  assert.equal(recordsNeededBy(job({ PeriodEnd: "2026-09-30", Deadline: "2026-11-07", ServiceKey: "VAT" }), { needs: true, leadDays: 60 })!.date, "2026-10-01");
  // the job's own date wins
  assert.deepEqual(recordsNeededBy(job({ RecordsExpected: "2026-11-15", Deadline: "2026-12-31" }), recordsRule("ACCS_LTD")), { date: "2026-11-15", worked: false });
});

test("the chase list: late, due soon, chased recently; skips received, on hold and not-yet-ended periods", () => {
  const jobs = [
    job({ Key: "late", PeriodEnd: "2026-03-31", Deadline: "2026-12-31" }), // needed 2 Oct
    job({ Key: "soon", PeriodEnd: "2026-04-30", Deadline: "2027-01-15" }), // needed 17 Oct
    job({ Key: "later", PeriodEnd: "2026-06-30", Deadline: "2027-03-31" }), // needed 31 Dec: not yet
    job({ Key: "got", PeriodEnd: "2026-03-31", Deadline: "2026-12-31", RecordsReceived: "2026-09-01" }),
    job({ Key: "held", PeriodEnd: "2026-03-31", Deadline: "2026-12-31", Status: "On hold" }),
    job({ Key: "cs01", ServiceKey: "CS01", PeriodEnd: "2026-09-01", Deadline: "2026-09-15" }),
    job({ Key: "running", ServiceKey: "VAT", PeriodEnd: "2026-10-31", Deadline: "2026-12-07" }),
    job({ Key: "chased", ClientKey: "C2", PeriodEnd: "2026-03-31", Deadline: "2026-12-20", LastChased: "2026-10-06" }),
    job({ Key: "done", Status: "Complete", PeriodEnd: "2026-03-31", Deadline: "2026-12-31" }),
  ];
  const items = chaseItems(jobs, [], today);
  assert.deepEqual(items.map((i) => [i.job.Key, i.status]), [["chased", "chased"], ["late", "late"], ["soon", "soon"]]);
  const groups = groupByClient(items);
  assert.deepEqual(groups.map((g) => [g.clientKey, g.status, g.items.length]), [["C1", "late", 2], ["C2", "chased", 1]]);
});

test("email wording", () => {
  const client = { Key: "C1", Title: "Acme Ltd", ContactFirst: "Samantha", ContactPreferred: "Sam" } as Client;
  const items = chaseItems([job({ PeriodEnd: "2026-04-30", Deadline: "2027-01-15" })], [], today);
  const { subject, body } = fillTemplate(DEFAULT_TEMPLATE, client, items, "Kevin", today);
  assert.equal(subject, "Records needed: Acme Ltd");
  assert.match(body, /^Hi Sam,/);
  assert.match(body, /- Limited company accounts for the period to 30 Apr 2026/);
  assert.match(body, /by Sat 17 Oct 2026\?/);
  assert.match(body, /Kevin$/);
  // late records: ask for them within a week, not by a date already past
  const late = chaseItems([job({ PeriodEnd: "2026-03-31", Deadline: "2026-12-31" })], [], today);
  assert.match(fillTemplate(DEFAULT_TEMPLATE, client, late, "Kevin", today).body, /by Fri 16 Oct 2026\?/);
  assert.equal(mailtoLink("sam@acme.co.uk", "Hi there", "a&b\nc"), "mailto:sam@acme.co.uk?subject=Hi%20there&body=a%26b%0Ac");
});

test("the chase log", () => {
  const first = chasePatch(job({}), "email", today);
  assert.deepEqual(first, { LastChased: today, ChaseCount: 1, ChaseLog: "9 Oct 2026: chased by email" });
  const second = chasePatch(job(first as Partial<Job>), "phone", "2026-10-16");
  assert.equal(second.ChaseCount, 2);
  assert.equal(second.ChaseLog, "16 Oct 2026: chased by phone\n9 Oct 2026: chased by email");
  assert.equal(chaseSummary(job({ ...second } as Partial<Job>)), "Chased 2 times, last 16 Oct");
  assert.equal(chaseSummary(job({})), "Not chased yet");
});

test("stages: past a 'Request records' stage means the records are in", async () => {
  const { pastRecordsStage, receivedStage } = await import("../src/lib/chase");
  const stages = [
    { ServiceKey: "ACCS_LTD", StageNo: 1, Title: "Request records" },
    { ServiceKey: "ACCS_LTD", StageNo: 2, Title: "Records Received" },
    { ServiceKey: "MGMT_ACCOUNTS", StageNo: 1, Title: "Reconcile Balance Sheet" },
  ];
  assert.equal(pastRecordsStage(job({ StageNo: 2 }), stages), true);
  assert.equal(pastRecordsStage(job({ StageNo: 1 }), stages), false);
  assert.equal(pastRecordsStage(job({ StageNo: 3, ServiceKey: "MGMT_ACCOUNTS" }), stages), false);
  assert.equal(receivedStage(job({ StageNo: 1 }), stages)?.Title, "Records Received");
  assert.equal(receivedStage(job({ StageNo: 2 }), stages), undefined);
  const items = chaseItems([job({ Key: "a", StageNo: 2, PeriodEnd: "2026-03-31", Deadline: "2026-12-31" })], [], today, stages);
  assert.equal(items.length, 0);
});
