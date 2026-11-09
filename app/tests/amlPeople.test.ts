import test from "node:test";
import assert from "node:assert/strict";
import { alsoCovers, contactCover, coverOf, ownerChecks, ownerCover, ownersCovered, personKey, samePerson, suggestFor } from "../src/lib/amlPeople.ts";
import { hints } from "../src/lib/amlTemplate.ts";
import { COMPANY } from "../src/lib/amlTemplates.ts";

const john: any = { Key: "P1", Title: "Mr John Smith", Kind: "Individual", XamaAmlCheck: "done|2026-11-03|0|0" };
const jane: any = { Key: "P2", Title: "Jane Doe", Kind: "Individual", XamaIdCheck: "done|2026-10-01" };
const bob: any = { Key: "P3", Title: "Bob Brown", Kind: "Individual" };
const co: any = { Key: "C1", Title: "Smith Ltd", Kind: "Ltd", XamaContact: "John A Smith" };
const clients = [john, jane, bob, co];

test("names match on first and last name, ignoring titles and middle names", () => {
  assert.equal(personKey("Mr John A. Smith"), "john smith");
  assert.ok(samePerson("JOHN SMITH", "Mr John Smith"));
  assert.ok(!samePerson("John", "John"));
  assert.deepEqual(suggestFor("John Smith", clients, "C1").map((c) => c.Key), ["P1"]);
  assert.deepEqual(suggestFor("John Smith", clients, "P1"), []);
});

test("a linked owner's own Xama check covers them on the company; the checks are added once", () => {
  assert.deepEqual(coverOf(john).kinds, ["Identity verified", "Address verified", "Sanctions and PEP screening"]);
  assert.deepEqual(coverOf(jane).kinds, ["Identity verified"]);
  assert.equal(coverOf(bob).done, false);
  const oc = ownerCover([{ name: "John Smith", percent: 60, note: "", clientKey: "P1" }, { name: "Jane Doe", percent: 40, note: "" }], clients, "C1");
  assert.equal(oc[0].cover.done, true); assert.equal(oc[1].client, undefined); assert.equal(oc[1].suggest[0].Key, "P2");
  assert.equal(ownersCovered(oc), "");
  const add = ownerChecks(oc, [], "2026-11-09");
  assert.equal(add.length, 3); assert.equal(add[0].at, "2026-11-03"); assert.match(add[0].note, /^John Smith: Xama AML check/);
  assert.equal(ownerChecks(oc, add, "2026-11-09").length, 0);
  const both = ownerCover([{ name: "John Smith", percent: 60, note: "", clientKey: "P1" }, { name: "Jane Doe", percent: 40, note: "", clientKey: "P2" }], clients, "C1");
  assert.equal(ownersCovered(both), "ID");
  const h = hints(COMPANY as any, { companyNumber: "", owners: 2, passedIdentity: false, passedScreening: false, xamaIdDone: false, xamaAmlDone: false, ownershipAgrees: null, services: [], ownersCovered: "ID" });
  assert.equal(h.c17.value, "Yes"); assert.equal(h.c18.value, "Yes"); assert.ok(!h.c19 && !h.c20);
  const h2 = hints(COMPANY as any, { companyNumber: "", owners: 2, passedIdentity: false, passedScreening: false, xamaIdDone: false, xamaAmlDone: false, ownershipAgrees: null, services: [], ownersCovered: "AML" });
  assert.equal(h2.c19.value, "No"); assert.equal(h2.c20.value, "No");
});

test("the person's own record lists the companies it covers; a company's Xama contact who is already checked is spotted", () => {
  const rows: any[] = [{ ClientKey: "C1", Status: "approved", Created: "2026-10-01", Owners: JSON.stringify([{ name: "John Smith", percent: 60, note: "", clientKey: "P1" }]) }];
  assert.deepEqual(alsoCovers(john, clients, rows).map((x) => [x.client.Key, x.as]), [["C1", "owner (60%)"]]);
  assert.deepEqual(alsoCovers(john, clients, []).map((x) => x.as), ["Xama main contact"]);
  const cc = contactCover(co, clients)!;
  assert.equal(cc.client.Key, "P1"); assert.equal(cc.cover.done, true);
});
