import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { SEED_DECISIONS, SEED_FEATURES, SEED_INTEGRATIONS, SEED_MILESTONES, SEED_ROADMAP } from "../src/lib/devHubSeed";
import {
  API_STATUSES, COLUMNS, STATUSES, addLog, attention, buildTree, columnFromIssue, countStatuses, duplicateIssue, dueFollowUps, evidenceOf, featuresUnder,
  filterFeatures, isDevAdmin, issueRefs, labelsForColumn, leaves, looksSecret, mergeDecisions, mergeFeatures, mergeIntegrations, outstanding, priorityFromTitle,
  progressOf, resolveFile, reviseDecision, rollup, tasksFrom, type Issue,
} from "../src/lib/devHub";

const ROOT = resolve(import.meta.dirname, "../..");

test("every file the inventory points at exists in the repository", () => {
  const missing: string[] = [];
  for (const f of SEED_FEATURES) for (const p of [...f.files, ...f.tests]) if (!existsSync(resolve(ROOT, resolveFile(p)))) missing.push(`${f.id}: ${resolveFile(p)}`);
  assert.deepEqual(missing, []);
});

test("feature ids are unique and every parent, dependency and roadmap reference exists", () => {
  const ids = new Set(SEED_FEATURES.map((f) => f.id));
  assert.equal(ids.size, SEED_FEATURES.length);
  const integ = new Set(SEED_INTEGRATIONS.map((i) => i.id));
  for (const f of SEED_FEATURES) {
    if (f.parent) assert.ok(ids.has(f.parent), `${f.id} parent ${f.parent}`);
    for (const d of f.deps) assert.ok(ids.has(d) || integ.has(d), `${f.id} dep ${d}`);
  }
  for (const p of SEED_ROADMAP) for (const i of p.items) for (const id of i.features) assert.ok(ids.has(id), `${p.id}/${i.name}: ${id}`);
  for (const i of SEED_INTEGRATIONS) for (const id of i.features) assert.ok(ids.has(id), `${i.id}: ${id}`);
});

test("the hierarchy is Area > Module > Feature, with the three agreed areas", () => {
  const roots = buildTree(SEED_FEATURES);
  assert.deepEqual(roots.map((r) => r.f.name), ["Practice", "Work", "Advise"]);
  for (const r of roots) for (const m of r.children) { assert.equal(m.kind, "module"); assert.ok(m.children.length > 0, `${m.f.id} has no features`); }
});

test("every module the brief names is present", () => {
  const names = new Set(SEED_FEATURES.map((f) => f.name));
  for (const n of ["Dashboard", "Planning", "Action Centre", "Clients and groups", "Jobs", "Checklists", "Communications", "Client portal", "Sales and onboarding", "Fees and billing", "Practice operations",
    "Bookkeeping", "Monthly reconciliations", "Working papers", "Accounts preparation", "Personal tax", "Corporation tax", "VAT and CIS", "Payroll", "Company secretarial", "Documents", "Statutory filing",
    "Financial reporting", "KPIs", "Cash-flow forecasting", "Profitability analysis", "Budgets and forecasts", "Advisory planning", "Tax planning", "Management reports", "Client advisory opportunities"]) assert.ok(names.has(n), n);
});

test("nothing is marked Complete or given a made-up percentage without evidence", () => {
  for (const f of SEED_FEATURES) { assert.notEqual(f.status, "Complete", f.id); assert.equal(f.completion, undefined, f.id); assert.equal(evidenceOf(f) === "live", false); }
  for (const f of SEED_FEATURES) assert.ok(STATUSES.includes(f.status));
});

test("a feature with no automated tests is never reported as Ready for Testing by the seed", () => {
  for (const f of SEED_FEATURES) if (f.status === "Ready for Testing") assert.ok(f.tests.length > 0, f.id);
});

