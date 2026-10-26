// Fees (Phase 5): each client's fee schedule, the practice's agreed revenue, and manually entered direct costs.
// Pure logic, like sales.ts and onboarding.ts: functions return what to save (changes, new rows, a timeline entry).
//
// Everything here is CONTRACTED money: what the client agreed to pay. It is not invoiced and it is not cash received.
// Figures are net of VAT. Contribution counts only the direct costs someone has typed in; there is no time recording.
import { Config } from "./checklist";
import { AgreedLine } from "./engagements";
import { ProposalAction, proposalCan } from "./proposals";
import { PERIODS } from "./proposals";
import { Ctx, Written, activityRow } from "./sales";
import { Row } from "./schema";
import { addMonths } from "./planning";

const str = (v: unknown): string => (v === undefined || v === null ? "" : String(v));
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const money2 = (n: number) => Math.round(n * 100) / 100;
const truthy = (v: unknown) => v === true || v === "true" || v === "True" || v === 1;

// ------------------------------------------------------------------ settings and permission

export type FeeSettings = { reviewMonths: number };
export const DEFAULT_FEE_SETTINGS: FeeSettings = { reviewMonths: 12 };
export function readFeeSettings(settings: Row[]): FeeSettings {
  const row = settings.find((r) => r.Key === "fees.settings");
  try { const o = JSON.parse(str(row?.Value) || "{}"); const m = Number(o.reviewMonths); return { reviewMonths: Number.isInteger(m) && m >= 1 && m <= 60 ? m : 12 }; } catch { return DEFAULT_FEE_SETTINGS; }
}
/** Changing what a client is charged, or the costs against them, is for a manager or partner. Anyone who can see Sales can read. */
export type FeeAction = "view" | "adjust";
export const feeCan = (cfg: Config, user: string, a: FeeAction): boolean => proposalCan(cfg, user, (a === "view" ? "view" : "send") as ProposalAction);

// ------------------------------------------------------------------ periods

/** How many times a year a fee is charged. The planner's own values are monthly, quarterly and annually; "annual" is read too. 0 = not recurring. */
export function periodsPerYear(period: string): number {
  const p = period.trim().toLowerCase();
  if (p === "monthly") return 12;
  if (p === "quarterly") return 4;
  if (p === "annually" || p === "annual" || p === "yearly") return 1;
  return 0;
}
/** The text stored in a client's service for a proposal's billing frequency. */
export const periodText = (frequency: string): string => (frequency === "monthly" ? "monthly" : frequency === "quarterly" ? "quarterly" : frequency === "annual" ? "annually" : "");
export const PERIOD_OPTIONS: [string, string][] = [["monthly", "Monthly"], ["quarterly", "Quarterly"], ["annually", "Annually"], ["", "One-off"]];
export const periodLabel = (p: string) => PERIOD_OPTIONS.find(([k]) => k === p.toLowerCase())?.[1] || (p ? p[0].toUpperCase() + p.slice(1) : "One-off");

export const VAT_OPTIONS: [string, string][] = [["standard", "Standard rate"], ["zero", "Zero rated"], ["exempt", "Exempt"], ["outside", "Outside the scope"]];
export const vatLabel = (v: string) => VAT_OPTIONS.find(([k]) => k === v)?.[1] || "Not recorded";

// ------------------------------------------------------------------ the schedule

export type Discount = { kind: "pct" | "amount"; value: number; reason: string };
export type FeeLine = {
  key: string; clientKey: string; serviceKey: string; fee: number; period: string; oneOff: boolean; annual: number; listFee: number; discount?: Discount; vat: string;
  effectiveFrom: string; nextReview: string; ended: string; held: boolean; status: "active" | "held" | "ended" | "included"; proposalKey: string;
};
const readDiscount = (v: unknown): Discount | undefined => {
  try { const o = JSON.parse(str(v) || "null"); if (o && (o.kind === "pct" || o.kind === "amount") && num(o.value) > 0) return { kind: o.kind, value: num(o.value), reason: str(o.reason) }; } catch { /* none */ }
  return undefined;
};
export const discountText = (d?: Discount) => (d ? `${d.kind === "pct" ? `${d.value}%` : `£${d.value}`} off${d.reason ? ` (${d.reason})` : ""}` : "");

