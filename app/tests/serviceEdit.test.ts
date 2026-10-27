import { test } from "node:test";
import assert from "node:assert/strict";
import { planServiceEdit } from "../src/lib/fees.ts";

let n = 0;
const ctx = () => ({ actor: "Kevin", now: "2026-10-27T12:00:00Z", pid: "P", newKey: (p: string) => `${p}${++n}` });
const client = { Key: "C1", Title: "Acme Ltd", AnnualFees: 0 };
const yes = () => true, no = (a: string) => a !== "send";
const row = (o: object) => ({ Key: "S1", ClientKey: "C1", ServiceKey: "VAT", Fee: 100, FeePeriod: "quarterly", AnnualFee: 400, ...o });
const base = { client, today: "2026-10-27", reviewMonths: 12, reason: "" };

test("adding a service creates a line with its fee and a yearly total", () => {
  const w: any = planServiceEdit({ ...base, schedule: [], edits: [{ serviceKey: "PAYROLL", on: true, fee: "50", period: "monthly" }], can: yes }, ctx());
  const cs = w.creates.find((c: any) => c.list === "ClientServices").row;
  assert.equal(cs.Fee, 50); assert.equal(cs.AnnualFee, 600); assert.equal(cs.Off, false);
  assert.equal(w.patches.find((p: any) => p.list === "Clients").patch.AnnualFees, 600);
});

test("a fee can't be agreed or changed without authority", () => {
  assert.ok((planServiceEdit({ ...base, schedule: [], edits: [{ serviceKey: "VAT", on: true, fee: "10", period: "monthly" }], can: no }, ctx()) as any).error);
  assert.ok((planServiceEdit({ ...base, reason: "x", schedule: [row({})], edits: [{ serviceKey: "VAT", on: true, fee: "120", period: "quarterly" }], can: no }, ctx()) as any).error);
  assert.ok(!(planServiceEdit({ ...base, schedule: [], edits: [{ serviceKey: "VAT", on: true, fee: "", period: "" }], can: no }, ctx()) as any).error);
});

test("changing an existing fee needs a reason and is kept in the history", () => {
  const edits = [{ serviceKey: "VAT", on: true, fee: "120", period: "quarterly" }];
  assert.ok((planServiceEdit({ ...base, schedule: [row({})], edits, can: yes }, ctx()) as any).error);
  const w: any = planServiceEdit({ ...base, reason: "Annual increase", schedule: [row({})], edits, can: yes }, ctx());
  assert.equal(w.patches.find((p: any) => p.list === "ClientServices").patch.Fee, 120);
  assert.ok(w.creates.some((c: any) => c.list === "FeeHistory"));
  assert.equal(w.patches.find((p: any) => p.list === "Clients").patch.AnnualFees, 480);
});

test("unticking turns a service off, ticking it again turns it back on, with no fee reason needed", () => {
  const off: any = planServiceEdit({ ...base, schedule: [row({})], edits: [{ serviceKey: "VAT", on: false, fee: "100", period: "quarterly" }], can: no }, ctx());
  assert.equal(off.patches.find((p: any) => p.list === "ClientServices").patch.Off, true);
  const on: any = planServiceEdit({ ...base, schedule: [row({ Off: true })], edits: [{ serviceKey: "VAT", on: true, fee: "100", period: "quarterly" }], can: no }, ctx());
  assert.equal(on.patches.find((p: any) => p.list === "ClientServices").patch.Off, false);
});

test("nothing changed is not a save", () => {
  assert.ok((planServiceEdit({ ...base, schedule: [row({})], edits: [{ serviceKey: "VAT", on: true, fee: "100", period: "quarterly" }], can: yes }, ctx()) as any).error);
  assert.ok((planServiceEdit({ ...base, schedule: [], edits: [{ serviceKey: "VAT", on: false, fee: "", period: "" }], can: yes }, ctx()) as any).error);
});
