import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_COLOURS, contrastChecks, fixColours, inkFor, ratio } from "../src/portal/brand";

test("contrast arithmetic matches the published WCAG values", () => {
  assert.equal(Math.round(ratio("#000000", "#ffffff")), 21);
  assert.ok(Math.abs(ratio("#767676", "#ffffff") - 4.54) < 0.02);
  assert.equal(ratio("#123456", "#123456"), 1);
});

test("the standard look passes every readability check", () => {
  assert.ok(contrastChecks(DEFAULT_COLOURS).every((c) => c.pass));
});

test("ink is whichever of black or white reads better", () => {
  assert.equal(inkFor("#ffff00"), "#000000");
  assert.equal(inkFor("#0f4c81"), "#ffffff");
});

test("a faint colour set is flagged, and fixing it makes every check pass", () => {
  const faint = { ...DEFAULT_COLOURS, primary: "#9fc5e8", button: "#ffff00", buttonInk: "#ffffff", headerBg: "#222222", headerInk: "#333333", accent: "#eeeeee", secondary: "#dddddd" };
  const before = contrastChecks(faint).filter((c) => !c.pass).map((c) => c.id);
  for (const id of ["link", "button", "header", "focus", "secondary"]) assert.ok(before.includes(id), id);
  const fixed = fixColours(faint);
  assert.ok(contrastChecks(fixed).every((c) => c.pass), JSON.stringify(contrastChecks(fixed).filter((c) => !c.pass)));
});

test("the same colours give the same answers as the server's checks", async () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const server = (await import("../../api/portal/lib/branding.js")) as unknown as { default: { contrastChecks: (c: unknown) => { id: string; ratio: number; pass: boolean }[] } };
  const set = { ...DEFAULT_COLOURS, primary: "#7a1f3d", button: "#ffcc00", buttonInk: "#ffffff", accent: "#999999" };
  const a = contrastChecks(set).map((c) => [c.id, c.ratio, c.pass]);
  const b = server.default.contrastChecks(set).map((c) => [c.id, c.ratio, c.pass]);
  assert.deepEqual(a, b);
});
