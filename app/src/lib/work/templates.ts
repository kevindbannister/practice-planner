// Dependency templates: the standard relationships between kinds of accounting work, applied to each new period's jobs so nobody rebuilds them by hand.
// A template says "a job of service X waits for (a job of service Y | some information) in this relationship". Matching is by service, client and period
// only, never by title. When the right match is not certain the result is a review item for a person, not a guess. Templates only ever fill in what is
// missing on OPEN jobs: finished jobs, existing dependencies and anything a person removed or declined are left alone.
import { Row } from "../schema";
import { Dependency, DepType, DEP_TYPES, Ref, createsCycle, validateDependency } from "./dependencies";

const s = (v: unknown) => (v == null ? "" : String(v).trim());
export type Relation = "same_period" | "covering" | "tax_year" | "other_client";
export const RELATIONS: Relation[] = ["same_period", "covering", "tax_year", "other_client"];
export const RELATION_LABEL: Record<Relation, string> = {
  same_period: "Same client, same period end",
  covering: "Same client, the period it covers (accounts → tax)",
  tax_year: "Same client, same tax year",
  other_client: "A different client (you choose which)",
};
export type Template = {
  key: string; title: string; enabled: boolean; kind: "job" | "task";
  /** kind "job": the service of the prerequisite job. */ preService: string;
  /** kind "task": the information to be received; {period} becomes the period end. */ preTask: string;
  /** the stage the prerequisite job must reach (by name, so reordering stages doesn't break it). Blank = complete. */ preStage: string;
  depService: string; /** the stage of the dependent job that is held back (by name). Blank = the whole job. */ depStage: string;
  relation: Relation; type: DepType; verify: boolean; notes: string; version: number; created: string; createdBy: string;
};
export const readTemplate = (r: Row): Template => ({
  key: s(r.Key), title: s(r.Title), enabled: s(r.Enabled) === "yes" || r.Enabled === true, kind: s(r.PrerequisiteKind) === "task" ? "task" : "job",
  preService: s(r.PrerequisiteService), preTask: s(r.PrerequisiteTask), preStage: s(r.PrerequisiteStage), depService: s(r.DependentService), depStage: s(r.DependentStage),
  relation: (RELATIONS.includes(s(r.Relation) as Relation) ? s(r.Relation) : "same_period") as Relation, type: (DEP_TYPES.includes(s(r.DependencyType) as DepType) ? s(r.DependencyType) : "finish_to_start") as DepType,
  verify: s(r.VerificationRequired) === "yes" || r.VerificationRequired === true, notes: s(r.Notes), version: Number(r.Version) || 1, created: s(r.Created), createdBy: s(r.CreatedBy),
});
export const templateRow = (t: Template, practiceId = ""): Row => ({ Key: t.key, PracticeId: practiceId, Title: t.title, Enabled: t.enabled ? "yes" : "no", PrerequisiteKind: t.kind, PrerequisiteService: t.preService, PrerequisiteTask: t.preTask, PrerequisiteStage: t.preStage, DependentService: t.depService, DependentStage: t.depStage, Relation: t.relation, DependencyType: t.type, VerificationRequired: t.verify ? "yes" : "no", Notes: t.notes, Version: t.version, Created: t.created, CreatedBy: t.createdBy });

/** What is missing before a template can be switched on. Empty = complete. */
export function templateProblems(t: Template): string[] {
  const out: string[] = [];
  if (!t.title.trim()) out.push("Give it a name.");
  if (!t.depService) out.push("Choose the service that waits.");
  if (t.kind === "job" && !t.preService) out.push("Choose the service it waits for.");
  if (t.kind === "task" && !t.preTask.trim()) out.push("Say what information is awaited.");
  if (t.type === "stage" && t.kind === "job" && !t.preStage) out.push("A stage dependency needs the stage the other job must reach.");
  if (t.type === "partial" && !t.depStage) out.push("A partial dependency needs the one stage that is held back.");
  if (t.kind === "task" && (t.type === "stage")) out.push("A stage dependency needs a job to wait for, not information.");
  if (t.kind === "task" && t.relation !== "same_period") out.push("Information is always for the same client.");
  return out;
}

