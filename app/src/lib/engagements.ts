// Engagement letters (Phase 3 of the lead-to-client lifecycle). Pure logic, like sales.ts and proposals.ts.
//
// The accepted proposal drives the commercial agreement; the engagement letter formalises scope,
// responsibilities and terms. A letter is made from the practice's own reviewed wording (never invented),
// the client type, the services and fees that were agreed, and each service's own clauses. A client can
// have several engagements at once. A letter made outside the planner can be filed too. Every engagement
// carries a review date (three years by default, changeable at practice, template, client and engagement
// level), and nothing is overwritten: a renewal is a new engagement that supersedes the old one.
import { Block, DocContent, Run } from "./docModel";
import { Config, Role, staffRole } from "./checklist";
import { ClientType, CLIENT_TYPES, CatalogueService, Line, ProposalAction, calcLine, clientTypeFor, freqLabel, gbp, proposalCan, totalsFor, typeLabel, fill } from "./proposals";
import { Ctx, Written, activityRow, logRow } from "./sales";
import { Row } from "./schema";


const str = (v: unknown): string => (v === undefined || v === null ? "" : String(v));
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// ------------------------------------------------------------------ settings

export const SECTIONS = [
  ["wording", "Standard engagement wording"], ["practice", "Practice details"], ["clientResp", "Client responsibilities"], ["practiceResp", "Practice responsibilities"],
  ["feeTerms", "Fee terms"], ["terms", "Terms and conditions"], ["liability", "Limitation of liability"], ["confidentiality", "Confidentiality"],
  ["dataProtection", "Data protection"], ["termination", "Termination"], ["signature", "Signature requirements"], ["renewal", "Renewal and review"],
] as const;
export type SectionKey = (typeof SECTIONS)[number][0];
export type Sections = Record<SectionKey, string>;
/** Placeholders only. The practice writes (and has reviewed) its own terms: nothing here is legal wording. */
export const BLANK_SECTIONS: Sections = {
  wording: "This letter confirms the basis on which {{practice}} will act for {{client}} and sets out the services, responsibilities and fees we have agreed.",
  practice: "", clientResp: "", practiceResp: "", feeTerms: "", terms: "", liability: "", confidentiality: "", dataProtection: "", termination: "", signature: "Please sign below to confirm that you accept this letter.",
  renewal: "This engagement will be reviewed on {{reviewDate}}, and then at least every {{years}} years, or sooner if the services or your circumstances change.",
};
export type ReviewStamp = { by: string; at: string; hash: string };
export type EngagementSettings = {
  base: Sections;
  byType: Partial<Record<ClientType, Partial<Sections>>>;
  years: number;                                    // practice default review interval
  typeYears: Partial<Record<ClientType, number>>;    // template level
  clientYears: Record<string, number>;               // client level
  remindDays: number[];                              // reminders before a review falls due
  reviewed: Partial<Record<ClientType | "base", ReviewStamp>>;
};
export const DEFAULT_YEARS = 3;
export const DEFAULT_REMIND = [90, 30];
export const DEFAULT_ENGAGEMENT_SETTINGS: EngagementSettings = { base: BLANK_SECTIONS, byType: {}, years: DEFAULT_YEARS, typeYears: {}, clientYears: {}, remindDays: DEFAULT_REMIND, reviewed: {} };

const years = (v: unknown): number | undefined => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 10 ? n : undefined; };

export function readEngagementSettings(settings: Row[]): EngagementSettings {
  const row = settings.find((r) => r.Key === "engagement.settings");
  if (!row?.Value) return DEFAULT_ENGAGEMENT_SETTINGS;
  let o: Record<string, any>;
  try { o = JSON.parse(String(row.Value)); } catch { return DEFAULT_ENGAGEMENT_SETTINGS; }
  if (!o || typeof o !== "object") return DEFAULT_ENGAGEMENT_SETTINGS;
  const secs = (x: any): Partial<Sections> => { const out: Partial<Sections> = {}; for (const [k] of SECTIONS) if (x && typeof x[k] === "string") out[k] = x[k]; return out; };
  const base = { ...BLANK_SECTIONS, ...secs(o.base) };
  const byType: EngagementSettings["byType"] = {}; const typeYears: EngagementSettings["typeYears"] = {}; const reviewed: EngagementSettings["reviewed"] = {};
  for (const [t] of CLIENT_TYPES) {
    if (o.byType?.[t]) byType[t] = secs(o.byType[t]);
    const y = years(o.typeYears?.[t]); if (y) typeYears[t] = y;
  }
  for (const k of ["base", ...CLIENT_TYPES.map(([t]) => t)] as const) { const r = o.reviewed?.[k]; if (r && typeof r.hash === "string") reviewed[k] = { by: str(r.by), at: str(r.at), hash: r.hash }; }
  const clientYears: Record<string, number> = {};
  for (const [k, v] of Object.entries(o.clientYears || {})) { const y = years(v); if (y) clientYears[k] = y; }
  const remind = Array.isArray(o.remindDays) ? [...new Set((o.remindDays as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 365))].sort((a, b) => b - a) : DEFAULT_REMIND;
  return { base, byType, years: years(o.years) || DEFAULT_YEARS, typeYears, clientYears, remindDays: remind.length ? remind : DEFAULT_REMIND, reviewed };
}

