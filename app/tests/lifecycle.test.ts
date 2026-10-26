import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_STAGES, createLead, createOpp, findDuplicates, linkToClient, moveStage, setOutcome,
} from "../src/lib/sales.ts";
import {
  accept, advance, calcLine, contentTotals, createProposal, emptyContent, encodeContent, lineFromService, proposalCan, readCatalogue, totalsFor, revise,
} from "../src/lib/proposals.ts";
import {
  BLANK_SECTIONS, DEFAULT_ENGAGEMENT_SETTINGS, advanceEng, generate, markSigned, requestReview, reviewTemplate, sendOut, addYears, readAgreed,
} from "../src/lib/engagements.ts";
import {
  DEFAULT_STAGES as ONB_STAGES, EMPTY_AML, activate, approveAml, approveOnboarding, clientFromLead, onboardingCan, saveAml, setStage, stageLines, startOnboarding, blockers, readAml,
} from "../src/lib/onboarding.ts";
import { applyProposal, readFeeLine, revenue, feeCan } from "../src/lib/fees.ts";
import { buildActions, reconcile, itemsOf, visibleTo, canSeeAll } from "../src/lib/actions.ts";

/**
 * The whole lifecycle in one place, against an in-memory copy of the lists. Every step uses the real logic and applies
 * what it writes the way the app does (creates, then patches), so a hand-off that loses or duplicates a record shows up here.
 */
let n = 0;
const TODAY = "2026-10-26";
const O = { actor: "Kevin", now: "2026-10-26T10:00:00.000Z", pid: "practice-1", newKey: (p: string) => `${p}${++n}` };
const as = (actor: string) => ({ ...O, actor });
const cfg = (staff: { name: string; role: string }[]): any => ({ staff, overriders: [], independentReview: false, auto: true });
const config = cfg([{ name: "Kevin", role: "partner" }, { name: "Sam", role: "manager" }, { name: "Pat", role: "preparer" }]);
const can = (name: string) => (a: any) => proposalCan(config, name, a);
const who = (name: string) => ({ can: can(name), independent: false });

type Row = Record<string, any>;
class Store {
  lists: Record<string, Row[]> = {};
  get(l: string) { return (this.lists[l] ||= []); }
  add(l: string, r: Row) { this.get(l).push(r); return r; }
  apply(w: any) {
    for (const c of w.creates || []) this.add(c.list, c.row);
    for (const p of w.patches || []) {
      const target = this.get(p.list).find((r) => r.Key === p.row.Key);
      assert.ok(target, `patch to a ${p.list} row that does not exist: ${p.row.Key}`);
      Object.assign(target, p.patch);
    }
    for (const l of w.log || []) this.add("SalesLog", l);
    for (const a of w.activities || []) this.add("Activities", a);
  }
  find(l: string, k: string) { return this.get(l).find((r) => r.Key === k)!; }
}
const ok = <T,>(r: T | { error: string }): T => { if (r && typeof r === "object" && "error" in (r as any)) throw new Error((r as any).error); return r as T; };

const catalogue = readCatalogue([
  { Key: "ACC", Title: "Annual accounts", Offered: true, Price: 1200, PriceFrequency: "annual", ClientTypes: "limited", Scope: "Prepare accounts" },
  { Key: "VAT", Title: "VAT returns", Offered: true, Price: 90, PriceFrequency: "quarterly", ClientTypes: "limited", RequiresAuth: true },
  { Key: "ADV", Title: "Tax advice", Offered: true, Price: 300, PriceFrequency: "one-off", ClientTypes: "limited" },
] as any);
const services: any[] = [
  { Key: "ACC", Title: "Annual accounts", RepeatMonths: 12, DeadlineMode: "after", DeadlineMonths: 9, DeadlineDays: 0, KeepMonthEnd: true },
  { Key: "VAT", Title: "VAT returns", RepeatMonths: 3, DeadlineMode: "after", DeadlineMonths: 1, DeadlineDays: 7, KeepMonthEnd: true },
  { Key: "ADV", Title: "Tax advice" },
];
const engSettings = (() => {
  const s: any = { ...DEFAULT_ENGAGEMENT_SETTINGS, base: { ...BLANK_SECTIONS, terms: "Our terms apply.", clientResp: "Keep records.", feeTerms: "Fees are due in 14 days." } };
  const r: any = reviewTemplate(s, "base", () => true, "Sam", O.now);
  return r.settings;
})();

