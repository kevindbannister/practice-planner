import { PointerEvent as RPointerEvent, forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ApiError, SignRequest } from "./api";
import { save, toBlob } from "./files";
import type { Ctx } from "./PortalApp";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const STATUS: Record<string, [string, string]> = { out: ["Open", "attn"], completed: ["Signed by everyone", "ok"], cancelled: ["Cancelled", "muted"], declined: ["Declined", "bad"], expired: ["Expired", "bad"] };

export function Signing({ ctx }: { ctx: Ctx }) {
  const { api, biz } = ctx;
  const [list, setList] = useState<SignRequest[] | null>(null);
  const [err, setErr] = useState("");
  const [openId, setOpenId] = useState("");
  const load = () => api.signing(biz.clientKey).then((r) => { setList(r.requests); setErr(""); }).catch((e) => setErr(e instanceof ApiError ? e.message : "Couldn't load your documents to sign."));
  useEffect(() => { void load(); }, [biz.clientKey]);
  const todo = list?.filter((r) => r.status === "out" && r.you.status === "pending") || [];
  const rest = list?.filter((r) => !todo.includes(r)) || [];
  return (
    <div className="px-stack">
      <h1>Documents to sign</h1>
      {err && <p className="px-error" role="alert">{err}</p>}
      {!list && !err && <p className="px-muted">Loading…</p>}
      {list && !list.length && <p className="px-card px-muted">Nothing has been sent to you for signing. You can only sign a document that {ctx.cfg.practiceName} has named you for.</p>}
      {todo.length > 0 && <section className="px-card px-stack" aria-labelledby="sg-todo"><h2 id="sg-todo" style={{ margin: 0 }}>Waiting for your signature</h2>{todo.map((r) => <Item key={r.id} ctx={ctx} r={r} open={openId === r.id} toggle={() => setOpenId(openId === r.id ? "" : r.id)} onChanged={load} />)}</section>}
      {rest.length > 0 && <section className="px-card px-stack" aria-labelledby="sg-rest"><h2 id="sg-rest" style={{ margin: 0 }}>Everything else</h2>{rest.map((r) => <Item key={r.id} ctx={ctx} r={r} open={openId === r.id} toggle={() => setOpenId(openId === r.id ? "" : r.id)} onChanged={load} />)}</section>}
    </div>
  );
}

function Item({ ctx, r, open, toggle, onChanged }: { ctx: Ctx; r: SignRequest; open: boolean; toggle: () => void; onChanged: () => void }) {
  const [label, tone] = r.status === "out" && r.you.status === "signed" ? ["You've signed. Waiting for others", "ok"] : r.status === "out" && r.you.status === "waiting" ? ["Not your turn yet", "muted"] : STATUS[r.status];
  return (
    <div className="px-item">
      <div className="px-row"><button type="button" className="px-link px-title" aria-expanded={open} onClick={toggle}>{r.title}</button><span className={`px-chip ${tone}`}>{label}</span></div>
      <div className="px-fine">Sent {day(r.createdAt)} by {r.requestedBy}{r.status === "out" ? ` · expires ${day(r.expiresAt)}` : ""}</div>
      {open && <Detail ctx={ctx} r={r} onChanged={onChanged} />}
    </div>
  );
}

