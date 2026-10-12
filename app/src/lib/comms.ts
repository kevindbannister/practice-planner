// Letters and emails to clients: the details that go round the text (address, "Dear ...",
// sign-off), what the AI is told about the client, and where the Word files are kept.
import { Client, Job } from "./domain";
import { Row } from "./schema";

export type CommKind = "letter" | "email";
export type CommStatus = "draft" | "word" | "outlook";

export type CommsPrefs = {
  signName: string; // printed under the signature
  signTitle: string; // second line, e.g. the practice name
  signOff: string; // "Yours sincerely,"
  emailSignature: string; // added under emails
  style: string; // told to the AI every time: house style, practice details
  model: string; // OpenAI model; blank = the server's choice
  letterhead?: { name: string; size: number; uploaded: string; placeholder: boolean; webUrl?: string };
};

export const DEFAULT_COMMS: CommsPrefs = {
  signName: "", signTitle: "", signOff: "Yours sincerely,", emailSignature: "", style: "", model: "",
};

export const LETTERS_FOLDER = "Practice Planner Letters";
export const LETTERHEAD_FILE = "Letterhead.docx";
export const letterheadPath = () => `/me/drive/root:/${encodeURIComponent(LETTERS_FOLDER)}/${encodeURIComponent(LETTERHEAD_FILE)}`;

export const STATUS_TEXT: Record<CommStatus, string> = { draft: "Draft", word: "Word letter made", outlook: "In Outlook drafts" };

export const LETTER_STARTERS = [
  "Accounts ready for you to review and approve",
  "Tax return ready to check and sign",
  "Reminder: please send your records",
  "Tax to pay and when it's due",
  "Our fees for the coming year",
  "Covering letter for the engagement letter",
];
export const EMAIL_STARTERS = [
  "Chase for missing records",
  "Accounts attached for approval",
  "Booking a call to go through the accounts",
  "Payment on account reminder",
  "Thanks for sending everything",
];
export const CHANGE_STARTERS = ["Shorter", "More formal", "Friendlier", "Firmer", "Simpler words", "Add a deadline reminder"];

export function readCommsPrefs(settings: Row[]): CommsPrefs {
  const row = settings.find((s) => s.Key === "comms");
  try {
    return { ...DEFAULT_COMMS, ...(row ? JSON.parse(String(row.Value || "{}")) : {}) };
  } catch {
    return DEFAULT_COMMS;
  }
}

const isCompany = (c: Client) => c.Kind === "Ltd" || c.Kind === "LLP" || !!c.CompanyNumber;
const firstName = (c: Client) => String(c.ContactPreferred || c.ContactFirst || "").trim();

/** The person the letter's to, as written on an envelope ("Mr T Walters" style if the title is known). */
export function personLine(c: Client): string {
  const first = firstName(c);
  const last = String(c.ContactLast || "").trim();
  const title = String(c.ContactTitle || "").trim();
  if (title && last) return `${title} ${first ? first[0] + " " : ""}${last}`;
  return [first, last].filter(Boolean).join(" ");
}

/** Address lines for a letter: the person, the company (for a company), then the address. */
export function addressLines(c: Client): string[] {
  const raw = String((isCompany(c) ? c.TradingAddress || c.RegisteredOffice : c.HomeAddress || c.TradingAddress) || "");
  const lines = raw.split(/\r?\n|,/).map((l) => l.trim()).filter(Boolean);
  const out: string[] = [];
  const person = personLine(c);
  if (person) out.push(person);
  if (isCompany(c) || !person) out.push(String(c.Title || ""));
  return [...out, ...lines].filter(Boolean);
}

export function salutationFor(c: Client): string {
  const first = firstName(c);
  if (first) return `Dear ${first},`;
  if (c.ContactTitle && c.ContactLast) return `Dear ${c.ContactTitle} ${c.ContactLast},`;
  return "Dear Sir or Madam,";
}

/** "Yours faithfully" goes with "Dear Sir or Madam"; otherwise your usual sign-off. */
export function signOffFor(salutation: string, prefs: CommsPrefs): string {
  return /sir or madam/i.test(salutation) ? "Yours faithfully," : prefs.signOff || "Yours sincerely,";
}

export function emailGreeting(c: Client): string {
  const first = firstName(c);
  return first ? `Hi ${first},` : salutationFor(c);
}

const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "12 October 2026", as printed on a letter. */
export function longDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return y && m && d ? `${d} ${MONTHS_LONG[m - 1]} ${y}` : iso;
}

/**
 * What the AI is told about the client: names, how to address them, and their open work. Tax
 * references, dates of birth and other identifiers are not sent.
 */
export function aiContext(o: {
  client: Client; jobs: Job[]; job?: Job; stageName: (j: Job) => string; serviceName: (k?: string) => string;
  prefs: CommsPrefs; today: string; kind: CommKind; salutation: string;
}): Record<string, unknown> {
  const { client: c } = o;
  const work = (j: Job) => ({
    work: o.serviceName(j.ServiceKey) || j.Title,
    periodEnd: j.PeriodEnd || undefined,
    deadline: j.Deadline || undefined,
    stage: o.stageName(j) || undefined,
    recordsReceived: j.RecordsReceived || (j.RecordsReceived === undefined ? undefined : "not yet"),
    planned: j.PlannedDate || undefined,
  });
  return {
    today: o.today,
    client: c.Title,
    clientType: c.Kind === "Individual" ? "individual" : c.Kind || (isCompany(c) ? "company" : "individual"),
    contact: [c.ContactTitle, firstName(c), c.ContactLast].filter(Boolean).join(" ") || undefined,
    salutation: o.kind === "letter" ? o.salutation : emailGreeting(c),
    companyNumber: c.CompanyNumber || undefined,
    yearEnd: c.YearEnd || undefined,
    about: o.job ? work(o.job) : undefined,
    openWork: o.jobs.slice(0, 12).map(work),
    sender: o.prefs.signName || undefined,
    practice: o.prefs.signTitle || undefined,
  };
}

/** A safe file name: "2026-10-12 Your accounts.docx". */
export function letterFileName(date: string, subject: string): string {
  const s = subject.replace(/[\\/:*?"<>|#%{}~&]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Letter";
  return `${date} ${s}.docx`;
}
export const clientFolder = (name: string) => name.replace(/[\\/:*?"<>|#%{}~&]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Client";

export function toBase64(d: Uint8Array): string {
  let s = "";
  for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode(...d.subarray(i, i + 0x8000));
  return btoa(s);
}
