// The client Overview as a grid the user can rearrange. Pure layout maths, so it can be tested without a screen.
//
// A 24-column grid. Each card has a column (x), width (w, in columns), row (y) and optionally a fixed height
// (h, in rows of ROW px). A card with no h is as tall as its content. Cards never overlap: after any move or
// resize the others are pushed down and then pulled back up to close gaps ("gravity").

export const COLS = 24;
export const ROW = 10; // px per row
export const GAP = 12; // px between cards (taken out of each card's height)
export const MIN_W = 5; // columns
export const MIN_H = 6; // rows

export type Item = { id: string; x: number; y: number; w: number; h?: number };
export type Layout = Item[];
/** Heights, in rows, that auto-height cards currently need. */
export type Measured = Record<string, number>;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const rowsOf = (it: Item, m: Measured) => Math.max(MIN_H, it.h ?? m[it.id] ?? 20);
const hit = (a: Item, ah: number, b: Item, bh: number) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + bh && b.y < a.y + ah;

/** Where cards go before the user has arranged anything: three columns, each in the given order. */
export function defaultLayout(columns: { w: number; ids: string[] }[]): Layout {
  const out: Layout = [];
  let x = 0;
  for (const c of columns) {
    c.ids.forEach((id, i) => out.push({ id, x, y: i * 1000, w: c.w })); // far apart: compaction stacks them in order
    x += c.w;
  }
  return out;
}

/** Fit the saved layout to the cards that exist now: drop cards that are gone, add new ones at the bottom. */
export function reconcile(saved: Layout | null | undefined, ids: string[], fallback: Layout): Layout {
  const have = new Map((saved || []).map((i) => [i.id, i]));
  const base = new Map(fallback.map((i) => [i.id, i]));
  const out: Layout = [];
  for (const id of ids) {
    const s = have.get(id);
    if (s) out.push({ ...s });
    else out.push({ ...(base.get(id) || { id, x: 0, y: 0, w: 12 }), y: 100000 + out.length });
  }
  return out;
}

/** Push everything clear of the pinned card (if any), then pull cards up to close gaps. Returns new items. */
export function settle(items: Layout, m: Measured, pinned?: string): Layout {
  const order = [...items].sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const placed: Layout = [];
  const out = new Map<string, Item>();
  const fix = (it: Item) => {
    const w = clamp(Math.round(it.w), MIN_W, COLS);
    const x = clamp(Math.round(it.x), 0, COLS - w);
    return { ...it, w, x };
  };
  const put = (it: Item) => {
    const f = fix(it);
    const h = rowsOf(f, m);
    let y = 0;
    for (;;) {
      const c = placed.find((p) => hit({ ...f, y }, h, p, rowsOf(p, m)));
      if (!c) break;
      y = c.y + rowsOf(c, m); // jump to just below whatever is in the way
    }
    const done = { ...f, y };
    placed.push(done);
    out.set(f.id, done);
  };
  const pin = pinned ? order.find((i) => i.id === pinned) : undefined;
  if (pin) {
    const f = fix(pin);
    const done = { ...f, y: Math.max(0, Math.round(pin.y)) };
    placed.push(done);
    out.set(f.id, done);
  }
  for (const it of order) if (it !== pin) put(it);
  return items.map((i) => out.get(i.id)!);
}

/** Move a card so its top-left is at column x, row y. */
export function moveItem(items: Layout, m: Measured, id: string, x: number, y: number): Layout {
  return settle(items.map((i) => (i.id === id ? { ...i, x, y } : i)), m, id);
}

/** Resize a card (columns and/or rows). `h` undefined keeps it automatic. */
export function resizeItem(items: Layout, m: Measured, id: string, w: number, h: number | undefined): Layout {
  return settle(items.map((i) => (i.id === id ? { ...i, w, h: h === undefined ? undefined : Math.max(MIN_H, Math.round(h)) } : i)), m, id);
}

/** The card goes back to being as tall as its content. */
export function autoHeight(items: Layout, m: Measured, id: string): Layout {
  return settle(items.map((i) => { if (i.id !== id) return i; const { h: _h, ...rest } = i; return rest; }), m, id);
}

export function heightOf(items: Layout, m: Measured): number {
  return items.reduce((n, i) => Math.max(n, i.y + rowsOf(i, m)), 0);
}

/** Reading order for narrow screens, where the grid collapses to one column. */
export function readingOrder(items: Layout): string[] {
  return [...items].sort((a, b) => (a.y - b.y) || (a.x - b.x)).map((i) => i.id);
}

export function rowsFor(px: number): number {
  return Math.max(MIN_H, Math.ceil((px + GAP) / ROW));
}

/** A saved layout read back from JSON, or null if it isn't one. */
export function parseLayout(v: unknown): Layout | null {
  if (!Array.isArray(v)) return null;
  const out: Layout = [];
  for (const r of v) {
    if (!r || typeof r !== "object") continue;
    const { id, x, y, w, h } = r as Record<string, unknown>;
    if (typeof id !== "string" || ![x, y, w].every((n) => typeof n === "number" && Number.isFinite(n))) continue;
    const it: Item = { id, x: x as number, y: y as number, w: w as number };
    if (typeof h === "number" && Number.isFinite(h) && h >= MIN_H) it.h = h;
    out.push(it);
  }
  return out.length ? out : null;
}
