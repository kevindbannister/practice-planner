import { test } from "node:test";
import assert from "node:assert/strict";
import * as C from "../src/lib/checklist.ts";
import { STARTERS, starterFor } from "../src/lib/checklistStarters.ts";

const NOW = "2026-10-24T10:00:00.000Z";
const cfg: C.Config = { staff: [{ name: "Pat", role: "preparer" }, { name: "Rae", role: "reviewer" }, { name: "Mo", role: "manager" }, { name: "Pam", role: "partner" }], overriders: [], independentReview: true, auto: true };
const item = (id: string, o: Partial<C.TItem> = {}): C.TItem => ({ id, title: id, mandatory: true, hours: 1, after: [], ...o });
const tpl = (sections: C.TItem[][], o: Partial<C.Template> = {}): C.Template => ({
  id: "T1", name: "Test", description: "", jobType: "svc", clientKinds: [], version: 1, active: true, isDefault: true, hours: 0,
  sections: sections.map((items, n) => ({ id: `s${n}`, title: `Section ${n + 1}`, items })), ...o,
});
const facts = (o: Partial<C.Facts> = {}): C.Facts => ({ kind: "Ltd", vat: "yes", payroll: "no", fixedAssets: "unknown", dormant: "no", outsourced: "no", ...o });
const build = (t: C.Template, f = facts()) => {
  const b = C.generate(t, f, { now: NOW, by: "Pat" });
  return b.items.map((i, n) => ({ ...i, key: `K${n}`, checklistKey: "CL", rev: 1 })) as C.Item[];
};
const ok = (r: unknown): r is C.Change => !!r && typeof r === "object" && "patch" in r;
const merge = (items: C.Item[], key: string, r: C.Change | C.Verdict) => { assert.ok(ok(r), JSON.stringify(r)); return items.map((i) => (i.key === key ? { ...i, ...r.patch } : i)); };

test("templates: validation catches missing names, unknown dependencies and circles", () => {
  assert.deepEqual(C.validateTemplate(tpl([[item("a"), item("b", { after: ["a"] })]])), []);
  assert.ok(C.validateTemplate(tpl([[item("a", { after: ["zzz"] })]])).some((m) => /no longer exists/.test(m)));
  assert.ok(C.validateTemplate(tpl([[item("a", { after: ["b"] }), item("b", { after: ["a"] })]])).some((m) => /circle/.test(m)));
  assert.ok(C.validateTemplate({ name: " ", jobType: "", sections: [] }).length >= 3);
});

test("templates: versions go up only when content or rules change", () => {
  const t = tpl([[item("a")]]);
  const rename = C.saveEdit(t, { name: "Renamed", active: false }, NOW);
  assert.equal(rename.next.version, 1);
  assert.equal(rename.keep, undefined);
  const edit = C.saveEdit(t, { sections: [{ id: "s0", title: "S", items: [item("a"), item("b")] }] }, NOW);
  assert.equal(edit.next.version, 2);
  assert.equal(edit.keep?.version, 1);
  assert.equal(edit.next.hours, 2);
});

test("templates: default selection prefers a matching specific template and respects client type", () => {
  const plain = tpl([[item("a")]], { id: "plain", isDefault: true });
  const dormant = tpl([[item("d")]], { id: "dormant", isDefault: true, when: [{ attr: "dormant", is: true }] });
  const sole = tpl([[item("s")]], { id: "sole", isDefault: true, clientKinds: ["Individual"] });
  const archived = tpl([[item("x")]], { id: "arch", isDefault: true, active: false });
  const all = [plain, dormant, sole, archived];
  assert.equal(C.pickTemplate(all, "svc", facts())?.id, "plain");
  assert.equal(C.pickTemplate(all, "svc", facts({ dormant: "yes" }))?.id, "dormant");
  assert.equal(C.pickTemplate(all, "svc", facts({ dormant: "unknown" }))?.id, "plain");
  assert.equal(C.pickTemplate([sole], "svc", facts())?.id, undefined);
  assert.equal(C.pickTemplate([sole], "svc", facts({ kind: "Individual" }))?.id, "sole");
  assert.equal(C.pickTemplate([archived], "svc", facts()), undefined);
  assert.equal(C.pickTemplate(all, "other", facts()), undefined);
});

