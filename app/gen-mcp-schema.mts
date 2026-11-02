// Writes api/mcp/lib/schema.json from src/lib/schema.ts so the MCP server knows every list and column.
import { writeFileSync } from "node:fs";
import { LISTS } from "./src/lib/schema.ts";
writeFileSync("../api/mcp/lib/schema.json", JSON.stringify({ lists: LISTS.map((l) => ({ key: l.key, displayName: l.displayName, description: l.description.replace(/^Practice Planner: /, ""), columns: l.columns.map((c) => ({ name: c.name, type: c.type })) })) }, null, 1) + "\n");
console.log(LISTS.length, "lists");
