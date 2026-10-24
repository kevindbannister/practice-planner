// Job checklists: templates, the rules that decide which items apply to a client and job, the snapshot a job
// gets, dependencies, sign-off, review notes, permissions and progress. Nothing here touches SharePoint or the
// screen, so every rule can be tested on its own. The job stays the source of truth for work and dates;
// a checklist only records the steps and who did them.
import type { Row } from "./schema";

/* ---------- roles and who may do what ---------- */

export type Role = "preparer" | "reviewer" | "manager" | "partner" | "owner" | "outsourced";
export const ROLES: { key: Role; label: string }[] = [
  { key: "preparer", label: "Preparer" }, { key: "reviewer", label: "Reviewer" }, { key: "manager", label: "Manager" },
  { key: "partner", label: "Partner" }, { key: "owner", label: "Job owner" }, { key: "outsourced", label: "Outsourced" },
];
export const roleLabel = (r?: string) => ROLES.find((x) => x.key === r)?.label || "";

export type Staff = { name: string; role: Role };
export type Config = {
  staff: Staff[];
  /** Names allowed to skip a mandatory item (with a reason). Empty means partners and managers. */
  overriders: string[];
  /** When on, whoever prepared the work cannot also approve it. */
  independentReview: boolean;
  /** Make a checklist automatically when a job is created. */
  auto: boolean;
};
export const DEFAULT_CONFIG: Config = { staff: [], overriders: [], independentReview: false, auto: true };
export const CONFIG_KEY = "checklist-config";

export function readConfig(settings: Row[]): Config {
  const row = settings.find((r) => r.Key === CONFIG_KEY);
  if (!row?.Value) return DEFAULT_CONFIG;
  try {
    const v = JSON.parse(String(row.Value));
    const staff = Array.isArray(v.staff) ? v.staff.filter((s: Staff) => s && typeof s.name === "string" && s.name.trim()).map((s: Staff) => ({ name: s.name.trim(), role: ROLES.some((r) => r.key === s.role) ? s.role : "preparer" })) : [];
    return { staff, overriders: Array.isArray(v.overriders) ? v.overriders.map(String) : [], independentReview: !!v.independentReview, auto: v.auto !== false };
  } catch {
    return DEFAULT_CONFIG;
  }
}

const same = (a: string, b: string) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
export const staffRole = (cfg: Config, name: string): Role | undefined => cfg.staff.find((s) => same(s.name, name))?.role;
/** With nobody set up (a one-person practice) every action is allowed. */
export const hasStaff = (cfg: Config) => cfg.staff.length > 0;

export type Action = "complete" | "reassign" | "review" | "approve" | "reopen" | "override" | "template";
const SENIOR: Role[] = ["reviewer", "manager", "partner"];
/** Whether this person may do this. Used by every write in the checklist screens. */
export function can(cfg: Config, user: string, action: Action): boolean {
  if (!hasStaff(cfg)) return true;
  const role = staffRole(cfg, user);
  if (!role) return action === "complete"; // someone not on the list can still tick their own work off
  switch (action) {
    case "complete": case "reassign": return true;
    case "review": case "approve": case "reopen": return SENIOR.includes(role);
    case "override": return cfg.overriders.length ? cfg.overriders.some((n) => same(n, user)) : role === "manager" || role === "partner";
    case "template": return role === "manager" || role === "partner";
  }
}

/* ---------- which items apply ---------- */

export type Answer = "yes" | "no" | "unknown";
/** The things a rule can ask about, with how the planner learns each. */
export const ATTRS: { key: string; label: string; question: string; kind?: "choice" }[] = [
  { key: "vat", label: "VAT registered", question: "Is the client VAT registered?" },
  { key: "payroll", label: "Runs payroll", question: "Does the client run payroll?" },
  { key: "fixedAssets", label: "Has fixed assets", question: "Does the client have fixed assets?" },
  { key: "dormant", label: "Dormant company", question: "Is the company dormant?" },
  { key: "outsourced", label: "Outsourced preparation", question: "Is this job prepared by an outsourced accountant?" },
  { key: "kind", label: "Client type", question: "What type of client is this?", kind: "choice" },
];
export const KINDS = ["Ltd", "LLP", "Individual", "Partnership", "Trust"];
export const KIND_LABEL: Record<string, string> = { Ltd: "Limited company", LLP: "LLP", Individual: "Individual or sole trader", Partnership: "Partnership", Trust: "Trust" };

/** One test. `is` is yes/no for a question; `in` lists client types for the type test. */
export type Rule = { attr: string; is?: boolean; in?: string[] };
export type Facts = { kind: string; vat: Answer; payroll: Answer; fixedAssets: Answer; dormant: Answer; outsourced: Answer };

