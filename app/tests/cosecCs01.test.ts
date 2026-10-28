import test from "node:test";
import assert from "node:assert/strict";
import { buildCs01, blankCs01, cs01Issues, readCs01, idOf, Cs01Input } from "../src/lib/cosecCs01.ts";
import { readFees, feeFor, money, DEFAULT_FEES } from "../src/lib/cosecFees.ts";
import { readEntry } from "../src/lib/shareLedger.ts";

const client: any = { Key: "C1", Title: "Acme Ltd", Kind: "Ltd", CompanyNumber: "01234567", RegisteredOffice: "10 High Street, London, E1 5NF", SIC: "62020", CHVerified: JSON.stringify({ office: "10 High Street, London, E1 5NF", csTo: "2025-10-01", csDue: "2025-10-15" }) };
const dir = (o: any = {}) => ({ Key: "O1", ClientKey: "C1", Role: "director", Kind: "individual", Status: "current", First: "Jane", Last: "Doe", IdStatus: "verified", ...o });
const led = [readEntry({ Key: "L1", ClientKey: "C1", Type: "opening", EffectiveDate: "2020-01-01", Class: "Ordinary", Number: 100, ToHolder: "Jane Doe", Nominal: 1, Status: "active", Created: "a" })];
const ready: Cs01Input = { client, payload: { ...blankCs01("2026-10-01", "acme@example.com"), declarations: { infoReviewed: true, lawfulPurpose: true, emailConfirmed: true }, declaredBy: "Jane Doe" }, officers: [dir()], pscs: [{ Key: "P1", ClientKey: "C1", Status: "current", First: "Jane", Last: "Doe" }], ledger: led, classes: [{ ClientKey: "C1", Name: "Ordinary", NominalValue: 1, Status: "current" }], txs: [], fees: DEFAULT_FEES, today: "2026-10-28" };

