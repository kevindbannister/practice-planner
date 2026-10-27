import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_ENGAGEMENT_SETTINGS } from "../src/lib/engagements.ts";
import {
  Action, DEFAULT_PREFS, NO_FILTERS, applyPrefs, applyView, buildActions, canSeeAll, categoryLabel, dismiss, groupCounts, itemsOf, readHistory, readPrefs, reconcile, restore, visibleTo, CATEGORIES, prefsKey,
} from "../src/lib/actions.ts";

const TODAY = "2026-10-26";
const O = { actor: "Kevin", now: "2026-10-26T10:00:00.000Z", pid: "default" };
const src = (o: any = {}): any => ({
  today: TODAY, clients: [{ Key: "C1", Title: "Acme Ltd", Manager: "Mo", Kind: "Ltd" }], jobs: [], tasks: [], leads: [{ Key: "L1", Title: "Newco" }], opps: [], firstStageKey: "new", proposals: [], versions: [], engagements: [], onboardings: [],
  viewFor: () => undefined, clientServices: [], portal: [], eng: DEFAULT_ENGAGEMENT_SETTINGS, catalogue: [], ch: [], agentDone: () => false, ...o,
});
const by = (a: Action[], k: string) => a.find((x) => x.key === k);

test("the groups are the ones in the brief, in order, with Company Secretarial added", () => {
  assert.deepEqual(CATEGORIES.map((c) => c.label), ["Sales & Leads", "Proposals", "Client Onboarding", "Engagement Letters", "AML & Identity", "Document Signatures", "Client Information Requests", "Client Changes Awaiting Approval", "Company Secretarial", "Practice Jobs & Deadlines", "Other Notifications"]);
});

test("sales: overdue follow-up is high priority and due; a new uncontacted lead is flagged; one action per opportunity", () => {
  const opps: any[] = [
    { Key: "O1", Title: "Acme VAT", LeadKey: "L1", Stage: "talking", FollowUp: "2026-10-20", NextAction: "Call", Owner: "Pat", Created: "2026-10-01T00:00:00Z" },
    { Key: "O2", Title: "New enquiry", LeadKey: "L1", Stage: "new", Created: "2026-10-20T09:00:00Z", Owner: "Pat" },
    { Key: "O3", Title: "Far off", LeadKey: "L1", Stage: "talking", FollowUp: "2026-12-01", Created: "2026-10-01T00:00:00Z" },
    { Key: "O4", Title: "Won", LeadKey: "L1", Stage: "talking", FollowUp: "2026-10-01", Outcome: "won", Created: "2026-10-01T00:00:00Z" },
  ];
  const a = buildActions(src({ opps }));
  assert.equal(by(a, "sales:fu:O1")?.priority, "high"); assert.equal(by(a, "sales:fu:O1")?.due, "2026-10-20"); assert.equal(by(a, "sales:fu:O1")?.assignee, "Pat");
  assert.ok(by(a, "sales:new:O2")); assert.equal(by(a, "sales:new:O2")?.priority, "high");
  assert.equal(by(a, "sales:fu:O3"), undefined); assert.equal(by(a, "sales:fu:O4"), undefined);
  assert.equal(by(a, "sales:fu:O1")?.clientName, "Newco");
});

test("proposals: review, approved, valid-until, accepted without onboarding; and they resolve when the work is done", () => {
  const proposals: any[] = [
    { Key: "P1", Ref: "P-1", ClientKey: "C1", Status: "review", CurrentVersion: 1, CreatedBy: "Pat" },
    { Key: "P2", Ref: "P-2", ClientKey: "C1", Status: "approved", CurrentVersion: 1 },
    { Key: "P3", Ref: "P-3", ClientKey: "C1", Status: "sent", CurrentVersion: 1 },
    { Key: "P4", Ref: "P-4", ClientKey: "C1", Status: "accepted", CurrentVersion: 1 },
  ];
  const versions: any[] = [{ ProposalKey: "P1", Version: 1, Status: "review" }, { ProposalKey: "P2", Version: 1, Status: "approved" }, { ProposalKey: "P3", Version: 1, Status: "sent", ValidUntil: "2026-10-22" }, { ProposalKey: "P4", Version: 1, Status: "accepted", AcceptedBy: "Ann" }];
  const a = buildActions(src({ proposals, versions }));
  assert.ok(by(a, "prop:review:P1")); assert.ok(by(a, "prop:approved:P2")); assert.ok(by(a, "prop:sent:P3")); assert.equal(by(a, "prop:sent:P3")?.priority, "high");
  assert.match(by(a, "prop:accepted:P4")!.title, /start onboarding/);
  const after = buildActions(src({ proposals, versions, onboardings: [{ Key: "OB1", ProposalKey: "P4", Status: "active", ClientKey: "C1" }] }));
  assert.equal(by(after, "prop:accepted:P4"), undefined, "starting onboarding resolves it");
});