/** One line of a client's fee schedule, read from their service record. Records made before Phase 5 simply have fewer details. */
export function readFeeLine(cs: Row): FeeLine {
  const period = str(cs.FeePeriod);
  const oneOff = truthy(cs.OneOff) || (!periodsPerYear(period) && !num(cs.AnnualFee));
  const fee = num(cs.Fee);
  const per = periodsPerYear(period);
  const annual = oneOff ? 0 : per ? money2(fee * per) : num(cs.AnnualFee);
  const ended = str(cs.EndedOn);
  const held = truthy(cs.Off) && !ended;
  return {
    key: str(cs.Key), clientKey: str(cs.ClientKey), serviceKey: str(cs.ServiceKey), fee, period, oneOff, annual, listFee: num(cs.ListFee) || fee, discount: readDiscount(cs.DiscountNote), vat: str(cs.VatTreatment),
    effectiveFrom: str(cs.EffectiveFrom), nextReview: str(cs.NextReview), ended, held, proposalKey: str(cs.ProposalKey),
    status: ended ? "ended" : held ? "held" : fee <= 0 ? "included" : "active",
  };
}
/** A service that is switched off but whose fee still counts is "held"; one with no fee is "included" in another fee (a package). */
export const FEE_STATUS_LABEL: Record<FeeLine["status"], string> = { active: "Active", held: "Held", ended: "Ended", included: "Included in package" };

export type Charge = { key: string; clientKey: string; serviceKey: string; label: string; amount: number; vat: string; agreedOn: string; status: "agreed" | "cancelled"; proposalKey: string; notes: string };
export const readCharge = (r: Row): Charge => ({ key: str(r.Key), clientKey: str(r.ClientKey), serviceKey: str(r.ServiceKey), label: str(r.Label), amount: num(r.Amount), vat: str(r.Vat), agreedOn: str(r.AgreedOn), status: str(r.Status) === "cancelled" ? "cancelled" : "agreed", proposalKey: str(r.ProposalKey), notes: str(r.Notes) });

export type FeeSnapshot = { fee: number; period: string; listFee?: number; discount?: Discount | null; vat?: string; effectiveFrom?: string; nextReview?: string; ended?: string; held?: boolean };
const snap = (cs: Row): FeeSnapshot => { const l = readFeeLine(cs); return { fee: l.fee, period: l.period, listFee: l.listFee, discount: l.discount || null, vat: l.vat, effectiveFrom: l.effectiveFrom, nextReview: l.nextReview, ended: l.ended, held: l.held }; };

const historyRow = (o: Ctx, clientKey: string, serviceKey: string, action: string, before: unknown, after: unknown, reason: string, source: string): Row => ({
  Key: o.newKey("FH"), PracticeId: o.pid, ClientKey: clientKey, ServiceKey: serviceKey, At: o.now, Actor: o.actor, Action: action, Old: JSON.stringify(before ?? null), New: JSON.stringify(after ?? null), Reason: reason, Source: source,
});
const feeActivity = (o: Ctx, client: Row, title: string, summary: string) => activityRow(o, "fee-changed", `${title}: ${client.Title}`, undefined, { clientKey: str(client.Key) }, summary);

// ------------------------------------------------------------------ from an accepted proposal

