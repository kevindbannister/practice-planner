import { test } from "node:test";
import assert from "node:assert/strict";
import { STARTERS, answerProblems, cleanField, missing, prefilled, readRequest, readTemplate, templateProblems, writeBack } from "../src/lib/forms.ts";

test("starter forms are valid and only write back to fields that may be written", () => {
  for (const t of STARTERS) assert.deepEqual(templateProblems(t.name, t.fields), [], t.name);
  assert.equal(cleanField({ label: "Name", type: "text", prefill: "Title", writeBack: true }).writeBack, undefined);
  assert.equal(cleanField({ label: "Email", type: "text", prefill: "Email", writeBack: true }).writeBack, true);
});

test("a request starts with the client's details", () => {
  const f = STARTERS[0].fields;
  const a = prefilled(f, { Title: "Adam French", Email: "a@x.com", Mobile: "  " });
  assert.equal(a.n1, "Adam French"); assert.equal(a.n3, "a@x.com"); assert.equal(a.n4, undefined);
});

test("required questions and answer types are checked", () => {
  const f = STARTERS[0].fields;
  const m = missing(f, { n1: "A", n3: "e", n5: "addr", n9: "no" }).map((x) => x.id);
  assert.deepEqual(m, ["n11"]);
  assert.deepEqual(missing(f, { n1: "A", n3: "e", n5: "addr", n9: "no", n11: "yes" }), []);
  const p = answerProblems([{ id: "a", label: "Staff", type: "number", required: false }, { id: "b", label: "When", type: "date", required: false }, { id: "c", label: "Pick", type: "choice", required: false, options: ["x", "y"] }], { a: "many", b: "tomorrow", c: "z" });
  assert.equal(p.length, 3);
});

test("write-back lists only changed answers marked for the record", () => {
  const f = STARTERS[0].fields;
  const w = writeBack(f, { n3: "new@x.com", n4: "0777", n5: "1 High St", n1: "Different" }, { Email: "old@x.com", Mobile: "0777", HomeAddress: "" });
  assert.deepEqual(w.map((x) => [x.client, x.from, x.to]), [["Email", "old@x.com", "new@x.com"], ["HomeAddress", "", "1 High St"]]);
});

test("templates and requests are read back from rows", () => {
  const t = readTemplate({ Key: "T1", Title: "Q", Version: 2, Fields: JSON.stringify(STARTERS[1].fields) });
  assert.equal(t.version, 2); assert.equal(t.fields.length, STARTERS[1].fields.length);
  const r = readRequest({ Key: "R1", ClientKey: "C1", Status: "complete", Fields: JSON.stringify(t.fields), Answers: JSON.stringify({ c1: "yes" }), DueDate: "2026-11-01T00:00:00Z" });
  assert.equal(r.status, "complete"); assert.equal(r.answers.c1, "yes"); assert.equal(r.due, "2026-11-01");
  assert.ok(templateProblems("", [{ id: "x", label: "", type: "choice", required: false, options: ["a"] }]).length >= 3);
});
