// The figures behind the client deck. Every number on a slide can point at a "measure": a named figure (turnover, wages, the
// director's loan...), a change on last year, a figure of the user's own (chosen trial balance accounts added together), or one
// trial balance account. Measures are worked out for this year and last from the mapped trial balances, so a slide stays in step
// with the papers, and the user chooses which figure each tile, bar or table row shows.
import { CustomMeasure, Deck, Slide, Tile, kfmt, signed } from "./deck";
import { AccountsFigures, DEST_BY_KEY, Mapping, onSide } from "./tbMap";

export type FigCtx = { f: AccountsFigures; p?: AccountsFigures; maps: Mapping[]; priorMaps?: Mapping[]; custom: CustomMeasure[] };
export type Unit = "£" | "%" | "x";
type Def = { key: string; label: string; group: string; unit: Unit; /** 1: more is good, -1: more is bad, 0: neither */ good: 1 | -1 | 0; get: (f: AccountsFigures, maps: Mapping[]) => number };

const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (a: number, b: number) => (b ? (a / b) * 100 : 0);
/** What the trial balance holds for some places, each shown on its own side (a credit balance is positive for income and creditors). */
export const destSum = (maps: Mapping[], keys: string[]) => r2(maps.reduce((a, m) => { const d = DEST_BY_KEY.get(m.dest); return d && keys.includes(d.key) ? a + onSide(m.balance, d.side) : a; }, 0));
export const DLA_KEY = "creditors/dla";

const PL = "Profit and loss", BS = "Balance sheet", RA = "Ratios", OT = "Other";
export const BUILT_IN: Def[] = [
  { key: "turnover", label: "Turnover", group: PL, unit: "£", good: 1, get: (f) => f.turnover },
  { key: "costOfSales", label: "Cost of sales", group: PL, unit: "£", good: -1, get: (f) => f.costOfSales },
  { key: "grossProfit", label: "Gross profit", group: PL, unit: "£", good: 1, get: (f) => f.grossProfit },
  { key: "otherIncome", label: "Other income", group: PL, unit: "£", good: 1, get: (f) => f.otherIncome },
  { key: "expenses", label: "Overheads (expenses)", group: PL, unit: "£", good: -1, get: (f) => f.expenses },
  { key: "wages", label: "Staff costs", group: PL, unit: "£", good: -1, get: (_, m) => destSum(m, ["expenditure/employee", "expenditure/directors"]) },
  { key: "pbt", label: "Profit before tax", group: PL, unit: "£", good: 1, get: (f) => f.pbt },
  { key: "tax", label: "Tax charge", group: PL, unit: "£", good: -1, get: (f) => f.tax },
  { key: "pat", label: "Profit after tax", group: PL, unit: "£", good: 1, get: (f) => f.pat },
  { key: "dividends", label: "Dividends", group: PL, unit: "£", good: 0, get: (f) => f.dividends },
  { key: "retained", label: "Kept in the company", group: PL, unit: "£", good: 1, get: (f) => f.retained },
  { key: "fixed", label: "Fixed assets", group: BS, unit: "£", good: 1, get: (f) => f.fixed },
  { key: "stock", label: "Stock", group: BS, unit: "£", good: 0, get: (f) => f.stock },
  { key: "debtors", label: "Debtors", group: BS, unit: "£", good: 0, get: (f) => f.debtors },
  { key: "bank", label: "Cash at bank", group: BS, unit: "£", good: 1, get: (f) => f.bank },
  { key: "creditorsWithin", label: "Creditors due within a year", group: BS, unit: "£", good: -1, get: (f) => f.creditorsWithin },
  { key: "creditorsAfter", label: "Creditors due after a year", group: BS, unit: "£", good: -1, get: (f) => f.creditorsAfter },
  { key: "provisions", label: "Provisions", group: BS, unit: "£", good: -1, get: (f) => f.provisions },
  { key: "netCurrent", label: "Net current assets", group: BS, unit: "£", good: 1, get: (f) => f.netCurrent },
  { key: "netAssets", label: "Net assets", group: BS, unit: "£", good: 1, get: (f) => f.netAssets },
  { key: "reserves", label: "Reserves carried forward", group: BS, unit: "£", good: 1, get: (f) => f.reservesCf },
  { key: "dla", label: "Director's loan (owed by the director)", group: OT, unit: "£", good: -1, get: (_, m) => -destSum(m, [DLA_KEY]) },
  { key: "borrowing", label: "Loans and hire purchase", group: OT, unit: "£", good: -1, get: (_, m) => destSum(m, ["creditors/hp", "creditors/hp#after", "creditors/loan", "creditors/loan#after", "loans/main"]) },
  { key: "vat", label: "VAT owed to HMRC", group: OT, unit: "£", good: 0, get: (_, m) => destSum(m, ["vat/control"]) },
  { key: "grossMargin", label: "Gross margin", group: RA, unit: "%", good: 1, get: (f) => pct(f.grossProfit, f.turnover) },
  { key: "netMargin", label: "Profit margin (before tax)", group: RA, unit: "%", good: 1, get: (f) => pct(f.pbt, f.turnover) },
  { key: "overheadRatio", label: "Overheads as % of turnover", group: RA, unit: "%", good: -1, get: (f) => pct(f.expenses, f.turnover) },
  { key: "currentRatio", label: "Current ratio (assets to short-term debts)", group: RA, unit: "x", good: 1, get: (f) => (f.creditorsWithin ? (f.stock + f.debtors + f.bank) / f.creditorsWithin : 0) },
];
const DEF = new Map(BUILT_IN.map((d) => [d.key, d]));

