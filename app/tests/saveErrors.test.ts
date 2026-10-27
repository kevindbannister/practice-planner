import test from "node:test";
import assert from "node:assert/strict";
import { GraphError } from "../src/lib/graph.ts";
import { friendlyError } from "../src/lib/sharepoint.ts";

test("403 includes the Graph code and cause rather than asserting missing admin consent", () => {
  const msg = friendlyError(new GraphError(403, "Access denied to requested resource", "accessDenied"));
  assert.match(msg, /403 accessDenied/);
  assert.match(msg, /Access denied to requested resource/);
  assert.match(msg, /SharePoint site/);
  assert.match(msg, /Sites\.ReadWrite\.All/);
  assert.doesNotMatch(msg, /permissions have admin consent/);
});

test("401 and other Graph failures retain their appropriate guidance", () => {
  assert.match(friendlyError(new GraphError(401, "Unauthorised")), /sign-in has expired/);
  assert.match(friendlyError(new GraphError(400, "A column does not exist")), /A column does not exist/);
});
