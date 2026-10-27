// Sales (Phase 1 of the lead-to-client lifecycle): leads, opportunities and the pipeline.
// Pure logic only: the screens and storage call into this, and the tests run it directly.
//
// A Lead is someone who is not a client yet. An Opportunity is one piece of potential work and
// belongs to a Lead or to an existing Client (a client asking for more work never becomes a lead).
// The relationship, the opportunity and (in later phases) the proposal, engagement and onboarding
// each have their own status: nothing here is one rigid status field.
import { Client, Job } from "./domain";
import { Config, Role, readConfig, staffRole } from "./checklist";
import { Row } from "./schema";
import { normName } from "./xamaSync";

// ------------------------------------------------------------------ settings

export type Stage = { key: string; label: string; won?: boolean };

/** The eight stages in the brief. Practices can rename, reorder, add and remove them in Settings. */
export const DEFAULT_STAGES: Stage[] = [
  { key: "new", label: "New lead" }, { key: "contacted", label: "Contacted" }, { key: "qualified", label: "Qualified" },
  { key: "discovery", label: "Discovery / requirements" }, { key: "preparing", label: "Proposal being prepared" },
  { key: "sent", label: "Proposal sent" }, { key: "negotiation", label: "Negotiation" }, { key: "accepted", label: "Accepted", won: true },
];
export const DEFAULT_SOURCES = ["Website", "Referral", "Networking", "Advertising", "Telephone", "Email", "Existing client"];
export const DEFAULT_LOST_REASONS = ["Price", "Chose another accountant", "No response", "Not a good fit", "Timing", "Doing it themselves", "Other"];

const setting = (settings: Row[], key: string): unknown => {
  const r = settings.find((x) => x.Key === key);
  if (!r?.Value) return undefined;
  try { return JSON.parse(String(r.Value)); } catch { return undefined; }
};

export function readPipeline(settings: Row[]): Stage[] {
  const v = setting(settings, "sales.pipeline");
  if (!Array.isArray(v)) return DEFAULT_STAGES;
  const seen = new Set<string>();
  const out: Stage[] = [];
  for (const s of v) {
    const key = String(s?.key || "").trim();
    const label = String(s?.label || "").trim();
    if (!key || !label || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label, won: s.won === true ? true : undefined });
  }
  if (out.length < 2) return DEFAULT_STAGES;
  if (!out.some((s) => s.won)) out[out.length - 1] = { ...out[out.length - 1], won: true };
  // only the last "won" stage counts as won; any other is just an ordinary stage
  const lastWon = out.map((s) => !!s.won).lastIndexOf(true);
  return out.map((s, i) => (s.won && i !== lastWon ? { key: s.key, label: s.label } : s));
}

export function readStrings(settings: Row[], key: string, fallback: string[]): string[] {
  const v = setting(settings, key);
  if (!Array.isArray(v)) return fallback;
  const out = [...new Set(v.map((x) => String(x || "").trim()).filter(Boolean))];
  return out.length ? out : fallback;
}

export const wonStage = (stages: Stage[]): Stage => stages.find((s) => s.won) || stages[stages.length - 1];
export const firstStage = (stages: Stage[]): Stage => stages[0];

/** A stage key made from its label, not clashing with the ones already used. */
export function stageKeyFor(label: string, used: Iterable<string>): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "stage";
  const taken = new Set(used);
  let k = base, i = 2;
  while (taken.has(k)) k = `${base}-${i++}`;
  return k;
}

// ------------------------------------------------------------------ permissions

export type SalesAction = "view" | "work" | "configure";
/**
 * Who may do what, from the staff list in the checklist settings. With no staff listed everyone can
 * (as elsewhere in the app). Phase 1 enforces this in the app and records every change in the audit
 * log; enforcing it on a server needs sales writes to go through an API (planned for Phase 2).
 */
export function salesCan(cfg: Config, user: string, action: SalesAction): boolean {
  if (!cfg.staff.length) return true;
  const role: Role | undefined = staffRole(cfg, user);
  if (!role) return action === "view";
  if (role === "outsourced") return false;
  if (action === "configure") return role === "manager" || role === "partner" || role === "owner";
  return true;
}
export const salesConfig = (settings: Row[]) => readConfig(settings);

// ------------------------------------------------------------------ duplicates

export type Candidate = { name: string; email?: string; phone?: string; companyNumber?: string };
export type Match = { kind: "lead" | "client" | "contact"; key: string; title: string; why: string[]; strong: boolean; clientKey?: string };

