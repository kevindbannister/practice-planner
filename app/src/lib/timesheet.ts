// Timesheets. There is one set of actual time: the JobTime list (timer and typed entries). A timesheet is only a way of looking at and adding to it, by
// day or week, so a timer run on a job and the same time seen on the timesheet are one record, and a job's actual hours count it once.
// An entry can be for a job, a task, a client, or no client at all (internal work), can be linked to a planned session (never has to be), and carries an
// activity (what kind of work it was) which says whether it is billable, non-billable client time or internal time unless that is overridden.
import { Row } from "./schema";
import { TimeEntry, readTime, round2 } from "./jobTime";

const s = (v: unknown) => String(v ?? "").trim();
const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export type Billable = "billable" | "nonbillable" | "internal";
export const BILLABLE_LABEL: Record<Billable, string> = { billable: "Billable client time", nonbillable: "Non-billable client time", internal: "Internal time" };
export type Activity = { key: string; name: string; category: Billable; active: boolean };

const act = (name: string, category: Billable): Activity => ({ key: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), name, category, active: true });
export const DEFAULT_ACTIVITIES: Activity[] = [
  act("Accounts preparation", "billable"), act("Accounts review", "billable"), act("Bookkeeping", "billable"), act("VAT", "billable"), act("Payroll", "billable"), act("Tax", "billable"), act("Company secretarial", "billable"),
  act("Client meetings", "billable"), act("Telephone calls", "nonbillable"), act("Email and correspondence", "nonbillable"), act("Chasing records", "nonbillable"),
  act("Administration", "internal"), act("Business development", "internal"), act("Training", "internal"), act("Software development", "internal"), act("Internal management", "internal"),
];
/** The practice's own list from Settings where it has one (inactive ones stay so old entries still name them), else the suggested ones. */
export function activitiesFrom(saved: unknown): Activity[] {
  if (!Array.isArray(saved) || !saved.length) return DEFAULT_ACTIVITIES;
  const out: Activity[] = [];
  for (const a of saved) {
    const name = s((a as Activity)?.name);
    const cat = s((a as Activity)?.category) as Billable;
    if (!name) continue;
    out.push({ key: s((a as Activity).key) || act(name, "internal").key, name, category: (["billable", "nonbillable", "internal"] as string[]).includes(cat) ? cat : "internal", active: (a as Activity).active !== false });
  }
  return out.length ? out : DEFAULT_ACTIVITIES;
}

// ------------------------------------------------------------------ dates (UK local for the day, a timestamp for timed work)

const LONDON = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function partsOf(ms: number) {
  const p = Object.fromEntries(LONDON.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hhmm: `${p.hour}:${p.minute}`, ms };
}
/** The UK date an instant falls on (so 23:30 on a summer evening is that day, not the next in UTC). */
export const londonDate = (iso: string): string => (Number.isNaN(Date.parse(iso)) ? "" : partsOf(Date.parse(iso)).date);
export const londonTime = (iso: string): string => (Number.isNaN(Date.parse(iso)) ? "" : partsOf(Date.parse(iso)).hhmm);
/** The instant for a UK wall clock time on a date. */
export function londonIso(date: string, hhmm: string): string {
  const [y, m, d] = date.split("-").map(Number), [h, mi] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  for (const off of [0, -1, 1]) { // the clock is an hour ahead in summer: try each and keep the one that reads back as asked
    const t = guess + off * 3600000;
    const back = partsOf(t);
    if (back.date === date && back.hhmm === `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`) return new Date(t).toISOString();
  }
  return new Date(guess).toISOString();
}
export const parseClock = (t: string): string | undefined => { const m = /^(\d{1,2})[:.]?(\d{2})$/.exec(t.trim()); return m && +m[1] < 24 && +m[2] < 60 ? `${m[1].padStart(2, "0")}:${m[2]}` : undefined; };

// ------------------------------------------------------------------ entries