/** What a proposal line becomes in the fee schedule: the fee after discount, how often it is charged, and the one-off set-up fee if any. */
export function lineFee(l: AgreedLine): { net: number; listFee: number; period: string; oneOff: boolean; annual: number; discount: Discount | null; vat: string; setup: number } {
  const net = l.discount ? (l.discount.kind === "pct" ? l.price * (1 - l.discount.value / 100) : Math.max(0, l.price - l.discount.value)) : l.price;
  const per = (PERIODS as Record<string, number>)[l.frequency] || 0;
  const fee = money2(net);
  return { net: fee, listFee: money2(l.price), period: periodText(l.frequency), oneOff: !per, annual: per ? money2(fee * per) : 0, discount: l.discount ? { kind: l.discount.kind as "pct" | "amount", value: l.discount.value, reason: str((l.discount as { reason?: string }).reason) } : null, vat: str(l.vat), setup: money2(l.setupFee || 0) };
}

/** Columns to write on a client service when a proposal line is applied. */
export function scheduleFields(l: AgreedLine, i: { effectiveFrom: string; reviewMonths: number; proposalKey: string }): Row {
  const f = lineFee(l);
  return {
    Fee: f.net, FeePeriod: f.period, OneOff: f.oneOff, AnnualFee: f.annual, ListFee: f.listFee, DiscountNote: f.discount ? JSON.stringify(f.discount) : "", VatTreatment: f.vat,
    EffectiveFrom: i.effectiveFrom, NextReview: f.oneOff ? "" : addMonths(i.effectiveFrom, i.reviewMonths, false), EndedOn: "", ProposalKey: i.proposalKey,
  };
}

/** The one-off set-up charge for a proposal line, as a new row, unless one for this proposal and service already exists. */
export function setupCharge(l: AgreedLine, i: { clientKey: string; proposalKey: string; proposalRef: string; effectiveFrom: string; existing: Row[] }, o: Ctx): Row | undefined {
  const f = lineFee(l);
  if (f.setup <= 0) return undefined;
  if (i.existing.some((c) => str(c.ProposalKey) === i.proposalKey && str(c.ServiceKey) === l.serviceKey && str(c.Label).startsWith("Set-up") && str(c.Status) !== "cancelled")) return undefined;
  return { Key: o.newKey("FC"), PracticeId: o.pid, ClientKey: i.clientKey, ServiceKey: l.serviceKey, Label: `Set-up fee: ${l.name}`, Amount: f.setup, Vat: f.vat, AgreedOn: i.effectiveFrom, Status: "agreed", ProposalKey: i.proposalKey, Notes: `From proposal ${i.proposalRef}`, Created: o.now, CreatedBy: o.actor };
}

/** Which of a client's accepted proposals have fee lines that aren't in their schedule yet (or are in it at a different fee). */
export type Unapplied = { proposalKey: string; ref: string; version: Row; lines: AgreedLine[] };
export function unappliedProposals(clientKey: string, proposals: Row[], versions: Row[], schedule: Row[], readLines: (v: unknown) => AgreedLine[] | undefined): Unapplied[] {
  const out: Unapplied[] = [];
  for (const p of proposals.filter((x) => str(x.ClientKey) === clientKey && str(x.Status) === "accepted")) {
    const v = versions.find((x) => str(x.ProposalKey) === str(p.Key) && Number(x.Version) === Number(p.AcceptedVersion) && str(x.Status) === "accepted");
    const lines = v ? readLines(v.Agreed) : undefined;
    if (!v || !lines) continue;
    const todo = lines.filter((l) => {
      if (!l.serviceKey) return false;
      const cs = schedule.find((s) => str(s.ClientKey) === clientKey && str(s.ServiceKey) === l.serviceKey);
      if (!cs) return true;
      if (str(cs.ProposalKey) === str(p.Key)) return false; // already applied from this proposal
      return Math.abs(readFeeLine(cs).fee - lineFee(l).net) > 0.004;
    });
    if (todo.length) out.push({ proposalKey: str(p.Key), ref: str(p.Ref), version: v, lines: todo });
  }
  return out;
}

