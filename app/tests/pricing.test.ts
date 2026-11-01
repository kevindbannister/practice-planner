import test from "node:test";
import assert from "node:assert/strict";
import { blankRule, belowRule, checkAll, checkCsv, checkLine, inPeriod, readRules, removeRule, ruleProblems, saveRule, suggest } from "../src/lib/pricing.ts";
import { readFeeLine, revenue } from "../src/lib/fees.ts";
import { approveCatchUp, catchUpPeriod, catchUpWorking, monthName, monthlyRate, monthsBetween, overlapping, proposeCatchUp } from "../src/lib/catchup.ts";

const defs: any[] = [
  { key: "transactions", label: "Monthly transactions", type: "number", appliesTo: "client", options: [], help: "" },
  { key: "cis", label: "CIS", type: "yesno", appliesTo: "client", options: [], help: "" },
  { key: "turnover", label: "Turnover", type: "number", appliesTo: "client", options: [], help: "" },
  { key: "standard", label: "Standard", type: "choice", appliesTo: "client", options: ["good", "poor"], help: "" },
];
const rule = (o: any = {}) => ({ ...blankRule("R1", "BOOK"), name: "Bookkeeping", base: 100, drivers: [{ fieldKey: "transactions", rate: 12, per: 100 }], extras: [{ fieldKey: "cis", amount: 30 }], minimum: 150, round: 5, ...o });

test("fee = base + per-unit drivers + yes/no extras, then minimum, then rounding, with the working shown", () => {
  const s = suggest(rule(), { transactions: "250", cis: "yes" }, defs);
  // 100 + 2.5 x 12 = 130, + 30 = 160
  assert.equal(s.fee, 160);
  assert.deepEqual(s.steps.map((x) => x.amount), [100, 30, 30]);
  assert.equal(s.complete, true);
  assert.equal(suggest(rule(), { transactions: "250", cis: "no" }, defs).fee, 130 < 150 ? 150 : 130, "raised to the minimum");
  assert.ok(suggest(rule(), { transactions: "250", cis: "no" }, defs).steps.some((x) => x.label === "Raised to the minimum"));
  assert.equal(suggest(rule({ minimum: 0 }), { transactions: "263", cis: "no" }, defs).fee, 130, "131.56 to the nearest 5");
  assert.equal(suggest(rule({ minimum: 0, round: 0 }), { transactions: "263", cis: "no" }, defs).fee, 131.56);
});

test("bands pick the first band the value fits, and the last can be open-ended", () => {
  const r = rule({ base: 0, drivers: [], extras: [], minimum: 0, round: 0, bandField: "turnover", bands: [{ upTo: 85000, fee: 50 }, { upTo: 250000, fee: 90 }, { upTo: null, fee: 150 }] });
  assert.equal(suggest(r, { turnover: "85000" }, defs).fee, 50, "on the limit is in the lower band");
  assert.equal(suggest(r, { turnover: "85,001" }, defs).fee, 90);
  assert.equal(suggest(r, { turnover: "900000" }, defs).fee, 150);
});

test("a figure the client doesn't have is reported, not guessed", () => {
  const s = suggest(rule(), { cis: "no" }, defs);
  assert.deepEqual(s.missing, ["Monthly transactions"]);
  assert.equal(s.complete, false);
  assert.equal(s.fee, 150, "base only, raised to minimum");
});

