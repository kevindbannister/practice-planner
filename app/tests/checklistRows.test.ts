import { test } from "node:test";
import assert from "node:assert/strict";
import * as R from "../src/lib/checklistRows.ts";
import * as C from "../src/lib/checklist.ts";

const NOW = "2026-10-24T10:00:00.000Z";
const client = { Key: "C1", Title: "Acme Ltd", Kind: "Ltd", VATRegistered: "Yes", PAYERef: "", Partner: "Pam", Manager: "Mo", SIC: "62012" };
const job = (k: string, period: string, extra = {}) => ({ Key: k, ClientKey: "C1", ServiceKey: "svc-accts", PeriodEnd: period, Deadline: "2027-01-31", InternalDeadline: "2027-01-15", ...extra });
const item = (id: string, o: Partial<C.TItem> = {}): C.TItem => ({ id, title: id, mandatory: true, hours: 1, after: [], ...o });
const tpl = (o: Partial<C.Template> = {}): C.Template => ({ id: "T1", name: "Mine", description: "", jobType: "svc-accts", clientKinds: [], version: 3, active: true, isDefault: true, hours: 0, sections: [{ id: "s", title: "S", items: [item("a", { role: "preparer" }), item("o", { role: "owner" }), item("v", { when: [{ attr: "vat", is: true }] }), item("p", { when: [{ attr: "payroll", is: true }] })] }], ...o });
const base = { client, serviceName: "Limited company accounts", templates: [tpl()], paperLines: [], checklists: [] as Record<string, unknown>[], now: NOW, user: "Pat", pid: "default" };

test("a new job gets the default template's checklist with defaults assigned and linked to the job", () => {
  const plan = R.planChecklist({ ...base, job: job("J1", "2026-03-31") })!;
  assert.equal(plan.checklist.Key, "CL-J1"); assert.equal(plan.checklist.JobKey, "J1"); assert.equal(plan.checklist.TemplateVersion, 3); assert.equal(plan.usedStarter, false);
  const items = plan.items.map(R.itemFromRow);
  assert.deepEqual(items.map((i) => [i.itemId, i.status]), [["a", "todo"], ["o", "todo"], ["v", "todo"], ["p", "confirm"]]);
  assert.equal(items.find((i) => i.itemId === "o")!.assignee, "Mo"); // job owner is the client's manager
  assert.equal(items[0].due, "2027-01-15");
  assert.ok(plan.items.every((r) => r.PracticeId === "default" && String(r.Key).startsWith("CL-J1-")));
  assert.deepEqual(plan.log.map((l) => l.Action), ["Checklist created", "Template applied"]);
  assert.deepEqual(plan.questions, ["payroll"]);
});

test("planning is repeatable: a job that already has a checklist gets no second one", () => {
  const first = R.planChecklist({ ...base, job: job("J1", "2026-03-31") })!;
  assert.equal(R.planChecklist({ ...base, job: job("J1", "2026-03-31"), checklists: [first.checklist] }), null);
});

test("recurring jobs: each period gets its own checklist from the current template", () => {
  const a = R.planChecklist({ ...base, job: job("J1", "2026-03-31") })!;
  const b = R.planChecklist({ ...base, job: job("J2", "2027-03-31"), checklists: [a.checklist], templates: [tpl({ version: 4 })] })!;
  assert.equal(b.checklist.Key, "CL-J2"); assert.equal(b.checklist.TemplateVersion, 4); assert.equal(a.checklist.TemplateVersion, 3);
  assert.equal(b.checklist.PeriodEnd, "2027-03-31");
});

test("with no saved template the matching starter is used; unrelated or unmatched jobs get nothing", () => {
  const plan = R.planChecklist({ ...base, templates: [], job: job("J1", "2026-03-31") })!;
  assert.equal(plan.usedStarter, true); assert.equal(plan.template.key, "starter:ltd-accounts");
  assert.equal(R.planChecklist({ ...base, templates: [], serviceName: "Gardening", job: job("J1", "2026-03-31") }), null);
  // existing jobs of a type with no template and no starter keep working unchanged
  assert.equal(R.planChecklist({ ...base, templates: [tpl({ jobType: "other" })], serviceName: "Gardening", job: job("J1", "2026-03-31") }), null);
});

test("a dormant company gets the dormant workflow, an archived default is ignored, fixed asset lines are noticed", () => {
  const dormant = R.planChecklist({ ...base, templates: [], client: { ...client, SIC: "99999" }, job: job("J1", "2026-03-31") })!;
  assert.equal(dormant.template.key, "starter:dormant-accounts");
  const archived = R.planChecklist({ ...base, templates: [tpl({ active: false })], serviceName: "Gardening", job: job("J1", "2026-03-31") });
  assert.equal(archived, null);
  const withAssets = R.planChecklist({ ...base, templates: [tpl({ sections: [{ id: "s", title: "S", items: [item("fa", { when: [{ attr: "fixedAssets", is: true }] })] }] })], paperLines: [{ ClientKey: "C1", PeriodEnd: "2026-03-31", SectionKey: "fixed" }], job: job("J1", "2026-03-31") })!;
  assert.equal(R.itemFromRow(withAssets.items[0]).status, "todo");
});

test("rows convert both ways without losing anything", () => {
  const t = tpl({ when: [{ attr: "dormant", is: true }], clientKinds: ["Ltd", "LLP"] });
  const back = R.templateFromRow(R.templateRow(t, "default"));
  const clean = (x: unknown) => JSON.parse(JSON.stringify(x));
  assert.deepEqual(clean({ ...back, hours: 0, created: 0, updated: 0 }), clean({ ...t, sections: back.sections, created: 0, updated: 0, hours: 0, starter: undefined }));
  assert.deepEqual(back.sections.map((s) => s.items.map((i) => i.id)), t.sections.map((s) => s.items.map((i) => i.id)));
  const plan = R.planChecklist({ ...base, job: job("J1", "2026-03-31") })!;
  const i = R.itemFromRow(plan.items[2]);
  assert.deepEqual(R.itemFromRow(R.itemRow({ ...i, section: i.section }, { key: i.key, checklistKey: i.checklistKey, jobKey: "J1", pid: "x" })), { ...i, rev: 1 });
  const cl = R.checklistFromRow(plan.checklist);
  assert.equal(cl.status, "active"); assert.equal(cl.templateName, "Mine");
  const patch = R.itemPatch({ status: "done", completedBy: "Pat", history: [{ at: NOW, by: "Pat", action: "Completed" }], rev: 2, after: ["a"] });
  assert.equal(patch.Status, "done"); assert.equal(patch.Rev, 2); assert.equal(JSON.parse(String(patch.History))[0].action, "Completed"); assert.equal(patch.After, '["a"]');
  const n = R.noteFromRow({ Key: "N", Status: "weird", History: "{bad" });
  assert.equal(n.status, "open"); assert.deepEqual(n.history, []);
  assert.equal(R.practiceId([]), "default"); assert.equal(R.practiceId([{ Key: "practiceId", Value: '"acme"' }]), "acme");
});

test("a damaged item row falls back to safe values", () => {
  const i = R.itemFromRow({ Key: "K", Status: "nonsense", Detail: "{oops", After: "[[", Hours: "abc" });
  assert.equal(i.status, "todo"); assert.deepEqual(i.after, []); assert.equal(i.hours, 0); assert.equal(i.mandatory, true);
});
