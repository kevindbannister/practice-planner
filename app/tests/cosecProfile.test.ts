import test from "node:test";
import assert from "node:assert/strict";
import { addCompany, counts, filesCs01, findDuplicate, normNumber, profileFor, responsible, setLevel, validNumber } from "../src/lib/cosecProfile";

let k = 0;
const key = (p: string) => `${p}${++k}`;
const NOW = "2026-10-28T10:00:00Z";

test("defaults keep existing behaviour: active clients are managed, others historical, Co Sec only is monitoring", () => {
  assert.equal(profileFor({ Key: "C1", Kind: "Ltd" }, []).level, "managed");
  assert.equal(profileFor({ Key: "C1", Status: "active" }, []).level, "managed");
  assert.equal(profileFor({ Key: "C1", Status: "Archived" }, []).level, "historical");
  assert.equal(profileFor({ Key: "C1", Status: "cosec-only" }, []).level, "monitoring");
  assert.equal(profileFor({ Key: "C1", Status: "active" }, [{ ClientKey: "C1", Level: "monitoring" }]).level, "monitoring");
  assert.equal(profileFor({ Key: "C1", Status: "active" }, [{ ClientKey: "C1", Level: "junk" }]).level, "managed");
});

test("monitoring never makes the practice responsible for filings", () => {
  assert.equal(responsible("monitoring"), false);
  assert.equal(responsible("historical"), false);
  assert.equal(responsible("adhoc"), false);
  assert.equal(responsible("managed"), true);
  assert.equal(filesCs01(profileFor({ Key: "C1" }, [{ ClientKey: "C1", Level: "monitoring" }])), false);
  assert.equal(filesCs01(profileFor({ Key: "C1" }, [])), true);
  assert.equal(filesCs01(profileFor({ Key: "C1" }, [{ ClientKey: "C1", Level: "filings", FilesCS01: "no" }])), false);
  assert.equal(filesCs01(profileFor({ Key: "C1" }, [{ ClientKey: "C1", Level: "adhoc", FilesCS01: "yes" }])), true);
});

test("company numbers are normalised and checked", () => {
  assert.equal(normNumber(" 1234567 "), "01234567");
  assert.equal(validNumber("sc123456"), true);
  assert.equal(validNumber("12"), true); // padded to 8 digits
  assert.equal(validNumber("ABC"), false);
});

test("adding a company: validates, refuses a number already on file, creates a Co Sec only company and profile", () => {
  const clients = [{ Key: "C1", Title: "Existing Ltd", CompanyNumber: "01234567" }];
  assert.match(addCompany({ name: "", number: "09999999", kind: "Ltd" }, clients, key, NOW, "K").error!, /name/);
  assert.match(addCompany({ name: "X", number: "bad", kind: "Ltd" }, clients, key, NOW, "K").error!, /8 characters/);
  const dup = addCompany({ name: "Another", number: "1234567", kind: "Ltd" }, clients, key, NOW, "K");
  assert.equal(dup.duplicate!.Key, "C1");
  assert.ok(!dup.client);
  const ok = addCompany({ name: " New Co Ltd ", number: "sc123456", kind: "Ltd" }, clients, key, NOW, "K");
  assert.deepEqual([ok.client!.Title, ok.client!.CompanyNumber, ok.client!.Status, ok.profile!.Level, ok.profile!.ClientKey], ["New Co Ltd", "SC123456", "cosec-only", "monitoring", ok.client!.Key]);
  assert.equal(findDuplicate([...clients, ok.client!], "SC 123456")!.Key, ok.client!.Key);
});

test("setting a level creates a profile the first time and updates it after", () => {
  const c = { Key: "C1" };
  const first = setLevel(c, [], "monitoring", key, NOW, "K", { responsible: "Sam" });
  assert.equal(first.create!.Level, "monitoring");
  assert.equal(first.create!.Responsible, "Sam");
  const prof = [first.create!];
  const second = setLevel(c, prof, "filings", key, NOW, "K", { filesCs01: false });
  assert.deepEqual([second.patch!.patch.Level, second.patch!.patch.FilesCS01], ["filings", "no"]);
  assert.equal(second.create, undefined);
});

test("dashboard counts follow responsibility", () => {
  const clients = [
    { Key: "A", Kind: "Ltd", Status: "active" },
    { Key: "B", Kind: "Ltd", Status: "cosec-only" },
    { Key: "C", Kind: "LLP", Status: "Archived" },
    { Key: "D", Kind: "Individual" },
  ];
  const rows = [
    { key: "A", cs: { date: "2026-10-01" }, accounts: { date: "2026-11-30" }, openFilings: 2 },
    { key: "B", cs: { date: "2026-10-01" }, accounts: { date: "2026-10-01" }, openFilings: 0 },
    { key: "C", cs: { date: "2026-10-01" }, accounts: { date: "2026-10-01" }, openFilings: 1 },
    { key: "D", cs: { date: "" }, accounts: { date: "" }, openFilings: 0 },
  ];
  const c = counts(clients, [], rows, "2026-10-28");
  assert.deepEqual(c, { total: 3, managed: 1, monitoring: 1, other: 1, notClients: 1, cs01Overdue: 1, cs01Soon: 0, accountsOverdue: 0, accountsSoon: 1, outstanding: 3 });
});
