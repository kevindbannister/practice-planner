// Today: what to do today, and why. Plain rules you can read, no guessing:
//   late        past its deadline (or its day) and not finished
//   planned     put on today
//   suggested   not planned anywhere, picked to fill the day's remaining client hours:
//               nearest deadline first, with a lift for work marked urgent and for key clients
//   chase       waiting on someone and the chase date has come
// A day with no client hours (a business day) shows business project work against its business
// hours instead. If the work due soon can't fit in the client hours before it's due, it says so
// and suggests turning business days into client days; nothing changes until you agree.
import { daysBetween, fmtDate } from "./domain";
import { addDays, weekday } from "./planning";

export type Work = {
  key: string;
  kind: "job" | "task";
  title: string;
  client: string;
  hours: number;
  deadline?: string;
  planned?: string;
  urgent: boolean;
  importance: "key" | "normal" | "low";
  business: boolean;
  held: boolean;
  /** The day to chase, for work waiting on someone. */
  chaseOn?: string;
  heldLabel?: string;
  /** With the client for records or approval: can't be worked on yet. */
  blocked: boolean;
  projectTitle?: string;
};

export type Line = Work & { reasons: string[]; level: "red" | "amber" | "" };

export type Conflict = {
  deadline: string;
  /** What is due by then. */
  due: string[];
  shortfall: number;
  /** Days that could become client days, soonest first, and the business work planned on them. */
  days: { date: string; typeName: string; hours: number; businessWork: string[] }[];
  text: string;
};

export type DayInfo = {
  /** Client hours today, after meetings. */
  client: number;
  business: number;
  typeName: string;
};

export type TodayInput = {
  today: string;
  work: Work[];
  day: DayInfo;
  /** Client hours on a day after meetings, as if the day were of the given type ("client" = if it were a client day). */
  capacity: (date: string, asType?: string) => number;
  /** The kind of day each date is (name), and whether it has business hours. */
  dayType: (date: string) => { key: string; name: string; business: number };
};

export type Today = {
  lines: Line[]; // today's client work in the order to do it
  clientUsed: number;
  business: Line[];
  businessUsed: number;
  suggested: Line[];
  chase: Line[];
  conflicts: Conflict[];
  headline: string;
};

const FILL = 0.9; // suggestions fill the day to this level, to leave a little slack

const imp = { key: 15, normal: 0, low: -5 } as const;

const dueText = (d: number) => (d < 0 ? `${-d} day${d === -1 ? "" : "s"} late` : d === 0 ? "due today" : d === 1 ? "due tomorrow" : `due in ${d} days`);

function reasonsFor(w: Work, today: string): { reasons: string[]; level: "red" | "amber" | "" } {
  const reasons: string[] = [];
  let level: "red" | "amber" | "" = "";
  if (w.deadline) {
    const d = daysBetween(today, w.deadline);
    reasons.push(`${dueText(d)[0].toUpperCase()}${dueText(d).slice(1)} (${fmtDate(w.deadline, { weekday: true, year: false })})`);
    if (d < 0) level = "red";
    else if (d <= 7) level = "amber";
  }
  if (w.planned && w.planned < today) {
    reasons.push(`Planned for ${fmtDate(w.planned, { weekday: true, year: false })}, not finished`);
    if (!level) level = "amber";
  }
  if (w.urgent) reasons.push("Marked urgent");
  if (w.importance === "key") reasons.push("Key client");
  return { reasons, level };
}

/** Higher = sooner. Nearest deadline dominates; urgent and key clients lift a piece of work. */
export function score(w: Work, today: string): number {
  let s = 0;
  if (w.deadline) {
    const d = daysBetween(today, w.deadline);
    s += d < 0 ? 200 - d : Math.max(0, 90 - d * 3);
  }
  if (w.urgent) s += 40;
  s += imp[w.importance];
  return s;
}

const byScore = (today: string) => (a: Work, b: Work) =>
  score(b, today) - score(a, today) || (a.deadline || "9999").localeCompare(b.deadline || "9999") || a.title.localeCompare(b.title);

