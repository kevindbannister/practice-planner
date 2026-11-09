// What the firm's AML policy (the policy builder's monitoring step) says about how often clients are reviewed. Kept apart from the rest
// so onboarding can use it without a circular import.
import { Row } from "./schema";

const str = (v: unknown): string => (v === undefined || v === null ? "" : String(v));
export const monthsOf = (v: unknown): number | null => { const m = /^\s*(\d{1,3})/.exec(str(v)); const n = m ? Number(m[1]) : NaN; return Number.isInteger(n) && n >= 1 && n <= 120 ? n : null; };

export function policyAnswers(settings: Row[]): Record<string, unknown> {
  const row = settings.find((r) => r.Key === "aml.builder");
  if (!row?.Value) return {};
  try { const o = JSON.parse(str(row.Value)); return o && typeof o.answers === "object" && o.answers ? o.answers : {}; } catch { return {}; }
}
/** Months between reviews as the policy sets them, for each risk level the policy has answered. */
export function policyMonths(settings: Row[]): { high?: number; medium?: number; low?: number } {
  const a = policyAnswers(settings);
  const out: { high?: number; medium?: number; low?: number } = {};
  const hi = monthsOf(a.mHigh ?? a.high), md = monthsOf(a.mMed ?? a.medium), lo = monthsOf(a.mLow ?? a.low);
  if (hi) out.high = hi; if (md) out.medium = md; if (lo) out.low = lo;
  return out;
}

export type ScreeningPolicy = { high: number; medium: number; low: number; monitor: string[]; fromPolicy: boolean };
/** How often clients are re-screened for sanctions and PEPs, by risk, as the policy's sanctions step sets it. Falls back to the review periods. */
export function screeningPolicy(settings: Row[], review: { high: number; medium: number; low: number }): ScreeningPolicy {
  const a = policyAnswers(settings);
  const hi = monthsOf(a.sHigh), md = monthsOf(a.sMed), lo = monthsOf(a.sLow);
  return { high: hi ?? review.high, medium: md ?? review.medium, low: lo ?? review.low, monitor: Array.isArray(a.monitorRisk) ? (a.monitorRisk as unknown[]).map(str).filter((x) => ["high", "medium", "low"].includes(x)) : a.monitor === "yes" ? ["high", "medium", "low"] : [], fromPolicy: !!(hi && md && lo) };
}

/** How often identity is re-verified, by risk, in months (0 = only when something changes). Unanswered counts as 0. */
export function idRefreshPolicy(settings: Row[]): { high: number; medium: number; low: number } {
  const a = policyAnswers(settings);
  const m = (v: unknown) => { const n = parseInt(str(v), 10); return Number.isFinite(n) && n > 0 ? n : 0; };
  return { high: m(a.idHigh), medium: m(a.idMed), low: m(a.idLow) };
}
/** When the next ID re-check is due for a client last verified on `on`, or "" if none is due by time. */
export function idRecheckDue(on: string, risk: string, p: { high: number; medium: number; low: number }): string {
  const months = risk === "high" ? p.high : risk === "low" ? p.low : p.medium;
  if (!months || !/^\d{4}-\d{2}-\d{2}$/.test(on)) return "";
  const d = new Date(`${on}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}
