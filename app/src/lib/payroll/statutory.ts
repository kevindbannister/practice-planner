// Statutory sick pay and the family payments (maternity, adoption, paternity, shared parental, parental bereavement, neonatal care):
// average weekly earnings, the amount for the days that fall in a pay period, and what the employer gets back from HMRC on the EPS.
// From 6 April 2026 SSP is paid from the first day of sickness, with no lower earnings limit, at the lower of the weekly rate or 80% of
// average weekly earnings. Family payments need average weekly earnings of at least the lower earnings limit.
import { Freq, StatKind, payrollRates } from "./engine";

const r2 = (v: number) => Math.round(v * 100) / 100 + 0;
const ceil2 = (v: number) => Math.ceil(Math.round(v * 1e6) / 1e4) / 100;
const DAY = 86400000;
const t = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/** Average weekly earnings from the pay in the relevant period: monthly paid, gross over the months x 12 / 52; weekly paid, over the weeks. */
export function averageWeekly(total: number, freq: Freq, periods: number): number {
  if (!(periods > 0)) return 0;
  if (freq === "M1") return r2(total * 12 / 52 / periods);
  const weeks = periods * (freq === "W1" ? 1 : freq === "W2" ? 2 : 4);
  return r2(total / weeks);
}

/** SSP for some days of sickness. Qualifying days are the days they normally work in a week. At most 28 weeks in a spell. */
export function sspFor(year: number, awe: number, qualifyingDaysPerWeek: number, days: number, daysAlreadyPaid = 0): { amount: number; weekly: number; daily: number; days: number; warning?: string } {
  const R = payrollRates(year);
  const qd = Math.min(7, Math.max(1, Math.round(qualifyingDaysPerWeek)));
  const weekly = Math.min(R.ssp, ceil2(Math.max(0, awe) * 0.8));
  const daily = weekly / qd;
  const max = 28 * qd;
  const payable = Math.max(0, Math.min(days, max - daysAlreadyPaid));
  return { amount: ceil2(daily * payable), weekly, daily: Math.round(daily * 10000) / 10000, days: payable, warning: payable < days ? "The 28 weeks of SSP for this spell have been used." : undefined };
}

export type FamilyKind = Exclude<StatKind, "ssp">;
export const FAMILY: Record<FamilyKind, { label: string; weeks: number; higherWeeks: number }> = {
  smp: { label: "Statutory Maternity Pay", weeks: 39, higherWeeks: 6 },
  sap: { label: "Statutory Adoption Pay", weeks: 39, higherWeeks: 6 },
  spp: { label: "Statutory Paternity Pay", weeks: 2, higherWeeks: 0 },
  shpp: { label: "Statutory Shared Parental Pay", weeks: 37, higherWeeks: 0 },
  spbp: { label: "Statutory Parental Bereavement Pay", weeks: 2, higherWeeks: 0 },
  sncp: { label: "Statutory Neonatal Care Pay", weeks: 12, higherWeeks: 0 },
};
export const familyEligible = (year: number, awe: number) => awe >= payrollRates(year).weekly.lel;

/** The weekly rate in a given week of leave (week 1 = the first week). */
export function familyWeekly(year: number, kind: FamilyKind, awe: number, week: number): number {
  const R = payrollRates(year), f = FAMILY[kind];
  const ninety = ceil2(awe * 0.9);
  if (week < 1 || week > f.weeks) return 0;
  return week <= f.higherWeeks ? ninety : Math.min(R.family, ninety);
}
/** The family payment for the days of a pay period (from and to inclusive), for leave starting on `start` and lasting `weeks` (or the most allowed). */
export function familyFor(year: number, kind: FamilyKind, awe: number, start: string, weeks: number, from: string, to: string): number {
  if (!familyEligible(year, awe)) return 0;
  const max = Math.min(FAMILY[kind].weeks, Math.max(1, Math.floor(weeks || FAMILY[kind].weeks)));
  let total = 0;
  for (let d = Math.max(t(from), t(start)); d <= t(to); d += DAY) {
    const week = Math.floor((d - t(start)) / (7 * DAY)) + 1;
    if (week > max) break;
    total += familyWeekly(year, kind, awe, week) / 7;
  }
  return r2(total);
}

/** What the employer gets back for the family payments paid so far this year: 92%, or for a small employer all of it plus 9% compensation. SSP can't be recovered. */
export function recovery(year: number, ytd: Partial<Record<StatKind, number>>, small: boolean) {
  const R = payrollRates(year);
  const out: Record<string, number> = {};
  for (const k of ["smp", "spp", "sap", "shpp", "spbp", "sncp"] as FamilyKind[]) {
    const v = Number(ytd[k]) || 0;
    if (!v) continue;
    out[k] = r2(v * (small ? 1 : R.largeRecovery));
    if (small) out[`comp${k[0].toUpperCase()}${k.slice(1)}`] = r2(v * R.smallEmployerComp);
  }
  return out as { smp?: number; spp?: number; sap?: number; shpp?: number; spbp?: number; sncp?: number; compSmp?: number; compSpp?: number; compSap?: number; compShpp?: number; compSpbp?: number; compSncp?: number };
}
