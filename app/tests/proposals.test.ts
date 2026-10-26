import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TEMPLATE, Line, Content, accept, advance, advanceOpp, calcLine, catalogueChanges, catalogueIssues, clientTypeFor, contentProblems, contentTotals, createProposal, customLine, editProblems, effectiveStatus,
  emptyContent, encodeContent, fill, gbp, hashText, lineFromService, nextRef, nextSteps, offeredFor, pence, priceFor, proposalCan, proposalDocument, readCatalogue, readContent, readService, readTemplate, reject, revise,
  saveDraft, serviceRow, totalsFor, untouched, reviewSummary,
} from "../src/lib/proposals.ts";
import { DEFAULT_STAGES } from "../src/lib/sales.ts";

let n = 0;
const O = { actor: "Kevin", now: "2026-10-26T10:00:00.000Z", pid: "default", newKey: (p: string) => `${p}${++n}` };
const TODAY = "2026-10-26";
const cfg = (staff: { name: string; role: string }[], independentReview = false): any => ({ staff, overriders: [], independentReview, auto: true });
const L = (o: Partial<Line> = {}): Line => ({ ...customLine(`l${++n}`), name: "Service", price: 100, frequency: "monthly", ...o });
const content = (lines: Line[], o: Partial<Content> = {}): Content => ({ ...emptyContent(), title: "Proposal for Acme", recipientName: "Ann", recipientEmail: "ann@acme.test", validUntil: "2026-11-30", lines, ...o });
const opp: any = { Key: "O1", Title: "Acme", LeadKey: "L1", Stage: "preparing", Outcome: "open", Order: 1000 };
const who = (can = true, independent = false) => ({ can: () => can, independent });
const svcRow = (o: Record<string, unknown> = {}) => ({ Key: "VAT", Title: "VAT returns", Offered: true, Price: 90, PriceFrequency: "quarterly", VatTreatment: "standard", ClientTypes: "limited,sole-trader", ...o });

test("pence rounding is exact for money", () => {
  assert.equal(pence(0.1 + 0.2), 30);
  assert.equal(pence(1.005), 101);
  assert.equal(pence(19.99), 1999);
  assert.equal(gbp(123456), "£1,234.56");
  assert.equal(gbp(-250), "-£2.50");
});

test("monthly line: annualised, with VAT per payment", () => {
  const c = calcLine(L({ price: 100, frequency: "monthly" }), 0.2);
  assert.deepEqual([c.net, c.vatEach, c.totalEach, c.annualNet, c.annualVat], [10000, 2000, 12000, 120000, 24000]);
});

test("quarterly, annual, one-off and fixed lines", () => {
  assert.equal(calcLine(L({ price: 250, frequency: "quarterly" }), 0.2).annualNet, 100000);
  assert.equal(calcLine(L({ price: 900, frequency: "annual" }), 0.2).annualNet, 90000);
  const one = calcLine(L({ price: 400, frequency: "one-off" }), 0.2);
  assert.deepEqual([one.annualNet, one.oneOffNet, one.oneOffVat], [0, 40000, 8000]);
  const fixed = calcLine(L({ price: 1500, frequency: "fixed" }), 0.2);
  assert.deepEqual([fixed.annualNet, fixed.oneOffNet], [0, 150000]);
});

test("VAT treatments: only standard rate charges VAT", () => {
  for (const vat of ["zero", "exempt", "outside"] as const) assert.equal(calcLine(L({ price: 100, vat }), 0.2).vatEach, 0);
  assert.equal(calcLine(L({ price: 100, vat: "standard" }), 0.2).vatEach, 2000);
  assert.equal(calcLine(L({ price: 99.99, vat: "standard", frequency: "annual" }), 0.2).vatEach, 2000, "round to the penny: 19.998 -> 20.00");
});

