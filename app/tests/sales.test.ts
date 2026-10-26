import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_STAGES, createLead, createOpp, findDuplicates, inStage, linkToClient, logActivity, moveStage, orderAt, readPipeline, readStrings,
  reopen, repairStages, salesAlerts, salesCan, setOutcome, stageKeyFor, totals, wonStage,
} from "../src/lib/sales.ts";

let n = 0;
const O = { actor: "Kevin", now: "2026-10-26T10:00:00.000Z", pid: "default", newKey: (p: string) => `${p}${++n}` };
const stages = DEFAULT_STAGES;
const mk = (o: Record<string, unknown>): any => ({ Key: `O${++n}`, Title: "Acme", Stage: "new", Outcome: "open", Order: 1000, ...o });
const settings = (key: string, v: unknown): any[] => [{ Key: key, Value: JSON.stringify(v) }];

test("default pipeline has the eight stages in the brief, ending at Accepted", () => {
  assert.deepEqual(stages.map((s) => s.label), ["New lead", "Contacted", "Qualified", "Discovery / requirements", "Proposal being prepared", "Proposal sent", "Negotiation", "Accepted"]);
  assert.equal(wonStage(stages).key, "accepted");
});

test("a practice can rename, reorder and add stages; bad settings fall back safely", () => {
  const p = readPipeline(settings("sales.pipeline", [{ key: "a", label: "First" }, { key: "b", label: "Second" }, { key: "b", label: "Dup" }, { key: "", label: "x" }, { key: "c", label: "Done", won: true }]));
  assert.deepEqual(p.map((s) => s.key), ["a", "b", "c"]);
  assert.equal(wonStage(p).key, "c");
  assert.equal(readPipeline(settings("sales.pipeline", [{ key: "a", label: "Only" }])).length, 8);
  assert.equal(readPipeline([{ Key: "sales.pipeline", Value: "not json" }]).length, 8);
  assert.equal(readPipeline([]).length, 8);
  // with no stage marked won, the last one counts
  assert.equal(wonStage(readPipeline(settings("sales.pipeline", [{ key: "a", label: "A" }, { key: "b", label: "B" }]))).key, "b");
  // two marked won: only the last counts
  const two = readPipeline(settings("sales.pipeline", [{ key: "a", label: "A", won: true }, { key: "b", label: "B" }, { key: "c", label: "C", won: true }]));
  assert.deepEqual(two.map((s) => !!s.won), [false, false, true]);
  assert.equal(stageKeyFor("Proposal sent!", ["proposal-sent"]), "proposal-sent-2");
  assert.deepEqual(readStrings(settings("x", ["A", "A", " ", "B"]), "x", ["z"]), ["A", "B"]);
  assert.deepEqual(readStrings([], "x", ["z"]), ["z"]);
});

test("creating a lead needs a name and a sane email, and records an audit line and a timeline event", () => {
  assert.ok("error" in createLead({ name: " ", kind: "business" }, O));
  assert.ok("error" in createLead({ name: "A", kind: "business", email: "nope" }, O));
  const r: any = createLead({ name: "Acme Ltd", kind: "business", email: " a@acme.test ", source: "Referral" }, O);
  assert.equal(r.lead.Status, "open");
  assert.equal(r.lead.Email, "a@acme.test");
  assert.equal(r.lead.PracticeId, "default");
  assert.equal(r.lead.Received, "2026-10-26");
  assert.equal(r.log.Action, "created");
  assert.equal(r.activity.Type, "lead-created");
  assert.equal(r.activity.LeadKey, r.lead.Key);
});

test("an opportunity belongs to a lead or a client, and joins the end of its stage", () => {
  assert.ok("error" in createOpp({ title: "x", stage: "new" }, [], O));
  assert.ok("error" in createOpp({ title: " ", leadKey: "L1", stage: "new" }, [], O));
  const a: any = createOpp({ title: "Acme accounts", leadKey: "L1", stage: "new", value: 1200 }, [], O);
  const b: any = createOpp({ title: "Acme VAT", leadKey: "L1", stage: "new" }, [a.opp], O);
  assert.ok(b.opp.Order > a.opp.Order);
  assert.equal(b.opp.Outcome, "open");
});

