// The portal's server and the planner app must agree on the names of the portal's lists.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { LISTS } from "../src/lib/schema";

const require = createRequire(import.meta.url);

test("every list the portal server uses is created by the app, with the columns the server writes", () => {
  const { LISTS: server } = require("../../api/portal/lib/graphStore.js") as { LISTS: Record<string, string> };
  const app = new Map(LISTS.map((l) => [l.displayName, l]));
  for (const [coll, name] of Object.entries(server)) {
    const list = app.get(name);
    assert.ok(list, `${coll}: no list called "${name}" in schema.ts`);
    const cols = list.columns.map((c) => c.name);
    for (const c of ["Key", "PracticeId", "Ref1", "Ref2", "Rev", "Json"]) assert.ok(cols.includes(c), `${name} lacks ${c}`);
  }
  assert.equal(Object.keys(server).length, LISTS.filter((l) => l.key.startsWith("Portal")).length);
});
