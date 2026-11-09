// Client review frequencies and review triggers, as the firm's own AML policy sets them. The policy builder (monitoring step) holds the
// answers; the rest of the app reads them from here so the dates on client records follow the policy. A trigger is something that happens
// between scheduled reviews and means a client must be looked at again now. Some are seen in the data (a change to directors, owners or
// persons with significant control; a new service); the rest are raised by a person. Raising one opens a review on the client with a due date.
// A suspicion is never recorded here: details of a suspicious activity report stay in the MLRO's restricted records.
import { Row } from "./schema";
import { Ctx, Written } from "./sales";
import { asStatus, readAssessment, startAssessment } from "./amlAssessment";
import { monthsOf, policyAnswers } from "./amlPolicy";

const str = (v: unknown): string => (v === undefined || v === null ? "" : String(v));

export type TriggerKind = { v: string; label: string; auto?: boolean };
/** Every kind of trigger the policy can choose from. `auto` ones are also seen in the data. */
export const TRIGGER_KINDS: TriggerKind[] = [
  { v: "identity", label: "A change in the client's identity" },
  { v: "owners", label: "A change in directors, owners or persons with significant control", auto: true },
  { v: "service", label: "A change in the service provided", auto: true },
  { v: "country", label: "The client becomes linked to a high-risk country" },
  { v: "inconsistent", label: "Information that doesn't fit what we know about the client" },
  { v: "unusual", label: "Unusual or unexplained activity" },
  { v: "adverse", label: "Adverse news, a sanctions alert or a PEP match" },
  { v: "bank", label: "A change to bank details or payment instructions" },
];
export const kindLabel = (v: string) => TRIGGER_KINDS.find((k) => k.v === v)?.label || v;

export type ReviewPolicy = { high: number; medium: number; low: number; triggers: string[]; triggerDays: number; own: string; fromPolicy: boolean };
export function readReviewPolicy(settings: Row[], fallback: { low: number; medium: number; high: number }): ReviewPolicy {
  const a = policyAnswers(settings);
  const hi = monthsOf(a.mHigh ?? a.high), md = monthsOf(a.mMed ?? a.medium), lo = monthsOf(a.mLow ?? a.low);
  const picked = Array.isArray(a.triggers) ? (a.triggers as unknown[]).map(str).filter((t) => TRIGGER_KINDS.some((k) => k.v === t)) : [];
  const days = Number(a.triggerDays);
  return {
    high: hi ?? fallback.high, medium: md ?? fallback.medium, low: lo ?? fallback.low,
    triggers: picked.length ? picked : TRIGGER_KINDS.map((k) => k.v), triggerDays: Number.isInteger(days) && days >= 1 && days <= 365 ? days : 14,
    own: str(a.triggerOwn), fromPolicy: !!(hi && md),
  };
}

// ------------------------------------------------------------------ a triggered review

export type Trigger = { kind: string; label: string; raised: string; due: string; reason: string };
const SRC = "trigger:";
export const isTriggerSource = (s: unknown) => str(s).startsWith(SRC);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** The trigger behind an open review, if that is why it was opened. */
export function triggerOf(open: Row | undefined): Trigger | undefined {
  if (!open || !isTriggerSource(open.Source)) return undefined;
  const [, kind, raised, due] = str(open.Source).split(":");
  return { kind: kind || "", label: kindLabel(kind || ""), raised: raised || "", due: due || "", reason: str(open.Notes) };
}

/** Open a review because something happened. If a review is already open it is marked as triggered rather than duplicated. */
export function raiseReview(client: Row, rows: Row[], kind: string, reason: string, days: number, today: string, can: (a: "edit") => boolean, o: Ctx): Written | { error: string } {
  if (!can("edit")) return { error: "You can't change AML records." };
  if (!TRIGGER_KINDS.some((k) => k.v === kind)) return { error: "Choose what happened." };
  const why = reason.trim();
  if (!why) return { error: "Say what happened, in a line. Don't record details of a suspicion here." };
  const source = `${SRC}${kind}:${today}:${addDays(today, days)}`;
  const note = `${kindLabel(kind)}: ${why}`;
  const open = rows.filter((r) => r.ClientKey === client.Key && asStatus(r.Status) === "inprogress")[0];
  if (open) {
    const already = isTriggerSource(open.Source);
    const notes = [str(open.Notes), note].filter(Boolean).join("\n");
    return { patches: [{ list: "AmlAssessments", row: open, patch: { Source: already ? str(open.Source) : source, Notes: notes, Updated: o.now } }], log: [], activities: [] };
  }
  const w = startAssessment(client, rows, o);
  if ("error" in w) return w;
  const row = w.creates![0].row;
  row.Source = source; row.Notes = note;
  return w;
}

// ------------------------------------------------------------------ triggers seen in the data

export type Seen = { kind: string; label: string; at: string; detail: string };
/** Changes since the client's last approved assessment that the policy says should prompt a review. Nothing is reported for a client with no approval to compare to. */
export function seenTriggers(client: Row, data: { amlAssessments: Row[]; onboardings: Row[]; cosecEvents: Row[]; clientServices: Row[] }, policy: ReviewPolicy, since: string): Seen[] {
  if (!since) return [];
  const out: Seen[] = [];
  const day = since.slice(0, 10);
  if (policy.triggers.includes("owners")) {
    // Only changes that alter who runs, owns or controls the company: appointments and resignations, name changes, a PSC's nature of control,
    // nationality or country of residence, and share allotments or transfers. Address, occupation and title changes don't trigger a review.
    const LABEL: Record<string, string> = { appoint: "appointed", terminate: "ended", First: "name changed", Last: "name changed", CorporateName: "name changed", Nationality: "nationality changed", CountryOfResidence: "country of residence changed", allotment: "shares allotted", transfer: "shares transferred" };
    for (const e of data.cosecEvents) {
      if (e.ClientKey !== client.Key || str(e.Outcome) === "duplicate" || str(e.At) <= since) continue;
      const ent = str(e.Entity), f = str(e.Field);
      const relevant = ent === "officer" || ent === "psc" ? !/Address$/.test(f) && f !== "Title" && f !== "Occupation" : f === "allotment" || f === "transfer";
      if (!relevant) continue;
      const who = ent === "psc" ? "Person with significant control" : ent === "officer" ? "Director or officer" : "Shares";
      out.push({ kind: "owners", label: kindLabel("owners"), at: str(e.At).slice(0, 10), detail: `${who}: ${LABEL[f] || f || "changed"}${str(e.After) && ent !== "share" ? ` (${str(e.After).slice(0, 60)})` : ""}` });
    }
  }
  if (policy.triggers.includes("service")) {
    for (const s of data.clientServices) {
      if (s.ClientKey !== client.Key || s.EndedOn || s.Off) continue;
      const from = str(s.EffectiveFrom);
      if (from && from > day) out.push({ kind: "service", label: kindLabel("service"), at: from, detail: `A service started on ${from}` });
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

/** When the client's current approval was given (from assessments or onboarding), for comparing events to. */
export function lastApprovedAt(client: Row, assessments: Row[], onboardings: Row[], readAml: (v: unknown) => { status: string; approvedAt: string }): string {
  const at: string[] = [];
  for (const r of assessments) if (r.ClientKey === client.Key && ["approved", "superseded"].includes(asStatus(r.Status))) { const a = readAssessment(r); if (a.approvedAt) at.push(a.approvedAt); }
  for (const o of onboardings) if (o.ClientKey === client.Key) { const a = readAml(o.Aml); if (a.status === "approved" && a.approvedAt) at.push(a.approvedAt); }
  return at.sort().reverse()[0] || "";
}
