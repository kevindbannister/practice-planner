import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanDesign, copyDesign, defaultDesign, designProblems, fillVars, layoutFor, pageLabel, readDesigns, typeForCategory, DESIGN_KEY } from "../src/lib/docDesign";
import { DEFAULT_BRANDING } from "../src/lib/docBranding";
import { renderPdf } from "../src/lib/docPdf";
import * as pdf from "pdf-lib";

const brand = { ...DEFAULT_BRANDING, practiceName: "Acme Accountants", correspondenceAddress: "1 High St\nLondon" };
const content = { blocks: [{ type: "p" as const, runs: [{ t: "Hello" }] }] };

test("a bad saved design falls back to defaults and is clamped", () => {
  const d = cleanDesign({ font: "comic", fontSize: 99, margins: { top: -4 }, header: { minHeight: 500, left: { kind: "bogus" } }, cover: { info: new Array(9).fill({ label: "a", value: "b" }), overlay: "red" } }, "proposal");
  assert.equal(d.font, "inherit"); assert.equal(d.fontSize, 14); assert.equal(d.margins.top, 10); assert.equal(d.header.minHeight, 60);
  assert.equal(d.header.left.kind, "text"); assert.equal(d.cover.info.length, 4); assert.equal(d.cover.overlay, defaultDesign("proposal").cover.overlay);
});
test("designs are read from settings and copied between types", () => {
  const all = readDesigns([{ Key: DESIGN_KEY, Value: JSON.stringify({ proposal: { pageNumbers: "slash" } }) }]);
  assert.equal(all.proposal?.pageNumbers, "slash"); assert.equal(all.engagement, undefined);
  const copied = copyDesign(all, "proposal", "clearance");
  assert.equal(copied.clearance?.pageNumbers, "slash");
  assert.deepEqual(readDesigns([{ Key: DESIGN_KEY, Value: "not json" }]), {});
});
test("fields fill, unknown ones stay, page labels follow the style", () => {
  assert.equal(fillVars("{title} / {client} / {firm} / {address} / {page}", { title: "T", client: "C", branding: brand }), "T / C / Acme Accountants / 1 High St, London / {page}");
  assert.equal(pageLabel("page-of", 2, 5), "Page 2 of 5"); assert.equal(pageLabel("slash", 2, 5), "2 / 5"); assert.equal(pageLabel("none", 2, 5), "");
});
test("a header taller than its margin is reported", () => {
  const d = defaultDesign("adhoc");
  assert.equal(designProblems(d).length, 0);
  assert.equal(designProblems({ ...d, margins: { ...d.margins, top: 12 } }).length, 1);
});
test("category chooses the design type", () => {
  assert.equal(typeForCategory("Engagement letters"), "engagement"); assert.equal(typeForCategory("Fee proposals"), "proposal"); assert.equal(typeForCategory("Tax correspondence"), "adhoc");
  assert.equal(layoutFor(defaultDesign("adhoc")).showLogo, false);
});
test("a cover page adds one page, and without a design nothing changes", async () => {
  const plain = await pdf.PDFDocument.load(await renderPdf(pdf, { content, branding: brand }));
  const noCover = await pdf.PDFDocument.load(await renderPdf(pdf, { content, branding: brand, design: { ...defaultDesign("adhoc"), cover: { ...defaultDesign("adhoc").cover, enabled: false } } }));
  const covered = await pdf.PDFDocument.load(await renderPdf(pdf, { content, branding: brand, title: "Proposal", reference: "R1", design: defaultDesign("proposal"), vars: { client: "Client Ltd" } }));
  assert.equal(plain.getPageCount(), 1); assert.equal(noCover.getPageCount(), 1); assert.equal(covered.getPageCount(), 2);
});
