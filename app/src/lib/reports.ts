// Basic sales and onboarding reporting (Phase 5). Pure functions over the records already in the planner.
// Values are CONTRACTED fees worked out from what proposals agreed, before VAT. Nothing here is invoiced or collected money.
import { readAgreed } from "./engagements";
import { lineFee } from "./fees";
import { isLiveOnboarding, readAml, stageLines, blockers, View } from "./onboarding";
import { Opp, Lead, outcomeOf } from "./sales";
import { Row } from "./schema";

const str = (v: unknown): string => (v === undefined || v === null ? "" : String(v));
const day = (v: unknown) => str(v).slice(0, 10);
const days = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
const inRange = (d: string, from: string, to: string) => !!d && (!from || d >= from) && (!to || d <= to);
const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : undefined);
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : undefined);

export type SalesReport = {
  range: { from: string; to: string };
  funnel: { leads: number; opportunities: number; proposalsMade: number; proposalsSent: number; proposalsAccepted: number; onboardingStarted: number; activated: number };
  rates: { oppWon?: number; proposalAccepted?: number; leadToActivated?: number };
  opps: { won: number; lost: number; deferred: number; open: number; wonValue: number; lostValue: number; openValue: number };
  bySource: { source: string; leads: number; won: number; wonValue: number }[];
  lostReasons: { reason: string; count: number }[];
  acceptedValue: { recurring: number; oneOff: number };
  timing: { daysOppToAccepted?: number; daysAcceptedToActivated?: number };
};

/** Value of what a proposal agreed: annual recurring fees, and one-off (including set-up fees). */
export function agreedValue(version: Row | undefined): { recurring: number; oneOff: number } {
  const a = version ? readAgreed(version.Agreed) : undefined;
  let recurring = 0, oneOff = 0;
  for (const l of a?.lines || []) { const f = lineFee(l); recurring += f.annual; oneOff += (f.oneOff ? f.net : 0) + f.setup; }
  return { recurring: Math.round(recurring * 100) / 100, oneOff: Math.round(oneOff * 100) / 100 };
}

