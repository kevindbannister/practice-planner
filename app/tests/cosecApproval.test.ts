import test from "node:test";
import assert from "node:assert/strict";
import { act, allotShares, prepareTransfer, txStatus, Snapshot } from "../src/lib/cosec.ts";
import { approvalGate, approvalOf, decide, defaultApproval, fromSigning, recordManual, sendForApproval, summaryOf, withdrawApproval, approvalPdf } from "../src/lib/cosecApproval.ts";
import { readEntry } from "../src/lib/shareLedger.ts";

let n = 0, clock = 0;
const ctx = () => ({ actor: "Kevin", now: new Date(Date.UTC(2026, 9, 27, 9, 0, clock++)).toISOString(), pid: "default", newKey: (p: string) => `${p}${++n}` });
const cfg: any = { staff: [], overriders: [], independentReview: false, auto: true };
const ltd: any = { Key: "C1", Title: "Acme Ltd", Kind: "Ltd", CompanyNumber: "01234567" };
const apply = (s: any, w: any) => {
  const names: Record<string, string> = { CoSecTransactions: "txs", CoSecShares: "shares", CoSecLedger: "ledger", CoSecEvents: "events", CoSecOfficers: "officers", CoSecPscs: "pscs" };
  for (const c of w.creates || []) s[names[c.list]]?.push({ ...c.row });
  for (const p of w.patches || []) { const r = s[names[p.list]]?.find((x: any) => x.Key === p.row.Key); if (r) Object.assign(r, p.patch); }
  return w;
};
const world = (): any => ({ clients: [ltd], officers: [], pscs: [], shares: [], classes: [{ ClientKey: "C1", Name: "Ordinary", Status: "current" }], ledger: [], txs: [], events: [] });
const led = (o: any) => ({ Key: o.Key, ClientKey: "C1", Status: "active", Class: "Ordinary", Created: o.Key, Currency: "GBP", ...o });

