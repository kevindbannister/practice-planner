// Engagement letters for clients who are already in the system (imported, or taken on before letters were made here).
// Three pieces: which clients have services no live letter covers, a letter built from the client's own services and
// fees (no proposal needed), and doing that for a batch with the same checks as one at a time. Pure rules; the screens
// are in ui/LetterGaps.tsx.
import { Agreed, AgreedLine, EngagementSettings, MAX_BODY, partyOf, addYears, encodeBody, engagementDocument, isLive, nextRef, readList, refsOf, reviewStatus, reviewYears, templateFor, advanceEng } from "./engagements";
import { periodsPerYear } from "./fees";
import { CatalogueService, DEFAULT_VAT_RATE, ClientType, ProposalAction, clientTypeFor } from "./proposals";
import { Ctx, Written, activityRow, logRow } from "./sales";
import { Row } from "./schema";

const str = (v: unknown): string => (v === undefined || v === null ? "" : String(v));
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const truthy = (v: unknown) => v === true || v === "true" || v === 1 || v === "1" || v === "Yes" || v === "yes";
const inactive = (c: Row) => /archiv|former|ceased|inactive|left/i.test(str(c.Status));

/** One service the client has, as a letter would state it. `included` means no separate fee (part of a package). */
export type ScheduleLine = { serviceKey: string; name: string; frequency: "monthly" | "quarterly" | "annual" | "one-off"; price: number; vat: string; included: boolean };

/** The client's current services, read from their records. Ended services are left out; held ones are kept (the client has agreed to them). */
export function scheduleLines(clientKey: string, schedule: Row[], services: Row[], catalogue: CatalogueService[]): ScheduleLine[] {
  const out: ScheduleLine[] = [];
  const seen = new Set<string>();
  for (const cs of schedule) {
    if (str(cs.ClientKey) !== clientKey || str(cs.EndedOn)) continue;
    const key = str(cs.ServiceKey);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const period = str(cs.FeePeriod);
    const per = periodsPerYear(period);
    let frequency: ScheduleLine["frequency"] = per === 12 ? "monthly" : per === 4 ? "quarterly" : per === 1 ? "annual" : "one-off";
    let price = num(cs.Fee);
    if (!per && !truthy(cs.OneOff) && num(cs.AnnualFee) > 0) { frequency = "annual"; if (price <= 0) price = num(cs.AnnualFee); }
    const name = catalogue.find((c) => c.key === key)?.name || str(services.find((s) => str(s.Key) === key)?.Title) || key;
    out.push({ serviceKey: key, name, frequency, price: Math.round(price * 100) / 100, vat: str(cs.VatTreatment) || "standard", included: price <= 0 });
  }
  return out;
}

export type GapState = "ready" | "no-fee" | "not-reviewed";
export type Gap = {
  clientKey: string; name: string; manager: string; type: ClientType;
  lines: ScheduleLine[]; uncovered: ScheduleLine[]; hasLetter: boolean; state: GapState; reason: string; warnings: string[];
};
export type GapInput = { clients: Row[]; schedule: Row[]; services: Row[]; catalogue: CatalogueService[]; engagements: Row[]; settings: EngagementSettings };

