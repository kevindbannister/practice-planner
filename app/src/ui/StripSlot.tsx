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
