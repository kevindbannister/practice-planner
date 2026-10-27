// A client's own AML risk assessment: risk rating and what it rests on, beneficial owners, the
// checks a person has done, evidence filed, who approved it and when it is next due. It is kept
// apart from onboarding so existing clients can have one and be re-reviewed; an approved onboarding
// AML record counts too. Same rules as onboarding (amlProblems, independent approval).
import { Aml, Check, Owner, OnboardingSettings, Risk, amlProblems, readAml } from "./onboarding";
import { addMonths } from "./planning";
import { ClientType, ProposalAction, clientTypeFor } from "./proposals";
import { Row } from "./schema";
import { Ctx, Written, activityRow, logRow } from "./sales";

const str = (v: unknown): string => (v === undefined || v === null ? "" : String(v));
const json = <T,>(v: unknown, fallback: T): T => { try { const x = JSON.parse(str(v) || ""); return x ?? fallback; } catch { return fallback; } };

export type Evidence = { id: string; name: string; url: string; at: string; by: string; note: string };
export type Assessment = Aml & { evidence: Evidence[]; doneOn: string; source: string };
export type AssessmentStatus = "inprogress" | "approved" | "declined" | "superseded";
export const asStatus = (v: unknown): AssessmentStatus => (v === "approved" || v === "declined" || v === "superseded" ? v : "inprogress");

export function readAssessment(r: Row): Assessment {
  const st = asStatus(r.Status);
  return {
    status: st === "inprogress" ? "inprogress" : st === "superseded" ? "approved" : st, risk: (["low", "medium", "high"].includes(str(r.Risk)) ? str(r.Risk) : "") as Risk, riskBasis: str(r.RiskBasis),
    owners: json<Owner[]>(r.Owners, []), noOwnerNote: str(r.NoOwnerNote), checks: json<Check[]>(r.Checks, []), preparedBy: str(r.PreparedBy), approvedBy: str(r.ApprovedBy), approvedAt: str(r.ApprovedAt),
    reviewDate: str(r.ReviewDate), declinedReason: str(r.DeclinedReason), evidence: json<Evidence[]>(r.Evidence, []), doneOn: str(r.DoneOn), source: str(r.Source) || "manual",
  };
}

export function startAssessment(client: Row, rows: Row[], o: Ctx): Written | { error: string } {
  const mine = rows.filter((r) => r.ClientKey === client.Key);
  if (mine.some((r) => asStatus(r.Status) === "inprogress")) return { error: "There is already an assessment in progress." };
  const prev = mine.filter((r) => ["approved", "superseded"].includes(asStatus(r.Status))).sort((a, b) => str(b.ApprovedAt).localeCompare(str(a.ApprovedAt)))[0];
  const p = prev ? readAssessment(prev) : undefined;
  const row: Row = {
    Key: o.newKey("AML"), PracticeId: o.pid, ClientKey: str(client.Key), Status: "inprogress", Risk: p?.risk || "", RiskBasis: p?.riskBasis || "", Owners: JSON.stringify(p?.owners || []), NoOwnerNote: p?.noOwnerNote || "",
    Checks: "[]", Evidence: "[]", PreparedBy: "", Source: prev ? "review" : "manual", Created: o.now, CreatedBy: o.actor, Updated: o.now,
  };
  return { patches: [], creates: [{ list: "AmlAssessments", row }], log: [logRow(o, "aml-started", "aml", str(row.Key), { clientKey: str(client.Key) }, { review: !!prev })], activities: [] };
}