const emailKey = (s: unknown) => String(s || "").trim().toLowerCase();
const digits = (s: unknown) => String(s || "").replace(/\D/g, "").replace(/^44/, "0");
const phoneKey = (s: unknown) => { const d = digits(s); return d.length >= 9 ? d.slice(-10) : ""; };
const numKey = (s: unknown) => String(s || "").replace(/\s/g, "").toUpperCase().replace(/^0+/, "");

/** Anyone we already hold who might be the same person or business. Strong matches first. */
export function findDuplicates(c: Candidate, leads: Row[], clients: Client[], contacts: Row[], skipLeadKey?: string): Match[] {
  const e = emailKey(c.email), p = phoneKey(c.phone), nm = normName(c.name || ""), cn = numKey(c.companyNumber);
  const out: Match[] = [];
  const consider = (kind: Match["kind"], key: string, title: string, emails: unknown[], phones: unknown[], num: unknown, extra?: { clientKey?: string }) => {
    const why: string[] = [];
    let strong = false;
    if (e && emails.some((x) => emailKey(x) === e)) { why.push("same email"); strong = true; }
    if (p && phones.some((x) => phoneKey(x) === p)) { why.push("same phone number"); strong = true; }
    if (cn && numKey(num) === cn) { why.push("same company number"); strong = true; }
    const tn = normName(title);
    if (nm && tn) {
      if (tn === nm) { why.push("same name"); strong = true; }
      else if (nm.length >= 5 && tn.length >= 5 && (tn.includes(nm) || nm.includes(tn))) why.push("similar name");
    }
    if (why.length) out.push({ kind, key, title, why, strong, ...extra });
  };
  for (const l of leads) {
    if (skipLeadKey && l.Key === skipLeadKey) continue;
    consider("lead", String(l.Key), String(l.Title || ""), [l.Email], [l.Phone], "", l.ClientKey ? { clientKey: String(l.ClientKey) } : undefined);
  }
  for (const cl of clients) consider("client", cl.Key, cl.Title, [cl.Email], [cl.Mobile, cl.Phone], cl.CompanyNumber, { clientKey: cl.Key });
  for (const ct of contacts) consider("contact", String(ct.Key), String(ct.Title || ""), [ct.Email], [ct.Mobile, ct.Phone], "");
  return out.sort((a, b) => Number(b.strong) - Number(a.strong) || a.title.localeCompare(b.title));
}

// ------------------------------------------------------------------ opportunities

export type Opp = Row & {
  Key: string; Title: string; LeadKey?: string; ClientKey?: string; Stage: string; Outcome?: string; Order?: number; Value?: number;
  Owner?: string; Services?: string; NextAction?: string; FollowUp?: string; LastContact?: string; StageSince?: string; LostReason?: string; DeferUntil?: string;
};
export type Lead = Row & { Key: string; Title: string; Kind?: string; Status?: string; ClientKey?: string; Email?: string; Phone?: string; Source?: string; Owner?: string };

export const outcomeOf = (o: Row): "open" | "won" | "lost" | "deferred" => (o.Outcome === "won" || o.Outcome === "lost" || o.Outcome === "deferred" ? o.Outcome : "open");
export const isOpenOpp = (o: Row) => outcomeOf(o) === "open";

/** The open opportunities in one stage, in the order shown on the board. */
export function inStage(opps: Opp[], stage: string): Opp[] {
  return opps.filter((o) => isOpenOpp(o) && o.Stage === stage).sort((a, b) => (Number(a.Order) || 0) - (Number(b.Order) || 0) || String(a.Key).localeCompare(String(b.Key)));
}

/** An order number that puts a card at `index` among `siblings` (already without the moved card). */
export function orderAt(siblings: Opp[], index: number): number {
  const i = Math.max(0, Math.min(index, siblings.length));
  const prev = i > 0 ? Number(siblings[i - 1].Order) || 0 : undefined;
  const next = i < siblings.length ? Number(siblings[i].Order) || 0 : undefined;
  if (prev === undefined && next === undefined) return 1000;
  if (prev === undefined) return next! - 1000;
  if (next === undefined) return prev + 1000;
  return prev === next ? prev + 0.5 : (prev + next) / 2;
}

