// The Action Centre (Phase 5): everything that needs someone to do something, grouped.
//
// Actions are WORKED OUT from the real records each time (leads, proposals, onboarding, engagements, jobs, the portal),
// never typed in. Each has a stable key, so the same issue is one action however many times the data is read. When the
// underlying issue is dealt with the action disappears from "outstanding". A stored copy (PP Actions) keeps the audit
// trail: when it was first seen, when it resolved, and who dismissed it. Dismissing is only allowed for informational
// notices and never completes the underlying work.
import { Config } from "./checklist";
import { fmtDate, holdAlert, isHoldText, isOnHold, jobState } from "./domain";
import { coverageGaps, asEng, isInForce, EngagementSettings } from "./engagements";
import { feeReviewsDue } from "./fees";
import { View, isLiveOnboarding, onboardingAlerts, readAml, readStates, stageLines, amlProblems } from "./onboarding";
import { CatalogueService, clientTypeFor, effectiveStatus, proposalCan } from "./proposals";
import { Lead, Opp, isOpenOpp } from "./sales";
import { Row } from "./schema";
import { addDays } from "./planning";

const str = (v: unknown): string => (v === undefined || v === null ? "" : String(v));

export type Category = "sales" | "proposals" | "onboarding" | "engagement" | "aml" | "signatures" | "info" | "changes" | "jobs" | "other";
export const CATEGORIES: { key: Category; label: string }[] = [
  { key: "sales", label: "Sales & Leads" }, { key: "proposals", label: "Proposals" }, { key: "onboarding", label: "Client Onboarding" }, { key: "engagement", label: "Engagement Letters" },
  { key: "aml", label: "AML & Identity" }, { key: "signatures", label: "Document Signatures" }, { key: "info", label: "Client Information Requests" }, { key: "changes", label: "Client Changes Awaiting Approval" },
  { key: "jobs", label: "Practice Jobs & Deadlines" }, { key: "other", label: "Other Notifications" },
];
export const categoryLabel = (c: string) => CATEGORIES.find((x) => x.key === c)?.label || "Other Notifications";
export type Priority = "high" | "medium" | "low";
export const PRIORITY_LABEL: Record<Priority, string> = { high: "High", medium: "Medium", low: "Low" };

export type Action = { key: string; category: Category; title: string; clientKey: string; clientName: string; detail: string; assignee: string; due: string; priority: Priority; dismissible: boolean; href: string };

export type PortalItem = { kind: string; at: string; text: string; link: string; clientKey: string };
export type Source = {
  today: string; clients: Row[]; jobs: Row[]; tasks: Row[]; leads: Lead[]; opps: Opp[]; firstStageKey: string; proposals: Row[]; versions: Row[]; engagements: Row[]; onboardings: Row[];
  viewFor: (o: Row) => View | undefined; clientServices: Row[]; portal: PortalItem[]; eng: EngagementSettings; catalogue: CatalogueService[];
  /** Companies House flags and the backup warning, already worked out by their own screens. */
  ch: { key: string; level: "red" | "amber"; title: string; detail: string }[]; backup?: { level: "red" | "amber"; title: string; detail: string };
  /** Which services need an agent authorisation, for held-service reminders. */
  agentDone: (o: Row) => boolean;
};

const hash = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
const days = (a: string, b: string) => Math.round((Date.parse(b.slice(0, 10) + "T00:00:00Z") - Date.parse(a.slice(0, 10) + "T00:00:00Z")) / 86400000);