const yn = (v: unknown): Answer => (v === true || v === "yes" || v === "Yes" || v === "true" ? "yes" : v === false || v === "no" || v === "No" || v === "false" ? "no" : "unknown");

/** What the planner already knows about a client. What it cannot tell stays "unknown" so the user is asked. */
export function factsFor(client: Row | undefined, o: { fixedAssetLines?: number; paperKnown?: boolean; answers?: Record<string, Answer> } = {}): Facts {
  const c = client || {};
  const sic = String(c.SIC || "").split(/[,;\s]+/).filter(Boolean);
  const vat = yn(c.VATRegistered) !== "unknown" ? yn(c.VATRegistered) : c.VATNumber ? "yes" : "unknown";
  const f: Facts = {
    kind: String(c.Kind || (c.CompanyNumber ? "Ltd" : "Individual")),
    vat,
    payroll: c.PAYERef ? "yes" : "unknown",
    fixedAssets: (o.fixedAssetLines || 0) > 0 ? "yes" : "unknown",
    dormant: sic.includes("99999") ? "yes" : sic.length ? "no" : "unknown",
    outsourced: "unknown",
  };
  for (const [k, v] of Object.entries(o.answers || {})) if (k in f && k !== "kind" && (v === "yes" || v === "no")) (f as Record<string, string>)[k] = v;
  return f;
}

/** yes, no, or unknown (some answer is missing and nothing says no). */
export function evaluate(rules: Rule[] | undefined, facts: Facts): Answer {
  if (!rules?.length) return "yes";
  let unknown = false;
  for (const r of rules) {
    if (r.attr === "kind") {
      if (r.in?.length && !r.in.includes(facts.kind)) return "no";
      continue;
    }
    const have = (facts as Record<string, Answer | string>)[r.attr] as Answer | undefined;
    if (have === undefined) { unknown = true; continue; }
    if (have === "unknown") { unknown = true; continue; }
    if ((r.is !== false) !== (have === "yes")) return "no";
  }
  return unknown ? "unknown" : "yes";
}

/** Questions still unanswered for a set of rules (so the user can be asked once each). */
export function openQuestions(rules: Rule[][], facts: Facts): string[] {
  const out = new Set<string>();
  for (const rs of rules) for (const r of rs || []) if (r.attr !== "kind" && (facts as Record<string, string>)[r.attr] === "unknown") out.add(r.attr);
  return [...out];
}

export const describeRules = (rules?: Rule[]) =>
  (rules || []).map((r) => (r.attr === "kind" ? `type is ${(r.in || []).map((k) => KIND_LABEL[k] || k).join(" or ") || "any"}` : `${ATTRS.find((a) => a.key === r.attr)?.label || r.attr}: ${r.is === false ? "no" : "yes"}`)).join(" and ");

/* ---------- templates ---------- */

export type TItem = {
  id: string; title: string; description?: string; guidance?: string; link?: string;
  mandatory: boolean; hours: number; role?: Role | "";
  after: string[];                     // item ids that must be finished first
  when?: Rule[];                       // only applies if these hold
  stage?: string;                      // the job stage this should be done by (stage name)
  paper?: { section: string; sub?: string };
  needsClient?: string;                // what we need from the client for this step
  review?: "review" | "approve" | ""; // review steps need a reviewer; approve is the final sign-off
};
export type TSection = { id: string; title: string; items: TItem[] };
export type Template = {
  id: string; name: string; description: string; jobType: string;      // the job type's key (a Services row)
  clientKinds: string[];                                              // empty means any
  when?: Rule[];                                                      // picks this template over the default (e.g. dormant)
  version: number; active: boolean; isDefault: boolean; hours: number;
  sections: TSection[]; created?: string; updated?: string; starter?: string;
};

export const MAX_BODY = 60000;
export const encodeSections = (s: TSection[]) => JSON.stringify(s);
export function decodeSections(text: string): TSection[] {
  try {
    const v = JSON.parse(text || "[]");
    if (!Array.isArray(v)) return [];
    return v.filter((s) => s && Array.isArray(s.items)).map((s: TSection) => ({ id: String(s.id), title: String(s.title || ""), items: s.items.map(cleanItem) }));
  } catch {
    return [];
  }
}
export function cleanItem(i: Partial<TItem>): TItem {
  return {
    id: String(i.id || ""), title: String(i.title || "").trim(), description: i.description ? String(i.description) : undefined, guidance: i.guidance ? String(i.guidance) : undefined,
    link: i.link ? String(i.link) : undefined, mandatory: i.mandatory !== false, hours: Math.max(0, Number(i.hours) || 0), role: ROLES.some((r) => r.key === i.role) ? (i.role as Role) : "",
    after: Array.isArray(i.after) ? i.after.map(String) : [], when: Array.isArray(i.when) && i.when.length ? i.when.map((r) => ({ attr: String(r.attr), ...(r.in ? { in: r.in.map(String) } : {}), ...(r.attr === "kind" ? {} : { is: r.is !== false }) })) : undefined,
    stage: i.stage ? String(i.stage) : undefined, paper: i.paper?.section ? { section: String(i.paper.section), ...(i.paper.sub ? { sub: String(i.paper.sub) } : {}) } : undefined,
    needsClient: i.needsClient ? String(i.needsClient) : undefined, review: i.review === "review" || i.review === "approve" ? i.review : "",
  };
}
export const allItems = (t: { sections: TSection[] }) => t.sections.flatMap((s) => s.items.map((i) => ({ ...i, section: s.title })));
export const templateHours = (t: { sections: TSection[] }) => Math.round(allItems(t).reduce((n, i) => n + i.hours, 0) * 100) / 100;

