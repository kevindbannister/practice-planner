import test from "node:test";
import assert from "node:assert/strict";
import { detectClientChange, prepareArdChange, scanDifferences, Snapshot } from "../src/lib/cosec.ts";
import { regenerate, resettable, resetPlan } from "../src/lib/cosecReset.ts";

let n = 0;
let clock = 0;
const ctx = () => ({ actor: "Kevin", now: new Date(Date.UTC(2026, 10, 13, 9, 0, clock++)).toISOString(), pid: "default", newKey: (p: string) => `${p}${++n}` });
const ch = (o: any) => JSON.stringify({ at: "2026-11-01T00:00:00Z", office: "10 High Street, London, E1 5NF", name: "Acme Ltd", ard: "31 March", ...o });
const mk = (over: any = {}): any => ({ _id: "1", Key: "C1", Title: "Acme Ltd", Kind: "Ltd", CompanyNumber: "01234567", RegisteredOffice: "10 High Street, London, E1 5NF", YearEnd: "31 March", Incorporated: "2020-04-01", CHVerified: ch({}), ...over });

function save(s: Snapshot, w: any) {
  let id = 500 + s.txs.length + s.events.length;
  for (const c of w.creates || []) { if (c.list === "CoSecTransactions") s.txs.push({ _id: String(++id), ...c.row, ApprovalState: "not-required" }); if (c.list === "CoSecEvents") s.events.push({ _id: String(++id), ...c.row }); }
  for (const p of w.patches || []) { const r = s.txs.find((x: any) => x.Key === p.row.Key); if (r) Object.assign(r, p.patch); }
  return w;
}
const world = (clients: any[]): Snapshot => ({ clients, officers: [], pscs: [], shares: [], txs: [], events: [] });
/** The client record is edited in the app: detect against how it was, then change it. */
function edit(s: Snapshot, key: string, patch: any) {
  const c = s.clients.find((x: any) => x.Key === key)!;
  const w = detectClientChange({ client: { ...c }, patch, source: "client", changeId: `${key}:${++n}` }, s, ctx());
  Object.assign(c, patch); save(s, w); return w;
}

test("only never-sent drafts that the planner prepared itself can be reset", () => {
  assert.equal(resettable({ Status: "draft", Source: "client" } as any), true);
  assert.equal(resettable({ Status: "approved", Source: "portal" } as any), true);
  assert.equal(resettable({ Status: "declined", Source: "client" } as any), true);
  assert.equal(resettable({ Status: "cancelled", Source: "client" } as any), true);
  assert.equal(resettable({ Status: "draft", Source: "cosec" } as any), false, "started by hand");
  for (const st of ["submitted", "accepted", "external", "completed", "rejected"]) assert.equal(resettable({ Status: st, Source: "client" } as any), false, st);
});

test("the reset removes stale drafts and the records behind them, and prepares them again from Companies House", () => {
  const s = world([mk()]);
  // a stale draft from a past edit that Companies House never agreed with
  edit(s, "C1", { RegisteredOffice: "25 Market Road, London, N1 9GU" });
  edit(s, "C1", { Title: "Acme Holdings Ltd" });
  assert.equal(s.txs.length, 2);
  assert.ok(s.events.length >= 2);
  const before = resetPlan(s);
  assert.equal(before.txs.length, 2);
  assert.ok(before.events.length >= 2);
  // the planner's record was later corrected to match Companies House, so adding it fresh would need no filing
  Object.assign(s.clients[0], { RegisteredOffice: "10 High Street, London, E1 5NF", Title: "Acme Ltd" });
  const r = regenerate(s, { C1: JSON.parse(ch({})) }, ctx());
  assert.equal(r.plan.txs.length, 2);
  assert.equal(r.write.found, 0, "Companies House and the planner agree: nothing to file");
  assert.deepEqual((r.write.creates || []).filter((c) => c.list === "CoSecTransactions"), []);
});

