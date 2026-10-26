import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ONBOARDING_SETTINGS, DEFAULT_STAGES, EMPTY_AML, Check, View, activate, activationPlan, amlProblems, approveAml, approveOnboarding, blockers, cancelOnboarding, declineAml, detailsProblems, engagementState,
  firstJob, nextRef, onboardingAlerts, onboardingCan, releaseHeld, parseYearEnd, readAml, readOnboardingSettings, readStates, saveAml, setStage, stageLines, startOnboarding, withdrawAml, withdrawApproval,
} from "../src/lib/onboarding.ts";
import { readCatalogue } from "../src/lib/proposals.ts";
import { clientFromLead } from "../src/lib/onboarding.ts";

let n = 0;
const O = { actor: "Kevin", now: "2026-10-26T10:00:00.000Z", pid: "default", newKey: (p: string) => `${p}${++n}` };
const TODAY = "2026-10-26";
const yes = () => true;
const no = () => false;
const cfgOf = (staff: { name: string; role: string }[]): any => ({ staff, overriders: [], independentReview: false, auto: true });

const services: any[] = [
  { Key: "ACCS_LTD", Title: "Annual accounts", RepeatMonths: 12, DeadlineMode: "after", DeadlineMonths: 9, DeadlineDays: 0, KeepMonthEnd: true },
  { Key: "VAT", Title: "VAT returns", RepeatMonths: 3, DeadlineMode: "after", DeadlineMonths: 1, DeadlineDays: 7, KeepMonthEnd: true },
  { Key: "ADVICE", Title: "Advice" },
];
const catalogue = readCatalogue([
  { Key: "ACCS_LTD", Title: "Annual accounts", Offered: true, ClientTypes: "limited" },
  { Key: "VAT", Title: "VAT returns", Offered: true, ClientTypes: "limited", RequiresAuth: true },
  { Key: "ADVICE", Title: "Advice", Offered: true, ClientTypes: "limited" },
] as any);
const client = (o: any = {}): any => ({ Key: "C1", Title: "Acme Ltd", Kind: "Ltd", CompanyNumber: "01234567", RegisteredOffice: "1 High St", Email: "a@acme.test", ContactFirst: "Ann", YearEnd: "03-31", ...o });
const agreed = (keys = ["ACCS_LTD", "VAT"]) => JSON.stringify({ vatRate: 0.2, lines: keys.map((k, i) => ({ id: `l${i}`, serviceKey: k, name: k, frequency: k === "VAT" ? "quarterly" : k === "ADVICE" ? "one-off" : "annual", price: k === "VAT" ? 100 : 1200, discount: null, setupFee: 0, vat: "standard", optional: false })) });
const proposal: any = { Key: "PR1", Ref: "P-2026-0001", Status: "accepted", OppKey: "O1", LeadKey: "L1", ClientKey: "C1", AcceptedVersion: 1 };
const version = (o: any = {}): any => ({ Key: "PV1", ProposalKey: "PR1", Version: 1, Status: "accepted", Agreed: agreed(), AcceptedBy: "Ann", ...o });
const start = (o: any = {}) => startOnboarding({ proposal, version: version(), client: client(), existing: [], takeover: false, today: TODAY, can: yes, ...o }, O);
const onb = (o: any = {}): any => { const s: any = start(); if ("error" in s) throw new Error(s.error); return { ...s.onboarding, ...o }; };
const view = (b: any, o: Partial<View> = {}): View => ({ onb: b, defs: DEFAULT_STAGES, client: client(), engagements: [], proposals: [proposal], versions: [version()], catalogue, people: [], today: TODAY, ...o });
const eng = (o: any = {}): any => ({ Key: "E1", Ref: "E-2026-0001", ClientKey: "C1", ProposalKey: "PR1", Source: "generated", Status: "signed", ServiceKeys: JSON.stringify(["ACCS_LTD", "VAT"]), ...o });
const passId: Check = { id: "k1", kind: "Identity verified", result: "pass", by: "Sam", at: O.now, note: "" };
const goodAml = (b: any, o: any = {}) => ({ ...b, Aml: JSON.stringify({ ...EMPTY_AML, status: "inprogress", risk: "low", riskBasis: "UK company, simple structure", owners: [{ name: "Ann", percent: 100, note: "" }], checks: [passId], preparedBy: "Pat", ...o }) });
const line = (ls: any[], key: string) => ls.find((l) => l.def.key === key);

