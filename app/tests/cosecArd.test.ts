import test from "node:test";
import assert from "node:assert/strict";
import { ardAdvice, ardDeadline, ardForm, ardIssues, ardPayloadIssues, ardPrefill, dayMonth, direction, latestExtension, ArdInput } from "../src/lib/cosecArd.ts";
import { act, detectClientChange, prepareArdChange, txIssues, txStatus, Snapshot } from "../src/lib/cosec.ts";
import { formDef } from "../src/lib/cosecForms.ts";

let n = 0;
let clock = 0;
const ctx = () => ({ actor: "Kevin", now: new Date(Date.UTC(2026, 10, 13, 9, 0, clock++)).toISOString(), pid: "default", newKey: (p: string) => `${p}${++n}` });
const cfg: any = { staff: [], overriders: [], independentReview: false, auto: true };
const ltd: any = { _id: "1", Key: "C1", Title: "Acme Ltd", Kind: "Ltd", CompanyNumber: "01234567", YearEnd: "31 March", Incorporated: "2020-04-01", Manager: "Max", CHVerified: JSON.stringify({ at: "2026-11-01T00:00:00Z", ard: "31 March", accTo: "2027-03-31", accDue: "2027-12-31" }) };
const llp: any = { _id: "2", Key: "C2", Title: "Acme LLP", Kind: "LLP", CompanyNumber: "OC123456", YearEnd: "31 March", Incorporated: "2020-04-01", CHVerified: JSON.stringify({ at: "2026-11-01T00:00:00Z", ard: "31 March", accTo: "2027-03-31" }) };
const person: any = { _id: "3", Key: "C3", Title: "Ann", Kind: "Individual" };

const snapOf = (clients: any[]): Snapshot => ({ clients, officers: [], pscs: [], shares: [], txs: [], events: [] });
/** Apply what the engine wrote to an in-memory snapshot, as the app would save it. */
function save(s: Snapshot, w: any) {
  let id = 100 + s.txs.length;
  for (const c of w.creates || []) { if (c.list === "CoSecTransactions") s.txs.push({ _id: String(++id), ...c.row, ApprovalState: "not-required" }); if (c.list === "CoSecEvents") s.events.push(c.row); }
  for (const p of w.patches || []) { const r = s.txs.find((x: any) => x.Key === p.row.Key); if (r) Object.assign(r, p.patch); }
  if (w.verified) { const c = s.clients.find((x: any) => x.Key === w.verified.clientKey); if (c) c.CHVerified = JSON.stringify(w.verified.value); }
  if (w.clientPatch) { const c = s.clients.find((x: any) => x.Key === w.clientPatch.clientKey); if (c) Object.assign(c, w.clientPatch.patch); }
  return w;
}

const base: ArdInput = { which: "current", periodStart: "2026-04-01", periodEnd: "2027-03-31", newEnd: "2026-12-31" };

test("each kind of company has its own form, and AA01 is no longer offered for LLPs", () => {
  assert.equal(ardForm("limited"), "AA01");
  assert.equal(ardForm("llp"), "LLAA01");
  assert.deepEqual(formDef("AA01")?.applies, ["limited"]);
  assert.deepEqual(formDef("LLAA01")?.applies, ["llp"]);
});

test("dates: the accounting reference date as day and month, direction and the 18 month limit", () => {
  assert.equal(dayMonth("2027-06-30"), "30 June");
  assert.equal(dayMonth("2027-06-31"), "", "not a real date");
  assert.equal(direction(base), "shorten");
  assert.equal(direction({ periodEnd: "2027-03-31", newEnd: "2027-06-30" }), "extend");
  assert.equal(latestExtension("2026-01-01"), "2027-06-30");
  assert.equal(latestExtension("2026-04-01"), "2027-09-30");
});

test("a shortening with real dates has nothing outstanding, and needs no five-year answer", () => {
  assert.deepEqual(ardIssues(base), []);
});

test("an extension must be inside 18 months, and the five-year question has to be answered", () => {
  const ext = { ...base, newEnd: "2027-06-30" };
  assert.ok(ardIssues(ext).some((x) => /last five years/.test(x)), "asked, never guessed");
  assert.deepEqual(ardIssues({ ...ext, extendedWithinFiveYears: false }), []);
  const tooLong = { ...base, newEnd: "2027-12-31", extendedWithinFiveYears: false };
  assert.ok(ardIssues(tooLong).some((x) => /18 months/.test(x) && x.includes("30/09/2027")), "names the latest date");
  assert.deepEqual(ardIssues({ ...tooLong, extensionReason: "administration" }), [], "administration is the exception to 18 months");
});

