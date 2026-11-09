// A short review: the periodic (or event-driven) look at a client that doesn't redo the whole assessment. The reviewer answers a few
// questions against the current approved assessment. If every answer is Yes the review is recorded on that assessment and the next review
// date moves on. If any answer is No, the short review is recorded as having found something and a full assessment is opened.
// Recorded on the approved assessment row (column ShortReviews), so the assessment stays the one record of the client's AML.
import { asStatus, readAssessment, startAssessment } from "./amlAssessment";
import { OnboardingSettings } from "./onboarding";
import { addMonths } from "./planning";
import { ProposalAction } from "./proposals";
import { Row } from "./schema";
import { Ctx, Written, logRow } from "./sales";

const str = (v: unknown): string => (v === undefined || v === null ? "" : String(v));
export type ShortReview = { id: string; date: string; by: string; at: string; answers: Record<string, boolean>; notes: string; outcome: "complete" | "escalated"; next: string };
export type ShortQ = { k: string; label: string; help?: string };

export function readShortReviews(r: Row | undefined): ShortReview[] {
  try { const v = JSON.parse(str(r?.ShortReviews) || "[]"); return Array.isArray(v) ? (v as ShortReview[]) : []; } catch { return []; }
}

/** The questions, worded against this client's current assessment. `changes` adds the question about changes seen since it was approved. */
export function shortQuestions(doneOn: string, risk: string, changes: boolean): ShortQ[] {
  const qs: ShortQ[] = [
    { k: "behaved", label: "Has the client behaved as expected since the last assessment?", help: "Nothing unusual in the work, the way they pay or the information they give." },
    { k: "valid", label: `Is the risk assessment done${doneOn ? ` on ${doneOn}` : ""} still valid?` },
    { k: "info", label: "Is the identity and ownership information we hold still correct?", help: "Directors, owners, persons with significant control, address, and who instructs us." },
    { k: "rating", label: `Is the ${risk || "current"} risk rating still right?` },
  ];
  if (changes) qs.push({ k: "changes", label: "Have the changes since the last assessment been checked and recorded?", help: "A new director is added to company secretarial. Anyone who now owns or controls the client, or who will instruct us for it, is identified and their identity verified. If a change may affect the rating, answer No." });
  return qs;
}

export function completeShortReview(client: Row, cur: Row | undefined, rows: Row[], input: { date: string; answers: Record<string, boolean | undefined>; notes: string; changes: boolean }, settings: OnboardingSettings, independent: boolean, can: (a: ProposalAction) => boolean, today: string, o: Ctx): Written | { error: string } {
  if (!can(independent ? "approve" : "edit")) return { error: independent ? "Someone with approval rights has to complete AML reviews." : "You can't change AML records." };
  if (!cur || asStatus(cur.Status) !== "approved") return { error: "A short review needs a current approved assessment. Start a full assessment instead." };
  if (rows.some((r) => r.ClientKey === client.Key && asStatus(r.Status) === "inprogress")) return { error: "There is already an assessment in progress." };
  const a = readAssessment(cur);
  const qs = shortQuestions(a.doneOn, a.risk, input.changes);
  if (qs.some((q) => typeof input.answers[q.k] !== "boolean")) return { error: "Answer every question Yes or No." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || input.date > today) return { error: "Give the date of the review (not in the future)." };
  const failed = qs.filter((q) => input.answers[q.k] === false);
  const answers = Object.fromEntries(qs.map((q) => [q.k, input.answers[q.k] === true]));
  const entry: ShortReview = { id: o.newKey("SR"), date: input.date, by: o.actor, at: o.now, answers, notes: input.notes.trim(), outcome: failed.length ? "escalated" : "complete", next: "" };
  const history = [...readShortReviews(cur), entry];
  if (!failed.length) {
    const next = addMonths(input.date, settings.amlMonths[a.risk as "low"], false);
    entry.next = next;
    return {
      patches: [{ list: "AmlAssessments", row: cur, patch: { ShortReviews: JSON.stringify(history), ReviewDate: next, Updated: o.now } }, { list: "Clients", row: client, patch: { AMLReview: next } }],
      log: [logRow(o, "aml-short-review", "aml", str(cur.Key), { clientKey: str(client.Key) }, { next })], activities: [],
    };
  }
  const w = startAssessment(client, rows, o, "change");
  if ("error" in w) return w;
  const row = w.creates![0].row;
  row.Notes = [`Short review on ${input.date} found: ${failed.map((q) => q.label).join(" ")}`, input.notes.trim()].filter(Boolean).join("\n");
  return {
    patches: [{ list: "AmlAssessments", row: cur, patch: { ShortReviews: JSON.stringify(history), Updated: o.now } }], creates: w.creates,
    log: [logRow(o, "aml-short-review", "aml", str(cur.Key), { clientKey: str(client.Key) }, { escalated: failed.length })], activities: [],
  };
}

// ------------------------------------------------------------------ what the planner already knows, shown beside each question