/** Put agreed proposal lines into the client's schedule. Existing services at a different fee are changed, with the old fee kept in the history. */
export function applyProposal(i: { client: Row; proposalKey: string; proposalRef: string; lines: AgreedLine[]; schedule: Row[]; charges: Row[]; services: Row[]; effectiveFrom: string; reviewMonths: number; can: (a: ProposalAction) => boolean }, o: Ctx): Written | { error: string } {
  if (!i.can("send")) return { error: "Only a manager or partner can change a client's fees." };
  const w: Written = { patches: [], creates: [], log: [], activities: [] };
  const names: string[] = [];
  for (const l of i.lines) {
    if (!l.serviceKey) continue;
    const fields = scheduleFields(l, { effectiveFrom: i.effectiveFrom, reviewMonths: i.reviewMonths, proposalKey: i.proposalKey });
    const cs = i.schedule.find((s) => str(s.ClientKey) === str(i.client.Key) && str(s.ServiceKey) === l.serviceKey);
    const source = `Proposal ${i.proposalRef}`;
    if (cs) {
      w.patches.push({ list: "ClientServices", row: cs, patch: fields });
      w.creates!.push({ list: "FeeHistory", row: historyRow(o, str(i.client.Key), l.serviceKey, "agreed", snap(cs), { ...snap({ ...cs, ...fields }) }, `Agreed in ${source}`, source) });
    } else {
      const row: Row = { Key: o.newKey("CS"), ClientKey: str(i.client.Key), ServiceKey: l.serviceKey, Off: false, OffSince: "", ...fields };
      w.creates!.push({ list: "ClientServices", row });
      w.creates!.push({ list: "FeeHistory", row: historyRow(o, str(i.client.Key), l.serviceKey, "agreed", null, snap(row), `Agreed in ${source}`, source) });
    }
    const ch = setupCharge(l, { clientKey: str(i.client.Key), proposalKey: i.proposalKey, proposalRef: i.proposalRef, effectiveFrom: i.effectiveFrom, existing: i.charges }, o);
    if (ch) { w.creates!.push({ list: "FeeCharges", row: ch }); w.creates!.push({ list: "FeeHistory", row: historyRow(o, str(i.client.Key), l.serviceKey, "charge-agreed", null, { label: ch.Label, amount: ch.Amount }, `Agreed in ${source}`, source) }); }
    names.push(l.name);
  }
  if (!names.length) return { error: "Nothing to apply." };
  w.activities.push(feeActivity(o, i.client, "Fees agreed", `${names.join(", ")} (proposal ${i.proposalRef})`));
  return withAnnualTotal(w, i.client, i.schedule);
}


/** The client's yearly total (Clients.AnnualFees) after changing some of their schedule lines: active recurring fees only. */
export function withAnnualTotal(w: Written, client: Row, schedule: Row[] | undefined): Written {
  if (!schedule) return w;
  const changed = new Map<string, Row>();
  for (const p of w.patches) if (p.list === "ClientServices") changed.set(str(p.row.Key), { ...p.row, ...p.patch });
  const rows = [...schedule.filter((r) => str(r.ClientKey) === str(client.Key) && !changed.has(str(r.Key))), ...changed.values(), ...(w.creates || []).filter((c) => c.list === "ClientServices").map((c) => c.row)];
  const total = money2(rows.map(readFeeLine).filter((l) => l.status === "active").reduce((a, l) => a + l.annual, 0));
  if (total === num(client.AnnualFees)) return w;
  return { ...w, patches: [...w.patches, { list: "Clients", row: client, patch: { AnnualFees: total } }] };
}

// ------------------------------------------------------------------ manual adjustments

