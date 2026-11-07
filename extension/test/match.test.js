import { test } from "node:test";
import assert from "node:assert/strict";
import { normalise, score, findClient, searchClients, xeroShortCode, titleNames } from "../lib/match.js";

const clients = [
  { Key: "C1", TradingName: "A.D. Bannister Roofing & Building Ltd" },
  { Key: "C2", TradingName: "Acme Catering Limited" },
  { Key: "C3", TradingName: "Bannister Holdings Ltd" },
];
test("suffixes and punctuation do not matter", () => {
  assert.equal(score("A.D. Bannister Roofing & Building Ltd", "A D Bannister Roofing and Building Limited"), 1);
  assert.equal(normalise("Acme Ltd"), normalise("ACME Limited"));
});
test("finds the right client from page text", () => {
  const r = findClient(clients, ["Dashboard", "Acme Catering Ltd"]);
  assert.equal(r.best?.client.Key, "C2");
});
test("returns nothing when nothing is close", () => {
  assert.equal(findClient(clients, ["Zebra Farming"]).best, undefined);
});
test("search finds by part of a name", () => {
  assert.ok(searchClients(clients, "bannister").length >= 2);
});
test("reads the Xero short code and page title", () => {
  assert.equal(typeof xeroShortCode("https://go.xero.com/app/!abc12/dashboard"), "string");
  assert.deepEqual(titleNames("Xero | Dashboard | Acme Ltd"), ["Acme Ltd"]);
});
