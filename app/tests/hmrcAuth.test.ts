import test from "node:test";
import assert from "node:assert/strict";
import { fromHmrcStatus, nextAction, readRecord, relevantServices, vatInvitation, vatProblems, verified, auditRow } from "../src/lib/hmrcAuth";

test("HMRC statuses map; unknown ones never become authorised", () => {
  assert.equal(fromHmrcStatus("Pending"), "awaiting-client");
  assert.equal(fromHmrcStatus("accepted"), "authorised");
  assert.equal(fromHmrcStatus("Rejected"), "rejected");
  assert.equal(fromHmrcStatus("Cancelled"), "cancelled");
  assert.equal(fromHmrcStatus("Expired"), "expired");
  assert.equal(fromHmrcStatus("Deauthorised"), null);
  assert.equal(fromHmrcStatus(undefined), null);
});

test("only an HMRC-sourced authorised record is verified", () => {
  assert.equal(verified({ status: "authorised", source: "hmrc" }), true);
  assert.equal(verified({ status: "authorised", source: "manual" }), false);
  assert.equal(verified({ status: "authorised", source: "client" }), false);
  assert.equal(verified({ status: "awaiting-client", source: "hmrc" }), false);
});

test("records are read safely", () => {
  const r = readRecord({ Key: "H1", ClientKey: "C1", Service: "ct", Status: "nonsense", StatusSource: "x" });
  assert.equal(r.status, "not-requested");
  assert.equal(r.source, "none");
  assert.equal(r.service, "ct");
});

test("services follow the client's kind and references", () => {
  assert.deepEqual(relevantServices({ Kind: "Individual" }), []);
  assert.deepEqual(relevantServices({ Kind: "Ltd", VATNumber: "123456789", PAYERef: "123/AB1" }), ["vat", "ct", "paye"]);
  assert.deepEqual(relevantServices({ Kind: "Partnership", VATNumber: "1" }), ["vat"]);
});

test("VAT checks: number and registration date", () => {
  assert.deepEqual(vatProblems({ VATNumber: "GB 123 456 789", VATRegistered: "2020-03-01" }, "2026-10-27"), []);
  assert.match(vatProblems({ VATNumber: "12345", VATRegistered: "2020-03-01" }, "2026-10-27")[0], /9 digits/);
  assert.match(vatProblems({ VATNumber: "123456789", VATRegistered: "" }, "2026-10-27")[0], /needed/);
  assert.match(vatProblems({ VATNumber: "123456789", VATRegistered: "2020-02-31" }, "2026-10-27")[0], /real date/);
  assert.match(vatProblems({ VATNumber: "123456789", VATRegistered: "2030-01-01" }, "2026-10-27")[0], /future/);
});

test("the VAT invitation is built from the client record", () => {
  assert.deepEqual(vatInvitation({ Kind: "Ltd", VATNumber: "GB101747696", VATRegistered: "2007-05-18T00:00:00" }), { service: "MTD-VAT", clientType: "business", clientIdType: "vrn", clientId: "101747696", knownFact: "2007-05-18" });
  assert.equal(vatInvitation({ Kind: "Individual", VATNumber: "101747696", VATRegistered: "2007-05-18" }).clientType, "personal");
});

test("next action reflects status, expiry and source", () => {
  const base = { key: "", clientKey: "", service: "vat" as const, ref: "", method: "api" as const, hmrcId: "", requested: "", expires: "", authorised: "", checked: "", owner: "", onboarding: "", notes: "", env: "" };
  assert.equal(nextAction(undefined, "2026-10-27").action, "Request authorisation");
  assert.equal(nextAction({ ...base, status: "awaiting-client", source: "hmrc", expires: "2026-10-29" }, "2026-10-27").urgent, true);
  assert.equal(nextAction({ ...base, status: "awaiting-client", source: "hmrc", expires: "2026-11-15" }, "2026-10-27").urgent, false);
  assert.equal(nextAction({ ...base, status: "authorised", source: "hmrc" }, "2026-10-27").action, "None");
  assert.equal(nextAction({ ...base, status: "authorised", source: "manual" }, "2026-10-27").urgent, true);
});

test("audit rows hold facts only", () => {
  const a = auditRow({ key: "E1", clientKey: "C1", service: "vat", type: "submitted", summary: "x".repeat(900), user: "Kevin", at: "2026-10-27T10:00:00Z" });
  assert.equal(String(a.Summary).length, 500);
  assert.deepEqual(Object.keys(a).sort(), ["Actor", "At", "ClientKey", "HmrcId", "Key", "Service", "Status", "StatusSource", "Summary", "Type"]);
});
