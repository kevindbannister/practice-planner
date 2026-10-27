// Proposals (Phase 2 of the lead-to-client lifecycle): the service catalogue, prices and VAT, proposal versions,
// the review and approval workflow, acceptance, and the proposal document. Pure logic: the screens call in here
// and the tests run it directly.
//
// A Proposal is the commercial offer for one Opportunity. Each Version is a frozen copy of what was offered
// (lines, wording, VAT rate, validity) with its own status, so the exact version a client accepted can always
// be shown. Money is held in pounds in the lists and worked out in whole pence here, so totals never drift.
import { Config, Role, staffRole } from "./checklist";
import { Block, DocContent, Run } from "./docModel";
import { Row } from "./schema";
import { Ctx, Opp, Stage, Written, activityRow, logRow, moveStage, outcomeOf, wonStage } from "./sales";

// ------------------------------------------------------------------ catalogue

export type Freq = "monthly" | "quarterly" | "annual" | "one-off" | "fixed";
export const FREQS: [Freq, string][] = [["monthly", "Monthly"], ["quarterly", "Quarterly"], ["annual", "Annual"], ["one-off", "One-off"], ["fixed", "Fixed project fee"]];
export const freqLabel = (f: string) => FREQS.find(([k]) => k === f)?.[1] || f;
/** Payments a year. One-off and fixed fees are paid once and are not recurring. */
export const PERIODS: Record<Freq, number> = { monthly: 12, quarterly: 4, annual: 1, "one-off": 0, fixed: 0 };
export const isFreq = (f: unknown): f is Freq => typeof f === "string" && f in PERIODS;

export type Vat = "standard" | "zero" | "exempt" | "outside";
export const VATS: [Vat, string][] = [["standard", "Standard rate"], ["zero", "Zero rated"], ["exempt", "Exempt"], ["outside", "Outside the scope of VAT"]];
export const isVat = (v: unknown): v is Vat => v === "standard" || v === "zero" || v === "exempt" || v === "outside";

export type ClientType = "limited" | "llp" | "sole-trader" | "partnership" | "individual";
export const CLIENT_TYPES: [ClientType, string][] = [["limited", "Limited company"], ["llp", "LLP"], ["sole-trader", "Sole trader"], ["partnership", "Partnership"], ["individual", "Individual"]];
export const typeLabel = (t: string) => CLIENT_TYPES.find(([k]) => k === t)?.[1] || t;
/** The proposal's client type, suggested from the client record's own type. */
export const clientTypeFor = (kind: string | undefined): ClientType => (kind === "Ltd" ? "limited" : kind === "LLP" ? "llp" : kind === "Partnership" ? "partnership" : "individual");

export type Pricing = Partial<Record<ClientType, { price?: number; frequency?: Freq }>>;
export type CatalogueService = {
  key: string; name: string; code: string; category: string; description: string; clientDescription: string; types: ClientType[];
  price: number; frequency: Freq; vat: Vat; setupFee: number; scope: string; exclusions: string; clientResp: string; practiceResp: string; clauses: string; /** The service's schedule in the engagement letter, as rich text (HTML). */ schedule: string;
  pricing: Pricing; offered: boolean; active: boolean; /** work can't start until an agent authorisation is recorded */ requiresAuth: boolean;
};

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const str = (v: unknown): string => (v === undefined || v === null ? "" : String(v));
const flag = (v: unknown, dflt: boolean): boolean => (v === true || v === "true" || v === "Yes" ? true : v === false || v === "false" || v === "No" ? false : dflt);

function readPricing(v: unknown): Pricing {
  let o: unknown = v;
  if (typeof v === "string") { try { o = JSON.parse(v); } catch { return {}; } }
  if (!o || typeof o !== "object") return {};
  const out: Pricing = {};
  for (const [t] of CLIENT_TYPES) {
    const e = (o as Record<string, unknown>)[t] as { price?: unknown; frequency?: unknown } | undefined;
    if (!e || typeof e !== "object") continue;
    const entry: { price?: number; frequency?: Freq } = {};
    if (e.price !== undefined && e.price !== "" && Number.isFinite(Number(e.price)) && Number(e.price) >= 0) entry.price = Number(e.price);
    if (isFreq(e.frequency)) entry.frequency = e.frequency;
    if (entry.price !== undefined || entry.frequency) out[t] = entry;
  }
  return out;
}

/** A services-list row as a catalogue service. Rows nobody has set up for sale are simply not offered. */
export function readService(r: Row): CatalogueService {
  const types = str(r.ClientTypes).split(",").map((x) => x.trim()).filter((x): x is ClientType => CLIENT_TYPES.some(([k]) => k === x));
  return {
    key: str(r.Key), name: str(r.Title), code: str(r.Code) || str(r.Key), category: str(r.Category), description: str(r.Description), clientDescription: str(r.ClientDescription),
    types, price: Math.max(0, num(r.Price)), frequency: isFreq(r.PriceFrequency) ? r.PriceFrequency : "annual", vat: isVat(r.VatTreatment) ? r.VatTreatment : "standard",
    setupFee: Math.max(0, num(r.SetupFee)), scope: str(r.Scope), exclusions: str(r.Exclusions), clientResp: str(r.ClientResp), practiceResp: str(r.PracticeResp), clauses: str(r.Clauses), schedule: str(r.Schedule),
    pricing: readPricing(r.Pricing), offered: flag(r.Offered, false), active: flag(r.Active, true), requiresAuth: flag(r.RequiresAuth, false),
  };
}
export const readCatalogue = (rows: Row[]): CatalogueService[] => rows.filter((r) => r.Key !== "TASK").map(readService);
/** What can be put in a proposal for this type of client: offered, active, and not restricted to other types. */
export const offeredFor = (cat: CatalogueService[], type: ClientType): CatalogueService[] =>
  cat.filter((s) => s.offered && s.active && (!s.types.length || s.types.includes(type))).sort((a, b) => (a.category || "~").localeCompare(b.category || "~") || a.name.localeCompare(b.name));