test("rules: facts come from the client record, unknown stays unknown, answers fill gaps", () => {
  assert.deepEqual(C.factsFor({ Kind: "Ltd", VATRegistered: "Yes", PAYERef: "123/AB", SIC: "99999" }), { kind: "Ltd", vat: "yes", payroll: "yes", fixedAssets: "unknown", dormant: "yes", outsourced: "unknown" });
  const f = C.factsFor({ Kind: "Ltd" });
  assert.equal(f.vat, "unknown"); assert.equal(f.dormant, "unknown");
  assert.equal(C.factsFor({ VATNumber: "GB123" }).vat, "yes");
  assert.equal(C.factsFor({ Kind: "Ltd" }, { fixedAssetLines: 3 }).fixedAssets, "yes");
  assert.equal(C.factsFor({ Kind: "Ltd" }, { answers: { vat: "no", kind: "yes" } }).vat, "no");
  assert.equal(C.factsFor(undefined).kind, "Individual");
});

test("rules: evaluate treats a missing answer as a question and a clear no as no", () => {
  assert.equal(C.evaluate(undefined, facts()), "yes");
  assert.equal(C.evaluate([{ attr: "vat", is: true }], facts({ vat: "no" })), "no");
  assert.equal(C.evaluate([{ attr: "vat", is: true }], facts({ vat: "unknown" })), "unknown");
  assert.equal(C.evaluate([{ attr: "vat", is: false }], facts({ vat: "no" })), "yes");
  assert.equal(C.evaluate([{ attr: "vat", is: true }, { attr: "payroll", is: true }], facts({ vat: "unknown", payroll: "no" })), "no");
  assert.equal(C.evaluate([{ attr: "kind", in: ["Ltd", "LLP"] }], facts({ kind: "Trust" })), "no");
  assert.deepEqual(C.openQuestions([[{ attr: "vat", is: true }], [{ attr: "dormant", is: true }]], facts({ vat: "unknown" })), ["vat"]);
});

test("generation: conditional items become not applicable or a question, never silently dropped", () => {
  const t = tpl([[item("a", { role: "preparer" }), item("vat", { when: [{ attr: "vat", is: true }] }), item("pay", { when: [{ attr: "payroll", is: true }] }), item("fa", { when: [{ attr: "fixedAssets", is: true }] })]]);
  const b = C.generate(t, facts(), { now: NOW, by: "Pat", roles: { preparer: "Pat" } });
  const by = (id: string) => b.items.find((i) => i.itemId === id)!;
  assert.equal(by("a").status, "todo"); assert.equal(by("a").assignee, "Pat");
  assert.equal(by("vat").status, "todo");
  assert.equal(by("pay").status, "na"); assert.match(by("pay").naReason, /Runs payroll/);
  assert.equal(by("fa").status, "confirm");
  assert.deepEqual(b.questions, ["fixedAssets"]);
  assert.equal(b.items.length, 4);
});

test("generation: the checklist is a snapshot, so later template changes do not touch it", () => {
  const t = tpl([[item("a"), item("b")]]);
  const items = build(t);
  t.sections[0].items[0].title = "Changed";
  t.sections[0].items.push(item("c"));
  assert.deepEqual(items.map((i) => i.title), ["a", "b"]);
});

test("generation: answering a question re-applies the rules to untouched items only", () => {
  const t = tpl([[item("fa", { when: [{ attr: "fixedAssets", is: true }] }), item("pay", { when: [{ attr: "payroll", is: true }] })]]);
  let items = build(t, facts({ fixedAssets: "unknown", payroll: "no" }));
  const changes = C.reapply(items, facts({ fixedAssets: "yes", payroll: "yes" }), NOW, "Pat");
  assert.equal(changes.length, 2);
  for (const c of changes) items = items.map((i) => (i.key === c.key ? { ...i, ...c.patch } : i));
  assert.deepEqual(items.map((i) => i.status), ["todo", "todo"]);
  // a person's own choice is not overridden
  items = merge(items, "K1", C.markNa(items[1], cfg, "Mo", NOW, "client says no"));
  assert.equal(C.reapply(items, facts({ payroll: "yes" }), NOW, "Pat").length, 0);
});

