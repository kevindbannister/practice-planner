// Dependencies are records of their own (never inferred from titles or statuses). One dependency says: "this dependent thing cannot do this, until
// that prerequisite thing reaches this outcome". Both sides point at a stable key of a known kind; a stage is named only for a job.
// Phase 1 defines the record, the checks that keep the graph sound, and the history. Readiness and risk are calculated in later phases from these records.
import { Row } from "../schema";

const s = (v: unknown) => (v == null ? "" : String(v).trim());

/** What a dependency can point at. `info` is a piece of information to be received and verified (for example "VAT invoices"); it is held as its own task, so it is
 *  still a task key, but the kind makes the intent explicit and lets screens say "waiting for information". */
export type EntityKind = "task" | "job" | "info";
export type Ref = { kind: EntityKind; key: string; /** only for kind job: a stage number the job must reach (prerequisite) or that is held back (dependent) */ stage?: number };
export type DepType = "finish_to_start" | "stage" | "approval" | "information" | "partial";
export const DEP_TYPES: DepType[] = ["finish_to_start", "stage", "approval", "information", "partial"];
export const DEP_LABEL: Record<DepType, string> = { finish_to_start: "Must be finished first", stage: "Job must reach a stage", approval: "Needs approval", information: "Information must be received and checked", partial: "Holds back one stage only" };
export type DepStatus = "active" | "satisfied" | "overridden" | "cancelled";

export type Dependency = {
  key: string; prerequisite: Ref; dependent: Ref;
  type: DepType;
  /** What the prerequisite must reach. For a task: "done". For a job: "stage" (see prerequisite.stage) or "complete" or "approved". Free text is not allowed. */
  outcome: "done" | "stage" | "complete" | "approved";
  /** The practice must check the result before this is satisfied (true for anything a client or outside party supplies). */
  verificationRequired: boolean;
  status: DepStatus; expectedCompletion: string; resolvedAt: string; resolvedBy: string; overrideReason: string; templateKey: string;
  created: string; createdBy: string; version: number;
};

export const readDependency = (r: Row): Dependency => ({
  key: s(r.Key), prerequisite: { kind: (s(r.PrerequisiteType) as EntityKind) || "task", key: s(r.PrerequisiteKey), stage: num(r.PrerequisiteStage) },
  dependent: { kind: (s(r.DependentType) as EntityKind) || "task", key: s(r.DependentKey), stage: num(r.DependentStage) },
  type: (DEP_TYPES.includes(s(r.DependencyType) as DepType) ? s(r.DependencyType) : "finish_to_start") as DepType,
  outcome: (["done", "stage", "complete", "approved"].includes(s(r.RequiredOutcome)) ? s(r.RequiredOutcome) : "done") as Dependency["outcome"],
  verificationRequired: s(r.VerificationRequired) === "yes" || r.VerificationRequired === true,
  status: (["active", "satisfied", "overridden", "cancelled"].includes(s(r.Status)) ? s(r.Status) : "active") as DepStatus,
  expectedCompletion: s(r.ExpectedCompletion).slice(0, 10), resolvedAt: s(r.ResolvedAt), resolvedBy: s(r.ResolvedBy), overrideReason: s(r.OverrideReason), templateKey: s(r.TemplateKey),
  created: s(r.Created), createdBy: s(r.CreatedBy), version: num(r.Version) ?? 1,
});
function num(v: unknown): number | undefined { const x = typeof v === "number" ? v : parseFloat(s(v)); return Number.isFinite(x) ? x : undefined; }

export const dependencyRow = (d: Dependency, practiceId = ""): Row => ({
  Key: d.key, PracticeId: practiceId, PrerequisiteType: d.prerequisite.kind, PrerequisiteKey: d.prerequisite.key, PrerequisiteStage: d.prerequisite.stage ?? "",
  DependentType: d.dependent.kind, DependentKey: d.dependent.key, DependentStage: d.dependent.stage ?? "", DependencyType: d.type, RequiredOutcome: d.outcome,
  VerificationRequired: d.verificationRequired ? "yes" : "no", Status: d.status, ExpectedCompletion: d.expectedCompletion, ResolvedAt: d.resolvedAt, ResolvedBy: d.resolvedBy,
  OverrideReason: d.overrideReason, TemplateKey: d.templateKey, Created: d.created, CreatedBy: d.createdBy, Version: d.version,
});

export type Known = { tasks: Set<string>; jobs: Set<string>; /** stage numbers each job has, when known */ stages?: Map<string, Set<number>> };

