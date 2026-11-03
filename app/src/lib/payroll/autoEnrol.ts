// Workplace pension automatic enrolment: who must be enrolled, who must be told they can join, and what happens on an opt-out.
// Assessed each pay period on that period's earnings and the person's age on payday. A director is exempt unless they have a contract
// of employment and someone else in the company does too (The Pensions Regulator). Re-enrolment every three years, the declaration of
// compliance and the pension provider's own files are done outside the payroll.
import { Freq, payrollRates } from "./engine";

const t = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
export type AeStatus = "" | "assess" | "postponed" | "enrolled" | "opted-in" | "joined" | "opted-out" | "exempt";
export const AE_LABEL: Record<AeStatus, string> = { "": "Not tracked (pension as set)", assess: "Being assessed", postponed: "Postponed", enrolled: "Enrolled", "opted-in": "Opted in", joined: "Joined (entitled worker)", "opted-out": "Opted out", exempt: "Exempt" };

export function ageOn(dob: string, on: string): number {
  if (!dob || !on) return 0;
  const [y, m, d] = dob.split("-").map(Number), [Y, M, D] = on.split("-").map(Number);
  return Y - y - (M < m || (M === m && D < d) ? 1 : 0);
}
/** State Pension age: 66, rising to 67 for people born from 6 April 1960 (phased by month of birth until 5 March 1961). */
export function statePensionAgeDate(dob: string): string {
  const [y, m, d] = dob.split("-").map(Number);
  const born = t(dob);
  let months = 66 * 12;
  if (born >= t("1961-03-06")) months = 67 * 12;
  else if (born >= t("1960-04-06")) months = 66 * 12 + Math.min(11, Math.max(1, Math.floor((born - t("1960-04-06")) / (30.44 * 86400000)) + 1));
  const dt = new Date(Date.UTC(y, m - 1 + months, d));
  return dt.toISOString().slice(0, 10);
}

export type AeCategory = "eligible" | "non-eligible" | "entitled" | "outside" | "exempt";
export type AeResult = { category: AeCategory; action: "enrol" | "tell-optin" | "tell-join" | "none"; text: string };
export function assess(i: { dob: string; payday: string; earnings: number; freq: Freq; year: number; director: boolean; hasContract: boolean; otherContracts: boolean; status: AeStatus; postponeUntil?: string }): AeResult {
  const R = payrollRates(i.year);
  const mult = i.freq === "W2" ? 2 : i.freq === "W4" ? 4 : 1;
  const key = i.freq === "M1" ? "monthly" : "weekly";
  const trigger = i.freq === "M1" ? Math.round(R.qe.trigger / 12) : Math.round(R.qe.trigger / 52) * mult; // £833 a month, £192 a week
  const lower = R.qe.lower[key] * mult;
  if (i.director && !(i.hasContract && i.otherContracts)) return { category: "exempt", action: "none", text: "Director without a contract of employment (or the only one with one): exempt." };
  if (!i.dob) return { category: "outside", action: "none", text: "Add a date of birth to assess." };
  const age = ageOn(i.dob, i.payday), spa = statePensionAgeDate(i.dob);
  if (age < 16 || age >= 75) return { category: "outside", action: "none", text: "Under 16 or 75 and over: no duties." };
  const workingAge = age >= 22 && i.payday < spa;
  if (workingAge && i.earnings > trigger) {
    if (["enrolled", "opted-in", "joined", "opted-out"].includes(i.status)) return { category: "eligible", action: "none", text: "Eligible jobholder." };
    if (i.status === "postponed" && i.postponeUntil && i.payday <= i.postponeUntil) return { category: "eligible", action: "none", text: `Eligible jobholder: postponed until ${i.postponeUntil}.` };
    return { category: "eligible", action: "enrol", text: `Eligible jobholder (aged ${age}, earning over £${trigger}): enrol from this payday and write to them within six weeks.` };
  }
  if (i.earnings > lower) return { category: "non-eligible", action: ["enrolled", "opted-in"].includes(i.status) ? "none" : "tell-optin", text: "Non-eligible jobholder: can opt in, with employer contributions." };
  return { category: "entitled", action: ["joined"].includes(i.status) ? "none" : "tell-join", text: "Entitled worker: can ask to join a pension; no employer contribution needed." };
}

/** Whether pension is taken this payday: tracked people only once enrolled (and not after opting out); untracked people as set. */
export function pensionApplies(status: AeStatus, enrolDate: string, optOutDate: string, payday: string): boolean {
  if (status === "") return true;
  if (status === "opted-out" && optOutDate && payday >= optOutDate) return false;
  if (!["enrolled", "opted-in", "joined", "opted-out"].includes(status)) return false;
  return !enrolDate || payday >= enrolDate;
}
/** An opt-out within a month of being enrolled gets their contributions back (in the next pay run). */
export const optOutRefundable = (enrolDate: string, optOutDate: string) => !!enrolDate && !!optOutDate && t(optOutDate) <= new Date(Date.UTC(+enrolDate.slice(0, 4), +enrolDate.slice(5, 7), +enrolDate.slice(8, 10))).getTime();
