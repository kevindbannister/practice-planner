// Sales: leads, the pipeline board and opportunities. Everything that changes a record goes through lib/sales.ts,
// which also writes the audit line and the timeline entry.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { fmtDate } from "../lib/domain";
import {
  ACTIVITY_KINDS, ActivityInput, Lead, Match, Opp, createLead, createOpp, findDuplicates, inStage, isOpenOpp, linkToClient, logActivity, logRow, moveStage, outcomeOf, reopen, setOutcome, totals,
} from "../lib/sales";
import { Row } from "../lib/schema";
import { href, useRoute } from "./bits";
import { useData } from "./data";
import { money, outcomeChip, useSales } from "./salesKit";
import { useBoardDrag } from "./useBoardDrag";
import { ProposalDetail, ProposalLinks, ProposalsList } from "./ProposalsPage";
import { EngagementDetail, EngagementsList } from "./EngagementsPage";
import { OnboardingDetail, OnboardingList } from "./OnboardingPage";
import { TYPE_INFO, ActivityType } from "../lib/timeline";

const TABS: [string, string, string][] = [["", "Overview", "#/sales"], ["pipeline", "Pipeline", "#/sales/pipeline"], ["leads", "Leads", "#/sales/leads"], ["proposals", "Proposals", "#/sales/proposals"], ["engagements", "Engagements", "#/sales/engagements"], ["onboarding", "Onboarding", "#/sales/onboarding"]];

export function SalesPage() {
  const { parts } = useRoute();
  const s = useSales();
  const sub = parts[1] || "";
  if (!s.can("view")) return <div className="page"><div className="card empty"><p>Sales isn't open to your role. Ask a manager or partner if you need it.</p></div></div>;
  const current = sub === "lead" ? "leads" : sub === "opp" ? "pipeline" : sub === "proposal" ? "proposals" : sub === "engagement" ? "engagements" : sub === "onboard" ? "onboarding" : sub;
  return (
    <div className="page">
      <div className="plan-title">
        <h1>Sales</h1>
        <nav className="subtabs" aria-label="Sales views">
          {TABS.map(([k, label, to]) => <a key={k} href={to} aria-current={current === k ? "page" : undefined}>{label}</a>)}
          {s.can("configure") && <a href="#/settings/sales">Sales settings</a>}
          {s.pcan("configure") && <a href="#/settings/services">Services & pricing</a>}
          {s.pcan("configure") && <a href="#/settings/engagement">Engagement letter settings</a>}
          {s.pcan("configure") && <a href="#/settings/onboarding">Onboarding settings</a>}
        </nav>
      </div>
      {sub === "pipeline" && <Pipeline />}
      {sub === "leads" && <Leads />}
      {sub === "lead" && parts[2] && <LeadDetail leadKey={parts[2]} />}
      {sub === "opp" && parts[2] && <OppDetail oppKey={parts[2]} />}
      {sub === "proposals" && <ProposalsList />}
      {sub === "proposal" && parts[2] && <ProposalDetail propKey={parts[2]} />}
      {sub === "engagements" && <EngagementsList />}
      {sub === "engagement" && parts[2] && <EngagementDetail engKey={parts[2]} />}
      {sub === "onboarding" && <OnboardingList />}
      {sub === "onboard" && parts[2] && <OnboardingDetail onbKey={parts[2]} />}
      {!sub && <Overview />}
    </div>
  );
}

// ------------------------------------------------------------------ overview

