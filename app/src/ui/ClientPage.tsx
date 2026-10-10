// The full client page: overview and work tabs, with editable contact and references.
import { ReactNode, useRef, useState } from "react";
import {
  Client, Job, KIND_LABEL, isOnHold, amlLabel, contactName, fmtDate, fmtHours, fmtMoney, jobState, loeLabel, recordGaps, todayIso,
} from "../lib/domain";
import { Row } from "../lib/schema";
import { jobHours } from "../lib/planning";
import { ClientBadge, DeadlineChip, companiesHouseUrl, href } from "./bits";
import { useData, useIndex } from "./data";
import { chaseSummary } from "../lib/chase";
import { LogoError, logoSrc, prepareLogo } from "../lib/logo";
import { svcClass } from "../lib/serviceColour";
import { useEditor } from "./Editors";

export function ClientPage({ clientKey, tab }: { clientKey: string; tab: "overview" | "work" }) {
  const idx = useIndex();
  const c = idx.clientByKey.get(clientKey);
  if (!c) {
    return (
      <div className="page">
        <a className="crumb" href="#/clients">Clients</a>
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
  const loe = loeLabel(c.LoEStatus);

  return (
    <div className="page">
      <div className="page-head">
        <div className="stack" style={{ gap: 8 }}>
          <a className="crumb" href="#/clients">Clients</a>
          <div className="row-wrap" style={{ gap: "8px 14px" }}>
            <h1>{c.Title}</h1>
            <LogoPicker client={c} />
          </div>
          <div className="row-wrap" style={{ gap: 6 }}>
            <span className="chip green">{c.Status === "active" || !c.Status ? "Active" : String(c.Status)}</span>
            <span className="chip">{KIND_LABEL[c.Kind || ""] || c.Kind}</span>
            {c.CompanyNumber && <span className="chip mono">{c.CompanyNumber}</span>}
            {c.YearEnd && <span className="chip">Year end {fmtDate(`2000-${c.YearEnd}`, { year: false })}</span>}
            {c.Incorporated && <span className="chip">Incorporated {fmtDate(c.Incorporated as string)}</span>}
            {(idx.groupsByMember.get(c.Key) || []).map((g) => (
              <span key={g.Key} className="chip blue">{g.Title}</span>
            ))}
          </div>
        </div>
        <div className="row-wrap">
          {ch && <a className="btn" href={ch} target="_blank" rel="noreferrer">Companies House</a>}
          {c.Email && <a className="btn" href={`mailto:${c.Email}`}>Email</a>}
        </div>
      </div>

      {(urgent.length > 0 || aml.warn || loe.warn) && (
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
          {aml.warn && (
            <div className="alert amber"><strong>AML: {aml.text.toLowerCase()}</strong><span>Check in Xama</span></div>
          )}
          {loe.warn && <div className="alert"><strong>Engagement letter: {loe.text.toLowerCase()}</strong></div>}
        </section>
      )}

      <nav className="tabs" aria-label="Client sections">
        <a href={href("clients", c.Key)} aria-current={tab === "overview" ? "page" : undefined}>Overview</a>
        <a href={href("clients", c.Key, "work")} aria-current={tab === "work" ? "page" : undefined}>
          Work <span className="chip" style={{ marginLeft: 4 }}>{jobs.length}</span>
        </a>
      </nav>

      {tab === "overview" ? <Overview client={c} jobs={jobs} /> : <WorkTab client={c} jobs={jobs} />}
    </div>
  );
}

function Overview({ client: c, jobs }: { client: Client; jobs: Job[] }) {
  const { data } = useData();
  const idx = useIndex();
  const services = data.clientServices.filter((s) => s.ClientKey === c.Key);
  const gaps = recordGaps(c, idx.servicesByClient.get(c.Key) || new Set());
  const company = c.Kind === "Ltd" || c.Kind === "LLP";
  const today = todayIso();

  return (
    <div className="cols">
      <div className="col-main">
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

        {gaps.length > 0 && (
          <div className="alert amber">
            <strong>Missing from this record</strong>
            <span>{gaps.join(", ")}. Add them under References or Contact.</span>
          </div>
        )}

        <section className="card" aria-labelledby="svc-h">
          <div className="card-head"><h2 id="svc-h">Services and fees</h2>
            {c.AnnualFees ? <span className="mono">{fmtMoney(c.AnnualFees)} a year</span> : null}
          </div>
          {services.length ? (
            <div className="table-wrap">
              <table className="grid">
                <thead><tr><th scope="col">Service</th><th scope="col">Fee</th><th scope="col">Next deadline</th></tr></thead>
                <tbody>
                  {services.map((s) => (
                    <tr key={s.Key}>
                      <td>{idx.serviceName.get(s.ServiceKey as string) || s.ServiceKey}</td>
                      <td className="mono">
                        {s.Fee ? `${fmtMoney(s.Fee as number)} ${s.FeePeriod || ""}` : <span className="muted">In package</span>}
                      </td>
                      <td className="mono">{fmtDate(s.NextDeadline as string) || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">No services recorded.</div>
          )}
        </section>

        <AddressesCard client={c} />
      </div>

      <div className="col-side">
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
        <EditableCard
          title="References"
          client={c}
          fields={[
            ...(company ? ([["CompanyNumber", "Company number"], ["CHAuthCode", "CH auth code"]] as [string, string][]) : []),
            ...(c.Kind === "Ltd" ? ([["CTUTR", "Corporation tax UTR"]] as [string, string][]) : []),
            ["UTR", "Self Assessment UTR"], ["NINumber", "NI number"], ["VATNumber", "VAT number"],
            ["PAYERef", "PAYE reference"], ["AccountsOfficeRef", "Accounts Office ref"],
          ]}
          render={(fields) => (
            <>
              {fields.map(([k, label]) => (
                <div className="kv" key={k}>
                  <span>{label}</span>
                  <span className="mono">{(c[k] as string) || <span style={{ color: "var(--muted)", fontFamily: "var(--sans)" }}>—</span>}</span>
                </div>
              ))}
            </>
          )}
        />
        <section className="card pad stack" aria-labelledby="comp-h">
          <h2 id="comp-h">Compliance</h2>
          <div className="kv"><span>AML (Xama)</span><span style={amlLabel(c.XamaStatus).warn ? { color: "var(--amber-ink)", fontWeight: 600 } : undefined}>{amlLabel(c.XamaStatus).text}</span></div>
          <div className="kv"><span>Engagement letter</span><span style={loeLabel(c.LoEStatus).warn ? { color: "var(--amber-ink)", fontWeight: 600 } : undefined}>{loeLabel(c.LoEStatus).text}</span></div>
          {c.RetentionYears ? <div className="kv"><span>Data kept after leaving</span><span>{c.RetentionYears} years</span></div> : null}
        </section>
        <section className="card pad stack" aria-labelledby="team-h">
          <h2 id="team-h">Team</h2>
          <div className="kv"><span>Partner</span><span>{(c.Partner as string) || "—"}</span></div>
          <div className="kv"><span>Manager</span><span>{(c.Manager as string) || "—"}</span></div>
          {c.Engaged && <div className="kv"><span>Client since</span><span>{fmtDate(c.Engaged as string)}</span></div>}
        </section>
      </div>
    </div>
  );
}

function AddressesCard({ client: c }: { client: Client }) {
  const rows = [
    ["Registered office", c.RegisteredOffice], ["Trading address", c.TradingAddress], ["Home address", c.HomeAddress],
  ].filter(([, v]) => v);
  if (!rows.length) return null;
  return (
    <section className="card pad stack" aria-labelledby="addr-h">
      <h2 id="addr-h">Addresses</h2>
      {rows.map(([label, v]) => (
        <div key={label as string}>
          <div className="muted" style={{ fontSize: 12 }}>{label}</div>
          <div>{v as string}</div>
        </div>
      ))}
    </section>
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

  return (
    <div className="cols">
      <div className="col-main">
        <div className="row-wrap" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn" onClick={() => open({ kind: "task", clientKey: c.Key })}>+ Task</button>
          <button type="button" className="btn" onClick={() => open({ kind: "newJob", clientKey: c.Key })}>+ Job</button>
        </div>
        {jobs.map((j) => <JobCard key={j.Key} job={j} />)}
        {!jobs.length && <div className="card empty">No open work for this client.</div>}
      </div>
      <div className="col-side">
        <section className="card pad stack" aria-labelledby="tasks-h">
          <h2 id="tasks-h">Tasks</h2>
          {tasks.length ? (
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
              {tasks.map((t) => (
                <li key={t.Key}>
                  <button type="button" className="task-row" onClick={() => open({ kind: "task", key: t.Key })}>
                    <span style={{ fontWeight: 600 }}>{t.Title}{isOnHold(t) && <span className="chip hold" style={{ marginLeft: 6 }}>On hold</span>}</span>
                    <span className="muted" style={{ fontSize: 12 }}>
                      {t.Type}{isOnHold(t) ? (t.HoldReason ? ` · ${t.HoldReason}` : "") : t.PlannedDate ? ` · planned ${fmtDate(t.PlannedDate, { weekday: true, year: false })}` : " · not planned"}
                      {t.DueDate ? ` · due ${fmtDate(t.DueDate, { year: false })}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted" style={{ margin: 0 }}>No open tasks. Advisory work, meetings and one-offs go here.</p>
          )}
        </section>
        <section className="card pad stack" aria-labelledby="next-h">
          <h2 id="next-h">Coming up</h2>
          <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
            {jobs.filter((j) => j.Deadline).slice(0, 8).map((j) => (
              <li key={j.Key} style={{ display: "flex", gap: 12 }}>
                <span className="mono" style={{ flex: "0 0 80px", fontSize: 12, color: jobState(j, today).state === "ok" ? "var(--muted)" : "var(--amber-ink)" }}>
                  {fmtDate(j.Deadline)}
                </span>
                <span>{j.Title}</span>
              </li>
            ))}
          </ol>
        </section>
        <section className="card pad stack" aria-labelledby="hist-h">
          <h2 id="hist-h">Done before</h2>
          {history.length ? (
            <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
              {history.slice(0, 12).map((h) => (
                <li key={h.key} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <span>{h.title}</span>
                  <span className="mono muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{h.date ? fmtDate(h.date) : "closed"}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted" style={{ margin: 0 }}>Nothing yet.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function JobCard({ job: j }: { job: Job }) {
  const { data } = useData();
  const { open } = useEditor();
  const today = todayIso();
  const st = jobState(j, today);
  const templates = data.stageTemplates
    .filter((s) => s.ServiceKey === j.ServiceKey)
    .sort((a, b) => (a.StageNo as number) - (b.StageNo as number));
  const mine = new Map(
    data.clientStages.filter((s) => s.ClientKey === j.ClientKey && s.ServiceKey === j.ServiceKey).map((s) => [s.StageNo as number, s]),
  );
  const current = j.StageNo || 1;
  const budget = jobHours(j, data.services);

  return (
    <article className={`job ${svcClass(j.ServiceKey)}${isOnHold(j) ? " held" : st.state === "overdue" ? " late" : st.state === "tight" ? " warn" : ""}`} aria-label={j.Title}>
      <div className="job-head">
        <div className="stack" style={{ gap: 4 }}>
          <div className="row-wrap">
            <h2>{j.Title}</h2>
            {j.Priority === "urgent" && <span className="chip red">Urgent</span>}
            {isOnHold(j) && <span className="chip hold">On hold</span>}
            <DeadlineChip job={j} today={today} />
          </div>
          <span className="muted">
            {j.PeriodEnd ? `Period to ${fmtDate(j.PeriodEnd)}` : ""}
            {j.DeadlineSource ? ` · deadline from ${j.DeadlineSource}` : ""}
          </span>
          {isOnHold(j) && (
            <span style={{ fontSize: 13 }}>
              {(j.HoldReason as string) || "On hold"}
              {j.HoldUntil ? <span className="muted"> · look again {fmtDate(j.HoldUntil as string, { year: false })}</span> : null}
            </span>
          )}
        </div>
        <button type="button" className="btn" onClick={() => open({ kind: "job", key: j.Key })}>Update job</button>
      </div>
      <div className="job-dates">
        <div>
          <div className="label">Records</div>
          <div className="value">
            {j.RecordsReceived ? `In ${fmtDate(j.RecordsReceived, { year: false })}` : j.RecordsExpected ? `Expected ${fmtDate(j.RecordsExpected as string, { year: false })}` : "Not in yet"}
          </div>
          {!j.RecordsReceived && (j.ChaseCount as number) > 0 && <div className="muted" style={{ fontSize: 12 }}>{chaseSummary(j)}</div>}
        </div>
        <div><div className="label">Planned</div><div className="value" style={j.PlannedDate ? { color: "var(--blue-ink)" } : undefined}>{j.PlannedDate ? fmtDate(j.PlannedDate, { weekday: true }) : "Not yet"}</div></div>
        <div><div className="label">Deadline</div><div className="value mono" style={st.state !== "ok" ? { color: st.state === "overdue" ? "var(--red-ink)" : "var(--amber-ink)" } : undefined}>{fmtDate(j.Deadline) || "—"}</div></div>
        <div><div className="label">Your hours</div><div className="value">{fmtHours(budget)}{j.EstimateHours ? "" : <span className="muted" style={{ fontWeight: 400 }}> (default)</span>}</div></div>
      </div>
      {templates.length > 0 && (
        <div className="job-stages">
          <div className="track" style={{ gridTemplateColumns: `repeat(${templates.length}, minmax(0, 1fr))` }} aria-hidden="true">
            {templates.map((t) => (
              <span key={t.Key} className={(t.StageNo as number) < current ? "done" : (t.StageNo as number) === current ? "now" : ""} />
            ))}
          </div>
          <div className="row-wrap" style={{ justifyContent: "space-between", fontSize: 13 }}>
            <span><strong>Stage {current} of {templates.length}:</strong> {j.StageName || templates[current - 1]?.Title}</span>
            {j.SuggestedSlot && !j.PlannedDate && <span className="muted">Suggested slot: {fmtDate(j.SuggestedSlot, { weekday: true })}</span>}
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