test("dependencies: an item cannot be completed until what it waits for is finished", () => {
  const t = tpl([[item("a"), item("b", { after: ["a"] }), item("c", { after: ["a", "b"] })]]);
  let items = build(t);
  const v = C.canComplete(items[1], items, cfg, "Pat");
  assert.equal(v.ok, false); assert.match(v.reason!, /Waiting for: a/);
  items = merge(items, "K0", C.complete(items[0], items, cfg, "Pat", NOW));
  assert.equal(C.canComplete(items[1], items, cfg, "Pat").ok, true);
  assert.equal(C.canComplete(items[2], items, cfg, "Pat").ok, false);
  // an item set aside as not applicable does not hold others up
  items = merge(items, "K1", C.markNa(items[1], cfg, "Mo", NOW, "not needed"));
  assert.equal(C.canComplete(items[2], items, cfg, "Pat").ok, true);
});

test("completion: records who and when, and reopening keeps the earlier history", () => {
  let items = build(tpl([[item("a")]]));
  items = merge(items, "K0", C.complete(items[0], items, cfg, "Pat", NOW));
  assert.equal(items[0].status, "done"); assert.equal(items[0].completedBy, "Pat"); assert.equal(items[0].completedOn, NOW);
  assert.equal(C.complete(items[0], items, cfg, "Pat", NOW).hasOwnProperty("patch"), false);
  // another preparer may not reopen someone else's work; the person who did it, or a reviewer, may
  assert.equal((C.reopen(items[0], { ...cfg, staff: [...cfg.staff, { name: "Sam", role: "preparer" }] }, "Sam", NOW, "") as C.Verdict).ok, false);
  items = merge(items, "K0", C.reopen(items[0], cfg, "Rae", "2026-10-25T09:00:00.000Z", "figures changed"));
  assert.equal(items[0].status, "todo"); assert.equal(items[0].completedBy, "");
  assert.deepEqual(items[0].history.map((h) => h.action), ["Added", "Completed", "Reopened"]);
  assert.match(items[0].history[2].detail!, /completed by Pat/);
});

test("mandatory items: only an authorised person can set one aside, and only with a reason", () => {
  const items = build(tpl([[item("a"), item("o", { mandatory: false })]]));
  assert.equal((C.markNa(items[0], cfg, "Pat", NOW, "skip") as C.Verdict).ok, false);
  assert.match((C.markNa(items[0], cfg, "Mo", NOW, "  ") as C.Verdict).reason!, /reason/);
  const done = merge(items, "K0", C.markNa(items[0], cfg, "Mo", NOW, "Client asked us not to"));
  assert.equal(done[0].status, "na"); assert.match(done[0].override, /Mo on 2026-10-24: Client asked/);
  assert.equal(done[0].history.at(-1)!.action, "Mandatory override");
  const opt = merge(items, "K1", C.markNa(items[1], cfg, "Pat", NOW, ""));
  assert.equal(opt[1].status, "na");
  // a named overrider list replaces the manager/partner default
  const named = { ...cfg, overriders: ["Rae"] };
  assert.equal(C.can(named, "Rae", "override"), true); assert.equal(C.can(named, "Pam", "override"), false);
});

test("permissions: a one-person practice can do everything; staff are limited by role", () => {
  const solo: C.Config = { staff: [], overriders: [], independentReview: false, auto: true };
  for (const a of ["complete", "approve", "override", "reopen", "template", "reassign", "review"] as const) assert.equal(C.can(solo, "Anyone", a), true);
  assert.equal(C.can(cfg, "Pat", "approve"), false); assert.equal(C.can(cfg, "Rae", "approve"), true);
  assert.equal(C.can(cfg, "Pat", "template"), false); assert.equal(C.can(cfg, "Mo", "template"), true);
  assert.equal(C.can(cfg, "Stranger", "complete"), true); assert.equal(C.can(cfg, "Stranger", "review"), false);
});