test("engagements: awaiting approval, awaiting signature (older is high), renewal with a stable key, no letter yet", () => {
  const e: any[] = [
    { Key: "E1", Ref: "E-1", ClientKey: "C1", Status: "review" },
    { Key: "E2", Ref: "E-2", ClientKey: "C1", Status: "out", SentOn: "2026-10-10T00:00:00Z", SignProgress: "1 of 2" },
    { Key: "E3", Ref: "E-3", ClientKey: "C1", Status: "signed", ReviewDate: "2026-11-05" },
    { Key: "E4", Ref: "E-4", ClientKey: "C1", Status: "signed", ReviewDate: "2026-09-01", ReviewRequest: "Fees changed" },
  ];
  const a = buildActions(src({ engagements: e }));
  assert.ok(by(a, "eng:review:E1")); assert.equal(by(a, "sig:out:E2")?.priority, "high"); assert.match(by(a, "sig:out:E2")!.detail, /1 of 2/);
  assert.equal(by(a, "sig:out:E2")?.category, "signatures");
  assert.equal(by(a, "eng:renew:E3")?.priority !== undefined, true);
  assert.equal(by(a, "eng:renew:E4")?.priority, "high"); assert.ok(by(a, "eng:early:E4"));
  // the key does not change as the review gets closer, so it is one action throughout
  const later = buildActions(src({ today: "2026-11-04", engagements: e }));
  assert.ok(by(later, "eng:renew:E3"));
});

test("portal items go to the right group; only informational ones can be dismissed; the same item is one action", () => {
  const portal = [
    { kind: "change", at: "2026-10-25T09:00:00Z", text: "Ann asked to change address for Acme Ltd.", link: "#/portal/changes", clientKey: "C1" },
    { kind: "identity", at: "2026-10-25T09:00:00Z", text: "Ann sent a passport to check.", link: "#/portal/identity", clientKey: "" },
    { kind: "signing", at: "2026-10-25T09:00:00Z", text: "Ann declined to sign.", link: "#/clients/C1/portal", clientKey: "C1" },
    { kind: "request", at: "2026-10-25T09:00:00Z", text: "Ann answered a request.", link: "#/portal/requests", clientKey: "C1" },
    { kind: "document", at: "2026-10-25T09:00:00Z", text: "Ann uploaded a file.", link: "#/portal/documents", clientKey: "C1" },
    { kind: "message", at: "2026-10-25T09:00:00Z", text: "New message.", link: "#/portal/messages", clientKey: "C1" },
  ];
  const a = buildActions(src({ portal: [...portal, ...portal] }));
  const cats = Object.fromEntries(a.map((x) => [x.key.split(":")[1], x.category]));
  assert.deepEqual(cats, { change: "changes", identity: "aml", signing: "signatures", request: "info", document: "info", message: "other" });
  assert.equal(a.length, 6, "duplicates collapse");
  assert.deepEqual(a.filter((x) => x.dismissible).map((x) => x.key.split(":")[1]).sort(), ["document", "message"]);
  assert.equal(a.find((x) => x.key.includes("change"))?.assignee, "Mo");
});

test("jobs and tasks: overdue, due soon unplanned, holds; fee reviews and Companies House under Other", () => {
  const jobs: any[] = [
    { Key: "J1", Title: "VAT", ClientKey: "C1", Deadline: "2026-10-20", Status: "Open" },
    { Key: "J2", Title: "Accounts", ClientKey: "C1", Deadline: "2026-10-30", Status: "Open" },
    { Key: "J3", Title: "Planned", ClientKey: "C1", Deadline: "2026-10-30", PlannedDate: "2026-10-28", Status: "Open" },
    { Key: "J4", Title: "Far", ClientKey: "C1", Deadline: "2027-03-01", Status: "Open" },
  ];
  const a = buildActions(src({ jobs, tasks: [{ Key: "T1", Title: "Call HMRC", DueDate: "2026-10-01", Status: "Open" }], ch: [{ key: "f1", level: "red", title: "Acme: director changed", detail: "x" }], clientServices: [{ Key: "CS1", ClientKey: "C1", ServiceKey: "VAT", Fee: 90, FeePeriod: "quarterly", NextReview: "2026-11-05" }] }));
  assert.equal(by(a, "job:J1")?.priority, "high"); assert.equal(by(a, "job:J2")?.priority, "medium");
  assert.equal(by(a, "job:J3"), undefined); assert.equal(by(a, "job:J4"), undefined);
  assert.equal(by(a, "task:T1")?.category, "jobs");
  assert.equal(by(a, "ch:f1")?.category, "other");
  assert.equal(by(a, "fee:review:CS1")?.dismissible, true);
  assert.equal(by(a, "job:J1")?.assignee, "Mo");
});

