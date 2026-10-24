// Turns checklist records into the models in checklist.ts and back, and plans the checklist a new job gets.
// Pure (no SharePoint, no screen) so the same code runs when a job is created and in the tests.
import {
  Answer, Config, Entry, Facts, Item, ReviewNote, Role, Rule, Sign, Status, Template, TSection, allItems, decodeSections, encodeSections, factsFor, generate, pickTemplate, roleLabel, templateHours,
} from "./checklist";
import { STARTERS, starterFor } from "./checklistStarters";
import { newKey } from "./planning";
import { Row } from "./schema";

const json = <T,>(v: unknown, fallback: T): T => {
  try { const x = JSON.parse(String(v || "")); return x ?? fallback; } catch { return fallback; }
};
const bool = (v: unknown) => v === true || v === "true" || v === 1;
const num = (v: unknown, d = 0) => (Number.isFinite(Number(v)) && v !== "" && v !== undefined && v !== null ? Number(v) : d);

export const DEFAULT_PRACTICE = "default";
/** The practice these records belong to (for a future multi-practice setup). */
export function practiceId(settings: Row[]): string {
  const r = settings.find((x) => x.Key === "practiceId");
  const v = r?.Value ? String(r.Value).replace(/^"|"$/g, "") : "";
  return v || DEFAULT_PRACTICE;
}

/* ---------- templates ---------- */

export function templateFromRow(r: Row): Template {
  return {
    id: String(r.Key), name: String(r.Title || "Untitled template"), description: String(r.Description || ""), jobType: String(r.JobType || ""),
    clientKinds: String(r.ClientKinds || "").split(",").map((x) => x.trim()).filter(Boolean), when: json<Rule[] | undefined>(r.Rules, undefined),
    version: num(r.Version, 1), active: r.Active === undefined || r.Active === "" ? true : bool(r.Active), isDefault: bool(r.IsDefault), hours: num(r.Hours),
    sections: decodeSections(String(r.Body || "")), created: r.Created ? String(r.Created) : undefined, updated: r.Updated ? String(r.Updated) : undefined, starter: r.Starter ? String(r.Starter) : undefined,
  };
}
export const templateRow = (t: Template, pid: string): Row => ({
  Key: t.id, Title: t.name, Description: t.description, JobType: t.jobType, ClientKinds: t.clientKinds.join(","), Rules: t.when?.length ? JSON.stringify(t.when) : "", Version: t.version,
  Active: t.active, IsDefault: t.isDefault, Hours: t.hours || templateHours(t), Body: encodeSections(t.sections), Starter: t.starter || "", Created: t.created || new Date().toISOString(), Updated: t.updated || new Date().toISOString(), PracticeId: pid,
});

/** A starter used straight from the library (not yet saved as the practice's own template). */
export function starterTemplate(starterId: string, jobType: string, version = 1): Template | undefined {
  const s = STARTERS.find((x) => x.starter === starterId);
  if (!s) return undefined;
  const { match: _m, ...rest } = s;
  return { ...rest, id: `starter:${s.starter}`, jobType, version, active: true, isDefault: true, starter: s.starter };
}

/* ---------- checklists, items, notes ---------- */

export type Checklist = {
  key: string; jobKey: string; clientKey: string; period: string; jobType: string; templateKey: string; templateVersion: number; templateName: string;
  status: "active" | "review" | "approved"; answers: Record<string, Answer>; sign: Sign; createdBy: string; created: string; rev: number; row: Row;
};
export function checklistFromRow(r: Row): Checklist {
  const st = String(r.Status || "active");
  return {
    key: String(r.Key), jobKey: String(r.JobKey || ""), clientKey: String(r.ClientKey || ""), period: String(r.PeriodEnd || ""), jobType: String(r.JobType || ""), templateKey: String(r.TemplateKey || ""),
    templateVersion: num(r.TemplateVersion, 1), templateName: String(r.TemplateName || ""), status: st === "review" || st === "approved" ? st : "active", answers: json(r.Answers, {}),
    sign: { preparedBy: String(r.PreparedBy || ""), preparedOn: String(r.PreparedOn || ""), reviewedBy: String(r.ReviewedBy || ""), reviewedOn: String(r.ReviewedOn || ""), approvedBy: String(r.ApprovedBy || ""), approvedOn: String(r.ApprovedOn || "") },
    createdBy: String(r.CreatedBy || ""), created: String(r.Created || ""), rev: num(r.Rev), row: r,
  };
}
export const signPatch = (s: Partial<Sign>): Row => Object.fromEntries(Object.entries(s).map(([k, v]) => [k[0].toUpperCase() + k.slice(1), v ?? ""]));