test("review and sign-off: independence, review rights and open points are enforced", () => {
  const t = tpl([[item("p"), item("rev", { review: "review", after: ["p"], role: "reviewer" }), item("ap", { review: "approve", after: ["rev"] })]]);
  let items = build(t);
  assert.equal((C.canComplete(items[1], items, cfg, "Pat") as C.Verdict).ok, false);
  items = merge(items, "K0", C.complete(items[0], items, cfg, "Pat", NOW));
  assert.match((C.canComplete(items[1], items, cfg, "Pat", { preparedBy: "Pat" }).reason!), /Only a reviewer/);
  const sub = C.submitForReview(items, "Pat", NOW) as { sign: C.Sign };
  assert.equal(sub.sign.preparedBy, "Pat");
  // a preparer who is also a reviewer cannot review their own work when independence is on
  const dual: C.Config = { ...cfg, staff: [...cfg.staff, { name: "Dee", role: "reviewer" }] };
  assert.match(C.canComplete(items[1], items, dual, "Dee", { preparedBy: "Dee" }).reason!, /prepared the work/);
  items = merge(items, "K1", C.complete(items[1], items, cfg, "Rae", NOW, { preparedBy: "Pat" }));
  assert.match((C.approve(items, cfg, "Pat", NOW, { preparedBy: "Pat" }, 0) as C.Verdict).reason!, /Only a reviewer/);
  assert.match((C.approve(items, dual, "Dee", NOW, { preparedBy: "Dee" }, 0) as C.Verdict).reason!, /someone else/);
  assert.match((C.approve(items, cfg, "Rae", NOW, { preparedBy: "Pat" }, 2) as C.Verdict).reason!, /2 review points are still open/);
  const good = C.approve(items.map((i) => (i.itemId === "ap" ? { ...i, status: "done" as const } : i)), cfg, "Rae", NOW, { preparedBy: "Pat" }, 0) as { sign: C.Sign };
  assert.equal(good.sign.approvedBy, "Rae");
});

test("submit for review waits for confirmations and preparation items", () => {
  const items = build(tpl([[item("p"), item("q", { when: [{ attr: "fixedAssets", is: true }] }), item("r", { review: "review" })]]));
  assert.match((C.submitForReview(items, "Pat", NOW) as C.Verdict).reason!, /Confirm which items apply/);
  const confirmed = merge(items, "K1", C.confirmItem(items[1], false, "Pat", NOW));
  assert.match((C.submitForReview(confirmed, "Pat", NOW) as C.Verdict).reason!, /1 mandatory preparation item is still open/);
});

test("review notes: raise, respond, resolve and reopen follow the rules and keep a trail", () => {
  assert.equal(C.raiseNote("Check the accruals", cfg, "Pat").ok, false);
  assert.equal(C.raiseNote("", cfg, "Rae").ok, false);
  assert.equal(C.raiseNote("Check the accruals", cfg, "Rae").ok, true);
  let n: C.ReviewNote = { key: "N1", checklistKey: "CL", itemKey: "K0", text: "Check the accruals", raisedBy: "Rae", raisedOn: NOW, status: "open", response: "", respondedBy: "", resolvedBy: "", resolvedOn: "", history: [], rev: 1 };
  assert.equal((C.respondNote(n, "", "Pat", NOW) as C.Verdict).ok, false);
  n = { ...n, ...(C.respondNote(n, "Accrued £250", "Pat", NOW) as { patch: Partial<C.ReviewNote> }).patch };
  assert.equal(n.status, "ready"); assert.equal(C.openNoteCount([n]), 1);
  assert.equal((C.resolveNote(n, cfg, "Pat", NOW) as C.Verdict).ok, false);
  n = { ...n, ...(C.reopenNote(n, cfg, "Rae", NOW, "still wrong") as { patch: Partial<C.ReviewNote> }).patch };
  assert.equal(n.status, "open");
  n = { ...n, ...(C.respondNote(n, "Fixed", "Pat", NOW) as { patch: Partial<C.ReviewNote> }).patch };
  n = { ...n, ...(C.resolveNote(n, cfg, "Rae", NOW) as { patch: Partial<C.ReviewNote> }).patch };
  assert.equal(n.status, "resolved"); assert.equal(C.openNoteCount([n]), 0);
  assert.deepEqual(n.history.map((h) => h.action), ["Ready for re-review", "Reopened", "Ready for re-review", "Resolved"]);
  assert.equal(n.rev, 5);
});

test("progress: not-applicable items are excluded, confirm items count as outstanding", () => {
  let items = build(tpl([[item("a", { hours: 2 }), item("b", { hours: 1 }), item("c", { when: [{ attr: "payroll", is: true }] }), item("d", { when: [{ attr: "fixedAssets", is: true }] }), item("o", { mandatory: false, hours: 0.5 })]]));
  let p = C.progress(items, "2026-10-24");
  assert.equal(p.total, 4); assert.equal(p.done, 0); assert.equal(p.confirm, 1);
  items = merge(items, "K0", C.complete(items[0], items, cfg, "Pat", NOW));
  p = C.progress(items, "2026-10-24");
  assert.equal(p.done, 1); assert.equal(p.pct, 25); assert.equal(p.hoursLeft, 2.5); // b, the item to confirm, and the optional item
  assert.equal(p.readyToComplete, false);
  assert.deepEqual(p.mandatoryOpen.map((i) => i.itemId), ["b", "d"]);
  assert.equal(C.progress([], "2026-10-24").pct, 0);
});

