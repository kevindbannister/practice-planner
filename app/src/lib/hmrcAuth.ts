// HMRC agent authorisations: the shared model for Corporation Tax, Employer PAYE and VAT (MTD).
// One record per client and tax service, plus an append-only history. Only an answer read back from
// HMRC counts as confirmed; everything else (a manual note, a client's say-so) is labelled as such.
import { Row } from "./schema";

export type TaxService = "vat" | "ct" | "paye";
export const SERVICES: { key: TaxService; label: string; hmrcName: string }[] = [
  { key: "vat", label: "VAT (Making Tax Digital)", hmrcName: "MTD-VAT" },
  { key: "ct", label: "Corporation Tax", hmrcName: "CT" },
  { key: "paye", label: "Employer PAYE", hmrcName: "PAYE" },
];
export const serviceLabel = (s: string) => SERVICES.find((x) => x.key === s)?.label || s;

export type AuthStatus = "not-requested" | "awaiting-client" | "awaiting-code" | "authorised" | "rejected" | "cancelled" | "expired" | "failed" | "ended";
export const STATUS_LABEL: Record<AuthStatus, string> = {
  "not-requested": "Not requested", "awaiting-client": "Awaiting client", "awaiting-code": "Awaiting postal code", authorised: "Authorised",
  rejected: "Rejected", cancelled: "Cancelled", expired: "Expired", failed: "Request failed", ended: "Authorisation ended",
};
export const STATUS_CHIP: Record<AuthStatus, string> = {
  "not-requested": "red", "awaiting-client": "amber", "awaiting-code": "amber", authorised: "green", rejected: "red", cancelled: "gray", expired: "red", failed: "red", ended: "gray",
};

/** Where the current status came from. Only "hmrc" is HMRC's own word. */
export type StatusSource = "none" | "hmrc" | "manual" | "client";
export const SOURCE_LABEL: Record<StatusSource, string> = { none: "", hmrc: "Confirmed by HMRC", manual: "Recorded by staff (not checked with HMRC)", client: "Reported by the client (not checked with HMRC)" };
export const verified = (r: { status: AuthStatus; source: StatusSource }) => r.status === "authorised" && r.source === "hmrc";

/** What HMRC's Agent Authorisation API says about an invitation, mapped to ours. Unknown values map to null, never to authorised. */
export function fromHmrcStatus(s: unknown): AuthStatus | null {
  switch (String(s || "").trim().toLowerCase()) {
    case "pending": return "awaiting-client";
    case "accepted": return "authorised";
    case "rejected": return "rejected";
    case "cancelled": case "canceled": return "cancelled";
    case "expired": return "expired";
    default: return null;
  }
}

export type Method = "api" | "xml" | "guided";
export type AuthRecord = {
  key: string; clientKey: string; service: TaxService; ref: string; method: Method; hmrcId: string; status: AuthStatus; source: StatusSource;
  requested: string; expires: string; authorised: string; checked: string; owner: string; onboarding: string; notes: string; env: string;
};
const txt = (v: unknown) => (v == null ? "" : String(v));
const STATUSES = Object.keys(STATUS_LABEL) as AuthStatus[];
export function readRecord(r: Row): AuthRecord {
  const st = txt(r.Status) as AuthStatus;
  const src = txt(r.StatusSource) as StatusSource;
  return {
    key: txt(r.Key), clientKey: txt(r.ClientKey), service: (txt(r.Service) || "vat") as TaxService, ref: txt(r.TaxRef), method: (txt(r.Method) || "guided") as Method,
    hmrcId: txt(r.HmrcId), status: STATUSES.includes(st) ? st : "not-requested", source: ["hmrc", "manual", "client"].includes(src) ? src : "none",
    requested: txt(r.Requested), expires: txt(r.Expires), authorised: txt(r.AuthorisedOn), checked: txt(r.LastChecked), owner: txt(r.Owner), onboarding: txt(r.OnboardingKey), notes: txt(r.Notes), env: txt(r.Env),
  };
}

/** Which services a client could need, from the kind of client. Staff can still add one by hand. */
export function relevantServices(c: Row): TaxService[] {
  const kind = txt(c.Kind);
  const out: TaxService[] = [];
  if (txt(c.VATNumber)) out.push("vat");
  if (kind === "Ltd") out.push("ct");
  if (txt(c.PAYERef) || txt(c.AccountsOfficeRef)) out.push("paye");
  return out;
}

// ------------------------------------------------------------------ checks

export const cleanVrn = (v: unknown) => txt(v).replace(/\s+/g, "").replace(/^GB/i, "");
const realDate = (s: string) => { const d = new Date(`${s}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; };

/** Problems that stop a VAT invitation being sent (empty = ready). */
export function vatProblems(client: Row, today: string): string[] {
  const out: string[] = [];
  if (!/^\d{9}$/.test(cleanVrn(client.VATNumber))) out.push("The VAT number must be 9 digits.");
  const reg = txt(client.VATRegistered).slice(0, 10);
  if (!reg) out.push("The VAT registration date is needed.");
  else if (!realDate(reg)) out.push("The VAT registration date isn't a real date.");
  else if (reg > today) out.push("The VAT registration date can't be in the future.");
  return out;
}

/** The body HMRC's invitation call takes for VAT. */
export function vatInvitation(client: Row) {
  return { service: "MTD-VAT", clientType: txt(client.Kind) === "Individual" || txt(client.Kind) === "Sole trader" ? "personal" : "business", clientIdType: "vrn", clientId: cleanVrn(client.VATNumber), knownFact: txt(client.VATRegistered).slice(0, 10) };
}

// ------------------------------------------------------------------ what to do next

export type Next = { action: string; urgent: boolean };
export function nextAction(r: AuthRecord | undefined, today: string): Next {
  if (!r || r.status === "not-requested") return { action: "Request authorisation", urgent: false };
  const days = r.expires ? Math.round((Date.parse(r.expires.slice(0, 10)) - Date.parse(today)) / 86400000) : null;
  switch (r.status) {
    case "awaiting-client": return days !== null && days <= 5 ? { action: `Chase the client: expires ${days <= 0 ? "today" : `in ${days} day${days === 1 ? "" : "s"}`}`, urgent: true } : { action: "Waiting for the client to approve", urgent: false };
    case "awaiting-code": return { action: "Enter the code when it arrives by post", urgent: false };
    case "authorised": return r.source === "hmrc" ? { action: "None", urgent: false } : { action: "Check the authorisation with HMRC", urgent: true };
    case "failed": return { action: "Fix the problem and try again", urgent: true };
    case "ended": return { action: "Request authorisation again", urgent: true };
    default: return { action: "Start a new request", urgent: true };
  }
}

// ------------------------------------------------------------------ history

export type EventType = "created" | "submitted" | "hmrc-response" | "client-notified" | "reminder" | "code-received" | "code-submitted" | "confirmed" | "expired" | "cancelled" | "manual";
/** An audit entry. Never holds tokens, passwords or authorisation codes: only the facts of what happened. */
export function auditRow(a: { key: string; clientKey: string; service: TaxService; type: EventType; summary: string; user: string; at: string; status?: AuthStatus; source?: StatusSource; hmrcId?: string }): Row {
  return { Key: a.key, ClientKey: a.clientKey, Service: a.service, Type: a.type, Summary: a.summary.slice(0, 500), Status: a.status || "", StatusSource: a.source || "", HmrcId: a.hmrcId || "", Actor: a.user, At: a.at };
}
