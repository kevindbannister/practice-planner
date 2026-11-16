// How one person moves around the app (their menu style, the workspace they were last in, and the last page in each)
// is kept against their Microsoft 365 account, so it follows them to every device.
//
// - The account's copy lives in the practice's Settings list under a key of its own (navPrefs:<account id>), so one
//   person's changes can never overwrite another's, and no firm-wide setting is touched.
// - A copy is kept in this browser under the same account id, so the right menu shows at once on a device you have
//   used before, without waiting for the account's copy and without showing someone else's.
// - A change shows straight away, then is saved to the account. If that save fails the menu style goes back to the
//   last one that did save, and the profile menu says so.
import { useEffect, useRef, useSyncExternalStore } from "react";
import { DEFAULT_MENU, MenuKind, Mode, NavPrefs, defaultPrefs, effectiveMode, isThreeMode, landing, migrateLegacy, mergePrefs, noteVisit, prefsKey, readPrefs, sectionOfHash } from "../lib/navAreas";
import { readSetting, useData } from "./data";

type State = {
  /** The Microsoft 365 account id these preferences belong to ("" before sign-in is known). */
  uid: string;
  prefs: NavPrefs;
  /** The last copy known to be saved on the account. */
  saved?: NavPrefs;
  /** The account's copy has been read (or there was a copy from this device to start from). */
  ready: boolean;
  /** Changed here and not yet saved to the account. */
  dirty: boolean;
  /** The menu style was changed here and that change is not yet saved. */
  styleDirty: boolean;
  /** Bumped to ask for a save. */
  saveTick: number;
  error: string;
};

let state: State = { uid: "", prefs: defaultPrefs(), ready: false, dirty: false, styleDirty: false, saveTick: 0, error: "" };
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const set = (patch: Partial<State>) => { state = { ...state, ...patch }; emit(); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const now = () => new Date().toISOString();

const cacheKey = (uid: string) => `pp.nav.${uid}`;
const cache = (uid: string, p: NavPrefs) => { if (!uid) return; try { localStorage.setItem(cacheKey(uid), JSON.stringify(p)); } catch { /* this visit only */ } };
const LEGACY = ["pp.menu", "pp.mode", "pp.mode.last.practice", "pp.mode.last.work"];
const readLegacy = () => { const g = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }; return { menu: g(LEGACY[0]), mode: g(LEGACY[1]), lastPractice: g(LEGACY[2]), lastWork: g(LEGACY[3]) }; };
const clearLegacy = () => { for (const k of LEGACY) { try { localStorage.removeItem(k); } catch { /* fine */ } } };

/** Called once at start-up, before the first screen, with the signed-in account's id. */
export function initNavPrefs(uid: string) {
  let mine: NavPrefs | undefined;
  try { mine = readPrefs(localStorage.getItem(cacheKey(uid))); } catch { /* none */ }
  state = { uid, prefs: mine || defaultPrefs(), ready: !!mine, dirty: false, styleDirty: false, saveTick: 0, error: "" };
  emit();
}

export const getNavPrefs = () => state.prefs;

function change(next: NavPrefs, save: boolean) {
  if (next === state.prefs) return;
  cache(state.uid, next);
  set({ prefs: next, dirty: true, saveTick: save ? state.saveTick + 1 : state.saveTick });
}

/** Choose a menu style: shows at once, then saves to the account. */
export function setMenuStyle(k: MenuKind) {
  if (k === state.prefs.menuStyle) return;
  set({ error: "", styleDirty: true });
  change({ ...state.prefs, menuStyle: k, updated: now() }, true);
}

/** Note the page being shown. Kept on this device straight away; saved to the account when you next switch workspace
 *  or leave the tab, rather than on every page. */
export function notePage() {
  // the section is read from the address itself, so the page and its address can never be out of step
  const hash = typeof window === "undefined" ? "" : window.location.hash || "#/";
  change(noteVisit(state.prefs, sectionOfHash(hash), hash, now()), false);
}

/** Go to a workspace: its last page if there is one, otherwise its landing page. */
export function goToMode(m: Mode) {
  const three = isThreeMode(state.prefs.menuStyle);
  const to = landing(state.prefs, m, three);
  const pw = m === "advisory" ? state.prefs.lastPracticeWorkMode : m;
  change({ ...state.prefs, lastMode: m, lastPracticeWorkMode: pw, updated: now() }, true);
  if (window.location.hash !== to) window.location.hash = to;
}

export function useNavState(): State {
  return useSyncExternalStore(subscribe, () => state, () => state);
}
/** The menu style in use, and a way to change it. */
export function useMenuKind(): [MenuKind, (k: MenuKind) => void] {
  const s = useNavState();
  return [s.ready ? s.prefs.menuStyle : DEFAULT_MENU, setMenuStyle];
}
/** The workspace showing: the page's own, or on a shared page (Clients, Settings…) the one you were last in. */
export function useMode(section: string): Mode {
  const s = useNavState();
  return effectiveMode(s.prefs, section, isThreeMode(s.prefs.menuStyle));
}