/** The price and frequency for a type of client: that type's own setting if there is one, else the default. */
export function priceFor(s: CatalogueService, type: ClientType): { price: number; frequency: Freq } {
  const o = s.pricing[type];
  return { price: o?.price ?? s.price, frequency: o?.frequency ?? s.frequency };
}

/** Problems with a catalogue entry that would make proposals wrong. */
export function catalogueIssues(s: Partial<CatalogueService>): string[] {
  const out: string[] = [];
  if (!str(s.name).trim()) out.push("Give the service a name.");
  if (num(s.price) < 0) out.push("The price can't be negative.");
  if (num(s.setupFee) < 0) out.push("The set-up fee can't be negative.");
  if (s.frequency && !isFreq(s.frequency)) out.push("Choose how often the fee is charged.");
  if (s.vat && !isVat(s.vat)) out.push("Choose the VAT treatment.");
  for (const [t, e] of Object.entries(s.pricing || {})) if (e?.price !== undefined && e.price < 0) out.push(`The ${typeLabel(t)} price can't be negative.`);
  return out;
}

/** The fields to write to the Services list for an edited catalogue entry. */
export function serviceRow(s: CatalogueService): Row {
  return {
    Code: s.code, Category: s.category, Description: s.description, ClientDescription: s.clientDescription, ClientTypes: s.types.join(","), Price: s.price, PriceFrequency: s.frequency,
    VatTreatment: s.vat, SetupFee: s.setupFee, Scope: s.scope, Exclusions: s.exclusions, ClientResp: s.clientResp, PracticeResp: s.practiceResp, Clauses: s.clauses, Schedule: s.schedule,
    Pricing: JSON.stringify(s.pricing), Offered: s.offered, Active: s.active, RequiresAuth: s.requiresAuth,
  };
}

/** Audit lines for a catalogue edit, one per price or offering change, so the history of prices is kept. */
export function catalogueChanges(before: CatalogueService, after: CatalogueService, o: Ctx): Row[] {
  const out: Row[] = [];
  const watch: [string, unknown, unknown][] = [
    ["price", before.price, after.price], ["frequency", before.frequency, after.frequency], ["setupFee", before.setupFee, after.setupFee], ["vat", before.vat, after.vat],
    ["pricing", JSON.stringify(before.pricing), JSON.stringify(after.pricing)], ["offered", before.offered, after.offered], ["active", before.active, after.active],
  ];
  for (const [field, a, b] of watch) if (String(a) !== String(b)) out.push(logRow(o, "service-" + field, "service", after.key, {}, { name: after.name, from: a, to: b }));
  return out;
}

// ------------------------------------------------------------------ lines and money

export type Discount = { kind: "pct" | "amount"; value: number; reason?: string };
export type Line = {
  id: string; serviceKey?: string; name: string; description: string; scope: string; exclusions: string; clientResp: string; practiceResp: string;
  frequency: Freq; price: number; setupFee: number; vat: Vat; discount?: Discount; optional?: boolean;
  /** What the catalogue charged when the line was added, so an override can be seen. */
  catalogPrice?: number; catalogSetup?: number; note?: string;
};

