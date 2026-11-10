// Rates and the value of time. All money here is whole pence (a rate is pence per hour), so nothing is added up as a decimal and nothing is
// rounded more than once: the value of an entry is rounded to the penny once, and totals are sums of those. All figures are net of VAT.
//
// Two kinds of rate: a CHARGE rate (what an hour is worth to the client) and a COST rate (what an hour costs the practice). Both are effective-dated:
// a new rate starts on a date and the old one stays for the entries before it, so a change never rewrites history.
//
// WHICH RATE APPLIES (documented, and the same everywhere). A rate can say who it is for (user), a role, a service, an activity, a client and a job; a
// field left empty means "any". A rate applies to an entry if every field it sets matches and the entry's work date falls in its dates. If several
// apply, the most specific wins, where a field counts for different weights: job 32, client 16, user 8, activity 4, service 2, role 1. (So a rate for one
// job beats one for the client, which beats one for the person, then the activity, the service and the role. The weights are powers of two, so a
// more important field always outweighs all the less important ones together.) If two are equally specific, the one that started later wins.
// If none applies there is no rate: the value is nothing and the screens say so, rather than guessing a figure.
import { Row } from "./schema";

const s = (v: unknown) => String(v ?? "").trim();

export type RateKind = "charge" | "cost";
export type Rate = {
  key: string; kind: RateKind; pence: number; from: string; to: string;
  userKey: string; role: string; serviceKey: string; activityKey: string; clientKey: string; jobKey: string; note: string;
};
export type RateContext = { date: string; userKey?: string; role?: string; serviceKey?: string; activityKey?: string; clientKey?: string; jobKey?: string };

export const WEIGHT = { jobKey: 32, clientKey: 16, userKey: 8, activityKey: 4, serviceKey: 2, role: 1 } as const;
export const RATE_SETTING = "time.rates";
export const poundsToPence = (p: number): number => Math.round((Number(p) || 0) * 100);
export const penceToPounds = (p: number): string => (p < 0 ? "-" : "") + "£" + (Math.abs(p) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The value in pence of `minutes` at `pence` an hour, rounded to the penny once. */
export const valueOf = (minutes: number, penceAnHour: number): number => Math.round((Math.max(0, minutes) * Math.max(0, penceAnHour)) / 60);

export function readRates(saved: unknown): Rate[] {
  if (!Array.isArray(saved)) return [];
  const out: Rate[] = [];
  for (const r of saved) {
    const x = r as Record<string, unknown>;
    const pence = Math.round(Number(x?.pence));
    if (!(pence >= 0) || !["charge", "cost"].includes(s(x.kind)) || !/^\d{4}-\d{2}-\d{2}$/.test(s(x.from))) continue;
    out.push({ key: s(x.key) || `R-${out.length + 1}`, kind: s(x.kind) as RateKind, pence, from: s(x.from), to: /^\d{4}-\d{2}-\d{2}$/.test(s(x.to)) ? s(x.to) : "", userKey: s(x.userKey), role: s(x.role), serviceKey: s(x.serviceKey), activityKey: s(x.activityKey), clientKey: s(x.clientKey), jobKey: s(x.jobKey), note: s(x.note) });
  }
  return out;
}

export function matches(r: Rate, c: RateContext): boolean {
  if (r.from > c.date || (r.to && r.to < c.date)) return false;
  return (!r.userKey || r.userKey === c.userKey) && (!r.role || r.role === c.role) && (!r.serviceKey || r.serviceKey === c.serviceKey)
    && (!r.activityKey || r.activityKey === c.activityKey) && (!r.clientKey || r.clientKey === c.clientKey) && (!r.jobKey || r.jobKey === c.jobKey);
}
export const specificity = (r: Rate): number =>
  (r.jobKey ? WEIGHT.jobKey : 0) + (r.clientKey ? WEIGHT.clientKey : 0) + (r.userKey ? WEIGHT.userKey : 0) + (r.activityKey ? WEIGHT.activityKey : 0) + (r.serviceKey ? WEIGHT.serviceKey : 0) + (r.role ? WEIGHT.role : 0);

/** The rate that applies, or undefined. Most specific first; a tie goes to the one that started later; a further tie to the key, so the answer is never random. */
export function resolveRate(rates: Rate[], kind: RateKind, c: RateContext): Rate | undefined {
  const hits = rates.filter((r) => r.kind === kind && matches(r, c));
  hits.sort((a, b) => specificity(b) - specificity(a) || b.from.localeCompare(a.from) || a.key.localeCompare(b.key));
  return hits[0];
}

/** Problems with a rate list: two equally specific rates that overlap in time are ambiguous (the later start wins, but the person should know). */
export function rateProblems(rates: Rate[]): string[] {
  const out: string[] = [];
  for (const r of rates) if (r.to && r.to < r.from) out.push(`Rate ${r.key} ends before it starts.`);
  for (let i = 0; i < rates.length; i++) for (let j = i + 1; j < rates.length; j++) {
    const a = rates[i], b = rates[j];
    if (a.kind !== b.kind || specificity(a) !== specificity(b) || a.userKey !== b.userKey || a.role !== b.role || a.serviceKey !== b.serviceKey || a.activityKey !== b.activityKey || a.clientKey !== b.clientKey || a.jobKey !== b.jobKey) continue;
    if (a.from === b.from) out.push(`Two ${a.kind} rates for the same people and work start on ${a.from}.`);
  }
  return out;
}

/** Starting a new rate ends the open one it replaces (same scope) the day before, so the history is kept and nothing overlaps. */
export function addRate(rates: Rate[], next: Omit<Rate, "key" | "to"> & { key?: string }): Rate[] {
  const prev = (d: string) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() - 1); return t.toISOString().slice(0, 10); };
  const same = (r: Rate) => r.kind === next.kind && r.userKey === next.userKey && r.role === next.role && r.serviceKey === next.serviceKey && r.activityKey === next.activityKey && r.clientKey === next.clientKey && r.jobKey === next.jobKey;
  const closed = rates.map((r) => (same(r) && !r.to && r.from < next.from ? { ...r, to: prev(next.from) } : r));
  return [...closed, { ...next, key: next.key || `R-${Date.now().toString(36)}-${closed.length}`, to: "" }];
}