test("discounts: percentage and amount, capped, never on the set-up fee", () => {
  assert.equal(calcLine(L({ price: 200, discount: { kind: "pct", value: 10 } }), 0.2).net, 18000);
  assert.equal(calcLine(L({ price: 200, discount: { kind: "amount", value: 25 } }), 0.2).net, 17500);
  assert.equal(calcLine(L({ price: 200, discount: { kind: "amount", value: 999 } }), 0.2).net, 0, "can't go below nothing");
  assert.equal(calcLine(L({ price: 200, discount: { kind: "pct", value: 150 } }), 0.2).net, 0);
  const s = calcLine(L({ price: 200, setupFee: 100, frequency: "monthly", discount: { kind: "pct", value: 50 } }), 0.2);
  assert.deepEqual([s.net, s.setup], [10000, 10000]);
});

test("setup fee: one-off, VAT on it, counted in the first year only", () => {
  const t = totalsFor([L({ price: 100, frequency: "monthly", setupFee: 250 })], 0.2);
  assert.deepEqual([t.annualRecurringNet, t.oneOffNet, t.setupNet, t.firstYearNet, t.ongoingNet], [120000, 25000, 25000, 145000, 120000]);
  assert.equal(t.oneOffVat, 5000);
});

test("proposal totals mix frequencies and distinguish ex and inc VAT", () => {
  const t = totalsFor([
    L({ price: 100, frequency: "monthly" }), L({ price: 300, frequency: "quarterly" }), L({ price: 1000, frequency: "annual", vat: "exempt" }),
    L({ price: 500, frequency: "one-off" }), L({ price: 2000, frequency: "fixed", setupFee: 100 }),
  ], 0.2);
  assert.equal(t.annualRecurringNet, 120000 + 120000 + 100000);
  assert.equal(t.annualRecurringVat, 24000 + 24000);
  assert.equal(t.oneOffNet, 50000 + 200000 + 10000);
  assert.equal(t.oneOffVat, 10000 + 40000 + 2000);
  assert.equal(t.firstYearNet, 340000 + 260000);
  assert.equal(t.firstYearGross, t.firstYearNet + t.firstYearVat);
  assert.equal(t.ongoingGross, 340000 + 48000);
  assert.equal(t.monthlyRecurring, Math.round(340000 / 12));
  assert.deepEqual([t.byFrequency.monthly, t.byFrequency.quarterly, t.byFrequency.annual], [10000, 30000, 100000]);
});

test("totals of nothing are zero, and optional lines stay out of the totals", () => {
  assert.equal(totalsFor([], 0.2).firstYearGross, 0);
  const c = content([L({ price: 100, frequency: "monthly" }), L({ price: 999, frequency: "monthly", optional: true })]);
  assert.equal(contentTotals(c).annualRecurringNet, 120000);
});

test("the VAT rate is part of the proposal, so an accepted offer keeps its rate", () => {
  const c = content([L({ price: 100, frequency: "annual" })], { vatRate: 0.25 });
  assert.equal(contentTotals(c).firstYearVat, 2500);
});

test("catalogue: reading rows, defaults, and what is offered to which type of client", () => {
  const cat = readCatalogue([svcRow(), { Key: "CT600", Title: "Corporation tax" }, { Key: "TASK", Title: "Task", Offered: true }, svcRow({ Key: "OLD", Title: "Old", Active: false }), svcRow({ Key: "PAY", Title: "Payroll", ClientTypes: "" })] as any);
  assert.equal(cat.length, 4, "TASK is not a service");
  assert.equal(cat.find((s) => s.key === "CT600")!.offered, false);
  assert.deepEqual(offeredFor(cat, "limited").map((s) => s.key).sort(), ["PAY", "VAT"]);
  assert.deepEqual(offeredFor(cat, "individual").map((s) => s.key), ["PAY"], "no type restriction means every type");
});

test("catalogue: per-type pricing overrides the default; bad values are ignored", () => {
  const s = readService(svcRow({ Pricing: JSON.stringify({ "sole-trader": { price: 60, frequency: "monthly" }, limited: { price: -5, frequency: "weekly" } }) }) as any);
  assert.deepEqual(priceFor(s, "sole-trader"), { price: 60, frequency: "monthly" });
  assert.deepEqual(priceFor(s, "limited"), { price: 90, frequency: "quarterly" });
  assert.deepEqual(readService(svcRow({ Pricing: "garbage", Price: "abc", PriceFrequency: "weekly", VatTreatment: "odd", SetupFee: -3 }) as any).price, 0);
  const bad = readService(svcRow({ Price: -4, PriceFrequency: "weekly", VatTreatment: "odd", SetupFee: -3 }) as any);
  assert.deepEqual([bad.price, bad.frequency, bad.vat, bad.setupFee], [0, "annual", "standard", 0]);
});

