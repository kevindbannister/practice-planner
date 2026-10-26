// App shell: top bar, save indicator, and routing between pages.
import { ChecklistsPage } from "./Checklists";
import { PortalPage } from "./PortalAdmin";
import { PortalProvider, usePortal } from "./portalKit";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { fmtDate, holdAlert, isHoldText, isOnHold, jobState, todayIso } from "../lib/domain";
import { addDays } from "../lib/planning";
import { signOut } from "../lib/auth";
import { Brand, ClientBadge, Icon, IconName, href, useRoute } from "./bits";
import { useTheme } from "./theme";
import { ClientPage } from "./ClientPage";
import { ClientsPage } from "./ClientsPage";
import { useData, useIndex } from "./data";
import { SetupPage } from "./SetupPage";
import { EditorProvider, useEditor } from "./Editors";
import { PlanPage } from "./PlanPage";
import { HomePage } from "./HomePage";
import { ChasePage, useChaseCount } from "./ChasePage";
import { SettingsPage, SettingsTabs } from "./SettingsPage";
import { CompaniesHouseProvider, fmtWhen, useChAlerts, useCompaniesHouse } from "./CompaniesHouse";
import { BackupProvider, useBackupAlert } from "./Backups";
import { CalendarProvider } from "./Calendar";
import { AssistantProvider, useAssistant } from "./Assistant";
import { PageBoundary } from "./ErrorBoundary";
import { CommsPage } from "./Comms";
import { PapersPage } from "./PapersPage";
import { SalesPage } from "./SalesPage";
import { useSales } from "./salesKit";
import { salesAlerts } from "../lib/sales";
import { engagementAlerts, readEngagementSettings } from "../lib/engagements";
import { SearchButton } from "./Search";
import { readSetting } from "./data";
import { aiDefaults } from "../lib/ai";
import { readCommsPrefs } from "../lib/comms";
import { adoptWaitingJobs, initialWaitStages } from "../lib/waiting";

export function App({ demo }: { demo: boolean }) {
  const { status, error, reload, saveSetting, data } = useData();
  const { parts } = useRoute();
  // the model and effort chosen in Settings go with every AI request
  useEffect(() => {
    const p = readCommsPrefs(data.settings);
    aiDefaults.model = p.model || undefined;
    aiDefaults.effort = p.effort || undefined;
  }, [data.settings]);
  useWaitStageSetup(status === "ready");
  const section = parts[0] || "home";
  const path = parts.join("/");
  // a new screen starts at the top (after it has drawn)
  useEffect(() => {
    const id = requestAnimationFrame(() => window.scrollTo(0, 0));
    return () => cancelAnimationFrame(id);
  }, [path]);

  let body;
  if (status === "connecting" || status === "loading") {
    body = (
      <div className="center">
        <p className="muted">{status === "connecting" ? "Connecting to SharePoint…" : "Loading your clients…"}</p>
      </div>
    );
  } else if (status === "error") {
    body = (
      <div className="center">
        <div className="panel" role="alert">
          <h1>Couldn't load xproflow</h1>
          <p style={{ margin: 0 }}>{error}</p>
          <div><button type="button" className="btn primary" onClick={reload}>Try again</button></div>
        </div>
      </div>
    );
  } else if (status === "needs-setup" || section === "setup") {
    body = <SetupPage />;
  } else if (section === "clients" && parts[1] === "all") {
    body = <ClientsPage />;
  } else if (section === "clients" && parts[1]) {
    body = <ClientPage clientKey={parts[1]} tab={(["work", "comms", "meetings", "tax", "activity", "portal"].includes(parts[2]) ? parts[2] : "overview") as "overview"} />;
  } else if (section === "groups" || section === "clients") {
    body = <GroupsPage />;
  } else if (section === "home") {
    body = <HomePage />;
  } else if (section === "plan") {
    body = <PlanPage />;
  } else if (section === "settings") {
    body = <SettingsPage />;
  } else if (section === "sales") {
    body = <SalesPage />;
  } else if (section === "chase") {
    body = <ChasePage />;
  } else if (section === "comms") {
    body = <CommsPage />;
  } else if (section === "papers") {
    body = <PapersPage />;
  } else if (section === "checklists") {
    body = <><SettingsTabs current="checklists" /><ChecklistsPage /></>;
  } else if (section === "portal") {
    body = <><SettingsTabs current="portal" /><PortalPage /></>;
  } else {
    body = <ClientsPage />;
  }

  return (
    <BackupProvider>
      <CompaniesHouseProvider demo={demo}>
        <CalendarProvider demo={demo}>
          <EditorProvider>
            <AssistantProvider>
              <PortalProvider>
                <TopBar section={section} demo={demo} ready={status === "ready"} />
                <PageBoundary resetKey={path} onProblem={(p) => void saveSetting("debug.lastProblem", p).catch(() => undefined)}>
                  {body}
                </PageBoundary>
              </PortalProvider>
            </AssistantProvider>
          </EditorProvider>
        </CalendarProvider>
      </CompaniesHouseProvider>
    </BackupProvider>
  );
}

