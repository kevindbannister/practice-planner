// Client approval for a Co Sec transaction. Part of the one transaction engine, not a separate system: a transaction is asked "does this need
// client approval?", and if it does, it gets an approval document, goes to the client by the existing portal signing (or is signed on paper and
// uploaded), and the decision is recorded on the transaction. Staff cannot approve the transaction internally while a client decision is
// outstanding. Mandatory approvals can't be skipped. Pure logic apart from the PDF.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { Row } from "./schema";
import { Ctx, Written, activityRow, logRow } from "./sales";

const str = (v: unknown): string => (v == null ? "" : String(v));
const json = <T,>(v: unknown, f: T): T => { try { const x = JSON.parse(str(v)); return x == null ? f : x; } catch { return f; } };

export type ApprovalState = "undecided" | "required" | "awaiting" | "approved" | "declined" | "not-required";
export const APPROVAL_LABEL: Record<ApprovalState, string> = { undecided: "Approval not yet decided", required: "Client approval needed", awaiting: "Waiting for the client", approved: "Client approved", declined: "Client declined", "not-required": "No client approval needed" };
export const APPROVAL_CHIP: Record<ApprovalState, string> = { undecided: "amber", required: "amber", awaiting: "amber", approved: "green", declined: "red", "not-required": "" };
export const approvalOf = (tx: Row): ApprovalState => (str(tx.ApprovalState) as ApprovalState) || "";

/** Forms where the law needs a company decision (a resolution) behind the filing: the answer can't simply be "no". */
const MANDATORY: Record<string, string> = {
  NM01: "A change of name needs a special resolution of the members.",
  SH01: "An allotment of shares needs the directors' authority and a board decision.",
  STT: "A share transfer needs the directors to approve it for registration, unless the articles say otherwise.",
};
/** The usual answer for each kind of transaction. Changing these is a one-line edit; they are only the starting point. */
export function defaultApproval(form: string): { required: boolean; mandatory: boolean; reason: string } {
  const mandatory = !!MANDATORY[form];
  if (mandatory) return { required: true, mandatory, reason: MANDATORY[form] };
  if (/^(AP|LLAP|TM|LLTM|CH|LLCH|PSC)/.test(form) || form === "AD01" || form === "AA01" || form === "CS01") return { required: true, mandatory: false, reason: "The company is making this change, so its directors normally confirm it first." };
  return { required: false, mandatory: false, reason: "" };
}

/** Why the transaction can't be approved internally yet, or nothing if it can. Older drafts with no decision recorded aren't held up. */
export function approvalGate(tx: Row): string | undefined {
  switch (approvalOf(tx)) {
    case "undecided": return "Decide whether this needs client approval first.";
    case "required": return "Client approval is needed: send it to the client, or record a signed copy, first.";
    case "awaiting": return "Waiting for the client's approval.";
    case "declined": return "The client declined this. Change the draft and ask again, or cancel it.";
    default: return undefined;
  }
}

type W = Written | { error: string };
const hist = (tx: Row, o: Ctx, what: string, note?: string) => JSON.stringify([...json<{ at: string; by: string; what: string; note?: string }[]>(tx.History, []), { at: o.now, by: o.actor, what, ...(note ? { note } : {}) }]);
const OPEN = ["draft", "info", "approved", "rejected"];
const done = (tx: Row, patch: Row, what: string, note: string, title: string, o: Ctx): Written => ({
  patches: [{ list: "CoSecTransactions", row: tx, patch: { ...patch, History: hist(tx, o, what, note), Updated: o.now } }],
  log: [logRow(o, what, "cosec", str(tx.Key), { clientKey: str(tx.ClientKey) }, { form: tx.Form, note })],
  activities: [activityRow(o, "cosec-flag", title, undefined, { clientKey: str(tx.ClientKey) }, note, `cosec:${what}:${str(tx.Key)}:${o.now}`)],
  creates: [],
});
const label = (tx: Row) => `${str(tx.Form)} ${str(tx.Title)}`;

