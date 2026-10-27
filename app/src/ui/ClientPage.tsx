// The full client page: overview and work tabs, with editable contact and references.
import { XamaClientPanel } from "./XamaClientPanel";
import { CisCard } from "./CisCard";
import { cisStatus } from "../lib/cis";
import { ReactNode, useRef, useState } from "react";
import {
  Client, IMPORTANCE, Importance, Job, KIND_LABEL, holdLabel, importanceLabel, importanceOf, isOnHold, amlLabel, contactName, fmtDate, fmtHours, fmtMoney, jobState, loeLabel, recordGaps, todayIso,
} from "../lib/domain";
import { Row } from "../lib/schema";
import { newKey } from "../lib/planning";
import { ClientBadge, CopyButton, DeadlineChip, ElementsLink, Icon, PapersLink, companiesHouseUrl, href } from "./bits";
import { elementsUrl } from "../lib/elements";
import { nextStagePatch, stageLabel } from "../lib/stages";
import { inFinalise, isWaitStage, stageAt, waitingForClient } from "../lib/waiting";
import { useData, useIndex } from "./data";
import { LogoError, logoSrc, prepareLogo } from "../lib/logo";
import { svcClass } from "../lib/serviceColour";
import { useEditor } from "./Editors";
import { CommsList, NewButtons } from "./Comms";
import { DocumentHistory } from "./DocsCreate";
import { ClientTimeline } from "./Timeline";
import { JobChecklistChip } from "./JobChecklist";
import { MeetingsTable, NewMeetingButtons } from "./Meetings";
import { TaxPaymentsTab } from "./TaxPayments";
import { ClientPortalUsers, IndividualPortalAccess } from "./PortalAdmin";
import { ClientDocuments } from "./PortalDocuments";
import { ClientRequests } from "./PortalRequests";
import { ClientMessages } from "./PortalMessages";
import { ClientOpportunities } from "./SalesPage";
import { ClientEngagements } from "./EngagementsPage";
import { ClientOnboardingCard } from "./OnboardingPage";
import { ClientFees } from "./FeesPanel";
import { SigningRequests } from "./SigningRequests";
import { XeroInvoices } from "./XeroInvoices";
import { ClearanceCard, ClearanceTab } from "./Clearance";
import { AmlCard, AmlTab } from "./AmlTab";
import { TaxRefsCard } from "./TaxRefs";
import { ComplianceExtras, MemosCard } from "./ClientExtras";
import { addDays as addDaysIso } from "../lib/planning";
import { position as amlPosition } from "../lib/amlAssessment";
import { ServicesEditor } from "./ServicesEditor";
import { officerName, pscName } from "../lib/cosecForms";
import { OverviewGrid, OverviewCard, DefaultColumn } from "./OverviewGrid";
import { sectionJobs, waitingOnClient } from "../lib/workGroups";