let counter = 0;
export const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** Problems that make a template unsafe to save: empty names, unknown or circular dependencies. */
export function validateTemplate(t: Pick<Template, "name" | "sections" | "jobType">): string[] {
  const out: string[] = [];
  if (!t.name.trim()) out.push("Give the template a name.");
  if (!t.jobType) out.push("Choose the job type this is for.");
  const items = allItems(t);
  if (!items.length) out.push("Add at least one checklist item.");
  const ids = new Set<string>();
  for (const i of items) {
    if (!i.title.trim()) out.push("Every item needs a title.");
    if (ids.has(i.id)) out.push(`Two items share an id (${i.title}).`);
    ids.add(i.id);
  }
  for (const i of items) for (const a of i.after) if (!ids.has(a)) out.push(`"${i.title}" depends on an item that no longer exists.`);
  const byId = new Map(items.map((i) => [i.id, i]));
  const state = new Map<string, number>();
  const visit = (id: string): boolean => {
    if (state.get(id) === 1) return true;
    if (state.get(id) === 2) return false;
    state.set(id, 1);
    for (const a of byId.get(id)?.after || []) if (byId.has(a) && visit(a)) return true;
    state.set(id, 2);
    return false;
  };
  if (items.some((i) => visit(i.id))) out.push("Some items depend on each other in a circle.");
  return [...new Set(out)];
}

/** A new version only when the content or rules change; renaming or archiving keeps the number. */
export function saveEdit(current: Template, edit: Partial<Template>, now: string): { next: Template; keep?: Template } {
  const next = { ...current, ...edit, updated: now };
  const changed = JSON.stringify([current.sections, current.when, current.clientKinds, current.jobType]) !== JSON.stringify([next.sections, next.when, next.clientKinds, next.jobType]);
  if (!changed) return { next: { ...next, version: current.version } };
  return { next: { ...next, version: current.version + 1, hours: templateHours(next) }, keep: current };
}

/** The template a new job gets: a default for its job type whose own rules hold beats a plain default. */
export function pickTemplate(templates: Template[], jobType: string, facts: Facts): Template | undefined {
  const live = templates.filter((t) => t.active && t.jobType === jobType && (!t.clientKinds.length || t.clientKinds.includes(facts.kind)));
  const specific = live.filter((t) => t.when?.length && evaluate(t.when, facts) === "yes");
  return specific.find((t) => t.isDefault) || specific[0] || live.find((t) => t.isDefault && !t.when?.length) || live.find((t) => t.isDefault && evaluate(t.when, facts) !== "no");
}

/* ---------- a job's checklist ---------- */

export type Status = "todo" | "doing" | "blocked" | "done" | "na" | "confirm";
export const STATUS_LABEL: Record<Status, string> = { todo: "Not started", doing: "In progress", blocked: "Blocked", done: "Completed", na: "Not applicable", confirm: "Confirm if this applies" };

export type Entry = { at: string; by: string; action: string; detail?: string };
export type Item = {
  key: string; checklistKey: string; itemId: string; section: string; seq: number; title: string; mandatory: boolean; status: Status;
  assignee: string; role: Role | ""; hours: number; due: string; notes: string; completedBy: string; completedOn: string;
  naReason: string; override: string; rule: string; // rule: why it was set aside or put to a question, if the rules did it
  after: string[]; description: string; guidance: string; link: string; stage: string; needsClient: string; review: "review" | "approve" | "";
  paper?: { section: string; sub?: string }; when?: Rule[]; gone?: boolean; history: Entry[]; rev: number;
};

const note = (s: string | undefined, n = 400) => (s || "").slice(0, n);
const push = (h: Entry[], e: Entry) => [...h, e].slice(-40);

export type Built = { items: Omit<Item, "key" | "checklistKey" | "rev">[]; questions: string[] };