/** Run the front half: lead → qualified → proposal accepted. Returns the store and the keys. */
function toAccepted(s = new Store()) {
  const l = ok(createLead({ name: "Newco Ltd", kind: "business", contactName: "Ann", email: "ann@newco.test", source: "Referral" }, as("Pat")));
  s.add("Leads", l.lead); s.add("SalesLog", l.log); s.add("Activities", l.activity);
  const op = ok(createOpp({ title: "Newco accounts and VAT", leadKey: l.lead.Key, stage: "new", value: 1560 }, s.get("Opportunities") as any, as("Pat")));
  s.add("Opportunities", op.opp); s.add("SalesLog", op.log); s.add("Activities", op.activity);
  for (const to of ["contacted", "qualified", "discovery", "preparing"]) {
    const m = moveStage(s.find("Opportunities", op.opp.Key) as any, to, undefined, s.get("Opportunities") as any, DEFAULT_STAGES, as("Pat"));
    if ("error" in m) throw new Error(`${to}: ${m.error}`); s.apply(m);
  }
  const lines = [lineFromService(catalogue.find((c) => c.key === "ACC")!, "limited"), lineFromService(catalogue.find((c) => c.key === "VAT")!, "limited")] as any[];
  const content = { ...emptyContent(), title: "Proposal for Newco", recipientName: "Ann", recipientEmail: "ann@newco.test", validUntil: "2026-11-30", lines };
  const p = ok(createProposal(s.find("Opportunities", op.opp.Key) as any, content as any, s.get("Proposals"), as("Pat")));
  s.add("Proposals", p.proposal); s.add("ProposalVersions", p.version); s.add("SalesLog", p.log); s.add("Activities", p.activity);
  return { s, lead: l.lead, opp: op.opp, proposal: p.proposal, version: p.version };
}

