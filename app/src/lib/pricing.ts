// Pricing rules: a suggested fee worked out from a client's own figures (their custom fields).
//   fee = base + (driver x rate) ... + the band the client falls in + yes/no extras, then the minimum, then rounded.
// A rule only SUGGESTS. It never changes an agreed fee: adjusting still goes through Adjust fee, which records who and why.
// Rules are a setting (no list is added). Editing the pricing part of a rule bumps its version, so it is clear which version produced a suggestion.
import { CustomDef, Values } from "./customFields";
import { FeeLine, periodsPerYear } from "./fees";

const s = (v: unknown) => String(v ?? "").trim();
const num = (v: unknown): number => { const n = Number(typeof v === "string" ? v.replace(/,/g, "") : v); return Number.isFinite(n) ? n : 0; };
const money = (n: number) => Math.round(n * 100) / 100;

export const PRICING_KEY = "pricing-rules";
export type PricePeriod = "monthly" | "quarterly" | "annually" | "";
export type Driver = { fieldKey: string; /** £ for each `per` units */ rate: number; per: number };
export type Band = { /** up to and including this value; null = anything above the last limit */ upTo: number | null; fee: number };
export type Extra = { fieldKey: string; amount: number };
export type PricingRule = {
  id: string; serviceKey: string; name: string; period: PricePeriod; base: number;
  drivers: Driver[]; bandField: string; bands: Band[]; extras: Extra[];
  minimum: number; /** round to the nearest 0, 1, 5 or 10 pounds */ round: number;
  version: number; updated: string; updatedBy: string;
};
export const ROUNDINGS: [number, string][] = [[0, "Pence (no rounding)"], [1, "Nearest £1"], [5, "Nearest £5"], [10, "Nearest £10"]];

export function readRules(raw: unknown): PricingRule[] {
  if (!Array.isArray(raw)) return [];
  const out: PricingRule[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, any>;
    const id = s(o.id), serviceKey = s(o.serviceKey);
    if (!id || !serviceKey) continue;
    const period = (["monthly", "quarterly", "annually"] as const).find((p) => p === o.period) ?? "";
    out.push({
      id, serviceKey, name: s(o.name) || "Pricing rule", period, base: Math.max(0, num(o.base)),
      drivers: (Array.isArray(o.drivers) ? o.drivers : []).map((d: any) => ({ fieldKey: s(d?.fieldKey), rate: num(d?.rate), per: num(d?.per) > 0 ? num(d.per) : 1 })).filter((d: Driver) => d.fieldKey),
      bandField: s(o.bandField),
      bands: (Array.isArray(o.bands) ? o.bands : []).map((b: any) => ({ upTo: b?.upTo === null || b?.upTo === "" || b?.upTo === undefined ? null : num(b.upTo), fee: Math.max(0, num(b?.fee)) })),
      extras: (Array.isArray(o.extras) ? o.extras : []).map((e: any) => ({ fieldKey: s(e?.fieldKey), amount: num(e?.amount) })).filter((e: Extra) => e.fieldKey),
      minimum: Math.max(0, num(o.minimum)), round: [0, 1, 5, 10].includes(num(o.round)) ? num(o.round) : 0,
      version: Math.max(1, Math.floor(num(o.version)) || 1), updated: s(o.updated), updatedBy: s(o.updatedBy),
    });
  }
  return out;
}

/** What is wrong with a rule, in plain words. Empty means it can be saved. */
export function ruleProblems(r: PricingRule, defs: CustomDef[]): string[] {
  const out: string[] = [];
  const field = (k: string) => defs.find((d) => d.appliesTo === "client" && d.key === k);
  if (!r.serviceKey) out.push("Choose the service this rule prices.");
  if (!s(r.name)) out.push("Give the rule a name.");
  if (!(r.base > 0) && !r.drivers.length && !r.bands.length && !r.extras.length && !(r.minimum > 0)) out.push("The rule has no prices in it yet.");
  for (const d of r.drivers) {
    const f = field(d.fieldKey);
    if (!f) out.push(`"${d.fieldKey}" isn't one of your client fields.`);
    else if (f.type !== "number") out.push(`"${f.label}" has to be a number field to be priced per unit.`);
    if (!(d.rate >= 0)) out.push("A rate can't be negative.");
  }
  for (const e of r.extras) {
    const f = field(e.fieldKey);
    if (!f) out.push(`"${e.fieldKey}" isn't one of your client fields.`);
    else if (f.type !== "yesno") out.push(`"${f.label}" has to be a yes / no field to be an extra.`);
  }
  if (r.bands.length) {
    const f = field(r.bandField);
    if (!f) out.push("Choose the field the bands are based on.");
    else if (f.type !== "number") out.push(`"${f.label}" has to be a number field to use bands.`);
    const limits = r.bands.map((b) => b.upTo);
    if (limits.slice(0, -1).some((l) => l === null)) out.push("Only the last band can have no upper limit.");
    const nums = limits.filter((l): l is number => l !== null);
    if (nums.some((l, i) => i > 0 && l <= nums[i - 1])) out.push("Band limits have to go up from one band to the next.");
  }
  return out;
}

