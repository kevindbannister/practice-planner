// Company secretarial (the Co Sec module). Pure logic, like sales.ts and engagements.ts.
//
// One reusable service watches changes made anywhere in the planner and decides what they mean for the statutory record:
//   a change event  ->  a rule  ->  a draft filing, a flag, or nothing.
// A draft is never filed by itself. A person reviews it, approves it, and only then can it be sent. Nothing here overwrites
// the client's own records, and the four pictures of a company are kept apart: the planner's current data, the proposed
// change (the draft), what Companies House last showed (Clients.CHVerified), and the internal registers (CoSec lists).
import { Config } from "./checklist";
import { sameAddress, sameName } from "./companiesHouse";
import { Addr, CompanyKind, OfficerOp, addrIssues, addrText, formDef, formTitle, officerForm, officerName, parseAddress, pscForm, pscName } from "./cosecForms";
import { ProposalAction, proposalCan } from "./proposals";
import { Row } from "./schema";
import { Ctx, Written, activityRow, logRow } from "./sales";

const str = (v: unknown): string => (v === undefined || v === null ? "" : String(v));
const json = <T,>(v: unknown, fallback: T): T => { try { const x = JSON.parse(str(v)); return x === null || x === undefined ? fallback : x; } catch { return fallback; } };

// ------------------------------------------------------------------ states

export type TxStatus = "draft" | "info" | "approved" | "submitted" | "accepted" | "tested" | "rejected" | "declined" | "cancelled" | "external";
export const STATUS_LABEL: Record<TxStatus, string> = {
  draft: "Awaiting review", info: "Needs information", approved: "Approved, ready to submit", submitted: "Submitted, awaiting Companies House", accepted: "Accepted by Companies House",
  tested: "Accepted by TEST gateway (not filed)", rejected: "Rejected by Companies House", declined: "Declined by the practice", cancelled: "Cancelled", external: "Filed externally",
};
/** Still needs somebody's attention. */
export const OPEN_STATUSES: TxStatus[] = ["draft", "info", "approved", "submitted", "rejected", "tested"];
/** A draft that can still be changed. */
const EDITABLE: TxStatus[] = ["draft", "info", "approved", "rejected"];
export const txStatus = (tx: Row): TxStatus => (str(tx.Status) as TxStatus) || "draft";
export const isOpenTx = (tx: Row) => OPEN_STATUSES.includes(txStatus(tx));
export const NOT_FILED = "Not yet submitted to Companies House.";

export type Source = "client" | "portal" | "onboarding" | "ch-sync" | "cosec" | "import" | "other";
/** Changes that were already made at Companies House, or by the Co Sec module itself, never prepare a second filing. */
const NO_FILING_SOURCES: Source[] = ["ch-sync", "cosec", "import"];
export const SOURCE_LABEL: Record<string, string> = { client: "Main client record", portal: "Client portal (approved by staff)", onboarding: "Sales and onboarding", "ch-sync": "Companies House", cosec: "Co Sec", import: "Import", other: "Another part of the planner" };

// ------------------------------------------------------------------ permissions

export type CoSecAction = "view" | "edit" | "approve" | "submit" | "configure";
/**
 * Anyone who may edit client records can prepare and review. Approving and submitting need a manager or partner, and where independent
 * review is on, not the person who last edited the draft. With nobody set up (a one-person practice) everyone can do everything.
 */
export function cosecCan(cfg: Config, user: string, action: CoSecAction): boolean {
  const map: Record<CoSecAction, ProposalAction> = { view: "view", edit: "edit", approve: "send", submit: "send", configure: "configure" };
  return proposalCan(cfg, user, map[action]);
}

// ------------------------------------------------------------------ references and history

export type History = { at: string; by: string; what: string; note?: string };
export const historyOf = (tx: Row): History[] => json<History[]>(tx.History, []);
const pushHistory = (tx: Row, o: Ctx, what: string, note?: string): string => JSON.stringify([...historyOf(tx), { at: o.now, by: o.actor, what, ...(note ? { note } : {}) }]);

