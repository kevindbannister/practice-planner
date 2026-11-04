// HMRC filing: the record of a return's journey to HMRC. One record per submission attempt of a return version, plus an append-only
// history. The rules here are the ones that don't depend on HMRC's XML:
//
//  - A return moves Draft → Prepared → Validated → Reviewed → Client approved → Ready to file → Submitted → Accepted or Rejected.
//  - The client approves an exact version: the hash of what was prepared. If the return changes afterwards the approval no longer
//    covers it, so the filing goes back to Prepared. An approved version can't silently change before it is sent.
//  - Production (live) filing is off unless it has been switched on and approved by name. The External Test Service needs HMRC's
//    test credentials. A mock run (nothing leaves the server) is always possible and is never shown as filed.
//  - Only HMRC's own final acceptance, on the live service, counts as filed. A test-service or mock acceptance never does.
//  - The same version can't be sent twice. A correction or an amendment is a new version that points at the one before it; earlier
//    versions are never changed.
//  - The history is only ever added to.
import { Row } from "./schema";

export type FilingService = "SA100" | "SA800" | "CT600";
export const SERVICE_LABEL: Record<FilingService, string> = { SA100: "Self Assessment (SA100)", SA800: "Partnership (SA800)", CT600: "Corporation Tax (CT600)" };

/** mock: built here, nothing leaves the server. ets: HMRC's External Test Service. live: HMRC's live service. */
export type FilingEnv = "mock" | "ets" | "live";
export const ENV_LABEL: Record<FilingEnv, string> = { mock: "Mock (nothing is sent to HMRC)", ets: "HMRC External Test Service", live: "Live" };

export type FilingState = "draft" | "prepared" | "validated" | "reviewed" | "client-approved" | "ready" | "submitted" | "accepted" | "rejected";
export const STATE_LABEL: Record<FilingState, string> = {
  draft: "Draft", prepared: "Prepared", validated: "Validated", reviewed: "Reviewed", "client-approved": "Client approved", ready: "Ready to file",
  submitted: "Submitted", accepted: "Accepted", rejected: "Rejected",
};
const FLOW: FilingState[] = ["draft", "prepared", "validated", "reviewed", "client-approved", "ready", "submitted", "accepted"];
/** Forwards one step at a time (or to a rejection from submitted); backwards only to Prepared, when something has to be redone. */
const NEXT: Record<FilingState, FilingState[]> = {
  draft: ["prepared"], prepared: ["validated", "prepared"], validated: ["reviewed", "prepared"], reviewed: ["client-approved", "prepared"],
  "client-approved": ["ready", "prepared"], ready: ["submitted", "prepared"], submitted: ["accepted", "rejected"], accepted: [], rejected: [],
};
export const canMove = (from: FilingState, to: FilingState) => NEXT[from]?.includes(to) ?? false;

export type Validation = { at: string; payloadHash: string; schema: string; errors: string[]; warnings: string[] };
/** Where a final answer came from. Only "hmrc" is HMRC's own word; "mock" is ours. */
export type Outcome = "hmrc" | "mock";