/** The wording for one client type: the practice-wide text, with any of its own sections swapped in. */
export function templateFor(s: EngagementSettings, type: ClientType): Sections {
  const out = { ...s.base };
  for (const [k] of SECTIONS) { const v = s.byType[type]?.[k]; if (v !== undefined && v.trim()) out[k] = v; }
  return out;
}
/** A short fingerprint of wording, so a template that has changed since it was reviewed is noticed. */
export function wordingHash(sec: Sections): string {
  let h = 2166136261;
  const t = SECTIONS.map(([k]) => sec[k]).join("\u0001");
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, "0") + t.length.toString(16);
}
/** Wording may be used for letters only once someone with authority has reviewed exactly this text. */
export function reviewStatus(s: EngagementSettings, type: ClientType): { ok: boolean; reason: string } {
  const stamp = s.reviewed[type] || s.reviewed.base;
  if (!stamp) return { ok: false, reason: `The ${typeLabel(type).toLowerCase()} wording hasn't been reviewed yet. Review it in Settings › Engagement letters.` };
  if (stamp.hash !== wordingHash(templateFor(s, type))) return { ok: false, reason: `The ${typeLabel(type).toLowerCase()} wording has changed since it was reviewed. Review it again in Settings › Engagement letters.` };
  return { ok: true, reason: "" };
}
export function reviewTemplate(s: EngagementSettings, scope: ClientType | "base", can: (a: ProposalAction) => boolean, who: string, now: string): { settings: EngagementSettings } | { error: string } {
  if (!can("configure")) return { error: "Only a manager or partner can mark wording as reviewed." };
  const sec = scope === "base" ? s.base : templateFor(s, scope);
  if (!sec.wording.trim()) return { error: "Add the standard engagement wording first." };
  return { settings: { ...s, reviewed: { ...s.reviewed, [scope]: { by: who, at: now, hash: wordingHash(sec) } } } };
}

