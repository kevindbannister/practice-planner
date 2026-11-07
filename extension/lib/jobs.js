// What the extension does with jobs and time. These follow the web app's own rules (the same fields, the same hold and resume
// behaviour, one running timer at a time) so that what is saved here looks exactly like what the app saves.

export const ON_HOLD = "On hold";
export const WAIT_KINDS = ["Client", "HMRC", "Companies House", "Someone else"];

export const isOpen = (j) => j.Status !== "Complete" && j.Status !== "Done" && j.Status !== "Cancelled";
export const isOnHold = (j) => j.Status === ON_HOLD;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function fmtDate(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return d && m ? `${d} ${MONTHS[m - 1]} ${y}` : "";
}
export function todayIso(now = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
export const newKey = (prefix) => prefix + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();

/** Whole days from today to a date (negative when it has passed). */
export function daysUntil(iso, today) {
  if (!iso) return undefined;
  const a = Date.parse(String(iso).slice(0, 10) + "T00:00:00Z"), b = Date.parse(today + "T00:00:00Z");
  return Number.isFinite(a) ? Math.round((a - b) / 86400000) : undefined;
}
/** late, soon (within 14 days) or "" for a job's deadline. */
export function deadlineState(job, today) {
  const d = daysUntil(job.Deadline || job.InternalDeadline, today);
  return d === undefined ? "" : d < 0 ? "late" : d <= 14 ? "soon" : "";
}

/** Open jobs for a client, soonest deadline first. */
export function jobsFor(jobs, clientKey) {
  return jobs
    .filter((j) => j.ClientKey === clientKey && isOpen(j))
    .sort((a, b) => String(a.Deadline || a.InternalDeadline || "9999").localeCompare(String(b.Deadline || b.InternalDeadline || "9999")));
}

export function holdPatch(reason, until, today, kind = "") {
  return { Status: ON_HOLD, HoldReason: String(reason || "").trim(), HoldUntil: until || "", HeldOn: today, HoldKind: kind, PlannedDate: "" };
}
export function resumePatch(job, today) {
  const kind = isOnHold(job) && job.HoldKind ? `Waiting on ${job.HoldKind}` : "On hold";
  const from = job.HeldOn ? fmtDate(job.HeldOn) : "";
  const line = `${kind}${from ? ` ${from} to ${fmtDate(today)}` : ` until ${fmtDate(today)}`}${job.HoldReason ? `: ${job.HoldReason}` : ""}`;
  const notes = job.Notes ? `${String(job.Notes).trimEnd()}\n${line}` : line;
  return { Status: "Open", HoldReason: "", HoldUntil: "", HeldOn: "", HoldKind: "", Notes: notes };
}
/** A dated line added to the end of a job's or client's notes. */
export function noteAppend(existing, text, user, now = new Date()) {
  const line = `${fmtDate(todayIso(now))}${user ? ` (${user})` : ""}: ${String(text).trim()}`;
  return existing ? `${String(existing).trimEnd()}\n${line}` : line;
}

// ---- time ----
export const round2 = (h) => Math.round(h * 100) / 100;
export function readTime(r) {
  return {
    id: r._id, key: r.Key || "", jobKey: r.JobKey || "", clientKey: r.ClientKey || "", stageNo: Number(r.StageNo) || 0, stageName: r.StageName || "",
    started: r.Started || "", ended: r.Ended || "", hours: Number(r.Hours) || 0, kind: r.Kind === "manual" ? "manual" : "timer", note: r.Note || "", by: r.CreatedBy || "",
  };
}
/** The timer running now, if any. There is only ever one. */
export const runningTimer = (entries) => entries.filter((e) => e.kind === "timer" && e.started && !e.ended).sort((a, b) => b.started.localeCompare(a.started))[0];
export const elapsedHours = (e, now) => Math.max(0, (now.getTime() - Date.parse(e.started)) / 3600000);
export function clock(hours) {
  const t = Math.max(0, Math.round(hours * 3600)), p = (x) => String(x).padStart(2, "0");
  return `${Math.floor(t / 3600)}:${p(Math.floor((t % 3600) / 60))}:${p(t % 60)}`;
}
export function lengthText(hours) {
  const m = Math.round(hours * 60);
  return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`;
}
export function startRow(job, user, now, key = newKey) {
  return { Key: key("JT"), PracticeId: "", JobKey: job.Key, ClientKey: job.ClientKey, StageNo: Number(job.StageNo) || 0, StageName: job.StageName || "", Started: now.toISOString(), Ended: "", Hours: 0, Kind: "timer", Note: "", CreatedBy: user || "", Created: now.toISOString() };
}
/** Stopping closes the entry. A timer left running for more than a working day is capped at 12 hours, as it was almost certainly forgotten. */
export function stopPatch(e, now) {
  const h = Math.min(12, elapsedHours(e, now));
  return { Ended: now.toISOString(), Hours: Math.max(0.01, round2(h)) };
}
export function manualRow(job, hours, note, user, now, key = newKey) {
  return { Key: key("JT"), PracticeId: "", JobKey: job.Key, ClientKey: job.ClientKey, StageNo: Number(job.StageNo) || 0, StageName: job.StageName || "", Started: "", Ended: now.toISOString(), Hours: round2(hours), Kind: "manual", Note: String(note || "").trim(), CreatedBy: user || "", Created: now.toISOString() };
}
/** 1.5, 1h30, 1:30, 90m. Returns undefined for anything else, or more than a day. */
export function parseDuration(text) {
  const t = String(text || "").trim().toLowerCase().replace(/,/g, ".");
  if (!t) return undefined;
  const valid = (h) => (h > 0 && h <= 24 ? round2(h) : undefined);
  let m = /^(\d*\.?\d+)$/.exec(t);
  if (m) return valid(Number(m[1]));
  m = /^(\d+):(\d{1,2})$/.exec(t);
  if (m) return Number(m[2]) < 60 ? valid(Number(m[1]) + Number(m[2]) / 60) : undefined;
  m = /^(\d*\.?\d+)\s*h(?:rs?|ours?)?\s*(?:and\s*)?(?:(\d+)\s*(?:m(?:ins?|inutes?)?)?)?$/.exec(t);
  if (m) return Number(m[2] ?? 0) < 60 ? valid(Number(m[1]) + Number(m[2] ?? 0) / 60) : undefined;
  m = /^(\d+)\s*m(?:ins?|inutes?)?$/.exec(t);
  if (m) return valid(Number(m[1]) / 60);
  return undefined;
}
/** Hours recorded on each job (finished entries, plus the running timer up to now). */
export function hoursByJob(entries, now) {
  const out = new Map();
  for (const e of entries) {
    const h = e.ended ? e.hours : e.kind === "timer" && e.started ? elapsedHours(e, now) : 0;
    out.set(e.jobKey, (out.get(e.jobKey) || 0) + h);
  }
  return out;
}
