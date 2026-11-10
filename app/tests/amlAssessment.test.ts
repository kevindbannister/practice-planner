import { test } from "node:test";
import assert from "node:assert/strict";
import { approveAssessment, declineAssessment, position, readAssessment, saveAssessment, startAssessment, withdrawAssessment } from "../src/lib/amlAssessment.ts";
import { COMPANY } from "../src/lib/amlTemplates.ts";
import { evaluate, type Ans } from "../src/lib/amlTemplate.ts";
import { DEFAULT_ONBOARDING_SETTINGS } from "../src/lib/onboarding.ts";

/** Answers that satisfy the company template: every required question answered, every MUST rule met. */
const full = (): Ans => {
  const a: Ans = {};
  for (let i = 0; i < 12; i++) {
    const r = evaluate(COMPANY, a);
    for (const q of r.shown) if (a[q.k] === undefined || a[q.k] === "") a[q.k] = q.t === "risk" ? "Low" : q.t === "one" ? (q.options!.includes("No") ? "No" : q.options![0]) : q.t === "many" ? [q.options![0]] : q.t === "date" ? "2020-01-01" : "x";
    for (const f of r.findings.filter((x) => x.strict === "MUST")) a[f.question] = f.wants.op === "eq" ? f.wants.value : "Normal";
  }
  // A plain low-risk client: the reassuring answers are Yes, every section Low, no EDD.
  for (const k of ["c3", "c4", "c9", "c10", "c13", "c14", "c16", "c17", "c18", "c22"]) a[k] = "Yes";
  for (const k of ["c21", "c29", "c32", "c35", "c37"]) a[k] = "Low";
  a.c36 = ["Face to face with owner"]; a.c38 = "No";
  return a;
};
let n = 0;
const o = (actor = "Kevin") => ({ actor, now: "2026-10-27T10:00:00Z", pid: "P", newKey: (p: string) => `${p}${++n}` });
const yes = () => true;
const client = { Key: "C1", Title: "Bck Interior Ltd", Kind: "Ltd" } as any;
const apply = (rows: any[], w: any) => { for (const c of w.creates || []) rows.push(c.row); for (const p of w.patches) Object.assign(p.row, p.patch); return rows; };
const good = { ddLevel: "standard" as const, pep: { status: "no" as const, people: [] }, answers: full(), risk: "low" as const, riskBasis: "UK company, one director, simple structure", owners: [{ name: "A Smith", percent: 100, note: "" }], checks: [{ id: "", kind: "Identity verified", result: "pass" as const, by: "", at: "", note: "passport seen" }] };

test("a new assessment is started once, saved, and approved with a review date", () => {
  const rows: any[] = [];
  apply(rows, startAssessment(client, rows, o()) as any);
  assert.ok("error" in (startAssessment(client, rows, o()) as any));
  apply(rows, saveAssessment(rows[0], good, yes, o("Ann")) as any);
  const w = approveAssessment(rows[0], client, rows, DEFAULT_ONBOARDING_SETTINGS, true, yes, "2026-10-27", o("Bob")) as any;
  assert.equal(w.patches.find((p: any) => p.list === "Clients").patch.AMLReview, "2029-10-27");
  apply(rows, w);
  assert.equal(readAssessment(rows[0]).status, "approved");
  assert.equal(rows[0].DoneOn, "2026-10-27");
});

test("the person who prepared it can't approve it when independent review is on, and problems block approval", () => {
  const rows: any[] = [];
  apply(rows, startAssessment(client, rows, o()) as any);
  assert.match((approveAssessment(rows[0], client, rows, DEFAULT_ONBOARDING_SETTINGS, true, yes, "2026-10-27", o("Ann")) as any).error, /risk assessment/i);
  apply(rows, saveAssessment(rows[0], good, yes, o("Ann")) as any);
  assert.match((approveAssessment(rows[0], client, rows, DEFAULT_ONBOARDING_SETTINGS, true, yes, "2026-10-27", o("Ann")) as any).error, /Someone else/);
});

