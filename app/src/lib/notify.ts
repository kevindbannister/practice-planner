// Pop-up notifications (the browser's own notification pop-ups, on desktop browsers and Chrome on Android). Per device: permission is a device setting, so
// the choices are kept in this browser, not in the shared Settings list. What is worth a pop-up is worked out from the same actions the Action Centre shows
// (lib/actions.ts), so a pop-up is never about something you can't open. Nothing here sends anything to a client.
//
// Scope, plainly: pop-ups appear while the planner is open in a tab or installed app on the device (including in the background), and the device is awake.
// They do not appear once the app is fully closed: that needs a push server, which is a separate piece of setup.
import { Action, sameUser } from "./actions";

export type NotifyPrefs = {
  enabled: boolean;
  /** categories to notify about; empty means all */ categories: string[];
  minPriority: "low" | "medium" | "high";
  /** pop up only when the app isn't the screen in front of you */ onlyWhenAway: boolean;
  /** show client names and details on the pop-up (off keeps the lock screen generic) */ details: boolean;
  quiet: boolean; quietFrom: string; quietTo: string;
};
export const DEFAULT_NOTIFY: NotifyPrefs = { enabled: false, categories: [], minPriority: "medium", onlyWhenAway: true, details: true, quiet: true, quietFrom: "19:00", quietTo: "08:00" };
export type NotifyState = { baselined: boolean; seen: Record<string, string> };
export const EMPTY_STATE: NotifyState = { baselined: false, seen: {} };
export type Pop = { tag: string; title: string; body: string; href: string };

const RANK: Record<string, number> = { low: 1, medium: 2, high: 3 };
const mins = (hhmm: string) => { const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || ""); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
/** Is `minutesNow` (minutes since midnight, London) inside the quiet window? The window may cross midnight. */
export function inQuiet(p: Pick<NotifyPrefs, "quiet" | "quietFrom" | "quietTo">, minutesNow: number): boolean {
  if (!p.quiet) return false; const a = mins(p.quietFrom), b = mins(p.quietTo); if (isNaN(a) || isNaN(b) || a === b) return false;
  return a < b ? minutesNow >= a && minutesNow < b : minutesNow >= a || minutesNow < b;
}
export const londonMinutes = (d: Date) => { const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d); return Number(p.find((x) => x.type === "hour")!.value) * 60 + Number(p.find((x) => x.type === "minute")!.value); };

export type Plan = { pops: Pop[]; state: NotifyState; reason: "baseline" | "quiet" | "in-front" | "none" | "shown" };
/** What to pop up now. New means: not seen before, or seen at a lower priority. The first run only records what already exists (no flood when you switch it on).
 *  During quiet hours nothing is marked seen, so what arrived overnight is summarised when quiet hours end. While you're looking at the app, new items are marked seen
 *  (you can see them) but don't pop up. More than three new items become one summary pop-up. */
export function plan(actions: Action[], me: string, prefs: NotifyPrefs, state: NotifyState, o: { minutesNow: number; inFront: boolean }): Plan {
  const mine = actions.filter((a) => sameUser(a.assignee, me) && RANK[a.priority] >= RANK[prefs.minPriority] && (!prefs.categories.length || prefs.categories.includes(a.category)));
  const live = new Set(mine.map((a) => a.key));
  const seen: Record<string, string> = {}; for (const k of Object.keys(state.seen)) if (live.has(k)) seen[k] = state.seen[k]; // an action that goes away and comes back is new again
  const fresh = mine.filter((a) => !seen[a.key] || RANK[a.priority] > RANK[seen[a.key]]);
  const mark = (list: Action[]) => { for (const a of list) seen[a.key] = a.priority; };
  if (!state.baselined) { mark(mine); return { pops: [], state: { baselined: true, seen }, reason: "baseline" }; }
  if (!fresh.length) return { pops: [], state: { baselined: true, seen }, reason: "none" };
  if (inQuiet(prefs, o.minutesNow)) return { pops: [], state: { baselined: true, seen: Object.fromEntries(Object.entries(state.seen).filter(([k]) => live.has(k))) }, reason: "quiet" };
  mark(fresh);
  if (prefs.onlyWhenAway && o.inFront) return { pops: [], state: { baselined: true, seen }, reason: "in-front" };
  const top = [...fresh].sort((a, b) => RANK[b.priority] - RANK[a.priority] || (a.due || "9").localeCompare(b.due || "9"));
  const href = (a: Action) => a.href || "#/actions";
  if (fresh.length > 3) {
    const body = prefs.details ? top.slice(0, 3).map((a) => a.title).join("; ") + (fresh.length > 3 ? `; and ${fresh.length - 3} more` : "") : "Open the Action Centre to see them.";
    return { pops: [{ tag: "summary", title: `${fresh.length} new actions for you`, body, href: "#/actions" }], state: { baselined: true, seen }, reason: "shown" };
  }
  const pops = top.map((a) => prefs.details
    ? { tag: a.key, title: a.clientName ? `${a.clientName}: ${a.title}` : a.title, body: [a.detail, a.due ? `Due ${a.due}` : ""].filter(Boolean).join(" · "), href: href(a) }
    : { tag: a.key, title: "New action for you", body: "Open the planner to see it.", href: "#/actions" });
  return { pops, state: { baselined: true, seen }, reason: "shown" };
}

