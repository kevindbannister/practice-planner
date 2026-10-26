// Client portal, staff side: who has a login, which businesses each person can see and at what
// level, invitations, and the trail of what happened. People and businesses are many-to-many: one
// login per person, however many businesses they can see.
import { useEffect, useMemo, useState } from "react";
import { Client, fmtDate } from "../lib/domain";
import { Row } from "../lib/schema";
import { ChangeRequestStaff, DecideResult, LEVELS, PortalBusiness, PortalEvent, PortalLevel, PortalPerson, STATUS_LABEL, eventLabel, levelLabel } from "../lib/portalAdmin";
import { href, useRoute } from "./bits";
import { useData } from "./data";
import { say, useFresh, usePortal } from "./portalKit";
import { IdentityFor, IdentityTab } from "./PortalIdentity";
import { RemindersTab } from "./PortalRequests";

const when = (iso?: string) => (iso ? fmtDate(iso.slice(0, 10)) + " " + iso.slice(11, 16) : "—");
const day = (iso?: string) => (iso ? fmtDate(iso.slice(0, 10)) : "—");
const statusClass = (s: string) => (s === "active" ? "green" : s === "invited" ? "amber" : s === "none" ? "dashed" : "red");

const TABS: [string, string][] = [["", "Overview"], ["changes", "Changes"], ["identity", "Identity"], ["reminders", "Reminders"], ["people", "People"], ["activity", "Activity"], ["setup", "Set-up"]];

export function PortalPage() {
  const { parts } = useRoute();
  const portal = usePortal();
  useFresh();
  const sub = parts[1] || "";
  const changesWaiting = (portal.overview?.attention || []).filter((a) => a.kind === "change").length;
  return (
    <div className="page portal-page">
      <div className="page-head"><div>
        <h1>Client portal</h1>
        <p className="muted" style={{ margin: "4px 0 0" }}>Who can sign in, which businesses they can see, and what needs your attention. Clients only ever see what you publish to them.</p>
      </div></div>
      <nav className="subtabs" aria-label="Client portal">
        {TABS.map(([k, label]) => <a key={k} className="subtab" href={`#/portal${k ? "/" + k : ""}`} aria-current={sub === k ? "page" : undefined}>{label}{k === "changes" && changesWaiting > 0 ? <span className="chip amber" style={{ marginLeft: 6 }}>{changesWaiting}</span> : null}</a>)}
      </nav>
      {portal.error && <p className="import-list warn" role="alert">{portal.error}</p>}
      {portal.status && !portal.status.configured && sub !== "setup" && (
        <p className="import-list warn" role="status">The client portal isn't switched on yet. <a href="#/portal/setup">See what's needed</a>.</p>
      )}
      {sub === "changes" ? <ChangesQueue /> : sub === "identity" ? <IdentityTab /> : sub === "reminders" ? <RemindersTab /> : sub === "people" ? <People /> : sub === "activity" ? <ActivityLog /> : sub === "setup" ? <SetupInfo /> : <Overview />}
    </div>
  );
}

// ---------------------------------------------------------------- overview

const KIND_LABEL: Record<string, string> = { change: "Change requests", document: "Documents", signing: "Signing", identity: "Identity", request: "Information requests", message: "Messages" };

function Overview() {
  const { overview, status } = usePortal();
  const [kind, setKind] = useState("");
  const [find, setFind] = useState("");
  if (!overview) return status && !status.configured ? null : <p className="muted">Loading…</p>;
  const c = overview.counts;
  const awaiting = overview.users.filter((u) => u.status === "active" && u.selfRegistered && !u.personKey && u.businesses.length === 0);
  const expired = overview.users.filter((u) => u.status === "invited" && u.inviteExpires && Date.parse(u.inviteExpires) < Date.now());
  const suspended = overview.users.filter((u) => u.status === "suspended");
  const mfaPct = c.active ? Math.round((c.mfa / c.active) * 100) : 0;
  return (
    <div className="stack">
      <section className="pt-stats" aria-label="Portal numbers">
        <Stat n={c.active} label="Active logins" />
        <Stat n={c.invited} label="Invitations pending" />
        <Stat n={c.suspended + c.revoked} label="Suspended or revoked" />
        <Stat n={`${mfaPct}%`} label={`Using two-step sign-in (${c.mfa} of ${c.active})`} />
      </section>
      <section className="card pad stack" aria-labelledby="attn-h">
        <div className="row-wrap" style={{ justifyContent: "space-between" }}>
          <h2 id="attn-h" style={{ margin: 0, fontSize: 16 }}>Needs your attention</h2>
          {overview.attention.length > 0 && (
            <div className="row-wrap">
              <select className="input" aria-label="Show" value={kind} onChange={(e) => setKind(e.target.value)}><option value="">Everything</option>{[...new Set(overview.attention.map((a) => a.kind))].map((k) => <option key={k} value={k}>{KIND_LABEL[k] || k}</option>)}</select>
              <input className="input" type="search" aria-label="Search what needs attention" placeholder="Search" value={find} onChange={(e) => setFind(e.target.value)} />
            </div>
          )}
        </div>
        {!awaiting.length && !expired.length && !suspended.length && !overview.attention.length && <p className="muted" style={{ margin: 0 }}>Nothing right now.</p>}
        {overview.attention.filter((a) => (!kind || a.kind === kind) && (!find.trim() || a.text.toLowerCase().includes(find.trim().toLowerCase()))).map((a, i) => <div className="row-wrap" key={i} style={{ justifyContent: "space-between" }}><span>{a.text}</span><a className="btn small" href={a.link}>Review</a></div>)}
        {awaiting.map((u) => <AttentionRow key={u.id} person={u} text={`${u.name || u.email} registered on their own and can't see anything yet. Match them to a person and give them access, or leave them waiting.`} />)}
        {expired.map((u) => <AttentionRow key={u.id} person={u} text={`${u.name || u.email}'s invitation expired on ${day(u.inviteExpires)}. Resend it to renew it.`} />)}
        {suspended.map((u) => <AttentionRow key={u.id} person={u} text={`${u.name || u.email} is suspended.`} />)}
      </section>
      <p className="muted" style={{ margin: 0 }}>Two-step sign-in is the person's own choice. You can see who uses it, but you can't switch it off or see anything they use to sign in.</p>
    </div>
  );
}

