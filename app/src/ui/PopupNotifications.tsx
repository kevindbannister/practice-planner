// Pop-up notifications on this device: the watcher that decides when to pop one up, and the settings panel (inside the Action Centre).
import { useEffect, useRef, useState } from "react";
import { CATEGORIES } from "../lib/actions";
import { DEFAULT_NOTIFY, NotifyPrefs, askPermission, londonMinutes, plan, readPrefs, readState, show, support, writePrefs, writeState } from "../lib/notify";
import { useEditor } from "./Editors";
import { useActions } from "./ActionCentre";

declare const __DEMO__: boolean;
const PREFS_EVENT = "pp-notify-prefs";

/** Mounted once. Looks at the actions whenever they change, and when you leave or come back to the app, and pops up what is new. Also opens what a tapped pop-up was about. */
export function NotificationWatcher() {
  const a = useActions(); const { open: openEditor } = useEditor();
  const me = a.user; const busy = useRef(false); const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((x) => x + 1);
    document.addEventListener("visibilitychange", bump); window.addEventListener(PREFS_EVENT, bump);
    const t = setInterval(bump, 60000); // quiet hours ending, or a long-open tab
    const onMsg = (e: MessageEvent) => { const d = e.data as { type?: string; href?: string } | null; if (d?.type !== "pp-open" || !d.href) return; if (d.href.startsWith("editor:")) { const [, kind, key] = d.href.split(":"); openEditor({ kind: kind as "job", key }); } else window.location.hash = d.href.replace(/^#/, ""); };
    if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", onMsg);
    return () => { document.removeEventListener("visibilitychange", bump); window.removeEventListener(PREFS_EVENT, bump); clearInterval(t); if ("serviceWorker" in navigator) navigator.serviceWorker.removeEventListener("message", onMsg); };
  }, [openEditor]);
  useEffect(() => {
    if (!me || busy.current) return;
    const prefs = readPrefs(me); const sp = support(); if (!prefs.enabled || !sp.ok || sp.permission !== "granted") return;
    busy.current = true;
    const r = plan(a.items.open, me, prefs, readState(me), { minutesNow: londonMinutes(new Date()), inFront: document.visibilityState === "visible" && document.hasFocus() });
    writeState(me, r.state);
    (async () => { for (const p of r.pops) await show(p); })().finally(() => { busy.current = false; });
  }, [a.items, me, tick]);
  return null;
}

export function PopupNotificationSettings() {
  const { user } = useDataUser(); const me = user;
  const [prefs, setPrefs] = useState<NotifyPrefs>(() => readPrefs(me)); const [msg, setMsg] = useState(""); const [sp, setSp] = useState(support());
  const save = (p: Partial<NotifyPrefs>) => { const n = { ...prefs, ...p }; setPrefs(n); writePrefs(me, n); window.dispatchEvent(new Event(PREFS_EVENT)); };
  const turnOn = async () => {
    setMsg(""); const perm = await askPermission(); setSp(support());
    if (perm !== "granted") { setMsg(perm === "denied" ? "Pop-ups are blocked for this site. Allow notifications for it in the browser's site settings, then try again." : "Pop-ups weren't allowed, so they stay off."); return; }
    writeState(me, { baselined: false, seen: {} }); save({ enabled: true });
    setMsg("On for this device. What is already waiting won't pop up; new actions will.");
  };
  const test = async () => { setMsg((await show({ tag: "test", title: "Practice Planner", body: "Pop-ups are working on this device.", href: "#/actions" })) ? "Test sent. If you didn't see it, check this device's notification settings (and Focus or Do Not Disturb)." : "Couldn't show a test pop-up on this device."); };
  const on = prefs.enabled && sp.ok && sp.permission === "granted";
  return (
    <details className="card pad" style={{ marginBottom: 12 }}>
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>Pop-up notifications on this device {on ? "(on)" : "(off)"}</summary>
      <div className="stack" style={{ marginTop: 10 }}>
        <p className="muted" style={{ margin: 0 }}>A pop-up for new actions that are yours, in your browser or the installed app (desktop, and Chrome on Android). The choice is for this device only. Pop-ups show while the planner is open, including in the background; they don't appear once it is fully closed.</p>
        {!sp.ok && <p role="status" style={{ margin: 0 }}>{sp.why}</p>}
        {sp.ok && sp.permission === "denied" && <p role="status" style={{ margin: 0 }}>Pop-ups are blocked for this site in the browser. Allow notifications in the site settings to use this.</p>}
        {sp.ok && !on && sp.permission !== "denied" && <div><button type="button" className="btn primary" onClick={turnOn}>Turn on pop-ups</button></div>}
        {on && <>
          <div className="row-wrap" style={{ gap: 8 }}><button type="button" className="btn small" onClick={test}>Send a test</button><button type="button" className="btn small" onClick={() => save({ enabled: false })}>Turn off on this device</button></div>
          <label className="row" style={{ gap: 8 }}>Tell me about <select className="input" style={{ maxWidth: 260 }} value={prefs.minPriority} onChange={(e) => save({ minPriority: e.target.value as NotifyPrefs["minPriority"] })}><option value="high">High priority only</option><option value="medium">Medium priority and above</option><option value="low">Everything</option></select></label>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}><legend className="muted" style={{ marginBottom: 4 }}>Topics (none ticked means all)</legend>
            <div className="row-wrap" style={{ gap: 12 }}>{CATEGORIES.map((c) => <label key={c.key} className="row" style={{ gap: 6 }}><input type="checkbox" checked={prefs.categories.includes(c.key)} onChange={(e) => save({ categories: e.target.checked ? [...prefs.categories, c.key] : prefs.categories.filter((x) => x !== c.key) })} /> {c.label}</label>)}</div></fieldset>
          <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={prefs.onlyWhenAway} onChange={(e) => save({ onlyWhenAway: e.target.checked })} /> Only when the planner isn't the screen in front of me</label>
          <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={prefs.details} onChange={(e) => save({ details: e.target.checked })} /> Show client names and details on the pop-up (off keeps it generic on a lock screen)</label>
          <div className="row-wrap" style={{ gap: 8 }}><label className="row" style={{ gap: 8 }}><input type="checkbox" checked={prefs.quiet} onChange={(e) => save({ quiet: e.target.checked })} /> Quiet hours</label>
            <label className="row" style={{ gap: 6 }}>from <input className="input" type="time" aria-label="Quiet hours start" value={prefs.quietFrom} onChange={(e) => save({ quietFrom: e.target.value || DEFAULT_NOTIFY.quietFrom })} /></label>
            <label className="row" style={{ gap: 6 }}>to <input className="input" type="time" aria-label="Quiet hours end" value={prefs.quietTo} onChange={(e) => save({ quietTo: e.target.value || DEFAULT_NOTIFY.quietTo })} /></label></div>
          <p className="muted" style={{ margin: 0 }}>Anything that arrives during quiet hours is summarised in one pop-up afterwards. More than three new actions at once also become one pop-up.</p>
        </>}
        {msg && <p role="status" style={{ margin: 0 }}>{msg}</p>}
      </div>
    </details>
  );
}
function useDataUser() { return { user: useActions().user }; }
export const notificationsAvailable = () => !__DEMO__;