function Overview() {
  const s = useSales();
  const t = totals(s.opps, s.stages, s.today);
  const open = s.opps.filter(isOpenOpp);
  const due = open.filter((o) => o.FollowUp).sort((a, b) => String(a.FollowUp).localeCompare(String(b.FollowUp))).slice(0, 8);
  const untouched = open.filter((o) => o.Stage === s.stages[0].key && !o.LastContact);
  return (
    <>
      <div className="grid-stats" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, marginBottom: 16 }}>
        {[["Open opportunities", String(t.open)], ["Pipeline value", money(t.value) || "£0"], ["Follow-ups overdue", String(t.overdue)], ["Won", String(t.won)], ["Lost", String(t.lost)], ["Deferred", String(t.deferred)]].map(([k, v]) => (
          <div className="card" key={k} style={{ padding: 14 }}><div className="muted" style={{ fontSize: 12 }}>{k}</div><div style={{ fontSize: 24, fontWeight: 700 }}>{v}</div></div>
        ))}
      </div>
      <div className="card" style={{ padding: 14, marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>By stage</h2>
        <table className="table"><tbody>
          {s.stages.map((st) => (
            <tr key={st.key}><td>{st.label}</td><td>{t.byStage[st.key]?.count || 0}</td><td>{money(t.byStage[st.key]?.value)}</td></tr>
          ))}
        </tbody></table>
      </div>
      <div className="card" style={{ padding: 14, marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Follow-ups</h2>
        {due.length ? <ul className="plain">{due.map((o) => (
          <li key={o.Key}><a href={href("sales", "opp", o.Key)}>{o.Title}</a> <span className="muted">· {s.nameOf(o)} · </span>
            <span className={`chip ${String(o.FollowUp) < s.today ? "red" : ""}`}>{fmtDate(String(o.FollowUp))}</span></li>
        ))}</ul> : <p className="muted" style={{ margin: 0 }}>No follow-ups set.</p>}
      </div>
      {untouched.length > 0 && (
        <div className="card" style={{ padding: 14 }}>
          <h2 style={{ marginTop: 0 }}>New and not yet contacted</h2>
          <ul className="plain">{untouched.map((o) => <li key={o.Key}><a href={href("sales", "opp", o.Key)}>{o.Title}</a> <span className="muted">· {s.nameOf(o)}</span></li>)}</ul>
        </div>
      )}
      {!s.opps.length && !s.leads.length && (
        <div className="card empty"><p>No leads yet. <a href="#/sales/leads">Add your first lead</a>.</p></div>
      )}
    </>
  );
}

// ------------------------------------------------------------------ leads

function Leads() {
  const s = useSales();
  const [q, setQ] = useState("");
  const [show, setShow] = useState<"open" | "all">("open");
  const [adding, setAdding] = useState(false);
  const rows = s.leads.filter((l) => (show === "all" || l.Status !== "closed") && (!q.trim() || [l.Title, l.Email, l.ContactName, l.Source].join(" ").toLowerCase().includes(q.trim().toLowerCase())));
  return (
    <>
      <div className="row-wrap" style={{ gap: 10, marginBottom: 12, alignItems: "center" }}>
        <input className="input" style={{ maxWidth: 280 }} placeholder="Search leads" aria-label="Search leads" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="seg" role="group" aria-label="Show"><button type="button" aria-pressed={show === "open"} onClick={() => setShow("open")}>Open</button><button type="button" aria-pressed={show === "all"} onClick={() => setShow("all")}>All</button></div>
        {s.can("work") && <button type="button" className="btn primary" style={{ marginLeft: "auto" }} onClick={() => setAdding(true)}>+ New lead</button>}
      </div>
      {adding && <NewLead onClose={() => setAdding(false)} />}
      {rows.length ? (
        <div className="card table-wrap"><table className="table">
          <thead><tr><th>Name</th><th>Source</th><th>Received</th><th>Owner</th><th>Opportunities</th><th>Status</th></tr></thead>
          <tbody>{rows.map((l) => (
            <tr key={l.Key}>
              <td><a href={href("sales", "lead", l.Key)}>{l.Title}</a><div className="muted" style={{ fontSize: 12 }}>{[l.ContactName, l.Email].filter(Boolean).join(" · ")}</div></td>
              <td>{String(l.Source || "")}</td><td>{l.Received ? fmtDate(String(l.Received)) : ""}</td><td>{String(l.Owner || "")}</td>
              <td>{s.opps.filter((o) => o.LeadKey === l.Key && isOpenOpp(o)).length}</td>
              <td>{l.Status === "converted" ? <span className="chip green">Client</span> : l.Status === "closed" ? <span className="chip">Closed</span> : <span className="chip blue">Open</span>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      ) : <div className="card empty"><p>{s.leads.length ? "No leads match." : "No leads yet."}</p></div>}
    </>
  );
}

function NewLead({ onClose }: { onClose: () => void }) {
  const s = useSales();
  const { data, create } = useData();
  const [f, setF] = useState({ name: "", kind: "business" as "business" | "individual", contactName: "", email: "", phone: "", companyNumber: "", source: "", owner: s.me, work: "", notes: "" });
  const [dups, setDups] = useState<Match[] | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF({ ...f, [k]: e.target.value }); setDups(null); };

  const save = async (override: boolean) => {
    setError(undefined);
    const matches = findDuplicates({ name: f.name, email: f.email, phone: f.phone, companyNumber: f.companyNumber }, s.leads, data.clients, data.contacts);
    if (matches.length && !override) { setDups(matches); return; }
    setBusy(true);
    try {
      const o = s.ctx();
      const r = createLead({ name: f.name, kind: f.kind, contactName: f.contactName, email: f.email, phone: f.phone, source: f.source, owner: f.owner, notes: f.notes }, o);
      if ("error" in r) { setError(r.error); return; }
      await create("Leads", { ...r.lead, ...(f.companyNumber ? { Notes: `${r.lead.Notes ? r.lead.Notes + "\n" : ""}Company number: ${f.companyNumber}` } : {}) });
      await create("SalesLog", r.log);
      await create("Activities", r.activity);
      if (override && matches.length) await create("SalesLog", logRow(o, "duplicate-override", "lead", String(r.lead.Key), { leadKey: String(r.lead.Key) }, { matches: matches.map((m) => ({ kind: m.kind, key: m.key, title: m.title, why: m.why })) }));
      if (f.work.trim()) {
        const op = createOpp({ title: f.work, leadKey: String(r.lead.Key), stage: s.stages[0].key, owner: f.owner }, s.opps, o);
        if (!("error" in op)) { await create("Opportunities", op.opp); await create("SalesLog", op.log); await create("Activities", op.activity); }
      }
      window.location.hash = href("sales", "lead", String(r.lead.Key));
    } catch {
      setError("That didn't save. Try again.");
    } finally { setBusy(false); }
  };

  return (
    <form className="card" style={{ padding: 16, marginBottom: 16 }} onSubmit={(e) => { e.preventDefault(); void save(false); }} aria-label="New lead">
      <h2 style={{ marginTop: 0 }}>New lead</h2>
      <div className="form-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
        <label className="doc-field"><span>Name (person or business)</span><input className="input" value={f.name} onChange={set("name")} autoFocus /></label>
        <label className="doc-field"><span>Type</span><select className="input" value={f.kind} onChange={set("kind")}><option value="business">Business</option><option value="individual">Individual</option></select></label>
        <label className="doc-field"><span>Contact name</span><input className="input" value={f.contactName} onChange={set("contactName")} /></label>
        <label className="doc-field"><span>Email</span><input className="input" type="email" value={f.email} onChange={set("email")} /></label>
        <label className="doc-field"><span>Phone</span><input className="input" value={f.phone} onChange={set("phone")} /></label>
        <label className="doc-field"><span>Company number (if known)</span><input className="input" value={f.companyNumber} onChange={set("companyNumber")} /></label>
        <label className="doc-field"><span>Source</span><select className="input" value={f.source} onChange={set("source")}><option value="">Not known</option>{s.sources.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label className="doc-field"><span>Owner</span><input className="input" value={f.owner} onChange={set("owner")} /></label>
      </div>
      <label className="doc-field" style={{ marginTop: 12 }}><span>What they're asking for (starts an opportunity)</span><input className="input" value={f.work} onChange={set("work")} placeholder="e.g. Annual accounts and tax" /></label>
      <label className="doc-field" style={{ marginTop: 12 }}><span>Notes</span><textarea className="input" rows={3} value={f.notes} onChange={set("notes")} /></label>
      {dups && (
        <div className="card" role="alert" style={{ padding: 12, marginTop: 12, borderColor: "var(--amber-ink)" }}>
          <strong>This may already be in xproflow</strong>
          <ul className="plain" style={{ margin: "8px 0" }}>
            {dups.map((m) => (
              <li key={m.kind + m.key} style={{ marginBottom: 6 }}>
                <strong>{m.title}</strong> <span className="chip">{m.kind === "client" ? "Client" : m.kind === "contact" ? "Contact" : "Lead"}</span> <span className="muted">{m.why.join(", ")}</span>{" "}
                {m.kind === "lead" && <a href={href("sales", "lead", m.key)}>Open this lead</a>}
                {m.kind === "client" && <a href={href("clients", m.key)}>Open this client</a>}
                {m.kind === "contact" && m.clientKey && <a href={href("clients", m.clientKey)}>Open their client</a>}
              </li>
            ))}
          </ul>
          <p className="muted" style={{ margin: "0 0 8px" }}>If it's the same person, open the record above rather than adding them twice. If a client wants more work, start an opportunity from their client page.</p>
          <button type="button" className="btn" disabled={busy} onClick={() => void save(true)}>It's someone else: create anyway</button>
        </div>
      )}
      {error && <p role="alert" style={{ color: "var(--red-ink)" }}>{error}</p>}
      <div className="row-wrap" style={{ gap: 8, marginTop: 12 }}>
        <button type="submit" className="btn primary" disabled={busy || !f.name.trim()}>Save lead</button>
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}

function LeadDetail({ leadKey }: { leadKey: string }) {
  const s = useSales();
  const { data, create, update } = useData();
  const lead = s.leads.find((l) => l.Key === leadKey);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [pick, setPick] = useState("");
  const [err, setErr] = useState<string>();
  const [notes, setNotes] = useState(String(lead?.Notes || ""));
  useEffect(() => setNotes(String(lead?.Notes || "")), [lead?.Notes]);
  if (!lead) return <div className="card empty"><p>That lead isn't here. <a href="#/sales/leads">Back to leads</a></p></div>;
  const mine = s.opps.filter((o) => o.LeadKey === lead.Key);
  const client = lead.ClientKey ? data.clients.find((c) => c.Key === lead.ClientKey) : undefined;
  const work = s.can("work");
  const run = async (fn: () => Promise<void>) => { setErr(undefined); try { await fn(); } catch { setErr("That didn't save. Try again."); } };
  const addOpp = () => run(async () => {
    const r = createOpp({ title, leadKey: lead.Key, clientKey: client?.Key, stage: s.stages[0].key, owner: s.me }, s.opps, s.ctx());
    if ("error" in r) { setErr(r.error); return; }
    await create("Opportunities", r.opp); await create("SalesLog", r.log); await create("Activities", r.activity);
    setTitle(""); setAdding(false);
  });
  const link = () => run(async () => {
    if (!pick) return;
    await s.apply(linkToClient(lead, pick, s.opps, data.activities as Row[], s.ctx()));
  });
  return (
    <>
      <p><a href="#/sales/leads">← Leads</a></p>
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div className="row-wrap" style={{ justifyContent: "space-between", gap: 8 }}>
          <h2 style={{ margin: 0 }}>{lead.Title}</h2>
          {lead.Status === "converted" ? <span className="chip green">Linked to a client</span> : lead.Status === "closed" ? <span className="chip">Closed</span> : <span className="chip blue">Open</span>}
        </div>
        <dl className="kv" style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "4px 14px", marginTop: 12 }}>
          {([["Type", lead.Kind === "individual" ? "Individual" : "Business"], ["Contact", lead.ContactName], ["Email", lead.Email], ["Phone", lead.Phone], ["Source", lead.Source], ["Owner", lead.Owner], ["Received", lead.Received ? fmtDate(String(lead.Received)) : ""]] as [string, unknown][])
            .filter(([, v]) => v).map(([k, v]) => <div key={k} style={{ display: "contents" }}><dt className="muted">{k}</dt><dd style={{ margin: 0 }}>{String(v)}</dd></div>)}
        </dl>
        {client && <p style={{ marginBottom: 0 }}>Client record: <a href={href("clients", client.Key)}>{client.Title}</a></p>}
        <label className="doc-field" style={{ marginTop: 12 }}><span>Notes</span>
          <textarea className="input" rows={3} value={notes} disabled={!work} onChange={(e) => setNotes(e.target.value)} onBlur={() => work && void run(() => s.edit("Leads", lead, { Notes: notes }))} />
        </label>
        {work && lead.Status !== "converted" && (
          <div style={{ marginTop: 12 }}>
            <div className="row-wrap" style={{ gap: 8, alignItems: "center" }}>
              <select className="input" style={{ maxWidth: 320 }} aria-label="Existing client" value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">Link to an existing client…</option>
                {data.clients.map((c) => <option key={c.Key} value={c.Key}>{c.Title}</option>)}
              </select>
              <button type="button" className="btn" disabled={!pick} onClick={link}>Link</button>
              <button type="button" className="btn" onClick={() => run(() => s.edit("Leads", lead, { Status: lead.Status === "closed" ? "open" : "closed" }))}>{lead.Status === "closed" ? "Reopen lead" : "Close lead"}</button>
            </div>
            <p className="muted" style={{ fontSize: 12, margin: "6px 0 0" }}>Linking moves this lead's opportunities and history onto the client. Clients themselves are added by import, so nothing is copied.</p>
          </div>
        )}
      </div>
      <div className="card" style={{ padding: 16 }}>
        <div className="row-wrap" style={{ justifyContent: "space-between" }}><h2 style={{ margin: 0 }}>Opportunities</h2>
          {work && !adding && <button type="button" className="btn small" onClick={() => setAdding(true)}>+ New opportunity</button>}</div>
        {adding && <div className="row-wrap" style={{ gap: 8, marginTop: 10 }}>
          <input className="input" style={{ maxWidth: 360 }} aria-label="Opportunity name" placeholder="What are they asking for?" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          <button type="button" className="btn primary" onClick={addOpp}>Add</button><button type="button" className="btn" onClick={() => setAdding(false)}>Cancel</button></div>}
        {err && <p role="alert" style={{ color: "var(--red-ink)" }}>{err}</p>}
        <OppList opps={mine} />
        <ProposalLinks leadKey={lead.Key} opps={mine} />
      </div>
    </>
  );
}

export function OppList({ opps }: { opps: Opp[] }) {
  const s = useSales();
  if (!opps.length) return <p className="muted">None yet.</p>;
  return (
    <ul className="plain" style={{ marginTop: 10 }}>
      {opps.map((o) => {
        const oc = outcomeChip(o);
        return (
          <li key={o.Key} style={{ marginBottom: 6 }}>
            <a href={href("sales", "opp", o.Key)}>{o.Title}</a>{" "}
            {oc ? <span className={`chip ${oc.cls}`}>{oc.label}</span> : <span className="chip blue">{s.stages.find((x) => x.key === o.Stage)?.label || o.Stage}</span>}{" "}
            {money(o.Value) && <span className="muted">{money(o.Value)}</span>}
          </li>
        );
      })}
    </ul>
  );
}

// ------------------------------------------------------------------ pipeline board

function Pipeline() {
  const s = useSales();
  const [mine, setMine] = useState(false);
  const [error, setError] = useState<string>();
  const [showClosed, setShowClosed] = useState(false);
  const first = s.stages[0].key;
  const known = new Set(s.stages.map((x) => x.key));
  const all = s.opps;
  const onBoard = all.filter((o) => (isOpenOpp(o) || (outcomeOf(o) === "won")) && (!mine || o.Owner === s.me));
  const colOf = (o: Opp) => (known.has(o.Stage) ? o.Stage : first);
  const cards = (stage: string) => inStage(onBoard.map((o) => ({ ...o, Stage: colOf(o) })) as Opp[], stage);
  const work = s.can("work");

  const move = async (key: string, target: string, at?: number) => {
    setError(undefined);
    if (!work) { setError("Your role can view the pipeline but not change it."); return; }
    const opp = all.find((o) => o.Key === key);
    if (!opp || !target.startsWith("stage:")) return;
    const r = moveStage(opp, target.slice(6), at, all, s.stages, s.ctx());
    if ("error" in r) { setError(r.error); return; }
    try { await s.apply(r); } catch { setError("That change didn't save. Try again."); }
  };
  const { dragKey, target: dropTarget, insertAt, cardProps } = useBoardDrag((k, t, at) => void move(k, t, at));
  const closed = all.filter((o) => !isOpenOpp(o) && outcomeOf(o) !== "won");

  return (
    <>
      <div className="row-wrap" style={{ gap: 10, marginBottom: 12, alignItems: "center" }}>
        <div className="seg" role="group" aria-label="Whose"><button type="button" aria-pressed={!mine} onClick={() => setMine(false)}>Everyone</button><button type="button" aria-pressed={mine} onClick={() => setMine(true)}>Mine</button></div>
        <span className="muted" style={{ fontSize: 13 }}>{work ? "Drag a card to move it, or open it to use the stage menu." : "View only."}</span>
        <a className="btn" style={{ marginLeft: "auto" }} href="#/sales/leads">Leads</a>
      </div>
      {error && <p role="alert" style={{ color: "var(--red-ink)" }}>{error}</p>}
      <div className="kanban" role="list" aria-label="Pipeline" style={{ display: "grid", gridAutoFlow: "column", gridAutoColumns: "minmax(230px, 1fr)", gap: 12, overflowX: "auto", paddingBottom: 12 }}>
        {s.stages.map((st) => {
          const list = cards(st.key);
          const value = list.reduce((t, o) => t + (Number(o.Value) || 0), 0);
          let n = 0;
          const out: ReactNode[] = [];
          for (const o of list) {
            if (o.Key !== dragKey) {
              if (dropTarget === `stage:${st.key}` && insertAt === n) out.push(<div key="line" className="drop-line" aria-hidden="true" />);
              n++;
            }
            out.push(<OppCard key={o.Key} opp={all.find((x) => x.Key === o.Key)!} dragging={dragKey === o.Key} props={work ? cardProps(o.Key) : {}} />);
          }
          if (dropTarget === `stage:${st.key}` && dragKey && insertAt === n && list.some((o) => o.Key !== dragKey)) out.push(<div key="line" className="drop-line" aria-hidden="true" />);
          return (
            <section key={st.key} role="listitem" aria-label={st.label} data-drop={`stage:${st.key}`} data-order="" className={`kcol${dropTarget === `stage:${st.key}` ? " drop" : ""}`}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <h2 style={{ margin: 0, fontSize: 15 }}>{st.label}</h2>
                <span className="mono" style={{ fontSize: 12 }}>{list.length}{money(value) ? ` · ${money(value)}` : ""}</span>
              </div>
              <div className="stack" style={{ gap: 8, marginTop: 8 }}>{out.length ? out : <span className="muted" style={{ fontSize: 12 }}>Nothing here</span>}</div>
            </section>
          );
        })}
      </div>
      {closed.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <button type="button" className="btn" aria-expanded={showClosed} onClick={() => setShowClosed(!showClosed)}>{showClosed ? "Hide" : "Show"} lost and deferred ({closed.length})</button>
          {showClosed && <div className="card" style={{ padding: 14, marginTop: 10 }}><OppList opps={closed} /></div>}
        </div>
      )}
    </>
  );
}

function OppCard({ opp: o, dragging, props }: { opp: Opp; dragging: boolean; props: Record<string, unknown> }) {
  const s = useSales();
  const late = o.FollowUp && String(o.FollowUp) < s.today && isOpenOpp(o);
  return (
    <a href={href("sales", "opp", o.Key)} className={`pcard${dragging ? " dragging" : ""}`} data-card={o.Key} draggable={false} {...props}>
      <strong>{o.Title}</strong>
      <span className="muted" style={{ fontSize: 12 }}>{s.nameOf(o)}</span>
      <span className="row-wrap" style={{ gap: 6 }}>
        {money(o.Value) && <span className="chip">{money(o.Value)}</span>}
        {o.FollowUp && <span className={`chip${late ? " red" : ""}`}>{late ? "Overdue " : "Follow up "}{fmtDate(String(o.FollowUp), { year: false })}</span>}
        {outcomeOf(o) === "won" && <span className="chip green">Won</span>}
        {o.Owner && <span className="muted" style={{ fontSize: 12 }}>{String(o.Owner)}</span>}
      </span>
    </a>
  );
}

// ------------------------------------------------------------------ one opportunity

function OppDetail({ oppKey }: { oppKey: string }) {
  const s = useSales();
  const { data } = useData();
  const o = s.opps.find((x) => x.Key === oppKey);
  const [err, setErr] = useState<string>();
  const [reason, setReason] = useState("");
  const [until, setUntil] = useState("");
  const [closing, setClosing] = useState<"lost" | "deferred" | null>(null);
  const [act, setAct] = useState<ActivityInput>({ kind: "call", text: "", followUp: "" });
  const [fields, setFields] = useState({ Value: "", Owner: "", Services: "", NextAction: "", FollowUp: "" });
  const sig = o ? [o.Value, o.Owner, o.Services, o.NextAction, o.FollowUp].join("|") : "";
  const sigRef = useRef(sig);
  useEffect(() => {
    if (!o) return;
    sigRef.current = sig;
    setFields({ Value: String(o.Value || ""), Owner: String(o.Owner || ""), Services: String(o.Services || ""), NextAction: String(o.NextAction || ""), FollowUp: String(o.FollowUp || "") });
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  const history = useMemo(() => (data.activities as Row[]).filter((a) => a.OppKey === oppKey).sort((a, b) => String(b.At).localeCompare(String(a.At))), [data.activities, oppKey]);
  if (!o) return <div className="card empty"><p>That opportunity isn't here. <a href="#/sales/pipeline">Back to the pipeline</a></p></div>;
  const work = s.can("work");
  const out = outcomeOf(o);
  const run = async (fn: () => Promise<boolean | void>): Promise<boolean> => { setErr(undefined); try { return (await fn()) !== false; } catch { setErr("That didn't save. Try again."); return false; } };
  const doApply = (r: ReturnType<typeof moveStage>) => run(async () => { if ("error" in r) { setErr(r.error); return false; } await s.apply(r); });
  const parent = o.LeadKey ? s.leads.find((l) => l.Key === o.LeadKey) : undefined;
  const client = o.ClientKey ? data.clients.find((c) => c.Key === o.ClientKey) : undefined;
  const saveFields = () => run(async () => {
    if (fields.FollowUp && !/^\d{4}-\d{2}-\d{2}$/.test(fields.FollowUp)) { setErr("Use a date for the follow-up."); return; }
    await s.edit("Opportunities", o, { Value: Number(fields.Value) || 0, Owner: fields.Owner, Services: fields.Services, NextAction: fields.NextAction, FollowUp: fields.FollowUp });
  });
  const f = (k: keyof typeof fields) => ({ value: fields[k], disabled: !work, onChange: (e: { target: { value: string } }) => setFields({ ...fields, [k]: e.target.value }) });
  return (
    <>
      <p><a href="#/sales/pipeline">← Pipeline</a></p>
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div className="row-wrap" style={{ justifyContent: "space-between", gap: 8 }}>
          <h2 style={{ margin: 0 }}>{o.Title}</h2>
          {out === "open" ? <span className="chip blue">{s.stages.find((x) => x.key === o.Stage)?.label || o.Stage}</span> : <span className={`chip ${outcomeChip(o)!.cls}`}>{outcomeChip(o)!.label}{o.LostReason ? `: ${o.LostReason}` : ""}{out === "deferred" && o.DeferUntil ? ` until ${fmtDate(String(o.DeferUntil))}` : ""}</span>}
        </div>
        <p className="muted" style={{ margin: "6px 0 0" }}>
          {client ? <>Client: <a href={href("clients", client.Key)}>{client.Title}</a></> : parent ? <>Lead: <a href={href("sales", "lead", parent.Key)}>{parent.Title}</a></> : ""}
          {client && parent ? <> · from lead <a href={href("sales", "lead", parent.Key)}>{parent.Title}</a></> : ""}
        </p>
        {work && out === "open" && (
          <div className="row-wrap" style={{ gap: 8, marginTop: 12, alignItems: "center" }}>
            <label className="row-wrap" style={{ gap: 6, alignItems: "center" }}><span className="muted">Stage</span>
              <select className="input" style={{ width: "auto" }} aria-label="Stage" value={o.Stage} onChange={(e) => void doApply(moveStage(o, e.target.value, undefined, s.opps, s.stages, s.ctx()))}>
                {s.stages.map((st) => <option key={st.key} value={st.key}>{st.label}</option>)}
              </select></label>
            <button type="button" className="btn" onClick={() => void doApply(setOutcome(o, "won", s.stages, s.ctx(), {}))}>Mark won</button>
            <button type="button" className="btn" onClick={() => setClosing("lost")}>Mark lost</button>
            <button type="button" className="btn" onClick={() => setClosing("deferred")}>Defer</button>
          </div>
        )}
        {work && closing && (
          <div className="row-wrap" style={{ gap: 8, marginTop: 10, alignItems: "center" }}>
            {closing === "lost"
              ? <select className="input" style={{ maxWidth: 260 }} aria-label="Reason lost" value={reason} onChange={(e) => setReason(e.target.value)}><option value="">Why was it lost?</option>{s.lostReasons.map((r) => <option key={r}>{r}</option>)}</select>
              : <label className="row-wrap" style={{ gap: 6, alignItems: "center" }}><span className="muted">Come back on</span><input className="input" type="date" aria-label="Defer until" value={until} onChange={(e) => setUntil(e.target.value)} /></label>}
            <button type="button" className="btn primary" onClick={() => void doApply(setOutcome(o, closing, s.stages, s.ctx(), { reason, until })).then((ok) => ok && setClosing(null))}>Confirm</button>
            <button type="button" className="btn" onClick={() => setClosing(null)}>Cancel</button>
          </div>
        )}
        {work && out !== "open" && <div style={{ marginTop: 12 }}><button type="button" className="btn" onClick={() => void doApply(reopen(o, s.stages, s.ctx()))}>Reopen</button></div>}
        {err && <p role="alert" style={{ color: "var(--red-ink)" }}>{err}</p>}
        <div className="form-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12, marginTop: 14 }}>
          <label className="doc-field"><span>Estimated annual fee (£)</span><input className="input" inputMode="decimal" {...f("Value")} /></label>
          <label className="doc-field"><span>Owner</span><input className="input" {...f("Owner")} /></label>
          <label className="doc-field"><span>Services wanted</span><input className="input" {...f("Services")} /></label>
          <label className="doc-field"><span>Next action</span><input className="input" {...f("NextAction")} /></label>
          <label className="doc-field"><span>Follow up on</span><input className="input" type="date" {...f("FollowUp")} /></label>
        </div>
        {work && <div style={{ marginTop: 10 }}><button type="button" className="btn" onClick={saveFields}>Save details</button></div>}
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 16 }}><ProposalLinks oppKey={o.Key} leadKey={o.LeadKey ? String(o.LeadKey) : undefined} clientKey={o.ClientKey ? String(o.ClientKey) : undefined} only /></div>

      {work && out === "open" && (
        <form className="card" style={{ padding: 16, marginBottom: 16 }} aria-label="Log activity" onSubmit={(e) => { e.preventDefault(); void run(async () => { const r = logActivity(o, act, s.ctx()); if ("error" in r) { setErr(r.error); return; } await s.apply(r); setAct({ ...act, text: "", followUp: "" }); }); }}>
          <h2 style={{ marginTop: 0 }}>Log activity</h2>
          <div className="row-wrap" style={{ gap: 8, alignItems: "flex-end" }}>
            <label className="doc-field"><span>What happened</span><select className="input" value={act.kind} onChange={(e) => setAct({ ...act, kind: e.target.value as ActivityInput["kind"] })}>{ACTIVITY_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select></label>
            <label className="doc-field" style={{ flex: 1, minWidth: 220 }}><span>Note</span><input className="input" value={act.text} onChange={(e) => setAct({ ...act, text: e.target.value })} /></label>
            <label className="doc-field"><span>Follow up on</span><input className="input" type="date" value={act.followUp || ""} onChange={(e) => setAct({ ...act, followUp: e.target.value })} /></label>
            <button type="submit" className="btn primary" disabled={!act.text.trim()}>Log</button>
          </div>
        </form>
      )}

      <div className="card" style={{ padding: 16 }}>
        <h2 style={{ marginTop: 0 }}>History</h2>
        {history.length ? <ul className="plain">{history.map((a) => {
          const info = TYPE_INFO[a.Type as ActivityType];
          return (
            <li key={String(a.Key)} style={{ marginBottom: 8 }}>
              <span className="chip">{info?.label || String(a.Type)}</span> <strong>{String(a.Title || "")}</strong>
              {a.Summary ? <div>{String(a.Summary)}</div> : null}
              <div className="muted" style={{ fontSize: 12 }}>{fmtDate(String(a.At).slice(0, 10))} · {String(a.Actor || "")}{a.FollowUp ? ` · follow up ${fmtDate(String(a.FollowUp))}` : ""}</div>
            </li>
          );
        })}</ul> : <p className="muted">Nothing logged yet.</p>}
      </div>
    </>
  );
}

// ------------------------------------------------------------------ on the client page

/** The "Opportunities" card on a client: work being sold to them, and a way to start more. */
export function ClientOpportunities({ clientKey }: { clientKey: string }) {
  const s = useSales();
  const { create } = useData();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [err, setErr] = useState<string>();
  const mine = s.opps.filter((o) => o.ClientKey === clientKey);
  const leads = s.leads.filter((l) => l.ClientKey === clientKey);
  if (!s.can("view") || (!mine.length && !s.can("work"))) return null;
  const add = async () => {
    setErr(undefined);
    const r = createOpp({ title, clientKey, stage: s.stages[0].key, owner: s.me }, s.opps, s.ctx());
    if ("error" in r) { setErr(r.error); return; }
    try { await create("Opportunities", r.opp); await create("SalesLog", r.log); await create("Activities", r.activity); setTitle(""); setAdding(false); } catch { setErr("That didn't save. Try again."); }
  };
  return (
    <section className="card" style={{ padding: 16 }} aria-label="Opportunities">
      <div className="row-wrap" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>Opportunities</h2>
        {s.can("work") && !adding && <button type="button" className="btn small" onClick={() => setAdding(true)}>+ New opportunity</button>}
      </div>
      {adding && <div className="row-wrap" style={{ gap: 8, marginTop: 10 }}>
        <input className="input" style={{ maxWidth: 360 }} aria-label="Opportunity name" placeholder="e.g. Payroll services" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        <button type="button" className="btn primary" onClick={add}>Add</button><button type="button" className="btn" onClick={() => setAdding(false)}>Cancel</button></div>}
      {err && <p role="alert" style={{ color: "var(--red-ink)" }}>{err}</p>}
      <OppList opps={mine} />
      <ProposalLinks clientKey={clientKey} opps={mine} />
      {leads.length > 0 && <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>Came in as a lead: {leads.map((l) => <a key={l.Key} href={href("sales", "lead", l.Key)}>{l.Title}</a>)}</p>}
    </section>
  );
}
