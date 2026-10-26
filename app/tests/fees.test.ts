import test from "node:test";
import assert from "node:assert/strict";
import {
  addCharge, addCost, adjustFee, applyProposal, cancelCharge, contribution, endFee, feeReviewsDue, lineFee, periodsPerYear, readCost, readFeeLine, readFeeSettings, restartFee, revenue, reviewFee, scheduleFields, setupCharge, unappliedProposals, feeCan,
} from "../src/lib/fees.ts";

let n = 0;
const O = { actor: "Kevin", now: "2026-10-26T10:00:00.000Z", pid: "default", newKey: (p: string) => `${p}${++n}` };
const yes = () => true;
const no = () => false;
const client: any = { Key: "C1", Title: "Acme Ltd" };
const line = (o: any = {}): any => ({ id: "l1", serviceKey: "ACCS_LTD", name: "Accounts", frequency: "monthly", price: 100, discount: null, setupFee: 0, vat: "standard", optional: false, ...o });
const cs = (o: any = {}): any => ({ Key: "CS1", ClientKey: "C1", ServiceKey: "ACCS_LTD", Fee: 100, FeePeriod: "monthly", OneOff: false, AnnualFee: 1200, ...o });

test("periods: the planner's own words and the proposal's", () => {
  assert.deepEqual(["monthly", "Quarterly", "annually", "annual", "", "weekly"].map(periodsPerYear), [12, 4, 1, 1, 0, 0]);
});

test("a proposal line becomes a fee after discount, with its frequency, VAT and set-up fee", () => {
  const a = lineFee(line({ price: 200, discount: { kind: "pct", value: 25, reason: "new client" }, setupFee: 150 }));
  assert.equal(a.net, 150); assert.equal(a.annual, 1800); assert.equal(a.period, "monthly"); assert.equal(a.setup, 150); assert.equal(a.discount?.reason, "new client");
  const b = lineFee(line({ frequency: "one-off", price: 500, discount: { kind: "amount", value: 100 } }));
  assert.equal(b.net, 400); assert.equal(b.oneOff, true); assert.equal(b.annual, 0); assert.equal(b.period, "");
  assert.equal(lineFee(line({ frequency: "annual", price: 90 })).period, "annually");
  const f = scheduleFields(line({ frequency: "annual", price: 90 }), { effectiveFrom: "2026-11-01", reviewMonths: 12, proposalKey: "PR1" });
  assert.equal(f.NextReview, "2027-11-01"); assert.equal(f.EffectiveFrom, "2026-11-01"); assert.equal(f.ProposalKey, "PR1");
  assert.equal(scheduleFields(line({ frequency: "one-off" }), { effectiveFrom: "2026-11-01", reviewMonths: 12, proposalKey: "P" }).NextReview, "");
});

test("a fee line is read with its status, and old records without Phase 5 details still work", () => {
  const l = readFeeLine(cs());
  assert.equal(l.annual, 1200); assert.equal(l.status, "active"); assert.equal(l.effectiveFrom, "");
  assert.equal(readFeeLine(cs({ Fee: 0, AnnualFee: 0 })).status, "included");
  assert.equal(readFeeLine(cs({ Off: true })).status, "held");
  assert.equal(readFeeLine(cs({ Off: true, EndedOn: "2026-10-01" })).status, "ended");
  assert.equal(readFeeLine(cs({ OneOff: true, FeePeriod: "", Fee: 300, AnnualFee: 300 })).annual, 0);
  assert.equal(readFeeLine(cs({ FeePeriod: "fortnightly", AnnualFee: 500 })).annual, 500);
});

