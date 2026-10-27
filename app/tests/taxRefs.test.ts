import { test } from "node:test";
import assert from "node:assert/strict";
import { allFields, authRow, authState, check, groupsFor, mask } from "../src/lib/taxRefs.ts";

test("groups depend on the client type", () => {
  assert.deepEqual(groupsFor({ Kind: "Ltd" } as any).map((g) => g.key), ["ch", "vat", "ct", "paye", "sa"]);
  assert.deepEqual(groupsFor({ Kind: "Individual" } as any).map((g) => g.key), ["vat", "paye", "sa"]);
  assert.equal(groupsFor({ Kind: "Ltd" } as any).find((g) => g.key === "sa")!.auth, undefined);
  assert.ok(allFields({ Kind: "Ltd" } as any).some(([k]) => k === "CTUTR"));
});

test("sensitive codes are masked but recognisable", () => {
  assert.equal(mask("4600723736"), "••••••••36");
  assert.equal(mask("AB12"), "••••");
  assert.equal(mask(""), "");
});

test("format checks guide without blocking", () => {
  assert.equal(check("UTR", "4600723736"), "");
  assert.equal(check("UTR", "460072373"), "A UTR is 10 digits.");
  assert.equal(check("NINumber", "AB123456C"), "");
  assert.notEqual(check("NINumber", "12345"), "");
  assert.equal(check("VATNumber", "GB123456789"), "");
  assert.equal(check("PAYERef", "123/AB456"), "");
  assert.equal(check("CHAuthCode", "ABC123"), "");
  assert.equal(check("CompanyNumber", "SC123456"), "");
  assert.equal(check("PAYERef", ""), "");
});

test("authorisation state", () => {
  const today = "2026-10-27";
  assert.equal(authState(undefined, today), "none");
  assert.equal(authState({ Status: "requested", LinkSent: "2026-10-01" } as any, today), "requested");
  assert.equal(authState({ Status: "authorised", Expiry: "2027-10-01" } as any, today), "authorised");
  assert.equal(authState({ Status: "authorised", Expiry: "2026-11-10" } as any, today), "expiring");
  assert.equal(authState({ Status: "authorised", Expiry: "2026-10-01" } as any, today), "expired");
  const rows = [{ ClientKey: "C1", Service: "vat", Status: "requested", LinkSent: "2026-01-01" }, { ClientKey: "C1", Service: "vat", Status: "authorised", LinkSent: "2026-06-01" }] as any;
  assert.equal(authRow(rows, "C1", "vat")!.Status, "authorised");
});
