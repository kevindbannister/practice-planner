import { test } from "node:test";
import assert from "node:assert/strict";
import { addDef, cleanKey, matchCustom, mergeValues, readDefs, removeDef, saveValues, valueProblem, valuesOf } from "../src/lib/customFields.ts";

let k = 0; const key = (p: string) => `${p}${++k}`;
const base = { type: "number" as const, appliesTo: "client" as const, options: [], help: "" };

test("names become safe keys and duplicates, blanks and thin choices are refused", () => {
  assert.equal(cleanKey("Monthly bank transactions!"), "monthly_bank_transactions");
  let r = addDef([], { ...base, label: "Monthly transactions" });
  assert.equal(r.defs[0].key, "monthly_transactions");
  assert.ok(addDef(r.defs, { ...base, label: "monthly  transactions" }).problem);
  assert.equal(addDef(r.defs, { ...base, label: "Monthly transactions", appliesTo: "job" }).problem, undefined); // same name on jobs is fine
  assert.ok(addDef([], { ...base, label: "" }).problem);
  assert.ok(addDef([], { ...base, label: "Standard", type: "choice", options: ["Good"] }).problem);
  assert.equal(addDef([], { ...base, label: "Standard", type: "choice", options: ["Good", "Poor", "Good"] }).defs[0].options.length, 2);
});

test("saved definitions read back and bad ones are dropped", () => {
  const d = readDefs([{ label: "A", type: "number" }, { label: "A", type: "number" }, { label: "", type: "text" }, { label: "B", type: "weird" }, { label: "C", type: "choice", options: ["x", "y"], appliesTo: "job" }]);
  assert.deepEqual(d.map((x) => `${x.appliesTo}.${x.key}`), ["client.a", "job.c"]);
  assert.deepEqual(readDefs("no"), []);
});

test("values are checked by type, saved tidily, and clearing a field leaves nothing behind", () => {
  const defs = readDefs([{ label: "Transactions", type: "number" }, { label: "CIS", type: "yesno" }, { label: "Standard", type: "choice", options: ["Good", "Poor"] }]);
  assert.ok(valueProblem(defs[0], "lots"));
  assert.equal(valueProblem(defs[0], "1,200"), "");
  assert.equal(valueProblem(defs[0], ""), "");
  const first = saveValues(defs, "client", "C1", "C1", {}, { transactions: "1,200", cis: "yes", standard: "Poor" }, undefined, key, "now");
  assert.equal(first.isNew, true);
  assert.deepEqual(JSON.parse(String(first.row.Json)), { transactions: "1200", cis: "yes", standard: "Poor" });
  const row = { ...first.row };
  const cur = valuesOf([row], "client", "C1");
  const second = saveValues(defs, "client", "C1", "C1", cur, { cis: "" }, row, key, "later");
  assert.equal(second.isNew, false);
  assert.deepEqual(JSON.parse(String(second.row.Json)), { transactions: "1200", standard: "Poor" });
  assert.ok(saveValues(defs, "client", "C1", "C1", cur, { standard: "Great" }, row, key, "x").problem);
});

test("removing a field hides it but keeps what was entered", () => {
  const defs = readDefs([{ label: "Transactions", type: "number" }, { label: "CIS", type: "yesno" }]);
  const r = saveValues(defs, "client", "C1", "C1", {}, { transactions: "5", cis: "no" }, undefined, key, "n");
  const left = removeDef(defs, "client", "cis");
  const again = saveValues(left, "client", "C1", "C1", valuesOf([r.row], "client", "C1"), { transactions: "6" }, r.row, key, "n");
  assert.deepEqual(JSON.parse(String(again.row.Json)), { transactions: "6", cis: "no" });
});

test("merge fields exist for every defined field, blank when no value", () => {
  const defs = readDefs([{ label: "Transactions", type: "number" }, { label: "CIS", type: "yesno" }, { label: "Site", type: "text", appliesTo: "job" }]);
  assert.deepEqual(mergeValues(defs, "client", { transactions: "40", cis: "yes" }), { "client.custom.transactions": "40", "client.custom.cis": "Yes" });
  assert.deepEqual(mergeValues(defs, "client", {}), { "client.custom.transactions": "", "client.custom.cis": "" });
  assert.deepEqual(Object.keys(mergeValues(defs, "job", {})), ["job.custom.site"]);
});

test("filtering: ranges, yes/no, choices; no value never matches a test; removed fields are ignored", () => {
  const defs = readDefs([{ label: "Transactions", type: "number" }, { label: "CIS", type: "yesno" }, { label: "Standard", type: "choice", options: ["Good", "Poor"] }, { label: "Since", type: "date" }]);
  const v = { transactions: "40", cis: "yes", standard: "Poor", since: "2025-06-01" };
  assert.equal(matchCustom(defs, [{ key: "transactions", min: 30, max: 50 }], v), true);
  assert.equal(matchCustom(defs, [{ key: "transactions", min: 41 }], v), false);
  assert.equal(matchCustom(defs, [{ key: "cis", is: "yes" }, { key: "standard", is: "Poor" }], v), true);
  assert.equal(matchCustom(defs, [{ key: "standard", is: "Good" }], v), false);
  assert.equal(matchCustom(defs, [{ key: "since", from: "2025-01-01", to: "2025-12-31" }], v), true);
  assert.equal(matchCustom(defs, [{ key: "transactions", min: 1 }], {}), false);
  assert.equal(matchCustom(defs, [{ key: "gone", min: 1 }], {}), true);
  assert.equal(matchCustom(defs, [{ key: "transactions" }], {}), true); // an empty test filters nothing
});
