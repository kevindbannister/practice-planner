import test from "node:test";
import assert from "node:assert/strict";
import { ADVISORY_BARS, CANVASES, DEFAULT_LOOK, PRACTICE_BARS, WORK_BARS, contrast, lookVars, personalKey, readLook, readPersonal } from "../src/lib/appearance.ts";

test("every Work and Advisory bar colour keeps white text readable", () => {
  for (const p of [...WORK_BARS, ...ADVISORY_BARS]) assert.ok(contrast(p.value, "#FFFFFF") >= 4.5, `${p.label} ${p.value} is only ${contrast(p.value, "#FFFFFF").toFixed(2)}:1`);
});

test("the Practice bars and backgrounds are light enough for dark text", () => {
  for (const c of CANVASES) { assert.ok(contrast(c.practice, "#17263A") >= 7, c.label); assert.ok(contrast(c.work, "#17263A") >= 7, c.label); }
  assert.ok(PRACTICE_BARS.some((p) => p.key === DEFAULT_LOOK.practiceBar));
});

test("a saved look is checked: unknown choices go back to the default, colour slots must be 0 to 7", () => {
  assert.deepEqual(readLook(undefined), DEFAULT_LOOK);
  assert.deepEqual(readLook({ workBar: "teal", advisoryBar: "nope", practiceBar: "white", canvas: "deeper", serviceSlots: { VAT: 3, X: 9, Y: -1, Z: "2", W: 1.5 } }),
    { workBar: "teal", advisoryBar: "purple", practiceBar: "white", canvas: "deeper", serviceSlots: { VAT: 3, Z: 2 } });
});

test("a look becomes the CSS variables the page and the preview use", () => {
  const v = lookVars(readLook({ workBar: "forest", canvas: "lighter" }));
  assert.equal(v["--work-bar"], "#14532D");
  assert.equal(v["--adv-bar"], "#2E2368");
  assert.equal(v["--canvas-practice"], "#F8F9FB");
  assert.equal(v["--canvas-work"], "#EEF1F5");
  assert.match(v["--practice-bar"], /linear-gradient/);
});

test("each person's own view is checked and kept per person, whatever the capitals", () => {
  assert.equal(readPersonal(null), undefined);
  assert.deepEqual(readPersonal({ layout: "side", workView: "bars", tips: true, theme: "dark", updated: "2026-11-17T10:00:00Z" }),
    { layout: "side", workView: "bars", tips: true, theme: "dark", updated: "2026-11-17T10:00:00Z" });
  assert.deepEqual(readPersonal({ layout: "x", workView: "y", tips: "yes", theme: "z" }), { layout: "top", workView: "table", tips: false, theme: "system", updated: "" });
  assert.equal(personalKey(" Demo User "), personalKey("demo user"));
});