export type Edit = { risk?: Risk; riskBasis?: string; owners?: Owner[]; noOwnerNote?: string; checks?: Check[]; evidence?: Evidence[]; notes?: string };
export function saveAssessment(row: Row, edit: Edit, can: (a: ProposalAction) => boolean, o: Ctx): Written | { error: string } {
  if (!can("edit")) return { error: "You can't change AML records." };
  if (asStatus(row.Status) !== "inprogress" && asStatus(row.Status) !== "declined") return { error: "This assessment has been approved. Start a new review to change it." };
  const cur = readAssessment(row);
  const checks = (edit.checks ?? cur.checks).map((c) => ({ ...c, id: c.id || o.newKey("CK"), by: c.by || o.actor, at: c.at || o.now }));
  const patch: Row = {
    Status: "inprogress", Risk: edit.risk ?? cur.risk, RiskBasis: edit.riskBasis ?? cur.riskBasis, Owners: JSON.stringify(edit.owners ?? cur.owners), NoOwnerNote: edit.noOwnerNote ?? cur.noOwnerNote,
    Checks: JSON.stringify(checks), Evidence: JSON.stringify(edit.evidence ?? cur.evidence), PreparedBy: o.actor, DeclinedReason: "", Updated: o.now, ...(edit.notes !== undefined ? { Notes: edit.notes } : {}),
  };
  return { patches: [{ list: "AmlAssessments", row, patch }], log: [logRow(o, "aml-saved", "aml", str(row.Key), { clientKey: str(row.ClientKey) }, { risk: patch.Risk, checks: checks.length })], activities: [] };
}

export function approveAssessment(row: Row, client: Row, all: Row[], settings: OnboardingSettings, independent: boolean, can: (a: ProposalAction) => boolean, today: string, o: Ctx): Written | { error: string } {
  if (!can("approve")) return { error: "You can't approve AML work." };
  if (asStatus(row.Status) !== "inprogress") return { error: "Only an assessment in progress can be approved." };
  const a = readAssessment(row);
  if (independent && a.preparedBy && a.preparedBy === o.actor) return { error: "Someone else has to approve AML work you prepared." };
  const type: ClientType = clientTypeFor(str(client.Kind));
  const bad = amlProblems(a, type);
  if (bad.length) return { error: bad[0] };
  const review = addMonths(today, settings.amlMonths[a.risk as "low"], false);
  const older = all.filter((r) => r.ClientKey === row.ClientKey && r.Key !== row.Key && asStatus(r.Status) === "approved");
  return {
    patches: [
      { list: "AmlAssessments", row, patch: { Status: "approved", ApprovedBy: o.actor, ApprovedAt: o.now, DoneOn: today, ReviewDate: review, Updated: o.now } },
      ...older.map((r) => ({ list: "AmlAssessments" as const, row: r, patch: { Status: "superseded", Updated: o.now } })),
      { list: "Clients", row: client, patch: { AMLReview: review } },
    ],
    log: [logRow(o, "aml-approved", "aml", str(row.Key), { clientKey: str(row.ClientKey) }, { risk: a.risk, review })],
    activities: [activityRow(o, "aml-approved", `AML assessment approved (${a.risk} risk): ${str(client.Title)}`, undefined, { clientKey: str(row.ClientKey) }, `Next review ${review}`)],
  };
}

export function declineAssessment(row: Row, reason: string, can: (a: ProposalAction) => boolean, o: Ctx): Written | { error: string } {
  if (!can("approve")) return { error: "You can't decide AML work." };
  if (!reason.trim()) return { error: "Say why." };
  if (asStatus(row.Status) !== "inprogress") return { error: "Only an assessment in progress can be declined." };
  return { patches: [{ list: "AmlAssessments", row, patch: { Status: "declined", DeclinedReason: reason.trim(), Updated: o.now } }], log: [logRow(o, "aml-declined", "aml", str(row.Key), { clientKey: str(row.ClientKey) }, { reason: reason.trim() })], activities: [] };
}

