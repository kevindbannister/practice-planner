// How a client's logo is shown: as a square (for small icon-like logos) or a rectangle (for wide ones), and how big.
// It is a display choice kept in Settings, one entry per client, so the Freedom Plan banner and the client page agree.
export type LogoShape = "square" | "rectangle";
export type LogoSize = { shape: LogoShape; size: number };
export const LOGO_SIZE_KEY = "client.logo-sizes";
export const MIN_SIZE = 28;
export const MAX_SIZE = 96;
export const DEFAULT_LOGO_SIZE: LogoSize = { shape: "rectangle", size: 44 };
/** A rectangle is this many times wider than it is high. */
export const RECT_RATIO = 2.5;

export const cleanLogoSize = (v: unknown): LogoSize => {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const size = typeof o.size === "number" && Number.isFinite(o.size) ? Math.round(Math.min(MAX_SIZE, Math.max(MIN_SIZE, o.size))) : DEFAULT_LOGO_SIZE.size;
  return { shape: o.shape === "square" ? "square" : "rectangle", size };
};
export function readLogoSizes(raw: unknown): Record<string, LogoSize> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).slice(0, 5000).map(([k, v]) => [k, cleanLogoSize(v)]));
}
export const logoSizeOf = (all: Record<string, LogoSize>, clientKey: string): LogoSize => all[clientKey] || DEFAULT_LOGO_SIZE;
/** The box the logo sits in, in pixels. The picture is fitted inside it without being stretched. */
export const logoBox = (s: LogoSize): { width: number; height: number } => ({ width: s.shape === "square" ? s.size : Math.round(s.size * RECT_RATIO), height: s.size });
/** The saved set with one client's size set (the default size is removed rather than kept). */
export function withLogoSize(all: Record<string, LogoSize>, clientKey: string, s: LogoSize): Record<string, LogoSize> {
  const next = { ...all };
  const c = cleanLogoSize(s);
  if (c.shape === DEFAULT_LOGO_SIZE.shape && c.size === DEFAULT_LOGO_SIZE.size) delete next[clientKey]; else next[clientKey] = c;
  return next;
}
