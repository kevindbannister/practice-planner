// Development Hub: the model behind the feature inventory, mind map, board, roadmap, approvals tracker and decision register.
// Pure logic, no screens. The inventory itself ships in the code (devHubSeed.ts, checked against the repository by a test);
// everything the practice changes in the Hub is kept as a small overlay in the Settings list, so it never overwrites the seed.

export const STATUSES = ["Not Started", "Planned", "In Development", "Ready for Testing", "Testing", "Complete", "Blocked", "Broken"] as const;
export type Status = (typeof STATUSES)[number];

export const PRIORITIES = ["P1", "P2", "P3", "P4", "P5", "Access", "None"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABEL: Record<Priority, string> = {
  P1: "P1 Core reliability", P2: "P2 Accounts and working papers", P3: "P3 Practice workflow", P4: "P4 Reporting and advisory",
  P5: "P5 Tax and statutory filing", Access: "Access (external approvals)", None: "Unprioritised",
};

/** How far a feature has actually been checked. A screen existing, or unit tests passing, is not live readiness. */
export type Evidence = "none" | "unit" | "live";
export const EVIDENCE_LABEL: Record<Evidence, string> = { none: "No tests found", unit: "Unit tests only", live: "Verified live" };

export type Kind = "root" | "area" | "module" | "feature" | "sub";

export interface Feature {
  id: string;
  parent: string;
  name: string;
  desc: string;
  status: Status;
  priority: Priority;
  /** Only set where an assessment supports it (a percentage worked out from a checklist, say). Never guessed. */
  completion?: number;
  files: string[];
  tests: string[];
  issues: number[];
  deps: string[];
  blockers: string[];
  bugs: string[];
  next: string[];
  notes: string;
  /** ISO date of the latest assessment. */
  reviewed: string;
  /** Set by the practice when a feature has been checked live, with what was checked. */
  live?: { on: string; by: string; note: string };
  custom?: boolean;
}

export interface FeatureEdit {
  status?: Status; priority?: Priority; completion?: number | null; notes?: string; blockers?: string[]; bugs?: string[]; next?: string[]; reviewed?: string;
  issues?: number[]; deps?: string[]; live?: Feature["live"] | null; desc?: string;
}
export interface FeatureStore { edits: Record<string, FeatureEdit>; custom: Feature[]; removed?: string[] }

export function emptyFeatures(): FeatureStore { return { edits: {}, custom: [], removed: [] }; }

/** The inventory the screens use: the shipped seed plus the practice's own edits and additions. */
export function mergeFeatures(seed: Feature[], store: FeatureStore | undefined): Feature[] {
  const s = store || emptyFeatures();
  const gone = new Set(s.removed || []);
  const out: Feature[] = [];
  for (const f of [...seed, ...s.custom]) {
    if (gone.has(f.id)) continue;
    const e = s.edits[f.id];
    if (!e) { out.push(f); continue; }
    const m: Feature = { ...f };
    if (e.status) m.status = e.status;
    if (e.priority) m.priority = e.priority;
    if (e.completion === null) delete m.completion;
    else if (typeof e.completion === "number") m.completion = e.completion;
    if (e.notes !== undefined) m.notes = e.notes;
    if (e.desc !== undefined) m.desc = e.desc;
    if (e.blockers) m.blockers = e.blockers;
    if (e.bugs) m.bugs = e.bugs;
    if (e.next) m.next = e.next;
    if (e.issues) m.issues = e.issues;
    if (e.deps) m.deps = e.deps;
    if (e.reviewed) m.reviewed = e.reviewed;
    if (e.live === null) delete m.live;
    else if (e.live) m.live = e.live;
    out.push(m);
  }
  return out;
}

export function evidenceOf(f: Feature): Evidence {
  if (f.live) return "live";
  return f.tests.length ? "unit" : "none";
}

// ------------------------------------------------------------------ tree

export interface Node { f: Feature; kind: Kind; children: Node[]; depth: number }

export function buildTree(features: Feature[]): Node[] {
  const byId = new Map<string, Node>();
  for (const f of features) byId.set(f.id, { f, kind: "feature", children: [], depth: 0 });
  const roots: Node[] = [];
  for (const n of byId.values()) {
    const p = byId.get(n.f.parent);
    if (p) p.children.push(n);
    else roots.push(n);
  }
  const mark = (n: Node, depth: number) => {
    n.depth = depth;
    n.kind = depth === 0 ? "area" : depth === 1 ? "module" : depth === 2 ? "feature" : "sub";
    n.children.forEach((c) => mark(c, depth + 1));
  };
  roots.forEach((r) => mark(r, 0));
  return roots;
}

export function descendants(n: Node): Feature[] {
  const out: Feature[] = [];
  const walk = (x: Node) => x.children.forEach((c) => { out.push(c.f); walk(c); });
  walk(n);
  return out;
}

/** Leaves are the things that are actually built or not; areas and modules only group them. */
export function leaves(features: Feature[]): Feature[] {
  const parents = new Set(features.map((f) => f.parent));
  return features.filter((f) => !parents.has(f.id));
}

/** The status shown on a group: the least finished state among what it holds, with blocked and broken taking priority. */
export function leafFeatures(n: Node): Feature[] { return n.children.length ? n.children.flatMap(leafFeatures) : [n.f]; }

export function rollup(n: Node): Status {
  const ls = leafFeatures(n);
  const have = new Set(ls.map((x) => x.status));
  for (const s of ["Broken", "Blocked"] as Status[]) if (have.has(s)) return s;
  const order: Status[] = ["Not Started", "Planned", "In Development", "Ready for Testing", "Testing", "Complete"];
  for (const s of order) if (have.has(s)) return s;
  return n.f.status;
}

export interface Counts { total: number; byStatus: Record<Status, number>; complete: number; inDev: number; testing: number; planned: number; blocked: number; broken: number }

export function countStatuses(features: Feature[]): Counts {
  const ls = leaves(features);
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<Status, number>;
  for (const f of ls) byStatus[f.status]++;
  return {
    total: ls.length, byStatus, complete: byStatus.Complete,
    inDev: byStatus["In Development"], testing: byStatus["Ready for Testing"] + byStatus.Testing,
    planned: byStatus.Planned + byStatus["Not Started"], blocked: byStatus.Blocked, broken: byStatus.Broken,
  };
}

export function byPriority(features: Feature[]): Record<Priority, Feature[]> {
  const out = Object.fromEntries(PRIORITIES.map((p) => [p, [] as Feature[]])) as Record<Priority, Feature[]>;
  for (const f of leaves(features)) out[f.priority].push(f);
  return out;
}

/** What needs attention: broken, blocked, then in development, then planned, ordered by agreed priority. */
export function attention(features: Feature[], limit = 12): Feature[] {
  const rank: Record<Status, number> = { Broken: 0, Blocked: 1, "In Development": 2, "Ready for Testing": 4, Testing: 3, Planned: 5, "Not Started": 6, Complete: 99 };
  const pr = (p: Priority) => (p === "Access" ? 0 : p === "None" ? 9 : Number(p.slice(1)));
  return leaves(features)
    .filter((f) => f.status !== "Complete")
    .sort((a, b) => rank[a.status] - rank[b.status] || pr(a.priority) - pr(b.priority) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export function filterFeatures(features: Feature[], o: { q?: string; status?: Status | ""; priority?: Priority | ""; area?: string }): Feature[] {
  const q = (o.q || "").trim().toLowerCase();
  const byId = new Map(features.map((f) => [f.id, f]));
  const areaOf = (f: Feature): string => { let x: Feature | undefined = f; while (x && x.parent) x = byId.get(x.parent); return x ? x.id : ""; };
  return features.filter((f) => {
    if (o.status && f.status !== o.status) return false;
    if (o.priority && f.priority !== o.priority) return false;
    if (o.area && areaOf(f) !== o.area) return false;
    if (!q) return true;
    return `${f.name} ${f.desc} ${f.id} ${f.notes} ${f.files.join(" ")}`.toLowerCase().includes(q);
  });
}

// ------------------------------------------------------------------ files

/** A short path such as "lib:planning" or "ui:PlanPage" to the file in the repository. */
export function resolveFile(p: string): string {
  const m = /^(lib|ui|test|api|apitest|doc|app|root):(.+)$/.exec(p);
  if (!m) return p;
  const [, kind, name] = m;
  if (kind === "lib") return name.includes(".") ? `app/src/lib/${name}` : `app/src/lib/${name}.ts`;
  if (kind === "ui") return name.includes(".") ? `app/src/ui/${name}` : `app/src/ui/${name}.tsx`;
  if (kind === "test") return `app/tests/${name}.test.ts`;
  if (kind === "api") return name.includes("/") ? `api/${name}` : `api/${name}/index.js`;
  if (kind === "apitest") return `api/test/${name}.test.js`;
  if (kind === "doc") return `docs/${name}.md`;
  return name;
}

export const REPO = "kevindbannister/practice-planner";
export const repoUrl = (path: string) => `https://github.com/${REPO}/blob/main/${path}`;
export const issueUrl = (n: number) => `https://github.com/${REPO}/issues/${n}`;

// ------------------------------------------------------------------ GitHub issues and the board

export const COLUMNS = ["Backlog", "Ready", "In Progress", "Blocked", "Testing", "Done"] as const;
export type Column = (typeof COLUMNS)[number];

/** The GitHub label that carries each column. Backlog is no label; Done is a closed issue. */
export const COLUMN_LABEL: Record<Column, string> = {
  Backlog: "", Ready: "status:ready", "In Progress": "status:in-progress", Blocked: "status:blocked", Testing: "status:testing", Done: "",
};
const STATUS_LABELS = Object.values(COLUMN_LABEL).filter(Boolean);

export interface Issue {
  number: number; title: string; state: "open" | "closed"; labels: string[]; assignee?: string; url: string; body: string; updated: string; milestone?: string;
}

export function columnFromIssue(i: Pick<Issue, "state" | "labels">): Column {
  if (i.state === "closed") return "Done";
  const l = i.labels.map((x) => x.toLowerCase());
  if (l.includes("status:blocked") || l.includes("blocked")) return "Blocked";
  if (l.includes("status:testing")) return "Testing";
  if (l.includes("status:in-progress")) return "In Progress";
  if (l.includes("status:ready")) return "Ready";
  return "Backlog";
}

/** The label set an issue should carry after moving to a column: other status labels removed, the column's added. */
export function labelsForColumn(current: string[], col: Column): string[] {
  const keep = current.filter((l) => !STATUS_LABELS.includes(l.toLowerCase()) && l.toLowerCase() !== "blocked");
  const add = COLUMN_LABEL[col];
  return add ? [...keep, add] : keep;
}

export interface TaskMeta {
  /** A column set in the Hub that GitHub hasn't confirmed yet (the move failed or GitHub isn't connected). */
  pending?: Column; error?: string;
  feature?: string; assignee?: string; target?: string; deps?: number[]; criteria?: string[]; notes?: string;
  checklist?: { text: string; done: boolean }[]; priority?: Priority;
}
export interface TaskStore { meta: Record<string, TaskMeta> }
export function emptyTasks(): TaskStore { return { meta: {} }; }

export interface Task extends Issue { column: Column; meta: TaskMeta; priority: Priority; synced: boolean }

/** The priority named in a title such as "[P1] ..." or "[Access] ...". */
export function priorityFromTitle(title: string): Priority {
  const m = /^\s*\[(P[1-5]|Access)\]/i.exec(title);
  if (!m) return "None";
  const t = m[1];
  return (t.toLowerCase() === "access" ? "Access" : t.toUpperCase()) as Priority;
}

export function tasksFrom(issues: Issue[], store: TaskStore | undefined): Task[] {
  const meta = (store || emptyTasks()).meta;
  return issues.map((i) => {
    const m = meta[String(i.number)] || {};
    const fromGithub = columnFromIssue(i);
    return { ...i, meta: m, column: m.pending || fromGithub, priority: m.priority || priorityFromTitle(i.title), synced: !m.pending || m.pending === fromGithub };
  }).sort((a, b) => a.number - b.number);
}

/** Issue numbers named in commit messages, pull request titles and bodies ("#12", "fixes #12"). */
export function issueRefs(text: string): number[] {
  const out = new Set<number>();
  for (const m of text.matchAll(/(?:^|[^\w&/])#(\d{1,6})\b/g)) out.add(Number(m[1]));
  return [...out];
}

export interface Activity { kind: "commit" | "pull" | "issue"; id: string; title: string; url: string; at: string; by: string; state?: string; refs: number[] }

/** Duplicate check before creating an issue: the same title (ignoring case, spacing and the [P1] prefix) already exists. */
export function duplicateIssue(title: string, issues: Issue[]): Issue | undefined {
  const norm = (s: string) => s.replace(/^\s*\[[^\]]*\]\s*/, "").toLowerCase().replace(/\s+/g, " ").trim();
  const n = norm(title);
  if (!n) return undefined;
  return issues.find((i) => norm(i.title) === n);
}

// ------------------------------------------------------------------ roadmap

export interface RoadmapItem { name: string; features: string[] }
export interface RoadmapPriority { id: Priority; title: string; items: RoadmapItem[]; issue?: number }
export interface Milestone { id: string; title: string; priority: Priority; target?: string; done: boolean; items: { text: string; done: boolean }[]; issues: number[]; notes: string }
export interface MilestoneStore { items: Milestone[] }

export interface Progress { total: number; byStatus: Record<Status, number>; complete: number; pastBuild: number }

/** Progress for a set of features: how many are verified complete, and how many are at least built and awaiting testing. */
export function progressOf(features: Feature[]): Progress {
  const c = countStatuses(features);
  const pastBuild = c.byStatus["Ready for Testing"] + c.byStatus.Testing + c.byStatus.Complete;
  return { total: c.total, byStatus: c.byStatus, complete: c.complete, pastBuild };
}

export function featuresUnder(all: Feature[], ids: string[]): Feature[] {
  const byParent = new Map<string, Feature[]>();
  for (const f of all) byParent.set(f.parent, [...(byParent.get(f.parent) || []), f]);
  const out = new Map<string, Feature>();
  const add = (id: string) => {
    const f = all.find((x) => x.id === id);
    if (!f) return;
    const kids = byParent.get(id) || [];
    if (!kids.length) out.set(f.id, f);
    kids.forEach((k) => add(k.id));
  };
  ids.forEach(add);
  return [...out.values()];
}

// ------------------------------------------------------------------ external approvals

export const API_STATUSES = ["Not Checked", "Not Required", "Need to Apply", "Applied", "Awaiting Approval", "Approved", "Credentials Received", "Testing", "Operational", "Blocked"] as const;
export type ApiStatus = (typeof API_STATUSES)[number];

export interface Integration {
  id: string; provider: string; service: string; requirement: string; status: ApiStatus;
  submitted?: string; expected?: string; reference?: string; next: string; blockers: string;
  tasks: number[]; features: string[]; docs: string; followUp?: string; notes?: string;
  history?: { on: string; status: ApiStatus; note?: string }[];
}
export interface IntegrationStore { edits: Record<string, Partial<Integration>>; custom: Integration[] }

export function mergeIntegrations(seed: Integration[], store: IntegrationStore | undefined): Integration[] {
  const s = store || { edits: {}, custom: [] };
  return [...seed, ...s.custom].map((i) => ({ ...i, ...(s.edits[i.id] || {}) }));
}

/** Everything still waiting on someone else, or not yet started. Operational, approved credentials and "not required" are done. */
export function outstanding(list: Integration[]): Integration[] {
  const done: ApiStatus[] = ["Operational", "Credentials Received", "Approved", "Not Required", "Testing"];
  return list.filter((i) => !done.includes(i.status));
}

export function dueFollowUps(list: Integration[], today: string): Integration[] {
  return list.filter((i) => i.followUp && i.followUp <= today && i.status !== "Operational" && i.status !== "Not Required");
}

/** Secrets don't belong in the tracker. Refuses text that looks like a password, token or key. */
export function looksSecret(text: string): boolean {
  if (/\b(ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}/.test(text)) return true;
  if (/\bsk-[A-Za-z0-9]{20,}/.test(text)) return true;
  if (/(password|passwd|secret|api[ _-]?key|token|client[ _-]?secret)\s*[:=]\s*\S{6,}/i.test(text)) return true;
  if (/\b[A-Za-z0-9+/_-]{40,}={0,2}\b/.test(text) && !/\s/.test(text.trim())) return true;
  return false;
}

// ------------------------------------------------------------------ decisions

export const DECISION_STATUSES = ["Proposed", "Accepted", "Superseded", "Rejected"] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];
export interface DecisionVersion { on: string; by: string; decision: string; rationale: string; alternatives: string; consequences: string; status: DecisionStatus; why?: string }
export interface Decision { id: string; title: string; topic: string; current: DecisionVersion; history: DecisionVersion[] }
export interface DecisionStore { edits: Record<string, Decision>; custom: Decision[] }

export function mergeDecisions(seed: Decision[], store: DecisionStore | undefined): Decision[] {
  const s = store || { edits: {}, custom: [] };
  return [...seed, ...s.custom].map((d) => s.edits[d.id] || d);
}

/** Changing a decision keeps the old version in its history. */
export function reviseDecision(d: Decision, next: Omit<DecisionVersion, "on" | "by"> & { by: string }, on: string): Decision {
  const same = d.current.decision === next.decision && d.current.rationale === next.rationale && d.current.alternatives === next.alternatives
    && d.current.consequences === next.consequences && d.current.status === next.status;
  if (same) return d;
  return { ...d, current: { ...next, on }, history: [d.current, ...d.history] };
}

// ------------------------------------------------------------------ admins and the change log

export interface AdminStore { emails: string[] }

/** With no list set yet, the signed-in owner gets in (and is asked to name administrators); once a list exists only those people do. */
export function isDevAdmin(store: AdminStore | undefined, user: string | undefined): { allowed: boolean; open: boolean } {
  const list = (store?.emails || []).map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!list.length) return { allowed: !!user, open: true };
  return { allowed: !!user && list.includes(user.trim().toLowerCase()), open: false };
}

export interface LogEntry { at: string; by: string; what: string; ref?: string }
export function addLog(log: LogEntry[] | undefined, e: LogEntry, max = 300): LogEntry[] { return [e, ...(log || [])].slice(0, max); }