test("applying a proposal creates or changes schedule lines, keeps history, and records set-up fees once", () => {
  const input = { client, proposalKey: "PR1", proposalRef: "P-2026-0001", lines: [line({ setupFee: 250 }), line({ serviceKey: "VAT", name: "VAT", frequency: "quarterly", price: 90 })], schedule: [cs({ ServiceKey: "VAT", Fee: 80, FeePeriod: "quarterly", Key: "CS9" })], charges: [], services: [], effectiveFrom: "2026-11-01", reviewMonths: 12, can: yes };
  const w: any = applyProposal(input, O);
  assert.equal(w.creates.filter((c: any) => c.list === "ClientServices").length, 1);
  const csp = w.patches.filter((p: any) => p.list === "ClientServices"); assert.equal(csp.length, 1); assert.equal(csp[0].row.Key, "CS9"); assert.equal(csp[0].patch.Fee, 90);
  assert.ok(w.patches.some((p: any) => p.list === "Clients"), "the client's yearly total is updated");
  const hist = w.creates.filter((c: any) => c.list === "FeeHistory");
  assert.ok(hist.length >= 3);
  const vatHist = hist.find((h: any) => h.row.ServiceKey === "VAT").row;
  assert.equal(JSON.parse(vatHist.Old).fee, 80); assert.equal(JSON.parse(vatHist.New).fee, 90);
  assert.equal(w.creates.filter((c: any) => c.list === "FeeCharges").length, 1);
  assert.equal(w.activities[0].Type, "fee-changed");
  // run again with the charge present: no second set-up fee
  const again: any = applyProposal({ ...input, charges: [w.creates.find((c: any) => c.list === "FeeCharges").row] }, O);
  assert.equal(again.creates.filter((c: any) => c.list === "FeeCharges").length, 0);
  assert.ok("error" in (applyProposal({ ...input, can: no }, O) as any));
  assert.ok("error" in (applyProposal({ ...input, lines: [] }, O) as any));
});

test("proposals not yet in the schedule are found, and applied ones are not offered again", () => {
  const props: any[] = [{ Key: "PR1", Ref: "P-1", ClientKey: "C1", Status: "accepted", AcceptedVersion: 1 }];
  const vers: any[] = [{ ProposalKey: "PR1", Version: 1, Status: "accepted", Agreed: "{}" }];
  const read = () => [line(), line({ serviceKey: "VAT", name: "VAT", price: 90, frequency: "quarterly" })];
  assert.equal(unappliedProposals("C1", props, vers, [], read as any)[0].lines.length, 2);
  const have = [cs({ ProposalKey: "PR1" }), cs({ ServiceKey: "VAT", Fee: 90, FeePeriod: "quarterly", Key: "CS2" })];
  assert.equal(unappliedProposals("C1", props, vers, have, read as any).length, 0);
  // same service at a different fee, set by hand: offered so the manager can choose
  assert.equal(unappliedProposals("C1", props, vers, [cs({ Fee: 150 })], read as any)[0].lines.some((l) => l.serviceKey === "ACCS_LTD"), true);
  assert.equal(unappliedProposals("C2", props, vers, [], read as any).length, 0);
});

test("a manual adjustment needs authority and a reason, and keeps the old fee", () => {
  const a = { fee: 120, period: "monthly", vat: "standard", effectiveFrom: "2026-11-01", nextReview: "2027-11-01", discount: null, reason: "Annual increase" };
  const w: any = adjustFee(cs(), client, a, yes, O);
  assert.equal(w.patches[0].patch.Fee, 120); assert.equal(w.patches[0].patch.AnnualFee, 1440);
  const h = w.creates[0].row; assert.equal(JSON.parse(h.Old).fee, 100); assert.equal(JSON.parse(h.New).fee, 120); assert.equal(h.Reason, "Annual increase"); assert.equal(h.Actor, "Kevin");
  assert.ok("error" in (adjustFee(cs(), client, a, no, O) as any));
  assert.ok("error" in (adjustFee(cs(), client, { ...a, reason: " " }, yes, O) as any));
  assert.ok("error" in (adjustFee(cs(), client, { ...a, fee: -5 }, yes, O) as any));
  assert.ok("error" in (adjustFee(cs(), client, { ...a, nextReview: "2026-01-01" }, yes, O) as any));
  assert.ok("error" in (adjustFee(cs(), client, { ...a, discount: { kind: "pct", value: 120, reason: "" } }, yes, O) as any));
  assert.ok("error" in (adjustFee(cs({ EndedOn: "2026-01-01" }), client, a, yes, O) as any));
  const one: any = adjustFee(cs(), client, { ...a, period: "" }, yes, O);
  assert.equal(one.patches[0].patch.OneOff, true); assert.equal(one.patches[0].patch.AnnualFee, 0);
});

test("ending, restarting and reviewing a fee are recorded", () => {
  const e: any = endFee(cs(), client, "2026-12-31", "Client left", yes, O);
  assert.equal(e.patches[0].patch.EndedOn, "2026-12-31"); assert.equal(e.patches[0].patch.Off, true);
  assert.ok("error" in (endFee(cs(), client, "2026-12-31", "", yes, O) as any));
  assert.ok("error" in (endFee(cs({ EndedOn: "2026-01-01" }), client, "2026-12-31", "x", yes, O) as any));
  const r: any = restartFee(cs({ EndedOn: "2026-12-31", Off: true }), client, "2027-02-01", "Came back", yes, O);
  assert.equal(r.patches[0].patch.EndedOn, ""); assert.equal(r.patches[0].patch.Off, false);
  assert.ok("error" in (restartFee(cs(), client, "2027-02-01", "x", yes, O) as any));
  const v: any = reviewFee(cs(), client, "2027-11-01", "", yes, O);
  assert.equal(v.patches[0].patch.NextReview, "2027-11-01"); assert.equal(v.creates[0].row.Action, "reviewed");
});

