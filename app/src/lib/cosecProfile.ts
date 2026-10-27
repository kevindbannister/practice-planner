// How the practice relates to each company in Co Sec: a service level and a few overrides. A company is a Clients row (one
// company record); a company that isn't a client is a Clients row with status "cosec-only". The profile says what the practice
// is responsible for. Monitoring never implies the practice files anything.
import { Row } from "./schema";
import { companyKind } from "./cosec";

export type Level = "managed" | "filings" | "adhoc" | "monitoring" | "historical";
export const LEVELS: { key: Level; label: string; help: string }[] = [
  { key: "managed", label: "Fully managed", help: "The practice looks after the company's statutory filings and records." },
  { key: "filings", label: "Specific filings only", help: "The practice files only the filings marked below." },
  { key: "adhoc", label: "Ad hoc transactions", help: "The practice acts when asked; nothing is filed on a schedule." },
  { key: "monitoring", label: "Monitoring only", help: "Watched for changes at Companies House. The practice is not responsible for any filing." },
  { key: "historical", label: "Historical, no active services", help: "Kept for the record." },
];
export const levelLabel = (l: string) => LEVELS.find((x) => x.key === l)?.label || l;
/** Does this level make the practice responsible for statutory filings? */
export const responsible = (l: Level) => l === "managed" || l === "filings";

const str = (v: unknown) => (v == null ? "" : String(v));
export const COSEC_ONLY = "cosec-only";

export type Profile = { key: string; clientKey: string; level: Level; responsible: string; filesCs01: boolean | null; notes: string; explicit: boolean };

/** A company's profile. With none on file, an active client is fully managed (as before) and anything else is historical. */
export function profileFor(client: Row, profiles: Row[]): Profile {
  const p = profiles.find((x) => str(x.ClientKey) === str(client.Key));
  const status = str(client.Status).toLowerCase();
  const fallback: Level = status === COSEC_ONLY ? "monitoring" : !status || status === "active" ? "managed" : "historical";
  const lv = str(p?.Level) as Level;
  return {
    key: str(p?.Key), clientKey: str(client.Key), level: LEVELS.some((x) => x.key === lv) ? lv : fallback, responsible: str(p?.Responsible) || str(client.Manager) || str(client.Partner),
    filesCs01: p && str(p.FilesCS01) ? str(p.FilesCS01) === "yes" : null, notes: str(p?.Notes), explicit: !!p,
  };
}

/** Does the practice file this company's confirmation statement? An explicit answer wins; otherwise only managed companies. */
export const filesCs01 = (p: Profile) => (p.filesCs01 !== null ? p.filesCs01 : p.level === "managed");

export const normNumber = (v: unknown) => { const n = str(v).replace(/\s+/g, "").toUpperCase(); return /^\d{1,7}$/.test(n) ? n.padStart(8, "0") : n; };
export const validNumber = (v: unknown) => /^([A-Z]{2}\d{6}|\d{8})$/.test(normNumber(v));

/** An existing company with this number, if any. */
export function findDuplicate(clients: Row[], number: string): Row | undefined {
  const n = normNumber(number);
  return n ? clients.find((c) => normNumber(c.CompanyNumber) === n) : undefined;
}

export type NewCompany = { name: string; number: string; kind: "Ltd" | "LLP"; incorporated?: string; registeredOffice?: string; level?: Level; responsible?: string };
export type Added = { error?: string; duplicate?: Row; client?: Row; profile?: Row };

/** A company that isn't an existing client: a Clients row marked Co Sec only, plus its profile. Refuses a number already on file. */
export function addCompany(c: NewCompany, clients: Row[], key: (p: string) => string, now: string, by: string): Added {
  if (!c.name.trim()) return { error: "Enter the company's registered name." };
  if (!validNumber(c.number)) return { error: "A company number is 8 characters, e.g. 01234567 or SC123456." };
  const dup = findDuplicate(clients, c.number);
  if (dup) return { duplicate: dup, error: `${str(dup.Title)} is already on file with that number.` };
  const ck = key("CL");
  const level = c.level || "monitoring";
  return {
    client: { Key: ck, Title: c.name.trim(), Kind: c.kind, CompanyNumber: normNumber(c.number), Incorporated: c.incorporated || "", RegisteredOffice: c.registeredOffice || "", Status: COSEC_ONLY },
    profile: { Key: key("CP"), ClientKey: ck, Level: level, Responsible: c.responsible || "", FilesCS01: "", Notes: "", Created: now, CreatedBy: by, Updated: now },
  };
}

/** Set a service level on an existing company: creates the profile or updates it. */
export function setLevel(client: Row, profiles: Row[], level: Level, key: (p: string) => string, now: string, by: string, extra: Partial<{ responsible: string; filesCs01: boolean | null; notes: string }> = {}): { create?: Row; patch?: { row: Row; patch: Row } } {
  const row = profiles.find((x) => str(x.ClientKey) === str(client.Key));
  const fields: Row = { Level: level, Updated: now };
  if (extra.responsible !== undefined) fields.Responsible = extra.responsible;
  if (extra.filesCs01 !== undefined) fields.FilesCS01 = extra.filesCs01 === null ? "" : extra.filesCs01 ? "yes" : "no";
  if (extra.notes !== undefined) fields.Notes = extra.notes;
  return row ? { patch: { row, patch: fields } } : { create: { Key: key("CP"), ClientKey: str(client.Key), Responsible: "", FilesCS01: "", Notes: "", Created: now, CreatedBy: by, ...fields } };
}

export type Counts = { total: number; managed: number; monitoring: number; other: number; notClients: number; cs01Overdue: number; cs01Soon: number; accountsOverdue: number; accountsSoon: number; outstanding: number };
/** Dashboard figures. Dates come from the portfolio rows, which already prefer Companies House. */
export function counts(clients: Row[], profiles: Row[], rows: { key: string; cs: { date: string }; accounts: { date: string }; openFilings: number }[], today: string, soonDays = 60): Counts {
  const byKey = new Map(clients.map((c) => [str(c.Key), c]));
  const out: Counts = { total: 0, managed: 0, monitoring: 0, other: 0, notClients: 0, cs01Overdue: 0, cs01Soon: 0, accountsOverdue: 0, accountsSoon: 0, outstanding: 0 };
  const days = (d: string) => Math.round((Date.parse(d) - Date.parse(today)) / 86400000);
  for (const r of rows) {
    const c = byKey.get(r.key);
    if (!c || !companyKind(c)) continue;
    const p = profileFor(c, profiles);
    out.total++;
    if (p.level === "managed" || p.level === "filings") out.managed++;
    else if (p.level === "monitoring") out.monitoring++;
    else out.other++;
    if (str(c.Status).toLowerCase() === COSEC_ONLY) out.notClients++;
    if (p.level !== "historical") {
      if (r.cs.date && filesCs01(p)) { const d = days(r.cs.date); if (d < 0) out.cs01Overdue++; else if (d <= soonDays) out.cs01Soon++; }
      if (r.accounts.date && responsible(p.level)) { const d = days(r.accounts.date); if (d < 0) out.accountsOverdue++; else if (d <= soonDays) out.accountsSoon++; }
    }
    out.outstanding += r.openFilings;
  }
  return out;
}
