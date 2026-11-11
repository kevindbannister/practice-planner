// Deadline risk and blocker impact. Statutory deadlines are never moved, suspended or hidden by anything here: this module only reads dates and reports on them.
// Five dates stay separate: the statutory deadline (job Deadline), the practice's internal target, the date agreed with the client, the date work is planned,
// and when a prerequisite is expected. If a prerequisite has no known date none is invented: the result says "uncertain" and escalates as the deadline nears.
import { Row } from "../schema";
import { Assessment, ChainNode, DepEval, World, assess, chain, evaluate, labelOf } from "./readiness";
import { isFinished } from "./model";

export type RiskCategory = "on_track" | "attention" | "at_risk" | "critical" | "overdue";
export const RISK_LABEL: Record<RiskCategory, string> = { on_track: "On track", attention: "Attention required", at_risk: "At risk", critical: "Critical", overdue: "Overdue" };
export const RISK_RANK: Record<RiskCategory, number> = { on_track: 0, attention: 1, at_risk: 2, critical: 3, overdue: 4 };
const worse = (a: RiskCategory, b: RiskCategory) => (RISK_RANK[a] >= RISK_RANK[b] ? a : b);

/** The columns that hold statutory and filing deadlines. Nothing in the dependency, readiness or rescheduling code may write these. */
export const DEADLINE_COLUMNS = ["Deadline", "CHDeadline", "DeadlineSource"] as const;
export const touchesDeadline = (patch: Row): boolean => DEADLINE_COLUMNS.some((c) => c in patch);

export type RiskConfig = {
  /** Working days of spare time below which a job is "at risk" (attention is below twice this). */ leadDays: number;
  /** Hours one job can realistically take in a working day. */ focusHours: number;
  /** With an unknown prerequisite date: working days to the deadline at which it becomes attention / at risk / critical. */ uncertain: { attention: number; atRisk: number; critical: number };
};
export const DEFAULT_RISK: RiskConfig = { leadDays: 3, focusHours: 3.75, uncertain: { attention: 20, atRisk: 10, critical: 5 } };
export function readRiskConfig(settings: Row[]): RiskConfig {
  try {
    const raw = settings.find((r) => r.Key === "work.risk")?.Value; const o = raw ? JSON.parse(String(raw)) : {};
    const n = (v: unknown, d: number, min = 0) => (Number.isFinite(Number(v)) && Number(v) >= min && v !== "" && v !== null ? Number(v) : d);
    return { leadDays: n(o.leadDays, DEFAULT_RISK.leadDays), focusHours: n(o.focusHours, DEFAULT_RISK.focusHours, 0.25), uncertain: { attention: n(o.uncertain?.attention, DEFAULT_RISK.uncertain.attention), atRisk: n(o.uncertain?.atRisk, DEFAULT_RISK.uncertain.atRisk), critical: n(o.uncertain?.critical, DEFAULT_RISK.uncertain.critical) } };
  } catch { return DEFAULT_RISK; }
}

const addDay = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
/** Working days from..to inclusive, a day counting when the practice has hours on it. Bank holidays count only if the practice has marked them off. */
export function workingDays(from: string, to: string, hoursOn: (d: string) => number): number {
  let n = 0; if (to < from) return 0;
  for (let d = from, i = 0; d <= to && i < 1500; d = addDay(d, 1), i++) if (hoursOn(d) > 0) n++;
  return n;
}

export type Facts = { key: string; title: string; clientKey: string; deadline: string; internalTarget: string; clientAgreed: string; planned: string; remaining: number; actionable: number; complete: boolean };
export type Risk = {
  category: RiskCategory; reasons: string[]; workingDaysLeft: number | null; slackDays: number | null; uncertain: boolean; noDeadline: boolean;
  held: number; actionable: number; remaining: number; blockers: DepEval[];
  /** Only set when every outstanding prerequisite has a known date: the day the last one is expected. A date for the job itself is never projected. */
  lastExpected: string;
};
const level = (slack: number, lead: number): RiskCategory => (slack < 0 ? "critical" : slack < lead ? "at_risk" : slack < 2 * lead ? "attention" : "on_track");