export const STARTERS: Omit<Template, "key" | "created" | "createdBy" | "version" | "enabled">[] = [
  { title: "Client records received → VAT preparation", kind: "task", preService: "", preTask: "VAT records for period ending {period}", preStage: "", depService: "", depStage: "", relation: "same_period", type: "information", verify: true, notes: "Choose the VAT service. A task for the client is made for each VAT job; it is not sent to them." },
  { title: "Bookkeeping finalised → Annual accounts preparation", kind: "job", preService: "", preTask: "", preStage: "", depService: "", depStage: "", relation: "same_period", type: "finish_to_start", verify: false, notes: "Choose bookkeeping and accounts services; add the stage of the accounts that is held back if only part waits." },
  { title: "Annual accounts approved → Corporation tax finalisation", kind: "job", preService: "", preTask: "", preStage: "", depService: "", depStage: "", relation: "covering", type: "stage", verify: false, notes: "Pick the accounts stage that means approved and the tax stage that is held back. Draft computation work is not held back unless you add it here. Companies House acceptance is not required." },
  { title: "Partnership accounts → Partners' Self Assessment", kind: "job", preService: "", preTask: "", preStage: "", depService: "", depStage: "", relation: "other_client", type: "partial", verify: false, notes: "The partnership and the partner are different clients, so each match is a review you confirm." },
  { title: "Payroll information received → Payroll processing", kind: "task", preService: "", preTask: "Payroll changes for period ending {period}", preStage: "", depService: "", depStage: "", relation: "same_period", type: "information", verify: true, notes: "" },
  { title: "Reconciliations → Management accounts finalisation", kind: "task", preService: "", preTask: "Reconciliations complete for period ending {period}", preStage: "", depService: "", depStage: "", relation: "same_period", type: "finish_to_start", verify: false, notes: "Add one template per reconciliation (bank, purchase ledger, sales ledger, payroll journals, stock)." },
];

// ---------------------------------------------------------------- matching
export type JobLite = { key: string; clientKey: string; serviceKey: string; periodEnd: string; status: string; title: string };
export const readJobLite = (r: Row): JobLite => ({ key: s(r.Key), clientKey: s(r.ClientKey), serviceKey: s(r.ServiceKey), periodEnd: s(r.PeriodEnd).slice(0, 10), status: s(r.Status), title: s(r.Title) });
const closed = (st: string) => st === "Complete" || st === "Done" || st === "Cancelled";
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
const monthsBetween = (a: string, b: string) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));
/** The tax year (6 April to 5 April) a date falls in, as its end date. */
export const taxYearEnd = (d: string) => { const y = Number(d.slice(0, 4)), after = d.slice(5) > "04-05"; return `${after ? y + 1 : y}-04-05`; };

export type Outcome =
  | { kind: "skip"; why: string }
  | { kind: "none"; why: string }
  | { kind: "link"; template: Template; dependent: JobLite; prerequisite: JobLite; depStage?: number; preStage?: number }
  | { kind: "task"; template: Template; dependent: JobLite; title: string; depStage?: number }
  | { kind: "review"; template: Template; dependent: JobLite; reason: string; candidates: JobLite[]; depStage?: number; preStage?: number };

export type Env = {
  jobs: JobLite[]; deps: Dependency[]; decisions: { templateKey: string; dependentKey: string }[];
  /** the stage names of a service, in order (position 1 first) */ stages: (service: string) => string[];
};
const stageNo = (names: string[], name: string) => { const i = names.findIndex((n) => n.trim().toLowerCase() === name.trim().toLowerCase()); return i < 0 ? undefined : i + 1; };

