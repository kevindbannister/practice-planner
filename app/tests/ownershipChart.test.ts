import { test } from "node:test";
import assert from "node:assert/strict";
import { buildChart, chartSvg } from "../src/lib/ownershipChart.ts";
import type { Owner } from "../src/lib/cosecShares.ts";

const o = (name: string, key: string, pct: number): Owner => ({ id: name, name, key, shares: pct, sharePercent: pct, votes: pct, votePercent: pct, classes: [] });
const world: Record<string, Owner[]> = {
  SUBJ: [o("Holdco Ltd", "HOLD", 60), o("Jane Doe", "", 30), o("Bob Roe", "", 10)],
  HOLD: [o("Jane Doe", "", 50), o("Sam Poe", "", 50)],
};
const input = (w: Record<string, Owner[]>) => ({
  subjectKey: "SUBJ", subjectName: "Subject Ltd",
  heldBy: (k: string) => ({ owners: w[k] || [], known: k in w }),
  isCompany: (k: string) => k === "HOLD" || k === "NOLEDGER",
});

test("people are followed through a holding company, and their routes add up", () => {
  const c = buildChart(input(world));
  const by = Object.fromEntries(c.nodes.map((n) => [n.name, n]));
  assert.equal(by["Holdco Ltd"].effective, 60);
  assert.equal(by["Sam Poe"].effective, 30); // 50% of 60%
  assert.equal(by["Jane Doe"].effective, 60); // 30% direct + 50% of 60% through Holdco: one box, both routes
  assert.equal(c.nodes.filter((n) => n.name === "Jane Doe").length, 1);
  assert.equal(c.edges.length, 5);
  assert.equal(by["Jane Doe"].over25, true);
  assert.equal(by["Bob Roe"].over25, false);
  assert.equal(by["Subject Ltd"].level, 0);
  assert.ok(by["Sam Poe"].level > by["Holdco Ltd"].level - 0.5); // above its company
});

test("a company with no ledger is drawn as a box with unknown owners, not followed", () => {
  const c = buildChart(input({ SUBJ: [o("Elsewhere Ltd", "NOLEDGER", 100)] }));
  assert.equal(c.nodes.find((n) => n.name === "Elsewhere Ltd")!.open, true);
  assert.equal(c.nodes.length, 2);
});

test("a company named like a company but not a client is treated as one", () => {
  const c = buildChart(input({ SUBJ: [o("Overseas Holdings Limited", "", 100)] }));
  const n = c.nodes.find((x) => x.name.startsWith("Overseas"))!;
  assert.equal(n.kind, "company");
  assert.equal(n.open, true);
});

test("ownership loops are cut with a warning rather than hanging", () => {
  const w = { SUBJ: [o("Holdco Ltd", "HOLD", 100)], HOLD: [o("Subject Ltd", "SUBJ", 100)] };
  const c = buildChart({ ...input(w), isCompany: () => true });
  assert.ok(c.warnings.some((x) => x.includes("owns it back")));
});

test("no ledger gives just the subject and a plain message", () => {
  const c = buildChart(input({}));
  assert.equal(c.nodes.length, 1);
  assert.ok(c.warnings[0].includes("Nothing on the share ledger"));
});

test("boxes in a row don't overlap and the SVG escapes names", () => {
  const c = buildChart(input({ SUBJ: [o("A & B <x>", "", 50), o("C", "", 50)] }));
  const row = c.nodes.filter((n) => n.level === 1).sort((a, b) => a.x - b.x);
  assert.ok(row[1].x >= row[0].x + 176);
  const svg = chartSvg(c, "Subject Ltd", "2026-10-31");
  assert.ok(svg.includes("A &amp; B &lt;x&gt;"));
  assert.ok(!svg.includes("<x>"));
});
