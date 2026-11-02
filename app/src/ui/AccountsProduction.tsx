// Accounts production: every company's accounts for the year in one list, with the status they have reached (the same
// statuses IRIS Elements uses), their stage, how far the papers are and the deadline. The statutory accounts are made
// in Elements; the status here is set by hand, in this list or on the company's papers.
import { useMemo, useState } from "react";
import { ACCOUNTS_ITEM, ACCOUNTS_STATUSES, AccountsStatus, ProductionRow, StatusFilter, STATUS_NAME, accountsStatusOf, asStatus, matchesStatus, productionRows, statusCounts, statusSetup } from "../lib/accountsStatus";
import { Client, deadlineLabel, fmtDate, todayIso } from "../lib/domain";
import { newKey } from "../lib/planning";
import { readSetup, setupRow } from "../lib/papers";
import { ClientBadge, Icon, href } from "./bits";
import { useData, useIndex } from "./data";

/** Saves a company's accounts status for a year. */
export function useSetAccountsStatus() {
  const { data, update, create, user } = useData();
  return async (clientKey: string, period: string, status: AccountsStatus | "") => {
    const row = setupRow(data.papers, clientKey, period, ACCOUNTS_ITEM);
    const now = new Date().toISOString();
    const next = statusSetup(readSetup(row), status, user || "", now);
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    const values = { Setup: JSON.stringify(next), Updated: now };
    if (row) await update("WorkingPapers", row, values);
    else if (status) await create("WorkingPapers", { Key: newKey("WP"), ClientKey: clientKey, PeriodEnd: period, ItemKey: ACCOUNTS_ITEM, Status: "todo", ...values });
  };
}

/** The status dropdown, as in Elements, for one company and year. */
export function AccountsStatusSelect({ clientKey, period, compact = false }: { clientKey: string; period: string; compact?: boolean }) {
  const { data } = useData();
  const set = useSetAccountsStatus();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const cur = accountsStatusOf(data.papers, clientKey, period);
  const change = async (v: string) => {
    setBusy(true); setError(false);
    try { await set(clientKey, period, asStatus(v)); } catch { setError(true); } finally { setBusy(false); }
  };
  return (
    <label className={`row-wrap accounts-status${compact ? " compact" : ""}`} style={{ gap: 6, fontSize: 13 }}>
      <span className={compact ? "sr-only" : ""}>Accounts</span>
      <select className="input" value={cur.status} disabled={busy} style={{ width: "auto", minHeight: 32, padding: "2px 8px" }} aria-label="Accounts status"
        title={cur.at ? `Set ${fmtDate(cur.at.slice(0, 10))}${cur.by ? ` by ${cur.by}` : ""}` : "Where the accounts have got to"}
        onChange={(e) => void change(e.target.value)}>
        <option value="">Not started</option>
        {ACCOUNTS_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
      </select>
      {error && <span className="error-text" role="alert">Didn't save</span>}
    </label>
  );
}

export function AccountsProductionPage() {
  const { data } = useData();
  const idx = useIndex();
  const today = todayIso();
  const [filter, setFilter] = useState<StatusFilter | "all" | "soon">("all");
  const [search, setSearch] = useState("");
  const [showComplete, setShowComplete] = useState(false);
  const all = useMemo(
    () => productionRows({ jobs: data.jobs as never, clients: idx.clientByKey as Map<string, Client>, papers: data.papers, stagesByService: idx.stagesByService, today, showComplete }),
    [data.jobs, data.papers, idx, today, showComplete],
  );
  const counts = statusCounts(all);
  const soon = all.filter((r) => matchesStatus(r, "soon")).length;
  const q = search.trim().toLowerCase();
  const rows = all.filter((r) => matchesStatus(r, filter) && (!q || `${r.client.Title} ${r.client.CompanyNumber || ""}`.toLowerCase().includes(q)));
  const chips: [StatusFilter | "all" | "soon", string, number][] = [["all", "All", all.length], ["soon", "Late or due in 30 days", soon], ["none", STATUS_NAME.none, counts.none], ...ACCOUNTS_STATUSES.map((s) => [s.key, s.label, counts[s.key]] as [StatusFilter, string, number])];

  return (
    <div className="stack">
      <div className="row-wrap" style={{ gap: 8 }}>
        <label className="search" style={{ flex: "1 1 260px", maxWidth: 380 }}>
          <Icon name="search" /><span className="sr-only">Search companies</span>
          <input type="search" placeholder="Company or number" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <label className="row-wrap" style={{ gap: 6, fontSize: 13 }}><input type="checkbox" checked={showComplete} onChange={(e) => setShowComplete(e.target.checked)} /> Include finished jobs</label>
      </div>
      <div className="row-wrap" style={{ gap: 6 }} role="group" aria-label="Filter by status">
        {chips.map(([k, label, n]) => (
          <button key={k} type="button" className={`chip${filter === k ? " blue" : ""}`} aria-pressed={filter === k} style={{ cursor: "pointer" }} onClick={() => setFilter(k)}>{label} · {n}</button>
        ))}
      </div>
      <section className="card">
        <div className="table-wrap">
          <table className="grid papers-list">
            <thead><tr><th scope="col">Company</th><th scope="col">Year end</th><th scope="col">Deadline</th><th scope="col">Accounts status</th><th scope="col">Job stage</th><th scope="col">Papers</th><th scope="col"><span className="sr-only">Open</span></th></tr></thead>
            <tbody>
              {rows.map((r) => <Row key={r.job.Key} r={r} />)}
            </tbody>
          </table>
        </div>
        {!rows.length && <div className="empty">{all.length ? "Nothing matches that filter." : "No accounts jobs yet. They appear here when a company has an accounts job."}</div>}
      </section>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>The accounts themselves are made in IRIS Elements. The status is set by hand here or on the company's papers, using the same names as Elements.</p>
    </div>
  );
}

function Row({ r }: { r: ProductionRow }) {
  const dl = r.days !== undefined ? deadlineLabel(r.days) : "";
  return (
    <tr>
      <td className="cell-title">
        <a href={href("papers", r.client.Key, r.period)} className="adv-client"><ClientBadge client={r.client} /><span><strong>{r.client.Title}</strong>{r.client.CompanyNumber && <span className="cell-sub mono" style={{ display: "block" }}>{r.client.CompanyNumber}</span>}</span></a>
      </td>
      <td className="mono" style={{ whiteSpace: "nowrap" }}>{fmtDate(r.period)}</td>
      <td className="mono" style={{ whiteSpace: "nowrap" }}>{r.deadline ? fmtDate(r.deadline) : "—"}{dl && <div className={`cell-sub${r.late ? " late" : ""}`} style={r.late ? { color: "var(--red, #b3261e)" } : undefined}>{dl}</div>}</td>
      <td><AccountsStatusSelect clientKey={String(r.client.Key)} period={r.period} compact /></td>
      <td>{r.stage}{r.waiting && <div className="cell-sub">Waiting for the client</div>}{r.complete && <div className="cell-sub">Job finished</div>}</td>
      <td>
        <span className="paper-prog" title={`${r.done} of ${r.total} sections finished`}>
          <span className="paper-bar" aria-hidden="true"><span style={{ width: `${r.total ? (r.done / r.total) * 100 : 0}%` }} /></span>
          <span className="mono">{r.done}/{r.total}</span>
        </span>
      </td>
      <td style={{ textAlign: "right" }}><a className="btn small" href={href("papers", r.client.Key, r.period)}>Open papers</a></td>
    </tr>
  );
}
