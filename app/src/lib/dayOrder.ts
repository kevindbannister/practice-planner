// The order of work within a day on the plan. Each job or task can carry a DayOrder; work
// without one sits after ordered work, urgent first, then by deadline.
import { Row } from "./schema";

export type Ordered = { key: string; row: Row; urgent?: boolean; deadline?: string };

export const dayRank = (row: Row) => {
  const n = Number(row.DayOrder);
  return row.DayOrder === undefined || row.DayOrder === null || row.DayOrder === "" || !Number.isFinite(n) ? Infinity : n;
};

export function compareInDay(a: Ordered, b: Ordered): number {
  const ra = dayRank(a.row), rb = dayRank(b.row);
  if (ra !== rb) return ra < rb ? -1 : 1;
  return Number(!!b.urgent) - Number(!!a.urgent) || (a.deadline || "9999").localeCompare(b.deadline || "9999") || a.key.localeCompare(b.key);
}

/**
 * The day's work after moving `key` to position `at` (0 = top; undefined = the end). Returns the
 * new order and the DayOrder changes needed (only rows whose number changes).
 */
export function placeInDay<T extends Ordered>(day: T[], moved: T, at?: number): { order: T[]; changes: { item: T; DayOrder: number }[] } {
  const rest = [...day].sort(compareInDay).filter((x) => x.key !== moved.key);
  const i = at === undefined ? rest.length : Math.max(0, Math.min(at, rest.length));
  const order = [...rest.slice(0, i), moved, ...rest.slice(i)];
  const changes = order
    .map((item, n) => ({ item, DayOrder: n + 1 }))
    .filter(({ item, DayOrder }) => item.key === moved.key || dayRank(item.row) !== DayOrder);
  return { order, changes };
}
