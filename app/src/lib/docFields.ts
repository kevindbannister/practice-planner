// Merge fields: {{client.name}}, {{practice.phone}}, {{job.period}}, {{doc.date}} and the practice's
// own custom fields. Each field says where its value comes from; documents hold only the token, and
// the values are filled in when a document is made, so one template serves every client.
import { Branding, displayName } from "./docBranding";
import { DocContent, Run, allRuns, mapRuns, tidyRuns } from "./docModel";
import { addressLines, longDate, personLine, salutationFor } from "./comms";
import { Client, Job } from "./domain";

export type FieldContext = {
  client?: Client;
  job?: Job;
  serviceName?: string;
  branding: Branding;
  today: string;
  reference: string;
};
export type FieldDef = { key: string; label: string; group: "Client" | "Practice" | "Job" | "General" | "Custom"; get: (c: FieldContext) => string };

const isCompany = (c?: Client) => !!c && (c.Kind === "Ltd" || c.Kind === "LLP" || !!c.CompanyNumber);
const lines = (s: unknown) => String(s || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join("\n");
const dateOf = (iso?: string) => (iso ? longDate(iso) : "");

export const BUILT_IN_FIELDS: FieldDef[] = [
  { key: "client.name", label: "Client name", group: "Client", get: (c) => String(c.client?.Title || "") },
  { key: "client.trading_name", label: "Trading name", group: "Client", get: (c) => String(c.client?.Title || "") },
  { key: "client.company_name", label: "Company name", group: "Client", get: (c) => (isCompany(c.client) ? String(c.client?.Title || "") : "") },
  { key: "client.company_number", label: "Company registration number", group: "Client", get: (c) => String(c.client?.CompanyNumber || "") },
  { key: "client.registered_address", label: "Registered address", group: "Client", get: (c) => lines(c.client?.RegisteredOffice) },
  { key: "client.correspondence_address", label: "Correspondence address", group: "Client", get: (c) => lines(c.client?.TradingAddress || c.client?.HomeAddress || c.client?.RegisteredOffice) },
  { key: "client.address_block", label: "Address block (name, company and address)", group: "Client", get: (c) => (c.client ? addressLines(c.client).join("\n") : "") },
  { key: "client.contact_name", label: "Primary contact", group: "Client", get: (c) => (c.client ? personLine(c.client) : "") },
  { key: "client.salutation", label: "Salutation (Dear …,)", group: "Client", get: (c) => (c.client ? salutationFor(c.client) : "") },
  { key: "client.contact_email", label: "Contact email", group: "Client", get: (c) => String(c.client?.Email || "") },
  { key: "practice.name", label: "Practice name", group: "Practice", get: (c) => displayName(c.branding) },
  { key: "practice.address", label: "Practice address", group: "Practice", get: (c) => lines(c.branding.correspondenceAddress || c.branding.registeredAddress) },
  { key: "practice.registered_address", label: "Practice registered address", group: "Practice", get: (c) => lines(c.branding.registeredAddress) },
  { key: "practice.phone", label: "Practice telephone", group: "Practice", get: (c) => c.branding.phone },
  { key: "practice.email", label: "Practice email", group: "Practice", get: (c) => c.branding.email },
  { key: "practice.website", label: "Practice website", group: "Practice", get: (c) => c.branding.website },
  { key: "practice.registration", label: "Practice registration details", group: "Practice", get: (c) => c.branding.registration },
  { key: "practice.signatory_name", label: "Signatory name", group: "Practice", get: (c) => c.branding.signatoryName },
  { key: "practice.signatory_title", label: "Signatory job title", group: "Practice", get: (c) => c.branding.signatoryTitle },
  { key: "job.type", label: "Job type", group: "Job", get: (c) => c.serviceName || "" },
  { key: "job.period", label: "Accounting period", group: "Job", get: (c) => (c.job?.PeriodEnd ? `the year ended ${dateOf(String(c.job.PeriodEnd))}` : "") },
  { key: "job.year_end", label: "Year-end date", group: "Job", get: (c) => dateOf(c.job?.PeriodEnd ? String(c.job.PeriodEnd) : "") },
  { key: "job.deadline", label: "Deadline", group: "Job", get: (c) => dateOf(c.job?.Deadline ? String(c.job.Deadline) : "") },
  { key: "job.statutory_deadline", label: "Statutory deadline", group: "Job", get: (c) => dateOf(String(c.job?.CHDeadline || c.job?.Deadline || "")) },
  { key: "job.reference", label: "Job reference", group: "Job", get: (c) => String(c.job?.Key || "") },
  { key: "doc.date", label: "Current date", group: "General", get: (c) => longDate(c.today) },
  { key: "doc.reference", label: "Document reference", group: "General", get: (c) => c.reference },
];

/** Every field available: the built-in ones and the practice's own custom fields. */
export function fieldsFor(branding: Branding): FieldDef[] {
  const custom: FieldDef[] = branding.customFields.map((f) => ({ key: `custom.${f.key}`, label: f.label || f.key, group: "Custom", get: () => f.value }));
  return [...BUILT_IN_FIELDS, ...custom];
}

/** The value of every field for a client, job and practice (empty text where it isn't known). */
export function resolveValues(ctx: FieldContext): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fieldsFor(ctx.branding)) out[f.key] = f.get(ctx);
  return out;
}

export const TOKEN = /\{\{\s*([a-z0-9_.]+)\s*\}\}/gi;
export const tokensIn = (text: string) => [...text.matchAll(TOKEN)].map((m) => m[1].toLowerCase());

/** The merge fields a document uses, in the order they first appear. */
export function fieldsUsed(content: DocContent, extraText: string[] = []): string[] {
  const seen: string[] = [];
  for (const t of [...allRuns(content).map((r) => r.t), ...extraText]) for (const k of tokensIn(t)) if (!seen.includes(k)) seen.push(k);
  return seen;
}

export type FieldCheck = { missing: string[]; unknown: string[] };
/** Fields the document uses that have no value (missing) or that don't exist (unknown): shown as warnings before a document is made. */
export function checkFields(used: string[], values: Record<string, string>): FieldCheck {
  const missing: string[] = [], unknown: string[] = [];
  for (const k of used) {
    if (!(k in values)) unknown.push(k);
    else if (!values[k].trim()) missing.push(k);
  }
  return { missing, unknown };
}

/** Text with the fields that have values filled in; ones without are left as {{field}} so they can't go unnoticed. */
export function fillText(text: string, values: Record<string, string>): string {
  return text.replace(TOKEN, (m, k: string) => (values[k.toLowerCase()]?.trim() ? values[k.toLowerCase()] : m));
}
export function fillContent(content: DocContent, values: Record<string, string>): DocContent {
  return mapRuns(content, (runs) => tidyRuns(runs.map((r): Run => ({ ...r, t: fillText(r.t, values) }))));
}

/** The label to show for a field key. */
export const labelOf = (key: string, branding: Branding) => fieldsFor(branding).find((f) => f.key === key)?.label || key;
