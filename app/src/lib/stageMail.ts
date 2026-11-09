// An email to the client when a stage of a job is finished ("your records are in", "we've started on your accounts").
// Rules say which stage of which type of work triggers one and what it says. Finishing the stage only offers the email:
// it goes into Outlook drafts for you to check and send, never straight out.
const s = (v: unknown) => String(v ?? "").trim();

export type StageRule = { serviceKey: string; stageNo: number; enabled: boolean; subject: string; body: string };
export const STAGE_MAIL_KEY = "stage-mail";

export const DEFAULT_BODY = "{{client.greeting}}\n\nA quick update on {{job.type}}: we have finished the \"{{stage}}\" step.\n\nIf you have any questions, just reply to this email.\n\n{{practice.name}}";
export const DEFAULT_SUBJECT = "{{job.type}}: {{stage}} done";

export function readRules(raw: unknown): StageRule[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: StageRule[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const stageNo = Number(o.stageNo);
    const serviceKey = s(o.serviceKey);
    if (!serviceKey || !Number.isInteger(stageNo) || stageNo < 1) continue;
    const id = `${serviceKey}|${stageNo}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ serviceKey, stageNo, enabled: o.enabled !== false, subject: s(o.subject) || DEFAULT_SUBJECT, body: typeof o.body === "string" && o.body.trim() ? o.body : DEFAULT_BODY });
  }
  return out;
}

export const ruleFor = (rules: StageRule[], serviceKey: string, stageNo: number): StageRule | undefined => rules.find((r) => r.serviceKey === serviceKey && r.stageNo === stageNo);

/** Switch a stage's email on or off, starting from the default wording; edits keep what was written. */
export function withRule(rules: StageRule[], serviceKey: string, stageNo: number, patch: Partial<StageRule>): StageRule[] {
  const have = ruleFor(rules, serviceKey, stageNo);
  const next: StageRule = { ...(have || { serviceKey, stageNo, enabled: true, subject: DEFAULT_SUBJECT, body: DEFAULT_BODY }), ...patch, serviceKey, stageNo };
  return [...rules.filter((r) => r !== have), next].sort((a, b) => a.serviceKey.localeCompare(b.serviceKey) || a.stageNo - b.stageNo);
}

/**
 * The rule to offer when a job moves from one stage to another. Only moving forward finishes a stage (going back never
 * offers an email), and moving several stages at once offers just the stage that was left.
 */
export function ruleOnMove(rules: StageRule[], serviceKey: string, from: number, to: number): StageRule | undefined {
  if (!(to > from)) return undefined;
  const r = ruleFor(rules, serviceKey, from);
  return r && r.enabled ? r : undefined;
}

/** Fill the wording in: the usual merge fields plus {{stage}} for the finished stage's name. */
export function stageEmail(rule: StageRule, values: Record<string, string>, stageName: string): { subject: string; body: string } {
  const v: Record<string, string> = { ...values, stage: stageName, "job.type": values["job.type"] || "" };
  const fill = (t: string) => t.replace(/\{\{\s*([a-z0-9_.]+)\s*\}\}/gi, (m, k: string) => (s(v[k.toLowerCase()]) ? v[k.toLowerCase()] : m));
  return { subject: fill(rule.subject), body: fill(rule.body) };
}
