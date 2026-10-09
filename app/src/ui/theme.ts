// Light and dark mode. "system" follows the device setting. The choice is remembered on
// this device only; public/theme.js applies it before the page draws, so there's no flash.
import { useEffect, useState } from "react";

export type ThemeChoice = "system" | "light" | "dark";
const KEY = "pp.theme";
const media = () => (typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null);

export function storedTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function apply(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
}

const listeners = new Set<() => void>();

export function setTheme(choice: ThemeChoice) {
  try {
    if (choice === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    /* still applies for this visit */
  }
  apply(choice);
  listeners.forEach((l) => l());
}

/** The current choice and whether the page is dark right now. */
export function useTheme(): { choice: ThemeChoice; dark: boolean; set: (c: ThemeChoice) => void } {
  const read = () => {
    const choice = (document.documentElement.getAttribute("data-theme") as ThemeChoice | null) || storedTheme();
    return { choice, dark: choice === "dark" || (choice === "system" && !!media()?.matches) };
  };
  const [state, setState] = useState(read);
  useEffect(() => {
    const update = () => setState(read());
    listeners.add(update);
    const m = media();
    m?.addEventListener("change", update);
    return () => {
      listeners.delete(update);
      m?.removeEventListener("change", update);
    };
  }, []);
  return { ...state, set: setTheme };
}
