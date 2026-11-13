import test from "node:test";
import assert from "node:assert/strict";
import { filingRows, filingsFrom } from "../src/lib/cosecHistory.ts";
import { verifiedFrom, verifiedOf } from "../src/lib/cosec.ts";

const list = { items: [
  { transaction_id: "A", date: "2025-12-01", type: "AA", description: "accounts-with-accounts-type-micro-entity", category: "accounts" },
  { transaction_id: "B", date: "2026-03-01", type: "CS01", description: "confirmation-statement-with-no-updates", category: "confirmation-statement", paper_filed: true },
  { date: "bad", type: "AA" }, { date: "2026-01-01", type: "" },
] };

test("Companies House filing history becomes short rows, newest first, dropping unusable ones", () => {
  const f = filingsFrom(list);
  assert.deepEqual(f.map((x) => x.id), ["B", "A"]);
  assert.equal(f[1].what, "Accounts with accounts type micro entity");
  assert.equal(f[0].paper, true);
  assert.equal(filingsFrom(list, 1).length, 1);
  assert.deepEqual(filingsFrom(null), []);
});

test("the history is kept on the Companies House record", () => {
  const v = verifiedFrom({ company_name: "Acme Ltd" } as any, "2026-11-13T00:00:00Z", filingsFrom(list));
  assert.equal(verifiedOf({ CHVerified: JSON.stringify(v) } as any).history?.length, 2);
  assert.equal(verifiedFrom({ company_name: "Acme Ltd" } as any, "2026-11-13T00:00:00Z").history, undefined);
});

const client: any = { Key: "C1", Title: "Acme Ltd", CHVerified: JSON.stringify({ history: filingsFrom(list) }) };
const tx = (o: any) => ({ Key: "T" + o.Status, ClientKey: "C1", Form: "AD01", Title: "Change office", Ref: "R1", Created: "2026-11-10T09:00:00Z", ...o });

test("Companies House filings carry no status; only open filings prepared here do", () => {
  const rows = filingRows([tx({ Status: "draft" }), tx({ Status: "approved" }), tx({ Status: "accepted" }), tx({ Status: "cancelled" })], [client], verifiedOf);
  assert.equal(rows.filter((r) => r.source === "ch").length, 2);
  assert.ok(rows.filter((r) => r.source === "ch").every((r) => r.status === undefined));
  assert.deepEqual(rows.filter((r) => r.source === "system").map((r) => r.status).sort(), ["approved", "draft"]);
  assert.equal(filingRows([tx({ Status: "accepted" })], [client], verifiedOf, { showClosed: true }).filter((r) => r.source === "system").length, 1);
});

test("a company with no history read yet lists only what is being prepared", () => {
  const rows = filingRows([tx({ Status: "draft" })], [{ Key: "C1", Title: "Acme Ltd" } as any], verifiedOf);
  assert.deepEqual(rows.map((r) => r.source), ["system"]);
});
