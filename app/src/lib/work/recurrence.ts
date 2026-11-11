// Ordinary recurring tasks ("review bank feeds every Monday"). Entirely separate from recurring accounting-period jobs, which roll forward from period ends
// (lib/planning.ts rollForward). Only ONE open occurrence of a series exists at a time: finishing it makes the next, nothing is generated ahead of time, and
// the capture key means finishing, reopening and finishing again, or a retry after a failure, can never make two. Moving the date of an open occurrence changes
// that occurrence only. Cancelling it ends the series.
import { Row } from "../schema";

export type Rule = { freq: "daily" | "weekly" | "monthly" | "yearly"; every: number; weekdays: number[]; monthDay?: number; last?: boolean; nth?: { n: number; weekday: number }; month?: number; until?: string };
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const s = (v: unknown) => (v == null ? "" : String(v).trim());
const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (x: string) => new Date(`${x}T00:00:00Z`);
const addD = (x: string, n: number) => iso(new Date(utc(x).getTime() + n * 86400000));
const dow = (x: string) => utc(x).getUTCDay();
const monday = (x: string) => addD(x, -((dow(x) + 6) % 7));
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const monthIndex = (x: string) => Number(x.slice(0, 4)) * 12 + Number(x.slice(5, 7)) - 1;

/** Canonical text: daily, daily/3, weekly:mon,thu, weekly/2:mon, monthly:15, monthly:last, monthly:1mon, monthly:-1fri, yearly:11-30; optional ;until=YYYY-MM-DD. "weekdays" and "every monday" are accepted too. */
export function parseRule(text: string): Rule | { error: string } {
  let t = s(text).toLowerCase(); if (!t) return { error: "No repeat rule." };
  let until: string | undefined; const um = /;\s*until=(\d{4}-\d{2}-\d{2})\s*$/.exec(t); if (um) { until = um[1]; t = t.slice(0, um.index); }
  if (t === "weekdays") t = "weekly:mon,tue,wed,thu,fri";
  const em = /^every\s+(mon|tue|wed|thu|fri|sat|sun)[a-z]*$/.exec(t); if (em) t = `weekly:${em[1]}`;
  const m = /^(daily|weekly|monthly|yearly)(?:\/(\d{1,2}))?(?::(.+))?$/.exec(t); if (!m) return { error: `"${text}" isn't a repeat rule I understand.` };
  const every = m[2] ? Number(m[2]) : 1; if (!(every >= 1 && every <= 52)) return { error: "Repeat every 1 to 52." };
  const r: Rule = { freq: m[1] as Rule["freq"], every, weekdays: [], until };
  const spec = m[3] || "";
  if (r.freq === "daily") { if (spec) return { error: "A daily rule takes no detail." }; return r; }
  if (r.freq === "weekly") { r.weekdays = spec.split(",").map((x) => DAYS.indexOf(x.trim().slice(0, 3))).filter((x) => x >= 0); if (!r.weekdays.length) return { error: "Say which weekday, for example weekly:mon." }; r.weekdays = [...new Set(r.weekdays)].sort(); return r; }
  if (r.freq === "monthly") {
    if (spec === "last") { r.last = true; return r; }
    const n = /^(-?[1-4])(mon|tue|wed|thu|fri|sat|sun)$/.exec(spec); if (n) { r.nth = { n: Number(n[1]), weekday: DAYS.indexOf(n[2]) }; return r; }
    const d = /^(\d{1,2})$/.exec(spec); if (d && Number(d[1]) >= 1 && Number(d[1]) <= 31) { r.monthDay = Number(d[1]); return r; }
    return { error: "Monthly needs a day: monthly:15, monthly:last or monthly:1mon." };
  }
  const y = /^(\d{2})-(\d{2})$/.exec(spec); if (!y || Number(y[1]) < 1 || Number(y[1]) > 12 || Number(y[2]) < 1 || Number(y[2]) > 31) return { error: "Yearly needs a date: yearly:11-30." };
  r.month = Number(y[1]); r.monthDay = Number(y[2]); return r;
}
export function formatRule(r: Rule): string {
  const ev = r.every > 1 ? `/${r.every}` : "";
  const body = r.freq === "daily" ? "" : r.freq === "weekly" ? `:${r.weekdays.map((d) => DAYS[d]).join(",")}` : r.freq === "monthly" ? (r.last ? ":last" : r.nth ? `:${r.nth.n}${DAYS[r.nth.weekday]}` : `:${r.monthDay}`) : `:${String(r.month).padStart(2, "0")}-${String(r.monthDay).padStart(2, "0")}`;
  return `${r.freq}${ev}${body}${r.until ? `;until=${r.until}` : ""}`;
}
export function describeRule(r: Rule): string {
  const n = (k: number) => (k === -1 ? "last" : ["", "first", "second", "third", "fourth"][k]);
  const full = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const every = r.every > 1 ? `every ${r.every} ` : "every ";
  const t = r.freq === "daily" ? (r.every > 1 ? `Every ${r.every} days` : "Every day")
    : r.freq === "weekly" ? `${r.every > 1 ? `Every ${r.every} weeks on` : "Every"} ${r.weekdays.map((d) => full[d]).join(" and ")}`
    : r.freq === "monthly" ? `${r.every > 1 ? `Every ${r.every} months` : "Every month"} on ${r.last ? "the last day" : r.nth ? `the ${n(r.nth.n)} ${full[r.nth.weekday]}` : `day ${r.monthDay}`}`
    : `${every}year on ${r.monthDay}/${r.month}`.replace(/^every/, "Every");
  return r.until ? `${t}, until ${r.until}` : t;
}