/** Keeps the account's copy and this device in step. Renders nothing. */
export function NavPrefsSync() {
  const { status, data, saveSetting, refreshList } = useData();
  const s = useNavState();
  const key = prefsKey(s.uid);
  const row = data.settings.find((r) => r.Key === key);
  const account = row ? readPrefs(readSetting<unknown>(data.settings, key)) : undefined;
  const accountStamp = `${account?.updated || ""}|${account?.menuStyle || ""}`;
  // the latest of each, for the save (which runs outside the render)
  const latest = useRef({ saveSetting, refreshList, account });
  latest.current = { saveSetting, refreshList, account };
  const busy = useRef(false);
  const again = useRef(false);
  const creating = useRef(false);

  const push = async () => {
    if (!state.uid) return;
    if (busy.current) { again.current = true; return; }
    busy.current = true;
    const styleWas = state.styleDirty;
    let sending = state.prefs;
    try {
      // read the account's copy again first, so a change saved from another device since is kept rather than overwritten
      try { await latest.current.refreshList("Settings"); await new Promise((r) => window.setTimeout(r, 60)); } catch { /* save with what is known */ }
      const acct = latest.current.account;
      sending = acct ? mergePrefs(acct, state.prefs, state.styleDirty) : state.prefs;
      if (acct && sending === acct) {
        // nothing of this device's to add: take the account's copy
        cache(state.uid, acct);
        set({ prefs: acct, saved: acct, dirty: false, styleDirty: false, error: "" });
      } else {
        sending = { ...sending, updated: now() };
        await latest.current.saveSetting(prefsKey(state.uid), sending);
        // a change made while this one was saving stays "not yet saved"
        const moved = state.prefs.updated > sending.updated;
        const next = moved ? { ...state.prefs, menuStyle: state.styleDirty && state.prefs.menuStyle !== sending.menuStyle ? state.prefs.menuStyle : sending.menuStyle } : sending;
        cache(state.uid, next);
        set({ prefs: next, saved: sending, dirty: moved, styleDirty: state.prefs.menuStyle !== sending.menuStyle && state.styleDirty, error: "" });
      }
    } catch (e) {
      // keep the last style that did save; the pages visited stay on this device and go up with the next save
      const back = styleWas && state.saved ? { ...state.prefs, menuStyle: state.saved.menuStyle } : state.prefs;
      cache(state.uid, back);
      set({ prefs: back, dirty: false, styleDirty: false, error: styleWas ? `Your menu style couldn't be saved to your account${e instanceof Error && e.message ? ` (${e.message})` : ""}. It has gone back to the last one saved.` : "" });
    } finally {
      busy.current = false;
      if (again.current) { again.current = false; void push(); }
    }
  };

  // read the account's copy when the practice's data arrives, and again whenever it changes (another device saved)
  useEffect(() => {
    if (status !== "ready" || !s.uid) {
      // nothing to read from (not set up, the data couldn't be loaded, or no account id): carry on with what this device has
      if ((status === "error" || status === "needs-setup" || (status === "ready" && !s.uid)) && !state.ready) set({ ready: true });
      return;
    }
    if (account) {
      const next = state.ready ? mergePrefs(account, state.prefs, state.styleDirty) : account;
      if (next !== state.prefs) cache(s.uid, next);
      set({ prefs: next, saved: account, ready: true, dirty: next === account ? false : state.dirty });
      clearLegacy();
      return;
    }
    if (state.saved || creating.current) return; // already created during this visit; the list just hasn't caught up
    creating.current = true;
    // first time on this account: start from what this device remembered, and save it to the account
    const first = state.ready ? state.prefs : migrateLegacy(readLegacy(), now());
    cache(s.uid, first);
    set({ prefs: first, ready: true, dirty: true });
    void push().then(() => { if (!state.error) clearLegacy(); });
  }, [status, s.uid, accountStamp, !!row]); // eslint-disable-line react-hooks/exhaustive-deps

  // save when asked (a new menu style, or a switch of workspace)
  useEffect(() => { if (s.saveTick && status === "ready") void push(); }, [s.saveTick, status]); // eslint-disable-line react-hooks/exhaustive-deps

  // pages visited since the last save go up when you leave the tab
  useEffect(() => {
    const leave = () => { if (document.visibilityState === "hidden" && state.dirty && status === "ready") void push(); };
    document.addEventListener("visibilitychange", leave);
    return () => document.removeEventListener("visibilitychange", leave);
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

/** For the address bar and Back/Forward: the section of the page showing now. */
export const currentSection = () => sectionOfHash(typeof window === "undefined" ? "" : window.location.hash);
