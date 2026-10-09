// App shell: top bar, save indicator, and routing between pages.
import { useEffect, useRef, useState } from "react";
import { fmtDate, holdAlert, isOnHold, jobState, todayIso } from "../lib/domain";
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
import { SettingsPage } from "./SettingsPage";
import { CompaniesHouseProvider, fmtWhen, useChAlerts, useCompaniesHouse } from "./CompaniesHouse";
import { BackupProvider, useBackupAlert } from "./Backups";

export function App({ demo }: { demo: boolean }) {
  const { status, error, reload } = useData();
  const { parts } = useRoute();
  const section = parts[0] || "plan";
  const path = parts.join("/");
  useEffect(() => window.scrollTo(0, 0), [path]); // a new screen starts at the top

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
          <h1>Couldn't load Practice Planner</h1>
          <p style={{ margin: 0 }}>{error}</p>
          <div><button type="button" className="btn primary" onClick={reload}>Try again</button></div>
        </div>
      </div>
    );
  } else if (status === "needs-setup" || section === "setup") {
    body = <SetupPage />;
  } else if (section === "clients" && parts[1]) {
    body = <ClientPage clientKey={parts[1]} tab={parts[2] === "work" ? "work" : "overview"} />;
  } else if (section === "groups") {
    body = <GroupsPage />;
  } else if (section === "plan") {
    body = <PlanPage />;
  } else if (section === "settings") {
    body = <SettingsPage />;
  } else {
    body = <ClientsPage />;
  }

  return (
    <BackupProvider>
      <CompaniesHouseProvider demo={demo}>
        <EditorProvider>
          <TopBar section={section} demo={demo} ready={status === "ready"} />
          {body}
        </EditorProvider>
      </CompaniesHouseProvider>
    </BackupProvider>
  );
}

function TopBar({ section, demo, ready }: { section: string; demo: boolean; ready: boolean }) {
  const { save, user } = useData();
  const { open } = useEditor();
  const nav: [string, string, IconName][] = [
    ["plan", "Plan", "plan"], ["clients", "Clients", "clients"], ["groups", "Groups", "groups"], ["settings", "Settings", "settings"],
  ];
  return (
    <header className="topbar">
      <div className="topbar-left">
        <Brand />
        <nav className="nav" aria-label="Main">
          {nav.map(([k, label, icon]) => (
            <a key={k} href={`#/${k}`} aria-current={section === k ? "page" : undefined}>
              <Icon name={icon} size={22} />
              {label}
            </a>
          ))}
        </nav>
      </div>
      <div className="topbar-right">
        {demo && <span className="chip amber hide-phone">Demo data store</span>}
        {save.state === "saving" && <span className="save saving"><span className="save-text">Saving…</span></span>}
        {save.state === "saved" && (
          <span className="save saved" title={`Saved to SharePoint at ${save.at!.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`}>
            <Icon name="check" size={14} />
            <span className="save-text">Saved to SharePoint · {save.at!.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
          </span>
        )}
        {save.state === "error" && (
          <span className="save error" role="alert"><Icon name="alert" size={14} /><span className="save-text">Not saved: {save.error}</span></span>
        )}
        <ThemeToggle />
        {ready && <Alerts />}
        {ready && (
          <>
            <button type="button" className="btn small primary hide-phone" onClick={() => open({ kind: "task" })}>+ New task</button>
            <button type="button" className="btn primary topbar-icon only-phone" aria-label="New task" onClick={() => open({ kind: "task" })}>
              <Icon name="plus" size={20} />
            </button>
          </>
        )}
        {user && <span className="muted hide-phone">{user}</span>}
        {!demo && <button type="button" className="linkbtn hide-phone" onClick={signOut}>Sign out</button>}
      </div>
    </header>
  );
}

function ThemeToggle() {
  const { dark, set } = useTheme();
  return (
    <button
      type="button"
      className="iconbtn"
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      onClick={() => set(dark ? "light" : "dark")}
    >
      <Icon name={dark ? "sun" : "moon"} size={18} />
    </button>
  );
}

function GroupsPage() {
  const { data } = useData();
  const idx = useIndex();
  const today = todayIso();
  return (
    <div className="page">
      <div className="page-head"><h1>Groups</h1></div>
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

type Alert = { key: string; kind: "job" | "task" | "ch" | "backup"; level: "red" | "amber"; title: string; detail: string };

/** The bell: late work, work due within a week that isn't planned, and Companies House changes to review. */
function Alerts() {
  const { data } = useData();
  const idx = useIndex();
  const { open } = useEditor();
  const ch = useCompaniesHouse();
  const chAlerts = useChAlerts();
  const backupAlert = useBackupAlert();
  const [shown, setShown] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const today = todayIso();
  const soon = addDays(today, 7);

  useEffect(() => {
    if (!shown) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setShown(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setShown(false);
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
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
      {shown && (
        <div className="alerts-panel" role="region" aria-label="Alerts">
          <div className="alerts-head">
            <strong>Needs attention</strong>
            <span className="muted" style={{ fontSize: 12 }}>
              {[
                `${alerts.filter((a) => (a.kind === "job" || a.kind === "task") && !a.detail.startsWith("On hold") && a.level === "red").length} late`,
                `${alerts.filter((a) => (a.kind === "job" || a.kind === "task") && !a.detail.startsWith("On hold") && a.level === "amber").length} due this week, unplanned`,
                ...(alerts.some((a) => a.detail.startsWith("On hold")) ? [`${alerts.filter((a) => a.detail.startsWith("On hold")).length} on hold to look at`] : []),
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
        </div>
      )}
    </div>
  );
}
