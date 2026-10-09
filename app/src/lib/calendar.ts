// Outlook calendar: meetings reduce the hours you have each day, and planned work is put in
// your calendar as time blocks that fit around them. Blocks the planner makes are tagged so
// it only ever changes its own; your other events are only read.
import { Graph } from "./graph";
import { addDays } from "./planning";

export type CalendarPrefs = {
  enabled: boolean;
  readMeetings: boolean; // meetings reduce your hours
  writeBlocks: boolean; // planned work goes in the calendar
  dayStart: string; // "09:00"
  dayEnd: string; // "17:30"
  lunchStart: string; // "13:00"
  lunchMins: number; // 60; 0 = no lunch break
  showAs: "busy" | "free" | "tentative";
};

export const DEFAULT_CAL: CalendarPrefs = {
  enabled: false, readMeetings: true, writeBlocks: true, dayStart: "09:00", dayEnd: "17:30", lunchStart: "13:00", lunchMins: 60, showAs: "busy",
};

export const CAL_SCOPE = "Calendars.ReadWrite";
export const CATEGORY = "Practice Planner";
export const BLOCK_PROP = "String {c1a5d3f2-8a9b-4e8f-9c2d-6b3a1e7f0d42} Name PPBlock";
export const WINDOW_DAYS = 28; // keep the next four weeks in step

export type CalEvent = {
  id: string;
  subject?: string;
  start: Date;
  end: Date;
  allDay: boolean;
  showAs: string;
  cancelled: boolean;
  block?: string; // set on the planner's own blocks
};

type Interval = [number, number]; // minutes from midnight

export const mins = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};
export const hhmm = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;

/** Local midnight of an ISO day, as a Date. */
export function localDay(iso: string): Date {
  return new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
}
const localIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const atMinutes = (iso: string, m: number) => new Date(localDay(iso).getTime() + m * 60000);

// ------------------------------------------------------------------ reading

function parseGraphTime(t: { dateTime: string; timeZone?: string }): Date {
  // Graph returns UTC unless asked otherwise
  const s = t.dateTime.replace(/\.\d+$/, "");
  return new Date(/Z|[+-]\d\d:\d\d$/.test(s) ? s : `${s}Z`);
}

export async function fetchEvents(graph: Graph, from: string, to: string): Promise<CalEvent[]> {
  const q = new URLSearchParams({
    startDateTime: localDay(from).toISOString(),
    endDateTime: localDay(addDays(to, 1)).toISOString(),
    $top: "200",
    $select: "subject,start,end,showAs,isAllDay,isCancelled,categories",
    $expand: `singleValueExtendedProperties($filter=id eq '${BLOCK_PROP}')`,
  });
  const raw = await graph.getAll<any>(`/me/calendarView?${q}`);
  return raw.map((e) => ({
    id: e.id,
    subject: e.subject,
    start: parseGraphTime(e.start),
    end: parseGraphTime(e.end),
    allDay: !!e.isAllDay,
    showAs: e.showAs || "busy",
    cancelled: !!e.isCancelled,
    block: (e.singleValueExtendedProperties || []).find((p: any) => p.id?.toLowerCase() === BLOCK_PROP.toLowerCase())?.value,
  }));
}

const BUSY = new Set(["busy", "oof", "tentative"]);

/** Meetings and other busy time on a day, as minutes from midnight, merged. */
export function busyOn(day: string, events: CalEvent[]): Interval[] {
  const start = localDay(day).getTime();
  const end = start + 1440 * 60000;
  const out: Interval[] = [];
  for (const e of events) {
    if (e.block || e.cancelled || !BUSY.has(e.showAs)) continue;
    const s = Math.max(e.start.getTime(), start);
    const f = Math.min(e.end.getTime(), end);
    if (f <= s) continue;
    out.push([Math.round((s - start) / 60000), Math.round((f - start) / 60000)]);
  }
  return merge(out);
}

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

/** Free gaps in the working day, after lunch and meetings. */
export function freeGaps(prefs: CalendarPrefs, busy: Interval[]): Interval[] {
  const blocked = [...busy];
  if (prefs.lunchMins > 0) blocked.push([mins(prefs.lunchStart), mins(prefs.lunchStart) + prefs.lunchMins]);
  let gaps: Interval[] = [[mins(prefs.dayStart), mins(prefs.dayEnd)]];
  for (const [bs, be] of merge(blocked)) {
    gaps = gaps.flatMap(([gs, ge]): Interval[] => {
      if (be <= gs || bs >= ge) return [[gs, ge]];
      const parts: Interval[] = [];
      if (bs > gs) parts.push([gs, bs]);
      if (be < ge) parts.push([be, ge]);
      return parts;
    });
  }
  return gaps.filter(([s, e]) => e - s >= 5);
}

/** Hours of meetings inside the working day (not counting lunch). */
export function meetingHours(prefs: CalendarPrefs, busy: Interval[]): number {
  const window = freeGaps({ ...prefs }, []);
  const total = window.reduce((t, [s, e]) => t + (e - s), 0);
  const free = freeGaps(prefs, busy).reduce((t, [s, e]) => t + (e - s), 0);
  return Math.max(0, (total - free) / 60);
}

