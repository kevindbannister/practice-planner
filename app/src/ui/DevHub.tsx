import { todayIso } from "../lib/domain";
// Development Hub: the one place to see what Xproflow contains, how far each part has really got, and what to work on next.
// Route: #/devhub/<section>[/<feature id>]. Only development administrators get in; it is not part of the client portal.
import React, { useMemo, useState } from "react";
import {
  Feature, PRIORITIES, PRIORITY_LABEL, Priority, STATUSES, Status, attention, buildTree, countStatuses, dueFollowUps, filterFeatures, leaves, outstanding, byPriority, evidenceOf,
  EVIDENCE_LABEL, rollup, tasksFrom,
} from "../lib/devHub";
import { SEED_ROADMAP } from "../lib/devHubSeed";
import { BannerMenu } from "./BannerMenu";
import { GhBanner, DevBoard } from "./DevHubBoard";
import { FeatureMap } from "./DevHubMap";
import { DevDecisions, DevIntegrations, DevRoadmap } from "./DevHubRegisters";
import { Bar, FeatureDetail, HubProvider, PriorityChip, STATUS_COLOR, StatusChip, statusParts, useHub } from "./devHubKit";
import { Icon, IconName, href, useRoute } from "./bits";

const SECTIONS: [string, string, IconName][] = [
  ["overview", "Overview", "home"], ["map", "Feature Map", "groups"], ["inventory", "Feature Inventory", "list"], ["board", "Development Board", "layout"],
  ["roadmap", "Roadmap", "flag"], ["issues", "Bugs & Issues", "alert"], ["integrations", "Integrations & Approvals", "bank"], ["architecture", "Architecture & Decisions", "book"],
];

export function DevHubPage() {
  return <HubProvider><Shell /></HubProvider>;
}