test("catalogue: checks, row round trip, and a history line for every price change", () => {
  assert.equal(catalogueIssues({ name: " ", price: -1, setupFee: -2 }).length, 3);
  assert.deepEqual(catalogueIssues({ name: "VAT", price: 10, frequency: "monthly", vat: "zero" }), []);
  const a = readService(svcRow() as any);
  assert.deepEqual(readService({ Key: "VAT", Title: "VAT returns", ...serviceRow(a) } as any), a);
  const b = { ...a, price: 110, offered: false };
  const log = catalogueChanges(a, b, O);
  assert.deepEqual(log.map((l) => l.Action), ["service-price", "service-offered"]);
  assert.deepEqual(JSON.parse(String(log[0].Detail)), { name: "VAT returns", from: 90, to: 110 });
  assert.equal(catalogueChanges(a, a, O).length, 0);
});

test("a line from the catalogue brings its wording and price, and editing it leaves the catalogue alone", () => {
  const s = readService(svcRow({ ClientDescription: "We file your VAT.", Description: "internal", Scope: "Quarterly returns", SetupFee: 50 }) as any);
  const l = lineFromService(s, "limited", "x1");
  assert.deepEqual([l.name, l.description, l.scope, l.price, l.frequency, l.setupFee, l.catalogPrice], ["VAT returns", "We file your VAT.", "Quarterly returns", 90, "quarterly", 50, 90]);
  l.price = 70;
  assert.equal(s.price, 90);
});

test("client type is suggested from the client record", () => {
  assert.deepEqual(["Ltd", "LLP", "Partnership", "Individual", undefined].map(clientTypeFor), ["limited", "llp", "partnership", "individual", "individual"]);
});

test("permissions by role, with the same rules as the rest of the app when no staff are listed", () => {
  const c = cfg([{ name: "Pat", role: "preparer" }, { name: "Rev", role: "reviewer" }, { name: "Kate", role: "manager" }, { name: "Paul", role: "partner" }, { name: "Out", role: "outsourced" }]);
  const acts = ["view", "edit", "override-price", "discount", "discount-any", "approve", "send", "record-acceptance", "configure"] as const;
  const row = (u: string) => acts.map((a) => proposalCan(c, u, a));
  assert.deepEqual(row("Pat"), [true, true, false, false, false, false, false, false, false]);
  assert.deepEqual(row("Rev"), [true, false, false, false, false, true, false, false, false]);
  assert.deepEqual(row("Kate"), [true, true, true, true, false, true, true, true, true]);
  assert.deepEqual(row("Paul"), [true, true, true, true, true, true, true, true, true]);
  assert.deepEqual(row("Out"), acts.map(() => false));
  assert.deepEqual(row("Stranger"), [true, false, false, false, false, false, false, false, false]);
  assert.ok(acts.every((a) => proposalCan(cfg([]), "Anyone", a)));
});