// ---------------------------------------------------------------- the device
export type Support = { ok: boolean; permission: "granted" | "denied" | "default" | "unsupported"; why?: string };
export function support(): Support {
  if (typeof window === "undefined" || !("Notification" in window)) return { ok: false, permission: "unsupported", why: "This browser doesn't support pop-up notifications. On an iPhone or iPad, add the planner to the Home Screen first." };
  if (!window.isSecureContext) return { ok: false, permission: "unsupported", why: "Pop-ups need the secure (https) address of the planner." };
  return { ok: true, permission: Notification.permission as Support["permission"] };
}
const storeKey = (me: string, what: string) => `pp.notify.${what}.${me.trim().toLowerCase()}`;
export function readPrefs(me: string): NotifyPrefs { try { const raw = localStorage.getItem(storeKey(me, "prefs")); return { ...DEFAULT_NOTIFY, ...(raw ? JSON.parse(raw) : {}) }; } catch { return DEFAULT_NOTIFY; } }
export function writePrefs(me: string, p: NotifyPrefs) { try { localStorage.setItem(storeKey(me, "prefs"), JSON.stringify(p)); } catch { /* private mode: the choice lasts until the tab closes */ } }
export function readState(me: string): NotifyState { try { const raw = localStorage.getItem(storeKey(me, "state")); const s = raw ? JSON.parse(raw) : null; return s && typeof s === "object" && s.seen ? { baselined: !!s.baselined, seen: s.seen } : EMPTY_STATE; } catch { return EMPTY_STATE; } }
export function writeState(me: string, s: NotifyState) { try { localStorage.setItem(storeKey(me, "state"), JSON.stringify(s)); } catch { /* ignore */ } }

export type Shown = { ok: boolean; via?: "service worker" | "browser"; error?: string };
const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T | undefined> => new Promise((res) => { const t = setTimeout(() => res(undefined), ms); p.then((v) => { clearTimeout(t); res(v); }, () => { clearTimeout(t); res(undefined); }); });
/** Android Chrome only allows pop-ups through the service worker, so that is tried first. It waits (briefly) for the worker to be active, because right after the app loads the
 *  worker may still be starting; the plain browser pop-up is the fallback on desktop. If both fail the reason is returned so the screen can say what went wrong. */
export async function showDetailed(p: Pop): Promise<Shown> {
  const sp = support(); if (!sp.ok) return { ok: false, error: sp.why }; if (sp.permission !== "granted") return { ok: false, error: "Permission isn't granted for this site." };
  const opts: NotificationOptions & { renotify?: boolean } = { body: p.body, tag: p.tag, icon: "/icon-192.png", badge: "/icon-192.png", data: { href: p.href } };
  let err = "";
  if ("serviceWorker" in navigator) {
    const reg = await withTimeout(navigator.serviceWorker.ready, 4000);
    if (reg) { try { await reg.showNotification(p.title, opts); return { ok: true, via: "service worker" }; } catch (e) { err = `Service worker: ${e instanceof Error ? e.message : String(e)}`; } }
    else err = "The app's background worker isn't running yet (it starts after the first load on the secure address). Reload the page and try again.";
  }
  try { const n = new Notification(p.title, opts); n.onclick = () => { window.focus(); window.location.hash = p.href.replace(/^#/, ""); n.close(); }; return { ok: true, via: "browser" }; } catch (e) { return { ok: false, error: err || (e instanceof Error ? e.message : String(e)) }; }
}
export const show = async (p: Pop) => (await showDetailed(p)).ok;
/** What this device is doing, for the settings panel: helps find out why a pop-up doesn't appear. */
export async function diagnose(): Promise<string[]> {
  const out: string[] = []; const sp = support();
  out.push(`Permission: ${sp.permission}${sp.ok ? "" : ` (${sp.why})`}`);
  out.push(`Secure address: ${typeof window !== "undefined" && window.isSecureContext ? "yes" : "no"}`);
  if ("serviceWorker" in navigator) { const reg = await navigator.serviceWorker.getRegistration().catch(() => undefined); out.push(`Background worker: ${reg ? (reg.active ? "running" : reg.installing || reg.waiting ? "starting" : "registered, not active") : "not registered"}`); } else out.push("Background worker: not supported");
  out.push(`Looking at the app: ${document.visibilityState === "visible" ? "yes" : "no"}`);
  return out;
}
export async function askPermission(): Promise<Support["permission"]> { const sp = support(); if (!sp.ok) return sp.permission; try { return (await Notification.requestPermission()) as Support["permission"]; } catch { return Notification.permission as Support["permission"]; } }
