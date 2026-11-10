// The electronic accounts filing journey as the screens and the Action Centre see it. Pure rules, no I/O.
// Nothing here sends anything. `canSubmit` is the single gate a future submit button must obey, and today it can never be true
// because the server reports the accounts message as unverified. A "filed" job only becomes complete when Companies House accepts.
import { Row } from "../schema";

export type AttemptStatus = "submitting" | "acknowledged" | "pending" | "accepted" | "rejected" | "failed" | "unknown";
export type Attempt = { key: string; attempt: number; status: AttemptStatus; test: boolean; at: string; detail?: string; history: { status: AttemptStatus; at: string }[] };
/** What the server says about electronic accounts filing. `null` means it could not be reached (older deployment). */
export type ServerInfo = { available: boolean; reason: string | null; test: boolean } | null;
export type FlowState = "manual" | "blocked" | "ready" | "submitting" | "acknowledged" | "pending" | "accepted" | "rejected" | "unknown";
export type FlowIn = { jobStatus: string; approvalStale: boolean; modelErrors: string[]; mappingProblems: string[]; server: ServerInfo; attempts: Attempt[] };
export type Flow = { state: FlowState; headline: string; blockers: string[]; canSubmit: boolean };

const REASON: Record<string, string> = {
  "storage-not-configured": "The server has no secure store for approvals and filing attempts yet.",
  "spec-not-verified": "The Companies House accounts message format hasn't been taken from their technical specification yet.",
  "ixbrl-unavailable": "The iXBRL taxonomy details haven't been obtained and checked yet.",
};
export const reasonText = (r: string | null) => (r ? REASON[r] || `The server says electronic filing isn't available (${r}).` : "");

export const latest = (a: Attempt[]): Attempt | undefined => [...a].sort((x, y) => y.attempt - x.attempt)[0];

export function flowOf(i: FlowIn): Flow {
  const last = latest(i.attempts);
  if (last && last.status !== "failed") {
    const m: Record<string, [FlowState, string]> = {
      submitting: ["submitting", "Being sent now. Don't send again."],
      acknowledged: ["acknowledged", "Received by the gateway. This is not acceptance. Check the status."],
      pending: ["pending", "Companies House is still processing the accounts."],
      accepted: ["accepted", "Accepted by Companies House."],
      rejected: ["rejected", "Rejected by Companies House. The reason is below."],
      unknown: ["unknown", "The outcome is not known (the connection failed after sending may have started). Do not send again: check the status first."],
    };
    const [state, headline] = m[last.status] || ["unknown", m.unknown[1]];
    return { state, headline, blockers: [], canSubmit: false };
  }
  const blockers: string[] = [];
  if (i.jobStatus !== "approved" && i.jobStatus !== "rejected") blockers.push("The accounts must be prepared and approved by the director first.");
  if (i.approvalStale) blockers.push("The accounts changed after approval. Withdraw and approve again.");
  for (const e of i.modelErrors) blockers.push(e);
  if (i.mappingProblems.length) blockers.push(`The iXBRL taxonomy mapping isn't verified (${i.mappingProblems.length} open points).`);
  if (!i.server) blockers.push("The server couldn't be reached, or doesn't have electronic filing yet.");
  else if (!i.server.available) blockers.push(reasonText(i.server.reason) || "The server says electronic filing isn't available.");
  const canSubmit = blockers.length === 0 && !!i.server && i.server.available && (i.jobStatus === "approved" || i.jobStatus === "rejected");
  if (blockers.length) return { state: i.server && i.server.available ? "blocked" : "manual", headline: "Electronic filing isn't available. File the accounts yourself and record it here.", blockers, canSubmit: false };
  return { state: "ready", headline: "Ready to send to the Companies House " + (i.server!.test ? "TEST" : "live") + " gateway.", blockers, canSubmit };
}

export type Item = { key: string; clientKey: string; title: string; detail: string; priority: "high" | "medium" | "low"; due: string };
const s = (v: unknown) => (v == null ? "" : String(v));
const days = (a: string, b: string) => Math.round((Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`)) / 86400000);

/** What needs somebody on dormant accounts jobs. `hashes` maps a job key to the current accounts hash, to spot approvals that no longer cover the figures. */
export function accountsItems(jobs: Row[], attempts: Attempt[], names: (clientKey: string) => string, today: string, hashes: Record<string, string> = {}): Item[] {
  const out: Item[] = [];
  for (const r of jobs) {
    const st = s(r.Status); if (st === "complete" || st === "cancelled") continue;
    const k = s(r.Key), ck = s(r.ClientKey), nm = names(ck), due = s(r.Deadline).slice(0, 10), end = s(r.PeriodEnd).slice(0, 10);
    const mine = attempts.filter((a) => a.key.startsWith(`attempt#${k}#`) || a.key.includes(`#${k}#`));
    const last = latest(mine);
    const add = (suffix: string, title: string, detail: string, priority: Item["priority"]) => out.push({ key: `acct:${k}:${suffix}`, clientKey: ck, title: `${nm}: ${title}`, detail, priority, due });
    if (last && last.status === "unknown") add("unknown", "accounts filing outcome unknown", "Check the status with Companies House before doing anything else. Do not send again.", "high");
    if (last && last.status === "rejected") add("rejected-e", "accounts rejected by Companies House", last.detail || "See the filing history for the reason.", "high");
    if (st === "rejected") add("rejected", "accounts rejected, refile needed", `Year ended ${end}. Correct and file again.`, "high");
    if (st === "approved" && hashes[k] && s(r.ApprovedHash) && hashes[k] !== s(r.ApprovedHash)) add("stale", "approval no longer covers the accounts", "The figures changed after the director approved. Withdraw and approve again.", "high");
    if (st === "approved" && due) {
      const left = days(today, due);
      if (left < 0) add("late", "accounts approved but overdue", `Were due ${due}. File now, late filing penalties apply.`, "high");
      else if (left <= 30) add("due", "approved accounts to file", `Due ${due} (${left} days).`, "medium");
    }
    if (st === "filed") {
      const since = s(r.FiledOn).slice(0, 10);
      if (since && days(since, today) > 7) add("waiting", "accounts filed, not yet accepted", `Filed ${since}. Check Companies House and record the acceptance or rejection.`, "medium");
    }
    if (["draft", "confirmed", "prepared"].includes(st) && due) {
      const left = days(today, due);
      if (left < 0) add("overdue", "accounts overdue", `Were due ${due}. Not yet approved.`, "high");
      else if (left <= 30) add("soon", "accounts due soon", `Due ${due} (${left} days). Not yet approved.`, "medium");
    }
  }
  return out;
}