/** Takes a snapshot of the template for one client and job. Unknown facts become a question, never a skipped step. */
export function generate(t: Template, facts: Facts, o: { now: string; by: string; owner?: string; due?: string; roles?: Partial<Record<Role, string>> } ): Built {
  const items: Built["items"] = [];
  let seq = 0;
  for (const s of t.sections) {
    for (const i of s.items) {
      const fit = evaluate(i.when, facts);
      const status: Status = fit === "no" ? "na" : fit === "unknown" ? "confirm" : "todo";
      const assignee = i.role ? o.roles?.[i.role] || (i.role === "owner" ? o.owner : "") || "" : "";
      items.push({
        itemId: i.id, section: s.title, seq: seq++, title: i.title, mandatory: i.mandatory, status, assignee: assignee || "", role: i.role || "", hours: i.hours, due: o.due || "", notes: "",
        completedBy: "", completedOn: "", naReason: fit === "no" ? `Rule: ${describeRules(i.when)}` : "", override: "", rule: fit === "yes" ? "" : describeRules(i.when),
        after: i.after, description: note(i.description, 1000), guidance: note(i.guidance, 1000), link: i.link || "", stage: i.stage || "", needsClient: i.needsClient || "", review: i.review || "",
        paper: i.paper, when: i.when, history: [{ at: o.now, by: o.by, action: fit === "no" ? "Not applicable" : fit === "unknown" ? "Needs confirming" : "Added", detail: fit === "yes" ? `From ${t.name} v${t.version}` : describeRules(i.when) }],
      });
    }
  }
  return { items, questions: openQuestions(t.sections.flatMap((s) => s.items.map((i) => i.when || [])), facts) };
}

/** Re-checks the rules after an answer changes. Only items nobody has touched are moved. */
export function reapply(items: Item[], facts: Facts, now: string, by: string): { key: string; patch: Partial<Item> }[] {
  const out: { key: string; patch: Partial<Item> }[] = [];
  for (const i of items) {
    if (!i.when?.length || i.gone) continue;
    const fit = evaluate(i.when, facts);
    const auto = i.status === "confirm" || (i.status === "na" && i.naReason.startsWith("Rule:"));
    if (!auto) continue;
    const next: Status = fit === "no" ? "na" : fit === "unknown" ? "confirm" : "todo";
    if (next === i.status) continue;
    out.push({ key: i.key, patch: { status: next, naReason: next === "na" ? `Rule: ${describeRules(i.when)}` : "", history: push(i.history, { at: now, by, action: next === "na" ? "Not applicable" : next === "todo" ? "Now applies" : "Needs confirming", detail: describeRules(i.when) }), rev: i.rev + 1 } });
  }
  return out;
}

/* ---------- what can be done now ---------- */

/** Whether the information this step needs from the client has come in (recorded on the item). */
export const infoReceived = (i: Item) => i.history.some((h) => h.action === "Information received");
const live = (items: Item[]) => items.filter((i) => !i.gone);
const finished = (i: Item) => i.status === "done" || i.status === "na";

/** Whether any step this one (directly or through others) waits for matches `test`. */
export function descendsFrom(item: Item, items: Item[], test: (i: Item) => boolean): boolean {
  const byId = new Map(items.map((i) => [i.itemId, i]));
  const seen = new Set<string>();
  const walk = (i: Item): boolean => {
    for (const id of i.after) {
      if (seen.has(id)) continue;
      seen.add(id);
      const a = byId.get(id);
      if (a && (test(a) || walk(a))) return true;
    }
    return false;
  };
  return walk(item);
}

/** Items this one is still waiting for. */
export function waitingFor(item: Item, items: Item[]): Item[] {
  return item.after.map((id) => items.find((x) => x.itemId === id)).filter((x): x is Item => !!x && !x.gone && !finished(x));
}

export type Verdict = { ok: boolean; reason?: string };
const deny = (reason: string): Verdict => ({ ok: false, reason });

/** Whether `user` can mark this item done, with the plain-English reason if not. */
export function canComplete(item: Item, items: Item[], cfg: Config, user: string, cl?: { preparedBy?: string; status?: string }): Verdict {
  if (item.status === "done") return deny("Already completed.");
  if (item.status === "na") return deny("This item is set as not applicable. Reopen it first.");
  if (item.status === "confirm") return deny("Confirm whether this item applies first.");
  const wait = waitingFor(item, items);
  if (wait.length) return deny(`Waiting for: ${wait.slice(0, 3).map((w) => w.title).join("; ")}${wait.length > 3 ? ` and ${wait.length - 3} more` : ""}.`);
  if (item.review) {
    if (cl?.status === "active") return deny("Submit the checklist for review first. Review steps are done by the reviewer once the preparer has handed the work over.");
    if (!can(cfg, user, item.review === "approve" ? "approve" : "review")) return deny(`Only a reviewer, manager or partner can complete "${item.title}".`);
    if (cfg.independentReview && cl?.preparedBy && same(cl.preparedBy, user)) return deny("The person who prepared the work can't review or approve it. Another reviewer is needed.");
  }
  return { ok: true };
}

