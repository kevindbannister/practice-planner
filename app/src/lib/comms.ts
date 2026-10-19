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
  letterhead?: { name: string; size: number; uploaded: string; placeholder: boolean; example?: boolean; webUrl?: string };
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
  prefs: CommsPrefs; today: string; kind: CommKind; salutation: string; payments?: unknown[];
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
    taxPayments: o.payments && o.payments.length ? o.payments : undefined,
    sender: o.prefs.signName || undefined,
    practice: o.prefs.signTitle || undefined,
  };
}

/** A safe file name: "2026-10-12 Your accounts.docx". */
export function letterFileName(date: string, subject: string): string {
  const s = oneLine(subject).replace(/[\\/:*?"<>|#%{}~&]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Letter";
  return `${date} ${s}.docx`;
}
export const clientFolder = (name: string) => name.replace(/[\\/:*?"<>|#%{}~&]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Client";

export function toBase64(d: Uint8Array): string {
  let s = "";
  for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode(...d.subarray(i, i + 0x8000));
  return btoa(s);
}

/** A subject that may run over two lines (as on a letter), as one line for file names and emails. */
export const oneLine = (subject: string) => subject.split(/\r?\n/).map((x) => x.trim()).filter(Boolean).join(" - ");

const MONTH_NO: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n: number) => String(n).padStart(2, "0");

/** A date as written on a letter ("28th July 2026", "Monday 28 July 2026", "28/07/2026") as yyyy-mm-dd. */
export function dateFromText(text: string): string | undefined {
  const t = text.trim().replace(/,/g, "");
  let m = t.match(/^(?:[a-z]+day\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*\.?\s+(\d{4})$/i);
  if (m && MONTH_NO[m[2].toLowerCase()]) return `${m[3]}-${pad(MONTH_NO[m[2].toLowerCase()])}-${pad(Number(m[1]))}`;
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m && Number(m[2]) <= 12 && Number(m[1]) <= 31) return `${m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
  return undefined;
}

export type PastedLetter = { date?: string; address: string; salutation: string; subject: string; body: string; signOff?: string };

const SIGN_OFF_LINE = /^(?:yours\s+(?:faithfully|sincerely|truly)|kind(?:est)?\s+regards|best\s+regards|warm\s+regards|regards|best\s+wishes|many\s+thanks|with\s+thanks)\b/i;

/**
 * A whole letter pasted in, split into its parts: the date and address (before "Dear ..."), the
 * greeting, the subject (the short line or two straight after the greeting), the body, and the
 * sign-off. Anything after the sign-off (the name and signature) is left off, as the letterhead adds it.
 * Without a "Dear ..." line, it's all taken as the body.
 */
export function parseLetter(text: string): PastedLetter {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ").split("\n");
  const g = lines.findIndex((l) => /^\s*dear\b/i.test(l));
  if (g < 0) return { address: "", salutation: "", subject: "", body: text.trim() };
  let date: string | undefined;
  const address: string[] = [];
  for (const l of lines.slice(0, g)) {
    const d = dateFromText(l);
    if (d && !date) date = d;
    else if (l.trim()) address.push(l.trim());
  }
  // the greeting line may carry the subject straight after it
  let rest = lines.slice(g + 1);
  const firstBlock: string[] = [];
  let i = 0;
  while (i < rest.length && !rest[i].trim()) i++;
  while (i < rest.length && rest[i].trim()) firstBlock.push(rest[i++].trim());
  const isSubject = firstBlock.length > 0 && firstBlock.length <= 3 && firstBlock.every((l) => l.length <= 140 && !/[.?!:]$/.test(l) && !l.includes("\t"));
  if (isSubject) rest = rest.slice(i);
  const so = rest.findIndex((l) => SIGN_OFF_LINE.test(l.trim()));
  const body = (so >= 0 ? rest.slice(0, so) : rest).join("\n").replace(/^\s*\n/, "").replace(/\s+$/, "");
  return {
    date, address: address.join("\n"), salutation: lines[g].trim(),
    subject: isSubject ? firstBlock.map((l) => l.replace(/^\*\*(.*)\*\*$/, "$1").replace(/^(re|subject):\s*/i, "")).join("\n") : "",
    body: body.trim() ? body.replace(/^\n+/, "") : "",
    signOff: so >= 0 ? rest[so].trim() : undefined,
  };
}