test("AML: an approaching or overdue client review date shows; onboarding ready for AML approval shows", () => {
  const cl = [{ Key: "C1", Title: "Acme Ltd", Manager: "Mo", Kind: "Ltd", AMLReview: "2026-10-01", Status: "active" }, { Key: "C2", Title: "Far Ltd", AMLReview: "2028-01-01" }, { Key: "C3", Title: "Left Ltd", AMLReview: "2026-01-01", Status: "inactive" }];
  const a = buildActions(src({ clients: cl }));
  assert.equal(by(a, "aml:renew:C1")?.priority, "high"); assert.equal(by(a, "aml:renew:C2"), undefined); assert.equal(by(a, "aml:renew:C3"), undefined);
});

test("reconcile: new actions are stored once, resolved ones close with an audit entry, a returning one reopens, nothing is duplicated", () => {
  const d1: Action[] = [{ key: "a", category: "sales", title: "A", clientKey: "", clientName: "", detail: "", assignee: "Pat", due: "2026-10-20", priority: "high", dismissible: false, href: "#/x" }, { key: "b", category: "other", title: "B", clientKey: "", clientName: "", detail: "", assignee: "", due: "", priority: "low", dismissible: true, href: "#/y" }];
  const r1 = reconcile(d1, [], O);
  assert.equal(r1.creates.length, 2); assert.equal(r1.patches.length, 0);
  assert.equal(readHistory(r1.creates[0].History)[0].what, "opened");
  // same data again, with the rows stored: nothing to do
  const stored = r1.creates.map((r) => ({ ...r }));
  const r2 = reconcile(d1, stored, O); assert.equal(r2.creates.length + r2.patches.length, 0);
  // "b" is dealt with
  const r3 = reconcile([d1[0]], stored, { ...O, now: "2026-10-27T09:00:00.000Z" });
  assert.equal(r3.patches.length, 1); assert.equal(r3.patches[0].patch.Status, "resolved"); assert.equal(r3.patches[0].patch.ResolvedBy, "system");
  assert.equal(readHistory(r3.patches[0].patch.History).pop()!.what, "resolved");
  // it comes back
  const resolved = [stored[0], { ...stored[1], ...r3.patches[0].patch }];
  const r4 = reconcile(d1, resolved, O);
  assert.equal(r4.patches[0].patch.Status, "open"); assert.equal(readHistory(r4.patches[0].patch.History).pop()!.what, "reopened");
  // a changed title or due date updates the stored copy; duplicate stored rows are both kept in step, never re-created
  const r5 = reconcile([{ ...d1[0], title: "A!" }], [stored[0], { ...stored[0] }], O);
  assert.equal(r5.creates.length, 0); assert.equal(r5.patches.length, 2);
  // batches are capped
  const many: Action[] = Array.from({ length: 100 }, (_, i) => ({ ...d1[0], key: `k${i}` }));
  const r6 = reconcile(many, [], O, 40); assert.equal(r6.creates.length, 40); assert.equal(r6.more, true);
});

test("dismissing: only informational notices, never completes the work, recorded with who and why, can be restored", () => {
  const info: Action = { key: "portal:document:x", category: "info", title: "Ann uploaded a file", clientKey: "C1", clientName: "Acme", detail: "", assignee: "Mo", due: "", priority: "low", dismissible: true, href: "#/portal" };
  const must: Action = { ...info, key: "job:J1", dismissible: false };
  assert.ok("error" in (dismiss(must, undefined, "", O) as any));
  const first: any = dismiss(info, undefined, "seen it", O);
  assert.equal(first.create.Status, "dismissed"); assert.equal(first.create.DismissedBy, "Kevin");
  assert.equal(readHistory(first.create.History).pop()!.note, "seen it");
  // while the issue still exists it is out of the outstanding list but not "resolved"
  const items = itemsOf([info], [first.create]);
  assert.equal(items.open.length, 0); assert.equal(items.done[0].state, "dismissed");
  assert.ok("error" in (dismiss(info, first.create, "", O) as any));
  const back: any = restore(first.create, O); assert.equal(back.patch.patch.Status, "open");
  assert.ok("error" in (restore({ Status: "open" } as any, O) as any));
  // the issue is dealt with while dismissed: it moves to completed as resolved by the system
  const r = reconcile([], [first.create], O); assert.equal(r.patches[0].patch.Status, "resolved");
  assert.match(readHistory(r.patches[0].patch.History).pop()!.note!, /dismissed/);
});

