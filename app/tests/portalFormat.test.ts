import test from "node:test";
import assert from "node:assert/strict";
import { niceDate, readable } from "../src/portal/format";

test("dates from the practice's records read the way people say them", () => {
  assert.equal(niceDate("1997-05-08"), "8 May 1997");
  assert.equal(niceDate("2015-03-02T00:00:00Z"), "2 March 2015");
  assert.equal(niceDate("10-31"), "31 October");
  assert.equal(niceDate("03-31"), "31 March");
  assert.equal(niceDate("31 March"), "31 March");
  assert.equal(niceDate(""), "");
  assert.equal(niceDate("13-40"), "13-40");
  assert.deepEqual(readable({ name: "X", yearEnd: "12-31", incorporated: "2020-01-05" }), { name: "X", yearEnd: "31 December", incorporated: "5 January 2020" });
});