test("rules are checked: field types, bands in order, one rule per service", () => {
  assert.deepEqual(ruleProblems(rule(), defs), []);
  assert.match(ruleProblems(rule({ drivers: [{ fieldKey: "cis", rate: 1, per: 1 }] }), defs).join(), /number field/);
  assert.match(ruleProblems(rule({ extras: [{ fieldKey: "transactions", amount: 5 }] }), defs).join(), /yes \/ no/);
  assert.match(ruleProblems(rule({ drivers: [{ fieldKey: "gone", rate: 1, per: 1 }] }), defs).join(), /isn't one of your client fields/);
  assert.match(ruleProblems(rule({ bandField: "turnover", bands: [{ upTo: 100, fee: 1 }, { upTo: 50, fee: 2 }] }), defs).join(), /go up/);
  assert.match(ruleProblems(rule({ bandField: "turnover", bands: [{ upTo: null, fee: 1 }, { upTo: 50, fee: 2 }] }), defs).join(), /last band/);
  assert.match(ruleProblems({ ...blankRule("X", "S"), name: "x" }, defs).join(), /no prices/);
  const a = saveRule([], rule(), defs, "Kevin", "t1");
  assert.equal(a.rules[0].version, 1);
  assert.match(saveRule(a.rules, rule({ id: "R2" }), defs, "Kevin", "t2").problems.join(), /already a rule/);
});

test("changing the prices bumps the version; renaming does not; read drops junk", () => {
  const v1 = saveRule([], rule(), defs, "K", "t1").rules;
  const renamed = saveRule(v1, rule({ name: "Books" }), defs, "K", "t2").rules;
  assert.equal(renamed[0].version, 1);
  const repriced = saveRule(renamed, rule({ base: 110 }), defs, "K", "t3").rules;
  assert.equal(repriced[0].version, 2); assert.equal(repriced[0].updatedBy, "K");
  assert.deepEqual(removeRule(repriced, "R1"), []);
  assert.deepEqual(readRules("nonsense"), []);
  assert.equal(readRules([{ id: "a" }, { id: "b", serviceKey: "S", drivers: [{ fieldKey: "", rate: 1 }, { fieldKey: "t", rate: 2, per: 0 }] }]).length, 1);
  assert.equal(readRules([{ id: "b", serviceKey: "S", drivers: [{ fieldKey: "t", rate: 2, per: 0 }] }])[0].drivers[0].per, 1);
});

test("periods convert: a monthly rule against a quarterly or annual fee; one-off only against one-off", () => {
  assert.equal(inPeriod(100, "monthly", "quarterly"), 300);
  assert.equal(inPeriod(100, "monthly", "annually"), 1200);
  assert.equal(inPeriod(1200, "annually", "monthly"), 100);
  assert.equal(inPeriod(100, "", ""), 100);
  assert.equal(inPeriod(100, "monthly", ""), undefined);
});

const cs = (o: any = {}): any => ({ Key: "CS1", ClientKey: "C1", ServiceKey: "BOOK", Fee: 120, FeePeriod: "monthly", OneOff: false, AnnualFee: 1440, ...o });

test("the pricing check: gap each period and a year, only for active lines with a rule", () => {
  const c = checkLine(readFeeLine(cs()), [rule()], { transactions: "250", cis: "yes" }, defs)!;
  assert.equal(c.suggested, 160); assert.equal(c.gap, 40); assert.equal(c.gapYear, 480); assert.equal(c.ruleVersion, 1);
  const q = checkLine(readFeeLine(cs({ Fee: 300, FeePeriod: "quarterly" })), [rule()], { transactions: "250", cis: "yes" }, defs)!;
  assert.equal(q.suggested, 480); assert.equal(q.gap, 180); assert.equal(q.gapYear, 720);
  assert.equal(checkLine(readFeeLine(cs({ EndedOn: "2026-01-01" })), [rule()], {}, defs), undefined);
  assert.equal(checkLine(readFeeLine(cs({ ServiceKey: "OTHER" })), [rule()], {}, defs), undefined);
  assert.equal(checkLine(readFeeLine(cs({ Fee: 0 })), [rule()], {}, defs), undefined, "included in a package");
  const over = checkLine(readFeeLine(cs({ Fee: 200 })), [rule()], { transactions: "250", cis: "yes" }, defs)!;
  assert.equal(over.gap, -40);
  const none = checkLine(readFeeLine(cs()), [rule({ base: 0, minimum: 0, extras: [] })], {}, defs)!;
  assert.equal(none.suggested, undefined); assert.match(none.reason!, /No figures/);
  const oneOff = checkLine(readFeeLine(cs({ FeePeriod: "", OneOff: true, AnnualFee: 0 })), [rule()], { transactions: "1" }, defs)!;
  assert.match(oneOff.reason!, /priced monthly/);
});

test("checkAll sorts the biggest shortfall first and belowRule applies a threshold; CSV is quoted", () => {
  const lines = [readFeeLine(cs({ Key: "a", ClientKey: "A", Fee: 150 })), readFeeLine(cs({ Key: "b", ClientKey: "B", Fee: 100 })), readFeeLine(cs({ Key: "c", ClientKey: "C", Fee: 400 }))];
  const vals: any = { A: { transactions: "250", cis: "yes" }, B: { transactions: "250", cis: "yes" }, C: { transactions: "250", cis: "yes" } };
  const rows = checkAll(lines, [rule()], (k) => vals[k], defs, (k) => `Client "${k}"`);
  assert.deepEqual(rows.map((r) => r.clientKey), ["B", "A", "C"]);
  assert.deepEqual(belowRule(rows, 0).map((r) => r.clientKey), ["B", "A"]);
  assert.deepEqual(belowRule(rows, 200).map((r) => r.clientKey), ["B"]);
  assert.match(checkCsv(rows, () => "Book, keeping"), /"Client ""B""","Book, keeping","monthly","100","160","60","720","1"/);
});

// ------------------------------------------------------------------ catch-up

let n = 0;
const O = { actor: "Kevin", now: "2026-10-26T10:00:00.000Z", pid: "default", newKey: (p: string) => `${p}${++n}` };
const yes = () => true;
const client: any = { Key: "C1", Title: "Acme Ltd" };
const base = (o: any = {}): any => ({ line: readFeeLine(cs()), from: "2026-01", to: "2026-06", basis: "agreed", premiumPct: 0, vat: "standard", today: "2026-10-26", serviceName: "Bookkeeping", ...o });

test("months are counted inclusively and bad ranges give nothing", () => {
  assert.equal(monthsBetween("2026-01", "2026-06"), 6);
  assert.equal(monthsBetween("2025-11", "2026-02"), 4);
  assert.equal(monthsBetween("2026-06", "2026-01"), 0);
  assert.equal(monthsBetween("2026-1", "2026-06"), 0);
  assert.equal(monthName("2026-03"), "Mar 2026");
});

test("monthly rate comes from the agreed fee in any period; none for one-offs", () => {
  assert.equal(monthlyRate(readFeeLine(cs())), 120);
  assert.equal(monthlyRate(readFeeLine(cs({ Fee: 300, FeePeriod: "quarterly" }))), 100);
  assert.equal(monthlyRate(readFeeLine(cs({ Fee: 1200, FeePeriod: "annually" }))), 100);
  assert.equal(monthlyRate(readFeeLine(cs({ FeePeriod: "", OneOff: true, AnnualFee: 0 }))), undefined);
});

test("working: months x monthly, with a premium, a typed total, or the rule's figure", () => {
  const w: any = catchUpWorking(base({ premiumPct: 25 }));
  assert.equal(w.months, 6); assert.equal(w.subtotal, 720); assert.equal(w.amount, 900);
  assert.equal((catchUpWorking(base({ override: 650 })) as any).amount, 650);
  assert.equal((catchUpWorking(base({ basis: "rule", ruleMonthly: 160 })) as any).amount, 960);
  assert.match((catchUpWorking(base({ basis: "rule" })) as any).error, /no figure/);
  assert.match((catchUpWorking(base({ to: "2025-01" })) as any).error, /last can't be before/);
  assert.match((catchUpWorking(base({ from: "2022-01", to: "2026-01" })) as any).error, /most one catch-up/);
  assert.match((catchUpWorking(base({ premiumPct: 500 })) as any).error, /premium/);
  assert.match((catchUpWorking(base({ override: 0 })) as any).error, /more than zero/);
  assert.match((catchUpWorking(base({ line: readFeeLine(cs({ FeePeriod: "", OneOff: true, AnnualFee: 0 })) })) as any).error, /no monthly rate/);
});

test("a catch-up is proposed, not agreed: it is not revenue until approved", () => {
  const w: any = proposeCatchUp(client, base({ premiumPct: 10 }), [], yes, O);
  assert.equal(w.error, undefined);
  const row = w.creates[0].row;
  assert.equal(row.Status, "proposed"); assert.equal(row.Amount, 792); assert.equal(row.AgreedOn, ""); assert.match(row.Label, /Catch-up: Bookkeeping, Jan 2026 to Jun 2026/);
  assert.deepEqual(catchUpPeriod(row), { serviceKey: "BOOK", from: "2026-01", to: "2026-06" });
  assert.equal(w.creates[1].list, "FeeHistory"); assert.equal(w.creates[1].row.Action, "catchup-proposed");
  assert.equal(revenue([], [row]).oneOff, 0);
});

test("asking again for the same or an overlapping period does nothing; cancelled ones don't block", () => {
  const w: any = proposeCatchUp(client, base(), [], yes, O);
  const row = w.creates[0].row;
  assert.match((proposeCatchUp(client, base(), [row], yes, O) as any).error, /already a catch-up/);
  assert.match((proposeCatchUp(client, base({ from: "2026-05", to: "2026-08" }), [row], yes, O) as any).error, /Jan 2026 to Jun 2026/);
  assert.equal((proposeCatchUp(client, base({ from: "2026-07", to: "2026-08" }), [row], yes, O) as any).error, undefined, "next months are fine");
  assert.equal((proposeCatchUp(client, base({ line: { ...base().line, serviceKey: "OTHER" } }), [row], yes, O) as any).error, undefined, "another service is fine");
  assert.equal((proposeCatchUp(client, base(), [{ ...row, Status: "cancelled" }], yes, O) as any).error, undefined);
  assert.equal(overlapping([row], "C2", "BOOK", "2026-01", "2026-06").length, 0);
});

test("catch-up rules: manager only, and only for months that have happened", () => {
  assert.match((proposeCatchUp(client, base(), [], () => false, O) as any).error, /manager or partner/);
  assert.match((proposeCatchUp(client, base({ to: "2026-12" }), [], yes, O) as any).error, /already happened/);
  assert.equal((proposeCatchUp(client, base({ from: "2026-10", to: "2026-10" }), [], yes, O) as any).error, undefined, "the current month is allowed");
});

test("approving makes it an agreed charge dated today, once", () => {
  const w: any = proposeCatchUp(client, base(), [], yes, O);
  const row = w.creates[0].row;
  const a: any = approveCatchUp(row, client, "2026-10-27", yes, O);
  assert.deepEqual(a.patches[0].patch, { Status: "agreed", AgreedOn: "2026-10-27" });
  assert.match((approveCatchUp({ ...row, Status: "agreed" }, client, "2026-10-27", yes, O) as any).error, /isn't waiting/);
  assert.match((approveCatchUp(row, client, "2026-10-27", () => false, O) as any).error, /manager or partner/);
});