export function ClientPage({ clientKey, tab }: { clientKey: string; tab: "overview" | "work" | "comms" | "meetings" | "tax" | "activity" | "timeline" | "signing" | "invoices" | "clearance" | "aml" | "portal" }) {
  const idx = useIndex();
  const { data: allData } = useData();
  const commsCount = allData.comms.filter((m) => m.ClientKey === clientKey).length;
  const meetingsCount = allData.meetings.filter((m) => m.ClientKey === clientKey).length;
  const owingCount = allData.taxPayments.filter((p) => p.ClientKey === clientKey && !p.PaidOn && Number(p.Amount) > 0).length;
  const [editingElements, setEditingElements] = useState(false);
  const c = idx.clientByKey.get(clientKey);
  if (!c) {
    return (
      <div className="page">
        <div className="card empty">That client couldn't be found.</div>
      </div>
    );
  }
  const jobs = idx.jobsByClient.get(c.Key) || [];
  const today = todayIso();
  const company = c.Kind === "Ltd" || c.Kind === "LLP";
  const ch = company ? companiesHouseUrl(c.CompanyNumber) : undefined;
  const urgent = jobs.filter((j) => !isOnHold(j) && (j.Priority === "urgent" || jobState(j, today).state === "overdue"));
  const aml = amlLabel(c.XamaStatus);
  const amlPos = amlPosition(c as never, allData.amlAssessments, allData.onboardings, todayIso());
  const amlAlert = amlPos.state === "overdue" || amlPos.state === "soon" || ((amlPos.state === "none" || amlPos.state === "declined" || amlPos.state === "inprogress") && aml.warn);
  const loe = loeLabel(c.LoEStatus);

  return (
    <div className="page client-page">
      <div className="page-head">
        <div className="stack" style={{ gap: 8 }}>
          <div className="row-wrap" style={{ gap: "8px 14px" }}>
            <h1>{c.Title}</h1>
            <LogoPicker client={c} />
          </div>
          <div className="row-wrap" style={{ gap: 6 }}>
            <span className="chip green">{c.Status === "active" || !c.Status ? "Active" : String(c.Status)}</span>
            <span className="chip">{KIND_LABEL[c.Kind || ""] || c.Kind}</span>
            {importanceOf(c) !== "normal" && <span className={`chip ${importanceOf(c) === "key" ? "amber" : ""}`}>{importanceLabel(c)}</span>}
            {c.CompanyNumber && <span className="chip mono">{c.CompanyNumber}<CopyButton value={c.CompanyNumber} label="company number" /></span>}
            {c.YearEnd && <span className="chip">Year end {fmtDate(`2000-${c.YearEnd}`, { year: false })}</span>}
            {c.Incorporated && <span className="chip">Incorporated {fmtDate(c.Incorporated as string)}</span>}
            {(idx.groupsByMember.get(c.Key) || []).map((g) => (
              <span key={g.Key} className="chip blue">{g.Title}</span>
            ))}
          </div>
        </div>
        <div className="row-wrap">
          {ch && <a className="btn" href={ch} target="_blank" rel="noreferrer">Companies House</a>}
          {elementsUrl(c) ? (
            <span className="btn-pair">
              <a className="btn" href={elementsUrl(c)} target="_blank" rel="noreferrer noopener" title="Open this client in Iris Elements">Iris Elements<span aria-hidden="true"> ↗</span><span className="sr-only"> (opens in a new tab)</span></a>
              <button type="button" className="btn iconbtn-sm" aria-label="Edit the Iris Elements link" title="Edit the Iris Elements link" aria-expanded={editingElements} onClick={() => setEditingElements((v) => !v)}><Icon name="cog" size={16} /></button>
            </span>
          ) : (
            <button type="button" className="btn" aria-expanded={editingElements} onClick={() => setEditingElements((v) => !v)}><Icon name="cog" size={16} /> Add Iris Elements link</button>
          )}
          {c.Email && <a className="btn" href={`mailto:${c.Email}`}>Email</a>}
        </div>
      </div>
      {editingElements && <ElementsEditor client={c} onClose={() => setEditingElements(false)} />}

      {(urgent.length > 0 || (tab === "overview" && (amlAlert || loe.warn))) && (
        <section className="alerts" aria-label="Needs attention">
          {urgent.slice(0, 3).map((j) => {
            const st = jobState(j, today);
            return (
              <div key={j.Key} className={`alert ${st.state === "overdue" ? "red" : "amber"}`}>
                <strong>{j.Title}{st.state === "overdue" ? " is late" : ` due in ${st.days} days`}</strong>
                <span>
                  {j.PeriodEnd ? `Period to ${fmtDate(j.PeriodEnd)} · ` : ""}due {fmtDate(j.Deadline)} ·{" "}
                  {j.PlannedDate ? `planned ${fmtDate(j.PlannedDate, { year: false })}` : "not planned"}
                </span>
              </div>
            );
          })}
          {tab === "overview" && amlAlert && (
            <div className={`alert ${amlPos.state === "overdue" ? "" : "amber"}`}><strong>{amlPos.state === "overdue" ? "AML review overdue" : amlPos.state === "soon" ? "AML review due soon" : `AML: ${amlPos.state === "none" ? "no assessment" : amlPos.state === "inprogress" ? "assessment in progress" : "not approved"}`}</strong><a href={href("clients", c.Key, "aml")}>Open AML</a></div>
          )}
          {tab === "overview" && loe.warn && <div className="alert"><strong>Engagement letter: {loe.text.toLowerCase()}</strong></div>}
        </section>
      )}

      {(() => {
        type T = { key: typeof tab; label: string; count?: number };
        const groups: { label: string; tabs: T[] }[] = [
          { label: "Overview", tabs: [{ key: "overview", label: "Overview" }] },
          { label: "Work", tabs: [{ key: "work", label: "Work", count: jobs.length }] },
          { label: "Communication", tabs: [{ key: "timeline", label: "Communication" }, { key: "activity", label: "Activity" }, { key: "comms", label: "Letters and emails", count: commsCount }, { key: "meetings", label: "Meetings", count: meetingsCount }] },
          { label: "Documents", tabs: [{ key: "signing", label: "Signing requests" }, { key: "portal", label: "Portal" }] },
          { label: "Finance", tabs: [{ key: "invoices", label: "Invoices" }, { key: "tax", label: "Tax payments", count: owingCount }] },
          { label: "Compliance", tabs: [{ key: "aml", label: "AML" }, { key: "clearance", label: "Clearance" }] },
        ];
        const to = (k: typeof tab) => (k === "overview" ? href("clients", c.Key) : href("clients", c.Key, k));
        const active = groups.find((g) => g.tabs.some((t) => t.key === tab)) || groups[0];
        const chip = (n?: number) => (n ? <span className="chip" style={{ marginLeft: 4 }}>{n}</span> : null);
        return (
          <>
            <nav className="tabs" aria-label="Client sections">
              {groups.map((g) => {
                const sub = g.tabs.length > 1;
                const count = g.tabs.reduce((n, t) => n + (t.count || 0), 0);
                return <a key={g.label} href={to(g.tabs[0].key)} aria-current={g === active ? "page" : undefined}>{g.label}{g.tabs.length === 1 && g.tabs[0].key === "work" ? chip(jobs.length) : sub ? chip(count) : null}</a>;
              })}
            </nav>
            {active.tabs.length > 1 && (
              <nav className="tabs sub-tabs" aria-label={`${active.label} sections`} style={{ fontSize: 13, marginTop: -8 }}>
                {active.tabs.map((t) => <a key={t.key} href={to(t.key)} aria-current={tab === t.key ? "page" : undefined}>{t.label}{chip(t.count)}</a>)}
              </nav>
            )}
          </>
        );
      })()}

      {tab === "meetings" && (
        <div className="stack">
          <div className="row-wrap" style={{ justifyContent: "space-between" }}>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>Meetings and calls with {c.Title}.</p>
            <NewMeetingButtons clientKey={c.Key} />
          </div>
          <MeetingsTable clientKey={c.Key} />
        </div>
      )}
      {tab === "tax" && <TaxPaymentsTab client={c} />}
      {tab === "activity" && <ClientTimeline client={c} />}
      {tab === "timeline" && <ClientTimeline client={c} mode="comms" />}
      {tab === "signing" && <SigningRequests client={c} />}
      {tab === "invoices" && <XeroInvoices client={c} />}
      {tab === "clearance" && <ClearanceTab client={c} />}
      {tab === "aml" && <AmlTab client={c} />}
      {tab === "portal" && <div className="stack"><ClientPortalUsers client={c} /><ClientMessages client={c} /><ClientRequests client={c} /><ClientDocuments client={c} /></div>}
      {tab === "meetings" || tab === "tax" || tab === "activity" || tab === "timeline" || tab === "signing" || tab === "invoices" || tab === "clearance" || tab === "aml" || tab === "portal" ? null : tab === "overview" ? <Overview client={c} jobs={jobs} /> : tab === "work" ? <WorkTab client={c} jobs={jobs} /> : (
        <div className="stack">
          <div className="row-wrap" style={{ justifyContent: "space-between" }}>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>Letters and emails to {c.Title}, newest first.</p>
            <NewButtons clientKey={c.Key} />
          </div>
          <CommsList clientKey={c.Key} />
          <div className="row-wrap" style={{ justifyContent: "space-between" }}>
            <h3 style={{ margin: 0 }}>Documents</h3>
            <a className="btn small" href={`#/comms/documents?client=${encodeURIComponent(c.Key)}`}>New document</a>
          </div>
          <DocumentHistory clientKey={c.Key} />
        </div>
      )}
    </div>
  );
}

