// Asking a client for the invoices and receipts behind a spreadsheet of transactions. The spreadsheet itself is attached to the
// email just as it is (nothing is read out of it); the email comes from a template the practice sets up once, with a few gaps the
// planner fills in for each client. Nothing here touches the screen or the network.

export const RECEIPT_TEMPLATE_KEY = "receipts.template";

/** The practice's wording. The {{gaps}} are filled in for each email (see RECEIPT_FIELDS). */
export type ReceiptTemplate = { subject: string; body: string; replyDays: number };

/** The gaps a template can use, with what each becomes. */
export const RECEIPT_FIELDS: [string, string][] = [
  ["greeting", "Hi and the client's first name (or Dear Sir or Madam)"],
  ["client", "The client's name"],
  ["file", "The attached spreadsheet's name"],
  ["reply_by", "The date to reply by"],
  ["sender", "Your first name"],
];

export const DEFAULT_RECEIPT_TEMPLATE: ReceiptTemplate = {
  subject: "Receipts and invoices needed",
  body: [
    "{{greeting}}",
    "",
    "We're working on your records and need the invoices and receipts for the transactions in the attached spreadsheet ({{file}}).",
    "",
    "Could you send them to us by {{reply_by}}? A photo or a PDF of each is fine. If there isn't one for a transaction, just tell us what it was for next to it in the spreadsheet and send it back.",
    "",
    "Thank you,",
    "{{sender}}",
  ].join("\n"),
  replyDays: 14,
};

/** A saved template, with anything missing taken from the default. */
export function readReceiptTemplate(raw: unknown): ReceiptTemplate {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const days = Math.floor(Number(o.replyDays));
  return {
    subject: typeof o.subject === "string" && o.subject.trim() ? o.subject : DEFAULT_RECEIPT_TEMPLATE.subject,
    body: typeof o.body === "string" && o.body.trim() ? o.body : DEFAULT_RECEIPT_TEMPLATE.body,
    replyDays: Number.isFinite(days) && days >= 1 && days <= 90 ? days : DEFAULT_RECEIPT_TEMPLATE.replyDays,
  };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const longDate = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
export const addDays = (iso: string, n: number) => { const t = new Date(`${iso}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

/** The template with its gaps filled in for one client. A gap it doesn't know is left as it is, so it shows up when checked. */
export function fillReceiptTemplate(t: ReceiptTemplate, o: { greeting: string; client: string; file: string; today: string; sender: string }): { subject: string; body: string; replyBy: string } {
  const replyBy = addDays(o.today, t.replyDays);
  const values: Record<string, string> = { greeting: o.greeting, client: o.client, file: o.file || "the attached spreadsheet", reply_by: longDate(replyBy), sender: (o.sender || "").split(" ")[0] };
  const fill = (s: string) => s.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, k: string) => values[k.toLowerCase()] ?? m);
  return { subject: fill(t.subject), body: fill(t.body).replace(/\n+$/, ""), replyBy };
}

/** Outlook takes an attachment of up to 3 MB this way. */
export const MAX_ATTACHMENT = 3 * 1024 * 1024;