type Detail = { description?: string; guidance?: string; link?: string; stage?: string; needsClient?: string; review?: string; paper?: Item["paper"]; when?: Rule[]; rule?: string };
const STATUSES: Status[] = ["todo", "doing", "blocked", "done", "na", "confirm"];

export function itemFromRow(r: Row): Item {
  const d = json<Detail>(r.Detail, {});
  const st = String(r.Status || "todo") as Status;
  return {
    key: String(r.Key), checklistKey: String(r.ChecklistKey || ""), itemId: String(r.ItemId || ""), section: String(r.Section || ""), seq: num(r.Seq), title: String(r.Title || ""),
    mandatory: r.Mandatory === undefined || r.Mandatory === "" ? true : bool(r.Mandatory), status: STATUSES.includes(st) ? st : "todo", assignee: String(r.Assignee || ""), role: (String(r.Role || "") as Role | ""),
    hours: num(r.Hours), due: String(r.Due || ""), notes: String(r.Notes || ""), completedBy: String(r.CompletedBy || ""), completedOn: String(r.CompletedOn || ""), naReason: String(r.NaReason || ""),
    override: String(r.Override || ""), rule: d.rule || "", after: json<string[]>(r.After, []), description: d.description || "", guidance: d.guidance || "", link: d.link || "", stage: d.stage || "",
    needsClient: d.needsClient || "", review: d.review === "review" || d.review === "approve" ? d.review : "", paper: d.paper, when: d.when, gone: bool(r.Gone), history: json<Entry[]>(r.History, []), rev: num(r.Rev),
  };
}
const COLS: Partial<Record<keyof Item, string>> = {
  title: "Title", section: "Section", seq: "Seq", mandatory: "Mandatory", status: "Status", assignee: "Assignee", role: "Role", hours: "Hours", due: "Due", notes: "Notes", completedBy: "CompletedBy",
  completedOn: "CompletedOn", naReason: "NaReason", override: "Override", gone: "Gone", rev: "Rev",
};
/** The row fields for a change to an item. */
export function itemPatch(p: Partial<Item>): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(p)) {
    const col = COLS[k as keyof Item];
    if (col) out[col] = v as never;
    else if (k === "after") out.After = JSON.stringify(v);
    else if (k === "history") out.History = JSON.stringify(v);
  }
  return out;
}
export function itemRow(i: Omit<Item, "key" | "checklistKey" | "rev">, o: { key: string; checklistKey: string; jobKey: string; pid: string }): Row {
  const detail: Detail = { description: i.description, guidance: i.guidance, link: i.link, stage: i.stage, needsClient: i.needsClient, review: i.review, paper: i.paper, when: i.when, rule: i.rule };
  return {
    Key: o.key, ChecklistKey: o.checklistKey, JobKey: o.jobKey, ItemId: i.itemId, Title: i.title, Section: i.section, Seq: i.seq, Status: i.status, Mandatory: i.mandatory, Assignee: i.assignee, Role: i.role, Hours: i.hours,
    Due: i.due, Notes: i.notes, CompletedBy: i.completedBy, CompletedOn: i.completedOn, NaReason: i.naReason, Override: i.override, After: JSON.stringify(i.after), Detail: JSON.stringify(detail), Gone: false,
    History: JSON.stringify(i.history), Rev: 1, PracticeId: o.pid,
  };
}

export function noteFromRow(r: Row): ReviewNote {
  const st = String(r.Status || "open");
  return {
    key: String(r.Key), checklistKey: String(r.ChecklistKey || ""), itemKey: String(r.ItemKey || ""), text: String(r.Text || ""), raisedBy: String(r.RaisedBy || ""), raisedOn: String(r.RaisedOn || ""),
    status: st === "ready" || st === "resolved" ? st : "open", response: String(r.Response || ""), respondedBy: String(r.RespondedBy || ""), resolvedBy: String(r.ResolvedBy || ""), resolvedOn: String(r.ResolvedOn || ""),
    history: json<Entry[]>(r.History, []), rev: num(r.Rev),
  };
}
export function notePatch(p: Partial<ReviewNote>): Row {
  const out: Row = {};
  const map: Partial<Record<keyof ReviewNote, string>> = { status: "Status", response: "Response", respondedBy: "RespondedBy", resolvedBy: "ResolvedBy", resolvedOn: "ResolvedOn", rev: "Rev" };
  for (const [k, v] of Object.entries(p)) {
    if (k === "history") out.History = JSON.stringify(v);
    else if (map[k as keyof ReviewNote]) out[map[k as keyof ReviewNote]!] = v as never;
  }
  return out;
}

