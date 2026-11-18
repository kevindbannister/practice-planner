// How the app looks. Two parts:
// - the practice look, set by a partner or manager for everyone: the Work and Advisory bar colours, the Practice bar, the page
//   background, and a colour for each type of work. Kept in Settings under LOOK_KEY.
// - each person's own view: the Practice page layout, how Work by type is drawn, tips, and light or dark. Kept in Settings under
//   personalKey(user) so it follows them between computers (the menu style already does, through the navigation prefs).
// The colours are presets, not a free choice, so white text on a bar always stays readable and the type-of-work dots stay apart.

export type Preset = { key: string; label: string; value: string };

/** Dark bar colours that keep white text readable (tested at 4.5:1 or better). */
export const WORK_BARS: Preset[] = [
  { key: "navy", label: "Navy", value: "#1B3049" }, { key: "slate", label: "Slate", value: "#334155" }, { key: "ocean", label: "Ocean", value: "#0C4A6E" },
  { key: "teal", label: "Teal", value: "#134E4A" }, { key: "forest", label: "Forest", value: "#14532D" }, { key: "charcoal", label: "Charcoal", value: "#27272A" },
];
export const ADVISORY_BARS: Preset[] = [
  { key: "purple", label: "Purple", value: "#2E2368" }, { key: "indigo", label: "Indigo", value: "#312E81" }, { key: "plum", label: "Plum", value: "#581C87" },
  { key: "wine", label: "Wine", value: "#6B1D35" }, { key: "graphite", label: "Graphite", value: "#374151" }, { key: "navy", label: "Navy", value: "#1B3049" },
];
/** The Practice bar is light, with dark text. */
export const PRACTICE_BARS: Preset[] = [
  { key: "gradient", label: "Blue to lavender", value: "linear-gradient(95deg, #E7FAFF 0%, #F2F8FE 50%, #F2F3FF 100%)" },
  { key: "white", label: "Plain white", value: "#FFFFFF" },
  { key: "mist", label: "Soft grey", value: "linear-gradient(95deg, #EEF2F7 0%, #E9EEF5 100%)" },
  { key: "mint", label: "Mint to sky", value: "linear-gradient(95deg, #E9F8F1 0%, #EAF4FB 100%)" },
];
export type Canvas = { key: string; label: string; practice: string; work: string };
export const CANVASES: Canvas[] = [
  { key: "light", label: "Light", practice: "#F4F6F9", work: "#E7EBF0" },
  { key: "lighter", label: "Lighter", practice: "#F8F9FB", work: "#EEF1F5" },
  { key: "deeper", label: "Deeper", practice: "#EEF1F5", work: "#E1E6EC" },
];
/** The eight colours a type of work can have (0 is the neutral one); the CSS variables --svc-0 to --svc-7 hold them. */
export const SLOT_NAMES = ["Grey", "Blue", "Terracotta", "Teal", "Slate", "Orchid", "Sea green", "Violet"];

/** `practiceLine`: the line under the Practice bar in the bar's own colours ("bar") or plain white ("white"). */
export type PracticeLook = { workBar: string; advisoryBar: string; practiceBar: string; practiceLine: "bar" | "white"; canvas: string; serviceSlots: Record<string, number> };
export const DEFAULT_LOOK: PracticeLook = { workBar: "navy", advisoryBar: "purple", practiceBar: "gradient", practiceLine: "bar", canvas: "light", serviceSlots: {} };
export const LOOK_KEY = "appearance-practice";

const pick = (list: { key: string }[], v: unknown, fallback: string) => (typeof v === "string" && list.some((x) => x.key === v) ? v : fallback);

/** A saved practice look, with anything unknown or out of range put back to the default. */
export function readLook(raw: unknown): PracticeLook {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const slots: Record<string, number> = {};
  if (o.serviceSlots && typeof o.serviceSlots === "object") {
    for (const [k, v] of Object.entries(o.serviceSlots as Record<string, unknown>)) {
      const n = Number(v);
      if (k && Number.isInteger(n) && n >= 0 && n <= 7) slots[k] = n;
    }
  }
  return {
    workBar: pick(WORK_BARS, o.workBar, DEFAULT_LOOK.workBar),
    advisoryBar: pick(ADVISORY_BARS, o.advisoryBar, DEFAULT_LOOK.advisoryBar),
    practiceBar: pick(PRACTICE_BARS, o.practiceBar, DEFAULT_LOOK.practiceBar),
    practiceLine: o.practiceLine === "white" ? "white" : "bar",
    canvas: pick(CANVASES, o.canvas, DEFAULT_LOOK.canvas),
    serviceSlots: slots,
  };
}

/** The CSS variables a look sets (on the page, or on the preview box only). */
export function lookVars(look: PracticeLook): Record<string, string> {
  const find = (list: Preset[], k: string) => (list.find((x) => x.key === k) || list[0]).value;
  const canvas = CANVASES.find((c) => c.key === look.canvas) || CANVASES[0];
  return {
    "--work-bar": find(WORK_BARS, look.workBar),
    "--adv-bar": find(ADVISORY_BARS, look.advisoryBar),
    "--practice-bar": find(PRACTICE_BARS, look.practiceBar),
    "--canvas-practice": canvas.practice,
    "--canvas-work": canvas.work,
    // the line under the Practice bar, in light and in dark mode
    "--practice-line": look.practiceLine === "white" ? "var(--surface)" : find(PRACTICE_BARS, look.practiceBar),
    "--practice-line-dark": look.practiceLine === "white" ? "var(--surface)" : "linear-gradient(95deg, #10293b 0%, #1a2145 100%)",
  };
}

/* ---------- each person's own view ---------- */

export type Layout = "top" | "side";
export type WorkViewChoice = "table" | "cards" | "bars" | "summary";
export type ThemeChoice = "system" | "light" | "dark";
/** How the job card is laid out: 1 the original single column, 2 the wide two-column card, 3 half the screen with everything in view. */
export type JobCardVersion = "1" | "2" | "3" | "4";
export const JOB_CARDS: [JobCardVersion, string, string][] = [
  ["4", "Version 4", "As version 3, with the stages down the left-hand side"],
  ["3", "Version 3", "Half the screen, everything in view without scrolling, checklist inside the card"],
  ["2", "Version 2", "Wide card in two columns, with More folded at the bottom"],
  ["1", "Version 1", "The original single column"],
];
export type Personal = { layout: Layout; workView: WorkViewChoice; tips: boolean; theme: ThemeChoice; jobCard: JobCardVersion; updated: string };
export const DEFAULT_PERSONAL: Personal = { layout: "top", workView: "table", tips: false, theme: "system", jobCard: "4", updated: "" };
export const personalKey = (user: string) => `appearance:${user.trim().toLowerCase()}`;

export function readPersonal(raw: unknown): Personal | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  return {
    layout: o.layout === "side" ? "side" : "top",
    workView: o.workView === "cards" || o.workView === "bars" || o.workView === "summary" ? o.workView : "table",
    tips: o.tips === true,
    theme: o.theme === "light" || o.theme === "dark" ? o.theme : "system",
    jobCard: o.jobCard === "1" || o.jobCard === "2" || o.jobCard === "3" ? o.jobCard : "4",
    updated: typeof o.updated === "string" ? o.updated : "",
  };
}

/* ---------- contrast, for the tests and the picker ---------- */

const channel = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
export function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return NaN;
  const n = parseInt(m[1], 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
