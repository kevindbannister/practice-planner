import { useEffect, useState } from "react";
import { ApiError, BusinessInfo, Official } from "./api";
import { Changes } from "./Changes";
import { readable } from "./format";
import type { Ctx } from "./PortalApp";

const GROUPS: [string, [string, string][]][] = [
  ["Company", [["name", "Registered name"], ["tradingName", "Trading name"], ["kind", "Type"], ["companyNumber", "Company number"], ["incorporated", "Incorporated"], ["yearEnd", "Year end"], ["businessActivity", "What the business does"]]],
  ["Contact", [["email", "Email"], ["phone", "Telephone"], ["mobile", "Mobile"], ["website", "Website"]]],
  ["Addresses", [["registeredOffice", "Registered office"], ["tradingAddress", "Trading address"]]],
  ["Tax references", [["vatNumber", "VAT number"], ["payeRef", "PAYE reference"]]],
];
const TYPE: Record<string, string> = { Ltd: "Limited company", LLP: "LLP", Individual: "Individual", Partnership: "Partnership", Trust: "Trust" };
const day = (iso: string) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "");

export function BusinessPage({ ctx }: { ctx: Ctx }) {
  const { api, biz } = ctx;
  const [info, setInfo] = useState<BusinessInfo | null>(null);
  const [err, setErr] = useState("");
  const load = () => api.business(biz.clientKey).then(setInfo).catch((e) => setErr(e instanceof ApiError ? e.message : "Couldn't load."));
  useEffect(() => { setInfo(null); void load(); }, [api, biz.clientKey]);
  if (err) return <p className="px-error" role="alert">{err}</p>;
  if (!info) return <p>Loading…</p>;
  if (!biz.can["business.details"]) return <section className="px-card"><h1>{biz.name}</h1><p className="px-muted">Your access doesn't include the full business details.</p></section>;
  const d = { ...readable(info.details), kind: TYPE[info.details.kind] || info.details.kind };
  return (
    <div className="px-stack">
      <h1>My business</h1>
      <p className="px-muted" style={{ margin: 0 }}>The first section is what {ctx.cfg.practiceName} holds for {biz.name}. The last is the public record at Companies House, shown separately so you can compare.</p>
      <h2 className="px-h2">Held by {ctx.cfg.practiceName}</h2>
      {GROUPS.map(([title, fields]) => {
        const shown = fields.filter(([k]) => d[k]);
        return (
          <section className="px-card" key={title} aria-labelledby={`bp-${title}`}>
            <h2 id={`bp-${title}`}>{title}</h2>
            {shown.length ? <dl className="px-dl">{shown.map(([k, label]) => <div key={k}><dt>{label}</dt><dd>{d[k]}</dd></div>)}</dl> : <p className="px-muted" style={{ margin: 0 }}>Nothing recorded.</p>}
          </section>
        );
      })}
      {biz.can["business.requestChange"] && info.editable.length > 0 && <Changes ctx={ctx} details={info.details} editable={info.editable} onChanged={() => void load()} />}
      {info.details.companyNumber && <OfficialRecord ctx={ctx} />}
    </div>
  );
}

function OfficialRecord({ ctx }: { ctx: Ctx }) {
  const [o, setO] = useState<{ official: Official | null; configured: boolean; unavailable?: boolean } | null>(null);
  useEffect(() => { void ctx.api.official(ctx.biz.clientKey).then(setO).catch(() => setO({ official: null, configured: false, unavailable: true })); }, [ctx.api, ctx.biz.clientKey]);
  if (!o) return null;
  const c = o.official;
  return (
    <>
      <h2 className="px-h2">Official record at Companies House</h2>
      <section className="px-card" aria-label="Companies House record">
        {!c ? <p className="px-muted" style={{ margin: 0 }}>{o.unavailable ? "The Companies House record couldn't be loaded just now." : "The Companies House record isn't available here."}</p> : (
          <div className="px-stack" style={{ gap: 12 }}>
            <p className="px-fine" style={{ margin: 0 }}>From the public register. This is the official record: it changes only when a filing is made at Companies House.</p>
            <dl className="px-dl">
              <div><dt>Registered name</dt><dd>{c.name}</dd></div>
              <div><dt>Status</dt><dd style={{ textTransform: "capitalize" }}>{c.status}</dd></div>
              {c.incorporated && <div><dt>Incorporated</dt><dd>{day(c.incorporated)}</dd></div>}
              {c.registeredOffice && <div><dt>Registered office</dt><dd>{c.registeredOffice}</dd></div>}
              {c.sic.length > 0 && <div><dt>SIC codes</dt><dd>{c.sic.join(", ")}</dd></div>}
              {c.accountingReferenceDate && <div><dt>Accounting reference date</dt><dd>{c.accountingReferenceDate.replace("/", " / ")}</dd></div>}
              {c.accountsDue && <div><dt>Next accounts due</dt><dd>{day(c.accountsDue)}</dd></div>}
              {c.confirmationDue && <div><dt>Next confirmation statement due</dt><dd>{day(c.confirmationDue)}</dd></div>}
            </dl>
            {c.officers.length > 0 && <div><h3 className="px-h3">Directors and officers</h3><ul className="px-list">{c.officers.map((p, i) => <li key={i}>{p.name} <span className="px-muted">· {p.role}{p.appointed ? `, since ${day(p.appointed)}` : ""}</span></li>)}</ul></div>}
            {c.pscs.length > 0 && <div><h3 className="px-h3">People with significant control</h3><ul className="px-list">{c.pscs.map((p, i) => <li key={i}>{p.name} <span className="px-muted">· {p.control.join("; ") || "significant control"}</span></li>)}</ul></div>}
          </div>
        )}
      </section>
    </>
  );
}