/** The first occurrence strictly after `after`. `anchor` is the series' first date (needed for "every 2 weeks" and the like). Undefined once past `until`. */
export function nextAfter(r: Rule, after: string, anchor: string = after): string | undefined {
  let out: string | undefined;
  if (r.freq === "daily") { let d = addD(after, 1); if (r.every > 1) { const gap = Math.round((utc(d).getTime() - utc(anchor).getTime()) / 86400000); d = addD(d, ((r.every - (((gap % r.every) + r.every) % r.every)) % r.every)); } out = d; }
  else if (r.freq === "weekly") { for (let i = 1; i <= 7 * r.every + 7; i++) { const d = addD(after, i); if (!r.weekdays.includes(dow(d))) continue; const weeks = Math.round((utc(monday(d)).getTime() - utc(monday(anchor)).getTime()) / (7 * 86400000)); if (((weeks % r.every) + r.every) % r.every === 0) { out = d; break; } } }
  else if (r.freq === "monthly") {
    for (let i = 0; i < 12 * 8 && !out; i++) {
      const base = monthIndex(after) + i, y = Math.floor(base / 12), m = base % 12;
      if ((((base - monthIndex(anchor)) % r.every) + r.every) % r.every !== 0) continue;
      const last = daysIn(y, m); let day: number;
      if (r.last) day = last; else if (r.monthDay) day = Math.min(r.monthDay, last);
      else { const wd = r.nth!.weekday, first = new Date(Date.UTC(y, m, 1)).getUTCDay(), firstHit = 1 + ((wd - first + 7) % 7); const hits: number[] = []; for (let d = firstHit; d <= last; d += 7) hits.push(d); day = r.nth!.n > 0 ? hits[r.nth!.n - 1] : hits[hits.length + r.nth!.n]; if (!day) continue; }
      const d = `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`; if (d > after) out = d;
    }
  } else { for (let y = Number(after.slice(0, 4)); y < Number(after.slice(0, 4)) + 30; y++) { if ((((y - Number(anchor.slice(0, 4))) % r.every) + r.every) % r.every !== 0) continue; const day = Math.min(r.monthDay!, daysIn(y, r.month! - 1)); const d = `${y}-${String(r.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`; if (d > after) { out = d; break; } } }
  return out && (!r.until || out <= r.until) ? out : undefined;
}
/** A preview of the next few dates for the screen. Never stored. */
export function preview(r: Rule, from: string, count = 4, anchor = from): string[] { const out: string[] = []; let d = from; while (out.length < count) { const n = nextAfter(r, d, anchor); if (!n) break; out.push(n); d = n; } return out; }

// ---------------------------------------------------------------- finishing an occurrence
const COPY = ["Title", "Description", "Area", "ClientKey", "ProjectKey", "JobKey", "OwnerType", "AssignedUser", "AssignedContact", "ExternalParty", "InternalOwner", "Priority", "EstimateMinutes", "Tags", "PrivacyLevel", "RecurrenceRule", "Type", "EstimateHours"];
export type Spawn = { row?: Row; reason: string };
/** The next occurrence after the given one is finished. Called once when it is completed. Nothing is made for a series that has ended, was cancelled, or already has its next occurrence. */
export function spawnNext(done: Row, all: Row[], c: { now: string; today: string; key: () => string }): Spawn {
  const text = s(done.RecurrenceRule); if (!text) return { reason: "Not a recurring task." };
  if (s(done.Status) !== "Done" && s(done.Status) !== "Complete") return { reason: "Only a finished occurrence makes the next one." };
  const rule = parseRule(text); if ("error" in rule) return { reason: rule.error };
  const series = s(done.SeriesKey) || s(done.Key);
  const origin = all.find((r) => s(r.Key) === series), anchor = s(origin?.DueDate).slice(0, 10) || s(done.DueDate).slice(0, 10) || c.today;
  const due = s(done.DueDate).slice(0, 10), base = due && due > c.today ? due : c.today;
  const next = nextAfter(rule, base, anchor); if (!next) return { reason: "The series has ended." };
  const capture = `rec:${series}:${next}`;
  if (all.some((r) => s(r.CaptureKey) === capture)) return { reason: "The next occurrence already exists." };
  if (all.some((r) => s(r.SeriesKey) === series && s(r.Key) !== s(done.Key) && !["Done", "Complete", "Cancelled"].includes(s(r.Status)))) return { reason: "The next occurrence already exists." };
  const row: Row = {}; for (const k of COPY) if (done[k] !== undefined && done[k] !== "") row[k] = done[k];
  const outside = s(done.OwnerType) && s(done.OwnerType) !== "user";
  return { row: { ...row, Key: c.key(), DueDate: next, Status: outside ? "Not requested" : "Open", SeriesKey: series, CaptureKey: capture, Version: 1, Created: c.now, Updated: c.now, CreatedBy: s(done.CreatedBy) }, reason: `Next: ${next}.` };
}
export const isRecurring = (r: Row) => !!s(r.RecurrenceRule);
