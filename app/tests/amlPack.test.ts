import test from "node:test";
import assert from "node:assert/strict";
import * as p from "../src/lib/amlPack";
import { unzip } from "../src/lib/docx";

const today = "2026-11-07";
const name = (k: string) => (k === "K1" ? "Acme Ltd" : k);

test("every form has unique ids and field keys", () => {
  assert.equal(new Set(p.FORMS.map((f) => f.id)).size, p.FORMS.length);
  for (const f of p.FORMS) {
    const keys = f.sections.flatMap((s) => s.fields.map((x) => x.k));
    assert.equal(new Set(keys).size, keys.length, f.id);
  }
});

test("the suspicious activity forms are never stored", () => {
  for (const id of ["sar1", "sar2"]) {
    const f = p.formById(id)!;
    assert.equal(f.stored, false);
    assert.equal(f.restricted, true);
  }
  assert.ok(p.FORMS.filter((f) => f.stored).every((f) => !f.restricted));
});

test("standing: not started, draft, overdue, soon, in date", () => {
  const def = p.formById("mlro")!;
  const rec = (status: "Draft" | "Approved", next?: string): p.Rec => ({ id: "x", created: "2026-01-01", status, values: next ? { nextReport: next } : {} });
  assert.equal(p.standing(def, { records: [] }, today).state, "none");
  assert.equal(p.standing(def, { records: [rec("Draft")] }, today).state, "draft");
  assert.equal(p.standing(def, { records: [rec("Approved", "2026-10-01")] }, today).state, "overdue");
  assert.equal(p.standing(def, { records: [rec("Approved", "2026-11-20")] }, today).state, "soon");
  assert.equal(p.standing(def, { records: [rec("Approved", "2027-06-01")] }, today).state, "ok");
  assert.equal(p.standing(def, { records: [rec("Approved")] }, today).state, "ok");
});

test("ticks show which options were chosen", () => {
  const def = p.formById("screening")!;
  const rec = p.newRec(def, today);
  rec.values = { result: ["Possible match"], client: "K1" };
  const b = p.docBlocks(def, rec, { firm: "F", title: "t", status: "", date: today, today }, name);
  const kv = b.find((x) => x.t === "kv") as Extract<p.Block, { t: "kv" }>;
  assert.ok(kv.rows.some((r) => r[0] === "Result" && r[1].includes("☒ Possible match") && r[1].includes("☐ No match")));
  assert.ok(kv.rows.some((r) => r[0] === "Client" && r[1] === "Acme Ltd"));
});

test("a blank copy ignores any saved values", () => {
  const def = p.formById("screening")!;
  const rec = p.newRec(def, today);
  rec.values = { client: "K1", notes: "Secret note" };
  const meta = { firm: "F", title: "t", status: "", date: today, blank: true, today };
  assert.ok(!JSON.stringify(p.docBlocks(def, rec, meta, name)).includes("Secret note"));
});

test("free text turns into paragraphs and bullet lists", () => {
  const b = p.flow("Intro line\n\n- one\n- two\nAfter");
  assert.deepEqual(b.map((x) => x.t), ["p", "bullets", "p"]);
});

test("every form makes a real Word file and a print page", async () => {
  for (const def of p.FORMS) {
    const rec = def.stored ? p.newRec(def, today) : undefined;
    const meta = { firm: "Insight & Co <Ltd>", title: def.title, status: "", date: today, restricted: def.restricted, blank: !rec, today };
    const blocks = p.docBlocks(def, rec, meta, name);
    const bytes = await p.toDocx(blocks, meta);
    const files = await unzip(bytes);
    const names = files.map((f) => f.name);
    for (const need of ["[Content_Types].xml", "word/document.xml", "word/styles.xml", "word/footer1.xml"]) assert.ok(names.includes(need), `${def.id} ${need}`);
    const doc = new TextDecoder().decode(files.find((f) => f.name === "word/document.xml")!.data);
    assert.ok(doc.includes("Insight &amp; Co &lt;Ltd&gt;"), "text is escaped");
    assert.equal((doc.match(/<w:tbl>/g) || []).length, (doc.match(/<\/w:tbl>/g) || []).length);
    const html = p.toHtml(blocks, meta);
    assert.ok(html.includes("Insight &amp; Co &lt;Ltd&gt;") && html.includes("window.print()"));
    if (def.restricted) assert.ok(html.includes("RESTRICTED"));
  }
});
