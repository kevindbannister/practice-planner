// The planner's own rules, bundled for the Azure functions (app/tools/build-server-lib.mjs writes api/shared/plannerlib.js).
// The server runs exactly the same checks as the screens, with the approver taken from their Microsoft sign-in.
import { approveAssessment, asStatus } from "../lib/amlAssessment";
import { storeFrom } from "../lib/amlPack";
import { policyAnswers, screeningPolicy } from "../lib/amlPolicy";
import { sealPayload } from "../lib/amlSeal";
import { practiceId } from "../lib/checklistRows";
import { readOnboardingSettings } from "../lib/onboarding";
import { newKey } from "../lib/planning";
import { proposalCan } from "../lib/proposals";
import { salesConfig, Written } from "../lib/sales";
import { Row } from "../lib/schema";

export { sealPayload, asStatus };
export { digestFor, digestText } from "./digest";

export type ApproveInput = { key: string; user: string; assessments: Row[]; clients: Row[]; settings: Row[]; records: Row[]; today: string; now: string };
/** Approve one AML assessment with the same rules as the screen. Returns what to write, or why not. */
export function approveAml(i: ApproveInput): Written | { error: string } {
  const row = i.assessments.find((r) => r.Key === i.key);
  if (!row) return { error: "That assessment wasn't found." };
  const client = i.clients.find((c) => c.Key === row.ClientKey);
  if (!client) return { error: "The client for that assessment wasn't found." };
  const cfg = salesConfig(i.settings);
  const settings = readOnboardingSettings(i.settings);
  const sp = screeningPolicy(i.settings, { high: settings.amlMonths.high, medium: settings.amlMonths.medium, low: settings.amlMonths.low });
  const ed = policyAnswers(i.settings).edd;
  const sof = Array.isArray(ed) ? ed.map(String).includes("sof") : true;
  const register = storeFrom(i.records, i.settings, "screening").records;
  const o = { actor: i.user, now: i.now, pid: practiceId(i.settings), newKey };
  return approveAssessment(row, client, i.assessments, settings, cfg.independentReview, (a) => proposalCan(cfg, i.user, a), i.today, o, { sof, screening: { sp, register } });
}
