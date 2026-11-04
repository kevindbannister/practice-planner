import test from "node:test";
import assert from "node:assert/strict";
import { Ctx, DEFAULT_SETTINGS, Filing, FilingSettings, advance, amend, describe, duplicateOf, envGate, isFiled, needsRework, newFiling, readFiling, readiness, sha256Hex } from "../src/lib/hmrcFiling";

const NOW = "2026-11-04T09:00:00.000Z";
const LIVE_ON: FilingSettings = { vendorIdSet: true, testCredentialsSet: true, liveEnabled: true, liveApprovedBy: "Kevin" };
const ctx = (over: Partial<Ctx> = {}): Ctx => ({ by: "Kevin", now: NOW, can: () => true, currentHash: "h1", settings: LIVE_ON, xml: { ready: true, reason: "" }, ...over });
const fresh = (env: "mock" | "ets" | "live" = "mock") => readFiling(newFiling({ clientKey: "c1", service: "SA100", period: "2025-26", env, by: "Kevin", now: NOW }).row);
const apply = (f: Filing, r: { error?: string; patch?: Record<string, unknown> }) => { assert.equal(r.error, undefined); return readFiling({ ...(f as any as Record<string, unknown>), ...JSON.parse(JSON.stringify({})), Key: f.key, ClientKey: f.clientKey, Service: f.service, Period: f.period, Version: f.version, Supersedes: f.supersedes, State: f.state, Env: f.env, PayloadHash: f.payloadHash, XmlHash: f.xmlHash, Validation: f.validation ? JSON.stringify(f.validation) : "", ReviewedBy: f.reviewedBy, ReviewedAt: f.reviewedAt, ApprovedBy: f.approvedBy, ApprovedAt: f.approvedAt, ApprovedHash: f.approvedHash, ApprovalNote: f.approvalNote, ConfirmedBy: f.confirmedBy, ConfirmedAt: f.confirmedAt, SubmittedBy: f.submittedBy, SubmittedAt: f.submittedAt, CorrelationId: f.correlationId, Irmark: f.irmark, Outcome: f.outcome, AnsweredAt: f.answeredAt, Messages: JSON.stringify(f.messages), Receipt: f.receipt, Created: f.created, CreatedBy: f.createdBy, Notes: f.notes, ...r.patch }); };
const valid = (hash = "h1") => ({ at: NOW, payloadHash: hash, schema: "test", errors: [] as string[], warnings: [] as string[] });
/** Walk a new filing up to "ready". */
function toReady(env: "mock" | "ets" | "live" = "mock", over: Partial<Ctx> = {}): Filing {
  let f = fresh(env);
  f = apply(f, advance(f, "prepared", ctx(over)));
  f = apply(f, advance(f, "validated", ctx({ ...over, validation: valid() })));
  f = apply(f, advance(f, "reviewed", ctx(over)));
  f = apply(f, advance(f, "client-approved", ctx({ ...over, approval: { by: "Client A", note: "Emailed approval" } })));
  return apply(f, advance(f, "ready", ctx(over)));
}

