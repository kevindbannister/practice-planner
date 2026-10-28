import test from "node:test";
import assert from "node:assert/strict";
import { readRights, owners, bandOf, pscCheck } from "../src/lib/cosecShares.ts";
import { readEntry } from "../src/lib/shareLedger.ts";

const e = (n: string, o: any) => readEntry({ Key: n, ClientKey: "C1", Status: "active", Created: n, Class: "Ordinary", Type: "allotment", EffectiveDate: "2020-01-01", ...o });
const classes: any[] = [{ ClientKey: "C1", Name: "Ordinary", NominalValue: 1, Status: "current" }, { ClientKey: "C1", Name: "A Ordinary", NominalValue: 1, Votes: 0, Dividends: "yes", Status: "current" }, { ClientKey: "C1", Name: "Pref", NominalValue: 1, Votes: 0, Dividends: "no", Redeemable: "yes", Status: "current" }];
test("class rights default to one vote and a share of dividends", () => {
  assert.deepEqual([readRights({ Name: "X" }).votes, readRights({ Name: "X" }).dividends], [1, true]);
  assert.equal(readRights({ Name: "X", Votes: "0" }).votes, 0); assert.equal(readRights({ Name: "X", Votes: "abc" }).votes, 1);
  assert.equal(readRights({ Name: "X", Dividends: "no", Redeemable: "yes" }).redeemable, true);
});
test("ownership by shares and by votes differ when a class has no votes", () => {
  const ledger = [e("1", { Number: 60, ToHolder: "Ann" }), e("2", { Number: 40, ToHolder: "Bob" }), e("3", { Class: "A Ordinary", Number: 100, ToHolder: "Bob" })];
  const o = owners(ledger, classes, "C1", "2026-01-01");
  assert.equal(o.issued, 200); assert.equal(o.votes, 100);
  const ann = o.owners.find((x) => x.name === "Ann")!, bob = o.owners.find((x) => x.name === "Bob")!;
  assert.deepEqual([ann.sharePercent, ann.votePercent, bob.sharePercent, bob.votePercent], [30, 60, 70, 40]);
  assert.equal(owners(ledger, classes, "C1", "2019-01-01").issued, 0, "nothing before the first allotment");
});
test("bands follow Companies House's wording at the boundaries", () => {
  assert.deepEqual([25, 25.01, 50, 50.01, 74.99, 75, 100].map(bandOf), ["", "25-to-50", "25-to-50", "50-to-75", "50-to-75", "75-to-100", "75-to-100"]);
});
test("PSC check: missing, wrong band, and a PSC the ledger no longer supports", () => {
  const ledger = [e("1", { Number: 60, ToHolder: "Ann Able" }), e("2", { Number: 40, ToHolder: "Bob Baker" })];
  const o = owners(ledger, classes, "C1", "2026-01-01");
  const none = pscCheck(o, []);
  assert.deepEqual(none.findings.map((f) => `${f.kind}:${f.who}`), ["missing:Ann Able", "missing:Bob Baker"]);
  const pscs: any[] = [
    { Status: "current", First: "Ann", Last: "Able", Natures: JSON.stringify(["ownership-of-shares-25-to-50-percent", "voting-rights-25-to-50-percent"]) },
    { Status: "current", First: "Bob", Last: "Baker", Natures: JSON.stringify(["ownership-of-shares-25-to-50-percent", "voting-rights-25-to-50-percent"]) },
    { Status: "current", First: "Cy", Last: "Gone", Natures: JSON.stringify(["ownership-of-shares-75-to-100-percent"]) },
    { Status: "ceased", First: "Old", Last: "Timer", Natures: JSON.stringify(["ownership-of-shares-75-to-100-percent"]) },
  ];
  const r = pscCheck(o, pscs);
  assert.deepEqual(r.findings.map((f) => `${f.kind}:${f.who}`), ["band:Ann Able", "band:Ann Able", "no-longer:Cy Gone"]);
  assert.match(r.findings[0].detail, /50% and less than 75%/);
  assert.equal(pscCheck(o, [{ ...pscs[0], Natures: JSON.stringify(["ownership-of-shares-50-to-75-percent", "voting-rights-50-to-75-percent"]) }, { ...pscs[1], Natures: JSON.stringify(["ownership-of-shares-25-to-50-percent", "voting-rights-25-to-50-percent"]) }]).findings.length, 0);
});
