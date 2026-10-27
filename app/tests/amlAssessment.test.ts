import { test } from "node:test";
import assert from "node:assert/strict";
import { approveAssessment, declineAssessment, position, readAssessment, saveAssessment, startAssessment, withdrawAssessment } from "../src/lib/amlAssessment.ts";
import { DEFAULT_ONBOARDING_SETTINGS } from "../src/lib/onboarding.ts";

let n = 0;
const o = (actor = "Kevin") => ({ actor, now: "2026-10-27T10:00:00Z", pid: "P", newKey: (p: string) => `${p}${++n}` });
const yes = () => true;
const client = { Key: "C1", Title: "Bck Interior Ltd", Kind: "Ltd" } as any;
const apply = (rows: any[], w: any) => { for (const c of w.creates || []) rows.push(c.row); for (const p of w.patches) Object.assign(p.row, p.patch); return rows; };
const good = { risk: "low" as const, riskBasis: "UK company, one director, simple structure", owners: [{ name: "A Smith", percent: 100, note: "" }], checks: [{ id: "", kind: "Identity verified", result: "pass" as const, by: "", at: "", note: "passport seen" }] };

test("a new assessment is started once, saved, and approved with a review date", () => {
  const rows: any[] = [];
  apply(rows, startAssessment(client, rows, o()) as any);
  assert.ok("error" in (startAssessment(client, rows, o()) as any));
  apply(rows, saveAssessment(rows[0], good, yes, o("Ann")) as any);
  const w = approveAssessment(rows[0], client, rows, DEFAULT_ONBOARDING_SETTINGS, true, yes, "2026-10-27", o("Bob")) as any;
  assert.equal(w.patches.find((p: any) => p.list === "Clients").patch.AMLReview, "2029-10-27");
  apply(rows, w);
  assert.equal(readAssessment(rows[0]).status, "approved");
  assert.equal(rows[0].DoneOn, "2026-10-27");
});

test("the person who prepared it can't approve it when independent review is on, and problems block approval", () => {
  const rows: any[] = [];
  apply(rows, startAssessment(client, rows, o()) as any);
  assert.match((approveAssessment(rows[0], client, rows, DEFAULT_ONBOARDING_SETTINGS, true, yes, "2026-10-27", o("Ann")) as any).error, /risk assessment/i);
  apply(rows, saveAssessment(rows[0], good, yes, o("Ann")) as any);
  assert.match((approveAssessment(rows[0], client, rows, DEFAULT_ONBOARDING_SETTINGS, true, yes, "2026-10-27", o("Ann")) as any).error, /Someone else/);
});

test("a review copies the last answers and supersedes the old approval", () => {
  const rows: any[] = [];
  apply(rows, startAssessment(client, rows, o()) as any);
  apply(rows, saveAssessment(rows[0], good, yes, o("Ann")) as any);
  apply(rows, approveAssessment(rows[0], client, rows, DEFAULT_ONBOARDING_SETTINGS, true, yes, "2026-10-27", o("Bob")) as any);
  apply(rows, startAssessment(client, rows, o()) as any);
  assert.equal(rows[1].Risk, "low");
  assert.equal(rows[1].Source, "review");
  apply(rows, saveAssessment(rows[1], { checks: good.checks }, yes, o("Ann")) as any);
  apply(rows, approveAssessment(rows[1], client, rows, DEFAULT_ONBOARDING_SETTINGS, true, yes, "2027-10-27", o("Bob")) as any);
  assert.equal(rows[0].Status, "superseded");
  assert.equal(rows[1].Status, "approved");
});

test("decline needs a reason, and withdrawing reopens and clears the client's review date", () => {
  const rows: any[] = [];
  apply(rows, startAssessment(client, rows, o()) as any);
  assert.ok("error" in (declineAssessment(rows[0], "", yes, o()) as any));
  apply(rows, declineAssessment(rows[0], "ID not clear", yes, o()) as any);
  assert.equal(position(client, rows, [], "2026-10-27").state, "declined");
  apply(rows, saveAssessment(rows[0], good, yes, o("Ann")) as any);
  apply(rows, approveAssessment(rows[0], client, rows, DEFAULT_ONBOARDING_SETTINGS, false, yes, "2026-10-27", o("Bob")) as any);
  const w = withdrawAssessment(rows[0], "mistake", client, yes, o()) as any;
  assert.equal(w.patches.find((p: any) => p.list === "Clients").patch.AMLReview, "");
});

test("position: current, due soon, overdue, onboarding approval, and a bare client review date", () => {
  const rows: any[] = [{ Key: "A1", ClientKey: "C1", Status: "approved", Risk: "low", ApprovedAt: "2025-01-01T00:00:00Z", DoneOn: "2025-01-01", ReviewDate: "2026-12-01", Checks: "[]", Evidence: "[]", Owners: "[]" }];
  assert.equal(position(client, rows, [], "2026-10-27").state, "soon");
  assert.equal(position(client, rows, [], "2026-01-01").state, "current");
  assert.equal(position(client, rows, [], "2027-02-01").state, "overdue");
  const onb = [{ ClientKey: "C1", Aml: JSON.stringify({ status: "approved", risk: "medium", approvedAt: "2026-06-01T00:00:00Z", reviewDate: "2028-06-01", checks: [], owners: [] }) }];
  const p = position(client, rows, onb as any, "2026-10-27");
  assert.equal(p.source, "onboarding"); assert.equal(p.state, "current");
  assert.equal(position({ ...client, AMLReview: "2026-01-01" }, [], [], "2026-10-27").state, "overdue");
  assert.equal(position({ Key: "C9" } as any, [], [], "2026-10-27").state, "none");
});