/** How many years until review: this engagement, else this client, else the client-type template, else the practice. */
export function reviewYears(s: EngagementSettings, o: { engagementYears?: unknown; clientKey?: string; type?: ClientType }): number {
  return years(o.engagementYears) || (o.clientKey ? s.clientYears[o.clientKey] : undefined) || (o.type ? s.typeYears[o.type] : undefined) || s.years;
}
/** The same day some years on. 29 February lands on 28 February in a non-leap year. */
export function addYears(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const ny = y + n;
  const last = new Date(Date.UTC(ny, m, 0)).getUTCDate();
  return `${ny}-${String(m).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

// ------------------------------------------------------------------ engagements

export type EngStatus = "draft" | "review" | "approved" | "out" | "signed" | "unsigned" | "superseded" | "ended";
export const ENG_LABEL: Record<EngStatus, string> = { draft: "Draft", review: "In review", approved: "Approved", out: "Out for signature", signed: "Signed", unsigned: "On file, unsigned", superseded: "Superseded", ended: "Ended" };
export const ENG_CHIP: Record<EngStatus, string> = { draft: "", review: "amber", approved: "blue", out: "amber", signed: "green", unsigned: "amber", superseded: "", ended: "" };
export const asEng = (v: unknown): EngStatus => (v === "review" || v === "approved" || v === "out" || v === "signed" || v === "unsigned" || v === "superseded" || v === "ended" ? v : "draft");
/** In force or about to be: counts towards covering a client's services. */
export const isLive = (e: Row) => ["draft", "review", "approved", "out", "signed", "unsigned"].includes(asEng(e.Status));
export const isInForce = (e: Row) => ["signed", "unsigned"].includes(asEng(e.Status));

export type EngagementAction = ProposalAction | "renewal-decision";
export function engagementCan(cfg: Config, user: string, action: EngagementAction): boolean {
  if (action === "renewal-decision") return proposalCan(cfg, user, "configure");
  return proposalCan(cfg, user, action);
}
export const roleOf = (cfg: Config, user: string): Role | undefined => staffRole(cfg, user);

export type Decision = { at: string; by: string; decision: string; note: string; from?: string; to?: string };
export const readDecisions = (v: unknown): Decision[] => { try { const a = JSON.parse(str(v) || "[]"); return Array.isArray(a) ? a : []; } catch { return []; } };
export const readList = (v: unknown): string[] => { try { const a = JSON.parse(str(v) || "[]"); return Array.isArray(a) ? a.map(String) : []; } catch { return []; } };

export function nextRef(rows: Row[], year: number): string {
  const prefix = `E-${year}-`;
  const used = rows.map((p) => (str(p.Ref).startsWith(prefix) ? Number(str(p.Ref).slice(prefix.length)) || 0 : 0));
  return `${prefix}${String(Math.max(0, ...used) + 1).padStart(4, "0")}`;
}
export const MAX_BODY = 60000;
export const encodeBody = (c: DocContent) => JSON.stringify(c);
export function readBody(v: unknown): DocContent { try { const o = JSON.parse(str(v)); return o && Array.isArray(o.blocks) ? (o as DocContent) : { blocks: [] }; } catch { return { blocks: [] }; } }
export async function sealHash(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export async function intact(e: Row): Promise<boolean> { return !e.Hash || (await sealHash(str(e.Body))) === str(e.Hash); }

export const refsOf = (e: Row) => ({ clientKey: str(e.ClientKey), leadKey: str(e.LeadKey) });

// ------------------------------------------------------------------ the letter

const r = (t: string, o: Partial<Run> = {}): Run => ({ t, ...o });
const para = (text: string, o: Partial<Run> = {}): Block[] => text.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean).map((x) => ({ type: "p" as const, runs: [r(x.replace(/\n/g, " "), o)] }));
const heading = (t: string, level: 1 | 2 | 3 = 2): Block => ({ type: "h", level, runs: [r(t)] });
const bullets = (text: string): Block[] => { const items = text.split("\n").map((x) => x.replace(/^[-•*\s]+/, "").trim()).filter(Boolean); return items.length ? [{ type: "list", ordered: false, items: items.map((t) => [r(t)]) }] : []; };
const cell = (t: string, o: Partial<Run> = {}, align?: "right") => ({ runs: [r(t, o)], align });
const fmtD = (d: string) => { const x = new Date(d + "T00:00:00"); return Number.isNaN(+x) ? d : x.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }); };

export type AgreedLine = { id: string; serviceKey: string; name: string; frequency: string; price: number; discount: Line["discount"] | null; setupFee: number; vat: string; optional: boolean };
export type Agreed = { lines: AgreedLine[]; vatRate: number };
export function readAgreed(v: unknown): Agreed | undefined {
  try { const o = JSON.parse(str(v)); if (!o || !Array.isArray(o.lines)) return undefined; return { vatRate: num(o.vatRate) || 0.2, lines: o.lines.map((l: any) => ({ id: str(l.id), serviceKey: str(l.serviceKey), name: str(l.name), frequency: str(l.frequency) || "annual", price: num(l.price), discount: l.discount || null, setupFee: num(l.setupFee), vat: str(l.vat) || "standard", optional: !!l.optional })) }; } catch { return undefined; }
}
const asLine = (l: AgreedLine): Line => ({ id: l.id, serviceKey: l.serviceKey, name: l.name, description: "", scope: "", exclusions: "", clientResp: "", practiceResp: "", clauses: "", frequency: l.frequency as Line["frequency"], price: l.price, setupFee: l.setupFee, vat: l.vat as Line["vat"], discount: l.discount || undefined } as Line);

export type LetterInput = {
  sections: Sections; client: { name: string; address: string; companyNumber: string; type: ClientType }; practice: string; agreed: Agreed; catalogue: CatalogueService[];
  ref: string; date: string; effectiveDate: string; reviewDate: string; years: number; proposalRef: string; signatories: string[];
};
/** The draft letter as document blocks, ready for the existing Document Designer layout and PDF. */
export function engagementDocument(i: LetterInput): DocContent {
  const vars: Record<string, string> = { client: i.client.name, practice: i.practice, date: fmtD(i.date), effectivedate: fmtD(i.effectiveDate), reviewdate: i.reviewDate ? fmtD(i.reviewDate) : "the review date", years: String(i.years), reference: i.ref, proposal: i.proposalRef };
  const sec = (k: SectionKey) => fill(i.sections[k] || "", vars);
  const b: Block[] = [];
  b.push(heading(`Engagement letter: ${i.client.name}`, 1), { type: "p", runs: [r(`${i.practice} · ${fmtD(i.date)}`)] }, { type: "p", runs: [r(`Reference ${i.ref}${i.proposalRef ? ` · from proposal ${i.proposalRef}` : ""}`)] });
  b.push({ type: "p", runs: [r(`Client: ${i.client.name}${i.client.companyNumber ? ` (company number ${i.client.companyNumber})` : ""}`, { b: true })] });
  if (i.client.address.trim()) b.push({ type: "p", runs: [r(i.client.address.replace(/\s*\n\s*/g, ", "))] });
  b.push({ type: "p", runs: [r(`Effective from ${fmtD(i.effectiveDate)}`)] }, { type: "break" });
  b.push(...para(sec("wording")));
  if (sec("practice").trim()) b.push(heading("About us"), ...para(sec("practice")));
  const lines = i.agreed.lines;
  b.push(heading("The services"));
  for (const l of lines) {
    const svc = i.catalogue.find((c) => c.key === l.serviceKey);
    b.push(heading(l.name, 3));
    const desc = svc?.clientDescription || svc?.description || "";
    if (desc.trim()) b.push(...para(desc));
    if (svc?.scope.trim()) b.push({ type: "p", runs: [r("What's included", { b: true })] }, ...bullets(svc.scope));
    if (svc?.exclusions.trim()) b.push({ type: "p", runs: [r("Not included", { b: true })] }, ...bullets(svc.exclusions));
  }
  const withClauses = lines.filter((l) => i.catalogue.find((c) => c.key === l.serviceKey)?.clauses.trim());
  const respFor = (k: "clientResp" | "practiceResp") => lines.filter((l) => i.catalogue.find((c) => c.key === l.serviceKey)?.[k].trim());
  if (sec("clientResp").trim() || sec("practiceResp").trim() || respFor("clientResp").length || respFor("practiceResp").length) b.push(heading("Responsibilities"));
  if (sec("clientResp").trim()) b.push({ type: "p", runs: [r("Your responsibilities", { b: true })] }, ...para(sec("clientResp")));
  for (const l of respFor("clientResp")) b.push({ type: "p", runs: [r(`${l.name}: your responsibilities`, { b: true })] }, ...bullets(i.catalogue.find((c) => c.key === l.serviceKey)!.clientResp));
  if (sec("practiceResp").trim()) b.push({ type: "p", runs: [r("Our responsibilities", { b: true })] }, ...para(sec("practiceResp")));
  for (const l of respFor("practiceResp")) b.push({ type: "p", runs: [r(`${l.name}: our responsibilities`, { b: true })] }, ...bullets(i.catalogue.find((c) => c.key === l.serviceKey)!.practiceResp));
  // fees as agreed
  // every line in the agreed record was agreed: optional services the client chose are included, the rest never got here
  const main = lines.map(asLine);
  const head = ["Service", "Charged", "Net fee", "VAT", "Total"].map((h, n) => cell(h, { b: true }, n >= 2 ? "right" : undefined));
  const rows = lines.flatMap((l) => {
    const k = calcLine(asLine(l), i.agreed.vatRate);
    const out = [[cell(l.name), cell(freqLabel(l.frequency)), cell(gbp(k.net), {}, "right"), cell(l.vat === "standard" ? gbp(k.vatEach) : "No VAT", {}, "right"), cell(gbp(k.totalEach), { b: true }, "right")]];
    if (k.setup) out.push([cell(`${l.name}: set-up fee`), cell("One-off"), cell(gbp(k.setup), {}, "right"), cell(""), cell(gbp(k.setup), {}, "right")]);
    return out;
  });
  b.push(heading("Fees"));
  if (rows.length) {
    b.push({ type: "table", header: true, rows: [head, ...rows] });
    const t = totalsFor(main, i.agreed.vatRate);
    b.push({ type: "p", runs: [r(`First year, excluding VAT: ${gbp(t.firstYearNet)}. Including VAT: ${gbp(t.firstYearGross)}.${t.annualRecurringNet ? ` Each year after, excluding VAT: ${gbp(t.ongoingNet)}.` : ""}`, { b: true })] });
  } else b.push(...para("The fees are as set out in the accepted proposal."));
  if (sec("feeTerms").trim()) b.push(...para(sec("feeTerms")));
  if (withClauses.length) { b.push(heading("Service schedules")); for (const l of withClauses) b.push(heading(l.name, 3), ...para(fill(i.catalogue.find((c) => c.key === l.serviceKey)!.clauses, vars))); }
  for (const [k, title] of [["terms", "Terms and conditions"], ["liability", "Limitation of liability"], ["confidentiality", "Confidentiality"], ["dataProtection", "Data protection"], ["termination", "Termination"], ["renewal", "Review and renewal"]] as [SectionKey, string][]) {
    if (sec(k).trim()) b.push(heading(title), ...para(sec(k)));
  }
  b.push(heading("Signature"));
  if (sec("signature").trim()) b.push(...para(sec("signature")));
  const who = i.signatories.length ? i.signatories : [""];
  b.push({ type: "table", header: true, rows: [["Signed", "Name", "Position", "Date"].map((h) => cell(h, { b: true })), ...who.map((n) => [cell(""), cell(n), cell(""), cell("")])] });
  return { blocks: b };
}

// ------------------------------------------------------------------ making one from an accepted proposal

export type Party = { client: Row; type: ClientType };
const partyType = (client: Row): ClientType => clientTypeFor(str(client.Kind));

export type GenerateInput = {
  proposal: Row; version: Row; client: Row; settings: EngagementSettings; catalogue: CatalogueService[]; existing: Row[]; practice: string; signatories?: string[];
  previousKey?: string; effectiveDate?: string; today: string; can: (a: ProposalAction) => boolean;
};
export function generate(i: GenerateInput, o: Ctx): { engagement: Row; log: Row; activity: Row } | { error: string } {
  if (!i.can("edit")) return { error: "You can't create engagement letters." };
  if (str(i.version.Status) !== "accepted" || str(i.proposal.Status) !== "accepted") return { error: "Only an accepted proposal can be turned into an engagement letter." };
  const agreed = readAgreed(i.version.Agreed);
  if (!agreed || !agreed.lines.length) return { error: "This proposal has no record of what was agreed." };
  const type = partyType(i.client);
  const rv = reviewStatus(i.settings, type);
  if (!rv.ok) return { error: rv.reason };
  if (!i.previousKey && i.existing.some((e) => str(e.ProposalKey) === str(i.proposal.Key) && str(e.ProposalVersion) === str(i.version.Version) && isLive(e) && str(e.Source) === "generated")) return { error: "There is already an engagement letter for this proposal. Open it, or supersede it by renewing." };
  const effective = i.effectiveDate || str(i.version.StartDate) || i.today;
  const yrs = reviewYears(i.settings, { clientKey: str(i.client.Key), type });
  const ref = nextRef(i.existing, Number(o.now.slice(0, 4)));
  const doc = engagementDocument({
    sections: templateFor(i.settings, type), client: { name: str(i.client.Title), address: str(i.client.RegisteredOffice || i.client.TradingAddress || i.client.HomeAddress), companyNumber: str(i.client.CompanyNumber), type }, practice: i.practice,
    agreed, catalogue: i.catalogue, ref, date: i.today, effectiveDate: effective, reviewDate: addYears(effective, yrs), years: yrs, proposalRef: str(i.proposal.Ref), signatories: i.signatories || [],
  });
  const body = encodeBody(doc);
  if (body.length > MAX_BODY) return { error: "This letter is too long to save. Shorten the service clauses." };
  const key = o.newKey("EN");
  const keys = [...new Set(agreed.lines.map((l) => l.serviceKey).filter(Boolean))];
  const engagement: Row = {
    Key: key, PracticeId: o.pid, Ref: ref, ClientKey: str(i.client.Key), ProposalKey: str(i.proposal.Key), ProposalVersion: Number(i.version.Version), OppKey: str(i.proposal.OppKey),
    Title: `Engagement letter: ${str(i.client.Title)}${keys.length === 1 ? ` (${agreed.lines[0].name})` : ""}`, Source: "generated", Status: "draft", ClientType: type, ServiceKeys: JSON.stringify(keys),
    ServiceNames: JSON.stringify(agreed.lines.map((l) => l.name)), DocumentDate: i.today, EffectiveDate: effective, ReviewYears: "", ReviewDate: addYears(effective, yrs), Body: body, Hash: "", Signatories: JSON.stringify(i.signatories || []),
    PreviousKey: i.previousKey || "", Decisions: "[]", Notes: "", Created: o.now, CreatedBy: o.actor, Updated: o.now,
  };
  const refs = { clientKey: str(i.client.Key) };
  return { engagement, log: logRow(o, "created", "engagement", key, refs, { ref, proposal: i.proposal.Ref, version: i.version.Version, previous: i.previousKey || "" }), activity: activityRow(o, "engagement-created", `Engagement letter ${ref} drafted for ${i.client.Title}`, undefined, { ...refs, oppKey: str(i.proposal.OppKey) }, `From proposal ${i.proposal.Ref}`) };
}

/** The letter's blocks for an existing engagement, from the proposal it came from and the current wording. */
export function letterFor(e: Row, i: { proposal: Row; version: Row; client: Row; settings: EngagementSettings; catalogue: CatalogueService[]; practice: string; today: string }, effective: string, yrs: number, signatories: string[]): DocContent | undefined {
  const agreed = readAgreed(i.version.Agreed);
  if (!agreed) return undefined;
  const type = partyType(i.client);
  return engagementDocument({ sections: templateFor(i.settings, type), client: { name: str(i.client.Title), address: str(i.client.RegisteredOffice || i.client.TradingAddress || i.client.HomeAddress), companyNumber: str(i.client.CompanyNumber), type }, practice: i.practice, agreed, catalogue: i.catalogue, ref: str(e.Ref), date: str(e.DocumentDate) || i.today, effectiveDate: effective, reviewDate: addYears(effective, yrs), years: yrs, proposalRef: str(i.proposal.Ref), signatories });
}

/** The signing request failed, was declined or ran out, so the letter goes back to approved to be sent again. */
export function recall(e: Row, reason: string, can: (a: ProposalAction) => boolean, o: Ctx): Written | { error: string } {
  if (!can("send")) return { error: "Only a manager or partner can do that." };
  if (asEng(e.Status) !== "out") return { error: "That letter isn't out for signature." };
  return { patches: [{ list: "Engagements", row: e, patch: { Status: "approved", Hash: "", SigningId: "", PortalDocId: "", SentOn: "", Updated: o.now } }], log: [logRow(o, "recalled", "engagement", str(e.Key), refsOf(e), { reason })], activities: [] };
}

/** Rebuild a draft's wording from the current settings (for example after the wording was updated and reviewed). */
export function regenerate(e: Row, i: Omit<GenerateInput, "proposal" | "version" | "existing" | "previousKey" | "effectiveDate"> & { proposal: Row; version: Row }, o: Ctx): Written | { error: string } {
  if (asEng(e.Status) !== "draft") return { error: "Only a draft can be rebuilt. Return it to draft first." };
  if (!i.can("edit")) return { error: "You can't change engagement letters." };
  const agreed = readAgreed(i.version.Agreed);
  if (!agreed) return { error: "This proposal has no record of what was agreed." };
  const type = partyType(i.client);
  const rv = reviewStatus(i.settings, type);
  if (!rv.ok) return { error: rv.reason };
  const yrs = reviewYears(i.settings, { engagementYears: e.ReviewYears, clientKey: str(i.client.Key), type });
  const effective = str(e.EffectiveDate) || i.today;
  const doc = engagementDocument({ sections: templateFor(i.settings, type), client: { name: str(i.client.Title), address: str(i.client.RegisteredOffice || i.client.TradingAddress || i.client.HomeAddress), companyNumber: str(i.client.CompanyNumber), type }, practice: i.practice, agreed, catalogue: i.catalogue, ref: str(e.Ref), date: str(e.DocumentDate) || i.today, effectiveDate: effective, reviewDate: addYears(effective, yrs), years: yrs, proposalRef: str(i.proposal.Ref), signatories: readList(e.Signatories) });
  return { patches: [{ list: "Engagements", row: e, patch: { Body: encodeBody(doc), Updated: o.now } }], log: [logRow(o, "rebuilt", "engagement", str(e.Key), refsOf(e), {})], activities: [] };
}

export type DraftEdit = { effectiveDate?: string; reviewYears?: string; signatories?: string[]; notes?: string; title?: string };
/** Edit a draft's date, signatories and notes. The dates and signatories are also changed in the wording. */
export function editDraft(e: Row, edit: DraftEdit, settings: EngagementSettings, rebuild: (effective: string, years: number, signatories: string[]) => DocContent | undefined, can: (a: ProposalAction) => boolean, o: Ctx): Written | { error: string } {
  if (!can("edit")) return { error: "You can't change engagement letters." };
  if (asEng(e.Status) !== "draft") return { error: "Only a draft can be edited. Return it to draft first." };
  const effective = edit.effectiveDate ?? str(e.EffectiveDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effective) || Number.isNaN(Date.parse(effective))) return { error: "Choose the date the engagement takes effect." };
  const ry = edit.reviewYears ?? str(e.ReviewYears);
  if (ry && !years(ry)) return { error: "Review interval must be a whole number of years from 1 to 10." };
  const type = (str(e.ClientType) as ClientType) || "limited";
  const yrs = reviewYears(settings, { engagementYears: ry, clientKey: str(e.ClientKey), type });
  const sig = (edit.signatories ?? readList(e.Signatories)).map((x) => x.trim()).filter(Boolean);
  const patch: Row = { EffectiveDate: effective, ReviewYears: ry, ReviewDate: addYears(effective, yrs), Signatories: JSON.stringify(sig), Notes: edit.notes ?? str(e.Notes), Title: (edit.title ?? str(e.Title)).trim() || str(e.Title), Updated: o.now };
  const doc = rebuild(effective, yrs, sig);
  if (doc) patch.Body = encodeBody(doc);
  return { patches: [{ list: "Engagements", row: e, patch }], log: [logRow(o, "edited", "engagement", str(e.Key), refsOf(e), { effective, years: yrs })], activities: [] };
}

// ------------------------------------------------------------------ workflow

const EDGES: Partial<Record<EngStatus, { to: EngStatus; action: ProposalAction; log: string }[]>> = {
  draft: [{ to: "review", action: "edit", log: "submitted" }, { to: "approved", action: "approve", log: "approved" }],
  review: [{ to: "approved", action: "approve", log: "approved" }, { to: "draft", action: "approve", log: "returned" }],
  approved: [{ to: "draft", action: "edit", log: "approval-withdrawn" }],
};
export function advanceEng(e: Row, to: EngStatus, note: string, independent: boolean, can: (a: ProposalAction) => boolean, o: Ctx): Written | { error: string } {
  const from = asEng(e.Status);
  const edge = (EDGES[from] || []).find((x) => x.to === to);
  if (!edge) return { error: `A ${ENG_LABEL[from].toLowerCase()} letter can't go to ${ENG_LABEL[to].toLowerCase()}.` };
  if (!can(edge.action)) return { error: edge.action === "approve" ? "You can't approve engagement letters." : "You can't change this letter." };
  if (to === "approved" && independent && str(e.CreatedBy) && str(e.CreatedBy) === o.actor) return { error: "Someone else has to approve a letter you prepared." };
  if (to === "approved" && !readBody(e.Body).blocks.length) return { error: "The letter has no content." };
  const patch: Row = { Status: to, Updated: o.now };
  if (to === "approved") { patch.ApprovedBy = o.actor; patch.ApprovedOn = o.now; }
  if (to === "draft") { patch.ApprovedBy = ""; patch.ApprovedOn = ""; }
  return { patches: [{ list: "Engagements", row: e, patch }], log: [logRow(o, edge.log, "engagement", str(e.Key), refsOf(e), { from, to, note })], activities: [] };
}