export type LogEntry = Row;
export type Patch = { list: "Leads" | "Opportunities" | "Activities" | "Proposals" | "ProposalVersions" | "Services" | "Engagements" | "Clients" | "Onboardings" | "ClientServices" | "FeeCharges" | "ClientCosts" | "Actions" | "CoSecTransactions" | "CoSecOfficers" | "CoSecPscs" | "CoSecShares" | "CoSecShareClasses"; row: Row; patch: Row };
export type Created = { list: "Proposals" | "ProposalVersions" | "Engagements" | "Onboardings" | "ClientServices" | "Jobs" | "Clients" | "FeeHistory" | "FeeCharges" | "ClientCosts" | "Actions" | "CoSecEvents" | "CoSecTransactions" | "CoSecOfficers" | "CoSecPscs" | "CoSecShares" | "CoSecShareClasses"; row: Row };
export type Written = { patches: Patch[]; log: LogEntry[]; activities: Row[]; creates?: Created[] };
export type Ctx = { actor: string; now: string; pid: string; newKey: (p: string) => string };

export function logRow(o: Ctx, action: string, entityType: string, entityKey: string, refs: { leadKey?: string; clientKey?: string }, detail: unknown): LogEntry {
  return { Key: o.newKey("SL"), PracticeId: o.pid, At: o.now, Actor: o.actor, Action: action, EntityType: entityType, EntityKey: entityKey, LeadKey: refs.leadKey || "", ClientKey: refs.clientKey || "", Detail: JSON.stringify(detail) };
}

export function activityRow(o: Ctx, type: string, title: string, opp: Row | undefined, refs: { leadKey?: string; clientKey?: string; oppKey?: string }, summary = "", eventKey?: string, followUp = ""): Row {
  return {
    Key: o.newKey("A"), ClientKey: refs.clientKey || "", LeadKey: refs.leadKey || "", OppKey: refs.oppKey || (opp ? String(opp.Key) : ""), Type: type, Title: title, Summary: summary,
    At: o.now, Actor: o.actor, Source: "sales", SourceKey: refs.oppKey || (opp ? String(opp.Key) : refs.leadKey || ""), EventKey: eventKey || `sales:${type}:${refs.oppKey || refs.leadKey || ""}:${o.now}`,
    Status: "", Visibility: "normal", FollowUp: followUp, PracticeId: o.pid,
  };
}

const refsOf = (opp: Row) => ({ leadKey: String(opp.LeadKey || ""), clientKey: String(opp.ClientKey || ""), oppKey: String(opp.Key) });
const dayOf = (iso: string) => iso.slice(0, 10);

/** Move an opportunity to a stage (and a place in it). Moving into the won stage records a win. */
export function moveStage(opp: Opp, to: string, index: number | undefined, all: Opp[], stages: Stage[], o: Ctx): Written | { error: string } {
  const target = stages.find((s) => s.key === to);
  if (!target) return { error: "That stage doesn't exist." };
  if (outcomeOf(opp) === "lost" || outcomeOf(opp) === "deferred") return { error: "Reopen this opportunity before moving it." };
  const from = stages.find((s) => s.key === opp.Stage);
  const siblings = inStage(all.filter((x) => x.Key !== opp.Key), to);
  const patch: Row = { Stage: to, Order: orderAt(siblings, index === undefined ? siblings.length : index), Updated: o.now };
  const changedStage = opp.Stage !== to;
  if (changedStage) patch.StageSince = o.now;
  const won = !!target.won && changedStage;
  if (won) { patch.Outcome = "won"; patch.LastContact = opp.LastContact || ""; }
  const w: Written = { patches: [{ list: "Opportunities", row: opp, patch }], log: [], activities: [] };
  if (changedStage) {
    w.log.push(logRow(o, won ? "won" : "stage", "opportunity", opp.Key, refsOf(opp), { from: opp.Stage, to, fromLabel: from?.label, toLabel: target.label }));
    w.activities.push(activityRow(o, won ? "opp-won" : "opp-stage", won ? `Opportunity won: ${opp.Title}` : `${opp.Title}: moved to ${target.label}`, opp, refsOf(opp), from ? `From ${from.label}` : ""));
  }
  return w;
}

export function reopen(opp: Opp, stages: Stage[], o: Ctx): Written {
  const stage = stages.find((s) => s.key === opp.Stage && !s.won) || stages[0];
  const w: Written = { patches: [{ list: "Opportunities", row: opp, patch: { Outcome: "open", LostReason: "", DeferUntil: "", Stage: stage.key, StageSince: o.now, Updated: o.now } }], log: [], activities: [] };
  w.log.push(logRow(o, "reopened", "opportunity", opp.Key, refsOf(opp), { stage: stage.key }));
  w.activities.push(activityRow(o, "opp-outcome", `Opportunity reopened: ${opp.Title}`, opp, refsOf(opp)));
  return w;
}