test("a review copies the last answers and supersedes the old approval", () => {
  const rows: any[] = [];
  apply(rows, startAssessment(client, rows, o()) as any);
  apply(rows, saveAssessment(rows[0], good, yes, o("Ann")) as any);
  apply(rows, approveAssessment(rows[0], client, rows, DEFAULT_ONBOARDING_SETTINGS, true, yes, "2026-10-27", o("Bob")) as any);
  apply(rows, startAssessment(client, rows, o()) as any);
  assert.equal(rows[1].Risk, "low");
  assert.equal(rows[1].Source, "review");
  apply(rows, saveAssessment(rows[1], { checks: good.checks, answers: good.answers }, yes, o("Ann")) as any);
  apply(rows, approveAssessment(rows[1], client, rows, DEFAULT_ONBOARDING_SETTINGS, true, yes, "2027-10-27", o("Bob")) as any);
  assert.equal(rows[0].Status, "superseded");
  assert.equal(rows[1].Status, "approved");
});

test("decline needs a reason, and withdrawing reopens and clears the client's review date", () => {
  const rows: any[] = [];
  apply(rows, startAssessment(client, rows, o()) as any);
  assert.ok("error" in (declineAssessment(rows[0], "", yes, o()) as any));
  apply(rows, declineAssessment(rows[0], "ID not clear", yes, o()) as any);
  assert.equal(position(client, rows, [], "2026-10-27").state, "declined");
  apply(rows, saveAssessment(rows[0], good, yes, o("Ann")) as any);
  apply(rows, approveAssessment(rows[0], client, rows, DEFAULT_ONBOARDING_SETTINGS, false, yes, "2026-10-27", o("Bob")) as any);
  const w = withdrawAssessment(rows[0], "mistake", client, yes, o()) as any;
  assert.equal(w.patches.find((p: any) => p.list === "Clients").patch.AMLReview, "");
});

test("position: current, due soon, overdue, onboarding approval, and a bare client review date", () => {
  const rows: any[] = [{ Key: "A1", ClientKey: "C1", Status: "approved", Risk: "low", ApprovedAt: "2025-01-01T00:00:00Z", DoneOn: "2025-01-01", ReviewDate: "2026-12-01", Checks: "[]", Evidence: "[]", Owners: "[]" }];
  assert.equal(position(client, rows, [], "2026-10-27").state, "soon");
  assert.equal(position(client, rows, [], "2026-01-01").state, "current");
  assert.equal(position(client, rows, [], "2027-02-01").state, "overdue");
  const onb = [{ ClientKey: "C1", Aml: JSON.stringify({ status: "approved", risk: "medium", approvedAt: "2026-06-01T00:00:00Z", reviewDate: "2028-06-01", checks: [], owners: [] }) }];
  const p = position(client, rows, onb as any, "2026-10-27");
  assert.equal(p.source, "onboarding"); assert.equal(p.state, "current");
  assert.equal(position({ ...client, AMLReview: "2026-01-01" }, [], [], "2026-10-27").state, "overdue");
  assert.equal(position({ Key: "C9" } as any, [], [], "2026-10-27").state, "none");
});

test("approval is blocked until the risk assessment questions are answered and the MUST rules are met", () => {
  const rows: any[] = [];
  apply(rows, startAssessment(client, rows, o()) as any);
  apply(rows, saveAssessment(rows[0], { ...good, answers: {} }, yes, o("Ann")) as any);
  assert.match((approveAssessment(rows[0], client, rows, DEFAULT_ONBOARDING_SETTINGS, true, yes, "2026-10-27", o("Bob")) as any).error, /Answer the risk assessment questions/);
  const ans: any = { ...full() };
  const pep = Object.keys(ans).find((k) => k && COMPANY.sections[0].questions.find((q) => q.k === k)?.label.startsWith("PEP screening"))!;
  ans[pep] = "Yes";
  ans[COMPANY.sections[0].questions.find((q) => q.label.startsWith("Overall client identity"))!.k] = "Low";
  apply(rows, saveAssessment(rows[0], { ...good, answers: ans }, yes, o("Ann")) as any);
  assert.match((approveAssessment(rows[0], client, rows, DEFAULT_ONBOARDING_SETTINGS, true, yes, "2026-10-27", o("Bob")) as any).error, /"Overall client identity risk\?" must be/);
});

