// Builds the app into dist/: one bundled script, the stylesheet and the page.
//   node build.mjs           production build
//   node build.mjs --serve   local server on http://localhost:5173 with rebuilds
//   node build.mjs --demo    build that talks to an in-browser fake SharePoint (for testing)
import { build, context } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

const serve = process.argv.includes("--serve");
const demo = process.argv.includes("--demo") || serve;

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });
cpSync("public", "dist", { recursive: true });
// pdf.js, for reading PDF bank statements: served from the site itself (the security policy allows nothing else)
mkdirSync("dist/pdf", { recursive: true });
for (const f of ["pdf.min.mjs", "pdf.worker.min.mjs"]) cpSync(`node_modules/pdfjs-dist/build/${f}`, `dist/pdf/${f}`);
// pdf-lib, for making PDF documents (letters and other documents): also served from the site
cpSync("node_modules/pdf-lib/dist/pdf-lib.esm.min.js", "dist/pdf/pdf-lib.esm.min.js");

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

if (serve) {
  const ctx = await context(options);
  await ctx.watch();
  await ctx.serve({ servedir: "dist", port: 5173 });
  console.log("Serving on http://localhost:5173 (demo data store)");
} else {
  await build(options);
  await build(portalOptions);
}