test("an existing client can have several opportunities at once", () => {
  const all: any[] = [];
  for (const t of ["Payroll", "Advisory", "Tax planning"]) {
    const r: any = createOpp({ title: `${t} for Client`, clientKey: "C1", stage: "qualified" }, all, O);
    all.push(r.opp);
  }
  assert.equal(inStage(all, "qualified").length, 3);
  assert.ok(all.every((x) => x.ClientKey === "C1" && !x.LeadKey));
});

test("moving a card changes stage, keeps its place, and writes the audit log and timeline", () => {
  const a = mk({ Key: "A", Order: 1000 }), b = mk({ Key: "B", Order: 2000, Stage: "contacted" }), c = mk({ Key: "C", Order: 3000, Stage: "contacted" });
  const w: any = moveStage(a, "contacted", 1, [a, b, c], stages, O);
  assert.equal(w.patches[0].patch.Stage, "contacted");
  assert.ok(w.patches[0].patch.Order > 2000 && w.patches[0].patch.Order < 3000, "dropped between B and C");
  assert.equal(w.patches[0].list, "Opportunities");
  assert.equal(w.log[0].Action, "stage");
  assert.deepEqual(JSON.parse(w.log[0].Detail), { from: "new", to: "contacted", fromLabel: "New lead", toLabel: "Contacted" });
  assert.equal(w.activities[0].Type, "opp-stage");
  assert.ok(w.patches[0].patch.StageSince);
});

test("reordering inside a stage changes only the order, with no log noise", () => {
  const a = mk({ Key: "A", Order: 1000 }), b = mk({ Key: "B", Order: 2000 });
  const w: any = moveStage(b, "new", 0, [a, b], stages, O);
  assert.ok(w.patches[0].patch.Order < 1000);
  assert.equal(w.log.length, 0);
  assert.equal(w.activities.length, 0);
  assert.equal(w.patches[0].patch.Stage, "new");
});

test("order numbers sit between neighbours, at the ends, and in an empty column", () => {
  assert.equal(orderAt([], 0), 1000);
  const s: any[] = [{ Order: 1000 }, { Order: 2000 }];
  assert.equal(orderAt(s, 0), 0);
  assert.equal(orderAt(s, 1), 1500);
  assert.equal(orderAt(s, 2), 3000);
  assert.equal(orderAt(s, 99), 3000);
  assert.equal(orderAt([{ Order: 5 }, { Order: 5 }] as any, 1), 5.5);
});

test("moving into Accepted records a win; moving to an unknown stage or a closed card is refused", () => {
  const a = mk({ Key: "A", Stage: "negotiation" });
  const w: any = moveStage(a, "accepted", undefined, [a], stages, O);
  assert.equal(w.patches[0].patch.Outcome, "won");
  assert.equal(w.activities[0].Type, "opp-won");
  assert.equal(w.log[0].Action, "won");
  assert.ok("error" in (moveStage(a, "nowhere", 0, [a], stages, O) as any));
  assert.ok("error" in (moveStage(mk({ Outcome: "lost" }), "contacted", 0, [], stages, O) as any));
  assert.ok("error" in (moveStage(mk({ Outcome: "deferred" }), "contacted", 0, [], stages, O) as any));
});

test("lost needs a reason, deferred needs a date, won jumps to the won stage", () => {
  const a = mk({ Key: "A", FollowUp: "2026-11-01" });
  assert.ok("error" in (setOutcome(a, "lost", stages, O, {}) as any));
  assert.ok("error" in (setOutcome(a, "deferred", stages, O, { until: "soon" }) as any));
  const lost: any = setOutcome(a, "lost", stages, O, { reason: "Price" });
  assert.deepEqual([lost.patches[0].patch.Outcome, lost.patches[0].patch.LostReason, lost.patches[0].patch.FollowUp], ["lost", "Price", ""]);
  assert.equal(JSON.parse(lost.log[0].Detail).reason, "Price");
  const def: any = setOutcome(a, "deferred", stages, O, { until: "2027-01-10" });
  assert.deepEqual([def.patches[0].patch.Outcome, def.patches[0].patch.DeferUntil, def.patches[0].patch.FollowUp], ["deferred", "2027-01-10", "2027-01-10"]);
  const won: any = setOutcome(a, "won", stages, O, {});
  assert.deepEqual([won.patches[0].patch.Outcome, won.patches[0].patch.Stage], ["won", "accepted"]);
});

