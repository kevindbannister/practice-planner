// What a server seal covers on an approved AML assessment. The server (api/approve) signs this with a key only it holds; if anyone
// later changes these fields directly in SharePoint, the seal no longer matches and the planner shows the approval as "changed".
// The review date and short reviews are left out on purpose: a short review legitimately moves the review date on.
import { Row } from "./schema";

const SEALED = ["Key", "ClientKey", "Status", "Risk", "RiskBasis", "Owners", "NoOwnerNote", "Checks", "Evidence", "Factors", "Pep", "DdLevel", "PreparedBy", "ApprovedBy", "ApprovedAt", "DoneOn"];
const str = (v: unknown): string => (v === undefined || v === null ? "" : String(v));
export function sealPayload(row: Row): string {
  return JSON.stringify(SEALED.map((k) => [k, str(row[k])]));
}
/** A Co Sec filing's approval: what was approved (form, company, details) and who approved it. Its status moves on after approval
 *  (submitted, accepted) without breaking the seal; editing the details clears the approval, so there is nothing left to verify. */
const TX_SEALED = ["Key", "ClientKey", "Form", "Payload", "After", "ApprovedBy", "ApprovedAt", "EditedBy"];
export function txSealPayload(row: Row): string {
  return JSON.stringify(TX_SEALED.map((k) => [k, str(row[k])]));
}
export type SealState = "sealed" | "changed" | "unsealed";
export const SEAL_LABEL: Record<SealState, string> = { sealed: "Approval verified by the server", changed: "Changed after approval: not verified", unsealed: "Approved before server checks (not sealed)" };
