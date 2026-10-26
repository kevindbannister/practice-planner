import { useEffect, useState } from "react";
import { BusinessInfo, ChangeRequest, IdItem, InfoRequest, Notice, PortalDoc, SignRequest } from "./api";
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
  const [sign, setSign] = useState<SignRequest[]>([]);
  useEffect(() => {
    setSign([]);
    if (biz.can["signing.sign"]) void api.signing(biz.clientKey).then((r) => setSign(r.requests)).catch(() => undefined);
  }, [api, biz.clientKey, biz.can]);
  const [ids, setIds] = useState<IdItem[]>([]);
  useEffect(() => { if (me.identity?.any) void api.identity().then((r) => setIds(r.items)).catch(() => undefined); }, [api, me.identity?.any]);
  const [reqs, setReqs] = useState<InfoRequest[]>([]);
  useEffect(() => {
    setReqs([]);
    if (biz.can["requests.respond"]) void api.infoRequests(biz.clientKey).then((r) => setReqs(r.requests)).catch(() => undefined);
  }, [api, biz.clientKey, biz.can]);
  const [notes, setNotes] = useState<{ notices: Notice[]; unread: number }>({ notices: [], unread: 0 });
  useEffect(() => { setNotes({ notices: [], unread: 0 }); void api.notices(biz.clientKey).then(setNotes).catch(() => undefined); }, [api, biz.clientKey]);
  const markRead = () => void api.readNotices(biz.clientKey).then(setNotes).catch(() => undefined);
  const openReqs = reqs.filter((r) => r.status === "open");
  const idTodo = ids.filter((i) => i.canUpload && !i.request?.uploaded);
  const toSign = sign.filter((r) => r.status === "out" && r.you.status === "pending");
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
        {openReqs.map((r) => (
          <div className="px-row" key={r.id}><span>We need something from you: {r.title}.</span><button type="button" className="px-btn small" onClick={() => go("requests")}>Answer</button></div>
        ))}
        {idTodo.map((i) => (
          <div className="px-row" key={i.id}><span>{i.request?.reason === "renewal" ? `Your ${i.title.toLowerCase()} is due to expire. We need a new one.` : `We need your ${i.title.toLowerCase()}.`}</span><button type="button" className="px-btn small" onClick={() => go("identity")}>Send it</button></div>
        ))}
        {toSign.map((r) => (
          <div className="px-row" key={r.id}><span>"{r.title}" is waiting for your signature.</span><button type="button" className="px-btn small" onClick={() => go("signing")}>Review and sign</button></div>
        ))}
        {toApprove.map((d) => (
          <div className="px-row" key={d.id}><span>"{d.title}" needs your approval.</span><button type="button" className="px-btn small" onClick={() => go("documents")}>Review</button></div>
        ))}
        {!openReqs.length && !asked.length && !toApprove.length && !toSign.length && !idTodo.length && <p className="px-muted" style={{ margin: 0 }}>Nothing needs your attention right now.</p>}
        {asked.map((r) => (
          <div className="px-row" key={r.id}><span>We've asked you a question about your requested changes ({r.items.map((i) => i.label.toLowerCase()).join(", ")}).</span><button type="button" className="px-btn small" onClick={() => go("business")}>Answer</button></div>
        ))}
        {waiting.length > 0 && <p className="px-fine" style={{ margin: "8px 0 0" }}>{waiting.length === 1 ? "1 change request is" : `${waiting.length} change requests are`} with us for checking.</p>}
      </section>
      {notes.notices.length > 0 && (
        <section className="px-card" aria-labelledby="d-note">
          <div className="px-row"><h2 id="d-note" style={{ margin: 0 }}>Notifications{notes.unread > 0 ? ` (${notes.unread} new)` : ""}</h2>{notes.unread > 0 && <button type="button" className="px-btn small secondary" onClick={markRead}>Mark all as read</button>}</div>
          {notes.notices.slice(0, 6).map((n) => <div className="px-row" key={n.id} style={{ padding: "4px 0" }}><span style={{ fontWeight: n.read ? 400 : 700 }}>{n.text}</span><span className="px-fine">{new Date(n.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span></div>)}
        </section>
      )}
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