export function buildActions(src: Source): Action[] {
  const { today } = src;
  const soon = addDays(today, 7);
  const out: Action[] = [];
  const client = (k: string) => src.clients.find((c) => c.Key === k);
  const nameOf = (k: string) => str(client(k)?.Title);
  const manager = (k: string) => str(client(k)?.Manager || client(k)?.Partner);
  const add = (a: Partial<Action> & Pick<Action, "key" | "category" | "title" | "href">) => out.push({ clientKey: "", detail: "", assignee: "", due: "", priority: "medium", dismissible: false, ...a, clientName: a.clientName ?? nameOf(a.clientKey || "") });

  // ---- sales and leads
  for (const op of src.opps.filter(isOpenOpp)) {
    const who = op.ClientKey ? nameOf(str(op.ClientKey)) : str(src.leads.find((l) => l.Key === op.LeadKey)?.Title);
    if (op.FollowUp && op.FollowUp <= soon) add({ key: `sales:fu:${op.Key}`, category: "sales", title: op.FollowUp < today ? `Sales follow-up overdue: ${op.Title}` : `Sales follow-up due: ${op.Title}`, detail: `${op.FollowUp < today ? "Was due" : "Due"} ${fmtDate(String(op.FollowUp))}${op.NextAction ? `: ${op.NextAction}` : ""}`, clientKey: str(op.ClientKey), clientName: who, assignee: str(op.Owner), due: str(op.FollowUp), priority: op.FollowUp < today ? "high" : "medium", href: `#/sales/opp/${op.Key}` });
    else if (op.Stage === src.firstStageKey && !op.LastContact && str(op.Created).slice(0, 10) < today) add({ key: `sales:new:${op.Key}`, category: "sales", title: `New lead awaiting first contact: ${op.Title}`, detail: `Received ${fmtDate(str(op.Created).slice(0, 10))}`, clientKey: str(op.ClientKey), clientName: who, assignee: str(op.Owner), due: str(op.Created).slice(0, 10), priority: days(str(op.Created), today) >= 3 ? "high" : "medium", href: `#/sales/opp/${op.Key}` });
  }

  // ---- proposals
  for (const p of src.proposals) {
    const v = src.versions.find((x) => str(x.ProposalKey) === str(p.Key) && Number(x.Version) === Number(p.CurrentVersion || x.Version));
    const status = v ? effectiveStatus(v, today) : (str(p.Status) as ReturnType<typeof effectiveStatus>);
    const ck = str(p.ClientKey); const nm = ck ? nameOf(ck) : str(src.leads.find((l) => l.Key === p.LeadKey)?.Title);
    const base = { category: "proposals" as Category, clientKey: ck, clientName: nm, assignee: str(p.CreatedBy), href: `#/sales/proposal/${p.Key}` };
    const ref = str(p.Ref);
    if (status === "review") add({ ...base, key: `prop:review:${p.Key}`, title: `Proposal awaiting internal approval: ${nm || ref}`, detail: ref, priority: "medium" });
    else if (status === "approved") add({ ...base, key: `prop:approved:${p.Key}`, title: `Proposal approved but not sent: ${nm || ref}`, detail: ref, priority: "medium" });
    else if (status === "sent") {
      const until = str(v?.ValidUntil);
      if (until && until <= soon) add({ ...base, key: `prop:sent:${p.Key}`, title: until < today ? `Proposal passed its valid-until date: ${nm || ref}` : `Proposal valid until ${fmtDate(until)}: ${nm || ref}`, detail: `${ref}: sent, no answer recorded`, due: until, priority: until < today ? "high" : "medium" });
    } else if (status === "expired") add({ ...base, key: `prop:sent:${p.Key}`, title: `Proposal passed its valid-until date: ${nm || ref}`, detail: `${ref}: sent, no answer recorded`, due: str(v?.ValidUntil), priority: "high" });
    else if (str(p.Status) === "accepted") {
      const started = src.onboardings.some((o) => str(o.ProposalKey) === str(p.Key) && str(o.Status) !== "cancelled");
      if (!started) add({ ...base, key: `prop:accepted:${p.Key}`, title: `Proposal accepted: start onboarding for ${nm || ref}`, detail: `${ref} was accepted${v?.AcceptedBy ? ` by ${v.AcceptedBy}` : ""}. Nothing has been set up yet.`, priority: "high" });
    }
  }

  // ---- onboarding and AML
  for (const a of onboardingAlerts(src.onboardings, src.viewFor, src.clients, today)) {
    const key = a.key.split(":")[1]; const o = src.onboardings.find((x) => str(x.Key) === key);
    add({ key: `onb:${a.key}`, category: "onboarding", title: a.title, detail: a.detail, clientKey: str(o?.ClientKey), assignee: str(o?.Owner), priority: a.level === "red" ? "high" : "medium", href: a.href });
  }
  for (const o of src.onboardings) {
    const v = src.viewFor(o); if (!v) continue;
    if (isLiveOnboarding(o)) {
      const aml = readAml(o.Aml);
      if (aml.status === "inprogress" && !amlProblems(aml, clientTypeFor(str(v.client.Kind))).length) add({ key: `aml:review:${o.Key}`, category: "aml", title: `AML verification awaiting review: ${str(v.client.Title)}`, detail: `Prepared by ${aml.preparedBy}. Ready for approval.`, clientKey: str(o.ClientKey), assignee: str(o.Owner), priority: "medium", href: `#/sales/onboard/${o.Key}` });
    } else if (str(o.Status) === "activated") {
      let held: string[] = []; try { held = JSON.parse(str(o.ActivationSummary) || "{}").held || []; } catch { /* none */ }
      if (held.length) add({ key: `onb:held:${o.Key}`, category: "onboarding", title: `Services held for an agent authorisation: ${str(v.client.Title)}`, detail: `${held.join(", ")}. ${src.agentDone(o) ? "Authorisation recorded: start them." : "Record the authorisation to start them."}`, clientKey: str(o.ClientKey), assignee: str(o.Owner), priority: "medium", href: `#/sales/onboard/${o.Key}` });
    }
  }
  for (const c of src.clients) {
    const r = str(c.AMLReview).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(r) && r <= addDays(today, 60) && (!str(c.Status) || /^active$/i.test(str(c.Status)))) add({ key: `aml:renew:${c.Key}`, category: "aml", title: r < today ? `AML review overdue: ${str(c.Title)}` : `AML review due ${fmtDate(r)}: ${str(c.Title)}`, detail: `Review date ${fmtDate(r)}`, clientKey: str(c.Key), assignee: manager(str(c.Key)), due: r, priority: r < today ? "high" : "medium", href: `#/clients/${c.Key}` });
  }

  // ---- engagement letters and signatures
  for (const e of src.engagements) {
    const s = asEng(e.Status); const ck = str(e.ClientKey); const link = `#/sales/engagement/${e.Key}`; const nm = nameOf(ck); const ref = str(e.Ref);
    if (s === "review") add({ key: `eng:review:${e.Key}`, category: "engagement", title: `Engagement letter awaiting internal approval: ${nm}`, detail: ref, clientKey: ck, assignee: str(e.CreatedBy), href: link });
    else if (s === "approved") add({ key: `eng:approved:${e.Key}`, category: "engagement", title: `Engagement letter approved, not yet sent: ${nm}`, detail: ref, clientKey: ck, assignee: str(e.CreatedBy), href: link });
    else if (s === "out") {
      const waited = e.SentOn ? days(str(e.SentOn), today) : 0;
      add({ key: `sig:out:${e.Key}`, category: "signatures", title: `Engagement letter awaiting signature: ${nm}`, detail: `${ref} sent ${e.SentOn ? fmtDate(str(e.SentOn).slice(0, 10)) : ""}${str(e.SignProgress) ? `, signed by ${e.SignProgress}` : ""}`, clientKey: ck, assignee: str(e.CreatedBy) || manager(ck), due: "", priority: waited >= 7 ? "high" : "medium", href: link });
    }
    if (isInForce(e) && e.ReviewDate) {
      const rd = str(e.ReviewDate).slice(0, 10); const win = Math.max(...src.eng.remindDays);
      if (days(today, rd) <= win) add({ key: `eng:renew:${e.Key}`, category: "engagement", title: rd < today ? `Engagement review overdue: ${nm}` : `Engagement review due ${fmtDate(rd)}: ${nm}`, detail: `${ref}`, clientKey: ck, assignee: str(e.CreatedBy) || manager(ck), due: rd, priority: rd < today || days(today, rd) <= Math.min(...src.eng.remindDays) ? "high" : "medium", href: link });
    }
    if (isInForce(e) && str(e.ReviewRequest)) add({ key: `eng:early:${e.Key}`, category: "engagement", title: `Early engagement review requested: ${nm}`, detail: str(e.ReviewRequest), clientKey: ck, assignee: manager(ck), priority: "medium", href: link });
  }
  const seen = new Set<string>();
  for (const p of src.proposals.filter((x) => str(x.Status) === "accepted" && str(x.ClientKey))) {
    const ck = str(p.ClientKey); if (seen.has(ck)) continue; seen.add(ck);
    const gaps = coverageGaps(ck, src.proposals, src.versions, src.engagements, src.catalogue);
    if (gaps.length) add({ key: `eng:gap:${ck}`, category: "engagement", title: `No engagement letter yet for ${gaps.map((g) => g.name).join(", ")}: ${nameOf(ck)}`, detail: `Agreed in proposal ${gaps[0].proposalRef}`, clientKey: ck, assignee: manager(ck), priority: "medium", href: `#/sales/proposal/${p.Key}` });
  }

  // ---- the portal: things clients have sent or asked for
  for (const it of src.portal) {
    const key = `portal:${it.kind}:${hash(`${it.at}|${it.text}`)}`;
    const ck = it.clientKey || "";
    const base = { key, title: it.text, detail: it.at ? `Received ${fmtDate(it.at.slice(0, 10))}` : "", clientKey: ck, assignee: ck ? manager(ck) : "", href: it.link || "#/portal" };
    if (it.kind === "change") add({ ...base, category: "changes", priority: "high" });
    else if (it.kind === "identity") add({ ...base, category: "aml", priority: /expired/.test(it.text) ? "high" : "medium" });
    else if (it.kind === "signing") add({ ...base, category: "signatures", priority: "high" });
    else if (it.kind === "request") add({ ...base, category: "info", priority: "medium" });
    else if (it.kind === "document") add({ ...base, category: "info", priority: "low", dismissible: true });
    else add({ ...base, category: "other", priority: "low", dismissible: true });
  }

  // ---- practice jobs and deadlines
  for (const j of src.jobs) {
    const ck = str(j.ClientKey); const nm = nameOf(ck) || str(j.ClientName);
    if (isOnHold(j as never)) { const h = holdAlert(j as never, str(j.Deadline), today); if (h) add({ key: `job:${j.Key}`, category: "jobs", title: `${nm}: ${str(j.Title)}`, detail: h.text, clientKey: ck, assignee: manager(ck), due: str(j.Deadline), priority: h.level === "red" ? "high" : "medium", href: `editor:job:${j.Key}` }); continue; }
    if (!j.Deadline) continue;
    if (jobState(j as never, today).state === "overdue") add({ key: `job:${j.Key}`, category: "jobs", title: `${nm}: ${str(j.Title)}`, detail: `Was due ${fmtDate(str(j.Deadline))}`, clientKey: ck, assignee: manager(ck), due: str(j.Deadline), priority: "high", href: `editor:job:${j.Key}` });
    else if (!j.PlannedDate && str(j.Deadline) <= soon) add({ key: `job:${j.Key}`, category: "jobs", title: `${nm}: ${str(j.Title)}`, detail: `Due ${fmtDate(str(j.Deadline))}, not planned`, clientKey: ck, assignee: manager(ck), due: str(j.Deadline), priority: "medium", href: `editor:job:${j.Key}` });
  }
  for (const t of src.tasks) {
    const ck = str(t.ClientKey);
    if (isOnHold(t as never)) continue;
    if (t.DueDate && str(t.DueDate) < today) add({ key: `task:${t.Key}`, category: "jobs", title: ck ? `${nameOf(ck)}: ${str(t.Title)}` : str(t.Title), detail: `Task was due ${fmtDate(str(t.DueDate))}`, clientKey: ck, assignee: str(t.Assignee), due: str(t.DueDate), priority: "high", href: `editor:task:${t.Key}` });
  }

  // ---- other
  for (const a of src.ch) add({ key: `ch:${a.key}`, category: "other", title: a.title, detail: a.detail, priority: a.level === "red" ? "high" : "medium", href: "#/settings/companies-house" });
  if (src.backup) add({ key: "backup", category: "other", title: src.backup.title, detail: src.backup.detail, priority: src.backup.level === "red" ? "high" : "medium", href: "#/settings/backups" });
  for (const l of feeReviewsDue(src.clientServices, today, 30)) {
    add({ key: `fee:review:${l.key}`, category: "other", title: l.nextReview < today ? `Fee review overdue: ${nameOf(l.clientKey)}` : `Fee review due ${fmtDate(l.nextReview)}: ${nameOf(l.clientKey)}`, detail: `${l.serviceKey} at £${l.fee}`, clientKey: l.clientKey, assignee: manager(l.clientKey), due: l.nextReview, priority: l.nextReview < today ? "high" : "low", dismissible: l.nextReview >= today, href: `#/clients/${l.clientKey}` });
  }
  void readStates; void stageLines; void isHoldText;
  // one action per key, whatever the sources did
  const uniq = new Map<string, Action>(); for (const a of out) if (!uniq.has(a.key)) uniq.set(a.key, a);
  return [...uniq.values()];
}

