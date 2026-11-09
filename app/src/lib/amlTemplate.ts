// The client risk assessment: a template of questions (individual or company), which questions show when, and the rules that say a rating
// MUST or SHOULD be high. It works out section ratings, what is missing, and what blocks approval. Rules come from the practice's own
// templates, so they are the practice's rules; the planner only applies them.
import { ClientType } from "./proposals";
import { COMPANY, INDIVIDUAL } from "./amlTemplates";

export type TQ = { k: string; t: "one" | "many" | "text" | "long" | "date" | "risk"; label: string; options?: string[]; help?: string; need: boolean; hidden?: boolean; cat?: string };
export type TSection = { title: string; questions: TQ[] };
export type Test = { src: string; op: "eq" | "ne"; value: string };
export type Template = { id: "individual" | "company"; title: string; sections: TSection[]; conditions: { target: string; source: string; value: string }[]; rules: { when: Test[]; then: Test; strict: "MUST" | "SHOULD" }[] };
export type Ans = Record<string, string | string[]>;
export type Level = "" | "low" | "medium" | "high";

export const LEVEL: Record<string, Level> = { Low: "low", Normal: "medium", High: "high" };
export const LEVEL_LABEL: Record<string, string> = { low: "Low", medium: "Normal", high: "High" };
const RANK: Record<Level, number> = { "": 0, low: 1, medium: 2, high: 3 };

/** Companies, LLPs, sole traders and partnerships use the company template (it has the "N/A, sole trader" answers); individuals use the other. */
export const templateFor = (type: ClientType): Template => (type === "individual" ? INDIVIDUAL : COMPANY);

const s = (v: unknown): string => (v == null ? "" : Array.isArray(v) ? v.join(", ") : String(v));
export function readAnswers(v: unknown): Ans {
  try {
    const j = JSON.parse(s(v) || "{}");
    const out: Ans = {};
    if (j && typeof j === "object") for (const [k, x] of Object.entries(j as Record<string, unknown>)) if (typeof x === "string" || (Array.isArray(x) && x.every((y) => typeof y === "string"))) out[k] = x as string | string[];
    return out;
  } catch { return {}; }
}

export const questions = (t: Template): TQ[] => t.sections.flatMap((x) => x.questions);
const byKey = (t: Template, k: string) => questions(t).find((q) => q.k === k);
export const isShown = (t: Template, a: Ans, q: TQ): boolean => !q.hidden || t.conditions.some((c) => c.target === q.k && s(a[c.source]) === c.value);
const answered = (a: Ans, k: string) => (Array.isArray(a[k]) ? (a[k] as string[]).length > 0 : s(a[k]).trim() !== "");
/** For a choice of several (tick boxes), "is" means that one is ticked and "is not" means something other than it is ticked. */
const test = (a: Ans, x: Test) => {
  const v = a[x.src];
  if (Array.isArray(v)) return x.op === "eq" ? v.includes(x.value) : v.some((y) => y !== x.value);
  return x.op === "eq" ? s(v) === x.value : s(v) !== x.value;
};

export type Finding = { strict: "MUST" | "SHOULD"; question: string; text: string; wants: Test };
export type Result = { shown: TQ[]; missing: TQ[]; findings: Finding[]; ratings: { section: string; q: string; level: Level }[]; highest: Level };

export function evaluate(t: Template, a: Ans): Result {
  const shown = questions(t).filter((q) => isShown(t, a, q));
  const missing = shown.filter((q) => q.need && !answered(a, q.k));
  const findings: Finding[] = [];
  for (const r of t.rules) {
    if (!r.when.every((w) => answered(a, w.src) && test(a, w))) continue;
    const target = byKey(t, r.then.src); if (!target || !isShown(t, a, target)) continue;
    if (answered(a, r.then.src) && test(a, r.then)) continue;
    const why = r.when.map((w) => `"${byKey(t, w.src)?.label}" is${w.op === "ne" ? " not" : ""} "${w.value}"`).join(" and ");
    findings.push({ strict: r.strict, question: r.then.src, wants: r.then, text: `${r.strict === "MUST" ? "Must" : "Should"} be ${r.then.op === "ne" ? "anything but " : ""}${r.then.value}, because ${why}.` });
  }
  const ratings = t.sections.flatMap((sec) => sec.questions.filter((q) => q.t === "risk").map((q) => ({ section: sec.title, q: q.k, level: LEVEL[s(a[q.k])] || ("" as Level) })));
  const highest = ratings.reduce<Level>((m, r) => (RANK[r.level] > RANK[m] ? r.level : m), "");
  return { shown, missing, findings, ratings, highest };
}

