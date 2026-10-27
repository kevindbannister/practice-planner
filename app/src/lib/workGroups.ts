// The client's Work tab: which jobs are statutory work and which are other services, in what order, and which are
// waiting on the client. Pure functions so they can be tested.
import { Row } from "./schema";
import { inFinalise, isWaitStage, stageAt } from "./waiting";

/** Types of work that carry a statutory deadline, unless Settings says otherwise (Services › Statutory deadline). */
const STATUTORY_KEYS = /^(ACCS|SE_ACCOUNTS|CHARITY_ACCOUNTS|CT600|SA800|SA100|VAT|PAYROLL|CIS|P11D|MTD|CS01)/;

export function isStatutory(service: Row | undefined, serviceKey: string | undefined): boolean {
  const set = String(service?.Statutory ?? "");
  if (set === "yes") return true;
  if (set === "no") return false;
  return STATUTORY_KEYS.test(String(serviceKey || ""));
}

/** Where a type of work sits among statutory work: accounts, corporation tax or partnership return, VAT, payroll, P11D, confirmation statement, personal tax, MTD. */
export function statutoryRank(serviceKey: string | undefined): number {
  const k = String(serviceKey || "");
  if (/^(ACCS|SE_ACCOUNTS|CHARITY_ACCOUNTS)/.test(k)) return 1;
  if (k === "CT600" || k === "SA800") return 2;
  if (k === "VAT") return 3;
  if (k === "PAYROLL") return 4;
  if (k === "CIS") return 5; // payroll-like monthly return: next to payroll, before P11D
  if (/^P11D/.test(k)) return 6;
  if (k === "CS01") return 7;
  if (k === "SA100") return 8;
  if (/^MTD/.test(k)) return 9;
  return 10; // statutory because Settings says so, but not one of the usual ones
}

export type WorkSections = { statutory: Row[]; other: Row[] };

/** Open jobs split into statutory and other, each in a steady order: type of work first, then nearest deadline. */
export function sectionJobs(jobs: Row[], services: Row[], name: (key: string) => string): WorkSections {
  const byKey = new Map(services.map((s) => [String(s.Key), s]));
  const cmp = (a: Row, b: Row) =>
    statutoryRank(a.ServiceKey as string) - statutoryRank(b.ServiceKey as string)
    || name(String(a.ServiceKey || "")).localeCompare(name(String(b.ServiceKey || "")))
    || String(a.Deadline || "9999").localeCompare(String(b.Deadline || "9999"))
    || String(a.PeriodEnd || "").localeCompare(String(b.PeriodEnd || ""));
  const statutory = jobs.filter((j) => isStatutory(byKey.get(String(j.ServiceKey)), j.ServiceKey as string)).sort(cmp);
  const other = jobs.filter((j) => !statutory.includes(j)).sort((a, b) => name(String(a.ServiceKey || "")).localeCompare(name(String(b.ServiceKey || ""))) || String(a.Deadline || "9999").localeCompare(String(b.Deadline || "9999")));
  return { statutory, other };
}

export type Waiting = { job: Row; reason: string; since?: string; chaseOn?: string };

/** Jobs that are with the client: at a "with the client" stage, prepared and waiting to finalise, or still missing records that have been chased. */
export function waitingOnClient(jobs: Row[], stagesOf: (job: Row) => Row[]): Waiting[] {
  const out: Waiting[] = [];
  for (const j of jobs) {
    if (j.Status === "Complete") continue;
    const stages = stagesOf(j);
    const atWait = isWaitStage(stageAt(stages, Number(j.StageNo || 1)));
    if (atWait || inFinalise(j)) {
      out.push({ job: j, reason: atWait ? "With the client" : "Prepared: waiting to finalise", since: (j.WaitingSince as string) || undefined, chaseOn: (j.SpeakOn as string) || undefined });
    } else if (!j.RecordsReceived && Number(j.ChaseCount) > 0) {
      out.push({ job: j, reason: "Records chased, not in yet", chaseOn: (j.RecordsExpected as string) || undefined });
    }
  }
  return out;
}