export type Adjust = { fee: number; period: string; vat: string; effectiveFrom: string; nextReview: string; discount: Discount | null; reason: string };
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
export function adjustFeeProblems(a: Adjust): string[] {
  const out: string[] = [];
  if (!(a.fee >= 0) || !Number.isFinite(a.fee)) out.push("The fee has to be zero or more.");
  if (!isDate(a.effectiveFrom)) out.push("Give the date the new fee starts.");
  if (a.nextReview && !isDate(a.nextReview)) out.push("The review date isn't valid.");
  if (a.nextReview && isDate(a.effectiveFrom) && a.nextReview < a.effectiveFrom) out.push("The review date is before the fee starts.");
  if (a.discount && !(a.discount.value > 0)) out.push("A discount has to be more than zero.");
  if (a.discount?.kind === "pct" && a.discount.value > 100) out.push("A discount can't be more than 100%.");
  if (!a.reason.trim()) out.push("Say why the fee is changing.");
  return out;
}
/** Change a client's fee by hand. Needs authority and a reason, and the previous fee is kept in the history. */
export function adjustFee(cs: Row, client: Row, a: Adjust, can: (x: ProposalAction) => boolean, o: Ctx, schedule?: Row[]): Written | { error: string } {
  if (!can("send")) return { error: "Only a manager or partner can change a client's fees." };
  if (str(cs.EndedOn)) return { error: "This fee has ended. Restart it first." };
  const bad = adjustFeeProblems(a); if (bad.length) return { error: bad[0] };
  const oneOff = !periodsPerYear(a.period);
  const patch: Row = { Fee: money2(a.fee), FeePeriod: a.period, OneOff: oneOff, AnnualFee: oneOff ? 0 : money2(a.fee * periodsPerYear(a.period)), VatTreatment: a.vat, EffectiveFrom: a.effectiveFrom, NextReview: oneOff ? "" : a.nextReview, DiscountNote: a.discount ? JSON.stringify(a.discount) : "", ListFee: num(cs.ListFee) || money2(a.fee) };
  const before = snap(cs); const after = snap({ ...cs, ...patch });
  return withAnnualTotal({
    patches: [{ list: "ClientServices", row: cs, patch }], creates: [{ list: "FeeHistory", row: historyRow(o, str(client.Key), str(cs.ServiceKey), "adjusted", before, after, a.reason.trim(), "Manual") }], log: [],
    activities: [feeActivity(o, client, "Fee changed", `${str(cs.ServiceKey)}: £${before.fee} ${before.period || "one-off"} to £${after.fee} ${after.period || "one-off"}. ${a.reason.trim()}`)],
  }, client, schedule);
}
/** Stop charging for a service from a date (the client left it). The line stays in the schedule as ended. */
export function endFee(cs: Row, client: Row, on: string, reason: string, can: (x: ProposalAction) => boolean, o: Ctx, schedule?: Row[]): Written | { error: string } {
  if (!can("send")) return { error: "Only a manager or partner can change a client's fees." };
  if (!isDate(on)) return { error: "Give the date it ends." };
  if (!reason.trim()) return { error: "Say why." };
  if (str(cs.EndedOn)) return { error: "Already ended." };
  const before = snap(cs);
  return withAnnualTotal({ patches: [{ list: "ClientServices", row: cs, patch: { EndedOn: on, Off: true, OffSince: on } }], creates: [{ list: "FeeHistory", row: historyRow(o, str(client.Key), str(cs.ServiceKey), "ended", before, { ...before, ended: on }, reason.trim(), "Manual") }], log: [], activities: [feeActivity(o, client, "Fee ended", `${str(cs.ServiceKey)} from ${on}. ${reason.trim()}`)] }, client, schedule);
}
export function restartFee(cs: Row, client: Row, on: string, reason: string, can: (x: ProposalAction) => boolean, o: Ctx, schedule?: Row[]): Written | { error: string } {
  if (!can("send")) return { error: "Only a manager or partner can change a client's fees." };
  if (!str(cs.EndedOn)) return { error: "It hasn't ended." };
  if (!isDate(on)) return { error: "Give the date it restarts." };
  if (!reason.trim()) return { error: "Say why." };
  const before = snap(cs);
  return withAnnualTotal({ patches: [{ list: "ClientServices", row: cs, patch: { EndedOn: "", Off: false, OffSince: "", EffectiveFrom: on } }], creates: [{ list: "FeeHistory", row: historyRow(o, str(client.Key), str(cs.ServiceKey), "restarted", before, { ...before, ended: "", effectiveFrom: on }, reason.trim(), "Manual") }], log: [], activities: [feeActivity(o, client, "Fee restarted", `${str(cs.ServiceKey)} from ${on}. ${reason.trim()}`)] }, client, schedule);
}
/** Record that the fee was looked at and stays as it is: moves the next review date on. */
export function reviewFee(cs: Row, client: Row, nextReview: string, note: string, can: (x: ProposalAction) => boolean, o: Ctx): Written | { error: string } {
  if (!can("send")) return { error: "Only a manager or partner can review fees." };
  if (!isDate(nextReview)) return { error: "Give the next review date." };
  const before = snap(cs);
  return { patches: [{ list: "ClientServices", row: cs, patch: { NextReview: nextReview } }], creates: [{ list: "FeeHistory", row: historyRow(o, str(client.Key), str(cs.ServiceKey), "reviewed", before, { ...before, nextReview }, note.trim() || "Reviewed: no change", "Manual") }], log: [], activities: [] };
}