test("it prepares the filing a fresh add would give when Companies House and the planner differ", () => {
  const s = world([mk()]);
  edit(s, "C1", { RegisteredOffice: "25 Market Road, London, N1 9GU" });
  const oldKey = s.txs[0].Key;
  const r = regenerate(s, { C1: JSON.parse(ch({})) }, ctx());
  assert.equal(r.plan.txs.length, 1, "the old draft goes");
  assert.equal(r.write.found, 1, "and one is prepared again, which is only possible because its event was removed too");
  const made = (r.write.creates || []).filter((c) => c.list === "CoSecTransactions");
  assert.equal(made.length, 1);
  assert.equal(made[0].row.Form, "AD01");
  assert.notEqual(made[0].row.Key, oldKey);
  assert.equal(made[0].row.Status, "draft");
});

test("without removing the old events, the same difference would not be prepared again", () => {
  const s = world([mk()]);
  edit(s, "C1", { RegisteredOffice: "25 Market Road, London, N1 9GU" });
  // a plain scan on the untouched snapshot sees the open draft and does nothing new: this is why the reset has to clear the records
  assert.equal(scanDifferences(s, ctx()).found, 0);
});

test("a declined draft is cleared too, so the difference can come back", () => {
  const s = world([mk()]);
  edit(s, "C1", { RegisteredOffice: "25 Market Road, London, N1 9GU" });
  s.txs[0].Status = "declined";
  assert.equal(scanDifferences(s, ctx()).found, 0, "left alone, a declined draft is not prepared again");
  const r = regenerate(s, { C1: JSON.parse(ch({})) }, ctx());
  assert.equal(r.write.found, 1);
});

test("filings that were sent or started by hand are kept, and stop duplicates", () => {
  const s = world([mk()]);
  // a name change that was filed and accepted
  edit(s, "C1", { Title: "Acme Holdings Ltd" });
  assert.equal(s.txs.length, 1);
  s.txs[0].Status = "accepted";
  // a change of accounting reference date a person started
  const hand: any = prepareArdChange(s.clients[0], { which: "current", periodStart: "2026-04-01", periodEnd: "2027-03-31", newEnd: "2026-12-31" }, { ...s, txs: [] }, true, ctx());
  save(s, hand);
  const handKey = s.txs.find((t: any) => t.Source === "cosec")!.Key;
  const plan = resetPlan(s);
  assert.equal(plan.txs.length, 0, "nothing qualifies for removal");
  const r = regenerate(s, { C1: JSON.parse(ch({ name: "Acme Holdings Ltd" })) }, ctx());
  assert.equal(r.plan.txs.length, 0);
  assert.equal(r.write.found, 0);
  assert.ok(s.txs.some((t: any) => t.Key === handKey), "the hand-started filing is still there");
});

test("a company Companies House could not be read for is compared with its last record", () => {
  const s = world([mk(), mk({ _id: "2", Key: "C2", Title: "Other Ltd", CompanyNumber: "07654321", RegisteredOffice: "1 New Street, Leeds, LS1 4AB", CHVerified: ch({ office: "2 Old Street, Leeds, LS1 4AB", name: "Other Ltd" }) })]);
  const r = regenerate(s, { C1: JSON.parse(ch({})) }, ctx()); // no fresh record for C2
  assert.equal(r.write.found, 1, "C2's last-recorded difference is still prepared");
  const made = (r.write.creates || []).find((c) => c.list === "CoSecTransactions")!;
  assert.equal(made.row.ClientKey, "C2");
});

test("the reset changes nothing by itself: it only describes what to remove and prepare", () => {
  const s = world([mk()]);
  edit(s, "C1", { RegisteredOffice: "25 Market Road, London, N1 9GU" });
  const txs = JSON.stringify(s.txs), events = JSON.stringify(s.events), client = JSON.stringify(s.clients);
  regenerate(s, { C1: JSON.parse(ch({})) }, ctx());
  assert.equal(JSON.stringify(s.txs), txs);
  assert.equal(JSON.stringify(s.events), events);
  assert.equal(JSON.stringify(s.clients), client, "the snapshot passed in is not altered");
});
