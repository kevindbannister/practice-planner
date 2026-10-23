// Email suggestions on the Today screen, and their Settings card. The planner reads your recent
// inbox (read-only; it never changes your mail), picks out emails that look like they need
// action, and offers each as a task to add or dismiss.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AiError } from "../lib/ai";
import { DEFAULT_EMAIL_PREFS, EmailPrefs, Handled, Mail, Suggestion, aiPayload, applyVerdicts, fetchInbox, pruneHandled, suggest, taskFromSuggestion } from "../lib/emailTasks";
import { fmtDate, todayIso } from "../lib/domain";
import { addDays, newKey, weekday } from "../lib/planning";
import { Icon } from "./bits";
import { isDemo, useAi, mailAllowed, MAIL_SCOPE } from "./commsKit";
import { readSetting, useData } from "./data";
import { addScope } from "../lib/auth";
import { usePrivacy } from "./Assistant";

export function useEmailPrefs(): EmailPrefs {
  const { data } = useData();
  return { ...DEFAULT_EMAIL_PREFS, ...(readSetting<Partial<EmailPrefs>>(data.settings, "email.prefs") || {}) };
}

const REFRESH_MS = 15 * 60 * 1000;

export function EmailSuggestions() {
  const { data, store, create, saveSetting } = useData();
  const prefs = useEmailPrefs();
  const privacy = usePrivacy();
  const ai = useAi();
  const today = todayIso();
  const handled = useMemo(() => readSetting<Handled>(data.settings, "email.handled") || {}, [data.settings]);
  const handledRef = useRef(handled);
  handledRef.current = handled;
  const [mails, setMails] = useState<Mail[] | null>(null);
  const [verdicts, setVerdicts] = useState<Awaited<ReturnType<typeof ai.emails>>["emails"] | null>(null);
  const [state, setState] = useState<{ busy: boolean; error?: string; at?: Date; aiNote?: string }>({ busy: false });
  const [busyId, setBusyId] = useState<string>();
  const lastAt = useRef(0);

  const ok = prefs.enabled && mailAllowed();
  const base = useMemo(() => (mails ? suggest(mails, data.clients, data.contacts, handled) : []), [mails, data.clients, data.contacts, handled]);
  const list = useMemo(() => (verdicts ? applyVerdicts(base, verdicts) : base), [base, verdicts]);

  const scan = useCallback(async () => {
    setState((s) => ({ ...s, busy: true, error: undefined }));
    try {
      const inbox = await fetchInbox(store.graph, todayIso(), prefs.days);
      setMails(inbox);
      let v: typeof verdicts = null;
      let aiNote: string | undefined;
      if (prefs.ai) {
        const cands = suggest(inbox, data.clients, data.contacts, handledRef.current);
        if (cands.length) {
          try {
            v = (await ai.emails({ today: todayIso(), emails: aiPayload(cands, data.clients, privacy.names) })).emails;
          } catch (e) {
            aiNote = `The AI couldn't look at them (${e instanceof AiError ? e.message : "try again"}); these are picked by simple rules.`;
          }
        }
      }
      setVerdicts(v);
      lastAt.current = Date.now();
      setState({ busy: false, at: new Date(), aiNote });
    } catch {
      setState({ busy: false, error: "Couldn't read your inbox. Check Settings › Letters and email, or try again." });
    }
  }, [store, prefs.days, prefs.ai, data.clients, data.contacts, privacy.names, ai]);

  useEffect(() => {
    if (!ok || Date.now() - lastAt.current < REFRESH_MS) return;
    void scan();
  }, [ok, scan]);

  if (!prefs.enabled) return null;
  if (!ok) {
    return (
      <section className="card pad" aria-label="Email suggestions">
        <strong>Email suggestions need permission to read your Outlook</strong>
        <p className="muted" style={{ margin: "4px 0 8px", fontSize: 13 }}>It only reads; it never changes or sends anything.</p>
        <button type="button" className="btn small primary" onClick={() => void addScope(MAIL_SCOPE, true)}>Allow</button>
      </section>
    );
  }

  const record = async (id: string, how: "added" | "dismissed") => {
    await saveSetting("email.handled", pruneHandled({ ...handledRef.current, [id]: { how, on: todayIso() } }, todayIso()));
  };
  const planDay = () => {
    let d = today;
    while (weekday(d) > 5) d = addDays(d, 1);
    return d;
  };
  const add = async (s: Suggestion) => {
    setBusyId(s.mail.id);
    try {
      await create("Tasks", taskFromSuggestion(s, data.clients, planDay(), newKey("T")));
      await record(s.mail.id, "added");
    } catch {
      setState((x) => ({ ...x, error: "Couldn't add that task. Nothing was changed; try again." }));
    } finally {
      setBusyId(undefined);
    }
  };
  const dismiss = async (s: Suggestion) => {
    setBusyId(s.mail.id);
    try { await record(s.mail.id, "dismissed"); } finally { setBusyId(undefined); }
  };

  const clientName = (k?: string) => data.clients.find((c) => c.Key === k)?.Title;
  return (
    <section className="card" aria-labelledby="em-h">
      <div className="card-head">
        <h2 className="with-icon" id="em-h"><span className="h-icon hue-pink" aria-hidden="true"><Icon name="mail" size={15} /></span>From your email</h2>
        <span className="row-wrap" style={{ gap: 8 }}>
          <span className="muted" style={{ fontSize: 13 }}>{state.busy ? "Checking…" : list.length ? `${list.length} may need action` : "Nothing needs action"}</span>
          <button type="button" className="btn small" disabled={state.busy} onClick={() => void scan()}>Check now</button>
        </span>
      </div>
      {state.error && <p className="error-text" role="alert" style={{ margin: "0 16px 8px" }}>{state.error}</p>}
      {state.aiNote && <p className="muted" style={{ margin: "0 16px 8px", fontSize: 12 }}>{state.aiNote}</p>}
      {list.length > 0 && (
        <ul className="today-list">
          {list.map((s) => (
            <li key={s.mail.id} className="today-row">
              <div className="today-main" style={{ cursor: "default" }}>
                <span className="today-dot amber" aria-hidden="true" />
                <span className="stack" style={{ gap: 2, minWidth: 0 }}>
                  <strong className="ellipsis">{s.title}</strong>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {s.mail.from}{clientName(s.clientKey) ? ` (${clientName(s.clientKey)})` : ""} · {fmtDate(s.mail.received.slice(0, 10), { weekday: true, year: false })} · {s.why}
                    {s.mail.link ? <> · <a href={s.mail.link} target="_blank" rel="noreferrer">Open in Outlook</a></> : null}
                  </span>
                </span>
              </div>
              <button type="button" className="btn small" disabled={busyId === s.mail.id} onClick={() => void dismiss(s)}>Dismiss</button>
              <button type="button" className="btn small primary" disabled={busyId === s.mail.id} onClick={() => void add(s)}>Add task</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function EmailSettings() {
  const { saveSetting } = useData();
  const prefs = useEmailPrefs();
  const set = (p: Partial<EmailPrefs>) => void saveSetting("email.prefs", { ...prefs, ...p });
  return (
    <section className="card pad stack" aria-labelledby="emset-h" style={{ maxWidth: 720 }}>
      <h2 id="emset-h">Email suggestions</h2>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        The planner reads your recent inbox and suggests tasks from emails that look like they need action, on the Today screen. You add or dismiss each one.
        It only reads your mail; it never changes, moves or sends anything. It uses the same Outlook permission as drafting letters.
      </p>
      <label className="row-wrap" style={{ gap: 8, fontSize: 14 }}>
        <input type="checkbox" checked={prefs.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        Suggest tasks from my email{isDemo() ? " (demo inbox)" : ""}
      </label>
      <label className="row-wrap" style={{ gap: 8, fontSize: 14 }}>
        Look back
        <select className="input" style={{ width: "auto" }} value={prefs.days} onChange={(e) => set({ days: Number(e.target.value) })} aria-label="How many days back">
          {[1, 2, 3, 5, 7].map((n) => <option key={n} value={n}>{n} day{n === 1 ? "" : "s"}</option>)}
        </select>
      </label>
      <label className="row-wrap" style={{ gap: 8, fontSize: 14 }}>
        <input type="checkbox" checked={prefs.ai} disabled={!prefs.enabled} onChange={(e) => set({ ai: e.target.checked })} />
        Let the AI judge them better. This sends the subject and the first lines of each possible email (up to 20 at a time) to OpenAI, with sender names only if the assistant is set to send names.
      </label>
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>With this off, emails are picked by simple rules on your computer: from a known client, flagged, or asking for something. Nothing leaves the app.</p>
    </section>
  );
}