test("one-off charges: added with a reason to exist, cancelled with a reason, never counted as recurring", () => {
  const w: any = addCharge(client, { label: "Catch-up work", amount: 400, vat: "standard", agreedOn: "2026-10-26" }, yes, O);
  assert.equal(w.creates[0].list, "FeeCharges"); assert.equal(w.creates[0].row.Amount, 400);
  assert.ok("error" in (addCharge(client, { label: "", amount: 400, vat: "standard", agreedOn: "2026-10-26" }, yes, O) as any));
  assert.ok("error" in (addCharge(client, { label: "x", amount: 0, vat: "standard", agreedOn: "2026-10-26" }, yes, O) as any));
  assert.ok("error" in (addCharge(client, { label: "x", amount: 5, vat: "standard", agreedOn: "26/10" }, yes, O) as any));
  assert.ok("error" in (addCharge(client, { label: "x", amount: 5, vat: "standard", agreedOn: "2026-10-26" }, no, O) as any));
  const c: any = cancelCharge(w.creates[0].row, client, "Not going ahead", yes, O);
  assert.equal(c.patches[0].patch.Status, "cancelled");
  assert.ok("error" in (cancelCharge({ ...w.creates[0].row, Status: "cancelled" }, client, "x", yes, O) as any));
});

test("revenue: contracted recurring and one-off kept apart, held and ended services not counted as running income", () => {
  const schedule: any[] = [
    cs({ Key: "a", ClientKey: "C1", ServiceKey: "ACCS_LTD", Fee: 100, FeePeriod: "monthly" }),
    cs({ Key: "b", ClientKey: "C1", ServiceKey: "VAT", Fee: 90, FeePeriod: "quarterly" }),
    cs({ Key: "c", ClientKey: "C2", ServiceKey: "ACCS_LTD", Fee: 600, FeePeriod: "annually" }),
    cs({ Key: "d", ClientKey: "C2", ServiceKey: "PAYROLL", Fee: 50, FeePeriod: "monthly", Off: true }),
    cs({ Key: "e", ClientKey: "C2", ServiceKey: "CIS", Fee: 50, FeePeriod: "monthly", Off: true, EndedOn: "2026-01-01" }),
    cs({ Key: "f", ClientKey: "C3", ServiceKey: "CGT", Fee: 300, FeePeriod: "", OneOff: true }),
    cs({ Key: "g", ClientKey: "C3", ServiceKey: "CT600", Fee: 0, AnnualFee: 0, FeePeriod: "annually" }),
  ];
  const charges: any[] = [{ Key: "x", ClientKey: "C1", ServiceKey: "ACCS_LTD", Label: "Set-up", Amount: 250, Status: "agreed" }, { Key: "y", ClientKey: "C1", Label: "Cancelled", Amount: 999, Status: "cancelled" }];
  const r = revenue(schedule, charges);
  assert.equal(r.arr, 1200 + 360 + 600); assert.equal(r.mrr, 180);
  assert.equal(r.oneOff, 300 + 250); assert.equal(r.total, 2160 + 550);
  assert.equal(r.heldArr, 600); assert.equal(r.includedCount, 1);
  assert.equal(r.byService.find((s) => s.serviceKey === "ACCS_LTD")?.arr, 1800);
  assert.equal(r.byService.find((s) => s.serviceKey === "ACCS_LTD")?.oneOff, 250);
  assert.equal(r.byClient[0].clientKey, "C1");
  assert.equal(revenue([], []).total, 0);
});

