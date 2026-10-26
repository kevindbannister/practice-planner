import { RefObject, useEffect, useRef, useState } from "react";
import { Msg, MsgThread } from "./api";
import { ACCEPT, MAX_MB, readFile } from "./files";
import type { Ctx } from "./PortalApp";

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const oops = (e: unknown) => (e instanceof Error ? e.message : "That didn't work. Please try again.");

export function Messages({ ctx }: { ctx: Ctx }) {
  const key = ctx.biz.clientKey;
  const [list, setList] = useState<MsgThread[] | null>(null);
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState("");
  const [composing, setComposing] = useState(false);
  const [err, setErr] = useState("");
  const load = (query = q) => ctx.api.messages(key, query).then((r) => { setList(r.threads); setErr(""); if (!query) window.dispatchEvent(new CustomEvent("px:unread", { detail: r.unread })); }).catch((e) => setErr(oops(e)));
  useEffect(() => { void load(""); }, [key]);
  if (openId) return <Thread ctx={ctx} id={openId} onBack={() => { setOpenId(""); void load(); }} />;
  return (
    <div className="px-stack">
      <div className="px-row"><h1 style={{ margin: 0 }}>Messages</h1><button type="button" className="px-btn" onClick={() => setComposing(!composing)}>{composing ? "Close" : "New message"}</button></div>
      <p className="px-muted" style={{ margin: 0 }}>A private way to talk to {ctx.cfg.practiceName}. We'll only email you to say there's a message here; we never put its contents in an email.</p>
      {composing && <Compose ctx={ctx} onSent={(id) => { setComposing(false); setOpenId(id); }} />}
      <form className="px-form" role="search" onSubmit={(e) => { e.preventDefault(); void load(q); }}>
        <label className="px-field">Search your messages<input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="A word from the subject or message" /></label>
      </form>
      {err && <p className="px-error" role="alert">{err}</p>}
      {list && !list.length && <section className="px-card"><p style={{ margin: 0 }}>{q ? "Nothing matches that." : "No messages yet."}</p></section>}
      {list?.map((t) => (
        <button type="button" key={t.id} className="px-card px-msgrow" onClick={() => setOpenId(t.id)} aria-label={`${t.unread ? "Unread: " : ""}${t.subject}`}>
          <span className="px-row"><strong style={{ fontWeight: t.unread ? 800 : 600 }}>{t.unread && <span className="px-dot" aria-hidden="true" />}{t.subject}</strong><span className="px-fine">{when(t.lastAt)}</span></span>
          <span className="px-fine">{t.lastFrom === "staff" ? ctx.cfg.practiceName : "You"}: {t.preview}</span>
        </button>
      ))}
    </div>
  );
}

function Attach({ ctx, input }: { ctx: Ctx; input: RefObject<HTMLInputElement | null> }) {
  if (!ctx.biz.can["documents.upload"]) return null;
  return <label className="px-field">Attach files (optional)<input ref={input} type="file" multiple accept={ACCEPT} /><span className="px-fine" style={{ fontWeight: 400 }}>Up to {MAX_MB} MB each. Files are checked before we keep them.</span></label>;
}
async function filesOf(input: RefObject<HTMLInputElement | null>) {
  const out = [];
  const fl = input.current?.files;
  const arr: File[] = fl ? Array.from(fl) : [];
  for (const f of arr) out.push(await readFile(f));
  return out;
}

function Compose({ ctx, onSent }: { ctx: Ctx; onSent: (id: string) => void }) {
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const send = async () => {
    setBusy(true); setErr("");
    try { const r = await ctx.api.startMessage(ctx.biz.clientKey, { subject, text, files: await filesOf(input) }); onSent(r.thread.id); } catch (e) { setErr(oops(e)); } finally { setBusy(false); }
  };
  return (
    <section className="px-card px-stack px-form" aria-labelledby="mc-h" style={{ gap: 10 }}>
      <h2 id="mc-h" style={{ margin: 0 }}>New message</h2>
      <label className="px-field">Subject<input value={subject} maxLength={120} onChange={(e) => setSubject(e.target.value)} /></label>
      <label className="px-field">Message<textarea rows={5} value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} /></label>
      <Attach ctx={ctx} input={input} />
      {err && <p className="px-error" role="alert" style={{ margin: 0 }}>{err}</p>}
      <div><button type="button" className="px-btn" disabled={busy} onClick={() => void send()}>{busy ? "Sending…" : "Send message"}</button></div>
    </section>
  );
}

function Thread({ ctx, id, onBack }: { ctx: Ctx; id: string; onBack: () => void }) {
  const [data, setData] = useState<{ thread: MsgThread; messages: Msg[] } | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { ctx.api.openMessage(ctx.biz.clientKey, id).then(setData).catch((e) => setErr(oops(e))); }, [id]);
  const send = async () => {
    setBusy(true); setErr("");
    try { setData(await ctx.api.replyMessage(ctx.biz.clientKey, id, { text, files: await filesOf(input) })); setText(""); if (input.current) input.current.value = ""; } catch (e) { setErr(oops(e)); } finally { setBusy(false); }
  };
  return (
    <div className="px-stack">
      <p style={{ margin: 0 }}><button type="button" className="px-link" onClick={onBack}>← All messages</button></p>
      {err && !data && <p className="px-error" role="alert">{err}</p>}
      {data && (
        <>
          <h1>{data.thread.subject}</h1>
          {data.messages.map((m) => (
            <section key={m.id} className="px-card" aria-label={`Message from ${m.from === "staff" ? m.name : "you"}`} style={{ borderLeft: `4px solid ${m.from === "staff" ? "var(--p-btn)" : "var(--p-line)"}` }}>
              <div className="px-row"><strong>{m.from === "staff" ? `${m.name} (${ctx.cfg.practiceName})` : m.name}</strong><span className="px-fine">{when(m.at)}</span></div>
              <p style={{ whiteSpace: "pre-wrap", margin: "8px 0 0" }}>{m.text}</p>
              {m.docs.length > 0 && <p className="px-fine" style={{ margin: "8px 0 0" }}>Attached: {m.docs.map((d) => d.title).join(", ")}. {ctx.biz.can["documents.view"] && <a href="#/documents">Find it in Documents</a>}</p>}
            </section>
          ))}
          <section className="px-card px-stack px-form" aria-labelledby="mr-h" style={{ gap: 10 }}>
            <h2 id="mr-h" style={{ margin: 0 }}>Reply</h2>
            <label className="px-field">Your reply<textarea rows={4} value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} /></label>
            <Attach ctx={ctx} input={input} />
            {err && <p className="px-error" role="alert" style={{ margin: 0 }}>{err}</p>}
            <div><button type="button" className="px-btn" disabled={busy} onClick={() => void send()}>{busy ? "Sending…" : "Send reply"}</button></div>
          </section>
        </>
      )}
    </div>
  );
}