export const pence = (pounds: number): number => Math.round((Number(pounds) || 0) * 100 + (Number(pounds) < 0 ? -1e-9 : 1e-9));
export const pounds = (p: number): number => p / 100;
export const gbp = (p: number): string => (p < 0 ? "-" : "") + "£" + (Math.abs(p) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const DEFAULT_VAT_RATE = 0.2;
const rateFor = (vat: Vat, rate: number) => (vat === "standard" ? rate : 0);
const vatOf = (netPence: number, vat: Vat, rate: number) => Math.round(netPence * rateFor(vat, rate));

export type LineCalc = {
  periods: number; gross: number; discount: number; net: number; setup: number;
  /** For each payment: the VAT and the total. */
  vatEach: number; totalEach: number;
  annualNet: number; annualVat: number; oneOffNet: number; oneOffVat: number;
  discountYear: number;
};
/** One line, in pence. The discount applies to the fee, not to the set-up fee. */
export function calcLine(l: Line, rate: number): LineCalc {
  const periods = PERIODS[l.frequency] ?? 0;
  const gross = pence(l.price);
  let discount = 0;
  if (l.discount && l.discount.value > 0) discount = l.discount.kind === "pct" ? Math.round(gross * Math.min(100, l.discount.value) / 100) : Math.min(gross, pence(l.discount.value));
  const net = gross - discount;
  const setup = pence(l.setupFee);
  const vatEach = vatOf(net, l.vat, rate);
  const recurring = periods > 0;
  const oneOffFee = recurring ? 0 : net;
  return {
    periods, gross, discount, net, setup, vatEach, totalEach: net + vatEach,
    annualNet: recurring ? net * periods : 0, annualVat: recurring ? vatEach * periods : 0,
    oneOffNet: oneOffFee + setup, oneOffVat: vatOf(oneOffFee, l.vat, rate) + vatOf(setup, l.vat, rate),
    discountYear: discount * (recurring ? periods : 1),
  };
}

export type Totals = {
  monthlyRecurring: number; annualRecurringNet: number; annualRecurringVat: number; oneOffNet: number; oneOffVat: number; setupNet: number; discounts: number;
  firstYearNet: number; firstYearVat: number; firstYearGross: number; ongoingNet: number; ongoingVat: number; ongoingGross: number;
  byFrequency: Record<Freq, number>;
};
export const noTotals = (): Totals => ({ monthlyRecurring: 0, annualRecurringNet: 0, annualRecurringVat: 0, oneOffNet: 0, oneOffVat: 0, setupNet: 0, discounts: 0, firstYearNet: 0, firstYearVat: 0, firstYearGross: 0, ongoingNet: 0, ongoingVat: 0, ongoingGross: 0, byFrequency: { monthly: 0, quarterly: 0, annual: 0, "one-off": 0, fixed: 0 } });

/** Totals for a set of lines, in pence. Optional lines are left out: price them separately with `totalsFor(optionalLines)`. */
export function totalsFor(lines: Line[], rate: number): Totals {
  const t = noTotals();
  for (const l of lines) {
    const c = calcLine(l, rate);
    t.annualRecurringNet += c.annualNet; t.annualRecurringVat += c.annualVat;
    t.oneOffNet += c.oneOffNet; t.oneOffVat += c.oneOffVat; t.setupNet += c.setup; t.discounts += c.discountYear;
    t.byFrequency[l.frequency] += c.net + (c.periods === 0 ? c.setup : 0);
  }
  t.monthlyRecurring = Math.round(t.annualRecurringNet / 12);
  t.firstYearNet = t.annualRecurringNet + t.oneOffNet;
  t.firstYearVat = t.annualRecurringVat + t.oneOffVat;
  t.firstYearGross = t.firstYearNet + t.firstYearVat;
  t.ongoingNet = t.annualRecurringNet;
  t.ongoingVat = t.annualRecurringVat;
  t.ongoingGross = t.annualRecurringNet + t.annualRecurringVat;
  return t;
}

/** A new line from a catalogue service, with the price for this type of client. Editing it never changes the catalogue. */
export function lineFromService(s: CatalogueService, type: ClientType, id: string): Line {
  const p = priceFor(s, type);
  return {
    id, serviceKey: s.key, name: s.name, description: s.clientDescription || s.description, scope: s.scope, exclusions: s.exclusions, clientResp: s.clientResp, practiceResp: s.practiceResp,
    frequency: p.frequency, price: p.price, setupFee: s.setupFee, vat: s.vat, catalogPrice: p.price, catalogSetup: s.setupFee,
  };
}
export const customLine = (id: string): Line => ({ id, name: "", description: "", scope: "", exclusions: "", clientResp: "", practiceResp: "", frequency: "annual", price: 0, setupFee: 0, vat: "standard" });

// ------------------------------------------------------------------ content of a version

export type Content = {
  schema: 1; clientType: ClientType; recipientName: string; recipientEmail: string; title: string; introduction: string; requirements: string;
  startDate: string; validUntil: string; vatRate: number; lines: Line[]; notes: string;
};
export const emptyContent = (): Content => ({ schema: 1, clientType: "limited", recipientName: "", recipientEmail: "", title: "", introduction: "", requirements: "", startDate: "", validUntil: "", vatRate: DEFAULT_VAT_RATE, lines: [], notes: "" });

export const live = (c: Content) => c.lines.filter((l) => !l.optional);
export const optionalLines = (c: Content) => c.lines.filter((l) => l.optional);
export const contentTotals = (c: Content): Totals => totalsFor(live(c), c.vatRate);

export function readContent(body: unknown): Content {
  let o: unknown = body;
  if (typeof body === "string") { try { o = JSON.parse(body); } catch { return emptyContent(); } }
  if (!o || typeof o !== "object") return emptyContent();
  const r = o as Partial<Content>;
  const d = emptyContent();
  const lines = Array.isArray(r.lines) ? r.lines.filter((l) => l && typeof l === "object").map((l, i): Line => {
    const x = l as Partial<Line>;
    return {
      id: str(x.id) || `ln${i}`, serviceKey: x.serviceKey ? str(x.serviceKey) : undefined, name: str(x.name), description: str(x.description), scope: str(x.scope), exclusions: str(x.exclusions),
      clientResp: str(x.clientResp), practiceResp: str(x.practiceResp), frequency: isFreq(x.frequency) ? x.frequency : "annual", price: Math.max(0, num(x.price)), setupFee: Math.max(0, num(x.setupFee)),
      vat: isVat(x.vat) ? x.vat : "standard", optional: x.optional === true || undefined, catalogPrice: x.catalogPrice === undefined ? undefined : num(x.catalogPrice), catalogSetup: x.catalogSetup === undefined ? undefined : num(x.catalogSetup),
      note: x.note ? str(x.note) : undefined,
      discount: x.discount && typeof x.discount === "object" && num(x.discount.value) > 0 ? { kind: x.discount.kind === "amount" ? "amount" : "pct", value: num(x.discount.value), reason: x.discount.reason ? str(x.discount.reason) : undefined } : undefined,
    };
  }) : [];
  return {
    schema: 1, clientType: CLIENT_TYPES.some(([k]) => k === r.clientType) ? (r.clientType as ClientType) : d.clientType, recipientName: str(r.recipientName), recipientEmail: str(r.recipientEmail),
    title: str(r.title), introduction: str(r.introduction), requirements: str(r.requirements), startDate: str(r.startDate), validUntil: str(r.validUntil),
    vatRate: r.vatRate !== undefined && num(r.vatRate) >= 0 && num(r.vatRate) <= 1 ? num(r.vatRate) : DEFAULT_VAT_RATE, lines, notes: str(r.notes),
  };
}

/** Largest version body kept in one list cell. */
export const MAX_BODY = 60000;
const sort = (v: unknown): unknown => (Array.isArray(v) ? v.map(sort) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])])) : v);
/** The body as stored: the same content always gives the same text, so a hash of it can prove nothing changed. */
export const encodeContent = (c: Content): string => JSON.stringify(sort(c));
export async function hashText(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ------------------------------------------------------------------ permissions

export type ProposalAction = "view" | "edit" | "override-price" | "discount" | "discount-any" | "approve" | "send" | "record-acceptance" | "configure";
const MANAGERS: Role[] = ["manager", "partner", "owner"];
const SENIORS: Role[] = ["partner", "owner"];
/**
 * Who may do what. With no staff listed everyone may (the same as the rest of the app). Someone not on the list
 * can only look. Outsourced staff see nothing. Preparers draft; reviewers approve; managers price, discount within
 * the limit and send; partners and owners can discount without limit.
 */
export function proposalCan(cfg: Config, user: string, action: ProposalAction): boolean {
  if (!cfg.staff.length) return true;
  const role = staffRole(cfg, user);
  if (!role) return action === "view";
  if (role === "outsourced") return false;
  switch (action) {
    case "view": return true;
    case "edit": return role !== "reviewer";
    case "approve": return role !== "preparer";
    case "override-price": case "discount": case "send": case "record-acceptance": case "configure": return MANAGERS.includes(role);
    case "discount-any": return SENIORS.includes(role);
  }
}

export const DEFAULT_DISCOUNT_LIMIT = 10;

/** What a person isn't allowed to put in a draft: price changes, and discounts beyond their authority. */
export function editProblems(prev: Content | undefined, next: Content, can: (a: ProposalAction) => boolean, limitPct = DEFAULT_DISCOUNT_LIMIT): string[] {
  const out: string[] = [];
  for (const l of next.lines) {
    const before = prev?.lines.find((x) => x.id === l.id);
    const label = l.name || "A service";
    if (l.catalogPrice !== undefined && l.price !== l.catalogPrice && (!before || before.price !== l.price) && !can("override-price")) out.push(`${label}: you can't change the catalogue price. Ask a manager.`);
    if (l.catalogSetup !== undefined && l.setupFee !== l.catalogSetup && (!before || before.setupFee !== l.setupFee) && !can("override-price")) out.push(`${label}: you can't change the set-up fee. Ask a manager.`);
    if (l.discount && l.discount.value > 0) {
      const changed = !before || JSON.stringify(before.discount) !== JSON.stringify(l.discount);
      if (changed && !can("discount")) out.push(`${label}: you can't give a discount. Ask a manager.`);
      else if (changed && !can("discount-any")) {
        const pct = l.discount.kind === "pct" ? l.discount.value : l.price > 0 ? (l.discount.value / l.price) * 100 : 100;
        if (pct > limitPct) out.push(`${label}: discounts over ${limitPct}% need a partner.`);
      }
    }
  }
  return out;
}

/** Everything wrong with the content itself (not who is editing it). */
export function contentProblems(c: Content, today: string, forSending = false): string[] {
  const out: string[] = [];
  if (!c.title.trim()) out.push("Give the proposal a title.");
  for (const l of c.lines) {
    const label = l.name.trim() || "A line";
    if (!l.name.trim()) out.push("Every line needs a name.");
    if (!(l.price >= 0)) out.push(`${label}: the price can't be negative.`);
    if (l.discount) {
      if (l.discount.value < 0) out.push(`${label}: the discount can't be negative.`);
      if (l.discount.kind === "pct" && l.discount.value > 100) out.push(`${label}: a discount can't be more than 100%.`);
      if (l.discount.kind === "amount" && l.discount.value > l.price) out.push(`${label}: the discount is more than the fee.`);
    }
  }
  if (c.startDate && !/^\d{4}-\d{2}-\d{2}$/.test(c.startDate)) out.push("The start date isn't a date.");
  if (forSending) {
    if (!live(c).length) out.push("Add at least one service that isn't optional.");
    if (!c.validUntil) out.push("Set how long the proposal is valid for.");
    else if (c.validUntil < today) out.push("The valid-until date has already passed.");
    if (!c.recipientName.trim()) out.push("Say who the proposal is for.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.recipientEmail.trim())) out.push("Add an email address to send it to.");
  }
  return out;
}

// ------------------------------------------------------------------ proposals and versions

export type Status = "draft" | "review" | "approved" | "sent" | "accepted" | "rejected" | "expired" | "superseded";
export const STATUS_LABEL: Record<Status, string> = { draft: "Draft", review: "In review", approved: "Approved to send", sent: "Sent", accepted: "Accepted", rejected: "Rejected", expired: "Expired", superseded: "Superseded" };
export const STATUS_CHIP: Record<Status, string> = { draft: "", review: "amber", approved: "blue", sent: "blue", accepted: "green", rejected: "red", expired: "red", superseded: "" };
export const asStatus = (s: unknown): Status => (typeof s === "string" && s in STATUS_LABEL ? (s as Status) : "draft");
/** A sent proposal past its valid-until date is expired, whether or not anyone has recorded it. */
export function effectiveStatus(v: Row, today: string): Status {
  const s = asStatus(v.Status);
  return s === "sent" && v.ValidUntil && String(v.ValidUntil) < today ? "expired" : s;
}
export const isFrozen = (s: Status) => s !== "draft" && s !== "review";
export const isLiveStatus = (s: Status) => s === "draft" || s === "review" || s === "approved" || s === "sent";

/** P-2026-0001, counting this year's proposals. */
export function nextRef(proposals: Row[], year: number): string {
  const prefix = `P-${year}-`;
  const used = proposals.map((p) => (String(p.Ref || "").startsWith(prefix) ? Number(String(p.Ref).slice(prefix.length)) || 0 : 0));
  return `${prefix}${String(Math.max(0, ...used) + 1).padStart(4, "0")}`;
}

const parties = (p: Row, opp?: Row) => ({ leadKey: str(p.LeadKey || opp?.LeadKey), clientKey: str(p.ClientKey || opp?.ClientKey), oppKey: str(p.OppKey || opp?.Key) });
const totalsCols = (c: Content): Row => { const t = contentTotals(c); return { FirstYearNet: pounds(t.firstYearNet), FirstYearGross: pounds(t.firstYearGross), OngoingNet: pounds(t.ongoingNet), OngoingGross: pounds(t.ongoingGross) }; };

/** Start a proposal (version 1, a draft) for an opportunity. */
export function createProposal(opp: Opp, content: Content, existing: Row[], o: Ctx): { proposal: Row; version: Row; log: Row; activity: Row } | { error: string } {
  if (!content.title.trim()) return { error: "Give the proposal a title." };
  if (outcomeOf(opp) !== "open") return { error: "This opportunity is closed. Reopen it first." };
  const key = o.newKey("PR");
  const ref = nextRef(existing, Number(o.now.slice(0, 4)));
  const proposal: Row = {
    Key: key, PracticeId: o.pid, Ref: ref, Title: content.title.trim(), OppKey: opp.Key, LeadKey: opp.LeadKey || "", ClientKey: opp.ClientKey || "", CurrentVersion: 1,
    Status: "draft", AcceptedVersion: 0, Created: o.now, CreatedBy: o.actor, Updated: o.now,
  };
  const version: Row = {
    Key: o.newKey("PV"), PracticeId: o.pid, ProposalKey: key, Version: 1, Status: "draft", Body: encodeContent(content), ValidUntil: content.validUntil, Created: o.now, CreatedBy: o.actor, Updated: o.now, ...totalsCols(content),
  };
  const refs = parties(proposal, opp);
  return { proposal, version, log: logRow(o, "created", "proposal", key, refs, { ref, version: 1 }), activity: activityRow(o, "proposal-created", `Proposal ${ref} started: ${proposal.Title}`, opp, refs, "", `proposal:${key}:created`) };
}

/** Save the wording and lines of a draft. Anything already sent for review, approved or sent is frozen: revise it instead. */
export function saveDraft(proposal: Row, version: Row, content: Content, o: Ctx): Written | { error: string } {
  const s = asStatus(version.Status);
  if (s !== "draft") return { error: s === "review" ? "Return it to draft before editing." : "This version can't be edited. Make a revision instead." };
  const body = encodeContent(content);
  if (body.length > MAX_BODY) return { error: "This proposal is too long to save. Shorten the descriptions or remove a service." };
  return {
    patches: [
      { list: "ProposalVersions", row: version, patch: { Body: body, ValidUntil: content.validUntil, Updated: o.now, ...totalsCols(content) } },
      { list: "Proposals", row: proposal, patch: { Title: content.title.trim() || proposal.Title, Updated: o.now } },
    ],
    log: [], activities: [],
  };
}

type Edge = { to: Status; action: ProposalAction; log: string };
const EDGES: Partial<Record<Status, Edge[]>> = {
  draft: [{ to: "review", action: "edit", log: "submitted" }, { to: "approved", action: "approve", log: "approved" }],
  review: [{ to: "approved", action: "approve", log: "approved" }, { to: "draft", action: "approve", log: "returned" }],
  approved: [{ to: "sent", action: "send", log: "sent" }, { to: "draft", action: "edit", log: "withdrawn" }],
};
export const nextSteps = (s: Status): Status[] => (EDGES[s] || []).map((e) => e.to);

export type Who = { can: (a: ProposalAction) => boolean; independent: boolean };
export type Move = { to: Status; note?: string; sentTo?: string; docKey?: string; /** SHA-256 of the body, taken when it is sent. */ hash?: string };

/** Move a version along the workflow: submit, approve, return, withdraw approval, send. */
export function advance(proposal: Row, version: Row, move: Move, who: Who, today: string, o: Ctx): Written | { error: string } {
  const from = asStatus(version.Status);
  const edge = (EDGES[from] || []).find((e) => e.to === move.to);
  if (!edge) return { error: `A ${STATUS_LABEL[from].toLowerCase()} proposal can't go to ${STATUS_LABEL[move.to].toLowerCase()}.` };
  if (!who.can(edge.action)) return { error: edge.action === "send" ? "Only a manager or partner can send proposals." : edge.action === "approve" ? "You can't approve proposals." : "You can't change this proposal." };
  if (edge.to === "approved" && who.independent && version.CreatedBy && String(version.CreatedBy) === o.actor) return { error: "Someone else has to approve a proposal you prepared." };
  const content = readContent(version.Body);
  const patch: Row = { Status: move.to, Updated: o.now };
  if (move.to === "review") { patch.ReviewedBy = ""; patch.ReviewedOn = ""; }
  if (move.to === "approved") { patch.ApprovedBy = o.actor; patch.ApprovedOn = o.now; }
  if (move.to === "draft") { patch.ApprovedBy = ""; patch.ApprovedOn = ""; patch.ReturnNote = move.note || ""; }
  if (move.to === "sent") {
    const bad = contentProblems(content, today, true);
    if (bad.length) return { error: bad[0] };
    if (!move.hash) return { error: "The proposal couldn't be sealed. Try again." };
    patch.SentOn = o.now; patch.SentBy = o.actor; patch.SentTo = move.sentTo || content.recipientEmail; patch.Hash = move.hash; if (move.docKey) patch.DocKey = move.docKey;
  }
  const refs = parties(proposal);
  const w: Written = {
    patches: [{ list: "ProposalVersions", row: version, patch }, { list: "Proposals", row: proposal, patch: { Status: move.to, Updated: o.now } }],
    log: [logRow(o, edge.log, "proposal", String(proposal.Key), refs, { version: Number(version.Version), from, to: move.to, note: move.note || "", sentTo: patch.SentTo || "" })],
    activities: [],
  };
  if (move.to === "sent") w.activities.push(activityRow(o, "proposal-sent", `Proposal ${proposal.Ref} sent to ${patch.SentTo}`, undefined, refs, `Version ${version.Version}, valid until ${content.validUntil}`, `proposal:${proposal.Key}:sent:${version.Version}`));
  return w;
}

/** A new draft version copied from this one. The old version is kept and, if it had gone out, marked superseded. */
export function revise(proposal: Row, version: Row, all: Row[], o: Ctx, can: (a: ProposalAction) => boolean): Written | { error: string } {
  if (!can("edit")) return { error: "You can't change this proposal." };
  const s = asStatus(version.Status);
  if (s === "accepted") return { error: "An accepted proposal can't be revised. Start a new proposal for any change." };
  if (s === "superseded") return { error: "That version has already been replaced." };
  if (s === "draft") return { error: "This version is still a draft. Edit it directly." };
  const mine = all.filter((v) => v.ProposalKey === proposal.Key);
  if (mine.some((v) => asStatus(v.Status) === "draft")) return { error: "There is already a draft version. Edit that one." };
  const n = Math.max(0, ...mine.map((v) => Number(v.Version) || 0)) + 1;
  const content = readContent(version.Body);
  const fresh: Row = {
    Key: o.newKey("PV"), PracticeId: o.pid, ProposalKey: proposal.Key, Version: n, Status: "draft", Body: encodeContent(content), ValidUntil: "", Created: o.now, CreatedBy: o.actor, Updated: o.now, ...totalsCols(content),
  };
  const refs = parties(proposal);
  const w: Written = {
    patches: [{ list: "Proposals", row: proposal, patch: { CurrentVersion: n, Status: "draft", Updated: o.now } }],
    creates: [{ list: "ProposalVersions", row: fresh }],
    log: [logRow(o, "revised", "proposal", String(proposal.Key), refs, { from: Number(version.Version), to: n })],
    activities: [activityRow(o, "proposal-revised", `Proposal ${proposal.Ref} revised (version ${n})`, undefined, refs, "", `proposal:${proposal.Key}:revised:${n}`)],
  };
  w.patches.push({ list: "ProposalVersions", row: version, patch: { Status: "superseded", Updated: o.now } });
  return w;
}

// ------------------------------------------------------------------ acceptance and rejection

export type Acceptance = { name: string; email?: string; method: "recorded" | "link"; evidence: string; optional?: string[]; when?: string; ip?: string };
/**
 * Record a client's acceptance of the version that was sent. What they agreed to (services, fees, the version) is
 * written onto the version itself and the opportunity moves to its won stage. Acceptance is NOT treated as AML
 * complete or as a signed engagement letter: those are separate steps.
 */
export function accept(proposal: Row, version: Row, a: Acceptance, who: Who, today: string, opp: Opp | undefined, all: Opp[], stages: Stage[], o: Ctx): Written | { error: string } {
  if (a.method === "recorded" && !who.can("record-acceptance")) return { error: "Only a manager or partner can record an acceptance." };
  const s = effectiveStatus(version, today);
  if (s === "expired") return { error: "This proposal has expired. Revise it and send a new version." };
  if (s !== "sent") return { error: s === "accepted" ? "This proposal has already been accepted." : "Only a proposal that has been sent can be accepted." };
  if (!a.name.trim()) return { error: "Say who accepted it." };
  if (a.method === "recorded" && !a.evidence.trim()) return { error: "Say how you know (for example, the email or call)." };
  const content = readContent(version.Body);
  const chosen = new Set(a.optional || []);
  const lines = content.lines.filter((l) => !l.optional || chosen.has(l.id));
  const t = totalsFor(lines, content.vatRate);
  const when = a.when || o.now;
  const agreed = JSON.stringify({
    lines: lines.map((l) => ({ id: l.id, serviceKey: l.serviceKey || "", name: l.name, frequency: l.frequency, price: l.price, discount: l.discount || null, setupFee: l.setupFee, vat: l.vat, optional: !!l.optional })),
    vatRate: content.vatRate, totals: { annualRecurringNet: pounds(t.annualRecurringNet), oneOffNet: pounds(t.oneOffNet), firstYearNet: pounds(t.firstYearNet), firstYearGross: pounds(t.firstYearGross), ongoingNet: pounds(t.ongoingNet), ongoingGross: pounds(t.ongoingGross) },
  });
  const refs = parties(proposal, opp);
  const w: Written = {
    patches: [
      { list: "ProposalVersions", row: version, patch: { Status: "accepted", AcceptedBy: a.name.trim(), AcceptedEmail: (a.email || "").trim(), AcceptedAt: when, AcceptMethod: a.method, AcceptEvidence: a.evidence.trim(), AcceptIp: a.ip || "", Agreed: agreed, Updated: o.now } },
      { list: "Proposals", row: proposal, patch: { Status: "accepted", AcceptedVersion: Number(version.Version), Updated: o.now } },
    ],
    log: [logRow(o, "accepted", "proposal", String(proposal.Key), refs, { version: Number(version.Version), by: a.name.trim(), method: a.method, evidence: a.evidence.trim(), optional: [...chosen], firstYearGross: pounds(t.firstYearGross) })],
    activities: [activityRow(o, "proposal-accepted", `Proposal ${proposal.Ref} accepted by ${a.name.trim()}`, opp, refs, `Version ${version.Version}, ${gbp(t.firstYearGross)} first year including VAT`, `proposal:${proposal.Key}:accepted`)],
  };
  if (opp) {
    const moved = moveStage(opp, wonStage(stages).key, undefined, all, stages, o);
    const value = pounds(t.annualRecurringNet || t.firstYearNet);
    if (!("error" in moved)) {
      for (const pt of moved.patches) pt.patch.Value = value; // the opportunity now carries the agreed annual value
      w.patches.push(...moved.patches); w.log.push(...moved.log); w.activities.push(...moved.activities);
    } else w.patches.push({ list: "Opportunities", row: opp, patch: { Value: value, Updated: o.now } });
  }
  return w;
}

export function reject(proposal: Row, version: Row, reason: string, who: Who, today: string, o: Ctx): Written | { error: string } {
  if (!who.can("record-acceptance")) return { error: "Only a manager or partner can record a decision." };
  const s = effectiveStatus(version, today);
  if (s !== "sent" && s !== "expired") return { error: "Only a proposal that has been sent can be rejected." };
  if (!reason.trim()) return { error: "Say why it was turned down." };
  const refs = parties(proposal);
  return {
    patches: [
      { list: "ProposalVersions", row: version, patch: { Status: "rejected", RejectedReason: reason.trim(), RejectedAt: o.now, Updated: o.now } },
      { list: "Proposals", row: proposal, patch: { Status: "rejected", Updated: o.now } },
    ],
    log: [logRow(o, "rejected", "proposal", String(proposal.Key), refs, { version: Number(version.Version), reason: reason.trim() })],
    activities: [activityRow(o, "proposal-rejected", `Proposal ${proposal.Ref} turned down`, undefined, refs, reason.trim(), `proposal:${proposal.Key}:rejected:${version.Version}`)],
  };
}

/** Does the stored body still match the hash taken when it was sent? */
export async function untouched(version: Row): Promise<boolean> {
  if (!version.Hash) return true;
  return (await hashText(str(version.Body))) === String(version.Hash);
}

// ------------------------------------------------------------------ opportunity stages

/** Move the opportunity on to a stage only if that is forward of where it is now. */
export function advanceOpp(opp: Opp, stageKey: string, all: Opp[], stages: Stage[], o: Ctx): Written | undefined {
  const to = stages.findIndex((s) => s.key === stageKey), at = stages.findIndex((s) => s.key === opp.Stage);
  if (to < 0 || outcomeOf(opp) !== "open" || stages[to].won || to <= at) return undefined;
  const r = moveStage(opp, stageKey, undefined, all, stages, o);
  return "error" in r ? undefined : r;
}

// ------------------------------------------------------------------ the proposal template and document

export type ProposalTemplate = { coverPage: boolean; introduction: string; about: string; terms: string; acceptanceText: string; closing: string; showScope: boolean; showResponsibilities: boolean; brandingId: string };
export const DEFAULT_TEMPLATE: ProposalTemplate = {
  coverPage: true, brandingId: "", showScope: true, showResponsibilities: true,
  introduction: "Thank you for the opportunity to propose our services to {{client}}. This proposal sets out what we would do, what we need from you, and what it would cost.",
  about: "",
  terms: "Fees are shown excluding VAT unless stated. Fees for recurring services are charged at the frequency shown. This proposal is valid until {{validUntil}}. Accepting it confirms the services and fees only: we also need to complete our identity and anti-money-laundering checks and agree our formal engagement letter before work begins.",
  acceptanceText: "To accept this proposal, please sign below or reply to confirm in writing. By accepting you agree to the services and fees above.",
  closing: "We look forward to working with you.",
};
export function readTemplate(v: unknown): ProposalTemplate {
  let o: unknown = v;
  if (typeof v === "string") { try { o = JSON.parse(v); } catch { return DEFAULT_TEMPLATE; } }
  if (!o || typeof o !== "object") return DEFAULT_TEMPLATE;
  const r = o as Partial<ProposalTemplate>;
  const d = DEFAULT_TEMPLATE;
  return {
    coverPage: r.coverPage !== false, brandingId: str(r.brandingId), showScope: r.showScope !== false, showResponsibilities: r.showResponsibilities !== false,
    introduction: r.introduction !== undefined ? str(r.introduction) : d.introduction, about: str(r.about), terms: r.terms !== undefined ? str(r.terms) : d.terms,
    acceptanceText: r.acceptanceText !== undefined ? str(r.acceptanceText) : d.acceptanceText, closing: r.closing !== undefined ? str(r.closing) : d.closing,
  };
}
export const fill = (text: string, vars: Record<string, string>): string => text.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (m, k: string) => (k.toLowerCase() in vars ? vars[k.toLowerCase()] : m));

export type DocContext = { client: string; practice: string; contact: string; reference: string; date: string; version: number };
const r = (t: string, o: Partial<Run> = {}): Run => ({ t, ...o });
const para = (text: string, o: Partial<Run> = {}): Block[] => text.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean).map((x) => ({ type: "p" as const, runs: [r(x.replace(/\n/g, " "), o)] }));
const bullets = (text: string): Block[] => { const items = text.split("\n").map((x) => x.replace(/^[\s*•-]+/, "").trim()).filter(Boolean); return items.length ? [{ type: "list", ordered: false, items: items.map((x) => [r(x)]) }] : []; };
const heading = (text: string, level: 1 | 2 | 3 = 2): Block => ({ type: "h", level, runs: [r(text)] });
const fmtD = (d: string) => (d ? new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "");
const cell = (t: string, o: Partial<Run> = {}, align?: "right") => ({ runs: [r(t, o)], align });

