// A space down the left of the screen for the views of the section you are in. A section's tabs put themselves there
// when Practice pages are set to "List down the left"; otherwise they sit along the top of the page.
import { ReactNode, useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

let slot: HTMLElement | null = null;
const subs = new Set<() => void>();

/** Called by the strip with its tab space (and with null when the strip goes). */
export function setStripSlot(el: HTMLElement | null) {
  if (slot === el) return;
  slot = el;
  subs.forEach((f) => f());
}

/** The strip's tab space, or null when there is no strip. */
export function useStripSlot(): HTMLElement | null {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => slot, () => null);
}

// The white band under the full-width Practice bar. It is part of the menu, so it never moves with the page:
// pages put their views into it, and only those contents change.
let band: HTMLElement | null = null;
const bandSubs = new Set<() => void>();

/** Called by the menu with the band's space (and with null when the band goes). */
export function setBandSlot(el: HTMLElement | null) {
  if (band === el) return;
  band = el;
  bandSubs.forEach((f) => f());
}

/** The band's space under the full-width bar, or null when there is no band. */
export function useBandSlot(): HTMLElement | null {
  return useSyncExternalStore((f) => { bandSubs.add(f); return () => { bandSubs.delete(f); }; }, () => band, () => null);
}

/** Shows its contents in the strip when there is one, otherwise where it is. */
export function InStrip({ children }: { children: ReactNode }) {
  const el = useStripSlot();
  return el ? createPortal(children, el) : <>{children}</>;
}

/** How Practice pages show a section's views: along the top of the page, or listed down the left. Remembered on this device. */
export type PracticeLayout = "top" | "side";
const LAYOUT_KEY = "pp.practice.layout";
const readLayout = (): PracticeLayout => { try { return localStorage.getItem(LAYOUT_KEY) === "side" ? "side" : "top"; } catch { return "top"; } };
export function usePracticeLayout(): [PracticeLayout, (v: PracticeLayout) => void] {
  const [v, setV] = useState<PracticeLayout>(readLayout);
  useEffect(() => {
    const f = () => setV(readLayout());
    window.addEventListener("pp-layout", f);
    return () => window.removeEventListener("pp-layout", f);
  }, []);
  return [v, (n) => { try { localStorage.setItem(LAYOUT_KEY, n); } catch { /* this visit only */ } setV(n); window.dispatchEvent(new Event("pp-layout")); }];
}

/** How the Practice bar looks: the floating glass bar, or the full-width bar with the views in a band joined under it (as in Work). Remembered on this device. */
export type PracticeBar = "float" | "flat";
const BAR_KEY = "pp.practice.bar";
const readBar = (): PracticeBar => { try { return localStorage.getItem(BAR_KEY) === "float" ? "float" : "flat"; } catch { return "flat"; } };
export function usePracticeBar(): [PracticeBar, (v: PracticeBar) => void] {
  const [v, setV] = useState<PracticeBar>(readBar);
  useEffect(() => {
    const f = () => setV(readBar());
    window.addEventListener("pp-bar", f);
    return () => window.removeEventListener("pp-bar", f);
  }, []);
  return [v, (n) => { try { localStorage.setItem(BAR_KEY, n); } catch { /* this visit only */ } setV(n); window.dispatchEvent(new Event("pp-bar")); }];
}
