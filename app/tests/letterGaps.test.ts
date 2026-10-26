import test from "node:test";
import assert from "node:assert/strict";
import { BLANK_SECTIONS, DEFAULT_ENGAGEMENT_SETTINGS, EngagementSettings, advanceEng, readAgreed, readBody, reviewTemplate } from "../src/lib/engagements.ts";
import { bulkAdvance, generateBatch, generateFromSchedule, letterGaps, scheduleLines } from "../src/lib/letterGaps.ts";
import { readCatalogue } from "../src/lib/proposals.ts";

let n = 0;
const O = { actor: "Pat", now: "2026-10-26T10:00:00.000Z", pid: "practice-1", newKey: (p: string) => `${p}${++n}` };
const TODAY = "2026-10-26";
const yes = () => true;
const no = () => false;
const settings = (): EngagementSettings => {
  const s: EngagementSettings = { ...DEFAULT_ENGAGEMENT_SETTINGS, base: { ...BLANK_SECTIONS, terms: "Our terms apply.", feeTerms: "Fees are due in 14 days." } };
  const r: any = reviewTemplate(s, "base", yes, "Sam", O.now); if ("error" in r) throw new Error(r.error); return r.settings;
};
const catalogue = readCatalogue([
  { Key: "ACC", Title: "Annual accounts", Offered: true, ClientTypes: "limited" },
  { Key: "VAT", Title: "VAT returns", Offered: true, ClientTypes: "limited" },
  { Key: "BK", Title: "Bookkeeping", Offered: true, ClientTypes: "limited" },
] as any);
const clients: any[] = [
  { Key: "C1", Title: "Acme Ltd", Kind: "Ltd", Status: "active", Manager: "Mo", RegisteredOffice: "1 High St", ContactFirst: "Ann", ContactLast: "Acme" },
  { Key: "C2", Title: "Bee Ltd", Kind: "Ltd", Status: "active", Manager: "Mo" },
  { Key: "C3", Title: "Gone Ltd", Kind: "Ltd", Status: "archived" },
  { Key: "C4", Title: "No Fees Ltd", Kind: "Ltd", Status: "active" },
  { Key: "C5", Title: "Nothing Ltd", Kind: "Ltd", Status: "active" },
];
const sched: any[] = [
  { Key: "S1", ClientKey: "C1", ServiceKey: "ACC", Fee: 100, FeePeriod: "monthly", VatTreatment: "standard" },
  { Key: "S2", ClientKey: "C1", ServiceKey: "VAT", Fee: 90, FeePeriod: "quarterly", VatTreatment: "standard" },
  { Key: "S3", ClientKey: "C1", ServiceKey: "BK", Fee: 0, FeePeriod: "monthly" },
  { Key: "S4", ClientKey: "C2", ServiceKey: "ACC", Fee: 0, AnnualFee: 1200, FeePeriod: "" },
  { Key: "S5", ClientKey: "C3", ServiceKey: "ACC", Fee: 50, FeePeriod: "monthly" },
  { Key: "S6", ClientKey: "C4", ServiceKey: "ACC", Fee: 0, FeePeriod: "annually" },
  { Key: "S7", ClientKey: "C1", ServiceKey: "OLD", Fee: 10, FeePeriod: "monthly", EndedOn: "2026-01-01" },
];
const base = () => ({ clients, schedule: sched, services: [], catalogue, engagements: [] as any[], settings: settings() });
const one = (o: any = {}) => generateFromSchedule({ client: clients[0], schedule: sched, services: [], catalogue, settings: settings(), existing: [], practice: "Bannister & Co", today: TODAY, can: yes, ...o }, O);

test("a client's services are read as a letter would state them, skipping ended ones", () => {
  const l = scheduleLines("C1", sched, [], catalogue);
  assert.deepEqual(l.map((x) => [x.serviceKey, x.frequency, x.price, x.included]), [["ACC", "monthly", 100, false], ["VAT", "quarterly", 90, false], ["BK", "monthly", 0, true]]);
  const c2 = scheduleLines("C2", sched, [], catalogue);
  assert.deepEqual([c2[0].frequency, c2[0].price], ["annual", 1200], "an annual fee held only as AnnualFee still reads as annual");
});

test("the gap list: active clients with services no live letter covers; archived and service-less clients are left out", () => {
  const g = letterGaps(base());
  assert.deepEqual(g.map((x) => x.clientKey), ["C1", "C2", "C4"]);
  assert.equal(g[0].state, "ready");
  assert.equal(g.find((x) => x.clientKey === "C4")!.state, "no-fee", "no fee recorded: shown but not ready");
  assert.match(g.find((x) => x.clientKey === "C2")!.warnings.join(" "), /address/i);
  const unreviewed = letterGaps({ ...base(), settings: { ...DEFAULT_ENGAGEMENT_SETTINGS } });
  assert.equal(unreviewed.find((x) => x.clientKey === "C1")!.state, "not-reviewed");
});

test("a letter built from the schedule states the same services and fees, and needs no proposal", () => {
  const g: any = one();
  assert.ok(!g.error, g.error);
  const e = g.engagement;
  assert.equal(e.Status, "draft"); assert.equal(e.Source, "generated"); assert.equal(e.Basis, "schedule"); assert.equal(e.ProposalKey, ""); assert.equal(e.PracticeId, "practice-1");
  assert.deepEqual(JSON.parse(e.ServiceKeys), ["ACC", "VAT", "BK"]);
  const a = readAgreed(e.Agreed)!;
  assert.deepEqual(a.lines.map((l) => [l.serviceKey, l.price, l.frequency]), [["ACC", 100, "monthly"], ["VAT", 90, "quarterly"], ["BK", 0, "monthly"]]);
  assert.match(a.lines[2].name, /included in package/);
  const text = JSON.stringify(readBody(e.Body));
  for (const s of ["Annual accounts", "Our terms apply.", "Fees are due in 14 days.", "Acme Ltd", "1 High St", "Ann Acme"]) assert.ok(text.includes(s), `letter should contain ${s}`);
  assert.ok(!/from proposal/.test(text), "no proposal reference");
  assert.equal(e.ReviewDate, "2029-10-26", "the three-year review runs from the effective date");
});

