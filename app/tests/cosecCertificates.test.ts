import test from "node:test";
import assert from "node:assert/strict";
import { issue, cancel, replace, reissue, nextNumber, certsFor, coverage, readCert, certificatePdf } from "../src/lib/cosecCertificates.ts";
import { holderId } from "../src/lib/shareLedger.ts";

const h = (name: string, number: number, cls = "Ordinary", key = "") => ({ id: holderId(name, key), name, key, cls, number });
const holdings = [h("Ann", 60), h("Bob", 40)];
const apply = (rows: any[], w: any) => { for (const p of w.patches) Object.assign(p.row, p.patch); return [...rows, ...w.creates]; };

test("numbers are sequential and never reused, even after cancellation", () => {
  let rows: any[] = [];
  rows = apply(rows, issue([{ holder: "Ann", cls: "Ordinary", shares: 60, issuedOn: "2024-01-01" }], rows, "C1", holdings, "me", "n"));
  rows = apply(rows, issue([{ holder: "Bob", cls: "Ordinary", shares: 40, issuedOn: "2024-01-01" }], rows, "C1", holdings, "me", "n"));
  assert.deepEqual(rows.map((r) => r.Number), ["1", "2"]);
  assert.equal(cancel(rows[1], "Wrong holder", "n").error, undefined);
  apply(rows, cancel(rows[1], "Wrong holder", "n"));
  assert.equal(nextNumber(certsFor(rows, "C1")), "3", "cancelled number 2 is not handed out again");
  assert.match(cancel(rows[1], "again", "n").error!, /already cancelled/);
  assert.equal(nextNumber([readCert({ Number: "SC-0009" })]), "SC-0010");
});
test("can't certify more than the ledger holds, or for someone who holds nothing", () => {
  let rows: any[] = apply([], issue([{ holder: "Ann", cls: "Ordinary", shares: 50, issuedOn: "2024-01-01" }], [], "C1", holdings, "me", "n"));
  assert.match(issue([{ holder: "Ann", cls: "Ordinary", shares: 11, issuedOn: "2024-01-01" }], rows, "C1", holdings, "me", "n").error!, /only 10 can be certified/);
  assert.match(issue([{ holder: "Zed", cls: "Ordinary", shares: 1, issuedOn: "2024-01-01" }], rows, "C1", holdings, "me", "n").error!, /holds no Ordinary/);
  assert.match(issue([{ holder: "Ann", cls: "Ordinary", shares: 1.5, issuedOn: "2024-01-01" }], rows, "C1", holdings, "me", "n").error!, /whole number/);
  const two = issue([{ holder: "Ann", cls: "Ordinary", shares: 5, issuedOn: "2024-01-01" }, { holder: "Ann", cls: "Ordinary", shares: 6, issuedOn: "2024-01-01" }], rows, "C1", holdings, "me", "n");
  assert.match(two.error!, /only 5/, "later items in one batch count the earlier ones");
});
test("replace keeps the old one on record and links the new one", () => {
  const rows: any[] = apply([], issue([{ holder: "Ann", cls: "Ordinary", shares: 60, issuedOn: "2024-01-01" }], [], "C1", holdings, "me", "n"));
  assert.match(replace(rows[0], rows, "", "2025-01-01", "me", "n").error!, /why/);
  const w = replace(rows[0], rows, "Lost", "2025-01-01", "me", "n");
  const all = apply(rows, w);
  assert.deepEqual(all.map((r) => [r.Number, r.Status, r.Replaces]), [["1", "replaced", ""], ["2", "issued", "1"]]);
  assert.equal(coverage(certsFor(all, "C1"), holdings).over.length, 0);
});
test("reissue after a transfer: old cancelled, new certificates must match the new holdings", () => {
  const rows: any[] = apply([], issue([{ holder: "Ann", cls: "Ordinary", shares: 60, issuedOn: "2024-01-01" }], [], "C1", holdings, "me", "n"));
  const after = [h("Ann", 20), h("Bob", 40), h("Cy", 40)];
  assert.match(reissue(rows[0], rows, [{ holder: "Cy", cls: "Ordinary", shares: 41, issuedOn: "2025-01-01" }], "Transfer", after, "me", "n").error!, /only 40/);
  assert.equal(rows[0].Status, "issued", "a refused exchange changes nothing");
  const w = reissue(rows[0], rows, [{ holder: "Cy", cls: "Ordinary", shares: 40, issuedOn: "2025-01-01" }, { holder: "Ann", cls: "Ordinary", shares: 20, issuedOn: "2025-01-01" }], "Transfer", after, "me", "n");
  assert.equal(w.error, undefined); const all = apply(rows, w);
  assert.deepEqual(all.map((r) => [r.Number, r.Status, r.Holder]), [["1", "cancelled", "Ann"], ["2", "issued", "Cy"], ["3", "issued", "Ann"]]);
});
test("coverage flags too many shares certified, and certificates for people who no longer hold", () => {
  const rows: any[] = apply([], issue([{ holder: "Ann", cls: "Ordinary", shares: 60, issuedOn: "2024-01-01" }], [], "C1", holdings, "me", "n"));
  const c = coverage(certsFor(rows, "C1"), [h("Ann", 30), h("Bob", 40)]);
  assert.equal(c.over[0].held, 30); assert.equal(c.uncertificated[0].holder, "Bob");
  assert.equal(coverage(certsFor(rows, "C1"), [h("Bob", 40)]).orphan.length, 1);
});
test("certificate PDF is produced", async () => {
  const b = await certificatePdf({ name: "Test Ltd", number: "01234567" }, readCert({ Number: "1", Holder: "Ann", Class: "Ordinary", NumberOfShares: 60, IssuedOn: "2024-01-01", Status: "issued" }), 1);
  assert.equal(Buffer.from(b.slice(0, 4)).toString(), "%PDF");
});