test("an assessment can be discarded, stays in history, and doesn't change the client's position or block a new one", async () => {
  const { discardAssessment } = await import("../src/lib/amlAssessment.ts");
  const rows: any[] = [];
  const before = position(client, rows, [], "2026-10-27").state;
  apply(rows, startAssessment(client, rows, o()) as any);
  assert.ok("error" in (discardAssessment(rows[0], () => false, o()) as any));
  apply(rows, discardAssessment(rows[0], yes, o()) as any);
  assert.equal(rows[0].Status, "discarded");
  assert.equal(position(client, rows, [], "2026-10-27").state, before);
  assert.ok(!("error" in (startAssessment(client, rows, o()) as any)));
  apply(rows, startAssessment(client, rows, o()) as any);
  assert.ok("error" in (discardAssessment(rows[0], yes, o()) as any));
});

test("an assessment records why it is being done: defaults to new for a first one, periodic for later, and can be changed", async () => {
  const { REASONS } = await import("../src/lib/amlAssessment.ts");
  const rows: any[] = [];
  apply(rows, startAssessment(client, rows, o()) as any);
  assert.equal(rows[0].Reason, "new");
  assert.equal(readAssessment(rows[0]).reason, "new");
  apply(rows, saveAssessment(rows[0], { reason: "existing" }, yes, o()) as any);
  assert.equal(rows[0].Reason, "existing");
  apply(rows, saveAssessment(rows[0], { reason: "nonsense" }, yes, o()) as any);
  assert.equal(rows[0].Reason, "existing");
  const r2: any[] = [];
  apply(r2, startAssessment(client, r2, o(), "change") as any);
  assert.equal(r2[0].Reason, "change");
  assert.ok(REASONS.length >= 4);
});

test("a short review: all Yes moves the next review on and records it; any No opens a full assessment; needs an approved assessment", async () => {
  const { completeShortReview, readShortReviews } = await import("../src/lib/amlShortReview.ts");
  const settings = { amlMonths: { low: 36, medium: 24, high: 12 } } as any;
  const rows: any[] = [];
  const cl: any = { Key: "C1", Title: "X", Kind: "Ltd" };
  const inp = (a: boolean, extra = {}) => ({ date: "2026-10-27", answers: { behaved: a, valid: true, info: true, rating: true, dd: true }, notes: "", changes: false, ...extra });
  assert.ok("error" in (completeShortReview(cl, undefined, rows, inp(true), settings, false, yes, "2026-10-27", o()) as any));
  apply(rows, startAssessment(client, rows, o()) as any);
  apply(rows, saveAssessment(rows[0], good, yes, o("Ann")) as any);
  apply(rows, approveAssessment(rows[0], client, rows, { amlMonths: { low: 36, medium: 24, high: 12 } } as any, false, yes, "2026-10-01", o("Bea")) as any);
  const cur = rows[0];
  assert.equal(cur.Status, "approved");
  assert.ok("error" in (completeShortReview(client, cur, rows, { ...inp(true), answers: { behaved: true } }, settings, false, yes, "2026-10-27", o()) as any));
  assert.ok("error" in (completeShortReview(client, cur, rows, inp(true), settings, true, () => false, "2026-10-27", o()) as any));
  const w = completeShortReview(client, cur, rows, inp(true), settings, false, yes, "2026-10-27", o()) as any;
  assert.ok(!("error" in w));
  const risk = readAssessment(cur).risk;
  apply(rows, w);
  assert.equal(readShortReviews(cur).length, 1);
  assert.equal(readShortReviews(cur)[0].outcome, "complete");
  assert.ok(cur.ReviewDate > "2026-10-27");
  assert.equal(cur.Status, "approved");
  assert.ok(risk);
  const before = cur.ReviewDate;
  const w2 = completeShortReview(client, cur, rows, inp(false), settings, false, yes, "2026-10-28", o()) as any;
  assert.ok(!("error" in w2));
  apply(rows, w2);
  assert.equal(cur.ReviewDate, before);
  assert.equal(readShortReviews(cur)[1].outcome, "escalated");
  assert.equal(rows.filter((r) => r.Status === "inprogress").length, 1);
  assert.match(rows.find((r) => r.Status === "inprogress").Notes, /Short review on 2026-10-27 found: Has the client behaved/);
  assert.ok("error" in (completeShortReview(client, cur, rows, inp(true), settings, false, yes, "2026-10-28", o()) as any));
});