export const isGrowth = (k: string) => k.startsWith("g:");
export const isAccount = (k: string) => k.startsWith("a:");
const acctOf = (maps: Mapping[], key: string) => maps.find((m) => m.acct.key === key);
const acctValue = (m: Mapping | undefined) => { if (!m) return 0; const d = DEST_BY_KEY.get(m.dest); return r2(d && d.key !== "ignore" ? onSide(m.balance, d.side) : m.balance); };

export type Info = { label: string; unit: Unit; good: 1 | -1 | 0 };
export function infoOf(key: string, ctx: FigCtx): Info | undefined {
  if (isGrowth(key)) { const b = infoOf(key.slice(2), ctx); return b && { label: `${b.label}: change on last year`, unit: "%", good: b.good }; }
  const d = DEF.get(key);
  if (d) return { label: d.label, unit: d.unit, good: d.good };
  const c = ctx.custom.find((x) => x.key === key);
  if (c) return { label: c.label, unit: "£", good: 0 };
  if (isAccount(key)) { const m = acctOf(ctx.maps, key.slice(2)) || (ctx.priorMaps && acctOf(ctx.priorMaps, key.slice(2))); return m ? { label: m.acct.account || m.acct.code, unit: "£", good: 0 } : undefined; }
  return undefined;
}

function valueIn(key: string, f: AccountsFigures | undefined, maps: Mapping[] | undefined, ctx: FigCtx): number | undefined {
  if (!f || !maps) return undefined;
  const d = DEF.get(key);
  if (d) return r2(d.get(f, maps));
  const c = ctx.custom.find((x) => x.key === key);
  if (c) return r2(c.accounts.reduce((a, k) => a + (acctOf(maps, k)?.balance || 0), 0) * (c.flip ? -1 : 1)); // debits positive; flip shows credits as positive
  if (isAccount(key)) return acctValue(acctOf(maps, key.slice(2)));
  return undefined;
}