// ------------------------------------------------------------------ who can see what

export type Role = "partner" | "manager" | "other";
/** Managers and partners see everything. Everyone else sees what is assigned to them and what is unassigned. */
export function canSeeAll(cfg: Config, user: string): boolean { return proposalCan(cfg, user, "send"); }
export const sameUser = (a: string, b: string) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
export function visibleTo(actions: Action[], cfg: Config, user: string): Action[] {
  return canSeeAll(cfg, user) ? actions : actions.filter((a) => !a.assignee || sameUser(a.assignee, user));
}

// ------------------------------------------------------------------ the stored copy and its audit trail

export type StoredStatus = "open" | "resolved" | "dismissed";
export type HistoryEntry = { at: string; by: string; what: "opened" | "resolved" | "reopened" | "dismissed" | "restored"; note?: string };
export const readHistory = (v: unknown): HistoryEntry[] => { try { const a = JSON.parse(str(v) || "[]"); return Array.isArray(a) ? a : []; } catch { return []; } };
type RCtx = { actor: string; now: string; pid: string };
const keep = (h: HistoryEntry[], e: HistoryEntry) => JSON.stringify([...h, e].slice(-30));

const rowFor = (a: Action, o: RCtx, status: StoredStatus, history: HistoryEntry[], extra: Row = {}): Row => ({
  Key: a.key, PracticeId: o.pid, Category: a.category, Title: a.title, ClientKey: a.clientKey, ClientName: a.clientName, Detail: a.detail, Assignee: a.assignee, Due: a.due, Priority: a.priority, Dismissible: a.dismissible, Href: a.href,
  Status: status, FirstSeen: o.now, ResolvedAt: "", ResolvedBy: "", DismissedBy: "", History: JSON.stringify(history), Updated: o.now, ...extra,
});
const SHOWN = ["Title", "ClientName", "Detail", "Assignee", "Due", "Priority", "Href", "Category"] as const;
const fieldsOf = (a: Action): Row => ({ Title: a.title, ClientName: a.clientName, Detail: a.detail, Assignee: a.assignee, Due: a.due, Priority: a.priority, Href: a.href, Category: a.category });