test("a new draft is undecided and can't be approved until the client-approval question is answered", () => {
  const s = world();
  const r: any = allotShares(ltd, { holder: "Bob Jones", class: "Ordinary", number: 10, currency: "GBP", nominal: 1, paid: 1, date: "2026-10-01" }, s, true, ctx());
  apply(s, r);
  const tx = () => s.txs[0];
  assert.equal(approvalOf(tx()), "undecided");
  assert.match(approvalGate(tx())!, /Decide whether/);
  assert.match((act(tx(), "approve", {}, cfg, ctx(), s) as any).error, /Decide whether/);
});
test("mandatory approvals can't just be skipped; others can", () => {
  const s = world();
  apply(s, allotShares(ltd, { holder: "Bob", class: "Ordinary", number: 10, currency: "GBP", nominal: 1, paid: 1, date: "2026-10-01" }, s, true, ctx()));
  const tx = () => s.txs[0];
  assert.equal(defaultApproval("SH01").mandatory, true); assert.equal(defaultApproval("AD01").required, true); assert.equal(defaultApproval("AD01").mandatory, false);
  assert.match((decide(tx(), false, "", true, ctx()) as any).error, /resolution/);
  const ok: any = decide(tx(), false, "Board resolution 1 Oct 2026", true, ctx());
  assert.equal(ok.error, undefined); apply(s, ok);
  assert.equal(approvalOf(tx()), "not-required"); assert.equal(approvalGate(tx()), undefined);
  assert.match(JSON.parse(tx().History).at(-1).what, /no client approval/);
  assert.match((decide(tx(), true, "", false, ctx()) as any).error, /can't/);
});
const sh01 = () => { const s = world(); apply(s, allotShares(ltd, { holder: "Bob", class: "Ordinary", number: 10, currency: "GBP", nominal: 1, paid: 1, date: "2026-10-01" }, s, true, ctx())); return s; };
test("portal approval: awaiting blocks internal approval; completed signing approves; declined blocks", () => {
  const s = sh01(); const tx = () => s.txs[0];
  apply(s, decide(tx(), true, "", true, ctx()) as any);
  assert.match(approvalGate(tx())!, /Client approval is needed/);
  assert.match((sendForApproval(tx(), { method: "portal", signatories: ["Ann"] }, true, ctx()) as any).error, /signing request/);
  apply(s, sendForApproval(tx(), { method: "portal", signingId: "SG1", portalDocId: "D1", signatories: ["Ann Acme"] }, true, ctx()) as any);
  assert.equal(approvalOf(tx()), "awaiting");
  assert.match((act(tx(), "approve", {}, cfg, ctx(), s) as any).error, /Waiting for the client/);
  const still = fromSigning(tx(), { id: "SG1", ref: "SG-1", status: "out", completedAt: "", signatories: [{ name: "Ann Acme", status: "pending", signedAt: "" }] }, ctx());
  assert.equal(still.written, undefined); assert.match(still.progress, /0 of 1/);
  assert.equal(fromSigning(tx(), { id: "OTHER", ref: "x", status: "completed", completedAt: "", signatories: [] }, ctx()).written, undefined, "a different signing request is ignored");
  const done = fromSigning(tx(), { id: "SG1", ref: "SG-1", status: "completed", completedAt: "2026-10-05T10:00:00Z", signatories: [{ name: "Ann Acme", status: "signed", signedAt: "2026-10-05T10:00:00Z" }] }, ctx());
  apply(s, done.written);
  assert.equal(approvalOf(tx()), "approved"); assert.equal(tx().ApprovalEvidence, "Portal signing SG-1");
  const r: any = act(tx(), "approve", {}, cfg, ctx(), s); assert.equal(r.error, undefined);
  // applying the same result again does nothing
  assert.equal(fromSigning(tx(), { id: "SG1", ref: "SG-1", status: "completed", completedAt: "x", signatories: [] }, ctx()).written, undefined);
});
test("declined, withdrawn and expired requests", () => {
  const s = sh01(); const tx = () => s.txs[0];
  apply(s, decide(tx(), true, "", true, ctx()) as any);
  apply(s, sendForApproval(tx(), { method: "portal", signingId: "SG1", signatories: ["Ann"] }, true, ctx()) as any);
  apply(s, withdrawApproval(tx(), true, ctx()) as any); assert.equal(approvalOf(tx()), "required");
  apply(s, sendForApproval(tx(), { method: "portal", signingId: "SG2", signatories: ["Ann"] }, true, ctx()) as any);
  apply(s, fromSigning(tx(), { id: "SG2", ref: "r", status: "declined", completedAt: "", signatories: [] }, ctx()).written);
  assert.equal(approvalOf(tx()), "declined"); assert.match(approvalGate(tx())!, /declined/);
  apply(s, sendForApproval(tx(), { method: "portal", signingId: "SG3", signatories: ["Ann"] }, true, ctx()) as any);
  apply(s, fromSigning(tx(), { id: "SG3", ref: "r", status: "expired", completedAt: "", signatories: [] }, ctx()).written);
  assert.equal(approvalOf(tx()), "required");
});
test("manual approval needs who, when (not in the future) and the signed copy or where it is", () => {
  const s = sh01(); const tx = () => s.txs[0];
  apply(s, decide(tx(), true, "", true, ctx()) as any);
  apply(s, sendForApproval(tx(), { method: "manual", docKey: "DOC1", signatories: ["Ann"] }, true, ctx()) as any);
  assert.match((recordManual(tx(), { by: "", at: "2026-10-05", evidence: "x" }, true, ctx()) as any).error, /who signed/);
  assert.match((recordManual(tx(), { by: "Ann", at: "2030-01-01", evidence: "x" }, true, ctx()) as any).error, /future/);
  assert.match((recordManual(tx(), { by: "Ann", at: "2026-10-05", evidence: "" }, true, ctx()) as any).error, /signed copy/);
  apply(s, recordManual(tx(), { by: "Ann Acme", at: "2026-10-05", evidence: "", docKey: "SIGNED1" }, true, ctx()) as any);
  assert.equal(approvalOf(tx()), "approved"); assert.equal(tx().ApprovalSignedDocKey, "SIGNED1");
});
test("an accepted allotment writes one ledger entry, once", () => {
  const s = sh01(); const tx = () => s.txs[0];
  apply(s, decide(tx(), false, "Board 1 Oct", true, ctx()) as any);
  apply(s, act(tx(), "edit", { payload: { ...JSON.parse(tx().Payload) } }, cfg, ctx(), s) as any);
  const a: any = act(tx(), "approve", {}, cfg, ctx(), s);
  assert.equal(a.error, undefined, a.error); apply(s, a);
  apply(s, act(tx(), "external", { ref: "X1" }, cfg, ctx(), s) as any);
  assert.equal(s.ledger.length, 1);
  const e = readEntry(s.ledger[0]); assert.equal(e.type, "allotment"); assert.equal(e.number, 10); assert.equal(e.to, "Bob"); assert.equal(e.txKey, tx().Key);
});
test("a share transfer is a transaction: needs approval decision, completes without filing, moves the ledger and register", () => {
  const s = world();
  s.ledger.push(led({ Key: "L1", Type: "opening", EffectiveDate: "2020-01-01", Number: 100, ToHolder: "Alice" }));
  s.shares.push({ Key: "H1", ClientKey: "C1", Holder: "Alice", Class: "Ordinary", Number: 100, Status: "current", Currency: "GBP" });
  const bad: any = prepareTransfer(ltd, { fromRow: "H1", from: "Alice", to: "Bob", class: "Ordinary", number: 500, date: "2026-10-01" }, s, true, ctx());
  assert.match(bad.error, /only has 100|up to what/i);
  const r: any = prepareTransfer(ltd, { fromRow: "H1", from: "Alice", to: "Bob", class: "Ordinary", number: 40, date: "2026-10-01", consideration: "£40" }, s, true, ctx());
  assert.equal(r.error, undefined); apply(s, r);
  const tx = () => s.txs[0];
  assert.equal(tx().Form, "STT"); assert.equal(approvalOf(tx()), "undecided");
  assert.match((act(tx(), "complete", {}, cfg, ctx(), s) as any).error, /Approve it/);
  apply(s, decide(tx(), false, "Directors approved 1 Oct 2026", true, ctx()) as any);
  apply(s, act(tx(), "approve", {}, cfg, ctx(), s) as any);
  assert.match((act(tx(), "external", {}, cfg, ctx(), s) as any).error, /Nothing is filed/);
  assert.match((act(tx(), "submitted", { gatewayRef: "x" }, cfg, ctx(), s) as any).error, /can't be sent/);
  const c: any = act(tx(), "complete", {}, cfg, ctx(), s); assert.equal(c.error, undefined, c.error); apply(s, c);
  assert.equal(txStatus(tx()), "completed");
  assert.equal(s.ledger.length, 2); assert.equal(readEntry(s.ledger[1]).type, "transfer");
  assert.equal(s.shares.find((x: any) => x.Key === "H1").Number, 60); assert.equal(s.shares.some((x: any) => x.Holder === "Bob" && x.Number === 40), true);
  assert.match((act(tx(), "complete", {}, cfg, ctx(), s) as any).error, /Approve it/, "completing twice does nothing");
});
test("completion is refused if the ledger would go negative at that date", () => {
  const s = world();
  s.ledger.push(led({ Key: "L1", Type: "opening", EffectiveDate: "2020-01-01", Number: 100, ToHolder: "Alice" }));
  const r: any = prepareTransfer(ltd, { from: "Alice", to: "Bob", class: "Ordinary", number: 10, date: "2026-10-01" }, s, true, ctx());
  assert.equal(r.error, undefined);
  apply(s, r);
  s.ledger[0].EffectiveDate = "2026-12-01"; // the ledger was corrected after the draft was prepared
  const tx = () => s.txs[0];
  apply(s, decide(tx(), false, "Directors approved", true, ctx()) as any);
  apply(s, act(tx(), "approve", {}, cfg, ctx(), s) as any);
  assert.match((act(tx(), "complete", {}, cfg, ctx(), s) as any).error, /would be left holding|Shares can only move/);
});
test("the approval document lists company, change, wording and a signature per signatory", async () => {
  const s = sh01();
  const sum = summaryOf(s.txs[0], { name: "Acme Ltd", number: "01234567" }, "Return of allotment of shares", ["Ann Acme", "Bob Acme"], "Example Practice");
  assert.equal(sum.signatories.length, 2); assert.match(sum.wording, /allot/); assert.ok(sum.details.some(([k]) => k === "Number of shares"));
  const pdf = await approvalPdf(sum);
  assert.equal(Buffer.from(pdf.slice(0, 5)).toString(), "%PDF-");
});