/** A measure for this year and last (last is undefined when there is no earlier year). */
export function measure(key: string, ctx: FigCtx): { now?: number; prior?: number } {
  if (isGrowth(key)) {
    const b = measure(key.slice(2), ctx);
    return { now: b.now !== undefined && b.prior ? r2(((b.now - b.prior) / Math.abs(b.prior)) * 100) : undefined };
  }
  return { now: valueIn(key, ctx.f, ctx.maps, ctx), prior: ctx.p && ctx.priorMaps ? valueIn(key, ctx.p, ctx.priorMaps, ctx) : undefined };
}

export const fmt = (n: number | undefined, unit: Unit): string => (n === undefined ? "-" : unit === "%" ? `${n.toFixed(1)}%` : unit === "x" ? `${n.toFixed(2)}x` : kfmt(n));

/** The change on last year, as a tile shows it. */
export function changeOf(now: number | undefined, prior: number | undefined, unit: Unit, good: 1 | -1 | 0): { change: string; sub: string; tone: Tile["tone"] } {
  if (now === undefined || prior === undefined) return { change: "", sub: "", tone: "flat" };
  const diff = now - prior;
  let change: string;
  if (unit === "%") change = `${diff >= 0 ? "+" : ""}${diff.toFixed(1)} pts`;
  else if (unit === "x") change = `${diff >= 0 ? "+" : ""}${diff.toFixed(2)}`;
  else if (prior) { const c = Math.round((diff / Math.abs(prior)) * 100); change = `${c >= 0 ? "+" : ""}${c}%`; } else change = signed(diff);
  const dir = Math.abs(diff) < (unit === "£" ? 0.5 : 0.005) ? 0 : diff > 0 ? 1 : -1;
  return { change, sub: "year on year", tone: dir === 0 || good === 0 ? "flat" : dir * good > 0 ? "up" : "down" };
}

/** Every figure a user can pick from, in groups. */
export function options(ctx: FigCtx): { group: string; items: { key: string; label: string }[] }[] {
  const groups = new Map<string, { key: string; label: string }[]>();
  const add = (g: string, key: string, label: string) => { if (!groups.has(g)) groups.set(g, []); groups.get(g)!.push({ key, label }); };
  for (const d of BUILT_IN) add(d.group, d.key, d.label);
  if (ctx.p) for (const d of BUILT_IN.filter((x) => x.unit === "£" && !["wages", "dla", "borrowing", "vat"].includes(x.key))) add("Change on last year (%)", `g:${d.key}`, d.label);
  for (const c of ctx.custom) add("Your own figures", c.key, c.label);
  for (const m of [...ctx.maps].sort((a, b) => (a.acct.account || "").localeCompare(b.acct.account || ""))) if (m.acct.key) add("Trial balance accounts", `a:${m.acct.key}`, `${m.acct.code ? `${m.acct.code} ` : ""}${m.acct.account}`.trim());
  const order = [PL, BS, OT, RA, "Change on last year (%)", "Your own figures", "Trial balance accounts"];
  return order.filter((g) => groups.has(g)).map((g) => ({ group: g, items: groups.get(g)! }));
}

/** Where a figure comes from, in words, for the check list. */
export function sourceOf(key: string, ctx: FigCtx): string {
  if (isGrowth(key)) return "Percentage change on last year";
  const c = ctx.custom.find((x) => x.key === key);
  if (c) return `${c.accounts.length} account${c.accounts.length === 1 ? "" : "s"} added together${c.flip ? " (credits shown as positive)" : ""}`;
  if (isAccount(key)) return "One trial balance account";
  const src: Record<string, string> = { wages: "Accounts mapped to Expenditure › Employee costs", dla: "Accounts mapped to Creditors › Director's loan", borrowing: "Loans and hire purchase accounts", vat: "Accounts mapped to VAT control" };
  return src[key] || "Profit and loss account / balance sheet worked out from the mapped trial balance";
}

// ------------------------------------------------------------------ keeping the slides in step