test("a second extension within five years needs one of the listed exceptions", () => {
  const second = { ...base, newEnd: "2027-06-30", extendedWithinFiveYears: true };
  assert.ok(ardIssues(second).some((x) => /second extension/.test(x)));
  assert.ok(ardIssues({ ...second, extensionReason: "nonsense" }).some((x) => /second extension/.test(x)));
  assert.deepEqual(ardIssues({ ...second, extensionReason: "align" }), []);
});

test("missing or impossible dates are listed, not guessed", () => {
  assert.ok(ardIssues({}).length >= 3);
  assert.ok(ardIssues({ ...base, newEnd: "2027-03-31" }).some((x) => /same as the current/.test(x)));
  assert.ok(ardIssues({ ...base, newEnd: "2026-03-31" }).some((x) => /after the period's start/.test(x)));
  assert.ok(ardIssues({ ...base, periodStart: "2027-04-01" }).some((x) => /start after it ends/.test(x)));
  assert.ok(ardIssues({ ...base, which: undefined as any }).some((x) => /Which period/.test(x)));
});

test("the deadline: an extension is nine months from the new end; a shortening is the later of that and three months from filing", () => {
  assert.equal(ardDeadline({ periodEnd: "2027-03-31", newEnd: "2027-06-30" }, "2026-11-13"), "2028-03-31");
  assert.equal(ardDeadline({ periodEnd: "2027-03-31", newEnd: "2026-12-31" }, "2026-11-13"), "2027-09-30", "nine months from the new end is later");
  assert.equal(ardDeadline({ periodEnd: "2027-03-31", newEnd: "2026-11-14" }, "2026-11-13"), "2027-08-14", "nine months from the new end is still later here");
  assert.equal(ardDeadline({ periodEnd: "2026-03-31", newEnd: "2025-12-31" }, "2026-11-13"), "2027-02-13", "three months from filing is later when the old period has long gone");
});

test("advice reads the deadline and warns about a previous period whose deadline has passed", () => {
  const a = ardAdvice(base, "2026-11-13");
  assert.ok(a.some((x) => /later of nine months/.test(x)));
  assert.ok(a.some((x) => /corporation tax/.test(x)));
  const prev = ardAdvice({ ...base, which: "previous", periodStart: "2024-04-01", periodEnd: "2025-03-31", newEnd: "2024-12-31" }, "2026-11-13");
  assert.ok(prev.some((x) => /has passed/.test(x)));
  assert.deepEqual(ardAdvice({}, "2026-11-13") as any, [], "nothing to say until the dates are valid");
});

test("the period dates are worked out from what Companies House shows, and never start before incorporation", () => {
  assert.deepEqual(ardPrefill("2027-03-31", "2020-04-01"), { periodStart: "2026-04-01", periodEnd: "2027-03-31" });
  assert.deepEqual(ardPrefill("2021-03-31", "2020-09-15"), { periodStart: "2020-09-15", periodEnd: "2021-03-31" });
  assert.deepEqual(ardPrefill("", "2020-04-01"), { periodStart: "", periodEnd: "" });
});

test("nothing prepares an AA01 on its own: only a person asking does", () => {
  const s = snapOf([{ ...ltd }, { ...llp }]);
  assert.equal(s.txs.length, 0);
});

test("a person asks for a change of year end: a company gets an AA01, with the dates kept", () => {
  const s = snapOf([{ ...ltd }]);
  const r: any = prepareArdChange(s.clients[0], base, s, true, ctx());
  assert.equal(r.error, undefined);
  save(s, r);
  assert.equal(s.txs.length, 1);
  const t = s.txs[0];
  assert.equal(t.Form, "AA01");
  assert.equal(t.Source, "cosec");
  assert.equal(t.Status, "draft");
  assert.equal(t.Before, "31 March");
  assert.equal(t.After, "31 December");
  assert.equal(t.Target, "client:AccountingReferenceDate");
  const p = JSON.parse(t.Payload);
  assert.equal(p.newPeriodEnd, "2026-12-31");
  assert.equal(p.direction, "shorten");
  assert.equal(p.periodStart, "2026-04-01");
  assert.deepEqual(txIssues(t), []);
  assert.match(JSON.parse(t.History)[0].note, /Not yet submitted to Companies House/);
});

test("an LLP gets an LL AA01, not an AA01", () => {
  const s = snapOf([{ ...llp }]);
  const r: any = prepareArdChange(s.clients[0], base, s, true, ctx());
  save(s, r);
  assert.equal(s.txs[0].Form, "LLAA01");
});

test("preparing is refused without permission, for an individual, with no company number, with bad dates, or against the rules", () => {
  const s = snapOf([{ ...ltd }, { ...person }, { ...ltd, Key: "C9", CompanyNumber: "" }]);
  assert.match((prepareArdChange(s.clients[0], base, s, false, ctx()) as any).error, /can't prepare/);
  assert.match((prepareArdChange(s.clients[1], base, s, true, ctx()) as any).error, /Only companies and LLPs/);
  assert.match((prepareArdChange(s.clients[2], base, s, true, ctx()) as any).error, /no company number/);
  assert.match((prepareArdChange(s.clients[0], { ...base, newEnd: "" }, s, true, ctx()) as any).error, /Enter the date/);
  assert.match((prepareArdChange(s.clients[0], { ...base, newEnd: "2027-12-31" }, s, true, ctx()) as any).error, /18 months/);
  assert.equal(s.txs.length, 0, "nothing was written");
});

test("asking again updates the one open draft, and an approval no longer stands", () => {
  const s = snapOf([{ ...ltd }]);
  save(s, prepareArdChange(s.clients[0], base, s, true, ctx()));
  const key = s.txs[0].Key;
  s.txs[0].ApprovalState = "approved"; s.txs[0].ApprovedBy = "Pat";
  const again: any = prepareArdChange(s.clients[0], { ...base, newEnd: "2026-09-30" }, s, true, ctx());
  assert.equal(again.outcome, "updated");
  save(s, again);
  assert.equal(s.txs.length, 1, "one draft only");
  assert.equal(s.txs[0].Key, key);
  assert.equal(s.txs[0].After, "30 September");
  assert.equal(s.txs[0].ApprovedBy, "");
  assert.equal(s.txs[0].ApprovalState, "required", "the client has to approve the new date");
  assert.equal(JSON.parse(s.txs[0].Payload).newPeriodEnd, "2026-09-30");
});

test("a change already with Companies House blocks a second one", () => {
  const s = snapOf([{ ...ltd }]);
  save(s, prepareArdChange(s.clients[0], base, s, true, ctx()));
  s.txs[0].Status = "submitted";
  assert.match((prepareArdChange(s.clients[0], { ...base, newEnd: "2026-09-30" }, s, true, ctx()) as any).error, /already with Companies House/);
});

test("approval is held back by the rules, not just by missing fields", () => {
  const s = snapOf([{ ...ltd }]);
  save(s, prepareArdChange(s.clients[0], { ...base, newEnd: "2027-06-30", extendedWithinFiveYears: false }, s, true, ctx()));
  const t = s.txs[0];
  assert.deepEqual(txIssues(t), []);
  // someone edits the saved draft so it breaks the 18 month rule
  const bad = { ...t, Payload: JSON.stringify({ ...JSON.parse(t.Payload), newPeriodEnd: "2028-03-31" }) };
  assert.ok(txIssues(bad).some((x) => /18 months/.test(x)));
  // and a draft made by editing the client's year end only needs its date, as it always did
  assert.deepEqual(ardPayloadIssues({ newDate: "30 June" }), []);
  assert.deepEqual(ardPayloadIssues({}), ["The new accounting reference date"]);
});

test("editing the client's year end still drafts the right form for the kind of company", () => {
  const s = snapOf([{ ...ltd }, { ...llp }]);
  for (const key of ["C1", "C2"]) {
    const client = s.clients.find((c: any) => c.Key === key)!;
    const w = detectClientChange({ client: { ...client }, patch: { YearEnd: "30 June" }, source: "client", changeId: `${key}:ye` }, s, ctx());
    save(s, w);
  }
  assert.deepEqual(s.txs.map((t) => t.Form).sort(), ["AA01", "LLAA01"]);
  assert.deepEqual(txIssues(s.txs[0]), [], "its payload has only the new date, which is enough");
});

test("when it is filed and recorded, Companies House's record and the planner's year end both follow", () => {
  const s = snapOf([{ ...llp }]);
  save(s, prepareArdChange(s.clients[0], { ...base, newEnd: "2026-12-31" }, s, true, ctx()));
  const w: any = act(s.txs[0], "external", { note: "Filed on WebFiling" }, cfg, ctx(), { clients: s.clients, officers: [], pscs: [], shares: [], ledger: [] });
  assert.equal(w.error, undefined);
  assert.equal(w.verified.value.ard, "31 December");
  assert.deepEqual(w.clientPatch, { clientKey: "C2", patch: { YearEnd: "31 December" } });
  assert.ok(w.activities.some((a: any) => /accounts and tax dates/.test(a.Title) || /accounts and tax dates/.test(JSON.stringify(a))), "a note to check the accounts and tax dates");
  save(s, w);
  assert.equal(txStatus(s.txs[0]), "external");
  assert.equal(s.clients[0].YearEnd, "31 December");
});

test("no client patch when the planner's year end already matches", () => {
  const s = snapOf([{ ...ltd, YearEnd: "31 December" }]);
  save(s, prepareArdChange(s.clients[0], base, s, true, ctx()));
  const w: any = act(s.txs[0], "external", {}, cfg, ctx(), { clients: s.clients, officers: [], pscs: [], shares: [], ledger: [] });
  assert.equal(w.clientPatch, undefined);
});
