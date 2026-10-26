// Mail: your Outlook folders and messages, with the emails from your clients picked out. Three
// panes (folders, the list, the message); on a phone one at a time. A client's email carries their
// name, found by their address, a contact linked to them, or a company email domain only they use.
// You can flag emails in Outlook (one, or all the client ones shown), mark them read or unread, and
// turn one into a task. Message bodies are shown in a locked-down frame: no scripts, nothing loaded
// from the internet.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Filter, MailFolder, MailItem, Body, WHY, applyFilter, bodyDoc, fetchBody, fetchFolders, fetchPage, flagMany, isInboxName, isOutgoing, originOf, setFlag, setRead } from "../lib/mailbox";
import { taskFromSuggestion } from "../lib/emailTasks";
import { todayIso } from "../lib/domain";
import { addDays, newKey, weekday } from "../lib/planning";
import { addScope } from "../lib/auth";
import { CommsTabs, MAIL_SCOPE, mailAllowed } from "./commsKit";
import { useData } from "./data";
import { Icon } from "./bits";

type Pane = "folders" | "list" | "read";

const when = (iso: string) => {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "";
  return t.toDateString() === new Date().toDateString()
    ? t.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : t.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};
const whenLong = (iso: string) => {
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? "" : t.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};

export function MailPage() {
  const { data, store, create } = useData();
  const ok = mailAllowed();
  const [folders, setFolders] = useState<MailFolder[] | null>(null);
  const [folderId, setFolderId] = useState<string>();
  const [items, setItems] = useState<MailItem[]>([]);
  const [next, setNext] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [selId, setSelId] = useState<string>();
  const [filter, setFilter] = useState<Filter>("all");
  const [text, setText] = useState("");
  const [pane, setPane] = useState<Pane>("list");
  const [body, setBody] = useState<{ id: string; body?: Body; error?: boolean }>();
  const [note, setNote] = useState<string>();
  const [added, setAdded] = useState<Set<string>>(new Set());
  const run = useRef(0);

  const folder = folders?.find((f) => f.id === folderId);
  const outgoing = !!folder && isOutgoing(folder.name);
  const origins = useMemo(() => new Map(items.map((m) => [m.id, originOf(m, outgoing, data.clients, data.contacts, [])])), [items, outgoing, data.clients, data.contacts]);
  const shown = useMemo(() => applyFilter(items, origins, filter, text), [items, origins, filter, text]);
  const selected = items.find((m) => m.id === selId);
  const clientName = (k?: string) => data.clients.find((c) => c.Key === k)?.Title || "";
  const clientCount = items.filter((m) => origins.get(m.id)?.clientKey).length;
  const toFlag = shown.filter((m) => origins.get(m.id)?.clientKey && !m.flagged);

  const loadFolders = useCallback(async () => {
    const f = await fetchFolders(store.graph);
    setFolders(f);
    setFolderId((cur) => cur && f.some((x) => x.id === cur) ? cur : (f.find((x) => isInboxName(x.name)) || f[0])?.id);
  }, [store]);

  const loadPage = useCallback(async (id: string, more?: string) => {
    const mine = ++run.current;
    setBusy(true);
    setError(undefined);
    try {
      const p = await fetchPage(store.graph, id, more);
      if (mine !== run.current) return;
      setItems((cur) => (more ? [...cur, ...p.items] : p.items));
      setNext(p.next);
    } catch {
      if (mine === run.current) setError("Couldn't read that folder. Check your connection and try again.");
    } finally {
      if (mine === run.current) setBusy(false);
    }
  }, [store]);

  useEffect(() => {
    if (!ok) return;
    loadFolders().catch(() => setError("Couldn't read your folders. Check your connection and try again."));
  }, [ok, loadFolders]);
  useEffect(() => {
    if (!ok || !folderId) return;
    setItems([]); setNext(undefined); setSelId(undefined); setBody(undefined); setNote(undefined);
    void loadPage(folderId);
  }, [ok, folderId, loadPage]);

  const refresh = () => {
    setNote(undefined);
    void loadFolders().catch(() => undefined);
    if (folderId) void loadPage(folderId);
  };

  const patch = (id: string, p: Partial<MailItem>) => setItems((cur) => cur.map((m) => (m.id === id ? { ...m, ...p } : m)));
  const bumpUnread = (n: number) => setFolders((cur) => cur && cur.map((f) => (f.id === folderId ? { ...f, unread: Math.max(0, f.unread + n) } : f)));

  const open = async (m: MailItem) => {
    setSelId(m.id); setPane("read"); setNote(undefined); setBody({ id: m.id });
    if (!m.isRead) {
      patch(m.id, { isRead: true }); bumpUnread(-1);
      setRead(store.graph, m.id, true).catch(() => { patch(m.id, { isRead: false }); bumpUnread(1); });
    }
    try {
      const b = await fetchBody(store.graph, m.id);
      setBody((cur) => (cur?.id === m.id ? { id: m.id, body: b } : cur));
    } catch {
      setBody((cur) => (cur?.id === m.id ? { id: m.id, error: true } : cur));
    }
  };

  const toggleFlag = async (m: MailItem) => {
    patch(m.id, { flagged: !m.flagged });
    try { await setFlag(store.graph, m.id, !m.flagged); } catch { patch(m.id, { flagged: m.flagged }); setNote("Couldn't change the flag in Outlook. Nothing was changed."); }
  };
  const toggleRead = async (m: MailItem) => {
    patch(m.id, { isRead: !m.isRead }); bumpUnread(m.isRead ? 1 : -1);
    try { await setRead(store.graph, m.id, !m.isRead); } catch { patch(m.id, { isRead: m.isRead }); bumpUnread(m.isRead ? -1 : 1); setNote("Couldn't change that in Outlook. Nothing was changed."); }
  };
  const flagClients = async () => {
    const ids = toFlag.map((m) => m.id);
    setNote(undefined);
    ids.forEach((id) => patch(id, { flagged: true }));
    const failed = await flagMany(store.graph, ids);
    failed.forEach((id) => patch(id, { flagged: false }));
    setNote(failed.length ? `Flagged ${ids.length - failed.length} in Outlook; ${failed.length} couldn't be flagged.` : `Flagged ${ids.length} client email${ids.length === 1 ? "" : "s"} in Outlook.`);
  };
  const addTask = async (m: MailItem) => {
    const o = origins.get(m.id);
    const who = (o?.clientKey && clientName(o.clientKey)) || m.from;
    let d = todayIso();
    while (weekday(d) > 5) d = addDays(d, 1);
    try {
      await create("Tasks", taskFromSuggestion({ mail: m, clientKey: o?.clientKey, title: `Reply to ${who || "email"}: ${m.subject}`.slice(0, 120), why: "", score: 0 }, data.clients, d, newKey("T")));
      setAdded((s) => new Set(s).add(m.id));
      setNote("Task added for today. Find it on the plan.");
    } catch {
      setNote("Couldn't add that task. Nothing was changed; try again.");
    }
  };

  if (!ok) {
    return (
      <div className="page">
        <CommsTabs current="mail" />
        <div className="page-head"><h1>Email</h1></div>
        <section className="card pad stack" style={{ maxWidth: 640 }}>
          <strong>Mail needs permission to use your Outlook</strong>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            It lets the planner show your folders and messages, mark them read and flag them. It never sends or deletes anything.
            It's the same Outlook permission used for drafting letters.
          </p>
          <div><button type="button" className="btn primary" onClick={() => void addScope(MAIL_SCOPE, true)}>Allow Outlook</button></div>
        </section>
      </div>
    );
  }

  const bodyFor = body && selected && body.id === selected.id ? body : undefined;
  const so = selected ? origins.get(selected.id) : undefined;
  const person = (m: MailItem) => (outgoing ? `To: ${m.toNames.join(", ") || m.to.join(", ") || "no recipient"}` : m.from || m.address);

  return (
    <div className="page mail-page">
      <CommsTabs current="mail" />
      <div className="page-head">
        <div>
          <h1>Email</h1>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
            {folder ? `${folder.name}: ${folder.total} message${folder.total === 1 ? "" : "s"}${folder.unread ? `, ${folder.unread} unread` : ""}` : "Loading your folders…"}
            {items.length ? ` · ${clientCount} from clients${next ? " so far" : ""}` : ""}
          </p>
        </div>
        <button type="button" className="btn small" onClick={refresh} disabled={busy}><Icon name="refresh" size={16} /> Refresh</button>
      </div>

      <div className="mail" data-pane={pane}>
        <nav className="mail-folders card" aria-label="Mail folders">
          <ul>
            {(folders || []).map((f) => (
              <li key={f.id}>
                <button type="button" aria-current={f.id === folderId ? "page" : undefined} style={{ paddingLeft: 12 + f.depth * 16 }} onClick={() => { setFolderId(f.id); setPane("list"); }}>
                  <span className="ellipsis">{f.name}</span>
                  {f.unread > 0 && <span className="mail-count">{f.unread}</span>}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <section className="mail-list card" aria-label="Messages">
          <div className="mail-tools">
            <button type="button" className="btn small only-phone" onClick={() => setPane("folders")}>Folders</button>
            <input className="input" type="search" placeholder="Search this folder" aria-label="Search this folder" value={text} onChange={(e) => setText(e.target.value)} />
            <div className="subtabs" role="group" aria-label="Show">
              {([["all", "All"], ["clients", `From clients${items.length ? ` (${clientCount})` : ""}`], ["unread", "Unread"], ["flagged", "Flagged"]] as [Filter, string][]).map(([k, label]) => (
                <button key={k} type="button" className="subtab" aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}</button>
              ))}
            </div>
            {toFlag.length > 0 && (
              <button type="button" className="btn small" onClick={() => void flagClients()}>
                <Icon name="flag" size={15} /> Flag {toFlag.length} client email{toFlag.length === 1 ? "" : "s"} in Outlook
              </button>
            )}
          </div>
          {error && <p className="error-text" role="alert" style={{ margin: "8px 16px" }}>{error}</p>}
          {note && !selected && <p className="muted" role="status" style={{ margin: "8px 16px", fontSize: 13 }}>{note}</p>}
          {!error && !busy && !shown.length && <p className="muted" style={{ margin: 16 }}>{items.length ? "No messages match." : "This folder is empty."}</p>}
          <ul className="mail-rows">
            {shown.map((m) => {
              const o = origins.get(m.id);
              return (
                <li key={m.id}>
                  <button type="button" className={`mail-row${m.isRead ? "" : " unread"}${o?.clientKey ? " client" : ""}`} aria-current={m.id === selId ? "true" : undefined} onClick={() => void open(m)}>
                    <span className="mail-top">
                      <span className="mail-from ellipsis">{person(m)}</span>
                      <span className="mail-when mono">{when(m.received)}</span>
                    </span>
                    <span className="mail-subject ellipsis">{m.subject}</span>
                    <span className="mail-preview ellipsis">{m.preview}</span>
                    {(o?.clientKey || m.flagged || m.hasAttachments) && (
                      <span className="row-wrap" style={{ gap: 6 }}>
                        {o?.clientKey && <span className="chip blue">Client: {clientName(o.clientKey)}</span>}
                        {m.flagged && <span className="chip amber">Flagged</span>}
                        {m.hasAttachments && <span className="chip">Attachment</span>}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          {next && <div style={{ padding: 12 }}><button type="button" className="btn small" disabled={busy} onClick={() => folderId && void loadPage(folderId, next)}>{busy ? "Loading…" : "Load older messages"}</button></div>}
          {busy && !items.length && <p className="muted" style={{ margin: 16 }}>Loading…</p>}
        </section>

        <section className="mail-read card" aria-label="Message">
          {!selected ? (
            <p className="muted" style={{ margin: 16 }}>Choose a message to read it.</p>
          ) : (
            <>
              <div className="mail-read-head">
                <button type="button" className="btn small only-phone" onClick={() => setPane("list")}>Back</button>
                <h2>{selected.subject}</h2>
                <div className="muted" style={{ fontSize: 13 }}>
                  {outgoing ? <>To {selected.toNames.join(", ") || selected.to.join(", ") || "nobody yet"}</> : <>From {selected.from}{selected.from !== selected.address && selected.address ? ` <${selected.address}>` : ""}</>} · {whenLong(selected.received)}
                  {bodyFor?.body?.cc.length ? <> · Cc {bodyFor.body.cc.join(", ")}</> : null}
                </div>
                {so?.clientKey && (
                  <div className="row-wrap" style={{ gap: 8 }}>
                    <a className="chip blue" href={`#/clients/${so.clientKey}`}>Client: {clientName(so.clientKey)}</a>
                    <span className="muted" style={{ fontSize: 12 }}>Matched by {WHY[so.by || "address"]}</span>
                  </div>
                )}
                <div className="row-wrap" style={{ gap: 8 }}>
                  <button type="button" className="btn small" aria-pressed={selected.flagged} onClick={() => void toggleFlag(selected)}><Icon name="flag" size={15} /> {selected.flagged ? "Remove flag" : "Flag in Outlook"}</button>
                  <button type="button" className="btn small" onClick={() => void toggleRead(selected)}>{selected.isRead ? "Mark unread" : "Mark read"}</button>
                  <button type="button" className="btn small" disabled={added.has(selected.id)} onClick={() => void addTask(selected)}>{added.has(selected.id) ? "Task added" : "Add as a task"}</button>
                  {selected.link && <a className="btn small" href={selected.link} target="_blank" rel="noreferrer">Open in Outlook</a>}
                </div>
                {note && <p className="muted" role="status" style={{ margin: 0, fontSize: 13 }}>{note}</p>}
              </div>
              {!bodyFor ? null : bodyFor.error ? (
                <p className="error-text" role="alert" style={{ margin: 16 }}>Couldn't load the message. Use Open in Outlook.</p>
              ) : !bodyFor.body ? (
                <p className="muted" style={{ margin: 16 }}>Loading…</p>
              ) : (
                <iframe className="mail-frame" title={`Message: ${selected.subject}`} sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={bodyDoc(bodyFor.body)} />
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
