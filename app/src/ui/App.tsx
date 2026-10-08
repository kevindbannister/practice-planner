// App shell: top bar, save indicator, and routing between pages.
import { fmtDate, jobState, todayIso } from "../lib/domain";
import { signOut } from "../lib/auth";
import { Brand, ClientBadge, Icon, href, useRoute } from "./bits";
import { ClientPage } from "./ClientPage";
import { ClientsPage } from "./ClientsPage";
import { useData, useIndex } from "./data";
import { SetupPage } from "./SetupPage";
import { EditorProvider, useEditor } from "./Editors";
import { PlanPage } from "./PlanPage";
import { SettingsPage } from "./SettingsPage";

export function App({ demo }: { demo: boolean }) {
  const { status, error, reload } = useData();
  const { parts } = useRoute();
  const section = parts[0] || "plan";

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
    <EditorProvider>
      <TopBar section={section} demo={demo} ready={status === "ready"} />
      {body}
    </EditorProvider>
  );
}

function TopBar({ section, demo, ready }: { section: string; demo: boolean; ready: boolean }) {
  const { save, user } = useData();
  const { open } = useEditor();
  const nav: [string, string][] = [["plan", "Plan"], ["clients", "Clients"], ["groups", "Groups"], ["settings", "Settings"]];
  return (
    <header className="topbar">
      <div className="topbar-left">
        <Brand />
        <nav className="nav" aria-label="Main">
          {nav.map(([k, label]) => (
            <a key={k} href={`#/${k}`} aria-current={section === k ? "page" : undefined}>{label}</a>
          ))}
        </nav>
      </div>
      <div className="topbar-right">
        {demo && <span className="chip amber">Demo data store</span>}
        {save.state === "saving" && <span className="save saving">Saving…</span>}
        {save.state === "saved" && (
          <span className="save saved">
            <Icon name="check" size={14} />
            Saved to SharePoint · {save.at!.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
        {save.state === "error" && (
          <span className="save error" role="alert"><Icon name="alert" size={14} />Not saved: {save.error}</span>
        )}
        {ready && <button type="button" className="btn small primary" onClick={() => open({ kind: "task" })}>+ New task</button>}
        {user && <span className="muted">{user}</span>}
        {!demo && <button type="button" className="linkbtn" onClick={signOut}>Sign out</button>}
      </div>
    </header>
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
          const jobs = members.flatMap((m) => idx.jobsByClient.get(m.MemberKey as string) || []);
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
