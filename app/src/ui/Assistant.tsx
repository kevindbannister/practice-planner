// The chat assistant: an "Ask" panel where you type what you want ("add a task to ring Bob on
// Friday", "what's most urgent?", "VAT for Acme is waiting on the client until the 3rd"). The AI
// answers and proposes changes as cards; nothing changes until you press Apply, and every
// applied change has an Undo. What was asked and applied is kept in a log (Settings).
import { ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AiError, AiStatus } from "../lib/ai";
import { AssistAction, freshUndo, DEFAULT_PRIVACY, LogEntry, Op, Plan, Privacy, Snapshot, addLog, buildContext, toPlan, validActions, withNames } from "../lib/assist";
import { todayIso } from "../lib/domain";
import { Icon } from "./bits";
import { isDemo, useAi } from "./commsKit";
import { readSetting, useData } from "./data";
import { useTodayModel } from "./useTodayModel";

type Card = { id: number; plan: Plan; state: "pending" | "applied" | "skipped" | "failed" | "undone" };
type Msg = { id: number; role: "user" | "assistant"; text: string; cards?: Card[]; error?: boolean; turn?: number };

type Ctx = { open: boolean; toggle: () => void };
const AssistCtx = createContext<Ctx>({ open: false, toggle: () => undefined });
export const useAssistant = () => useContext(AssistCtx);

export function usePrivacy(): Privacy {
  const { data } = useData();
  return { ...DEFAULT_PRIVACY, ...(readSetting<Partial<Privacy>>(data.settings, "ai.assist") || {}) };
}
export function useAssistLog(): LogEntry[] {
  const { data } = useData();
  return readSetting<LogEntry[]>(data.settings, "ai.log") || [];
}

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((o) => !o), []);
  return (
    <AssistCtx.Provider value={{ open, toggle }}>
      {children}
      {open && <AssistantPanel onClose={() => setOpen(false)} />}
    </AssistCtx.Provider>
  );
}

let counter = 0;
const nextId = () => ++counter;

/** Dictation using the browser's own speech recognition (Chrome, Edge, Safari). Text lands in the box for you to check before sending. */
function useVoice(onText: (t: string) => void) {
  type Rec = { lang: string; continuous: boolean; interimResults: boolean; start(): void; stop(): void; onresult: ((e: any) => void) | null; onend: (() => void) | null; onerror: ((e: any) => void) | null };
  const Ctor = (typeof window !== "undefined" ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) : null) as (new () => Rec) | null;
  const [listening, setListening] = useState(false);
  const rec = useRef<Rec | null>(null);
  useEffect(() => () => rec.current?.stop(), []);
  const toggle = (current: string) => {
    if (!Ctor) return;
    if (rec.current) { rec.current.stop(); return; }
    const r = new Ctor();
    r.lang = "en-GB"; r.continuous = true; r.interimResults = true;
    const base = current.trim() ? current.trim() + " " : "";
    r.onresult = (e: any) => {
      let said = "";
      for (let i = 0; i < e.results.length; i++) said += e.results[i][0].transcript;
      onText(base + said.trim());
    };
    r.onerror = () => { /* permission refused or no speech: just stop */ };
    r.onend = () => { rec.current = null; setListening(false); };
    rec.current = r; setListening(true);
    try { r.start(); } catch { rec.current = null; setListening(false); }
  };
  return { supported: !!Ctor, listening, toggle };
}

