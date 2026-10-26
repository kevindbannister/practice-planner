import { useEffect, useState } from "react";
import { ApiError, BusinessInfo } from "./api";
import type { Ctx } from "./PortalApp";

const GROUPS: [string, [string, string][]][] = [
  ["Company", [["name", "Registered name"], ["kind", "Type"], ["companyNumber", "Company number"], ["incorporated", "Incorporated"], ["yearEnd", "Year end"], ["sic", "Business activity codes (SIC)"]]],
  ["Contact", [["email", "Email"], ["phone", "Telephone"], ["mobile", "Mobile"], ["website", "Website"]]],
  ["Addresses", [["registeredOffice", "Registered office"], ["tradingAddress", "Trading address"]]],
  ["Tax references", [["vatNumber", "VAT number"], ["payeRef", "PAYE reference"]]],
];

export function BusinessPage({ ctx }: { ctx: Ctx }) {
  const { api, biz } = ctx;
  const [info, setInfo] = useState<BusinessInfo | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { setInfo(null); api.business(biz.clientKey).then(setInfo).catch((e) => setErr(e instanceof ApiError ? e.message : "Couldn't load.")); }, [api, biz.clientKey]);
  if (err) return <p className="px-error" role="alert">{err}</p>;
  if (!info) return <p>Loading…</p>;
  if (!biz.can["business.details"]) return <section className="px-card"><h1>{biz.name}</h1><p className="px-muted">Your access doesn't include the full business details.</p></section>;
  return (
    <div className="px-stack">
      <h1>My business</h1>
      <p className="px-muted">These are the details {ctx.cfg.practiceName} holds for {biz.name}.</p>
      {GROUPS.map(([title, fields]) => {
        const shown = fields.filter(([k]) => info.details[k]);
        return (
          <section className="px-card" key={title} aria-labelledby={`bp-${title}`}>
            <h2 id={`bp-${title}`}>{title}</h2>
            {shown.length ? <dl className="px-dl">{shown.map(([k, label]) => <div key={k}><dt>{label}</dt><dd>{info.details[k]}</dd></div>)}</dl> : <p className="px-muted" style={{ margin: 0 }}>Nothing recorded.</p>}
          </section>
        );
      })}
    </div>
  );
}