export function setOutcome(opp: Opp, outcome: "won" | "lost" | "deferred", stages: Stage[], o: Ctx, extra: { reason?: string; until?: string }): Written | { error: string } {
  if (outcome === "lost" && !String(extra.reason || "").trim()) return { error: "Say why it was lost." };
  if (outcome === "deferred" && !/^\d{4}-\d{2}-\d{2}$/.test(String(extra.until || ""))) return { error: "Say when to come back to it." };
  const patch: Row = { Outcome: outcome, Updated: o.now };
  if (outcome === "won") { patch.Stage = wonStage(stages).key; patch.StageSince = o.now; patch.LostReason = ""; patch.DeferUntil = ""; }
  if (outcome === "lost") { patch.LostReason = String(extra.reason).trim(); patch.FollowUp = ""; }
  if (outcome === "deferred") { patch.DeferUntil = extra.until!; patch.FollowUp = extra.until!; }
  const word = outcome === "won" ? "won" : outcome === "lost" ? `lost (${extra.reason})` : `deferred until ${extra.until}`;
  return {
    patches: [{ list: "Opportunities", row: opp, patch }],
    log: [logRow(o, outcome, "opportunity", opp.Key, refsOf(opp), { reason: extra.reason || "", until: extra.until || "" })],
    activities: [activityRow(o, outcome === "won" ? "opp-won" : "opp-outcome", `Opportunity ${word}: ${opp.Title}`, opp, refsOf(opp))],
  };
}

export type NewOppInput = { title: string; leadKey?: string; clientKey?: string; stage: string; services?: string; value?: number; owner?: string; nextAction?: string; followUp?: string; notes?: string };
export function createOpp(i: NewOppInput, all: Opp[], o: Ctx): { opp: Row; log: LogEntry; activity: Row } | { error: string } {
  if (!i.title.trim()) return { error: "Give the opportunity a name." };
  if (!i.leadKey && !i.clientKey) return { error: "An opportunity belongs to a lead or a client." };
  const key = o.newKey("O");
  const opp: Row = {
    Key: key, PracticeId: o.pid, Title: i.title.trim(), LeadKey: i.leadKey || "", ClientKey: i.clientKey || "", Stage: i.stage, StageSince: o.now, Services: i.services || "", Value: i.value ?? 0,
    Owner: i.owner || "", NextAction: i.nextAction || "", FollowUp: i.followUp || "", LastContact: "", Outcome: "open", Order: orderAt(inStage(all, i.stage), Infinity), Notes: i.notes || "", Created: o.now, Updated: o.now,
  };
  const refs = { leadKey: i.leadKey, clientKey: i.clientKey, oppKey: key };
  return { opp, log: logRow(o, "created", "opportunity", key, refs, { stage: i.stage }), activity: activityRow(o, "opp-created", `Opportunity created: ${opp.Title}`, opp, refs) };
}

export type NewLeadInput = { name: string; kind: "individual" | "business"; contactName?: string; email?: string; phone?: string; website?: string; source?: string; notes?: string; received?: string; owner?: string; clientKey?: string };
export function createLead(i: NewLeadInput, o: Ctx): { lead: Row; log: LogEntry; activity: Row } | { error: string } {
  if (!i.name.trim()) return { error: "Give the lead a name." };
  if (i.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(i.email.trim())) return { error: "That email address doesn't look right." };
  const key = o.newKey("L");
  const lead: Row = {
    Key: key, PracticeId: o.pid, Title: i.name.trim(), Kind: i.kind, ContactName: i.contactName || "", Email: (i.email || "").trim(), Phone: i.phone || "", Website: i.website || "", Source: i.source || "",
    Owner: i.owner || "", Received: i.received || dayOf(o.now), Notes: i.notes || "", Status: "open", ClientKey: i.clientKey || "", Created: o.now, Updated: o.now,
  };
  const refs = { leadKey: key, clientKey: i.clientKey };
  return { lead, log: logRow(o, "created", "lead", key, refs, { source: i.source || "", kind: i.kind }), activity: activityRow(o, "lead-created", `Lead created: ${lead.Title}`, undefined, refs, i.source ? `Source: ${i.source}` : "") };
}

/** Link a lead to an existing client: the lead, its opportunities and its history then show on that client. */
export function linkToClient(lead: Lead, clientKey: string, opps: Opp[], activities: Row[], o: Ctx): Written {
  const w: Written = { patches: [{ list: "Leads", row: lead, patch: { ClientKey: clientKey, Status: "converted", Updated: o.now } }], log: [], activities: [] };
  for (const op of opps.filter((x) => x.LeadKey === lead.Key && x.ClientKey !== clientKey)) w.patches.push({ list: "Opportunities", row: op, patch: { ClientKey: clientKey } });
  for (const a of activities.filter((x) => x.LeadKey === lead.Key && x.ClientKey !== clientKey)) w.patches.push({ list: "Activities", row: a, patch: { ClientKey: clientKey } });
  w.log.push(logRow(o, "linked", "lead", lead.Key, { leadKey: lead.Key, clientKey }, { clientKey }));
  w.activities.push(activityRow(o, "opp-outcome", `Lead linked to this client: ${lead.Title}`, undefined, { leadKey: lead.Key, clientKey }));
  return w;
}

