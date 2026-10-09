// Clients list with filters, and the quick look panel for the selected client.
import { useMemo, useState } from "react";
import { Client, Job, KIND_LABEL, amlLabel, contactName, fmtDate, fmtMoney, isOnHold, jobState, loeLabel, recordGaps, todayIso } from "../lib/domain";
import { ClientBadge, DeadlineChip, Icon, companiesHouseUrl, go, href, useRoute } from "./bits";
import { useData, useIndex } from "./data";

type KindFilter = "all" | "companies" | "individuals";

export function ClientsPage() {
  const { data } = useData();
  const idx = useIndex();
  const { query } = useRoute();
  const selectedKey = query.get("c");
  const today = todayIso();

  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [group, setGroup] = useState("");

  const rows = useMemo(
    () =>
      data.clients.map((c) => {
        const jobs = idx.jobsByClient.get(c.Key) || [];
        const attention = jobs.some((j) => !isOnHold(j) && (j.Priority === "urgent" || jobState(j, today).state === "overdue"));
        return { client: c, next: jobs[0], groups: idx.groupsByMember.get(c.Key) || [], attention };
      }),
    [data.clients, idx, today],
  );
  const attentionCount = rows.filter((r) => r.attention).length;

  const shown = rows.filter((r) => {
    const c = r.client;
    if (kind === "companies" && !(c.Kind === "Ltd" || c.Kind === "LLP")) return false;
    if (kind === "individuals" && (c.Kind === "Ltd" || c.Kind === "LLP")) return false;
    if (attentionOnly && !r.attention) return false;
    if (group && !r.groups.some((g) => g.Key === group)) return false;
    if (search) {
      const hay = [c.Title, c.CompanyNumber, contactName(c), c.Email].join(" ").toLowerCase();
      if (!hay.includes(search.toLowerCase())) return false;
    }
    return true;
  });

  const selected = selectedKey ? idx.clientByKey.get(selectedKey) : undefined;
  const select = (key?: string) => go(key ? `/clients?c=${encodeURIComponent(key)}` : "/clients");

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
        </div>

        <div className="row-wrap">
          <label className="search">
            <Icon name="search" />
            <span className="sr-only">Search clients</span>
            <input
              type="search"
              placeholder="Name, company number or contact"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <div className="seg" role="group" aria-label="Client type">
            {(["all", "companies", "individuals"] as KindFilter[]).map((k) => (
              <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
                {k === "all" ? "All" : k === "companies" ? "Companies" : "Individuals"}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn"
            aria-pressed={attentionOnly}
            onClick={() => setAttentionOnly(!attentionOnly)}
            style={attentionOnly ? { background: "var(--amber-soft)", borderColor: "var(--amber-line)", color: "var(--amber-ink)" } : undefined}
          >
            Needs attention ({attentionCount})
          </button>
          <label>
            <span className="sr-only">Group</span>
            <select className="input" value={group} onChange={(e) => setGroup(e.target.value)} style={{ width: "auto" }}>
              <option value="">Any group</option>
              {data.groups.map((g) => (
                <option key={g.Key} value={g.Key}>{g.Title}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="card table-wrap">
          <table className="grid" style={{ minWidth: 820 }}>
            <thead>
              <tr>
                <th scope="col">Client</th>
                <th scope="col">Group</th>
                <th scope="col">Next job</th>
                <th scope="col">Next deadline</th>
                <th scope="col">AML</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(({ client: c, next, groups }) => {
                const aml = amlLabel(c.XamaStatus);
                return (
                  <tr key={c.Key} className={`clickable${c.Key === selectedKey ? " selected" : ""}`} onClick={() => select(c.Key)}>
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
                          <div className="cell-sub">{KIND_LABEL[c.Kind || ""] || c.Kind}</div>
                        </div>
                      </div>
                    </td>
                    <td className="muted">{groups.map((g) => g.Title).join(", ") || "—"}</td>
                    <td>
                      {next ? (
                        <>
                          {next.Title}
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
                  <td colSpan={5} className="empty">No clients match these filters.</td>
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
            {c.CompanyNumber && <> · <span className="mono">{c.CompanyNumber}</span></>}
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

      <div className="stack" style={{ gap: 8 }}>
        <h3>Open work</h3>
        {jobs.length ? (
          <div className="mini-jobs">
            {jobs.slice(0, 6).map((j) => (
              <div key={j.Key}>
                <div>
                  <div style={{ fontWeight: 600 }}>{j.Title}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {j.PeriodEnd ? `Period to ${fmtDate(j.PeriodEnd)} · ` : ""}
                    {isOnHold(j) ? "on hold" : j.PlannedDate ? `planned ${fmtDate(j.PlannedDate, { year: false })}` : "not planned"}
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