test("direct costs and contribution are labelled as partial and never read as profitability", () => {
  const fees = [readFeeLine(cs()), readFeeLine(cs({ Key: "z", ServiceKey: "VAT", Fee: 90, FeePeriod: "quarterly" }))];
  const none = contribution(fees, []);
  assert.equal(none.revenue, 1560); assert.equal(none.complete, "none"); assert.match(none.label, /not a contribution figure/);
  const w: any = addCost(client, { kind: "outsourcing", label: "Bookkeeper", amount: 100, period: "monthly" }, yes, O);
  const w2: any = addCost(client, { kind: "internal", label: "Partner time estimate", amount: 600, period: "annually" }, yes, O);
  const w3: any = addCost(client, { kind: "software", label: "Licence", amount: 200, period: "" }, yes, O);
  const costs = [w, w2, w3].map((x) => readCost(x.creates[0].row));
  assert.equal(costs[1].estimate, true); assert.equal(costs[2].oneOff, true);
  const c = contribution(fees, costs);
  assert.equal(c.costs, 1200); assert.equal(c.internal, 600); assert.equal(c.contribution, 1560 - 1200 - 600); assert.equal(c.oneOffCosts, 200);
  assert.equal(c.complete, "partial"); assert.match(c.label, /not full client profitability/); assert.match(c.label, /estimated internal/);
  const stopped = contribution(fees, costs.map((x) => ({ ...x, active: false })));
  assert.equal(stopped.complete, "none");
  assert.ok("error" in (addCost(client, { kind: "outsourcing", label: "x", amount: 0, period: "monthly" }, yes, O) as any));
  assert.ok("error" in (addCost(client, { kind: "bogus" as any, label: "x", amount: 5, period: "monthly" }, yes, O) as any));
  assert.ok("error" in (addCost(client, { kind: "other", label: "x", amount: 5, period: "monthly" }, no, O) as any));
  const r = revenue([cs()], [], [w.creates[0].row]);
  assert.equal(r.byClient[0].contribution?.costs, 1200);
});

test("fee reviews due, settings and permissions", () => {
  const sched: any[] = [cs({ NextReview: "2026-11-10" }), cs({ Key: "b", NextReview: "2027-06-01" }), cs({ Key: "c", NextReview: "2026-01-01", Off: true, EndedOn: "2026-02-01" })];
  assert.deepEqual(feeReviewsDue(sched, "2026-10-26", 30).map((l) => l.key), ["CS1"]);
  assert.equal(feeReviewsDue([cs({ NextReview: "2026-01-01" })], "2026-10-26", 30).length, 1);
  assert.equal(readFeeSettings([]).reviewMonths, 12);
  assert.equal(readFeeSettings([{ Key: "fees.settings", Value: JSON.stringify({ reviewMonths: 6 }) }] as any).reviewMonths, 6);
  assert.equal(readFeeSettings([{ Key: "fees.settings", Value: JSON.stringify({ reviewMonths: 999 }) }] as any).reviewMonths, 12);
  const cfg: any = { staff: [{ name: "Pat", role: "preparer" }, { name: "Mo", role: "manager" }], overriders: [], independentReview: false, auto: true };
  assert.equal(feeCan(cfg, "Pat", "adjust"), false); assert.equal(feeCan(cfg, "Mo", "adjust"), true);
  const ch = setupCharge(line({ setupFee: 100 }), { clientKey: "C1", proposalKey: "P", proposalRef: "P-1", effectiveFrom: "2026-11-01", existing: [] }, O);
  assert.equal(ch?.Amount, 100); assert.equal(setupCharge(line(), { clientKey: "C1", proposalKey: "P", proposalRef: "P-1", effectiveFrom: "2026-11-01", existing: [] }, O), undefined);
});

test("changing a fee keeps the client's yearly total in step (active recurring fees only)", () => {
  const sched: any[] = [cs(), cs({ Key: "CS2", ServiceKey: "VAT", Fee: 90, FeePeriod: "quarterly" }), cs({ Key: "CS3", ServiceKey: "CIS", Fee: 50, FeePeriod: "monthly", Off: true })];
  const c: any = { Key: "C1", Title: "Acme", AnnualFees: 1560 };
  const a = { fee: 120, period: "monthly", vat: "standard", effectiveFrom: "2026-11-01", nextReview: "2027-11-01", discount: null, reason: "Increase" };
  const w: any = adjustFee(sched[0], c, a, yes, O, sched);
  assert.equal(w.patches.find((p: any) => p.list === "Clients").patch.AnnualFees, 1440 + 360);
  const e: any = endFee(sched[1], c, "2026-12-31", "Left", yes, O, sched);
  assert.equal(e.patches.find((p: any) => p.list === "Clients").patch.AnnualFees, 1200);
  const same: any = adjustFee(sched[0], { ...c, AnnualFees: 1560 }, { ...a, fee: 100 }, yes, O, sched);
  assert.equal(same.patches.some((p: any) => p.list === "Clients"), false, "no change to the total, no write");
});
