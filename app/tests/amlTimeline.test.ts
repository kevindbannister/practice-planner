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