/** The user's answer to "Does this transaction need client approval?". For a mandatory one, "no" needs the resolution recorded. */
export function decide(tx: Row, required: boolean, note: string, can: boolean, o: Ctx): W {
  if (!can) return { error: "You can't change a filing." };
  if (!OPEN.includes(str(tx.Status) || "draft")) return { error: "That filing is closed." };
  const st = approvalOf(tx);
  if (st === "awaiting") return { error: "It has already been sent. Withdraw that request before changing the decision." };
  if (st === "approved") return { error: "The client has already approved this." };
  const d = defaultApproval(str(tx.Form));
  if (!required && d.mandatory && !note.trim()) return { error: `${d.reason} To go ahead without the client's approval here, record where the decision was made (for example, the date of the board or members' resolution).` };
  return done(tx, { ApprovalState: required ? "required" : "not-required", ApprovalNote: note.trim(), ApprovalDecidedBy: o.actor, ApprovalDecidedAt: o.now }, required ? "client approval required" : "no client approval needed", note.trim(), `${label(tx)}: ${required ? "client approval will be asked for" : "no client approval needed"}`, o);
}

/** The approval request has gone out: through the portal (a signing request) or as a printed document. */
export function sendForApproval(tx: Row, d: { method: "portal" | "manual"; signingId?: string; portalDocId?: string; docKey?: string; signatories: string[] }, can: boolean, o: Ctx): W {
  if (!can) return { error: "You can't send an approval." };
  const st = approvalOf(tx);
  if (st !== "required" && st !== "declined") return { error: st === "awaiting" ? "It has already been sent." : "Client approval isn't needed for this filing." };
  if (d.method === "portal" && !d.signingId) return { error: "The portal didn't return a signing request." };
  const who = d.signatories.filter(Boolean).join(", ");
  return done(tx, { ApprovalState: "awaiting", ApprovalMethod: d.method, ApprovalSigningId: d.signingId || "", ApprovalPortalDocId: d.portalDocId || "", ApprovalDocKey: d.docKey || "", ApprovalSignatories: who, ApprovalSentAt: o.now, ApprovalBy: "", ApprovalAt: "", ApprovalEvidence: "" },
    d.method === "portal" ? "sent for client approval" : "approval document prepared for signing", d.method === "portal" ? `Sent through the portal to ${who}.` : "Printed copy to be signed and uploaded.", `${label(tx)} sent for client approval`, o);
}

/** A signed paper copy came back. The person recording it says who signed and when; the signed copy should be filed too. */
export function recordManual(tx: Row, d: { by: string; at: string; evidence: string; docKey?: string }, can: boolean, o: Ctx): W {
  if (!can) return { error: "You can't record an approval." };
  const st = approvalOf(tx);
  if (st !== "required" && st !== "awaiting" && st !== "declined") return { error: "Nothing is waiting for approval." };
  if (!d.by.trim()) return { error: "Say who signed." };
  if (!/^\d{4}-\d{2}-\d{2}/.test(d.at)) return { error: "Enter the date it was signed." };
  if (d.at.slice(0, 10) > o.now.slice(0, 10)) return { error: "The signing date can't be in the future." };
  if (!d.docKey && !d.evidence.trim()) return { error: "Upload the signed copy or say where it is kept." };
  return done(tx, { ApprovalState: "approved", ApprovalMethod: "manual", ApprovalBy: d.by.trim(), ApprovalAt: d.at, ApprovalEvidence: d.evidence.trim(), ApprovalSignedDocKey: d.docKey || "" }, "client approval recorded (signed copy)", `Signed by ${d.by.trim()} on ${d.at.slice(0, 10)}.`, `${label(tx)} approved by the client`, o);
}