test("short review facts only report what the planner holds; delivery channels is a tick-box question where any non-face-to-face method raises the rating advice", async () => {
  const { shortFacts } = await import("../src/lib/amlShortReview.ts");
  const { COMPANY, INDIVIDUAL } = await import("../src/lib/amlTemplates.ts");
  const { evaluate } = await import("../src/lib/amlTemplate.ts");
  for (const [t, k, f2f] of [[INDIVIDUAL, "i19", "Face to face"], [COMPANY, "c36", "Face to face with owner"]] as const) {
    const q = t.sections.flatMap((s) => s.questions).find((x) => x.k === k)!;
    assert.equal(q.t, "many");
    const r = (v: string[]) => evaluate(t as any, { [k]: v }).findings.filter((x) => x.question === (k === "i19" ? "i20" : "c37")).length;
    assert.equal(r([f2f]), 0);
    assert.equal(r([f2f, q.options![1]]), 1);
    assert.equal(r([q.options![1]]), 1);
  }
  const rows: any[] = [];
  apply(rows, startAssessment(client, rows, o()) as any);
  const f = shortFacts({ client: { ...client }, cur: rows[0], seen: [], services: ["Accounts"], open: [], today: "2026-10-27", fmt: (d) => d });
  assert.ok(f.valid[0].includes("0 owners recorded"));
  assert.ok(f.behaved.some((l) => /No screening check/.test(l)));
  assert.deepEqual(f.changes, []);
  assert.ok(f.info.some((l) => /No Xama identity result/.test(l)));
});

test("Xama: the AML check suggests identity, PEP and sanctions; ID verification suggests identity only; Xama 'Approved' alone suggests nothing; owner questions only with one owner", async () => {
  const { hints } = await import("../src/lib/amlTemplate.ts");
  const { COMPANY, INDIVIDUAL } = await import("../src/lib/amlTemplates.ts");
  const base = { companyNumber: "", owners: 0, passedIdentity: false, passedScreening: false, xamaIdDone: false, xamaAmlDone: false, ownershipAgrees: null, services: [] };
  assert.deepEqual(Object.keys(hints(INDIVIDUAL as any, base)), []);
  const h = hints(INDIVIDUAL as any, { ...base, xamaAmlDone: true });
  assert.equal(h.i2.value, "Yes"); assert.equal(h.i3.value, "Yes"); assert.equal(h.i4.value, "No"); assert.equal(h.i5.value, "No");
  const idOnly = hints(INDIVIDUAL as any, { ...base, xamaIdDone: true });
  assert.ok(idOnly.i2 && idOnly.i3); assert.ok(!idOnly.i4 && !idOnly.i5);
  assert.deepEqual(Object.keys(hints(COMPANY as any, { ...base, xamaAmlDone: true, owners: 2 })).filter((k) => ["c17", "c18", "c19", "c20"].includes(k)), []);
  const one = hints(COMPANY as any, { ...base, xamaAmlDone: true, owners: 1 });
  for (const k of ["c17", "c18", "c19", "c20"]) { assert.ok(one[k], k); assert.match(one[k].from, /only if the main contact/); }
});

