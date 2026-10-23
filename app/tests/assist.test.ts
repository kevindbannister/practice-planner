import test from "node:test";
import assert from "node:assert/strict";
import { buildContext, toPlan, withNames, addLog, LOG_LIMIT, freshUndo } from "../src/lib/assist";
import { DEFAULT_SETTINGS } from "../src/lib/planning";

const s: any = {
  today: "2026-10-23", settings: { ...DEFAULT_SETTINGS, overrides: {} },
  clients: [{ Key: "C1", Title: "Acme Ltd" }, { Key: "C2", Title: "Other Ltd" }],
  jobs: [{ Key: "J1", Title: "Accounts", ClientKey: "C1", Deadline: "2026-12-01", Status: "Open" }, { Key: "J2", Title: "VAT", ClientKey: "C2", Status: "On hold", HeldOn: "2026-10-01", HoldKind: "Client" }, { Key: "J3", Title: "Old", ClientKey: "C2", Status: "Complete", CompletedDate: "2026-10-22" }],
  tasks: [{ Key: "T1", Title: "Ring bank", Status: "Open" }],
  projects: [{ Key: "P1", Title: "Website" }],
};

test("context holds names only if allowed, and only for clients that appear", () => {
  const on: any = buildContext(s, { names: true });
  assert.ok(on.clients.every((c: any) => c.name));
  const off: any = buildContext(s, { names: false });
  assert.ok(off.clients.every((c: any) => c.name === undefined));
  assert.ok(!JSON.stringify(off).includes("Acme"));
  assert.equal(on.work.length, 3);
  assert.equal(on.recentlyFinished[0].key, "J3");
});
test("names are put back where the AI used keys", () => assert.equal(withNames("Chase C1 about it", s.clients), "Chase Acme Ltd about it"));

test("create task, with undo", () => {
  const p: any = toPlan({ type: "create_task", title: "Call Acme", client: "C1", planned: "2026-10-26", hours: 0.5 }, s, () => "TX");
  assert.equal(p.ops[0].row.ClientName, "Acme Ltd"); assert.equal(p.ops[0].row.EstimateHours, 0.5);
  assert.deepEqual(p.undo, [{ op: "remove", list: "Tasks", key: "TX" }]);
  assert.ok(toPlan({ type: "create_task", title: "x", client: "NOPE" }, s).hasOwnProperty("error"));
});
test("plan and undo restore the old date", () => {
  const p: any = toPlan({ type: "plan", item: "J1", date: "2026-10-27" }, s);
  assert.equal(p.ops[0].patch.PlannedDate, "2026-10-27"); assert.equal(p.undo[0].patch.PlannedDate, "");
});
test("waiting, resume, time, urgent, day type", () => {
  const w: any = toPlan({ type: "set_waiting", item: "J1", on: "HMRC", until: "2026-11-03" }, s);
  assert.equal(w.ops[0].patch.Status, "On hold"); assert.equal(w.ops[0].patch.HoldKind, "HMRC"); assert.equal(w.undo[0].patch.Status, "Open");
  assert.ok((toPlan({ type: "resume", item: "J1" }, s) as any).error);
  assert.equal((toPlan({ type: "resume", item: "J2" }, s) as any).ops[0].patch.Status, "Open");
  assert.equal((toPlan({ type: "log_time", item: "J3", hours: 2 }, s) as any).ops[0].patch.ActualHours, 2);
  assert.equal((toPlan({ type: "set_urgent", item: "J1", urgent: true }, s) as any).ops[0].patch.Priority, "urgent");
  assert.ok((toPlan({ type: "set_urgent", item: "T1", urgent: true }, s) as any).error);
  const d: any = toPlan({ type: "set_day_type", date: "2026-10-29", dayType: "business" }, s);
  assert.deepEqual(d.ops[0], { op: "dayType", date: "2026-10-29", type: "business" }); assert.equal(d.undo[0].type, undefined);
  assert.ok((toPlan({ type: "set_day_type", date: "2026-10-29", dayType: "zzz" }, s) as any).error);
  assert.ok((toPlan({ type: "plan", item: "NOPE", date: "2026-10-27" }, s) as any).error);
});
test("the log keeps the newest entries", () => {
  let log: any[] = [];
  for (let i = 0; i < LOG_LIMIT + 5; i++) log = addLog(log, { at: String(i), asked: "", reply: "", applied: [], names: true });
  assert.equal(log.length, LOG_LIMIT); assert.equal(log[0].at, String(LOG_LIMIT + 4));
});

test("undo is taken from the planner as it is when you press Apply", () => {
  const p: any = toPlan({ type: "plan", item: "J1", date: "2026-10-27" }, s);
  const later = { ...s, jobs: s.jobs.map((j: any) => (j.Key === "J1" ? { ...j, PlannedDate: "2026-10-25" } : j)), settings: { ...s.settings, overrides: { "2026-10-29": "mixed" } } };
  assert.equal(freshUndo(p, later)[0].patch.PlannedDate, "2026-10-25");
  const d: any = toPlan({ type: "set_day_type", date: "2026-10-29", dayType: "business" }, s);
  assert.equal((freshUndo(d, later)[0] as any).type, "mixed");
});
test("your tasks are always sent, even with many jobs", () => {
  const many: any = { ...s, jobs: Array.from({ length: 400 }, (_, i) => ({ Key: `J${i}`, Title: "Job", Status: "Open", Deadline: "2026-11-01" })) };
  const ctx: any = buildContext(many, { names: true });
  assert.ok(ctx.work.some((w: any) => w.key === "T1"));
  assert.equal(ctx.work.length, 200);
});