export type Step = { label: string; amount: number };
export type Suggestion = { fee: number; steps: Step[]; /** fields the client has no value for, so the figure is understated or unknown */ missing: string[]; complete: boolean };

const rounded = (n: number, to: number) => (to > 0 ? Math.round(n / to) * to : money(n));
const label = (defs: CustomDef[], k: string) => defs.find((d) => d.appliesTo === "client" && d.key === k)?.label || k;

/** The fee the rule suggests for one client, with the working. A field the client has no value for counts as nothing and is reported. */
export function suggest(rule: PricingRule, values: Values, defs: CustomDef[]): Suggestion {
  const steps: Step[] = [];
  const missing: string[] = [];
  let total = 0;
  if (rule.base > 0) { steps.push({ label: "Base fee", amount: money(rule.base) }); total += rule.base; }
  for (const d of rule.drivers) {
    const raw = s(values[d.fieldKey]);
    if (!raw) { missing.push(label(defs, d.fieldKey)); continue; }
    const units = num(raw);
    const amt = money((units / d.per) * d.rate);
    steps.push({ label: `${label(defs, d.fieldKey)}: ${units}${d.per !== 1 ? ` at £${d.rate} per ${d.per}` : ` at £${d.rate} each`}`, amount: amt });
    total += amt;
  }
  if (rule.bands.length) {
    const raw = s(values[rule.bandField]);
    if (!raw) missing.push(label(defs, rule.bandField));
    else {
      const v = num(raw);
      const hit = rule.bands.find((b) => b.upTo === null || v <= b.upTo) ?? rule.bands[rule.bands.length - 1];
      steps.push({ label: `${label(defs, rule.bandField)} ${v.toLocaleString("en-GB")}: ${hit.upTo === null ? "above the top band" : `band up to ${hit.upTo.toLocaleString("en-GB")}`}`, amount: money(hit.fee) });
      total += hit.fee;
    }
  }
  for (const e of rule.extras) {
    const v = s(values[e.fieldKey]);
    if (!v) { missing.push(label(defs, e.fieldKey)); continue; }
    if (v === "yes") { steps.push({ label: label(defs, e.fieldKey), amount: money(e.amount) }); total += e.amount; }
  }
  if (rule.minimum > 0 && total < rule.minimum) { steps.push({ label: `Raised to the minimum`, amount: money(rule.minimum - total) }); total = rule.minimum; }
  const fee = Math.max(0, rounded(total, rule.round));
  if (fee !== money(total) && rule.round > 0) steps.push({ label: `Rounded to the nearest £${rule.round}`, amount: money(fee - total) });
  return { fee, steps, missing: [...new Set(missing)], complete: !missing.length };
}

/** The suggestion in terms of another billing period (a rule priced monthly checked against a quarterly fee). Undefined when the periods can't be compared. */
export function inPeriod(fee: number, from: string, to: string): number | undefined {
  const a = periodsPerYear(from), b = periodsPerYear(to);
  if (!a && !b) return fee; // both one-off
  if (!a || !b) return undefined;
  return money((fee * a) / b);
}

export const activeRule = (rules: PricingRule[], serviceKey: string): PricingRule | undefined => rules.find((r) => r.serviceKey === serviceKey);

// ---- the pricing check

export type Check = {
  clientKey: string; serviceKey: string; ruleId: string; ruleVersion: number; period: string;
  /** what the rule says, per the fee line's own period; undefined when it can't be worked out */
  suggested?: number; agreed: number;
  /** suggested - agreed; positive = paying below the rule */
  gap?: number; gapYear?: number; steps: Step[]; missing: string[]; complete: boolean; reason?: string;
};

