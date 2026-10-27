// A client's tax references, grouped by tax (VAT, Corporation Tax, PAYE, Self Assessment), with the
// HMRC agent authorisation for each, masked sensitive codes and gentle format checks. References stay
// on the client record; authorisations are rows in the Authorisations list.
import { Row } from "./schema";

export type RefField = { key: string; label: string; sensitive?: boolean; hint?: string };
export type RefGroup = { key: string; label: string; fields: RefField[]; auth?: string; note?: string };
export const AUTH_LABEL: Record<string, string> = { vat: "VAT", ct: "Corporation Tax", paye: "PAYE", sa: "Self Assessment", cis: "CIS" };

const company = (k: unknown) => k === "Ltd" || k === "LLP";
export function groupsFor(c: Row): RefGroup[] {
  const kind = c.Kind;
  const out: RefGroup[] = [];
  if (company(kind)) out.push({ key: "ch", label: "Companies House", fields: [{ key: "CompanyNumber", label: "Company number" }, { key: "CHAuthCode", label: "Authentication code", sensitive: true }] });
  out.push({ key: "vat", label: "VAT", auth: "vat", fields: [{ key: "VATNumber", label: "VAT number" }, { key: "VATRegistered", label: "Registered from" }, { key: "MTDServices", label: "Making Tax Digital for" }] });
  if (kind === "Ltd") out.push({ key: "ct", label: "Corporation Tax", auth: "ct", fields: [{ key: "CTUTR", label: "Company UTR", sensitive: true }] });
  out.push({ key: "paye", label: "PAYE", auth: "paye", fields: [{ key: "PAYERef", label: "PAYE reference" }, { key: "AccountsOfficeRef", label: "Accounts Office reference" }], note: String(c.CISStatus) === "registered" ? "CIS contractor: uses these references." : undefined });
  if (!company(kind)) out.push({ key: "sa", label: "Self Assessment", auth: "sa", fields: [{ key: "UTR", label: "UTR", sensitive: true }, { key: "NINumber", label: "National Insurance number", sensitive: true }] });
  else out.push({ key: "sa", label: "Directors' Self Assessment", fields: [{ key: "UTR", label: "UTR (main contact)", sensitive: true }, { key: "NINumber", label: "National Insurance number", sensitive: true }] });
  return out;
}
export const allFields = (c: Row): [string, string][] => groupsFor(c).flatMap((g) => g.fields.map((f) => [f.key, f.label] as [string, string]));

/** A sensitive code shown as dots with the last two characters, so it can be recognised without being read aloud. */
export function mask(v: string): string {
  const s = v.trim();
  if (s.length <= 4) return "•".repeat(s.length);
  return `${"•".repeat(Math.min(8, s.length - 2))}${s.slice(-2)}`;
}

/** A problem with the format, or nothing. A guide only: it never blocks saving. */
export function check(key: string, raw: unknown): string {
  const v = String(raw ?? "").replace(/\s+/g, "");
  if (!v) return "";
  switch (key) {
    case "UTR": case "CTUTR": return /^\d{10}$/.test(v.replace(/^k/i, "")) ? "" : "A UTR is 10 digits.";
    case "VATNumber": return /^(GB)?\d{9}(\d{3})?$/i.test(v) ? "" : "A VAT number is 9 digits (optionally starting GB).";
    case "NINumber": return /^[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z]\d{6}[A-D]?$/i.test(v) ? "" : "A National Insurance number looks like AB123456C.";
    case "PAYERef": return /^\d{3}\/[A-Z0-9]{1,10}$/i.test(v) ? "" : "A PAYE reference looks like 123/AB456.";
    case "AccountsOfficeRef": return /^\d{3}P[A-Z]\d{8}([A-Z0-9]{1,5})?$/i.test(v) ? "" : "An Accounts Office reference looks like 123PA00012345.";
    case "CHAuthCode": return /^[A-Z0-9]{6}$/i.test(v) ? "" : "A Companies House authentication code is 6 characters.";
    case "CompanyNumber": return /^([A-Z]{2}\d{6}|\d{8})$/i.test(v) ? "" : "A company number is 8 characters, e.g. 01234567 or SC123456.";
    default: return "";
  }
}

export type AuthState = "none" | "requested" | "authorised" | "expiring" | "expired" | "refused";
export const AUTH_STATE_LABEL: Record<AuthState, string> = { none: "Not authorised", requested: "Link sent, waiting", authorised: "Authorised", expiring: "Authorised, expiring soon", expired: "Authorisation expired", refused: "Refused" };
export const AUTH_STATE_CHIP: Record<AuthState, string> = { none: "red", requested: "amber", authorised: "green", expiring: "amber", expired: "red", refused: "red" };

export function authRow(rows: Row[], clientKey: string, service: string): Row | undefined {
  return rows.filter((r) => r.ClientKey === clientKey && String(r.Service) === service).sort((a, b) => String(b.LinkSent || "").localeCompare(String(a.LinkSent || "")))[0];
}
export function authState(r: Row | undefined, today: string): AuthState {
  if (!r) return "none";
  const st = String(r.Status || "").toLowerCase();
  const exp = String(r.Expiry || "").slice(0, 10);
  if (st === "refused") return "refused";
  if (st === "authorised") {
    if (exp && exp < today) return "expired";
    if (exp && (Date.parse(exp) - Date.parse(today)) / 86400000 <= 30) return "expiring";
    return "authorised";
  }
  return st === "requested" || r.LinkSent ? "requested" : "none";
}