export type Filing = {
  key: string; clientKey: string; service: FilingService; period: string; version: number; supersedes: string;
  state: FilingState; env: FilingEnv; payloadHash: string; xmlHash: string; validation: Validation | null;
  reviewedBy: string; reviewedAt: string; approvedBy: string; approvedAt: string; approvedHash: string; approvalNote: string;
  confirmedBy: string; confirmedAt: string; submittedBy: string; submittedAt: string;
  correlationId: string; irmark: string; outcome: Outcome | ""; answeredAt: string; messages: { number: string; text: string }[]; receipt: string;
  created: string; createdBy: string; notes: string;
};
const s = (v: unknown) => (v == null ? "" : String(v));
const json = <T,>(v: unknown, d: T): T => { try { return v ? (JSON.parse(String(v)) as T) : d; } catch { return d; } };
export function readFiling(r: Row): Filing {
  return {
    key: s(r.Key), clientKey: s(r.ClientKey), service: (s(r.Service) || "SA100") as FilingService, period: s(r.Period), version: Number(r.Version) || 1, supersedes: s(r.Supersedes),
    state: (s(r.State) || "draft") as FilingState, env: (s(r.Env) || "mock") as FilingEnv, payloadHash: s(r.PayloadHash), xmlHash: s(r.XmlHash), validation: json<Validation | null>(r.Validation, null),
    reviewedBy: s(r.ReviewedBy), reviewedAt: s(r.ReviewedAt), approvedBy: s(r.ApprovedBy), approvedAt: s(r.ApprovedAt), approvedHash: s(r.ApprovedHash), approvalNote: s(r.ApprovalNote),
    confirmedBy: s(r.ConfirmedBy), confirmedAt: s(r.ConfirmedAt), submittedBy: s(r.SubmittedBy), submittedAt: s(r.SubmittedAt),
    correlationId: s(r.CorrelationId), irmark: s(r.Irmark), outcome: s(r.Outcome) as Outcome | "", answeredAt: s(r.AnsweredAt), messages: json(r.Messages, []), receipt: s(r.Receipt),
    created: s(r.Created), createdBy: s(r.CreatedBy), notes: s(r.Notes),
  };
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------- environments

export type FilingSettings = {
  /** HMRC's XML vendor ID and the test credentials are set on the server (their values never reach the browser). */
  vendorIdSet: boolean; testCredentialsSet: boolean;
  /** Live filing is off until someone switches it on and names who approved it. */
  liveEnabled: boolean; liveApprovedBy: string;
};
export const DEFAULT_SETTINGS: FilingSettings = { vendorIdSet: false, testCredentialsSet: false, liveEnabled: false, liveApprovedBy: "" };
export function envGate(env: FilingEnv, st: FilingSettings): { ok: boolean; reason: string } {
  if (env === "mock") return { ok: true, reason: "" };
  if (env === "ets") {
    if (!st.vendorIdSet) return { ok: false, reason: "HMRC's XML vendor ID isn't set up. It comes from HMRC's software developer support team." };
    if (!st.testCredentialsSet) return { ok: false, reason: "HMRC's test credentials aren't set up." };
    return { ok: true, reason: "" };
  }
  if (!st.liveEnabled) return { ok: false, reason: "Live filing is switched off." };
  if (!st.liveApprovedBy.trim()) return { ok: false, reason: "Live filing hasn't been approved by a named person." };
  if (!st.vendorIdSet) return { ok: false, reason: "HMRC's XML vendor ID isn't set up." };
  return { ok: true, reason: "" };
}

// ---------------------------------------------------------------- the record and its history

const KEY = () => `HF${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
export type LogEntry = Row;
export function logRow(f: { key: string; clientKey: string }, event: string, from: string, to: string, by: string, now: string, detail: unknown = ""): LogEntry {
  return { Key: `HL${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, FilingKey: f.key, ClientKey: f.clientKey, At: now, By: by, Event: event, From: from, To: to, Detail: typeof detail === "string" ? detail : JSON.stringify(detail) };
}

export function newFiling(inp: { clientKey: string; service: FilingService; period: string; env: FilingEnv; by: string; now: string; previous?: Filing; notes?: string }): { row: Row; log: LogEntry } {
  const version = inp.previous ? inp.previous.version + 1 : 1;
  const key = KEY();
  const row: Row = {
    Key: key, ClientKey: inp.clientKey, Service: inp.service, Period: inp.period, Version: version, Supersedes: inp.previous?.key || "", State: "draft", Env: inp.env,
    PayloadHash: "", XmlHash: "", Validation: "", ReviewedBy: "", ReviewedAt: "", ApprovedBy: "", ApprovedAt: "", ApprovedHash: "", ApprovalNote: "", ConfirmedBy: "", ConfirmedAt: "", SubmittedBy: "", SubmittedAt: "",
    CorrelationId: "", Irmark: "", Outcome: "", AnsweredAt: "", Messages: "", Receipt: "", Created: inp.now, CreatedBy: inp.by, Notes: inp.notes || "",
  };
  return { row, log: logRow({ key, clientKey: inp.clientKey }, inp.previous ? "amendment started" : "created", "", "draft", inp.by, inp.now, inp.previous ? { supersedes: inp.previous.key, version } : { env: inp.env }) };
}

/** A correction (after a rejection) or an amendment (after an acceptance) is a new version; the one before is left exactly as it was. */
export function amend(prev: Filing, by: string, now: string, env: FilingEnv = prev.env): { error?: string; row?: Row; log?: LogEntry } {
  if (prev.state !== "accepted" && prev.state !== "rejected") return { error: "Only a version HMRC has answered can be corrected or amended." };
  if (prev.state === "accepted" && prev.outcome === "mock") return { error: "A mock result isn't a filing, so there is nothing to amend. Start again." };
  return newFiling({ clientKey: prev.clientKey, service: prev.service, period: prev.period, env, by, now, previous: prev });
}