export function salesReport(i: { leads: Lead[]; opps: Opp[]; proposals: Row[]; versions: Row[]; onboardings: Row[]; from: string; to: string }): SalesReport {
  const { from, to } = i;
  const leads = i.leads.filter((l) => inRange(day(l.Created || l.Received), from, to));
  const opps = i.opps.filter((o) => inRange(day(o.Created), from, to));
  const props = i.proposals.filter((p) => inRange(day(p.Created), from, to));
  const vOf = (p: Row) => i.versions.find((v) => str(v.ProposalKey) === str(p.Key) && Number(v.Version) === Number(p.AcceptedVersion || p.CurrentVersion || v.Version));
  const sent = props.filter((p) => i.versions.some((v) => str(v.ProposalKey) === str(p.Key) && str(v.SentOn)));
  const accepted = props.filter((p) => str(p.Status) === "accepted");
  const rejected = props.filter((p) => str(p.Status) === "rejected");
  const onbs = i.onboardings.filter((o) => inRange(day(o.Created), from, to));
  const activated = onbs.filter((o) => str(o.Status) === "activated");
  const won = opps.filter((o) => outcomeOf(o) === "won"), lost = opps.filter((o) => outcomeOf(o) === "lost");
  const sum = (xs: Opp[]) => xs.reduce((a, o) => a + (Number(o.Value) || 0), 0);
  const sources = new Map<string, { source: string; leads: number; won: number; wonValue: number }>();
  for (const l of leads) { const k = str(l.Source) || "(not recorded)"; const e = sources.get(k) || { source: k, leads: 0, won: 0, wonValue: 0 }; e.leads++; sources.set(k, e); }
  for (const o of won) { const l = i.leads.find((x) => x.Key === o.LeadKey); const k = str(l?.Source) || "(not recorded)"; const e = sources.get(k) || { source: k, leads: 0, won: 0, wonValue: 0 }; e.won++; e.wonValue += Number(o.Value) || 0; sources.set(k, e); }
  const reasons = new Map<string, number>(); for (const o of lost) { const k = str(o.LostReason) || "(no reason recorded)"; reasons.set(k, (reasons.get(k) || 0) + 1); }
  const av = accepted.map((p) => agreedValue(vOf(p)));
  const oppToAcc = accepted.map((p) => { const o = i.opps.find((x) => x.Key === p.OppKey); const v = vOf(p); const a = day(v?.AcceptedAt); return o && a ? days(day(o.Created), a) : NaN; }).filter((n) => Number.isFinite(n) && n >= 0);
  const accToAct = activated.map((o) => { const v = i.versions.find((x) => str(x.ProposalKey) === str(o.ProposalKey) && Number(x.Version) === Number(o.ProposalVersion)); const a = day(v?.AcceptedAt); const d = day(o.ActivatedOn); return a && d ? days(a, d) : NaN; }).filter((n) => Number.isFinite(n) && n >= 0);
  return {
    range: { from, to },
    funnel: { leads: leads.length, opportunities: opps.length, proposalsMade: props.length, proposalsSent: sent.length, proposalsAccepted: accepted.length, onboardingStarted: onbs.length, activated: activated.length },
    rates: { oppWon: pct(won.length, won.length + lost.length), proposalAccepted: pct(accepted.length, accepted.length + rejected.length), leadToActivated: pct(activated.length, leads.length) },
    opps: { won: won.length, lost: lost.length, deferred: opps.filter((o) => outcomeOf(o) === "deferred").length, open: opps.filter((o) => outcomeOf(o) === "open").length, wonValue: sum(won), lostValue: sum(lost), openValue: sum(opps.filter((o) => outcomeOf(o) === "open")) },
    bySource: [...sources.values()].sort((a, b) => b.leads - a.leads || a.source.localeCompare(b.source)),
    lostReasons: [...reasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    acceptedValue: { recurring: Math.round(av.reduce((a, x) => a + x.recurring, 0) * 100) / 100, oneOff: Math.round(av.reduce((a, x) => a + x.oneOff, 0) * 100) / 100 },
    timing: { daysOppToAccepted: avg(oppToAcc), daysAcceptedToActivated: avg(accToAct) },
  };
}

export type OnboardingReport = {
  inProgress: number; blocked: number; awaitingApproval: number; readyToActivate: number; activated: number; cancelled: number; heldServices: number; avgDaysToActivate?: number;
  open: { key: string; ref: string; client: string; days: number; waitingOn: string; blocked: boolean }[];
  stageCounts: { key: string; label: string; waiting: number }[];
};
export function onboardingReport(i: { onboardings: Row[]; viewFor: (o: Row) => View | undefined; today: string; from?: string; to?: string }): OnboardingReport {
  const { from = "", to = "" } = i;
  const all = i.onboardings;
  const live = all.filter(isLiveOnboarding);
  const done = all.filter((o) => str(o.Status) === "activated" && inRange(day(o.ActivatedOn), from, to));
  const open: OnboardingReport["open"] = []; const waiting = new Map<string, { key: string; label: string; waiting: number }>();
  let blocked = 0, awaiting = 0, ready = 0;
  for (const o of live) {
    const v = i.viewFor(o); if (!v) continue;
    const lines = stageLines(v); const b = blockers(lines, { includeApproval: true });
    const isBlocked = lines.some((l) => l.status === "blocked" || (l.def.kind === "aml" && readAml(o.Aml).status === "declined"));
    if (isBlocked) blocked++;
    else if (!blockers(lines).length && !str(o.ApprovedBy)) awaiting++;
    else if (!b.length && str(o.ApprovedBy)) ready++;
    const first = lines.find((l) => l.applies && l.def.mandatory && l.status !== "done" && l.status !== "na" && l.def.kind !== "activation");
    if (first) { const e = waiting.get(first.def.key) || { key: first.def.key, label: first.def.label, waiting: 0 }; e.waiting++; waiting.set(first.def.key, e); }
    open.push({ key: str(o.Key), ref: str(o.Ref), client: str(v.client.Title), days: days(day(o.Created), i.today), waitingOn: b[0] || (str(o.ApprovedBy) ? "Ready to activate" : "Ready for approval"), blocked: isBlocked });
  }
  let held = 0; for (const o of all.filter((x) => str(x.Status) === "activated")) { try { held += (JSON.parse(str(o.ActivationSummary) || "{}").held || []).length; } catch { /* none */ } }
  return {
    inProgress: live.length, blocked, awaitingApproval: awaiting, readyToActivate: ready, activated: done.length, cancelled: all.filter((o) => str(o.Status) === "cancelled" && inRange(day(o.Updated), from, to)).length, heldServices: held,
    avgDaysToActivate: avg(done.map((o) => days(day(o.Created), day(o.ActivatedOn))).filter((n) => n >= 0)),
    open: open.sort((a, b) => b.days - a.days), stageCounts: [...waiting.values()].sort((a, b) => b.waiting - a.waiting),
  };
}

/** A simple CSV of the sales report, for a spreadsheet. */
export function reportCsv(r: SalesReport, o: OnboardingReport): string {
  const q = (v: unknown) => `"${str(v).replace(/"/g, '""')}"`;
  const rows: unknown[][] = [["Report", "Measure", "Value"], ["Period", "From", r.range.from || "all time"], ["Period", "To", r.range.to || "today"]];
  for (const [k, v] of Object.entries(r.funnel)) rows.push(["Funnel", k, v]);
  for (const [k, v] of Object.entries(r.opps)) rows.push(["Opportunities", k, v]);
  for (const [k, v] of Object.entries(r.rates)) rows.push(["Rates (%)", k, v ?? ""]);
  rows.push(["Accepted proposals (contracted, before VAT)", "recurring a year", r.acceptedValue.recurring], ["Accepted proposals (contracted, before VAT)", "one-off", r.acceptedValue.oneOff]);
  for (const s of r.bySource) rows.push(["Source", s.source, `${s.leads} leads, ${s.won} won, £${s.wonValue}`]);
  for (const l of r.lostReasons) rows.push(["Lost reason", l.reason, l.count]);
  rows.push(["Onboarding", "in progress", o.inProgress], ["Onboarding", "blocked", o.blocked], ["Onboarding", "awaiting approval", o.awaitingApproval], ["Onboarding", "ready to activate", o.readyToActivate], ["Onboarding", "activated", o.activated], ["Onboarding", "avg days to activate", o.avgDaysToActivate ?? ""]);
  return rows.map((r2) => r2.map(q).join(",")).join("\n");
}