test("progress: blocked items, overdue items and what the job still needs", () => {
  let items = build(tpl([[item("a"), item("b")]]));
  items = items.map((i) => ({ ...i, due: "2026-10-01" }));
  items = merge(items, "K0", C.setStatus(items[0], "blocked", "Pat", NOW, "Waiting for bank statements"));
  const p = C.progress(items, "2026-10-24");
  assert.equal(p.blocked.length, 1); assert.equal(p.overdue.length, 2);
  assert.match((C.setStatus(items[1], "blocked", "Pat", NOW, "") as C.Verdict).reason!, /blocked on/);
  const blockers = C.jobBlockers(items, 1);
  assert.ok(blockers.some((b) => /Mandatory: a/.test(b))); assert.ok(blockers.some((b) => /1 review point/.test(b)));
  assert.deepEqual(C.jobBlockers(build(tpl([[item("x", { mandatory: false })]])).map((i) => ({ ...i, status: "todo" as const }))), []);
});

test("updating to a newer template: the preview and the change leave finished work alone", () => {
  const v1 = tpl([[item("a"), item("b"), item("c")]]);
  let items = build(v1);
  items = merge(items, "K0", C.complete(items[0], items, cfg, "Pat", NOW));
  items = merge(items, "K1", C.setStatus(items[1], "doing", "Pat", NOW));
  const v2 = tpl([[{ ...item("a"), title: "A renamed", mandatory: false }, item("b"), item("d")]], { version: 2 });
  const d = C.diffTemplate(items, v2);
  assert.deepEqual(d.added.map((i) => i.id), ["d"]);
  assert.deepEqual(d.removed.map((i) => i.itemId), ["c"]);
  assert.equal(d.changed.length, 1);
  const out = C.applyDiff(items, v2, facts(), { now: NOW, by: "Mo", checklistKey: "CL" });
  assert.equal(out.create.length, 1); assert.equal(out.create[0].itemId, "d"); assert.equal(out.create[0].seq, 3);
  const patched = (k: string) => out.patch.find((p) => p.key === k)?.patch;
  assert.equal(patched("K0"), undefined); // completed: untouched
  assert.equal(patched("K2")?.gone, true); // untouched and removed: dropped
  const keepStarted = C.applyDiff(items.map((i) => (i.key === "K2" ? { ...i, status: "doing" as const } : i)), v2, facts(), { now: NOW, by: "Mo", checklistKey: "CL" });
  assert.equal(keepStarted.patch.find((p) => p.key === "K2")?.patch.gone, undefined); // work started: kept
});

test("working papers: a Done status completes the linked item, an opened or unfinished paper does not", () => {
  const t = tpl([[item("bank", { paper: { section: "bank" } }), item("rev", { paper: { section: "final-tb" }, review: "review" }), item("tb", { paper: { section: "tb" } })]]);
  const items = build(t);
  const papers = [
    { ClientKey: "C1", PeriodEnd: "2026-03-31", ItemKey: "bank", Status: "done", PreparedBy: "Pat", PreparedOn: "2026-10-01" },
    { ClientKey: "C1", PeriodEnd: "2026-03-31", ItemKey: "final-tb", Status: "done", PreparedBy: "Pat" },
    { ClientKey: "C1", PeriodEnd: "2026-03-31", ItemKey: "tb", Status: "doing", PreparedBy: "Pat" },
    { ClientKey: "C2", PeriodEnd: "2026-03-31", ItemKey: "tb", Status: "done" },
  ];
  const r = C.paperCompletions(items, papers, "C1", "2026-03-31");
  assert.deepEqual(r.map((x) => x.item.itemId), ["bank"]);
  assert.equal(r[0].by, "Pat");
  const reviewed = C.paperCompletions(items, [...papers, { ClientKey: "C1", PeriodEnd: "2026-03-31", ItemKey: "final-tb", Status: "done", ReviewedBy: "Rae", ReviewedOn: "2026-10-02" }].slice(0, 1).concat([{ ClientKey: "C1", PeriodEnd: "2026-03-31", ItemKey: "final-tb", Status: "done", ReviewedBy: "Rae", ReviewedOn: "2026-10-02" }]), "C1", "2026-03-31");
  assert.ok(reviewed.some((x) => x.item.itemId === "rev" && x.by === "Rae"));
});