test("a return moves forward one step at a time", () => {
  const f = fresh();
  assert.match(advance(f, "validated", ctx()).error!, /can't go to/);
  assert.match(advance(f, "submitted", ctx()).error!, /can't go to/);
  const ready = toReady();
  assert.equal(ready.state, "ready");
  assert.equal(ready.approvedHash, "h1");
  assert.equal(ready.approvedBy, "Client A");
});

test("validation errors stop a return being validated, and a changed return has to be prepared again", () => {
  let f = fresh(); f = apply(f, advance(f, "prepared", ctx()));
  assert.match(advance(f, "validated", ctx({ validation: { ...valid(), errors: ["Box 1 is missing"] } })).error!, /1 validation error/);
  assert.match(advance(f, "validated", ctx({ validation: valid("old") })).error!, /changed since it was prepared/);
  assert.match(advance(f, "validated", ctx()).error!, /Validate the return first/);
});

test("the client approves an exact version: a change afterwards stops it going further", () => {
  const f = toReady();
  assert.equal(needsRework(f, "h1"), false);
  assert.equal(needsRework(f, "h2"), true);
  assert.match(advance(f, "submitted", ctx({ currentHash: "h2", confirm: true })).error!, /changed since the client approved it/);
  const back = apply(f, advance(f, "prepared", ctx({ currentHash: "h2" })));
  assert.equal(back.state, "prepared"); assert.equal(back.payloadHash, "h2");
  assert.equal(back.approvedHash, ""); assert.equal(back.reviewedBy, "");
});

test("review and filing need permission, and filing needs an explicit confirmation", () => {
  let f = fresh(); f = apply(f, advance(f, "prepared", ctx())); f = apply(f, advance(f, "validated", ctx({ validation: valid() })));
  assert.match(advance(f, "reviewed", ctx({ can: () => false })).error!, /permission/);
  const ready = toReady();
  assert.match(advance(ready, "submitted", ctx({ can: (w) => w !== "file", confirm: true })).error!, /permission to file/);
  assert.match(advance(ready, "submitted", ctx()).error!, /Confirm that you want to file/);
  assert.match(advance(ready, "submitted", ctx({ confirm: false })).error!, /Confirm that you want to file/);
  assert.equal(advance(ready, "submitted", ctx({ confirm: true })).error, undefined);
});

test("live filing is off unless switched on and approved by name; the test service needs HMRC's credentials", () => {
  assert.equal(envGate("mock", DEFAULT_SETTINGS).ok, true);
  assert.match(envGate("live", DEFAULT_SETTINGS).reason, /switched off/);
  assert.match(envGate("live", { ...LIVE_ON, liveApprovedBy: " " }).reason, /approved by a named person/);
  assert.match(envGate("live", { ...LIVE_ON, vendorIdSet: false }).reason, /vendor ID/);
  assert.equal(envGate("live", LIVE_ON).ok, true);
  assert.match(envGate("ets", DEFAULT_SETTINGS).reason, /vendor ID/);
  assert.match(envGate("ets", { ...DEFAULT_SETTINGS, vendorIdSet: true }).reason, /test credentials/);
  const ready = toReady("mock");
  const live: Filing = { ...ready, env: "live" };
  assert.match(advance(live, "submitted", ctx({ confirm: true, settings: DEFAULT_SETTINGS })).error!, /switched off/);
});

test("the same version can't be sent twice, but a later version can", () => {
  const a = { ...toReady(), key: "A", state: "submitted" as const };
  const b = { ...toReady(), key: "B" };
  assert.equal(duplicateOf(b, [a])?.key, "A");
  assert.match(advance(b, "submitted", ctx({ confirm: true, all: [a, b] })).error!, /already been sent/);
  const accepted = { ...a, state: "accepted" as const, outcome: "hmrc" as const };
  assert.equal(duplicateOf({ ...b, payloadHash: "same" }, [{ ...accepted, payloadHash: "same" }])?.key, "A");
  assert.equal(duplicateOf({ ...b, payloadHash: "different" }, [{ ...accepted, payloadHash: "same" }]), undefined);
});

test("only HMRC's live acceptance counts as filed", () => {
  const sub = { ...toReady("live"), state: "submitted" as const };
  const ans = (outcome: "hmrc" | "mock") => advance(sub, "accepted", ctx({ answer: { outcome, accepted: true, receipt: "R1", correlationId: "C1" } }));
  const live = apply(sub, ans("hmrc")); assert.equal(isFiled(live), true); assert.equal(describe(live), "Accepted by HMRC");
  const mock = apply(sub, ans("mock")); assert.equal(isFiled(mock), false); assert.match(describe(mock), /nothing was sent to HMRC/);
  const test = apply({ ...sub, env: "ets" }, ans("hmrc")); assert.equal(isFiled(test), false); assert.match(describe(test), /not filed/);
  assert.match(advance(sub, "rejected", ctx({ answer: { outcome: "hmrc", accepted: true } })).error!, /isn't what the answer says/);
  assert.match(advance(sub, "accepted", ctx()).error!, /no answer/);
});

test("a rejection can be corrected as a new version; the old one is never changed", () => {
  const sub = { ...toReady(), state: "submitted" as const };
  const rej = apply(sub, advance(sub, "rejected", ctx({ answer: { outcome: "hmrc", accepted: false, messages: [{ number: "1046", text: "Invalid" }] } })));
  assert.deepEqual(rej.messages, [{ number: "1046", text: "Invalid" }]);
  const a = amend(rej, "Kevin", NOW); assert.equal(a.error, undefined);
  const next = readFiling(a.row!);
  assert.equal(next.version, 2); assert.equal(next.supersedes, rej.key); assert.equal(next.state, "draft"); assert.equal(next.approvedHash, "");
  assert.match(amend(sub, "Kevin", NOW).error!, /answered/);
  const mockDone = { ...rej, state: "accepted" as const, outcome: "mock" as const };
  assert.match(amend(mockDone, "Kevin", NOW).error!, /mock/);
});

test("every step writes a history entry, and history rows are only ever added", () => {
  const f = fresh(); const r = advance(f, "prepared", ctx());
  assert.equal(r.log!.FilingKey, f.key); assert.equal(r.log!.From, "draft"); assert.equal(r.log!.To, "prepared"); assert.equal(r.log!.By, "Kevin");
  assert.equal(newFiling({ clientKey: "c1", service: "CT600", period: "2025", env: "mock", by: "K", now: NOW }).log.Event, "created");
});

test("readiness lists what is still missing", () => {
  const ready = toReady();
  const all = readiness(ready, "h1", LIVE_ON, { ready: true, reason: "" });
  assert.ok(all.every((c) => c.ok), JSON.stringify(all));
  const blocked = readiness(fresh("live"), "h1", DEFAULT_SETTINGS, { ready: false, reason: "No official schema" });
  assert.equal(blocked.find((c) => c.key === "xml")!.detail, "No official schema");
  assert.equal(blocked.find((c) => c.key === "env")!.ok, false);
  assert.equal(blocked.find((c) => c.key === "approved")!.ok, false);
});

test("sha256Hex is stable", async () => {
  assert.equal(await sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("without HMRC XML a return can be approved but never marked ready or sent", () => {
  const noXml = { xml: { ready: false, reason: "The SA100 adapter isn't built." } };
  let f = fresh();
  f = apply(f, advance(f, "prepared", ctx(noXml)));
  f = apply(f, advance(f, "validated", ctx({ ...noXml, validation: valid() })));
  f = apply(f, advance(f, "reviewed", ctx(noXml)));
  f = apply(f, advance(f, "client-approved", ctx({ ...noXml, approval: { by: "Client A", note: "" } })));
  assert.equal(advance(f, "ready", ctx(noXml)).error, "The SA100 adapter isn't built.");
  const ready = toReady();
  assert.equal(advance(ready, "submitted", ctx({ ...noXml, confirm: true })).error, "The SA100 adapter isn't built.");
});