function TopBar({ section, demo, ready }: { section: string; demo: boolean; ready: boolean }) {
  const { save, user } = useData();
  const { open } = useEditor();
  const chase = useChaseCount();
  const assistant = useAssistant();
  const portalWaiting = usePortal().overview?.attention.length || 0;
  const [tools, setTools] = useState(() => { try { return localStorage.getItem("pp.bar.tools") === "1"; } catch { return false; } });
  const toggleTools = () => setTools((v) => { try { localStorage.setItem("pp.bar.tools", v ? "0" : "1"); } catch { /* still works this visit */ } return !v; });
  const nav: [string, string, IconName][] = [
    ["home", "Home", "home"], ["plan", "Plan", "plan"], ["clients", "Clients", "clients"], ["sales", "Sales", "chart"], ["chase", "Chase", "clock"], ["comms", "Email", "mail"], ["papers", "Papers", "list"], ["settings", "Settings", "settings"],
  ];
  return (
    <header className="topbar">
      <div className="topbar-left">
        <Brand />
        <nav className="nav" aria-label="Main">
          {nav.map(([k, label, icon]) => (
            <a key={k} href={`#/${k}`} aria-current={section === k || (k === "clients" && section === "groups") || (k === "settings" && (section === "checklists" || section === "portal")) ? "page" : undefined}>
              <Icon name={icon} size={22} />
              {label}
              {k === "chase" && ready && chase > 0 && <span className="nav-count" aria-label={`${chase} to chase`}>{chase}</span>}
              {k === "settings" && ready && portalWaiting > 0 && <span className="nav-count" aria-label={`${portalWaiting} waiting in the portal`}>{portalWaiting}</span>}
            </a>
          ))}
        </nav>
      </div>
      <div className="topbar-right">
        {save.state === "error" && (
          <span className="save error" role="alert"><Icon name="alert" size={14} /><span className="save-text">Not saved: {save.error}</span></span>
        )}
        <div className={`bar-actions${tools ? "" : " collapsed"}`} id="bar-actions">
          <div className="bar-actions-in">
          {ready && <SearchButton />}
          {ready && <Alerts />}
          {ready && (
            <>
              <button type="button" className="btn small hide-phone" onClick={assistant.toggle} aria-expanded={assistant.open}><Icon name="spark" size={16} /> Ask</button>
              <button type="button" className="btn topbar-icon only-phone" aria-label="Ask the assistant" onClick={assistant.toggle}><Icon name="spark" size={20} /></button>
              <button type="button" className="btn small primary hide-phone" onClick={() => open({ kind: "task" })}>+ New task</button>
              <button type="button" className="btn primary topbar-icon only-phone" aria-label="New task" onClick={() => open({ kind: "task" })}>
                <Icon name="plus" size={20} />
              </button>
            </>
          )}
          </div>
        </div>
        {ready && (
          <button type="button" className="bar-toggle hide-phone" aria-expanded={tools} aria-controls="bar-actions" aria-label={tools ? "Hide search, alerts, Ask and New task" : "Show search, alerts, Ask and New task"} title={tools ? "Hide tools" : "Search, alerts, Ask, New task"} onClick={toggleTools}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ transform: tools ? "rotate(180deg)" : "none", transformOrigin: "8px 8px", transition: "transform .2s" }} /></svg>
          </button>
        )}
        <ProfileMenu user={user} demo={demo} />
      </div>
    </header>
  );
}