export type SendOut = { hash: string; portalDocId?: string; signingId?: string; docKey?: string; signatories: string[]; method: "portal" | "paper" };
/** The approved letter has gone out for signature (through the portal) or been issued on paper. The wording is sealed. */
export function sendOut(e: Row, s: SendOut, client: Row | undefined, can: (a: ProposalAction) => boolean, today: string, o: Ctx): Written | { error: string } {
  if (!can("send")) return { error: "Only a manager or partner can send engagement letters." };
  if (asEng(e.Status) !== "approved") return { error: "Approve the letter before it goes out." };
  if (!s.hash) return { error: "The letter couldn't be sealed. Try again." };
  if (s.method === "portal" && (!s.signingId || !s.signatories.length)) return { error: "Choose who signs." };
  const w: Written = {
    patches: [{ list: "Engagements", row: e, patch: { Status: "out", SignProgress: "", Hash: s.hash, PortalDocId: s.portalDocId || "", SigningId: s.signingId || "", DocKey: s.docKey || str(e.DocKey), Signatories: JSON.stringify(s.signatories), SentOn: o.now, SentBy: o.actor, SignMethod: s.method, Updated: o.now } }],
    log: [logRow(o, "sent-for-signature", "engagement", str(e.Key), refsOf(e), { method: s.method, signatories: s.signatories, signingId: s.signingId || "" })],
    activities: [activityRow(o, "engagement-sent", `Engagement letter ${e.Ref} sent for signature`, undefined, refsOf(e), s.signatories.join(", "))],
  };
  if (client) w.patches.push({ list: "Clients", row: client, patch: { LoEStatus: "Active", LoESent: today } });
  return w;
}

