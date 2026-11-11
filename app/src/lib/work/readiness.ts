// Readiness: whether a piece of work can be done now, worked out live from the dependency records and the real state of what they point at.
// Readiness is kept apart from workflow status: a job can be "Accounts preparation" (status) and "Partly ready" (readiness) at once.
// Nothing here changes a deadline, and nothing guesses: a prerequisite that has no known completion date is reported as unknown, not given a date.
import { Dependency, Ref, transition, DepEvent } from "./dependencies";
import { WorkTask, isDone } from "./model";

export type Readiness = "ready" | "partly_ready" | "blocked" | "waiting" | "on_hold" | "complete";
export const READINESS_LABEL: Record<Readiness, string> = { ready: "Ready", partly_ready: "Partly ready", blocked: "Blocked", waiting: "Waiting", on_hold: "On hold", complete: "Complete" };

export type JobInfo = { key: string; title: string; status: string; stageNo: number; stageCount: number; onHold: boolean; clientKey?: string; deadline?: string };
export type World = {
  deps: Dependency[];
  tasks: Map<string, WorkTask>;
  jobs: Map<string, JobInfo>;
  /** True when the practice has checked and accepted this task (a `verified` history entry). */
  verified: (taskKey: string) => boolean;
  stageName?: (jobKey: string, stage: number) => string;
};

export type EvalState = "met" | "unmet" | "overridden" | "missing" | "conflict" | "ignored";
export type DepEval = { dep: Dependency; state: EvalState; /** plain-English reason it is not met (or why it is) */ reason: string; /** true when the record says satisfied but the live facts no longer agree */ reopened: boolean; expected: string; expectedKnown: boolean };

const stageText = (w: World, job: string, st?: number) => (st === undefined ? "" : w.stageName?.(job, st) || `stage ${st}`);
export const labelOf = (r: Ref, w: World): string => (r.kind === "job" ? w.jobs.get(r.key)?.title : w.tasks.get(r.key)?.title) || "something that no longer exists";

/** The live state of one dependency. The stored status is a record of what someone decided; this is what is true now. */
export function evaluate(dep: Dependency, w: World): DepEval {
  const out = (state: EvalState, reason: string, reopened = false): DepEval => ({ dep, state, reason, reopened: reopened && dep.status === "satisfied", expected: dep.expectedCompletion, expectedKnown: !!dep.expectedCompletion });
  if (dep.status === "cancelled") return out("ignored", "Cancelled.");
  if (dep.status === "overridden") return out("overridden", `Overridden${dep.resolvedBy ? ` by ${dep.resolvedBy}` : ""}: ${dep.overrideReason}`);
  const p = dep.prerequisite, name = labelOf(p, w);
  const unmet = (reason: string) => out("unmet", reason, true);
  if (p.kind === "job") {
    const j = w.jobs.get(p.key);
    if (!j) return out("missing", `${name} no longer exists.`);
    if (j.status === "Cancelled") return out("conflict", `${name} was cancelled. Remove this dependency or point it at something else.`);
    const complete = j.status === "Complete" || j.status === "Done";
    if (dep.outcome === "complete" || (dep.outcome === "done")) return complete ? out("met", `${name} is complete.`) : unmet(`${name} is not complete.`);
    if (p.stage === undefined) return out("conflict", `No stage is chosen for ${name}, so this can't be checked.`);
    if (j.stageCount && p.stage > j.stageCount) return out("conflict", `${name} no longer has stage ${p.stage}.`);
    if (complete || j.stageNo >= p.stage) return out("met", `${name} has reached ${stageText(w, p.key, p.stage)}.`);
    return unmet(`${name} has not reached ${stageText(w, p.key, p.stage)}.`);
  }
  const t = w.tasks.get(p.key);
  if (!t) return out("missing", `${name} no longer exists.`);
  if (t.status === "Cancelled") return out("conflict", `${name} was cancelled. Remove this dependency or point it at something else.`);
  if (!isDone(t.status)) return unmet(`${name} is not done${t.status === "Submitted" || t.status === "Under review" ? " (the client has sent it; it still needs checking)" : ""}.`);
  const checkNeeded = dep.verificationRequired || dep.type === "information";
  if (checkNeeded && t.ownerType !== "user" && !w.verified(t.key)) return unmet(`${name} was marked done but has not been checked.`);
  return out("met", `${name} is done${checkNeeded && t.ownerType !== "user" ? " and checked" : ""}.`);
}

