// Politically exposed persons (MLR 2017 reg 35). When the client, a beneficial owner or someone acting for them is a PEP, a family member of
// one or a known close associate, the firm must: have senior management approve the relationship, establish source of wealth and source of
// funds, and monitor the relationship more closely. The measures continue for at least 12 months after the person leaves office.
// Enhanced due diligence: when a client needs EDD, the firm's policy lists the extra steps; if it includes source of funds and wealth, a passed
// check of that kind is needed before approval.
import { Check } from "./onboarding";
import { addMonths } from "./planning";

const str = (v: unknown): string => (v === undefined || v === null ? "" : String(v));
export type PepKind = "pep" | "family" | "kca";
export const PEP_KINDS: { v: PepKind; label: string }[] = [{ v: "pep", label: "PEP" }, { v: "family", label: "Family member of a PEP" }, { v: "kca", label: "Known close associate of a PEP" }];
export type PepPerson = { name: string; kind: PepKind; role: string; where: "" | "uk" | "abroad"; left: string; sow: string; sof: string };
export type Pep = { status: "" | "no" | "yes"; people: PepPerson[] };
export const EMPTY_PEP: Pep = { status: "", people: [] };
export const blankPep = (): PepPerson => ({ name: "", kind: "pep", role: "", where: "", left: "", sow: "", sof: "" });

export function readPep(v: unknown): Pep {
  try {
    const o = JSON.parse(str(v) || "{}");
    const status = o.status === "yes" || o.status === "no" ? o.status : "";
    const people = Array.isArray(o.people) ? o.people.map((p: any) => ({ name: str(p.name), kind: (["pep", "family", "kca"].includes(p.kind) ? p.kind : "pep") as PepKind, role: str(p.role), where: (["uk", "abroad"].includes(p.where) ? p.where : "") as PepPerson["where"], left: str(p.left), sow: str(p.sow), sof: str(p.sof) })) : [];
    return { status, people };
  } catch { return EMPTY_PEP; }
}

/** PEP measures can end, if the risk allows, 12 months after the person left office. */
export const pepUntil = (left: string) => (/^\d{4}-\d{2}-\d{2}$/.test(left) ? addMonths(left, 12, false) : "");

/** What stops approval. The approval itself is the senior management approval reg 35 requires, so it needs approval rights. */
export function pepProblems(p: Pep, risk: string): string[] {
  const out: string[] = [];
  if (!p.status) return ["Say whether the client, an owner or anyone acting for them is a politically exposed person, a family member or a close associate of one."];
  if (p.status === "no") return out;
  const people = p.people.filter((x) => x.name.trim());
  if (!people.length) out.push("Name the politically exposed person.");
  for (const x of people) {
    if (!x.role.trim()) out.push(`Say what public role makes ${x.name} a PEP${x.kind === "pep" ? "" : " (or the PEP they are connected to)"}.`);
    if (!x.sow.trim()) out.push(`Record the source of wealth for ${x.name}.`);
    if (!x.sof.trim()) out.push(`Record the source of funds for ${x.name}.`);
  }
  if (risk && risk !== "high") out.push("A politically exposed person means enhanced due diligence, so the overall rating has to be High.");
  return out;
}

/** Enhanced due diligence needs a passed source of funds or wealth check when the firm's policy lists that step. */
export function eddProblems(eddNeeded: boolean, checks: Check[], policySof: boolean): string[] {
  if (!eddNeeded || !policySof) return [];
  return checks.some((c) => c.result === "pass" && /source of funds|source of wealth/i.test(c.kind)) ? [] : ["Enhanced due diligence: your policy includes establishing source of funds and wealth, so record a passed \"Source of funds or wealth\" check."];
}