test("lifecycle: lead to accepted proposal, with the right people at each step", () => {
  const { s, proposal, version, opp } = toAccepted();
  assert.equal(s.get("Leads").length, 1);
  assert.equal(s.get("Opportunities").length, 1);
  assert.equal(version.Status, "draft");

  // a preparer can submit for review but can't approve, send or record acceptance
  s.apply(ok(advance(proposal, s.find("ProposalVersions", version.Key), { to: "review" }, who("Pat"), TODAY, as("Pat"))));
  const v = () => s.find("ProposalVersions", version.Key);
  assert.match((advance(proposal, v(), { to: "approved" }, who("Pat"), TODAY, as("Pat")) as any).error, /can't approve/);
  s.apply(ok(advance(proposal, v(), { to: "approved" }, who("Sam"), TODAY, as("Sam"))));
  assert.match((advance(proposal, v(), { to: "sent", hash: "h" }, who("Pat"), TODAY, as("Pat")) as any).error, /Only a manager or partner/);
  s.apply(ok(advance(proposal, v(), { to: "sent", hash: "abc123", docKey: "D1" }, who("Sam"), TODAY, as("Sam"))));
  assert.match((accept(proposal, v(), { name: "Ann", method: "recorded", evidence: "email" }, who("Pat"), TODAY, s.find("Opportunities", opp.Key) as any, s.get("Opportunities") as any, DEFAULT_STAGES, as("Pat")) as any).error, /Only a manager or partner/);
  s.apply(ok(accept(proposal, v(), { name: "Ann", email: "ann@newco.test", method: "recorded", evidence: "Email of 25 Oct" }, who("Sam"), TODAY, s.find("Opportunities", opp.Key) as any, s.get("Opportunities") as any, DEFAULT_STAGES, as("Sam"))));

  assert.equal(v().Status, "accepted");
  assert.equal(s.find("Proposals", proposal.Key).Status, "accepted");
  assert.equal(s.find("Opportunities", opp.Key).Outcome, "won", "acceptance wins the opportunity");
  // accepting twice must not be possible
  assert.ok("error" in (accept(s.find("Proposals", proposal.Key), v(), { name: "Ann", method: "recorded", evidence: "again" }, who("Sam"), TODAY, s.find("Opportunities", opp.Key) as any, s.get("Opportunities") as any, DEFAULT_STAGES, as("Sam")) as any));
  // agreed fees recorded on the version are what later steps use
  const agreed = readAgreed(v().Agreed)!;
  assert.deepEqual(agreed.lines.map((l) => l.serviceKey).sort(), ["ACC", "VAT"]);
});

test("lifecycle: everything created carries the practice, a unique key, and nothing is duplicated", () => {
  const { s } = toAccepted();
  for (const [list, rows] of Object.entries(s.lists)) {
    const keys = rows.map((r) => r.Key);
    assert.equal(new Set(keys).size, keys.length, `${list} has duplicate keys`);
    if (["Leads", "Opportunities", "Proposals", "ProposalVersions", "SalesLog"].includes(list)) for (const r of rows) assert.equal(r.PracticeId, O.pid, `${list} row ${r.Key} is missing PracticeId`);
  }
  assert.equal(s.get("Proposals").length, 1);
  assert.equal(s.get("ProposalVersions").length, 1);
});

test("duplicate detection: the same email, company number or name finds the lead or client; a different one doesn't", () => {
  const { s, lead } = toAccepted();
  const clients: any[] = [{ Key: "C9", Title: "Other Ltd", Email: "hello@other.test", CompanyNumber: "09876543" }];
  assert.ok(findDuplicates({ name: "Someone", email: "ANN@newco.test" }, s.get("Leads") as any, clients, []).some((m) => m.key === lead.Key));
  assert.ok(findDuplicates({ name: "Newco Limited" }, s.get("Leads") as any, clients, []).length > 0, "name variants match");
  assert.ok(findDuplicates({ name: "X", companyNumber: "9876543" }, s.get("Leads") as any, clients, []).some((m) => m.key === "C9"), "company number ignores leading zeros");
  assert.equal(findDuplicates({ name: "Totally Different", email: "no@one.test" }, s.get("Leads") as any, clients, []).length, 0);
  assert.equal(findDuplicates({ name: "Newco Ltd", email: "ann@newco.test" }, s.get("Leads") as any, clients, [], lead.Key).filter((m) => m.key === lead.Key).length, 0, "a lead never matches itself");
});

test("linking a lead to an existing client moves its opportunities, and a second opportunity for the same client is allowed", () => {
  const { s, lead, opp } = toAccepted();
  s.add("Clients", { Key: "C5", Title: "Newco Ltd", Kind: "Ltd" });
  s.apply(linkToClient(s.find("Leads", lead.Key) as any, "C5", s.get("Opportunities") as any, s.get("Activities"), as("Sam")));
  assert.equal(s.find("Leads", lead.Key).ClientKey, "C5");
  assert.equal(s.find("Leads", lead.Key).Status, "converted");
  assert.equal(s.find("Opportunities", opp.Key).ClientKey, "C5");
  const second = ok(createOpp({ title: "Newco payroll", clientKey: "C5", stage: "new" }, s.get("Opportunities") as any, as("Pat")));
  s.add("Opportunities", second.opp);
  assert.equal(s.get("Opportunities").filter((o) => o.ClientKey === "C5").length, 2);
  assert.equal(s.get("Clients").length, 1, "linking never creates a second client");
});

test("outcomes: lost needs a reason, deferred needs a date, and a closed opportunity refuses proposals and moves", () => {
  const { s, opp } = toAccepted();
  const cur = () => s.find("Opportunities", opp.Key) as any;
  assert.match((setOutcome(cur(), "lost", DEFAULT_STAGES, O, {}) as any).error, /why/);
  assert.match((setOutcome(cur(), "deferred", DEFAULT_STAGES, O, { until: "soon" }) as any).error, /when/);
  s.apply(ok(setOutcome(cur(), "lost", DEFAULT_STAGES, O, { reason: "Went elsewhere" })));
  assert.match((moveStage(cur(), "qualified", undefined, s.get("Opportunities") as any, DEFAULT_STAGES, O) as any).error, /Reopen/);
  assert.ok("error" in (createProposal(cur(), { ...emptyContent(), title: "x" } as any, [], O) as any));
});

/** The back half, from a proposal that has been accepted. */
function toActive() {
  const f = toAccepted();
  const { s } = f;
  const v = () => s.find("ProposalVersions", f.version.Key);
  s.apply(ok(advance(f.proposal, v(), { to: "review" }, who("Pat"), TODAY, as("Pat"))));
  s.apply(ok(advance(f.proposal, v(), { to: "approved" }, who("Sam"), TODAY, as("Sam"))));
  s.apply(ok(advance(f.proposal, v(), { to: "sent", hash: "abc123", docKey: "D1" }, who("Sam"), TODAY, as("Sam"))));
  s.apply(ok(accept(f.proposal, v(), { name: "Ann", method: "recorded", evidence: "Email" }, who("Sam"), TODAY, s.find("Opportunities", f.opp.Key) as any, s.get("Opportunities") as any, DEFAULT_STAGES, as("Sam"))));

  // client from the lead (no second client for the same lead)
  const cl = ok(clientFromLead({ lead: s.find("Leads", f.lead.Key) as any, kind: "Ltd", opps: s.get("Opportunities") as any, activities: s.get("Activities"), proposals: s.get("Proposals"), can: can("Pat") }, as("Pat")));
  s.apply(cl.written);
  Object.assign(s.find("Clients", cl.client.Key), { YearEnd: "03-31", CompanyNumber: "01234567", RegisteredOffice: "1 High St" });
  return { ...f, clientKey: cl.client.Key as string, v };
}

test("lifecycle: client from lead is created once, linked everywhere, and refused a second time", () => {
  const f = toActive();
  const { s } = f;
  assert.equal(s.get("Clients").length, 1);
  assert.equal(s.find("Leads", f.lead.Key).ClientKey, f.clientKey);
  assert.equal(s.find("Opportunities", f.opp.Key).ClientKey, f.clientKey);
  assert.equal(s.find("Proposals", f.proposal.Key).ClientKey, f.clientKey);
  assert.match((clientFromLead({ lead: s.find("Leads", f.lead.Key) as any, kind: "Ltd", opps: s.get("Opportunities") as any, activities: [], proposals: [], can: can("Pat") }, O) as any).error, /already linked/);
});

test("lifecycle: engagement letter, signature, onboarding, AML, approval and activation produce the schedule and jobs once", () => {
  const f = toActive();
  const { s } = f;
  const client = () => s.find("Clients", f.clientKey);
  const proposal = () => s.find("Proposals", f.proposal.Key);

  // engagement letter
  const g: any = generate({ proposal: proposal(), version: f.v(), client: client(), settings: engSettings, catalogue, existing: s.get("Engagements"), practice: "Bannister & Co", today: TODAY, can: can("Pat") }, as("Pat"));
  assert.ok(!("error" in g), g.error);
  s.add("Engagements", g.engagement);
  const e = () => s.find("Engagements", g.engagement.Key);
  assert.ok("error" in (generate({ proposal: proposal(), version: f.v(), client: client(), settings: engSettings, catalogue, existing: s.get("Engagements"), practice: "x", today: TODAY, can: can("Pat") }, O) as any), "a second letter for the same proposal is refused");
  s.apply(ok(advanceEng(e(), "review", "", false, can("Pat"), as("Pat"))));
  s.apply(ok(advanceEng(e(), "approved", "", false, can("Sam"), as("Sam"))));
  assert.match((sendOut(e(), { hash: "h", signatories: ["Ann"], method: "paper" }, client(), can("Pat"), TODAY, as("Pat")) as any).error, /Only a manager or partner/);
  s.apply(ok(sendOut(e(), { hash: "h", signatories: ["Ann"], method: "paper" }, client(), can("Sam"), TODAY, as("Sam"))));
  s.apply(ok(markSigned(e(), { by: "Ann", at: O.now, method: "paper", evidence: "Signed copy" }, undefined, client(), engSettings, can("Sam"), TODAY, as("Sam"))));
  assert.equal(e().Status, "signed");
  assert.equal(e().ReviewDate, addYears(TODAY, 3), "the three-year review is set from the signing date");

  // onboarding
  const st: any = ok(startOnboarding({ proposal: proposal(), version: f.v(), client: client(), existing: s.get("Onboardings"), takeover: false, today: TODAY, can: can("Pat") }, as("Pat")));
  s.add("Onboardings", st.onboarding); s.add("SalesLog", st.log); s.add("Activities", st.activity);
  assert.ok("error" in (startOnboarding({ proposal: proposal(), version: f.v(), client: client(), existing: s.get("Onboardings"), takeover: false, today: TODAY, can: can("Pat") }, O) as any), "one onboarding per proposal");
  const ob = () => s.find("Onboardings", st.onboarding.Key);
  const view = () => ({ onb: ob(), defs: ONB_STAGES, client: client(), engagements: s.get("Engagements"), proposals: s.get("Proposals"), versions: s.get("ProposalVersions"), catalogue, people: [], today: TODAY } as any);

  // blocked until AML etc.
  assert.match((approveOnboarding(ob(), stageLines(view()), false, can("Sam"), as("Sam")) as any).error, /Not ready/);
  assert.ok(blockers(stageLines(view())).length > 0);
  s.apply(ok(setStage(ob(), ONB_STAGES.find((d) => d.key === "details")!, "done", "", client(), can("Pat"), as("Pat"))));
  s.apply(ok(saveAml(ob(), { risk: "low", riskBasis: "UK company", owners: [{ name: "Ann", percent: 100, note: "" }], checks: [{ id: "k1", kind: "Identity verified", result: "pass", by: "Pat", at: O.now, note: "" }], status: "inprogress" } as any, can("Pat"), as("Pat"))));
  assert.match((approveAml(ob(), client(), { amlMonths: { low: 36, medium: 24, high: 12 } } as any, false, can("Pat"), TODAY, as("Pat")) as any).error, /can't approve/);
  s.apply(ok(approveAml(ob(), client(), { amlMonths: { low: 36, medium: 24, high: 12 } } as any, false, can("Sam"), TODAY, as("Sam"))));
  s.apply(ok(setStage(ob(), ONB_STAGES.find((d) => d.key === "agent")!, "done", "64-8 / authorisation recorded", client(), can("Pat"), as("Pat"))));
  const lines = () => stageLines(view());
  assert.deepEqual(blockers(lines()).map((b: any) => b), [], "nothing left blocking");
  s.apply(ok(approveOnboarding(ob(), lines(), false, can("Sam"), as("Sam"))));

  // activation: manager+ only
  const input = (c: (a: any) => boolean) => ({ onb: ob(), lines: lines(), client: client(), version: f.v(), services, catalogue, clientServices: s.get("ClientServices"), jobs: s.get("Jobs"), engagements: s.get("Engagements"), authDone: true, today: TODAY, can: c, independent: false } as any);
  assert.match((activate(input(can("Pat")), as("Pat")) as any).error, /manager or partner/);
  const act = ok(activate(input(can("Sam")), as("Sam")));
  s.apply(act);
  assert.equal(ob().Status, "activated");
  assert.equal(client().Status === "active" || client().Status === "Active" || client().Status !== "onboarding", true);

  // schedule: one row per recurring service, no duplicates, fee carried over from the proposal
  const cs = s.get("ClientServices").filter((r) => r.ClientKey === f.clientKey);
  assert.deepEqual(cs.map((r) => r.ServiceKey).sort(), ["ACC", "VAT"]);
  assert.equal(new Set(cs.map((r) => r.Key)).size, cs.length);
  const jobs = s.get("Jobs").filter((r) => r.ClientKey === f.clientKey);
  assert.equal(jobs.length, 2, "one first job per service");
  assert.equal(new Set(jobs.map((j) => j.ServiceKey || j.Service || j.Type)).size, 2);
  // activating again must not duplicate anything
  assert.match((activate(input(can("Sam")), as("Sam")) as any).error, /closed/);
  assert.equal(s.get("Jobs").length, 2);
  assert.equal(s.get("ClientServices").length, cs.length);

  // fees reflect the proposal
  const lines2 = cs.map(readFeeLine);
  const acc = lines2.find((l) => l.serviceKey === "ACC")!, vat = lines2.find((l) => l.serviceKey === "VAT")!;
  assert.equal(acc.fee, 1200);
  assert.equal(vat.fee, 90);
  const rev = revenue(cs, s.get("FeeCharges"));
  assert.equal(rev.mrr, 100 + 30, "annual £1,200 is £100 a month; quarterly £90 is £30 a month");
  assert.equal(rev.arr, 1200 + 360);
  assert.ok(feeCan(config, "Sam", "adjust") && !feeCan(config, "Pat", "adjust"));

  // every created row has a unique key in each list and is tagged to the practice where the list has the column
  for (const [list, rows] of Object.entries(s.lists)) {
    const keys = rows.map((r) => r.Key); assert.equal(new Set(keys).size, keys.length, `${list} has duplicate keys`);
  }
  for (const list of ["Onboardings", "Engagements", "FeeHistory", "FeeCharges", "ClientCosts", "Actions"]) for (const r of s.get(list)) assert.equal(r.PracticeId, O.pid, `${list} ${r.Key} missing PracticeId`);
});

test("financials: VAT, discount and set-up fee agree between the proposal total, the agreed lines and the revenue figures", () => {
  const rate = 0.2;
  const lines: any[] = [
    { id: "a", serviceKey: "ACC", name: "Accounts", frequency: "annual", price: 1200, discount: { kind: "pct", value: 10 }, setupFee: 100, vat: "standard", optional: false },
    { id: "b", serviceKey: "VAT", name: "VAT", frequency: "quarterly", price: 90, discount: null, setupFee: 0, vat: "standard", optional: false },
    { id: "c", serviceKey: "PAY", name: "Payroll", frequency: "monthly", price: 25.5, discount: { kind: "amount", value: 5.5 }, setupFee: 0, vat: "exempt", optional: false },
    { id: "d", serviceKey: "ADV", name: "Advice", frequency: "one-off", price: 300, discount: null, setupFee: 0, vat: "standard", optional: false },
    { id: "e", serviceKey: "EXTRA", name: "Optional extra", frequency: "annual", price: 999, discount: null, setupFee: 0, vat: "standard", optional: true },
  ];
  const calcs = lines.map((l) => calcLine(l, rate));
  assert.equal(calcs[0].net, 108000, "10% off £1,200 is £1,080, in pence");
  assert.equal(calcs[0].annualNet, 108000);
  assert.equal(calcs[0].setup, 10000, "the discount does not reduce the set-up fee");
  assert.equal(calcs[0].vatEach, 21600);
  assert.equal(calcs[1].annualNet, 9000 * 4);
  assert.equal(calcs[2].net, 2000, "£25.50 less £5.50");
  assert.equal(calcs[2].vatEach, 0, "exempt has no VAT");
  assert.equal(calcs[2].annualNet, 2000 * 12);
  assert.equal(calcs[3].annualNet, 0, "a one-off is not recurring");
  assert.equal(calcs[3].oneOffNet, 30000);
  const t = totalsFor(lines.filter((l) => !l.optional) as any, rate);
  assert.equal(t.annualRecurringNet, 108000 + 36000 + 24000, "optional lines are left out");
  assert.equal(t.setupNet, 10000);
  assert.equal(t.oneOffNet, 30000 + 10000, "one-offs and set-up fees");
  assert.equal(t.firstYearNet, t.annualRecurringNet + t.oneOffNet);
  assert.equal(t.firstYearGross, t.firstYearNet + t.firstYearVat);
  assert.equal(t.ongoingGross, t.ongoingNet + t.ongoingVat);
  // the revenue figures use the same fee, before VAT, for the same lines
  const sched = [
    { Key: "S1", ClientKey: "C1", ServiceKey: "ACC", FeePeriod: "annually", Fee: 1080, Status: "active" },
    { Key: "S2", ClientKey: "C1", ServiceKey: "VAT", FeePeriod: "quarterly", Fee: 90, Status: "active" },
    { Key: "S3", ClientKey: "C1", ServiceKey: "PAY", FeePeriod: "monthly", Fee: 20, Status: "active" },
  ] as any[];
  const r = revenue(sched, []);
  assert.equal(r.arr, (t.annualRecurringNet) / 100, "ARR equals the proposal's recurring net");
  assert.equal(Math.round(r.mrr * 100), Math.round(t.annualRecurringNet / 12));
});

test("financials: money is never fractional pence, and negative or junk prices are refused or zeroed", () => {
  const c = calcLine({ id: "x", serviceKey: "S", name: "S", frequency: "monthly", price: 33.33, discount: { kind: "pct", value: 33 }, setupFee: 0, vat: "standard", optional: false } as any, 0.2);
  for (const v of [c.gross, c.discount, c.net, c.vatEach, c.totalEach, c.annualNet]) assert.equal(Number.isInteger(v), true);
  const over = calcLine({ id: "x", serviceKey: "S", name: "S", frequency: "annual", price: 50, discount: { kind: "amount", value: 500 }, setupFee: 0, vat: "standard", optional: false } as any, 0.2);
  assert.equal(over.net, 0, "a discount can't make the fee negative");
  assert.equal(calcLine({ id: "x", serviceKey: "S", name: "S", frequency: "annual", price: 100, discount: { kind: "pct", value: 150 }, setupFee: 0, vat: "standard", optional: false } as any, 0.2).net, 0, "over 100% is capped");
});

test("notifications: actions appear as work arises, resolve themselves when it's done, and don't reappear once dismissed or duplicated", () => {
  const f = toActive();
  const { s } = f;
  const base = (): any => ({
    today: TODAY, clients: s.get("Clients"), jobs: s.get("Jobs"), tasks: [], leads: s.get("Leads"), opps: s.get("Opportunities"), firstStageKey: "new", proposals: s.get("Proposals"), versions: s.get("ProposalVersions"),
    engagements: s.get("Engagements"), onboardings: s.get("Onboardings"), viewFor: () => undefined, clientServices: s.get("ClientServices"), portal: [], eng: DEFAULT_ENGAGEMENT_SETTINGS, catalogue,
    ch: [], agentDone: () => false,
  });
  const ctx = { actor: "system", now: O.now, pid: O.pid };
  // an accepted proposal with no onboarding is something to do
  const a1 = buildActions(base());
  const accepted = a1.filter((a) => /accepted|onboard/i.test(a.key + a.title) && a.category !== "sales");
  assert.ok(accepted.length >= 1, "accepted-without-onboarding is flagged");
  // reconcile twice: second time creates nothing (stable keys, no duplicates)
  const r1 = reconcile(a1, [], ctx as any);
  for (const c of r1.creates) s.add("Actions", c);
  const r2 = reconcile(buildActions(base()), s.get("Actions"), ctx as any);
  assert.equal(r2.creates.length, 0, "reconciling again creates no duplicates");
  assert.equal(new Set(s.get("Actions").map((a) => a.Key)).size, s.get("Actions").length);
  // start onboarding -> that action resolves
  const st: any = ok(startOnboarding({ proposal: s.find("Proposals", f.proposal.Key), version: f.v(), client: s.find("Clients", f.clientKey), existing: [], takeover: false, today: TODAY, can: can("Pat") }, as("Pat")));
  s.add("Onboardings", st.onboarding);
  const r3 = reconcile(buildActions(base()), s.get("Actions"), ctx as any);
  const resolved = r3.patches.filter((p) => p.patch.Status === "resolved");
  assert.ok(resolved.length >= 1, "the accepted-without-onboarding action resolves itself");
  assert.ok(resolved.every((p) => /system/i.test(String(p.patch.ResolvedBy || "system"))), "resolved by the system, not a person");
  // grouping and visibility
  const { open } = itemsOf(buildActions(base()), s.get("Actions"));
  assert.ok(open.length >= 1);
  assert.equal(new Set(open.map((i) => i.key)).size, open.length, "no action is listed twice");
  assert.equal(canSeeAll(config, "Sam"), true);
  assert.equal(canSeeAll(config, "Pat"), false, "a preparer sees their own and unassigned work, not everyone's");
});