/** Compare what is outstanding now with what was stored, and say what to write: new actions, resolved ones, reopened ones. Never duplicates a key. */
export function reconcile(derived: Action[], stored: Row[], o: RCtx, limit = 60): { creates: Row[]; patches: { row: Row; patch: Row }[]; more: boolean } {
  const byKey = new Map<string, Row[]>(); for (const r of stored) byKey.set(str(r.Key), [...(byKey.get(str(r.Key)) || []), r]);
  const live = new Set(derived.map((d) => d.key));
  const creates: Row[] = []; const patches: { row: Row; patch: Row }[] = []; let more = false;
  const room = () => creates.length + patches.length < limit || ((more = true), false);
  for (const d of derived) {
    const rows = byKey.get(d.key);
    if (!rows) { if (room()) creates.push(rowFor(d, o, "open", [{ at: o.now, by: "system", what: "opened" }])); continue; }
    for (const r of rows) {
      const patch: Row = {};
      if (str(r.Status) === "resolved") { Object.assign(patch, { Status: "open", ResolvedAt: "", ResolvedBy: "" }, fieldsOf(d), { History: keep(readHistory(r.History), { at: o.now, by: "system", what: "reopened", note: "The issue came back" }) }); }
      else for (const k of SHOWN) { const cur = fieldsOf(d)[k]; if (str(r[k]) !== str(cur)) (patch as Record<string, unknown>)[k] = cur; }
      if (Object.keys(patch).length && room()) patches.push({ row: r, patch: { ...patch, Updated: o.now } });
    }
  }
  for (const [key, rows] of byKey) {
    if (live.has(key)) continue;
    for (const r of rows) if (str(r.Status) !== "resolved" && room()) patches.push({ row: r, patch: { Status: "resolved", ResolvedAt: o.now, ResolvedBy: "system", History: keep(readHistory(r.History), { at: o.now, by: "system", what: "resolved", note: str(r.Status) === "dismissed" ? "The issue was dealt with (it had been dismissed)" : "The underlying issue was dealt with" }), Updated: o.now } });
  }
  return { creates, patches, more };
}