test("default stages are the ten in the brief, and settings can only add requirements", () => {
  assert.deepEqual(DEFAULT_STAGES.map((s) => s.key), ["proposal", "details", "aml", "engagement", "agent", "clearance", "portal", "info", "approval", "activation"]);
  const s = readOnboardingSettings([{ Key: "onboarding.settings", Value: JSON.stringify({ stages: [{ key: "approval", enabled: false, mandatory: false }, { key: "agent", mandatory: true }, { key: "info", enabled: false }], amlMonths: { low: 60, medium: 0, high: "x" } }) }]);
  assert.equal(s.stages.find((x) => x.key === "approval")!.enabled, true, "approval can't be switched off");
  assert.equal(s.stages.find((x) => x.key === "approval")!.mandatory, true);
  assert.equal(s.stages.find((x) => x.key === "agent")!.mandatory, true);
  assert.equal(s.stages.find((x) => x.key === "info")!.enabled, false);
  assert.deepEqual(s.amlMonths, { low: 60, medium: 24, high: 12 });
  assert.equal(readOnboardingSettings([{ Key: "onboarding.settings", Value: "junk" }]).amlMonths.low, 36);
});

test("onboarding starts only from an accepted proposal, once", () => {
  const ok: any = start();
  assert.equal(ok.onboarding.Ref, "O-2026-0001");
  assert.equal(ok.onboarding.Status, "active");
  assert.match((start({ proposal: { ...proposal, Status: "sent" } }) as any).error, /accepted/);
  assert.match((start({ version: version({ Agreed: "" }) }) as any).error, /what was agreed/);
  assert.match((start({ existing: [ok.onboarding] }) as any).error, /already been started/);
  assert.equal("error" in (start({ existing: [{ ...ok.onboarding, Status: "cancelled" }] }) as any), false, "a cancelled one doesn't block a new start");
  assert.match((start({ can: no }) as any).error, /can't start/);
  assert.equal(nextRef([ok.onboarding], 2026), "O-2026-0002");
});

test("client details problems are listed", () => {
  assert.deepEqual(detailsProblems(client()), []);
  const bad = detailsProblems({ Key: "x", Title: "", Kind: "Ltd" });
  assert.ok(bad.length >= 4);
  assert.ok(detailsProblems(client({ CompanyNumber: "" })).some((p) => /company number/.test(p)));
  assert.deepEqual(detailsProblems(client({ Kind: "Individual", CompanyNumber: "", ContactFirst: "" })), []);
});

test("takeover-only stages apply only to takeovers, and others are conditional by client type", () => {
  const b = onb();
  assert.equal(line(stageLines(view(b)), "clearance").applies, false);
  assert.equal(line(stageLines(view({ ...b, Takeover: "yes" })), "clearance").applies, true);
  const defs = DEFAULT_STAGES.map((d) => (d.key === "agent" ? { ...d, types: ["individual" as const] } : d));
  assert.equal(line(stageLines(view(b, { defs })), "agent").applies, false);
  assert.equal(line(stageLines(view(b, { defs })), "agent").status, "na");
});

test("engagement stage follows the letter: not prepared, draft, awaiting approval, sent, partially signed, signed, uploaded", () => {
  const st = (e: any) => engagementState("C1", "PR1", e ? [e] : []).state;
  assert.equal(st(null), "not-prepared");
  assert.equal(st(eng({ Status: "draft" })), "draft");
  assert.equal(st(eng({ Status: "review" })), "awaiting-approval");
  assert.equal(st(eng({ Status: "approved" })), "approved");
  assert.equal(st(eng({ Status: "out" })), "sent");
  assert.equal(st(eng({ Status: "out", SignProgress: "1 of 2 signed" })), "partial");
  assert.equal(st(eng({ Status: "signed" })), "signed");
  assert.equal(st(eng({ Status: "signed", Source: "uploaded", ProposalKey: "" })), "uploaded-signed");
  assert.equal(st(eng({ Status: "unsigned", Source: "uploaded", ProposalKey: "" })), "uploaded-unsigned");
  assert.equal(st(eng({ Status: "superseded" })), "not-prepared");
  const b = onb();
  assert.equal(line(stageLines(view(b, { engagements: [eng()] })), "engagement").status, "done");
  assert.equal(line(stageLines(view(b, { engagements: [eng({ ServiceKeys: JSON.stringify(["ACCS_LTD"]) })] })), "engagement").status, "doing", "signed but a service isn't covered");
  assert.equal(line(stageLines(view(b, { engagements: [eng({ Status: "unsigned", Source: "uploaded", ProposalKey: "" })] })), "engagement").status, "doing", "an unsigned letter doesn't complete it");
});

test("portal stage follows invitations", () => {
  const b = onb();
  assert.equal(line(stageLines(view(b)), "portal").status, "todo");
  assert.equal(line(stageLines(view(b, { people: [{ id: "u", name: "Ann", status: "invited" }] })), "portal").status, "doing");
  assert.equal(line(stageLines(view(b, { people: [{ id: "u", name: "Ann", status: "active" }] })), "portal").status, "done");
});

test("manual stages: confirm details needs a clean record; 'not needed' needs a reason, and authority for required ones", () => {
  const b = onb();
  const det = DEFAULT_STAGES.find((s) => s.key === "details")!;
  assert.match((setStage(b, det, "done", "", client({ Email: "", Mobile: "", Phone: "" }), yes, O) as any).error, /email/);
  const w: any = setStage(b, det, "done", "", client(), yes, O);
  assert.equal(readStates(w.patches[0].patch.Stages).details.status, "done");
  const info = DEFAULT_STAGES.find((s) => s.key === "info")!;
  assert.match((setStage(b, info, "na", " ", client(), yes, O) as any).error, /why/);
  assert.equal("error" in (setStage(b, info, "na", "Brand new company", client(), (a) => a === "edit", O) as any), false);
  assert.match((setStage(b, det, "na", "ok", client(), (a) => a === "edit", O) as any).error, /manager/, "details is required");
  assert.match((setStage(b, DEFAULT_STAGES.find((s) => s.key === "aml")!, "done", "", client(), yes, O) as any).error, /automatically/);
  assert.match((setStage({ ...b, Status: "activated" }, info, "done", "", client(), yes, O) as any).error, /closed/);
});

test("AML: documents alone don't complete it; a passed identity check, risk and (for companies) owners are needed", () => {
  const empty = readAml(onb().Aml);
  assert.ok(amlProblems(empty, "limited").length >= 4);
  assert.equal(line(stageLines(view(onb())), "aml").status, "todo");
  const saved: any = saveAml(onb(), { risk: "low", riskBasis: "Simple UK company", owners: [{ name: "Ann", percent: 100, note: "" }], checks: [{ id: "", kind: "Identity verified", result: "pass", by: "", at: "", note: "" }] }, yes, O);
  const a = JSON.parse(saved.patches[0].patch.Aml);
  assert.equal(a.status, "inprogress");
  assert.equal(a.checks[0].by, "Kevin");
  assert.ok(a.checks[0].id);
  assert.deepEqual(amlProblems(readAml(saved.patches[0].patch.Aml), "limited"), []);
  assert.ok(amlProblems({ ...a, owners: [], noOwnerNote: "" }, "limited").some((p: string) => /beneficial/.test(p)));
  assert.deepEqual(amlProblems({ ...a, owners: [] }, "individual"), []);
  assert.ok(amlProblems({ ...a, checks: [{ ...a.checks[0], kind: "Address verified" }] }, "limited").some((p: string) => /identity check/.test(p)));
  assert.ok(amlProblems({ ...a, checks: [...a.checks, { ...a.checks[0], result: "fail" }] }, "limited").some((p: string) => /failed/.test(p)));
  assert.ok(amlProblems({ ...a, risk: "high" }, "limited").some((p: string) => /High risk/.test(p)));
});

test("AML approval: reviewer, not the preparer (when independent), sets the client's review date by risk", () => {
  const b = goodAml(onb());
  const w: any = approveAml(b, client(), DEFAULT_ONBOARDING_SETTINGS, false, yes, TODAY, O);
  const a = JSON.parse(w.patches[0].patch.Aml);
  assert.deepEqual([a.status, a.approvedBy, a.reviewDate], ["approved", "Kevin", "2029-10-26"]);
  assert.equal(w.patches.find((p: any) => p.list === "Clients").patch.AMLReview, "2029-10-26");
  const high: any = approveAml(goodAml(onb(), { risk: "high", checks: [passId, { ...passId, id: "k2", kind: "Sanctions and PEP screening" }] }), client(), DEFAULT_ONBOARDING_SETTINGS, false, yes, TODAY, O);
  assert.equal(JSON.parse(high.patches[0].patch.Aml).reviewDate, "2027-10-26");
  assert.match((approveAml(goodAml(onb(), { preparedBy: "Kevin" }), client(), DEFAULT_ONBOARDING_SETTINGS, true, yes, TODAY, O) as any).error, /Someone else/);
  assert.match((approveAml(goodAml(onb()), client(), DEFAULT_ONBOARDING_SETTINGS, false, no, TODAY, O) as any).error, /can't approve/);
  assert.match((approveAml(onb(), client(), DEFAULT_ONBOARDING_SETTINGS, false, yes, TODAY, O) as any).error, /Record the AML work/);
  assert.match((approveAml(goodAml(onb(), { checks: [] }), client(), DEFAULT_ONBOARDING_SETTINGS, false, yes, TODAY, O) as any).error, /identity/);
});

test("an approved AML record is locked until the approval is withdrawn; declining and withdrawing need a reason", () => {
  const approved = { ...goodAml(onb()), Aml: JSON.stringify({ ...readAml(goodAml(onb()).Aml), status: "approved", approvedBy: "Sam", reviewDate: "2029-10-26" }) };
  assert.match((saveAml(approved, { risk: "high" }, yes, O) as any).error, /Withdraw/);
  assert.match((withdrawAml(approved, "", yes, O) as any).error, /why/);
  const w: any = withdrawAml(approved, "New information", yes, O);
  assert.equal(JSON.parse(w.patches[0].patch.Aml).status, "inprogress");
  assert.match((declineAml(goodAml(onb()), "", yes, O) as any).error, /why/);
  const d: any = declineAml(goodAml(onb()), "Source of funds unclear", yes, O);
  assert.equal(line(stageLines(view({ ...onb(), Aml: d.patches[0].patch.Aml })), "aml").status, "blocked");
});

const readyOnb = () => ({ ...goodAml(onb(), { status: "approved", approvedBy: "Sam", reviewDate: "2029-10-26" }), Stages: JSON.stringify({ details: { status: "done", by: "Kevin" } }) });
test("internal approval needs every mandatory stage, and a different person when independent", () => {
  const b = onb();
  assert.match((approveOnboarding(b, stageLines(view(b)), false, yes, O) as any).error, /Not ready/);
  const r: any = readyOnb();
  const lines = stageLines(view(r, { engagements: [eng()] }));
  assert.deepEqual(blockers(lines), []);
  assert.match((approveOnboarding({ ...r, CreatedBy: "Kevin" }, lines, true, yes, O) as any).error, /Someone else/);
  assert.match((approveOnboarding(r, lines, false, no, O) as any).error, /can't approve/);
  const ok: any = approveOnboarding(r, lines, false, yes, O);
  assert.equal(ok.patches[0].patch.ApprovedBy, "Kevin");
  assert.equal(line(stageLines(view({ ...r, ApprovedBy: "Kevin" }, { engagements: [eng()] })), "approval").status, "done");
  assert.match((withdrawApproval(r, yes, O) as any).error, /hasn't/);
  assert.equal((withdrawApproval({ ...r, ApprovedBy: "x" }, yes, O) as any).patches[0].patch.ApprovedBy, "");
});

test("first job dates come from the client's year end and the service's own rule", () => {
  const c = client();
  const a = firstJob("ACCS_LTD", services, c, "2026-10-26");
  assert.equal(a.PeriodEnd, "2027-03-31");
  assert.equal(a.Deadline, "2027-12-31", "nine months after the period end");
  assert.equal(firstJob("ACCS_LTD", services, c, "2026-02-01").PeriodEnd, "2026-03-31", "a year end later this year");
  assert.equal(firstJob("ACCS_LTD", services, client({ YearEnd: "" }), "2026-10-26").PeriodEnd, "2027-10-25");
  assert.match(firstJob("ACCS_LTD", services, client({ YearEnd: "" }), "2026-10-26").note, /year end/);
  const v = firstJob("VAT", services, c, "2026-10-26");
  assert.equal(v.PeriodEnd, "2026-12-31");
  assert.equal(v.Deadline, "2027-02-07");
  assert.equal(firstJob("ADVICE", services, c, "2026-10-26").PeriodEnd, "2026-10-26");
  assert.deepEqual([parseYearEnd("31 March"), parseYearEnd("March 31"), parseYearEnd("30/04"), parseYearEnd("nonsense"), parseYearEnd("03-31"), parseYearEnd("10-31"), parseYearEnd("13-01")], [{ m: 3, d: 31 }, { m: 3, d: 31 }, { m: 4, d: 30 }, undefined, { m: 3, d: 31 }, { m: 10, d: 31 }, undefined]);
});

const actInput = (o: any = {}) => {
  const r: any = { ...readyOnb(), ApprovedBy: "Sam", ApprovedOn: O.now };
  const v = view(r, { engagements: [eng()] });
  return { onb: r, lines: stageLines(v), client: client({ Status: "onboarding" }), version: version(), services, catalogue, clientServices: [], jobs: [], engagements: [eng()], authDone: false, today: TODAY, can: yes, independent: false, ...o };
};

test("activation is refused until approved, ready, and the person is authorised", () => {
  assert.match((activate(actInput({ onb: { ...actInput().onb, ApprovedBy: "" } }), O) as any).error, /approved first/);
  assert.match((activate(actInput({ can: no }), O) as any).error, /manager or partner/);
  const notReady = onb(); 
  assert.match((activate(actInput({ onb: { ...notReady, ApprovedBy: "Sam" }, lines: stageLines(view(notReady)) }), O) as any).error, /Not ready/);
  assert.match((activate(actInput({ onb: { ...actInput().onb, Status: "activated" } }), O) as any).error, /closed/);
});

test("activation: client made active, fees recorded, first jobs created, services needing authorisation held, history kept", () => {
  const w: any = activate(actInput(), O);
  const jobs = w.creates.filter((c: any) => c.list === "Jobs").map((c: any) => c.row);
  const cs = w.creates.filter((c: any) => c.list === "ClientServices").map((c: any) => c.row);
  assert.deepEqual(jobs.map((j: any) => j.ServiceKey), ["ACCS_LTD"], "VAT needs an authorisation, so no job");
  assert.equal(jobs[0].PeriodEnd, "2027-03-31");
  assert.equal(jobs[0].Source, "Onboarding");
  assert.deepEqual(cs.map((c: any) => [c.ServiceKey, c.Fee, c.AnnualFee]), [["ACCS_LTD", 1200, 1200], ["VAT", 100, 400]], "the held service has its agreed fee recorded");
  assert.deepEqual(cs.map((c: any) => c.Off), [false, true], "but the held service is switched off");
  const client_ = w.patches.find((p: any) => p.list === "Clients").patch;
  assert.deepEqual([client_.Status, client_.AnnualFees], ["active", 1600]);
  const ob = w.patches.find((p: any) => p.list === "Onboardings").patch;
  assert.equal(ob.Status, "activated");
  const sum = JSON.parse(ob.ActivationSummary);
  assert.deepEqual([sum.started, sum.held, sum.engagements], [["ACCS_LTD"], ["VAT"], ["E-2026-0001"]]);
  assert.ok(w.log.some((l: any) => l.Action === "activated"));
  assert.ok(w.activities.some((a: any) => a.Type === "client-activated"));
  assert.equal(w.patches.some((p: any) => p.list === "Leads" || p.list === "Opportunities"), false, "lead and opportunity history is left alone");
});

test("with the authorisation in place the held service starts; an existing open job is not duplicated; an existing client service is updated", () => {
  const w: any = activate(actInput({ authDone: true, jobs: [{ ClientKey: "C1", ServiceKey: "ACCS_LTD", Status: "Open" }], clientServices: [{ Key: "CS9", ClientKey: "C1", ServiceKey: "VAT", Off: true }] }), O);
  const jobs = w.creates.filter((c: any) => c.list === "Jobs").map((c: any) => c.row.ServiceKey);
  assert.deepEqual(jobs, ["VAT"]);
  const upd = w.patches.find((p: any) => p.list === "ClientServices");
  assert.deepEqual([upd.row.Key, upd.patch.Off, upd.patch.Fee], ["CS9", false, 100]);
  assert.equal(w.creates.filter((c: any) => c.list === "ClientServices").length, 1);
});

test("an already-active client keeps their existing annual fees figure; a service not in the planner has its fee recorded but no job", () => {
  const w: any = activate(actInput({ client: client({ Status: "active", AnnualFees: 5000 }), version: version({ Agreed: agreed(["ACCS_LTD", "UNKNOWN"]) }) }), O);
  assert.equal(w.patches.find((p: any) => p.list === "Clients").patch.AnnualFees, undefined);
  const plan = activationPlan({ agreed: JSON.parse(agreed(["UNKNOWN"])), catalogue, services, client: client(), jobs: [], start: TODAY, authDone: true });
  assert.equal(plan[0].action, "skip");
});

test("cancelling needs authority and a reason; permissions follow the roles", () => {
  assert.match((cancelOnboarding(onb(), "", yes, O) as any).error, /why/);
  assert.match((cancelOnboarding(onb(), "x", no, O) as any).error, /manager/);
  assert.equal((cancelOnboarding(onb(), "Client changed their mind", yes, O) as any).patches[0].patch.Status, "cancelled");
  const cfg = cfgOf([{ name: "Pat", role: "preparer" }, { name: "Sam", role: "manager" }]);
  assert.equal(onboardingCan(cfg, "Pat", "activate"), false);
  assert.equal(onboardingCan(cfg, "Sam", "activate"), true);
  assert.equal(onboardingCan(cfg, "Pat", "edit"), true);
  assert.equal(onboardingCan(cfg, "Pat", "approve"), false);
});

test("alerts: blocked AML, awaiting approval, ready to activate, long-open", () => {
  const clients = [client()];
  const al = (b: any, v: Partial<View> = {}) => onboardingAlerts([b], (o) => view(o, v), clients, TODAY);
  const declined = { ...onb(), Aml: JSON.stringify({ ...EMPTY_AML, status: "declined", declinedReason: "x" }) };
  assert.match(al(declined)[0].title, /blocked/);
  const r: any = readyOnb();
  assert.match(al(r, { engagements: [eng()] })[0].title, /awaiting approval/);
  assert.match(al({ ...r, ApprovedBy: "Sam" }, { engagements: [eng()] })[0].title, /Ready to activate/);
  assert.match(al({ ...onb(), Created: "2026-09-01T00:00:00Z" })[0].title, /open for/);
  assert.equal(al(onb()).length, 0);
  assert.equal(al({ ...onb(), Status: "activated" }).length, 0);
});

test("held services start once the authorisation is recorded", () => {
  const w: any = activate(actInput(), O);
  const act = { ...actInput().onb, Status: "activated", ActivationSummary: w.patches.find((p: any) => p.list === "Onboardings").patch.ActivationSummary };
  const csRow = w.creates.find((c: any) => c.list === "ClientServices" && c.row.ServiceKey === "VAT").row;
  const base = { onb: act, client: client({ Status: "active" }), version: version(), services, catalogue, clientServices: [csRow], jobs: [], authDone: true, today: TODAY, can: yes };
  const r: any = releaseHeld(base, O);
  assert.deepEqual(r.creates.map((c: any) => c.row.ServiceKey), ["VAT"]);
  assert.equal(r.patches.find((p: any) => p.list === "ClientServices").patch.Off, false);
  assert.deepEqual(JSON.parse(r.patches.find((p: any) => p.list === "Onboardings").patch.ActivationSummary).held, []);
  assert.match((releaseHeld({ ...base, authDone: false }, O) as any).error, /authorisation/);
  assert.match((releaseHeld({ ...base, onb: { ...act, Status: "active" } }, O) as any).error, /activated/);
  assert.match((releaseHeld({ ...base, can: no }, O) as any).error, /manager/);
});

test("a client made from a lead keeps the lead's history, is not active, and can't be made twice", () => {
  const lead: any = { Key: "L1", Title: "Acme Ltd", Email: "a@acme.test", Phone: "07000 000000", ContactName: "Ann Smith", Status: "open" };
  const opps: any[] = [{ Key: "O1", LeadKey: "L1", ClientKey: "" }];
  const acts: any[] = [{ Key: "A1", LeadKey: "L1", ClientKey: "" }];
  const props: any[] = [{ Key: "PR1", LeadKey: "L1", ClientKey: "" }, { Key: "PR2", LeadKey: "L9", ClientKey: "" }];
  const r: any = clientFromLead({ lead, kind: "Ltd", opps, activities: acts, proposals: props, can: yes }, O);
  assert.equal(r.client.Status, "onboarding");
  assert.equal(r.client.ContactFirst, "Ann"); assert.equal(r.client.ContactLast, "Smith");
  assert.equal(r.written.creates[0].list, "Clients");
  const lists = r.written.patches.map((p: any) => `${p.list}:${p.row.Key}`);
  assert.ok(lists.includes("Leads:L1") && lists.includes("Opportunities:O1") && lists.includes("Activities:A1") && lists.includes("Proposals:PR1"));
  assert.ok(!lists.includes("Proposals:PR2"));
  assert.ok(r.written.log.some((l: any) => l.Action === "client-created"));
  assert.ok("error" in (clientFromLead({ lead: { ...lead, ClientKey: "C1" }, kind: "Ltd", opps, activities: acts, proposals: props, can: yes }, O) as any));
  assert.ok("error" in (clientFromLead({ lead, kind: "Ltd", opps, activities: acts, proposals: props, can: no }, O) as any));
  assert.ok("error" in (clientFromLead({ lead, kind: "Nonsense", opps, activities: acts, proposals: props, can: yes }, O) as any));
});

test("the agent authorisation can still be recorded after activation, but no other stage can", () => {
  const b: any = onb({ Status: "activated" });
  const agent = DEFAULT_STAGES.find((d) => d.key === "agent")!;
  assert.ok(!("error" in (setStage(b, agent, "done", "", client(), yes, O) as any)));
  assert.ok("error" in (setStage(b, DEFAULT_STAGES.find((d) => d.key === "info")!, "done", "", client(), yes, O) as any));
});
