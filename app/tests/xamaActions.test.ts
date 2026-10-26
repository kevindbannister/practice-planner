import test from "node:test";
import assert from "node:assert/strict";
import { accountBody, askForIdCheck, createAccount, draftAccount, idOptions, missingForAml, missingForCreate, progress, progressText, runAmlCheck } from "../src/lib/xamaActions.ts";
import { FakeXama } from "../src/lib/fakeXama.ts";
import { DEFAULT_XAMA_CONFIG } from "../src/lib/xama.ts";

const CFG = { ...DEFAULT_XAMA_CONFIG, firmId: "firm-1" };
const co: any = { Key: "C1", Title: "Acme Limited", Kind: "Ltd", CompanyNumber: "01234567", ContactFirst: "Ann", ContactLast: "Smith", Email: "ann@acme.test", Mobile: "07700 900123", RegisteredOffice: "1 High Street\nLeeds\nLS1 4AB" };
const person: any = { Key: "P1", Title: "Alan Bannister", Kind: "Individual", Email: "alan@x.test", DateOfBirth: "1970-05-04", HomeAddress: "2 Low Road, Ripon, HG4 1AA" };

test("a company is drafted from what we hold, address split into parts", () => {
  const d = draftAccount(co);
  assert.deepEqual([d.type, d.regNumber, d.firstName, d.lastName, d.email, d.phone], ["COMPANY", "01234567", "Ann", "Smith", "ann@acme.test", "07700 900123"]);
  assert.deepEqual([d.street, d.city, d.postcode], ["1 High Street", "Leeds", "LS1 4AB"]);
});

test("an individual is their own contact, with date of birth and home address", () => {
  const d = draftAccount(person);
  assert.deepEqual([d.type, d.regNumber, d.firstName, d.lastName, d.dob], ["INDIVIDUAL", "", "Alan", "Bannister", "1970-05-04"]);
  assert.deepEqual([d.street, d.city, d.postcode], ["2 Low Road", "Ripon", "HG4 1AA"]);
  assert.deepEqual(missingForAml(d), []);
});

test("what Xama insists on is checked before anything is sent", () => {
  assert.deepEqual(missingForCreate({ ...draftAccount(co), email: "nope", lastName: "" }), ["last name", "email"]);
  assert.deepEqual(missingForAml(draftAccount(co)), ["date of birth"]);
});

test("the request to create a client matches Xama's documented shape", () => {
  const b: any = accountBody(draftAccount(co), "C1");
  assert.deepEqual(b, {
    name: "Acme Limited", type: "COMPANY", metadata: { external_reference: "C1" }, reg_number: "01234567",
    primary_contact: { first_name: "Ann", last_name: "Smith", email: "ann@acme.test", phone: "07700 900123", primary_address: { street: "1 High Street", postcode: "LS1 4AB", city: "Leeds", country_code: "GB", type: "PRIMARY" } },
  });
  assert.ok(!("reg_number" in (accountBody(draftAccount(person), "P1") as any)));
});

test("creating sends one POST and returns the new Xama ID; an incomplete client sends nothing", async () => {
  const api = new FakeXama();
  const id = await createAccount(api, CFG, draftAccount(co), "C1");
  assert.match(id, /^fake-new-/);
  assert.equal(api.writes.length, 1);
  assert.deepEqual([api.writes[0].method, api.writes[0].path], ["POST", "clients/firm-1/accounts"]);
  await assert.rejects(() => createAccount(api, CFG, { ...draftAccount(co), email: "" }, "C1"), /needs the email/);
  assert.equal(api.writes.length, 1);
});

test("an answer with no ID is explained rather than lost", async () => {
  const api: any = new FakeXama();
  api.write = async () => ({});
  await assert.rejects(() => createAccount(api, CFG, draftAccount(co), "C1"), /didn't say what its ID is/);
});

test("ID check: offers Xama's own levels and wordings, then asks with email on", async () => {
  const api = new FakeXama();
  const o = await idOptions(api, CFG);
  assert.equal(o.levels.length, 2);
  assert.equal(o.levels[0].isDefault, true);
  await assert.rejects(() => askForIdCheck(api, CFG, "acc-1", { level: "" }), /Choose which ID check/);
  await askForIdCheck(api, CFG, "acc-1", { level: "lvl-1", template: "tpl-1" });
  const w = api.writes[0];
  assert.deepEqual([w.method, w.path], ["PUT", "clients/firm-1/accounts/acc-1/contacts/con-1/reports/onboarding"]);
  assert.deepEqual(w.body, { config: { parameters: { level: "lvl-1", suppress_invitation_mail: "false", mail_template_id: "tpl-1" }, ttl_in_days: 365, is_reminder_enabled: true } });
});

test("AML check goes to the AML report of the primary contact", async () => {
  const api = new FakeXama();
  await runAmlCheck(api, CFG, "acc-1");
  assert.equal(api.writes[0].path, "clients/firm-1/accounts/acc-1/contacts/con-1/reports/aml");
  assert.equal(api.writes[0].method, "PUT");
});

test("progress reads nothing-yet as plain words, then as it advances", async () => {
  const api = new FakeXama();
  let p = await progress(api, CFG, "acc-1");
  assert.deepEqual(progressText(p), { id: "No ID check requested yet.", aml: "No AML check run yet." });
  await askForIdCheck(api, CFG, "acc-1", { level: "lvl-1" });
  await runAmlCheck(api, CFG, "acc-1");
  p = await progress(api, CFG, "acc-1");
  assert.match(progressText(p).id, /waiting for the client/);
  assert.match(progressText(p).aml, /Completed: identity pass; no PEP matches; no sanctions matches/);
});

test("progress wording for the awkward states", () => {
  assert.match(progressText({ id: { status: "READY", document: "PASSED", face: "FAILED" }, aml: { status: "READY", decision: "REFER", pep: 2, sanctions: 1 } }).id, /document passed, face match failed/);
  assert.match(progressText({ id: { status: "READY" }, aml: { status: "READY", decision: "REFER", pep: 2, sanctions: 1 } }).aml, /2 possible PEP matches; 1 possible sanctions match\./);
  assert.match(progressText({ id: { status: "CREDIT_BALANCE_EXCEEDED" }, aml: { status: "CREDIT_BALANCE_EXCEEDED" } }).id, /credit has run out/);
});
