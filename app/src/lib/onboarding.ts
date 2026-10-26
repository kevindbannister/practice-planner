// Client onboarding (Phase 4 of the lead-to-client lifecycle): the move from accepted prospect to active client.
// Pure logic, like sales.ts, proposals.ts and engagements.ts. Onboarding is its own workflow with its own record and
// stages, not a recurring job. Collecting identity documents is kept apart from verifying and approving the AML work,
// and a client can only be activated once the mandatory controls are met.
import { Config, Role, staffRole } from "./checklist";
import { Agreed, readAgreed, isInForce, coverageGaps, asEng } from "./engagements";
import { CatalogueService, ClientType, ProposalAction, clientTypeFor, freqLabel, proposalCan, typeLabel } from "./proposals";
import { Ctx, Written, activityRow, linkToClient, logRow, Lead, Opp } from "./sales";
import { Row } from "./schema";
import { addDays, addMonths, deadlineByRule, ruleFor } from "./planning";

const str = (v: unknown): string => (v === undefined || v === null ? "" : String(v));
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// ------------------------------------------------------------------ the stages

export type StageKind = "proposal" | "details" | "aml" | "engagement" | "manual" | "portal" | "approval" | "activation";
export type StageDef = { key: string; label: string; kind: StageKind; help: string; mandatory: boolean; enabled: boolean; types?: ClientType[]; takeoverOnly?: boolean };
export const DEFAULT_STAGES: StageDef[] = [
  { key: "proposal", label: "Proposal accepted", kind: "proposal", help: "The services and fees were agreed. This is not AML clearance or a signed engagement letter.", mandatory: true, enabled: true },
  { key: "details", label: "Client details confirmed", kind: "details", help: "Name, address, contact and (for companies) company number checked against the record.", mandatory: true, enabled: true },
  { key: "aml", label: "AML and KYC requirements", kind: "aml", help: "Identity documents, beneficial ownership, risk assessment and checks, then review and approval. Collecting documents is not the same as verifying.", mandatory: true, enabled: true },
  { key: "engagement", label: "Engagement documentation", kind: "engagement", help: "The engagement letter for the agreed services, signed or filed.", mandatory: true, enabled: true },
  { key: "agent", label: "Agent authorisations", kind: "manual", help: "Authority to act for the client with HMRC, Companies House and other bodies, where the services need it.", mandatory: false, enabled: true },
  { key: "clearance", label: "Previous accountant clearance", kind: "manual", help: "Professional clearance from the previous accountant. Only for clients we are taking over.", mandatory: false, enabled: true, takeoverOnly: true },
  { key: "portal", label: "Client portal invitation", kind: "portal", help: "Invite the people who should have access, and check that they have accepted.", mandatory: false, enabled: true },
  { key: "info", label: "Initial information and records", kind: "manual", help: "Opening records, prior-year accounts and anything else needed to start.", mandatory: false, enabled: true },
  { key: "approval", label: "Internal onboarding approval", kind: "approval", help: "A second person confirms the controls are met.", mandatory: true, enabled: true },
  { key: "activation", label: "Client activation", kind: "activation", help: "Makes the client active, sets up the services and fees, and creates the first jobs.", mandatory: true, enabled: true },
];
/** Stages that are always required: the practice can add requirements but cannot remove these. */
export const FIXED_MANDATORY = ["proposal", "approval", "activation"];

export type AmlMonths = { low: number; medium: number; high: number };
export type OnboardingSettings = { stages: StageDef[]; amlMonths: AmlMonths };
export const DEFAULT_AML_MONTHS: AmlMonths = { low: 36, medium: 24, high: 12 };
export const DEFAULT_ONBOARDING_SETTINGS: OnboardingSettings = { stages: DEFAULT_STAGES, amlMonths: DEFAULT_AML_MONTHS };

export function readOnboardingSettings(settings: Row[]): OnboardingSettings {
  const row = settings.find((r) => r.Key === "onboarding.settings");
  if (!row?.Value) return DEFAULT_ONBOARDING_SETTINGS;
  let o: any;
  try { o = JSON.parse(String(row.Value)); } catch { return DEFAULT_ONBOARDING_SETTINGS; }
  const over: Record<string, any> = {};
  for (const s of Array.isArray(o?.stages) ? o.stages : []) if (s && typeof s.key === "string") over[s.key] = s;
  const stages = DEFAULT_STAGES.map((d) => {
    const x = over[d.key] || {};
    const fixed = FIXED_MANDATORY.includes(d.key);
    return { ...d, enabled: fixed ? true : x.enabled !== false, mandatory: fixed ? true : x.mandatory === undefined ? d.mandatory : x.mandatory === true };
  });
  const m = (v: unknown, d: number) => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 120 ? n : d; };
  return { stages, amlMonths: { low: m(o?.amlMonths?.low, 36), medium: m(o?.amlMonths?.medium, 24), high: m(o?.amlMonths?.high, 12) } };
}

// ------------------------------------------------------------------ records

export type OnboardingStatus = "active" | "activated" | "cancelled";
export type StageState = { status: "todo" | "doing" | "done" | "na"; by?: string; at?: string; note?: string };
export type States = Record<string, StageState>;
export const readStates = (v: unknown): States => { try { const o = JSON.parse(str(v) || "{}"); return o && typeof o === "object" ? o : {}; } catch { return {}; } };

