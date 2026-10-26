import { useEffect, useState } from "react";
import { BusinessInfo, ChangeRequest, PortalDoc } from "./api";
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
  const [docs, setDocs] = useState<PortalDoc[]>([]);
  useEffect(() => {
    setDocs([]);
    if (biz.can["documents.view"]) void api.documents(biz.clientKey).then((r) => setDocs(r.documents)).catch(() => undefined);
  }, [api, biz.clientKey, biz.can]);
  const toApprove = docs.filter((d) => d.status === "awaiting-approval");
  const recent = docs.filter((d) => d.from === "practice").slice(0, 3);
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
        {toApprove.map((d) => (
          <div className="px-row" key={d.id}><span>"{d.title}" needs your approval.</span><button type="button" className="px-btn small" onClick={() => go("documents")}>Review</button></div>
        ))}
        {!asked.length && !toApprove.length && <p className="px-muted" style={{ margin: 0 }}>Nothing needs your attention right now.</p>}
        {asked.map((r) => (
          <div className="px-row" key={r.id}><span>We've asked you a question about your requested changes ({r.items.map((i) => i.label.toLowerCase()).join(", ")}).</span><button type="button" className="px-btn small" onClick={() => go("business")}>Answer</button></div>
        ))}
        {waiting.length > 0 && <p className="px-fine" style={{ margin: "8px 0 0" }}>{waiting.length === 1 ? "1 change request is" : `${waiting.length} change requests are`} with us for checking.</p>}
      </section>
      {recent.length > 0 && (
        <section className="px-card" aria-labelledby="d-docs">
          <h2 id="d-docs">Latest documents</h2>
          {recent.map((d) => <div className="px-row" key={d.id} style={{ padding: "4px 0" }}><span>{d.title}</span><span className="px-fine">{new Date(d.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span></div>)}
          <p><button type="button" className="px-link" onClick={() => go("documents")}>See all documents</button></p>
        </section>
      )}
    </div>
  );
}
