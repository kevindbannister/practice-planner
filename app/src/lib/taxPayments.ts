// Tax payments: Self Assessment balancing payments and payments on account, and corporation
// tax, per client. They feed the payment reminders and what the AI knows when writing letters.
//
// Self Assessment, for the 2025/26 tax year (6 April 2025 to 5 April 2026):
//   - the 2025/26 balancing payment is due 31 January 2027
//   - the first payment on account for 2026/27 is due 31 January 2027
//   - the second payment on account for 2026/27 is due 31 July 2027
// Each payment on account is normally half of the year's Self Assessment bill (income tax and
// Class 4 National Insurance). None are due if that bill is under £1,000, or if more than 80%
// of the year's tax was taken at source (PAYE).
// Corporation tax (not a large company): due 9 months and 1 day after the period ends.
import { fmtMoney } from "./domain";
import { addDays, addMonths } from "./planning";
import { Row } from "./schema";

export type PayKind = "balancing" | "poa1" | "poa2" | "ct" | "other";
export type TaxPayment = Row & {
  Key: string; ClientKey: string; Tax: "SA" | "CT" | "OTHER"; Kind: PayKind; EntryYear?: string; TaxYear?: string;
  Amount?: number; DueDate?: string; PaidOn?: string; RemindedOn?: string; Label?: string;
};

export const POA_THRESHOLD = 1000;

/** "2025/26" from 2025. */
export const taxYearLabel = (start: number) => `${start}/${String((start + 1) % 100).padStart(2, "0")}`;
export const taxYearStart = (label: string) => Number(String(label).slice(0, 4));

/** The tax year a date falls in (tax years start on 6 April). */
export function taxYearOf(iso: string): number {
  const y = Number(iso.slice(0, 4));
  return iso.slice(5) >= "04-06" ? y : y - 1;
}

/** Due dates for a tax year's return: balancing and first payment on account on 31 January, second on 31 July. */
export function saDates(start: number): { balancing: string; poa1: string; poa2: string } {
  return { balancing: `${start + 2}-01-31`, poa1: `${start + 2}-01-31`, poa2: `${start + 2}-07-31` };
}

export type SaInput = {
  bill: number; // the year's Self Assessment bill: income tax and Class 4 NIC
  other: number; // also payable on 31 January but not counted for payments on account (capital gains tax, student loan, Class 2)
  poaPaid: number; // payments on account already made for this year
  mostlyAtSource: boolean; // more than 80% of the year's tax taken at source
};
export type SaResult = { balancing: number; poa1: number; poa2: number; refund: number; why: string };

const pence = (n: number) => Math.round(n * 100) / 100;
const downToPence = (n: number) => Math.floor(n * 100 + 1e-6) / 100;

/** The usual Self Assessment payments from a year's bill. A starting point to check against the tax computation. */
export function calcSa(i: SaInput): SaResult {
  const owed = pence(i.bill + i.other - i.poaPaid);
  const balancing = Math.max(0, owed);
  const refund = Math.max(0, -owed);
  let poa = 0;
  let why = "";
  if (i.mostlyAtSource) why = "No payments on account: more than 80% of the tax was taken at source.";
  else if (i.bill < POA_THRESHOLD) why = `No payments on account: the bill is under ${fmtMoney(POA_THRESHOLD)}.`;
  else {
    poa = downToPence(i.bill / 2);
    why = "Each payment on account is half of this year's bill.";
  }
  return { balancing, poa1: poa, poa2: poa, refund, why };
}

/** The three payments for a tax year's return. */
export function saRows(clientKey: string, start: number, r: { balancing: number; poa1: number; poa2: number }, key: () => string): TaxPayment[] {
  const d = saDates(start);
  const entry = taxYearLabel(start);
  const next = taxYearLabel(start + 1);
  return [
    { Key: key(), ClientKey: clientKey, Tax: "SA", Kind: "balancing", EntryYear: entry, TaxYear: entry, Amount: r.balancing, DueDate: d.balancing },
    { Key: key(), ClientKey: clientKey, Tax: "SA", Kind: "poa1", EntryYear: entry, TaxYear: next, Amount: r.poa1, DueDate: d.poa1 },
    { Key: key(), ClientKey: clientKey, Tax: "SA", Kind: "poa2", EntryYear: entry, TaxYear: next, Amount: r.poa2, DueDate: d.poa2 },
  ];
}

/** Payments on account already set up for a tax year (from the previous year's return). */
export function poasFor(payments: TaxPayment[], clientKey: string, year: string): number {
  return pence(
    payments
      .filter((p) => p.ClientKey === clientKey && p.Tax === "SA" && (p.Kind === "poa1" || p.Kind === "poa2") && p.TaxYear === year)
      .reduce((t, p) => t + (Number(p.Amount) || 0), 0),
  );
}

/** Corporation tax due date: 9 months and 1 day after the period ends. */
export function ctDue(periodEnd: string): string {
  return addDays(addMonths(periodEnd, 9), 1);
}