export type ChargeInput = { label: string; amount: number; vat: string; agreedOn: string; serviceKey?: string; notes?: string };
export function addCharge(client: Row, c: ChargeInput, can: (x: ProposalAction) => boolean, o: Ctx): Written | { error: string } {
  if (!can("send")) return { error: "Only a manager or partner can add a charge." };
  if (!c.label.trim()) return { error: "Say what the charge is for." };
  if (!(c.amount > 0)) return { error: "The amount has to be more than zero." };
  if (!isDate(c.agreedOn)) return { error: "Give the date it was agreed." };
  const row: Row = { Key: o.newKey("FC"), PracticeId: o.pid, ClientKey: str(client.Key), ServiceKey: c.serviceKey || "", Label: c.label.trim(), Amount: money2(c.amount), Vat: c.vat, AgreedOn: c.agreedOn, Status: "agreed", ProposalKey: "", Notes: c.notes || "", Created: o.now, CreatedBy: o.actor };
  return { patches: [], creates: [{ list: "FeeCharges", row }, { list: "FeeHistory", row: historyRow(o, str(client.Key), c.serviceKey || "", "charge-added", null, { label: row.Label, amount: row.Amount }, c.notes || "Added by hand", "Manual") }], log: [], activities: [feeActivity(o, client, "Charge agreed", `${row.Label}: £${row.Amount}`)] };
}
export function cancelCharge(charge: Row, client: Row, reason: string, can: (x: ProposalAction) => boolean, o: Ctx): Written | { error: string } {
  if (!can("send")) return { error: "Only a manager or partner can cancel a charge." };
  if (!reason.trim()) return { error: "Say why." };
  if (str(charge.Status) === "cancelled") return { error: "Already cancelled." };
  return { patches: [{ list: "FeeCharges", row: charge, patch: { Status: "cancelled" } }], creates: [{ list: "FeeHistory", row: historyRow(o, str(client.Key), str(charge.ServiceKey), "charge-cancelled", { label: charge.Label, amount: charge.Amount }, null, reason.trim(), "Manual") }], log: [], activities: [] };
}

// ------------------------------------------------------------------ direct costs

