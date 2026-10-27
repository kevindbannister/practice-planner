import { test } from "node:test";
import assert from "node:assert/strict";
import { counts, filterRows, signingRows, waitingDays } from "../src/lib/signingView.ts";
import type { StaffDoc, StaffSigning } from "../src/lib/portalAdmin.ts";

const sig = (o: Partial<StaffSigning>): StaffSigning => ({ id: "S1", ref: "SIG-1", clientKey: "C1", docId: "D1", version: 1, title: "Engagement letter", status: "out", sequential: false, createdAt: "2026-10-01T09:00:00Z", createdByName: "Kevin", expiresAt: "2026-10-31T09:00:00Z", message: "", completedAt: "", sealedDocId: "", certDocId: "", remindedAt: "", declineReason: "", sha256: "", sealedSha256: "", signatories: [{ id: "a", userId: "u1", name: "Ann", email: "", order: 1, status: "pending", signedAt: "", viewedAt: "" }, { id: "b", userId: "u2", name: "Bob", email: "", order: 2, status: "signed", signedAt: "2026-10-02T10:00:00Z", viewedAt: "" }], ...o });
const doc = (o: Partial<StaffDoc>): StaffDoc => ({ id: "D2", clientKey: "C1", title: "Accounts 2026", category: "Accounts", status: "awaiting-approval", published: true, publishedAt: "2026-10-05T09:00:00Z", createdAt: "2026-10-04T09:00:00Z", updatedAt: "", from: "practice", needsApproval: true, approval: null, message: "", locked: false, internalNote: "", assignedTo: [], assignedNames: [], uploadedBy: "", scan: "", versions: [], size: 0, ext: "pdf", ...o });
const eng = (o: Record<string, unknown>) => ({ Key: "E1", ClientKey: "C1", Title: "Engagement letter: X", Status: "signed", SignedAt: "2026-09-01", SignedBy: "Ann", SignMethod: "external", Created: "2026-08-30T00:00:00Z", ...o });

test("a portal request says who it is waiting for and who has signed", () => {
  const [r] = signingRows({ signings: [sig({})], docs: [], engagements: [], clientKey: "C1", portalLoaded: true });
  assert.equal(r.state, "waiting");
  assert.equal(r.text, "Waiting for Ann · signed by Bob");
  assert.equal(r.chasable, true);
});

test("a letter sent through the portal is shown once", () => {
  const rows = signingRows({ signings: [sig({})], docs: [], engagements: [eng({ Status: "out", SigningId: "S1", SignMethod: "portal", SentOn: "2026-10-01T09:00:00Z" })], clientKey: "C1", portalLoaded: true });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "portal");
});

test("when the portal can't be read, the letter still shows", () => {
  const rows = signingRows({ signings: [], docs: [], engagements: [eng({ Status: "out", SigningId: "S1", SignMethod: "portal", SentOn: "2026-10-01T09:00:00Z", Signatories: JSON.stringify(["Ann"]) })], clientKey: "C1", portalLoaded: false });
  assert.equal(rows[0].text, "Waiting for Ann");
});

test("filed letters, other clients, drafts and approvals", () => {
  const rows = signingRows({
    signings: [], clientKey: "C1", portalLoaded: true,
    engagements: [eng({}), eng({ Key: "E2", Status: "unsigned", SignedAt: "" }), eng({ Key: "E3", Status: "draft" }), eng({ Key: "E4", ClientKey: "C2" })],
    docs: [doc({}), doc({ id: "D3", title: "Tax return", status: "approved", approval: { status: "approved", at: "2026-10-06T10:00:00Z", by: "Ann", note: "" } }), doc({ id: "D4", needsApproval: false })],
  });
  assert.deepEqual(rows.map((r) => r.id).sort(), ["approval:D2", "approval:D3", "letter:E1", "letter:E2"]);
  assert.equal(rows.find((r) => r.id === "letter:E1")!.text, "Signed by Ann (filed, signed outside)");
  assert.equal(rows.find((r) => r.id === "approval:D3")!.state, "signed");
  assert.deepEqual(counts(rows), { waiting: 1, signed: 2, declined: 0, cancelled: 0, expired: 0, unsigned: 1 });
});

test("filtering and days waiting", () => {
  const rows = signingRows({ signings: [sig({}), sig({ id: "S2", title: "Tax return", status: "declined", signatories: [{ id: "a", userId: "u1", name: "Ann", email: "", order: 1, status: "declined", signedAt: "", viewedAt: "" }] })], docs: [], engagements: [], clientKey: "C1", portalLoaded: true });
  assert.equal(filterRows(rows, { state: "declined" }).length, 1);
  assert.equal(filterRows(rows, { q: "bob" }).length, 1);
  assert.equal(waitingDays(rows.find((r) => r.state === "waiting")!, "2026-10-27"), 26);
});
