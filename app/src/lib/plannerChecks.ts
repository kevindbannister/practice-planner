// Planner checks: things that can be wrong in the planner itself, found without going to
// Companies House. Deadlines that disagree with the statutory date, dates that can't be right,
// the same job twice, a deadline rule that has drifted from the statutory one, and work that is
// close with no AML or engagement letter in place. Each finding is a proposal for you to apply
// or ignore, in the same list as Companies House's changes. Nothing here writes anything.
import { Client, Job, amlLabel, fmtDate, isOpen, loeLabel } from "./domain";
import { Proposal } from "./companiesHouse";
import { addDays, addMonths, deadlineByRule, isMonthEnd, parseIso, ruleFor } from "./planning";
import { Row } from "./schema";

// ------------------------------------------------------------------ the statutory dates

type Statutory = { basis: string; date: (periodEnd: string) => string; /** Companies House's own date wins for these once it has been checked. */ companiesHouse?: boolean; samples: string[] };

const nextJan31 = (pe: string) => {
  const y = parseIso(pe).getUTCFullYear();
  const d = `${y}-01-31`;
  return d <= pe ? `${y + 1}-01-31` : d;
};
const monthsAfter = (n: number) => (pe: string) => addMonths(pe, n, isMonthEnd(pe));
const MONTH_ENDS = ["2026-03-31", "2026-06-30", "2026-10-31", "2027-02-28", "2028-02-29", "2026-12-31"];

/** The statutory deadline for a period end, for the types of work that have one. */
export const STATUTORY: Record<string, Statutory> = {
  ACCS_LTD: { basis: "9 months after the period end", date: monthsAfter(9), companiesHouse: true, samples: MONTH_ENDS },
  ACCS_LLP: { basis: "9 months after the period end", date: monthsAfter(9), companiesHouse: true, samples: MONTH_ENDS },
  CT600: { basis: "12 months after the period end", date: monthsAfter(12), samples: MONTH_ENDS },
  CS01: { basis: "14 days after the made-up date", date: (pe) => addDays(pe, 14), companiesHouse: true, samples: ["2026-03-31", "2026-10-12", "2027-02-28"] },
  VAT: { basis: "1 month and 7 days after the period end", date: (pe) => addDays(addMonths(pe, 1, isMonthEnd(pe)), 7), samples: MONTH_ENDS },
  SA100: { basis: "31 January after the tax year ends", date: nextJan31, samples: ["2026-04-05", "2027-04-05"] },
  SA800: { basis: "31 January after the tax year ends", date: nextJan31, samples: ["2026-04-05", "2027-04-05"] },
};

export const statutoryDate = (serviceKey: string | undefined, periodEnd: string | undefined): string | undefined =>
  serviceKey && periodEnd && STATUTORY[serviceKey] ? STATUTORY[serviceKey].date(periodEnd) : undefined;

// ------------------------------------------------------------------ the checks

export type CheckInput = { clients: Client[]; jobs: Job[]; services: Row[]; today: string };

/** Work that is due within this many days needs its AML and engagement letter sorted. */
export const PREPARE_DAYS = 60;

const d = (iso?: string) => (iso ? fmtDate(iso) : "not set");
const inactive = (c: Client) => /archiv|former|ceased|inactive|left/i.test(String(c.Status || ""));