export type Change = { patch: Partial<Item>; entry: Entry };
const apply = (item: Item, patch: Partial<Item>, e: Entry): Change => ({ patch: { ...patch, history: push(item.history, e), rev: item.rev + 1 }, entry: e });

export function complete(item: Item, items: Item[], cfg: Config, user: string, now: string, cl?: { preparedBy?: string; status?: string }): Change | Verdict {
  const v = canComplete(item, items, cfg, user, cl);
  if (!v.ok) return v;
  return apply(item, { status: "done", completedBy: user, completedOn: now }, { at: now, by: user, action: "Completed" });
}

export function setStatus(item: Item, status: "todo" | "doing" | "blocked", user: string, now: string, reason = ""): Change | Verdict {
  if (status === "blocked" && !reason.trim()) return deny("Say what the item is blocked on.");
  if (item.status === "done" || item.status === "na") return deny("Reopen the item before changing its status.");
  return apply(item, { status, notes: status === "blocked" ? `${item.notes ? item.notes + "\n" : ""}Blocked: ${reason.trim()}` : item.notes }, { at: now, by: user, action: STATUS_LABEL[status], detail: reason.trim() });
}

/** Marks an item not applicable. A mandatory item needs an authorised person and a reason, which stay on record. */
export function markNa(item: Item, cfg: Config, user: string, now: string, reason: string): Change | Verdict {
  if (item.status === "done") return deny("Reopen the completed item first.");
  const why = reason.trim();
  if (item.mandatory) {
    if (!can(cfg, user, "override")) return deny("This item is mandatory. Only an authorised person can set it aside.");
    if (!why) return deny("A reason is needed to set aside a mandatory item.");
    return apply(item, { status: "na", naReason: why, override: `${user} on ${now.slice(0, 10)}: ${why}` }, { at: now, by: user, action: "Mandatory override", detail: why });
  }
  return apply(item, { status: "na", naReason: why || "Not needed for this job", override: "" }, { at: now, by: user, action: "Not applicable", detail: why });
}

/** A confirmed answer for an item the rules could not decide on. */
export function confirmItem(item: Item, applies: boolean, user: string, now: string): Change {
  return apply(item, { status: applies ? "todo" : "na", naReason: applies ? "" : `Confirmed not applicable by ${user}`, rule: item.rule }, { at: now, by: user, action: applies ? "Confirmed applies" : "Confirmed not applicable" });
}

/** Reopens a finished item. What happened before stays in its history. */
export function reopen(item: Item, cfg: Config, user: string, now: string, reason: string): Change | Verdict {
  if (item.status !== "done" && item.status !== "na") return deny("Only completed or not-applicable items can be reopened.");
  if (item.status === "done" && item.completedBy && !same(item.completedBy, user) && !can(cfg, user, "reopen")) return deny("Only the person who completed it, or a reviewer, manager or partner, can reopen it.");
  return apply(item, { status: "todo", completedBy: "", completedOn: "", naReason: "", override: "" }, { at: now, by: user, action: "Reopened", detail: [reason.trim(), item.status === "done" ? `was completed by ${item.completedBy} on ${item.completedOn.slice(0, 10)}` : "was not applicable"].filter(Boolean).join(": ") });
}

export function assign(item: Item, to: string, cfg: Config, user: string, now: string): Change | Verdict {
  if (!can(cfg, user, "reassign")) return deny("You can't reassign items.");
  if (same(item.assignee, to)) return deny("Already assigned to them.");
  return apply(item, { assignee: to }, { at: now, by: user, action: "Responsibility changed", detail: `${item.assignee || "nobody"} to ${to || "nobody"}` });
}

/* ---------- the checklist as a whole ---------- */

export type Progress = {
  total: number; done: number; pct: number; mandatoryOpen: Item[]; confirm: number; blocked: Item[]; overdue: Item[];
  hoursLeft: number; reviewOpen: number; prepOpen: number; waitingClient: Item[]; readyForReview: boolean; readyToComplete: boolean;
};

