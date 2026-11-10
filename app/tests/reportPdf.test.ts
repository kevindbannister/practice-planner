import test from "node:test";
import assert from "node:assert/strict";
import { pdfName, slices } from "../src/ui/reportPdf.ts";

test("a section that fits is one page; a longer one is cut between blocks, never through one", () => {
  assert.deepEqual(slices(700, 1123, [], []), [[0, 700]]);
  const blocks = [{ top: 40, bottom: 500 }, { top: 520, bottom: 1000 }, { top: 1020, bottom: 1500 }, { top: 1520, bottom: 1700 }];
  const s = slices(1740, 1123, blocks, []);
  assert.deepEqual(s, [[0, 1020], [1020, 1740]]);
  for (const [a, b] of s) for (const k of blocks) assert.ok(!(k.top < b && k.bottom > b && k.top > a), "no block is cut");
  assert.equal(s[0][0], 0); assert.equal(s[s.length - 1][1], 1740);
});

test("a page break block always starts a new page, and a block taller than a page is cut at the page end", () => {
  assert.deepEqual(slices(900, 1123, [{ top: 40, bottom: 300 }, { top: 320, bottom: 860 }], [310]), [[0, 310], [310, 900]]);
  const tall = slices(3000, 1123, [{ top: 40, bottom: 2960 }], []);
  assert.equal(tall[0][1], 1123 - 46); assert.equal(tall[tall.length - 1][1], 3000);
  assert.ok(tall.every(([a, b]) => b > a));
});

test("the file name is safe to save", () => {
  assert.equal(pdfName("Acme Ltd", "Management accounts: Jan/Feb"), "Acme Ltd - Management accounts Jan Feb.pdf");
});