export function nextRef(txs: Row[], year: number): string {
  const prefix = `CS-${year}-`;
  const max = txs.map((t) => str(t.Ref)).filter((r) => r.startsWith(prefix)).map((r) => Number(r.slice(prefix.length)) || 0).reduce((a, b) => Math.max(a, b), 0);
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

export const companyKind = (client: Row): CompanyKind | "" => (str(client.Kind) === "Ltd" ? "limited" : str(client.Kind) === "LLP" ? "llp" : "");
const responsible = (client: Row): string => str(client.Manager) || str(client.Partner);

// ------------------------------------------------------------------ the snapshot the engine reads

export type Snapshot = { clients: Row[]; officers: Row[]; pscs: Row[]; shares: Row[]; txs: Row[]; events: Row[] };

/** What Companies House last showed, as kept in Clients.CHVerified. */
export type Verified = { at?: string; name?: string; office?: string; sic?: string; ard?: string };
export const verifiedOf = (client: Row): Verified => json<Verified>(client.CHVerified, {});

// ------------------------------------------------------------------ preparing a draft (the shared core)

export type Proposed = {
  clientKey: string; clientName: string; form: string; /** What the change is about, so repeated edits find the same draft. */ target: string; title: string; before: string; after: string; payload: Record<string, unknown>;
  source: Source; sourceKey: string; eventKey: string; assignee: string; note?: string; entity: string; entityKey: string; field: string;
};
export type Outcome = "draft" | "updated" | "cancelled" | "duplicate" | "ignored" | "info";
export type Prepared = Written & { outcome: Outcome; tx?: Row };
const norm = (v: unknown) => str(v).replace(/\s+/g, " ").trim().toLowerCase();
const same = (a: unknown, b: unknown) => norm(a) === norm(b) || (str(a).includes(" ") && str(b).includes(" ") && sameAddress(str(a), str(b)) && /\d/.test(str(a)));
const empty = (): Written => ({ patches: [], log: [], activities: [], creates: [] });

function eventRow(p: Proposed, outcome: Outcome, note: string, txKey: string, o: Ctx): Row {
  return { Key: o.newKey("CE"), PracticeId: o.pid, EventKey: p.eventKey, ClientKey: p.clientKey, Entity: p.entity, EntityKey: p.entityKey, Field: p.field, Before: p.before, After: p.after, Source: p.source, SourceKey: p.sourceKey, Actor: o.actor, At: o.now, Outcome: outcome, TxKey: txKey, Note: note };
}

/**
 * Turn one change into a draft filing, or into nothing, and say which. Nothing is submitted. The same change processed twice does
 * nothing the second time, a second edit to the same thing updates the draft already open, and changing it back cancels the draft.
 */
export function prepare(p: Proposed, snap: Pick<Snapshot, "txs" | "events">, o: Ctx): Prepared {
  const w = empty();
  if (snap.events.some((e) => str(e.EventKey) === p.eventKey)) return { ...w, outcome: "duplicate" };
  const event = (outcome: Outcome, note: string, txKey = "") => w.creates!.push({ list: "CoSecEvents", row: eventRow(p, outcome, note, txKey, o) });
  const refs = { clientKey: p.clientKey };

  if (NO_FILING_SOURCES.includes(p.source)) { event("info", p.source === "ch-sync" ? "Changed at Companies House: nothing to file." : "Made through Co Sec: its own filing covers this."); return { ...w, outcome: "info" }; }

  const mine = snap.txs.filter((t) => str(t.ClientKey) === p.clientKey && str(t.Target) === p.target);
  const open = mine.find((t) => EDITABLE.includes(txStatus(t)));
  if (open) {
    const key = str(open.Key);
    if (txStatus(open) !== "rejected" && same(p.after, open.Before)) {
      w.patches.push({ list: "CoSecTransactions", row: open, patch: { Status: "cancelled", History: pushHistory(open, o, "cancelled", "The change was put back, so there is nothing to file."), Updated: o.now } });
      w.log.push(logRow(o, "cancelled", "cosec", key, refs, { reason: "reverted", form: p.form }));
      w.activities.push(activityRow(o, "cosec-cancelled", `${p.form} draft cancelled: ${p.title}`, undefined, refs, "The change was reverted.", `cosec:cancelled:${key}:${o.now}`));
      event("cancelled", "Reverted.", key);
      return { ...w, outcome: "cancelled" };
    }
    if (same(p.after, open.After)) { event("duplicate", "Already in the open draft.", key); return { ...w, outcome: "duplicate" }; }
    const patch: Row = { After: p.after, Payload: JSON.stringify(p.payload), Status: "draft", ApprovedBy: "", ApprovedAt: "", ApprovedPayload: "", EventKeys: JSON.stringify([...json<string[]>(open.EventKeys, []), p.eventKey]), History: pushHistory(open, o, "updated", `Now ${p.after}`), Updated: o.now };
    w.patches.push({ list: "CoSecTransactions", row: open, patch });
    w.log.push(logRow(o, "updated", "cosec", key, refs, { form: p.form, after: p.after }));
    event("updated", "Changed again before filing: draft updated.", key);
    return { ...w, outcome: "updated", tx: { ...open, ...patch } };
  }
  const done = mine.filter((t) => txStatus(t) === "accepted" || txStatus(t) === "external").sort((a, b) => str(b.Updated).localeCompare(str(a.Updated)))[0];
  if (done && same(p.after, done.After)) { event("ignored", "Already filed and accepted.", str(done.Key)); return { ...w, outcome: "ignored" }; }

  const key = o.newKey("CT");
  const inFlight = mine.find((t) => txStatus(t) === "submitted");
  const tx: Row = {
    Key: key, PracticeId: o.pid, Ref: nextRef(snap.txs, Number(o.now.slice(0, 4))), ClientKey: p.clientKey, Form: p.form, Title: p.title, Status: "draft", Target: p.target, Source: p.source, SourceKey: p.sourceKey,
    Before: p.before, After: p.after, Payload: JSON.stringify(p.payload), Assignee: p.assignee, EventKeys: JSON.stringify([p.eventKey]), Clarification: "", Due: "", EditedBy: "", ApprovedBy: "", ApprovedAt: "", ApprovedPayload: "",
    SubmittedBy: "", SubmittedAt: "", GatewayRef: "", GatewayEnvironment: "", GatewayStatus: "", GatewayNote: "", ChRef: "", AcceptedAt: "", RejectReason: "",
    History: JSON.stringify([{ at: o.now, by: o.actor, what: "prepared", note: [p.note, inFlight ? `A filing for this (${inFlight.Ref}) is already with Companies House.` : "", NOT_FILED].filter(Boolean).join(" ") }]), Created: o.now, CreatedBy: o.actor, Updated: o.now,
  };
  w.creates!.push({ list: "CoSecTransactions", row: tx });
  w.log.push(logRow(o, "prepared", "cosec", key, refs, { form: p.form, source: p.source, before: p.before, after: p.after }));
  w.activities.push(activityRow(o, "cosec-prepared", `${p.form} prepared for review: ${p.title}`, undefined, refs, `${p.before ? `From ${p.before} to ` : ""}${p.after}. ${NOT_FILED}`, `cosec:prepared:${key}`));
  event("draft", p.note || "Draft prepared for review.", key);
  return { ...w, outcome: "draft", tx };
}

const mergeV = (a: Written, b: CoSecWritten): CoSecWritten => ({ ...merge(a, b), verified: b.verified });
const merge = (a: Written, b: Written): Written => ({ patches: [...a.patches, ...b.patches], log: [...a.log, ...b.log], activities: [...a.activities, ...b.activities], creates: [...(a.creates || []), ...(b.creates || [])] });

// ------------------------------------------------------------------ rules: what a change in a client record means

export type ClientChange = { client: Row; patch: Row; source: Source; /** One id for this change (it makes processing it twice harmless). */ changeId: string };
type Assessment = { kind: "draft"; form: string; target: string; title: string; payload: Record<string, unknown>; before: string; after: string; note?: string } | { kind: "info"; why: string } | { kind: "ignore"; why: string };
type Rule = { field: string; assess: (c: { client: Row; before: string; after: string; kind: CompanyKind | ""; verified: Verified }) => Assessment | Assessment[] };

const hasCompanyNumber = (c: Row) => !!str(c.CompanyNumber).trim();

/**
 * The rules, one per watched field. To prepare a new kind of filing, add a rule here (and its form in cosecForms.ts): nothing else
 * needs to change. A rule says what the change means; it never decides whether to file.
 */
export const RULES: Rule[] = [
  { field: "RegisteredOffice", assess: ({ client, before, after, kind, verified }) => {
    if (!kind || !hasCompanyNumber(client)) return { kind: "ignore", why: "Not a registered company." };
    if (!before.trim()) return { kind: "ignore", why: "Registered office recorded for the first time." };
    if (verified.office && sameAddress(verified.office, after)) return { kind: "ignore", why: "Companies House already shows this address." };
    if (!after.trim()) return { kind: "ignore", why: "Address cleared: nothing to file." };
    return { kind: "draft", form: "AD01", target: "client:RegisteredOffice", title: `Registered office: ${after}`, payload: { address: parseAddress(after), previous: before }, before, after };
  } },
  { field: "Title", assess: ({ client, before, after, kind, verified }) => {
    if (!kind || !hasCompanyNumber(client)) return { kind: "ignore", why: "Not a registered company." };
    if (!before.trim()) return { kind: "ignore", why: "Name recorded for the first time." };
    if (sameName(before, after)) return { kind: "ignore", why: "Only the capital letters or punctuation changed." };
    if (verified.name && sameName(verified.name, after)) return { kind: "ignore", why: "Companies House already shows this name." };
    return { kind: "draft", form: "NM01", target: "client:Name", title: `Company name: ${after}`, payload: { newName: after, previous: before }, before, after, note: "A change of name needs a special resolution and the company's decision. Start the name-change process; this is not a simple update." };
  } },
  { field: "YearEnd", assess: ({ client, before, after, kind, verified }) => {
    if (!kind || !hasCompanyNumber(client)) return { kind: "ignore", why: "Not a registered company." };
    if (!before.trim()) return { kind: "ignore", why: "Year end recorded for the first time." };
    if (norm(before) === norm(after)) return { kind: "ignore", why: "No change." };
    if (verified.ard && norm(verified.ard) === norm(after)) return { kind: "ignore", why: "Companies House already shows this date." };
    return { kind: "draft", form: "AA01", target: "client:AccountingReferenceDate", title: `Accounting reference date: ${after}`, payload: { newDate: after, previous: before }, before, after, note: "Check the extension and shortening rules before filing." };
  } },
  { field: "SIC", assess: ({ client, kind }) => (kind && hasCompanyNumber(client) ? { kind: "info", why: "SIC codes are changed when the confirmation statement is filed. Flagged for that review." } : { kind: "ignore", why: "Not a registered company." }) },
  { field: "TradingAddress", assess: () => ({ kind: "ignore", why: "The trading address is not a statutory address." }) },
  { field: "CorrespondenceAddress", assess: () => ({ kind: "ignore", why: "The correspondence address is not a statutory address." }) },
];
const WATCHED = new Set([...RULES.map((r) => r.field), "HomeAddress"]);

/**
 * A change to a client record. Only fields the rules know about are looked at, and each is compared with what was there. The home
 * address and name of an individual client also reach the director or PSC records linked to that person.
 */
export function detectClientChange(c: ClientChange, snap: Snapshot, o: Ctx): Written & { outcomes: { field: string; outcome: Outcome | "skipped" }[] } {
  let w = empty();
  const outcomes: { field: string; outcome: Outcome | "skipped" }[] = [];
  const kind = companyKind(c.client);
  const verified = verifiedOf(c.client);
  const ck = str(c.client.Key);
  const mkEvent = (field: string, before: string, after: string, extra: Partial<Proposed> = {}): Proposed => ({
    clientKey: ck, clientName: str(c.client.Title), form: "", target: `client:${field}`, title: "", before, after, payload: {}, source: c.source, sourceKey: c.changeId, eventKey: `${c.source}|${c.changeId}|client|${ck}|${field}|${norm(after)}`,
    assignee: responsible(c.client), entity: "client", entityKey: ck, field, ...extra,
  });
  const snapNow: Pick<Snapshot, "txs" | "events"> = { txs: [...snap.txs], events: [...snap.events] };
  const remember = (p: Written) => { for (const x of p.creates || []) if (x.list === "CoSecEvents") snapNow.events.push(x.row); for (const x of p.creates || []) if (x.list === "CoSecTransactions") snapNow.txs.push(x.row); };

  for (const [field, raw] of Object.entries(c.patch)) {
    if (!WATCHED.has(field)) continue;
    const before = str(c.client[field]), after = str(raw);
    if (norm(before) === norm(after) && before.trim() === after.trim()) { outcomes.push({ field, outcome: "skipped" }); continue; }
    if (norm(before) === norm(after)) { outcomes.push({ field, outcome: "skipped" }); continue; }
    if (field === "HomeAddress" || field === "Title") {
      const linked = linkedPeople(snap, ck);
      for (const l of linked) {
        if (field === "Title" && kind) continue; // a company's name is a company change, not a person's
        const r = personChange(l, field === "Title" ? "name" : "ResidentialAddress", before, after, c, snapNow, o, snap);
        if (r) { w = merge(w, r); remember(r); outcomes.push({ field: `${field}:${l.name}`, outcome: r.outcome }); }
      }
      if (field === "HomeAddress") continue;
    }
    const rule = RULES.find((r) => r.field === field);
    if (!rule) continue;
    const results = ([] as Assessment[]).concat(rule.assess({ client: c.client, before, after, kind, verified }));
    for (const a of results) {
      if (a.kind !== "draft") {
        const p = mkEvent(field, before, after);
        if (!snapNow.events.some((e) => str(e.EventKey) === p.eventKey)) {
          const row = eventRow(p, a.kind === "info" ? "info" : "ignored", a.why, "", o);
          w.creates!.push({ list: "CoSecEvents", row }); snapNow.events.push(row);
          if (a.kind === "info") w.activities.push(activityRow(o, "cosec-flag", `${field === "SIC" ? "SIC code changed" : field} changed`, undefined, { clientKey: ck }, a.why, `cosec:flag:${p.eventKey}`));
        }
        outcomes.push({ field, outcome: a.kind === "info" ? "info" : "ignored" });
        continue;
      }
      const p = mkEvent(field, a.before, a.after, { form: a.form, target: a.target, title: a.title, payload: a.payload, note: [c.source === "portal" ? "Requested by the client through the portal and approved by staff." : "", a.note || ""].filter(Boolean).join(" ") || undefined });
      const r = prepare(p, snapNow, o);
      w = merge(w, r); remember(r); outcomes.push({ field, outcome: r.outcome });
    }
  }
  return { ...w, outcomes };
}

type Linked = { list: "CoSecOfficers" | "CoSecPscs"; row: Row; name: string };
function linkedPeople(snap: Snapshot, clientKey: string): Linked[] {
  return [
    ...snap.officers.filter((x) => str(x.PersonClientKey) === clientKey && str(x.Status) === "current").map((row) => ({ list: "CoSecOfficers" as const, row, name: officerName(row) })),
    ...snap.pscs.filter((x) => str(x.PersonClientKey) === clientKey && str(x.Status) === "current").map((row) => ({ list: "CoSecPscs" as const, row, name: pscName(row) })),
  ];
}
/** The individual's own record changed: prepare the matching director or PSC change. */
function personChange(l: Linked, what: "name" | "ResidentialAddress", before: string, after: string, c: ClientChange, snapNow: Pick<Snapshot, "txs" | "events">, o: Ctx, snap: Snapshot): (Prepared) | undefined {
  const company = snap.clients.find((x) => x.Key === l.row.ClientKey);
  if (!company) return undefined;
  const k = companyKind(company);
  if (!k) return undefined;
  const field = what === "name" ? "Name" : what;
  const form = l.list === "CoSecOfficers" ? officerForm("change", l.row, k) : pscForm("change", l.row);
  const target = `${l.list === "CoSecOfficers" ? "officer" : "psc"}:${str(l.row.Key)}:change`;
  const hasDraft = snapNow.txs.some((x) => str(x.ClientKey) === str(company.Key) && str(x.Target) === target && EDITABLE.includes(txStatus(x)));
  if (what === "ResidentialAddress" && !hasDraft && sameAddress(str(l.row.ResidentialAddress), after) && str(l.row.ResidentialAddress).trim()) return undefined;
  return prepareChange({ company, who: l, field, before: what === "name" ? l.name : str(l.row.ResidentialAddress) || before, after, form, target, source: c.source, sourceKey: c.changeId, entity: l.list === "CoSecOfficers" ? "officer" : "psc" }, snapNow, o);
}

/** Add one changed detail to the open "change" draft for a director or PSC (or start one). Putting a detail back removes it, and an empty draft is cancelled. */
function prepareChange(i: { company: Row; who: Linked; field: string; before: string; after: string; form: string; target: string; source: Source; sourceKey: string; entity: string }, snap: Pick<Snapshot, "txs" | "events">, o: Ctx): Prepared {
  const ck = str(i.company.Key);
  const eventKey = `${i.source}|${i.sourceKey}|${i.entity}|${str(i.who.row.Key)}|${i.field}|${norm(i.after)}`;
  const base: Proposed = { clientKey: ck, clientName: str(i.company.Title), form: i.form, target: i.target, title: `${i.who.name}: ${i.field === "ResidentialAddress" ? "residential address" : i.field === "ServiceAddress" ? "service address" : i.field.toLowerCase()} changed`, before: i.before, after: i.after, payload: { who: str(i.who.row.Key), changes: { [i.field]: i.after }, before: { [i.field]: i.before } }, source: i.source, sourceKey: i.sourceKey, eventKey, assignee: responsible(i.company), entity: i.entity, entityKey: str(i.who.row.Key), field: i.field };
  const open = snap.txs.find((t) => str(t.ClientKey) === ck && str(t.Target) === i.target && EDITABLE.includes(txStatus(t)));
  if (!open || NO_FILING_SOURCES.includes(i.source) || snap.events.some((e) => str(e.EventKey) === eventKey)) return prepare(base, snap, o);
  // fold into the open draft
  const p = json<{ changes?: Record<string, string>; before?: Record<string, string> }>(open.Payload, {});
  const changes = { ...(p.changes || {}) }, was = { ...(p.before || {}) };
  if (!(i.field in was)) was[i.field] = i.before;
  if (norm(was[i.field]) === norm(i.after)) { delete changes[i.field]; delete was[i.field]; } else changes[i.field] = i.after;
  const w = empty();
  const refs = { clientKey: ck };
  w.creates!.push({ list: "CoSecEvents", row: eventRow(base, Object.keys(changes).length ? "updated" : "cancelled", "Folded into the open draft.", str(open.Key), o) });
  if (!Object.keys(changes).length) {
    w.patches.push({ list: "CoSecTransactions", row: open, patch: { Status: "cancelled", Payload: JSON.stringify({ ...p, changes, before: was }), History: pushHistory(open, o, "cancelled", "Every change was put back."), Updated: o.now } });
    w.log.push(logRow(o, "cancelled", "cosec", str(open.Key), refs, { reason: "reverted" }));
    return { ...w, outcome: "cancelled" };
  }
  const after = Object.entries(changes).map(([k, v]) => `${k}: ${v}`).join("; ");
  const patch: Row = { Payload: JSON.stringify({ ...p, changes, before: was }), After: after, Status: "draft", History: pushHistory(open, o, "updated", `${i.field} now ${i.after}`), Updated: o.now };
  w.patches.push({ list: "CoSecTransactions", row: open, patch });
  w.log.push(logRow(o, "updated", "cosec", str(open.Key), refs, { field: i.field, after: i.after }));
  return { ...w, outcome: "updated", tx: { ...open, ...patch } };
}

// ------------------------------------------------------------------ officers and PSCs prepared in Co Sec

const person = (x: Row) => (x.Kind === "corporate" || x.Kind === "legal-entity" || x.Kind === "other" ? str(x.CorporateName) : [x.First, x.Last].map(str).filter(Boolean).join(" "));
const OFFICER_FIELDS = ["Title", "First", "Last", "CorporateName", "Nationality", "Occupation", "CountryOfResidence", "ServiceAddress", "ResidentialAddress"];
export type NewPerson = Row & { Role?: string; Kind?: string };

function personEvent(company: Row, entity: "officer" | "psc", row: Row, op: OfficerOp, o: Ctx, detail = ""): Proposed {
  const form = entity === "officer" ? officerForm(op, row, companyKind(company) || "limited") : pscForm(op, row);
  const name = entity === "officer" ? officerName(row) : pscName(row);
  const verb = op === "appoint" ? (entity === "officer" ? "appointment" : "added") : op === "terminate" ? (entity === "officer" ? "termination" : "ceased") : "details changed";
  return { clientKey: str(company.Key), clientName: str(company.Title), form, target: `${entity}:${str(row.Key)}:${op}`, title: `${name}: ${verb}`, before: "", after: detail || name, payload: { who: str(row.Key), op }, source: "cosec", sourceKey: str(row.Key), eventKey: `cosec|${op}|${entity}|${str(row.Key)}|${o.now}`, assignee: responsible(company), entity, entityKey: str(row.Key), field: op };
}
/** Co Sec prepares its own filings directly (the source is Co Sec, so the main-record sync never makes a second draft). */
function directDraft(p: Proposed, snap: Pick<Snapshot, "txs" | "events">, o: Ctx): Prepared {
  const x = prepare({ ...p, source: "client" }, snap, o);
  const patch = (list: string) => x.creates?.find((c) => c.list === list);
  const tx = patch("CoSecTransactions");
  if (tx) { tx.row.Source = "cosec"; tx.row.SourceKey = p.sourceKey; }
  return x;
}

export function appointPerson(company: Row, entity: "officer" | "psc", fields: Row, snap: Snapshot, can: boolean, o: Ctx): Prepared | { error: string } {
  if (!can) return { error: "You can't prepare filings." };
  if (!companyKind(company)) return { error: "Only companies and LLPs have a statutory record." };
  const key = o.newKey(entity === "officer" ? "CO" : "CP");
  const row: Row = { ...fields, Key: key, PracticeId: o.pid, ClientKey: str(company.Key), Status: "pending", Source: "cosec", Created: o.now, Updated: o.now };
  if (!person(row).trim()) return { error: "Enter a name." };
  const ev = personEvent(company, entity, row, "appoint", o);
  const r = directDraft(ev, snap, o);
  const list = entity === "officer" ? "CoSecOfficers" : "CoSecPscs";
  r.creates = [{ list, row }, ...(r.creates || [])];
  if (r.tx) r.tx.Payload = JSON.stringify({ ...json(r.tx.Payload, {}), op: "appoint", date: str(fields.AppointedOn || fields.NotifiedOn) });
  const txc = r.creates.find((c) => c.list === "CoSecTransactions");
  if (txc) txc.row.Payload = JSON.stringify({ who: key, op: "appoint", date: str(fields.AppointedOn || fields.NotifiedOn), details: row });
  return r;
}
export function terminatePerson(company: Row, entity: "officer" | "psc", row: Row, date: string, snap: Snapshot, can: boolean, o: Ctx): Prepared | { error: string } {
  if (!can) return { error: "You can't prepare filings." };
  if (str(row.Status) !== "current") return { error: "Only a current appointment can be ended." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Enter the date it ended." };
  const r = directDraft(personEvent(company, entity, row, "terminate", o, date), snap, o);
  const txc = r.creates?.find((c) => c.list === "CoSecTransactions");
  if (txc) txc.row.Payload = JSON.stringify({ who: str(row.Key), op: "terminate", date });
  return r;
}
export function changePerson(company: Row, entity: "officer" | "psc", row: Row, changes: Row, snap: Snapshot, can: boolean, o: Ctx): Prepared | { error: string } {
  if (!can) return { error: "You can't prepare filings." };
  if (str(row.Status) !== "current") return { error: "Only a current appointment can be changed." };
  const k = companyKind(company);
  if (!k) return { error: "Only companies and LLPs have a statutory record." };
  let w: Prepared = { ...empty(), outcome: "ignored" };
  const who: Linked = { list: entity === "officer" ? "CoSecOfficers" : "CoSecPscs", row, name: entity === "officer" ? officerName(row) : pscName(row) };
  const form = entity === "officer" ? officerForm("change", row, k) : pscForm("change", row);
  const target = `${entity}:${str(row.Key)}:change`;
  const snapNow = { txs: [...snap.txs], events: [...snap.events] };
  for (const f of OFFICER_FIELDS) {
    if (!(f in changes)) continue;
    const before = str(row[f]), after = str(changes[f]);
    const openDraft = snapNow.txs.find((x) => str(x.ClientKey) === str(company.Key) && str(x.Target) === target && EDITABLE.includes(txStatus(x)));
    const pending = openDraft && f in (json<{ changes?: Record<string, string> }>(openDraft.Payload, {}).changes || {});
    if (norm(before) === norm(after) && !pending) continue;
    const r = prepareChange({ company, who, field: f, before, after, form, target, source: "client", sourceKey: `${o.now}:${f}`, entity }, snapNow, o);
    w = { ...merge(w, r), outcome: r.outcome, tx: r.tx || w.tx };
    for (const x of r.creates || []) { if (x.list === "CoSecEvents") snapNow.events.push(x.row); if (x.list === "CoSecTransactions") snapNow.txs.push(x.row); }
    for (const x of r.patches) { const i = snapNow.txs.findIndex((t) => t.Key === x.row.Key); if (i >= 0) snapNow.txs[i] = { ...snapNow.txs[i], ...x.patch }; }
  }
  for (const x of w.creates || []) if (x.list === "CoSecTransactions") x.row.Source = "cosec";
  return w;
}

// ------------------------------------------------------------------ share capital

export type Allotment = { holder: string; holderKey?: string; class: string; number: number; currency: string; nominal: number; paid: number; date: string };
/** A share allotment: the holding is recorded as pending and an SH01 is prepared. Transfers update the register directly and flag the confirmation statement. */
export function allotShares(company: Row, a: Allotment, snap: Snapshot, can: boolean, o: Ctx): Prepared | { error: string } {
  if (!can) return { error: "You can't prepare filings." };
  if (companyKind(company) !== "limited") return { error: "Only limited companies have share capital." };
  if (!a.holder.trim() || !(a.number > 0) || !a.class.trim()) return { error: "Enter who the shares go to, the class and a number of shares." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date)) return { error: "Enter the date of allotment." };
  const key = o.newKey("CH");
  const row: Row = { Key: key, PracticeId: o.pid, ClientKey: str(company.Key), Holder: a.holder, HolderKey: a.holderKey || "", Class: a.class, Number: a.number, Currency: a.currency || "GBP", NominalValue: a.nominal, PaidPerShare: a.paid, Status: "pending", From: a.date, To: "", Event: "allotment", CertificateNo: "", Source: "cosec", Notes: "", Created: o.now, Updated: o.now };
  const p: Proposed = { clientKey: str(company.Key), clientName: str(company.Title), form: "SH01", target: `share:${key}:allot`, title: `Allotment of ${a.number} ${a.class} shares to ${a.holder}`, before: "", after: `${a.number} ${a.class} to ${a.holder}`, payload: { who: key, op: "allot", date: a.date, details: row }, source: "cosec", sourceKey: key, eventKey: `cosec|allot|${key}`, assignee: responsible(company), entity: "share", entityKey: key, field: "allotment" };
  const r = directDraft(p, snap, o);
  r.creates = [{ list: "CoSecShares", row }, ...(r.creates || [])];
  return r;
}
export function transferShares(company: Row, from: Row, to: { holder: string; holderKey?: string }, number: number, date: string, can: boolean, o: Ctx): Written | { error: string } {
  if (!can) return { error: "You can't change the register." };
  if (str(from.Status) !== "current") return { error: "That holding isn't current." };
  if (!(number > 0) || number > Number(from.Number)) return { error: "Enter a number of shares up to what the holder has." };
  if (!to.holder.trim()) return { error: "Enter who the shares go to." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Enter the date of transfer." };
  const w = empty();
  const ck = str(company.Key);
  const left = Number(from.Number) - number;
  w.patches.push({ list: "CoSecShares", row: from, patch: left > 0 ? { Number: left, Updated: o.now } : { Status: "former", To: date, Updated: o.now } });
  w.creates!.push({ list: "CoSecShares", row: { Key: o.newKey("CH"), PracticeId: o.pid, ClientKey: ck, Holder: to.holder, HolderKey: to.holderKey || "", Class: from.Class, Number: number, Currency: from.Currency, NominalValue: from.NominalValue, PaidPerShare: from.PaidPerShare, Status: "current", From: date, To: "", Event: "transfer", CertificateNo: "", Source: "cosec", Notes: `Transferred from ${str(from.Holder)}`, Created: o.now, Updated: o.now } });
  w.log.push(logRow(o, "transferred", "cosec", str(from.Key), { clientKey: ck }, { number, to: to.holder, date }));
  w.activities.push(activityRow(o, "cosec-flag", `Share transfer: ${number} ${str(from.Class)} shares from ${str(from.Holder)} to ${to.holder}`, undefined, { clientKey: ck }, "Register updated. Check the next confirmation statement (statement of capital and shareholders).", `cosec:transfer:${str(from.Key)}:${o.now}`));
  return w;
}

// ------------------------------------------------------------------ working a draft: review, approval, filing

/** What the planner must also record: the client's last-verified Companies House data. */
export type CoSecWritten = Written & { verified?: { clientKey: string; value: Verified } };
export type TxAction = "edit" | "clarify" | "answer" | "approve" | "decline" | "external" | "cancel" | "reopen" | "submitted" | "result";
export type TxInput = { payload?: Record<string, unknown>; after?: string; note?: string; ref?: string; gatewayRef?: string; test?: boolean; result?: { status: "accepted" | "rejected" | "pending"; chRef?: string; reason?: string } };

/** What is still missing before a draft can be approved and filed. Forms that are filed another way only need the basics. */
export function txIssues(tx: Row): string[] {
  const p = json<Record<string, any>>(tx.Payload, {});
  const out: string[] = [];
  switch (str(tx.Form)) {
    case "AD01": out.push(...addrIssues(p.address || {}, "New registered office")); break;
    case "NM01": if (!str(p.newName).trim()) out.push("The new company name"); break;
    case "AA01": if (!/^\d{1,2}[ /-]/.test(str(p.newDate).trim()) && !str(p.newDate).trim()) out.push("The new accounting reference date"); break;
    case "AP01": case "AP02": case "AP03": case "AP04": case "LLAP01": case "LLAP02": {
      const d = p.details || {};
      if (!str(p.date).trim()) out.push("Date of appointment");
      if (!person(d).trim()) out.push("Name");
      if (str(tx.Form) === "AP01" || str(tx.Form) === "LLAP01") {
        for (const [f, l] of [["DOB", "Date of birth"], ["Nationality", "Nationality"], ["Occupation", "Occupation"], ["CountryOfResidence", "Country of residence"]] as const) if (!str(d[f]).trim()) out.push(l);
        out.push(...addrIssues(parseAddress(str(d.ServiceAddress)), "Service address"), ...addrIssues(parseAddress(str(d.ResidentialAddress)), "Residential address"));
      }
      break;
    }
    case "TM01": case "TM02": case "LLTM01": if (!/^\d{4}-\d{2}-\d{2}$/.test(str(p.date))) out.push("Date the appointment ended"); break;
    case "CH01": case "CH02": case "CH03": case "CH04": case "LLCH01": case "LLCH02": case "PSC04": case "PSC05": case "PSC06":
      if (!Object.keys(p.changes || {}).length) out.push("At least one changed detail");
      break;
    case "SH01": { const d = p.details || {}; if (!(Number(d.Number) > 0) || !str(d.Class).trim() || !str(p.date).trim()) out.push("Class, number of shares and date"); break; }
  }
  return out;
}

export const canSubmitVia = (tx: Row): boolean => !!formDef(str(tx.Form))?.gateway;

export function act(tx: Row, action: TxAction, input: TxInput, cfg: Config, o: Ctx, snap?: Pick<Snapshot, "officers" | "pscs" | "shares" | "clients">): CoSecWritten | { error: string } {
  const st = txStatus(tx);
  const ck = str(tx.ClientKey);
  const refs = { clientKey: ck };
  const fail = (m: string) => ({ error: m });
  const done = (patch: Row, what: string, note?: string, activity?: { type: string; title: string; summary?: string }): Written => ({
    patches: [{ list: "CoSecTransactions", row: tx, patch: { ...patch, History: pushHistory(tx, o, what, note), Updated: o.now } }],
    log: [logRow(o, what, "cosec", str(tx.Key), refs, { form: tx.Form, note: note || "" })],
    activities: activity ? [activityRow(o, activity.type, activity.title, undefined, refs, activity.summary || "", `cosec:${what}:${str(tx.Key)}:${o.now}`)] : [],
    creates: [],
  });
  const can = (a: CoSecAction) => cosecCan(cfg, o.actor, a);
  switch (action) {
    case "edit": {
      if (!can("edit")) return fail("You can't edit filings.");
      if (!EDITABLE.includes(st)) return fail("Only a draft can be edited.");
      const patch: Row = { Status: "draft", EditedBy: o.actor, ApprovedBy: "", ApprovedAt: "", ApprovedPayload: "" };
      if (input.payload) patch.Payload = JSON.stringify(input.payload);
      if (input.after !== undefined) patch.After = input.after;
      return done(patch, "edited", input.note);
    }
    case "clarify": {
      if (!can("edit")) return fail("You can't ask for clarification.");
      if (!EDITABLE.includes(st)) return fail("Only a draft can be queried.");
      if (!str(input.note).trim()) return fail("Say what you need to know.");
      return done({ Status: "info", Clarification: str(input.note) }, "clarification requested", input.note);
    }
    case "answer": {
      if (!can("edit")) return fail("You can't answer a query.");
      if (st !== "info") return fail("Nothing is waiting for an answer.");
      return done({ Status: "draft", Clarification: "" }, "answered", input.note);
    }
    case "approve": {
      if (!can("approve")) return fail("Only a manager or partner can approve a filing.");
      if (st !== "draft" && st !== "rejected") return fail(st === "approved" ? "Already approved." : "Only a draft awaiting review can be approved.");
      if (cfg.independentReview && str(tx.EditedBy) && str(tx.EditedBy).toLowerCase() === o.actor.toLowerCase()) return fail("Independent review is on: someone other than the person who edited this draft must approve it.");
      const issues = txIssues(tx);
      if (issues.length) return fail(`Still needed before it can be approved: ${issues.join(", ")}.`);
      return done({ Status: "approved", ApprovedBy: o.actor, ApprovedAt: o.now, ApprovedPayload: str(tx.Payload), RejectReason: st === "rejected" ? "" : str(tx.RejectReason) }, "approved", input.note, { type: "cosec-approved", title: `${tx.Form} approved: ${str(tx.Title)}`, summary: "Approved, not yet submitted to Companies House." });
    }
    case "decline": {
      if (!can("approve")) return fail("Only a manager or partner can decline a filing.");
      if (!EDITABLE.includes(st)) return fail("Only a draft can be declined.");
      if (!str(input.note).trim()) return fail("Say why it is being declined.");
      return done({ Status: "declined" }, "declined", input.note, { type: "cosec-declined", title: `${tx.Form} declined: ${str(tx.Title)}`, summary: input.note });
    }
    case "cancel": {
      if (!can("edit")) return fail("You can't cancel filings.");
      if (!EDITABLE.includes(st)) return fail("Only a draft can be cancelled.");
      return done({ Status: "cancelled" }, "cancelled", input.note);
    }
    case "reopen": {
      if (!can("edit")) return fail("You can't reopen filings.");
      if (st !== "declined" && st !== "cancelled" && st !== "rejected" && st !== "tested") return fail("Only a declined, cancelled, rejected or tested filing can be reopened.");
      return done({ Status: "draft", ApprovedBy: "", ApprovedAt: "", ApprovedPayload: "" }, "reopened", input.note);
    }
    case "external": {
      if (!can("approve")) return fail("Only a manager or partner can record a filing made elsewhere.");
      if (!OPEN_STATUSES.includes(st)) return fail("That filing is already closed.");
      const w = done({ Status: "external", ChRef: str(input.ref), AcceptedAt: o.now }, "filed externally", input.note || input.ref, { type: "cosec-filed", title: `${tx.Form} filed externally: ${str(tx.Title)}`, summary: input.note });
      return mergeV(w, reconcile(tx, o, snap));
    }
    case "submitted": {
      if (!can("submit")) return fail("Only a manager or partner can submit a filing.");
      if (st !== "approved") return fail("Approve the filing before it is submitted.");
      if (!canSubmitVia(tx)) return fail(`${tx.Form} can't be sent from the planner yet. File it at Companies House and record it as filed externally.`);
      if (!str(tx.ApprovedPayload) || str(tx.ApprovedPayload) !== str(tx.Payload)) return fail("The stored draft no longer matches what was approved. Save and approve the current draft before submitting.");
      if (typeof input.test !== "boolean") return fail("The gateway did not confirm whether this was a test or live submission.");
      if (!str(input.gatewayRef)) return fail("The submission has no reference.");
      const environment = input.test ? "test" : "live";
      return done({ Status: "submitted", SubmittedBy: o.actor, SubmittedAt: o.now, GatewayRef: str(input.gatewayRef), GatewayEnvironment: environment, GatewayStatus: "pending", GatewayNote: "" }, "submitted", `${environment.toUpperCase()} reference ${input.gatewayRef}`, { type: "cosec-submitted", title: `${tx.Form} submitted to Companies House ${environment.toUpperCase()}: ${str(tx.Title)}`, summary: `Reference ${input.gatewayRef}. Waiting for the answer.` });
    }
    case "result": {
      if (st !== "submitted") return fail("That filing isn't waiting for Companies House.");
      if (str(tx.GatewayEnvironment) !== "test" && str(tx.GatewayEnvironment) !== "live") return fail("The original filing environment is not recorded. Verify the result manually before updating statutory records.");
      const r = input.result;
      if (!r) return fail("No result.");
      if (r.status === "pending") return done({ GatewayStatus: "pending" }, "checked", "Still pending");
      if (r.status === "accepted") {
        if (str(tx.GatewayEnvironment) === "test") return done({ Status: "tested", GatewayStatus: "accepted", ChRef: str(r.chRef), ApprovedBy: "", ApprovedAt: "", ApprovedPayload: "" }, "test accepted", "TEST only — statutory registers and verified Companies House data unchanged.", { type: "cosec-test-accepted", title: `${tx.Form} passed Companies House test: ${str(tx.Title)}`, summary: "Test acceptance is not a live filing. Reopen, approve and submit when live filing is authorised." });
        const w = done({ Status: "accepted", GatewayStatus: "accepted", ChRef: str(r.chRef), AcceptedAt: o.now }, "accepted", r.chRef ? `Companies House reference ${r.chRef}` : "Accepted", { type: "cosec-accepted", title: `${tx.Form} accepted by Companies House: ${str(tx.Title)}`, summary: r.chRef ? `Reference ${r.chRef}` : "" });
        return mergeV(w, reconcile(tx, o, snap));
      }
      return done({ Status: "rejected", GatewayStatus: "rejected", RejectReason: str(r.reason) || "Rejected, no reason given.", ApprovedBy: "", ApprovedAt: "", ApprovedPayload: "" }, "rejected", r.reason, { type: "cosec-rejected", title: `${tx.Form} rejected by Companies House: ${str(tx.Title)}`, summary: r.reason });
    }
  }
}

/** After acceptance (or a filing made elsewhere): bring the internal register and the last-verified record into line, and close the work. */
export function reconcile(tx: Row, o: Ctx, snap?: Pick<Snapshot, "officers" | "pscs" | "shares" | "clients">): CoSecWritten {
  const w: CoSecWritten = empty();
  const p = json<Record<string, any>>(tx.Payload, {});
  const form = str(tx.Form);
  const patchPerson = (list: "CoSecOfficers" | "CoSecPscs", patch: Row) => {
    const row = snap ? (list === "CoSecOfficers" ? snap.officers : snap.pscs).find((x) => x.Key === p.who) : undefined;
    if (row) w.patches.push({ list, row, patch: { ...patch, Updated: o.now } });
  };
  const officer = form.startsWith("AP") || form.startsWith("LLAP") || form.startsWith("TM") || form.startsWith("LLTM") || form.startsWith("CH") || form.startsWith("LLCH");
  if (officer) {
    const list = "CoSecOfficers" as const;
    if (/^(AP|LLAP)/.test(form)) patchPerson(list, { Status: "current", AppointedOn: str(p.date) });
    else if (/^(TM|LLTM)/.test(form)) patchPerson(list, { Status: "resigned", ResignedOn: str(p.date) });
    else patchPerson(list, p.changes || {});
  } else if (/^PSC0[1-3]$/.test(form)) patchPerson("CoSecPscs", { Status: "current", NotifiedOn: str(p.date) });
  else if (form === "PSC07") patchPerson("CoSecPscs", { Status: "ceased", CeasedOn: str(p.date) });
  else if (/^PSC0[4-6]$/.test(form)) patchPerson("CoSecPscs", p.changes || {});
  else if (form === "SH01" && p.who) { const row = snap?.shares.find((x) => x.Key === p.who); if (row) w.patches.push({ list: "CoSecShares", row, patch: { Status: "current", Updated: o.now } }); }
  // what Companies House now shows: the planner's refresh (when it can reach Companies House) replaces this with the official record
  const field = form === "AD01" ? "office" : form === "NM01" ? "name" : form === "AA01" ? "ard" : "";
  if (field) {
    const client = snap?.clients.find((c) => c.Key === tx.ClientKey);
    w.verified = { clientKey: str(tx.ClientKey), value: { ...(client ? verifiedOf(client) : {}), [field]: str(tx.After), at: o.now } };
  }
  w.activities.push(activityRow(o, "cosec-completed", `${form} complete: ${str(tx.Title)}`, undefined, { clientKey: str(tx.ClientKey) }, "The statutory record is up to date.", `cosec:completed:${str(tx.Key)}`));
  return w;
}

// ------------------------------------------------------------------ what to show

/** Open filings that touch a statutory field of this client: the "Pending Co Sec review" indicator. */
export function pendingFor(txs: Row[], clientKey: string, target?: string): Row[] {
  return txs.filter((t) => str(t.ClientKey) === clientKey && isOpenTx(t) && (!target || str(t.Target) === target));
}
export const PENDING_TARGET: Record<string, string> = { RegisteredOffice: "client:RegisteredOffice", Title: "client:Name", YearEnd: "client:AccountingReferenceDate" };

export type CoSecItem = { key: string; txKey: string; clientKey: string; clientName: string; group: "review" | "approval" | "submit" | "rejected" | "info" | "waiting" | "discrepancy"; title: string; detail: string; assignee: string; priority: "high" | "medium" | "low"; due: string };
export const GROUP_LABEL: Record<CoSecItem["group"], string> = { review: "Statutory changes awaiting review", approval: "Drafts awaiting approval", submit: "Approved filings awaiting submission", rejected: "Rejected Companies House filings", info: "Changes needing more information", waiting: "Submitted, waiting for Companies House", discrepancy: "Companies House data differences" };

/** Everything in Co Sec that needs somebody, for the Action Centre and the bell. Each links to its filing by txKey. */
export function coSecItems(txs: Row[], clients: Row[], flags: Row[], today: string): CoSecItem[] {
  const out: CoSecItem[] = [];
  const name = (k: unknown) => str(clients.find((c) => c.Key === k)?.Title) || "Client";
  const ageDays = (iso: string) => Math.floor((Date.parse(today) - Date.parse(iso.slice(0, 10))) / 86400000) || 0;
  for (const t of txs) {
    const st = txStatus(t);
    if (!OPEN_STATUSES.includes(st)) continue;
    const base = { key: `cosec:${str(t.Key)}`, txKey: str(t.Key), clientKey: str(t.ClientKey), clientName: name(t.ClientKey), assignee: str(t.Assignee), due: str(t.Due) };
    const old = ageDays(str(t.Created)) > 14;
    const title = `${t.Form}: ${str(t.Title)}`;
    if (st === "draft") out.push({ ...base, group: "review", title, detail: `${NOT_FILED} ${str(t.Before) ? `From ${str(t.Before)} to ` : ""}${str(t.After)}`, priority: old ? "high" : "medium" });
    else if (st === "info") out.push({ ...base, group: "info", title, detail: str(t.Clarification) || "Waiting for more information.", priority: "medium" });
    else if (st === "approved") out.push({ ...base, group: "submit", title, detail: "Approved. Not yet submitted to Companies House.", priority: "high" });
    else if (st === "rejected") out.push({ ...base, group: "rejected", title, detail: str(t.RejectReason) || "Companies House rejected this filing.", priority: "high" });
    else if (st === "submitted" && ageDays(str(t.SubmittedAt)) >= 2) out.push({ ...base, group: "waiting", title, detail: `Submitted ${str(t.SubmittedAt).slice(0, 10)}. No answer yet.`, priority: "medium" });
  }
  for (const f of flags) {
    if (!["office", "name", "officers", "pscs"].includes(str(f.Type)) || str(f.Status) && str(f.Status) !== "open") continue;
    const ck = str(f.ClientKey);
    if (txs.some((t) => str(t.ClientKey) === ck && isOpenTx(t))) continue;
    out.push({ key: `cosec-flag:${str(f.Key)}`, txKey: "", clientKey: ck, clientName: name(ck), group: "discrepancy", title: str(f.Title) || "Companies House difference", detail: str(f.Detail), assignee: "", priority: "low", due: "" });
  }
  return out;
}

// ------------------------------------------------------------------ comparing with Companies House

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** What Companies House shows, in the shape kept on the client (Clients.CHVerified). */
export function verifiedFrom(profile: { company_name?: string; registered_office_address?: Record<string, string | undefined>; sic_codes?: string[]; accounts?: { accounting_reference_date?: { day?: string; month?: string } } }, now: string): Verified {
  const a = profile.registered_office_address;
  const first = a ? [a.premises, a.address_line_1].filter(Boolean).join(" ") : "";
  const ard = profile.accounts?.accounting_reference_date;
  const m = Number(ard?.month);
  return {
    at: now, name: profile.company_name || "", office: a ? [first, a.address_line_2, a.locality, a.region, a.postal_code, a.country].filter((x) => x && String(x).trim()).join(", ") : "",
    sic: (profile.sic_codes || []).join(", "), ard: ard?.day && m >= 1 && m <= 12 ? `${Number(ard.day)} ${MONTHS[m - 1]}` : "",
  };
}

/**
 * Changes the main save point never saw (for example a client change the portal's server applied after staff approved it) show up as a
 * difference between the planner's record and what Companies House last showed. Each difference becomes a draft unless one already
 * exists or the value was already filed. Safe to run as often as you like: each distinct difference is processed once.
 */
export function scanDifferences(snap: Snapshot, o: Ctx, source: Source = "other"): Written & { found: number } {
  let w = empty();
  const now: Snapshot = { ...snap, txs: [...snap.txs], events: [...snap.events] };
  let found = 0;
  for (const client of snap.clients) {
    if (!companyKind(client) || !str(client.CompanyNumber).trim()) continue;
    const v = verifiedOf(client);
    if (!v.at) continue;
    const pairs: [string, string | undefined, boolean][] = [
      ["RegisteredOffice", v.office, !!v.office && !!str(client.RegisteredOffice).trim() && !sameAddress(v.office, str(client.RegisteredOffice))],
      ["Title", v.name, !!v.name && !sameName(v.name, str(client.Title))],
      ["YearEnd", v.ard, !!v.ard && !!str(client.YearEnd).trim() && norm(v.ard) !== norm(client.YearEnd)],
    ];
    for (const [field, official, differs] of pairs) {
      if (!differs) continue;
      if (now.txs.some((x) => str(x.ClientKey) === str(client.Key) && str(x.Target) === PENDING_TARGET[field] && (txStatus(x) === "declined" || txStatus(x) === "cancelled") && norm(x.After) === norm(client[field]))) continue; // already decided against
      const r = detectClientChange({ client: { ...client, [field]: official }, patch: { [field]: str(client[field]) }, source, changeId: `scan:${str(client.Key)}:${field}:${norm(client[field])}` }, now, o);
      if (r.outcomes.some((x) => x.outcome === "draft" || x.outcome === "updated")) found++;
      w = merge(w, r);
      for (const x of r.creates || []) { if (x.list === "CoSecEvents") now.events.push(x.row); if (x.list === "CoSecTransactions") now.txs.push(x.row); }
      for (const x of r.patches) { const i = now.txs.findIndex((t) => t.Key === x.row.Key); if (i >= 0) now.txs[i] = { ...now.txs[i], ...x.patch }; }
    }
  }
  return { ...w, found };
}

// ------------------------------------------------------------------ bringing officers and PSCs in from Companies House

const DIRECT = (v: unknown) => str(v);
const chAddr = (a?: Record<string, string | undefined>) => (a ? [[a.premises, a.address_line_1].filter(Boolean).join(" "), a.address_line_2, a.locality, a.region, a.postal_code, a.country].filter((x) => x && String(x).trim()).join(", ") : "");
const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase());
/** "SMITH, Sam John" -> first and last. */
const splitName = (name: string): { First: string; Last: string; Title: string } => {
  const [last, rest = ""] = name.split(",");
  const words = rest.trim().split(/\s+/).filter(Boolean);
  const title = /^(mr|mrs|ms|miss|dr|mx|sir|lord|lady|prof)\.?$/i.test(words[0] || "") ? words.shift()! : "";
  return { Title: title, First: words.join(" "), Last: titleCase(last.trim()) };
};
const dob = (d?: { year?: number; month?: number }) => (d?.year ? `${d.year}-${String(d.month || 1).padStart(2, "0")}` : "");

/** Companies House's officers as register rows (current ones only). They are the starting record, so no filing is prepared for them. */
export function officersFromCh(client: Row, list: { items?: any[] } | null | undefined, existing: Row[], o: Ctx): Row[] {
  const out: Row[] = [];
  const have = new Set(existing.filter((x) => str(x.ClientKey) === str(client.Key)).map((x) => `${norm(officerName(x))}|${str(x.Role)}`));
  const llp = companyKind(client) === "llp";
  for (const it of list?.items || []) {
    if (it.resigned_on) continue;
    const roleText = str(it.officer_role).toLowerCase();
    const role = roleText.includes("secretary") ? "secretary" : roleText.includes("member") || llp ? "member" : "director";
    const corporate = /corporate/.test(roleText) || (!str(it.name).includes(",") && !!it.identification);
    const row: Row = corporate
      ? { Kind: "corporate", CorporateName: str(it.name) }
      : { Kind: "individual", ...splitName(str(it.name)) };
    const key = `${norm(corporate ? row.CorporateName : officerName({ ...row, Kind: "individual" }))}|${role}`;
    if (have.has(key)) continue;
    have.add(key);
    out.push({ Key: o.newKey("CO"), PracticeId: o.pid, ClientKey: str(client.Key), Role: role, ...row, Status: "current", DOB: dob(it.date_of_birth), Nationality: DIRECT(it.nationality), Occupation: DIRECT(it.occupation), CountryOfResidence: DIRECT(it.country_of_residence),
      ServiceAddress: chAddr(it.address), ResidentialAddress: "", AppointedOn: DIRECT(it.appointed_on), ResignedOn: "", PersonClientKey: "", ChId: DIRECT(it.links?.officer?.appointments || it.links?.self), Source: "ch", Notes: "", Created: o.now, Updated: o.now });
  }
  return out;
}
export function pscsFromCh(client: Row, list: { items?: any[] } | null | undefined, existing: Row[], o: Ctx): Row[] {
  const out: Row[] = [];
  const have = new Set(existing.filter((x) => str(x.ClientKey) === str(client.Key)).map((x) => norm(pscName(x))));
  for (const it of list?.items || []) {
    if (it.ceased_on || it.ceased) continue;
    const kind = str(it.kind).startsWith("individual") ? "individual" : str(it.kind).startsWith("corporate-entity") || str(it.kind).startsWith("legal-person") ? "legal-entity" : "other";
    const row: Row = kind === "individual" ? { Kind: kind, ...(it.name_elements ? { Title: str(it.name_elements.title), First: [it.name_elements.forename, it.name_elements.middle_name].filter(Boolean).join(" "), Last: str(it.name_elements.surname) } : splitName(str(it.name))) } : { Kind: kind, CorporateName: str(it.name) };
    const nm = pscName(row);
    if (have.has(norm(nm))) continue;
    have.add(norm(nm));
    out.push({ Key: o.newKey("CP"), PracticeId: o.pid, ClientKey: str(client.Key), ...row, Status: "current", DOB: dob(it.date_of_birth), Nationality: DIRECT(it.nationality), CountryOfResidence: DIRECT(it.country_of_residence), ServiceAddress: chAddr(it.address), ResidentialAddress: "",
      Natures: JSON.stringify(it.natures_of_control || []), NotifiedOn: DIRECT(it.notified_on), CeasedOn: "", PersonClientKey: "", ChId: DIRECT(it.links?.self), Source: "ch", Notes: "", Created: o.now, Updated: o.now });
  }
  return out;
}
