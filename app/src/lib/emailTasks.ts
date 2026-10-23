// Email suggestions: looks at your recent inbox and picks out emails that probably need action,
// by plain rules (from a client, flagged, wording that asks for something). Each one is offered
// on the Today screen to add as a task or dismiss; nothing is made without you. Optionally the
// AI can look at the subject and a short preview to judge better (a separate switch, off by default).
import { Client } from "./domain";
import { Graph } from "./graph";
import { Row } from "./schema";
import { addDays } from "./planning";

export type Mail = {
  id: string;
  subject: string;
  from: string; // name
  address: string;
  received: string; // ISO date-time
  preview: string;
  isRead: boolean;
  flagged: boolean;
  link?: string;
};

export type EmailPrefs = { enabled: boolean; ai: boolean; days: number };
export const DEFAULT_EMAIL_PREFS: EmailPrefs = { enabled: false, ai: false, days: 3 };

export type Handled = Record<string, { how: "added" | "dismissed"; on: string }>;

export type Suggestion = {
  mail: Mail;
  clientKey?: string;
  title: string;
  why: string;
  due?: string;
  hours?: number;
  score: number;
};

export async function fetchInbox(graph: Graph, today: string, days: number): Promise<Mail[]> {
  const since = `${addDays(today, -Math.max(1, days))}T00:00:00Z`;
  const q = new URLSearchParams({
    $top: "50", $orderby: "receivedDateTime desc", $filter: `receivedDateTime ge ${since}`,
    $select: "id,subject,from,receivedDateTime,bodyPreview,isRead,flag,webLink",
  });
  const raw = await graph.getAll<any>(`/me/mailFolders/inbox/messages?${q}`);
  return raw.map((m) => ({
    id: m.id, subject: String(m.subject || "(no subject)"), from: m.from?.emailAddress?.name || m.from?.emailAddress?.address || "",
    address: String(m.from?.emailAddress?.address || "").toLowerCase(), received: String(m.receivedDateTime || ""),
    preview: String(m.bodyPreview || "").replace(/\s+/g, " ").trim().slice(0, 300), isRead: !!m.isRead,
    flagged: m.flag?.flagStatus === "flagged", link: m.webLink,
  }));
}

/** The client an email's sender belongs to: their own address, or a contact's, never a guess from the name. */
export function clientOf(address: string, clients: Client[], contacts: Row[], links: Row[] = []): string | undefined {
  const a = address.toLowerCase();
  if (!a) return undefined;
  const direct = clients.find((c) => String(c.Email || "").toLowerCase().split(/[;,\s]+/).includes(a));
  if (direct) return direct.Key;
  const contact = contacts.find((c) => String(c.Email || "").toLowerCase().split(/[;,\s]+/).includes(a));
  if (contact) {
    const link = links.find((l) => l.MemberKey === contact.Key || l.ContactKey === contact.Key);
    if (link && (link.ClientKey as string)) return link.ClientKey as string;
  }
  return undefined;
}

const NOISE_SENDER = /(no-?reply|do-?not-?reply|notifications?@|newsletter|mailer|marketing|updates?@|bounce|alerts?@)/i;
const NOISE_SUBJECT = /(newsletter|unsubscribe|webinar|invoice from|your receipt|order confirmation|delivered|out of office|automatic reply|undeliverable)/i;
const ASKS = /(can you|could you|would you|please (?:can|could|let|send|confirm|advise|call|review|check)|let me know|need (?:you|to)|urgent|asap|deadline|by (?:monday|tuesday|wednesday|thursday|friday|tomorrow|today|the \d)|chasing|reminder|query|question|following up|waiting (?:for|on)|attached)/i;
const TAXY = /(hmrc|companies house|vat|self assessment|payroll|accounts|tax return|corporation tax|p11d|cis|bank statement|confirmation statement)/i;
/** Emails scoring at least this are suggested. */
export const THRESHOLD = 2;