test("Xama's AML check is stamped with its date and result for the screening register", async () => {
  const { amlStamp, amlStampRead } = await import("../src/lib/xamaActions.ts");
  const p = (aml: any) => ({ id: null, aml }) as any;
  assert.equal(amlStamp(p(null), "2026-11-09"), "");
  assert.equal(amlStamp(p({ status: "ERROR" }), "2026-11-09"), "");
  assert.equal(amlStamp(p({ status: "READY", decision: "ACCEPT", pep: 0, sanctions: 0, at: "2026-11-02" }), "2026-11-09"), "done|2026-11-02|0|0");
  assert.equal(amlStamp(p({ status: "READY", decision: "ACCEPT", pep: 0, sanctions: 0, at: "" }), "2026-11-09"), "done|2026-11-09|0|0");
  assert.equal(amlStamp(p({ status: "READY", decision: "ACCEPT", pep: 0, sanctions: 0, at: "" }), "2026-11-20", "done|2026-11-09|0|0"), "done|2026-11-09|0|0");
  assert.equal(amlStamp(p({ status: "READY", decision: "ACCEPT", pep: 1, sanctions: 0, at: "2026-11-02" }), "2026-11-09"), "check|2026-11-02|1|0");
  assert.equal(amlStamp(p({ status: "RUNNING" }), "2026-11-09").split("|")[0], "waiting");
  assert.deepEqual(amlStampRead("check|2026-11-02|1|2"), { state: "check", on: "2026-11-02", pep: 1, sanctions: 2 });
  assert.equal(amlStampRead("").state, "");
});

