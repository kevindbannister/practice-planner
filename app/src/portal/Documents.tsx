import { useEffect, useRef, useState } from "react";
import { ApiError, DocList, PortalDoc } from "./api";
import { ACCEPT, MAX_MB, readFile, save, size, toBlob } from "./files";
import type { Ctx } from "./PortalApp";

const STATUS: Record<string, [string, string]> = {
  published: ["Available", "muted"], received: ["Received by us", "ok"], "awaiting-approval": ["Needs your approval", "attn"], approved: ["Approved", "ok"], declined: ["Declined", "bad"],
};
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function Documents({ ctx }: { ctx: Ctx }) {
  const { api, biz } = ctx;
  const [data, setData] = useState<DocList | null>(null);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [err, setErr] = useState("");
  const [openId, setOpenId] = useState("");
  const load = () => api.documents(biz.clientKey, { q, category, status }).then((d) => { setData(d); setErr(""); }).catch((e) => setErr(e instanceof ApiError ? e.message : "Couldn't load your documents."));
  useEffect(() => { const t = setTimeout(() => void load(), q ? 250 : 0); return () => clearTimeout(t); }, [biz.clientKey, q, category, status]);
  return (
    <div className="px-stack">
      <h1>Documents</h1>
      {data?.canUpload && <UploadBox ctx={ctx} categories={data.categories} onDone={load} />}
      <section className="px-card px-stack" aria-labelledby="dc-h" style={{ gap: 12 }}>
        <h2 id="dc-h" style={{ margin: 0 }}>Your documents</h2>
        <div className="px-filters">
          <label className="px-field"><span>Search</span><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or type of document" /></label>
          <label className="px-field"><span>Category</span><select value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All</option>{data?.categories.map((c) => <option key={c}>{c}</option>)}</select></label>
          <label className="px-field"><span>Status</span><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option><option value="awaiting-approval">Needs your approval</option><option value="approved">Approved</option><option value="received">Sent by you</option></select></label>
        </div>
        {err && <p className="px-error" role="alert">{err}</p>}
        {!data && !err && <p className="px-muted">Loading…</p>}
        {data && !data.documents.length && <p className="px-muted" style={{ margin: 0 }}>{q || category || status ? "Nothing matches that." : "Nothing has been shared with you yet. When " + ctx.cfg.practiceName + " shares a document, it will appear here."}</p>}
        {data && data.documents.length > 0 && (
          <ul className="px-docs">
            {data.documents.map((d) => <DocRow key={d.id} ctx={ctx} d={d} canApprove={data.canApprove} open={openId === d.id} toggle={() => setOpenId(openId === d.id ? "" : d.id)} onChanged={load} />)}
          </ul>
        )}
      </section>
    </div>
  );
}

function UploadBox({ ctx, categories, onDone }: { ctx: Ctx; categories: string[]; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("From you");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const send = async () => {
    const f = input.current?.files?.[0];
    if (!f) return setErr("Choose a file first.");
    setBusy(true); setErr(""); setOk("");
    try {
      const file = await readFile(f);
      await ctx.api.uploadDocument(ctx.biz.clientKey, { title, category, message, ...file });
      setOk(`Thanks, we've received ${f.name}.`);
      setTitle(""); setMessage(""); if (input.current) input.current.value = "";
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That didn't work. Please try again.");
    } finally { setBusy(false); }
  };
  return (
    <section className="px-card px-stack" aria-labelledby="up-h" style={{ gap: 10 }}>
      <h2 id="up-h" style={{ margin: 0 }}>Send us a document</h2>
      <p className="px-muted" style={{ margin: 0 }}>PDF, Word, Excel, PNG, JPG, CSV or text files, up to {MAX_MB} MB. Files are checked before we keep them.</p>
      <label className="px-field"><span>File</span><input ref={input} type="file" accept={ACCEPT} /></label>
      <label className="px-field"><span>Name (optional)</span><input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} /></label>
      <label className="px-field"><span>Type</span><select value={category} onChange={(e) => setCategory(e.target.value)}>{categories.map((c) => <option key={c}>{c}</option>)}</select></label>
      <label className="px-field"><span>Message for us (optional)</span><textarea rows={2} maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} /></label>
      {err && <p className="px-error" role="alert">{err}</p>}
      {ok && <p role="status" className="px-ok">{ok}</p>}
      <div><button type="button" className="px-btn" disabled={busy} onClick={() => void send()}>{busy ? "Sending…" : "Send"}</button></div>
    </section>
  );
}