export type SigningView = { id: string; ref: string; status: string; completedAt: string; sealedDocId?: string; signatories: { name: string; status: string; signedAt: string }[] };
/** Bring a portal signing request's outcome onto the transaction. Returns nothing to write while it is still out. */
export function fromSigning(tx: Row, r: SigningView, o: Ctx): { written?: Written; progress: string } {
  const st = approvalOf(tx);
  const signed = r.signatories.filter((x) => x.status === "signed");
  const progress = `${signed.length} of ${r.signatories.length} have signed`;
  if (st !== "awaiting" || str(tx.ApprovalSigningId) !== r.id) return { progress };
  if (r.status === "completed") return { progress, written: done(tx, { ApprovalState: "approved", ApprovalBy: signed.map((x) => x.name).join(", "), ApprovalAt: r.completedAt || o.now, ApprovalEvidence: `Portal signing ${r.ref}`, ApprovalSealedDocId: r.sealedDocId || "" }, "client approved through the portal", `Signed by ${signed.map((x) => x.name).join(", ")}. Evidence: portal signing ${r.ref}.`, `${label(tx)} approved by the client`, o) };
  if (r.status === "declined") return { progress, written: done(tx, { ApprovalState: "declined" }, "client declined", `Declined through the portal (${r.ref}).`, `${label(tx)} declined by the client`, o) };
  if (r.status === "cancelled" || r.status === "expired") return { progress: `The request is ${r.status}`, written: done(tx, { ApprovalState: "required", ApprovalSigningId: "" }, `approval request ${r.status}`, "It can be sent again.", `${label(tx)}: the approval request ${r.status}`, o) };
  return { progress };
}

/** Take back a request that is out (the portal side is cancelled by the caller). */
export function withdrawApproval(tx: Row, can: boolean, o: Ctx): W {
  if (!can) return { error: "You can't withdraw an approval request." };
  if (approvalOf(tx) !== "awaiting") return { error: "Nothing is out for approval." };
  return done(tx, { ApprovalState: "required", ApprovalSigningId: "", ApprovalSentAt: "" }, "approval request withdrawn", "", `${label(tx)}: approval request withdrawn`, o);
}

// ------------------------------------------------------------------ the approval document

const WORDING: Record<string, string> = {
  AD01: "The company confirms that its registered office address is to be changed as set out above, with effect from the date stated.",
  NM01: "The members resolve by special resolution that the name of the company be changed as set out above.",
  SH01: "The directors resolve to allot the shares set out above on the terms stated, and confirm they have authority to do so.",
  CS01: "The directors confirm that the information set out above is correct as at the date the statement is made up to, and that the company's intended future activities are lawful.",
  STT: "The directors approve the transfer of the shares set out above and agree that the register of members be updated.",
};
export const wordingFor = (form: string) => WORDING[form] || (/^(AP|LLAP)/.test(form) ? "The company confirms the appointment set out above." : /^(TM|LLTM)/.test(form) ? "The company confirms that the appointment set out above has ended on the date stated." : /^(CH|LLCH|PSC0[4-6])/.test(form) ? "The company confirms that the details set out above are correct and are to be updated." : /^PSC/.test(form) ? "The company confirms the details of the person with significant control set out above." : "The company confirms the change set out above.");

export type Summary = { company: string; number: string; title: string; form: string; formTitle: string; effective: string; current: string; proposed: string; details: [string, string][]; wording: string; signatories: string[]; practice: string; ref: string };
const FIELD_LABEL: Record<string, string> = { Title: "Title", First: "First name", Last: "Last name", DOB: "Date of birth", Nationality: "Nationality", Occupation: "Occupation", CountryOfResidence: "Country of residence", ServiceAddress: "Service address", Holder: "Holder", Class: "Class", Number: "Number of shares", NominalValue: "Nominal value", PaidPerShare: "Paid per share", Currency: "Currency" };

/** What the client is asked to approve, laid out from the transaction. Nothing sensitive beyond what the filing itself contains. */
export function summaryOf(tx: Row, company: { name: string; number: string }, formTitle: string, signatories: string[], practice: string): Summary {
  const p = json<Record<string, any>>(tx.Payload, {});
  const details: [string, string][] = [];
  for (const [k, v] of Object.entries((p.details || {}) as Record<string, unknown>)) if (str(v).trim() && FIELD_LABEL[k]) details.push([FIELD_LABEL[k], str(v)]);
  for (const [k, v] of Object.entries((p.changes || {}) as Record<string, unknown>)) details.push([FIELD_LABEL[k] || k, `${str(p.before?.[k]) ? `${str(p.before[k])} → ` : ""}${str(v)}`]);
  if (str(tx.Form) === "CS01") {
    details.push(["Made up to", str(p.madeUpTo)], ["Registered email", str(p.email)]);
    for (const [k, v] of Object.entries((p.snapshot || {}) as Record<string, unknown>)) if (Array.isArray(v) && v.length) details.push([k === "capital" ? "Share capital" : k === "shareholders" ? "Shareholders" : k === "officers" ? "Officers" : k, v.map(str).join("\n")]);
  }
  if (p.from || p.to) { details.push(["From", str(p.from)], ["To", str(p.to)]); if (p.number) details.push(["Shares", `${str(p.number)} ${str(p.class)}`]); if (p.consideration) details.push(["Consideration", str(p.consideration)]); }
  return { company: company.name, number: company.number, title: str(tx.Title), form: str(tx.Form), formTitle, effective: str(p.date || p.newDate || p.madeUpTo || ""), current: str(tx.Before), proposed: str(tx.After), details, wording: wordingFor(str(tx.Form)), signatories, practice, ref: str(tx.Ref) };
}