export function paymentLabel(p: TaxPayment): string {
  switch (p.Kind) {
    case "balancing":
      return `${p.TaxYear} balancing payment`;
    case "poa1":
      return `${p.TaxYear} first payment on account`;
    case "poa2":
      return `${p.TaxYear} second payment on account`;
    case "ct":
      return `Corporation tax for the period to ${fmtLong(String(p.TaxYear || ""))}`;
    default:
      return String(p.Label || "Tax payment");
  }
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function fmtLong(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return y && m && d ? `${d} ${MONTHS[m - 1]} ${y}` : iso;
}

export const isPaid = (p: TaxPayment) => !!p.PaidOn;
export const owing = (p: TaxPayment) => !isPaid(p) && Number(p.Amount) > 0;

export type ReminderGroup = { clientKey: string; due: string; payments: TaxPayment[]; total: number; overdue: boolean; reminded?: string };

/**
 * Payments to remind clients about: not paid, something to pay, due within `days` (or already
 * overdue), one group per client and due date. Groups already reminded are kept, marked.
 */
export function reminderGroups(payments: TaxPayment[], today: string, days = 30): ReminderGroup[] {
  const until = addDays(today, days);
  const map = new Map<string, ReminderGroup>();
  for (const p of payments) {
    if (!owing(p) || !p.DueDate || p.DueDate > until) continue;
    const k = `${p.ClientKey}|${p.DueDate}`;
    const g = map.get(k) || { clientKey: p.ClientKey, due: p.DueDate, payments: [], total: 0, overdue: p.DueDate < today };
    g.payments.push(p);
    g.total = pence(g.total + Number(p.Amount));
    if (p.RemindedOn && (!g.reminded || p.RemindedOn > g.reminded)) g.reminded = String(p.RemindedOn);
    map.set(k, g);
  }
  const order: Record<string, number> = { balancing: 1, poa1: 2, poa2: 3, ct: 4, other: 5 };
  for (const g of map.values()) g.payments.sort((a, b) => order[a.Kind] - order[b.Kind]);
  return [...map.values()].sort((a, b) => a.due.localeCompare(b.due));
}

export type ReminderTemplate = { subject: string; body: string };
export const DEFAULT_REMINDER: ReminderTemplate = {
  subject: "Tax to pay by {due date}",
  body: [
    "{greeting}",
    "",
    "A quick reminder that the following tax is due to HMRC by {due date}:",
    "",
    "{payments}",
    "",
    "Total: **{total}**",
    "",
    "{how to pay}",
    "",
    "If you've already paid, thank you, and please ignore this email. If you have any questions, just reply.",
    "",
    "Kind regards,",
    "{sender}",
  ].join("\n"),
};
export const REMINDER_PLACEHOLDERS: [string, string][] = [
  ["{greeting}", "Hi and their first name"],
  ["{due date}", "e.g. 31 January 2027"],
  ["{payments}", "a bullet for each payment and amount"],
  ["{total}", "the total"],
  ["{how to pay}", "the payment reference (UTR followed by K for Self Assessment)"],
  ["{sender}", "your first name"],
];

/** A reminder email from the template. */
export function fillReminder(t: ReminderTemplate, g: ReminderGroup, c: { greeting: string; utr?: string; ctUtr?: string; sender: string }): ReminderTemplate {
  const lines = g.payments.map((p) => `- ${paymentLabel(p)}: ${fmtMoney(Number(p.Amount))}`).join("\n");
  const how: string[] = [];
  if (g.payments.some((p) => p.Tax === "SA")) {
    how.push(c.utr ? `For Self Assessment, use the reference **${c.utr.replace(/\s+/g, "")}K** when you pay HMRC.` : "For Self Assessment, use your UTR followed by the letter K as the payment reference.");
  }
  if (g.payments.some((p) => p.Tax === "CT")) {
    how.push("For corporation tax, use the company's 17-character payment reference, which starts with its corporation tax UTR.");
  }
  const fill = (s: string) =>
    s
      .split("{greeting}").join(c.greeting)
      .split("{due date}").join(fmtLong(g.due))
      .split("{payments}").join(lines)
      .split("{total}").join(fmtMoney(g.total))
      .split("{how to pay}").join(how.join(" ") || "Please pay HMRC by the due date.")
      .split("{sender}").join(c.sender)
      .replace(/\n{3,}/g, "\n\n");
  return { subject: fill(t.subject), body: fill(t.body).trim() };
}

/** For the AI: upcoming and recent payments in plain words (amounts and dates only). */
export function paymentsForAi(payments: TaxPayment[], clientKey: string, today: string) {
  const from = addDays(today, -400);
  return payments
    .filter((p) => p.ClientKey === clientKey && p.DueDate && p.DueDate >= from)
    .sort((a, b) => String(a.DueDate).localeCompare(String(b.DueDate)))
    .slice(0, 12)
    .map((p) => ({ payment: paymentLabel(p), amount: fmtMoney(Number(p.Amount) || 0), due: p.DueDate, paid: p.PaidOn ? `paid ${p.PaidOn}` : "not paid yet" }));
}
