import test from "node:test";
import assert from "node:assert/strict";
import { timeline } from "../src/lib/amlTimelineView.ts";

const rec = (id: string, created: string, values: Record<string, unknown>, status: "Draft" | "Approved" = "Approved") => ({ id, created, status, values });
const name = (k: string) => (k === "c1" ? "Acme Ltd" : "");
const today = "2026-11-10";

test("the timeline brings every kind of record together, newest first, with what is due next", () => {
  const stores = {
    reviews: { records: [rec("r1", "2026-03-01", { client: "c1", on: "2026-03-01", newRating: "Low", next: "2027-03-01" }), rec("r2", "2025-03-01", { client: "c1", on: "2025-03-01", next: "2026-03-01" })] },
    screening: { records: [rec("s1", "2026-10-01", { client: "c1", who: "Jane Smith", on: "2026-10-02", result: "No match" }), rec("s2", "2026-09-01", { who: "Bob", on: "2026-09-01", result: "Possible match" })] },
    training: { records: [rec("t1", "2026-01-01", { people: [{ person: "Kevin", course: "AML basics", on: "2026-02-01", result: "Pass", next: "2026-11-30" }] })] },
    actions: { records: [rec("a1", "2026-01-01", { actions: [{ ref: "A1", action: "Approve policy", owner: "MLRO", due: "2026-10-01", status: "Open" }, { ref: "A2", action: "Training", due: "2026-12-01", status: "Open" }, { ref: "A3", action: "Done thing", due: "2026-05-01", status: "Done" }, { ref: "A4", action: "No date", status: "Open" }] })] },
    registrations: { records: [rec("g1", "2026-01-01", { items: [{ item: "ACCA supervision", on: "2026-01-15", next: "2027-01-15", status: "Registered" }] })] },
    mlro: { records: [rec("m1", "2026-06-01", { prepared: "2026-06-05", nextReport: "2027-06-01" })] },
    independent: { records: [rec("i1", "2026-07-01", { reviewer: "Pat", followUp: "2027-07-01" }, "Draft")] },
  };
  const t = timeline(stores as never, { name, today });
  const types = new Set(t.map((e) => e.type));
  assert.deepEqual([...types].sort(), ["action", "independent", "mlro", "registration", "review", "screening", "training"]);
  const dated = t.filter((e) => e.date);
  assert.deepEqual(dated.map((e) => e.date), [...dated.map((e) => e.date)].sort().reverse(), "newest first");
  assert.equal(t[t.length - 1].title, "A4: No date", "undated entries last");
  const byKey = (k: string) => t.find((e) => e.key === k)!;
  assert.equal(byKey("review-next:r1").upcoming, true);
  assert.equal(t.filter((e) => e.key.startsWith("review-next")).length, 1, "only the latest review per client has a next date");
  assert.equal(byKey("screening:s2").tone, "amber"); assert.equal(byKey("screening:s1").tone, "green");
  assert.equal(byKey("action:a1:0").tone, "red"); assert.match(byKey("action:a1:0").chip, /overdue/);
  assert.equal(byKey("action:a1:2").tone, "green");
  assert.equal(byKey("training-next:t1:0").tone, "amber"); assert.equal(byKey("training-next:t1:0").chip, "Due in 20 days");
  assert.equal(byKey("registration-next:g1:0").tone, "green");
  assert.equal(t.some((e) => e.key.startsWith("independent-next")), false, "a draft review has no next date yet");
  assert.equal(byKey("independent:i1").tone, "amber");
});

test("a training row with a course but no date shows undated, and a blank row shows nothing", () => {
  const t = timeline({ training: { records: [rec("t1", "2026-01-01", { people: [{ person: "Kevin" }, { person: "Ann", course: "AML basics" }, {}] })] } } as never, { name, today });
  assert.equal(t.length, 1); assert.equal(t[0].chip, "No date"); assert.equal(t[0].date, "");
});