/** A one-or-two page PDF: what is proposed, the wording, and a signature block for each signatory. */
export async function approvalPdf(s: Summary): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595, H = 842, M = 50;
  let page = pdf.addPage([W, H]); let y = H - M;
  const clean = (t: string) => t.replace(/[^\x20-\x7E£→]/g, "?").replace(/→/g, "->");
  const wrap = (t: string, w: number, size: number, f = font) => { const out: string[] = []; for (const para of clean(t).split(/\n/)) { let line = ""; for (const word of para.split(/\s+/)) { const next = line ? `${line} ${word}` : word; if (f.widthOfTextAtSize(next, size) > w && line) { out.push(line); line = word; } else line = next; } out.push(line); } return out; };
  const ensure = (h: number) => { if (y - h < M) { page = pdf.addPage([W, H]); y = H - M; } };
  const line = (t: string, size = 10, f = font, x = M, w = W - 2 * M) => { for (const l of wrap(t, w, size, f)) { ensure(size + 4); page.drawText(l, { x, y: y - size, size, font: f, color: rgb(0.1, 0.1, 0.1) }); y -= size + 4; } };
  line(s.practice || "Approval request", 9, font); y -= 6;
  line(`${s.company}${s.number ? ` (${s.number})` : ""}`, 16, bold); y -= 2;
  line(`Approval of: ${s.title || s.formTitle}`, 12, bold); y -= 8;
  line(`Reference ${s.ref}   Form ${s.form}${s.effective ? `   Effective ${s.effective}` : ""}`, 9); y -= 8;
  const row = (k: string, v: string) => { if (!v.trim()) return; ensure(16); page.drawText(clean(k), { x: M, y: y - 10, size: 9, font: bold, color: rgb(0.3, 0.3, 0.3) }); const ls = wrap(v, W - 2 * M - 130, 10); ls.forEach((l, i) => { page.drawText(l, { x: M + 130, y: y - 10 - i * 14, size: 10, font, color: rgb(0.1, 0.1, 0.1) }); }); y -= Math.max(1, ls.length) * 14 + 2; };
  row("Current information", s.current); row("Proposed change", s.proposed); for (const [k, v] of s.details) row(k, v);
  y -= 10; line("Approval", 12, bold); line(s.wording, 10); y -= 6;
  line("By signing, you confirm that you are authorised to act for the company and that the information above is correct.", 9); y -= 14;
  const people = s.signatories.length ? s.signatories : [""];
  for (const n of people) { ensure(70); y -= 14; page.drawLine({ start: { x: M, y }, end: { x: M + 230, y }, thickness: 0.6, color: rgb(0.2, 0.2, 0.2) }); page.drawLine({ start: { x: M + 280, y }, end: { x: M + 400, y }, thickness: 0.6, color: rgb(0.2, 0.2, 0.2) }); y -= 12; page.drawText(clean(`Signed${n ? `: ${n}` : ""}`), { x: M, y, size: 9, font, color: rgb(0.3, 0.3, 0.3) }); page.drawText("Date", { x: M + 280, y, size: 9, font, color: rgb(0.3, 0.3, 0.3) }); y -= 24; }
  pdf.getPages().forEach((p, i, all) => p.drawText(`Page ${i + 1} of ${all.length}`, { x: M, y: 24, size: 8, font, color: rgb(0.5, 0.5, 0.5) }));
  return pdf.save();
}