export function risk(f: Facts, a: Assessment, today: string, hoursOn: (d: string) => number, cfg: RiskConfig = DEFAULT_RISK): Risk {
  const base: Risk = { category: "on_track", reasons: [], workingDaysLeft: null, slackDays: null, uncertain: false, noDeadline: !f.deadline, held: 0, actionable: f.actionable, remaining: f.remaining, blockers: a.blockers, lastExpected: "" };
  if (f.complete || a.readiness === "complete") return base;
  if (!f.deadline) return { ...base, reasons: ["No deadline is set."] };
  if (f.deadline < today) return { ...base, category: "overdue", reasons: [`The deadline of ${f.deadline} has passed${a.blockers.length ? `, and the job is still held up: ${a.blockers[0].reason}` : ""}`] };
  const days = workingDays(today, f.deadline, hoursOn), focus = cfg.focusHours, lead = cfg.leadDays;
  const need = f.remaining > 0 ? Math.ceil(f.remaining / focus) : 0;
  const held = Math.min(f.remaining, Math.max(0, f.remaining - f.actionable)), heldDays = held > 0 ? Math.ceil(held / focus) : 0;
  const out: Risk = { ...base, workingDaysLeft: days, held };
  const reasons: string[] = [];
  let cat: RiskCategory = "on_track";
  if (!a.blockers.length) {
    out.slackDays = days - need; cat = level(out.slackDays, lead);
    if (cat !== "on_track") reasons.push(`${f.remaining}h of work left and ${days} working day${days === 1 ? "" : "s"} to the deadline.`);
  } else if (a.blockers.every((b) => b.expectedKnown)) {
    const E = a.blockers.map((b) => b.expected).sort().at(-1)!; out.lastExpected = E;
    if (E > f.deadline) { cat = "critical"; reasons.push(`A prerequisite is not expected until ${E}, after the deadline of ${f.deadline}.`); }
    else {
      const after = workingDays(addDay(E, 1), f.deadline, hoursOn), before = workingDays(today, E, hoursOn);
      const overflow = Math.max(0, Math.ceil(f.actionable / focus) - before);
      out.slackDays = after - heldDays - overflow; cat = level(out.slackDays, lead);
      if (cat !== "on_track") reasons.push(`If the outstanding prerequisites arrive when expected (${E}), there is ${out.slackDays < 0 ? "not enough" : "little"} time left to do the work held behind them.`);
    }
  } else {
    out.uncertain = true;
    const best = level(days - need, lead), u = cfg.uncertain;
    const esc: RiskCategory = days <= u.critical ? "critical" : days <= u.atRisk ? "at_risk" : days <= u.attention ? "attention" : "on_track";
    cat = worse(best, esc);
    reasons.push(`No date is known for ${a.unknownDates.length === 1 ? "a prerequisite" : `${a.unknownDates.length} prerequisites`}, so the finish can't be predicted. ${days} working day${days === 1 ? "" : "s"} to the deadline.`);
  }
  if (f.internalTarget && today > f.internalTarget && f.remaining > 0) { cat = worse(cat, "attention"); reasons.push(`The internal target of ${f.internalTarget} has passed.`); }
  if (f.clientAgreed && today > f.clientAgreed && f.remaining > 0) { cat = worse(cat, "attention"); reasons.push(`The date agreed with the client (${f.clientAgreed}) has passed.`); }
  if (a.blockers.length) reasons.push(...a.blockers.slice(0, 3).map((b) => b.reason));
  return { ...out, category: cat, reasons };
}

// ---------------------------------------------------------------- blocker impact
export type Affected = { kind: "task" | "job"; key: string; label: string };
export type Impact = {
  prerequisite: Affected; direct: Affected[]; indirect: Affected[];
  deadlines: { key: string; label: string; date: string; category: RiskCategory }[];
  hours: number; responsible: string; followUp: string; earliest: ChainNode[]; worst: RiskCategory; score: number; actionable: boolean; expectedKnown: boolean; expected: string;
};
const tag = (k: "task" | "job", key: string) => `${k}:${key}`;
const kindOf = (r: { kind: string }): "task" | "job" => (r.kind === "job" ? "job" : "task");

