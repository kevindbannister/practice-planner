// The planner's hour-by-hour view: where each piece of a day's work sits in time. Work with a
// start time goes there; the rest fills the free time in your working day in the order you've
// set, around your meetings and lunch, splitting round a meeting if it has to. Work that
// doesn't fit is listed under the day.
import { CalendarPrefs, freeGaps, mins } from "./calendar";

type Interval = [number, number];

export type GridIn = { key: string; hours: number; start?: string };
export type Placed = { key: string; segments: Interval[]; pinned: boolean; clash: boolean };

const SNAP = 15;
const MIN_PIECE = 45; // the shortest piece a longer job is split into
export const snap = (m: number) => Math.round(m / SNAP) * SNAP;

function merge(list: Interval[]): Interval[] {
  const sorted = [...list].sort((a, b) => a[0] - b[0]);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i[0] <= last[1]) last[1] = Math.max(last[1], i[1]);
    else out.push([i[0], i[1]]);
  }
  return out;
}
const overlaps = (a: Interval, list: Interval[]) => list.some((b) => a[0] < b[1] && b[0] < a[1]);

/** Lay out a day's work (already in your order) around meetings (busy) and lunch. */
export function layoutDay(items: GridIn[], prefs: CalendarPrefs, busy: Interval[]): { placed: Placed[]; unfitted: string[] } {
  const placed: Placed[] = [];
  const unfitted: string[] = [];
  const taken: Interval[] = [];

  // work with a start time first, where you put it
  for (const it of items) {
    if (!it.start) continue;
    const s = mins(it.start);
    const seg: Interval = [s, s + Math.max(SNAP, Math.round(it.hours * 60))];
    placed.push({ key: it.key, segments: [seg], pinned: true, clash: overlaps(seg, busy) || overlaps(seg, taken) });
    taken.push(seg);
  }

  // then the rest, in order, into the free time left
  let gaps = freeGaps(prefs, merge([...busy, ...taken]));
  for (const it of items) {
    if (it.start) continue;
    let need = Math.round(it.hours * 60);
    const trial = gaps.map(([a, b]) => [a, b] as Interval);
    const segs: Interval[] = [];
    for (const g of trial) {
      if (need <= 0) break;
      const take = Math.min(need, g[1] - g[0]);
      // don't start a split piece in a short gap: leave it for smaller work
      if (take <= 0 || (take < MIN_PIECE && need > take)) continue;
      segs.push([g[0], g[0] + take]);
      g[0] += take;
      need -= take;
    }
    if (need > 0 || !segs.length) {
      unfitted.push(it.key);
      continue;
    }
    gaps = trial;
    placed.push({ key: it.key, segments: segs, pinned: false, clash: false });
  }
  return { placed, unfitted };
}

/** The hours shown: your working day with an hour either side, stretched for anything outside it. */
export function gridRange(prefs: CalendarPrefs, extra: Interval[]): [number, number] {
  let from = Math.floor(mins(prefs.dayStart) / 60) * 60 - 60;
  let to = Math.ceil(mins(prefs.dayEnd) / 60) * 60 + 60;
  for (const [s, e] of extra) {
    from = Math.min(from, Math.floor(s / 60) * 60);
    to = Math.max(to, Math.ceil(e / 60) * 60);
  }
  return [Math.max(0, from), Math.min(24 * 60, to)];
}

/** Times outside your working day, and lunch, for shading. */
export function offHours(prefs: CalendarPrefs, range: [number, number]): Interval[] {
  const out: Interval[] = [];
  const start = mins(prefs.dayStart), end = mins(prefs.dayEnd);
  if (range[0] < start) out.push([range[0], start]);
  if (prefs.lunchMins > 0) out.push([mins(prefs.lunchStart), mins(prefs.lunchStart) + prefs.lunchMins]);
  if (end < range[1]) out.push([end, range[1]]);
  return out;
}

export const clock = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
