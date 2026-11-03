// Builds the app into dist/: one bundled script, the stylesheet and the page.
//   node build.mjs           production build
//   node build.mjs --serve   local server on http://localhost:5173 with rebuilds
//   node build.mjs --demo    build that talks to an in-browser fake SharePoint (for testing)
import { build, context } from "esbuild";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
const cp = cpSync;

const serve = process.argv.includes("--serve");
const demo = process.argv.includes("--demo") || serve;

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });
cpSync("public", "dist", { recursive: true });
// pdf.js, for reading PDF bank statements: served from the site itself (the security policy allows nothing else)
mkdirSync("dist/pdf", { recursive: true });
for (const f of ["pdf.min.mjs", "pdf.worker.min.mjs"]) cpSync(`node_modules/pdfjs-dist/build/${f}`, `dist/pdf/${f}`);
// pdf.js 6 uses Map.getOrInsertComputed and Math.sumPrecise, which some browsers don't have yet; the page patches them in
// lib/pdfText.ts, and this starts the worker with the same patches (without them pages with form fields fail to draw)
writeFileSync("dist/pdf/pdf.worker.shim.mjs", `for (const C of [Map, WeakMap]) {
  const p = C.prototype;
  if (!p.getOrInsert) p.getOrInsert = function (k, v) { if (!this.has(k)) this.set(k, v); return this.get(k); };
  if (!p.getOrInsertComputed) p.getOrInsertComputed = function (k, f) { if (!this.has(k)) this.set(k, f(k)); return this.get(k); };
}
if (!Math.sumPrecise) Math.sumPrecise = (xs) => { let s = 0, c = 0; for (const x of xs) { const y = x - c, t = s + y; c = (t - s) - y; s = t; } return s; };
await import("./pdf.worker.min.mjs");
`);
// pdf-lib, for making PDF documents (letters and other documents): also served from the site
cpSync("node_modules/pdf-lib/dist/pdf-lib.esm.min.js", "dist/pdf/pdf-lib.esm.min.js");

// pptxgenjs (with its zip library), for exporting a deck as a PowerPoint file: also served from the site
cp("node_modules/pptxgenjs/dist/pptxgen.bundle.js", "dist/pdf/pptxgen.bundle.js");

const options = {
  entryPoints: ["src/main.tsx"],
  bundle: true,
  outfile: "dist/app.js",
  format: "esm",
  target: ["es2022"],
  jsx: "automatic",
  minify: !serve,
  sourcemap: serve,
  legalComments: "none",
  define: {
    "process.env.NODE_ENV": JSON.stringify(serve ? "development" : "production"),
    __DEMO__: JSON.stringify(demo),
  },
  logLevel: "info",
};

// The client portal is its own page and bundle: no staff code is ever sent to a client's browser.
const portalOptions = { ...options, entryPoints: ["src/portal/main.tsx"], outfile: "dist/portal.js" };

const acceptOptions = { ...options, entryPoints: ["src/accept/main.ts"], outfile: "dist/accept.js" };

if (serve) {
  const ctx = await context(options);
  await ctx.watch();
  await ctx.serve({ servedir: "dist", port: 5173 });
  console.log("Serving on http://localhost:5173 (demo data store)");
} else {
  await build(options);
  await build(portalOptions);
  await build(acceptOptions);
}