/** Dismiss an informational notice. Mandatory actions can't be dismissed, and dismissing never completes the work. */
export function dismiss(a: Action, stored: Row | undefined, note: string, o: RCtx): { create?: Row; patch?: { row: Row; patch: Row } } | { error: string } {
  if (!a.dismissible) return { error: "This one can't be dismissed. It goes away when the underlying work is done." };
  const entry: HistoryEntry = { at: o.now, by: o.actor, what: "dismissed", note: note.trim() || undefined };
  if (!stored) return { create: rowFor(a, o, "dismissed", [{ at: o.now, by: "system", what: "opened" }, entry], { DismissedBy: o.actor }) };
  if (str(stored.Status) === "dismissed") return { error: "Already dismissed." };
  return { patch: { row: stored, patch: { Status: "dismissed", DismissedBy: o.actor, History: keep(readHistory(stored.History), entry), Updated: o.now } } };
}
export function restore(stored: Row, o: RCtx): { patch: { row: Row; patch: Row } } | { error: string } {
  if (str(stored.Status) !== "dismissed") return { error: "It isn't dismissed." };
  return { patch: { row: stored, patch: { Status: "open", DismissedBy: "", History: keep(readHistory(stored.History), { at: o.now, by: o.actor, what: "restored" }), Updated: o.now } } };
}