export type Signed = { by: string; at: string; method: "portal" | "paper" | "external"; evidence: string; docKey?: string; sealedDocId?: string };
/** The signed letter is in. It comes into force on its effective date, the review date is set from it, and any letter it replaces is superseded. */
export function markSigned(e: Row, s: Signed, previous: Row | undefined, client: Row | undefined, settings: EngagementSettings, can: (a: ProposalAction) => boolean, today: string, o: Ctx): Written | { error: string } {
  if (!can("record-acceptance")) return { error: "Only a manager or partner can record a signature." };
  const from = asEng(e.Status);
  if (from !== "out" && from !== "approved" && from !== "unsigned") return { error: "Only a letter that has been sent for signature can be marked as signed." };
  if (!s.by.trim()) return { error: "Say who signed it." };
  if (s.method !== "portal" && !s.evidence.trim()) return { error: "Say how you know it was signed (for example, the signed copy filed or an email)." };
  const type = (str(e.ClientType) as ClientType) || "limited";
  const yrs = reviewYears(settings, { engagementYears: e.ReviewYears, clientKey: str(e.ClientKey), type });
  const effective = str(e.EffectiveDate) || s.at.slice(0, 10);
  const w: Written = {
    patches: [{ list: "Engagements", row: e, patch: { Status: "signed", SignProgress: "", SignedAt: s.at, SignedBy: s.by.trim(), SignMethod: s.method, SignEvidence: s.evidence.trim(), SealedDocId: s.sealedDocId || "", DocKey: s.docKey || str(e.DocKey), ReviewDate: addYears(effective, yrs), ReviewRequest: "", Updated: o.now } }],
    log: [logRow(o, "signed", "engagement", str(e.Key), refsOf(e), { by: s.by, at: s.at, method: s.method, evidence: s.evidence })],
    activities: [activityRow(o, "engagement-signed", `Engagement letter ${e.Ref} signed by ${s.by.trim()}`, undefined, refsOf(e), s.method === "portal" ? "Through the client portal" : s.evidence.trim())],
  };
  if (previous && isLive(previous) && asEng(previous.Status) !== "superseded") w.patches.push({ list: "Engagements", row: previous, patch: { Status: "superseded", SupersededBy: str(e.Key), Updated: o.now } });
  if (previous) w.log.push(logRow(o, "superseded", "engagement", str(previous.Key), refsOf(previous), { by: str(e.Key) }));
  if (client) w.patches.push({ list: "Clients", row: client, patch: { LoEStatus: "Finalised", LoEDecided: today } });
  return w;
}