/** What one template says about one open job. Pure: it decides, it does not write. */
export function match(t: Template, job: JobLite, env: Env): Outcome {
  if (!t.enabled) return { kind: "skip", why: "Template is off." };
  if (templateProblems(t).length) return { kind: "skip", why: "Template is not finished." };
  if (job.serviceKey !== t.depService) return { kind: "skip", why: "Not this service." };
  if (closed(job.status)) return { kind: "skip", why: "Job is finished; its history is left alone." };
  if (env.deps.some((d) => d.templateKey === t.key && d.dependent.key === job.key)) return { kind: "skip", why: "Already created (or removed on purpose)." };
  if (env.decisions.some((d) => d.templateKey === t.key && d.dependentKey === job.key)) return { kind: "skip", why: "Marked as not applying." };
  const mine = env.stages(job.serviceKey);
  let depStage: number | undefined;
  if (t.depStage) { depStage = stageNo(mine, t.depStage); if (depStage === undefined) return { kind: "review", template: t, dependent: job, reason: `The stage "${t.depStage}" is no longer one of this job's stages.`, candidates: [] }; }
  if (!job.periodEnd) return { kind: "review", template: t, dependent: job, reason: "This job has no period end, so the right match can't be worked out.", candidates: [], depStage };
  if (t.kind === "task") return { kind: "task", template: t, dependent: job, title: t.preTask.replace(/\{period\}/g, job.periodEnd), depStage };

  const base = env.jobs.filter((j) => j.serviceKey === t.preService && j.key !== job.key && j.status !== "Cancelled");
  let preStage: number | undefined;
  const checkStage = (p: JobLite): string | undefined => { if (!t.preStage) return undefined; preStage = stageNo(env.stages(p.serviceKey), t.preStage); return preStage === undefined ? `The stage "${t.preStage}" is no longer one of that job's stages.` : undefined; };
  const finish = (cands: JobLite[], why: string, certain: boolean): Outcome => {
    if (!cands.length) return { kind: "none", why };
    if (cands.length === 1 && certain) {
      const bad = checkStage(cands[0]); if (bad) return { kind: "review", template: t, dependent: job, reason: bad, candidates: cands, depStage };
      return { kind: "link", template: t, dependent: job, prerequisite: cands[0], depStage, preStage };
    }
    return { kind: "review", template: t, dependent: job, reason: cands.length > 1 ? `More than one ${t.preService} job could apply. Choose the right one.` : why, candidates: cands, depStage };
  };
  if (t.relation === "same_period") { const c = base.filter((j) => j.clientKey === job.clientKey && j.periodEnd === job.periodEnd); return finish(c, `No ${t.preService} job exists yet for the period ending ${job.periodEnd}.`, true); }
  if (t.relation === "tax_year") { const y = taxYearEnd(job.periodEnd), c = base.filter((j) => j.clientKey === job.clientKey && j.periodEnd && taxYearEnd(j.periodEnd) === y); return finish(c, `No ${t.preService} job exists yet for the tax year ending ${y}.`, true); }
  if (t.relation === "covering") {
    const same = base.filter((j) => j.clientKey === job.clientKey && j.periodEnd === job.periodEnd);
    if (same.length) return finish(same, "", true);
    // The accounts period can be longer than twelve months, so a tax period that ends earlier may sit inside a later accounts period: that is for a person to confirm.
    const later = base.filter((j) => j.clientKey === job.clientKey && j.periodEnd > job.periodEnd && monthsBetween(job.periodEnd, j.periodEnd) <= 12);
    if (later.length) return { kind: "review", template: t, dependent: job, reason: `The ${t.preService} job ending ${later[0].periodEnd} may cover this period (an accounts period longer than 12 months covers more than one tax period). Confirm.`, candidates: later, depStage };
    return { kind: "none", why: `No ${t.preService} job exists yet for the period ending ${job.periodEnd}.` };
  }
  const y = taxYearEnd(job.periodEnd), c = base.filter((j) => j.clientKey !== job.clientKey && j.periodEnd && taxYearEnd(j.periodEnd) === y).slice(0, 12);
  return c.length ? { kind: "review", template: t, dependent: job, reason: "These are different clients and nothing records which belongs to which. Choose the matching one, or say none applies.", candidates: c, depStage } : { kind: "none", why: `No ${t.preService} job exists for the tax year ending ${y}.` };
}