// ------------------------------------------------------------------ views and filters

export type ViewKey = "mine" | "all" | "overdue" | "soon" | "completed";
export const VIEWS: { key: ViewKey; label: string }[] = [{ key: "mine", label: "My actions" }, { key: "all", label: "All practice actions" }, { key: "overdue", label: "Overdue" }, { key: "soon", label: "Due soon" }, { key: "completed", label: "Completed" }];
export type Filters = { client: string; assignee: string; category: string; priority: string; from: string; to: string };
export const NO_FILTERS: Filters = { client: "", assignee: "", category: "", priority: "", from: "", to: "" };
export type Item = Action & { state: StoredStatus; resolvedAt: string; resolvedBy: string; dismissedBy: string; firstSeen: string; history: HistoryEntry[] };

/** Outstanding actions (worked out now, minus the dismissed ones) and the completed ones (resolved or dismissed). */
export function itemsOf(derived: Action[], stored: Row[]): { open: Item[]; done: Item[] } {
  const by = new Map<string, Row>(); for (const r of stored) if (!by.has(str(r.Key))) by.set(str(r.Key), r);
  const live = new Set(derived.map((d) => d.key));
  const mk = (a: Action, r: Row | undefined, state: StoredStatus): Item => ({ ...a, state, resolvedAt: str(r?.ResolvedAt), resolvedBy: str(r?.ResolvedBy), dismissedBy: str(r?.DismissedBy), firstSeen: str(r?.FirstSeen), history: readHistory(r?.History) });
  const open: Item[] = []; const done: Item[] = [];
  for (const d of derived) { const r = by.get(d.key); (str(r?.Status) === "dismissed" ? done : open).push(mk(d, r, str(r?.Status) === "dismissed" ? "dismissed" : "open")); }
  for (const [k, r] of by) if (!live.has(k) && str(r.Status) !== "open") done.push(mk({ key: k, category: (str(r.Category) || "other") as Category, title: str(r.Title), clientKey: str(r.ClientKey), clientName: str(r.ClientName), detail: str(r.Detail), assignee: str(r.Assignee), due: str(r.Due), priority: (str(r.Priority) || "medium") as Priority, dismissible: r.Dismissible === true || r.Dismissible === "true", href: str(r.Href) }, r, "resolved"));
  done.sort((a, b) => (b.resolvedAt || b.history[b.history.length - 1]?.at || "").localeCompare(a.resolvedAt || a.history[a.history.length - 1]?.at || ""));
  return { open, done };
}