/** Whether a record has been changed by someone else since it was read (its revision number moved). */
export const isStale = (current: Row, read: Row) => num(current.Rev) !== num(read.Rev);

export const logRow = (o: { checklistKey: string; jobKey: string; clientKey: string; itemKey?: string; at: string; actor: string; action: string; detail?: string; pid: string }): Row => ({
  Key: newKey("CG"), ChecklistKey: o.checklistKey, JobKey: o.jobKey, ClientKey: o.clientKey, ItemKey: o.itemKey || "", At: o.at, Actor: o.actor, Action: o.action, Detail: (o.detail || "").slice(0, 900), PracticeId: o.pid,
});

/* ---------- planning a new job's checklist ---------- */

/** The people the roles in a template point at, from the client's own partner and manager. */
export function rolesFor(client: Row | undefined): Partial<Record<Role, string>> {
  const partner = String(client?.Partner || ""), manager = String(client?.Manager || "");
  return { partner, manager, owner: manager || partner, reviewer: partner || manager };
}

export type Plan = { checklist: Row; items: Row[]; log: Row[]; template: { key: string; name: string; version: number }; questions: string[]; usedStarter: boolean };

/** The checklist for a job: which template, what applies, who does what. Returns nothing if the job already has one or no template fits. */
export function planChecklist(o: {
  job: Row; client?: Row; serviceName: string; templates: Template[]; paperLines: Row[]; checklists: Row[]; now: string; user: string; pid: string;
  template?: Template; answers?: Record<string, Answer>;
}): Plan | null {
  const jobKey = String(o.job.Key);
  if (o.checklists.some((c) => c.JobKey === jobKey)) return null;
  const period = String(o.job.PeriodEnd || "");
  const fixed = o.paperLines.filter((l) => l.ClientKey === o.job.ClientKey && l.PeriodEnd === period && l.SectionKey === "fixed").length;
  const base = factsFor(o.client, { fixedAssetLines: fixed, answers: o.answers });
  const kind = base.kind;
  let template = o.template || pickTemplate(o.templates, String(o.job.ServiceKey || ""), base);
  let usedStarter = false;
  if (!template) {
    const s = starterFor(o.serviceName, kind, base.dormant === "yes");
    template = s ? starterTemplate(s.starter!, String(o.job.ServiceKey || "")) : undefined;
    usedStarter = !!template;
  }
  if (!template) return null;
  const key = `CL-${jobKey}`;
  const built = generate(template, base, { now: o.now, by: o.user || "System", owner: rolesFor(o.client).owner, due: String(o.job.InternalDeadline || o.job.Deadline || ""), roles: rolesFor(o.client) });
  const items = built.items.map((i) => itemRow(i, { key: `${key}-${i.itemId}`, checklistKey: key, jobKey, pid: o.pid }));
  const checklist: Row = {
    Key: key, JobKey: jobKey, ClientKey: String(o.job.ClientKey || ""), PeriodEnd: period, JobType: String(o.job.ServiceKey || ""), TemplateKey: template.id, TemplateVersion: template.version, TemplateName: template.name,
    Status: "active", Answers: JSON.stringify(o.answers || {}), CreatedBy: o.user || "System", Created: o.now, Updated: o.now, Rev: 1, PracticeId: o.pid,
  };
  const at = { checklistKey: key, jobKey, clientKey: String(o.job.ClientKey || ""), at: o.now, actor: o.user || "System", pid: o.pid };
  return {
    checklist, items, template: { key: template.id, name: template.name, version: template.version }, questions: built.questions, usedStarter,
    log: [logRow({ ...at, action: "Checklist created", detail: `${items.length} items` }), logRow({ ...at, action: "Template applied", detail: `${template.name} version ${template.version}` })],
  };
}

export const factsOfChecklist = (client: Row | undefined, answers: Record<string, Answer>, fixedAssetLines: number): Facts => factsFor(client, { fixedAssetLines, answers });
export { allItems, roleLabel };
export type { TSection };