const r0 = (n: number) => Math.round(n);
function bindSlide(s: Slide, ctx: FigCtx): Slide {
  let out = s;
  if (s.tiles?.some((t) => t.m)) {
    out = { ...out, tiles: s.tiles.map((t) => {
      const info = t.m ? infoOf(t.m, ctx) : undefined;
      if (!t.m || !info) return t;
      const v = measure(t.m, ctx), c = changeOf(v.now, v.prior, info.unit, info.good);
      return { ...t, label: t.label || info.label, value: fmt(v.now, info.unit), ...c };
    }) };
  }
  if (s.bars?.rows.some((r) => r.m)) {
    out = { ...out, bars: { ...s.bars!, rows: s.bars!.rows.map((r) => {
      const info = r.m ? infoOf(r.m, ctx) : undefined;
      if (!r.m || !info) return r;
      const v = measure(r.m, ctx), round = (n: number | undefined) => (n === undefined ? 0 : info.unit === "%" && !isGrowth(r.m!) ? Math.round(n * 10) / 10 : r0(n));
      return { ...r, values: s.bars!.names.length >= 2 ? [round(v.prior), round(v.now)] : [round(v.now)] };
    }) } };
  }
  if (s.bridge?.rows.some((r) => r.m)) {
    out = { ...out, bridge: { rows: s.bridge!.rows.map((r) => {
      const info = r.m ? infoOf(r.m, ctx) : undefined;
      if (!r.m || !info) return r;
      const v = measure(r.m, ctx), w = r.w || (r.total ? "now" : "change");
      const value = w === "now" ? v.now : w === "prior" ? v.prior : v.now !== undefined && v.prior !== undefined ? (v.now - v.prior) * (info.good === -1 ? -1 : 1) : undefined;
      return { ...r, value: r0(value ?? 0) };
    }) } };
  }
  if (s.table && s.tableM?.some(Boolean)) {
    const rows = s.table.rows.map((row, i) => {
      const k = s.tableM![i], info = k ? infoOf(k, ctx) : undefined;
      if (!k || !info) return row;
      const v = measure(k, ctx), c = [...row];
      c[1] = fmt(v.now, info.unit);
      if (s.table!.head.length >= 3) c[2] = fmt(v.prior, info.unit);
      return c;
    });
    out = { ...out, table: { ...s.table, rows } };
  }
  return out;
}

/** The deck with every figure that points at a measure brought up to date. Returns the same deck when nothing changed. */
export function bindDeck(deck: Deck, ctx: FigCtx): Deck {
  const slides = deck.slides.map((s) => bindSlide(s, ctx));
  return JSON.stringify(slides) === JSON.stringify(deck.slides) ? deck : { ...deck, slides };
}

/** Warnings about the figures: things on the trial balance that the slides cannot place, and slides pointing at figures that have gone. */
export function figureChecks(deck: Deck | undefined, ctx: FigCtx): string[] {
  const out: string[] = [];
  if (ctx.f.leftOut) out.push(`${kfmt(Math.abs(ctx.f.leftOut))} of trial balance is mapped to "Leave out" or to a place the accounts do not use, so no slide shows it.`);
  if (ctx.f.difference) out.push(`The balance sheet does not balance (difference ${kfmt(ctx.f.difference)}). Check the mapping before showing the client.`);
  if (!ctx.p) out.push("There is no trial balance for last year, so comparisons are left out.");
  if (deck) {
    const gone = new Set<string>();
    const note = (k?: string) => { if (k && !infoOf(k, ctx)) gone.add(k); };
    for (const s of deck.slides) { s.tiles?.forEach((t) => note(t.m)); s.bars?.rows.forEach((r) => note(r.m)); s.bridge?.rows.forEach((r) => note(r.m)); s.tableM?.forEach(note); }
    if (gone.size) out.push(`${gone.size} figure${gone.size === 1 ? "" : "s"} on the slides point at an account that is not on this trial balance any more: choose them again.`);
  }
  return out;
}

export const newCustomKey = (custom: CustomMeasure[]) => { let n = custom.length + 1; while (custom.some((c) => c.key === `c:${n}`)) n++; return `c:${n}`; };