// ------------------------------------------------------------------ letters made elsewhere

export type External = { clientKey: string; title: string; documentDate: string; effectiveDate: string; signatories: string[]; signed: boolean; serviceKeys: string[]; serviceNames: string[]; reviewDate?: string; reviewYears?: string; notes: string; docKey: string; fileUrl: string; fileName: string; replaces?: Row; clientType: ClientType; signedBy?: string };
const ISO = /^\d{4}-\d{2}-\d{2}$/;
export function uploadExternal(x: External, existing: Row[], settings: EngagementSettings, can: (a: ProposalAction) => boolean, today: string, client: Row | undefined, o: Ctx): Written | { error: string } {
  if (!can("edit")) return { error: "You can't file engagement letters." };
  if (!x.clientKey) return { error: "Choose the client." };
  if (!x.docKey) return { error: "Upload the PDF first." };
  if (!ISO.test(x.documentDate)) return { error: "Enter the date on the letter." };
  if (!ISO.test(x.effectiveDate)) return { error: "Enter the date it takes effect." };
  if (x.reviewYears && !years(x.reviewYears)) return { error: "Review interval must be a whole number of years from 1 to 10." };
  if (x.reviewDate && !ISO.test(x.reviewDate)) return { error: "Enter the renewal date as a date." };
  if (x.signed && !x.signatories.filter((s) => s.trim()).length) return { error: "Name who signed it." };
  const yrs = reviewYears(settings, { engagementYears: x.reviewYears, clientKey: x.clientKey, type: x.clientType });
  const reviewDate = x.reviewDate || addYears(x.effectiveDate, yrs);
  const key = o.newKey("EN"); const ref = nextRef(existing, Number(o.now.slice(0, 4)));
  const row: Row = {
    Key: key, PracticeId: o.pid, Ref: ref, ClientKey: x.clientKey, ProposalKey: "", ProposalVersion: 0, OppKey: "", Title: x.title.trim() || `Engagement letter (uploaded): ${x.fileName}`, Source: "uploaded", Status: x.signed ? "signed" : "unsigned",
    ClientType: x.clientType, ServiceKeys: JSON.stringify(x.serviceKeys), ServiceNames: JSON.stringify(x.serviceNames), DocumentDate: x.documentDate, EffectiveDate: x.effectiveDate, ReviewYears: x.reviewYears || "", ReviewDate: reviewDate,
    Body: "", Hash: "", DocKey: x.docKey, FileUrl: x.fileUrl, Signatories: JSON.stringify(x.signatories.map((s) => s.trim()).filter(Boolean)), SignedAt: x.signed ? x.documentDate : "", SignedBy: x.signed ? (x.signedBy || x.signatories.join(", ")) : "", SignMethod: x.signed ? "external" : "",
    PreviousKey: x.replaces ? str(x.replaces.Key) : "", Decisions: "[]", Notes: x.notes, Created: o.now, CreatedBy: o.actor, Updated: o.now,
  };
  const refs = { clientKey: x.clientKey };
  const w: Written = { patches: [], creates: [{ list: "Engagements", row }], log: [logRow(o, "uploaded", "engagement", key, refs, { ref, file: x.fileName, signed: x.signed, replaces: x.replaces ? x.replaces.Key : "" })], activities: [activityRow(o, "engagement-uploaded", `Engagement letter ${ref} filed (made outside the planner)`, undefined, refs, x.signed ? "Signed" : "Not signed")] };
  if (x.replaces && x.signed && isLive(x.replaces)) { w.patches.push({ list: "Engagements", row: x.replaces, patch: { Status: "superseded", SupersededBy: key, Updated: o.now } }); w.log.push(logRow(o, "superseded", "engagement", str(x.replaces.Key), refs, { by: key })); }
  if (client && x.signed) w.patches.push({ list: "Clients", row: client, patch: { LoEStatus: "Finalised", LoEDecided: today } });
  return w;
}