test("counts, roll-ups and attention list work from the leaves", () => {
  const c = countStatuses(SEED_FEATURES);
  assert.equal(c.total, leaves(SEED_FEATURES).length);
  assert.equal(Object.values(c.byStatus).reduce((a, b) => a + b, 0), c.total);
  const roots = buildTree(SEED_FEATURES);
  const deliver = roots[1];
  assert.equal(rollup(deliver), "Blocked");
  const att = attention(SEED_FEATURES, 5);
  assert.equal(att.length, 5);
  assert.ok(["Blocked", "Broken"].includes(att[0].status));
});

test("edits overlay the seed without changing it, and extra features can be added or hidden", () => {
  const seed = SEED_FEATURES;
  const m = mergeFeatures(seed, { edits: { "run.dash.today": { status: "Testing", notes: "n", completion: 40 } }, custom: [{ ...seed[3], id: "x.new", name: "New one", custom: true }], removed: ["run.dash.practice"] });
  assert.equal(m.find((f) => f.id === "run.dash.today")!.status, "Testing");
  assert.equal(m.find((f) => f.id === "run.dash.today")!.completion, 40);
  assert.equal(seed.find((f) => f.id === "run.dash.today")!.status, "Ready for Testing");
  assert.ok(m.find((f) => f.id === "x.new"));
  assert.ok(!m.find((f) => f.id === "run.dash.practice"));
  const live = mergeFeatures(seed, { edits: { "run.dash.today": { live: { on: "2026-11-07", by: "K", note: "Checked on BCK" } } }, custom: [] });
  assert.equal(evidenceOf(live.find((f) => f.id === "run.dash.today")!), "live");
});

test("filtering by text, status, priority and area", () => {
  assert.ok(filterFeatures(SEED_FEATURES, { q: "xero" }).length >= 3);
  assert.ok(filterFeatures(SEED_FEATURES, { status: "Blocked" }).every((f) => f.status === "Blocked"));
  assert.ok(filterFeatures(SEED_FEATURES, { priority: "P4" }).every((f) => f.priority === "P4"));
  assert.ok(filterFeatures(SEED_FEATURES, { area: "grow" }).every((f) => f.id.startsWith("grow")));
});

test("roadmap progress counts only what has been checked", () => {
  const p1 = SEED_ROADMAP[0];
  const fs = featuresUnder(SEED_FEATURES, p1.items.flatMap((i) => i.features));
  const pr = progressOf(fs);
  assert.ok(pr.total > 0); assert.equal(pr.complete, 0);
  assert.deepEqual(SEED_ROADMAP.map((r) => r.id), ["P1", "P2", "P3", "P4", "P5"]);
});

test("GitHub issues turn into board columns, and moving a card changes only the status labels", () => {
  const mk = (state: "open" | "closed", labels: string[]): Issue => ({ number: 1, title: "[P1] x", state, labels, url: "", body: "", updated: "" });
  assert.equal(columnFromIssue(mk("open", [])), "Backlog");
  assert.equal(columnFromIssue(mk("open", ["status:ready"])), "Ready");
  assert.equal(columnFromIssue(mk("open", ["status:in-progress", "bug"])), "In Progress");
  assert.equal(columnFromIssue(mk("open", ["blocked"])), "Blocked");
  assert.equal(columnFromIssue(mk("open", ["status:testing"])), "Testing");
  assert.equal(columnFromIssue(mk("closed", ["status:ready"])), "Done");
  assert.deepEqual(labelsForColumn(["bug", "status:ready"], "In Progress"), ["bug", "status:in-progress"]);
  assert.deepEqual(labelsForColumn(["bug", "status:ready", "blocked"], "Backlog"), ["bug"]);
  assert.equal(COLUMNS.length, 6);
  assert.equal(priorityFromTitle("[P3] Connect planning"), "P3");
  assert.equal(priorityFromTitle("[Access] Start"), "Access");
  assert.equal(priorityFromTitle("Plain"), "None");
});

test("a move GitHub hasn't confirmed is shown as unsynced rather than silently kept", () => {
  const i: Issue = { number: 4, title: "[P1] a", state: "open", labels: [], url: "", body: "", updated: "" };
  const t = tasksFrom([i], { meta: { "4": { pending: "In Progress", error: "403" } } })[0];
  assert.equal(t.column, "In Progress"); assert.equal(t.synced, false);
  assert.equal(tasksFrom([i], undefined)[0].synced, true);
});