/** Clients with at least one service that no live letter (draft, in review, approved, out or in force) covers. Nothing is guessed: a client with no fees recorded is shown, but marked as not ready. */
export function letterGaps(i: GapInput): Gap[] {
  const out: Gap[] = [];
  for (const c of i.clients) {
    if (inactive(c)) continue;
    const ck = str(c.Key);
    const lines = scheduleLines(ck, i.schedule, i.services, i.catalogue);
    if (!lines.length) continue;
    const mine = i.engagements.filter((e) => str(e.ClientKey) === ck && isLive(e));
    const covered = new Set(mine.flatMap((e) => readList(e.ServiceKeys)));
    const uncovered = lines.filter((l) => !covered.has(l.serviceKey));
    if (!uncovered.length) continue;
    const type = clientTypeFor(str(c.Kind));
    const warnings: string[] = [];
    if (!str(c.RegisteredOffice || c.TradingAddress || c.HomeAddress).trim()) warnings.push("No address on the record, so the letter won't show one.");
    if (lines.some((l) => !l.included && !str(i.schedule.find((s) => str(s.ClientKey) === ck && str(s.ServiceKey) === l.serviceKey)?.VatTreatment))) warnings.push("VAT treatment not recorded; standard rate shown.");
    let state: GapState = "ready", reason = "";
    if (!lines.some((l) => !l.included)) { state = "no-fee"; reason = "No fees are recorded for this client's services. Add them in the client's fee schedule first."; }
    else { const rv = reviewStatus(i.settings, type); if (!rv.ok) { state = "not-reviewed"; reason = rv.reason; } }
    out.push({ clientKey: ck, name: str(c.Title), manager: str(c.Manager), type, lines, uncovered, hasLetter: mine.length > 0, state, reason, warnings });
  }
  // clients with no letter at all first, then partial cover, each by name
  return out.sort((a, b) => Number(a.hasLetter) - Number(b.hasLetter) || a.name.localeCompare(b.name));
}

export type FromScheduleInput = {
  client: Row; schedule: Row[]; services: Row[]; catalogue: CatalogueService[]; settings: EngagementSettings; existing: Row[]; practice: string; signatories?: string[];
  effectiveDate?: string; previousKey?: string; vatRate?: number; today: string; can: (a: ProposalAction) => boolean;
};
const agreedFrom = (lines: ScheduleLine[], vatRate: number): Agreed => ({
  vatRate,
  lines: lines.map((l, n): AgreedLine => ({ id: `s${n + 1}`, serviceKey: l.serviceKey, name: l.included ? `${l.name} (included in package fee)` : l.name, frequency: l.frequency, price: l.price, discount: null, setupFee: 0, vat: l.vat, optional: false })),
});
const contactName = (c: Row) => [str(c.ContactFirst), str(c.ContactLast)].filter(Boolean).join(" ").trim() || str(c.Title);

/**
 * A draft letter for a client already in the system, built from what they have now: their services, fees and VAT treatment.
 * Without `previousKey` it covers only services no live letter covers. With it, the letter renews that one and covers everything current.
 */
export function generateFromSchedule(i: FromScheduleInput, o: Ctx): { engagement: Row; log: Row; activity: Row } | { error: string } {
  if (!i.can("edit")) return { error: "You can't create engagement letters." };
  const ck = str(i.client.Key);
  if (inactive(i.client)) return { error: "This client isn't active." };
  const all = scheduleLines(ck, i.schedule, i.services, i.catalogue);
  if (!all.length) return { error: "This client has no current services to put in a letter." };
  if (!all.some((l) => !l.included)) return { error: "No fees are recorded for this client's services. Add them in the client's fee schedule first." };
  const type = clientTypeFor(str(i.client.Kind));
  const rv = reviewStatus(i.settings, type);
  if (!rv.ok) return { error: rv.reason };
  const covered = new Set(i.existing.filter((e) => str(e.ClientKey) === ck && isLive(e) && str(e.Key) !== i.previousKey).flatMap((e) => readList(e.ServiceKeys)));
  const lines = i.previousKey ? all : all.filter((l) => !covered.has(l.serviceKey));
  if (!lines.length) return { error: "Every service is already covered by a letter." };
  const agreed = agreedFrom(lines, i.vatRate ?? DEFAULT_VAT_RATE);
  const effective = i.effectiveDate || i.today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effective)) return { error: "Choose the date the engagement takes effect." };
  const yrs = reviewYears(i.settings, { clientKey: ck, type });
  const ref = nextRef(i.existing, Number(o.now.slice(0, 4)));
  const sig = i.signatories ?? [contactName(i.client)];
  const doc = engagementDocument({
    sections: templateFor(i.settings, type), client: partyOf(i.client, type), now: o.now, practice: i.practice,
    agreed, catalogue: i.catalogue, ref, date: i.today, effectiveDate: effective, reviewDate: addYears(effective, yrs), years: yrs, proposalRef: "", signatories: sig,
  });
  const body = encodeBody(doc);
  if (body.length > MAX_BODY) return { error: "This letter is too long to save. Shorten the service clauses." };
  const key = o.newKey("EN");
  const keys = lines.map((l) => l.serviceKey);
  const engagement: Row = {
    Key: key, PracticeId: o.pid, Ref: ref, ClientKey: ck, ProposalKey: "", ProposalVersion: 0, OppKey: "",
    Title: `Engagement letter: ${str(i.client.Title)}${lines.length === 1 ? ` (${lines[0].name})` : ""}`, Source: "generated", Basis: "schedule", Agreed: JSON.stringify(agreed), Status: "draft", ClientType: type,
    ServiceKeys: JSON.stringify(keys), ServiceNames: JSON.stringify(lines.map((l) => l.name)), DocumentDate: i.today, EffectiveDate: effective, ReviewYears: "", ReviewDate: addYears(effective, yrs), Body: body, Hash: "",
    Signatories: JSON.stringify(sig), PreviousKey: i.previousKey || "", Decisions: "[]", Notes: "Built from the client's services and fees as recorded in the planner, not from a proposal. Check the fees before sending.", Created: o.now, CreatedBy: o.actor, Updated: o.now,
  };
  const refs = { clientKey: ck };
  return {
    engagement,
    log: logRow(o, "created", "engagement", key, refs, { ref, basis: "schedule", services: keys, previous: i.previousKey || "" }),
    activity: activityRow(o, "engagement-created", `Engagement letter ${ref} drafted for ${i.client.Title}`, undefined, refs, `Built from their current services and fees (${lines.length} service${lines.length === 1 ? "" : "s"}).`),
  };
}