/** An unsigned letter on file turns out to have been signed. */
export function markFiledSigned(e: Row, by: string, at: string, evidence: string, previous: Row | undefined, client: Row | undefined, settings: EngagementSettings, can: (a: ProposalAction) => boolean, today: string, o: Ctx) {
  return markSigned(e, { by, at, method: "external", evidence }, previous, client, settings, can, today, o);
}

// ------------------------------------------------------------------ renewal and review

export type RenewalDecision = "extend" | "no-new-letter" | "revise" | "replace" | "end";
export const DECISION_LABEL: Record<string, string> = { extend: "Review date extended", "no-new-letter": "No new letter needed for now", revise: "Revised letter started", replace: "Replacement letter filed", end: "Engagement ended", "review-requested": "Early review requested" };

const withDecision = (e: Row, d: Decision) => JSON.stringify([...readDecisions(e.Decisions), d]);

/** An authorised decision to move the review date on, or to record that no new letter is needed yet. The note is required and kept. */
export function decide(e: Row, kind: "extend" | "no-new-letter" | "end", p: { note: string; newDate?: string }, settings: EngagementSettings, can: (a: EngagementAction) => boolean, today: string, o: Ctx): Written | { error: string } {
  if (!can("renewal-decision")) return { error: "Only a manager or partner can make a renewal decision." };
  if (!isInForce(e)) return { error: "Only an engagement that is in force can be reviewed." };
  if (!p.note.trim()) return { error: "Say why. The reason is kept with the engagement." };
  const type = (str(e.ClientType) as ClientType) || "limited";
  const yrs = reviewYears(settings, { engagementYears: e.ReviewYears, clientKey: str(e.ClientKey), type });
  const from = str(e.ReviewDate);
  let to = from; let patch: Row;
  if (kind === "end") patch = { Status: "ended", EndedOn: today };
  else {
    if (kind === "extend") {
      if (!p.newDate || !ISO.test(p.newDate)) return { error: "Choose the new review date." };
      if (p.newDate <= from) return { error: "The new review date has to be later than the current one." };
      if (p.newDate > addYears(today, 10)) return { error: "That review date is too far away. Ten years is the most." };
      to = p.newDate;
    } else to = addYears(today, yrs);
    patch = { ReviewDate: to, ReviewRequest: "" };
  }
  const d: Decision = { at: o.now, by: o.actor, decision: kind, note: p.note.trim(), from, to };
  return { patches: [{ list: "Engagements", row: e, patch: { ...patch, Decisions: withDecision(e, d), Updated: o.now } }], log: [logRow(o, kind === "end" ? "ended" : kind, "engagement", str(e.Key), refsOf(e), d)], activities: [activityRow(o, "engagement-decision", `${DECISION_LABEL[kind]}: ${e.Ref}`, undefined, refsOf(e), `${p.note.trim()}${kind === "end" ? "" : ` (review now ${to})`}`)] };
}

