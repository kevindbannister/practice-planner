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

/** One point in the clearance request. `services` is where it applies: empty means every client, otherwise only clients with one of those services. */
export type ItemDef = { key: string; label: string; for: "all" | "company" | "individual"; services?: string[] };
export const STANDARD_ITEMS: ItemDef[] = [
  // the client and the relationship
  { key: "fees", label: "Confirmation that no fees are outstanding, or the position if there are", for: "all" },
  { key: "lien", label: "Whether you are exercising a lien over any of the client's books or papers", for: "all" },
  { key: "hmrcauth", label: "The date you will remove your HMRC agent authorisation, so that ours can take effect", for: "all" },
  { key: "enquiries", label: "Details of any open HMRC enquiries, investigations, penalties or time-to-pay arrangements", for: "all" },
  { key: "late", label: "Any returns, accounts or payments that are overdue, or that you know will be late", for: "all" },
  { key: "aml", label: "A copy of the client's identity and AML checks, where you are able to share them", for: "all" },
  // identifiers
  { key: "utr", label: "Unique Taxpayer Reference and, for a company, the Companies House authentication code", for: "all" },
  { key: "chnum", label: "The company's registered office address, year end and confirmation statement due date", for: "company" },
  // company year end work
  { key: "accounts", label: "Last filed accounts and the working papers behind them", for: "company" },
  { key: "ct600", label: "Last Corporation Tax return (CT600) and computations", for: "company" },
  { key: "ctpay", label: "Corporation Tax payments made and any amount still due", for: "company" },
  { key: "fixedassets", label: "The fixed asset register and capital allowances computations", for: "company" },
  { key: "ledgers", label: "Debtors and creditors listings at the last year end", for: "company" },
  { key: "loans", label: "The directors' loan account and any other loan balances at the last year end", for: "company" },
  { key: "registers", label: "Statutory registers (members, directors, people with significant control) and minute book, if you hold them", for: "company" },
  { key: "tb", label: "Trial balance and nominal ledger for the current year to date", for: "all" },
  // individuals
  { key: "sa", label: "Last Self Assessment returns and tax calculations", for: "individual" },
  { key: "sapay", label: "Payments on account made and the balance, if any, still due", for: "individual" },
  { key: "sa800", label: "Partnership returns and the partners' profit shares, where the client is a partner", for: "individual", services: ["SA800"] },
  { key: "cgt", label: "Capital gains and property computations, including base costs and any losses carried forward", for: "individual" },
  // services
  { key: "vat", label: "VAT registration details, the VAT scheme and the last VAT returns", for: "all", services: ["VAT"] },
  { key: "vatrecon", label: "VAT working papers and any outstanding VAT queries or assessments", for: "all", services: ["VAT"] },
  { key: "paye", label: "PAYE and employer references and payroll records for the year to date", for: "all", services: ["PAYE", "PAYROLL"] },
  { key: "pension", label: "Auto-enrolment details: the pension provider, staging date and latest declaration of compliance", for: "all", services: ["PAYE", "PAYROLL"] },
  { key: "cis", label: "CIS registration, the verification and monthly returns for the current tax year", for: "all", services: ["CIS"] },
];
export type Item = { key: string; label: string; asked: boolean; got: boolean };

export const POINTS_KEY = "clearance.points";
/** The practice's own clearance points from Settings, or the standard list until it has made some. */
export function readPoints(settings: { Key?: unknown; Value?: unknown }[]): ItemDef[] {
  const row = settings.find((x) => String(x.Key) === POINTS_KEY);
  if (!row) return STANDARD_ITEMS;
  try {
    const a = JSON.parse(String(row.Value || "[]"));
    if (!Array.isArray(a)) return STANDARD_ITEMS;
    return a.filter((x) => x && typeof x.label === "string" && x.label.trim()).slice(0, 100).map((x, i) => ({
      key: String(x.key || `p${i + 1}`).slice(0, 40), label: String(x.label).trim().slice(0, 300), for: x.for === "company" || x.for === "individual" ? x.for : "all",
      services: Array.isArray(x.services) ? x.services.filter((k: unknown) => typeof k === "string").slice(0, 60) : [],
    }));
  } catch { return STANDARD_ITEMS; }
}
/** The points that apply to this client: by company or individual, and by the services they have (a point with no services applies to everyone). */
export const itemsFor = (c: Pick<Client, "Kind">, points: ItemDef[] = STANDARD_ITEMS, serviceKeys?: string[]): ItemDef[] =>
  points.filter((i) => (i.for === "all" || (i.for === "company") === (c.Kind === "Ltd" || c.Kind === "LLP")) && (!i.services?.length || !serviceKeys || i.services.some((k) => serviceKeys.includes(k))));
export const defaultItems = (c: Pick<Client, "Kind">, points: ItemDef[] = STANDARD_ITEMS, serviceKeys?: string[]): Item[] => itemsFor(c, points, serviceKeys).map((i) => ({ key: i.key, label: i.label, asked: true, got: false }));
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
    `${who}${company && i.client.CompanyNumber ? ` (company number ${i.client.CompanyNumber})` : ""} has asked us to act as their accountants in place of your firm, and has given us authority to contact you. A copy of that authority is available on request.`,
    "",
    "Before we accept the appointment, please would you tell us whether there is any professional or other reason why we should not do so. In particular, please let us know if:",
    "- you have ceased to act, or been asked to cease to act, and why;",
    "- you have any concern about the integrity of the client or the information they have given you;",
    "- there is any matter that raises a money laundering or tax compliance concern that you are free to tell us about; or",
    "- there is any other fact we ought to know before we decide.",
    "",
    "If there is nothing of that kind, a short reply to say so will do. If there is a matter you feel unable to disclose without the client's permission, please tell us that you are unable to give clearance, and we will take it up with the client.",
    "",
    "To allow a smooth handover, please would you also let us have the following, where you hold them:",
    ...asked.map((x) => `- ${x.label}`),
    "",
    "Please send these to us in your usual format, and tell us if you will charge for copying the records.",
    "",
    "We would be grateful for your reply within 14 days. We will not start work for the client until we have heard from you or the client has told us why a reply is not coming.",
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