/** The proposal as a document the Document Designer can lay out, in the practice's branding. */
export function proposalDocument(content: Content, tpl: ProposalTemplate, c: DocContext): DocContent {
  const vars = { client: c.client, practice: c.practice, contact: c.contact || c.client, validuntil: fmtD(content.validUntil), startdate: fmtD(content.startDate), reference: c.reference, date: fmtD(c.date) };
  const b: Block[] = [];
  if (tpl.coverPage) {
    b.push(heading(content.title || "Proposal", 1), { type: "p", runs: [r(`Prepared for ${c.client}`, { b: true })] }, { type: "p", runs: [r(`${c.practice} · ${fmtD(c.date)}`)] }, { type: "p", runs: [r(`Reference ${c.reference}${c.version > 1 ? ` (version ${c.version})` : ""}`)] });
    if (content.validUntil) b.push({ type: "p", runs: [r(`Valid until ${fmtD(content.validUntil)}`)] });
    b.push({ type: "break" });
  } else b.push(heading(content.title || "Proposal", 1));
  const intro = fill(content.introduction || tpl.introduction, vars);
  if (intro.trim()) b.push(heading("Introduction"), ...para(intro));
  if (tpl.about.trim()) b.push(heading(`About ${c.practice}`), ...para(fill(tpl.about, vars)));
  if (content.requirements.trim()) b.push(heading("Your requirements"), ...para(content.requirements));
  const main = live(content), opt = optionalLines(content);
  if (main.length || opt.length) b.push(heading("Services"));
  for (const l of [...main, ...opt]) {
    b.push(heading(l.name + (l.optional ? " (optional)" : ""), 3));
    if (l.description.trim()) b.push(...para(l.description));
    if (tpl.showScope && l.scope.trim()) b.push({ type: "p", runs: [r("What's included", { b: true })] }, ...bullets(l.scope));
    if (tpl.showScope && l.exclusions.trim()) b.push({ type: "p", runs: [r("Not included", { b: true })] }, ...bullets(l.exclusions));
    if (tpl.showResponsibilities && l.clientResp.trim()) b.push({ type: "p", runs: [r("Your responsibilities", { b: true })] }, ...bullets(l.clientResp));
    if (tpl.showResponsibilities && l.practiceResp.trim()) b.push({ type: "p", runs: [r("Our responsibilities", { b: true })] }, ...bullets(l.practiceResp));
  }
  const feeRows = (ls: Line[]) => ls.flatMap((l) => {
    const k = calcLine(l, content.vatRate);
    const rows = [[cell(l.name), cell(freqLabel(l.frequency)), cell(gbp(k.gross), {}, "right"), cell(k.discount ? "-" + gbp(k.discount) : "", {}, "right"), cell(gbp(k.net), {}, "right"), cell(l.vat === "standard" ? gbp(k.vatEach) : "No VAT", {}, "right"), cell(gbp(k.totalEach), { b: true }, "right")]];
    if (k.setup) rows.push([cell(`${l.name}: set-up fee`), cell("One-off"), cell(gbp(k.setup), {}, "right"), cell(""), cell(gbp(k.setup), {}, "right"), cell(l.vat === "standard" ? gbp(vatOf(k.setup, l.vat, content.vatRate)) : "No VAT", {}, "right"), cell(gbp(k.setup + vatOf(k.setup, l.vat, content.vatRate)), { b: true }, "right")]);
    return rows;
  });
  const head = ["Service", "Charged", "Fee", "Discount", "Net", "VAT", "Total"].map((h, i) => cell(h, { b: true }, i >= 2 ? "right" : undefined));
  if (main.length) {
    b.push(heading("Fees"), { type: "table", header: true, rows: [head, ...feeRows(main)] });
    const t = contentTotals(content);
    const rows: [string, string][] = [];
    if (t.annualRecurringNet) rows.push(["Recurring fees per month (net)", gbp(t.monthlyRecurring)], ["Recurring fees per year (net)", gbp(t.annualRecurringNet)]);
    if (t.oneOffNet) rows.push(["One-off fees including any set-up (net)", gbp(t.oneOffNet)]);
    if (t.discounts) rows.push(["Discounts included above, first year", gbp(t.discounts)]);
    rows.push(["First year total, excluding VAT", gbp(t.firstYearNet)], [`VAT at ${Math.round(content.vatRate * 1000) / 10}% where it applies`, gbp(t.firstYearVat)], ["First year total, including VAT", gbp(t.firstYearGross)]);
    if (t.annualRecurringNet) rows.push(["Each year after, excluding VAT", gbp(t.ongoingNet)], ["Each year after, including VAT", gbp(t.ongoingGross)]);
    b.push(heading("Summary of fees", 3), { type: "table", header: false, rows: rows.map(([k, v], i) => [cell(k, i >= rows.length - (t.annualRecurringNet ? 4 : 2) ? { b: true } : {}), cell(v, { b: true }, "right")]) });
  }
  if (opt.length) b.push(heading("Optional services", 3), ...para("These are not included in the totals above. Tell us if you would like to add any of them."), { type: "table", header: true, rows: [head, ...feeRows(opt)] });
  if (content.startDate) b.push(heading("Proposed start date"), ...para(`We propose to start on ${fmtD(content.startDate)}.`));
  if (tpl.terms.trim()) b.push(heading("Terms"), ...para(fill(tpl.terms, vars)));
  if (tpl.closing.trim()) b.push(...para(fill(tpl.closing, vars)));
  b.push({ type: "break" }, heading("Acceptance"), ...para(fill(tpl.acceptanceText, vars)));
  b.push({ type: "table", header: false, rows: [[cell("Signed", { b: true }), cell("")], [cell("Name", { b: true }), cell("")], [cell("Position", { b: true }), cell("")], [cell("Date", { b: true }), cell("")]] });
  return { blocks: b };
}

/** Who should be asked what, before a proposal is sent: a short summary for the review step. */
export function reviewSummary(c: Content, t: Totals): string[] {
  const out = [`${live(c).length} service${live(c).length === 1 ? "" : "s"}${optionalLines(c).length ? ` and ${optionalLines(c).length} optional` : ""}`, `First year ${gbp(t.firstYearGross)} including VAT`];
  if (t.annualRecurringNet) out.push(`Then ${gbp(t.ongoingGross)} a year including VAT`);
  const overridden = c.lines.filter((l) => l.catalogPrice !== undefined && l.catalogPrice !== l.price).length;
  const discounted = c.lines.filter((l) => l.discount && l.discount.value > 0).length;
  if (overridden) out.push(`${overridden} price${overridden === 1 ? "" : "s"} changed from the catalogue`);
  if (discounted) out.push(`${discounted} discounted`);
  return out;
}
