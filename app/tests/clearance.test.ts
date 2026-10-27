import { test } from "node:test";
import assert from "node:assert/strict";
import { clearanceLetter, defaultItems, greeting, itemsFor, latest, problems, readItems } from "../src/lib/clearance.ts";

const company = { Title: "Bck Interior Ltd", Kind: "Ltd", CompanyNumber: "01234567" } as any;
const person = { Title: "Adam French", Kind: "Individual" } as any;

test("the request list depends on the client type", () => {
  assert.ok(itemsFor(company).some((i) => i.key === "ct600"));
  assert.ok(!itemsFor(company).some((i) => i.key === "sa"));
  assert.ok(itemsFor(person).some((i) => i.key === "sa"));
  assert.ok(!itemsFor(person).some((i) => i.key === "ct600"));
});

test("no contact falls back to Sir/Madam and Yours faithfully", () => {
  assert.deepEqual(greeting(""), { salutation: "Dear Sir/Madam,", signOff: "Yours faithfully," });
  assert.deepEqual(greeting("Mr Smith"), { salutation: "Dear Mr Smith,", signOff: "Yours sincerely," });
});

test("the letter names the client and lists only what is asked for", () => {
  const items = defaultItems(company).map((x, i) => ({ ...x, asked: i !== 0 }));
  const l = clearanceLetter({ client: company, clientName: "Bck Interior Ltd", previous: { firm: "Old & Co", contact: "", email: "", address: "1 High St, Leeds" }, items, practice: "Us LLP", person: "Kevin", date: "27 October 2026" });
  assert.equal(l.salutation, "Dear Sir/Madam,");
  assert.match(l.body, /company number 01234567/);
  assert.ok(!l.body.includes("Last filed accounts"));
  assert.ok(l.body.includes("- Last Corporation Tax return"));
  assert.deepEqual(l.address, ["Old & Co", "1 High St", "Leeds"]);
  assert.equal(l.subject, "Professional clearance: Bck Interior Ltd");
});

test("saved items are read back, and a blank record gets the standard list", () => {
  assert.equal(readItems("", company).length, itemsFor(company).length);
  assert.equal(readItems(JSON.stringify([{ key: "x", label: "Something", asked: false, got: true }]), company)[0].got, true);
});

test("problems and the latest status", () => {
  assert.equal(problems({ firm: "", contact: "", email: "", address: "" }).length, 2);
  const rows = [{ ClientKey: "C1", Status: "requested", PrevFirm: "Old & Co", SentOn: "2026-10-10T09:00:00Z", Created: "2026-10-09" }, { ClientKey: "C1", Status: "draft", Created: "2026-09-01" }];
  const l = latest(rows as any, "C1", "2026-10-27");
  assert.equal(l.status, "requested");
  assert.equal(l.waitingDays, 17);
  assert.equal(latest(rows as any, "C2", "2026-10-27").status, "none");
});
