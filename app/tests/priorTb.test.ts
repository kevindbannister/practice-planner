import assert from "node:assert/strict";
import { test } from "node:test";
import { PRIOR_OWN_SUB, priorAccounts, usesOwnPrior } from "../src/lib/tbMap";

const L = (period: string, section: string, sub: string, code: string, Detail: string, f: Record<string, unknown>, n: number) =>
  ({ Key: `${period}${section}${sub}${n}`, ClientKey: "C", PeriodEnd: period, SectionKey: section, SubKey: sub, Code: code, Detail, Seq: n, Figures: JSON.stringify(f) }) as any;
const lines = [
  L("2025-09-30", "tb", "main", "204", "Sales", { cr: 1000 }, 1), L("2025-09-30", "tb", "main", "310", "Wages", { dr: 400 }, 2), L("2025-09-30", "tb", "main", "622", "Bank", { dr: 600 }, 3),
  L("2025-09-30", "journals", "main", "310", "Wages", { no: 1, dr: 50 }, 4), L("2025-09-30", "journals", "main", "622", "Bank", { no: 1, cr: 50 }, 5),
];
const own = [L("2026-09-30", "tb", PRIOR_OWN_SUB, "204", "Sales", { cr: 900 }, 1), L("2026-09-30", "tb", PRIOR_OWN_SUB, "622", "Bank", { dr: 900 }, 2)];
const flag = (on: boolean) => [{ ClientKey: "C", PeriodEnd: "2026-09-30", ItemKey: "tb/main", Setup: JSON.stringify(on ? { priorOwn: true } : {}) }] as any;
const fig = (rows: any[]) => rows.map((r) => [r.account, r.dr, r.cr]);

test("last year, as the next set of accounts uses it, is last year's final trial balance (journals included)", () => {
  const rows = priorAccounts([...lines, ...own], flag(false), "C", "2026-09-30");
  assert.deepEqual(fig(rows), [["Sales", 0, 1000], ["Wages", 450, 0], ["Bank", 550, 0]]);
  assert.equal(usesOwnPrior(flag(false), "C", "2026-09-30"), false);
});

test("ticking the box uses the figures kept on this year's papers, and last year's papers are untouched", () => {
  const rows = priorAccounts([...lines, ...own], flag(true), "C", "2026-09-30");
  assert.deepEqual(fig(rows), [["Sales", 0, 900], ["Bank", 900, 0]]);
  assert.equal(usesOwnPrior(flag(true), "C", "2026-09-30"), true);
  assert.deepEqual(fig(priorAccounts([...lines, ...own], flag(false), "C", "2026-09-30")), [["Sales", 0, 1000], ["Wages", 450, 0], ["Bank", 550, 0]]);
});