export type Ctx = {
  by: string; now: string; can: (what: "review" | "file") => boolean;
  /** The hash of the return as it is now. */
  currentHash: string;
  validation?: Validation; xmlHash?: string;
  /** Whether HMRC XML can be made for this return. Without it a return can be reviewed and approved but never marked ready or sent. */
  xml: { ready: boolean; reason: string };
  approval?: { by: string; note: string };
  confirm?: boolean;
  settings?: FilingSettings;
  /** Every filing held, to catch the same version being sent twice. */
  all?: Filing[];
  /** What HMRC (or the mock) answered. */
  answer?: { outcome: Outcome; accepted: boolean; messages?: { number: string; text: string }[]; receipt?: string; correlationId?: string; irmark?: string };
};

/** Another version of the same return that is already with HMRC or accepted with identical content. */
export function duplicateOf(f: Filing, all: Filing[]): Filing | undefined {
  return all.find((o) => o.key !== f.key && o.clientKey === f.clientKey && o.service === f.service && o.period === f.period && o.env === f.env
    && (o.state === "submitted" || (o.state === "accepted" && o.payloadHash === f.payloadHash)));
}

const done = (f: Filing, to: FilingState, patch: Row, ctx: Ctx, event: string, detail: unknown = ""): { patch: Row; log: LogEntry } => ({ patch: { State: to, ...patch }, log: logRow(f, event, f.state, to, ctx.by, ctx.now, detail) });

/** Move to the next state if every condition for it holds. Returns what to write; nothing is changed here. */
export function advance(f: Filing, to: FilingState, ctx: Ctx): { error?: string; patch?: Row; log?: LogEntry } {
  if (!canMove(f.state, to)) return { error: `A return that is ${STATE_LABEL[f.state].toLowerCase()} can't go to ${STATE_LABEL[to].toLowerCase()}.` };
  const st = ctx.settings || DEFAULT_SETTINGS;
  switch (to) {
    case "prepared": {
      if (!ctx.currentHash) return { error: "There is nothing prepared to file." };
      // back to Prepared also clears everything that was resting on the old version
      return done(f, to, { PayloadHash: ctx.currentHash, XmlHash: ctx.xmlHash || "", Validation: "", ReviewedBy: "", ReviewedAt: "", ApprovedBy: "", ApprovedAt: "", ApprovedHash: "", ApprovalNote: "", ConfirmedBy: "", ConfirmedAt: "" }, ctx, f.state === "draft" ? "prepared" : "sent back to prepared", { hash: ctx.currentHash });
    }
    case "validated": {
      const v = ctx.validation;
      if (!v) return { error: "Validate the return first." };
      if (v.payloadHash !== f.payloadHash || f.payloadHash !== ctx.currentHash) return { error: "The return has changed since it was prepared. Prepare it again." };
      if (v.errors.length) return { error: `The return has ${v.errors.length} validation error${v.errors.length === 1 ? "" : "s"}: ${v.errors.slice(0, 3).join("; ")}.` };
      return done(f, to, { Validation: JSON.stringify(v) }, ctx, "validated", { schema: v.schema, warnings: v.warnings.length });
    }
    case "reviewed":
      if (!ctx.can("review")) return { error: "You don't have permission to review returns for filing." };
      if (f.payloadHash !== ctx.currentHash) return { error: "The return has changed since it was prepared. Prepare it again." };
      return done(f, to, { ReviewedBy: ctx.by, ReviewedAt: ctx.now }, ctx, "reviewed");
    case "client-approved": {
      if (!ctx.approval?.by.trim()) return { error: "Record who approved it for the client." };
      if (f.payloadHash !== ctx.currentHash) return { error: "The return has changed since it was prepared, so the client can't approve this version. Prepare it again." };
      return done(f, to, { ApprovedBy: ctx.approval.by.trim(), ApprovedAt: ctx.now, ApprovedHash: f.payloadHash, ApprovalNote: ctx.approval.note.trim() }, ctx, "client approved", { hash: f.payloadHash, recordedBy: ctx.by });
    }
    case "ready": {
      if (!f.approvedHash || f.approvedHash !== ctx.currentHash || f.payloadHash !== ctx.currentHash) return { error: "The return has changed since the client approved it. It has to be approved again." };
      if (!ctx.xml.ready) return { error: ctx.xml.reason || "HMRC XML isn't ready for this return." };
      const g = envGate(f.env, st); if (!g.ok) return { error: g.reason };
      return done(f, to, {}, ctx, "marked ready");
    }
    case "submitted": {
      if (!ctx.can("file")) return { error: "You don't have permission to file returns with HMRC." };
      if (ctx.confirm !== true) return { error: "Confirm that you want to file this return." };
      if (!f.approvedHash || f.approvedHash !== ctx.currentHash || f.payloadHash !== ctx.currentHash) return { error: "The return has changed since the client approved it. It has to be approved again." };
      if (!ctx.xml.ready) return { error: ctx.xml.reason || "HMRC XML isn't ready for this return." };
      const g = envGate(f.env, st); if (!g.ok) return { error: g.reason };
      const dup = duplicateOf(f, ctx.all || []); if (dup) return { error: `Version ${dup.version} of this return has already been sent (${STATE_LABEL[dup.state].toLowerCase()}), so it isn't sent again.` };
      return done(f, to, { ConfirmedBy: ctx.by, ConfirmedAt: ctx.now, SubmittedBy: ctx.by, SubmittedAt: ctx.now, Env: f.env }, ctx, "submitted", { env: f.env });
    }
    case "accepted": case "rejected": {
      const a = ctx.answer;
      if (!a) return { error: "There is no answer to record." };
      if ((to === "accepted") !== a.accepted) return { error: "That isn't what the answer says." };
      return done(f, to, { Outcome: a.outcome, AnsweredAt: ctx.now, Messages: JSON.stringify(a.messages || []), Receipt: a.receipt || "", CorrelationId: a.correlationId || f.correlationId, Irmark: a.irmark || f.irmark }, ctx, to === "accepted" ? "accepted" : "rejected", { source: a.outcome, messages: a.messages?.length || 0 });
    }
    default: return { error: "That isn't a step." };
  }
}