export function applyView(items: { open: Item[]; done: Item[] }, view: ViewKey, f: Filters, me: string, today: string, soonDays = 7): Item[] {
  const end = addDays(today, soonDays);
  let list = view === "completed" ? items.done : items.open;
  if (view === "mine") list = list.filter((a) => sameUser(a.assignee, me));
  if (view === "overdue") list = list.filter((a) => a.due && a.due < today);
  if (view === "soon") list = list.filter((a) => a.due && a.due >= today && a.due <= end);
  if (f.client) list = list.filter((a) => a.clientKey === f.client);
  if (f.assignee) list = list.filter((a) => (f.assignee === "(unassigned)" ? !a.assignee : sameUser(a.assignee, f.assignee)));
  if (f.category) list = list.filter((a) => a.category === f.category);
  if (f.priority) list = list.filter((a) => a.priority === f.priority);
  if (f.from) list = list.filter((a) => (view === "completed" ? (a.resolvedAt || a.history[a.history.length - 1]?.at || "").slice(0, 10) : a.due) >= f.from);
  if (f.to) list = list.filter((a) => { const d = view === "completed" ? (a.resolvedAt || a.history[a.history.length - 1]?.at || "").slice(0, 10) : a.due; return !!d && d <= f.to; });
  const rank = { high: 0, medium: 1, low: 2 };
  return view === "completed" ? list : [...list].sort((a, b) => rank[a.priority] - rank[b.priority] || (a.due || "9999").localeCompare(b.due || "9999") || a.title.localeCompare(b.title));
}
export function groupCounts(list: Item[]): { category: Category; label: string; items: Item[]; overdue: number }[] {
  return CATEGORIES.map((c) => { const items = list.filter((a) => a.category === c.key); return { category: c.key, label: c.label, items, overdue: items.filter((a) => a.priority === "high").length }; });
}

// ------------------------------------------------------------------ notification preferences (per person)

export type Prefs = { inApp: boolean; email: boolean; emailAddress: string; categories: Record<string, boolean>; assignedOnly: boolean; practiceWide: boolean; dueSoonDays: number };
export const DEFAULT_PREFS: Prefs = { inApp: true, email: false, emailAddress: "", categories: Object.fromEntries(CATEGORIES.map((c) => [c.key, true])), assignedOnly: false, practiceWide: true, dueSoonDays: 7 };
export const prefsKey = (user: string) => `notify.prefs.${user.trim().toLowerCase()}`;
export function readPrefs(settings: Row[], user: string): Prefs {
  const row = settings.find((r) => r.Key === prefsKey(user));
  try {
    const o = JSON.parse(str(row?.Value) || "{}");
    const d = Number(o.dueSoonDays);
    return { inApp: o.inApp !== false, email: o.email === true, emailAddress: str(o.emailAddress), categories: { ...DEFAULT_PREFS.categories, ...(o.categories && typeof o.categories === "object" ? o.categories : {}) }, assignedOnly: o.assignedOnly === true, practiceWide: o.practiceWide !== false, dueSoonDays: [3, 7, 14, 30].includes(d) ? d : 7 };
  } catch { return DEFAULT_PREFS; }
}
/** What this person has chosen to be told about. Turning a category off hides it from their Action Centre; it does not resolve anything. */
export function applyPrefs(list: Action[], p: Prefs, user: string): Action[] {
  return list.filter((a) => p.categories[a.category] !== false && (!p.assignedOnly || sameUser(a.assignee, user)));
}
