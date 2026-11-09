// One person, several clients: someone you act for personally may also own or run a company you act for. Their identity, PEP and
// sanctions check is done once, on their own (individual) client record, and the company's AML uses it instead of checking them again.
// A company's owner is linked to the person's own client (Owner.clientKey); the planner suggests the link when the names match.
import { readAssessment, asStatus } from "./amlAssessment";
import { Owner } from "./onboarding";
import { Row } from "./schema";
import { amlStampRead, idStampRead } from "./xamaActions";

const str = (v: unknown): string => (v === undefined || v === null ? "" : String(v));
const TITLES = new Set(["mr", "mrs", "ms", "miss", "mx", "dr", "sir", "dame", "prof", "professor", "lord", "lady", "rev"]);

/** First and last name, lower case, without titles or punctuation: "Mr John A. Smith" and "john smith" match. */
export function personKey(name: string): string {
  const t = str(name).toLowerCase().replace(/[^a-z\s'-]/g, " ").split(/\s+/).filter((w) => w && !TITLES.has(w));
  return t.length >= 2 ? `${t[0]} ${t[t.length - 1]}` : t.join(" ");
}
export const samePerson = (a: string, b: string) => { const x = personKey(a); return x.includes(" ") && x === personKey(b); };

export const isIndividual = (c: Row) => str(c.Kind) === "Individual" && !c.CeasedOn;

export type Cover = { done: boolean; kinds: string[]; on: string; how: string };
/** What Xama has checked for a person on their own client record. The AML check covers identity, address, PEP and sanctions; ID verification covers identity. */
export function coverOf(c: Row | undefined): Cover {
  if (!c) return { done: false, kinds: [], on: "", how: "" };
  const aml = amlStampRead(c.XamaAmlCheck), id = idStampRead(c.XamaIdCheck);
  if (aml.state === "done") return { done: true, kinds: ["Identity verified", "Address verified", "Sanctions and PEP screening"], on: aml.on, how: "Xama AML check (identity, address, PEP and sanctions)" };
  if (id.state === "done") return { done: true, kinds: ["Identity verified"], on: id.on, how: "Xama ID verification (identity only)" };
  return { done: false, kinds: [], on: "", how: aml.state === "check" ? "Xama AML check found a possible match" : "" };
}

/** Individual clients that look like the same person, not counting the client itself. */
export function suggestFor(name: string, clients: Row[], selfKey: string): Row[] {
  return clients.filter((c) => isIndividual(c) && c.Key !== selfKey && samePerson(str(c.Title), name));
}

export type OwnerCover = { owner: Owner; client?: Row; cover: Cover; suggest: Row[] };
export function ownerCover(owners: Owner[], clients: Row[], selfKey: string): OwnerCover[] {
  return owners.filter((o) => o.name.trim()).map((owner) => {
    const client = owner.clientKey ? clients.find((c) => c.Key === owner.clientKey) : undefined;
    return { owner, client, cover: coverOf(client), suggest: client ? [] : suggestFor(owner.name, clients, selfKey) };
  });
}
/** Every owner is linked to their own client and checked there: "AML" when all have the full AML check, "ID" when all at least have ID. */
export function ownersCovered(oc: OwnerCover[]): "" | "ID" | "AML" {
  if (!oc.length || oc.some((x) => !x.cover.done)) return "";
  return oc.every((x) => x.cover.kinds.includes("Sanctions and PEP screening")) ? "AML" : "ID";
}

/** The checks to add to a company's assessment for its linked owners, skipping any already added. */
export function ownerChecks(oc: OwnerCover[], existing: { note: string }[], today: string): { id: string; kind: string; result: "pass"; by: string; at: string; note: string }[] {
  const out: { id: string; kind: string; result: "pass"; by: string; at: string; note: string }[] = [];
  for (const x of oc) {
    if (!x.cover.done || !x.client) continue;
    const note = `${x.owner.name}: ${x.cover.how} on their own client record (${str(x.client.Title)})`;
    if (existing.some((c) => c.note.startsWith(`${x.owner.name}: Xama`))) continue;
    for (const kind of x.cover.kinds) out.push({ id: "", kind, result: "pass", by: "Xama", at: x.cover.on || today, note });
  }
  return out;
}

/** The other clients this person's check covers: companies where they are a linked owner, or the Xama main contact. */
export function alsoCovers(person: Row, clients: Row[], assessments: Row[]): { client: Row; as: string }[] {
  const out: { client: Row; as: string }[] = [];
  for (const c of clients) {
    if (c.Key === person.Key || c.CeasedOn) continue;
    const rows = assessments.filter((r) => r.ClientKey === c.Key && ["inprogress", "approved", "declined"].includes(asStatus(r.Status))).sort((a, b) => str(b.Created).localeCompare(str(a.Created)));
    const o = rows[0] ? readAssessment(rows[0]).owners.find((x) => x.clientKey === person.Key) : undefined;
    if (o) out.push({ client: c, as: `owner${o.percent ? ` (${o.percent}%)` : ""}` });
    else if (str(c.XamaContact) && samePerson(str(c.XamaContact), str(person.Title))) out.push({ client: c, as: "Xama main contact" });
  }
  return out;
}

/** For a company: its Xama main contact, if that person is an individual client already checked on their own record. */
export function contactCover(company: Row, clients: Row[]): { client: Row; cover: Cover } | null {
  const name = str(company.XamaContact);
  if (!name) return null;
  const c = suggestFor(name, clients, str(company.Key))[0];
  return c ? { client: c, cover: coverOf(c) } : null;
}
