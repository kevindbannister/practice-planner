// Works out where every box is on HMRC's blank SA100 forms, so the tax return screen can write each figure into its box and
// make the boxes clickable. Run from app/:  node tools/sa100-map.mjs   (or name the years: node tools/sa100-map.mjs 2026)
// For each public/forms/sa100/SA100-<year>.pdf it writes SA100-<year>.json beside it.
//
// The forms are drawn, not fillable, so the boxes are found from the drawing: every white input cell (and the shaded cell with
// the £ sign), grouped into fields, and each field matched to the numbered badge above-left of it ("1", "2"...) and its label.
// The first page has HMRC's own few fields (UTR, NINO, reference, name and address), taken from the form's widgets.
// The finding itself is in src/lib/formMap.mjs, which the app also uses to read a filled-in return.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pageBoxes } from "../src/lib/formMap.mjs";

const DIR = "public/forms/sa100";
async function mapYear(year) {
  const file = join(DIR, `SA100-${year}.pdf`);
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), isEvalSupported: false, verbosity: 0 }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const pg = await pageBoxes(await doc.getPage(p), p, pdfjs.OPS);
    if (pg.tr) pages.push(pg);
  }
  const out = { year, made: "tools/sa100-map.mjs", pages };
  writeFileSync(join(DIR, `SA100-${year}.json`), JSON.stringify(out));
  console.log(`SA100-${year}: ${pages.length} pages, ${pages.reduce((a, p) => a + p.boxes.length, 0)} boxes`);
}

const years = process.argv.slice(2).length ? process.argv.slice(2).map(Number) : readdirSync(DIR).map((f) => f.match(/^SA100-(\d{4})\.pdf$/)?.[1]).filter(Boolean).map(Number);
for (const y of years.sort()) await mapYear(y);
// the years the app can show
const have = readdirSync(DIR).map((f) => f.match(/^SA100-(\d{4})\.json$/)?.[1]).filter(Boolean).map(Number).filter((y) => readdirSync(DIR).includes(`SA100-${y}.pdf`)).sort();
writeFileSync(join(DIR, "index.json"), JSON.stringify({ years: have }));
