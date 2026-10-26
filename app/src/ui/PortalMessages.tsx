// Client portal, staff side: conversations with one client's portal users.
import { useEffect, useRef, useState } from "react";
import { Client, fmtDate } from "../lib/domain";
import { StaffMsg, StaffThread } from "../lib/portalAdmin";
import { ACCEPT, readFile } from "../portal/files";
import { say, usePortal } from "./portalKit";

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

async function filesFrom(el: HTMLInputElement | null) {
  const fl = el?.files;
  const arr: File[] = fl ? Array.from(fl) : [];
  const out = [];
  for (const f of arr) out.push(await readFile(f));
  return out;
}

export function ClientMessages({ client }: { client: Client }) {
  const portal = usePortal();
  const [list, setList] = useState<StaffThread[] | null>(null);
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState("");
  const [composing, setComposing] = useState(false);
  const [err, setErr] = useState("");
  const load = (query = q) => portal.run((a) => a.threads(client.Key, query)).then((r) => { setList(r); setErr(""); }).catch((e) => setErr(say(e)));
  useEffect(() => { void load(""); }, [client.Key]);
  if (portal.status && !portal.status.configured) return null;
  const unread = (list || []).filter((t) => t.unread).length;
  return (
    <section className="card pad stack" aria-labelledby="mg-h">
      <div className="row-wrap" style={{ justifyContent: "space-between" }}>
        <h2 id="mg-h" style={{ margin: 0, fontSize: 16 }}>Messages with {client.Title}{unread ? ` (${unread} waiting for you)` : ""}</h2>
        <button type="button" className="btn small primary" onClick={() => { setComposing(!composing); setOpenId(""); }}>{composing ? "Close" : "New message"}</button>
      </div>
      {composing && <Compose client={client} onSent={(id) => { setComposing(false); setOpenId(id); void load(); }} />}
      {openId ? <ThreadView id={openId} onClose={() => { setOpenId(""); void load(); }} /> : (
        <>
          <form className="row-wrap" role="search" onSubmit={(e) => { e.preventDefault(); void load(q); }}>
            <input className="input" aria-label="Search messages" placeholder="Search messages and subjects" value={q} onChange={(e) => setQ(e.target.value)} />
            <button type="submit" className="btn small">Search</button>
          </form>
          {err && <p className="import-list warn" role="alert">{err}</p>}
          {list && !list.length && <p className="muted" style={{ margin: 0 }}>{q ? "Nothing matches." : "No conversations yet."}</p>}
          {list?.map((t) => (
            <button type="button" key={t.id} className="linkbtn" style={{ textAlign: "left", display: "block", width: "100%" }} onClick={() => setOpenId(t.id)} aria-label={`${t.unread ? "Unread: " : ""}${t.subject}`}>
              <strong style={{ fontWeight: t.unread ? 800 : 500 }}>{t.unread ? "● " : ""}{t.subject}</strong> <span className="muted">{when(t.lastAt)} · {t.lastFrom === "client" ? "client" : "you"}: {t.preview}{t.assignedNames.length ? ` · for ${t.assignedNames.join(", ")}` : ""}</span>
            </button>
          ))}
        </>
      )}
    </section>
  );
}

function Compose({ client, onSent }: { client: Client; onSent: (id: string) => void }) {
  const portal = usePortal();
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const people = portal.forClient(client.Key).filter((r) => r.person.status === "active");
  const send = async () => {
    setBusy(true); setErr("");
    try { const r = await portal.run(async (a) => a.startThread({ clientKey: client.Key, subject, text, assignedTo: picked, notify, files: await filesFrom(input.current) })); onSent(r.thread.id); } catch (e) { setErr(say(e)); } finally { setBusy(false); }
  };
  return (
    <div className="stack" style={{ gap: 8 }}>
      <input className="input" aria-label="Message subject" placeholder="Subject" value={subject} maxLength={120} onChange={(e) => setSubject(e.target.value)} />
      <textarea className="input" aria-label="Message" rows={4} placeholder="Message (the client sees exactly this: there is no private note here)" value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} />
      <fieldset className="stack" style={{ gap: 4, border: "1px solid var(--line)", borderRadius: 8, padding: "8px 12px" }}>
        <legend>Who it is for</legend>
        <span className="muted" style={{ fontSize: 13 }}>{picked.length ? "Only the people ticked, plus administrators and standard users. Restricted people see it only if ticked." : "Everyone at this business who can use messages. Restricted people see only conversations they are named in."}</span>
        {people.map((p) => <label key={p.person.id} className="row-wrap"><input type="checkbox" checked={picked.includes(p.person.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, p.person.id] : picked.filter((x) => x !== p.person.id))} /> {p.person.name || p.person.email} <span className="muted">({p.levelLabel})</span></label>)}
      </fieldset>
      <label className="row-wrap">Attach files <input ref={input} type="file" multiple accept={ACCEPT} aria-label="Attach files" /></label>
      <label className="row-wrap"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Email them that there is a new message (the email never includes the message)</label>
      {err && <p className="import-list warn" role="alert">{err}</p>}
      <div><button type="button" className="btn small primary" disabled={busy || !subject.trim()} onClick={() => void send()}>Send message</button></div>
    </div>
  );
}

function ThreadView({ id, onClose }: { id: string; onClose: () => void }) {
  const portal = usePortal();
  const [data, setData] = useState<{ thread: StaffThread; messages: StaffMsg[] } | null>(null);
  const [text, setText] = useState("");
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { portal.run((a) => a.openThread(id)).then(setData).catch((e) => setErr(say(e))); }, [id]);
  const send = async () => {
    setBusy(true); setErr("");
    try { const r = await portal.run(async (a) => a.replyThread(id, { text, notify, files: await filesFrom(input.current) })); setData(r); setText(""); if (input.current) input.current.value = ""; } catch (e) { setErr(say(e)); } finally { setBusy(false); }
  };
  if (!data) return err ? <p className="import-list warn" role="alert">{err}</p> : <p className="muted">Loading…</p>;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row-wrap" style={{ justifyContent: "space-between" }}><h3 style={{ margin: 0, fontSize: 15 }}>{data.thread.subject}</h3><button type="button" className="btn small" onClick={onClose}>Back to all</button></div>
      {data.messages.map((m) => (
        <div key={m.id} style={{ borderLeft: `3px solid ${m.from === "client" ? "var(--blue, #2563eb)" : "var(--line)"}`, paddingLeft: 10 }}>
          <strong>{m.name}</strong> <span className="muted">{when(m.at)}</span>
          <div style={{ whiteSpace: "pre-wrap" }}>{m.text}</div>
          {m.docs.length > 0 && <div className="muted" style={{ fontSize: 13 }}>Attached (in the client's documents): {m.docs.map((d) => d.title).join(", ")}</div>}
        </div>
      ))}
      <textarea className="input" aria-label="Your reply" rows={3} placeholder="Reply (the client sees exactly this)" value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} />
      <label className="row-wrap">Attach files <input ref={input} type="file" multiple accept={ACCEPT} aria-label="Attach files to reply" /></label>
      <label className="row-wrap"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Email them that there is a new message</label>
      {err && <p className="import-list warn" role="alert">{err}</p>}
      <div><button type="button" className="btn small primary" disabled={busy || (!text.trim() && !input.current?.files?.length)} onClick={() => void send()}>Send reply</button></div>
    </div>
  );
}