export type Entry = TimeEntry & { taskKey: string; sessionKey: string; activityKey: string; workDate: string; billable: Billable | ""; version: number };
export const readEntry = (r: Row): Entry => {
  const e = readTime(r);
  const billable = s(r.BillableType);
  return { ...e, taskKey: s(r.TaskKey), sessionKey: s(r.SessionKey), activityKey: s(r.ActivityKey), workDate: s(r.WorkDate).slice(0, 10) || londonDate(e.ended || e.started), billable: (["billable", "nonbillable", "internal"].includes(billable) ? billable : "") as Billable | "", version: Math.max(1, Math.round(n(r.Version)) || 1) };
};

/** Minutes on an entry: a finished one is what was recorded, a running timer counts up to now. */
export const entryMinutes = (e: Entry, now: Date): number => (e.ended ? Math.round(e.hours * 60) : e.kind === "timer" && e.started ? Math.max(0, Math.round((now.getTime() - Date.parse(e.started)) / 60000)) : 0);

/** Billable, non-billable client time or internal: what was set on the entry, else its activity's, else billable if it is for a client or job and internal if not. */
export function billableOf(e: Entry, activities: Activity[]): Billable {
  if (e.billable) return e.billable;
  const a = activities.find((x) => x.key === e.activityKey);
  if (a) return a.category;
  return e.jobKey || e.clientKey ? "billable" : "internal";
}

export const sessionMinutes = (entries: Entry[], sessionKey: string, now: Date): number => entries.filter((e) => e.sessionKey === sessionKey).reduce((t, e) => t + entryMinutes(e, now), 0);

// ------------------------------------------------------------------ views

export type Cell = { minutes: number; entries: Entry[] };
export type GridRow = { key: string; clientKey: string; jobKey: string; taskKey: string; activityKey: string; cells: Cell[]; total: number };
export type Grid = { days: string[]; rows: GridRow[]; dayTotals: number[]; total: number };
export const addDay = (d: string, k: number): string => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + k); return t.toISOString().slice(0, 10); };
export const rowKey = (x: { clientKey: string; jobKey: string; taskKey: string; activityKey: string }) => [x.clientKey, x.jobKey, x.taskKey, x.activityKey].join("|");

/** Rows are what the time was for (client, job or task, activity); columns the seven days from `week`. `extra` rows are ones just added and still empty. */
export function weekGrid(entries: Entry[], week: string, now: Date, extra: { clientKey: string; jobKey: string; taskKey: string; activityKey: string }[] = []): Grid {
  const days = Array.from({ length: 7 }, (_, i) => addDay(week, i));
  const rows = new Map<string, GridRow>();
  const get = (x: { clientKey: string; jobKey: string; taskKey: string; activityKey: string }) => {
    const k = rowKey(x);
    if (!rows.has(k)) rows.set(k, { key: k, clientKey: x.clientKey, jobKey: x.jobKey, taskKey: x.taskKey, activityKey: x.activityKey, cells: days.map(() => ({ minutes: 0, entries: [] })), total: 0 });
    return rows.get(k)!;
  };
  for (const e of entries) {
    const i = days.indexOf(e.workDate);
    if (i < 0) continue;
    const r = get(e), c = r.cells[i], m = entryMinutes(e, now);
    c.entries.push(e); c.minutes += m; r.total += m;
  }
  for (const x of extra) get(x);
  const list = [...rows.values()].sort((a, b) => a.clientKey.localeCompare(b.clientKey) || a.jobKey.localeCompare(b.jobKey) || a.activityKey.localeCompare(b.activityKey));
  const dayTotals = days.map((_, i) => list.reduce((t, r) => t + r.cells[i].minutes, 0));
  return { days, rows: list, dayTotals, total: dayTotals.reduce((t, x) => t + x, 0) };
}