test("a lost opportunity can be reopened into a working stage", () => {
  const w: any = reopen(mk({ Outcome: "lost", Stage: "accepted", LostReason: "Price" }), stages, O);
  assert.deepEqual([w.patches[0].patch.Outcome, w.patches[0].patch.Stage, w.patches[0].patch.LostReason], ["open", "new", ""]);
  assert.equal(w.log[0].Action, "reopened");
});

test("logging a call updates last contact; a note does not; follow-up date is checked", () => {
  const a = mk({ Key: "A" });
  const call: any = logActivity(a, { kind: "call", text: "Spoke to Ann", followUp: "2026-11-02" }, O);
  assert.equal(call.patches[0].patch.LastContact, "2026-10-26");
  assert.equal(call.patches[0].patch.FollowUp, "2026-11-02");
  assert.equal(call.activities[0].Type, "call");
  assert.equal(call.activities[0].FollowUp, "2026-11-02");
  const note: any = logActivity(a, { kind: "note", text: "Thinking about it" }, O);
  assert.equal(note.patches[0].patch.LastContact, undefined);
  assert.ok("error" in (logActivity(a, { kind: "note", text: "  " }, O) as any));
  assert.ok("error" in (logActivity(a, { kind: "call", text: "x", followUp: "tomorrow" }, O) as any));
  assert.equal((logActivity(a, { kind: "email", text: "Sent the intro" }, O) as any).patches[0].patch.LastContact, "2026-10-26");
});

const clients: any[] = [{ Key: "C1", Title: "Acme Building Limited", Email: "info@acme.test", Mobile: "07700 900123", CompanyNumber: "01234567" }];
const contacts: any[] = [{ Key: "P1", Title: "Ann Smith", Email: "ann@smithco.test" }];
const leads: any[] = [{ Key: "L9", Title: "Smith & Sons", Email: "sam@smith.test", Phone: "+44 7700 900555" }];

test("duplicates: same email, same phone in another format, same company number, same name", () => {
  const byEmail = findDuplicates({ name: "Someone", email: "INFO@acme.test" }, leads, clients, contacts);
  assert.equal(byEmail[0].key, "C1");
  assert.deepEqual(byEmail[0].why, ["same email"]);
  const byPhone = findDuplicates({ name: "Other", phone: "07700900555" }, leads, clients, contacts);
  assert.equal(byPhone[0].kind, "lead");
  assert.match(byPhone[0].why.join(), /same phone/);
  assert.match(findDuplicates({ name: "Z", companyNumber: "1234567" }, leads, clients, contacts)[0].why.join(), /company number/);
  assert.equal(findDuplicates({ name: "acme building ltd" }, leads, clients, contacts)[0].strong, true);
  assert.equal(findDuplicates({ name: "Smith and Sons" }, leads, clients, contacts)[0].key, "L9");
});

test("duplicates: similar names are weak, unrelated people are not matched, a lead can skip itself", () => {
  const weak = findDuplicates({ name: "Acme Building" }, [], clients, []);
  assert.equal(weak[0].strong, false);
  assert.deepEqual(weak[0].why, ["similar name"]);
  assert.equal(findDuplicates({ name: "Totally Different Ltd", email: "x@y.test", phone: "01234 567890" }, leads, clients, contacts).length, 0);
  assert.equal(findDuplicates({ name: "Smith & Sons", email: "sam@smith.test" }, leads, [], [], "L9").length, 0);
  assert.equal(findDuplicates({ name: "", email: "", phone: "123" }, leads, clients, contacts).length, 0, "empty details match nothing");
  assert.equal(findDuplicates({ name: "A" }, [{ Key: "L1", Title: "A" }] as any, [], []).length, 1);
});

test("duplicates: strong matches come first", () => {
  const m = findDuplicates({ name: "Acme Building", email: "ann@smithco.test" }, [], clients, contacts);
  assert.equal(m[0].kind, "contact");
  assert.equal(m[0].strong, true);
});

