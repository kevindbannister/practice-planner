import { todayIso } from "../lib/domain";
// Development Hub: the shared state for all of its screens. The inventory ships in code and the practice's changes are kept
// as small overlays in the Settings list; GitHub is read through the server bridge (api/devhub), never from the browser.
import React, { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { getAccessToken } from "../lib/auth";
import {
  Activity, AdminStore, Column, DecisionStore, Feature, FeatureEdit, FeatureStore, Integration, IntegrationStore, Issue, LogEntry, MilestoneStore, Task, TaskMeta, TaskStore,
  addLog, columnFromIssue, emptyFeatures, emptyTasks, isDevAdmin, issueRefs, labelsForColumn, mergeDecisions, mergeFeatures, mergeIntegrations, tasksFrom, Decision,
} from "../lib/devHub";
import { SEED_DECISIONS, SEED_FEATURES, SEED_INTEGRATIONS, SEED_MILESTONES, SNAPSHOT_ISSUES } from "../lib/devHubSeed";
import { readSetting, useData } from "./data";

declare const __DEMO__: boolean;

const K = { features: "dev.features", tasks: "dev.tasks", milestones: "dev.milestones", integrations: "dev.integrations", decisions: "dev.decisions", admins: "dev.admins", log: "dev.log" };

export type GhState = "loading" | "demo" | "off" | "ready" | "error";

async function bridge(method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; data: any }> {
  let res: Response;
  try {
    res = await fetch(`/api/devhub/${path}`, {
      method,
      headers: { "X-PP-Token": await getAccessToken(), Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    return { ok: false, status: 0, data: { error: "unreachable", message: "Couldn't reach the app's server. Check your internet connection." } };
  }
  let data: any = null;
  try { data = await res.json(); } catch { /* not JSON: the bridge isn't deployed */ }
  if (!data) data = { error: "no-bridge", message: "The Development Hub bridge isn't deployed yet." };
  return { ok: res.ok, status: res.status, data };
}

export interface Hub {
  admin: { allowed: boolean; open: boolean };
  user: string;
  features: Feature[];
  tasks: Task[];
  issues: Issue[];
  activity: Activity[];
  gh: { state: GhState; message: string; repo: string; at?: string };
  refreshGh(): Promise<void>;
  editFeature(id: string, edit: FeatureEdit, what?: string): Promise<void>;
  addFeature(f: Feature): Promise<void>;
  removeFeature(id: string): Promise<void>;
  taskMeta(n: number, patch: Partial<TaskMeta>): Promise<void>;
  moveTask(n: number, to: Column): Promise<string | null>;
  createIssue(title: string, body: string, labels: string[]): Promise<{ ok: boolean; message: string; issue?: Issue }>;
  updateIssue(n: number, patch: { title?: string; body?: string; state?: "open" | "closed" }): Promise<{ ok: boolean; message: string }>;
  comment(n: number, body: string): Promise<{ ok: boolean; message: string }>;
  integrations: Integration[]; saveIntegration(i: Integration, isNew: boolean): Promise<void>;
  decisions: Decision[]; saveDecision(d: Decision, isNew: boolean): Promise<void>;
  milestones: MilestoneStore; saveMilestones(m: MilestoneStore): Promise<void>;
  setAdmins(emails: string[]): Promise<void>; adminList: string[];
  log: LogEntry[];
  loaded: boolean;
}

const Ctx = createContext<Hub | null>(null);
export function useHub(): Hub {
  const h = useContext(Ctx);
  if (!h) throw new Error("useHub outside the Development Hub");
  return h;
}

export function HubProvider({ children }: { children: ReactNode }) {
  const { data, user, saveSetting } = useData();
  const who = user || "";
  const settings = data.settings;
  const featStore = readSetting<FeatureStore>(settings, K.features) || emptyFeatures();
  const taskStore = readSetting<TaskStore>(settings, K.tasks) || emptyTasks();
  const adminStore = readSetting<AdminStore>(settings, K.admins);
  const intStore = readSetting<IntegrationStore>(settings, K.integrations);
  const decStore = readSetting<DecisionStore>(settings, K.decisions);
  const msStore = readSetting<MilestoneStore>(settings, K.milestones) || { items: SEED_MILESTONES };
  const log = readSetting<LogEntry[]>(settings, K.log) || [];

  // always write on top of the latest saved copy, so two quick edits don't overwrite each other
  const latest = useRef(settings);
  latest.current = settings;
  const now = () => new Date().toISOString();
  const logIt = useCallback(async (what: string, ref?: string) => {
    const cur = readSetting<LogEntry[]>(latest.current, K.log);
    await saveSetting(K.log, addLog(cur, { at: now(), by: who, what, ref }));
  }, [saveSetting, who]);

  const features = useMemo(() => mergeFeatures(SEED_FEATURES, featStore), [featStore]);

  const editFeature = useCallback(async (id: string, edit: FeatureEdit, what?: string) => {
    const cur = readSetting<FeatureStore>(latest.current, K.features) || emptyFeatures();
    const custom = cur.custom.some((c) => c.id === id);
    const next: FeatureStore = custom
      ? { ...cur, custom: cur.custom.map((c) => (c.id === id ? mergeFeatures([c], { edits: { [id]: edit }, custom: [] })[0] : c)) }
      : { ...cur, edits: { ...cur.edits, [id]: { ...(cur.edits[id] || {}), ...edit } } };
    await saveSetting(K.features, next);
    if (what) await logIt(what, id);
  }, [saveSetting, logIt]);
  const addFeature = useCallback(async (f: Feature) => {
    const cur = readSetting<FeatureStore>(latest.current, K.features) || emptyFeatures();
    await saveSetting(K.features, { ...cur, custom: [...cur.custom, { ...f, custom: true }] });
    await logIt(`Added feature ${f.name}`, f.id);
  }, [saveSetting, logIt]);
  const removeFeature = useCallback(async (id: string) => {
    const cur = readSetting<FeatureStore>(latest.current, K.features) || emptyFeatures();
    const isCustom = cur.custom.some((c) => c.id === id);
    await saveSetting(K.features, isCustom ? { ...cur, custom: cur.custom.filter((c) => c.id !== id) } : { ...cur, removed: [...(cur.removed || []), id] });
    await logIt(`Removed feature ${id}`, id);
  }, [saveSetting, logIt]);

  // ------------------------------------------------------------------ GitHub
  const [issues, setIssues] = useState<Issue[]>(SNAPSHOT_ISSUES);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [gh, setGh] = useState<Hub["gh"]>({ state: __DEMO__ ? "demo" : "loading", message: "", repo: "kevindbannister/practice-planner" });

  const refreshGh = useCallback(async () => {
    if (__DEMO__) return;
    setGh((g) => ({ ...g, state: "loading" }));
    const st = await bridge("GET", "status");
    if (!st.ok) { setGh({ state: "error", message: st.data.message || "Couldn't reach the GitHub bridge.", repo: "kevindbannister/practice-planner" }); return; }
    if (!st.data.configured) { setGh({ state: "off", message: "The GitHub token hasn't been added to Azure yet (setting GITHUB_TOKEN). Showing the issues as they were on 6 November 2026.", repo: st.data.repo }); return; }
    const [is, ac] = await Promise.all([bridge("GET", "issues?state=all"), bridge("GET", "activity")]);
    if (!is.ok) { setGh({ state: "error", message: is.data.message || "GitHub didn't answer.", repo: st.data.repo }); return; }
    setIssues(is.data.issues as Issue[]);
    if (ac.ok) setActivity((ac.data.items as any[]).map((x) => ({ ...x, refs: issueRefs(x.title) })));
    setGh({ state: "ready", message: ac.ok ? "" : ac.data.message || "Recent activity couldn't be read.", repo: st.data.repo, at: now() });
  }, []);
  useEffect(() => { void refreshGh(); }, [refreshGh]);

  const tasks = useMemo(() => tasksFrom(issues, taskStore), [issues, taskStore]);

  const taskMeta = useCallback(async (n: number, patch: Partial<TaskMeta>) => {
    const cur = readSetting<TaskStore>(latest.current, K.tasks) || emptyTasks();
    await saveSetting(K.tasks, { meta: { ...cur.meta, [String(n)]: { ...(cur.meta[String(n)] || {}), ...patch } } });
  }, [saveSetting]);

  /** Move a card. GitHub is the source of truth: the label and open/closed state are changed there first, and if that fails
   *  the card keeps the move marked as not synced, with the reason, instead of pretending it worked. Returns an error message or null. */
  const moveTask = useCallback(async (n: number, to: Column): Promise<string | null> => {
    const issue = issues.find((i) => i.number === n);
    if (!issue) return "That issue isn't loaded.";
    if (columnFromIssue(issue) === to) { await taskMeta(n, { pending: undefined, error: undefined }); return null; }
    if (gh.state !== "ready") {
      await taskMeta(n, { pending: to, error: gh.state === "demo" ? "Demo build: not sent to GitHub." : "GitHub isn't connected, so this move is only recorded here." });
      return "GitHub isn't connected: the move is recorded here only and is marked not synced.";
    }
    const r = await bridge("PATCH", `issues/${n}`, { labels: labelsForColumn(issue.labels, to), state: to === "Done" ? "closed" : "open" });
    if (!r.ok) {
      await taskMeta(n, { pending: to, error: r.data.message || `GitHub refused (${r.status}).` });
      return r.data.message || "GitHub refused the change.";
    }
    setIssues((all) => all.map((i) => (i.number === n ? (r.data.issue as Issue) : i)));
    await taskMeta(n, { pending: undefined, error: undefined });
    await logIt(`Moved #${n} to ${to}`, `#${n}`);
    return null;
  }, [issues, gh.state, taskMeta, logIt]);

  const createIssue: Hub["createIssue"] = useCallback(async (title, body, labels) => {
    if (gh.state !== "ready") return { ok: false, message: "GitHub isn't connected, so no issue was created." };
    const r = await bridge("POST", "issues", { title, body, labels });
    if (!r.ok) return { ok: false, message: r.data.message || "GitHub refused the new issue.", issue: r.data.issue };
    setIssues((all) => [...all, r.data.issue as Issue]);
    await logIt(`Created issue #${r.data.issue.number}: ${title}`, `#${r.data.issue.number}`);
    return { ok: true, message: `Created #${r.data.issue.number}.`, issue: r.data.issue as Issue };
  }, [gh.state, logIt]);
  const updateIssue: Hub["updateIssue"] = useCallback(async (n, patch) => {
    if (gh.state !== "ready") return { ok: false, message: "GitHub isn't connected, so nothing was changed." };
    const r = await bridge("PATCH", `issues/${n}`, patch);
    if (!r.ok) return { ok: false, message: r.data.message || "GitHub refused the change." };
    setIssues((all) => all.map((i) => (i.number === n ? (r.data.issue as Issue) : i)));
    await logIt(`Updated issue #${n}`, `#${n}`);
    return { ok: true, message: "Saved to GitHub." };
  }, [gh.state, logIt]);
  const comment: Hub["comment"] = useCallback(async (n, body) => {
    if (gh.state !== "ready") return { ok: false, message: "GitHub isn't connected." };
    const r = await bridge("POST", `issues/${n}/comments`, { body });
    return r.ok ? { ok: true, message: "Comment added." } : { ok: false, message: r.data.message || "GitHub refused the comment." };
  }, [gh.state]);

  // ------------------------------------------------------------------ registers
  const integrations = useMemo(() => mergeIntegrations(SEED_INTEGRATIONS, intStore), [intStore]);
  const saveIntegration = useCallback(async (i: Integration, isNew: boolean) => {
    const cur = readSetting<IntegrationStore>(latest.current, K.integrations) || { edits: {}, custom: [] };
    const next: IntegrationStore = isNew ? { ...cur, custom: [...cur.custom, i] } : cur.custom.some((c) => c.id === i.id)
      ? { ...cur, custom: cur.custom.map((c) => (c.id === i.id ? i : c)) } : { ...cur, edits: { ...cur.edits, [i.id]: i } };
    await saveSetting(K.integrations, next);
    await logIt(`${isNew ? "Added" : "Updated"} approval: ${i.provider} ${i.service} (${i.status})`, i.id);
  }, [saveSetting, logIt]);
  const decisions = useMemo(() => mergeDecisions(SEED_DECISIONS, decStore), [decStore]);
  const saveDecision = useCallback(async (d: Decision, isNew: boolean) => {
    const cur = readSetting<DecisionStore>(latest.current, K.decisions) || { edits: {}, custom: [] };
    const next: DecisionStore = isNew ? { ...cur, custom: [...cur.custom, d] } : cur.custom.some((c) => c.id === d.id)
      ? { ...cur, custom: cur.custom.map((c) => (c.id === d.id ? d : c)) } : { ...cur, edits: { ...cur.edits, [d.id]: d } };
    await saveSetting(K.decisions, next);
    await logIt(`${isNew ? "Recorded" : "Revised"} decision: ${d.title}`, d.id);
  }, [saveSetting, logIt]);
  const saveMilestones = useCallback(async (m: MilestoneStore) => { await saveSetting(K.milestones, m); }, [saveSetting]);
  const setAdmins = useCallback(async (emails: string[]) => { await saveSetting(K.admins, { emails }); await logIt(`Development administrators set to ${emails.join(", ") || "nobody"}`); }, [saveSetting, logIt]);

  const hub: Hub = {
    admin: isDevAdmin(adminStore, who || (__DEMO__ ? "demo" : "")), user: who, features, tasks, issues, activity, gh, refreshGh, editFeature, addFeature, removeFeature, taskMeta, moveTask,
    createIssue, updateIssue, comment, integrations, saveIntegration, decisions, saveDecision, milestones: msStore, saveMilestones, setAdmins, adminList: adminStore?.emails || [],
    log, loaded: true,
  };
  return <Ctx.Provider value={hub}>{children}</Ctx.Provider>;
}

// ------------------------------------------------------------------ shared pieces

import { EVIDENCE_LABEL, PRIORITIES, PRIORITY_LABEL, Priority, STATUSES, Status, evidenceOf, issueUrl, repoUrl, resolveFile, buildTree, leafFeatures, rollup, Node } from "../lib/devHub";

export const STATUS_COLOR: Record<Status, string> = {
  "Not Started": "#8e8e93", Planned: "#6e7f99", "In Development": "#d98a00", "Ready for Testing": "#0a64d8", Testing: "#6a3fc4", Complete: "#1f9d55", Blocked: "#d0312d", Broken: "#8b1a1a",
};
const STATUS_CHIP: Record<Status, string> = { "Not Started": "", Planned: "", "In Development": "amber", "Ready for Testing": "blue", Testing: "blue", Complete: "green", Blocked: "red", Broken: "red" };

export function StatusChip({ status }: { status: Status }) {
  return <span className={`chip ${STATUS_CHIP[status]}`}><span className="dh-dot" style={{ background: STATUS_COLOR[status] }} aria-hidden="true" />{status}</span>;
}
export function PriorityChip({ p }: { p: Priority }) {
  return <span className="chip" title={PRIORITY_LABEL[p]}>{p === "None" ? "No priority" : p}</span>;
}
export function Bar({ parts, label }: { parts: { n: number; color: string; title: string }[]; label: string }) {
  const total = parts.reduce((a, b) => a + b.n, 0) || 1;
  return (
    <div className="dh-bar" role="img" aria-label={label}>
      {parts.filter((p) => p.n > 0).map((p) => <span key={p.title} title={`${p.title}: ${p.n}`} style={{ width: `${(p.n / total) * 100}%`, background: p.color }} />)}
    </div>
  );
}
export const statusParts = (by: Record<Status, number>) => STATUSES.map((s) => ({ n: by[s], color: STATUS_COLOR[s], title: s }));

const lines = (t: string) => t.split("\n").map((x) => x.trim()).filter(Boolean);

/** One feature, with everything known about it and the controls to change it. Used by the mind map and the inventory. */
export function FeatureDetail({ id, onSelect, onClose }: { id: string; onSelect: (id: string) => void; onClose?: () => void }) {
  const hub = useHub();
  const f = hub.features.find((x) => x.id === id);
  const [pendingComplete, setPendingComplete] = useState(false);
  const [evidence, setEvidence] = useState("");
  const [busy, setBusy] = useState("");
  const tree = useMemo(() => buildTree(hub.features), [hub.features]);
  const node = useMemo(() => { let hit: Node | undefined; const walk = (n: Node) => { if (n.f.id === id) hit = n; else n.children.forEach(walk); }; tree.forEach(walk); return hit; }, [tree, id]);
  if (!f || !node) return <div className="card pad"><p className="muted" style={{ margin: 0 }}>That feature isn't in the inventory any more.</p></div>;
  const group = node.children.length > 0;
  const shown = group ? rollup(node) : f.status;
  const issueNos = f.issues;
  const act = async (label: string, fn: () => Promise<void>) => { setBusy(label); try { await fn(); } finally { setBusy(""); } };
  const setStatus = (s: Status) => {
    if (s === "Complete") { setPendingComplete(true); return; }
    void act("status", () => hub.editFeature(f.id, { status: s, reviewed: todayIso(), live: s !== f.status && f.live ? null : f.live }, `${f.name}: ${f.status} → ${s}`));
  };
  const confirmComplete = () => act("status", async () => {
    const day = todayIso();
    await hub.editFeature(f.id, { status: "Complete", reviewed: day, live: { on: day, by: hub.user, note: evidence.trim() } }, `${f.name}: ${f.status} → Complete (${evidence.trim()})`);
    setPendingComplete(false); setEvidence("");
  });
  const ev = evidenceOf(f);
  return (
    <aside className="card pad stack dh-detail" aria-label={`${f.name} details`}>
      <div className="row-wrap" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div className="eyebrow">{node.kind === "area" ? "Area" : node.kind === "module" ? "Module" : node.kind === "feature" ? "Feature" : "Subfeature"} · <span className="mono">{f.id}</span></div>
          <h2 className="sec-h" style={{ marginTop: 2 }}>{f.name}</h2>
        </div>
        {onClose && <button type="button" className="btn small" onClick={onClose} aria-label="Close details">Close</button>}
      </div>
      <p style={{ margin: 0 }}>{f.desc || "No description yet."}</p>
      <div className="row-wrap"><StatusChip status={shown} />{group && <span className="muted" style={{ fontSize: 13 }}>worst state of {leafFeatures(node).length} features below</span>}<PriorityChip p={f.priority} />{!group && <span className={`chip ${ev === "live" ? "green" : ""}`}>{EVIDENCE_LABEL[ev]}</span>}</div>

      {!group && (
        <div className="dh-fields">
          <label>Status
            <select className="input" value={f.status} disabled={!!busy} onChange={(e) => setStatus(e.target.value as Status)}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
          </label>
          <label>Priority
            <select className="input" value={f.priority} disabled={!!busy} onChange={(e) => void act("priority", () => hub.editFeature(f.id, { priority: e.target.value as Priority }, `${f.name}: priority ${e.target.value}`))}>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</select>
          </label>
          <label>Completion (only if assessed)
            <input className="input" type="number" min={0} max={100} placeholder="Not assessed" defaultValue={f.completion ?? ""} key={`${f.id}:${f.completion}`}
              onBlur={(e) => { const v = e.target.value.trim(); const n = v === "" ? null : Math.max(0, Math.min(100, Math.round(Number(v)))); if (n !== (f.completion ?? null) && (n === null || !Number.isNaN(n))) void act("completion", () => hub.editFeature(f.id, { completion: n }, `${f.name}: completion ${n === null ? "cleared" : n + "%"}`)); }} />
          </label>
        </div>
      )}
      {pendingComplete && (
        <div className="alert amber" role="group" aria-label="Evidence needed">
          <strong>Complete needs evidence</strong>
          <span>Say what was checked live (which client, which journey, what happened). A screen existing or unit tests passing is not enough.</span>
          <textarea className="input" rows={2} value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="e.g. Ran BCK Interior's year-end through to signed accounts on 12 Nov; no duplicate entry" />
          <div className="row-wrap"><button type="button" className="btn small primary" disabled={evidence.trim().length < 10 || !!busy} onClick={() => void confirmComplete()}>Mark complete</button><button type="button" className="btn small" onClick={() => setPendingComplete(false)}>Cancel</button></div>
        </div>
      )}
      {f.live && <div className="alert green"><strong>Verified live {f.live.on}{f.live.by ? ` by ${f.live.by}` : ""}</strong><span>{f.live.note}</span></div>}

      {group && (
        <section><h3 className="dh-h">Contains</h3>
          <ul className="dh-list">{node.children.map((c) => <li key={c.f.id}><button type="button" className="linkbtn" onClick={() => onSelect(c.f.id)}>{c.f.name}</button> <StatusChip status={rollup(c)} /></li>)}</ul>
        </section>
      )}

      {f.deps.length > 0 && <section><h3 className="dh-h">Depends on</h3><ul className="dh-list">{f.deps.map((d) => { const t = hub.features.find((x) => x.id === d); const a = hub.integrations.find((x) => x.id === d); return <li key={d}>{t ? <button type="button" className="linkbtn" onClick={() => onSelect(d)}>{t.name}</button> : a ? <a href="#/devhub/integrations">{a.provider}: {a.service}</a> : d} {t && <StatusChip status={t.status} />}{a && <span className="chip">{a.status}</span>}</li>; })}</ul></section>}

      {!group && (
        <>
          <ListEdit title="Blockers" items={f.blockers} onSave={(v) => hub.editFeature(f.id, { blockers: v }, `${f.name}: blockers updated`)} empty="None recorded." />
          <ListEdit title="Known bugs" items={f.bugs} onSave={(v) => hub.editFeature(f.id, { bugs: v }, `${f.name}: bugs updated`)} empty="None recorded." />
          <ListEdit title="Next actions" items={f.next} onSave={(v) => hub.editFeature(f.id, { next: v }, `${f.name}: next actions updated`)} empty="None recorded." />
          <section>
            <h3 className="dh-h">Notes</h3>
            <textarea className="input" rows={3} defaultValue={f.notes} key={`${f.id}:n`} placeholder="Development notes" onBlur={(e) => { if (e.target.value !== f.notes) void hub.editFeature(f.id, { notes: e.target.value }, `${f.name}: notes updated`); }} />
          </section>
        </>
      )}

      <section><h3 className="dh-h">GitHub issues</h3>
        {issueNos.length ? <ul className="dh-list">{issueNos.map((n) => { const i = hub.issues.find((x) => x.number === n); return <li key={n}><a href={issueUrl(n)} target="_blank" rel="noreferrer">#{n}</a> {i ? i.title : ""} {i && <span className="chip">{i.state}</span>}</li>; })}</ul> : <p className="muted" style={{ margin: 0 }}>None linked.</p>}
      </section>
      <section><h3 className="dh-h">Source files</h3>
        {f.files.length ? <ul className="dh-list mono">{f.files.map((p) => <li key={p}><a href={repoUrl(resolveFile(p))} target="_blank" rel="noreferrer">{resolveFile(p)}</a></li>)}</ul> : <p className="muted" style={{ margin: 0 }}>{group ? "See the features below." : "No code yet."}</p>}
        {f.tests.length > 0 && <><h3 className="dh-h" style={{ marginTop: 8 }}>Tests</h3><ul className="dh-list mono">{f.tests.map((p) => <li key={p}><a href={repoUrl(resolveFile(p))} target="_blank" rel="noreferrer">{resolveFile(p)}</a></li>)}</ul></>}
      </section>
      <div className="row-wrap" style={{ justifyContent: "space-between" }}>
        <span className="muted" style={{ fontSize: 13 }}>Last reviewed {f.reviewed}</span>
        {!group && <button type="button" className="btn small" disabled={!!busy} onClick={() => void act("reviewed", () => hub.editFeature(f.id, { reviewed: todayIso() }, `${f.name}: reviewed`))}>Mark reviewed today</button>}
      </div>
    </aside>
  );
}

function ListEdit({ title, items, onSave, empty }: { title: string; items: string[]; onSave: (v: string[]) => Promise<void>; empty: string }) {
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState("");
  return (
    <section>
      <div className="row-wrap" style={{ justifyContent: "space-between" }}><h3 className="dh-h">{title}</h3>{!edit && <button type="button" className="linkbtn" onClick={() => { setText(items.join("\n")); setEdit(true); }}>Edit</button>}</div>
      {edit ? (
        <div className="stack" style={{ gap: 6 }}>
          <textarea className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} aria-label={title} placeholder="One per line" />
          <div className="row-wrap"><button type="button" className="btn small primary" onClick={() => void onSave(lines(text)).then(() => setEdit(false))}>Save</button><button type="button" className="btn small" onClick={() => setEdit(false)}>Cancel</button></div>
        </div>
      ) : items.length ? <ul className="dh-list">{items.map((x) => <li key={x}>{x}</li>)}</ul> : <p className="muted" style={{ margin: 0 }}>{empty}</p>}
    </section>
  );
}