export type CostKind = "outsourcing" | "software" | "other" | "internal";
export const COST_KINDS: [CostKind, string][] = [["outsourcing", "Outsourcing"], ["software", "Client-specific software"], ["other", "Other direct cost"], ["internal", "Estimated internal cost"]];
export const costKindLabel = (k: string) => COST_KINDS.find(([x]) => x === k)?.[1] || "Other direct cost";
export type Cost = { key: string; clientKey: string; kind: CostKind; label: string; amount: number; period: string; estimate: boolean; active: boolean; notes: string; annual: number; oneOff: boolean };
export function readCost(r: Row): Cost {
  const kind = (COST_KINDS.some(([k]) => k === str(r.Kind)) ? str(r.Kind) : "other") as CostKind;
  const period = str(r.Period); const per = periodsPerYear(period); const amount = num(r.Amount);
  return { key: str(r.Key), clientKey: str(r.ClientKey), kind, label: str(r.Label), amount, period, estimate: kind === "internal" || truthy(r.Estimate), active: r.Active === undefined || r.Active === "" ? true : truthy(r.Active), notes: str(r.Notes), annual: per ? money2(amount * per) : 0, oneOff: !per };
}
export type CostInput = { kind: CostKind; label: string; amount: number; period: string; notes?: string };
export function addCost(client: Row, c: CostInput, can: (x: ProposalAction) => boolean, o: Ctx): Written | { error: string } {
  if (!can("send")) return { error: "Only a manager or partner can enter costs." };
  if (!COST_KINDS.some(([k]) => k === c.kind)) return { error: "Choose the kind of cost." };
  if (!c.label.trim()) return { error: "Say what the cost is." };
  if (!(c.amount > 0)) return { error: "The amount has to be more than zero." };
  const row: Row = { Key: o.newKey("CC"), PracticeId: o.pid, ClientKey: str(client.Key), Kind: c.kind, Label: c.label.trim(), Amount: money2(c.amount), Period: c.period, Estimate: c.kind === "internal", Active: true, Notes: c.notes || "", Created: o.now, CreatedBy: o.actor, Updated: o.now };
  return { patches: [], creates: [{ list: "ClientCosts", row }], log: [], activities: [] };
}
export function stopCost(cost: Row, can: (x: ProposalAction) => boolean, o: Ctx): Written | { error: string } {
  if (!can("send")) return { error: "Only a manager or partner can change costs." };
  return { patches: [{ list: "ClientCosts", row: cost, patch: { Active: false, Updated: o.now } }], log: [], activities: [] };
}

export type Contribution = { revenue: number; costs: number; internal: number; contribution: number; complete: "none" | "partial"; costCount: number; hasInternal: boolean; oneOffCosts: number; label: string };
/** Recurring fees less recurring direct costs a year. Costs are only what has been typed in, so this is never full profitability. */
export function contribution(fees: FeeLine[], costs: Cost[]): Contribution {
  const revenue = money2(fees.filter((f) => f.status === "active").reduce((a, f) => a + f.annual, 0));
  const live = costs.filter((c) => c.active);
  const direct = money2(live.filter((c) => !c.estimate).reduce((a, c) => a + c.annual, 0));
  const internal = money2(live.filter((c) => c.estimate).reduce((a, c) => a + c.annual, 0));
  const oneOffCosts = money2(live.filter((c) => c.oneOff).reduce((a, c) => a + c.amount, 0));
  const hasInternal = live.some((c) => c.estimate);
  const label = !live.length ? "No costs entered, so this is just the fees: it is not a contribution figure." : `Estimated contribution from the ${live.length} cost${live.length === 1 ? "" : "s"} entered${hasInternal ? " (including an estimated internal cost)" : ""}. Time isn't recorded, so this is not full client profitability.`;
  return { revenue, costs: direct, internal, contribution: money2(revenue - direct - internal), complete: live.length ? "partial" : "none", costCount: live.length, hasInternal, oneOffCosts, label };
}

// ------------------------------------------------------------------ revenue overview

