import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { buildPptx } from "../src/lib/deckPptx";
import { DEFAULT_BRAND, SLIDE_TYPES, blankSlide, Deck } from "../src/lib/deck";

const require = createRequire(import.meta.url);
const Pptx = require("pptxgenjs");
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("every slide type makes a PowerPoint file; hidden and internal slides are left out unless asked for", async () => {
  const slides = [{ ...blankSlide("section"), title: "Cover", type: "cover" as const }, ...SLIDE_TYPES.map((t) => ({ ...blankSlide(t.type), notes: `Notes for ${t.name}` }))];
  slides[2] = { ...slides[2], hidden: true }; slides[3] = { ...slides[3], internal: true };
  const deck: Deck = { v: 1, brand: { ...DEFAULT_BRAND, clientName: "Acme & Sons Ltd", logo: PNG, cover: PNG, footer: "Draft for discussion" }, slides };
  const buf = await buildPptx(Pptx, deck, { firmLogo: PNG, firmName: "Firm & Co" });
  const bytes = new Uint8Array(buf);
  assert.equal(String.fromCharCode(bytes[0], bytes[1]), "PK");
  const JSZip = require("jszip");
  const zip = await JSZip.loadAsync(buf);
  const files = Object.keys(zip.files);
  assert.equal(files.filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).length, slides.length - 2);
  assert.ok(files.some((f) => f.startsWith("ppt/charts/chart")), "charts are native");
  const all = await buildPptx(Pptx, deck, { includeInternal: true });
  assert.equal(Object.keys((await JSZip.loadAsync(all)).files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).length, slides.length - 1);
});