export function buildToday(input: TodayInput): Today {
  const { today, day } = input;
  const open = input.work.filter((w) => !w.held);
  const line = (w: Work, extra: string[] = []): Line => {
    const r = reasonsFor(w, today);
    return { ...w, reasons: [...r.reasons, ...extra], level: r.level };
  };

  // client work: late, missed or planned for today, in that order, then what's suggested
  const client = open.filter((w) => !w.business && !w.blocked);
  const isLate = (w: Work) => !!w.deadline && w.deadline < today;
  const mine = client.filter((w) => isLate(w) || (w.planned && w.planned <= today)).sort(byScore(today));
  const lines = mine.map((w) => line(w));
  const clientUsed = lines.reduce((t, l) => t + l.hours, 0);

  let room = day.client * FILL - clientUsed;
  const suggested: Line[] = [];
  if (day.client > 0) {
    const pool = client
      .filter((w) => !mine.includes(w) && !w.planned && w.deadline && daysBetween(today, w.deadline) <= 45)
      .sort(byScore(today));
    for (const w of pool) {
      // a piece too big for what's left is skipped, unless it's the only thing and fits an empty day
      if (w.hours > room && (suggested.length || lines.length || w.hours > day.client)) continue;
      suggested.push(line(w, ["Not planned yet; fits today"]));
      room -= w.hours;
      if (room <= 0.25) break;
    }
  }

  // business work: planned for today, then the next step of each project until the hours are used
  const biz = open.filter((w) => w.business && !w.blocked);
  const bizToday = biz.filter((w) => w.planned && w.planned <= today).sort(byScore(today));
  const business = bizToday.map((w) => line(w));
  let bizRoom = day.business - business.reduce((t, l) => t + l.hours, 0);
  if (day.business > 0) {
    for (const w of biz.filter((x) => !bizToday.includes(x) && !x.planned).sort(byScore(today))) {
      if (bizRoom <= 0.25) break;
      if (w.hours > bizRoom && business.length) continue;
      business.push(line(w, [w.projectTitle ? `Next step on ${w.projectTitle}` : "Business work for today"]));
      bizRoom -= w.hours;
    }
  }

  const chase = input.work
    .filter((w) => w.held && w.chaseOn && w.chaseOn <= today)
    .sort((a, b) => String(a.chaseOn).localeCompare(String(b.chaseOn)))
    .map((w) => ({ ...w, reasons: [`${w.heldLabel || "On hold"}: time to chase (from ${fmtDate(w.chaseOn, { weekday: true, year: false })})`], level: "amber" as const }));

  const conflicts = findConflicts(input, open);

  const used = clientUsed + suggested.reduce((t, l) => t + l.hours, 0);
  const late = lines.filter((l) => isLate(l)).length;
  let headline: string;
  if (day.client === 0 && day.business === 0) headline = `${day.typeName}: nothing planned.`;
  else if (day.client === 0) headline = `${day.typeName}: ${business.length ? `${business.length} thing${business.length === 1 ? "" : "s"} for the business` : "no business work lined up"}.`;
  else {
    const n = lines.length + suggested.length;
    headline = `${n} thing${n === 1 ? "" : "s"} for today, about ${Math.round(used * 10) / 10}h of ${day.client}h${late ? `, ${late} already late` : ""}.`;
  }
  return { lines, clientUsed, business, businessUsed: business.reduce((t, l) => t + l.hours, 0), suggested, chase, conflicts, headline };
}

/** How far ahead to look for work that won't fit before it's due. */
export const CONFLICT_DAYS = 21;

/**
 * Walk the deadlines in date order. If the work due by one needs more client hours than the days
 * up to it offer, find business or mixed days in that stretch that could become client days.
 */
export function findConflicts(input: TodayInput, open: Work[]): Conflict[] {
  const { today } = input;
  const horizon = addDays(today, CONFLICT_DAYS);
  const due = open
    .filter((w) => !w.business && !w.blocked && w.deadline && w.deadline <= horizon)
    .sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)));
  const out: Conflict[] = [];
  const turned = new Set<string>();
  const capacityTo = (to: string) => {
    let total = 0;
    for (let d = today; d <= to; d = addDays(d, 1)) total += turned.has(d) ? input.capacity(d, "client") : input.capacity(d);
    return total;
  };
  let demand = 0;
  const deadlines = [...new Set(due.map((w) => w.deadline as string))];
  for (const dl of deadlines) {
    demand += due.filter((w) => w.deadline === dl).reduce((t, w) => t + w.hours, 0);
    const to = dl < today ? today : dl;
    const base = capacityTo(to);
    let short = demand - base;
    if (short <= 0.01) continue;
    const days: Conflict["days"] = [];
    for (let d = today; d <= to && short > 0.01; d = addDays(d, 1)) {
      const wd = weekday(d);
      const t = input.dayType(d);
      if (wd > 5 || turned.has(d) || t.key === "client" || t.business <= 0) continue;
      const gain = input.capacity(d, "client") - input.capacity(d);
      if (gain <= 0) continue;
      turned.add(d);
      short -= gain;
      days.push({
        date: d, typeName: t.name, hours: gain,
        businessWork: open.filter((w) => w.business && w.planned === d).map((w) => w.title),
      });
    }
    const names = due.filter((w) => (w.deadline as string) <= dl).map((w) => `${w.client ? `${w.client}: ` : ""}${w.title}`);
    const shortfall = Math.round((demand - base) * 10) / 10;
    out.push({
      deadline: dl, due: names.slice(0, 6), shortfall, days,
      text: days.length
        ? `${names.length} piece${names.length === 1 ? "" : "s"} of work due by ${fmtDate(dl, { weekday: true, year: false })} needs ${Math.round(demand * 10) / 10}h of client time, and your client days before then only have ${Math.round(base * 10) / 10}h. Turning ${days.map((x) => fmtDate(x.date, { weekday: true, year: false })).join(" and ")} into client ${days.length === 1 ? "day" : "days"} would cover it.`
        : `${names.length} piece${names.length === 1 ? "" : "s"} of work due by ${fmtDate(dl, { weekday: true, year: false })} needs ${Math.round(demand * 10) / 10}h of client time, and there are only ${Math.round(base * 10) / 10}h before then. There's no business day left to turn into a client day: something will need to move or be handed on.`,
    });
  }
  return out;
}

/** The next day with client hours, for rolling unfinished work forward. */
export function nextClientDay(today: string, capacity: (date: string) => number): string | undefined {
  for (let i = 1; i <= 14; i++) {
    const d = addDays(today, i);
    if (weekday(d) <= 5 && capacity(d) > 0) return d;
  }
  return undefined;
}