import { LEVEL_LABEL, evaluate, templateFor } from "./amlTemplate";
import { CosecOwnership } from "./amlCosec";
import { Seen } from "./amlReview";
import { clientTypeFor } from "./proposals";
import { amlStampRead, idStampRead } from "./xamaActions";

export type FactsIn = { client: Row; cur: Row; seen: Seen[]; co?: CosecOwnership; services: string[]; open: Row[]; today: string; fmt: (d: string) => string };
/** For each short-review question, the facts the planner already holds that bear on it. Nothing is guessed: a line only appears when there is data behind it. */
export function shortFacts(f: FactsIn): Record<string, string[]> {
  const a = readAssessment(f.cur);
  const out: Record<string, string[]> = { behaved: [], valid: [], info: [], rating: [], changes: [] };
  const named = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  // behaved
  const checks = a.checks.filter((c) => c.at);
  const screen = checks.filter((c) => /sanction|pep|screen|adverse/i.test(c.kind)).sort((x, y) => String(y.at).localeCompare(String(x.at)))[0];
  if (screen) out.behaved.push(`Last screening check: ${screen.kind}, ${screen.result === "pass" ? "passed" : screen.result === "fail" ? "failed" : "pending"} on ${f.fmt(String(screen.at).slice(0, 10))}.`);
  else if (amlStampRead(f.client.XamaAmlCheck).state === "done") out.behaved.push(`Xama AML check (identity, PEP and sanctions) on ${f.fmt(amlStampRead(f.client.XamaAmlCheck).on)}: no matches.`);
  else if (amlStampRead(f.client.XamaAmlCheck).state === "check") out.behaved.push(`Xama AML check on ${f.fmt(amlStampRead(f.client.XamaAmlCheck).on)} found possible matches: review them in Xama.`);
  else out.behaved.push("No screening check is recorded on the assessment.");
  if (f.services.length) out.behaved.push(`Services now: ${f.services.join(", ")}.`);
  const trig = f.open.filter((r) => String(r.Source).startsWith("trigger:")).length;
  if (trig) out.behaved.push("A review has been triggered since: see the review in progress.");
  // valid
  out.valid.push(`Approved ${a.approvedAt ? f.fmt(a.approvedAt.slice(0, 10)) : "—"}${a.approvedBy ? ` by ${a.approvedBy}` : ""}; ${named(a.owners.length, "owner")} recorded, ${named(a.checks.length, "check")}, ${named(a.evidence.length, "file")} filed.`);
  if (a.reviewDate) out.valid.push(`Next review was due ${f.fmt(a.reviewDate)}.`);
  const total = templateFor(clientTypeFor(String(f.client.Kind)));
  const miss = evaluate(total, a.answers).missing.length;
  if (Object.keys(a.answers).length === 0) out.valid.push("The risk assessment questions weren't answered on this assessment.");
  else if (miss) out.valid.push(`${named(miss, "risk assessment question")} on it weren't answered.`);
  // info
  const x = idStampRead(f.client.XamaIdCheck);
  if (x.state === "done") out.info.push(`Xama ID check done${x.on ? ` on ${f.fmt(x.on)}` : ""}.`);
  else out.info.push("No Xama identity result on the client.");
  if (f.co?.hasData) {
    const dirs = f.co.people.filter((p) => p.roles.some((r) => /director/i.test(r))).length, pscs = f.co.people.filter((p) => p.psc).length;
    out.info.push(`Company secretarial: ${named(dirs, "director")}, ${named(pscs, "person")} with significant control.`);
    const pending = f.co.people.filter((p) => (p.psc || p.sharePercent !== null && p.sharePercent > 25) && p.id !== "verified" && p.id !== "exempt").map((p) => p.name);
    if (pending.length) out.info.push(`ID not yet verified for: ${pending.join(", ")}.`);
    for (const t of f.co.findings.slice(0, 3)) out.info.push(t);
    if (!f.co.findings.length) out.info.push("Company secretarial shows no ownership problems.");
  } else out.info.push("Nothing held in company secretarial for this client.");
  if (a.owners.length) out.info.push(`Owners on the assessment: ${a.owners.map((o) => `${o.name}${o.percent ? ` ${o.percent}%` : ""}`).join(", ")}.`);
  // rating
  out.rating.push(`Rated ${LEVEL_LABEL[a.risk] || a.risk || "not rated"}${a.riskBasis ? `: ${a.riskBasis}` : "."}`);
  for (const p of a.pep.status === "yes" ? a.pep.people.filter((x) => x.name.trim()) : []) out.rating.push(`PEP: ${p.name}${p.role ? ` (${p.role})` : ""}${p.left ? `, left office ${f.fmt(p.left)}` : ""}. Enhanced due diligence and closer monitoring still apply${p.left ? " for at least 12 months after leaving office" : ""}.`);
  const high = evaluate(total, a.answers);
  if (high.highest) out.rating.push(`Highest section rating on the assessment: ${LEVEL_LABEL[high.highest]}.`);
  // changes
  for (const s of f.seen) out.changes.push(`${f.fmt(s.at)}: ${s.label}. ${s.detail}`);
  return out;
}
