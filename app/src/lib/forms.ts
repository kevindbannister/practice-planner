// Forms and information requests, phase 1 (staff side). A form template is an ordered list of
// questions; a request is a template put to one client, with the questions as they were when it
// was made and the answers. Questions can start from a client field, and the practice can choose to
// write chosen answers back to the client record when a request is completed.
import { Row } from "./schema";

export type FieldType = "text" | "longtext" | "yesno" | "choice" | "date" | "number" | "tick";
export const FIELD_TYPES: { key: FieldType; label: string }[] = [
  { key: "text", label: "Short answer" }, { key: "longtext", label: "Long answer" }, { key: "yesno", label: "Yes / no" }, { key: "choice", label: "Choose one" },
  { key: "date", label: "Date" }, { key: "number", label: "Number" }, { key: "tick", label: "Declaration (tick)" },
];
export type Field = { id: string; label: string; type: FieldType; required: boolean; options?: string[]; help?: string; prefill?: string; writeBack?: boolean };
export type Answers = Record<string, string>;

/** Client fields a question can start from, and (the ones marked) be written back to. */
export const PREFILLS: { key: string; label: string; writable: boolean }[] = [
  { key: "Title", label: "Client name", writable: false }, { key: "TradingName", label: "Trading name", writable: true }, { key: "Email", label: "Email", writable: true }, { key: "Mobile", label: "Mobile", writable: true },
  { key: "Phone", label: "Phone", writable: true }, { key: "HomeAddress", label: "Home address", writable: true }, { key: "TradingAddress", label: "Trading address", writable: true }, { key: "CorrespondenceAddress", label: "Correspondence address", writable: true },
  { key: "DateOfBirth", label: "Date of birth", writable: true }, { key: "UTR", label: "Self Assessment UTR", writable: true }, { key: "NINumber", label: "National Insurance number", writable: true }, { key: "CTUTR", label: "Company UTR", writable: true },
  { key: "VATNumber", label: "VAT number", writable: true }, { key: "PAYERef", label: "PAYE reference", writable: true }, { key: "AccountsOfficeRef", label: "Accounts Office reference", writable: true },
  { key: "BusinessActivity", label: "Nature of business", writable: true }, { key: "Website", label: "Website", writable: true }, { key: "YearEnd", label: "Year end", writable: true },
];
export const isWritable = (key?: string) => !!PREFILLS.find((p) => p.key === key && p.writable);

export type Template = { key: string; name: string; category: string; description: string; version: number; archived: boolean; fields: Field[] };
const s = (v: unknown) => String(v ?? "");
export function readTemplate(r: Row): Template {
  let fields: Field[] = [];
  try { const a = JSON.parse(s(r.Fields) || "[]"); if (Array.isArray(a)) fields = a.filter((f) => f && f.label && f.type).map(cleanField); } catch { /* none */ }
  return { key: s(r.Key), name: s(r.Title) || s(r.Name) || "Untitled form", category: s(r.Category) || "General", description: s(r.Description), version: Number(r.Version) || 1, archived: r.Archived === true || r.Archived === "true", fields };
}
export function cleanField(f: Partial<Field>): Field {
  const type = FIELD_TYPES.some((t) => t.key === f.type) ? (f.type as FieldType) : "text";
  return { id: s(f.id) || `f${Math.random().toString(36).slice(2, 8)}`, label: s(f.label).trim(), type, required: !!f.required, ...(type === "choice" ? { options: (f.options || []).map((o) => s(o).trim()).filter(Boolean) } : {}), ...(f.help ? { help: s(f.help) } : {}), ...(f.prefill ? { prefill: s(f.prefill) } : {}), ...(f.writeBack && isWritable(f.prefill) ? { writeBack: true } : {}) };
}

export function templateProblems(name: string, fields: Field[]): string[] {
  const out: string[] = [];
  if (!name.trim()) out.push("Give the form a name.");
  if (!fields.length) out.push("Add at least one question.");
  fields.forEach((f, i) => {
    if (!f.label.trim()) out.push(`Question ${i + 1} has no wording.`);
    if (f.type === "choice" && (f.options || []).filter((o) => o.trim()).length < 2) out.push(`Question ${i + 1} needs at least two choices.`);
  });
  return out;
}

/** Answers a new request starts with: the client's own details where a question names one. */
export function prefilled(fields: Field[], client: Row): Answers {
  const a: Answers = {};
  for (const f of fields) {
    if (f.prefill && s(client[f.prefill]).trim()) a[f.id] = s(client[f.prefill]).trim();
  }
  return a;
}