test("issue references in commits and pull requests are found", () => {
  assert.deepEqual(issueRefs("Fix save (#4), refs #6 and fixes #10"), [4, 6, 10]);
  assert.deepEqual(issueRefs("colour #fff and C#"), []);
});

test("a new issue is refused if one with the same title already exists", () => {
  const issues: Issue[] = [{ number: 4, title: "[P1] Validate M365 / SharePoint reliability", state: "open", labels: [], url: "", body: "", updated: "" }];
  assert.equal(duplicateIssue("validate  m365 / sharepoint reliability", issues)?.number, 4);
  assert.equal(duplicateIssue("[P2] Something else", issues), undefined);
});

test("the approvals tracker covers the required providers and keeps secrets out", () => {
  const names = SEED_INTEGRATIONS.map((i) => `${i.provider} ${i.service}`).join("|");
  for (const s of ["XML Vendor ID", "External Test Service", "Developer Hub", "Production API", "Software filing test account", "Presenter or credit", "OAuth application", "API access"]) assert.ok(names.includes(s), s);
  assert.equal(SEED_INTEGRATIONS.length >= 9, true);
  for (const i of SEED_INTEGRATIONS) { assert.ok(API_STATUSES.includes(i.status)); assert.equal(i.expected, undefined); assert.equal(i.submitted, undefined); }
  assert.equal(outstanding(SEED_INTEGRATIONS).length, SEED_INTEGRATIONS.length);
  assert.ok(looksSecret("password: hunter22x")); assert.ok(looksSecret("ghp_abcdefghijklmnopqrstuvwxyz0123456789")); assert.ok(!looksSecret("Ref 12345, ask for the test pack"));
  const m = mergeIntegrations(SEED_INTEGRATIONS, { edits: { "acc.xero": { status: "Operational", followUp: "2026-12-01" } }, custom: [] });
  assert.equal(m.find((i) => i.id === "acc.xero")!.status, "Operational");
  assert.equal(dueFollowUps(m.map((i) => ({ ...i, followUp: i.id === "acc.xama" ? "2026-11-01" : undefined })), "2026-11-06").length, 1);
});

test("decisions keep their history when changed", () => {
  const d = SEED_DECISIONS.find((x) => x.id === "dec.db")!;
  assert.equal(SEED_DECISIONS.length >= 4, true);
  const next = reviseDecision(d, { ...d.current, decision: "Migrate in 2027", why: "stable", by: "K" }, "2027-01-01");
  assert.equal(next.history.length, 1); assert.equal(next.history[0].decision, d.current.decision); assert.equal(next.current.on, "2027-01-01");
  assert.equal(reviseDecision(d, { ...d.current, by: "K" }, "2027-01-01"), d);
  assert.equal(mergeDecisions(SEED_DECISIONS, { edits: { "dec.db": next }, custom: [] }).find((x) => x.id === "dec.db")!.history.length, 1);
});

test("administrator check: open until a list is set, then only the list", () => {
  assert.deepEqual(isDevAdmin(undefined, "a@b.com"), { allowed: true, open: true });
  assert.deepEqual(isDevAdmin(undefined, undefined), { allowed: false, open: true });
  assert.equal(isDevAdmin({ emails: ["A@b.com"] }, "a@b.com").allowed, true);
  assert.equal(isDevAdmin({ emails: ["a@b.com"] }, "c@d.com").allowed, false);
});

test("the change log is capped and newest first", () => {
  let l = addLog(undefined, { at: "1", by: "k", what: "a" }, 2);
  l = addLog(l, { at: "2", by: "k", what: "b" }, 2); l = addLog(l, { at: "3", by: "k", what: "c" }, 2);
  assert.deepEqual(l.map((x) => x.what), ["c", "b"]);
});

test("milestones are seeded without invented dates", () => {
  assert.ok(SEED_MILESTONES.length >= 1);
  for (const m of SEED_MILESTONES) assert.equal(m.target, undefined);
});