test("price overrides and discounts are checked against who is editing", () => {
  const pat = (a: any) => a === "edit";
  const kate = (a: any) => a !== "discount-any";
  const paul = () => true;
  const base = content([L({ id: "a", name: "VAT", price: 90, catalogPrice: 90 })]);
  const cheaper = content([L({ id: "a", name: "VAT", price: 70, catalogPrice: 90 })]);
  assert.equal(editProblems(base, base, pat).length, 0, "untouched prices are fine for anyone");
  assert.match(editProblems(base, cheaper, pat)[0], /can't change the catalogue price/);
  assert.equal(editProblems(base, cheaper, kate).length, 0);
  const disc = (v: number) => content([L({ id: "a", name: "VAT", price: 90, catalogPrice: 90, discount: { kind: "pct", value: v } })]);
  assert.match(editProblems(base, disc(5), pat)[0], /can't give a discount/);
  assert.equal(editProblems(base, disc(10), kate).length, 0);
  assert.match(editProblems(base, disc(15), kate)[0], /need a partner/);
  assert.equal(editProblems(base, disc(15), paul).length, 0);
  assert.match(editProblems(base, content([L({ id: "a", name: "VAT", price: 90, catalogPrice: 90, discount: { kind: "amount", value: 20 } })]), kate)[0], /need a partner/, "£20 off £90 is over 10%");
  assert.equal(editProblems(disc(15), disc(15), pat).length, 0, "someone who didn't add it isn't blamed for an existing discount");
});

test("content checks, and the extra ones before sending", () => {
  assert.equal(contentProblems(content([L()]), TODAY).length, 0);
  assert.ok(contentProblems(content([L({ name: "" })]), TODAY).some((p) => /name/.test(p)));
  assert.ok(contentProblems(content([L()], { title: "" }), TODAY)[0].includes("title"));
  assert.ok(contentProblems(content([L({ discount: { kind: "pct", value: 120 } })]), TODAY).some((p) => /100%/.test(p)));
  assert.ok(contentProblems(content([L({ price: 50, discount: { kind: "amount", value: 80 } })]), TODAY).some((p) => /more than the fee/.test(p)));
  const send = (c: Content) => contentProblems(c, TODAY, true);
  assert.equal(send(content([L()])).length, 0);
  assert.ok(send(content([])).some((p) => /at least one/.test(p)));
  assert.ok(send(content([L({ optional: true })])).some((p) => /at least one/.test(p)));
  assert.ok(send(content([L()], { validUntil: "" })).some((p) => /valid/.test(p)));
  assert.ok(send(content([L()], { validUntil: "2026-10-01" })).some((p) => /passed/.test(p)));
  assert.ok(send(content([L()], { recipientEmail: "nope" })).some((p) => /email/.test(p)));
  assert.ok(send(content([L()], { recipientName: " " })).some((p) => /who/.test(p)));
});

test("reading a stored body is forgiving, and the same content always encodes the same way", () => {
  assert.deepEqual(readContent("not json"), emptyContent());
  assert.deepEqual(readContent(null), emptyContent());
  const c = readContent(JSON.stringify({ title: "T", vatRate: 5, lines: [null, { name: "A", price: -3, frequency: "weekly", vat: "x" }] }));
  assert.equal(c.vatRate, 0.2, "an impossible VAT rate is replaced");
  assert.equal(c.lines.length, 1);
  assert.deepEqual([c.lines[0].price, c.lines[0].frequency, c.lines[0].vat], [0, "annual", "standard"]);
  const a = content([L({ id: "x", name: "A" })]);
  const reordered = JSON.parse(JSON.stringify(a));
  assert.equal(encodeContent(readContent(reordered)), encodeContent(a));
});

test("numbering: P-2026-0001, counted per year", () => {
  assert.equal(nextRef([], 2026), "P-2026-0001");
  assert.equal(nextRef([{ Ref: "P-2026-0007" }, { Ref: "P-2025-0099" }, { Ref: "junk" }] as any, 2026), "P-2026-0008");
  assert.equal(nextRef([{ Ref: "P-2026-0007" }] as any, 2027), "P-2027-0001");
});

function started(c = content([L({ price: 100 })])) {
  const r: any = createProposal(opp, c, [], O);
  return { p: r.proposal, v: r.version, r };
}

test("starting a proposal makes version 1 as a draft, with a log line and a timeline event", () => {
  const { p, v, r } = started();
  assert.deepEqual([p.Status, v.Status, v.Version, p.CurrentVersion, p.Ref, p.PracticeId, v.PracticeId], ["draft", "draft", 1, 1, "P-2026-0001", "default", "default"]);
  assert.equal(p.OppKey, "O1");
  assert.equal(p.LeadKey, "L1");
  assert.equal(r.activity.Type, "proposal-created");
  assert.equal(r.activity.OppKey, "O1");
  assert.equal(r.log.Action, "created");
  assert.equal(v.FirstYearGross, 1440);
  assert.ok("error" in (createProposal(opp, content([], { title: " " }), [], O) as any));
  assert.ok("error" in (createProposal({ ...opp, Outcome: "lost" }, content([]), [], O) as any), "no proposals on a closed opportunity");
});

test("editing: drafts can be saved, anything else is frozen, and a giant proposal is refused", () => {
  const { p, v } = started();
  const w: any = saveDraft(p, v, content([L({ price: 200 })], { title: "New title" }), O);
  assert.equal(w.patches[0].patch.FirstYearNet, 2400);
  assert.equal(w.patches[1].patch.Title, "New title");
  assert.match((saveDraft(p, { ...v, Status: "review" }, content([]), O) as any).error, /Return it to draft/);
  for (const s of ["approved", "sent", "accepted", "superseded"]) assert.match((saveDraft(p, { ...v, Status: s }, content([]), O) as any).error, /Make a revision/);
  const huge = content([L({ description: "x".repeat(70000) })]);
  assert.match((saveDraft(p, v, huge, O) as any).error, /too long/);
});

test("workflow: draft to review to approved to sent, with who may do each step", () => {
  const { p, v } = started();
  assert.deepEqual(nextSteps("draft"), ["review", "approved"]);
  const review: any = advance(p, v, { to: "review" }, who(), TODAY, O);
  assert.equal(review.patches[0].patch.Status, "review");
  const v2 = { ...v, Status: "review" };
  assert.match((advance(p, v2, { to: "sent", hash: "h" }, who(), TODAY, O) as any).error, /can't go to sent/);
  assert.match((advance(p, v2, { to: "approved" }, who(false), TODAY, O) as any).error, /can't approve/);
  const ok: any = advance(p, v2, { to: "approved" }, who(), TODAY, O);
  assert.equal(ok.patches[0].patch.ApprovedBy, "Kevin");
  const v3 = { ...v, Status: "approved" };
  assert.match((advance(p, v3, { to: "sent", hash: "h" }, who(false), TODAY, O) as any).error, /Only a manager or partner/);
  const sent: any = advance(p, v3, { to: "sent", hash: "abc", docKey: "D1" }, who(), TODAY, O);
  assert.deepEqual([sent.patches[0].patch.Status, sent.patches[0].patch.Hash, sent.patches[0].patch.DocKey, sent.patches[0].patch.SentTo], ["sent", "abc", "D1", "ann@acme.test"]);
  assert.equal(sent.activities[0].Type, "proposal-sent");
  assert.equal(sent.patches[1].patch.Status, "sent");
  assert.match((advance(p, v3, { to: "sent" }, who(), TODAY, O) as any).error, /sealed/);
});

test("workflow: a proposal with problems can't be sent, and approval can be withdrawn or returned", () => {
  const bad = started(content([], {}));
  assert.match((advance(bad.p, { ...bad.v, Status: "approved" }, { to: "sent", hash: "h" }, who(), TODAY, O) as any).error, /at least one/);
  const { p, v } = started();
  const late: any = advance(p, { ...v, Status: "approved", Body: encodeContent(content([L()], { validUntil: "2026-01-01" })) }, { to: "sent", hash: "h" }, who(), TODAY, O);
  assert.match(late.error, /passed/);
  const back: any = advance(p, { ...v, Status: "review" }, { to: "draft", note: "Fix the price" }, who(), TODAY, O);
  assert.equal(back.patches[0].patch.ReturnNote, "Fix the price");
  const wd: any = advance(p, { ...v, Status: "approved" }, { to: "draft" }, who(), TODAY, O);
  assert.equal(wd.patches[0].patch.ApprovedBy, "");
  assert.equal(wd.log[0].Action, "withdrawn");
});

test("independent review: you can't approve what you prepared", () => {
  const { p, v } = started();
  const mine = { ...v, Status: "review", CreatedBy: "Kevin" };
  assert.match((advance(p, mine, { to: "approved" }, who(true, true), TODAY, O) as any).error, /Someone else/);
  assert.ok(!("error" in (advance(p, { ...mine, CreatedBy: "Kate" }, { to: "approved" }, who(true, true), TODAY, O) as any)));
  assert.ok(!("error" in (advance(p, mine, { to: "approved" }, who(true, false), TODAY, O) as any)), "only when the practice has turned it on");
});

test("revising: copies the content into a new draft, keeps the old version, supersedes it once it had gone out", () => {
  const { p, v } = started();
  const sentV = { ...v, Status: "sent", Version: 1 };
  const w: any = revise(p, sentV, [sentV], O, () => true);
  assert.equal(w.creates[0].list, "ProposalVersions");
  assert.deepEqual([w.creates[0].row.Version, w.creates[0].row.Status, w.creates[0].row.Body === v.Body], [2, "draft", true]);
  assert.equal(w.creates[0].row.ValidUntil, "", "a revision needs a new validity date");
  assert.equal(w.patches.find((x: any) => x.list === "ProposalVersions").patch.Status, "superseded");
  assert.deepEqual([w.patches.find((x: any) => x.list === "Proposals").patch.CurrentVersion, w.patches.find((x: any) => x.list === "Proposals").patch.Status], [2, "draft"]);
  assert.equal(w.activities[0].Type, "proposal-revised");
  assert.match((revise(p, sentV, [sentV, { ...v, Version: 2, ProposalKey: p.Key, Status: "draft" }], O, () => true) as any).error, /already a draft/);
  assert.match((revise(p, { ...v, Status: "accepted" }, [], O, () => true) as any).error, /accepted proposal can't be revised/);
  assert.match((revise(p, { ...v, Status: "superseded" }, [], O, () => true) as any).error, /already been replaced/);
  assert.match((revise(p, sentV, [sentV], O, (a) => a !== "edit") as any).error, /can't change/);
  assert.match((revise(p, v, [v], O, () => true) as any).error, /still a draft/);
  const third: any = revise(p, { ...sentV, Version: 2, Status: "rejected" }, [sentV, { ...sentV, Version: 2, Status: "rejected" }], O, () => true);
  assert.equal(third.creates[0].row.Version, 3);
});

test("expiry: a sent proposal past its date is expired and can't be accepted", () => {
  assert.equal(effectiveStatus({ Status: "sent", ValidUntil: "2026-10-25" }, TODAY), "expired");
  assert.equal(effectiveStatus({ Status: "sent", ValidUntil: "2026-10-26" }, TODAY), "sent", "valid through its last day");
  assert.equal(effectiveStatus({ Status: "accepted", ValidUntil: "2020-01-01" }, TODAY), "accepted");
  assert.equal(effectiveStatus({ Status: "weird" }, TODAY), "draft");
  const { p, v } = started();
  const old = { ...v, Status: "sent", ValidUntil: "2026-10-01" };
  assert.match((accept(p, old, { name: "Ann", method: "recorded", evidence: "email" }, who(), TODAY, opp, [opp], DEFAULT_STAGES, O) as any).error, /expired/);
});

test("acceptance records who, when, how, what they agreed, and moves the opportunity to won", () => {
  const { p, v } = started(content([L({ id: "m", name: "Bookkeeping", price: 100, frequency: "monthly" }), L({ id: "opt", name: "Payroll", price: 50, frequency: "monthly", optional: true })]));
  const sentV = { ...v, Status: "sent", Hash: "h" };
  const w: any = accept(p, sentV, { name: "Ann Smith", email: "ann@acme.test", method: "recorded", evidence: "Email 25 Oct", optional: ["opt"], when: "2026-10-25T09:00:00Z" }, who(), TODAY, opp, [opp], DEFAULT_STAGES, O);
  const vp = w.patches.find((x: any) => x.list === "ProposalVersions").patch;
  assert.deepEqual([vp.Status, vp.AcceptedBy, vp.AcceptedAt, vp.AcceptMethod, vp.AcceptEvidence], ["accepted", "Ann Smith", "2025-10-25T09:00:00Z".replace("2025", "2026"), "recorded", "Email 25 Oct"]);
  const agreed = JSON.parse(vp.Agreed);
  assert.deepEqual(agreed.lines.map((l: any) => l.name), ["Bookkeeping", "Payroll"], "the chosen optional service is part of the agreement");
  assert.equal(agreed.totals.annualRecurringNet, 1800);
  assert.equal(w.patches.find((x: any) => x.list === "Proposals").patch.AcceptedVersion, 1);
  const o = w.patches.find((x: any) => x.list === "Opportunities").patch;
  assert.deepEqual([o.Stage, o.Outcome], ["accepted", "won"]);
  assert.equal(o.Value, 1800, "the opportunity takes the agreed annual value");
  assert.deepEqual(w.activities.map((a: any) => a.Type), ["proposal-accepted", "opp-won"]);
  const none: any = accept(p, sentV, { name: "Ann", method: "recorded", evidence: "x" }, who(), TODAY, opp, [opp], DEFAULT_STAGES, O);
  assert.equal(JSON.parse(none.patches[0].patch.Agreed).lines.length, 1, "optional services not chosen are left out");
});

test("acceptance edge cases", () => {
  const { p, v } = started();
  const sentV = { ...v, Status: "sent" };
  const a = { name: "Ann", method: "recorded" as const, evidence: "call" };
  const go = (ver: any, x: any = a, w: any = who()) => accept(p, ver, x, w, TODAY, opp, [opp], DEFAULT_STAGES, O) as any;
  assert.match(go({ ...v, Status: "draft" }).error, /has been sent/);
  assert.match(go({ ...v, Status: "accepted" }).error, /already been accepted/);
  assert.match(go({ ...v, Status: "superseded" }).error, /has been sent/);
  assert.match(go(sentV, { ...a, name: " " }).error, /who accepted/);
  assert.match(go(sentV, { ...a, evidence: "" }).error, /how you know/);
  assert.match(go(sentV, a, who(false)).error, /Only a manager/);
  assert.ok(!go(sentV, { name: "Ann", method: "link", evidence: "" }, who(false)).error, "an acceptance made through a secure link needs no staff permission");
  const noOpp: any = accept(p, sentV, a, who(), TODAY, undefined, [], DEFAULT_STAGES, O);
  assert.equal(noOpp.patches.length, 2, "without an opportunity only the proposal records change");
});

test("accepting does not touch onboarding, AML or engagement: only the proposal and the opportunity change", () => {
  const { p, v } = started();
  const w: any = accept(p, { ...v, Status: "sent" }, { name: "Ann", method: "recorded", evidence: "email" }, who(), TODAY, opp, [opp], DEFAULT_STAGES, O);
  assert.deepEqual([...new Set(w.patches.map((x: any) => x.list))].sort(), ["Opportunities", "ProposalVersions", "Proposals"]);
});

test("rejecting needs a reason and a sent (or expired) proposal; the opportunity stays open", () => {
  const { p, v } = started();
  const sentV = { ...v, Status: "sent" };
  assert.match((reject(p, sentV, " ", who(), TODAY, O) as any).error, /why/);
  assert.match((reject(p, { ...v, Status: "draft" }, "no", who(), TODAY, O) as any).error, /sent/);
  assert.match((reject(p, sentV, "no", who(false), TODAY, O) as any).error, /Only a manager/);
  const w: any = reject(p, sentV, "Too dear", who(), TODAY, O);
  assert.equal(w.patches[0].patch.RejectedReason, "Too dear");
  assert.ok(!w.patches.some((x: any) => x.list === "Opportunities"));
  assert.equal(w.activities[0].Type, "proposal-rejected");
  assert.ok(!("error" in (reject(p, { ...v, Status: "sent", ValidUntil: "2026-01-01" }, "late", who(), TODAY, O) as any)));
});

test("the accepted version can be proved untouched, and tampering is caught", async () => {
  const body = encodeContent(content([L()]));
  const hash = await hashText(body);
  assert.equal(hash.length, 64);
  assert.equal(await untouched({ Body: body, Hash: hash }), true);
  assert.equal(await untouched({ Body: body.replace("100", "1"), Hash: hash }), false);
  assert.equal(await untouched({ Body: body }), true, "a draft has nothing to check yet");
  assert.equal(await hashText("a"), await hashText("a"));
});

test("moving the opportunity on only goes forward, and only while open", () => {
  const all = [opp];
  assert.equal((advanceOpp(opp, "sent", all, DEFAULT_STAGES, O) as any).patches[0].patch.Stage, "sent");
  assert.equal(advanceOpp({ ...opp, Stage: "negotiation" }, "sent", all, DEFAULT_STAGES, O), undefined, "never backwards");
  assert.equal(advanceOpp({ ...opp, Stage: "sent" }, "sent", all, DEFAULT_STAGES, O), undefined, "already there");
  assert.equal(advanceOpp({ ...opp, Outcome: "lost" }, "sent", all, DEFAULT_STAGES, O), undefined);
  assert.equal(advanceOpp(opp, "accepted", all, DEFAULT_STAGES, O), undefined, "winning is done by acceptance, not by a stage move");
  assert.equal(advanceOpp(opp, "nowhere", all, DEFAULT_STAGES, O), undefined);
});

test("proposal template: defaults, overrides and merge fields", () => {
  assert.deepEqual(readTemplate(null), DEFAULT_TEMPLATE);
  assert.deepEqual(readTemplate("junk"), DEFAULT_TEMPLATE);
  const t = readTemplate({ coverPage: false, about: "We are small.", terms: "" });
  assert.deepEqual([t.coverPage, t.about, t.terms, t.introduction === DEFAULT_TEMPLATE.introduction], [false, "We are small.", "", true]);
  assert.equal(fill("Hi {{client}}, {{unknown}} {{ VALIDUNTIL }}", { client: "Acme", validuntil: "1 Dec" }), "Hi Acme, {{unknown}} 1 Dec");
});

const text = (d: ReturnType<typeof proposalDocument>) => JSON.stringify(d.blocks);
const dc = { client: "Acme Ltd", practice: "Bannister & Co", contact: "Ann", reference: "P-2026-0001", date: TODAY, version: 1 };

test("the proposal document carries the services, scope, fees, VAT, validity, terms and an acceptance section", () => {
  const c = content([L({ name: "Bookkeeping", description: "Monthly books", scope: "Bank reconciliation\nSales ledger", exclusions: "Payroll", clientResp: "Send records", practiceResp: "Post them", price: 100, frequency: "monthly", setupFee: 50 }), L({ name: "Payroll", price: 20, frequency: "monthly", optional: true })], { startDate: "2026-12-01", introduction: "", requirements: "Needs monthly books." });
  const d = proposalDocument(c, DEFAULT_TEMPLATE, dc);
  const s = text(d);
  for (const w of ["Bookkeeping", "Monthly books", "Bank reconciliation", "Not included", "Your responsibilities", "Our responsibilities", "Needs monthly books.", "Optional services", "30 November 2026", "1 December 2026", "Acceptance", "Signed", "P-2026-0001", "First year total, including VAT", "£1,200.00"]) assert.ok(s.includes(w), w);
  assert.ok(s.includes("Thank you for the opportunity to propose our services to Acme Ltd"), "merge fields are filled in");
  assert.ok(!s.includes("{{"));
  assert.ok(d.blocks.some((b) => b.type === "break"));
  const optionalHeading = s.indexOf("Optional services");
  assert.ok(s.indexOf("Summary of fees") < optionalHeading, "optional services are kept out of the totals");
});

test("a template can drop the cover page, scope and responsibilities", () => {
  const c = content([L({ name: "Bookkeeping", scope: "Reconciliations", clientResp: "Send records" })]);
  const s = text(proposalDocument(c, { ...DEFAULT_TEMPLATE, coverPage: false, showScope: false, showResponsibilities: false }, dc));
  assert.ok(!s.includes("Reconciliations") && !s.includes("Send records") && !s.includes("Prepared for"));
});

test("zero-VAT lines show no VAT, and totals match the on-screen calculation", () => {
  const c = content([L({ name: "Training", price: 200, frequency: "annual", vat: "exempt" })]);
  const s = text(proposalDocument(c, DEFAULT_TEMPLATE, dc));
  assert.ok(s.includes("No VAT"));
  assert.ok(s.includes("£200.00"));
});

test("the review summary flags overrides and discounts for the approver", () => {
  const t = totalsFor([L({ price: 80, catalogPrice: 100, discount: { kind: "pct", value: 5 } })], 0.2);
  const lines = reviewSummary(content([L({ price: 80, catalogPrice: 100, discount: { kind: "pct", value: 5 } })]), t);
  assert.ok(lines.some((x) => /changed from the catalogue/.test(x)) && lines.some((x) => /discounted/.test(x)));
});