/** If the return has changed since this version was prepared, it goes back to Prepared (or Draft if it never was prepared). */
export function needsRework(f: Filing, currentHash: string): boolean {
  return !["draft", "submitted", "accepted", "rejected"].includes(f.state) && f.payloadHash !== currentHash;
}

/** Filed means HMRC's live service gave its final acceptance. A test-service or mock acceptance never counts. */
export const isFiled = (f: Filing) => f.state === "accepted" && f.outcome === "hmrc" && f.env === "live";
export function describe(f: Filing): string {
  if (f.state === "accepted") return f.outcome === "mock" ? "Mock run only: nothing was sent to HMRC" : f.env === "live" ? "Accepted by HMRC" : "Accepted by HMRC's test service: not filed";
  if (f.state === "rejected") return f.outcome === "mock" ? "Mock run rejected: nothing was sent to HMRC" : "Rejected by HMRC";
  if (f.state === "submitted") return "With HMRC, waiting for the answer";
  return STATE_LABEL[f.state];
}

export type Check = { key: string; label: string; ok: boolean; detail: string };
/** The checks shown in the HMRC Filing area: what stands between this version and filing. */
export function readiness(f: Filing, currentHash: string, st: FilingSettings, xml: { ready: boolean; reason: string }): Check[] {
  const g = envGate(f.env, st);
  const unchanged = !!f.payloadHash && f.payloadHash === currentHash;
  const idx = FLOW.indexOf(f.state);
  return [
    { key: "xml", label: "HMRC XML ready", ok: xml.ready, detail: xml.ready ? "" : xml.reason },
    { key: "version", label: "Return unchanged since prepared", ok: unchanged, detail: unchanged ? "" : f.payloadHash ? "The return has changed since it was prepared." : "Not prepared yet." },
    { key: "validated", label: "Validated", ok: !!f.validation && !f.validation.errors.length && idx >= FLOW.indexOf("validated"), detail: f.validation?.errors.length ? `${f.validation.errors.length} error(s).` : "" },
    { key: "reviewed", label: "Reviewed", ok: !!f.reviewedBy, detail: f.reviewedBy ? `By ${f.reviewedBy}.` : "" },
    { key: "approved", label: "Client approved this version", ok: !!f.approvedHash && f.approvedHash === currentHash, detail: f.approvedBy ? (f.approvedHash === currentHash ? `By ${f.approvedBy}.` : "Approved a different version.") : "" },
    { key: "env", label: `${ENV_LABEL[f.env]} available`, ok: g.ok, detail: g.reason },
  ];
}