export type Risk = "" | "low" | "medium" | "high";
export type Check = { id: string; kind: string; result: "pass" | "fail" | "pending"; by: string; at: string; note: string };
export type Owner = { name: string; percent: number | null; note: string };
export type Aml = { status: "notstarted" | "inprogress" | "approved" | "declined"; risk: Risk; riskBasis: string; owners: Owner[]; noOwnerNote: string; checks: Check[]; preparedBy: string; approvedBy: string; approvedAt: string; reviewDate: string; declinedReason: string };
export const EMPTY_AML: Aml = { status: "notstarted", risk: "", riskBasis: "", owners: [], noOwnerNote: "", checks: [], preparedBy: "", approvedBy: "", approvedAt: "", reviewDate: "", declinedReason: "" };
export const CHECK_KINDS = ["Identity verified", "Address verified", "Sanctions and PEP screening", "Companies House / registry check", "Source of funds or wealth", "Specialist AML provider", "Other"];
export function readAml(v: unknown): Aml {
  try {
    const o = JSON.parse(str(v) || "{}");
    if (!o || typeof o !== "object") return EMPTY_AML;
    const st = ["notstarted", "inprogress", "approved", "declined"].includes(o.status) ? o.status : "notstarted";
    return {
      status: st, risk: ["low", "medium", "high"].includes(o.risk) ? o.risk : "", riskBasis: str(o.riskBasis), noOwnerNote: str(o.noOwnerNote),
      owners: (Array.isArray(o.owners) ? o.owners : []).map((x: any) => ({ name: str(x.name), percent: x.percent === null || x.percent === "" || x.percent === undefined ? null : num(x.percent), note: str(x.note) })).filter((x: Owner) => x.name.trim()),
      checks: (Array.isArray(o.checks) ? o.checks : []).map((c: any) => ({ id: str(c.id), kind: str(c.kind), result: ["pass", "fail", "pending"].includes(c.result) ? c.result : "pending", by: str(c.by), at: str(c.at), note: str(c.note) })),
      preparedBy: str(o.preparedBy), approvedBy: str(o.approvedBy), approvedAt: str(o.approvedAt), reviewDate: str(o.reviewDate), declinedReason: str(o.declinedReason),
    };
  } catch { return EMPTY_AML; }
}

export type OnboardingAction = ProposalAction;
export function onboardingCan(cfg: Config, user: string, action: "view" | "edit" | "approve" | "activate" | "configure"): boolean {
  return proposalCan(cfg, user, action === "activate" ? "send" : action);
}
export const roleName = (cfg: Config, user: string): Role | undefined => staffRole(cfg, user);

export function nextRef(rows: Row[], year: number): string {
  const prefix = `O-${year}-`;
  const used = rows.map((p) => (str(p.Ref).startsWith(prefix) ? Number(str(p.Ref).slice(prefix.length)) || 0 : 0));
  return `${prefix}${String(Math.max(0, ...used) + 1).padStart(4, "0")}`;
}
const refsOf = (o: Row) => ({ clientKey: str(o.ClientKey), leadKey: str(o.LeadKey), oppKey: str(o.OppKey) });
export const isLiveOnboarding = (o: Row) => str(o.Status) !== "cancelled" && str(o.Status) !== "activated";

/** Anything wrong with the client record that has to be put right before the details can be confirmed. */
export function detailsProblems(client: Row): string[] {
  const out: string[] = [];
  if (!str(client.Title).trim()) out.push("The client has no name.");
  if (!str(client.Email).trim() && !str(client.Mobile).trim() && !str(client.Phone).trim()) out.push("Add an email address or phone number.");
  if (!str(client.RegisteredOffice || client.TradingAddress || client.HomeAddress).trim()) out.push("Add an address.");
  const type = clientTypeFor(str(client.Kind));
  if ((type === "limited" || type === "llp") && !str(client.CompanyNumber).trim()) out.push("Add the company number.");
  if (!str(client.ContactFirst || client.ContactLast || client.ContactPreferred).trim() && type !== "individual") out.push("Add the main contact's name.");
  return out;
}

// ------------------------------------------------------------------ starting

export function startOnboarding(i: { proposal: Row; version: Row; client: Row; existing: Row[]; takeover: boolean; startDate?: string; today: string; can: (a: ProposalAction) => boolean }, o: Ctx): { onboarding: Row; log: Row; activity: Row } | { error: string } {
  if (!i.can("edit")) return { error: "You can't start onboarding." };
  if (str(i.proposal.Status) !== "accepted" || str(i.version.Status) !== "accepted") return { error: "Only an accepted proposal can start onboarding." };
  if (!readAgreed(i.version.Agreed)?.lines.length) return { error: "This proposal has no record of what was agreed." };
  if (i.existing.some((x) => str(x.ProposalKey) === str(i.proposal.Key) && str(x.Status) !== "cancelled")) return { error: "Onboarding has already been started for this proposal." };
  const key = o.newKey("OB");
  const ref = nextRef(i.existing, Number(o.now.slice(0, 4)));
  const onboarding: Row = {
    Key: key, PracticeId: o.pid, Ref: ref, ClientKey: str(i.client.Key), LeadKey: str(i.proposal.LeadKey), OppKey: str(i.proposal.OppKey), ProposalKey: str(i.proposal.Key), ProposalVersion: Number(i.version.Version),
    Status: "active", Takeover: i.takeover ? "yes" : "", Stages: "{}", Aml: JSON.stringify(EMPTY_AML), StartDate: i.startDate || str(i.version.StartDate) || i.today, Owner: o.actor, Notes: "", Created: o.now, CreatedBy: o.actor, Updated: o.now,
  };
  return { onboarding, log: logRow(o, "started", "onboarding", key, refsOf(onboarding), { ref, proposal: i.proposal.Ref, takeover: i.takeover }), activity: activityRow(o, "onboarding-started", `Onboarding ${ref} started for ${i.client.Title}`, undefined, refsOf(onboarding), `From proposal ${i.proposal.Ref}`) };
}