/** A day in order: timed entries by start, then those with only a length (in the order they were made). */
export const dayEntries = (entries: Entry[], date: string): Entry[] =>
  entries.filter((e) => e.workDate === date).sort((a, b) => (a.started && b.started ? a.started.localeCompare(b.started) : a.started ? -1 : b.started ? 1 : a.key.localeCompare(b.key)));

/** Hours of working capacity not yet accounted for by recorded time. Never negative: more than capacity is simply overtime. Not a measure of unproductive time. */
export const unaccounted = (recordedMinutes: number, capacityHours: number): number => Math.max(0, Math.round(capacityHours * 60) - recordedMinutes);

export function totalsByType(entries: Entry[], activities: Activity[], from: string, to: string, now: Date): Record<Billable, number> & { all: number } {
  const t = { billable: 0, nonbillable: 0, internal: 0, all: 0 };
  for (const e of entries) {
    if (e.workDate < from || e.workDate > to) continue;
    const m = entryMinutes(e, now);
    t[billableOf(e, activities)] += m; t.all += m;
  }
  return t;
}

// ------------------------------------------------------------------ making and changing entries

export type NewEntry = { date: string; minutes?: number; start?: string; end?: string; clientKey?: string; jobKey?: string; taskKey?: string; sessionKey?: string; activityKey?: string; billable?: Billable | ""; stageNo?: number; stageName?: string; note?: string };
/** A typed entry: a length, or a start and end (UK clock times). Either is enough; no planned session is needed. */
export function manualEntry(i: NewEntry, user: string, newKey: (p: string) => string, now: Date): { row?: Row; error?: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.date)) return { error: "Choose the day." };
  let started = "", ended = now.toISOString(), minutes = Math.round(i.minutes || 0);
  if (i.start || i.end) {
    const a = parseClock(i.start || ""), b = parseClock(i.end || "");
    if (!a || !b) return { error: "Start and end times like 09:30 and 11:00." };
    started = londonIso(i.date, a); ended = londonIso(i.date, b);
    minutes = Math.round((Date.parse(ended) - Date.parse(started)) / 60000);
    if (minutes <= 0) return { error: "The end has to be after the start." };
  }
  if (!(minutes > 0)) return { error: "Say how long it took." };
  if (minutes > 24 * 60) return { error: "That is more than a day." };
  if (!started) ended = londonIso(i.date, "12:00");
  return { row: {
    Key: newKey("JT"), PracticeId: "", JobKey: i.jobKey || "", ClientKey: i.clientKey || "", StageNo: i.stageNo || 0, StageName: i.stageName || "", Started: started, Ended: ended, Hours: round2(minutes / 60), Kind: "manual", Note: (i.note || "").trim(),
    CreatedBy: user, Created: now.toISOString(), TaskKey: i.taskKey || "", SessionKey: i.sessionKey || "", ActivityKey: i.activityKey || "", WorkDate: i.date, BillableType: i.billable || "", Version: 1,
  } };
}

/** Typing hours into a day cell. One entry in the cell is changed; none makes one; several can't be set as a total (the entries are opened instead), so none is lost or merged. */
export function setCell(cell: Cell, minutes: number, template: NewEntry, user: string, newKey: (p: string) => string, now: Date): { create?: Row; patch?: { key: string; patch: Row }; error?: string; remove?: string } {
  const finished = cell.entries.filter((e) => e.ended);
  if (finished.length > 1) return { error: "That box holds several entries. Open it to change them one by one." };
  if (!(minutes >= 0)) return { error: "Hours like 1.5 or 1h30." };
  if (finished.length === 1) {
    const e = finished[0];
    if (minutes === 0) return { remove: e.key };
    if (minutes === Math.round(e.hours * 60)) return {};
    return { patch: { key: e.key, patch: { Hours: round2(minutes / 60), Version: e.version + 1, ...(e.started ? { Ended: new Date(Date.parse(e.started) + minutes * 60000).toISOString() } : {}) } } };
  }
  if (minutes === 0) return {};
  const m = manualEntry({ ...template, minutes }, user, newKey, now);
  return m.error ? { error: m.error } : { create: m.row };
}