/** The one place progress is worked out. Not-applicable items are left out; items still to confirm count as outstanding. */
export function progress(all: Item[], today: string, noteCount = 0): Progress {
  const items = live(all);
  const counted = items.filter((i) => i.status !== "na");
  const done = counted.filter((i) => i.status === "done").length;
  const open = counted.filter((i) => i.status !== "done");
  const mandatoryOpen = open.filter((i) => i.mandatory);
  // steps the preparer must finish before handing over: not review steps, and not steps that come after a review
  const prepOpen = open.filter((i) => !i.review && i.mandatory && !descendsFrom(i, items, (a) => !!a.review)).length;
  const reviewOpen = open.filter((i) => i.review).length;
  return {
    total: counted.length, done, pct: counted.length ? Math.round((done / counted.length) * 100) : 0, mandatoryOpen, confirm: items.filter((i) => i.status === "confirm").length,
    blocked: items.filter((i) => i.status === "blocked"),
    overdue: open.filter((i) => i.due && i.due < today && i.status !== "confirm"), hoursLeft: Math.round(open.reduce((n, i) => n + i.hours, 0) * 100) / 100,
    reviewOpen, prepOpen, waitingClient: open.filter((i) => i.needsClient && !infoReceived(i)),
    readyForReview: prepOpen === 0 && items.every((i) => i.status !== "confirm") && reviewOpen > 0,
    readyToComplete: mandatoryOpen.length === 0 && items.every((i) => i.status !== "confirm") && noteCount === 0 && counted.length > 0,
  };
}

/** What stops a job being marked complete. */
export function jobBlockers(items: Item[], openNotes = 0): string[] {
  const out: string[] = [];
  const p = progress(items, "9999-12-31");
  if (p.confirm) out.push(`${p.confirm} item${p.confirm === 1 ? "" : "s"} still need confirming as applicable`);
  for (const i of p.mandatoryOpen.slice(0, 5)) out.push(`Mandatory: ${i.title}`);
  if (p.mandatoryOpen.length > 5) out.push(`…and ${p.mandatoryOpen.length - 5} more mandatory items`);
  if (openNotes) out.push(`${openNotes} review point${openNotes === 1 ? "" : "s"} not yet resolved`);
  return out;
}

export type Sign = { preparedBy: string; preparedOn: string; reviewedBy: string; reviewedOn: string; approvedBy: string; approvedOn: string };

/** Hands the work to review. Everything the preparer must do has to be finished first. */
export function submitForReview(items: Item[], user: string, now: string): { sign: Partial<Sign> } | Verdict {
  const p = progress(items, "9999-12-31");
  if (p.confirm) return deny("Confirm which items apply before submitting.");
  if (p.prepOpen) return deny(`${p.prepOpen} mandatory preparation item${p.prepOpen === 1 ? " is" : "s are"} still open.`);
  return { sign: { preparedBy: user, preparedOn: now } };
}

/** Final approval: reviewer rights, independence if required, review items done and no open points. */
export function approve(items: Item[], cfg: Config, user: string, now: string, sign: Partial<Sign>, openNotes: number): { sign: Partial<Sign> } | Verdict {
  if (!can(cfg, user, "approve")) return deny("Only a reviewer, manager or partner can approve.");
  if (cfg.independentReview && sign.preparedBy && same(sign.preparedBy, user)) return deny("You prepared this work, so someone else has to approve it.");
  if (openNotes) return deny(`${openNotes} review point${openNotes === 1 ? " is" : "s are"} still open.`);
  // everything before the approval must be done; steps that follow the approval (filing, closing) come after it
  const left = progress(items, "9999-12-31").mandatoryOpen.filter((i) => i.review !== "approve" && !descendsFrom(i, items, (a) => a.review === "approve"));
  if (left.length) return deny(`${left.length} mandatory item${left.length === 1 ? " is" : "s are"} still open.`);
  return { sign: { reviewedBy: user, reviewedOn: now, approvedBy: user, approvedOn: now } };
}

/* ---------- review notes ---------- */

export type NoteStatus = "open" | "ready" | "resolved";
export type ReviewNote = { key: string; checklistKey: string; itemKey: string; text: string; raisedBy: string; raisedOn: string; status: NoteStatus; response: string; respondedBy: string; resolvedBy: string; resolvedOn: string; history: Entry[]; rev: number };