// ------------------------------------------------------------------ a client record for a lead

export const CLIENT_KINDS = ["Individual", "Ltd", "LLP", "Partnership"] as const;
/** Make the client record for an accepted lead, and move the lead, its opportunities, proposals and history across to it.
 *  The caller checks for duplicates first. The client starts as "onboarding" and only becomes active when activated. */
export function clientFromLead(i: { lead: Lead; kind: string; opps: Opp[]; activities: Row[]; proposals: Row[]; can: (a: ProposalAction) => boolean }, o: Ctx): { client: Row; written: Written } | { error: string } {
  if (!i.can("edit")) return { error: "You can't create clients." };
  if (str(i.lead.ClientKey)) return { error: "This lead is already linked to a client." };
  if (!(CLIENT_KINDS as readonly string[]).includes(i.kind)) return { error: "Choose the type of client." };
  const name = str(i.lead.ContactName).trim();
  const [first, ...rest] = name.split(/\s+/).filter(Boolean);
  const key = o.newKey("C");
  const client: Row = { Key: key, Title: str(i.lead.Title).trim(), Kind: i.kind, Status: "onboarding", Email: str(i.lead.Email), Mobile: str(i.lead.Phone), Website: str(i.lead.Website), ContactFirst: first || "", ContactLast: rest.join(" "), ContactPreferred: first || "", Notes: `Created from lead on ${o.now.slice(0, 10)}. It has no Engager record.` };
  const link = linkToClient(i.lead, key, i.opps, i.activities, o);
  for (const p of i.proposals.filter((x) => str(x.LeadKey) === str(i.lead.Key) && !str(x.ClientKey))) link.patches.push({ list: "Proposals", row: p, patch: { ClientKey: key } });
  link.creates = [{ list: "Clients", row: client }];
  link.log.push(logRow(o, "client-created", "lead", str(i.lead.Key), { leadKey: str(i.lead.Key), clientKey: key }, { title: client.Title, kind: i.kind }));
  return { client, written: link };
}

// ------------------------------------------------------------------ what each stage looks like now

export type PortalPerson = { id: string; name: string; status: string };
export type View = {
  onb: Row; defs: StageDef[]; client: Row; engagements: Row[]; proposals: Row[]; versions: Row[]; catalogue: CatalogueService[]; people: PortalPerson[]; today: string;
};
export type StageStatus = "done" | "doing" | "todo" | "na" | "blocked";
export type StageLine = { def: StageDef; status: StageStatus; detail: string; by?: string; at?: string; note?: string; applies: boolean };
export type EngagementState = "not-prepared" | "draft" | "awaiting-approval" | "approved" | "sent" | "partial" | "signed" | "uploaded-signed" | "uploaded-unsigned";
export const ENGAGEMENT_STATE_LABEL: Record<EngagementState, string> = {
  "not-prepared": "Not prepared", draft: "Draft", "awaiting-approval": "Awaiting internal approval", approved: "Approved, not yet sent", sent: "Sent for signature", partial: "Partially signed", signed: "Fully signed", "uploaded-signed": "Uploaded externally, signed", "uploaded-unsigned": "Uploaded externally, not signed",
};
/** Where the engagement letters for this client's agreed services stand. */
export function engagementState(clientKey: string, proposalKey: string, engagements: Row[]): { state: EngagementState; ref: string } {
  const mine = engagements.filter((e) => str(e.ClientKey) === clientKey && (str(e.ProposalKey) === proposalKey || str(e.Source) === "uploaded") && !["superseded", "ended"].includes(asEng(e.Status)));
  if (!mine.length) return { state: "not-prepared", ref: "" };
  const rank = (e: Row): [EngagementState, number] => {
    const s = asEng(e.Status);
    if (s === "signed") return [str(e.Source) === "uploaded" ? "uploaded-signed" : "signed", 9];
    if (s === "out") return [str(e.SignProgress) ? "partial" : "sent", 6];
    if (s === "unsigned") return ["uploaded-unsigned", 4];
    if (s === "approved") return ["approved", 5];
    if (s === "review") return ["awaiting-approval", 3];
    return ["draft", 2];
  };
  const best = mine.map((e) => ({ e, r: rank(e) })).sort((a, b) => b.r[1] - a.r[1])[0];
  return { state: best.r[0], ref: str(best.e.Ref) };
}

