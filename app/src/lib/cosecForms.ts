// Company secretarial: the Companies House forms the planner prepares, and the address and officer helpers they share.
// This is data, not logic: to prepare a new kind of filing, add it here and add a rule in cosec.ts.
import { Row } from "./schema";

export type CompanyKind = "limited" | "llp";
export type FormDef = { id: string; title: string; applies: CompanyKind[]; /** Can be sent from the planner through the Companies House gateway (api/cosec). Only forms with a message built and tested there. */ gateway: boolean; /** Nothing is sent to Companies House for this: it is completed inside the planner and reported in the next confirmation statement. */ noFiling?: boolean };

export const FORMS: FormDef[] = [
  { id: "AD01", title: "Change of registered office address", applies: ["limited", "llp"], gateway: true },
  { id: "NM01", title: "Change of name by special resolution", applies: ["limited"], gateway: false },
  { id: "CS01", title: "Confirmation statement", applies: ["limited", "llp"], gateway: false },
  { id: "AA01", title: "Change of accounting reference date", applies: ["limited", "llp"], gateway: false },
  { id: "AP01", title: "Appointment of a director", applies: ["limited"], gateway: false },
  { id: "AP02", title: "Appointment of a corporate director", applies: ["limited"], gateway: false },
  { id: "AP03", title: "Appointment of a secretary", applies: ["limited"], gateway: false },
  { id: "AP04", title: "Appointment of a corporate secretary", applies: ["limited"], gateway: false },
  { id: "TM01", title: "Termination of a director's appointment", applies: ["limited"], gateway: false },
  { id: "TM02", title: "Termination of a secretary's appointment", applies: ["limited"], gateway: false },
  { id: "CH01", title: "Change of a director's details", applies: ["limited"], gateway: false },
  { id: "CH02", title: "Change of a corporate director's details", applies: ["limited"], gateway: false },
  { id: "CH03", title: "Change of a secretary's details", applies: ["limited"], gateway: false },
  { id: "CH04", title: "Change of a corporate secretary's details", applies: ["limited"], gateway: false },
  { id: "LLAP01", title: "Appointment of a member of an LLP", applies: ["llp"], gateway: false },
  { id: "LLAP02", title: "Appointment of a corporate member of an LLP", applies: ["llp"], gateway: false },
  { id: "LLTM01", title: "Termination of a member of an LLP", applies: ["llp"], gateway: false },
  { id: "LLCH01", title: "Change of a member's details", applies: ["llp"], gateway: false },
  { id: "LLCH02", title: "Change of a corporate member's details", applies: ["llp"], gateway: false },
  { id: "PSC01", title: "Notice of an individual person with significant control", applies: ["limited", "llp"], gateway: false },
  { id: "PSC02", title: "Notice of a relevant legal entity with significant control", applies: ["limited", "llp"], gateway: false },
  { id: "PSC03", title: "Notice of another registrable person with significant control", applies: ["limited", "llp"], gateway: false },
  { id: "PSC04", title: "Change of an individual PSC's details", applies: ["limited", "llp"], gateway: false },
  { id: "PSC05", title: "Change of a relevant legal entity PSC's details", applies: ["limited", "llp"], gateway: false },
  { id: "PSC06", title: "Change of another registrable person's details", applies: ["limited", "llp"], gateway: false },
  { id: "PSC07", title: "Notice of ceasing to be a person with significant control", applies: ["limited", "llp"], gateway: false },
  { id: "SH01", title: "Return of allotment of shares", applies: ["limited"], gateway: false },
  { id: "STT", title: "Share transfer (nothing is filed; shown in the next confirmation statement)", applies: ["limited"], gateway: false, noFiling: true },
];
export const formDef = (id: string): FormDef | undefined => FORMS.find((f) => f.id === id);
export const formTitle = (id: string): string => formDef(id)?.title || id;

// ------------------------------------------------------------------ addresses

/** A statutory address split the way Companies House asks for it. */
export type Addr = { premises: string; line1: string; line2: string; town: string; county: string; country: string; postcode: string };
export const BLANK_ADDR: Addr = { premises: "", line1: "", line2: "", town: "", county: "", country: "", postcode: "" };
const POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;
const COUNTRIES = ["england", "wales", "scotland", "northern ireland", "united kingdom", "uk", "great britain"];
const asText = (v: unknown) => (v === undefined || v === null ? "" : String(v));

