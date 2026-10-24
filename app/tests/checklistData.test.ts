import assert from "node:assert/strict";
import { test } from "node:test";
import { FakeGraph } from "../src/lib/fakeGraph";
import { SharePointStore } from "../src/lib/sharepoint";
import * as C from "../src/lib/checklist";
import * as R from "../src/lib/checklistRows";

const NOW = "2026-10-24T10:00:00.000Z";
async function setup() {
  const g = new FakeGraph();
  const s = new SharePointStore(g);
  await s.connect();
  await s.ensureSchema();
  return { g, s };
}
const job = { Key: "J1", ClientKey: "C1", ServiceKey: "svc", PeriodEnd: "2026-03-31", Deadline: "2027-01-31" };
const client = { Key: "C1", Title: "Acme", Kind: "Ltd", VATRegistered: "Yes", SIC: "62012", Partner: "Pam", Manager: "Mo" };
const plan = () => R.planChecklist({ job, client, serviceName: "VAT return", templates: [], paperLines: [], checklists: [], now: NOW, user: "Pat", pid: "default" })!;

test("the checklist lists are created with the rest and survive the trip through SharePoint", async () => {
  const { s } = await setup();
  for (const k of ["ChecklistTemplates", "ChecklistVersions", "Checklists", "ChecklistItems", "ChecklistNotes", "ChecklistLog"] as const) assert.ok(s.hasList(k), k);
  const p = plan();
  await s.create("Checklists", p.checklist);
  const res = await s.createMany("ChecklistItems", p.items);
  assert.equal(res.failed, 0);
  await s.createMany("ChecklistLog", p.log);
  const back = (await s.readAll("ChecklistItems")).map(R.itemFromRow);
  assert.equal(back.length, p.items.length);
  const sent = p.items.map((r) => R.itemFromRow(r));
  assert.deepEqual(back.map((i) => ({ ...i, key: "" })).sort((a, b) => a.seq - b.seq), sent.map((i) => ({ ...i, key: "" })).sort((a, b) => a.seq - b.seq));
  assert.equal(R.checklistFromRow((await s.readAll("Checklists"))[0]).templateName, p.template.name);
  assert.equal((await s.readAll("ChecklistLog")).length, 2);
  assert.ok(back.every((i) => i.history.length >= 1 && typeof i.mandatory === "boolean"));
});

test("two people on the same item: the second is told, not allowed to overwrite", async () => {
  const { g, s } = await setup();
  const p = plan();
  await s.createMany("ChecklistItems", p.items);
  const a = (await s.readAll("ChecklistItems")).find((r) => r.ItemId === "v1")!;
  // a second person completes it first, as the app would: write the change and move the revision
  const b = new SharePointStore(g);
  await b.connect();
  const other = R.itemFromRow(a);
  const done = C.complete(other, [other], { staff: [], overriders: [], independentReview: false, auto: true }, "Sam", NOW) as C.Change;
  await b.update("ChecklistItems", a._id!, R.itemPatch(done.patch));
  // the first person's screen still holds the old revision: the freshness check sees the difference
  const now = await s.readItem("ChecklistItems", a._id!);
  assert.equal(R.isStale(now, a), true);
  assert.equal(now.Status, "done"); assert.equal(now.CompletedBy, "Sam");
  // and a screen that has refreshed is not stale
  assert.equal(R.isStale(now, now), false);
  // a record that was deleted can't be read, so a stale screen can't write to it either
  await b.remove("ChecklistItems", a._id!);
  await assert.rejects(() => s.readItem("ChecklistItems", a._id!));
});

test("items changing on different rows never interfere", async () => {
  const { s } = await setup();
  const p = plan();
  await s.createMany("ChecklistItems", p.items);
  const rows = await s.readAll("ChecklistItems");
  const [x, y] = rows;
  await Promise.all([s.update("ChecklistItems", x._id!, R.itemPatch({ status: "doing", rev: 2 })), s.update("ChecklistItems", y._id!, R.itemPatch({ notes: "hello", rev: 2 }))]);
  const after = await s.readAll("ChecklistItems");
  assert.equal(after.find((r) => r.Key === x.Key)!.Status, "doing");
  assert.equal(after.find((r) => r.Key === y.Key)!.Notes, "hello");
  assert.equal(after.find((r) => r.Key === y.Key)!.Status, y.Status);
});

test("a template and its earlier versions are kept apart", async () => {
  const { s } = await setup();
  const t: C.Template = { id: "T1", name: "Mine", description: "", jobType: "svc", clientKinds: ["Ltd"], version: 1, active: true, isDefault: true, hours: 1, sections: [{ id: "s", title: "S", items: [{ id: "a", title: "A", mandatory: true, hours: 1, after: [] }] }] };
  await s.create("ChecklistTemplates", R.templateRow(t, "p1"));
  const edit = C.saveEdit(t, { sections: [{ id: "s", title: "S", items: [...t.sections[0].items, { id: "b", title: "B", mandatory: false, hours: 0.5, after: ["a"] }] }] }, NOW);
  await s.create("ChecklistVersions", { Key: "V1", TemplateKey: edit.keep!.id, Version: edit.keep!.version, Saved: NOW, Body: C.encodeSections(edit.keep!.sections), PracticeId: "p1" });
  const row = (await s.readAll("ChecklistTemplates"))[0];
  await s.update("ChecklistTemplates", row._id!, R.templateRow(edit.next, "p1"));
  const now = R.templateFromRow((await s.readAll("ChecklistTemplates"))[0]);
  assert.equal(now.version, 2); assert.equal(C.allItems(now).length, 2); assert.equal(now.isDefault, true); assert.deepEqual(now.clientKinds, ["Ltd"]);
  const old = (await s.readAll("ChecklistVersions"))[0];
  assert.equal(C.decodeSections(String(old.Body))[0].items.length, 1);
  assert.equal((await s.readAll("ChecklistTemplates"))[0].PracticeId, "p1");
});

test("every checklist record carries its practice, ready for more than one practice", async () => {
  const p = plan();
  assert.equal(p.checklist.PracticeId, "default");
  assert.ok(p.items.every((r) => r.PracticeId === "default"));
  assert.ok(p.log.every((r) => r.PracticeId === "default"));
  const other = R.planChecklist({ job, client, serviceName: "VAT return", templates: [], paperLines: [], checklists: [], now: NOW, user: "Pat", pid: "acme-practice" })!;
  assert.equal(other.checklist.PracticeId, "acme-practice");
  assert.ok(other.items.every((r) => r.PracticeId === "acme-practice"));
});