export function withdrawAssessment(row: Row, reason: string, client: Row, can: (a: ProposalAction) => boolean, o: Ctx): Written | { error: string } {
  if (!can("approve")) return { error: "You can't change AML approvals." };
  if (!reason.trim()) return { error: "Say why." };
  const st = asStatus(row.Status);
  if (st !== "approved" && st !== "declined") return { error: "Nothing to withdraw." };
  return {
    patches: [{ list: "AmlAssessments", row, patch: { Status: "inprogress", ApprovedBy: "", ApprovedAt: "", DoneOn: "", ReviewDate: "", DeclinedReason: "", Updated: o.now } }, ...(st === "approved" ? [{ list: "Clients" as const, row: client, patch: { AMLReview: "" } }] : [])],
    log: [logRow(o, "aml-withdrawn", "aml", str(row.Key), { clientKey: str(row.ClientKey) }, { reason: reason.trim() })], activities: [],
  };
}

// ------------------------------------------------------------------ where a client stands

export type Position = {
  state: "none" | "inprogress" | "declined" | "current" | "soon" | "overdue";
  risk: Risk; doneOn: string; reviewDate: string; daysToReview: number | null; source: string; by: string; row?: Row; current?: Row; checks: number; evidence: number;
};
export const SOON_DAYS = 60;
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

/** The approved assessment that counts now (the latest from assessments and onboarding), or the one being worked on. */
export function position(client: Row, rows: Row[], onboardings: Row[], today: string): Position {
  const key = str(client.Key);
  const mine = rows.filter((r) => r.ClientKey === key);
  const approved: { at: string; risk: Risk; review: string; done: string; source: string; by: string; row?: Row; checks: number; evidence: number }[] = [];
  for (const r of mine.filter((x) => ["approved", "superseded"].includes(asStatus(x.Status)))) { const a = readAssessment(r); if (asStatus(r.Status) === "approved") approved.push({ at: a.approvedAt, risk: a.risk, review: a.reviewDate, done: a.doneOn, source: "assessment", by: a.approvedBy, row: r, checks: a.checks.length, evidence: a.evidence.length }); }
  for (const o of onboardings.filter((x) => x.ClientKey === key)) { const a = readAml(o.Aml); if (a.status === "approved") approved.push({ at: a.approvedAt, risk: a.risk, review: a.reviewDate, done: a.approvedAt.slice(0, 10), source: "onboarding", by: a.approvedBy, checks: a.checks.length, evidence: 0 }); }
  approved.sort((a, b) => b.at.localeCompare(a.at));
  const cur = approved[0];
  const open = mine.filter((r) => ["inprogress", "declined"].includes(asStatus(r.Status))).sort((a, b) => str(b.Created).localeCompare(str(a.Created)))[0];
  if (cur) {
    const review = cur.review || str(client.AMLReview);
    const d = review ? days(today, review) : null;
    return { state: d !== null && d < 0 ? "overdue" : d !== null && d <= SOON_DAYS ? "soon" : "current", risk: cur.risk, doneOn: cur.done, reviewDate: review, daysToReview: d, source: cur.source, by: cur.by, row: open, current: cur.row, checks: cur.checks, evidence: cur.evidence };
  }
  if (open) { const a = readAssessment(open); return { state: asStatus(open.Status) === "declined" ? "declined" : "inprogress", risk: a.risk, doneOn: "", reviewDate: "", daysToReview: null, source: "assessment", by: a.preparedBy, row: open, checks: a.checks.length, evidence: a.evidence.length }; }
  const rd = str(client.AMLReview);
  if (rd) { const d = days(today, rd); return { state: d < 0 ? "overdue" : d <= SOON_DAYS ? "soon" : "current", risk: "", doneOn: "", reviewDate: rd, daysToReview: d, source: "client record", by: "", checks: 0, evidence: 0 }; }
  return { state: "none", risk: "", doneOn: "", reviewDate: "", daysToReview: null, source: "", by: "", checks: 0, evidence: 0 };
}

export const POSITION_LABEL: Record<Position["state"], string> = { none: "No assessment", inprogress: "In progress", declined: "Not approved", current: "Up to date", soon: "Review due soon", overdue: "Review overdue" };
export const POSITION_CHIP: Record<Position["state"], string> = { none: "red", inprogress: "amber", declined: "red", current: "green", soon: "amber", overdue: "red" };
