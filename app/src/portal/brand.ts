// The practice's look for the portal: colours, logo, welcome message, contact details. The server
// checks and stores them (api/portal/lib/branding.js); this applies them in the browser and mirrors
// the contrast arithmetic so the staff preview can show what the server will accept.
export type Colours = { primary: string; secondary: string; accent: string; background: string; button: string; buttonInk: string; headerBg: string; headerInk: string };
export type PortalBranding = { practiceName: string; logo: string; loginLogo: string; colours: Colours; welcome: string; contact: { phone: string; address: string; hours: string }; supportEmail: string };

export const DEFAULT_COLOURS: Colours = { primary: "#0f4c81", secondary: "#3b6ea5", accent: "#c2410c", background: "#f4f6f9", button: "#0f4c81", buttonInk: "#ffffff", headerBg: "#ffffff", headerInk: "#1b2430" };
export const COLOUR_LABELS: Record<keyof Colours, string> = { primary: "Primary colour", secondary: "Secondary colour", accent: "Accent colour", background: "Page background", button: "Button colour", buttonInk: "Button text", headerBg: "Header background", headerInk: "Header text" };
const FIXED = { text: "#1b2430", muted: "#566271", surface: "#ffffff" };

const channel = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
export const isHex = (v: string) => /^#[0-9a-f]{6}$/i.test(v);
export function ratio(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
/** Black or white, whichever reads better on this colour. */
export const inkFor = (hex: string) => (ratio("#ffffff", hex) >= ratio("#000000", hex) ? "#ffffff" : "#000000");

export type Check = { id: string; label: string; ratio: number; min: number; pass: boolean };
export function contrastChecks(c: Colours): Check[] {
  const pair = (id: string, label: string, fg: string, bg: string, min: number): Check => { const r = Math.round(ratio(fg, bg) * 100) / 100; return { id, label, ratio: r, min, pass: r >= min }; };
  return [
    pair("text", "Main text on the page background", FIXED.text, c.background, 4.5),
    pair("muted", "Secondary text on the page background", FIXED.muted, c.background, 4.5),
    pair("link", "Links and headings (primary) on white cards", c.primary, FIXED.surface, 4.5),
    pair("link-bg", "Links (primary) on the page background", c.primary, c.background, 4.5),
    pair("button", "Button text on the button colour", c.buttonInk, c.button, 4.5),
    pair("header", "Header text on the header background", c.headerInk, c.headerBg, 4.5),
    pair("focus", "Keyboard focus outline (accent) on white", c.accent, FIXED.surface, 3),
    pair("focus-bg", "Keyboard focus outline (accent) on the page background", c.accent, c.background, 3),
    pair("secondary", "Secondary colour on white", c.secondary, FIXED.surface, 3),
  ];
}

/** Nudge colours until every check passes: readable text colours first, then a darker primary/accent. */
export function fixColours(c: Colours): Colours {
  const out = { ...c };
  const darken = (hex: string) => { const n = parseInt(hex.slice(1), 16); const f = (v: number) => Math.max(0, Math.round(v * 0.85)); return "#" + [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)].map((v) => v.toString(16).padStart(2, "0")).join(""); };
  out.buttonInk = inkFor(out.button);
  out.headerInk = inkFor(out.headerBg);
  for (const k of ["primary", "accent", "secondary"] as const) {
    const min = k === "primary" ? 4.5 : 3;
    const against = k === "secondary" ? [FIXED.surface] : [FIXED.surface, out.background];
    for (let i = 0; i < 40 && against.some((bg) => ratio(out[k], bg) < min); i++) out[k] = darken(out[k]);
  }
  return out;
}

export const BLANK: PortalBranding = { practiceName: "", logo: "", loginLogo: "", colours: DEFAULT_COLOURS, welcome: "", contact: { phone: "", address: "", hours: "" }, supportEmail: "" };

/** Put a look onto the page (colours as CSS variables, title). Safe to call again with a new look. */
export function applyBranding(b: PortalBranding | undefined, root: HTMLElement = document.documentElement) {
  const c = { ...DEFAULT_COLOURS, ...(b?.colours || {}) };
  for (const [k, v] of Object.entries(c)) if (!isHex(v)) return;
  const set = (name: string, v: string) => root.style.setProperty(name, v);
  set("--p-primary", c.primary); set("--p-primary-ink", inkFor(c.primary)); set("--p-secondary", c.secondary); set("--p-accent", c.accent);
  set("--p-bg", c.background); set("--p-btn", c.button); set("--p-btn-ink", c.buttonInk); set("--p-header-bg", c.headerBg); set("--p-header-ink", c.headerInk);
}