test("refused when it would be wrong: no permission, inactive, no services, no fees, wording not reviewed, already covered", () => {
  assert.match((one({ can: no }) as any).error, /can't create/);
  assert.match((one({ client: clients[2], schedule: sched }) as any).error, /isn't active/);
  assert.match((one({ client: clients[4] }) as any).error, /no current services/);
  assert.match((one({ client: clients[3] }) as any).error, /No fees/);
  assert.ok("error" in (one({ settings: { ...DEFAULT_ENGAGEMENT_SETTINGS } }) as any));
  const made: any = one();
  const again: any = one({ existing: [made.engagement] });
  assert.match(again.error, /already covered/, "a draft in progress counts as cover, so it can't be made twice");
});

test("a letter covering some services leaves the others in the gap list, and only they go into the next letter", () => {
  const partial: any = { Key: "EN9", Ref: "E-2026-0009", ClientKey: "C1", Status: "signed", ServiceKeys: JSON.stringify(["ACC"]) };
  const g = letterGaps({ ...base(), engagements: [partial] });
  assert.deepEqual(g.find((x) => x.clientKey === "C1")!.uncovered.map((l) => l.serviceKey), ["VAT", "BK"]);
  assert.equal(g.find((x) => x.clientKey === "C1")!.hasLetter, true);
  const next: any = one({ existing: [partial] });
  assert.deepEqual(JSON.parse(next.engagement.ServiceKeys), ["VAT", "BK"]);
  assert.notEqual(next.engagement.Ref, "E-2026-0009");
  // ended and superseded letters don't count as cover
  const old = { ...partial, Status: "superseded" };
  assert.equal(letterGaps({ ...base(), engagements: [old] }).find((x) => x.clientKey === "C1")!.hasLetter, false);
});

test("renewing a schedule letter covers everything current and links the old one", () => {
  const first: any = one(); const signed = { ...first.engagement, Status: "signed" };
  const renewal: any = one({ existing: [signed], previousKey: signed.Key });
  assert.ok(!renewal.error, renewal.error);
  assert.equal(renewal.engagement.PreviousKey, signed.Key);
  assert.deepEqual(JSON.parse(renewal.engagement.ServiceKeys), ["ACC", "VAT", "BK"]);
});

test("a batch makes a draft for each client that can have one, skips the rest with a reason, never duplicates, and numbers letters in turn", () => {
  const common = { schedule: sched, services: [], catalogue, settings: settings(), existing: [] as any[], practice: "P", today: TODAY, can: yes };
  const r = generateBatch(["C1", "C2", "C4", "C3", "C1", "NOPE"], common, clients, O);
  assert.deepEqual(r.made.map((m) => m.clientKey), ["C1", "C2"]);
  assert.deepEqual(r.skipped.map((s) => s.clientKey).sort(), ["C3", "C4", "NOPE"]);
  assert.match(r.skipped.find((s) => s.clientKey === "C4")!.reason, /No fees/);
  assert.equal(new Set(r.made.map((m) => m.ref)).size, 2, "each letter has its own reference");
  const created = r.written.creates!.map((c) => c.row);
  assert.equal(created.length, 2); assert.ok(created.every((e) => e.PracticeId === "practice-1" && e.Status === "draft"));
  assert.equal(r.written.log.length, 2); assert.equal(r.written.activities.length, 2);
  // running it again with those drafts present makes nothing new
  const again = generateBatch(["C1", "C2"], { ...common, existing: created }, clients, O);
  assert.equal(again.made.length, 0); assert.ok(again.skipped.every((s) => /already covered/.test(s.reason)));
  // the limit holds and says how many are left
  const limited = generateBatch(["C1", "C2"], common, clients, O, 1);
  assert.equal(limited.made.length, 1); assert.equal(limited.remaining, 1);
  assert.equal(generateBatch(["C1"], { ...common, can: no }, clients, O).made.length, 0);
});

test("bulk submit and approve check each letter: roles, independence and order", () => {
  const r = generateBatch(["C1", "C2"], { schedule: sched, services: [], catalogue, settings: settings(), existing: [], practice: "P", today: TODAY, can: yes }, clients, O);
  const drafts: any[] = r.written.creates!.map((c) => ({ ...c.row }));
  assert.equal(bulkAdvance(drafts, "approved", true, yes, O).moved.length, 0, "the preparer can't approve their own when independent");
  assert.match(bulkAdvance(drafts, "approved", true, yes, O).skipped[0].reason, /Someone else/);
  const sub = bulkAdvance(drafts, "review", true, yes, O);
  assert.equal(sub.moved.length, 2); assert.equal(sub.written.patches.length, 2);
  const inReview = drafts.map((d) => ({ ...d, Status: "review" }));
  assert.equal(bulkAdvance(inReview, "approved", true, yes, { ...O, actor: "Sam" }).moved.length, 2);
  assert.equal(bulkAdvance(inReview, "approved", false, no, { ...O, actor: "Sam" }).moved.length, 0, "no permission, nothing moves");
  assert.match(bulkAdvance(drafts, "review", false, no, O).skipped[0].reason, /can't change/);
  // approving a draft straight away is allowed for someone who can approve and isn't bound by independence
  assert.equal(bulkAdvance(drafts, "approved", false, yes, O).moved.length, 2);
  assert.ok(advanceEng);
});
