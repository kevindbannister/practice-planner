// "Suggest a plan": fills the days left in a week from unplanned work, by fixed rules you can
// see. Nothing is saved until you accept.
//
// The rules, in order:
//   1. Only work that's open, not on hold, not planned, and due within the look-ahead
//      (or marked urgent, or whose slot from last year falls this week) is considered.
//   2. Work still waiting for records from the client is left out, and listed as such.
//   3. Late work first, then urgent, then the nearest deadline.
//   4. Each piece goes on the day it was done last year if that's this week, otherwise the
//      earliest day with room, and never after its deadline (unless it's already late).
//   5. A day is filled only up to your chosen level (85% by default), so there's slack.
//      Work bigger than that goes on an empty day on its own.

export type Candidate = {
  key: string;
  kind: "job" | "task";
  hours: number;
  deadline?: string;
  urgent: boolean;
  held: boolean;
  planned?: string; // a planned date; one in the past counts as unplanned
  suggestedSlot?: string; // the same time last year
  waitingForRecords: boolean;
};

export type PlanOptions = {
  today: string;
  days: string[]; // the working days to fill (today onwards)
  capacity: Record<string, number>; // hours available each day
  load: Record<string, number>; // hours already planned each day
  fillPct: number; // 0.85 = fill to 85% of each day
  lookAheadDays: number; // consider work due within this many days
};

export type Suggestion = { key: string; day: string; reason: string };
export type Skipped = { key: string; reason: string };

export const DEFAULT_FILL = 85;
export const LOOK_AHEAD_DAYS = 60;

const addDaysIso = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export function suggestPlan(cands: Candidate[], o: PlanOptions): { suggestions: Suggestion[]; skipped: Skipped[] } {
  const days = o.days.filter((d) => d >= o.today);
  const suggestions: Suggestion[] = [];
  const skipped: Skipped[] = [];
  if (!days.length) return { suggestions, skipped };
  const until = addDaysIso(o.today, o.lookAheadDays);
  const room: Record<string, number> = {};
  const empty: Record<string, boolean> = {};
  for (const d of days) {
    room[d] = Math.max(0, (o.capacity[d] || 0) * o.fillPct - (o.load[d] || 0));
    empty[d] = !(o.load[d] > 0);
  }

  const eligible = cands.filter((c) => {
    if (c.held || (c.planned && c.planned >= o.today)) return false;
    const slotThisWeek = !!c.suggestedSlot && days.includes(c.suggestedSlot);
    if (!c.deadline && !slotThisWeek) return false; // nothing to say when it's needed
    if (c.deadline && c.deadline > until && !slotThisWeek && !c.urgent) return false;
    if (c.waitingForRecords) {
      skipped.push({ key: c.key, reason: "Waiting for records" });
      return false;
    }
    return true;
  });

  const late = (c: Candidate) => !!c.deadline && c.deadline < o.today;
  eligible.sort(
    (a, b) =>
      Number(late(b)) - Number(late(a)) ||
      Number(b.urgent) - Number(a.urgent) ||
      (a.deadline || "9999").localeCompare(b.deadline || "9999") ||
      b.hours - a.hours,
  );

  for (const c of eligible) {
    const allowed = days.filter((d) => late(c) || !c.deadline || d <= c.deadline);
    if (!allowed.length) {
      skipped.push({ key: c.key, reason: "Due before any day left this week" });
      continue;
    }
    const fits = (d: string) => room[d] >= c.hours - 1e-9;
    const big = c.hours > Math.max(...allowed.map((d) => (o.capacity[d] || 0) * o.fillPct));
    let day: string | undefined;
    let reason = "";
    if (c.suggestedSlot && allowed.includes(c.suggestedSlot) && (fits(c.suggestedSlot) || (big && empty[c.suggestedSlot]))) {
      day = c.suggestedSlot;
      reason = "Same time as last year";
    } else if (big) {
      day = allowed.find((d) => empty[d]);
      reason = "A full day's work";
    } else {
      day = allowed.find(fits);
    }
    if (!day) {
      skipped.push({ key: c.key, reason: "No room left this week" });
      continue;
    }
    room[day] = Math.max(0, room[day] - c.hours);
    empty[day] = false;
    // the card already shows the deadline; say why it was picked
    const why = [late(c) ? "Late" : "", c.urgent ? "Urgent" : "", reason].filter(Boolean);
    if (!why.length) why.push("Next deadline");
    suggestions.push({ key: c.key, day, reason: why.join(" · ") });
  }
  return { suggestions, skipped };
}