/** For each outstanding prerequisite: what it holds up (directly, then further along), which deadlines that touches, the hours held, who has the ball, and how worth acting on it is. */
export function impacts(w: World, facts: Map<string, Facts>, risks: Map<string, Risk>): Impact[] {
  const live = w.deps.filter((d) => d.status !== "cancelled").map((d) => evaluate(d, w));
  const unmet = live.filter((e) => e.state === "unmet" || e.state === "missing" || e.state === "conflict");
  const finishedDependent = (k: "task" | "job", key: string) => (k === "job" ? ["Complete", "Done", "Cancelled"].includes(w.jobs.get(key)?.status || "") : isFinished(w.tasks.get(key)?.status || ""));
  const byPre = new Map<string, DepEval[]>();
  for (const e of unmet) { if (finishedDependent(kindOf(e.dep.dependent), e.dep.dependent.key)) continue; const t = tag(kindOf(e.dep.prerequisite), e.dep.prerequisite.key); byPre.set(t, [...(byPre.get(t) || []), e]); }
  const out: Impact[] = [];
  for (const [t, es] of byPre) {
    const [pk, pkey] = t.split(":") as ["task" | "job", string];
    if (pk === "task" ? !w.tasks.has(pkey) : !w.jobs.has(pkey)) continue;
    const aff = (k: "task" | "job", key: string): Affected => ({ kind: k, key, label: labelOf({ kind: k, key }, w) });
    const direct = [...new Map(es.map((e) => [tag(kindOf(e.dep.dependent), e.dep.dependent.key), aff(kindOf(e.dep.dependent), e.dep.dependent.key)])).values()];
    const seen = new Set<string>([t, ...direct.map((d) => tag(d.kind, d.key))]), indirect: Affected[] = [];
    const queue = [...direct];
    while (queue.length) { const n = queue.shift()!; for (const e of unmet) { if (tag(kindOf(e.dep.prerequisite), e.dep.prerequisite.key) !== tag(n.kind, n.key)) continue; const k = kindOf(e.dep.dependent), id = tag(k, e.dep.dependent.key); if (seen.has(id) || finishedDependent(k, e.dep.dependent.key)) continue; seen.add(id); const a = aff(k, e.dep.dependent.key); indirect.push(a); queue.push(a); } }
    let hours = 0, worst: RiskCategory = "on_track";
    const deadlines: Impact["deadlines"] = [];
    for (const a of [...direct, ...indirect]) {
      if (a.kind === "job") { const f = facts.get(a.key), r = risks.get(a.key); const isDirectStage = direct.some((d) => d.key === a.key && d.kind === "job") && es.some((e) => e.dep.dependent.key === a.key && e.dep.dependent.stage !== undefined); hours += f ? (isDirectStage && r ? r.held : f.remaining) : 0; if (f?.deadline) deadlines.push({ key: a.key, label: a.label, date: f.deadline, category: r?.category || "on_track" }); if (r) worst = worse(worst, r.category); }
      else hours += (w.tasks.get(a.key)?.estimateMinutes || 0) / 60;
    }
    const pre = pk === "task" ? w.tasks.get(pkey) : undefined, job = pk === "job" ? w.jobs.get(pkey) : undefined;
    const responsible = pre ? (pre.ownerType === "user" ? pre.owner || "Us" : pre.responsible || (pre.ownerType === "contact" ? "The client" : "Someone else")) : "Us";
    const actionable = pre ? !isFinished(pre.status) && pre.status !== "On hold" : !!job && assess("job", pkey, w).readiness !== "on_hold" && assess("job", pkey, w).readiness !== "blocked";
    const dated = es.filter((e) => e.expectedKnown).map((e) => e.expected).sort();
    deadlines.sort((a, b) => a.date.localeCompare(b.date));
    const score = RISK_RANK[worst] * 1000 + (direct.length + indirect.length) * 50 + Math.min(Math.round(hours), 50) + (actionable ? 25 : 0);
    out.push({ prerequisite: aff(pk, pkey), direct, indirect, deadlines, hours: Math.round(hours * 100) / 100, responsible, followUp: pre?.followUpDate || "", earliest: chain(pk, pkey, w).earliest, worst, score, actionable, expectedKnown: es.every((e) => e.expectedKnown), expected: dated.at(-1) || "" });
  }
  return out.sort((a, b) => b.score - a.score || (a.deadlines[0]?.date || "9").localeCompare(b.deadlines[0]?.date || "9") || a.prerequisite.label.localeCompare(b.prerequisite.label));
}

// ---------------------------------------------------------------- Action Centre
export type RiskItem = { key: string; clientKey: string; title: string; detail: string; priority: "high" | "medium" | "low"; due: string; href: string };
/** Alerts for jobs that are held up and short of time. Overdue jobs already have their own alert; ordinary jobs with enough time are not raised. */
export function riskItems(facts: Map<string, Facts>, risks: Map<string, Risk>, w: World, today: string): RiskItem[] {
  const out: RiskItem[] = [];
  for (const [key, r] of risks) {
    const f = facts.get(key); if (!f || !f.deadline || r.category === "overdue" || r.category === "on_track") continue;
    if (!r.blockers.length && r.category === "attention") continue;
    const b = r.blockers[0];
    const pre = b ? b.dep.prerequisite : undefined;
    const who = pre?.kind !== "job" && pre ? (w.tasks.get(pre.key)?.responsible || w.tasks.get(pre.key)?.owner || "") : "";
    const what = b ? `Waiting on ${labelOf(b.dep.prerequisite, w)}${who ? ` (${who})` : ""}${b.expectedKnown ? `, expected ${b.expected}` : ", no date known"}.` : "";
    out.push({ key: `risk:${key}`, clientKey: f.clientKey, title: `${f.title}: ${RISK_LABEL[r.category].toLowerCase()}`, detail: `Due ${f.deadline}${r.workingDaysLeft !== null ? ` (${r.workingDaysLeft} working day${r.workingDaysLeft === 1 ? "" : "s"})` : ""}. ${what} ${r.reasons[0] || ""}`.trim(), priority: r.category === "critical" ? "high" : r.category === "at_risk" ? "high" : "medium", due: f.deadline, href: pre ? `editor:${pre.kind === "job" ? "job" : "task"}:${pre.key}` : `editor:job:${key}` });
  }
  return out.sort((a, b) => a.due.localeCompare(b.due));
}
