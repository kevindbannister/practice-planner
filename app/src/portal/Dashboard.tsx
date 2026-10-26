import { useEffect, useState } from "react";
import { BusinessInfo } from "./api";
import type { Ctx } from "./PortalApp";

export function Dashboard({ ctx }: { ctx: Ctx }) {
  const { me, biz, api, go } = ctx;
  const [info, setInfo] = useState<BusinessInfo | null>(null);
  useEffect(() => { void api.business(biz.clientKey).then(setInfo).catch(() => setInfo(null)); }, [api, biz.clientKey]);
  const first = me.user.name.split(" ")[0] || "there";
  const d = info?.details || {};
  return (
    <div className="px-stack">
      <h1>Welcome, {first}</h1>
      <section className="px-card" aria-labelledby="d-biz">
        <h2 id="d-biz">{biz.name}</h2>
        <p className="px-muted">You have {biz.levelLabel.toLowerCase()} access to this business.</p>
        {info && (
          <dl className="px-dl">
            {d.companyNumber && <div><dt>Company number</dt><dd>{d.companyNumber}</dd></div>}
            {d.yearEnd && <div><dt>Year end</dt><dd>{d.yearEnd}</dd></div>}
            {d.registeredOffice && <div><dt>Registered office</dt><dd>{d.registeredOffice}</dd></div>}
          </dl>
        )}
        {biz.can["business.details"] && <p><button type="button" className="px-link" onClick={() => go("business")}>See all business details</button></p>}
      </section>
      <section className="px-card" aria-labelledby="d-attn">
        <h2 id="d-attn">Needs your attention</h2>
        <p className="px-muted" style={{ margin: 0 }}>Nothing needs your attention right now.</p>
      </section>
    </div>
  );
}