const initialsOf = (name?: string) => {
  const w = (name || "").replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return ((w[0]?.[0] || "") + (w.length > 1 ? w[w.length - 1][0] : "")).toUpperCase() || "?";
};

/** The profile icon: your name, the save status, light or dark, and sign out. */
function ProfileMenu({ user, demo }: { user?: string; demo: boolean }) {
  const { save } = useData();
  const { dark, set } = useTheme();
  const [shown, setShown] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!shown) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setShown(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setShown(false);
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); window.removeEventListener("keydown", onKey); };
  }, [shown]);
  const at = save.at ? save.at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "";
  return (
    <div className="profile-wrap" ref={ref}>
      <button type="button" className="profile-btn" aria-label="Your profile" aria-haspopup="menu" aria-expanded={shown} title={user || "Profile"} onClick={() => setShown((v) => !v)}>
        {initialsOf(user || (demo ? "Demo" : ""))}
      </button>
      {shown && (
        <div className="profile-panel" role="menu">
          <div className="profile-who">
            <strong>{user || (demo ? "Demo user" : "Signed in")}</strong>
            {demo && <span className="chip amber">Demo data store</span>}
            <span className="muted">
              {save.state === "saving" ? "Saving…" : save.state === "saved" ? `Saved to SharePoint · ${at}` : save.state === "error" ? "Not saved" : "SharePoint"}
            </span>
          </div>
          <button type="button" role="menuitem" onClick={() => { set(dark ? "light" : "dark"); setShown(false); }}>
            <Icon name={dark ? "sun" : "moon"} size={16} /> {dark ? "Light mode" : "Dark mode"}
          </button>
          <a role="menuitem" href="#/settings" onClick={() => setShown(false)}><Icon name="settings" size={16} /> Settings</a>
          {!demo && <button type="button" role="menuitem" onClick={signOut}><Icon name="left" size={16} /> Sign out</button>}
        </div>
      )}
    </div>
  );
}