/** Checks a proposed dependency against everything already stored. Returns reasons it is refused, in plain English; empty means it is allowed. */
export function validateDependency(d: Pick<Dependency, "prerequisite" | "dependent" | "type" | "outcome" | "overrideReason" | "status">, existing: Dependency[], known: Known, selfKey = ""): string[] {
  const out: string[] = [];
  const { prerequisite: p, dependent: q } = d;
  if (!p.key || !q.key) return ["Both sides of a dependency need to be chosen."];
  const exists = (r: Ref) => (r.kind === "job" ? known.jobs.has(r.key) : known.tasks.has(r.key));
  if (!exists(p)) out.push("The prerequisite doesn't exist any more.");
  if (!exists(q)) out.push("The work that depends on it doesn't exist any more.");
  if (p.kind === q.kind && p.key === q.key && (p.stage ?? -1) === (q.stage ?? -1)) out.push("Something can't depend on itself.");
  if (p.stage !== undefined && p.kind !== "job") out.push("Only a job has stages.");
  if (q.stage !== undefined && q.kind !== "job") out.push("Only a job has stages.");
  if (d.type === "stage" && (p.kind !== "job" || p.stage === undefined)) out.push("A stage dependency needs a job and the stage it must reach.");
  if (d.type === "partial" && (q.kind !== "job" || q.stage === undefined)) out.push("A partial dependency needs the one stage of the job that is held back.");
  if (d.outcome === "stage" && p.stage === undefined) out.push("Say which stage the job must reach.");
  if (p.kind === "job" && p.stage !== undefined && known.stages) { const st = known.stages.get(p.key); if (st && !st.has(p.stage)) out.push("That job has no such stage."); }
  if (q.kind === "job" && q.stage !== undefined && known.stages) { const st = known.stages.get(q.key); if (st && !st.has(q.stage)) out.push("That job has no such stage."); }
  if (d.status === "overridden" && !s(d.overrideReason)) out.push("Overriding a dependency needs a reason.");
  const live = existing.filter((x) => x.key !== selfKey && (x.status === "active" || x.status === "satisfied"));
  if (live.some((x) => sameRef(x.prerequisite, p) && sameRef(x.dependent, q) && x.type === d.type)) out.push("That dependency already exists.");
  if (!out.length && createsCycle(d.prerequisite, d.dependent, live)) out.push("That would make the work wait on itself, directly or through other work.");
  return out;
}
const sameRef = (a: Ref, b: Ref) => a.kind === b.kind && a.key === b.key && (a.stage ?? -1) === (b.stage ?? -1);
const nodeOf = (r: Ref) => `${r.kind === "job" ? "job" : "task"}:${r.key}`; // cycles are checked per piece of work, not per stage: a job can't wait on something that waits on that job

/** Would adding "dependent waits for prerequisite" create a loop? Walks the existing edges from the prerequisite back to the dependent. */
export function createsCycle(prerequisite: Ref, dependent: Ref, existing: Dependency[]): boolean {
  const target = nodeOf(dependent), start = nodeOf(prerequisite);
  if (start === target) return !(prerequisite.kind === "job" && dependent.kind === "job" && prerequisite.stage !== dependent.stage);
  const waitsFor = new Map<string, string[]>(); // node -> what it waits for
  for (const e of existing) { if (e.status === "cancelled") continue; const k = nodeOf(e.dependent); waitsFor.set(k, [...(waitsFor.get(k) || []), nodeOf(e.prerequisite)]); }
  const seen = new Set<string>(), stack = [start];
  while (stack.length) { const x = stack.pop()!; if (x === target) return true; if (seen.has(x)) continue; seen.add(x); for (const y of waitsFor.get(x) || []) stack.push(y); }
  return false;
}

/** Dependencies whose either side no longer exists. They are kept (history), reported, and never silently dropped or treated as satisfied. */
export function missingPrerequisites(deps: Dependency[], known: Known): { dep: Dependency; side: "prerequisite" | "dependent" }[] {
  const exists = (r: Ref) => (r.kind === "job" ? known.jobs.has(r.key) : known.tasks.has(r.key));
  const out: { dep: Dependency; side: "prerequisite" | "dependent" }[] = [];
  for (const d of deps) { if (d.status === "cancelled") continue; if (!exists(d.prerequisite)) out.push({ dep: d, side: "prerequisite" }); if (!exists(d.dependent)) out.push({ dep: d, side: "dependent" }); }
  return out;
}

export type DepEventType = "create" | "satisfy" | "reopen" | "override" | "cancel" | "change";
export type DepEvent = { key: string; dependencyKey: string; type: DepEventType; at: string; by: string; before: string; after: string; reason: string };
export const readDepEvent = (r: Row): DepEvent => ({ key: s(r.Key), dependencyKey: s(r.DependencyKey), type: s(r.EventType) as DepEventType, at: s(r.Created), by: s(r.CreatedBy), before: s(r.Before), after: s(r.After), reason: s(r.Reason) });
export const depEventRow = (e: DepEvent, practiceId = ""): Row => ({ Key: e.key, PracticeId: practiceId, DependencyKey: e.dependencyKey, EventType: e.type, Created: e.at, CreatedBy: e.by, Before: e.before, After: e.after, Reason: e.reason });

/** Satisfy, reopen, override or cancel a dependency. Each returns the changed record and the event to append; the old state stays in the event. Never edits history. */
export function transition(d: Dependency, to: "satisfied" | "active" | "overridden" | "cancelled", i: { by: string; now: string; reason?: string; eventKey: string }): { dep?: Dependency; event?: DepEvent; error?: string } {
  if (d.status === to) return { error: "Nothing to change." };
  if (to === "overridden" && !s(i.reason)) return { error: "Overriding a dependency needs a reason." };
  if (d.status === "cancelled" && to !== "active") return { error: "A cancelled dependency can only be reinstated." };
  const type: DepEventType = to === "satisfied" ? "satisfy" : to === "overridden" ? "override" : to === "cancelled" ? "cancel" : "reopen";
  const next: Dependency = { ...d, status: to, version: d.version + 1, resolvedAt: to === "satisfied" || to === "overridden" ? i.now : "", resolvedBy: to === "satisfied" || to === "overridden" ? i.by : "", overrideReason: to === "overridden" ? s(i.reason) : to === "active" ? "" : d.overrideReason };
  return { dep: next, event: { key: i.eventKey, dependencyKey: d.key, type, at: i.now, by: i.by, before: d.status, after: to, reason: s(i.reason) } };
}
