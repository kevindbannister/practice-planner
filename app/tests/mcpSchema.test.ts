import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LISTS } from "../src/lib/schema.ts";

// The MCP server (api/mcp) carries a copy of the list definitions. This fails if the app's lists change and the copy is stale.
// Fix it with: cd app && node --import tsx gen-mcp-schema.mts
test("the MCP server's copy of the lists matches the app's", () => {
  const copy = JSON.parse(readFileSync(new URL("../../api/mcp/lib/schema.json", import.meta.url), "utf8")) as { lists: { key: string; displayName: string; columns: { name: string; type: string }[] }[] };
  assert.deepEqual(copy.lists.map((l) => [l.key, l.displayName, l.columns.map((c) => `${c.name}:${c.type}`)]), LISTS.map((l) => [l.key, l.displayName, l.columns.map((c) => `${c.name}:${c.type}`)]));
});
