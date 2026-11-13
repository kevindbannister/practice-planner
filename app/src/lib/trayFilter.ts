// Which unplanned work the tray shows, by deadline. Pure, so it can be tested.
import { addDays } from "./planning";

export type Horizon = "30" | "90" | "all" | "days" | "date";
export type HorizonIn = { horizon: Horizon; days: string; until: string; withRecords: boolean };
const iso = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

/** The last deadline to show, or "" for no limit. A number of days that isn't a whole number from 0 up, or a date that isn't one, means no limit. */
export function horizonEnd(h: HorizonIn, today: string): string {
  switch (h.horizon) {
    case "30": return addDays(today, 30);
    case "90": return addDays(today, 90);
    case "days": { const n = Number(h.days); return h.days.trim() !== "" && Number.isInteger(n) && n >= 0 && n <= 3650 ? addDays(today, n) : ""; }
    case "date": return iso(h.until) ? h.until : "";
    default: return "";
  }
}

/** Work with no deadline always shows; work due after the limit shows only if we have its records and that option is on. */
export function inHorizon(item: { deadline?: string; kind: string; recordsIn?: boolean }, h: HorizonIn, today: string): boolean {
  const end = horizonEnd(h, today);
  if (!end || !item.deadline || item.deadline <= end) return true;
  return h.withRecords && item.kind === "job" && !!item.recordsIn;
}
