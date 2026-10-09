// Chasing records: which jobs are waiting on the client, when the records are needed, the
// email wording, and keeping a log of each chase.
import { Client, Job, contactName, daysBetween, fmtDate, isOnHold, isOpen } from "./domain";
import { addDays } from "./planning";
import { Row } from "./schema";

/** Types of work that need records from the client, and how many days before the deadline to have them. */
export const RECORDS_DEFAULTS: Record<string, number> = {
  ACCS_LTD: 90, ACCS_LLP: 90, SE_ACCOUNTS: 90, CHARITY_ACCOUNTS: 90, ACCS_OTHER_A: 90, ACCS_OTHER_B: 90,
  SA100: 90, SA800: 90, VAT: 21, BOOKKEEPING: 14, MGMT_ACCOUNTS: 14, PAYROLL: 7, CIS: 7,
};
export const SOON_DAYS = 14; // show work whose records are needed within two weeks
export const RECENT_DAYS = 7; // a chase in the last week counts as "chased recently"

export type RecordsRule = { needs: boolean; leadDays: number };

/** What's saved for the type of work in Settings, else the defaults above. */
export function recordsRule(serviceKey: string | undefined, services: Row[] = []): RecordsRule {
  const row = services.find((s) => s.Key === serviceKey);
  const builtIn = RECORDS_DEFAULTS[serviceKey || ""];
  // saved as text ("yes"/"no"): a new yes/no column would read as "no" on existing rows
  const needs = row && row.RecordsNeeded ? row.RecordsNeeded === "yes" : builtIn !== undefined;
  const lead = row && row.RecordsLeadDays !== undefined ? Number(row.RecordsLeadDays) : builtIn ?? 30;
  return { needs, leadDays: Number.isFinite(lead) ? Math.max(0, lead) : 30 };
}

/**
 * When the records are needed: the job's own "records expected" date if set; otherwise
 * the lead time before the deadline, but never before the period has ended.
 */
export function recordsNeededBy(job: Job, rule: RecordsRule): { date: string; worked: boolean } | null {
  if (job.RecordsExpected) return { date: job.RecordsExpected as string, worked: false };
  if (!job.Deadline) return null;
  let d = addDays(job.Deadline, -rule.leadDays);
  if (job.PeriodEnd) {
    const after = addDays(job.PeriodEnd, 1);
    if (d < after) d = after;
  }
  return { date: d, worked: true };
}

export type ChaseItem = {
  job: Job;
  neededBy: string;
  worked: boolean; // worked out from the type of work, rather than set on the job
  status: "late" | "soon" | "chased";
};

/** True when a job's stages show the records are in (it's past a "Request records" first stage). */
export function pastRecordsStage(job: Job, stageTemplates: Row[]): boolean {
  if ((job.StageNo || 1) < 2) return false;
  const first = stageTemplates.find((s) => s.ServiceKey === job.ServiceKey && Number(s.StageNo) === 1);
  return !!first && /^request/i.test(String(first.Title || ""));
}

/** The stage to move to when records arrive: stage 2 if it's a "received" stage and the job is at stage 1. */
export function receivedStage(job: Job, stageTemplates: Row[]): Row | undefined {
  if ((job.StageNo || 1) !== 1) return undefined;
  const second = stageTemplates.find((s) => s.ServiceKey === job.ServiceKey && Number(s.StageNo) === 2);
  return second && /received/i.test(String(second.Title || "")) ? second : undefined;
}

/** Jobs waiting on records that are needed within two weeks (or already late). */
export function chaseItems(jobs: Job[], services: Row[], today: string, stageTemplates: Row[] = []): ChaseItem[] {
  const out: ChaseItem[] = [];
  for (const j of jobs) {
    if (!isOpen(j) || isOnHold(j) || j.RecordsReceived || pastRecordsStage(j, stageTemplates)) continue;
    const rule = recordsRule(j.ServiceKey, services);
    if (!rule.needs && !j.RecordsExpected) continue;
    if (j.PeriodEnd && j.PeriodEnd >= today && !j.RecordsExpected) continue; // period not over yet
    const need = recordsNeededBy(j, rule);
    if (!need || need.date > addDays(today, SOON_DAYS)) continue;
    const last = j.LastChased as string | undefined;
    const recent = !!last && daysBetween(last, today) < RECENT_DAYS;
    out.push({ job: j, neededBy: need.date, worked: need.worked, status: recent ? "chased" : need.date < today ? "late" : "soon" });
  }
  return out.sort((a, b) => a.neededBy.localeCompare(b.neededBy));
}