/** Hours you have on a day: your usual hours, less meetings in the working day. */
export function capacityOn(usual: number, prefs: CalendarPrefs, busy: Interval[]): number {
  return Math.max(0, Math.round((usual - meetingHours(prefs, busy)) * 4) / 4);
}

// ------------------------------------------------------------------ writing blocks

export type PlannedItem = { key: string; day: string; hours: number; subject: string; note: string };
export type Block = { id: string; day: string; start: number; end: number; subject: string; note: string };

/**
 * Time blocks for planned work, fitted into each day's free gaps in the order given. A piece
 * of work that spans a meeting is split into more than one block. Work that doesn't fit in
 * the working day is left out of the calendar (it's still planned in the planner).
 */
export function layoutBlocks(items: PlannedItem[], prefs: CalendarPrefs, busyByDay: Record<string, Interval[]>): { blocks: Block[]; unfitted: string[] } {
  const blocks: Block[] = [];
  const unfitted: string[] = [];
  const days = [...new Set(items.map((i) => i.day))];
  for (const day of days) {
    let gaps = freeGaps(prefs, busyByDay[day] || []);
    for (const item of items.filter((i) => i.day === day)) {
      const trial = gaps.map(([a, b]) => [a, b] as Interval);
      let need = Math.round(item.hours * 60);
      const placed: Block[] = [];
      for (const g of trial) {
        if (need <= 0) break;
        const take = Math.min(need, g[1] - g[0]);
        if (take <= 0 || (take < 15 && need > take)) continue; // no tiny fragments
        placed.push({ id: `${item.key}#${placed.length + 1}`, day, start: g[0], end: g[0] + take, subject: item.subject, note: item.note });
        g[0] += take;
        need -= take;
      }
      if (need > 0) {
        unfitted.push(item.key); // doesn't fit today: leave the gaps as they were
        continue;
      }
      gaps = trial;
      blocks.push(...placed);
    }
  }
  return { blocks, unfitted };
}

export type CalChanges = {
  create: Block[];
  update: { id: string; block: Block }[];
  remove: string[]; // event ids
};

/** Compare wanted blocks with the planner's existing blocks from `today` on. */
export function diffBlocks(wanted: Block[], existing: CalEvent[], today: string): CalChanges {
  const mine = existing.filter((e) => e.block && localIso(e.start) >= today);
  const byBlock = new Map(mine.map((e) => [e.block!, e]));
  const out: CalChanges = { create: [], update: [], remove: [] };
  const seen = new Set<string>();
  for (const b of wanted) {
    const e = byBlock.get(b.id);
    seen.add(b.id);
    if (!e) {
      out.create.push(b);
      continue;
    }
    const s = atMinutes(b.day, b.start).getTime();
    const f = atMinutes(b.day, b.end).getTime();
    if (e.start.getTime() !== s || e.end.getTime() !== f || e.subject !== b.subject) out.update.push({ id: e.id, block: b });
  }
  for (const e of mine) if (!seen.has(e.block!)) out.remove.push(e.id);
  // a duplicate of the same block (e.g. from two devices) goes too
  const counts = new Map<string, number>();
  for (const e of mine) counts.set(e.block!, (counts.get(e.block!) || 0) + 1);
  for (const [block, n] of counts) {
    if (n < 2) continue;
    const dupes = mine.filter((e) => e.block === block).slice(1);
    for (const d of dupes) if (!out.remove.includes(d.id)) out.remove.push(d.id);
  }
  return out;
}

const graphTime = (d: Date) => ({ dateTime: d.toISOString().replace("Z", ""), timeZone: "UTC" });

export function eventBody(b: Block, prefs: CalendarPrefs) {
  return {
    subject: b.subject,
    start: graphTime(atMinutes(b.day, b.start)),
    end: graphTime(atMinutes(b.day, b.end)),
    showAs: prefs.showAs,
    categories: [CATEGORY],
    isReminderOn: false,
    body: { contentType: "text", content: `${b.note}\n\nPlanned in Practice Planner. Change it there; this block moves with it.` },
    singleValueExtendedProperties: [{ id: BLOCK_PROP, value: b.id }],
  };
}

export async function applyChanges(graph: Graph, c: CalChanges, prefs: CalendarPrefs): Promise<number> {
  let n = 0;
  for (const id of c.remove) {
    await graph.delete(`/me/events/${encodeURIComponent(id)}`);
    n++;
  }
  for (const u of c.update) {
    const body = eventBody(u.block, prefs);
    await graph.patch(`/me/events/${encodeURIComponent(u.id)}`, { subject: body.subject, start: body.start, end: body.end, showAs: body.showAs });
    n++;
  }
  for (const b of c.create) {
    await graph.post("/me/events", eventBody(b, prefs));
    n++;
  }
  return n;
}

export function windowDays(today: string): string[] {
  return Array.from({ length: WINDOW_DAYS }, (_, i) => addDays(today, i));
}
