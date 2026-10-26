import test from "node:test";
import assert from "node:assert/strict";
import { agreedValue, onboardingReport, reportCsv, salesReport } from "../src/lib/reports.ts";
import { DEFAULT_STAGES } from "../src/lib/onboarding.ts";

const ag = (lines: any[]) => JSON.stringify({ vatRate: 0.2, lines });
const L = (o: any = {}) => ({ id: "l", serviceKey: "S", name: "S", frequency: "monthly", price: 100, discount: null, setupFee: 0, vat: "standard", optional: false, ...o });
const leads: any[] = [
  { Key: "L1", Source: "Referral", Created: "2026-09-01T00:00:00Z" }, { Key: "L2", Source: "Referral", Created: "2026-09-05T00:00:00Z" }, { Key: "L3", Source: "Website", Created: "2026-09-10T00:00:00Z" }, { Key: "L4", Source: "Website", Created: "2025-01-01T00:00:00Z" },
];
const opps: any[] = [
  { Key: "O1", LeadKey: "L1", Created: "2026-09-01T00:00:00Z", Outcome: "won", Value: 2000 }, { Key: "O2", LeadKey: "L2", Created: "2026-09-05T00:00:00Z", Outcome: "lost", LostReason: "Price", Value: 500 },
  { Key: "O3", LeadKey: "L3", Created: "2026-09-10T00:00:00Z", Value: 700 }, { Key: "O4", LeadKey: "L4", Created: "2025-01-01T00:00:00Z", Outcome: "lost", Value: 100 },
];
const proposals: any[] = [{ Key: "P1", OppKey: "O1", Status: "accepted", AcceptedVersion: 1, Created: "2026-09-02T00:00:00Z" }, { Key: "P2", OppKey: "O2", Status: "rejected", CurrentVersion: 1, Created: "2026-09-06T00:00:00Z" }];
const versions: any[] = [
  { ProposalKey: "P1", Version: 1, SentOn: "2026-09-03T00:00:00Z", AcceptedAt: "2026-09-11T12:00:00Z", Agreed: ag([L({ setupFee: 150 }), L({ frequency: "one-off", price: 400 })]) },
  { ProposalKey: "P2", Version: 1, SentOn: "2026-09-07T00:00:00Z" },
];
const onboardings: any[] = [{ Key: "OB1", ProposalKey: "P1", ProposalVersion: 1, Status: "activated", Created: "2026-09-12T00:00:00Z", ActivatedOn: "2026-09-20T00:00:00Z", ActivationSummary: JSON.stringify({ held: ["VAT"] }) }];

test("sales report: funnel, rates, sources, lost reasons, values and timings, within the period only", () => {
  const r = salesReport({ leads, opps, proposals, versions, onboardings, from: "2026-01-01", to: "2026-12-31" });
  assert.deepEqual(r.funnel, { leads: 3, opportunities: 3, proposalsMade: 2, proposalsSent: 2, proposalsAccepted: 1, onboardingStarted: 1, activated: 1 });
  assert.deepEqual([r.rates.oppWon, r.rates.proposalAccepted, r.rates.leadToActivated], [50, 50, 33.3]);
  assert.deepEqual([r.opps.won, r.opps.lost, r.opps.open, r.opps.wonValue, r.opps.openValue], [1, 1, 1, 2000, 700]);
  assert.deepEqual(r.bySource.find((s) => s.source === "Referral"), { source: "Referral", leads: 2, won: 1, wonValue: 2000 });
  assert.deepEqual(r.lostReasons, [{ reason: "Price", count: 1 }]);
  assert.deepEqual(r.acceptedValue, { recurring: 1200, oneOff: 550 });
  assert.deepEqual([r.timing.daysOppToAccepted, r.timing.daysAcceptedToActivated], [10, 9]);
  const all = salesReport({ leads, opps, proposals, versions, onboardings, from: "", to: "" });
  assert.equal(all.funnel.leads, 4); assert.equal(all.lostReasons.length, 2); assert.equal(all.lostReasons[1].reason, "(no reason recorded)");
  const none = salesReport({ leads: [], opps: [], proposals: [], versions: [], onboardings: [], from: "", to: "" });
  assert.equal(none.rates.oppWon, undefined); assert.equal(none.timing.daysOppToAccepted, undefined);
  assert.deepEqual(agreedValue(undefined), { recurring: 0, oneOff: 0 });
});

test("onboarding report: counts, ageing, what each is waiting on, held services, average time to activate", () => {
  const client: any = { Key: "C1", Title: "Acme Ltd", Kind: "Ltd" };
  const live: any = { Key: "OB2", Ref: "O-2", ClientKey: "C1", ProposalKey: "P9", ProposalVersion: 1, Status: "active", Created: "2026-10-01T00:00:00Z", Stages: "{}", Aml: "{}" };
  const view = (o: any): any => ({ onb: o, defs: DEFAULT_STAGES, client, engagements: [], proposals: [], versions: [], catalogue: [], people: [], today: "2026-10-26" });
  const r = onboardingReport({ onboardings: [...onboardings, live], viewFor: (o) => (o.Key === "OB2" ? view(o) : undefined), today: "2026-10-26" });
  assert.equal(r.inProgress, 1); assert.equal(r.activated, 1); assert.equal(r.heldServices, 1); assert.equal(r.avgDaysToActivate, 8);
  assert.equal(r.open[0].days, 25); assert.match(r.open[0].waitingOn, /Client details confirmed/);
  assert.equal(r.stageCounts[0].waiting, 1);
  const csv = reportCsv(salesReport({ leads, opps, proposals, versions, onboardings, from: "", to: "" }), r);
  assert.match(csv, /^"Report","Measure","Value"/); assert.match(csv, /Referral/); assert.match(csv, /"Onboarding","in progress","1"/);
});