export type Plan = { links: Extract<Outcome, { kind: "link" }>[]; tasks: Extract<Outcome, { kind: "task" }>[]; reviews: Extract<Outcome, { kind: "review" }>[]; nothing: number };
/** Every enabled template against the given open jobs. */
export function plan(templates: Template[], jobs: JobLite[], env: Env): Plan {
  const out: Plan = { links: [], tasks: [], reviews: [], nothing: 0 };
  for (const j of jobs) for (const t of templates) {
    const o = match(t, j, env);
    if (o.kind === "link") { if (createsCycle(depRef(o.prerequisite, o.preStage), depRef(o.dependent, o.depStage), env.deps)) out.reviews.push({ kind: "review", template: t, dependent: j, reason: "Linking these would make the work wait on itself.", candidates: [o.prerequisite], depStage: o.depStage }); else out.links.push(o); }
    else if (o.kind === "task") out.tasks.push(o); else if (o.kind === "review") out.reviews.push(o); else out.nothing++;
  }
  return out;
}
const depRef = (j: JobLite, stage?: number): Ref => ({ kind: "job", key: j.key, stage });

type Ctx = { user: string; now: string; key: () => string };
const baseDep = (t: Template, prerequisite: Ref, dependent: Ref, c: Ctx, outcome: Dependency["outcome"]): Dependency => ({ key: c.key(), prerequisite, dependent, type: t.type, outcome, verificationRequired: t.verify || t.type === "information", status: "active", expectedCompletion: "", resolvedAt: "", resolvedBy: "", overrideReason: "", templateKey: t.key, created: c.now, createdBy: c.user, version: 1 });

/** The dependency for a certain (or person-confirmed) job match. Returns reasons instead if it would not be valid. */
export function dependencyFor(o: { template: Template; dependent: JobLite; depStage?: number }, pre: JobLite, preStage: number | undefined, env: Env, c: Ctx): Dependency | { error: string } {
  const t = o.template, hasStage = preStage !== undefined;
  const d = baseDep(t, { kind: "job", key: pre.key, stage: preStage }, { kind: "job", key: o.dependent.key, stage: o.depStage }, c, hasStage ? "stage" : "complete");
  const known = { tasks: new Set<string>(), jobs: new Set(env.jobs.map((j) => j.key)) };
  const probs = validateDependency({ ...d, overrideReason: "" }, env.deps, known);
  return probs.length ? { error: probs[0] } : d;
}
/** The client task (information to be received) and the dependency on it. Not shared with the client; the capture key means a repeat can't make two. */
export function taskAndDependency(o: Extract<Outcome, { kind: "task" }>, c: Ctx & { taskKey: string }): { task: Row; dependency: Dependency } {
  const { template: t, dependent: j } = o;
  const task: Row = { Key: c.taskKey, Title: o.title.slice(0, 250), Area: "client", ClientKey: j.clientKey, JobKey: j.key, OwnerType: "contact", Status: "Not requested", AssignedUser: c.user, Description: `Needed for: ${j.title}`, CreatedBy: c.user, Created: c.now, Updated: c.now, Version: 1, PrivacyLevel: "shared", CaptureKey: `tpl:${t.key}:${j.key}` };
  return { task, dependency: baseDep(t, { kind: "task", key: c.taskKey }, { kind: "job", key: j.key, stage: o.depStage }, c, t.type === "approval" ? "approved" : "done") };
}

export const usage = (t: Template, deps: Dependency[]) => deps.filter((d) => d.templateKey === t.key);
export const decisionRow = (templateKey: string, dependentKey: string, c: Ctx, reason = "", practiceId = ""): Row => ({ Key: c.key(), PracticeId: practiceId, TemplateKey: templateKey, DependentKey: dependentKey, Decision: "not-applicable", Reason: reason, Created: c.now, CreatedBy: c.user });
