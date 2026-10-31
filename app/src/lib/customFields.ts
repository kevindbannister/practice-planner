// Your own fields on clients and jobs: monthly transactions, employees, bookkeeping standard, whatever the practice wants to record.
// The definitions are a setting; the values live in their own list (one row per client or job), so no existing list changes.
// Values are kept as text and read according to the field's type. They can be filtered on, exported and used as merge fields.
import { Row } from "./schema";

export type FieldType = "number" | "text" | "yesno" | "choice" | "date";
export const FIELD_TYPE_LABEL: Record<FieldType, string> = { number: "Number", text: "Short text", yesno: "Yes / no", choice: "Choose one", date: "Date" };
export type AppliesTo = "client" | "job";
export type CustomDef = { key: string; label: string; type: FieldType; appliesTo: AppliesTo; options: string[]; help: string };
export const CUSTOM_FIELDS_KEY = "custom-fields";
export const MAX_FIELDS = 40;

const s = (v: unknown) => String(v ?? "").trim();
export const cleanKey = (label: string): string => s(label).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

export function readDefs(raw: unknown): CustomDef[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: CustomDef[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const label = s(o.label).slice(0, 80);
    const key = cleanKey(s(o.key) || label);
    const type = (["number", "text", "yesno", "choice", "date"] as const).find((t) => t === o.type);
    const appliesTo: AppliesTo = o.appliesTo === "job" ? "job" : "client";
    if (!label || !key || !type || seen.has(`${appliesTo}.${key}`)) continue;
    seen.add(`${appliesTo}.${key}`);
    const options = type === "choice" && Array.isArray(o.options) ? [...new Set(o.options.map(s).filter(Boolean))].slice(0, 30) : [];
    out.push({ key, label, type, appliesTo, options, help: s(o.help).slice(0, 200) });
  }
  return out.slice(0, MAX_FIELDS);
}

export function addDef(defs: CustomDef[], d: Omit<CustomDef, "key"> & { key?: string }): { defs: CustomDef[]; problem?: string } {
  const label = s(d.label);
  const key = cleanKey(d.key || label);
  if (!label) return { defs, problem: "Give the field a name." };
  if (!key) return { defs, problem: "The name needs some letters or numbers." };
  if (defs.some((x) => x.appliesTo === d.appliesTo && x.key === key)) return { defs, problem: `There is already a ${d.appliesTo} field called "${label}".` };
  if (defs.length >= MAX_FIELDS) return { defs, problem: `That is the most fields (${MAX_FIELDS}).` };
  if (d.type === "choice" && new Set(d.options.map(s).filter(Boolean)).size < 2) return { defs, problem: "A choice field needs at least two choices." };
  return { defs: [...defs, { key, label, type: d.type, appliesTo: d.appliesTo, options: d.type === "choice" ? [...new Set(d.options.map(s).filter(Boolean))] : [], help: s(d.help) }] };
}
/** Removing a definition hides the field everywhere; the stored values stay in case it is added back with the same name. */
export const removeDef = (defs: CustomDef[], appliesTo: AppliesTo, key: string): CustomDef[] => defs.filter((d) => !(d.appliesTo === appliesTo && d.key === key));

// ---- values

export type Values = Record<string, string>;
/** The stored values for one client or job, from the CustomValues list. */
export function valuesOf(rows: Row[], kind: AppliesTo, entityKey: string): Values {
  const r = rows.find((x) => s(x.Kind) === kind && s(x.EntityKey) === entityKey);
  if (!r) return {};
  try {
    const o = JSON.parse(s(r.Json) || "{}") as Record<string, unknown>;
    return Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === "string" || typeof v === "number").map(([k, v]) => [k, String(v)]));
  } catch { return {}; }
}

/** What is wrong with a typed value, if anything. An empty value is always fine (it clears the field). */
export function valueProblem(d: CustomDef, text: string): string {
  const v = s(text);
  if (!v) return "";
  if (d.type === "number" && !Number.isFinite(Number(v.replace(/,/g, "")))) return `"${d.label}" should be a number.`;
  if (d.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return `"${d.label}" should be a date.`;
  if (d.type === "yesno" && v !== "yes" && v !== "no") return `"${d.label}" should be yes or no.`;
  if (d.type === "choice" && !d.options.includes(v)) return `"${d.label}" isn't one of the choices.`;
  return "";
}
const normal = (d: CustomDef, text: string) => (d.type === "number" ? String(Number(s(text).replace(/,/g, ""))) : s(text));

/** The row to save for a client or job after a change. Unknown or empty values are dropped, so a cleared field leaves nothing behind. */
export function saveValues(defs: CustomDef[], kind: AppliesTo, entityKey: string, clientKey: string, current: Values, patch: Values, existing: Row | undefined, newKey: (p: string) => string, now: string): { row: Row; isNew: boolean; problem?: string } {
  const mine = defs.filter((d) => d.appliesTo === kind);
  const merged: Values = { ...current, ...patch };
  const out: Values = {};
  for (const d of mine) {
    const v = s(merged[d.key]);
    const bad = valueProblem(d, v);
    if (bad) return { row: {}, isNew: !existing, problem: bad };
    if (v) out[d.key] = normal(d, v);
  }
  // values for fields that have been removed are kept as they were
  for (const [k, v] of Object.entries(current)) if (!mine.some((d) => d.key === k) && s(v)) out[k] = v;
  const base: Row = { Json: JSON.stringify(out), Updated: now };
  return existing ? { row: base, isNew: false } : { row: { Key: newKey("CV"), PracticeId: "", Kind: kind, EntityKey: entityKey, ClientKey: clientKey, ...base }, isNew: true };
}

/** Merge fields: {{client.custom.transactions}} and {{job.custom.x}}. Every defined field is present, blank where there is no value, so a missing one is reported, not "unknown". */
export function mergeValues(defs: CustomDef[], kind: AppliesTo, values: Values): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of defs.filter((x) => x.appliesTo === kind)) {
    const v = s(values[d.key]);
    out[`${kind}.custom.${d.key}`] = d.type === "yesno" ? (v === "yes" ? "Yes" : v === "no" ? "No" : "") : v;
  }
  return out;
}

export const displayValue = (d: CustomDef, v: string): string => (d.type === "yesno" ? (v === "yes" ? "Yes" : v === "no" ? "No" : "") : v);

// ---- filtering the client list

export type CustomTest = { key: string; /** number: min/max; yesno: yes/no; choice: the choice; text: contains; date: from/to */ min?: number | null; max?: number | null; is?: string; from?: string; to?: string };
export const hasTest = (t: CustomTest) => (t.min != null && !Number.isNaN(t.min)) || (t.max != null && !Number.isNaN(t.max)) || !!s(t.is) || !!s(t.from) || !!s(t.to);

/** Whether a client's custom values pass every test. A client with no value for a tested field doesn't match. */
export function matchCustom(defs: CustomDef[], tests: CustomTest[], values: Values): boolean {
  for (const t of tests.filter(hasTest)) {
    const d = defs.find((x) => x.appliesTo === "client" && x.key === t.key);
    if (!d) continue; // a field that has since been removed no longer filters anything
    const v = s(values[t.key]);
    if (!v) return false;
    if (d.type === "number") { const x = Number(v); if (t.min != null && x < t.min) return false; if (t.max != null && x > t.max) return false; }
    else if (d.type === "date") { if (t.from && v < t.from) return false; if (t.to && v > t.to) return false; }
    else if (d.type === "text") { if (t.is && !v.toLowerCase().includes(s(t.is).toLowerCase())) return false; }
    else if (t.is && v !== t.is) return false;
  }
  return true;
}