test("the overall rating can't be below the highest section rating, EDD needed means High, and partnerships need owners", async () => {
  const { ratingProblems } = await import("../src/lib/amlTemplate.ts");
  const { COMPANY } = await import("../src/lib/amlTemplates.ts");
  const { amlProblems } = await import("../src/lib/onboarding.ts");
  assert.equal(ratingProblems(COMPANY as any, { c21: "Low", c29: "Normal" }, "medium").length, 0);
  assert.match(ratingProblems(COMPANY as any, { c21: "Low", c29: "High" }, "medium")[0], /can't be lower than the highest section rating \(High\)/);
  assert.match(ratingProblems(COMPANY as any, { c38: "Yes" }, "medium")[0], /has to be High/);
  assert.equal(ratingProblems(COMPANY as any, { c38: "Yes", c21: "High" }, "high").length, 0);
  const a: any = { risk: "low", riskBasis: "x", owners: [], noOwnerNote: "", checks: [{ kind: "Identity verified", result: "pass" }] };
  assert.ok(amlProblems(a, "partnership").some((p) => /partner with more than 25%/.test(p)));
  assert.ok(!amlProblems(a, "individual").some((p) => /beneficial owners/.test(p)));
});

test("PEPs: the section must be answered; a PEP needs a role, source of wealth and funds, and a High rating; EDD needs a source of funds check when the policy says so", async () => {
  const { pepProblems, eddProblems, pepUntil, readPep } = await import("../src/lib/amlPep.ts");
  assert.match(pepProblems({ status: "", people: [] }, "low")[0], /Say whether/);
  assert.deepEqual(pepProblems({ status: "no", people: [] }, "low"), []);
  const p = { status: "yes" as const, people: [{ name: "Ann Lee", kind: "pep" as const, role: "", where: "uk" as const, left: "", sow: "", sof: "" }] };
  const errs = pepProblems(p, "medium");
  assert.ok(errs.some((e) => /public role/.test(e)) && errs.some((e) => /source of wealth/.test(e)) && errs.some((e) => /source of funds/.test(e)) && errs.some((e) => /has to be High/.test(e)));
  assert.deepEqual(pepProblems({ status: "yes", people: [{ ...p.people[0], role: "MP", sow: "Salary and property", sof: "Salary" }] }, "high"), []);
  assert.equal(pepUntil("2026-03-31"), "2027-03-31");
  assert.equal(readPep("not json").status, "");
  assert.equal(readPep(JSON.stringify(p)).people[0].name, "Ann Lee");
  const id = [{ id: "", kind: "Identity verified", result: "pass" as const, by: "", at: "", note: "" }];
  assert.equal(eddProblems(false, id, true).length, 0);
  assert.equal(eddProblems(true, id, false).length, 0);
  assert.match(eddProblems(true, id, true)[0], /Source of funds or wealth/);
  assert.equal(eddProblems(true, [...id, { ...id[0], kind: "Source of funds or wealth" }], true).length, 0);
});

test("approval is blocked for a PEP until the PEP section and EDD are complete", async () => {
  const rows: any[] = [];
  apply(rows, startAssessment(client, rows, o()) as any);
  apply(rows, saveAssessment(rows[0], { ...good, risk: "high" as const, pep: { status: "yes", people: [{ name: "A Smith", kind: "pep", role: "", where: "uk", left: "", sow: "", sof: "" }] } }, yes, o("Ann")) as any);
  assert.match((approveAssessment(rows[0], client, rows, DEFAULT_ONBOARDING_SETTINGS, true, yes, "2026-10-27", o("Bob")) as any).error, /./);
  const { hints } = await import("../src/lib/amlTemplate.ts");
  const h = hints(COMPANY as any, { companyNumber: "", owners: 2, passedIdentity: false, passedScreening: false, xamaIdDone: false, xamaAmlDone: false, ownershipAgrees: null, services: [], pep: "yes" });
  assert.equal(h.c19.value, "Yes"); assert.match(h.c19.from, /PEP section/);
});

test("due diligence can't be completed: the client shows as stopped until a new assessment is approved; nothing about suspicion is asked", async () => {
  const { stopAssessment, STOP_REASONS } = await import("../src/lib/amlAssessment.ts");
  const cl: any = { Key: "S1", Title: "Stop Ltd", Kind: "Ltd" };
  const rows: any[] = [];
  apply(rows, startAssessment(cl, rows, o()) as any);
  assert.ok("error" in (stopAssessment(rows[0], cl, "made up", "", yes, o()) as any));
  const w = stopAssessment(rows[0], cl, STOP_REASONS[0], "asked twice", yes, o()) as any;
  assert.equal(w.activities.length, 1);
  apply(rows, w);
  assert.equal(rows[0].Status, "stopped");
  assert.equal(position(cl, rows, [], "2026-11-09").state, "stopped");
  assert.ok(!("error" in (startAssessment(cl, rows, o()) as any)));
  apply(rows, startAssessment(cl, rows, o()) as any);
  assert.equal(position(cl, rows, [], "2026-11-09").state, "inprogress");
});

test("due diligence level: required, Enhanced when EDD applies, Simplified only for low risk; suggested from the answers", async () => {
  const { ddProblems, suggestedDd } = await import("../src/lib/amlAssessment.ts");
  const none = { status: "no" as const, people: [] };
  assert.match(ddProblems("", "low", false, none)[0], /Record the level/);
  assert.match(ddProblems("standard", "high", false, none)[0], /must be Enhanced/);
  assert.match(ddProblems("standard", "low", true, none)[0], /must be Enhanced/);
  assert.match(ddProblems("simplified", "medium", false, none)[0], /only for clients rated low/);
  assert.deepEqual(ddProblems("simplified", "low", false, none), []);
  assert.equal(suggestedDd("low", false, none, true), "simplified");
  assert.equal(suggestedDd("low", false, none, false), "standard");
  assert.equal(suggestedDd("medium", false, { status: "yes", people: [] }, false), "enhanced");
});

test("an onboarding AML approval can be brought into the AML record once, and the position doesn't double count it", async () => {
  const { adoptOnboarding } = await import("../src/lib/amlAssessment.ts");
  const cl: any = { Key: "B1", Title: "Board Ltd", Kind: "Ltd" };
  const onb: any = { Key: "ON1", ClientKey: "B1", Aml: JSON.stringify({ status: "approved", risk: "medium", riskBasis: "x", owners: [], noOwnerNote: "", checks: [], preparedBy: "A", approvedBy: "B", approvedAt: "2026-01-05T10:00:00Z", reviewDate: "2028-01-05", declinedReason: "" }) };
  const rows: any[] = [];
  assert.equal(position(cl, rows, [onb], "2026-11-09").source, "onboarding");
  assert.ok("error" in (adoptOnboarding(cl, onb, rows, () => false, o()) as any));
  apply(rows, adoptOnboarding(cl, onb, rows, yes, o()) as any);
  assert.ok("error" in (adoptOnboarding(cl, onb, rows, yes, o()) as any));
  const p = position(cl, rows, [onb], "2026-11-09");
  assert.equal(p.source, "assessment"); assert.equal(p.current, rows[0]); assert.equal(p.reviewDate, "2028-01-05");
});

test("an unreported Companies House discrepancy blocks approval; a short review can't complete while screening is overdue; a stopped client's open jobs are flagged", async () => {
  const { ratingProblems } = await import("../src/lib/amlTemplate.ts");
  assert.match(ratingProblems(COMPANY as any, { c14: "No", c15: "No" }, "")[0], /reg 30A/);
  assert.deepEqual(ratingProblems(COMPANY as any, { c14: "No", c15: "Yes" }, ""), []);
  const { completeShortReview } = await import("../src/lib/amlShortReview.ts");
  const rows: any[] = [];
  apply(rows, startAssessment(client, rows, o()) as any);
  apply(rows, saveAssessment(rows[0], good, yes, o("Ann")) as any);
  apply(rows, approveAssessment(rows[0], client, rows, DEFAULT_ONBOARDING_SETTINGS, false, yes, "2026-10-01", o("Bea")) as any);
  const inp = { date: "2026-11-09", answers: { behaved: true, valid: true, info: true, rating: true, dd: true }, notes: "", changes: false, blockers: ["Re-screen first."] };
  assert.match((completeShortReview(client, rows[0], rows, inp, DEFAULT_ONBOARDING_SETTINGS, false, yes, "2026-11-09", o()) as any).error, /Re-screen first/);
  const esc = completeShortReview(client, rows[0], rows, { ...inp, answers: { ...inp.answers, behaved: false } }, DEFAULT_ONBOARDING_SETTINGS, false, yes, "2026-11-09", o()) as any;
  assert.ok(!("error" in esc), "a No still records the review and opens a full assessment");
  const { plannerChecks } = await import("../src/lib/plannerChecks.ts");
  const out = plannerChecks({ clients: [{ Key: "Z1", Title: "Z Ltd", AmlStopped: "2026-11-01" } as any], jobs: [{ Key: "J1", ClientKey: "Z1", Status: "Not started", ServiceKey: "OTHER" } as any], services: [], today: "2026-11-09" });
  assert.ok(out.some((p) => p.key === "Z1|aml-stopped" && p.severity === "red"));
});

test("approval with the screening rules on: blocked until screened, passes once screened", async () => {
  const { screeningPolicy } = await import("../src/lib/amlPolicy.ts");
  const sp = screeningPolicy([], { high: 12, medium: 24, low: 36 });
  const cl: any = { Key: "Q1", Title: "Q Ltd", Kind: "Ltd" };
  const rows: any[] = [];
  apply(rows, startAssessment(cl, rows, o()) as any);
  apply(rows, saveAssessment(rows[0], good, yes, o("Ann")) as any);
  const policy = { sof: true, screening: { sp, register: [] as any[] } };
  assert.match((approveAssessment(rows[0], cl, rows, DEFAULT_ONBOARDING_SETTINGS, false, yes, "2026-11-09", o("Bea"), policy) as any).error, /Screen the client/);
  cl.XamaAmlCheck = "done|2026-11-01|0|0";
  policy.screening.register = [{ values: { client: "Q1", on: "2026-11-02", role: "Client", result: "No match" } }];
  assert.ok(!("error" in (approveAssessment(rows[0], cl, rows, DEFAULT_ONBOARDING_SETTINGS, false, yes, "2026-11-09", o("Bea"), policy) as any)));
});

test("the server's approveAml runs the same rules as the screen (independent review, screening, template)", async () => {
  const { approveAml } = await import("../src/server/index.ts");
  const rows: any[] = [];
  const cl: any = { Key: "S9", Title: "Srv Ltd", Kind: "Ltd", XamaAmlCheck: "done|2026-11-01|0|0" };
  apply(rows, startAssessment(cl, rows, o()) as any);
  apply(rows, saveAssessment(rows[0], good, yes, o("Ann")) as any);
  const settings: any[] = [{ Key: "checklist-config", Value: JSON.stringify({ staff: [{ name: "Ann", role: "manager" }, { name: "Bea", role: "partner" }], independentReview: true }) }];
  const base = { key: rows[0].Key, assessments: rows, clients: [cl], settings, records: [] as any[], today: "2026-11-09", now: "2026-11-09T10:00:00Z" };
  assert.match((approveAml({ ...base, user: "Bea" }) as any).error, /company itself/);
  const records = [{ Key: "R1", Form: "screening", Data: JSON.stringify({ id: "R1", created: "2026-11-02", status: "Approved", values: { client: "S9", on: "2026-11-02", role: "Client", result: "No match" } }) }];
  assert.match((approveAml({ ...base, records, user: "Ann" }) as any).error, /someone else|prepared/i);
  const w = approveAml({ ...base, records, user: "Bea" }) as any;
  assert.ok(!("error" in w), w.error);
  assert.equal(w.patches.find((p: any) => p.list === "AmlAssessments").patch.ApprovedBy, "Bea");
});

test("a trust needs its settlor, trustees and beneficiaries recorded with their roles, and Trust Registration Service proof", async () => {
  const { trustProblems } = await import("../src/lib/amlAssessment");
  const chk = (note: string, result = "pass") => ({ id: "1", kind: "Trust Registration Service proof", result, at: "2026-11-01", by: "K", note }) as never;
  assert.deepEqual(trustProblems("Ltd", { owners: [], noOwnerNote: "", checks: [] }), []);
  const none = trustProblems("Trust", { owners: [], noOwnerNote: "", checks: [] });
  assert.equal(none.length, 2); assert.match(none[0], /settlor/); assert.match(none[1], /Trust Registration Service/);
  const noRole = trustProblems("Trust", { owners: [{ name: "Ann", note: "" }], noOwnerNote: "", checks: [chk("Proof of registration dated 1 Nov 2026")] });
  assert.match(noRole[0], /what each person is/); assert.match(noRole[1], /at least one trustee/);
  assert.match(trustProblems("Trust", { owners: [{ name: "Ann", note: "Trustee" }], noOwnerNote: "", checks: [chk("")] })[0], /note the proof/);
  assert.match(trustProblems("Trust", { owners: [{ name: "Ann", note: "Trustee" }], noOwnerNote: "", checks: [chk("x", "pending")] })[0], /Add a passed/);
  assert.deepEqual(trustProblems("Trust", { owners: [{ name: "Ann", note: "Trustee: UK resident" }, { name: "Bob", note: "Settlor" }, { name: "The grandchildren", note: "Class of beneficiaries" }], noOwnerNote: "", checks: [chk("Not registrable: bare trust excluded, see file note")] }), []);
});