function Shell() {
  const hub = useHub();
  const { parts } = useRoute();
  const section = SECTIONS.some(([k]) => k === parts[1]) ? parts[1] : "overview";
  const id = parts[2] || "";
  const due = dueFollowUps(hub.integrations, todayIso()).length;

  if (!hub.admin.allowed) {
    return (
      <div className="page">
        <div className="page-head"><h1>Development Hub</h1></div>
        <div className="alert red" role="alert"><strong>This is for development administrators</strong><span>You aren't on the administrators list{hub.user ? ` (signed in as ${hub.user})` : ""}. Ask an administrator to add you.</span></div>
        <a className="btn" href="#/home">Back to Xproflow</a>
      </div>
    );
  }
  return (
    <>
      <header className="paper-top">
        <a className="paper-top-icon" href="#/home" title="Back to Xproflow" aria-label="Back to Xproflow"><Icon name="left" size={20} /></a>
        <h1>Development Hub</h1>
        <span className="chip">{hub.features.length ? leaves(hub.features).length : 0} features</span>
        <span className={`chip ${hub.gh.state === "ready" ? "green" : hub.gh.state === "error" ? "red" : "amber"}`}>{hub.gh.state === "ready" ? "GitHub connected" : hub.gh.state === "loading" ? "Reading GitHub…" : hub.gh.state === "demo" ? "Demo: GitHub not called" : hub.gh.state === "off" ? "GitHub not connected" : "GitHub error"}</span>
        <div className="paper-tools"><BannerMenu current="devhub" /></div>
      </header>
      <div className="page paper-page">
        <div className="paper">
          <nav className="paper-side" aria-label="Development Hub sections">
            <ul>
              {SECTIONS.map(([k, label, icon]) => (
                <li key={k}>
                  <button type="button" className={`paper-item${section === k ? " on" : ""}`} aria-current={section === k ? "page" : undefined} onClick={() => { window.location.hash = href("devhub", k); }}>
                    <span className="paper-ico" aria-hidden="true"><Icon name={icon} size={15} /></span>
                    <span className="paper-name">{label}</span>
                    {k === "integrations" && due > 0 && <span className="nav-count" aria-label={`${due} follow-ups due`}>{due}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <section className="paper-main stack" style={{ minWidth: 0 }}>
            {section === "overview" ? <Overview />
              : section === "map" ? <FeatureMap selected={id} onSelect={(x) => { window.location.hash = href("devhub", "map", ...(x ? [x] : [])); }} />
              : section === "inventory" ? <Inventory selected={id} />
              : section === "board" ? <DevBoard />
              : section === "roadmap" ? <DevRoadmap />
              : section === "issues" ? <BugsAndIssues />
              : section === "integrations" ? <DevIntegrations />
              : <DevDecisions />}
          </section>
        </div>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ overview

function Tile({ label, value, sub, to, tone }: { label: string; value: number | string; sub?: string; to?: string; tone?: string }) {
  const body = (<><div className="label">{label}</div><div className="value">{value}</div>{sub && <div className="muted" style={{ fontSize: 13 }}>{sub}</div>}</>);
  return to ? <a className={`tile dh-tile ${tone || ""}`} href={to} style={{ textDecoration: "none", color: "inherit" }}>{body}</a> : <div className={`tile dh-tile ${tone || ""}`}>{body}</div>;
}

function Overview() {
  const hub = useHub();
  const c = useMemo(() => countStatuses(hub.features), [hub.features]);
  const groups = useMemo(() => byPriority(hub.features), [hub.features]);
  const next = useMemo(() => attention(hub.features, 10), [hub.features]);
  const tasks = hub.tasks;
  const active = tasks.filter((t) => t.column === "In Progress" || t.column === "Testing");
  const upNext = tasks.filter((t) => t.column !== "Done" && t.priority !== "None" && t.priority !== "Access").sort((a, b) => a.priority.localeCompare(b.priority) || a.number - b.number).slice(0, 4);
  const bugs = openBugs(hub.features, tasks);
  const waiting = outstanding(hub.integrations);
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div><h2 className="sec-h">Overview</h2><p className="muted tip" style={{ margin: "4px 0 0" }}>Built from the feature inventory, so anything changed in the Hub updates this page. "Complete" means checked live with evidence, so it starts at zero.</p></div>
      <GhBanner />
      {hub.admin.open && <AdminSetup />}
      <div className="tiles">
        <Tile label="Total features" value={c.total} to="#/devhub/inventory" />
        <Tile label="Complete (verified live)" value={c.complete} tone="green" />
        <Tile label="In development" value={c.inDev} />
        <Tile label="Awaiting testing" value={c.testing} sub="built, with automated tests" />
        <Tile label="Planned" value={c.planned} />
        <Tile label="Blocked or broken" value={c.blocked + c.broken} to="#/devhub/issues" tone={c.blocked + c.broken ? "red" : ""} />
        <Tile label="Open bugs" value={bugs.length} to="#/devhub/issues" />
        <Tile label="Active tasks" value={active.length} sub="in progress or testing" to="#/devhub/board" />
        <Tile label="Approvals outstanding" value={waiting.length} sub={`of ${hub.integrations.length}`} to="#/devhub/integrations" tone={waiting.length ? "amber" : ""} />
      </div>
      <div className="card pad stack" style={{ gap: 8 }}>
        <h3 className="sec-h" style={{ fontSize: 17 }}>All features by status</h3>
        <Bar parts={statusParts(c.byStatus)} label="Features by status" />
        <div className="dh-legend-inline">{STATUSES.map((s) => <span key={s}><i style={{ background: STATUS_COLOR[s] }} />{s} {c.byStatus[s]}</span>)}</div>
      </div>
      <div className="card pad stack" style={{ gap: 10 }}>
        <h3 className="sec-h" style={{ fontSize: 17 }}>Completion by workstream</h3>
        {SEED_ROADMAP.map((p) => {
          const fs = groups[p.id];
          const by = countStatuses(fs);
          return (
            <div key={p.id} className="dh-ws">
              <a href="#/devhub/roadmap" className="dh-ws-name">{PRIORITY_LABEL[p.id]}</a>
              <Bar parts={statusParts(by.byStatus)} label={`${PRIORITY_LABEL[p.id]}: ${by.complete} of ${by.total} complete`} />
              <span className="muted dh-ws-n">{by.complete}/{by.total} complete · {by.testing + by.complete} built</span>
            </div>
          );
        })}
        {groups.Access.length > 0 && <div className="muted" style={{ fontSize: 13 }}>External approvals run in parallel with all of these.</div>}
      </div>
      <div className="dh-two">
        <div className="card pad stack" style={{ gap: 8 }}>
          <h3 className="sec-h" style={{ fontSize: 17 }}>Work on next</h3>
          <p className="muted tip" style={{ margin: 0, fontSize: 13 }}>Priority 1 first. Open issues, then the features that most need attention.</p>
          {upNext.length ? <ul className="dh-list">{upNext.map((t) => <li key={t.number}><PriorityChip p={t.priority} /> <a href="#/devhub/board">#{t.number} {t.title.replace(/^\s*\[[^\]]*\]\s*/, "")}</a> <span className="chip">{t.column}</span></li>)}</ul> : <p className="muted" style={{ margin: 0 }}>No open prioritised issues.</p>}
          <h4 className="dh-h" style={{ marginTop: 6 }}>Features needing attention</h4>
          <ul className="dh-list">{next.map((f) => <li key={f.id}><a href={`#/devhub/map/${f.id}`}>{f.name}</a> <StatusChip status={f.status} /> <PriorityChip p={f.priority} /></li>)}</ul>
        </div>
        <div className="card pad stack" style={{ gap: 8 }}>
          <h3 className="sec-h" style={{ fontSize: 17 }}>Recent activity</h3>
          {hub.gh.state !== "ready" ? <p className="muted" style={{ margin: 0 }}>Commits, pull requests and issues appear here once GitHub is connected.</p>
            : hub.activity.length ? <ul className="dh-list">{hub.activity.slice(0, 12).map((a) => <li key={a.kind + a.id}><span className="chip">{a.kind === "pull" ? "PR" : a.kind}</span> <a href={a.url} target="_blank" rel="noreferrer">{a.title}</a><div className="muted" style={{ fontSize: 11 }}>{a.id} · {a.by} · {a.at.slice(0, 10)}{a.state ? ` · ${a.state}` : ""}</div></li>)}</ul>
            : <p className="muted" style={{ margin: 0 }}>Nothing recent.</p>}
          {hub.log.length > 0 && <><h4 className="dh-h" style={{ marginTop: 6 }}>Changes made in the Hub</h4><ul className="dh-list">{hub.log.slice(0, 6).map((l, i) => <li key={i}>{l.what}<div className="muted" style={{ fontSize: 11 }}>{l.at.slice(0, 16).replace("T", " ")} · {l.by}</div></li>)}</ul></>}
        </div>
      </div>
    </div>
  );
}

function AdminSetup() {
  const hub = useHub();
  const [text, setText] = useState(hub.user);
  return (
    <div className="alert amber" role="group" aria-label="Development administrators">
      <strong>Name the development administrators</strong>
      <span>Until a list is saved, anyone signed in to this app can open the Hub. Enter names as they appear in the profile menu, one per line.</span>
      <textarea className="input" rows={2} value={text} onChange={(e) => setText(e.target.value)} aria-label="Administrator names" />
      <div><button type="button" className="btn small primary" disabled={!text.trim()} onClick={() => void hub.setAdmins(text.split("\n").map((x) => x.trim()).filter(Boolean))}>Save administrators</button></div>
    </div>
  );
}

// ------------------------------------------------------------------ inventory

type SortKey = "name" | "status" | "priority" | "reviewed" | "id";

function Inventory({ selected }: { selected: string }) {
  const hub = useHub();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<Status | "">("");
  const [prio, setPrio] = useState<Priority | "">("");
  const [area, setArea] = useState("");
  const [sort, setSort] = useState<SortKey>("id");
  const [adding, setAdding] = useState(false);
  const tree = useMemo(() => buildTree(hub.features), [hub.features]);
  const names = useMemo(() => new Map(hub.features.map((f) => [f.id, f.name])), [hub.features]);
  const parents = new Set(hub.features.map((f) => f.parent));
  const rows = useMemo(() => {
    const r = filterFeatures(hub.features, { q, status, priority: prio, area }).filter((f) => f.parent);
    const rank = (s: Status) => STATUSES.indexOf(s);
    const p = (x: Priority) => PRIORITIES.indexOf(x);
    return [...r].sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : sort === "status" ? rank(a.status) - rank(b.status) : sort === "priority" ? p(a.priority) - p(b.priority) : sort === "reviewed" ? a.reviewed.localeCompare(b.reviewed) : 0);
  }, [hub.features, q, status, prio, area, sort]);
  const nodeOf = (id: string) => { let hit: ReturnType<typeof buildTree>[number] | undefined; const walk = (n: ReturnType<typeof buildTree>[number]) => { if (n.f.id === id) hit = n; else n.children.forEach(walk); }; tree.forEach(walk); return hit; };
  const crumb = (f: Feature) => { const out: string[] = []; let p = names.get(f.parent); let id = f.parent; while (id && p) { out.unshift(p); id = hub.features.find((x) => x.id === id)?.parent || ""; p = id ? names.get(id) : undefined; } return out.slice(-2).join(" › "); };
  const sortBtn = (k: SortKey, label: string) => <button type="button" className="dh-th" onClick={() => setSort(k)} aria-pressed={sort === k}>{label}{sort === k ? " ▾" : ""}</button>;
  return (
    <section className="stack" style={{ gap: 12, minWidth: 0 }} aria-label="Feature inventory">
      <div className="row-wrap" style={{ justifyContent: "space-between" }}><h2 className="sec-h">Feature inventory</h2><button type="button" className="btn small" onClick={() => setAdding(true)}>Add a feature</button></div>
      <div className="dh-tools">
        <input className="input" type="search" placeholder="Search name, description or file" aria-label="Search features" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" aria-label="Area" value={area} onChange={(e) => setArea(e.target.value)}><option value="">All areas</option>{tree.map((a) => <option key={a.f.id} value={a.f.id}>{a.f.name}</option>)}</select>
        <select className="input" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as Status | "")}><option value="">Any status</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
        <select className="input" aria-label="Priority" value={prio} onChange={(e) => setPrio(e.target.value as Priority | "")}><option value="">Any priority</option>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</select>
        <span className="muted" style={{ fontSize: 13 }}>{rows.length} rows (features, with the modules that hold them)</span>
      </div>
      {adding && <AddFeature onClose={() => setAdding(false)} />}
      <div className={selected ? "dh-split" : ""}>
        <div className="card table-wrap">
          <table className="grid">
            <thead><tr><th>{sortBtn("name", "Feature")}</th><th>{sortBtn("status", "Status")}</th><th>{sortBtn("priority", "Priority")}</th><th>Evidence</th><th>Completion</th><th>{sortBtn("reviewed", "Reviewed")}</th></tr></thead>
            <tbody>
              {rows.map((f) => {
                const n = nodeOf(f.id);
                const group = parents.has(f.id);
                return (
                  <tr key={f.id} className={`clickable${selected === f.id ? " selected" : ""}`} onClick={() => { window.location.hash = href("devhub", "inventory", f.id); }}>
                    <td data-label="Feature"><strong>{f.name}</strong><div className="muted" style={{ fontSize: 13 }}>{crumb(f)}{n && n.kind === "module" ? "" : ""}</div></td>
                    <td data-label="Status" onClick={(e) => e.stopPropagation()}>
                      {group ? <StatusChip status={n ? rollup(n) : f.status} /> : (
                        <select className="input" aria-label={`Status of ${f.name}`} value={f.status} onChange={(e) => { const s = e.target.value as Status; if (s === "Complete") { window.location.hash = href("devhub", "inventory", f.id); return; } void hub.editFeature(f.id, { status: s, reviewed: todayIso(), live: f.live ? null : undefined }, `${f.name}: ${f.status} → ${s}`); }}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
                      )}
                    </td>
                    <td data-label="Priority"><PriorityChip p={f.priority} /></td>
                    <td data-label="Evidence">{group ? "—" : EVIDENCE_LABEL[evidenceOf(f)]}</td>
                    <td data-label="Completion">{f.completion !== undefined ? `${f.completion}%` : <span className="muted">Not assessed</span>}</td>
                    <td data-label="Reviewed">{f.reviewed}</td>
                  </tr>
                );
              })}
              {!rows.length && <tr><td colSpan={6}><span className="muted">No features match those filters.</span></td></tr>}
            </tbody>
          </table>
        </div>
        {selected && <FeatureDetail id={selected} onSelect={(x) => { window.location.hash = href("devhub", "inventory", x); }} onClose={() => { window.location.hash = href("devhub", "inventory"); }} />}
      </div>
    </section>
  );
}

function AddFeature({ onClose }: { onClose: () => void }) {
  const hub = useHub();
  const mods = hub.features.filter((f) => f.parent && !hub.features.find((x) => x.id === f.parent)?.parent || hub.features.some((x) => x.parent === f.id));
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  const [desc, setDesc] = useState("");
  const [status, setStatus] = useState<Status>("Planned");
  const [priority, setPriority] = useState<Priority>("None");
  const add = async () => {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30);
    const id = `${parent}.${slug}-${Date.now().toString(36).slice(-3)}`;
    await hub.addFeature({ id, parent, name: name.trim(), desc: desc.trim(), status, priority, files: [], tests: [], issues: [], deps: [], blockers: [], bugs: [], next: [], notes: "", reviewed: todayIso(), custom: true });
    onClose();
  };
  return (
    <div className="card pad stack" role="group" aria-label="Add a feature">
      <h3 className="sec-h" style={{ fontSize: 17 }}>Add a feature</h3>
      <div className="dh-fields">
        <label>Name<input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>Belongs to<select className="input" value={parent} onChange={(e) => setParent(e.target.value)}><option value="">Choose a module or feature…</option>{mods.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
        <label>Status<select className="input" value={status} onChange={(e) => setStatus(e.target.value as Status)}>{STATUSES.filter((s) => s !== "Complete").map((s) => <option key={s}>{s}</option>)}</select></label>
        <label>Priority<select className="input" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</select></label>
      </div>
      <label>What it does<textarea className="input" rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
      <div className="row-wrap"><button type="button" className="btn primary small" disabled={!name.trim() || !parent} onClick={() => void add()}>Add feature</button><button type="button" className="btn small" onClick={onClose}>Cancel</button></div>
    </div>
  );
}

// ------------------------------------------------------------------ bugs and issues

function openBugs(features: Feature[], tasks: ReturnType<typeof tasksFrom>) {
  const fromFeatures = features.flatMap((f) => f.bugs.map((b) => ({ feature: f, text: b })));
  const fromGithub = tasks.filter((t) => t.state === "open" && t.labels.some((l) => l.toLowerCase() === "bug"));
  return [...fromFeatures.map((x) => ({ kind: "feature" as const, ...x })), ...fromGithub.map((t) => ({ kind: "issue" as const, task: t }))];
}

function BugsAndIssues() {
  const hub = useHub();
  const ls = leaves(hub.features);
  const broken = ls.filter((f) => f.status === "Broken");
  const blocked = ls.filter((f) => f.status === "Blocked");
  const blockers = ls.filter((f) => f.blockers.length && f.status !== "Complete" && f.status !== "Blocked");
  const bugs = openBugs(hub.features, hub.tasks);
  const unmet = ls.filter((f) => f.deps.some((d) => { const t = hub.features.find((x) => x.id === d); const a = hub.integrations.find((x) => x.id === d); return t ? t.status !== "Complete" && t.status !== "Ready for Testing" && t.status !== "Testing" : a ? !["Operational", "Credentials Received", "Approved", "Not Required"].includes(a.status) : false; }));
  const gaps = ls.filter((f) => f.status === "In Development" && f.tests.length === 0);
  return (
    <section className="stack" style={{ gap: 12, minWidth: 0 }} aria-label="Bugs and issues">
      <h2 className="sec-h">Bugs &amp; issues</h2>
      <GhBanner />
      <div className="tiles">
        <Tile label="Broken" value={broken.length} tone={broken.length ? "red" : ""} />
        <Tile label="Blocked" value={blocked.length} tone={blocked.length ? "red" : ""} />
        <Tile label="Known bugs" value={bugs.length} />
        <Tile label="With open blockers" value={blockers.length} />
        <Tile label="Built with no tests" value={gaps.length} sub="in development" />
      </div>
      <Group title="Blocked features" empty="Nothing is blocked." items={blocked} show={(f) => f.blockers.join(" · ") || "No blocker recorded"} />
      <Group title="Broken features" empty="Nothing is marked broken. Nothing has been tested live yet, so this is not the same as working." items={broken} show={(f) => f.bugs.join(" · ")} />
      <div className="card pad stack" style={{ gap: 6 }}>
        <h3 className="sec-h" style={{ fontSize: 17 }}>Known bugs</h3>
        {bugs.length ? <ul className="dh-list">{bugs.map((b, i) => b.kind === "feature" ? <li key={i}><a href={`#/devhub/map/${b.feature.id}`}>{b.feature.name}</a>: {b.text}</li> : <li key={i}><a href={b.task.url} target="_blank" rel="noreferrer">#{b.task.number}</a> {b.task.title}</li>)}</ul> : <p className="muted" style={{ margin: 0 }}>None recorded. Bugs come from features' "Known bugs" lists and GitHub issues labelled "bug".</p>}
      </div>
      <Group title="Features with outstanding blockers" empty="None." items={blockers} show={(f) => f.blockers.join(" · ")} />
      <Group title="Waiting on something else (dependencies)" empty="Nothing is waiting on an unmet dependency." items={unmet} show={(f) => f.deps.map((d) => hub.features.find((x) => x.id === d)?.name || hub.integrations.find((x) => x.id === d)?.service || d).join(", ")} />
      <Group title="Built without automated tests" empty="Every feature in development has tests." items={gaps} show={(f) => f.notes || "No tests found"} />
    </section>
  );
}

function Group({ title, items, show, empty }: { title: string; items: Feature[]; show: (f: Feature) => string; empty: string }) {
  return (
    <div className="card pad stack" style={{ gap: 6 }}>
      <h3 className="sec-h" style={{ fontSize: 17 }}>{title} <span className="chip">{items.length}</span></h3>
      {items.length ? <ul className="dh-list">{items.map((f) => <li key={f.id}><a href={`#/devhub/map/${f.id}`}>{f.name}</a> <StatusChip status={f.status} /> <PriorityChip p={f.priority} /><div className="muted" style={{ fontSize: 13 }}>{show(f)}</div></li>)}</ul> : <p className="muted" style={{ margin: 0 }}>{empty}</p>}
    </div>
  );
}