function Detail({ ctx, r, onChanged }: { ctx: Ctx; r: SignRequest; onChanged: () => void }) {
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<{ fileName: string } | null>(null);
  const [err, setErr] = useState("");
  const canSign = r.status === "out" && r.you.status === "pending";
  useEffect(() => {
    let live = "";
    if (r.status === "out" || r.status === "completed") {
      void ctx.api.signingDocument(ctx.biz.clientKey, r.id).then((f) => { live = URL.createObjectURL(toBlob(f)); setUrl(live); setFile(f); }).catch((e) => setErr(e instanceof ApiError ? e.message : "Couldn't open the document."));
    }
    return () => { if (live) URL.revokeObjectURL(live); };
  }, [r.id]);
  return (
    <div className="px-stack" style={{ gap: 10, marginTop: 10 }}>
      {r.message && <p style={{ margin: 0 }}>{r.message}</p>}
      {r.others.length > 0 && <p className="px-fine" style={{ margin: 0 }}>Also signing: {r.others.map((o) => `${o.name} (${o.status === "signed" ? "signed" : o.status === "declined" ? "declined" : "not yet"})`).join(", ")}.{r.sequential ? " They sign in order." : ""}</p>}
      {err && <p className="px-error" role="alert">{err}</p>}
      {url && <object className="px-preview" data={url} type="application/pdf" aria-label={`The document: ${r.title}`}><p className="px-fine">Your browser can't show the document here. Please download it to read it before you sign.</p></object>}
      {file && <div><button type="button" className="px-btn small secondary" onClick={() => void ctx.api.signingDocument(ctx.biz.clientKey, r.id).then(save)}>Download to read</button></div>}
      {r.status === "completed" && <p>Everyone has signed. The signed copy and its certificate are in your <a href="#/documents">Documents</a>.</p>}
      {r.status === "declined" && <p className="px-fine">This request was declined, so nothing was signed. {ctx.cfg.practiceName} will be in touch.</p>}
      {canSign && <SignBox ctx={ctx} r={r} onChanged={onChanged} />}
    </div>
  );
}

function SignBox({ ctx, r, onChanged }: { ctx: Ctx; r: SignRequest; onChanged: () => void }) {
  const [mode, setMode] = useState<"typed" | "drawn">("typed");
  const [name, setName] = useState(ctx.me.user.name || "");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const pad = useRef<DrawPad>(null);
  const go = async () => {
    setBusy(true); setErr("");
    try {
      const image = mode === "drawn" ? pad.current?.png() : undefined;
      await ctx.api.sign(ctx.biz.clientKey, r.id, { mode, typedName: name, image, consent });
      onChanged();
    } catch (e) { setErr(e instanceof ApiError ? e.message : "That didn't work. Please try again."); } finally { setBusy(false); }
  };
  const decline = async () => {
    setBusy(true); setErr("");
    try { await ctx.api.declineSigning(ctx.biz.clientKey, r.id, reason); onChanged(); } catch (e) { setErr(e instanceof ApiError ? e.message : "That didn't work."); } finally { setBusy(false); }
  };
  return (
    <div className="px-stack" style={{ gap: 10, borderTop: "1px solid var(--p-line)", paddingTop: 12 }}>
      <h3 style={{ margin: 0 }}>Sign this document</h3>
      <div role="tablist" aria-label="How to sign" className="px-actions">
        <button type="button" role="tab" aria-selected={mode === "typed"} className={`px-btn small ${mode === "typed" ? "" : "secondary"}`} onClick={() => setMode("typed")}>Type my name</button>
        <button type="button" role="tab" aria-selected={mode === "drawn"} className={`px-btn small ${mode === "drawn" ? "" : "secondary"}`} onClick={() => setMode("drawn")}>Draw my signature</button>
      </div>
      {mode === "typed" ? (
        <label className="px-field"><span>Your full name</span><input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
      ) : <DrawPad ref={pad} />}
      <label className="px-consent"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> <span>{r.consent}</span></label>
      {err && <p className="px-error" role="alert">{err}</p>}
      <div className="px-actions">
        <button type="button" className="px-btn" disabled={busy || !consent} onClick={() => void go()}>{busy ? "Signing…" : "Sign document"}</button>
        <button type="button" className="px-btn secondary" disabled={busy} onClick={() => setDeclining(!declining)}>I can't sign this</button>
      </div>
      {declining && (
        <div className="px-stack" style={{ gap: 8 }}>
          <label className="px-field"><span>Tell us why (optional)</span><textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
          <div><button type="button" className="px-btn small" disabled={busy} onClick={() => void decline()}>Decline to sign</button></div>
        </div>
      )}
    </div>
  );
}

type DrawPad = { png: () => string };

/** A drawing area that works with finger, pen or mouse. The transparent PNG is what is sent. */
const DrawPad = forwardRef<DrawPad>(function DrawPad(_, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<[number, number] | null>(null);
  const [inked, setInked] = useState(false);
  useImperativeHandle(ref, () => ({ png: () => canvas.current!.toDataURL("image/png") }));
  const at = (e: RPointerEvent) => {
    const c = canvas.current!, b = c.getBoundingClientRect();
    return [((e.clientX - b.left) * c.width) / b.width, ((e.clientY - b.top) * c.height) / b.height] as [number, number];
  };
  const line = (from: [number, number], to: [number, number]) => {
    const g = canvas.current!.getContext("2d")!;
    g.lineWidth = 3; g.lineCap = "round"; g.lineJoin = "round"; g.strokeStyle = "#0b2a5b";
    g.beginPath(); g.moveTo(...from); g.lineTo(...to); g.stroke();
  };
  const clear = () => { const c = canvas.current!; c.getContext("2d")!.clearRect(0, 0, c.width, c.height); setInked(false); };
  return (
    <div className="px-stack" style={{ gap: 6 }}>
      <canvas ref={canvas} width={640} height={200} className="px-pad" aria-label="Signature drawing area. If you can't draw here, choose Type my name instead."
        onPointerDown={(e) => { drawing.current = true; canvas.current!.setPointerCapture(e.pointerId); const p = at(e); last.current = p; line(p, [p[0] + 0.1, p[1]]); setInked(true); }}
        onPointerMove={(e) => { if (!drawing.current || !last.current) return; const p = at(e); line(last.current, p); last.current = p; }}
        onPointerUp={() => { drawing.current = false; last.current = null; }} onPointerCancel={() => { drawing.current = false; last.current = null; }} />
      <div className="px-row"><span className="px-fine">{inked ? "Draw again if you want to change it." : "Draw your signature above."}</span><button type="button" className="px-btn small ghost" onClick={clear}>Clear</button></div>
    </div>
  );
});