function AssistantPanel({ onClose }: { onClose: () => void }) {
  const ctx = useData();
  const latest = useRef(ctx);
  latest.current = ctx;
  const ai = useAi();
  const privacy = usePrivacy();
  const model = useTodayModel();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const logRef = useRef<LogEntry[]>([]);
  logRef.current = readSetting<LogEntry[]>(ctx.data.settings, "ai.log") || [];
  const turns = useRef(new Map<number, LogEntry>());
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const voice = useVoice((t) => setText(t));

  useEffect(() => { ai.status().then(setStatus).catch(() => setStatus({ configured: false })); }, [ai]);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [msgs, busy]);
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onClose]);

  const snapshot = (): Snapshot => {
    const d = latest.current.data;
    return { clients: d.clients, jobs: d.jobs, tasks: d.tasks, projects: d.projects, settings: latest.current.settings, today: todayIso() };
  };

  const saveLog = async (turn: number, patch: (e: LogEntry) => LogEntry) => {
    const e = turns.current.get(turn);
    if (!e) return;
    const next = patch(e);
    turns.current.set(turn, next);
    const rest = logRef.current.filter((x) => x.at !== e.at);
    await latest.current.saveSetting("ai.log", addLog(rest, next));
  };

  const run = async (ops: Op[]) => {
    const { data, update, create, remove, saveSetting } = latest.current;
    for (const o of ops) {
      if (o.op === "update") {
        const row = (o.list === "Jobs" ? data.jobs : data.tasks).find((r) => r.Key === o.key);
        if (!row) throw new Error("gone");
        await update(o.list, row, o.patch);
      } else if (o.op === "create") await create(o.list, o.row);
      else if (o.op === "remove") {
        const row = data.tasks.find((r) => r.Key === o.key);
        if (row) await remove("Tasks", row);
      } else {
        const next = { ...latest.current.settings.overrides };
        if (o.type) next[o.date] = o.type;
        else delete next[o.date];
        await saveSetting("dayOverrides", next);
      }
    }
  };

  const setCard = (msgId: number, cardId: number, state: Card["state"]) =>
    setMsgs((m) => m.map((x) => (x.id === msgId ? { ...x, cards: x.cards?.map((c) => (c.id === cardId ? { ...c, state } : c)) } : x)));

  const apply = async (msg: Msg, card: Card) => {
    if ("error" in card.plan) return;
    try {
      // undo puts back what's there now, not what was there when the AI answered
      const plan = { ...card.plan, undo: freshUndo(card.plan, snapshot()) };
      setMsgs((m: Msg[]) => m.map((x) => (x.id === msg.id ? { ...x, cards: x.cards?.map((c) => (c.id === card.id ? { ...c, plan } : c)) } : x)));
      await run(plan.ops);
      setCard(msg.id, card.id, "applied");
      const label = plan.label;
      if (msg.turn !== undefined) await saveLog(msg.turn, (e) => ({ ...e, applied: [...e.applied, label] }));
    } catch {
      setCard(msg.id, card.id, "failed");
    }
  };
  const undo = async (msg: Msg, card: Card) => {
    if ("error" in card.plan) return;
    try {
      await run(card.plan.undo);
      setCard(msg.id, card.id, "undone");
      const label = card.plan.label;
      if (msg.turn !== undefined) await saveLog(msg.turn, (e) => ({ ...e, undone: [...(e.undone || []), label] }));
    } catch {
      setCard(msg.id, card.id, "failed");
    }
  };
  const applyAll = async (msg: Msg) => {
    for (const c of msg.cards || []) if (c.state === "pending" && !("error" in c.plan)) await apply(msg, c);
  };

  const send = async () => {
    const message = text.trim();
    if (!message || busy) return;
    setText("");
    setBusy(true);
    const user: Msg = { id: nextId(), role: "user", text: message };
    setMsgs((m) => [...m, user]);
    const history = msgs.filter((m) => !m.error).slice(-8).map((m) => ({ role: m.role, content: m.text }));
    try {
      const snap = snapshot();
      const a = await ai.assist({ message, history, context: buildContext(snap, privacy, model.input) });
      const reply = privacy.names ? a.reply : withNames(a.reply, snap.clients);
      const cards: Card[] = validActions(a.actions).map((x: AssistAction) => ({ id: nextId(), plan: toPlan(x, snap), state: "pending" as const }));
      const turn = nextId();
      turns.current.set(turn, { at: new Date().toISOString(), asked: message, reply, applied: [], names: privacy.names });
      await latest.current.saveSetting("ai.log", addLog(logRef.current, turns.current.get(turn)!)).catch(() => undefined);
      setMsgs((m) => [...m, { id: nextId(), role: "assistant", text: reply, cards, turn }]);
    } catch (e) {
      const t = e instanceof AiError ? e.message : "Something went wrong. Try again.";
      setMsgs((m) => [...m, { id: nextId(), role: "assistant", text: t, error: true }]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const ideas = ["What should I do first today?", "Add a task to ring the bank", "What's waiting on someone?"];

  return (
    <div className="drawer-wrap">
      <button type="button" className="drawer-scrim" aria-label="Close" onClick={onClose} tabIndex={-1} />
      <div className="drawer assist" role="dialog" aria-modal="true" aria-labelledby="assist-title">
        <div className="drawer-head">
          <div className="stack" style={{ gap: 4 }}>
            <span className="eyebrow">Assistant</span>
            <h2 id="assist-title" tabIndex={-1}>Ask the planner</h2>
          </div>
          <button type="button" className="iconbtn" aria-label="Close" onClick={onClose}><Icon name="close" /></button>
        </div>
        <div className="assist-body" aria-live="polite">
          {status && !status.configured && (
            <div className="alert amber" role="alert"><strong>The assistant isn't switched on yet</strong>
              <span>Add the OpenAI key in Azure (setting OPENAI_API_KEY), then try again. <a href="#/settings/letters" onClick={onClose}>Details in Settings</a></span></div>
          )}
          {msgs.length === 0 && (
            <div className="stack" style={{ gap: 8 }}>
              <p className="muted" style={{ margin: 0, fontSize: 14 }}>
                Tell me what's changed or ask what to do. I suggest changes; nothing happens until you press Apply, and you can undo anything.
                {privacy.names ? " Client names are sent to the AI so it knows who you mean." : " Client names are kept from the AI."}
                {isDemo() ? " (Demo: simple answers only.)" : ""}
              </p>
              <div className="row-wrap">{ideas.map((i) => <button key={i} type="button" className="btn small" onClick={() => setText(i)}>{i}</button>)}</div>
            </div>
          )}
          {msgs.map((m) => (
            <div key={m.id} className={`assist-msg ${m.role}${m.error ? " err" : ""}`}>
              <p>{m.text}</p>
              {m.cards && m.cards.length > 0 && (
                <div className="stack" style={{ gap: 6 }}>
                  {m.cards.map((c) => (
                    <div key={c.id} className={`assist-card ${c.state}`}>
                      {"error" in c.plan ? <span className="muted">{c.plan.error}</span> : (
                        <>
                          <span className="assist-label">{c.plan.label}</span>
                          <span className="row-wrap" style={{ gap: 6 }}>
                            {c.state === "pending" && <>
                              <button type="button" className="btn small" onClick={() => setCard(m.id, c.id, "skipped")}>Skip</button>
                              <button type="button" className="btn small primary" onClick={() => void apply(m, c)}>Apply</button>
                            </>}
                            {c.state === "applied" && <><span className="chip green">Done</span><button type="button" className="btn small" onClick={() => void undo(m, c)}>Undo</button></>}
                            {c.state === "undone" && <span className="chip">Undone</span>}
                            {c.state === "skipped" && <span className="chip">Skipped</span>}
                            {c.state === "failed" && <span className="chip red">Couldn't do that</span>}
                          </span>
                        </>
                      )}
                    </div>
                  ))}
                  {m.cards.filter((c) => c.state === "pending" && !("error" in c.plan)).length > 1 && (
                    <button type="button" className="btn small primary" style={{ alignSelf: "flex-start" }} onClick={() => void applyAll(m)}>Apply all</button>
                  )}
                </div>
              )}
            </div>
          ))}
          {busy && <div className="assist-msg assistant"><p className="muted">Thinking…</p></div>}
          <div ref={endRef} />
        </div>
        <form className="assist-input" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <textarea ref={inputRef} className="input" rows={2} value={text} placeholder="Ask, or say what's changed…" aria-label="Your message"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} />
          {voice.supported && (
            <button type="button" className={`btn mic${voice.listening ? " on" : ""}`} aria-pressed={voice.listening}
              aria-label={voice.listening ? "Stop dictating" : "Dictate your message"} title={voice.listening ? "Stop dictating" : "Speak instead of typing"}
              onClick={() => voice.toggle(text)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
            </button>
          )}
          <button type="submit" className="btn primary" disabled={busy || !text.trim()}>Send</button>
        </form>
      </div>
    </div>
  );
}

/** Settings card: whether client names go to the AI, and the record of what it was asked and what you approved. */
export function AssistantSettings() {
  const { saveSetting } = useData();
  const privacy = usePrivacy();
  const log = useAssistLog();
  const [shown, setShown] = useState(10);
  return (
    <section className="card pad stack" aria-labelledby="asst-h" style={{ maxWidth: 720 }}>
      <h2 id="asst-h">Assistant (chat)</h2>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        The "Ask" button at the top asks OpenAI, using the same key as AI writing. Each question sends a snapshot of your open work
        (titles, dates and hours, plus today's plan) so it can answer. It proposes changes; you approve each one.
      </p>
      <label className="row-wrap" style={{ gap: 8, fontSize: 14 }}>
        <input type="checkbox" checked={privacy.names} onChange={(e) => void saveSetting("ai.assist", { ...privacy, names: e.target.checked })} />
        Send client names with each question (switch off to send only client codes; names are put back in the answers). Task titles you've typed are sent as written, so a name in a task title still goes.
      </label>
      <h3 style={{ margin: "6px 0 0", fontSize: 14 }}>What it was asked, and what you approved</h3>
      {log.length === 0 ? <p className="muted" style={{ margin: 0 }}>Nothing yet.</p> : (
        <ul className="assist-log">
          {log.slice(0, shown).map((e) => (
            <li key={e.at}>
              <span className="muted" style={{ fontSize: 12 }}>{new Date(e.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {e.names ? "names sent" : "names kept back"}</span>
              <span><strong>You:</strong> {e.asked}</span>
              <span className="muted">{e.applied.length ? `Applied: ${e.applied.join("; ")}` : "Nothing applied"}{e.undone?.length ? ` · Undone: ${e.undone.join("; ")}` : ""}</span>
            </li>
          ))}
        </ul>
      )}
      {log.length > shown && <button type="button" className="btn small" style={{ alignSelf: "flex-start" }} onClick={() => setShown(shown + 20)}>Show more</button>}
    </section>
  );
}
