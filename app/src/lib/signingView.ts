// The client's Signing requests view: everything that has been put in front of someone to sign or
// approve, in one list. It reads three existing records and keeps nothing of its own:
//   - portal e-signature requests (kept by the portal)
//   - engagement letters out for signature, signed or filed on paper (the Engagements list)
//   - documents the client was asked to approve in the portal (accounts, tax returns)
// A letter sent through the portal is already a portal request, so it is shown once.
import { Row } from "./schema";
import { StaffDoc, StaffSigning } from "./portalAdmin";

export type SignState = "waiting" | "signed" | "declined" | "cancelled" | "expired" | "unsigned";
export type SignKind = "portal" | "letter" | "approval";
export type SignRow = {
  id: string; kind: SignKind; title: string; ref: string; createdAt: string; creator: string;
  signees: { name: string; state: "signed" | "declined" | "waiting"; at: string }[];
  state: SignState; text: string; doneAt: string;
  portalId?: string; href?: string; chasable: boolean;
};

export const STATE_LABEL: Record<SignState, string> = { waiting: "Waiting", signed: "Signed", declined: "Declined", cancelled: "Cancelled", expired: "Expired", unsigned: "On file, unsigned" };
export const STATE_CHIP: Record<SignState, string> = { waiting: "amber", signed: "green", declined: "red", cancelled: "", expired: "red", unsigned: "amber" };
export const KIND_LABEL: Record<SignKind, string> = { portal: "Portal signature", letter: "Engagement letter", approval: "Document approval" };

const s = (v: unknown) => String(v ?? "").trim();
const list = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

export function fromSigning(r: StaffSigning): SignRow {
  const signees = r.signatories.map((x) => ({ name: x.name, at: x.signedAt || "", state: (x.status === "signed" ? "signed" : x.status === "declined" ? "declined" : "waiting") as "signed" | "declined" | "waiting" }));
  const names = (st: string) => signees.filter((x) => x.state === st).map((x) => x.name);
  const state: SignState = r.status === "out" ? "waiting" : r.status;
  const text = state === "signed" ? `Signed by ${list(names("signed"))}` : state === "declined" ? `Declined by ${list(names("declined")) || "a signatory"}` : state === "waiting" ? `Waiting for ${list(names("waiting"))}${names("signed").length ? ` · signed by ${list(names("signed"))}` : ""}` : STATE_LABEL[state];
  const lastSigned = signees.map((x) => x.at).filter(Boolean).sort().pop() || "";
  return { id: `portal:${r.id}`, kind: "portal", title: r.title, ref: r.ref, createdAt: r.createdAt, creator: r.createdByName, signees, state, text, doneAt: state === "signed" ? r.completedAt || lastSigned : state === "declined" ? lastSigned : "", portalId: r.id, chasable: state === "waiting" };
}

export function fromEngagement(e: Row): SignRow | undefined {
  const st = s(e.Status);
  const signedOnce = !!s(e.SignedAt);
  if (!(st === "out" || st === "signed" || st === "unsigned" || (st === "superseded" && signedOnce))) return undefined;
  const who = s(e.SignedBy) || s(e.Signatories).replace(/[\[\]"]/g, "").split(",").map((x) => x.trim()).filter(Boolean).join(", ");
  const names = (() => { try { const a = JSON.parse(s(e.Signatories) || "[]"); return Array.isArray(a) ? a.map((x) => (typeof x === "string" ? x : s((x as Row).name))).filter(Boolean) : []; } catch { return []; } })();
  const state: SignState = st === "out" ? "waiting" : st === "unsigned" ? "unsigned" : "signed";
  const signees = state === "signed" ? [{ name: who || "Signed", state: "signed" as const, at: s(e.SignedAt) }] : names.map((n) => ({ name: n, state: "waiting" as const, at: "" }));
  const method = s(e.SignMethod);
  const text = state === "signed" ? `Signed by ${who || "the client"}${method && method !== "portal" ? ` (${method === "external" ? "filed, signed outside" : method})` : ""}` : state === "waiting" ? `Waiting for ${names.length ? list(names) : "signature"}` : "Filed without a signature";
  return { id: `letter:${s(e.Key)}`, kind: "letter", title: s(e.Title) || "Engagement letter", ref: s(e.Ref), createdAt: s(e.SentOn) || s(e.Created), creator: s(e.SentBy) || s(e.CreatedBy), signees, state, text, doneAt: state === "signed" ? s(e.SignedAt) : "", href: `#/sales/engagements`, chasable: false };
}

export function fromApproval(d: StaffDoc): SignRow | undefined {
  if (!d.needsApproval && !d.approval) return undefined;
  const st = d.approval?.status || (d.status === "approved" ? "approved" : d.status === "declined" ? "declined" : "pending");
  const state: SignState = st === "approved" ? "signed" : st === "declined" ? "declined" : "waiting";
  const by = d.approval?.by || "the client";
  const text = state === "signed" ? `Approved by ${by}` : state === "declined" ? `Declined by ${by}${d.approval?.note ? `: ${d.approval.note}` : ""}` : "Waiting for the client to approve";
  return { id: `approval:${d.id}`, kind: "approval", title: d.title, ref: "", createdAt: d.publishedAt || d.createdAt, creator: "", signees: state === "waiting" ? [] : [{ name: by, state: state === "signed" ? "signed" : "declined", at: d.approval?.at || "" }], state, text, doneAt: state === "waiting" ? "" : d.approval?.at || "", chasable: false };
}

/** Everything for one client, newest first. `portalLoaded` is false when the portal couldn't be read, so letters sent through it still show. */
export function signingRows(o: { signings: StaffSigning[]; docs: StaffDoc[]; engagements: Row[]; clientKey: string; portalLoaded: boolean }): SignRow[] {
  const have = new Set(o.signings.map((x) => x.id));
  const rows: SignRow[] = o.signings.map(fromSigning);
  for (const e of o.engagements) {
    if (s(e.ClientKey) !== o.clientKey) continue;
    if (o.portalLoaded && s(e.SigningId) && have.has(s(e.SigningId))) continue; // shown as the portal request
    const r = fromEngagement(e);
    if (r) rows.push(r);
  }
  for (const d of o.docs) { const r = fromApproval(d); if (r) rows.push(r); }
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}

export type SignFilter = { state?: SignState | "all"; kind?: SignKind | "all"; q?: string };
export function filterRows(rows: SignRow[], f: SignFilter): SignRow[] {
  const q = (f.q || "").trim().toLowerCase();
  return rows.filter((r) => (!f.state || f.state === "all" || r.state === f.state) && (!f.kind || f.kind === "all" || r.kind === f.kind)
    && (!q || `${r.title} ${r.ref} ${r.creator} ${r.text} ${r.signees.map((x) => x.name).join(" ")}`.toLowerCase().includes(q)));
}

export function counts(rows: SignRow[]): Record<SignState, number> {
  const c: Record<SignState, number> = { waiting: 0, signed: 0, declined: 0, cancelled: 0, expired: 0, unsigned: 0 };
  for (const r of rows) c[r.state]++;
  return c;
}

/** Whole days a request has been waiting, for chasing. */
export function waitingDays(r: SignRow, today: string): number {
  if (r.state !== "waiting" || !r.createdAt) return 0;
  return Math.max(0, Math.round((Date.parse(today) - Date.parse(r.createdAt.slice(0, 10))) / 86400000));
}