export function stageLines(v: View): StageLine[] {
  const states = readStates(v.onb.Stages);
  const aml = readAml(v.onb.Aml);
  const type = clientTypeFor(str(v.client.Kind));
  const takeover = str(v.onb.Takeover) === "yes";
  const agreed = (() => { const p = v.proposals.find((x) => str(x.Key) === str(v.onb.ProposalKey)); const ver = v.versions.find((x) => str(x.ProposalKey) === str(v.onb.ProposalKey) && Number(x.Version) === Number(v.onb.ProposalVersion)); return { p, ver }; })();
  return v.defs.filter((d) => d.enabled).map((def): StageLine => {
    const applies = (!def.types || def.types.includes(type)) && (!def.takeoverOnly || takeover);
    const st = states[def.key];
    const base = { def, applies, by: st?.by, at: st?.at, note: st?.note };
    if (!applies) return { ...base, status: "na", detail: def.takeoverOnly && !takeover ? "Not applicable: not a takeover." : `Not applicable to ${typeLabel(type).toLowerCase()} clients.` };
    switch (def.kind) {
      case "proposal": return { ...base, status: "done", detail: agreed.p ? `Proposal ${agreed.p.Ref} accepted${agreed.ver?.AcceptedBy ? ` by ${agreed.ver.AcceptedBy}` : ""}.` : "Accepted." };
      case "aml": {
        const text = aml.status === "approved" ? `Approved by ${aml.approvedBy}${aml.reviewDate ? `; review ${aml.reviewDate}` : ""}.` : aml.status === "declined" ? `Not approved: ${aml.declinedReason}` : aml.status === "inprogress" ? "In progress: not yet approved." : "Not started.";
        return { ...base, status: aml.status === "approved" ? "done" : aml.status === "declined" ? "blocked" : aml.status === "inprogress" ? "doing" : "todo", detail: text };
      }
      case "engagement": {
        const e = engagementState(str(v.onb.ClientKey), str(v.onb.ProposalKey), v.engagements);
        const gaps = coverageGaps(str(v.onb.ClientKey), v.proposals, v.versions, v.engagements, v.catalogue);
        const signed = e.state === "signed" || e.state === "uploaded-signed";
        const done = signed && !gaps.length;
        return { ...base, status: done ? "done" : e.state === "not-prepared" ? "todo" : "doing", detail: `${ENGAGEMENT_STATE_LABEL[e.state]}${e.ref ? ` (${e.ref})` : ""}${signed && gaps.length ? `. Not yet covered: ${gaps.map((g) => g.name).join(", ")}.` : "."}` };
      }
      case "portal": {
        const active = v.people.filter((p) => p.status === "active"), invited = v.people.filter((p) => p.status === "invited");
        return { ...base, status: active.length ? "done" : invited.length ? "doing" : "todo", detail: active.length ? `${active.map((p) => p.name).join(", ")} can sign in.` : invited.length ? `Invited, not yet accepted: ${invited.map((p) => p.name).join(", ")}.` : "Nobody invited yet." };
      }
      case "approval": return { ...base, status: str(v.onb.ApprovedBy) ? "done" : "todo", detail: str(v.onb.ApprovedBy) ? `Approved by ${v.onb.ApprovedBy} on ${str(v.onb.ApprovedOn).slice(0, 10)}.` : "Waiting for someone to approve." };
      case "activation": return { ...base, status: str(v.onb.Status) === "activated" ? "done" : "todo", detail: str(v.onb.Status) === "activated" ? `Activated by ${v.onb.ActivatedBy} on ${str(v.onb.ActivatedOn).slice(0, 10)}.` : "Not yet activated." };
      case "details": return { ...base, status: st?.status === "done" ? "done" : st?.status === "na" ? "na" : "todo", detail: st?.status === "done" ? `Confirmed by ${st.by}.` : detailsProblems(v.client).join(" ") || "Ready to confirm." };
      default: return { ...base, status: st?.status === "na" ? "na" : st?.status || "todo", detail: st?.status === "done" ? `Done by ${st.by}${st.note ? `: ${st.note}` : ""}.` : st?.status === "na" ? `Not needed: ${st.note || ""}` : st?.status === "doing" ? "In progress." : "To do." };
    }
  });
}

/** Mandatory, applicable stages (other than approval and activation themselves) that are not finished. */
export function blockers(lines: StageLine[], opts: { includeApproval?: boolean } = {}): string[] {
  return lines.filter((l) => l.applies && l.def.mandatory && l.status !== "done" && l.status !== "na" && l.def.kind !== "activation" && (opts.includeApproval || l.def.kind !== "approval")).map((l) => `${l.def.label}: ${l.detail}`);
}

// ------------------------------------------------------------------ doing things

const saveOnb = (onb: Row, patch: Row, o: Ctx, log: ReturnType<typeof logRow>[], activities: Row[] = []): Written => ({ patches: [{ list: "Onboardings", row: onb, patch: { ...patch, Updated: o.now } }], log, activities });
const live = (onb: Row) => (isLiveOnboarding(onb) ? undefined : "This onboarding is closed.");

/** Mark a manual stage, or confirm the details. Marking a mandatory stage "not applicable" needs authority and a reason. */
export function setStage(onb: Row, def: StageDef, status: StageState["status"], note: string, client: Row, can: (a: ProposalAction) => boolean, o: Ctx): Written | { error: string } {
  // after activation the agent authorisation can still be recorded, so held services can be started
  const closed = str(onb.Status) === "activated" && def.key === "agent" ? undefined : live(onb); if (closed) return { error: closed };
  if (!can("edit")) return { error: "You can't change onboarding." };
  if (def.kind !== "manual" && def.kind !== "details") return { error: "That stage is worked out automatically." };
  if (status === "done" && def.kind === "details") { const bad = detailsProblems(client); if (bad.length) return { error: bad[0] }; }
  if (status === "na") {
    if (!note.trim()) return { error: "Say why it isn't needed." };
    if (def.mandatory && !can("configure")) return { error: "Only a manager or partner can mark a required stage as not needed." };
  }
  const states = readStates(onb.Stages);
  states[def.key] = { status, by: o.actor, at: o.now, note: note.trim() };
  return saveOnb(onb, { Stages: JSON.stringify(states) }, o, [logRow(o, "stage", "onboarding", str(onb.Key), refsOf(onb), { stage: def.key, status, note: note.trim() })]);
}

