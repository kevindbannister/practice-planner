// The Action Centre screen (Phase 5): everything that needs doing, grouped, with views, filters, dismissal and preferences.
// What counts as an action, and when it goes away, is in lib/actions.ts.
import { useEffect, useMemo, useRef, useState } from "react";
import { todayIso, fmtDate } from "../lib/domain";
import {
  Action, CATEGORIES, DEFAULT_PREFS, Filters, Item, NO_FILTERS, PRIORITY_LABEL, Prefs, ViewKey, VIEWS, applyPrefs, applyView, buildActions, canSeeAll, dismiss, groupCounts, itemsOf, prefsKey, readPrefs, reconcile, restore, visibleTo,
} from "../lib/actions";
import { readEngagementSettings } from "../lib/engagements";
import { Row } from "../lib/schema";
import { useBackupAlert } from "./Backups";
import { useChAlerts } from "./CompaniesHouse";
import { useData, useIndex } from "./data";
import { useEditor } from "./Editors";
import { useOnboarding } from "./OnboardingPage";
import { usePortal } from "./portalKit";
import { useSales } from "./salesKit";
import { readStates } from "../lib/onboarding";

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));
const msgOf = (e: unknown) => (e instanceof Error && e.message ? e.message : "That didn't work. Try again.");

/** Every action outstanding right now, worked out from the live records, and the stored copy with its history. */
export function useActions() {
  const s = useSales();
  const { data, user } = useData();
  const idx = useIndex();
  const ch = useChAlerts();
  const backup = useBackupAlert();
  const portal = usePortal();
  const onboarding = useOnboarding();
  const today = todayIso();
  const derived = useMemo(() => buildActions({
    today, clients: data.clients as Row[], jobs: idx.openJobs as Row[], tasks: idx.openTasks as Row[], leads: s.leads, opps: s.opps, firstStageKey: s.stages[0].key, proposals: data.proposals, versions: data.proposalVersions,
    engagements: data.engagements, onboardings: data.onboardings, viewFor: onboarding.viewFor, clientServices: data.clientServices, portal: portal.overview?.attention || [], eng: readEngagementSettings(data.settings), catalogue: s.catalogue,
    cosecTx: data.cosecTx, chFlags: data.chFlags, ch, backup: backup || undefined, agentDone: (o) => !onboarding.settings.stages.find((x) => x.key === "agent")?.enabled || readStates(o.Stages).agent?.status === "done",
  }), [data, idx, ch, backup, portal.overview, s.catalogue, onboarding.settings, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const prefs = useMemo(() => readPrefs(data.settings, user || ""), [data.settings, user]);
  const items = useMemo(() => itemsOf(derived, data.actions), [derived, data.actions]);
  return { derived, items, prefs, user: user || "", cfg: s.cfg, seeAll: canSeeAll(s.cfg, user || ""), today };
}

/** Keeps the stored copy in step: new actions saved once, resolved ones closed with a note, returning ones reopened. Runs quietly, in small batches. */
export function ActionSync() {
  const a = useActions();
  const sales = useSales();
  const { store, user, updateMany, data, status, refreshList } = useDataSync();
  const busy = useRef(false);
  const failed = useRef(false);
  const last = useRef(0);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (status !== "ready" || busy.current || failed.current || !store.hasList("Actions")) return;
    const wait = last.current + 8000 - Date.now();
    if (wait > 0) { const t = setTimeout(() => setTick((x) => x + 1), wait); return () => clearTimeout(t); }
    const w = reconcile(a.derived, data.actions, { actor: user, now: new Date().toISOString(), pid: sales.ctx().pid });
    if (!w.creates.length && !w.patches.length) return;
    busy.current = true; last.current = Date.now();
    (async () => {
      if (w.creates.length) await store.createMany("Actions", w.creates);
      if (w.patches.length) await updateMany("Actions", w.patches);
      await refreshList("Actions");
    })().catch(() => { failed.current = true; }).finally(() => { busy.current = false; setTick((x) => x + 1); });
  }, [a.derived, data.actions, status, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
function useDataSync() { const d = useData(); return { store: d.store, user: d.user || "", updateMany: d.updateMany, data: d.data, status: d.status, refreshList: d.refreshList }; }

// ------------------------------------------------------------------ the screen

const PRI_CHIP: Record<string, string> = { high: "red", medium: "amber", low: "" };

export function ActionCentrePage() {
  const a = useActions();
  const { data, saveSetting, refreshList, create, updateMany } = useData();
  const { open: openEditor } = useEditor();
  const s = useSales();
  const [view, setView] = useState<ViewKey>(a.seeAll ? "all" : "mine");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState("");
  const [err, setErr] = useState<string>();
  const [showPrefs, setShowPrefs] = useState(false);
  const [busy, setBusy] = useState(false);
  const user = a.user;
  const ctx = () => ({ actor: user, now: new Date().toISOString(), pid: s.ctx().pid });

  // permission first, then this person's own choices of what to see
  const visible = useMemo(() => {
    const keep = new Set(applyPrefs(visibleTo(a.derived, a.cfg, user), a.prefs, user).map((x) => x.key));
    const mine = (x: Item) => a.seeAll || !x.assignee || x.assignee.trim().toLowerCase() === user.trim().toLowerCase();
    return { open: a.items.open.filter((x) => keep.has(x.key)), done: a.items.done.filter((x) => mine(x) && a.prefs.categories[x.category] !== false && (!a.prefs.assignedOnly || x.assignee.trim().toLowerCase() === user.trim().toLowerCase())) };
  }, [a.derived, a.items, a.cfg, a.prefs, user, a.seeAll]);
  const list = applyView(visible, view, filters, user, a.today, a.prefs.dueSoonDays);
  const counts: Record<ViewKey, number> = {
    mine: applyView(visible, "mine", NO_FILTERS, user, a.today).length, all: visible.open.length, overdue: applyView(visible, "overdue", NO_FILTERS, user, a.today).length,
    soon: applyView(visible, "soon", NO_FILTERS, user, a.today, a.prefs.dueSoonDays).length, completed: visible.done.length,
  };
  const groups = groupCounts(list);
  const people = useMemo(() => [...new Set([...visible.open, ...visible.done].map((x) => x.assignee).filter(Boolean))].sort(), [visible]);
  const clients = useMemo(() => [...new Map([...visible.open, ...visible.done].filter((x) => x.clientKey).map((x) => [x.clientKey, x.clientName])).entries()].sort((p, q) => p[1].localeCompare(q[1])), [visible]);

  const go = (x: Action) => {
    if (x.href.startsWith("editor:")) { const [, kind, key] = x.href.split(":"); openEditor({ kind: kind as "job", key }); } else window.location.hash = x.href.replace(/^#/, "");
  };
  const saveRows = async (r: { create?: Row; patch?: { row: Row; patch: Row } } | { error: string }) => {
    if ("error" in r) { setErr(r.error); return; }
    setBusy(true); setErr(undefined);
    try { if (r.create) await create("Actions", r.create); if (r.patch) await updateMany("Actions", [r.patch]); await refreshList("Actions"); } catch (e) { setErr(msgOf(e)); } finally { setBusy(false); }
  };
  const stored = (key: string) => data.actions.find((r) => str(r.Key) === key);
  const setF = (k: keyof Filters, v: string) => setFilters({ ...filters, [k]: v });

  return (
    <div className="page">
      <div className="plan-title"><h1>Action Centre</h1><span className="muted">{counts.all} outstanding{a.seeAll ? "" : " that are yours or unassigned"}</span></div>
      <p className="muted" style={{ marginTop: 0 }}>Everything that needs doing, worked out from the real records. An action goes away by itself when the work is done. Informational notices can be dismissed; nothing else can.</p>
      <nav className="subtabs" aria-label="Action views">
        {VIEWS.map((v) => <button key={v.key} type="button" className="linkbtn" style={{ fontWeight: view === v.key ? 700 : 400 }} aria-current={view === v.key ? "page" : undefined} onClick={() => setView(v.key)}>{v.label} ({counts[v.key]})</button>)}
        <button type="button" className="linkbtn" aria-expanded={showPrefs} onClick={() => setShowPrefs(!showPrefs)}>Notification preferences</button>
      </nav>
      {showPrefs && <PrefsPanel prefs={a.prefs} user={user} seeAll={a.seeAll} items={visible.open} onSave={async (p) => { await saveSetting(prefsKey(user), p); }} />}
      <div className="card pad inline-form" role="group" aria-label="Filters" style={{ marginBottom: 12 }}>
        <select className="input" aria-label="Client" value={filters.client} onChange={(e) => setF("client", e.target.value)}><option value="">All clients</option>{clients.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
        <select className="input" aria-label="Responsible user" value={filters.assignee} onChange={(e) => setF("assignee", e.target.value)}><option value="">Anyone</option><option value="(unassigned)">Unassigned</option>{people.map((p) => <option key={p}>{p}</option>)}</select>
        <select className="input" aria-label="Category" value={filters.category} onChange={(e) => setF("category", e.target.value)}><option value="">All categories</option>{CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select>
        <select className="input" aria-label="Priority" value={filters.priority} onChange={(e) => setF("priority", e.target.value)}><option value="">Any priority</option>{(["high", "medium", "low"] as const).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</select>
        <label className="row-wrap">{view === "completed" ? "Closed from" : "Due from"} <input className="input" type="date" value={filters.from} onChange={(e) => setF("from", e.target.value)} /></label>
        <label className="row-wrap">to <input className="input" type="date" value={filters.to} onChange={(e) => setF("to", e.target.value)} /></label>
        {JSON.stringify(filters) !== JSON.stringify(NO_FILTERS) && <button type="button" className="linkbtn" onClick={() => setFilters(NO_FILTERS)}>Clear filters</button>}
      </div>
      {err && <p role="alert" style={{ color: "var(--red-ink)" }}>{err}</p>}
      {!list.length ? <div className="card empty"><p>{view === "completed" ? "Nothing has been completed or dismissed yet." : view === "mine" ? "Nothing is assigned to you." : "Nothing outstanding here."}</p></div> : groups.filter((g) => g.items.length).map((g) => (
        <section key={g.category} className="card" style={{ marginBottom: 12 }} aria-label={g.label}>
          <button type="button" className="linkbtn" style={{ width: "100%", textAlign: "left", padding: "12px 14px", display: "flex", justifyContent: "space-between" }} aria-expanded={!collapsed[g.category]} onClick={() => setCollapsed({ ...collapsed, [g.category]: !collapsed[g.category] })}>
            <strong>{g.label}</strong>
            <span><span className="chip">{g.items.length}</span>{g.overdue > 0 && view !== "completed" ? <span className="chip red" style={{ marginLeft: 6 }}>{g.overdue} high</span> : null}</span>
          </button>
          {!collapsed[g.category] && (
            <ul className="plain" style={{ margin: 0, padding: "0 14px 8px" }}>
              {g.items.map((x) => (
                <li key={x.key} style={{ borderTop: "1px solid var(--line, #e5e7eb)", padding: "10px 0" }}>
                  <div className="row-wrap" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div className="stack" style={{ gap: 2, flex: 1, minWidth: 240 }}>
                      <button type="button" className="linkbtn" style={{ textAlign: "left", fontWeight: 600 }} onClick={() => go(x)}>{x.title}</button>
                      {x.detail && <span className="muted">{x.detail}</span>}
                      <span className="muted" style={{ fontSize: 12 }}>{x.clientName ? `${x.clientName} · ` : ""}{x.assignee ? `Assigned to ${x.assignee}` : "Unassigned"}{x.due ? ` · due ${fmtDate(x.due)}` : ""}</span>
                    </div>
                    <div className="row-wrap">
                      <span className={`chip ${PRI_CHIP[x.priority]}`}>{PRIORITY_LABEL[x.priority]}</span>
                      <span className={`chip ${x.state === "open" ? "amber" : x.state === "resolved" ? "green" : ""}`}>{x.state === "open" ? "Open" : x.state === "resolved" ? "Done" : "Dismissed"}</span>
                      {x.state === "open" && x.dismissible && <button type="button" className="btn small" disabled={busy} onClick={() => saveRows(dismiss(x, stored(x.key), "", ctx()))}>Dismiss</button>}
                      {x.state === "dismissed" && stored(x.key) && <button type="button" className="btn small" disabled={busy} onClick={() => saveRows(restore(stored(x.key)!, ctx()))}>Restore</button>}
                      {view === "completed" && <button type="button" className="linkbtn" aria-expanded={expanded === x.key} onClick={() => setExpanded(expanded === x.key ? "" : x.key)}>History</button>}
                    </div>
                  </div>
                  {expanded === x.key && (
                    <ul className="plain muted" style={{ margin: "6px 0 0", fontSize: 12 }}>
                      {x.history.map((h, i) => <li key={i}>{h.at.slice(0, 16).replace("T", " ")} · {h.by} · {h.what}{h.note ? `: ${h.note}` : ""}</li>)}
                      {!x.history.length && <li>No history recorded.</li>}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

function PrefsPanel({ prefs, user, seeAll, items, onSave }: { prefs: Prefs; user: string; seeAll: boolean; items: Item[]; onSave: (p: Prefs) => Promise<void> }) {
  const { store } = useData();
  const [p, setP] = useState<Prefs>(prefs);
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const [busy, setBusy] = useState(false);
  useEffect(() => setP(prefs), [prefs]);
  const draftEmail = async () => {
    setBusy(true); setMsg(undefined);
    try {
      if (!/.+@.+/.test(p.emailAddress)) throw new Error("Enter your email address first.");
      const mine = items.filter((x) => !user || !x.assignee || x.assignee.toLowerCase() === user.toLowerCase());
      const html = `<p>Your open actions (${mine.length}):</p><ul>${mine.slice(0, 80).map((x) => `<li><strong>${x.title.replace(/</g, "&lt;")}</strong>${x.clientName ? ` (${x.clientName.replace(/</g, "&lt;")})` : ""}${x.due ? `, due ${x.due}` : ""}</li>`).join("")}</ul>`;
      await (store as unknown as { graph: { post: (path: string, body: unknown) => Promise<unknown> } }).graph.post("/me/messages", { subject: `Your xproflow actions: ${mine.length} open`, body: { contentType: "HTML", content: html }, toRecipients: [{ emailAddress: { address: p.emailAddress } }] });
      setMsg({ ok: true, text: "A draft is in your Outlook drafts. Nothing was sent." });
    } catch (e) { setMsg({ ok: false, text: msgOf(e) }); } finally { setBusy(false); }
  };
  return (
    <section className="card pad stack" aria-label="Notification preferences" style={{ marginBottom: 12 }}>
      <h2 style={{ margin: 0, fontSize: 16 }}>Your notification preferences</h2>
      <label className="row-wrap"><input type="checkbox" checked={p.inApp} onChange={(e) => setP({ ...p, inApp: e.target.checked })} /> Show the outstanding count beside "View Action Centre" in the bell</label>
      <label className="row-wrap"><input type="checkbox" checked={p.assignedOnly} onChange={(e) => setP({ ...p, assignedOnly: e.target.checked })} /> Only show actions assigned to me</label>
      <label className="row-wrap"><input type="checkbox" checked={p.practiceWide} disabled={!seeAll} onChange={(e) => setP({ ...p, practiceWide: e.target.checked })} /> Open on "All practice actions"{seeAll ? "" : " (managers and partners only)"}</label>
      <label className="doc-field" style={{ maxWidth: 260 }}><span>"Due soon" means within</span><select className="input" value={p.dueSoonDays} onChange={(e) => setP({ ...p, dueSoonDays: Number(e.target.value) })}>{[3, 7, 14, 30].map((d) => <option key={d} value={d}>{d} days</option>)}</select></label>
      <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 4 }}><legend><strong>Categories to show</strong></legend>
        {CATEGORIES.map((c) => <label key={c.key} className="row-wrap"><input type="checkbox" checked={p.categories[c.key] !== false} onChange={(e) => setP({ ...p, categories: { ...p.categories, [c.key]: e.target.checked } })} /> {c.label}</label>)}
      </fieldset>
      <div className="stack" style={{ gap: 6 }}>
        <label className="row-wrap"><input type="checkbox" checked={p.email} onChange={(e) => setP({ ...p, email: e.target.checked })} /> I want my actions by email</label>
        <input className="input" type="email" aria-label="Your email address" placeholder="Your email address" value={p.emailAddress} onChange={(e) => setP({ ...p, emailAddress: e.target.value })} style={{ maxWidth: 320 }} />
        <p className="muted" style={{ margin: 0 }}>Emails aren't sent on a schedule yet: that needs a background service that isn't set up. For now, "Draft an email of my actions" puts a summary in your Outlook drafts for you to send. Turning a category off only hides it from your list; the work is still tracked.</p>
        <div><button type="button" className="btn" disabled={busy} onClick={draftEmail}>Draft an email of my actions</button></div>
      </div>
      <div className="row-wrap"><button type="button" className="btn primary" disabled={busy} onClick={async () => { setBusy(true); try { await onSave(p); setMsg({ ok: true, text: "Saved." }); } catch (e) { setMsg({ ok: false, text: msgOf(e) }); } finally { setBusy(false); } }}>Save preferences</button>{msg && <span role={msg.ok ? "status" : "alert"}>{msg.text}</span>}<button type="button" className="linkbtn" onClick={() => setP(DEFAULT_PREFS)}>Reset</button></div>
    </section>
  );
}

/** The link in the bell: opens the full Action Centre, with the count of what is outstanding for this person. */
export function ActionCentreLink({ onNavigate }: { onNavigate: () => void }) {
  const a = useActions();
  const n = applyPrefs(visibleTo(a.derived, a.cfg, a.user), a.prefs, a.user).filter((x) => !a.items.done.some((d) => d.key === x.key)).length;
  return <a className="btn primary" href="#/actions" onClick={onNavigate} style={{ display: "block", margin: "8px 14px", textAlign: "center" }}>View Action Centre{a.prefs.inApp ? ` (${n} outstanding)` : ""}</a>;
}