function DocRow({ ctx, d, canApprove, open, toggle, onChanged }: { ctx: Ctx; d: PortalDoc; canApprove: boolean; open: boolean; toggle: () => void; onChanged: () => void }) {
  const [label, tone] = STATUS[d.status] || [d.status, "muted"];
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [preview, setPreview] = useState<{ url: string; ext: string } | null>(null);
  const [note, setNote] = useState("");
  const replace = useRef<HTMLInputElement>(null);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  const run = async (fn: () => Promise<void>) => { setBusy(true); setErr(""); try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : "That didn't work."); } finally { setBusy(false); } };
  const get = (n?: number) => run(async () => save(await ctx.api.downloadDocument(ctx.biz.clientKey, d.id, n)));
  const show = () => run(async () => { const f = await ctx.api.downloadDocument(ctx.biz.clientKey, d.id); setPreview({ url: URL.createObjectURL(toBlob(f)), ext: d.ext }); });
  const decide = (decision: "approved" | "declined") => run(async () => { await ctx.api.approveDocument(ctx.biz.clientKey, d.id, decision, note); setNote(""); onChanged(); });
  const newVersion = () => run(async () => { const f = replace.current?.files?.[0]; if (!f) throw new Error("Choose a file first."); await ctx.api.uploadDocument(ctx.biz.clientKey, { replaces: d.id, ...(await readFile(f)) }); onChanged(); });
  const mine = d.from === "client";
  return (
    <li className="px-item">
      <div className="px-row">
        <button type="button" className="px-link px-title" aria-expanded={open} onClick={toggle}>{d.title}</button>
        <span className={`px-chip ${tone}`}>{label}</span>
      </div>
      <div className="px-fine">{d.category} · {d.ext.toUpperCase()} · {size(d.size)} · {mine ? "Sent by you" : `From ${ctx.cfg.practiceName}`} · {day(d.updatedAt)}</div>
      {open && (
        <div className="px-stack" style={{ gap: 10, marginTop: 10 }}>
          {d.message && <p style={{ margin: 0 }}>{d.message}</p>}
          <div className="px-actions">
            <button type="button" className="px-btn small" disabled={busy} onClick={() => void get()}>Download</button>
            {d.previewable && <button type="button" className="px-btn small secondary" disabled={busy} onClick={() => (preview ? setPreview(null) : void show())}>{preview ? "Close preview" : "Preview"}</button>}
          </div>
          {preview && (d.ext === "pdf"
            ? <object className="px-preview" data={preview.url} type="application/pdf" aria-label={`Preview of ${d.title}`}><p className="px-fine">Your browser can't show this here. Please use Download.</p></object>
            : <img className="px-preview-img" src={preview.url} alt={`Preview of ${d.title}`} />)}
          {d.needsApproval && d.approval && <p className="px-fine" style={{ margin: 0 }}>{d.approval.status === "approved" ? "Approved" : "Declined"} by {d.approval.by} on {day(d.approval.at)}{d.approval.note ? `: ${d.approval.note}` : ""}.</p>}
          {d.needsApproval && d.status === "awaiting-approval" && canApprove && (
            <div className="px-stack" style={{ gap: 8 }}>
              <label className="px-field"><span>Comment (optional)</span><input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></label>
              <div className="px-actions"><button type="button" className="px-btn small" disabled={busy} onClick={() => void decide("approved")}>Approve</button><button type="button" className="px-btn small secondary" disabled={busy} onClick={() => void decide("declined")}>Decline</button></div>
            </div>
          )}
          {d.versions.length > 1 && (
            <details><summary>Earlier versions ({d.versions.length - 1})</summary>
              <ul className="px-vers">{d.versions.slice(0, -1).reverse().map((v) => <li key={v.n} className="px-row"><span>Version {v.n} · {v.fileName} · {day(v.at)}</span><button type="button" className="px-link" onClick={() => void get(v.n)}>Download</button></li>)}</ul>
            </details>
          )}
          {mine && (
            <div className="px-actions"><input ref={replace} type="file" accept={ACCEPT} aria-label="Replacement file" /><button type="button" className="px-btn small secondary" disabled={busy} onClick={() => void newVersion()}>Replace with a new version</button></div>
          )}
          {err && <p className="px-error" role="alert">{err}</p>}
        </div>
      )}
    </li>
  );
}
