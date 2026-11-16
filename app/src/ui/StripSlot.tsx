// The Practice strip (the second bar under the Practice menu) has a space for the tabs of the section you are in.
// A section's tab bar puts itself there when the strip is showing, and sits on the page as before when it isn't.
import { ReactNode, useSyncExternalStore } from "react";
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