function Overview({ client: c, jobs }: { client: Client; jobs: Job[] }) {
  const { data } = useData();
  const idx = useIndex();
  const gaps = recordGaps(c, idx.servicesByClient.get(c.Key) || new Set());
  const company = c.Kind === "Ltd" || c.Kind === "LLP";
  const today = todayIso();

  // Each card is its own piece, so the user can move and resize them (see OverviewGrid). Standard layout: three
  // columns that each answer one question at a glance: the work and money, who and what the client is, and
  // compliance and sales.
  const cards: OverviewCard[] = [
    { id: "work", label: "Open work", node: (
    <section className="card" aria-labelledby="work-h">
      <div className="card-head">
        <h2 id="work-h">Open work</h2>
        <a href={href("clients", c.Key, "work")} style={{ fontSize: 13 }}>Stages and history</a>
      </div>
      {jobs.length ? (
        <div className="table-wrap">
          <table className="grid" style={{ minWidth: 640 }}>
            <thead>
              <tr><th scope="col">Job</th><th scope="col">Stage</th><th scope="col">Planned</th><th scope="col">Deadline</th></tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.Key}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{j.Title}</div>
                    <div className="cell-sub">{j.PeriodEnd ? `Period to ${fmtDate(j.PeriodEnd)}` : ""}</div>
                  </td>
                  <td>{j.StageName || "—"}</td>
                  <td>{j.PlannedDate ? fmtDate(j.PlannedDate, { weekday: true }) : <span className="chip dashed">Not planned</span>}</td>
                  <td>
                    <div className="row-wrap" style={{ gap: 6 }}>
                      <span className="mono">{fmtDate(j.Deadline)}</span>
                      <DeadlineChip job={j} today={today} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty">No open work.</div>
      )}
    </section>
    ) },
    ...(gaps.length > 0 ? [{ id: "gaps", label: "Missing details", node: (
      <div className="alert amber">
        <strong>Missing from this record</strong>
        <span>{gaps.join(", ")}. Add them under References or Contact.</span>
      </div>
    ) }] : []),
    { id: "services", label: "Services and fees", node: <ServicesCard client={c} jobs={jobs} /> },
    { id: "fees", label: "Fee schedule", node: <ClientFees client={c} /> },
    ...(c.Kind === "Individual" ? [{ id: "portal", label: "Portal access", node: <IndividualPortalAccess client={c} /> }] : []),
    { id: "profile", label: "Company profile", node: <ProfileCard client={c} /> },
    ...(company ? [{ id: "people", label: "Directors and people", node: <PeopleCard client={c} /> }] : []),
    { id: "contact", label: "Contact", node: (
    <EditableCard
      title="Contact"
      client={c}
      fields={[
        ["ContactFirst", "First name"], ["ContactLast", "Last name"], ["ContactPreferred", "Preferred name"],
        ["Email", "Email"], ["Mobile", "Mobile"], ["Phone", "Phone"], ["ContactPreference", "Prefers"],
      ]}
      render={() => (
        <>
          <div>
            <div style={{ fontWeight: 600 }}>{contactName(c) || "—"}</div>
            {c.ContactPreference && <div className="muted" style={{ fontSize: 13 }}>Prefers {String(c.ContactPreference).toLowerCase()}</div>}
          </div>
          <div className="kv"><span>Email</span><span>{c.Email ? <a href={`mailto:${c.Email}`}>{c.Email}</a> : "—"}</span></div>
          <div className="kv"><span>Mobile</span><span className="mono">{(c.Mobile as string) || "—"}</span></div>
          {c.Phone && <div className="kv"><span>Phone</span><span className="mono">{c.Phone as string}</span></div>}
        </>
      )}
    />
    ) },
    { id: "refs", label: "Tax references", node: <TaxRefsCard client={c} /> },
    { id: "addresses", label: "Addresses", node: <AddressesCard client={c} /> },
    { id: "team", label: "Team", node: (
    <section className="card pad stack" aria-labelledby="team-h">
      <h2 id="team-h">Team</h2>
      <ImportanceRow client={c} />
      <div className="kv"><span>Partner</span><span>{(c.Partner as string) || "—"}</span></div>
      <div className="kv"><span>Manager</span><span>{(c.Manager as string) || "—"}</span></div>
      {c.Engaged && <div className="kv"><span>Client since</span><span>{fmtDate(c.Engaged as string)}</span></div>}
    </section>
    ) },
    { id: "compliance", label: "Compliance", node: (
    <section className="card pad stack" aria-labelledby="comp-h">
      <h2 id="comp-h">Compliance</h2>
      <ComplianceExtras client={c} />
      <div className="kv"><span>Engagement letter</span><span style={loeLabel(c.LoEStatus).warn ? { color: "var(--amber-ink)", fontWeight: 600 } : undefined}>{loeLabel(c.LoEStatus).text}</span></div>
      {c.RetentionYears ? <div className="kv"><span>Data kept after leaving</span><span>{c.RetentionYears} years</span></div> : null}
    </section>
    ) },
    { id: "sales", label: "Opportunities", node: (<><ClientOpportunities clientKey={c.Key} /><ClientOnboardingCard clientKey={c.Key} /></>) },
    { id: "letters", label: "Engagement letters", node: <ClientEngagements clientKey={c.Key} /> },
    { id: "aml", label: "AML", node: <AmlCard client={c} /> },
    { id: "memos", label: "Memos", node: <MemosCard client={c} /> },
    { id: "clearance", label: "Professional clearance", node: <ClearanceCard client={c} openHref={href("clients", c.Key, "clearance")} /> },
    { id: "cis", label: "CIS", node: (
    <CisCard client={c} hasCisWork={jobs.some((j) => j.ServiceKey === "CIS")} />
    ) },
  ];
  return <OverviewGrid cards={cards} columns={STANDARD_COLUMNS} name="the overview" store="overview" />;
}

