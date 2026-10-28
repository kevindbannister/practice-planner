// The company overview in Co Sec: who the directors and shareholders are, dividends for this year and last, and buttons that open the
// other screens (confirmation statement, dividends, certificates, dormant accounts and so on), so the tab bar can stay short.
import { useMemo } from "react";
import { fmtDate, todayIso } from "../lib/domain";
import { companyKind, isOpenTx, verifiedOf } from "../lib/cosec";
import { ID_LABEL, IdStatus } from "../lib/cosecCs01";
import { pounds } from "../lib/cosecDividends";
import { dividendYears, officers, shareholders } from "../lib/cosecOverview";
import { readEntry } from "../lib/shareLedger";
import { Row } from "../lib/schema";
import { href } from "./bits";
import { useCoSec } from "./cosecKit";

const s = (v: unknown) => (v == null ? "" : String(v));

export function Overview({ client, base, children }: { client: Row; base: string; children?: React.ReactNode }) {
  const k = useCoSec(); const ck = s(client.Key);
  const kind = companyKind(client); const limited = kind === "limited";
  const ver = verifiedOf(client); const today = todayIso();
  const off = useMemo(() => officers(k.data.cosecOfficers, ck), [k.data.cosecOfficers, ck]);
  const sh = useMemo(() => shareholders(k.data.cosecLedger.map(readEntry), k.data.cosecShareClasses, k.data.cosecShares, ck, today), [k.data, ck, today]);
  const dv = useMemo(() => dividendYears(k.data.cosecDividends, ck, ver.accTo, today), [k.data.cosecDividends, ck, ver.accTo, today]);
  const open = k.data.cosecTx.filter((t) => s(t.ClientKey) === ck && isOpenTx(t));
  const accountsJobs = k.data.cosecAccounts.filter((r) => s(r.ClientKey) === ck && !["complete", "cancelled"].includes(s(r.Status)));
  const certs = k.data.cosecCertificates.filter((r) => s(r.ClientKey) === ck && s(r.Status) === "issued").length;
  const go = (tab: string) => `${base}/${tab}`;
  const actions: [string, string, string][] = [
    ["Confirmation statement", "cs01", ver.csDue ? `Due ${fmtDate(ver.csDue)}` : "Prepare and check"],
    ...(limited ? [
      ["Dividends", "dividends", "Declare and record"],
      ["Share certificates", "certificates", certs ? `${certs} in force` : "Issue and replace"],
      ["Dormant accounts", "accounts", accountsJobs.length ? "In progress" : ver.accDue ? `Accounts due ${fmtDate(ver.accDue)}` : "Never traded companies"],
      ["Share classes and ownership", "classes", "Rights, votes, PSC check"],
      ["Share ledger", "ledger", "Every allotment and transfer"],
    ] as [string, string, string][] : []),
    ["Import history", "import", "Bring in past records"],
  ];
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="ov-three">
        <section className="card pad stack" aria-label="Directors">
          <div className="row-wrap" style={{ justifyContent: "space-between" }}><h3 style={{ margin: 0 }}>{kind === "llp" ? "Members" : "Directors"}</h3><a href={go("officers")}>All officers</a></div>
          {off.directors.length ? <ul className="plain" style={{ margin: 0 }}>{off.directors.map((p, i) => (
            <li key={i}><strong>{p.name}</strong>{p.appointed ? <span className="muted"> · since {fmtDate(p.appointed)}</span> : null}{p.id && p.id !== "verified" ? <> <span className="chip amber">{ID_LABEL[p.id as IdStatus] || p.id}</span></> : null}</li>))}</ul>
            : <p className="muted" style={{ margin: 0 }}>No current {kind === "llp" ? "members" : "directors"} recorded. Bring them in from Companies House below, or add one in Officers.</p>}
          {off.others.length > 0 && <p className="muted" style={{ margin: 0 }}>Also: {off.others.map((p) => `${p.name} (${p.role})`).join(", ")}</p>}
        </section>
        {limited && <section className="card pad stack" aria-label="Shareholders">
          <div className="row-wrap" style={{ justifyContent: "space-between" }}><h3 style={{ margin: 0 }}>Shareholders</h3><a href={go("shares")}>Open</a></div>
          {sh.holders.length ? <div className="table-wrap"><table className="grid" style={{ minWidth: 0 }}>
            <thead><tr><th scope="col">Name</th><th scope="col">Shares</th><th scope="col">%</th></tr></thead>
            <tbody>{sh.holders.map((h, i) => <tr key={i}><td>{h.name}<div className="cell-sub">{h.classes}</div></td><td>{h.shares.toLocaleString("en-GB")}</td><td>{h.percent}%{h.votePercent !== undefined && h.votePercent !== h.percent ? <div className="cell-sub">{h.votePercent}% of votes</div> : null}</td></tr>)}
              <tr><td><strong>In issue</strong></td><td colSpan={2}><strong>{sh.issued.toLocaleString("en-GB")}</strong></td></tr></tbody></table></div>
            : <p className="muted" style={{ margin: 0 }}>No shareholders recorded yet.</p>}
          {sh.source === "register" && <p className="muted" style={{ margin: 0 }}>From the shareholders register: the share ledger is empty.</p>}
        </section>}
        {limited && <section className="card pad stack" aria-label="Dividends">
          <div className="row-wrap" style={{ justifyContent: "space-between" }}><h3 style={{ margin: 0 }}>Dividends</h3><a href={go("dividends")}>Open</a></div>
          {dv.map((y, i) => (
            <div key={i} className="stack" style={{ gap: 4 }}>
              <strong>{i === 0 ? "This year" : i === 1 ? "Last year" : "Year before"} <span className="muted" style={{ fontWeight: 400 }}>{y.label}</span></strong>
              {y.rows.length ? <>{y.rows.map((r) => (
                <div key={r.key} className="stack" style={{ gap: 0 }}>
                  <div className="row-wrap" style={{ justifyContent: "space-between" }}><span>{r.ref} · {r.type === "final" ? "final" : "interim"} · {fmtDate(r.date)}{r.status === "declared" ? " (not yet paid)" : ""}</span><strong>{pounds(BigInt(r.totalPence))}</strong></div>
                  <span className="muted" style={{ fontSize: 13 }}>{r.rate ? `${r.rate}. ` : ""}{r.payees.map((p) => `${p.name} ${p.waived ? "waived" : pounds(BigInt(p.pence))}`).join(", ")}</span>
                </div>))}
                {y.rows.length > 1 && <div className="row-wrap" style={{ justifyContent: "space-between" }}><strong>Total</strong><strong>{pounds(BigInt(y.totalPence))}</strong></div>}</> : <span className="muted">None declared.</span>}
              {y.drafts > 0 && <span className="muted">{y.drafts} draft not counted.</span>}
            </div>))}
        </section>}
      </div>
      <section className="card pad stack" aria-label="Actions">
        <h3 style={{ margin: 0 }}>Actions</h3>
        <div className="ov-actions">{actions.map(([label, tab, hint]) => <a key={tab} className="btn ov-action" href={go(tab)}><strong>{label}</strong><span className="muted">{hint}</span></a>)}
          {open.length > 0 && <a className="btn ov-action" href={go("filings")}><strong>Filings waiting</strong><span className="muted">{open.length} open</span></a>}</div>
      </section>
      {children}
    </div>
  );
}
