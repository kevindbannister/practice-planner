// Clients list with filters, and the quick look panel for the selected client.
import { useMemo, useState } from "react";
import { Client, Job, KIND_LABEL, amlLabel, contactName, fmtDate, fmtMoney, holdLabel, importanceLabel, importanceOf, isOnHold, jobState, loeLabel, recordGaps, todayIso } from "../lib/domain";
import { ClientBadge, CopyButton, DeadlineChip, ElementsLink, Icon, companiesHouseUrl, go, href, useRoute } from "./bits";
import { elementsUrl } from "../lib/elements";
import { ElementsImport } from "./ElementsImport";
import { useData, useIndex } from "./data";
import { svcClass } from "../lib/serviceColour";
import { Criteria, ExportRow, NO_FILTERS, activeFilters, matchRow } from "../lib/clientFilter";
import { ActionBar, FilterPanel, ViewsBar } from "./ClientFilters";

export function ClientsPage() {
  const { data } = useData();
  const idx = useIndex();
  const { query } = useRoute();
  const selectedKey = query.get("c");
  const today = todayIso();

  const [f, setF] = useState<Criteria>(NO_FILTERS);
  const set = (p: Partial<Criteria>) => setF((x) => ({ ...x, ...p }));
  const [moreOpen, setMoreOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const rows = useMemo(
    () =>
      data.clients.map((c) => {
        const jobs = idx.jobsByClient.get(c.Key) || [];
        const live = jobs.filter((j) => !isOnHold(j));
        const overdue = live.filter((j) => jobState(j, today).state === "overdue").length;
        const attention = live.some((j) => j.Priority === "urgent" || jobState(j, today).state === "overdue");
        const services = [...(idx.servicesByClient.get(c.Key) || [])].filter((k) => !idx.servicesOff.has(`${c.Key}|${k}`));
        const groupRows = idx.groupsByMember.get(c.Key) || [];
        return { client: c, next: jobs[0], groupRows, groups: groupRows.map((g) => String(g.Key)), services, attention, open: jobs.length, overdue };
      }),
    [data.clients, idx, today],
  );
  const attentionCount = rows.filter((r) => r.attention).length;
  const shown = rows.filter((r) => matchRow(f, r));
  const serviceOptions = useMemo(() => data.services.filter((s) => s.Title).map((s) => ({ key: String(s.Key), title: String(s.Title) })).sort((a, b) => a.title.localeCompare(b.title)), [data.services]);
  const groupOptions = data.groups.map((g) => ({ key: String(g.Key), title: String(g.Title) }));
  const nFilters = activeFilters(f);

  // actions apply to the ticked clients, or to everyone shown when none are ticked
  const chosen = shown.filter((r) => picked.has(r.client.Key));
  const targets = chosen.length ? chosen : shown;
  const exportRows: ExportRow[] = targets.map((r) => ({
    client: r.client, groups: r.groups, services: r.services, attention: r.attention, open: r.open, overdue: r.overdue,
    groupNames: r.groupRows.map((g) => String(g.Title)), serviceNames: r.services.map((k) => idx.serviceName.get(k) || k),
    nextJob: r.next ? String(r.next.Title || "") : "", nextDeadline: r.next?.Deadline ? fmtDate(r.next.Deadline) : "",
  }));
  const allPicked = shown.length > 0 && shown.every((r) => picked.has(r.client.Key));
  const togglePage = () => setPicked((p) => { const n = new Set(p); if (allPicked) shown.forEach((r) => n.delete(r.client.Key)); else shown.forEach((r) => n.add(r.client.Key)); return n; });
  const toggleOne = (key: string) => setPicked((p) => { const n = new Set(p); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  const selected = selectedKey ? idx.clientByKey.get(selectedKey) : undefined;
  const select = (key?: string) => go(key ? `/clients/all?c=${encodeURIComponent(key)}` : "/clients/all");

  return (
    <div className="split">
      <main className="split-main">
        <div className="page-head">
          <div>
            <h1>Clients</h1>
            <p className="muted" style={{ margin: "4px 0 0" }}>
              {data.clients.length} clients · {attentionCount} need attention
            </p>
          </div>
          <div className="row-wrap"><a className="btn" href="#/clients">Back to clients</a><ElementsImport /></div>
        </div>

        <div className="row-wrap">
          <label className="search">
            <Icon name="search" />
            <span className="sr-only">Search clients</span>
            <input
              type="search"
              placeholder="Name, company number or contact"
              value={f.search}
              onChange={(e) => set({ search: e.target.value })}
            />
          </label>
          <div className="seg" role="group" aria-label="Client type">
            {(["all", "companies", "individuals"] as Criteria["kind"][]).map((k) => (
              <button key={k} type="button" aria-pressed={f.kind === k} onClick={() => set({ kind: k })}>
                {k === "all" ? "All" : k === "companies" ? "Companies" : "Individuals"}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn"
            aria-pressed={f.attention}
            onClick={() => set({ attention: !f.attention })}
            style={f.attention ? { background: "var(--amber-soft)", borderColor: "var(--amber-line)", color: "var(--amber-ink)" } : undefined}
          >
            Needs attention ({attentionCount})
          </button>
          <button type="button" className="btn" aria-expanded={moreOpen} onClick={() => setMoreOpen(!moreOpen)}>
            More filters{nFilters - (f.attention ? 1 : 0) > 0 ? ` (${nFilters - (f.attention ? 1 : 0)})` : ""}
          </button>
          {(nFilters > 0 || f.search || f.kind !== "all") && <button type="button" className="linkbtn" onClick={() => setF(NO_FILTERS)}>Clear filters</button>}
        </div>
        {moreOpen && <FilterPanel f={f} set={set} groups={groupOptions} services={serviceOptions} />}
        <div className="row-wrap" style={{ justifyContent: "space-between" }}>
          <ViewsBar f={f} apply={setF} />
          <span className="muted" aria-live="polite">{shown.length} of {data.clients.length} clients</span>
        </div>
        {shown.length > 0 && (
          <ActionBar targets={exportRows} ticked={chosen.length > 0} label={chosen.length ? `${chosen.length} ticked` : `All ${shown.length} shown`} />
        )}

        <div className="card table-wrap">
          <table className="grid" style={{ minWidth: 1040 }}>
            <thead>
              <tr>
                <th scope="col" style={{ width: 36 }}><input type="checkbox" aria-label="Tick every client shown" checked={allPicked} onChange={togglePage} /></th>
                <th scope="col">Client</th>
                <th scope="col">Group</th>
                <th scope="col">Services</th>
                <th scope="col" className="num">Annual fees</th>
                <th scope="col">Next job</th>
                <th scope="col">Next deadline</th>
                <th scope="col">AML</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(({ client: c, next, groupRows, services }) => {
                const aml = amlLabel(c.XamaStatus);
                return (
                  <tr key={c.Key} className={`clickable${c.Key === selectedKey ? " selected" : ""}`} onClick={() => select(c.Key)}>
                    <td onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Tick ${c.Title}`} checked={picked.has(c.Key)} onChange={() => toggleOne(c.Key)} /></td>
                    <td>
                      <div className="ident">
                        <ClientBadge client={c} />
                        <div>
                          <a
                            className="cell-title"
                            href={`#/clients?c=${encodeURIComponent(c.Key)}`}
                            aria-current={c.Key === selectedKey ? "true" : undefined}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {c.Title}
                          </a>
                          <div className="cell-sub">{KIND_LABEL[c.Kind || ""] || c.Kind}{importanceOf(c) !== "normal" ? ` · ${importanceLabel(c)}` : ""}</div>
                        </div>
                      </div>
                    </td>
                    <td className="muted">{groupRows.map((g) => g.Title).join(", ") || "—"}</td>
                    <td className="muted">{services.length ? <>{services.slice(0, 3).map((k) => idx.serviceName.get(k) || k).join(", ")}{services.length > 3 ? ` +${services.length - 3}` : ""}</> : "—"}</td>
                    <td className="num mono">{Number(c.AnnualFees) ? fmtMoney(Number(c.AnnualFees)) : <span className="muted">—</span>}</td>
                    <td>
                      {next ? (
                        <>
                          <span className={`svc-dot ${svcClass(next.ServiceKey)}`} aria-hidden="true" style={{ marginRight: 7, verticalAlign: "-1px" }} />{next.Title}
                          <div className="cell-sub">
                            {next.PlannedDate ? (
                              <span style={{ color: "var(--blue-ink)" }}>Planned {fmtDate(next.PlannedDate, { weekday: true, year: false })}</span>
                            ) : (
                              "Not planned"
                            )}
                          </div>
                        </>
                      ) : (
                        <span className="muted">No open work</span>
                      )}
                    </td>
                    <td>
                      {next?.Deadline ? (
                        <div className="row-wrap" style={{ gap: 6 }}>
                          <span className="mono">{fmtDate(next.Deadline)}</span>
                          <DeadlineChip job={next} today={today} />
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td style={aml.warn ? { color: "var(--amber-ink)", fontWeight: 600 } : undefined}>{aml.text}</td>
                  </tr>
                );
              })}
              {!shown.length && (
                <tr>
                  <td colSpan={8} className="empty">No clients match these filters.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>

      {selected && <QuickLook client={selected} onClose={() => select()} />}
    </div>
  );
}

function QuickLook({ client: c, onClose }: { client: Client; onClose: () => void }) {
  const idx = useIndex();
  const today = todayIso();
  const jobs: Job[] = idx.jobsByClient.get(c.Key) || [];
  const groups = idx.groupsByMember.get(c.Key) || [];
  const gaps = recordGaps(c, idx.servicesByClient.get(c.Key) || new Set());
  const aml = amlLabel(c.XamaStatus);
  const loe = loeLabel(c.LoEStatus);
  const urgent = jobs.filter((j) => !isOnHold(j) && (j.Priority === "urgent" || jobState(j, today).state === "overdue"));
  const ch = c.Kind === "Ltd" || c.Kind === "LLP" ? companiesHouseUrl(c.CompanyNumber) : undefined;

  return (
    <aside className="quick" aria-labelledby="ql-title">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div className="stack" style={{ gap: 6 }}>
          <span className="eyebrow">Quick look</span>
          <h2 id="ql-title">{c.Title}</h2>
          <span className="muted">
            {KIND_LABEL[c.Kind || ""] || c.Kind}
            {c.CompanyNumber && <> · <span className="mono">{c.CompanyNumber}</span><CopyButton value={c.CompanyNumber} label="company number" /></>}
            {c.YearEnd && <> · YE {fmtDate(`2000-${c.YearEnd}`, { year: false })}</>}
          </span>
        </div>
        <button type="button" className="iconbtn" aria-label="Close quick look" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>

      {(urgent.length > 0 || aml.warn || loe.warn || gaps.length > 0) && (
        <div className="stack" style={{ gap: 8 }}>
          <h3>Needs attention</h3>
          {urgent.map((j) => (
            <div key={j.Key} className={`alert ${jobState(j, today).state === "overdue" ? "red" : "amber"}`}>
              <strong>{j.Title}</strong>
              <span>
                Due {fmtDate(j.Deadline)} · {j.PlannedDate ? `planned ${fmtDate(j.PlannedDate, { year: false })}` : "not planned"}
              </span>
            </div>
          ))}
          {aml.warn && (
            <div className="alert amber"><strong>AML: {aml.text.toLowerCase()}</strong></div>
          )}
          {loe.warn && <div className="alert"><strong>Engagement letter: {loe.text.toLowerCase()}</strong></div>}
          {gaps.length > 0 && (
            <div className="alert"><strong>Missing from the record</strong><span>{gaps.join(", ")}</span></div>
          )}
        </div>
      )}

      {elementsUrl(c) && <div><ElementsLink client={c} /></div>}

      <div className="stack" style={{ gap: 8 }}>
        <h3>Open work</h3>
        {jobs.length ? (
          <div className="mini-jobs">
            {jobs.slice(0, 6).map((j) => (
              <div key={j.Key}>
                <div>
                  <div style={{ fontWeight: 600 }}><span className={`svc-dot ${svcClass(j.ServiceKey)}`} aria-hidden="true" style={{ marginRight: 7, verticalAlign: "-1px" }} />{j.Title}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {j.PeriodEnd ? `Period to ${fmtDate(j.PeriodEnd)} · ` : ""}
                    {isOnHold(j) ? holdLabel(j).toLowerCase() : j.PlannedDate ? `planned ${fmtDate(j.PlannedDate, { year: false })}` : "not planned"}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="mono" style={{ fontSize: 12 }}>{fmtDate(j.Deadline)}</div>
                  <DeadlineChip job={j} today={today} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted" style={{ margin: 0 }}>No open work.</p>
        )}
      </div>

      <div className="stack" style={{ gap: 8 }}>
        <h3>Contact</h3>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div>
            <div style={{ fontWeight: 600 }}>{contactName(c) || c.Title}</div>
            {c.ContactPreference && <div className="muted" style={{ fontSize: 12 }}>Prefers {String(c.ContactPreference).toLowerCase()}</div>}
          </div>
          <div className="row-wrap" style={{ gap: 6 }}>
            {c.Email && <a className="btn small" href={`mailto:${c.Email}`}>Email</a>}
            {c.Mobile && <a className="btn small" href={`sms:${String(c.Mobile).replace(/\s/g, "")}`}>Text</a>}
          </div>
        </div>
      </div>

      <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, paddingTop: 14, borderTop: "1px solid var(--line-2)" }}>
        <div><dt className="muted" style={{ fontSize: 12 }}>Fees per year</dt><dd style={{ margin: "2px 0 0" }} className="mono">{fmtMoney(c.AnnualFees) || "—"}</dd></div>
        <div><dt className="muted" style={{ fontSize: 12 }}>Partner</dt><dd style={{ margin: "2px 0 0" }}>{(c.Partner as string) || "—"}</dd></div>
        <div><dt className="muted" style={{ fontSize: 12 }}>Group</dt><dd style={{ margin: "2px 0 0" }}>{groups.map((g) => g.Title).join(", ") || "—"}</dd></div>
        <div><dt className="muted" style={{ fontSize: 12 }}>Engagement letter</dt><dd style={{ margin: "2px 0 0" }}>{loe.text}</dd></div>
      </dl>

      <div className="stack" style={{ gap: 8, marginTop: "auto" }}>
        <a className="btn primary" href={href("clients", c.Key)}>Open full client</a>
        <div className="row-wrap">
          <a className="btn" style={{ flex: 1 }} href={href("clients", c.Key, "work")}>Work</a>
          {ch && <a className="btn" style={{ flex: 1 }} href={ch} target="_blank" rel="noreferrer">Companies House</a>}
        </div>
      </div>
    </aside>
  );
}