export function plannerChecks({ clients, jobs, services, today }: CheckInput): Proposal[] {
  const out: Proposal[] = [];
  const byClient = new Map(clients.map((c) => [c.Key, c]));
  const open = jobs.filter(isOpen);

  // 1. each open job's deadline against the statutory date
  for (const j of open) {
    const c = byClient.get(j.ClientKey);
    if (!c || inactive(c)) continue;
    const ck = c.Key;
    const sd = statutoryDate(j.ServiceKey, j.PeriodEnd);
    const stat = j.ServiceKey ? STATUTORY[j.ServiceKey] : undefined;
    const governed = !!stat?.companiesHouse && (j.DeadlineSource === "Companies House" || !!j.CHDeadline || c.CHChecked === true || (c.CHChecked as unknown) === "true");
    const name = `${c.Title}: ${j.Title}`;
    const apply = (Deadline: string) => ({ do: "deadline" as const, jobKey: j.Key, Deadline });

    if (j.Deadline && j.PeriodEnd && j.Deadline < j.PeriodEnd) {
      out.push({
        key: `${ck}|deadline-order|${j.Key}`, type: "deadline-order", clientKey: ck, jobKey: j.Key, severity: "red",
        title: "Deadline is before the period end",
        detail: `${name}: the deadline (${d(j.Deadline)}) is earlier than the period end (${d(j.PeriodEnd)}).${sd ? ` The statutory date is ${d(sd)}; Apply sets it.` : " Check both dates."}`,
        current: `Period ${d(j.PeriodEnd)}, due ${d(j.Deadline)}`, action: sd ? apply(sd) : { do: "none", seen: `${j.PeriodEnd}|${j.Deadline}` },
      });
      continue;
    }
    if (!sd || governed) continue;

    if (!j.Deadline) {
      out.push({
        key: `${ck}|deadline-missing|${j.Key}`, type: "deadline-missing", clientKey: ck, jobKey: j.Key, severity: "amber",
        title: "No deadline on the job",
        detail: `${name}: no deadline is set. The statutory date is ${d(sd)} (${stat!.basis}). Apply sets it.`,
        current: "Not set", action: apply(sd),
      });
    } else if (j.Deadline !== sd) {
      const later = j.Deadline > sd;
      // a deadline you set yourself that is earlier than the law's is a deliberate buffer, so leave it alone
      if (!later && j.DeadlineSource === "Manual") continue;
      out.push({
        key: `${ck}|deadline-rule|${j.Key}`, type: "deadline-rule", clientKey: ck, jobKey: j.Key, severity: later ? "red" : "amber",
        title: later ? "Deadline is later than the statutory date" : "Deadline differs from the statutory date",
        detail: `${name}: the job says ${d(j.Deadline)}, but the statutory date is ${d(sd)} (${stat!.basis}).${later ? " Working to the job's date would miss it." : ""} Apply sets ${d(sd)}.`,
        current: `Due ${d(j.Deadline)}${j.DeadlineSource ? ` (${j.DeadlineSource})` : ""}`, action: apply(sd),
      });
    }

    if ((j.ServiceKey === "SA100" || j.ServiceKey === "SA800") && j.PeriodEnd && !/-04-05$/.test(j.PeriodEnd)) {
      out.push({
        key: `${ck}|period|${j.Key}`, type: "period", clientKey: ck, jobKey: j.Key, severity: "amber",
        title: "Self Assessment period doesn't end on 5 April",
        detail: `${name}: the period end is ${d(j.PeriodEnd)}. A Self Assessment return covers a tax year, which ends on 5 April. Change the period end on the job.`,
        current: `Period ${d(j.PeriodEnd)}`, action: { do: "none", seen: j.PeriodEnd },
      });
    }
  }

  // 2. the same job twice
  const groups = new Map<string, Job[]>();
  for (const j of open) {
    if (!j.PeriodEnd || !j.ServiceKey) continue;
    const k = `${j.ClientKey}|${j.ServiceKey}|${j.PeriodEnd}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(j);
  }
  for (const [k, list] of groups) {
    if (list.length < 2) continue;
    const c = byClient.get(list[0].ClientKey);
    if (!c || inactive(c)) continue;
    out.push({
      key: `${c.Key}|duplicate|${k.split("|").slice(1).join("|")}`, type: "duplicate", clientKey: c.Key, jobKey: list[0].Key, severity: "amber",
      title: `${list.length} open jobs for the same period`,
      detail: `${c.Title}: ${list[0].Title} for the period to ${d(list[0].PeriodEnd)} is on the planner ${list.length} times. Open the client and complete or cancel the extra ones.`,
      current: `${list.length} open jobs`, action: { do: "none", seen: list.map((j) => j.Key).sort().join(",") },
    });
  }

  // 3. a deadline rule saved in Settings that no longer matches the statutory one
  for (const [serviceKey, stat] of Object.entries(STATUTORY)) {
    const row = services.find((s) => s.Key === serviceKey);
    if (!row || row.RepeatMonths === undefined || row.RepeatMonths === null) continue; // uses the built-in rule
    const rule = ruleFor(serviceKey, services);
    const bad = stat.samples.find((pe) => deadlineByRule(rule, pe) !== stat.date(pe));
    if (!bad) continue;
    const title = String(row.Title || serviceKey);
    out.push({
      key: `rule|${serviceKey}`, type: "service-rule", clientKey: "", severity: "amber",
      title: `${title}: your deadline rule differs from the statutory one`,
      detail: `For a period to ${d(bad)}, your rule in Settings › Types of work gives ${d(deadlineByRule(rule, bad))}, but the statutory date is ${d(stat.date(bad))} (${stat.basis}). Apply puts back the standard rule.`,
      current: "Your own rule", action: { do: "service-rule", serviceKey },
    });
  }

  // 4. work that's close, with no AML check or engagement letter in place
  const soon = addDays(today, PREPARE_DAYS);
  for (const c of clients) {
    if (inactive(c)) continue;
    const due = open.filter((j) => j.ClientKey === c.Key && j.Status !== "On hold" && j.Deadline && j.Deadline <= soon).map((j) => j.Deadline!).sort();
    if (!due.length) continue;
    const first = due[0];
    const aml = amlLabel(c.XamaStatus as string | undefined);
    if (aml.warn) {
      out.push({
        key: `${c.Key}|aml`, type: "aml", clientKey: c.Key, severity: "amber",
        title: "AML check not complete",
        detail: `AML status: ${aml.text}. Work is due by ${d(first)}. Apply adds a task to sort it.`,
        current: aml.text, action: { do: "task", title: `Complete AML check for ${c.Title}`, clientKey: c.Key, dueInDays: 14, hours: 0.5 },
      });
    }
    const loe = loeLabel(c.LoEStatus as string | undefined);
    if (loe.warn) {
      out.push({
        key: `${c.Key}|loe`, type: "loe", clientKey: c.Key, severity: "amber",
        title: loe.text === "Sent, not signed" ? "Engagement letter not signed" : "No engagement letter on file",
        detail: `Engagement letter: ${loe.text.toLowerCase()}. Work is due by ${d(first)}. Apply adds a task to ${loe.text === "Sent, not signed" ? "chase it" : "send one"}.`,
        current: loe.text,
        action: { do: "task", title: `${loe.text === "Sent, not signed" ? "Chase engagement letter for" : "Send engagement letter to"} ${c.Title}`, clientKey: c.Key, dueInDays: 14, hours: 0.5 },
      });
    }
  }
  return out;
}

/** The "how is each deadline set" table: every type of work with its rule and where the date comes from. */
export function deadlineBasis(services: Row[]): { key: string; title: string; rule: string; basis: string; custom: boolean }[] {
  return services
    .filter((s) => s.Key !== "TASK")
    .map((s) => {
      const key = String(s.Key);
      const stat = STATUTORY[key];
      const custom = s.RepeatMonths !== undefined && s.RepeatMonths !== null;
      return {
        key, title: String(s.Title || key), custom,
        rule: "", // filled in by the screen, which owns the wording of a rule
        basis: stat ? `${stat.basis}${stat.companiesHouse ? " (Companies House's own date is used once checked)" : ""}` : "Your own rule",
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}
