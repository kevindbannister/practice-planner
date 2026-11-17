// Applying the look (lib/appearance.ts): the practice's colours on the page, and each person's own view on whichever computer they
// sign in on. The settings that make up the personal view still live where they always did on the device (so every screen keeps
// reading them as before); this keeps them in step with the copy saved to the person's account.
import { useEffect, useMemo } from "react";
import { LOOK_KEY, Personal, PracticeLook, lookVars, personalKey, readLook, readPersonal } from "../lib/appearance";
import { setServiceSlots } from "../lib/serviceColour";
import { readSetting, useData } from "./data";
import { setTheme, storedTheme } from "./theme";

const STAMP = "pp.appearance.updated";
const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* this visit only */ } };

/** The practice look as saved, with defaults for anything not chosen. */
export function usePracticeLook(): PracticeLook {
  const { data } = useData();
  return useMemo(() => readLook(readSetting(data.settings, LOOK_KEY)), [data.settings]);
}

/** This person's view as it is on this device now. */
export function devicePersonal(): Personal {
  const v = get("pp.home.view");
  return {
    layout: get("pp.practice.layout") === "side" ? "side" : "top",
    workView: v === "cards" || v === "bars" || v === "summary" ? v : "table",
    tips: get("pp.tips") === "1",
    theme: storedTheme(),
    updated: get(STAMP) || "",
  };
}

/** Put a personal view on this device, telling every screen that reads it. */
export function applyPersonal(p: Personal) {
  put("pp.practice.layout", p.layout);
  window.dispatchEvent(new Event("pp-layout"));
  put("pp.home.view", p.workView);
  window.dispatchEvent(new Event("pp-work-view"));
  put("pp.tips", p.tips ? "1" : "0");
  document.documentElement.toggleAttribute("data-tips", p.tips);
  setTheme(p.theme);
  if (p.updated) put(STAMP, p.updated);
}

/** Save a personal view: on this device straight away, and to the person's account so other computers pick it up. */
export function useSavePersonal(): (p: Omit<Personal, "updated">) => Promise<void> {
  const { user, saveSetting } = useData();
  return async (p) => {
    const next: Personal = { ...p, updated: new Date().toISOString() };
    applyPersonal(next);
    if (user) await saveSetting(personalKey(user), next);
  };
}

/** Renders nothing. Mount it before the screens so they draw with the practice's type-of-work colours from the start. */
export function AppearanceSync() {
  const { data, user } = useData();
  const look = usePracticeLook();
  setServiceSlots(look.serviceSlots);
  useEffect(() => {
    const vars = lookVars(look);
    for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v);
    put("pp.look.vars", JSON.stringify(vars));
  }, [look]);
  // the account's copy of this person's view wins when it is newer than what this device last had
  useEffect(() => {
    if (!user) return;
    const saved = readPersonal(readSetting(data.settings, personalKey(user)));
    if (!saved?.updated) return;
    const here = get(STAMP) || "";
    if (here >= saved.updated) return;
    applyPersonal(saved);
  }, [data.settings, user]);
  return null;
}