export function missing(fields: Field[], answers: Answers): Field[] {
  return fields.filter((f) => f.required && (f.type === "tick" ? answers[f.id] !== "yes" : !s(answers[f.id]).trim()));
}
export function answerProblems(fields: Field[], answers: Answers): string[] {
  const out: string[] = [];
  for (const f of fields) {
    const v = s(answers[f.id]).trim();
    if (!v) continue;
    if (f.type === "number" && !Number.isFinite(Number(v.replace(/,/g, "")))) out.push(`"${f.label}" should be a number.`);
    if (f.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) out.push(`"${f.label}" should be a date.`);
    if (f.type === "choice" && f.options && !f.options.includes(v)) out.push(`"${f.label}" isn't one of the choices.`);
  }
  return out;
}

export type Request = { key: string; clientKey: string; templateKey: string; title: string; status: "open" | "complete" | "cancelled"; fields: Field[]; answers: Answers; due: string; createdAt: string; createdBy: string; completedOn: string; completedBy: string; written: string[] };
export function readRequest(r: Row): Request {
  const parse = <T,>(v: unknown, d: T): T => { try { return JSON.parse(s(v)) ?? d; } catch { return d; } };
  const st = s(r.Status);
  return { key: s(r.Key), clientKey: s(r.ClientKey), templateKey: s(r.TemplateKey), title: s(r.Title), status: st === "complete" || st === "cancelled" ? st : "open", fields: parse<Field[]>(r.Fields, []).map(cleanField), answers: parse<Answers>(r.Answers, {}), due: s(r.DueDate).slice(0, 10), createdAt: s(r.Created), createdBy: s(r.CreatedBy), completedOn: s(r.CompletedOn), completedBy: s(r.CompletedBy), written: parse<string[]>(r.Written, []) };
}

/** What completing a request would change on the client record: answers to questions marked "update the client record" that differ from what is there. */
export function writeBack(fields: Field[], answers: Answers, client: Row): { field: Field; client: string; from: string; to: string }[] {
  const out: { field: Field; client: string; from: string; to: string }[] = [];
  for (const f of fields) {
    if (!f.writeBack || !f.prefill || !isWritable(f.prefill)) continue;
    const to = s(answers[f.id]).trim();
    if (!to) continue;
    const from = s(client[f.prefill]).trim();
    if (to !== from) out.push({ field: f, client: f.prefill, from, to });
  }
  return out;
}

export const STATUS_LABEL = { open: "Waiting for answers", complete: "Completed", cancelled: "Cancelled" } as const;
export const STATUS_CHIP = { open: "amber", complete: "green", cancelled: "" } as const;

const f = (id: string, label: string, type: FieldType, o: Partial<Field> = {}): Field => ({ id, label, type, required: false, ...o });
export const STARTERS: { name: string; category: string; description: string; fields: Field[] }[] = [
  { name: "New client questionnaire", category: "Onboarding", description: "The basics we need to start acting for a new client.", fields: [
    f("n1", "Full name", "text", { required: true, prefill: "Title" }), f("n2", "Date of birth", "date", { prefill: "DateOfBirth", writeBack: true }), f("n3", "Email", "text", { required: true, prefill: "Email", writeBack: true }),
    f("n4", "Mobile", "text", { prefill: "Mobile", writeBack: true }), f("n5", "Home address", "longtext", { required: true, prefill: "HomeAddress", writeBack: true }), f("n6", "National Insurance number", "text", { prefill: "NINumber", writeBack: true }),
    f("n7", "Self Assessment UTR (if you have one)", "text", { prefill: "UTR", writeBack: true }), f("n8", "Who was your previous accountant, if any?", "text"), f("n9", "Are you VAT registered?", "yesno", { required: true }),
    f("n10", "What does the business do?", "longtext", { prefill: "BusinessActivity", writeBack: true }), f("n11", "I confirm the information given is correct", "tick", { required: true }),
  ] },
  { name: "Annual information request: company", category: "Annual", description: "What we ask a company for each year before preparing accounts.", fields: [
    f("c1", "Have there been any changes to directors or shareholders this year?", "yesno", { required: true }), f("c2", "Any new loans, finance agreements or assets bought?", "longtext"),
    f("c3", "Were any dividends paid? If so, how much and when?", "longtext"), f("c4", "Number of employees at the year end", "number"), f("c5", "Any changes to the business (new premises, products, trading names)?", "longtext"),
    f("c6", "Do you have all bank statements for the year to give us?", "yesno", { required: true }), f("c7", "Anything else we should know?", "longtext"),
  ] },
  { name: "Annual information request: individual", category: "Annual", description: "What we ask an individual for each year before the tax return.", fields: [
    f("i1", "Did you receive income from employment, self-employment, property or investments?", "longtext", { required: true }), f("i2", "Any new bank, savings or investment accounts?", "longtext"),
    f("i3", "Did you sell any assets, shares or property?", "yesno", { required: true }), f("i4", "Pension contributions or charitable gifts made", "longtext"), f("i5", "Has your address or family situation changed?", "yesno"),
    f("i6", "Anything else we should know?", "longtext"),
  ] },
];