/** Checks one active fee line against its service's rule. Held, ended and included lines aren't checked. */
export function checkLine(line: FeeLine, rules: PricingRule[], values: Values, defs: CustomDef[]): Check | undefined {
  if (line.status !== "active") return undefined;
  const rule = activeRule(rules, line.serviceKey);
  if (!rule) return undefined;
  const sg = suggest(rule, values, defs);
  const base = { clientKey: line.clientKey, serviceKey: line.serviceKey, ruleId: rule.id, ruleVersion: rule.version, period: line.period, agreed: line.fee, steps: sg.steps, missing: sg.missing, complete: sg.complete };
  const fee = inPeriod(sg.fee, rule.period, line.period);
  if (fee === undefined) return { ...base, reason: `The rule is priced ${rule.period || "one-off"}, this fee is ${line.period || "one-off"}.` };
  if (!sg.complete && sg.fee === 0) return { ...base, reason: `No figures recorded for ${sg.missing.join(", ")}.` };
  const gap = money(fee - line.fee);
  const per = periodsPerYear(line.period) || 1;
  return { ...base, suggested: fee, gap, gapYear: money(gap * per) };
}

export type CheckRow = Check & { clientName: string };
/** Every active fee line that has a rule, biggest shortfall first. `values(clientKey)` gives that client's custom values. */
export function checkAll(lines: FeeLine[], rules: PricingRule[], values: (clientKey: string) => Values, defs: CustomDef[], names: (clientKey: string) => string): CheckRow[] {
  const out: CheckRow[] = [];
  for (const l of lines) {
    const c = checkLine(l, rules, values(l.clientKey), defs);
    if (c) out.push({ ...c, clientName: names(l.clientKey) });
  }
  return out.sort((a, b) => (b.gapYear ?? -Infinity) - (a.gapYear ?? -Infinity) || a.clientName.localeCompare(b.clientName));
}
/** The list for a fee review: lines paying below the rule by at least `minYear` pounds a year. */
export const belowRule = (rows: CheckRow[], minYear: number): CheckRow[] => rows.filter((r) => r.gapYear !== undefined && r.gapYear >= Math.max(0.01, minYear));

export function checkCsv(rows: CheckRow[], svcName: (k: string) => string): string {
  const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = ["Client", "Service", "Charged", "Agreed fee", "Rule suggests", "Gap each period", "Gap a year", "Rule version", "Missing figures", "Note"];
  return [head, ...rows.map((r) => [r.clientName, svcName(r.serviceKey), r.period || "one-off", r.agreed, r.suggested ?? "", r.gap ?? "", r.gapYear ?? "", r.ruleVersion, r.missing.join("; "), r.reason ?? ""])].map((r) => r.map(q).join(",")).join("\r\n");
}

// ---- keeping the rules

const pricingPart = (r: PricingRule) => JSON.stringify([r.serviceKey, r.period, r.base, r.drivers, r.bandField, r.bands, r.extras, r.minimum, r.round]);
/** Adds or replaces a rule. Changing what it charges bumps the version; renaming it doesn't. One rule per service. */
export function saveRule(rules: PricingRule[], r: PricingRule, defs: CustomDef[], who: string, now: string): { rules: PricingRule[]; problems: string[] } {
  const problems = ruleProblems(r, defs);
  const clash = rules.find((x) => x.serviceKey === r.serviceKey && x.id !== r.id);
  if (clash) problems.push(`There is already a rule for that service ("${clash.name}"). Edit that one.`);
  if (problems.length) return { rules, problems };
  const before = rules.find((x) => x.id === r.id);
  const version = before ? (pricingPart(before) === pricingPart(r) ? before.version : before.version + 1) : 1;
  const next = { ...r, version, updated: now, updatedBy: who };
  return { rules: before ? rules.map((x) => (x.id === r.id ? next : x)) : [...rules, next], problems: [] };
}
export const removeRule = (rules: PricingRule[], id: string): PricingRule[] => rules.filter((r) => r.id !== id);
export const blankRule = (id: string, serviceKey = ""): PricingRule => ({ id, serviceKey, name: "", period: "monthly", base: 0, drivers: [], bandField: "", bands: [], extras: [], minimum: 0, round: 5, version: 1, updated: "", updatedBy: "" });