export function raiseNote(text: string, cfg: Config, user: string): Verdict {
  if (!can(cfg, user, "review")) return deny("Only a reviewer, manager or partner can raise review notes.");
  if (!text.trim()) return deny("Write the review point first.");
  return { ok: true };
}
export function respondNote(n: ReviewNote, response: string, user: string, now: string): { patch: Partial<ReviewNote> } | Verdict {
  if (n.status === "resolved") return deny("This point is resolved.");
  if (!response.trim()) return deny("Write your response first.");
  return { patch: { status: "ready", response: response.trim(), respondedBy: user, history: push(n.history, { at: now, by: user, action: "Ready for re-review", detail: response.trim() }), rev: n.rev + 1 } };
}
export function resolveNote(n: ReviewNote, cfg: Config, user: string, now: string): { patch: Partial<ReviewNote> } | Verdict {
  if (!can(cfg, user, "review")) return deny("Only a reviewer, manager or partner can resolve a point.");
  if (n.status === "resolved") return deny("Already resolved.");
  return { patch: { status: "resolved", resolvedBy: user, resolvedOn: now, history: push(n.history, { at: now, by: user, action: "Resolved" }), rev: n.rev + 1 } };
}
export function reopenNote(n: ReviewNote, cfg: Config, user: string, now: string, why: string): { patch: Partial<ReviewNote> } | Verdict {
  if (!can(cfg, user, "review")) return deny("Only a reviewer, manager or partner can reopen a point.");
  if (n.status === "open") return deny("Already open.");
  return { patch: { status: "open", resolvedBy: "", resolvedOn: "", history: push(n.history, { at: now, by: user, action: "Reopened", detail: why.trim() }), rev: n.rev + 1 } };
}
export const openNoteCount = (notes: ReviewNote[]) => notes.filter((n) => n.status !== "resolved").length;

/* ---------- updating a checklist to a newer template ---------- */

export type Diff = { added: (TItem & { section: string })[]; removed: Item[]; changed: { item: Item; was: string[]; now: TItem & { section: string } }[]; sectionsChanged: boolean };

/** What would change if this checklist took the newer template. Nothing is applied by this. */
export function diffTemplate(items: Item[], t: Template): Diff {
  const have = new Map(live(items).map((i) => [i.itemId, i]));
  const want = allItems(t);
  const ids = new Set(want.map((i) => i.id));
  const added = want.filter((i) => !have.has(i.id));
  const removed = live(items).filter((i) => !ids.has(i.itemId));
  const changed: Diff["changed"] = [];
  for (const w of want) {
    const h = have.get(w.id);
    if (!h) continue;
    const was: string[] = [];
    if (h.title !== w.title) was.push(`title "${h.title}"`);
    if (h.mandatory !== w.mandatory) was.push(w.mandatory ? "now mandatory" : "now optional");
    if (JSON.stringify(h.after) !== JSON.stringify(w.after)) was.push("dependencies");
    if (h.section !== w.section) was.push(`section "${h.section}"`);
    if (was.length) changed.push({ item: h, was, now: w });
  }
  return { added, removed, changed, sectionsChanged: false };
}

/** Works out the row changes for an update the user has previewed. Finished work is never altered or removed. */
export function applyDiff(items: Item[], t: Template, facts: Facts, o: { now: string; by: string; checklistKey: string }): { create: Built["items"]; patch: { key: string; patch: Partial<Item> }[] } {
  const d = diffTemplate(items, t);
  const last = Math.max(-1, ...items.map((i) => i.seq));
  const built = generate({ ...t, sections: t.sections.map((s) => ({ ...s, items: s.items.filter((i) => d.added.some((a) => a.id === i.id)) })) }, facts, { now: o.now, by: o.by });
  const create = built.items.map((i, n) => ({ ...i, seq: last + 1 + n, history: [{ at: o.now, by: o.by, action: "Added by template update", detail: `${t.name} v${t.version}` }] }));
  const patch: { key: string; patch: Partial<Item> }[] = [];
  for (const r of d.removed) {
    if (r.status === "todo" && !r.notes) patch.push({ key: r.key, patch: { gone: true, history: push(r.history, { at: o.now, by: o.by, action: "Removed by template update" }), rev: r.rev + 1 } });
    else patch.push({ key: r.key, patch: { history: push(r.history, { at: o.now, by: o.by, action: "No longer in the template", detail: "Kept because work has started" }), rev: r.rev + 1 } });
  }
  for (const c of d.changed) {
    if (c.item.status === "done") continue;
    patch.push({ key: c.item.key, patch: { title: c.now.title, mandatory: c.now.mandatory, after: c.now.after, section: c.now.section, history: push(c.item.history, { at: o.now, by: o.by, action: "Updated from template", detail: c.was.join(", ") }), rev: c.item.rev + 1 } });
  }
  return { create, patch };
}

/* ---------- from a working paper's own status ---------- */

/** Items whose working paper is marked Done. The status already exists in the working papers, so it is used as is;
 *  opening or uploading a paper does nothing. Review steps need the paper to carry a reviewer's name. */
