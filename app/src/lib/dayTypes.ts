// Day types: what kind of day each day is. A client day is for client work, a business day for
// working on the practice itself (marketing, systems, recruiting), a mixed day splits the hours,
// and a day off has none. Each type has a share of the day for each kind of work and a buffer
// (time kept back for interruptions and admin), all editable in Settings. Any single day can
// be changed from the planner. Only the client hours feed the capacity bars and the plan.

export type DayType = {
  key: string;
  name: string;
  colour: string;
  /** Percent of the day's hours given to client work. */
  client: number;
  /** Percent of the day's hours given to working on the business. */
  business: number;
  /** Percent of the day held back for interruptions and admin. */
  buffer: number;
};

export const DEFAULT_DAY_TYPES: DayType[] = [
  { key: "client", name: "Client day", colour: "#0a84ff", client: 100, business: 0, buffer: 0 },
  { key: "business", name: "Business day", colour: "#af52de", client: 0, business: 100, buffer: 0 },
  { key: "mixed", name: "Mixed day", colour: "#ff9f0a", client: 50, business: 50, buffer: 0 },
  { key: "off", name: "Day off", colour: "#8e8e93", client: 0, business: 0, buffer: 0 },
];

/** Monday to Friday are client days until changed. */
export const DEFAULT_WEEK: Record<string, string> = { "1": "client", "2": "client", "3": "client", "4": "client", "5": "client" };

export type DaySettings = {
  hours: Record<"1" | "2" | "3" | "4" | "5", number>;
  dayTypes: DayType[];
  week: Record<string, string>;
  /** ISO date -> day type key, for days that differ from the usual week. */
  overrides: Record<string, string>;
};

const pct = (v: unknown, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : fallback;
};

/** The built-in types with anything saved in Settings laid over them (matched by key). */
export function mergeDayTypes(saved: unknown): DayType[] {
  const list = Array.isArray(saved) ? (saved as Partial<DayType>[]) : [];
  return DEFAULT_DAY_TYPES.map((d) => {
    const s = list.find((x) => x && x.key === d.key);
    if (!s) return { ...d };
    return {
      key: d.key,
      name: typeof s.name === "string" && s.name.trim() ? s.name.trim() : d.name,
      colour: typeof s.colour === "string" && /^#[0-9a-f]{6}$/i.test(s.colour) ? s.colour : d.colour,
      client: pct(s.client, d.client),
      business: pct(s.business, d.business),
      buffer: pct(s.buffer, d.buffer),
    };
  });
}

const weekdayOf = (iso: string) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))).getUTCDay();

/** The type a day is: its own override, else the usual one for that weekday (weekends are days off). */
export function typeOn(date: string, s: Pick<DaySettings, "dayTypes" | "week" | "overrides">): DayType {
  const wd = weekdayOf(date);
  const key = s.overrides[date] ?? s.week[String(wd)] ?? (wd >= 1 && wd <= 5 ? "client" : "off");
  return s.dayTypes.find((t) => t.key === key) || s.dayTypes.find((t) => t.key === "client") || DEFAULT_DAY_TYPES[0];
}

/** The usual type for a weekday (1 = Monday), ignoring any override. */
export function usualTypeKey(wd: number, s: Pick<DaySettings, "week">): string {
  return s.week[String(wd)] ?? (wd >= 1 && wd <= 5 ? "client" : "off");
}

export type DayHours = { type: DayType; total: number; client: number; business: number };

/** Hours of the day for each kind of work, after the type's shares and buffer. */
export function dayHours(date: string, s: DaySettings): DayHours {
  const wd = weekdayOf(date);
  const total = wd >= 1 && wd <= 5 ? s.hours[String(wd) as keyof DaySettings["hours"]] || 0 : 0;
  const type = typeOn(date, s);
  const keep = 1 - type.buffer / 100;
  const round = (h: number) => Math.round(h * 100) / 100;
  return { type, total, client: round((total * type.client * keep) / 100), business: round((total * type.business * keep) / 100) };
}

/** Hours available for client work on a day. */
export const clientHoursOn = (date: string, s: DaySettings): number => dayHours(date, s).client;