export type AmlEdit = { risk?: Risk; riskBasis?: string; owners?: Owner[]; noOwnerNote?: string; checks?: Check[] };
/** Record the risk assessment, beneficial owners and checks. Saving never approves anything. */
export function saveAml(onb: Row, edit: AmlEdit, can: (a: ProposalAction) => boolean, o: Ctx): Written | { error: string } {
  const closed = live(onb); if (closed) return { error: closed };
  if (!can("edit")) return { error: "You can't change the AML record." };
  const cur = readAml(onb.Aml);
  if (cur.status === "approved") return { error: "This AML record has been approved. Withdraw the approval to change it." };
  const next: Aml = { ...cur, ...edit, owners: edit.owners ?? cur.owners, checks: (edit.checks ?? cur.checks).map((c) => ({ ...c, id: c.id || o.newKey("CK"), by: c.by || o.actor, at: c.at || o.now })), status: "inprogress", preparedBy: o.actor, declinedReason: "" };
  return saveOnb(onb, { Aml: JSON.stringify(next) }, o, [logRow(o, "aml-saved", "onboarding", str(onb.Key), refsOf(onb), { risk: next.risk, checks: next.checks.length, owners: next.owners.length })]);
}

export function amlProblems(a: Aml, type: ClientType): string[] {
  const out: string[] = [];
  if (!a.risk) out.push("Record the risk assessment.");
  if (!a.riskBasis.trim()) out.push("Say what the risk rating is based on.");
  if (!a.checks.some((c) => c.result === "pass" && /identity/i.test(c.kind))) out.push("Record a passed identity check. An uploaded document is not a check until a person has verified it.");
  if (a.checks.some((c) => c.result === "fail")) out.push("A check has failed. Resolve it before approval.");
  if (a.checks.some((c) => c.result === "pending")) out.push("A check is still pending.");
  if ((type === "limited" || type === "llp") && !a.owners.length && !a.noOwnerNote.trim()) out.push("Record the beneficial owners, or say why there are none to record.");
  if (a.risk === "high" && a.checks.filter((c) => c.result === "pass").length < 2) out.push("High risk needs more than one passed check (enhanced due diligence).");
  return out;
}

/** Approve the AML work: a different person from whoever prepared it when independent review is on. Sets the client's AML review date. */
export function approveAml(onb: Row, client: Row, settings: OnboardingSettings, independent: boolean, can: (a: ProposalAction) => boolean, today: string, o: Ctx): Written | { error: string } {
  const closed = live(onb); if (closed) return { error: closed };
  if (!can("approve")) return { error: "You can't approve AML work." };
  const a = readAml(onb.Aml);
  if (a.status !== "inprogress") return { error: a.status === "approved" ? "Already approved." : "Record the AML work first." };
  if (independent && a.preparedBy && a.preparedBy === o.actor) return { error: "Someone else has to approve AML work you prepared." };
  const bad = amlProblems(a, clientTypeFor(str(client.Kind)));
  if (bad.length) return { error: bad[0] };
  const reviewDate = addMonths(today, settings.amlMonths[a.risk as "low"], false);
  const next: Aml = { ...a, status: "approved", approvedBy: o.actor, approvedAt: o.now, reviewDate };
  return { patches: [{ list: "Onboardings", row: onb, patch: { Aml: JSON.stringify(next), Updated: o.now } }, { list: "Clients", row: client, patch: { AMLReview: reviewDate } }], log: [logRow(o, "aml-approved", "onboarding", str(onb.Key), refsOf(onb), { risk: a.risk, review: reviewDate })], activities: [activityRow(o, "onboarding-aml", `AML approved (${a.risk} risk): ${client.Title}`, undefined, refsOf(onb), `Review ${reviewDate}`)] };
}
export function declineAml(onb: Row, reason: string, can: (a: ProposalAction) => boolean, o: Ctx): Written | { error: string } {
  const closed = live(onb); if (closed) return { error: closed };
  if (!can("approve")) return { error: "You can't decide AML work." };
  if (!reason.trim()) return { error: "Say why." };
  const a = readAml(onb.Aml);
  if (a.status === "approved") return { error: "Already approved." };
  return saveOnb(onb, { Aml: JSON.stringify({ ...a, status: "declined", declinedReason: reason.trim() }) }, o, [logRow(o, "aml-declined", "onboarding", str(onb.Key), refsOf(onb), { reason: reason.trim() })]);
}
export function withdrawAml(onb: Row, reason: string, can: (a: ProposalAction) => boolean, o: Ctx): Written | { error: string } {
  if (!can("approve")) return { error: "You can't change AML approvals." };
  if (!reason.trim()) return { error: "Say why." };
  const a = readAml(onb.Aml);
  if (a.status !== "approved" && a.status !== "declined") return { error: "Nothing to withdraw." };
  return saveOnb(onb, { Aml: JSON.stringify({ ...a, status: "inprogress", approvedBy: "", approvedAt: "", reviewDate: "", declinedReason: "" }), ApprovedBy: "", ApprovedOn: "" }, o, [logRow(o, "aml-withdrawn", "onboarding", str(onb.Key), refsOf(onb), { reason: reason.trim() })]);
}

