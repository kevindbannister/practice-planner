import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_LOGO_SIZE, cleanLogoSize, logoBox, logoSizeOf, readLogoSizes, withLogoSize } from "../src/lib/logoSize.ts";

test("sizes are clamped and shapes checked", () => {
  assert.deepEqual(cleanLogoSize({ shape: "square", size: 500 }), { shape: "square", size: 96 });
  assert.deepEqual(cleanLogoSize({ shape: "wide", size: 2 }), { shape: "rectangle", size: 28 });
  assert.deepEqual(cleanLogoSize("junk"), DEFAULT_LOGO_SIZE);
});
test("a square is as wide as it is high and a rectangle is wider", () => {
  assert.deepEqual(logoBox({ shape: "square", size: 50 }), { width: 50, height: 50 });
  assert.deepEqual(logoBox({ shape: "rectangle", size: 40 }), { width: 100, height: 40 });
});
test("saved sizes are per client, and the default is not stored", () => {
  let all = withLogoSize({}, "C1", { shape: "square", size: 60 });
  assert.deepEqual(logoSizeOf(all, "C1"), { shape: "square", size: 60 });
  assert.deepEqual(logoSizeOf(all, "C2"), DEFAULT_LOGO_SIZE);
  all = withLogoSize(all, "C1", DEFAULT_LOGO_SIZE);
  assert.deepEqual(all, {});
  assert.deepEqual(readLogoSizes([1]), {});
  assert.equal(readLogoSizes({ C1: { shape: "square", size: 999 } }).C1.size, 96);
});