const refIs = (a: Ref, kind: "task" | "job", key: string) => (a.kind === "job" ? "job" : "task") === kind && a.key === key;
const blocksNow = (e: DepEval) => e.state === "unmet" || e.state === "missing" || e.state === "conflict";
export type Assessment = { readiness: Readiness; reasons: string[]; blockers: DepEval[]; held: number[]; unknownDates: DepEval[] };

/** Readiness of a task (or info item) or a whole job. Jobs with stage-scoped dependencies are "partly ready" until they reach the held stage. */
export function assess(kind: "task" | "job", key: string, w: World): Assessment {
  const mine = w.deps.filter((d) => refIs(d.dependent, kind, key)).map((d) => evaluate(d, w));
  const open = mine.filter(blocksNow);
  const base = (readiness: Readiness, reasons: string[] = [], held: number[] = []): Assessment => ({ readiness, reasons, blockers: open, held, unknownDates: open.filter((e) => !e.expectedKnown) });
  if (kind === "task") {
    const t = w.tasks.get(key); if (!t) return base("complete", ["This task no longer exists."]);
    if (t.status === "Done" || t.status === "Complete") return base("complete");
    if (t.status === "Cancelled") return base("complete", ["Cancelled."]);
    if (t.status === "On hold") return base("on_hold", t.blockedReason ? [t.blockedReason] : []);
    if (open.length) return base("blocked", open.map((e) => `Blocked because ${e.reason}`));
    if (t.ownerType !== "user") return base("waiting", [`Waiting for ${t.responsible || (t.ownerType === "contact" ? "the client" : "someone else")}.`]);
    return base("ready");
  }
  const j = w.jobs.get(key); if (!j) return base("complete", ["This job no longer exists."]);
  if (j.status === "Complete" || j.status === "Done" || j.status === "Cancelled") return base("complete", j.status === "Cancelled" ? ["Cancelled."] : []);
  if (j.onHold) return base("on_hold");
  const whole = open.filter((e) => e.dep.dependent.stage === undefined);
  if (whole.length) return base("blocked", whole.map((e) => `Blocked because ${e.reason}`));
  const held = [...new Set(open.map((e) => e.dep.dependent.stage as number))].sort((a, b) => a - b);
  if (!held.length) return base("ready");
  const now = open.filter((e) => e.dep.dependent.stage === j.stageNo);
  if (now.length) return base("blocked", now.map((e) => `Can't continue ${stageText(w, key, j.stageNo)} because ${e.reason}`), held);
  return base("partly_ready", open.map((e) => `Can continue until ${stageText(w, key, e.dep.dependent.stage)}, which waits because ${e.reason}`), held);
}

/** Remaining hours of a job split into what can be worked now and what is held behind an unmet dependency. Needs each stage's hours; without them it says it can't split rather than guessing. */
export function splitHours(remaining: number, stageHours: Map<number, number>, held: number[], currentStage: number): { actionable: number; blocked: number; split: boolean } {
  if (!held.length) return { actionable: remaining, blocked: 0, split: true };
  const later = [...stageHours.entries()].filter(([n]) => n >= currentStage), total = later.reduce((a, [, h]) => a + h, 0);
  if (total <= 0) return { actionable: held.includes(currentStage) ? 0 : remaining, blocked: held.includes(currentStage) ? remaining : 0, split: false };
  const blockedShare = later.filter(([n]) => held.includes(n)).reduce((a, [, h]) => a + h, 0) / total;
  const blocked = Math.round(remaining * blockedShare * 100) / 100;
  return { actionable: Math.round((remaining - blocked) * 100) / 100, blocked, split: true };
}

// ---------------------------------------------------------------- the chain
export type ChainNode = { kind: "task" | "job"; key: string; label: string; depth: number; readiness: Readiness; reason: string; /** nothing earlier is in its way */ actionable: boolean };
/** Everything a piece of work is waiting on, nearest first, and the earliest steps that can actually be done. */
export function chain(kind: "task" | "job", key: string, w: World, maxDepth = 25): { nodes: ChainNode[]; earliest: ChainNode[] } {
  const nodes: ChainNode[] = [], seen = new Set<string>([`${kind}:${key}`]);
  const walk = (k: "task" | "job", id: string, depth: number) => {
    if (depth > maxDepth) return;
    for (const e of w.deps.filter((d) => refIs(d.dependent, k, id)).map((d) => evaluate(d, w)).filter(blocksNow)) {
      const pk: "task" | "job" = e.dep.prerequisite.kind === "job" ? "job" : "task", id2 = e.dep.prerequisite.key, tag = `${pk}:${id2}`;
      if (seen.has(tag)) continue; seen.add(tag);
      const a = assess(pk, id2, w);
      nodes.push({ kind: pk, key: id2, label: labelOf(e.dep.prerequisite, w), depth, readiness: a.readiness, reason: e.reason, actionable: !a.blockers.length && a.readiness !== "complete" && a.readiness !== "on_hold" });
      walk(pk, id2, depth + 1);
    }
  };
  walk(kind, key, 1);
  return { nodes, earliest: nodes.filter((n) => n.actionable) };
}
export const blockedTaskKeys = (w: World): Set<string> => { const s = new Set<string>(); for (const k of w.tasks.keys()) if (assess("task", k, w).readiness === "blocked") s.add(k); return s; };

