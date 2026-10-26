import { useEffect, useRef, useState } from "react";
import { InfoRequest } from "./api";
import { ACCEPT, MAX_MB, readFile } from "./files";
import type { Ctx } from "./PortalApp";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const LABEL: Record<string, string> = { open: "Waiting for you", responded: "Sent to us", complete: "Done", cancelled: "Cancelled" };

export function Requests({ ctx }: { ctx: Ctx }) {
  const [list, setList] = useState<InfoRequest[] | null>(null);
  const [canUpload, setCanUpload] = useState(false);
  const [err, setErr] = useState("");
  const load = () => ctx.api.infoRequests(ctx.biz.clientKey).then((r) => { setList(r.requests); setCanUpload(r.canUpload); }).catch((e) => setErr(e instanceof Error ? e.message : "Couldn't load."));
  useEffect(() => { void load(); }, [ctx.biz.clientKey]);
  return (
    <div className="px-stack">
      <h1>Requests from us</h1>
      <p className="px-muted">Things we need from you. Answer here and we'll be told straight away.</p>
      {err && <p className="px-error" role="alert">{err}</p>}
      {list && !list.length && <section className="px-card"><p style={{ margin: 0 }}>We haven't asked you for anything.</p></section>}
      {list?.map((r) => <Item key={r.id} ctx={ctx} r={r} canUpload={canUpload} onDone={load} />)}
    </div>
  );
}

function Item({ ctx, r, canUpload, onDone }: { ctx: Ctx; r: InfoRequest; canUpload: boolean; onDone: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const finished = r.status === "complete";
  const send = async () => {
    setBusy(true); setErr("");
    try {
      const files = [];
      for (const f of Array.from<File>(input.current?.files ? Array.from(input.current.files) : [])) files.push(await readFile(f));
      await ctx.api.respondRequest(ctx.biz.clientKey, r.id, { text, files });
      setText(""); if (input.current) input.current.value = "";
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : "That didn't work. Please try again."); } finally { setBusy(false); }
  };
  return (
    <section className="px-card px-stack" aria-label={r.title} style={{ gap: 8 }}>
      <div className="px-row"><h2 style={{ margin: 0 }}>{r.title}</h2><span className="px-fine">{LABEL[r.status]}</span></div>
      <div className="px-fine">Asked {day(r.createdAt)}{r.dueDate ? ` · needed by ${day(r.dueDate)}` : ""}</div>
      {r.details && <p style={{ margin: 0 }}>{r.details}</p>}
      {r.thread.map((t, i) => <div key={i} style={{ borderLeft: "3px solid var(--p-line)", paddingLeft: 10 }}><strong>{t.from === "client" ? "You" : t.name}</strong> <span className="px-fine">{day(t.at)}</span><div>{t.text}</div>{t.docs.length > 0 && <div className="px-fine">Sent: {t.docs.map((d) => d.title).join(", ")}</div>}</div>)}
      {!finished && (
        <div className="px-stack px-form" style={{ gap: 8 }}>
          <label className="px-field">Your answer<textarea rows={3} value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} /></label>
          {canUpload && <label className="px-field">Attach files (optional)<input ref={input} type="file" multiple accept={ACCEPT} /><span className="px-fine" style={{ fontWeight: 400 }}>Up to {MAX_MB} MB each.</span></label>}
          {err && <p className="px-error" role="alert" style={{ margin: 0 }}>{err}</p>}
          <div><button type="button" className="px-btn" disabled={busy} onClick={() => void send()}>{busy ? "Sending…" : "Send to us"}</button></div>
        </div>
      )}
    </section>
  );
}
