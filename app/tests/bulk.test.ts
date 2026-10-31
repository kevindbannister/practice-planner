import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_BRANDING } from "../src/lib/docBranding.ts";
import { emailLog, planEmails, planForms } from "../src/lib/bulk.ts";
import { readTemplate, STARTERS } from "../src/lib/forms.ts";
import type { Client } from "../src/lib/domain.ts";

const c = (o: Record<string, unknown>) => o as unknown as Client;
const anna = c({ Key: "C1", Title: "Anna Ltd", Kind: "Ltd", Email: "anna@x.com", ContactFirst: "Anna" });
const bob = c({ Key: "C2", Title: "Bob Smith", Kind: "Individual", Email: "bob@x.com" });
const cat = c({ Key: "C3", Title: "Cat Ltd", Kind: "Ltd", Email: "" });
const today = "2026-10-31";

test("each client gets their own greeting and name; clients with no email are left out", () => {
  const p = planEmails([anna, bob, cat], "Records for {{client.name}}", "{{client.greeting}}\n\nPlease send records.", DEFAULT_BRANDING, today, []);
  assert.equal(p.problems.length, 0);
  assert.equal(p.drafts.length, 2);
  assert.equal(p.drafts[0].subject, "Records for Anna Ltd");
  assert.ok(p.drafts[0].body.startsWith("Hi Anna,"));
  assert.ok(p.drafts[1].body.startsWith("Dear Sir or Madam,"));
  assert.deepEqual(p.noEmail.map((x) => x.Key), ["C3"]);
});

test("a second press skips clients who already have a drafted email with that subject", () => {
  const log = [emailLog(planEmails([anna], "Hello", "Hi", DEFAULT_BRANDING, today, []).drafts[0], "M1", "", "x")];
  const p = planEmails([anna, bob], "hello", "Hi", DEFAULT_BRANDING, today, log);
  assert.deepEqual(p.drafts.map((d) => d.client.Key), ["C2"]);
  assert.deepEqual(p.already.map((x) => x.Key), ["C1"]);
});

test("mistyped merge fields and empty messages stop it; blanks are reported per client", () => {
  assert.ok(planEmails([anna], "", "x", DEFAULT_BRANDING, today, []).problems.length > 0);
  assert.ok(planEmails([anna], "s", "{{client.nmae}}", DEFAULT_BRANDING, today, []).problems[0].includes("client.nmae"));
  const p = planEmails([anna], "s", "UTR {{client.company_number}}", DEFAULT_BRANDING, today, []);
  assert.deepEqual(p.drafts[0].blanks, ["client.company_number"]);
  assert.ok(p.drafts[0].body.includes("{{client.company_number}}")); // left visible, not silently blank
});

test("forms: one request per client, prefilled, none for clients who already have it open", () => {
  const t = readTemplate({ Key: "FT1", Title: "New client questionnaire", Version: 2, Fields: JSON.stringify(STARTERS[0].fields) });
  let n = 0;
  const key = (p: string) => `${p}${++n}`;
  const existing = [{ Key: "FR0", ClientKey: "C2", TemplateKey: "FT1", Status: "open" }, { Key: "FR9", ClientKey: "C1", TemplateKey: "FT1", Status: "complete" }];
  const p = planForms([anna, bob], t, "", "2026-12-01", existing, "Kevin", "now", key);
  assert.equal(p.requests.length, 1);
  assert.equal(p.requests[0].ClientKey, "C1");
  assert.equal(p.requests[0].Title, "New client questionnaire");
  assert.equal(p.requests[0].TemplateVersion, 2);
  assert.equal(JSON.parse(String(p.requests[0].Answers)).n1, "Anna Ltd");
  assert.equal(p.activities.length, 1);
  assert.deepEqual(p.already.map((x) => x.Key), ["C2"]);
  assert.equal(planForms([anna], undefined, "", "", [], "", "", key).problem, "Choose a form.");
});