export type ChaseGroup = { clientKey: string; items: ChaseItem[]; status: ChaseItem["status"]; neededBy: string };

/** One group per client, so one email covers everything they owe you. Late first. */
export function groupByClient(items: ChaseItem[]): ChaseGroup[] {
  const map = new Map<string, ChaseItem[]>();
  for (const i of items) {
    if (!map.has(i.job.ClientKey)) map.set(i.job.ClientKey, []);
    map.get(i.job.ClientKey)!.push(i);
  }
  const rank = { late: 0, soon: 1, chased: 2 };
  return [...map.entries()]
    .map(([clientKey, list]) => {
      const status = list.some((i) => i.status === "late") ? "late" : list.some((i) => i.status === "soon") ? "soon" : "chased";
      return { clientKey, items: list, status, neededBy: list[0].neededBy } as ChaseGroup;
    })
    .sort((a, b) => rank[a.status] - rank[b.status] || a.neededBy.localeCompare(b.neededBy));
}

// ------------------------------------------------------------------ email wording

export type ChaseTemplate = { subject: string; body: string };

export const DEFAULT_TEMPLATE: ChaseTemplate = {
  subject: "Records needed: {client}",
  body:
    "Hi {name},\n\nI'm getting ready to work on the following and need your records:\n\n{list}\n\n" +
    "Could you send them over by {date}? If you've sent them already, thank you, and please ignore this email.\n\n" +
    "Kind regards,\n{me}",
};

export const PLACEHOLDERS: [string, string][] = [
  ["{name}", "the client's first name"],
  ["{client}", "the client"],
  ["{list}", "the work waiting on records, one per line"],
  ["{date}", "when you need them by"],
  ["{me}", "your name"],
];

export function jobLine(j: Job): string {
  return `- ${j.Title}${j.PeriodEnd ? ` for the period to ${fmtDate(j.PeriodEnd)}` : ""}`;
}

export function fillTemplate(t: ChaseTemplate, client: Client | undefined, items: ChaseItem[], me: string, today: string) {
  const first = client ? String(client.ContactPreferred || client.ContactFirst || "").trim() || contactName(client) || client.Title : "";
  const earliest = items.map((i) => i.neededBy).sort()[0];
  // asking for "yesterday" reads oddly: late records are asked for within a week
  const by = !earliest || earliest < today ? addDays(today, 7) : earliest;
  const values: Record<string, string> = {
    "{name}": first || "there",
    "{client}": client?.Title || "",
    "{list}": items.map((i) => jobLine(i.job)).join("\n"),
    "{date}": fmtDate(by, { weekday: true }),
    "{me}": me,
  };
  const fill = (s: string) => s.replace(/\{(name|client|list|date|me)\}/g, (m) => values[m] ?? m);
  return { subject: fill(t.subject), body: fill(t.body) };
}

export function mailtoLink(to: string, subject: string, body: string): string {
  // spaces as %20 rather than +, which some mail apps show literally
  return `mailto:${encodeURIComponent(to).replace(/%40/g, "@")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// ------------------------------------------------------------------ the chase log

/** Fields to save on a job when it's chased. `how` is e.g. "email" or "phone". */
export function chasePatch(job: Job, how: string, today: string): Row {
  const line = `${fmtDate(today)}: chased by ${how}`;
  return {
    LastChased: today,
    ChaseCount: ((job.ChaseCount as number) || 0) + 1,
    ChaseLog: job.ChaseLog ? `${line}\n${job.ChaseLog}` : line,
  };
}

/** Put a job's chase fields back (for Undo). */
export function chaseUndo(job: Job): Row {
  return {
    LastChased: (job.LastChased as string) || "",
    ChaseCount: (job.ChaseCount as number) ?? ("" as unknown as number),
    ChaseLog: (job.ChaseLog as string) || "",
  };
}

export function chaseSummary(job: Job): string {
  const n = (job.ChaseCount as number) || 0;
  if (!n) return "Not chased yet";
  return `Chased ${n === 1 ? "once" : `${n} times`}, last ${fmtDate(job.LastChased as string, { year: false })}`;
}
