import test from "node:test";
import assert from "node:assert/strict";
import { addMonths, normName, patchFor, readAll, readClient, summarise } from "../src/lib/xamaSync.ts";
import { FakeXama } from "../src/lib/fakeXama.ts";
import { amlLabel } from "../src/lib/domain.ts";
import { DEFAULT_XAMA_CONFIG } from "../src/lib/xama.ts";

const CFG = { ...DEFAULT_XAMA_CONFIG, firmId: "firm-1" };
const TODAY = "2026-10-26";
const client = (o: Record<string, unknown>) => ({ Key: "c1", Title: "Acme Limited", ...o }) as any;

test("the latest approved assessment wins, with its risk level and date", () => {
  const s = summarise([
    { status: "COMPLETED", risk_level: "NORMAL", completed_at: "2025-12-01" },
    { status: "COMPLETED", risk_level: "LOW", completed_at: "2026-06-12" },
    { status: "IN_PROGRESS" },
  ], TODAY, 12);
  assert.deepEqual(s, { status: "Approved: low risk", review: "2026-06-12" });
});

test("an old approved assessment shows as review due, unless staleness is off", () => {
  const items = [{ status: "COMPLETED", risk_level: "HIGH", completed_at: "2025-10-26" }];
  assert.equal(summarise(items, TODAY, 12).status, "Review due: high risk");
  assert.equal(summarise(items, "2026-10-25", 12).status, "Approved: high risk");
  assert.equal(summarise(items, TODAY, 0).status, "Approved: high risk");
});

test("unfinished and missing assessments", () => {
  assert.equal(summarise([{ status: "IN_REVIEW" }, { status: "IN_PROGRESS" }], TODAY, 12).status, "In review");
  assert.equal(summarise([{ status: "IN_PROGRESS" }], TODAY, 12).status, "In progress");
  assert.deepEqual(summarise([], TODAY, 12), { status: "No assessment", review: "" });
  assert.equal(summarise([{ status: "COMPLETED", completed_at: "2026-01-01" }], TODAY, 12).status, "Approved: risk level not stated");
});

test("what the client page treats as a warning", () => {
  assert.equal(amlLabel("Approved: low risk").warn, false);
  for (const w of ["Review due: low risk", "In review", "In progress", "No assessment", "not linked", ""]) assert.equal(amlLabel(w).warn, true, w);
});

test("month arithmetic keeps to the end of short months", () => {
  assert.equal(addMonths("2025-10-26", 12), "2026-10-26");
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonths("2024-02-29", 12), "2025-02-28");
});

test("names match across Limited/Ltd, ampersands and punctuation", () => {
  assert.equal(normName("A & B Holdings Limited."), normName("A and B Holdings Ltd"));
  assert.notEqual(normName("Acme Ltd"), normName("Acme Holdings Ltd"));
});

test("a linked client is read without searching", async () => {
  const api = new FakeXama();
  const r = await readClient(api, CFG, client({ XamaId: "fake-x", XamaStatus: "not linked" }), TODAY);
  assert.deepEqual(api.calls.map((c) => c.split("/").pop()), ["risk-assessments"]);
  assert.equal(r.xamaId, "fake-x");
  assert.ok(r.summary);
});

test("an unlinked client is found by exact name and linked, with a patch to save", async () => {
  const api = new FakeXama();
  let found: any = null;
  for (let i = 0; i < 40 && !found; i++) {
    const r = await readClient(api, CFG, client({ Key: "k" + i, Title: `Client ${i} Limited`, XamaStatus: "not linked" }), TODAY);
    if (r.newlyLinked) found = r;
  }
  assert.ok(found, "some demo client matches exactly");
  const p = patchFor(found)!;
  assert.equal(p.XamaId, found.xamaId);
  assert.equal(p.XamaStatus, found.summary.status);
});

test("several or no matches are left for you to choose, and nothing is written", async () => {
  const api = new FakeXama();
  const rows = await readAll(api, CFG, Array.from({ length: 60 }, (_, i) => client({ Key: "k" + i, Title: `Firm ${i} Limited` })), TODAY);
  const open = rows.filter((r) => !r.xamaId);
  assert.ok(open.length > 0);
  for (const r of open) assert.equal(patchFor(r), null);
  assert.ok(open.some((r) => (r.candidates || []).length > 1), "some have candidates to choose from");
});

test("an unchanged client produces no patch; a failure is reported on its row", async () => {
  const api = new FakeXama();
  const first = await readClient(api, CFG, client({ XamaId: "fake-x" }), TODAY);
  const again = await readClient(api, CFG, client({ XamaId: "fake-x", XamaStatus: first.summary!.status, AMLReview: first.summary!.review }), TODAY);
  assert.equal(again.changed, false);
  assert.equal(patchFor(again), null);
  const bad = { status: async () => ({}) as any, test: async () => ({}) as any, get: async () => { throw new Error("Xama answered HTTP 500."); } };
  const r = await readClient(bad, CFG, client({ XamaId: "x" }), TODAY);
  assert.equal(r.error, "Xama answered HTTP 500.");
  assert.equal(patchFor(r), null);
});

test("ceased clients are skipped", async () => {
  const api = new FakeXama();
  const rows = await readAll(api, CFG, [client({ Key: "a", XamaId: "x1" }), client({ Key: "b", Status: "Ceased", XamaId: "x2" })], TODAY);
  assert.equal(rows.length, 1);
});
