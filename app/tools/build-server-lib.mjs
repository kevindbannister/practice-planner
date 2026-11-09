// Bundles the planner rules the Azure functions use (src/server/index.ts) into api/shared/plannerlib.js.
// Run in CI before the API is tested and deployed; also run it locally before `npm test` in api/.
import { build } from "esbuild";
await build({ entryPoints: ["src/server/index.ts"], bundle: true, platform: "node", format: "cjs", target: "node22", outfile: "../api/shared/plannerlib.js", logLevel: "warning", legalComments: "none" });
console.log("api/shared/plannerlib.js written");