/** What stops the assessment being approved: unanswered required questions and broken MUST rules. SHOULD findings only advise. */
export function templateProblems(t: Template, a: Ans): string[] {
  const r = evaluate(t, a);
  const out: string[] = [];
  if (r.missing.length) out.push(`Answer the risk assessment questions: ${r.missing.length} left, starting with "${r.missing[0].label}".`);
  for (const f of r.findings.filter((x) => x.strict === "MUST")) out.push(`"${byKey(t, f.question)?.label}" ${f.text.charAt(0).toLowerCase()}${f.text.slice(1)}`);
  return out;
}

/** The sentence for "what the rating is based on", built from the section ratings. */
export function basisFrom(t: Template, a: Ans): string {
  const r = evaluate(t, a);
  const named = r.ratings.filter((x) => x.level).map((x) => `${x.section.replace(/^Identify and verify the identity of the client$/, "identity").replace(/^Understanding the client and their activities$/, "transactions and activities").replace(/^Geographical risk$/, "geography").replace(/^Your services to the client$/, "services").replace(/^Delivery channels$/, "delivery channel")} ${LEVEL_LABEL[x.level].toLowerCase()}`);
  if (!named.length) return "";
  return `Section ratings: ${named.join(", ")}. The overall rating follows the highest.`;
}

export type HintCtx = { companyNumber: string; owners: number; passedIdentity: boolean; passedScreening: boolean; xamaApproved: boolean; xamaIdDone: boolean; ownershipAgrees: boolean | null; services: string[] };
/** Answers the planner can suggest from what it already holds. The person chooses whether to use each one. */
export function hints(t: Template, h: HintCtx): Record<string, { value: string | string[]; from: string }> {
  const out: Record<string, { value: string | string[]; from: string }> = {};
  for (const q of questions(t)) {
    const l = q.label.toLowerCase();
    if (/registered with companies house/.test(l) && h.companyNumber) out[q.k] = { value: "Yes", from: `company number ${h.companyNumber}` };
    else if (/beneficial owners (been )?identified and added/.test(l) && h.owners) out[q.k] = { value: "Yes", from: "owners recorded in this review" };
    else if (/identity documents? (has|have) been collected/.test(l) && h.passedIdentity) out[q.k] = { value: "Yes", from: "a passed identity check in this review" };
    else if (/passed.*aml identity verification/.test(l) && (h.xamaApproved || h.xamaIdDone)) out[q.k] = { value: "Yes", from: "the Xama result on the client" };
    else if (/(pep screening|identified as a pep)/.test(l) && h.passedScreening) out[q.k] = { value: "No", from: "a passed screening check in this review" };
    else if (/(sanctions screening|on the sanctions database)/.test(l) && h.passedScreening) out[q.k] = { value: "No", from: "a passed screening check in this review" };
    else if (/ownership agree with the details held on companies house/.test(l) && h.ownershipAgrees === true) out[q.k] = { value: "Yes", from: "Company Secretarial shows no ownership problems" };
    else if (q.t === "many" && /services does our firm offer/.test(l) && q.options) {
      const pick = q.options.filter((o) => h.services.some((n) => (o === "Accounts" && /account/i.test(n)) || (o === "Self assessment" && /self.?assess|personal tax/i.test(n)) || (o === "Tax advice" && /tax/i.test(n)) || (o === "Company secretarial" && /secretar/i.test(n)) || (o === "Payroll" && /payroll/i.test(n)) || (o === "Client money account" && /client money/i.test(n))));
      if (pick.length) out[q.k] = { value: pick, from: "the client's services in the planner" };
    }
  }
  return out;
}
