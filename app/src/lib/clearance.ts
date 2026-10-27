// Professional clearance: asking a client's previous accountant whether there is any reason we
// shouldn't act, and for the records we need. One row per request in the Clearances list. The letter
// is built from the client's record and the standard request list, and can be edited; the wording
// is a starting point for the practice to check, not legal advice.
import { Client } from "./domain";
import { Letter } from "./docx";
import { Row } from "./schema";

export type ClearanceStatus = "draft" | "requested" | "received" | "refused" | "notneeded";
export const STATUS_LABEL: Record<ClearanceStatus, string> = { draft: "Not sent yet", requested: "Asked, waiting for a reply", received: "Clearance received", refused: "Not cleared", notneeded: "Not needed" };
export const STATUS_CHIP: Record<ClearanceStatus, string> = { draft: "", requested: "amber", received: "green", refused: "red", notneeded: "" };
export const asStatus = (v: unknown): ClearanceStatus => (v === "requested" || v === "received" || v === "refused" || v === "notneeded" ? v : "draft");

export type ItemDef = { key: string; label: string; for: "all" | "company" | "individual" };
export const STANDARD_ITEMS: ItemDef[] = [
  { key: "accounts", label: "Last filed accounts and the working papers behind them", for: "company" },
  { key: "ct600", label: "Last Corporation Tax return (CT600) and computations", for: "company" },
  { key: "sa", label: "Last Self Assessment returns and tax calculations", for: "individual" },
  { key: "ledgers", label: "Debtors and creditors listings at the last year end", for: "company" },
  { key: "tb", label: "Trial balance and nominal ledger for the current year to date", for: "all" },
  { key: "utr", label: "Unique Taxpayer Reference and, for a company, the Companies House authentication code", for: "all" },
  { key: "vat", label: "VAT registration details and the last VAT returns", for: "all" },
  { key: "paye", label: "PAYE references and payroll records for the year to date", for: "all" },
  { key: "fees", label: "Confirmation that no fees are outstanding, or the position", for: "all" },
];
export type Item = { key: string; label: string; asked: boolean; got: boolean };

export const itemsFor = (c: Pick<Client, "Kind">): ItemDef[] => STANDARD_ITEMS.filter((i) => i.for === "all" || (i.for === "company") === (c.Kind === "Ltd" || c.Kind === "LLP"));
export const defaultItems = (c: Pick<Client, "Kind">): Item[] => itemsFor(c).map((i) => ({ key: i.key, label: i.label, asked: true, got: false }));
export function readItems(v: unknown, c: Pick<Client, "Kind">): Item[] {
  try { const a = JSON.parse(String(v || "[]")); if (Array.isArray(a) && a.length) return a.filter((x) => x && typeof x.label === "string").map((x) => ({ key: String(x.key || x.label), label: String(x.label), asked: x.asked !== false, got: !!x.got })); } catch { /* fall through */ }
  return defaultItems(c);
}

const s = (v: unknown) => String(v ?? "").trim();
export type Previous = { firm: string; contact: string; email: string; address: string };
export const previousOf = (r: Row): Previous => ({ firm: s(r.PrevFirm), contact: s(r.PrevContact), email: s(r.PrevEmail), address: s(r.PrevAddress) });

/** "Dear Sir/Madam" with "Yours faithfully" when there is no named contact. */
export function greeting(contact: string): { salutation: string; signOff: string } {
  const name = contact.trim();
  return name ? { salutation: `Dear ${name},`, signOff: "Yours sincerely," } : { salutation: "Dear Sir/Madam,", signOff: "Yours faithfully," };
}

export type LetterInput = { client: Pick<Client, "Title" | "Kind" | "CompanyNumber">; clientName: string; previous: Previous; items: Item[]; practice: string; person: string; date: string; ref?: string };
export function clearanceLetter(i: LetterInput): Letter {
  const g = greeting(i.previous.contact);
  const company = i.client.Kind === "Ltd" || i.client.Kind === "LLP";
  const who = i.clientName || String(i.client.Title);
  const asked = i.items.filter((x) => x.asked);
  const lines = [
    `We have been asked by ${who}${company && i.client.CompanyNumber ? ` (company number ${i.client.CompanyNumber})` : ""} to act as their accountants in place of your firm.`,
    "",
    "Before we accept the appointment, please would you tell us whether there is any professional or other reason why we should not do so. If there is a matter we ought to know about, please let us know so we can consider it. We have the client's authority to make this request and a copy is available on request.",
    "",
    "To allow a smooth handover, please would you also let us have the following, where you hold them:",
    ...asked.map((x) => `- ${x.label}`),
    "",
    "We would be grateful for your reply within 14 days. If there are fees outstanding, please tell us the position so that we can discuss it with the client.",
    "",
    "Thank you for your help.",
  ];
  return { date: i.date, address: [i.previous.contact || "", i.previous.firm, ...i.previous.address.split(/\r?\n|,/).map((x) => x.trim())].filter(Boolean), reference: i.ref, salutation: g.salutation, subject: `Professional clearance: ${who}`, body: lines.join("\n"), signOff: g.signOff, signName: i.person, signTitle: i.practice || undefined };
}

export function problems(p: Previous): string[] {
  const out: string[] = [];
  if (!p.firm) out.push("Add the previous accountant's firm.");
  if (!p.address && !p.email) out.push("Add an address or an email so the request can be sent.");
  return out;
}

export type Summary = { status: ClearanceStatus | "none"; line: string; row?: Row; waitingDays: number };
/** The latest clearance for a client, for the Overview card and the onboarding stage. */
export function latest(rows: Row[], clientKey: string, today: string): Summary {
  const mine = rows.filter((r) => r.ClientKey === clientKey).sort((a, b) => s(b.Created).localeCompare(s(a.Created)));
  const r = mine[0];
  if (!r) return { status: "none", line: "No clearance request yet", waitingDays: 0 };
  const st = asStatus(r.Status);
  const sent = s(r.SentOn).slice(0, 10);
  const waitingDays = st === "requested" && sent ? Math.max(0, Math.round((Date.parse(today) - Date.parse(sent)) / 86400000)) : 0;
  const firm = s(r.PrevFirm) || "the previous accountant";
  const line = st === "requested" ? `Asked ${firm}${sent ? ` on ${sent}` : ""}${waitingDays ? ` (${waitingDays} days ago)` : ""}` : st === "received" ? `Cleared by ${firm}${s(r.ReceivedOn) ? ` on ${s(r.ReceivedOn).slice(0, 10)}` : ""}` : st === "refused" ? `${firm} did not clear us` : st === "notneeded" ? "Not needed" : `Letter to ${firm} not sent yet`;
  return { status: st, line, row: r, waitingDays };
}