test("a complete, consistent company is ready, with capital, shareholders, due dates and a fee", () => {
  const m = buildCs01(ready);
  assert.deepEqual(m.blockers, []);
  assert.equal(m.capital.total, 100); assert.equal(m.capital.totalNominal, 100); assert.equal(m.shareholders[0].name, "Jane Doe");
  assert.equal(m.dueBy, "2026-10-15"); assert.equal(m.nextDue, "2027-10-15");
  assert.equal(m.fee?.amount, 50); assert.match(m.fee!.source, /Confirm on GOV.UK/);
  assert.equal(m.steps.find((s) => s.id === "pscs")!.state, "ok");
});
test("made-up date rules", () => {
  assert.match(buildCs01({ ...ready, payload: { ...ready.payload, madeUpTo: "2026-12-01" } }).blockers.join(), /future/);
  assert.match(buildCs01({ ...ready, payload: { ...ready.payload, madeUpTo: "2025-10-01" } }).blockers.join(), /already made up/);
  assert.match(buildCs01({ ...ready, payload: { ...ready.payload, madeUpTo: "" } }).blockers.join(), /Enter the date/);
  assert.match(buildCs01({ ...ready, today: "2027-01-01", payload: { ...ready.payload, madeUpTo: "2026-12-15" } }).warnings.join(), /overdue/);
});
test("identity verification: an unverified director blocks; a PSC who isn't a director only warns", () => {
  const m = buildCs01({ ...ready, officers: [dir({ IdStatus: "" })] });
  assert.match(m.blockers.join(), /Jane Doe: identity verification is not recorded/);
  assert.match(buildCs01({ ...ready, officers: [dir({ IdStatus: "pending" })] }).blockers.join(), /not yet done/);
  assert.deepEqual(buildCs01({ ...ready, officers: [dir({ IdStatus: "exempt" })] }).blockers, []);
  const w = buildCs01({ ...ready, pscs: [{ Key: "P2", ClientKey: "C1", Status: "current", First: "Sam", Last: "Other" }] });
  assert.deepEqual(w.blockers, []); assert.match(w.warnings.join(), /Sam Other/);
  assert.equal(idOf({ IdStatus: "weird" }), "");
});
test("differences from Companies House, an empty ledger, and open filings all block", () => {
  assert.match(buildCs01({ ...ready, client: { ...client, RegisteredOffice: "5 New Road, Leeds, LS1 1AA" } }).blockers.join(), /AD01/);
  assert.match(buildCs01({ ...ready, ledger: [] }).blockers.join(), /ledger is empty/);
  const open = { Key: "T1", ClientKey: "C1", Form: "AP01", Ref: "CS-2026-0007", Title: "Appoint Bo", Status: "draft" };
  const m = buildCs01({ ...ready, txs: [open, { ...open, Key: "T2", Status: "accepted" }, { ...open, Key: "T3", Form: "CS01" }] });
  assert.equal(m.linked.length, 1); assert.match(m.blockers.join(), /CS-2026-0007 \(AP01\) is still open/);
  assert.equal(buildCs01({ ...ready, txs: [open], selfTx: "T1" }).linked.length, 0);
});
test("declarations and email are required; an unbalanced ledger blocks", () => {
  const m = buildCs01({ ...ready, payload: blankCs01("2026-10-01") });
  assert.ok(m.blockers.filter((b) => b.startsWith("Confirm:")).length === 3); assert.match(m.blockers.join(), /registered email/); assert.match(m.blockers.join(), /who is making/);
  const bad = [readEntry({ Key: "L2", ClientKey: "C1", Type: "transfer", EffectiveDate: "2021-01-01", Class: "Ordinary", Number: 500, FromHolder: "Jane Doe", ToHolder: "X", Status: "active", Created: "b" }), ...led];
  assert.match(buildCs01({ ...ready, ledger: bad }).blockers.join(), /doesn't add up/);
});
test("shares are taken as at the made-up date", () => {
  const later = [...led, readEntry({ Key: "L3", ClientKey: "C1", Type: "allotment", EffectiveDate: "2026-10-15", Class: "Ordinary", Number: 50, ToHolder: "Bob", Nominal: 1, Status: "active", Created: "c" })];
  assert.equal(buildCs01({ ...ready, ledger: later }).capital.total, 100);
  assert.equal(buildCs01({ ...ready, ledger: later, today: "2026-10-28", payload: { ...ready.payload, madeUpTo: "2026-10-20" } }).capital.total, 150);
});
test("an LLP has members and no share capital", () => {
  const m = buildCs01({ ...ready, client: { ...client, Kind: "LLP" }, officers: [dir({ Role: "member" })], ledger: [] });
  assert.deepEqual(m.blockers, []); assert.equal(m.steps.some((s) => s.id === "capital"), false);
});
test("draft issues and payload reading; fee schedule is editable and tolerant", () => {
  assert.deepEqual(cs01Issues({ Payload: JSON.stringify(ready.payload) } as any), []);
  assert.equal(cs01Issues({ Payload: "{}" } as any).length, 4);
  assert.equal(readCs01({ Payload: "not json" } as any).declarations.lawfulPurpose, false);
  const f = readFees({ CS01: { amount: 55, effective: "2027-04-01", source: "GOV.UK" }, AD01: { amount: "x" }, SH01: { amount: 0 } });
  assert.equal(feeFor(f, "CS01")!.amount, 55); assert.equal(feeFor(f, "AD01"), undefined); assert.equal(feeFor(f, "SH01")!.amount, 0);
  assert.equal(feeFor(readFees(undefined), "CS01")!.amount, 50); assert.equal(money(50), "£50"); assert.equal(money(12.5), "£12.50");
});

import { act, prepareCs01, txStatus } from "../src/lib/cosec.ts";
import { decide, approvalOf } from "../src/lib/cosecApproval.ts";
let n = 0, clock = 0;
const ctx = () => ({ actor: "Kevin", now: new Date(Date.UTC(2026, 9, 28, 9, 0, clock++)).toISOString(), pid: "default", newKey: (p: string) => `${p}${++n}` });
const cfg: any = { staff: [], overriders: [], independentReview: false, auto: true };
const names: Record<string, string> = { CoSecTransactions: "txs", CoSecEvents: "events", CoSecLedger: "ledger" };
const apply = (s: any, w: any) => { for (const c of w.creates || []) s[names[c.list]]?.push({ ...c.row }); for (const p of w.patches || []) { const r = s[names[p.list] || (p.list === "Clients" ? "clients" : "")]?.find((x: any) => x.Key === p.row.Key); if (r) Object.assign(r, p.patch); } if (w.verified) { const c = s.clients.find((x: any) => x.Key === w.verified.clientKey); if (c) c.CHVerified = JSON.stringify(w.verified.value); } return w; };

test("a CS01 draft goes through approval, is blocked until ready, and filing it elsewhere moves the due dates", () => {
  const s: any = { clients: [{ ...client }], officers: [dir({ IdStatus: "" })], pscs: [], shares: [], classes: ready.classes, ledger: [{ Key: "L1", ClientKey: "C1", Type: "opening", EffectiveDate: "2020-01-01", Class: "Ordinary", Number: 100, ToHolder: "Jane Doe", Nominal: 1, Status: "active", Created: "a" }], txs: [], events: [] };
  const r: any = prepareCs01(s.clients[0], "2026-10-01", s, true, ctx()); assert.equal(r.error, undefined); apply(s, r);
  const tx = () => s.txs[0];
  assert.equal(tx().Form, "CS01"); assert.equal(approvalOf(tx()), "undecided");
  assert.match((prepareCs01(s.clients[0], "bad", s, true, ctx()) as any).error, /Enter the date/);
  const full = { madeUpTo: "2026-10-01", email: "acme@example.com", sail: "", declarations: { infoReviewed: true, lawfulPurpose: true, emailConfirmed: true }, declaredBy: "Jane Doe" };
  assert.match((act(tx(), "approve", {}, cfg, ctx(), s) as any).error, /Decide whether/);
  apply(s, decide(tx(), false, "", true, ctx()) as any);
  assert.match((act(tx(), "approve", {}, cfg, ctx(), s) as any).error, /Still needed.*declarations/i);
  apply(s, act(tx(), "edit", { payload: full }, cfg, ctx(), s) as any);
  assert.match((act(tx(), "approve", {}, cfg, ctx(), s) as any).error, /Not ready to approve: Jane Doe: identity verification/);
  s.officers[0].IdStatus = "verified";
  const ok: any = act(tx(), "approve", {}, cfg, ctx(), s); assert.equal(ok.error, undefined, ok.error); apply(s, ok);
  assert.match((act(tx(), "submitted", { gatewayRef: "x" }, cfg, ctx(), s) as any).error, /can't be sent/);
  const ext: any = act(tx(), "external", { ref: "CH-REF-1", note: "Filed in Companies House WebFiling" }, cfg, ctx(), s); assert.equal(ext.error, undefined, ext.error); apply(s, ext);
  assert.equal(txStatus(tx()), "external");
  const v = JSON.parse(s.clients[0].CHVerified); assert.equal(v.csTo, "2026-10-01"); assert.equal(v.csDue, "2027-10-15");
  assert.match((prepareCs01(s.clients[0], "2026-10-01", s, true, ctx()) as any).error, /already been filed/);
});
test("editing an approved CS01 draft puts the client approval back to required", () => {
  const s: any = { clients: [{ ...client }], officers: [dir()], pscs: [], shares: [], classes: ready.classes, ledger: [], txs: [], events: [] };
  apply(s, prepareCs01(s.clients[0], "2026-10-01", s, true, ctx()) as any);
  const tx = () => s.txs[0];
  apply(s, decide(tx(), true, "", true, ctx()) as any);
  Object.assign(tx(), { ApprovalState: "approved" });
  apply(s, act(tx(), "edit", { payload: { ...JSON.parse(tx().Payload), email: "new@example.com" } }, cfg, ctx(), s) as any);
  assert.equal(approvalOf(tx()), "required");
});
