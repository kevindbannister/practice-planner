import { useEffect, useRef, useState } from "react";
import { ApiError, IdItem } from "./api";
import { MAX_MB, readFile } from "./files";
import type { Ctx } from "./PortalApp";

const day = (iso: string) => (iso ? new Date(iso.slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "");
const LABEL: Record<string, [string, string]> = {
  needed: ["We need this from you", "attn"], rejected: ["We need another one", "attn"], received: ["Received. We're checking it", "ok"], accepted: ["Accepted", "ok"], expired: ["Out of date. Please send a new one", "bad"], none: ["", "muted"],
};

/** The person's own identity documents. Nobody else at their business can see this page's content. */
export function Identity({ ctx }: { ctx: Ctx }) {
  const [items, setItems] = useState<IdItem[] | null>(null);
  const [err, setErr] = useState("");
  const load = () => ctx.api.identity().then((r) => { setItems(r.items); setErr(""); }).catch((e) => setErr(e instanceof ApiError ? e.message : "Couldn't load this page."));
  useEffect(() => { void load(); }, []);
  const todo = items?.filter((i) => i.canUpload && !i.request?.uploaded) || [];
  const rest = items?.filter((i) => !todo.includes(i)) || [];
  return (
    <div className="px-stack">
      <h1>Identity documents</h1>
      <p className="px-muted" style={{ margin: 0 }}>These are private to you. Other people at your business can't see them, and neither can administrators there. Only {ctx.cfg.practiceName} can.</p>
      {err && <p className="px-error" role="alert">{err}</p>}
      {!items && !err && <p className="px-muted">Loading…</p>}
      {items && !items.length && <p className="px-card px-muted">{ctx.cfg.practiceName} hasn't asked you for any identity documents.</p>}
      {todo.length > 0 && <section className="px-card px-stack" aria-labelledby="idn-todo"><h2 id="idn-todo" style={{ margin: 0 }}>Please send</h2>{todo.map((i) => <Item key={i.id} ctx={ctx} i={i} onDone={load} />)}</section>}
      {rest.length > 0 && <section className="px-card px-stack" aria-labelledby="idn-rest"><h2 id="idn-rest" style={{ margin: 0 }}>Your documents</h2>{rest.map((i) => <Item key={i.id} ctx={ctx} i={i} onDone={load} />)}</section>}
    </div>
  );
}

function Item({ ctx, i, onDone }: { ctx: Ctx; i: IdItem; onDone: () => void }) {
  const [label, tone] = LABEL[i.status] || ["", "muted"];
  const input = useRef<HTMLInputElement>(null);
  const [issue, setIssue] = useState("");
  const [expiry, setExpiry] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const send = async () => {
    const f = input.current?.files?.[0];
    if (!f) return setErr("Choose a file first.");
    setBusy(true); setErr("");
    try { await ctx.api.uploadIdentity(i.id, { ...(await readFile(f)), issueDate: issue, expiryDate: expiry }); onDone(); } catch (e) { setErr(e instanceof Error ? e.message : "That didn't work. Please try again."); } finally { setBusy(false); }
  };
  return (
    <div className="px-item">
      <div className="px-row"><strong>{i.title}</strong>{label && <span className={`px-chip ${tone}`}>{label}</span>}</div>
      {i.businesses.length > 0 && <div className="px-fine">Used for {i.businesses.join(", ")}</div>}
      {i.request?.reason === "renewal" && !i.request.uploaded && <p style={{ margin: "6px 0 0" }}>The one we hold is due to expire, so we need a new one.</p>}
      {i.request?.rejectedReason && !i.request.uploaded && <p style={{ margin: "6px 0 0" }}>We couldn't accept the last one: {i.request.rejectedReason}</p>}
      {i.request?.note && !i.request.uploaded && <p style={{ margin: "6px 0 0" }}>{i.request.note}</p>}
      {i.request?.uploaded && <p className="px-fine" style={{ margin: "6px 0 0" }}>You sent this on {day(i.request.uploadedAt)}. We'll tell you if we need anything else.</p>}
      {i.current && !i.request && <p className="px-fine" style={{ margin: "6px 0 0" }}>Accepted on {day(i.current.acceptedAt)}{i.current.expiryDate ? `. Expires ${day(i.current.expiryDate)}` : ""}.{i.nextRenewal ? ` We'll ask for a new one on ${day(i.nextRenewal)}.` : ""}</p>}
      {i.canUpload && !i.request?.uploaded && (
        <div className="px-stack" style={{ gap: 8, marginTop: 10 }}>
          <label className="px-field"><span>Photo or scan (PDF, JPG or PNG, up to {MAX_MB} MB)</span><input ref={input} type="file" accept=".pdf,.jpg,.jpeg,.png" /></label>
          <div className="px-filters">
            <label className="px-field"><span>Issue date, if it shows one (optional)</span><input type="date" value={issue} onChange={(e) => setIssue(e.target.value)} /></label>
            <label className="px-field"><span>Expiry date, if it shows one (optional)</span><input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} /></label>
          </div>
          {err && <p className="px-error" role="alert">{err}</p>}
          <div><button type="button" className="px-btn" disabled={busy} onClick={() => void send()}>{busy ? "Sending…" : "Send"}</button></div>
        </div>
      )}
    </div>
  );
}
