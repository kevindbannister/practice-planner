import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_BRANDING, cleanBranding, readBranding } from "../src/lib/docBranding";
import { checkFields, fieldsUsed, fillContent, fillText, fieldsFor, resolveValues } from "../src/lib/docFields";
import { DocContent, plainText } from "../src/lib/docModel";

const branding = { ...DEFAULT_BRANDING, practiceName: "Bannister & Co", phone: "0113 000 0000", signatoryName: "Kevin Bannister", signatoryTitle: "Director",
  correspondenceAddress: "1 High Street\nLeeds\nLS1 1AA", customFields: [{ key: "bank_sort", label: "Sort code", value: "00-00-00" }] };
const client = { Key: "C1", Title: "Medifox Limited", Kind: "Ltd", CompanyNumber: "01234567", RegisteredOffice: "12 Sir John Fogge Avenue\nAshford\nTN23 3GA", Email: "sam@medifox.test", ContactFirst: "Sam", ContactLast: "Lam" } as never;
const job = { Key: "J1", Title: "Accounts", ClientKey: "C1", PeriodEnd: "2026-09-30", Deadline: "2027-06-30", CHDeadline: "2027-06-30" } as never;
const ctx = { client, job, serviceName: "Limited company accounts", branding, today: "2026-10-24", reference: "XPF-261024-1" };

test("fields are filled from the client, the job and the practice", () => {
  const v = resolveValues(ctx);
  assert.equal(v["client.name"], "Medifox Limited");
  assert.equal(v["client.company_number"], "01234567");
  assert.equal(v["client.salutation"], "Dear Sam,");
  assert.equal(v["client.registered_address"], "12 Sir John Fogge Avenue\nAshford\nTN23 3GA");
  assert.equal(v["practice.name"], "Bannister & Co");
  assert.equal(v["practice.signatory_title"], "Director");
  assert.equal(v["job.type"], "Limited company accounts");
  assert.equal(v["job.period"], "the year ended 30 September 2026");
  assert.equal(v["job.statutory_deadline"], "30 June 2027");
  assert.equal(v["doc.date"], "24 October 2026");
  assert.equal(v["doc.reference"], "XPF-261024-1");
  assert.equal(v["custom.bank_sort"], "00-00-00");
  assert.ok(fieldsFor(branding).length > 25);
});

test("without a job or client the fields are empty, so they are reported not guessed", () => {
  const v = resolveValues({ ...ctx, client: undefined, job: undefined, serviceName: undefined });
  assert.equal(v["client.name"], "");
  assert.equal(v["job.deadline"], "");
  const used = ["client.name", "job.deadline", "practice.name", "client.nonsense"];
  const check = checkFields(used, v);
  assert.deepEqual(check.missing, ["client.name", "job.deadline"]);
  assert.deepEqual(check.unknown, ["client.nonsense"]);
});

test("filling content leaves missing fields visible as tokens", () => {
  const c: DocContent = { blocks: [{ type: "p", runs: [{ t: "Dear {{client.name}}, re {{job.deadline}}", b: true }] }, { type: "table", header: false, rows: [[{ runs: [{ t: "{{ practice.phone }}" }] }]] }] };
  assert.deepEqual(fieldsUsed(c), ["client.name", "job.deadline", "practice.phone"]);
  const out = fillContent(c, { "client.name": "Medifox Limited", "job.deadline": "", "practice.phone": "0113 000 0000" });
  assert.equal(plainText(out), "Dear Medifox Limited, re {{job.deadline}}\n0113 000 0000");
  assert.equal(fillText("{{CLIENT.NAME}}", { "client.name": "X" }), "X");
});

test("branding is cleaned and several profiles are kept", () => {
  const b = cleanBranding({ primary: "red", logo: "data:image/svg+xml;base64,AAAA", font: "comic", customFields: [{ key: "My Field!", label: "x", value: "y" }, { key: "" }] });
  assert.equal(b.primary, DEFAULT_BRANDING.primary);
  assert.equal(b.logo, "");
  assert.equal(b.font, "sans");
  assert.deepEqual(b.customFields.map((f) => f.key), ["my_field"]);
  const set = readBranding([{ Key: "docs.branding", Value: JSON.stringify({ defaultId: "b", profiles: [{ id: "a", practiceName: "A" }, { id: "b", practiceName: "B" }, { id: "b", practiceName: "dup" }] }) }] as never);
  assert.equal(set.profiles.length, 2);
  assert.equal(set.defaultId, "b");
  assert.equal(readBranding([]).profiles[0].id, "default");
});