/** Internal approval: every mandatory control is met, and (when independent review is on) it is not the person who started it. */
export function approveOnboarding(onb: Row, lines: StageLine[], independent: boolean, can: (a: ProposalAction) => boolean, o: Ctx): Written | { error: string } {
  const closed = live(onb); if (closed) return { error: closed };
  if (!can("approve")) return { error: "You can't approve onboarding." };
  if (str(onb.ApprovedBy)) return { error: "Already approved." };
  if (independent && str(onb.CreatedBy) === o.actor) return { error: "Someone else has to approve an onboarding you started." };
  const b = blockers(lines);
  if (b.length) return { error: `Not ready: ${b[0]}` };
  return saveOnb(onb, { ApprovedBy: o.actor, ApprovedOn: o.now }, o, [logRow(o, "approved", "onboarding", str(onb.Key), refsOf(onb), {})], [activityRow(o, "onboarding-approved", `Onboarding ${onb.Ref} approved`, undefined, refsOf(onb))]);
}
export function withdrawApproval(onb: Row, can: (a: ProposalAction) => boolean, o: Ctx): Written | { error: string } {
  if (!can("approve")) return { error: "You can't change onboarding approvals." };
  if (!str(onb.ApprovedBy)) return { error: "It hasn't been approved." };
  if (str(onb.Status) !== "active") return { error: "This onboarding is closed." };
  return saveOnb(onb, { ApprovedBy: "", ApprovedOn: "" }, o, [logRow(o, "approval-withdrawn", "onboarding", str(onb.Key), refsOf(onb), {})]);
}
export function cancelOnboarding(onb: Row, reason: string, can: (a: ProposalAction) => boolean, o: Ctx): Written | { error: string } {
  if (!can("configure")) return { error: "Only a manager or partner can cancel onboarding." };
  if (!isLiveOnboarding(onb)) return { error: "This onboarding is closed." };
  if (!reason.trim()) return { error: "Say why." };
  return saveOnb(onb, { Status: "cancelled", Notes: reason.trim() }, o, [logRow(o, "cancelled", "onboarding", str(onb.Key), refsOf(onb), { reason: reason.trim() })], [activityRow(o, "onboarding-cancelled", `Onboarding ${onb.Ref} cancelled`, undefined, refsOf(onb), reason.trim())]);
}

// ------------------------------------------------------------------ activation

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
/** The planner stores a year end as "MM-DD" ("03-31"). Also reads "31 March", "March 31" and "31/03" as month and day, or undefined. */
export function parseYearEnd(s: string): { m: number; d: number } | undefined {
  const t = s.trim().toLowerCase();
  const iso = t.match(/^(\d{1,2})-(\d{1,2})$/);
  if (iso) { const m = Number(iso[1]), d = Number(iso[2]); return m >= 1 && m <= 12 && d >= 1 && d <= 31 ? { m, d } : undefined; }
  const uk = t.match(/^(\d{1,2})\/(\d{1,2})/);
  if (uk) { const d = Number(uk[1]), m = Number(uk[2]); return m >= 1 && m <= 12 && d >= 1 && d <= 31 ? { m, d } : undefined; }
  const m = MONTHS.findIndex((x) => t.includes(x.slice(0, 3))) + 1;
  const d = Number((t.match(/\d{1,2}/) || [])[0]);
  return m && d >= 1 && d <= 31 ? { m, d } : undefined;
}
const monthEnd = (iso: string) => addDays(addMonths(`${iso.slice(0, 7)}-01`, 1, false), -1);

/** The first period and deadline for a service the client has just taken on. Worked out from the start date and the client's year end. */
export function firstJob(serviceKey: string, services: Row[], client: Row, start: string): { PeriodEnd: string; Deadline: string; note: string } {
  const rule = ruleFor(serviceKey, services);
  let pe: string; let note = "";
  if (rule.repeatMonths === 12) {
    const ye = parseYearEnd(str(client.YearEnd));
    if (ye) {
      const year = Number(start.slice(0, 4));
      const last = new Date(Date.UTC(year, ye.m, 0)).getUTCDate();
      let c = `${year}-${String(ye.m).padStart(2, "0")}-${String(Math.min(ye.d, last)).padStart(2, "0")}`;
      if (c < start) { const l2 = new Date(Date.UTC(year + 1, ye.m, 0)).getUTCDate(); c = `${year + 1}-${String(ye.m).padStart(2, "0")}-${String(Math.min(ye.d, l2)).padStart(2, "0")}`; }
      pe = c;
    } else { pe = addDays(addMonths(start, 12, false), -1); note = "No year end on the client record: the period was worked out as twelve months from the start. Check it."; }
  } else if (rule.repeatMonths > 0) { pe = monthEnd(addMonths(`${start.slice(0, 7)}-01`, rule.repeatMonths - 1, false)); note = "First period worked out from the start date. Check it matches the client's own periods."; }
  else pe = start;
  return { PeriodEnd: pe, Deadline: deadlineByRule(rule, pe, 14), note };
}