/** Stops a timer at a time you give (the usual fix for one left running): the time can't be before the start. */
export function stopAt(e: Entry, endIso: string): { patch?: Row; error?: string } {
  const end = Date.parse(endIso);
  if (!e.started || Number.isNaN(end)) return { error: "That isn't a time." };
  if (end <= Date.parse(e.started)) return { error: "The end has to be after the start." };
  const hours = round2((end - Date.parse(e.started)) / 3600000);
  if (hours > 24) return { error: "That is more than a day." };
  return { patch: { Ended: endIso, Hours: Math.max(0.01, hours), WorkDate: londonDate(e.started), Version: e.version + 1 } };
}
/** A running timer that has been going over 12 hours: almost certainly forgotten. */
export const forgotten = (e: Entry, now: Date): boolean => !e.ended && e.kind === "timer" && !!e.started && now.getTime() - Date.parse(e.started) > 12 * 3600000;

// ------------------------------------------------------------------ one source of actual hours

/** Hours typed in when a job was finished, with no timer or timesheet entries behind them. They are brought in as one entry each, once, so the job's total is the same afterwards and comes from the time entries only. */
export function legacyEntries(items: { kind: "job" | "task"; key: string; clientKey: string; title: string; actual: number; doneOn: string }[], entries: Entry[], user: string, now: Date): { rows: Row[]; skipped: number } {
  const rows: Row[] = [];
  let skipped = 0;
  const have = new Set(entries.map((e) => e.key));
  for (const x of items) {
    const key = `JT-legacy-${x.key}`;
    const tracked = round2(entries.filter((e) => (x.kind === "job" ? e.jobKey === x.key : e.taskKey === x.key) && e.ended).reduce((t, e) => t + e.hours, 0));
    const gap = round2(x.actual - tracked);
    if (!(x.actual > 0) || have.has(key) || gap < 0.05) { skipped++; continue; }
    const date = (x.doneOn || now.toISOString()).slice(0, 10);
    rows.push({ Key: key, PracticeId: "", JobKey: x.kind === "job" ? x.key : "", ClientKey: x.clientKey, StageNo: 0, StageName: "", Started: "", Ended: londonIso(date, "12:00"), Hours: gap, Kind: "manual", Note: "Hours typed in when this was finished", CreatedBy: user, Created: now.toISOString(), TaskKey: x.kind === "task" ? x.key : "", SessionKey: "", ActivityKey: "", WorkDate: date, BillableType: "", Version: 1 });
  }
  return { rows, skipped };
}
/** A job's or task's actual hours, from time entries only (finished ones). */
export const actualHours = (entries: Entry[], kind: "job" | "task", key: string): number => round2(entries.filter((e) => (kind === "job" ? e.jobKey === key : e.taskKey === key) && e.ended).reduce((t, e) => t + e.hours, 0));

/** Starts a timer (for a job, a task, a client or just an activity). The caller stops one that is already running, as the job timer does. */
export function timerEntry(i: Omit<NewEntry, "date" | "minutes" | "start" | "end">, user: string, newKey: (p: string) => string, now: Date): Row {
  return { Key: newKey("JT"), PracticeId: "", JobKey: i.jobKey || "", ClientKey: i.clientKey || "", StageNo: i.stageNo || 0, StageName: i.stageName || "", Started: now.toISOString(), Ended: "", Hours: 0, Kind: "timer", Note: (i.note || "").trim(), CreatedBy: user, Created: now.toISOString(), TaskKey: i.taskKey || "", SessionKey: i.sessionKey || "", ActivityKey: i.activityKey || "", WorkDate: londonDate(now.toISOString()), BillableType: i.billable || "", Version: 1 };
}