export function paperCompletions(items: Item[], papers: Row[], clientKey: string, period: string): { item: Item; by: string; on: string }[] {
  const out: { item: Item; by: string; on: string }[] = [];
  for (const i of live(items)) {
    if (!i.paper || i.status === "done" || i.status === "na" || i.status === "confirm") continue;
    const p = papers.find((r) => r.ClientKey === clientKey && r.PeriodEnd === period && r.ItemKey === i.paper!.section && r.Status === "done");
    if (!p) continue;
    if (i.review && !p.ReviewedBy) continue;
    if (waitingFor(i, items).length) continue;
    out.push({ item: i, by: String((i.review ? p.ReviewedBy : p.PreparedBy) || "Working papers"), on: String((i.review ? p.ReviewedOn : p.PreparedOn) || p.Updated || "") });
  }
  return out;
}

/* ---------- dashboards ---------- */

export type Summary = { checklistKey: string; jobKey: string; clientKey: string; jobType: string; p: Progress; status: string; assignees: string[] };
export function summarise(checklists: { key: string; jobKey: string; clientKey: string; jobType: string; status: string }[], items: Item[], today: string, notes: ReviewNote[] = []): Summary[] {
  return checklists.map((c) => {
    const mine = items.filter((i) => i.checklistKey === c.key);
    return { checklistKey: c.key, jobKey: c.jobKey, clientKey: c.clientKey, jobType: c.jobType, status: c.status, p: progress(mine, today, openNoteCount(notes.filter((n) => n.checklistKey === c.key))), assignees: [...new Set(mine.filter((i) => !finished(i) && i.assignee).map((i) => i.assignee))] };
  });
}

/** Open work per person, so the practice can see who has what. */
export function workload(items: Item[]): { who: string; open: number; hours: number; overdue: number }[] {
  const by = new Map<string, { who: string; open: number; hours: number; overdue: number }>();
  for (const i of live(items)) {
    if (finished(i) || i.status === "confirm") continue;
    const k = i.assignee || "Unassigned";
    const e = by.get(k) || { who: k, open: 0, hours: 0, overdue: 0 };
    e.open++; e.hours = Math.round((e.hours + i.hours) * 100) / 100;
    by.set(k, e);
  }
  return [...by.values()].sort((a, b) => b.open - a.open);
}

/* ---------- export and import ---------- */

export const EXPORT_FORMAT = "xproflow-checklist-templates";
export function exportTemplates(ts: Template[]): string {
  return JSON.stringify({ format: EXPORT_FORMAT, version: 1, templates: ts.map((t) => ({ name: t.name, description: t.description, jobType: t.jobType, clientKinds: t.clientKinds, when: t.when, hours: t.hours, sections: t.sections })) }, null, 2);
}
/** Reads an export file. Anything not in the expected shape is refused with a plain reason, never half-imported. */
export function importTemplates(text: string): { templates: Omit<Template, "id" | "version" | "active" | "isDefault">[]; error?: string } {
  let v: { format?: string; templates?: unknown };
  try { v = JSON.parse(text); } catch { return { templates: [], error: "That file isn't a template export (it isn't valid JSON)." }; }
  if (v?.format !== EXPORT_FORMAT || !Array.isArray(v.templates)) return { templates: [], error: "That file isn't a checklist template export." };
  const out: ReturnType<typeof importTemplates>["templates"] = [];
  for (const raw of v.templates as Partial<Template>[]) {
    if (!raw || typeof raw.name !== "string" || !Array.isArray(raw.sections)) return { templates: [], error: "One of the templates in the file is damaged." };
    const sections = raw.sections.map((s) => ({ id: newId("s"), title: String(s.title || "Section"), items: (s.items || []).map((i) => cleanItem(i)) }));
    // item ids are kept so dependencies still point at the right items
    out.push({ name: raw.name.slice(0, 120), description: String(raw.description || ""), jobType: String(raw.jobType || ""), clientKinds: Array.isArray(raw.clientKinds) ? raw.clientKinds.map(String) : [], when: raw.when, hours: Number(raw.hours) || templateHours({ sections }), sections });
  }
  return { templates: out };
}

/** A template made from a job's finished checklist: the same sections and steps, minus names, notes and dates. */
export function templateFromItems(items: Item[], name: string, jobType: string): Pick<Template, "name" | "jobType" | "sections" | "description" | "clientKinds" | "hours"> {
  const secs = new Map<string, TSection>();
  for (const i of live(items).sort((a, b) => a.seq - b.seq)) {
    const s = secs.get(i.section) || { id: newId("s"), title: i.section, items: [] };
    s.items.push(cleanItem({ id: i.itemId, title: i.title, description: i.description, guidance: i.guidance, link: i.link, mandatory: i.mandatory, hours: i.hours, role: i.role, after: i.after, when: i.when, stage: i.stage, paper: i.paper, needsClient: i.needsClient, review: i.review }));
    secs.set(i.section, s);
  }
  const sections = [...secs.values()];
  return { name, jobType, sections, description: "Made from a job's checklist.", clientKinds: [], hours: templateHours({ sections }) };
}