// ---------------------------------------------------------------- integrity
export type Issue = { depKey: string; kind: "missing" | "cancelled" | "stage-gone" | "cycle" | "reopened" | "past-held" | "stale" | "no-reason" | "duplicate"; severity: "error" | "warn" | "info"; text: string };
export function integrity(w: World): Issue[] {
  const out: Issue[] = [], live = w.deps.filter((d) => d.status !== "cancelled");
  const add = (d: Dependency, kind: Issue["kind"], severity: Issue["severity"], text: string) => out.push({ depKey: d.key, kind, severity, text });
  const seen = new Map<string, string>();
  const node = (r: Ref) => `${r.kind === "job" ? "job" : "task"}:${r.key}`;
  const edges = new Map<string, string[]>(); for (const d of live) edges.set(node(d.dependent), [...(edges.get(node(d.dependent)) || []), node(d.prerequisite)]);
  const inCycle = (start: string) => { const st = [...(edges.get(start) || [])], vis = new Set<string>(); while (st.length) { const x = st.pop()!; if (x === start) return true; if (vis.has(x)) continue; vis.add(x); st.push(...(edges.get(x) || [])); } return false; };
  for (const d of live) {
    const e = evaluate(d, w);
    if (e.state === "missing") add(d, "missing", "error", e.reason);
    const dep = d.dependent.kind === "job" ? w.jobs.get(d.dependent.key) : w.tasks.get(d.dependent.key);
    if (!dep) add(d, "missing", "error", `The work that waits on ${labelOf(d.prerequisite, w)} no longer exists.`);
    if (e.state === "conflict") add(d, e.reason.includes("stage") ? "stage-gone" : "cancelled", "error", e.reason);
    if (e.reopened) add(d, "reopened", "warn", `Recorded as satisfied, but ${e.reason.charAt(0).toLowerCase()}${e.reason.slice(1)}`);
    if (d.status === "overridden" && !d.overrideReason.trim()) add(d, "no-reason", "warn", "Overridden without a reason.");
    if (inCycle(node(d.dependent))) add(d, "cycle", "error", `${labelOf(d.dependent, w)} waits on itself through other work.`);
    const key = `${d.type}|${node(d.prerequisite)}|${d.prerequisite.stage ?? ""}|${node(d.dependent)}|${d.dependent.stage ?? ""}`;
    if (seen.has(key)) add(d, "duplicate", "info", "The same dependency is recorded twice."); else seen.set(key, d.key);
    if (d.dependent.kind === "job" && d.dependent.stage !== undefined && blocksNow(e)) { const j = w.jobs.get(d.dependent.key); if (j && j.stageNo > d.dependent.stage) add(d, "past-held", "warn", `${j.title} has moved past ${stageText(w, j.key, d.dependent.stage)} while ${labelOf(d.prerequisite, w)} is still outstanding.`); }
    if (d.status === "active" && dep && (("status" in dep && ["Done", "Complete", "Cancelled"].includes(dep.status)))) add(d, "stale", "info", "This work is finished, so the dependency no longer holds anything back.");
  }
  return out;
}

// ---------------------------------------------------------------- keeping the records in step
/** Records that should change because the facts have: satisfied now that the prerequisite is met (and checked), reopened when it went back. Applied by the screen, not by this function. */
export function syncPlan(w: World, c: { by: string; now: string; key: () => string }): { dep: Dependency; event: DepEvent }[] {
  const out: { dep: Dependency; event: DepEvent }[] = [];
  for (const d of w.deps) {
    const e = evaluate(d, w);
    const to = d.status === "active" && e.state === "met" ? "satisfied" : d.status === "satisfied" && (e.state === "unmet") ? "active" : undefined;
    if (!to) continue;
    const r = transition(d, to, { by: c.by, now: c.now, eventKey: c.key(), reason: to === "satisfied" ? e.reason : e.reason });
    if (r.dep && r.event) out.push({ dep: r.dep, event: r.event });
  }
  return out;
}
