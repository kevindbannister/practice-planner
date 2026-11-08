import test from "node:test";
import assert from "node:assert/strict";
import { timeline, idCheckedOn } from "../src/lib/amlTimeline";

const row = (status: string, checks: unknown[], extra: Record<string, unknown> = {}) => ({ Key: "A1", ClientKey: "C1", Status: status, Risk: "medium", Checks: JSON.stringify(checks), Owners: "[]", Evidence: "[]", ...extra });

test("timeline merges checks and reviews, newest first, with backdated dates", () => {
  const rows = [
    row("superseded", [{ id: "1", kind: "Identity verified", result: "pass", by: "Kev", at: "2023-03-01", note: "Imported" }], { DoneOn: "2023-03-02", ApprovedBy: "Kev" }),
    row("inprogress", [{ id: "2", kind: "Sanctions and PEP screening", result: "pass", by: "Kev", at: "2025-06-10T09:00:00Z", note: "" }]),
    { ...row("approved", []), ClientKey: "C2" },
  ] as never[];
  const t = timeline("C1", rows, []);
  assert.deepEqual(t.map((e) => e.date), ["2025-06-10", "2023-03-02", "2023-03-01"]);
  assert.equal(t[1].type, "review");
});

test("idCheckedOn returns the latest passed identity check only", () => {
  const rows = [row("inprogress", [
    { id: "1", kind: "Identity verified", result: "fail", by: "", at: "2025-01-01", note: "" },
    { id: "2", kind: "Identity verified", result: "pass", by: "", at: "2024-05-05", note: "" },
    { id: "3", kind: "Address verified", result: "pass", by: "", at: "2025-02-02", note: "" },
  ])] as never[];
  assert.equal(idCheckedOn("C1", rows, []), "2024-05-05");
  assert.equal(idCheckedOn("C9", rows, []), "");
});

import { idStamp, idStampRead } from "../src/lib/xamaActions";
test("Xama ID stamp: completed is done, keeps first-seen date, rejections need checking", () => {
  assert.equal(idStamp({ id: null, aml: null }, "2026-11-08"), "");
  assert.equal(idStamp({ id: { status: "INITIATED" }, aml: null }, "2026-11-08"), "waiting|2026-11-08");
  assert.equal(idStamp({ id: { status: "READY", document: "ACCEPT", face: "ACCEPT" }, aml: null }, "2026-11-08", "waiting|2026-11-01"), "done|2026-11-08");
  assert.equal(idStamp({ id: { status: "READY", document: "ACCEPT" }, aml: null }, "2026-11-20", "done|2026-11-08"), "done|2026-11-08");
  assert.equal(idStamp({ id: { status: "READY", document: "REJECT" }, aml: null }, "2026-11-08"), "check|2026-11-08");
  assert.deepEqual(idStampRead("done|2026-11-08"), { state: "done", on: "2026-11-08" });
  assert.deepEqual(idStampRead(undefined), { state: "", on: "" });
});

import { suggestRating, basisText, readFactors } from "../src/lib/amlFactors";
import { cosecOwnership, mergeOwners } from "../src/lib/amlCosec";
test("risk questions: a severe yes is high, one worry is medium, all clear is low only when all answered", () => {
  assert.equal(suggestRating({ pep: "yes" }).risk, "high");
  assert.equal(suggestRating({ cash: "yes" }).risk, "medium");
  assert.equal(suggestRating({ funds: "no" }).risk, "medium");
  assert.equal(suggestRating({ cash: "no" }).risk, "");
  const all = Object.fromEntries(["pep","geo","adverse","structure","cash","remote","unusual"].map((k) => [k, "no"]).concat([["funds","yes"],["sense","yes"]]));
  assert.equal(suggestRating(all as never).risk, "low");
  assert.match(basisText({ cash: "yes", funds: "no" }), /cash-intensive.*source of funds/);
  assert.deepEqual(readFactors("not json"), {});
});
test("company secretarial ownership: PSCs and over-25% holders become suggested owners, merged by name", () => {
  const d = { cosecLedger: [], cosecShareClasses: [], cosecOfficers: [{ ClientKey: "C1", Status: "current", Kind: "individual", First: "Ann", Last: "Lee", Role: "director", IdStatus: "verified", IdCheckedOn: "2025-12-01" }], cosecPscs: [{ ClientKey: "C1", Status: "current", Kind: "individual", First: "Ann", Last: "Lee", Natures: JSON.stringify(["ownership-of-shares-50-to-75"]) }] } as never;
  const r = cosecOwnership("C1", d, "2026-11-08");
  assert.equal(r.suggested.length, 1);
  assert.match(r.suggested[0].note, /significant control/);
  assert.ok(r.findings.some((f) => /No shareholdings/.test(f)));
  assert.equal(r.people[0].id, "verified");
  assert.equal(mergeOwners([{ name: "ann lee", percent: 60, note: "" }], r.suggested).length, 1);
});