export type PlanLine = { serviceKey: string; name: string; action: "start" | "held" | "skip"; reason: string; fee: number; period: string; oneOff: boolean; annual: number; job?: { PeriodEnd: string; Deadline: string; note: string } };
/** What activation will do, line by line. Services that need an authorisation that isn't in place yet are held, not started. */
export function activationPlan(i: { agreed: Agreed; catalogue: CatalogueService[]; services: Row[]; client: Row; jobs: Row[]; start: string; authDone: boolean }): PlanLine[] {
  const out: PlanLine[] = [];
  for (const l of i.agreed.lines) {
    const svc = i.catalogue.find((c) => c.key === l.serviceKey);
    const net = l.discount ? (l.discount.kind === "pct" ? l.price * (1 - l.discount.value / 100) : Math.max(0, l.price - l.discount.value)) : l.price;
    const periods = ({ monthly: 12, quarterly: 4, annual: 1 } as Record<string, number>)[l.frequency] || 0;
    const oneOff = !periods;
    const base = { serviceKey: l.serviceKey, name: l.name, fee: Math.round(net * 100) / 100, period: freqLabel(l.frequency), oneOff, annual: oneOff ? 0 : Math.round(net * periods * 100) / 100 };
    if (!l.serviceKey || !i.services.some((s) => s.Key === l.serviceKey)) { out.push({ ...base, action: "skip", reason: "Not a type of work in the planner, so no job is created. The fee is still recorded." }); continue; }
    if (svc?.requiresAuth && !i.authDone) { out.push({ ...base, action: "held", reason: "Needs an agent authorisation that isn't recorded yet. It will not be started." }); continue; }
    if (i.jobs.some((j) => str(j.ClientKey) === str(i.client.Key) && str(j.ServiceKey) === l.serviceKey && !["Complete", "Done", "Cancelled"].includes(str(j.Status)))) { out.push({ ...base, action: "skip", reason: "The client already has an open job for this." }); continue; }
    out.push({ ...base, action: "start", reason: "", job: firstJob(l.serviceKey, i.services, i.client, i.start) });
  }
  return out;
}

export type ActivateInput = { onb: Row; lines: StageLine[]; client: Row; version: Row; services: Row[]; catalogue: CatalogueService[]; clientServices: Row[]; jobs: Row[]; engagements: Row[]; authDone: boolean; today: string; can: (a: ProposalAction) => boolean; independent: boolean };
export function activate(i: ActivateInput, o: Ctx): Written | { error: string } {
  const { onb } = i;
  const closed = live(onb); if (closed) return { error: closed };
  if (!i.can("send")) return { error: "Only a manager or partner can activate a client." };
  if (!str(onb.ApprovedBy)) return { error: "Get the onboarding approved first." };
  const b = blockers(i.lines, { includeApproval: true });
  if (b.length) return { error: `Not ready: ${b[0]}` };
  const agreed = readAgreed(i.version.Agreed);
  if (!agreed) return { error: "This proposal has no record of what was agreed." };
  const start = str(onb.StartDate) || i.today;
  const plan = activationPlan({ agreed, catalogue: i.catalogue, services: i.services, client: i.client, jobs: i.jobs, start, authDone: i.authDone });
  const w: Written = { patches: [], creates: [], log: [], activities: [] };
  const annual = plan.reduce((a, p) => a + p.annual, 0);
  for (const p of plan) {
    const existing = i.clientServices.find((x) => str(x.ClientKey) === str(i.client.Key) && str(x.ServiceKey) === p.serviceKey);
    const held = p.action === "held"; // fee recorded, but the work is switched off until the authorisation is in place
    const fee: Row = { Fee: p.fee, FeePeriod: p.period, OneOff: p.oneOff, AnnualFee: p.annual, Off: held, OffSince: held ? i.today : "" };
    if (!p.serviceKey) continue;
    if (existing) w.patches.push({ list: "ClientServices", row: existing, patch: fee });
    else w.creates!.push({ list: "ClientServices", row: { Key: o.newKey("CS"), ClientKey: str(i.client.Key), ServiceKey: p.serviceKey, ...fee } });
    if (p.action === "start" && p.job) {
      const stages = i.services.find((s) => s.Key === p.serviceKey);
      w.creates!.push({ list: "Jobs", row: { Key: o.newKey("J"), Title: str(stages?.Title) || p.name, ClientKey: str(i.client.Key), ClientName: str(i.client.Title), ServiceKey: p.serviceKey, PeriodEnd: p.job.PeriodEnd, Deadline: p.job.Deadline, DeadlineSource: "Calculated", StageNo: 1, Status: "Open", Source: "Onboarding", Fee: p.fee, FeePeriod: p.period, Notes: p.job.note } });
    }
  }
  const wasActive = !str(i.client.Status) || /^active$/i.test(str(i.client.Status));
  const clientPatch: Row = { Status: "active", Engaged: str(i.client.Engaged) || start };
  if (annual && (!num(i.client.AnnualFees) || !wasActive)) clientPatch.AnnualFees = annual;
  w.patches.push({ list: "Clients", row: i.client, patch: clientPatch });
  const summary = { started: plan.filter((p) => p.action === "start").map((p) => p.name), held: plan.filter((p) => p.action === "held").map((p) => p.name), skipped: plan.filter((p) => p.action === "skip").map((p) => `${p.name}: ${p.reason}`), annual, engagements: i.engagements.filter((e) => str(e.ClientKey) === str(i.client.Key) && isInForce(e)).map((e) => str(e.Ref)) };
  w.patches.push({ list: "Onboardings", row: onb, patch: { Status: "activated", ActivatedBy: o.actor, ActivatedOn: o.now, ActivationSummary: JSON.stringify(summary), Updated: o.now } });
  w.log.push(logRow(o, "activated", "onboarding", str(onb.Key), refsOf(onb), summary));
  w.activities.push(activityRow(o, "client-activated", `Client activated: ${i.client.Title}`, undefined, refsOf(onb), `${summary.started.length} service${summary.started.length === 1 ? "" : "s"} started${summary.held.length ? `, ${summary.held.length} held` : ""}`));
  return w;
}

