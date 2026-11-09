import assert from "node:assert/strict";
import { test } from "node:test";
import { digestFor } from "../src/server/digest";

const clients = [{ Key: "C1", Title: "Acme Ltd", Manager: "Kevin" }, { Key: "C2", Title: "Other Ltd", Manager: "Sam" }] as never[];
const alerts = (key: string, at: string, lines: string[]) => ({ Key: `reporting.alerts.${key}`, Value: JSON.stringify({ at, month: "2026-10", lines }) });
const base = { clients, jobs: [], assessments: [], onboardings: [], records: [] };

test("KPI alerts raised when a client's figures were read appear in that client's manager's morning email", () => {
  const d = digestFor({ name: "Kevin", role: "staff", email: "k@x.uk" }, { ...base, settings: [alerts("C1", "2026-11-08T10:00:00Z", ["Gross Profit Margin: is less than 45% (now 38%)"]), alerts("C2", "2026-11-08T10:00:00Z", ["Cash on Hand: is less than £5,000 (now £200)"])] as never[] }, "2026-11-09");
  const s = d.sections.find((x) => /KPI alerts/.test(x.title))!;
  assert.deepEqual(s.items, ["Acme Ltd: Gross Profit Margin: is less than 45% (now 38%)"]);
});

test("old KPI alerts are left out", () => {
  const d = digestFor({ name: "Kevin", role: "staff", email: "k@x.uk" }, { ...base, settings: [alerts("C1", "2026-08-01T10:00:00Z", ["Gross Profit Margin: is less than 45% (now 38%)"])] as never[] }, "2026-11-09");
  assert.equal(d.sections.length, 0);
});