export type ActivityInput = { kind: "call" | "meeting" | "email" | "note" | "follow-up"; text: string; followUp?: string };
export const ACTIVITY_KINDS: { key: ActivityInput["kind"]; label: string }[] = [
  { key: "call", label: "Phone call" }, { key: "meeting", label: "Meeting" }, { key: "email", label: "Email" }, { key: "note", label: "Note" }, { key: "follow-up", label: "Follow-up" },
];

/** Log a call, meeting, email, note or follow-up against an opportunity. A contact (not a note) counts as the last contact. */
export function logActivity(opp: Opp, i: ActivityInput, o: Ctx): Written | { error: string } {
  const text = i.text.trim();
  if (!text) return { error: "Write what happened." };
  if (i.followUp && !/^\d{4}-\d{2}-\d{2}$/.test(i.followUp)) return { error: "That follow-up date isn't valid." };
  const type = i.kind === "email" ? "note" : i.kind;
  const label = ACTIVITY_KINDS.find((k) => k.key === i.kind)!.label;
  const patch: Row = { Updated: o.now };
  if (i.kind === "call" || i.kind === "meeting" || i.kind === "email") patch.LastContact = dayOf(o.now);
  if (i.followUp) patch.FollowUp = i.followUp;
  const title = `${label}: ${opp.Title}`;
  return {
    patches: [{ list: "Opportunities", row: opp, patch }],
    log: [logRow(o, "activity", "opportunity", opp.Key, refsOf(opp), { kind: i.kind })],
    activities: [activityRow(o, type, title, opp, refsOf(opp), text, undefined, i.followUp || "")],
  };
}

// ------------------------------------------------------------------ what needs attention

export type SalesAlert = { key: string; level: "red" | "amber"; title: string; detail: string; href: string };

/** Overdue follow-ups, and new leads nobody has contacted yet. */
export function salesAlerts(opps: Opp[], leads: Lead[], today: string, firstStageKey: string): SalesAlert[] {
  const out: SalesAlert[] = [];
  for (const op of opps.filter(isOpenOpp)) {
    if (op.FollowUp && op.FollowUp < today) out.push({ key: `fu:${op.Key}`, level: "red", title: `Sales follow-up overdue: ${op.Title}`, detail: `Was due ${op.FollowUp}${op.NextAction ? `: ${op.NextAction}` : ""}`, href: `#/sales/opp/${op.Key}` });
    else if (op.Stage === firstStageKey && !op.LastContact && String(op.Created || "").slice(0, 10) < today) out.push({ key: `new:${op.Key}`, level: "amber", title: `New lead awaiting first contact: ${op.Title}`, detail: `Received ${String(op.Created).slice(0, 10)}`, href: `#/sales/opp/${op.Key}` });
  }
  void leads;
  return out;
}

export type Totals = { open: number; value: number; byStage: Record<string, { count: number; value: number }>; won: number; lost: number; deferred: number; overdue: number };
export function totals(opps: Opp[], stages: Stage[], today: string): Totals {
  const t: Totals = { open: 0, value: 0, byStage: Object.fromEntries(stages.map((s) => [s.key, { count: 0, value: 0 }])), won: 0, lost: 0, deferred: 0, overdue: 0 };
  for (const op of opps) {
    const out = outcomeOf(op);
    if (out === "won") t.won++;
    else if (out === "lost") t.lost++;
    else if (out === "deferred") t.deferred++;
    else {
      t.open++; t.value += Number(op.Value) || 0;
      const b = t.byStage[op.Stage] || (t.byStage[op.Stage] = { count: 0, value: 0 });
      b.count++; b.value += Number(op.Value) || 0;
      if (op.FollowUp && op.FollowUp < today) t.overdue++;
    }
  }
  return t;
}

/** Stage keys that no longer exist (the practice removed a stage): those cards go to the first stage. */
export function repairStages(opps: Opp[], stages: Stage[]): Patch[] {
  const known = new Set(stages.map((s) => s.key));
  return opps.filter((op) => isOpenOpp(op) && !known.has(op.Stage)).map((op) => ({ list: "Opportunities" as const, row: op, patch: { Stage: stages[0].key } }));
}

export type { Job };