/** After an agent authorisation is recorded: start the services that were held back at activation. */
export function releaseHeld(i: Omit<ActivateInput, "lines" | "independent" | "engagements">, o: Ctx): Written | { error: string } {
  const { onb } = i;
  if (str(onb.Status) !== "activated") return { error: "Only an activated client has held services." };
  if (!i.can("send")) return { error: "Only a manager or partner can start held services." };
  if (!i.authDone) return { error: "Record the agent authorisation first." };
  const agreed = readAgreed(i.version.Agreed);
  const held = new Set<string>((() => { try { return (JSON.parse(str(onb.ActivationSummary) || "{}").held || []) as string[]; } catch { return []; } })());
  if (!agreed || !held.size) return { error: "No services are being held." };
  const plan = activationPlan({ agreed: { ...agreed, lines: agreed.lines.filter((l) => held.has(l.name)) }, catalogue: i.catalogue, services: i.services, client: i.client, jobs: i.jobs, start: i.today, authDone: true });
  const w: Written = { patches: [], creates: [], log: [], activities: [] };
  const stillHeld = new Set(held);
  for (const p of plan) {
    const cs = i.clientServices.find((x) => str(x.ClientKey) === str(i.client.Key) && str(x.ServiceKey) === p.serviceKey);
    if (cs) w.patches.push({ list: "ClientServices", row: cs, patch: { Off: false, OffSince: "" } });
    if (p.action === "start" && p.job) w.creates!.push({ list: "Jobs", row: { Key: o.newKey("J"), Title: str(i.services.find((x) => x.Key === p.serviceKey)?.Title) || p.name, ClientKey: str(i.client.Key), ClientName: str(i.client.Title), ServiceKey: p.serviceKey, PeriodEnd: p.job.PeriodEnd, Deadline: p.job.Deadline, DeadlineSource: "Calculated", StageNo: 1, Status: "Open", Source: "Onboarding", Fee: p.fee, FeePeriod: p.period, Notes: p.job.note } });
    stillHeld.delete(p.name);
  }
  let summary: Record<string, unknown> = {}; try { summary = JSON.parse(str(onb.ActivationSummary) || "{}"); } catch { /* keep empty */ }
  summary.held = [...stillHeld]; summary.started = [...((summary.started as string[]) || []), ...plan.filter((p) => p.action === "start").map((p) => p.name)];
  w.patches.push({ list: "Onboardings", row: onb, patch: { ActivationSummary: JSON.stringify(summary), Updated: o.now } });
  w.log.push(logRow(o, "released-held", "onboarding", str(onb.Key), refsOf(onb), { started: plan.filter((p) => p.action === "start").map((p) => p.name) }));
  w.activities.push(activityRow(o, "client-activated", `Held services started: ${i.client.Title}`, undefined, refsOf(onb), plan.filter((p) => p.action === "start").map((p) => p.name).join(", ")));
  return w;
}

// ------------------------------------------------------------------ alerts

export type OnbAlert = { key: string; level: "red" | "amber"; title: string; detail: string; href: string };
export const daysSince = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
export function onboardingAlerts(onbs: Row[], viewFor: (o: Row) => View | undefined, clients: Row[], today: string): OnbAlert[] {
  const out: OnbAlert[] = [];
  for (const o of onbs.filter(isLiveOnboarding)) {
    const v = viewFor(o); if (!v) continue;
    const name = str(clients.find((c) => c.Key === o.ClientKey)?.Title) || "client";
    const href = `#/sales/onboard/${o.Key}`;
    const lines = stageLines(v);
    const age = daysSince(str(o.Created).slice(0, 10), today);
    const blocked = lines.filter((l) => l.status === "blocked");
    if (blocked.length) out.push({ key: `ob:${o.Key}:blocked`, level: "red", title: `Onboarding blocked: ${name}`, detail: `${blocked[0].def.label}: ${blocked[0].detail}`, href });
    else if (!blockers(lines, { includeApproval: true }).length && str(o.ApprovedBy)) out.push({ key: `ob:${o.Key}:ready`, level: "amber", title: `Ready to activate: ${name}`, detail: "All required controls are met.", href });
    else if (!blockers(lines).length && !str(o.ApprovedBy)) out.push({ key: `ob:${o.Key}:approve`, level: "amber", title: `Onboarding awaiting approval: ${name}`, detail: "All required controls are met.", href });
    else if (age >= 14) out.push({ key: `ob:${o.Key}:stale`, level: "amber", title: `Onboarding open for ${age} days: ${name}`, detail: blockers(lines)[0] || "", href });
  }
  return out;
}