test("export and import: round trip, and damaged files are refused whole", () => {
  const t = tpl([[item("a", { when: [{ attr: "vat", is: true }], after: [] }), item("b", { after: ["a"], paper: { section: "bank" } })]], { clientKinds: ["Ltd"], name: "Mine" });
  const text = C.exportTemplates([t]);
  const back = C.importTemplates(text);
  assert.equal(back.error, undefined);
  assert.equal(back.templates[0].name, "Mine");
  assert.deepEqual(back.templates[0].sections[0].items.map((i) => i.id), ["a", "b"]);
  assert.deepEqual(back.templates[0].sections[0].items[1].after, ["a"]);
  assert.match(C.importTemplates("not json").error!, /valid JSON/);
  assert.match(C.importTemplates(JSON.stringify({ format: "other", templates: [] })).error!, /isn't a checklist template export/);
  assert.match(C.importTemplates(JSON.stringify({ format: C.EXPORT_FORMAT, templates: [{ name: 1 }] })).error!, /damaged/);
});

test("a template can be made from a job's checklist", () => {
  const items = build(tpl([[item("a", { role: "preparer" }), item("b", { after: ["a"] })]]));
  const t = C.templateFromItems(items.map((i) => ({ ...i, notes: "private", completedBy: "Pat" })), "From job", "svc");
  assert.equal(t.sections[0].items.length, 2);
  assert.ok(!JSON.stringify(t).includes("private")); assert.ok(!JSON.stringify(t).includes("Pat"));
  assert.deepEqual(C.validateTemplate(t), []);
});

test("starter templates: all ten are valid, sensible and cover the conditional cases", () => {
  assert.equal(STARTERS.length, 11); // ten workflows plus the dormant-company variant
  for (const s of STARTERS) {
    assert.deepEqual(C.validateTemplate({ name: s.name, jobType: "x", sections: s.sections }), [], s.name);
    assert.ok(s.hours > 0, s.name);
    assert.ok(C.allItems(s).some((i) => i.review === "approve" || i.review === "review") || /onboarding|confirmation/i.test(s.name), `${s.name} has a review step`);
  }
  const ltd = STARTERS.find((s) => s.starter === "ltd-accounts")!;
  const names = C.allItems(ltd).map((i) => i.title);
  for (const need of ["Confirm accounting period", "Reconcile bank balances", "VAT reconciliation", "Payroll reconciliation", "Calculate depreciation", "Obtain reviewer approval", "Close the job"]) assert.ok(names.includes(need), need);
  const b = C.generate({ ...ltd, id: "x", jobType: "x", version: 1, active: true, isDefault: true }, facts({ vat: "yes", payroll: "no", fixedAssets: "unknown", outsourced: "no" }), { now: NOW, by: "t" });
  const st = (title: string) => b.items.find((i) => i.title === title)!.status;
  assert.equal(st("VAT reconciliation"), "todo"); assert.equal(st("Payroll reconciliation"), "na"); assert.equal(st("Calculate depreciation"), "confirm"); assert.equal(st("Send records to the outsourced preparer"), "na");
  assert.deepEqual(b.questions, ["fixedAssets"]);
  assert.equal(starterFor("Limited company accounts", "Ltd")?.starter, "ltd-accounts");
  assert.equal(starterFor("Limited company accounts", "Ltd", true)?.starter, "dormant-accounts");
  assert.equal(starterFor("Corporation tax return", "Ltd")?.starter, "ct");
  assert.equal(starterFor("Self assessment tax return", "Individual")?.starter, "sa");
  assert.equal(starterFor("VAT returns", "Ltd")?.starter, "vat");
  assert.equal(starterFor("Confirmation statement", "Ltd")?.starter, "confirmation");
  assert.equal(starterFor("Payroll", "Ltd")?.starter, "payroll");
  assert.equal(starterFor("Gardening", "Ltd"), undefined);
});

test("dashboards: summaries and workload agree with progress", () => {
  const items = build(tpl([[item("a", { role: "preparer", hours: 2 }), item("b", { after: ["a"] })]]));
  const assigned = items.map((i, n) => ({ ...i, assignee: n ? "Rae" : "Pat" }));
  const sum = C.summarise([{ key: "CL", jobKey: "J1", clientKey: "C1", jobType: "svc", status: "active" }], assigned, "2026-10-24");
  assert.equal(sum[0].p.total, 2); assert.deepEqual(sum[0].assignees.sort(), ["Pat", "Rae"]);
  const w = C.workload(assigned);
  assert.deepEqual(w.map((x) => [x.who, x.open]).sort(), [["Pat", 1], ["Rae", 1]]);
  assert.equal(C.workload(items).at(0)!.who, "Unassigned");
});

test("reassignment is recorded and permissioned", () => {
  const items = build(tpl([[item("a")]]));
  const r = C.assign(items[0], "Rae", cfg, "Mo", NOW);
  assert.ok(ok(r)); assert.equal(r.patch.assignee, "Rae"); assert.equal(r.entry.action, "Responsibility changed");
  assert.equal((C.assign({ ...items[0], assignee: "Rae" }, "Rae", cfg, "Mo", NOW) as C.Verdict).ok, false);
});

test("config reading survives damaged settings", () => {
  assert.deepEqual(C.readConfig([]), C.DEFAULT_CONFIG);
  assert.deepEqual(C.readConfig([{ Key: C.CONFIG_KEY, Value: "{not json" }]), C.DEFAULT_CONFIG);
  const c = C.readConfig([{ Key: C.CONFIG_KEY, Value: JSON.stringify({ staff: [{ name: " Pat ", role: "weird" }, { name: "" }], independentReview: true }) }]);
  assert.deepEqual(c.staff, [{ name: "Pat", role: "preparer" }]); assert.equal(c.independentReview, true);
});

test("large checklists stay fast", () => {
  const items = Array.from({ length: 400 }, (_, n) => item(`i${n}`, { after: n ? [`i${n - 1}`] : [] }));
  const t0 = Date.now();
  const built = build(tpl([items]));
  for (let n = 0; n < 50; n++) C.progress(built, "2026-10-24");
  assert.equal(C.canComplete(built[399], built, cfg, "Pat").ok, false);
  assert.ok(Date.now() - t0 < 1500);
});

test("hand-over sequence: review waits for submission, work after the review doesn't block it, and approval doesn't wait for filing", () => {
  const t = tpl([[
    item("p1"), item("p2", { after: ["p1"] }),
    item("rev", { review: "review", after: ["p2"] }), item("fix", { after: ["rev"] }), item("ok", { review: "approve", after: ["fix"] }),
    item("file", { after: ["ok"] }), item("close", { after: ["file"] }),
  ]]);
  let items = build(t);
  // nothing can be reviewed while the checklist is still with the preparer
  items = merge(items, "K0", C.complete(items[0], items, cfg, "Pat", NOW, { status: "active" }));
  items = merge(items, "K1", C.complete(items[1], items, cfg, "Pat", NOW, { status: "active" }));
  assert.match(C.canComplete(items[2], items, cfg, "Rae", { preparedBy: "Pat", status: "active" }).reason!, /Submit the checklist for review first/);
  // the fix, approval, filing and closing steps come after the review, so only p1 and p2 hold up the hand-over
  assert.equal(C.progress(items, "2026-10-24").prepOpen, 0);
  assert.equal(C.progress(items, "2026-10-24").readyForReview, true);
  assert.ok("sign" in C.submitForReview(items, "Pat", NOW));
  // once submitted the reviewer can work
  items = merge(items, "K2", C.complete(items[2], items, cfg, "Rae", NOW, { preparedBy: "Pat", status: "review" }));
  items = merge(items, "K3", C.complete(items[3], items, cfg, "Pat", NOW, { preparedBy: "Pat", status: "review" }));
  items = merge(items, "K4", C.complete(items[4], items, cfg, "Rae", NOW, { preparedBy: "Pat", status: "review" }));
  // approval is allowed with filing and closing still to do
  const a = C.approve(items.map((i) => (i.itemId === "ok" ? i : i)), cfg, "Rae", NOW, { preparedBy: "Pat" }, 0);
  assert.ok("sign" in a, JSON.stringify(a));
  // after approval, items after it can still be completed
  assert.equal(C.canComplete(items[5], items, cfg, "Pat", { preparedBy: "Pat", status: "approved" }).ok, true);
  assert.equal(C.descendsFrom(items[6], items, (i) => i.review === "approve"), true);
  assert.equal(C.descendsFrom(items[0], items, (i) => i.review === "approve"), false);
});
