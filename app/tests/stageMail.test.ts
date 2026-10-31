import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_BODY, readRules, ruleFor, ruleOnMove, stageEmail, withRule } from "../src/lib/stageMail.ts";

test("rules read back safely, one per stage, bad ones dropped", () => {
  const r = readRules([{ serviceKey: "ACC", stageNo: 2, subject: "", body: "" }, { serviceKey: "ACC", stageNo: 2 }, { serviceKey: "", stageNo: 1 }, { serviceKey: "VAT", stageNo: 0 }, null, { serviceKey: "VAT", stageNo: 1, enabled: false }]);
  assert.equal(r.length, 2);
  assert.equal(r[0].body, DEFAULT_BODY);
  assert.equal(r[1].enabled, false);
  assert.deepEqual(readRules("nope"), []);
});

test("only finishing a stage forward offers its email, and only when switched on", () => {
  const rules = withRule(withRule([], "ACC", 2, {}), "VAT", 1, { enabled: false });
  assert.equal(ruleOnMove(rules, "ACC", 2, 3)?.stageNo, 2);
  assert.equal(ruleOnMove(rules, "ACC", 3, 2), undefined); // going back
  assert.equal(ruleOnMove(rules, "ACC", 2, 2), undefined);
  assert.equal(ruleOnMove(rules, "VAT", 1, 2), undefined); // switched off
  assert.equal(ruleOnMove(rules, "ACC", 1, 2), undefined); // no rule for stage 1
  assert.equal(ruleOnMove(rules, "ACC", 2, 6)?.stageNo, 2); // skipping ahead offers the stage that was left
});

test("editing a rule keeps its wording and order", () => {
  let rules = withRule([], "ACC", 5, { subject: "Mine" });
  rules = withRule(rules, "ACC", 2, {});
  rules = withRule(rules, "ACC", 5, { enabled: false });
  assert.deepEqual(rules.map((r) => r.stageNo), [2, 5]);
  assert.equal(ruleFor(rules, "ACC", 5)?.subject, "Mine");
  assert.equal(ruleFor(rules, "ACC", 5)?.enabled, false);
});

test("the email fills in the stage name and merge fields, leaving unknown ones visible", () => {
  const rule = withRule([], "ACC", 2, { subject: "{{job.type}}: {{stage}} done", body: "{{client.greeting}} {{nope}}" })[0];
  const e = stageEmail(rule, { "client.greeting": "Hi Anna,", "job.type": "Accounts" }, "Records received");
  assert.equal(e.subject, "Accounts: Records received done");
  assert.equal(e.body, "Hi Anna, {{nope}}");
});