/**
 * A best-effort split of an address written on one line or several. Companies House needs the premises, first line, town,
 * country and postcode, and the person reviewing the draft completes or corrects whatever this couldn't tell.
 */
export function parseAddress(text: string): Addr {
  const parts = text.split(/[\n,]+/).map((p) => p.trim()).filter(Boolean);
  const a: Addr = { ...BLANK_ADDR };
  if (parts.length && POSTCODE.test(parts[parts.length - 1])) a.postcode = parts.pop()!.toUpperCase().replace(/^(\S+?)\s*(\d[A-Z]{2})$/, "$1 $2");
  if (parts.length && COUNTRIES.includes(parts[parts.length - 1].toLowerCase())) a.country = parts.pop()!;
  const first = parts.shift() || "";
  const m = first.match(/^(\d+[A-Za-z]?(?:\s*[-–]\s*\d+[A-Za-z]?)?|[^,]*?\b(?:house|court|building|buildings|centre|center|offices|suite|unit|floor)\b[^,]*?)\s+(.+)$/i);
  if (m && /^\d/.test(m[1])) { a.premises = m[1]; a.line1 = m[2]; } else if (m && parts.length) { a.premises = m[1]; a.line1 = m[2]; } else a.line1 = first;
  if (parts.length) a.town = parts.pop()!;
  if (parts.length && !a.county && parts.length > 1) a.county = parts.pop()!;
  if (parts.length) a.line2 = parts.join(", ");
  if (!a.country && a.postcode) a.country = "England";
  return a;
}
export const addrText = (a: Partial<Addr>): string => [[a.premises, a.line1].filter(Boolean).join(" "), a.line2, a.town, a.county, a.postcode, a.country].map(asText).filter((x) => x.trim()).join(", ");
/** What is still missing before an address can be filed. */
export function addrIssues(a: Partial<Addr>, label = "Address"): string[] {
  const out: string[] = [];
  if (!asText(a.line1).trim()) out.push(`${label}: first line`);
  if (!asText(a.town).trim()) out.push(`${label}: town`);
  if (!asText(a.postcode).trim() || !POSTCODE.test(asText(a.postcode).trim())) out.push(`${label}: a valid postcode`);
  if (!asText(a.country).trim()) out.push(`${label}: country`);
  return out;
}

// ------------------------------------------------------------------ officers and PSCs

export type OfficerRole = "director" | "secretary" | "member";
export const OFFICER_ROLES: [OfficerRole, string][] = [["director", "Director"], ["secretary", "Secretary"], ["member", "LLP member"]];
export type OfficerOp = "appoint" | "terminate" | "change";
/** Which form a director, secretary or LLP member change needs. */
export function officerForm(op: OfficerOp, o: Row, company: CompanyKind): string {
  const corporate = asText(o.Kind) === "corporate";
  const role = asText(o.Role) || "director";
  if (company === "llp" || role === "member") return op === "appoint" ? (corporate ? "LLAP02" : "LLAP01") : op === "terminate" ? "LLTM01" : corporate ? "LLCH02" : "LLCH01";
  if (role === "secretary") return op === "appoint" ? (corporate ? "AP04" : "AP03") : op === "terminate" ? "TM02" : corporate ? "CH04" : "CH03";
  return op === "appoint" ? (corporate ? "AP02" : "AP01") : op === "terminate" ? "TM01" : corporate ? "CH02" : "CH01";
}
export type PscKind = "individual" | "legal-entity" | "other";
export const PSC_KINDS: [PscKind, string][] = [["individual", "Individual"], ["legal-entity", "Relevant legal entity"], ["other", "Other registrable person"]];
export function pscForm(op: OfficerOp, p: Row): string {
  const k = asText(p.Kind) || "individual";
  const n = k === "individual" ? 1 : k === "legal-entity" ? 2 : 3;
  return op === "appoint" ? `PSC0${n}` : op === "terminate" ? "PSC07" : `PSC0${n + 3}`;
}
export const officerName = (o: Row): string => (asText(o.Kind) === "corporate" ? asText(o.CorporateName) : [o.Title, o.First, o.Last].map(asText).filter(Boolean).join(" ")) || "Unnamed";
export const pscName = (p: Row): string => (asText(p.Kind) === "individual" || !asText(p.Kind) ? [p.Title, p.First, p.Last].map(asText).filter(Boolean).join(" ") : asText(p.CorporateName)) || "Unnamed";