test("linking a lead to a client moves the opportunities and the history onto the client", () => {
  const lead: any = { Key: "L1", Title: "Acme", Status: "open" };
  const opps: any[] = [mk({ Key: "O1", LeadKey: "L1" }), mk({ Key: "O2", LeadKey: "L2" })];
  const acts: any[] = [{ Key: "A1", LeadKey: "L1", ClientKey: "" }, { Key: "A2", LeadKey: "L2", ClientKey: "" }];
  const w = linkToClient(lead, "C1", opps, acts, O);
  const by = (list: string) => w.patches.filter((p) => p.list === list);
  assert.equal(by("Leads")[0].patch.Status, "converted");
  assert.deepEqual(by("Opportunities").map((p) => p.row.Key), ["O1"]);
  assert.deepEqual(by("Activities").map((p) => p.row.Key), ["A1"]);
  assert.equal(w.log[0].Action, "linked");
});

test("alerts: overdue follow-ups and uncontacted new leads; closed ones are ignored", () => {
  const opps: any[] = [
    mk({ Key: "A", Title: "Late", FollowUp: "2026-10-20", Stage: "qualified" }),
    mk({ Key: "B", Title: "Fresh", Created: "2026-10-24T09:00:00Z", Stage: "new" }),
    mk({ Key: "C", Title: "Today", Created: "2026-10-26T09:00:00Z", Stage: "new" }),
    mk({ Key: "D", Title: "Contacted", Created: "2026-10-20T09:00:00Z", Stage: "new", LastContact: "2026-10-21" }),
    mk({ Key: "E", Title: "Lost", FollowUp: "2026-10-01", Outcome: "lost" }),
  ];
  const a = salesAlerts(opps, [], "2026-10-26", "new");
  assert.deepEqual(a.map((x) => [x.key, x.level]), [["fu:A", "red"], ["new:B", "amber"]]);
  assert.equal(a[0].href, "#/sales/opp/A");
});

test("totals count open, won, lost and deferred separately and don't count closed value", () => {
  const opps: any[] = [mk({ Value: 100, Stage: "new" }), mk({ Value: 200, Stage: "new", FollowUp: "2026-01-01" }), mk({ Value: 999, Outcome: "won" }), mk({ Outcome: "lost" }), mk({ Outcome: "deferred" }), mk({ Value: 50, Stage: "gone" })];
  const t = totals(opps, stages, "2026-10-26");
  assert.deepEqual([t.open, t.value, t.won, t.lost, t.deferred, t.overdue], [3, 350, 1, 1, 1, 1]);
  assert.deepEqual(t.byStage.new, { count: 2, value: 300 });
  assert.deepEqual(t.byStage.gone, { count: 1, value: 50 });
});

test("cards in a stage that was removed go back to the first stage", () => {
  const fixes = repairStages([mk({ Key: "A", Stage: "gone" }), mk({ Key: "B", Stage: "new" }), mk({ Key: "C", Stage: "gone", Outcome: "lost" })], stages);
  assert.deepEqual(fixes.map((f) => [f.row.Key, f.patch.Stage]), [["A", "new"]]);
});

test("permissions: everyone with no staff list; outsourced nobody; only senior roles configure", () => {
  const cfg = (staff: any[]): any => ({ staff, overriders: [], independentReview: false, auto: true });
  assert.equal(salesCan(cfg([]), "Anyone", "configure"), true);
  const c = cfg([{ name: "Kate", role: "manager" }, { name: "Pat", role: "preparer" }, { name: "Out", role: "outsourced" }]);
  assert.deepEqual(["view", "work", "configure"].map((a) => salesCan(c, "Kate", a as any)), [true, true, true]);
  assert.deepEqual(["view", "work", "configure"].map((a) => salesCan(c, "Pat", a as any)), [true, true, false]);
  assert.deepEqual(["view", "work", "configure"].map((a) => salesCan(c, "Out", a as any)), [false, false, false]);
  assert.deepEqual(["view", "work", "configure"].map((a) => salesCan(c, "Stranger", a as any)), [true, false, false]);
});
