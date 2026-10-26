import { useEffect, useState } from "react";
import { BusinessInfo, ChangeRequest } from "./api";
import { readable } from "./format";
import type { Ctx } from "./PortalApp";

export function Dashboard({ ctx }: { ctx: Ctx }) {
  const { me, biz, api, go } = ctx;
  const [info, setInfo] = useState<BusinessInfo | null>(null);
  const [changes, setChanges] = useState<ChangeRequest[]>([]);
  useEffect(() => { void api.business(biz.clientKey).then(setInfo).catch(() => setInfo(null)); }, [api, biz.clientKey]);
  useEffect(() => {
    setChanges([]);
    if (biz.can["business.requestChange"]) void api.changes(biz.clientKey).then((r) => setChanges(r.requests)).catch(() => undefined);
  }, [api, biz.clientKey, biz.can]);
  const asked = changes.filter((r) => r.status === "clarification");
  const waiting = changes.filter((r) => r.status === "pending");
  const first = me.user.name.split(" ")[0] || "there";
  const d = readable(info?.details || {});
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
        {!asked.length && <p className="px-muted" style={{ margin: 0 }}>Nothing needs your attention right now.</p>}
        {asked.map((r) => (
          <div className="px-row" key={r.id}><span>We've asked you a question about your requested changes ({r.items.map((i) => i.label.toLowerCase()).join(", ")}).</span><button type="button" className="px-btn small" onClick={() => go("business")}>Answer</button></div>
        ))}
        {waiting.length > 0 && <p className="px-fine" style={{ margin: "8px 0 0" }}>{waiting.length === 1 ? "1 change request is" : `${waiting.length} change requests are`} with us for checking.</p>}
      </section>
    </div>
  );
}
