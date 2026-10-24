import test from "node:test";
import assert from "node:assert/strict";
import { CATEGORIES, STARTERS, blankTemplate, copyTemplate, decodeBody, defaultFor, encodeBody, library, restoreVersion, saveEdit, setDefault } from "../src/lib/docTemplates";
import { fieldsUsed, checkFields, resolveValues } from "../src/lib/docFields";
import { DEFAULT_BRANDING } from "../src/lib/docBranding";
import { plainText } from "../src/lib/docModel";

test("there are starter templates and every merge field in them is a known one", () => {
  assert.ok(STARTERS.length >= 6);
  const cats = new Set(STARTERS.map((s) => s.category));
  assert.ok(cats.size >= 6);
  for (const s of STARTERS) {
    assert.ok(plainText(s.content).length > 50, s.name);
    const values = resolveValues({ branding: DEFAULT_BRANDING, today: "1 January 2026", reference: "R1" });
    const { unknown } = checkFields(fieldsUsed(s.content), values);
    assert.deepEqual(unknown, [], s.name);
  }
  assert.ok(STARTERS.every((s) => (CATEGORIES as readonly string[]).includes(s.category)));
});

test("editing content makes a new version and keeps the old one; renaming does not", () => {
  const t = copyTemplate(STARTERS[0], "Mine");
  const renamed = saveEdit(t, { name: "Renamed" });
  assert.equal(renamed.next.version, 1);
  assert.equal(renamed.keep, undefined);
  const edited = saveEdit(t, { content: { blocks: [{ type: "p", runs: [{ t: "New {{client.name}}" }] }] } });
  assert.equal(edited.next.version, 2);
  assert.equal(edited.keep?.version, 1);
  assert.deepEqual(edited.keep?.content, t.content);
  const back = restoreVersion(edited.next, edited.keep!);
  assert.equal(back.next.version, 3);
  assert.deepEqual(back.next.content, t.content);
});

test("copies are independent, defaults per category work", () => {
  const a = copyTemplate(STARTERS[1]);
  a.content.blocks.push({ type: "break" });
  assert.notEqual(a.content.blocks.length, STARTERS[1].content.blocks.length);
  assert.equal(defaultFor("Engagement letters", [])?.id, STARTERS[1].id);
  const b = { ...copyTemplate(STARTERS[1], "B"), category: "Engagement letters" as const };
  const c = { ...copyTemplate(STARTERS[1], "C"), category: "Engagement letters" as const, isDefault: true };
  assert.equal(defaultFor("Engagement letters", [b, c])?.name, "C");
  const changed = setDefault([b, c], b.id);
  assert.deepEqual(changed.map((t) => [t.name, t.isDefault]).sort(), [["B", true], ["C", false]]);
  assert.equal(defaultFor("Engagement letters", [{ ...b, archived: true }])?.id, STARTERS[1].id);
  assert.equal(library([b]).length, STARTERS.length + 1);
});

test("a template body survives storage, and bad storage gives an empty document", () => {
  const t = blankTemplate("X");
  t.content = { blocks: [{ type: "p", runs: [{ t: "Hello {{client.name}}", b: true }] }] };
  const back = decodeBody(encodeBody({ content: t.content, layout: t.layout }));
  assert.deepEqual(fieldsUsed(back.content), ["client.name"]);
  assert.equal(decodeBody("not json").content.blocks.length, 1);
});