/** Score one email by the rules, with the reasons it gives. Exposed so the rules can be tested. */
export function scoreMail(m: Mail, clientKey?: string): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const text = `${m.subject} ${m.preview}`;
  if (NOISE_SENDER.test(m.address) || NOISE_SUBJECT.test(m.subject)) return { score: -5, reasons: ["Looks automatic"] };
  if (clientKey) { score += 1.5; reasons.push("From a client"); }
  if (m.flagged) { score += 2; reasons.push("Flagged in Outlook"); }
  if (ASKS.test(text)) { score += 1.5; reasons.push("Asks for something"); }
  if (TAXY.test(text)) { score += 0.5; reasons.push("About tax or filings"); }
  if (!m.isRead) score += 0.25;
  return { score, reasons };
}

/** Suggestions from the inbox, best first, leaving out ones already added or dismissed. */
export function suggest(mails: Mail[], clients: Client[], contacts: Row[], handled: Handled, links: Row[] = []): Suggestion[] {
  const out: Suggestion[] = [];
  for (const m of mails) {
    if (handled[m.id]) continue;
    const clientKey = clientOf(m.address, clients, contacts, links);
    const { score, reasons } = scoreMail(m, clientKey);
    if (score < THRESHOLD) continue;
    const who = clientKey ? clients.find((c) => c.Key === clientKey)?.Title : m.from;
    out.push({ mail: m, clientKey, score, why: reasons.join(" · "), title: `Reply to ${who || "email"}: ${m.subject}`.slice(0, 120) });
  }
  return out.sort((a, b) => b.score - a.score || b.mail.received.localeCompare(a.mail.received));
}

export type AiVerdict = { id: string; needsAction: boolean; title?: string; due?: string; hours?: number; why?: string };

/** The AI's view laid over the rules: it can drop an email, or give it a better title, due date and time. */
export function applyVerdicts(list: Suggestion[], verdicts: AiVerdict[]): Suggestion[] {
  const by = new Map(verdicts.map((v) => [v.id, v]));
  const out: Suggestion[] = [];
  for (const s of list) {
    const v = by.get(s.mail.id);
    if (!v) { out.push(s); continue; }
    if (!v.needsAction) continue;
    out.push({ ...s, title: v.title || s.title, due: v.due || s.due, hours: v.hours || s.hours, why: v.why || s.why });
  }
  return out;
}

/** What the AI is given about each email: the sender, subject and a short preview, never more. */
export function aiPayload(list: Suggestion[], clients: Client[], names: boolean): Record<string, unknown>[] {
  return list.slice(0, 20).map((s) => ({
    id: s.mail.id, from: names ? s.mail.from : undefined, client: s.clientKey ? (names ? clients.find((c) => c.Key === s.clientKey)?.Title : s.clientKey) : undefined,
    subject: s.mail.subject, preview: s.mail.preview.slice(0, 240), received: s.mail.received.slice(0, 10),
  }));
}

/** The task to make from a suggestion. */
export function taskFromSuggestion(s: Suggestion, clients: Client[], planned: string, key: string): Row {
  const c = s.clientKey ? clients.find((x) => x.Key === s.clientKey) : undefined;
  return {
    Key: key, Title: s.title, ClientKey: c?.Key || "", ClientName: c?.Title || "", PlannedDate: planned, DueDate: s.due || "",
    EstimateHours: s.hours || 0.5, Status: "Open", Type: "Email",
    Notes: `From an email by ${s.mail.from || s.mail.address} on ${s.mail.received.slice(0, 10)}: ${s.mail.subject}${s.mail.link ? `\n${s.mail.link}` : ""}`,
  };
}

/** Keep the record of handled emails short: forget ones older than 60 days. */
export function pruneHandled(h: Handled, today: string): Handled {
  const cut = addDays(today, -60);
  return Object.fromEntries(Object.entries(h).filter(([, v]) => v.on >= cut));
}
