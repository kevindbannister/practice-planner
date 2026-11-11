// Quick capture rules: quick dates, where a new task should go from the screen you're on, links shared from a phone, voice text, and the offline queue.
// Pure and testable. The screens call these; nothing here touches the network or the browser.
import { Row } from "../schema";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const at = (today: string) => new Date(`${today}T00:00:00Z`);
const add = (today: string, n: number) => { const d = at(today); d.setUTCDate(d.getUTCDate() + n); return iso(d); };

export type QuickDate = "today" | "tomorrow" | "this_week" | "next_week";
export const QUICK_DATES: [QuickDate, string][] = [["today", "Today"], ["tomorrow", "Tomorrow"], ["this_week", "This week"], ["next_week", "Next week"]];

/** Today; tomorrow; "this week" is this Friday (or today when it is Friday or the weekend: a "this week" date is never in the past); "next week" is next Monday. */
export function quickDate(kind: QuickDate, today: string): string {
  const dow = at(today).getUTCDay(); // 0 Sun .. 6 Sat
  if (kind === "today") return today;
  if (kind === "tomorrow") return add(today, 1);
  if (kind === "this_week") return dow >= 1 && dow <= 4 ? add(today, 5 - dow) : today;
  return add(today, dow === 0 ? 1 : 8 - dow);
}

export type Where = { clientKey?: string; projectKey?: string; meetingKey?: string; label: string };
/** Where a new task belongs, from the screen you are on. Anywhere else it goes to the Inbox. Personal is never a default. */
export function contextFromHash(hash: string, names: { client?: (k: string) => string; project?: (k: string) => string } = {}): Where {
  const h = hash.replace(/^#\/?/, "").split("?")[0];
  const p = h.split("/").filter(Boolean);
  if (p[0] === "clients" && p[1] && p[1] !== "all") { const clientKey = decodeURIComponent(p[1]); return p[2] === "meetings" ? { clientKey, label: `${names.client?.(clientKey) || "this client"} (meeting)` } : { clientKey, label: names.client?.(clientKey) || "this client" }; }
  const q = /[?&]c=([^&]+)/.exec(hash); if (p[0] === "clients" && q) { const clientKey = decodeURIComponent(q[1]); return { clientKey, label: names.client?.(clientKey) || "this client" }; }
  return { label: "Inbox" };
}

/** What a phone's Share sheet sends: some of title, text and url. The first useful line becomes the title; everything is kept in the notes so nothing shared is lost. */
export function parseShare(search: string): { title: string; notes: string } | null {
  const q = new URLSearchParams(search.replace(/^\?/, ""));
  const title = (q.get("title") || "").trim(), text = (q.get("text") || "").trim(), url = (q.get("url") || "").trim();
  if (!title && !text && !url) return null;
  const first = (title || text.split(/\r?\n/).find((l) => l.trim()) || url).replace(/\s+/g, " ").trim().slice(0, 300);
  const notes = [title && text.startsWith(title) ? text : [title, text].filter(Boolean).join("\n"), url && !text.includes(url) ? url : ""].filter(Boolean).join("\n");
  return { title: first, notes: notes === first ? "" : notes };
}

/** Speech comes back lower case with no full stop. Tidy it for the box. The person still reads and confirms it before it is saved. */
export function cleanTranscript(t: string): string {
  const x = t.replace(/\s+/g, " ").trim().replace(/[.!]+$/, "");
  return x ? x[0].toUpperCase() + x.slice(1) : "";
}

// ---------------------------------------------------------------- the offline queue
// Only NEW tasks are queued. They have no clash to resolve: each carries its own capture key, so syncing twice (or from two tabs) can't make two.
export type Queued = { id: string; row: Row; queuedAt: string; attempts: number; error?: string };
export const MAX_ATTEMPTS = 5;

export const enqueue = (q: Queued[], row: Row, now: string): Queued[] => {
  const id = String(row.CaptureKey || "");
  if (!id) throw new Error("A queued task needs a capture key.");
  return q.some((x) => x.id === id) ? q : [...q, { id, row, queuedAt: now, attempts: 0 }];
};
/** What to do with the queue now, given the capture keys that already exist on stored tasks: `create` these, `drop` these (already saved by an earlier try). Failed-too-often items are held back for the person to see. */
export function syncPlan(q: Queued[], existing: Iterable<string>): { create: Queued[]; drop: Queued[]; stuck: Queued[] } {
  const have = new Set(existing);
  const drop = q.filter((x) => have.has(x.id)), rest = q.filter((x) => !have.has(x.id));
  return { drop, create: rest.filter((x) => x.attempts < MAX_ATTEMPTS), stuck: rest.filter((x) => x.attempts >= MAX_ATTEMPTS) };
}
export const afterSync = (q: Queued[], saved: string[], failed: { id: string; error: string }[]): Queued[] => {
  const done = new Set(saved), bad = new Map(failed.map((f) => [f.id, f.error]));
  return q.filter((x) => !done.has(x.id)).map((x) => (bad.has(x.id) ? { ...x, attempts: x.attempts + 1, error: bad.get(x.id) } : x));
};
export const discard = (q: Queued[], id: string): Queued[] => q.filter((x) => x.id !== id);
export const serializeQueue = (q: Queued[]): string => JSON.stringify(q);
/** Read the stored queue back. Anything that doesn't look right is dropped rather than trusted. */
export function parseQueue(raw: string | null | undefined): Queued[] {
  if (!raw) return [];
  try {
    const a = JSON.parse(raw); if (!Array.isArray(a)) return [];
    return a.filter((x) => x && typeof x.id === "string" && x.row && typeof x.row === "object" && x.row.CaptureKey === x.id && typeof x.row.Title === "string" && x.row.Title.trim())
      .map((x) => ({ id: x.id, row: x.row as Row, queuedAt: String(x.queuedAt || ""), attempts: Number.isFinite(x.attempts) ? x.attempts : 0, error: x.error ? String(x.error) : undefined }));
  } catch { return []; }
}
/** A failed save is a connection problem (queue it) rather than a refusal (show it) when the browser says offline or the error looks like a network failure. */
export const looksOffline = (online: boolean, e: unknown) => !online || (e instanceof TypeError && /fetch|network|load failed/i.test(e.message)) || (e instanceof Error && /network|failed to fetch|offline|timed out/i.test(e.message));
