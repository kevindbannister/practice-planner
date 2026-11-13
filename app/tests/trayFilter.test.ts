import test from "node:test";
import assert from "node:assert/strict";
import { horizonEnd, inHorizon } from "../src/lib/trayFilter.ts";

const today = "2026-11-13";
const h = (o: any = {}) => ({ horizon: "90", days: "45", until: "", withRecords: false, ...o });
const job = (deadline: string, recordsIn = false): any => ({ kind: "job", deadline, recordsIn });

test("the presets, a number of days and a date set the limit", () => {
  assert.equal(horizonEnd(h({ horizon: "30" }), today), "2026-12-13");
  assert.equal(horizonEnd(h(), today), "2027-02-11");
  assert.equal(horizonEnd(h({ horizon: "days", days: "10" }), today), "2026-11-23");
  assert.equal(horizonEnd(h({ horizon: "date", until: "2026-12-31" }), today), "2026-12-31");
  assert.equal(horizonEnd(h({ horizon: "all" }), today), "");
});

test("a bad number of days or date means no limit rather than hiding everything", () => {
  for (const days of ["", "abc", "-3", "2.5", "99999"]) assert.equal(horizonEnd(h({ horizon: "days", days }), today), "", days);
  assert.equal(horizonEnd(h({ horizon: "date", until: "soon" }), today), "");
});

test("work due after the limit is hidden, unless it has records and the option is on", () => {
  const lim = h({ horizon: "30" });
  assert.equal(inHorizon(job("2026-12-01"), lim, today), true);
  assert.equal(inHorizon(job("2027-03-01"), lim, today), false);
  assert.equal(inHorizon(job("2027-03-01", true), lim, today), false, "option off");
  assert.equal(inHorizon(job("2027-03-01", true), h({ horizon: "30", withRecords: true }), today), true);
  assert.equal(inHorizon(job("2027-03-01", false), h({ horizon: "30", withRecords: true }), today), false, "no records");
  assert.equal(inHorizon({ kind: "task", deadline: "2027-03-01", recordsIn: true }, h({ horizon: "30", withRecords: true }), today), false, "tasks have no records");
  assert.equal(inHorizon(job(""), lim, today), true, "no deadline always shows");
});
