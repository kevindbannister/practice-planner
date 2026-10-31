// Sending one email, or one form, to many clients at once. Pure logic: it works out what each client would get and
// who is left out (no email address, already sent, already has the form open), so the screen can show the numbers
// before anything is made and a second press does nothing.
import { Branding } from "./docBranding";
import { TOKEN, resolveValues, tokensIn } from "./docFields";
import { emailGreeting } from "./comms";
import { Client } from "./domain";
import { Template, cleanField, prefilled } from "./forms";
import { Row } from "./schema";

const s = (v: unknown) => String(v ?? "").trim();

/** Merge fields for one client: everything in docFields, plus a friendly greeting and the first name. */
export function bulkValues(client: Client, branding: Branding, today: string): Record<string, string> {
  const v = resolveValues({ client, branding, today, reference: "" });
  v["client.greeting"] = emailGreeting(client);
  v["client.first_name"] = s(client.ContactPreferred || client.ContactFirst);
  return v;
}

/** Fields written in the message that nobody knows about (typos such as {{client.nmae}}). */
export function unknownFields(text: string, known: Record<string, string>): string[] {
  return [...new Set(tokensIn(text))].filter((k) => !(k in known));
}

const fill = (text: string, values: Record<string, string>) => text.replace(TOKEN, (m, k: string) => (s(values[k.toLowerCase()]) ? values[k.toLowerCase()] : m));

export type EmailDraft = { client: Client; to: string; subject: string; body: string; /** merge fields this client has no value for */ blanks: string[] };
export type EmailPlan = {
  drafts: EmailDraft[];
  noEmail: Client[];
  already: Client[];
  /** Reasons nothing can be made yet. */
  problems: string[];
};

/** The email for each client. Clients with no address, or who already have a drafted email with this subject, are left out. */
export function planEmails(clients: Client[], subject: string, body: string, branding: Branding, today: string, comms: Row[]): EmailPlan {
  const problems: string[] = [];
  if (!subject.trim()) problems.push("Give the email a subject.");
  if (!body.trim()) problems.push("Write the message.");
  const sample = clients[0] ? bulkValues(clients[0], branding, today) : {};
  const bad = unknownFields(`${subject}\n${body}`, sample);
  if (bad.length) problems.push(`These merge fields don't exist: ${bad.map((k) => `{{${k}}}`).join(", ")}.`);

  const done = new Set(comms.filter((c) => c.Kind === "email" && c.Status === "outlook" && s(c.Subject).toLowerCase() === subject.trim().toLowerCase()).map((c) => s(c.ClientKey)));
  const used = [...new Set(tokensIn(`${subject}\n${body}`))];
  const drafts: EmailDraft[] = [];
  const noEmail: Client[] = [];
  const already: Client[] = [];
  for (const c of clients) {
    const to = s(c.Email);
    if (!to) { noEmail.push(c); continue; }
    if (done.has(c.Key)) { already.push(c); continue; }
    const values = bulkValues(c, branding, today);
    drafts.push({ client: c, to, subject: fill(subject.trim(), values), body: fill(body, values), blanks: used.filter((k) => k in values && !s(values[k])) });
  }
  return { drafts, noEmail, already, problems };
}

/** The log row for an email that has been put in Outlook drafts. */
export function emailLog(d: EmailDraft, key: string, outlookUrl: string, nowIso: string): Row {
  return {
    Key: key, ClientKey: d.client.Key, JobKey: "", Kind: "email", Status: "outlook", Subject: d.subject, Title: d.subject, Body: d.body, Brief: "Bulk email",
    ToEmail: d.to, Created: nowIso, Updated: nowIso, OutlookUrl: outlookUrl, SentOn: "",
  };
}

export type FormPlan = { requests: Row[]; activities: Row[]; already: Client[]; problem?: string };

/** One form request for each client. Clients who already have this form waiting for answers are skipped. */
export function planForms(clients: Client[], t: Template | undefined, title: string, due: string, existing: Row[], user: string, nowIso: string, newKey: (p: string) => string): FormPlan {
  if (!t) return { requests: [], activities: [], already: [], problem: "Choose a form." };
  const waiting = new Set(existing.filter((r) => r.TemplateKey === t.key && r.Status === "open").map((r) => s(r.ClientKey)));
  const fields = JSON.stringify(t.fields.map(cleanField));
  const name = title.trim() || t.name;
  const requests: Row[] = [];
  const activities: Row[] = [];
  const already: Client[] = [];
  for (const c of clients) {
    if (waiting.has(c.Key)) { already.push(c); continue; }
    const key = newKey("FR");
    requests.push({
      Key: key, PracticeId: "", ClientKey: c.Key, TemplateKey: t.key, TemplateVersion: t.version, Title: name, Status: "open", DueDate: due, Fields: fields,
      Answers: JSON.stringify(prefilled(t.fields, c as unknown as Row)), Created: nowIso, CreatedBy: user, Updated: nowIso,
    });
    activities.push({
      Key: newKey("A"), ClientKey: c.Key, Type: "form-sent", Title: `Form requested: ${name}`, Summary: "", At: nowIso, Actor: user, Source: "forms", SourceKey: key,
      EventKey: `form:${key}:form-sent`, Visibility: "normal", Created: nowIso,
    });
  }
  return { requests, activities, already };
}