export type Revenue = {
  mrr: number; arr: number; oneOff: number; total: number; heldArr: number; includedCount: number;
  byService: { serviceKey: string; arr: number; oneOff: number; clients: number }[];
  byClient: { clientKey: string; arr: number; oneOff: number; contribution?: Contribution }[];
};
/** The practice's CONTRACTED revenue. Held services are counted apart so work that isn't running isn't mistaken for income. */
export function revenue(schedule: Row[], charges: Row[], costs: Row[] = []): Revenue {
  const lines = schedule.map(readFeeLine);
  const rec = lines.filter((l) => l.status === "active" && !l.oneOff);
  const held = lines.filter((l) => l.status === "held" && !l.oneOff);
  const oneOffLines = lines.filter((l) => (l.status === "active" || l.status === "held") && l.oneOff && l.fee > 0);
  const cs = charges.map(readCharge).filter((c) => c.status === "agreed");
  const arr = money2(rec.reduce((a, l) => a + l.annual, 0));
  const oneOff = money2(oneOffLines.reduce((a, l) => a + l.fee, 0) + cs.reduce((a, c) => a + c.amount, 0));
  const svc = new Map<string, { serviceKey: string; arr: number; oneOff: number; clients: Set<string> }>();
  const cli = new Map<string, { clientKey: string; arr: number; oneOff: number }>();
  const touch = (m: Map<string, any>, k: string, init: () => any) => { if (!m.has(k)) m.set(k, init()); return m.get(k); };
  for (const l of rec) { const s = touch(svc, l.serviceKey, () => ({ serviceKey: l.serviceKey, arr: 0, oneOff: 0, clients: new Set() })); s.arr += l.annual; s.clients.add(l.clientKey); const c = touch(cli, l.clientKey, () => ({ clientKey: l.clientKey, arr: 0, oneOff: 0 })); c.arr += l.annual; }
  for (const l of oneOffLines) { const s = touch(svc, l.serviceKey, () => ({ serviceKey: l.serviceKey, arr: 0, oneOff: 0, clients: new Set() })); s.oneOff += l.fee; s.clients.add(l.clientKey); const c = touch(cli, l.clientKey, () => ({ clientKey: l.clientKey, arr: 0, oneOff: 0 })); c.oneOff += l.fee; }
  for (const c of cs) { const s = touch(svc, c.serviceKey || "(no service)", () => ({ serviceKey: c.serviceKey || "(no service)", arr: 0, oneOff: 0, clients: new Set() })); s.oneOff += c.amount; s.clients.add(c.clientKey); const k = touch(cli, c.clientKey, () => ({ clientKey: c.clientKey, arr: 0, oneOff: 0 })); k.oneOff += c.amount; }
  const costRows = costs.map(readCost);
  const byClient = [...cli.values()].map((c) => ({ ...c, arr: money2(c.arr), oneOff: money2(c.oneOff), contribution: costRows.some((x) => x.clientKey === c.clientKey) ? contribution(lines.filter((l) => l.clientKey === c.clientKey), costRows.filter((x) => x.clientKey === c.clientKey)) : undefined })).sort((a, b) => b.arr + b.oneOff - (a.arr + a.oneOff));
  return {
    mrr: money2(arr / 12), arr, oneOff, total: money2(arr + oneOff), heldArr: money2(held.reduce((a, l) => a + l.annual, 0)), includedCount: lines.filter((l) => l.status === "included").length,
    byService: [...svc.values()].map((s) => ({ serviceKey: s.serviceKey, arr: money2(s.arr), oneOff: money2(s.oneOff), clients: s.clients.size })).sort((a, b) => b.arr + b.oneOff - (a.arr + a.oneOff)),
    byClient,
  };
}

/** Fee lines whose review date has come or is within `days`. */
export function feeReviewsDue(schedule: Row[], today: string, days = 30): FeeLine[] {
  const end = new Date(Date.parse(today + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);
  return schedule.map(readFeeLine).filter((l) => l.status === "active" && l.nextReview && l.nextReview <= end).sort((a, b) => a.nextReview.localeCompare(b.nextReview));
}
