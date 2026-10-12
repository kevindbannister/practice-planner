// Waiting for the client: some stages mean the work is with the client (accounts sent for
// approval, a tax return sent to sign). When a job reaches one, the preparing is done: the
// job comes off the board, remembers when you're speaking to the client, and comes back as
// "Finalise" with just the time finalising takes.
import { Job } from "./domain";
import { jobHours } from "./planning";
import { Row } from "./schema";

/** Stage names that sound like "with the client for approval" (used to tick them the first time). */
export function looksLikeWaitStage(title: string): boolean {
  const t = title.toLowerCase();
  if (/received|approved|complete|filed|filing/.test(t)) return false;
  return /(sent?|request).*(approval|confirmation)/.test(t) || /(approval|confirmation).*request/.test(t);
}

const ordered = (stages: Row[]) => [...stages].sort((a, b) => Number(a.StageNo) - Number(b.StageNo));

export function isWaitStage(stage?: Row): boolean {
  return !!stage && (stage.WaitClient === true || stage.WaitClient === "true" || stage.WaitClient === 1);
}

export function stageAt(stages: Row[], no: number): Row | undefined {
  return stages.find((s) => Number(s.StageNo) === no);
}

/** The first "waiting for the client" stage number, if the type of work has one. */
export function firstWaitStage(stages: Row[]): number | undefined {
  const s = ordered(stages).find(isWaitStage);
  return s ? Number(s.StageNo) : undefined;
}

/** The job is sitting at a stage where it's with the client. */
export function waitingForClient(job: Row, stages: Row[]): boolean {
  if (job.Status === "Complete") return false;
  return isWaitStage(stageAt(stages, Number(job.StageNo || 1)));
}

/** The preparing is done and what's left is finalising. */
export function inFinalise(job: Row): boolean {
  return !!job.WaitingSince;
}

const FINALISE_DEFAULTS: Record<string, number> = { SA100: 0.5, SA800: 0.5, VAT: 0.5, CS01: 0.25 };

/** The usual time to finalise a type of work (Settings › Types of work), else a sensible default. */
export function finaliseDefault(serviceKey: string | undefined, services: Row[]): number {
  const svc = services.find((s) => s.Key === serviceKey);
  const set = Number(svc?.FinaliseHours);
  if (set > 0) return set;
  return FINALISE_DEFAULTS[serviceKey || ""] ?? 1;
}

/** Hours still to plan for a job: the finalising time once it's been prepared, else the whole job. */
export function planHours(job: Job | Row, services: Row[]): number {
  if (inFinalise(job)) {
    const own = Number(job.FinaliseHours);
    return own > 0 ? own : finaliseDefault(job.ServiceKey as string, services);
  }
  return jobHours(job as Job, services);
}

/**
 * Moving a job onto a waiting stage: it comes off the board, and the preparing is recorded on
 * the day it was planned (if that's passed) or today.
 */
export function waitPatch(job: Row, to: Row, speakOn: string, finaliseHours: number, today: string, services: Row[]): Row {
  const planned = job.PlannedDate as string | undefined;
  const whole = jobHours(job as Job, services);
  return {
    ...to,
    WaitingSince: today,
    SpeakOn: speakOn || "",
    FinaliseHours: finaliseHours,
    PreparedOn: planned && planned <= today ? planned : today,
    PreparedHours: Math.max(0, Math.round((whole - finaliseHours) * 4) / 4),
    PlannedDate: "",
  };
}

/** Going back to a stage before the client had it: it's a whole job again. */
export const unwaitPatch = (): Row => ({ WaitingSince: "", SpeakOn: "", FinaliseHours: "", PreparedOn: "", PreparedHours: "" });

export type WaitState = "today" | "passed" | "later" | "nodate";
export function waitState(job: Row, today: string): WaitState {
  const d = job.SpeakOn as string | undefined;
  if (!d) return "nodate";
  return d === today ? "today" : d < today ? "passed" : "later";
}

/** Jobs already sitting at a stage that's just been marked "with the client": they're prepared, so finalising is what's left. */
export function adoptWaitingJobs(jobs: Row[], stages: Row[], services: Row[], today: string): { row: Row; patch: Row }[] {
  return jobs
    .filter((j) => j.Status !== "Complete" && !inFinalise(j))
    .filter((j) => {
      const s = stageAt(stages.filter((x) => x.ServiceKey === j.ServiceKey), Number(j.StageNo || 1));
      return isWaitStage(s);
    })
    .map((j) => ({ row: j, patch: { WaitingSince: today, FinaliseHours: finaliseDefault(j.ServiceKey as string, services) } }));
}

/** Stages to tick the first time: those whose names sound like "with the client for approval". */
export function initialWaitStages(stages: Row[]): Row[] {
  return stages.filter((s) => !isWaitStage(s) && looksLikeWaitStage(String(s.Title || "")));
}