// ------------------------------------------------------------------ valuing one piece of time

export type Valued = { minutes: number; chargePence: number; costPence: number; chargeRate?: Rate; costRate?: Rate; missingCharge: boolean; missingCost: boolean };
/** What a piece of time is worth (at the charge rate) and what it cost. `billable` false means no charge value; a typed `chargeOverride` (pence) replaces the rate. */
export function valueTime(rates: Rate[], c: RateContext, minutes: number, billable: boolean, chargeOverride?: number): Valued {
  const cr = billable ? resolveRate(rates, "charge", c) : undefined;
  const co = resolveRate(rates, "cost", c);
  const hasOverride = billable && chargeOverride !== undefined && chargeOverride >= 0;
  return {
    minutes, chargeRate: cr, costRate: co,
    chargePence: hasOverride ? Math.round(chargeOverride!) : cr ? valueOf(minutes, cr.pence) : 0,
    costPence: co ? valueOf(minutes, co.pence) : 0,
    missingCharge: billable && !hasOverride && !cr, missingCost: !co,
  };
}

// ------------------------------------------------------------------ fixed fees

export type FixedFee = { feePence: number; minutes: number; costPence: number; contributionPence: number; marginPct: number | null; effectivePencePerHour: number | null; missingCost: number };
/** A fixed fee against the time spent on it: contribution is the fee less the labour cost; margin is that as a share of the fee; the effective rate is fee per hour worked. */
export function fixedFeeResult(feePence: number, items: Valued[]): FixedFee {
  const minutes = items.reduce((t, x) => t + x.minutes, 0);
  const costPence = items.reduce((t, x) => t + x.costPence, 0);
  return {
    feePence, minutes, costPence, contributionPence: feePence - costPence, missingCost: items.filter((x) => x.missingCost).length,
    marginPct: feePence > 0 ? Math.round(((feePence - costPence) / feePence) * 1000) / 10 : null,
    effectivePencePerHour: minutes > 0 ? Math.round((feePence * 60) / minutes) : null,
  };
}
export const asRows = (rates: Rate[]): Row[] => rates.map((r) => ({ ...r }));