const STANDARD_COLUMNS: DefaultColumn[] = [
  { w: 30, ids: ["work", "gaps", "services", "fees"] },
  { w: 15, ids: ["profile", "portal", "contact", "refs", "addresses", "team"] },
  { w: 15, ids: ["people", "compliance", "aml", "sales", "letters", "clearance", "memos", "cis"] },
];

/** Key, normal or low-touch: how much this client matters when the planner decides what comes first. */
function ImportanceRow({ client: c }: { client: Client }) {
  const { update } = useData();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const now = importanceOf(c);
  const set = async (v: Importance) => {
    if (v === now) return;
    setBusy(true);
    setFailed(false);
    try {
      await update("Clients", c, { Importance: v === "normal" ? "" : v });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="kv" style={{ alignItems: "center" }}>
      <span>Importance</span>
      <span className="row-wrap" style={{ gap: 6 }}>
        <span className="seg" role="group" aria-label="How important this client is" style={{ maxWidth: "100%" }}>
          {IMPORTANCE.map(([k, label]) => (
            <button key={k} type="button" aria-pressed={now === k} disabled={busy} onClick={() => set(k)}>{label}</button>
          ))}
        </span>
        {failed && <span className="error-text" role="alert">Couldn't save</span>}
      </span>
    </div>
  );
}

/** The facts that identify the client: type, status, dates, nature of business, who it is registered as. */
function ProfileCard({ client: c }: { client: Client }) {
  const company = c.Kind === "Ltd" || c.Kind === "LLP";
  const row = (label: string, v: ReactNode) => <div className="kv" key={label}><span>{label}</span><span>{v || "—"}</span></div>;
  const status = String(c.Status || "active");
  return (
    <section className="card pad stack" aria-labelledby="prof-h">
      <h2 id="prof-h">Company profile</h2>
      {row("Type", KIND_LABEL[c.Kind as string] || (c.Kind as string))}
      {row("Status", <span style={{ textTransform: "capitalize" }}>{status}</span>)}
      {c.TradingName ? row("Trading as", c.TradingName as string) : null}
      {company && row("Incorporated", c.Incorporated ? fmtDate(c.Incorporated as string) : "")}
      {row("Client since", c.Engaged ? fmtDate(c.Engaged as string) : "")}
      {row("Year end", c.YearEnd as string)}
      {company && row("Companies House", c.CompanyNumber ? <a href={companiesHouseUrl(String(c.CompanyNumber))} target="_blank" rel="noreferrer">{String(c.CompanyNumber)}</a> : "")}
      {row("Nature of business", [c.SIC, c.BusinessActivity].filter(Boolean).join(" · "))}
      {c.Website ? row("Website", <a href={String(c.Website).startsWith("http") ? String(c.Website) : `https://${c.Website}`} target="_blank" rel="noreferrer">{String(c.Website)}</a>) : null}
    </section>
  );
}

/** Current directors, secretaries and people with significant control, from the Co Sec registers. */
function PeopleCard({ client: c }: { client: Client }) {
  const { data } = useData();
  const officers = data.cosecOfficers.filter((o) => o.ClientKey === c.Key && o.Status === "current");
  const pscs = data.cosecPscs.filter((p) => p.ClientKey === c.Key && p.Status === "current");
  return (
    <section className="card pad stack" aria-labelledby="ppl-h">
      <div className="card-head" style={{ padding: 0 }}>
        <h2 id="ppl-h">Directors and people</h2>
        <a href={href("cosec", "company", c.Key as string)} style={{ fontSize: 13 }}>Co Sec</a>
      </div>
      {officers.length === 0 && pscs.length === 0 ? <div className="empty">None recorded. Import them in Co Sec.</div> : (
        <>
          {officers.map((o) => (
            <div className="kv" key={String(o.Key)}>
              <span>{officerName(o)}</span>
              <span>{String(o.Role || "Director")}{o.AppointedOn ? <span className="muted"> · since {fmtDate(String(o.AppointedOn))}</span> : null}</span>
            </div>
          ))}
          {pscs.length > 0 && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Significant control</div>}
          {pscs.map((p) => (
            <div className="kv" key={String(p.Key)}>
              <span>{pscName(p)}</span>
              <span className="muted">{String(p.Natures || "").split("\n")[0] || "PSC"}</span>
            </div>
          ))}
        </>
      )}
    </section>
  );
}

function AddressesCard({ client: c }: { client: Client }) {
  const company = c.Kind === "Ltd" || c.Kind === "LLP";
  const fields: [string, string][] = [...(company ? ([["RegisteredOffice", "Registered office"]] as [string, string][]) : []), ["TradingAddress", "Trading address"], ["HomeAddress", "Home address"]];
  return (
    <EditableCard
      title="Addresses"
      client={c}
      fields={fields}
      render={(fs) => {
        // show what is held (including a registered office on a non-company record); empty ones show a dash
        const held = fs.filter(([k]) => c[k]);
        const shown = held.length ? held : fs;
        return <>{shown.map(([k, label]) => (
          <div key={k}><div className="muted" style={{ fontSize: 12 }}>{label}</div><div>{(c[k] as string) || "—"}</div></div>
        ))}</>;
      }}
    />
  );
}

/** A sidebar card that shows values and switches to a form; Save writes straight to SharePoint. */
function EditableCard({
  title, client, fields, render,
}: {
  title: string; client: Client; fields: [string, string][]; render: (fields: [string, string][]) => ReactNode;
}) {
  const { update } = useData();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const id = `${title.toLowerCase()}-h`;

  const start = () => {
    setDraft(Object.fromEntries(fields.map(([k]) => [k, (client[k] as string) || ""])));
    setError(undefined);
    setEditing(true);
  };
  const saveIt = async () => {
    const patch: Row = {};
    for (const [k] of fields) {
      const v = (draft[k] || "").trim();
      if (v !== ((client[k] as string) || "")) patch[k] = v;
    }
    if (!Object.keys(patch).length) return setEditing(false);
    setBusy(true);
    try {
      await update("Clients", client, patch);
      setEditing(false);
    } catch {
      setError("Couldn't save. Your changes are still here; try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card pad stack" aria-labelledby={id}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h2 id={id}>{title}</h2>
        {!editing && <button type="button" className="linkbtn" onClick={start}>Edit</button>}
      </div>
      {editing ? (
        <>
          <div className="form" style={{ gridTemplateColumns: "1fr" }}>
            {fields.map(([k, label]) => (
              <label key={k}>
                {label}
                <input className="input" value={draft[k] || ""} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
              </label>
            ))}
          </div>
          {error && <p className="error-text" role="alert">{error}</p>}
          <div className="form-actions">
            <button type="button" className="btn" onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
            <button type="button" className="btn primary" onClick={saveIt} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
          </div>
        </>
      ) : (
        render(fields)
      )}
    </section>
  );
}

function WorkTab({ client: c, jobs }: { client: Client; jobs: Job[] }) {
  const { data } = useData();
  const idx = useIndex();
  const { open } = useEditor();
  const today = todayIso();
  const tasks = idx.tasksByClient.get(c.Key) || [];
  // finished work: imported history plus jobs completed in Practice Planner
  const history = [
    ...data.history.filter((h) => h.ClientKey === c.Key).map((h) => ({
      key: h.Key as string, title: (h.ServiceKey !== "TASK" && idx.serviceName.get(h.ServiceKey as string)) || (h.Title as string),
      date: h.Completed as string | undefined,
    })),
    ...data.jobs.filter((j) => j.ClientKey === c.Key && j.Status === "Complete").map((j) => ({
      key: j.Key, title: j.Title, date: j.CompletedDate,
    })),
    ...data.tasks.filter((t) => t.ClientKey === c.Key && t.Status === "Done").map((t) => ({
      key: t.Key, title: t.Title, date: t.CompletedDate,
    })),
  ].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));

  const [due, setDue] = useState<"all" | "overdue" | "30" | "90">("all");
  const inWindow = (j: Job) => due === "all" || (!!j.Deadline && (due === "overdue" ? String(j.Deadline) < today : String(j.Deadline) <= addDaysIso(today, Number(due))));
  const shownJobs = jobs.filter(inWindow);
  const sections = sectionJobs(shownJobs, data.services, (k) => idx.serviceName.get(k) || k);
  const waiting = waitingOnClient(jobs, (j) => data.stageTemplates.filter((t) => t.ServiceKey === j.ServiceKey));
  const upcoming = jobs.filter((j) => j.Deadline).sort((a, b) => String(a.Deadline).localeCompare(String(b.Deadline))).slice(0, 8);
  const buttons = (
    <span className="row-wrap" style={{ gap: 8 }}>
      <button type="button" className="btn small" onClick={() => open({ kind: "task", clientKey: c.Key })}>+ Task</button>
      <button type="button" className="btn small" onClick={() => open({ kind: "newJob", clientKey: c.Key })}>+ Job</button>
    </span>
  );
  const section = (title: string, list: Job[], first: boolean) => (
    <section className="wk-section" aria-label={title}>
      <div className="wk-head"><h2>{title} <span className="chip">{list.length}</span></h2>{first && buttons}</div>
      <div className="wk-grid">{list.map((j) => <div key={j.Key} className="wk-cell"><JobCard job={j} /></div>)}</div>
    </section>
  );
  const none = !sections.statutory.length && !sections.other.length;

  return (
    <div className="wk-layout">
      <div className="wk-main">
        {jobs.length > 1 && (
          <div className="row-wrap" role="group" aria-label="Show work due" style={{ gap: 6 }}>
            {([["all", "All work"], ["overdue", "Overdue"], ["30", "Due in 30 days"], ["90", "Due in 90 days"]] as const).map(([k, label]) => <button key={k} type="button" className={`chip-btn${due === k ? " on" : ""}`} aria-pressed={due === k} onClick={() => setDue(k)}>{label}</button>)}
          </div>
        )}
        {none && <div className="wk-head"><h2>Work</h2>{buttons}</div>}
        {none && <div className="card empty">{jobs.length && due !== "all" ? "No work matches this filter." : "No open work for this client."}</div>}
        {sections.statutory.length > 0 && section("Statutory work", sections.statutory, true)}
        {sections.other.length > 0 && section("Other services", sections.other, !sections.statutory.length)}
      </div>

      <aside className="wk-summary" aria-label="Work summary">
        <h2 className="wk-sum-title">Work summary</h2>
        <section className="card pad stack wk-card" aria-labelledby="up-h">
          <h3 id="up-h">Upcoming work</h3>
          {upcoming.length ? (
            <ol className="wk-list">
              {upcoming.map((j) => (
                <li key={j.Key}>
                  <span className="mono" style={{ color: jobState(j, today).state === "ok" ? "var(--muted)" : "var(--amber-ink)" }}>{fmtDate(j.Deadline)}</span>
                  <span>{j.Title}</span>
                </li>
              ))}
            </ol>
          ) : <p className="muted" style={{ margin: 0 }}>Nothing coming up.</p>}
        </section>
        <section className="card pad stack wk-card" aria-labelledby="done-h">
          <h3 id="done-h">Completed work</h3>
          {history.length ? (
            <>
              <ol className="wk-list">
                {history.slice(0, 5).map((h) => (
                  <li key={h.key}><span className="mono muted">{h.date ? fmtDate(h.date) : "closed"}</span><span>{h.title}</span></li>
                ))}
              </ol>
              {history.length > 5 && (
                <details>
                  <summary>{history.length - 5} earlier</summary>
                  <ol className="wk-list" style={{ marginTop: 6 }}>
                    {history.slice(5, 30).map((h) => (
                      <li key={h.key}><span className="mono muted">{h.date ? fmtDate(h.date) : "closed"}</span><span>{h.title}</span></li>
                    ))}
                  </ol>
                </details>
              )}
            </>
          ) : <p className="muted" style={{ margin: 0 }}>Nothing yet.</p>}
        </section>
        <section className="card pad stack wk-card" aria-labelledby="tasks-h">
          <h3 id="tasks-h">Open tasks</h3>
          {tasks.length ? (
            <ul className="wk-list tasks">
              {tasks.map((t) => (
                <li key={t.Key}>
                  <button type="button" className="task-row" onClick={() => open({ kind: "task", key: t.Key })}>
                    <span style={{ fontWeight: 600 }}>{t.Title}{isOnHold(t) && <span className="chip hold" style={{ marginLeft: 6 }}>{holdLabel(t)}</span>}</span>
                    <span className="muted" style={{ fontSize: 12 }}>
                      {t.Type}{isOnHold(t) ? (t.HoldReason ? ` · ${t.HoldReason}` : "") : t.PlannedDate ? ` · planned ${fmtDate(t.PlannedDate, { weekday: true, year: false })}` : " · not planned"}
                      {t.DueDate ? ` · due ${fmtDate(t.DueDate, { year: false })}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="muted" style={{ margin: 0 }}>No open tasks.</p>}
        </section>
        <section className="card pad stack wk-card" aria-labelledby="wait-h">
          <h3 id="wait-h">Waiting on client</h3>
          {waiting.length ? (
            <ul className="wk-list tasks">
              {waiting.map((w) => (
                <li key={String(w.job.Key)}>
                  <button type="button" className="task-row" onClick={() => open({ kind: "job", key: String(w.job.Key) })}>
                    <span style={{ fontWeight: 600 }}>{w.job.Title}</span>
                    <span className="muted" style={{ fontSize: 12 }}>
                      {w.reason}{w.since ? ` since ${fmtDate(w.since, { year: false })}` : ""}{w.chaseOn ? ` · ${w.reason.startsWith("Records") ? "expected" : "chase on"} ${fmtDate(w.chaseOn, { year: false })}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="muted" style={{ margin: 0 }}>Nothing waiting on the client.</p>}
        </section>
      </aside>
    </div>
  );
}

function JobCard({ job: j }: { job: Job }) {
  const { data, update } = useData();
  const [saving, setSaving] = useState(false);
  const { open } = useEditor();
  const today = todayIso();
  const st = jobState(j, today);
  const templates = data.stageTemplates
    .filter((s) => s.ServiceKey === j.ServiceKey)
    .sort((a, b) => (a.StageNo as number) - (b.StageNo as number));
  const mine = new Map(
    data.clientStages.filter((s) => s.ClientKey === j.ClientKey && s.ServiceKey === j.ServiceKey).map((s) => [s.StageNo as number, s]),
  );
  const current = Math.min(j.StageNo || 1, Math.max(templates.length, 1));
  const last = current >= templates.length;
  const stageDone = async () => {
    // the last stage, or handing it to the client: that's done in the job's panel, which asks the questions
    if (last || (isWaitStage(stageAt(templates, current + 1)) && !inFinalise(j))) return open({ kind: "job", key: j.Key });
    const patch = nextStagePatch(j, templates, today);
    if (!patch) return;
    setSaving(true);
    try {
      await update("Jobs", j, patch);
    } finally {
      setSaving(false);
    }
  };
  const idx = useIndex();
  const client = idx.clientByKey.get(j.ClientKey);

  return (
    <article className={`job ${svcClass(j.ServiceKey)}${isOnHold(j) ? " held" : st.state === "overdue" ? " late" : st.state === "tight" ? " warn" : ""}`} aria-label={j.Title}>
      <div className="job-head">
        <div className="stack" style={{ gap: 4, minWidth: 0 }}>
          <h2>{j.Title}</h2>
          <div className="row-wrap" style={{ gap: 4 }}>
            {j.Priority === "urgent" && <span className="chip red">Urgent</span>}
            {isOnHold(j) && <span className="chip hold">{holdLabel(j)}</span>}
            {waitingForClient(j, templates) && <span className="chip wait">With the client{j.SpeakOn ? ` · speaking ${fmtDate(j.SpeakOn as string, { year: false })}` : ""}</span>}
            {inFinalise(j) && !waitingForClient(j, templates) && <span className="chip wait">Ready to finalise</span>}
            <ElementsLink client={client} />
            <PapersLink job={j} />
            <JobChecklistChip jobKey={j.Key} />
            {idx.servicesOff.has(`${j.ClientKey}|${j.ServiceKey}`) && <span className="chip hold" title="Complete it yourself; no next job will be created">Service turned off</span>}
          </div>
          {(j.CardNote as string) && <span className="pcard-note" style={{ alignSelf: "flex-start" }}>{j.CardNote as string}</span>}
          {isOnHold(j) && (
            <span style={{ fontSize: 12 }}>
              {(j.HoldReason as string) || holdLabel(j)}
              {j.HoldUntil ? <span className="muted"> · {j.HoldKind ? "chase" : "look again"} {fmtDate(j.HoldUntil as string, { year: false })}</span> : null}
            </span>
          )}
        </div>
        <button type="button" className="btn small" onClick={() => open({ kind: "job", key: j.Key })} title="Open the job: records, hours, notes and everything else">Update job</button>
      </div>
      <div className="job-dates">
        <div><div className="label">Period</div><div className="value mono">{j.PeriodEnd ? fmtDate(j.PeriodEnd) : "—"}</div></div>
        <div><div className="label">Deadline</div><div className="value mono" title={j.DeadlineSource ? `Deadline from ${j.DeadlineSource}` : undefined} style={st.state !== "ok" ? { color: st.state === "overdue" ? "var(--red-ink)" : "var(--amber-ink)" } : undefined}>{fmtDate(j.Deadline) || "—"}</div></div>
        <div><div className="label">Planned</div><div className="value" style={j.PlannedDate ? { color: "var(--blue-ink)" } : undefined}>{j.PlannedDate ? fmtDate(j.PlannedDate, { weekday: true }) : "Not yet"}</div></div>
      </div>
      {templates.length > 0 && (
        <div className="job-stages">
          <div className="track" style={{ gridTemplateColumns: `repeat(${templates.length}, minmax(0, 1fr))` }} aria-hidden="true">
            {templates.map((t) => (
              <span key={t.Key} className={(t.StageNo as number) < current ? "done" : (t.StageNo as number) === current ? "now" : ""} />
            ))}
          </div>
          <div className="row-wrap" style={{ justifyContent: "space-between", fontSize: 13 }}>
            <span><strong>Stage {current} of {templates.length}:</strong> {stageLabel(j, templates)}</span>
            <span className="row-wrap" style={{ gap: 10 }}>
              <button type="button" className="btn small" onClick={stageDone} disabled={saving}>
                <Icon name="check" size={14} />{last ? "Finish job…" : "Stage done"}
              </button>
            </span>
          </div>
          <details>
            <summary>All stages</summary>
            <div className="table-wrap" style={{ marginTop: 8, background: "var(--surface)", border: "1px solid var(--line-2)", borderRadius: 8 }}>
              <table className="grid" style={{ minWidth: 520 }}>
                <thead><tr><th scope="col">#</th><th scope="col">Stage</th><th scope="col">Who</th><th scope="col">Budget</th></tr></thead>
                <tbody>
                  {templates.map((t) => {
                    const s = mine.get(t.StageNo as number);
                    return (
                      <tr key={t.Key}>
                        <td className="mono muted">{t.StageNo}</td>
                        <td>
                          {(t.StageNo as number) === current ? <strong style={{ color: "var(--blue-ink)" }}>{t.Title}</strong> : t.Title}
                          {s?.BillingPoint ? <span className="chip" style={{ marginLeft: 6 }}>Invoice</span> : null}
                        </td>
                        <td>{(s?.Who as string) || "—"}</td>
                        <td className="mono">{fmtHours(s?.BudgetHours as number) || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}
    </article>
  );
}

/** The client's logo, with Add / Change / Remove. Drop an image on it, or pick a file. */
function LogoPicker({ client: c }: { client: Client }) {
  const { update } = useData();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [over, setOver] = useState(false);
  const logo = logoSrc(c);

  const use = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setError(undefined);
    try {
      const data = await prepareLogo(file);
      await update("Clients", c, { LogoData: data });
    } catch (e) {
      setError(e instanceof LogoError ? e.message : "Couldn't save the logo. Try again.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  const remove = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await update("Clients", c, { LogoData: "", LogoUrl: "" });
    } catch {
      setError("Couldn't remove the logo. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`logo-picker${over ? " over" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); void use(e.dataTransfer.files?.[0]); }}
    >
      {logo ? (
        <span className="logo-box"><img src={logo} alt={`${c.Title} logo`} /></span>
      ) : (
        <ClientBadge client={c} size="lg" />
      )}
      <span className="logo-actions">
        <button type="button" className="linkbtn" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? "Saving…" : logo ? "Change logo" : "Add logo"}
        </button>
        {logo && !busy && <button type="button" className="linkbtn muted-link" onClick={remove}>Remove</button>}
      </span>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif" hidden
        aria-label={`Choose a logo for ${c.Title}`} onChange={(e) => void use(e.target.files?.[0])} />
      {error && <span className="error-text" role="alert" style={{ flexBasis: "100%" }}>{error}</span>}
    </div>
  );
}

/** Edit box for the client's Elements link (opened from the cog beside the Iris Elements button). It flows through to all their jobs. */
function ElementsEditor({ client: c, onClose }: { client: Client; onClose: () => void }) {
  const { update } = useData();
  const [draft, setDraft] = useState(String(c.ElementsLink || ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const saveIt = async () => {
    const v = draft.trim();
    if (v && !/^https:\/\/\S+$/i.test(v)) return setError("That should be a full web address starting https://");
    setBusy(true);
    try {
      if (v !== String(c.ElementsLink || "")) await update("Clients", c, { ElementsLink: v });
      onClose();
    } catch {
      setError("Couldn't save. Your change is still here; try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="row-wrap" style={{ gap: 10 }}>
      <span className="elements-edit">
        <label className="sr-only" htmlFor="elements-link-input">Elements link for {c.Title}</label>
        <input id="elements-link-input" className="input" value={draft} placeholder="https://elements.iris.co.uk/…" autoFocus
          onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void saveIt(); if (e.key === "Escape") onClose(); }} />
        <button type="button" className="btn small primary" onClick={saveIt} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        <button type="button" className="btn small" onClick={onClose} disabled={busy}>Cancel</button>
        {error && <span className="error-text" role="alert">{error}</span>}
      </span>
    </div>
  );
}

/** The work you do for this client, each with an on/off switch. Off keeps the open job but creates no next one. */
function ServicesCard({ client: c, jobs }: { client: Client; jobs: Job[] }) {
  const { data, update, create } = useData();
  const idx = useIndex();
  const { open } = useEditor();
  const [asking, setAsking] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [turnedOn, setTurnedOn] = useState<string>();
  const [editingAll, setEditingAll] = useState(false);
  const [saved, setSaved] = useState<string>();
  const today = todayIso();
  const rows = data.clientServices.filter((s) => s.ClientKey === c.Key);
  // every service this client has: recorded ones, and any that only have an open job
  const keys = [...new Set([...rows.map((r) => String(r.ServiceKey)), ...jobs.map((j) => j.ServiceKey || "").filter(Boolean)])]
    .sort((a, b) => (idx.serviceName.get(a) || a).localeCompare(idx.serviceName.get(b) || b));
  const name = (k: string) => idx.serviceName.get(k) || k;

  const setOff = async (serviceKey: string, off: boolean) => {
    setBusy(serviceKey);
    setError(undefined);
    try {
      const row = rows.find((r) => r.ServiceKey === serviceKey);
      if (row) await update("ClientServices", row, { Off: off, OffSince: off ? today : "" });
      else await create("ClientServices", { Key: newKey("CS"), ClientKey: c.Key, ServiceKey: serviceKey, Off: off, OffSince: off ? today : undefined });
      setAsking(undefined);
      setTurnedOn(off ? undefined : serviceKey);
    } catch {
      setError("Couldn't save that. Nothing has changed; try again.");
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <section className="card" aria-labelledby="svc-h">
      <div className="card-head"><h2 id="svc-h">Services and fees</h2>
        <span className="row-wrap" style={{ gap: 10 }}>
          {c.AnnualFees ? <span className="mono">{fmtMoney(c.AnnualFees)} a year</span> : null}
          {!editingAll && <button type="button" className="btn small" onClick={() => { setEditingAll(true); setSaved(undefined); }}>Edit services and fees</button>}
        </span>
      </div>
      {saved && <p role="status" className="muted" style={{ margin: 0, padding: "0 16px 8px" }}>{saved}</p>}
      {editingAll && <div style={{ padding: "0 12px 12px" }}><ServicesEditor client={c} onClose={() => setEditingAll(false)} onSaved={setSaved} /></div>}
      {keys.length ? (
        <div className="table-wrap">
          <table className="grid">
            <thead><tr><th scope="col">Service</th><th scope="col">Fee</th><th scope="col">Next deadline</th><th scope="col">Internal</th><th scope="col">Stage</th><th scope="col">Records</th><th scope="col">We do this</th></tr></thead>
            <tbody>
              {keys.map((k) => {
                const s = rows.find((r) => r.ServiceKey === k);
                const off = idx.servicesOff.has(`${c.Key}|${k}`);
                const openJob = jobs.find((j) => j.ServiceKey === k);
                return (
                  <tr key={k} className={off ? "svc-off" : undefined}>
                    <td>
                      {name(k)}
                      {off && <div className="cell-sub">Turned off{s?.OffSince ? ` ${fmtDate(String(s.OffSince))}` : ""}{openJob ? ": complete the open job yourself" : ""}</div>}
                    </td>
                    <td className="mono">
                      {s?.Fee ? `${fmtMoney(s.Fee as number)} ${s.FeePeriod || ""}` : <span className="muted">In package</span>}
                    </td>
                    <td className="mono">{fmtDate((openJob?.Deadline as string) || (s?.NextDeadline as string)) || "—"}</td>
                    <td className="mono">{openJob?.InternalDeadline ? fmtDate(openJob.InternalDeadline as string) : "—"}</td>
                    <td>
                      {openJob ? (() => {
                        const total = data.stageTemplates.filter((t) => t.ServiceKey === k).length;
                        const left = total ? Math.max(0, total - Number(openJob.StageNo || 1)) : 0;
                        return <>{openJob.StageName || "—"}{total ? <div className="cell-sub">{left} {left === 1 ? "stage" : "stages"} to go</div> : null}</>;
                      })() : <span className="muted">—</span>}
                    </td>
                    <td>{openJob ? (openJob.RecordsReceived ? `Received ${fmtDate(openJob.RecordsReceived as string)}` : openJob.RecordsExpected ? `Expected ${fmtDate(openJob.RecordsExpected as string)}` : "Not set") : <span className="muted">—</span>}</td>
                    <td>
                      {asking === k ? (
                        <div className="stack" style={{ gap: 6, maxWidth: 260 }}>
                          <span style={{ fontSize: 12 }}>
                            Stop {name(k).toLowerCase()} for {c.Title}?{" "}
                            {openJob ? "The open job stays until you complete it; no next one will be created." : "No new jobs will be created."}
                          </span>
                          <span className="row-wrap" style={{ gap: 6 }}>
                            <button type="button" className="btn small primary" disabled={busy === k} onClick={() => void setOff(k, true)}>{busy === k ? "Saving…" : "Turn off"}</button>
                            <button type="button" className="btn small" onClick={() => setAsking(undefined)}>Keep</button>
                          </span>
                        </div>
                      ) : (
                        <button type="button" role="switch" aria-checked={!off} aria-label={`${name(k)}: we ${off ? "don't do" : "do"} this`} className={`switch${off ? "" : " on"}`}
                          disabled={busy === k} onClick={() => (off ? void setOff(k, false) : setAsking(k))}>
                          <span aria-hidden="true" />
                          <span className="switch-text">{off ? "Off" : "On"}</span>
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty">No services recorded.</div>
      )}
      {turnedOn && (
        <p className="muted" style={{ margin: 0, padding: "0 16px 14px", fontSize: 13 }}>
          {name(turnedOn)} is back on. Jobs are created when the next one is completed, so{" "}
          {jobs.some((j) => j.ServiceKey === turnedOn) ? "the open job will roll on as normal." : (
            <button type="button" className="linkbtn" style={{ minHeight: 0, padding: 0 }} onClick={() => open({ kind: "newJob", clientKey: c.Key })}>add the next job now</button>
          )}.
        </p>
      )}
      {error && <p className="error-text" role="alert" style={{ padding: "0 16px 12px" }}>{error}</p>}
    </section>
  );
}
