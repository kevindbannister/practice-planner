// Accounts production: where each company's accounts for a year have got to. The statuses are the ones IRIS Elements
// uses on its accounts (Draft, Final, Ready for client, Sent to client, Awaiting signature, Approved, Submitted to CH), so
// the planner and Elements say the same thing. The statutory accounts themselves are made in Elements; this only keeps track.
// A status is kept with the company's working papers for the year (WorkingPapers, ItemKey "_accounts"). No row means not started.
import { Client, Job, isOpen, jobState } from "./domain";
import { progress, readSetup, setupRow, Setup } from "./papers";
import { Row } from "./schema";
import { waitingForClient } from "./waiting";
import { stageLabel } from "./stages";

export const ACCOUNTS_STATUSES = [
  { key: "draft", label: "Draft" },
  { key: "final", label: "Final" },
  { key: "ready", label: "Ready for client" },
  { key: "sent", label: "Sent to client" },
  { key: "signature", label: "Awaiting signature" },
  { key: "approved", label: "Approved" },
  { key: "ch", label: "Submitted to CH" },
] as const;
export type AccountsStatus = (typeof ACCOUNTS_STATUSES)[number]["key"];
export type StatusFilter = AccountsStatus | "none";
export const ACCOUNTS_ITEM = "_accounts";
export const STATUS_NAME: Record<StatusFilter, string> = { none: "Not started", ...Object.fromEntries(ACCOUNTS_STATUSES.map((s) => [s.key, s.label])) } as Record<StatusFilter, string>;
const ACCOUNTS_SERVICES = new Set(["ACCS_LTD", "ACCS_LLP"]);

export const asStatus = (v: unknown): AccountsStatus | "" => (ACCOUNTS_STATUSES.some((s) => s.key === v) ? (v as AccountsStatus) : "");

export type StatusInfo = { status: AccountsStatus | ""; at: string; by: string };
export function accountsStatusOf(rows: Row[], clientKey: string, period: string): StatusInfo {
  const s = readSetup(setupRow(rows, clientKey, period, ACCOUNTS_ITEM));
  return { status: asStatus(s.status), at: typeof s.at === "string" ? s.at : "", by: typeof s.by === "string" ? s.by : "" };
}
/** The setup to save when the status changes; choosing nothing clears it. */
export function statusSetup(prev: Setup, status: AccountsStatus | "", who: string, now: string): Setup {
  return { ...prev, status: status || undefined, at: status ? now : undefined, by: status ? who : undefined };
}

export type ProductionRow = {
  job: Job; client: Client; period: string; deadline: string; days?: number; late: boolean;
  status: AccountsStatus | ""; statusAt: string; stage: string; waiting: boolean; done: number; total: number; complete: boolean;
};
/** One row per accounts job (company and LLP), with its status, stage, papers progress and deadline, soonest deadline first. */
export function productionRows(i: { jobs: Job[]; clients: Map<string, Client>; papers: Row[]; stagesByService: Map<string, Row[]>; today: string; showComplete?: boolean }): ProductionRow[] {
  const out: ProductionRow[] = [];
  for (const job of i.jobs) {
    if (!ACCOUNTS_SERVICES.has(job.ServiceKey || "") || !job.PeriodEnd) continue;
    const complete = !isOpen(job) || !!job.CompletedDate;
    if (complete && !i.showComplete) continue;
    const client = i.clients.get(job.ClientKey);
    if (!client) continue;
    const st = accountsStatusOf(i.papers, job.ClientKey, job.PeriodEnd);
    const js = jobState(job, i.today);
    const p = progress(job.ClientKey, job.PeriodEnd, i.papers);
    const stages = i.stagesByService.get(job.ServiceKey || "") || [];
    out.push({
      job, client, period: job.PeriodEnd, deadline: job.Deadline || "", days: js.days, late: js.state === "overdue", status: st.status, statusAt: st.at,
      stage: stageLabel(job, stages), waiting: waitingForClient(job, stages), done: p.done, total: p.total, complete,
    });
  }
  return out.sort((a, b) => (a.deadline || "9999").localeCompare(b.deadline || "9999") || a.client.Title.localeCompare(b.client.Title));
}
export function statusCounts(rows: ProductionRow[]): Record<StatusFilter, number> {
  const c = Object.fromEntries((["none", ...ACCOUNTS_STATUSES.map((s) => s.key)] as StatusFilter[]).map((k) => [k, 0])) as Record<StatusFilter, number>;
  for (const r of rows) c[r.status || "none"]++;
  return c;
}
export const matchesStatus = (r: ProductionRow, f: StatusFilter | "all" | "soon"): boolean =>
  f === "all" ? true : f === "soon" ? r.late || (r.days !== undefined && r.days <= 30) : (r.status || "none") === f;