function GroupsPage() {
  const { data } = useData();
  const idx = useIndex();
  const today = todayIso();
  return (
    <div className="page">
      <div className="page-head">
        <h1>Clients</h1>
        <a className="btn" href="#/clients/all">Open full client list</a>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
        {data.groups.map((g) => {
          const members = idx.membersByGroup.get(g.Key as string) || [];
          const jobs = members.flatMap((m) => idx.jobsByClient.get(m.MemberKey as string) || []).filter((j) => !isOnHold(j));
          const late = jobs.filter((j) => jobState(j, today).state === "overdue").length;
          const tight = jobs.filter((j) => jobState(j, today).state === "tight").length;
          const next = [...jobs].sort((a, b) => (a.Deadline || "9999").localeCompare(b.Deadline || "9999"))[0];
          return (
            <section key={g.Key} className="card pad stack" aria-label={g.Title}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <h2>{g.Title}</h2>
                <span className="muted" style={{ fontSize: 13 }}>{jobs.length} open jobs</span>
              </div>
              <div className="row-wrap" style={{ gap: 6 }}>
                {late > 0 && <span className="chip red">{late} late</span>}
                {tight > 0 && <span className="chip amber">{tight} due soon</span>}
                {next && <span className="chip">Next: {next.Title}, {fmtDate(next.Deadline, { year: false })}</span>}
              </div>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                {members.map((m) => {
                  const c = idx.clientByKey.get(m.MemberKey as string);
                  return (
                    <li key={m.Key as string} className="ident">
                      {c ? <ClientBadge client={c} /> : <span className="badge" style={{ background: "var(--line-2)" }} />}
                      {c ? <a className="cell-title" href={href("clients", c.Key)}>{c.Title}</a> : <span>{m.Title} <span className="muted">(contact)</span></span>}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

type Alert = { key: string; kind: "job" | "task" | "ch" | "backup" | "sales"; href?: string; level: "red" | "amber"; title: string; detail: string };

/** The bell: late work, work due within a week that isn't planned, and Companies House changes to review. */
function Alerts() {
  const { data } = useData();
  const idx = useIndex();
  const { open } = useEditor();
  const ch = useCompaniesHouse();
  const chAlerts = useChAlerts();
  const backupAlert = useBackupAlert();
  const sales = useSales();
  const [shown, setShown] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties>({});
  const today = todayIso();
  const soon = addDays(today, 7);
  // The panel is drawn on the page itself, not inside the top bar, so the bar can't clip it.
  const place = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r && window.innerWidth > 720) setPos({ position: "fixed", top: r.bottom + 8, right: Math.max(12, window.innerWidth - r.right), left: "auto" });
    else setPos({});
  };

  useEffect(() => {
    if (!shown) return;
    place();
    window.addEventListener("resize", place);
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && !panelRef.current?.contains(e.target as Node) && setShown(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setShown(false);
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", place);
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [shown]);

  const name = (k?: string) => (k && idx.clientByKey.get(k)?.Title) || "";
  const alerts: Alert[] = [];
  for (const j of idx.openJobs) {
    if (isOnHold(j)) {
      const h = holdAlert(j, j.Deadline, today);
      if (h) alerts.push({ key: j.Key, kind: "job", level: h.level, title: `${name(j.ClientKey) || j.ClientName}: ${j.Title}`, detail: h.text });
      continue;
    }
    if (!j.Deadline) continue;
    if (jobState(j, today).state === "overdue") {
      alerts.push({ key: j.Key, kind: "job", level: "red", title: `${name(j.ClientKey) || j.ClientName}: ${j.Title}`, detail: `Was due ${fmtDate(j.Deadline)}` });
    } else if (!j.PlannedDate && j.Deadline <= soon) {
      alerts.push({ key: j.Key, kind: "job", level: "amber", title: `${name(j.ClientKey) || j.ClientName}: ${j.Title}`, detail: `Due ${fmtDate(j.Deadline, { weekday: true, year: false })}, not planned` });
    }
  }
  for (const t of idx.openTasks) {
    if (isOnHold(t)) {
      const h = holdAlert(t, t.DueDate, today);
      if (h) alerts.push({ key: t.Key, kind: "task", level: h.level, title: t.ClientKey ? `${name(t.ClientKey)}: ${t.Title}` : t.Title, detail: h.text });
      continue;
    }
    if (t.DueDate && t.DueDate < today) {
      alerts.push({ key: t.Key, kind: "task", level: "red", title: t.ClientKey ? `${name(t.ClientKey)}: ${t.Title}` : t.Title, detail: `Task was due ${fmtDate(t.DueDate)}` });
    }
  }
  for (const a of chAlerts) alerts.push({ ...a, key: "ch:" + a.key, kind: "ch" });
  if (backupAlert) alerts.push({ ...backupAlert, key: "backup", kind: "backup" });
  if (sales.can("view")) for (const a of salesAlerts(sales.opps, sales.leads, today, sales.stages[0].key)) alerts.push({ key: a.key, kind: "sales", level: a.level, title: a.title, detail: a.detail, href: a.href });
  if (sales.can("view")) for (const a of engagementAlerts(data.engagements, data.proposals, data.proposalVersions, data.clients, readEngagementSettings(data.settings), today, sales.catalogue)) alerts.push({ key: a.key, kind: "sales", level: a.level, title: a.title, detail: a.detail, href: a.href });
  // Companies House changes first (they need a decision), then late work, then unplanned
  const rank = (a: Alert) => (a.kind === "backup" ? -2 : a.kind === "ch" ? 0 : 2) + (a.level === "red" ? 0 : 1);
  alerts.sort((a, b) => rank(a) - rank(b));
  const red = alerts.filter((a) => a.level === "red").length;
  const chCount = chAlerts.length;

  return (
    <div className="alerts-wrap" ref={ref}>
      <button
        type="button"
        className={`bell${alerts.length ? " has" : ""}`}
        aria-expanded={shown}
        aria-label={`${alerts.length} alert${alerts.length === 1 ? "" : "s"}`}
        onClick={() => setShown(!shown)}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path d="M4.5 7.5a4.5 4.5 0 019 0c0 4 1.5 5.25 1.5 5.25H3s1.5-1.25 1.5-5.25zM7.5 15a1.5 1.5 0 003 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {alerts.length > 0 && <span className={`bell-count${red ? " red" : ""}`}>{alerts.length}</span>}
      </button>
      {shown && createPortal(
        <div className="alerts-panel" role="region" aria-label="Alerts" ref={panelRef} style={{ zIndex: 70, ...pos }}>
          <div className="alerts-head">
            <strong>Needs attention</strong>
            <span className="muted" style={{ fontSize: 12 }}>
              {[
                `${alerts.filter((a) => (a.kind === "job" || a.kind === "task") && !isHoldText(a.detail) && a.level === "red").length} late`,
                `${alerts.filter((a) => (a.kind === "job" || a.kind === "task") && !isHoldText(a.detail) && a.level === "amber").length} due this week, unplanned`,
                ...(alerts.some((a) => isHoldText(a.detail)) ? [`${alerts.filter((a) => isHoldText(a.detail)).length} on hold to look at`] : []),
                ...(chCount ? [`${chCount} from Companies House`] : []),
              ].join(" · ")}
            </span>
          </div>
          {alerts.length ? (
            <ul>
              {alerts.slice(0, 30).map((a) => (
                <li key={a.key}>
                  <button type="button" onClick={() => {
                    setShown(false);
                    if (a.kind === "ch") window.location.hash = "#/settings/companies-house";
                    else if (a.kind === "backup") window.location.hash = "#/settings/backups";
                    else if (a.kind === "sales") window.location.hash = a.href || "#/sales";
                    else open(a.kind === "job" ? { kind: "job", key: a.key } : { kind: "task", key: a.key });
                  }}>
                    <span className={`dot ${a.level}`} aria-hidden="true" />
                    <span className="stack" style={{ gap: 2 }}>
                      <span style={{ fontWeight: 600 }}>{a.title}</span>
                      <span className="muted" style={{ fontSize: 12 }}>{a.detail}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted" style={{ margin: 0, padding: 14 }}>Nothing late, and everything due this week is planned.</p>
          )}
          <p className="muted alerts-foot">
            {ch.progress.running
              ? `Checking Companies House: ${ch.progress.done} of ${ch.progress.total}`
              : `Companies House last checked ${fmtWhen(ch.lastRun?.at)}. `}
            {!ch.progress.running && <a href="#/settings/companies-house" onClick={() => setShown(false)}>Companies House settings</a>}
          </p>
        </div>,
        document.body,
      )}
    </div>
  );
}

/**
 * The first time, tick the stages that sound like "with the client for approval" (for example
 * "Sent to Client for approval") as waiting stages. Change them in Settings › Types of work.
 */
function useWaitStageSetup(ready: boolean) {
  const { data, updateMany, saveSetting } = useData();
  const done = useRef(false);
  useEffect(() => {
    if (!ready || done.current || readSetting(data.settings, "waitStages.set")) return;
    done.current = true;
    const tick = initialWaitStages(data.stageTemplates);
    (async () => {
      if (tick.length) await updateMany("StageTemplates", tick.map((row) => ({ row, patch: { WaitClient: true } })));
      const ticked = new Set(tick.map((t) => t.Key));
      const stages = data.stageTemplates.map((s) => (ticked.has(s.Key) ? { ...s, WaitClient: true } : s));
      const jobs = adoptWaitingJobs(data.jobs, stages, data.services, todayIso());
      if (jobs.length) await updateMany("Jobs", jobs);
      await saveSetting("waitStages.set", { on: todayIso(), stages: tick.length });
    })().catch(() => { done.current = false; });
  }, [ready, data.settings, data.stageTemplates]);
}
