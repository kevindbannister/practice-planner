// Companies House filing fees, kept as a schedule the practice can edit, never fixed in code. The defaults are a starting point and say
// where they came from; check them against GOV.UK before relying on them.
export type Fee = { amount: number; effective: string; source: string };
export type FeeSchedule = Record<string, Fee>;
export const DEFAULT_FEES: FeeSchedule = {
  CS01: { amount: 50, effective: "2026-02-01", source: "Reported by a third-party article for 1 February 2026 (online fee). Confirm on GOV.UK." },
};
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : undefined; };
/** The saved schedule over the defaults. Entries that aren't valid are ignored. */
export function readFees(saved: unknown): FeeSchedule {
  const out: FeeSchedule = { ...DEFAULT_FEES };
  if (saved && typeof saved === "object") for (const [form, v] of Object.entries(saved as Record<string, Partial<Fee>>)) {
    const amount = num(v?.amount);
    if (amount === undefined) { if (v === null || (v && (v as { amount?: unknown }).amount === "")) delete out[form]; continue; }
    out[form] = { amount, effective: String(v.effective || ""), source: String(v.source || "Entered by the practice") };
  }
  return out;
}
export const feeFor = (schedule: FeeSchedule, form: string): Fee | undefined => schedule[form];
export const money = (n: number) => `£${n.toFixed(2).replace(/\.00$/, "")}`;