const Stat = ({ n, label }: { n: number | string; label: string }) => (
  <div className="pt-stat"><strong>{n}</strong><span>{label}</span></div>
);

function AttentionRow({ person, text }: { person: PortalPerson; text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row-wrap" style={{ justifyContent: "space-between" }}>
        <span>{text}</span>
        <button type="button" className="btn small" onClick={() => setOpen(!open)}>{open ? "Close" : "Review"}</button>
      </div>
      {open && <PersonCard person={person} />}
    </div>
  );
}

// ---------------------------------------------------------------- people

function People() {
  const { overview } = usePortal();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState("");
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (overview?.users || [])
      .filter((u) => (status === "all" || u.status === status) && (!needle || `${u.name} ${u.email} ${u.businesses.map((b) => b.name).join(" ")}`.toLowerCase().includes(needle)))
      .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
  }, [overview, q, status]);
  return (
    <div className="stack">
      <div className="row-wrap">
        <input className="input" type="search" aria-label="Search people" placeholder="Search name, email or business" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">Any status</option>{["active", "invited", "suspended", "revoked"].map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <button type="button" className="btn primary" onClick={() => setAdding(!adding)}>{adding ? "Close" : "Invite someone"}</button>
      </div>
      {adding && <section className="card pad"><InviteForm onDone={() => setAdding(false)} /></section>}
      {!overview ? <p className="muted">Loading…</p> : !list.length ? <div className="card empty">{overview.users.length ? "No one matches." : "No one has been invited yet."}</div> : (
        <div className="stack" style={{ gap: 8 }}>
          {list.map((u) => (
            <section className="card pad stack" key={u.id} style={{ gap: 8 }}>
              <div className="row-wrap" style={{ justifyContent: "space-between" }}>
                <button type="button" className="linkbtn" aria-expanded={open === u.id} onClick={() => setOpen(open === u.id ? "" : u.id)} style={{ fontWeight: 600 }}>{u.name || u.email}</button>
                <span className="row-wrap" style={{ gap: 6 }}>
                  <span className={`chip ${statusClass(u.status)}`}>{STATUS_LABEL[u.status]}</span>
                  {u.mfa && <span className="chip green">Two-step on</span>}
                  {u.selfRegistered && !u.personKey && <span className="chip amber">Not matched</span>}
                </span>
              </div>
              <div className="muted">{u.email} · {u.businesses.length ? u.businesses.map((b) => `${b.name} (${b.levelLabel})`).join(", ") : "no businesses"} · last signed in {when(u.lastLoginAt)}</div>
              {open === u.id && <PersonCard person={u} />}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- one person

/** Everything about one person's portal access, with the actions. Used on People, the client page and the attention list. */
export function PersonCard({ person: u }: { person: PortalPerson }) {
  const { run } = usePortal();
  const { data } = useData();
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"" | "email" | "suspend" | "revoke" | "link">("");
  const [text, setText] = useState("");
  const [addKey, setAddKey] = useState("");
  const [addLevel, setAddLevel] = useState<PortalLevel>("standard");
  const clients = useMemo(() => [...data.clients].sort((a, b) => String(a.Title).localeCompare(String(b.Title))), [data.clients]);
  const free = clients.filter((c) => !u.businesses.some((b) => b.clientKey === c.Key));

  const go = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true); setErr(""); setMsg("");
    try { await work(); setMsg(done); setMode(""); setText(""); } catch (e) { setErr(say(e)); } finally { setBusy(false); }
  };
  const disabled = u.status === "revoked";
  return (
    <div className="stack portal-person" style={{ gap: 12 }}>
      <dl className="pt-kv">
        <div><dt>Status</dt><dd><span className={`chip ${statusClass(u.status)}`}>{STATUS_LABEL[u.status]}</span></dd></div>
        <div><dt>Sign-in email</dt><dd>{u.email}{u.pendingEmail && <span className="muted"> · moving to {u.pendingEmail} once confirmed</span>}</dd></div>
        <div><dt>Invited</dt><dd>{day(u.invitedAt)}{u.status === "invited" && u.inviteExpires ? ` (expires ${day(u.inviteExpires)})` : ""}</dd></div>
        <div><dt>Activated</dt><dd>{day(u.activatedAt)}</dd></div>
        <div><dt>Last signed in</dt><dd>{when(u.lastLoginAt)}</dd></div>
        <div><dt>Two-step sign-in</dt><dd>{u.mfa ? "On" : "Off"} <span className="muted">(their choice)</span></dd></div>
      </dl>

      <div className="stack" style={{ gap: 6 }}>
        <strong>Businesses they can see</strong>
        {!u.businesses.length && <span className="muted">None. They can sign in but see nothing.</span>}
        {u.businesses.map((b) => <BusinessRow key={b.clientKey} user={u} b={b} disabled={disabled} />)}
        {!disabled && (
          <div className="row-wrap">
            <select className="input" aria-label="Add a business" value={addKey} onChange={(e) => setAddKey(e.target.value)}>
              <option value="">Add a business…</option>{free.map((c) => <option key={c.Key} value={c.Key}>{c.Title}</option>)}
            </select>
            <select className="input" aria-label="Level for the new business" value={addLevel} onChange={(e) => setAddLevel(e.target.value as PortalLevel)}>{LEVELS.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}</select>
            <button type="button" className="btn small" disabled={!addKey || busy} onClick={() => go(() => run((a) => a.setAccess(u.id, addKey, addLevel)).then(() => setAddKey("")), "Business added.")}>Give access</button>
          </div>
        )}
      </div>

      {!disabled && (
        <div className="row-wrap" style={{ gap: 8 }}>
          {u.status === "invited" && <button type="button" className="btn small" disabled={busy} onClick={() => go(() => run((a) => a.resend(u.id)), "Invitation sent again.")}>Resend invitation</button>}
          <button type="button" className="btn small" onClick={() => { setMode(mode === "email" ? "" : "email"); setText(""); }}>Change sign-in email</button>
          {u.selfRegistered && !u.personKey && <button type="button" className="btn small" onClick={() => { setMode(mode === "link" ? "" : "link"); setText(""); }}>Match to a person</button>}
          {u.status === "active" && <button type="button" className="btn small" disabled={busy} onClick={() => go(() => run((a) => a.endSessions(u.id)), "Signed out everywhere.")}>Sign out everywhere</button>}
          {u.status === "suspended" ? <button type="button" className="btn small" disabled={busy} onClick={() => go(() => run((a) => a.reinstate(u.id)), "Reinstated.")}>Reinstate</button>
            : <button type="button" className="btn small" onClick={() => { setMode(mode === "suspend" ? "" : "suspend"); setText(""); }}>Suspend</button>}
          <button type="button" className="btn small danger" onClick={() => setMode(mode === "revoke" ? "" : "revoke")}>Revoke access</button>
        </div>
      )}
      {disabled && <div className="row-wrap"><button type="button" className="btn small" disabled={busy} onClick={() => go(() => run((a) => a.reinstate(u.id)), "Reinstated. Give them access to businesses again.")}>Reinstate</button></div>}

      {mode === "email" && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="muted">{u.status === "invited" ? "The invitation will go to the new address." : "They'll be emailed a link and must sign in with the new address to confirm it. Nothing changes until they do, and the old address is told."}</span>
          <div className="row-wrap">
            <input className="input" type="email" aria-label="New sign-in email" placeholder="new@email.com" value={text} onChange={(e) => setText(e.target.value)} />
            <button type="button" className="btn small primary" disabled={!text.includes("@") || busy} onClick={() => go(() => run((a) => a.changeEmail(u.id, text)), "Email change started.")}>Send confirmation</button>
          </div>
        </div>
      )}
      {mode === "suspend" && (
        <div className="row-wrap">
          <input className="input" aria-label="Reason for suspending" placeholder="Reason (kept in the audit trail)" value={text} onChange={(e) => setText(e.target.value)} />
          <button type="button" className="btn small primary" disabled={busy} onClick={() => go(() => run((a) => a.suspend(u.id, text)), "Suspended and signed out.")}>Suspend now</button>
        </div>
      )}
      {mode === "revoke" && (
        <div className="row-wrap">
          <span>This removes every business and the login. You can reinstate later.</span>
          <button type="button" className="btn small danger" disabled={busy} onClick={() => go(() => run((a) => a.revoke(u.id)), "Access revoked.")}>Yes, revoke access</button>
        </div>
      )}
      {mode === "link" && <LinkPerson user={u} onDone={() => { setMode(""); setMsg("Matched."); }} />}

      {err && <p className="error-text" role="alert">{err}</p>}
      {msg && <p className="muted" role="status">{msg}</p>}
      <PersonHistory userId={u.id} />
    </div>
  );
}

function BusinessRow({ user, b, disabled }: { user: PortalPerson; b: PortalBusiness; disabled: boolean }) {
  const { run } = usePortal();
  const [err, setErr] = useState("");
  const [confirm, setConfirm] = useState(false);
  const act = async (w: () => Promise<unknown>) => { setErr(""); try { await w(); } catch (e) { setErr(say(e)); } };
  return (
    <div className="row-wrap" style={{ gap: 8 }}>
      <a href={href("clients", b.clientKey)} style={{ minWidth: 180 }}>{b.name}</a>
      <select className="input" aria-label={`Level for ${b.name}`} value={b.level} disabled={disabled} onChange={(e) => act(() => run((a) => a.setAccess(user.id, b.clientKey, e.target.value as PortalLevel)))}>
        {LEVELS.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
      </select>
      {!disabled && (confirm
        ? <button type="button" className="btn small danger" onClick={() => act(() => run((a) => a.removeAccess(user.id, b.clientKey)))}>Confirm remove</button>
        : <button type="button" className="linkbtn danger-link" onClick={() => setConfirm(true)}>Remove</button>)}
      {err && <span className="error-text" role="alert">{err}</span>}
    </div>
  );
}

function LinkPerson({ user, onDone }: { user: PortalPerson; onDone: () => void }) {
  const { run } = usePortal();
  const people = usePeopleOptions();
  const [pick, setPick] = useState("");
  const [err, setErr] = useState("");
  const chosen = people.find((p) => p.key === pick);
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row-wrap">
        <select className="input" aria-label="Person in the planner" value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">Choose the person…</option>{people.map((p) => <option key={p.key} value={p.key}>{p.name}{p.email ? ` (${p.email})` : ""}</option>)}
        </select>
        <button type="button" className="btn small primary" disabled={!chosen} onClick={async () => { try { await run((a) => a.link(user.id, chosen!.key, chosen!.kind)); onDone(); } catch (e) { setErr(say(e)); } }}>Match</button>
      </div>
      {err && <p className="error-text" role="alert">{err}</p>}
    </div>
  );
}

function PersonHistory({ userId }: { userId: string }) {
  const { events, overview } = usePortal();
  const [list, setList] = useState<PortalEvent[] | null>(null);
  const [show, setShow] = useState(false);
  useEffect(() => { if (show) void events({ userId, limit: 30 }).then(setList).catch(() => setList([])); }, [show, userId, events, overview]);
  return (
    <div className="stack" style={{ gap: 6 }}>
      <button type="button" className="linkbtn" aria-expanded={show} onClick={() => setShow(!show)}>{show ? "Hide history" : "Show history"}</button>
      {show && (list ? <EventTable list={list} /> : <span className="muted">Loading…</span>)}
    </div>
  );
}

// ---------------------------------------------------------------- inviting

type PersonOption = { key: string; kind: "client" | "contact"; name: string; email: string };

/** People in the planner who could have a login: individual clients and the people listed as contacts. */
function usePeopleOptions(): PersonOption[] {
  const { data } = useData();
  return useMemo(() => {
    const out: PersonOption[] = [];
    for (const c of data.clients as Client[]) if (c.Kind === "Individual") out.push({ key: c.Key, kind: "client", name: String(c.Title), email: String(c.Email || "") });
    for (const r of data.contacts as Row[]) out.push({ key: String(r.Key), kind: "contact", name: String(r.Title || r.ContactTitle || r.Email || ""), email: String(r.Email || "").split(/[;,\s]+/)[0] });
    return out.filter((p) => p.name).sort((a, b) => a.name.localeCompare(b.name));
  }, [data.clients, data.contacts]);
}

export function InviteForm({ clientKey, preset, onDone }: { clientKey?: string; preset?: PersonOption; onDone?: () => void }) {
  const { run, overview } = usePortal();
  const { data } = useData();
  const people = usePeopleOptions();
  const [person, setPerson] = useState(preset?.key || "");
  const [name, setName] = useState(preset?.name || "");
  const [email, setEmail] = useState(preset?.email || "");
  const [rows, setRows] = useState<{ clientKey: string; level: PortalLevel }[]>([{ clientKey: clientKey || "", level: "standard" }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState("");
  const clients = useMemo(() => [...data.clients].sort((a, b) => String(a.Title).localeCompare(String(b.Title))), [data.clients]);
  const existing = overview?.users.find((u) => u.email === email.trim().toLowerCase());
  const choose = (key: string) => {
    setPerson(key);
    const p = people.find((x) => x.key === key);
    if (p) { setName(p.name); if (p.email) setEmail(p.email); }
  };
  const submit = async () => {
    setBusy(true); setErr(""); setResult("");
    try {
      const p = people.find((x) => x.key === person);
      const r = await run((a) => a.invite({ email: email.trim(), name: name.trim(), personKey: p?.key, personKind: p?.kind, businesses: rows.filter((x) => x.clientKey) }));
      setResult(r.emailed ? `Invitation emailed to ${r.user.email}.` : r.user.status === "invited" ? `Saved, but the email couldn't be sent${r.emailError ? ` (${r.emailError})` : ""}. Use "Resend invitation" once email is set up.` : `${r.user.name || r.user.email} already has a login. The businesses were added.`);
    } catch (e) { setErr(say(e)); } finally { setBusy(false); }
  };
  if (result) {
    return (
      <div className="stack" style={{ gap: 10 }}>
        <p role="status" style={{ margin: 0 }}>{result}</p>
        <div><button type="button" className="btn small" onClick={() => onDone?.()}>Done</button></div>
      </div>
    );
  }
  return (
    <div className="stack" style={{ gap: 10 }}>
      <h3 style={{ margin: 0 }}>Invite to the portal</h3>
      <div className="row-wrap">
        <select className="input" aria-label="Person in the planner" value={person} onChange={(e) => choose(e.target.value)}>
          <option value="">Not in the planner (type their details)</option>{people.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
        </select>
        <input className="input" aria-label="Their name" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input" type="email" aria-label="Their email" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      {existing && <p className="muted" style={{ margin: 0 }}>This email already has a login ({STATUS_LABEL[existing.status]}). The businesses below will be added to it; no second account is made.</p>}
      {rows.map((r, i) => (
        <div className="row-wrap" key={i}>
          <select className="input" aria-label="Business" value={r.clientKey} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, clientKey: e.target.value } : x)))}>
            <option value="">Choose a business…</option>{clients.map((c) => <option key={c.Key} value={c.Key}>{c.Title}</option>)}
          </select>
          <select className="input" aria-label="Permission level" value={r.level} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, level: e.target.value as PortalLevel } : x)))}>{LEVELS.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}</select>
          {rows.length > 1 && <button type="button" className="linkbtn danger-link" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button>}
        </div>
      ))}
      <p className="muted" style={{ margin: 0 }}>{LEVELS.find((l) => l.key === rows[0]?.level)?.blurb}</p>
      <div className="row-wrap">
        <button type="button" className="btn small" onClick={() => setRows([...rows, { clientKey: "", level: "standard" }])}>Add another business</button>
        <button type="button" className="btn primary" disabled={busy || !email.includes("@")} onClick={submit}>{busy ? "Sending…" : "Send invitation"}</button>
      </div>
      {err && <p className="error-text" role="alert">{err}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- on a client's page

/** The "Portal" tab of a business: everyone who can see it, and a way to add people. */
export function ClientPortalUsers({ client }: { client: Client }) {
  const portal = usePortal();
  useFresh();
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState("");
  const rows = portal.forClient(client.Key);
  const others = (portal.overview?.users || []).filter((u) => u.status !== "revoked" && !rows.some((r) => r.person.id === u.id));
  const [pick, setPick] = useState("");
  const [level, setLevel] = useState<PortalLevel>("standard");
  const [err, setErr] = useState("");
  if (portal.status && !portal.status.configured) return <p className="import-list warn" role="status">The client portal isn't switched on yet. <a href="#/portal/setup">See what's needed</a>.</p>;
  return (
    <div className="stack">
      <section className="card pad stack" aria-labelledby="pu-h">
        <div className="row-wrap" style={{ justifyContent: "space-between" }}>
          <h2 id="pu-h" style={{ margin: 0, fontSize: 16 }}>Portal users for {client.Title}</h2>
          <button type="button" className="btn small primary" onClick={() => setAdding(!adding)}>{adding ? "Close" : "Invite someone"}</button>
        </div>
        {adding && <InviteForm clientKey={client.Key} onDone={() => setAdding(false)} />}
        {!portal.overview ? <p className="muted">Loading…</p> : !rows.length ? <p className="muted" style={{ margin: 0 }}>No one can see this business in the portal yet.</p> : (
          <div className="table-wrap">
            <table className="grid" style={{ minWidth: 640 }}>
              <thead><tr><th scope="col">Person</th><th scope="col">Email</th><th scope="col">Status</th><th scope="col">Level</th><th scope="col">Last signed in</th><th scope="col">Two-step</th></tr></thead>
              <tbody>
                {rows.map(({ person: p, levelLabel: lv }) => (
                  <tr key={p.id}>
                    <td><button type="button" className="linkbtn" aria-expanded={open === p.id} onClick={() => setOpen(open === p.id ? "" : p.id)}>{p.name || p.email}</button></td>
                    <td>{p.email}</td>
                    <td><span className={`chip ${statusClass(p.status)}`}>{STATUS_LABEL[p.status]}</span></td>
                    <td>{lv}</td><td>{when(p.lastLoginAt)}</td><td>{p.mfa ? "On" : "Off"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows.filter((r) => r.person.id === open).map((r) => <PersonCard key={r.person.id} person={r.person} />)}
        {others.length > 0 && (
          <div className="row-wrap">
            <select className="input" aria-label="Existing portal user to add" value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Add someone who already has a login…</option>{others.map((u) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
            </select>
            <select className="input" aria-label="Level for the person being added" value={level} onChange={(e) => setLevel(e.target.value as PortalLevel)}>{LEVELS.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}</select>
            <button type="button" className="btn small" disabled={!pick} onClick={async () => { setErr(""); try { await portal.run((a) => a.setAccess(pick, client.Key, level)); setPick(""); } catch (e) { setErr(say(e)); } }}>Give access</button>
          </div>
        )}
        {err && <p className="error-text" role="alert">{err}</p>}
      </section>
      <section className="card pad stack" aria-labelledby="pa-h">
        <h2 id="pa-h" style={{ margin: 0, fontSize: 16 }}>Levels</h2>
        <dl className="pt-kv">{LEVELS.map((l) => <div key={l.key}><dt>{l.label}</dt><dd>{l.blurb}</dd></div>)}</dl>
        <p className="muted" style={{ margin: 0 }}>Being listed as a director or contact doesn't give anyone access. Only people you add here can see this business, and signing always needs the person to be named on the document.</p>
      </section>
      <section className="card pad stack"><h2 style={{ margin: 0, fontSize: 16 }}>History</h2><ClientHistory clientKey={client.Key} /></section>
    </div>
  );
}

function ClientHistory({ clientKey }: { clientKey: string }) {
  const { events, overview } = usePortal();
  const [list, setList] = useState<PortalEvent[] | null>(null);
  useEffect(() => { void events({ clientKey, limit: 50 }).then(setList).catch(() => setList([])); }, [clientKey, events, overview]);
  return list ? <EventTable list={list} /> : <span className="muted">Loading…</span>;
}

/** On an individual's own page: their portal login, or an invitation to make one. */
export function IndividualPortalAccess({ client }: { client: Client }) {
  const portal = usePortal();
  useFresh();
  const [inviting, setInviting] = useState(false);
  if (portal.status && !portal.status.configured) return null;
  const person = portal.forPerson(client.Key);
  return (
    <>
    <section className="card pad stack" aria-labelledby="cpa-h">
      <h2 id="cpa-h" style={{ margin: 0, fontSize: 16 }}>Client portal access</h2>
      {!portal.overview ? <p className="muted" style={{ margin: 0 }}>Loading…</p> : person ? <PersonCard person={person} /> : (
        <>
          <div className="row-wrap" style={{ justifyContent: "space-between" }}>
            <span><span className="chip dashed">Not invited</span> <span className="muted">No portal login yet.</span></span>
            <button type="button" className="btn small primary" onClick={() => setInviting(!inviting)}>{inviting ? "Close" : "Invite to portal"}</button>
          </div>
          {inviting && <InviteForm preset={{ key: client.Key, kind: "client", name: String(client.Title), email: String(client.Email || "") }} clientKey={client.Key} onDone={() => setInviting(false)} />}
        </>
      )}
    </section>
    {person && person.status === "active" && <IdentityFor person={person} />}
    </>
  );
}

// ---------------------------------------------------------------- activity and set-up

function EventTable({ list }: { list: PortalEvent[] }) {
  const { overview } = usePortal();
  const { data } = useData();
  const name = (id: string) => overview?.users.find((u) => u.id === id);
  const client = (key: string) => (data.clients as Client[]).find((c) => c.Key === key)?.Title;
  if (!list.length) return <p className="muted" style={{ margin: 0 }}>Nothing recorded yet.</p>;
  return (
    <div className="table-wrap">
      <table className="grid" style={{ minWidth: 640 }}>
        <thead><tr><th scope="col">When</th><th scope="col">What</th><th scope="col">Who</th><th scope="col">Business</th></tr></thead>
        <tbody>
          {list.map((e) => (
            <tr key={e.id}>
              <td className="mono">{when(e.at)}</td>
              <td>{eventLabel(e.type)}{e.meta?.level ? ` (${levelLabel(String(e.meta.level))})` : e.meta?.to ? ` (${levelLabel(String(e.meta.from))} to ${levelLabel(String(e.meta.to))})` : ""}{!e.verified && <span className="chip red" title="This event no longer matches its signature"> Altered</span>}</td>
              <td>{e.source === "staff" ? `${e.actor} (staff)` : name(e.userId)?.name || e.actor || "System"}{e.source === "staff" && e.userId && name(e.userId) ? ` → ${name(e.userId)!.name || name(e.userId)!.email}` : ""}</td>
              <td>{client(e.clientKey) || ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ActivityLog() {
  const { events, overview } = usePortal();
  const [list, setList] = useState<PortalEvent[] | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => { void events({ limit: 300 }).then(setList).catch(() => setList([])); }, [events, overview]);
  const shown = (list || []).filter((e) => !q.trim() || `${eventLabel(e.type)} ${e.actor} ${e.clientKey}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="stack">
      <input className="input" type="search" aria-label="Search activity" placeholder="Search activity" value={q} onChange={(e) => setQ(e.target.value)} />
      {list ? <EventTable list={shown} /> : <p className="muted">Loading…</p>}
      <p className="muted" style={{ margin: 0 }}>Each event is signed by the server when it's recorded. If one is changed afterwards in SharePoint, it shows as Altered here. Events can't be edited or removed from the portal.</p>
    </div>
  );
}

const SETTINGS: [string, string, boolean][] = [
  ["PORTAL_IDP_ISSUER", "The identity provider's issuer address (from the Entra External ID app's OpenID configuration).", true],
  ["PORTAL_IDP_JWKS_URL", "Where the provider publishes its signing keys.", true],
  ["PORTAL_IDP_CLIENT_ID", "The client portal app's Application (client) ID in the external tenant.", true],
  ["PORTAL_GRAPH_TENANT_ID", "Your Microsoft 365 tenant ID (for the portal server's own access).", true],
  ["PORTAL_GRAPH_CLIENT_ID", "The portal server app registration's client ID (access to the planner site only).", true],
  ["PORTAL_GRAPH_CLIENT_SECRET", "That app registration's secret.", true],
  ["PORTAL_AUDIT_KEY", "A long random string that signs audit events, so edits are detectable.", true],
  ["PORTAL_MAIL_FROM", "The mailbox invitations and reminders are sent from.", false],
  ["PORTAL_URL", "The portal's web address, put in invitation emails.", false],
  ["PORTAL_PRACTICE_NAME", "Your practice name, used in emails until branding is set.", false],
  ["PORTAL_ADMINS_MANAGE_ACCESS", "Set to true to let a business's administrators invite and remove people for that business.", false],
];

function SetupInfo() {
  const { status, reload } = usePortal();
  const missing = new Set([...(status?.missing || []), ...(status?.optional || [])]);
  return (
    <div className="stack">
      <section className="card pad stack">
        <h2 style={{ margin: 0, fontSize: 16 }}>{status?.configured ? "The client portal is switched on" : "The client portal needs setting up"}</h2>
        <p className="muted" style={{ margin: 0 }}>Clients register and sign in through Microsoft Entra External ID, a separate sign-in service for customers, so no passwords are kept here and two-step sign-in comes with it. Their browser only talks to the portal server, never to SharePoint. The server needs these Azure application settings; the full steps are in <code>docs/client-portal.md</code>.</p>
        <table className="bank-table">
          <thead><tr><th>Setting</th><th>What it is</th><th>Status</th></tr></thead>
          <tbody>{SETTINGS.map(([k, what, required]) => <tr key={k}><td className="mono">{k}</td><td>{what}</td><td>{missing.has(k) ? <span className={`chip ${required ? "red" : "amber"}`}>{required ? "Missing" : "Not set"}</span> : <span className="chip green">Set</span>}</td></tr>)}</tbody>
        </table>
        <div><button type="button" className="btn small" onClick={() => void reload()}>Check again</button></div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- change requests

const decisionWord = (d: string) => (d === "approved" ? "Approved" : d === "rejected" ? "Not approved" : d === "withdrawn" ? "Withdrawn" : "Waiting");

function ChangesQueue() {
  const portal = usePortal();
  const [list, setList] = useState<ChangeRequestStaff[] | null>(null);
  const [show, setShow] = useState<"open" | "all">("open");
  const [err, setErr] = useState("");
  // Requests decided during this visit stay on screen with their reminders until you leave the page.
  const [results, setResults] = useState<Record<string, DecideResult>>({});
  const load = () => portal.api.changes("").then(setList).catch((e) => setErr(say(e)));
  useEffect(() => { void load(); }, [portal.overview]);
  const shown = (list || []).filter((r) => show === "all" || r.status !== "decided" || results[r.id]);
  return (
    <div className="stack">
      <div className="row-wrap">
        <select className="input" aria-label="Which requests" value={show} onChange={(e) => setShow(e.target.value as "open" | "all")}><option value="open">Waiting</option><option value="all">All, including finished</option></select>
        <span className="muted">Clients propose changes in the portal. Nothing reaches the client record until you approve it here.</span>
      </div>
      {err && <p className="error-text" role="alert">{err}</p>}
      {!list ? <p className="muted">Loading…</p> : !shown.length ? <div className="card empty">{show === "open" ? "No change requests waiting." : "No change requests yet."}</div> : shown.map((r) => <ChangeCard key={r.id} r={r} result={results[r.id] || null} onDecided={(out) => setResults((x) => ({ ...x, [r.id]: out }))} onDone={() => { void load(); void portal.reload(); }} />)}
    </div>
  );
}

function ChangeCard({ r, result, onDecided, onDone }: { r: ChangeRequestStaff; result: DecideResult | null; onDecided: (out: DecideResult) => void; onDone: () => void }) {
  const portal = usePortal();
  const [dec, setDec] = useState<Record<string, { decision: "approved" | "rejected" | ""; note: string }>>({});
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const open = r.status !== "decided";
  const get = (k: string) => dec[k] || { decision: "", note: "" };
  const ready = r.items.every((i) => get(i.key).decision);
  const go = async (work: () => Promise<unknown>) => { setBusy(true); setErr(""); try { await work(); } catch (e) { setErr(say(e)); } finally { setBusy(false); } };
  const outcome = r.status === "decided" ? r.outcome : r.status === "clarification" ? "Waiting for the client's answer" : "Waiting for you";
  return (
    <section className="card pad stack" aria-label={`Change request from ${r.requestedByName}`} style={{ gap: 10 }}>
      <div className="row-wrap" style={{ justifyContent: "space-between" }}>
        <strong><a href={href("clients", r.clientKey)}>{r.clientName}</a> · {r.requestedByName}</strong>
        <span className={`chip ${r.status === "decided" ? (r.outcome === "rejected" ? "red" : "green") : r.status === "clarification" ? "" : "amber"}`}>{outcome[0].toUpperCase() + outcome.slice(1)}</span>
      </div>
      <div className="muted">Asked {day(r.createdAt)} · {r.requestedByEmail}{r.note ? ` · “${r.note}”` : ""}</div>
      <div className="table-wrap">
        <table className="grid" style={{ minWidth: 720 }}>
          <thead><tr><th scope="col">Detail</th><th scope="col">When asked</th><th scope="col">On the record now</th><th scope="col">Proposed</th><th scope="col">{open ? "Your decision" : "Decision"}</th></tr></thead>
          <tbody>
            {r.items.map((i) => (
              <tr key={i.key}>
                <td>{i.label}{i.statutory && <div className="cell-sub">Also needs filing at {i.statutory}</div>}{i.noted && <div className="cell-sub">Noted only: update by hand</div>}</td>
                <td style={{ whiteSpace: "pre-line" }}>{i.old || "—"}</td>
                <td style={{ whiteSpace: "pre-line" }}>{i.noted ? "—" : i.current || "—"}{open && !i.noted && i.current !== i.old && <div className="cell-sub"><span className="chip amber">Changed since</span></div>}</td>
                <td style={{ whiteSpace: "pre-line", fontWeight: 600 }}>{i.new}</td>
                <td>{open ? (
                  <div className="stack" style={{ gap: 4 }}>
                    <div className="row-wrap" style={{ gap: 10 }}>
                      <label className="check"><input type="radio" name={`${r.id}-${i.key}`} aria-label={`Approve ${i.label}`} checked={get(i.key).decision === "approved"} onChange={() => setDec({ ...dec, [i.key]: { ...get(i.key), decision: "approved" } })} /> Approve</label>
                      <label className="check"><input type="radio" name={`${r.id}-${i.key}`} aria-label={`Reject ${i.label}`} checked={get(i.key).decision === "rejected"} onChange={() => setDec({ ...dec, [i.key]: { ...get(i.key), decision: "rejected" } })} /> Reject</label>
                    </div>
                    <input className="input" aria-label={`Note for ${i.label}`} placeholder="Note to the client (optional)" value={get(i.key).note} onChange={(e) => setDec({ ...dec, [i.key]: { ...get(i.key), note: e.target.value } })} />
                  </div>
                ) : <>{decisionWord(i.decision)}{i.note ? ` — ${i.note}` : ""}</>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {r.thread.map((m, n) => <p key={n} className="muted" style={{ margin: 0 }}><strong>{m.from === "staff" ? m.name : r.requestedByName}:</strong> {m.text}</p>)}
      {open && (
        <>
          <div className="row-wrap">
            <input className="input" aria-label="Question for the client" placeholder="Ask the client a question before deciding" value={question} onChange={(e) => setQuestion(e.target.value)} />
            <button type="button" className="btn small" disabled={busy || !question.trim()} onClick={() => go(async () => { await portal.api.askChange(r.id, question); setQuestion(""); onDone(); })}>Ask</button>
          </div>
          <div className="row-wrap">
            <button type="button" className="btn primary" disabled={busy || !ready} onClick={() => go(async () => { const out = await portal.api.decideChange(r.id, r.items.map((i) => ({ key: i.key, decision: get(i.key).decision as "approved" | "rejected", note: get(i.key).note }))); onDecided(out); if (out.applied.length) await portal.reloadPlanner(); onDone(); })}>{busy ? "Saving…" : "Save decisions"}</button>
            {!ready && <span className="muted">Choose approve or reject for every line.</span>}
          </div>
        </>
      )}
      {result && (
        <div className="alert amber" role="status">
          <strong>Saved: {result.outcome}.</strong>
          <span>{result.applied.length ? "Approved changes are now on the client's record. " : ""}{result.statutory.length ? `Remember: approving doesn't update Companies House or HMRC. Still to file: ${result.statutory.map((s) => `${s.field} (${s.body})`).join(", ")}.` : ""}</span>
        </div>
      )}
      {err && <p className="error-text" role="alert">{err}</p>}
    </section>
  );
}
