// What Company Secretarial already knows about a company's owners and controllers, for the AML review: shareholders worked out from the
// share ledger, people with significant control, directors, and whether each has had their identity verified for Companies House. It only
// reads; the review's owners are filled from it when a person chooses to, and the person still judges beneficial ownership.
import { cosecIdOf } from "./amlCosecId";
import { officerName, pscName } from "./cosecForms";
import { owners as ledgerOwners, pscCheck } from "./cosecShares";
import { readEntry } from "./shareLedger";
import { Owner } from "./onboarding";
import { Row } from "./schema";

const str = (v: unknown): string => (v == null ? "" : String(v).trim());
const norm = (s: string) => s.toLowerCase().replace(/\b(mr|mrs|ms|miss|dr|mx)\b\.?/g, "").replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();

export type Person = { name: string; roles: string[]; sharePercent: number | null; votePercent: number | null; psc: boolean; natures: string; corporate: boolean; id: "" | "verified" | "pending" | "exempt"; idOn: string };
export type CosecOwnership = { hasData: boolean; people: Person[]; suggested: Owner[]; findings: string[]; issued: number };

const natureText = (r: Row): string => {
  let n: string[] = [];
  try { const j = JSON.parse(str(r.Natures)); n = Array.isArray(j) ? j.map(String) : []; } catch { n = str(r.Natures) ? [str(r.Natures)] : []; }
  return n.map((x) => x.replace(/-/g, " ")).join("; ");
};

export function cosecOwnership(clientKey: string, d: { cosecLedger: Row[]; cosecShareClasses: Row[]; cosecOfficers: Row[]; cosecPscs: Row[] }, today: string): CosecOwnership {
  const entries = d.cosecLedger.filter((r) => str(r.ClientKey) === clientKey).map(readEntry);
  const own = ledgerOwners(entries, d.cosecShareClasses, clientKey, today);
  const officers = d.cosecOfficers.filter((o) => str(o.ClientKey) === clientKey && str(o.Status) === "current");
  const pscs = d.cosecPscs.filter((p) => str(p.ClientKey) === clientKey && str(p.Status) === "current");
  const by = new Map<string, Person>();
  const get = (name: string, corporate = false): Person => {
    const k = norm(name);
    let p = by.get(k);
    if (!p) { p = { name, roles: [], sharePercent: null, votePercent: null, psc: false, natures: "", corporate, id: "", idOn: "" }; by.set(k, p); }
    return p;
  };
  for (const o of own.owners) { const p = get(o.name); p.roles.push("Shareholder"); p.sharePercent = o.sharePercent; p.votePercent = o.votePercent; }
  for (const o of officers) { const p = get(officerName(o), str(o.Kind) === "corporate"); p.roles.push(str(o.Role) === "secretary" ? "Secretary" : str(o.Role) === "member" ? "LLP member" : "Director"); const c = cosecIdOf(o); p.id = c.id; p.idOn = c.on; }
  for (const o of pscs) { const p = get(pscName(o), str(o.Kind) !== "individual" && !!str(o.Kind)); p.psc = true; p.roles.push("Person with significant control"); p.natures = natureText(o); if (!p.id) { const c = cosecIdOf(o); p.id = c.id; p.idOn = c.on; } }
  const people = [...by.values()].sort((a, b) => (b.sharePercent ?? -1) - (a.sharePercent ?? -1) || a.name.localeCompare(b.name));

  const suggested: Owner[] = people.filter((p) => p.psc || (p.sharePercent ?? 0) > 25 || (p.votePercent ?? 0) > 25).map((p) => ({
    name: p.name, percent: p.sharePercent, note: [p.psc ? "Person with significant control" : "", (p.votePercent ?? 0) > 25 ? `${p.votePercent}% of votes` : "", p.natures, p.corporate ? "A company or other entity: look through to the individuals behind it" : ""].filter(Boolean).join(". "),
  }));

  const findings: string[] = [];
  const hasData = entries.length > 0 || officers.length > 0 || pscs.length > 0;
  if (!entries.length) findings.push("No shareholdings are recorded in Company Secretarial, so ownership can't be worked out from the share ledger.");
  if (!pscs.length) findings.push("No person with significant control is recorded. A company with none should have a statement saying why.");
  for (const f of pscCheck(own, d.cosecPscs.filter((p) => str(p.ClientKey) === clientKey)).findings) findings.push(`${f.who}: ${f.detail}`);
  for (const p of people.filter((x) => x.corporate && (x.psc || (x.sharePercent ?? 0) > 25))) findings.push(`${p.name} is a company or other entity. The beneficial owners are the individuals who own or control it.`);
  const unverified = people.filter((p) => !p.corporate && (p.roles.some((r) => r !== "Shareholder") ) && p.id !== "verified" && p.id !== "exempt");
  if (unverified.length) findings.push(`Identity not recorded as verified for Companies House: ${unverified.map((p) => p.name).join(", ")}.`);
  if (own.problems.length) findings.push(`The share ledger has problems to fix first: ${own.problems[0]}`);
  return { hasData, people, suggested, findings, issued: own.issued };
}

/** Add suggested owners to those already on the review, matching on name so nothing is duplicated or overwritten. */
export function mergeOwners(current: Owner[], suggested: Owner[]): Owner[] {
  const out = [...current];
  for (const s of suggested) {
    const i = out.findIndex((o) => norm(o.name) === norm(s.name));
    if (i < 0) out.push(s);
    else out[i] = { ...out[i], percent: out[i].percent ?? s.percent, note: out[i].note || s.note, ...(out[i].clientKey || s.clientKey ? { clientKey: out[i].clientKey || s.clientKey } : {}) };
  }
  return out;
}