export type BatchResult = { written: Written; made: { clientKey: string; name: string; ref: string }[]; skipped: { clientKey: string; name: string; reason: string }[]; remaining: number };
/** Drafts for several clients in one go. Each is checked exactly as it would be on its own; one that can't be made is skipped with the reason and the rest carry on. */
export function generateBatch(clientKeys: string[], i: Omit<FromScheduleInput, "client" | "signatories" | "previousKey">, clients: Row[], o: Ctx, limit = 50): BatchResult {
  const written: Written = { patches: [], creates: [], log: [], activities: [] };
  const made: BatchResult["made"] = [], skipped: BatchResult["skipped"] = [];
  let existing = i.existing;
  const todo = [...new Set(clientKeys)];
  for (const ck of todo.slice(0, limit)) {
    const client = clients.find((c) => str(c.Key) === ck);
    if (!client) { skipped.push({ clientKey: ck, name: ck, reason: "Client not found." }); continue; }
    const g = generateFromSchedule({ ...i, client, existing }, o);
    if ("error" in g) { skipped.push({ clientKey: ck, name: str(client.Title), reason: g.error }); continue; }
    existing = [...existing, g.engagement];
    written.creates!.push({ list: "Engagements", row: g.engagement });
    written.log.push(g.log as never); written.activities.push(g.activity);
    made.push({ clientKey: ck, name: str(client.Title), ref: str(g.engagement.Ref) });
  }
  return { written, made, skipped, remaining: Math.max(0, todo.length - limit) };
}

export type BulkStep = { written: Written; moved: string[]; skipped: { ref: string; reason: string }[] };
/** Move several letters one step (submit for review, or approve). Each is checked on its own, so a letter you prepared is still refused if approval has to be independent. */
export function bulkAdvance(letters: Row[], to: "review" | "approved", independent: boolean, can: (a: ProposalAction) => boolean, o: Ctx): BulkStep {
  const written: Written = { patches: [], log: [], activities: [] };
  const moved: string[] = [], skipped: BulkStep["skipped"] = [];
  for (const e of letters) {
    const w = advanceEng(e, to, "", independent, can, o);
    if ("error" in w) { skipped.push({ ref: str(e.Ref), reason: w.error }); continue; }
    written.patches.push(...w.patches); written.log.push(...w.log); written.activities.push(...w.activities);
    moved.push(str(e.Ref));
  }
  return { written, moved, skipped };
}