/** Flag an engagement for an earlier review: the scope, the law or the client's circumstances changed. */
export function requestReview(e: Row, reason: string, can: (a: ProposalAction) => boolean, o: Ctx): Written | { error: string } {
  if (!can("edit")) return { error: "You can't change engagement letters." };
  if (!isInForce(e)) return { error: "Only an engagement that is in force can be flagged." };
  if (!reason.trim()) return { error: "Say what has changed." };
  const d: Decision = { at: o.now, by: o.actor, decision: "review-requested", note: reason.trim() };
  return { patches: [{ list: "Engagements", row: e, patch: { ReviewRequest: reason.trim(), Decisions: withDecision(e, d), Updated: o.now } }], log: [logRow(o, "review-requested", "engagement", str(e.Key), refsOf(e), d)], activities: [activityRow(o, "engagement-decision", `Early review requested: ${e.Ref}`, undefined, refsOf(e), reason.trim())] };
}

/** Services someone agreed to (in an accepted proposal) that no live engagement covers yet. A reason to review early. */
export function coverageGaps(clientKey: string, proposals: Row[], versions: Row[], engagements: Row[], catalogue: CatalogueService[]): { serviceKey: string; name: string; proposalRef: string }[] {
  const covered = new Set(engagements.filter((e) => str(e.ClientKey) === clientKey && isLive(e)).flatMap((e) => readList(e.ServiceKeys)));
  const out: { serviceKey: string; name: string; proposalRef: string }[] = [];
  for (const p of proposals.filter((x) => str(x.ClientKey) === clientKey && str(x.Status) === "accepted")) {
    const v = versions.find((x) => str(x.ProposalKey) === str(p.Key) && Number(x.Version) === Number(p.AcceptedVersion));
    const a = v && readAgreed(v.Agreed);
    for (const l of a?.lines || []) if (l.serviceKey && !covered.has(l.serviceKey) && !out.some((g) => g.serviceKey === l.serviceKey)) out.push({ serviceKey: l.serviceKey, name: catalogue.find((c) => c.key === l.serviceKey)?.name || l.name, proposalRef: str(p.Ref) });
  }
  return out;
}

export type EngAlert = { key: string; level: "red" | "amber"; title: string; detail: string; href: string };
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
export function engagementAlerts(engs: Row[], proposals: Row[], versions: Row[], clients: Row[], settings: EngagementSettings, today: string, catalogue: CatalogueService[] = []): EngAlert[] {
  const out: EngAlert[] = [];
  const name = (k: string) => str(clients.find((c) => c.Key === k)?.Title) || "client";
  const window = Math.max(...settings.remindDays);
  for (const e of engs) {
    const s = asEng(e.Status); const link = `#/sales/engagement/${e.Key}`;
    if (s === "out" && e.SentOn && daysBetween(str(e.SentOn).slice(0, 10), today) >= 7) out.push({ key: `eo:${e.Key}`, level: "amber", title: `Engagement letter awaiting signature: ${name(str(e.ClientKey))}`, detail: `Sent ${str(e.SentOn).slice(0, 10)}`, href: link });
    if (isInForce(e) && e.ReviewDate) {
      const d = daysBetween(today, str(e.ReviewDate));
      if (d < 0) out.push({ key: `er:${e.Key}`, level: "red", title: `Engagement review overdue: ${name(str(e.ClientKey))}`, detail: `${e.Ref} was due ${e.ReviewDate}`, href: link });
      else if (d <= window) { const step = settings.remindDays.filter((x) => d <= x).pop() || window; out.push({ key: `er:${e.Key}:${step}`, level: d <= Math.min(...settings.remindDays) ? "red" : "amber", title: `Engagement review due in ${d} day${d === 1 ? "" : "s"}: ${name(str(e.ClientKey))}`, detail: `${e.Ref}, review date ${e.ReviewDate}`, href: link }); }
    }
    if (isInForce(e) && str(e.ReviewRequest)) out.push({ key: `eq:${e.Key}`, level: "amber", title: `Early engagement review requested: ${name(str(e.ClientKey))}`, detail: str(e.ReviewRequest), href: link });
  }
  const seen = new Set<string>();
  for (const p of proposals.filter((x) => str(x.Status) === "accepted" && str(x.ClientKey))) {
    const ck = str(p.ClientKey); if (seen.has(ck)) continue; seen.add(ck);
    const gaps = coverageGaps(ck, proposals, versions, engs, catalogue);
    if (gaps.length) out.push({ key: `eg:${ck}`, level: "amber", title: `No engagement letter yet for ${gaps.map((g) => g.name).join(", ")}: ${name(ck)}`, detail: `Agreed in proposal ${gaps[0].proposalRef}`, href: `#/sales/proposal/${p.Key}` });
  }
  return out;
}
