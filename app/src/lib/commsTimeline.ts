// The client's Communication timeline: only the things said to or by the client (emails, texts, calls,
// meetings, letters), newest first, grouped by month. It is a view over the same events the Activity
// tab builds (lib/timeline.ts); nothing extra is stored except texts, which are logged by hand.
import { Activity, ActivityType } from "./timeline";

export type Channel = "email" | "text" | "call" | "meeting" | "letter";
export const CHANNELS: { key: Channel; label: string }[] = [
  { key: "email", label: "Emails" }, { key: "text", label: "Texts" }, { key: "call", label: "Calls" }, { key: "meeting", label: "Meetings" }, { key: "letter", label: "Letters" },
];
const CHANNEL_OF: Partial<Record<ActivityType, Channel>> = {
  "email-in": "email", "email-out": "email", "email-draft": "email", "text-in": "text", "text-out": "text", call: "call", meeting: "meeting", conversation: "meeting", letter: "letter", "doc-sent": "letter",
};
export const channelOf = (a: Pick<Activity, "type">): Channel | undefined => CHANNEL_OF[a.type];
/** "in", "out" or nothing, for the arrow beside an entry. */
export const directionOf = (t: ActivityType): "in" | "out" | "" => (t === "email-in" || t === "text-in" ? "in" : t === "email-out" || t === "text-out" || t === "letter" || t === "doc-sent" ? "out" : "");

export type CommFilter = { channels?: Channel[]; from?: string; to?: string; q?: string; extra?: (a: Activity) => string };

export function commEntries(all: Activity[], f: CommFilter = {}): Activity[] {
  const q = (f.q || "").trim().toLowerCase();
  const on = f.channels && f.channels.length ? new Set(f.channels) : undefined;
  return all.filter((a) => {
    const ch = channelOf(a);
    if (!ch || (on && !on.has(ch))) return false;
    if (f.from && a.at.slice(0, 10) < f.from) return false;
    if (f.to && a.at.slice(0, 10) > f.to) return false;
    if (q && !`${a.title} ${a.summary} ${a.actor} ${f.extra ? f.extra(a) : ""}`.toLowerCase().includes(q)) return false;
    return true;
  }).sort((x, y) => y.at.localeCompare(x.at) || x.id.localeCompare(y.id));
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function monthLabel(ym: string): string { const [y, m] = ym.split("-").map(Number); return `${MONTHS[m - 1]} ${y}`; }
export function groupByMonth(list: Activity[]): { month: string; label: string; items: Activity[] }[] {
  const out: { month: string; label: string; items: Activity[] }[] = [];
  for (const a of list) {
    const month = a.at.slice(0, 7);
    const last = out[out.length - 1];
    if (last && last.month === month) last.items.push(a);
    else out.push({ month, label: monthLabel(month), items: [a] });
  }
  return out;
}

/** How many of each channel, for the filter chips. */
export function channelCounts(all: Activity[]): Record<Channel, number> {
  const c: Record<Channel, number> = { email: 0, text: 0, call: 0, meeting: 0, letter: 0 };
  for (const a of all) { const ch = channelOf(a); if (ch) c[ch]++; }
  return c;
}