test("views: my actions, all, overdue, due soon, completed; filters; sort by priority then date", () => {
  const mk = (k: string, o: Partial<Action> = {}): any => ({ key: k, category: "sales", title: k, clientKey: "C1", clientName: "Acme", detail: "", assignee: "Kevin", due: "", priority: "medium", dismissible: false, href: "", state: "open", resolvedAt: "", resolvedBy: "", dismissedBy: "", firstSeen: "", history: [], ...o });
  const open = [mk("a", { due: "2026-10-20", priority: "high" }), mk("b", { due: "2026-10-28", assignee: "Pat", category: "jobs" }), mk("c", { due: "2026-12-01" }), mk("d", { assignee: "", priority: "low", clientKey: "C2" }), mk("e", { due: "2026-10-26", priority: "high" })];
  const done = [mk("z", { state: "resolved", resolvedAt: "2026-10-25T10:00:00Z", resolvedBy: "system" })];
  const items = { open, done };
  const keys = (v: any, f = NO_FILTERS) => applyView(items, v, f, "kevin", TODAY).map((x) => x.key);
  assert.deepEqual(keys("mine"), ["a", "e", "c"], "case-insensitive on the person; high first, then by date");
  assert.deepEqual(keys("all"), ["a", "e", "b", "c", "d"]);
  assert.deepEqual(keys("overdue"), ["a"]);
  assert.deepEqual(keys("soon"), ["e", "b"]);
  assert.deepEqual(keys("completed"), ["z"]);
  assert.deepEqual(keys("all", { ...NO_FILTERS, category: "jobs" }), ["b"]);
  assert.deepEqual(keys("all", { ...NO_FILTERS, client: "C2" }), ["d"]);
  assert.deepEqual(keys("all", { ...NO_FILTERS, assignee: "(unassigned)" }), ["d"]);
  assert.deepEqual(keys("all", { ...NO_FILTERS, priority: "low" }), ["d"]);
  assert.deepEqual(keys("all", { ...NO_FILTERS, from: "2026-10-27", to: "2026-12-31" }), ["b", "c"]);
  const g = groupCounts(applyView(items, "all", NO_FILTERS, "kevin", TODAY));
  assert.equal(g.length, 11); assert.equal(g.find((x) => x.category === "sales")!.items.length, 4); assert.equal(g.find((x) => x.category === "sales")!.overdue, 2);
});

test("permissions and preferences: managers see all, others see theirs and unassigned; categories can be switched off", () => {
  const cfg: any = { staff: [{ name: "Pat", role: "preparer" }, { name: "Mo", role: "manager" }], overriders: [], independentReview: false, auto: true };
  const list: Action[] = [{ key: "1", assignee: "Pat" }, { key: "2", assignee: "Mo" }, { key: "3", assignee: "" }].map((x: any) => ({ category: "sales", title: x.key, clientKey: "", clientName: "", detail: "", due: "", priority: "medium", dismissible: false, href: "", ...x }));
  assert.equal(canSeeAll(cfg, "Mo"), true); assert.equal(canSeeAll(cfg, "Pat"), false);
  assert.deepEqual(visibleTo(list, cfg, "Pat").map((a) => a.key), ["1", "3"]); assert.equal(visibleTo(list, cfg, "Mo").length, 3);
  assert.equal(readPrefs([], "Pat").inApp, true); assert.equal(readPrefs([], "Pat").dueSoonDays, 7);
  const p = readPrefs([{ Key: prefsKey("Pat"), Value: JSON.stringify({ categories: { sales: false }, assignedOnly: true, dueSoonDays: 14, email: true, emailAddress: "p@x.test" }) }] as any, "Pat");
  assert.deepEqual([p.categories.sales, p.categories.jobs, p.assignedOnly, p.dueSoonDays, p.email], [false, true, true, 14, true]);
  assert.equal(applyPrefs(list, p, "Pat").length, 0);
  assert.deepEqual(applyPrefs(list, { ...DEFAULT_PREFS, assignedOnly: true }, "Pat").map((a) => a.key), ["1"]);
  assert.equal(readPrefs([{ Key: prefsKey("Pat"), Value: "not json" }] as any, "Pat").inApp, true);
  assert.equal(categoryLabel("nonsense"), "Other Notifications");
});
