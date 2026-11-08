// A client's AML timeline: every dated check (identity, owners, screening...) recorded in any of their reviews or at onboarding,
// plus the reviews themselves, newest first. Dates on checks are editable in the review, so history from another system can be
// entered with its real date. Nothing here is stored separately: it is read from the reviews, so the review stays the one record.
import { asStatus, readAssessment } from "./amlAssessment";
import { readAml } from "./onboarding";
import { Row } from "./schema";

export type TimelineEntry = { date: string; type: "check" | "review"; title: string; result: string; note: string; by: string; where: string };
const str = (v: unknown): string => (v === undefined || v === null ? "" : String(v));

export function timeline(clientKey: string, assessments: Row[], onboardings: Row[]): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  for (const r of assessments) {
    if (r.ClientKey !== clientKey) continue;
    const a = readAssessment(r);
    const st = asStatus(r.Status);
    const where = st === "inprogress" ? "Review in progress" : "Review";
    for (const c of a.checks) out.push({ date: str(c.at).slice(0, 10), type: "check", title: c.kind, result: c.result, note: c.note, by: c.by, where });
    if (a.doneOn) out.push({ date: a.doneOn, type: "review", title: `Review approved (${a.risk || "no"} risk)`, result: "pass", note: a.approvedBy ? `Approved by ${a.approvedBy}` : "", by: a.approvedBy, where: "Review" });
    else if (st === "declined") out.push({ date: str(r.Updated).slice(0, 10), type: "review", title: "Review not approved", result: "fail", note: a.declinedReason, by: "", where: "Review" });
  }
  for (const o of onboardings) {
    if (o.ClientKey !== clientKey) continue;
    const a = readAml(o.Aml);
    for (const c of a.checks) out.push({ date: str(c.at).slice(0, 10), type: "check", title: c.kind, result: c.result, note: c.note, by: c.by, where: "Onboarding" });
  }
  return out.sort((x, y) => y.date.localeCompare(x.date));
}

/** The latest passed identity check, for the tracker. */
export function idCheckedOn(clientKey: string, assessments: Row[], onboardings: Row[]): string {
  return timeline(clientKey, assessments, onboardings).find((e) => e.type === "check" && e.result === "pass" && /identity/i.test(e.title))?.date || "";
}
