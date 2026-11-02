// The structure of the client deck. A fixed storyline in sections (results, costs, cash and balance sheet, owners, wrap-up); each
// slide has a rule that switches it on or off from the figures (growth only with a prior year, a director's loan slide only when
// there is a loan, dividends only when dividends were paid...). The rule gives a reason that is shown, and any slide can be forced on
// or off for a company: the choice is kept on the deck. Slides that are not relevant yet can still be added.
import { Deck, DeckBrand, DeckInput, DEFAULT_BRAND, Slide, kfmt, slideId, standard, yearLabel } from "./deck";
import { dateWords } from "./clientReview";
import { FigCtx, bindDeck, measure } from "./deckFigures";
import { gbp, spend } from "./clientReview";

export const PLAN_SECTIONS = [
  { key: "opening", label: "Opening" }, { key: "results", label: "The year's results" }, { key: "costs", label: "Costs" },
  { key: "cash", label: "Cash and balance sheet" }, { key: "owners", label: "Tax and the owners" }, { key: "close", label: "Wrap-up" },
] as const;

export type PlanItem = { key: string; section: (typeof PLAN_SECTIONS)[number]["key"]; title: string; optional?: boolean; build: (i: DeckInput, c: FigCtx) => Slide | undefined; rule: (i: DeckInput, c: FigCtx) => { on: boolean; why: string } };

export const ctxOf = (i: DeckInput, custom: Deck["custom"] = []): FigCtx => ({ f: i.f, p: i.p, maps: i.maps || [], priorMaps: i.priorMaps, custom });
const tile = (m: string, label?: string) => ({ m, label: label || "", value: "", change: "", sub: "", tone: "flat" as const });
const std = (key: string) => (i: DeckInput) => standard(i).find((s) => s.auto === key);
const either = (c: FigCtx, key: string) => { const v = measure(key, c); return { now: v.now ?? 0, prior: v.prior ?? 0 }; };

function movers(i: DeckInput) {
  const rows = spend(i.f, i.groups.expenses, i.groups.costs, i.priorGroups?.expenses, i.priorGroups?.costs).filter((x) => x.prior !== undefined);
  return rows.map((x) => ({ ...x, diff: x.now - (x.prior || 0), pc: x.prior ? ((x.now - x.prior) / Math.abs(x.prior)) * 100 : 100 })).filter((x) => Math.abs(x.diff) >= 1000 && Math.abs(x.pc) >= 10).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
}

export const PLAN: PlanItem[] = [
  { key: "cover", section: "opening", title: "Cover",
    build: (i) => ({ id: slideId(), type: "cover", auto: "cover", title: `${yearLabel(i.period)} business performance review`, subtitle: `Year ended ${dateWords(i.period)}`, notes: "All figures come from the draft accounts and may change before the accounts and corporation tax return are finalised." }),
    rule: () => ({ on: true, why: "Always shown" }) },
  { key: "headline", section: "results", title: "The year at a glance", build: std("headline"),
    rule: (i) => ({ on: true, why: i.f.pbt < 0 ? "Always shown; the wording changes because the company made a loss" : "Always shown" }) },
  { key: "growth", section: "results", title: "Growth compared with last year", build: std("growth"),
    rule: (i) => (i.p ? { on: true, why: "There is a trial balance for last year to compare with" } : { on: false, why: "No trial balance for last year" }) },
  { key: "movement", section: "results", title: "What moved profit", build: std("movement"),
    rule: (i) => (i.p ? { on: true, why: "Shows what changed profit since last year" } : { on: false, why: "No trial balance for last year" }) },
  { key: "movers", section: "costs", title: "Costs that moved most", optional: true,
    build: (i) => {
      const m = movers(i).slice(0, 6);
      if (!m.length) return undefined;
      return { id: slideId(), type: "table", auto: "movers", title: "Costs that changed most", table: { head: ["Cost", "This year", "Last year", "Change"], rows: m.map((x) => [x.title, kfmt(x.now), kfmt(x.prior || 0), `${x.diff >= 0 ? "+" : "-"}${kfmt(Math.abs(x.diff))} (${x.pc >= 0 ? "+" : ""}${Math.round(x.pc)}%)`]) },
        takeaway: `${m[0].title} ${m[0].diff >= 0 ? "rose" : "fell"} the most, by ${gbp(Math.abs(m[0].diff))}`, notes: "Only costs that moved by at least 10% and £1,000 are shown." };
    },
    rule: (i) => { const n = i.p ? movers(i).length : 0; return n >= 2 ? { on: true, why: `${n} costs moved by more than 10% and £1,000` } : { on: false, why: i.p ? "No costs moved enough to be worth a slide" : "No trial balance for last year" }; } },
  { key: "spend", section: "costs", title: "Where the money went", build: std("spend"),
    rule: (i) => { const n = spend(i.f, i.groups.expenses, i.groups.costs).length; return n ? { on: true, why: `${n} cost groups to show` } : { on: false, why: "No costs on the trial balance yet" }; } },
  { key: "position", section: "cash", title: "What the company owns and owes", build: std("position"), rule: () => ({ on: true, why: "Always shown" }) },
  { key: "cash", section: "cash", title: "Cash and short-term position", optional: true,
    build: (i, c) => ({ id: slideId(), type: "kpis", auto: "cash", title: "Cash and short-term position", tiles: [tile("bank"), tile("debtors"), tile("creditorsWithin"), tile("currentRatio")], takeaway: `${kfmt(i.f.bank)} in the bank at the year end${i.p ? `, ${i.f.bank >= i.p.bank ? "up" : "down"} ${kfmt(Math.abs(i.f.bank - i.p.bank))} on last year` : ""}.`, notes: "Current ratio is current assets divided by creditors due within a year." }),
    rule: (i, c) => { const b = either(c, "bank"); const big = Math.abs(b.now - b.prior) >= 5000 || (b.prior && Math.abs(b.now - b.prior) / Math.abs(b.prior) >= 0.25 && Math.abs(b.now - b.prior) >= 1000); return big ? { on: true, why: `Cash moved by ${kfmt(Math.abs(b.now - b.prior))}` } : { on: false, why: "Cash did not move much" }; } },
  { key: "assets", section: "cash", title: "Fixed assets and borrowing", optional: true,
    build: (i) => ({ id: slideId(), type: "kpis", auto: "assets", title: "Fixed assets and borrowing", tiles: [tile("fixed"), tile("borrowing"), tile("creditorsAfter")], takeaway: "", notes: "Loans and hire purchase come from the accounts mapped to those places." }),
    rule: (i, c) => { const a = either(c, "fixed"), b = either(c, "borrowing"); return Math.abs(a.now - a.prior) >= 1000 || b.now || b.prior ? { on: true, why: b.now || b.prior ? "There are loans or hire purchase" : `Fixed assets moved by ${kfmt(Math.abs(a.now - a.prior))}` } : { on: false, why: "No fixed asset change or borrowing" }; } },
  { key: "stock", section: "cash", title: "Stock and customers", optional: true,
    build: () => ({ id: slideId(), type: "kpis", auto: "stock", title: "Stock and money owed by customers", tiles: [tile("stock"), tile("debtors")], takeaway: "", notes: "" }),
    rule: (i, c) => { const a = either(c, "stock"); return a.now || a.prior ? { on: true, why: "The company holds stock" } : { on: false, why: "No stock on the trial balance" }; } },
  { key: "vat", section: "cash", title: "VAT", optional: true,
    build: (i, c) => { const v = measure("vat", c).now ?? 0; return { id: slideId(), type: "kpis", auto: "vat", title: "VAT", tiles: [tile("vat", v >= 0 ? "VAT owed to HMRC" : "VAT due back")], takeaway: v >= 0 ? "This is due to HMRC with the next VAT return." : "HMRC owes the company this amount.", notes: "Agree to the latest VAT return." }; },
    rule: (i, c) => { const a = either(c, "vat"); return a.now || a.prior ? { on: true, why: "There is a VAT balance at the year end" } : { on: false, why: "No VAT balance" }; } },
  { key: "tax", section: "owners", title: "Tax and profit kept", build: std("tax"),
    rule: (i) => (i.f.pbt || i.f.tax ? { on: true, why: i.f.tax ? "Corporation tax is due" : "There is a profit or loss to explain" } : { on: false, why: "No profit or tax" }) },
  { key: "dividends", section: "owners", title: "Dividends", optional: true,
    build: (i) => ({ id: slideId(), type: "kpis", auto: "dividends", title: "Dividends", tiles: [tile("pat"), tile("dividends"), tile("retained"), tile("reserves")],
      takeaway: i.f.dividends ? `${gbp(i.f.dividends)} was paid out as dividends, leaving ${gbp(i.f.retained)} in the company.` : "No dividends were paid in the year.", notes: "Check that reserves were enough to pay each dividend, and that the minutes and vouchers are in place." }),
    rule: (i, c) => { const d = either(c, "dividends"); return d.now || d.prior ? { on: true, why: d.now ? "Dividends were paid in the year" : "Dividends were paid last year" } : { on: false, why: "No dividends on the trial balance" }; } },
  { key: "dla", section: "owners", title: "Director's loan account", optional: true,
    build: (i, c) => { const v = measure("dla", c).now ?? 0; return { id: slideId(), type: "kpis", auto: "dla", title: "Director's loan account", tiles: [tile("dla", v > 0 ? "Owed by the director" : v < 0 ? "Owed to the director" : "Director's loan")],
      takeaway: v > 0 ? `The director owes the company ${gbp(v)}. If it is not repaid within nine months and one day of the year end, the company pays extra tax on it until it is.` : v < 0 ? `The company owes the director ${gbp(Math.abs(v))}. No extra tax arises, but it should be repaid or recorded as a loan.` : "The account is clear at the year end.",
      notes: "Section 455 tax applies to loans to participators that are still outstanding nine months and one day after the year end (rate 33.75% for loans made on or after 6 April 2022): check the current rate and the benefit-in-kind rules." }; },
    rule: (i, c) => { const v = either(c, "dla"); return v.now > 0 ? { on: true, why: `The director's loan is overdrawn by ${kfmt(v.now)}: extra tax may apply` } : v.now || v.prior ? { on: true, why: "There is a director's loan balance" } : { on: false, why: "No director's loan on the trial balance" }; } },
  { key: "questions", section: "close", title: "Questions for you", build: std("questions"),
    rule: (i) => (i.queries.length ? { on: true, why: `${i.queries.length} open question${i.queries.length === 1 ? "" : "s"} in the Queries paper` } : { on: false, why: "No queries recorded" }) },
  { key: "next", section: "close", title: "Next steps", build: std("next"), rule: () => ({ on: true, why: "Always shown" }) },
];

const byKey = new Map(PLAN.map((p) => [p.key, p]));
const order = PLAN.map((p) => p.key);

export function buildFor(item: PlanItem, i: DeckInput, custom: Deck["custom"] = []): Slide | undefined {
  const c = ctxOf(i, custom), s = item.build(i, c);
  return s ? bindDeck({ v: 1, brand: DEFAULT_BRAND, slides: [s] }, c).slides[0] : undefined;
}

export type PlanRow = { key: string; section: string; title: string; optional: boolean; on: boolean; present: boolean; forced: boolean; why: string; stale: boolean };
/** Every planned slide with whether the rule (or the user) wants it, whether it is in the deck, and why. */
export function planStatus(deck: Deck, i: DeckInput): PlanRow[] {
  const c = ctxOf(i, deck.custom);
  return PLAN.map((p) => {
    const r = p.rule(i, c), forced = deck.plan?.[p.key] !== undefined, on = deck.plan?.[p.key] ?? r.on, present = deck.slides.some((s) => s.auto === p.key);
    return { key: p.key, section: p.section, title: p.title, optional: !!p.optional, on, present, forced, why: forced ? (on ? "Switched on by you" : "Switched off by you") : r.why, stale: present && !r.on && !forced };
  });
}

function insertAt(slides: Slide[], key: string, s: Slide): Slide[] {
  const idx = order.indexOf(key);
  let at = -1;
  slides.forEach((x, n) => { if (x.auto && order.indexOf(x.auto) !== -1 && order.indexOf(x.auto) < idx) at = n; });
  if (at < 0) at = slides.findIndex((x) => x.type === "cover");
  return [...slides.slice(0, at + 1), s, ...slides.slice(at + 1)];
}

export function starterDeck(i: DeckInput, brand: Partial<DeckBrand> = {}): Deck {
  const b: DeckBrand = { ...DEFAULT_BRAND, ...brand, clientName: i.clientName }, c = ctxOf(i);
  const slides = PLAN.filter((p) => p.rule(i, c).on).map((p) => buildFor(p, i)).filter((s): s is Slide => !!s);
  return bindDeck({ v: 1, brand: b, slides, custom: [], plan: {} }, c);
}

/** Switch a planned slide on (adding it in its place) or off (taking it out), and remember the choice for this company. */
export function setInclude(deck: Deck, i: DeckInput, key: string, on: boolean): Deck {
  const item = byKey.get(key);
  if (!item) return deck;
  const plan = { ...(deck.plan || {}), [key]: on };
  if (!on) return { ...deck, plan, slides: deck.slides.filter((s) => s.auto !== key) };
  if (deck.slides.some((s) => s.auto === key)) return { ...deck, plan };
  const s = buildFor(item, i, deck.custom) || { id: slideId(), type: "text" as const, auto: key, title: item.title, notes: "", bullets: ["There is nothing to show for this yet."] };
  return { ...deck, plan, slides: insertAt(deck.slides, key, s) };
}

/** Bring the deck up to date with the accounts: figures follow what they point at, the standard slides' wording and data are refreshed,
 *  and slides that have become relevant are added (never one you switched off). Nothing you wrote or chose is removed. */
export function refreshDeck(deck: Deck, i: DeckInput): Deck {
  const c = ctxOf(i, deck.custom);
  let slides = deck.slides.map((s) => {
    const item = s.auto ? byKey.get(s.auto) : undefined, n = item ? buildFor(item, i, deck.custom) : undefined;
    if (!n || !item) return s;
    const bound = !!(s.tiles?.some((t) => t.m) || s.bars?.rows.some((r) => r.m) || s.tableM?.some(Boolean));
    return { ...s, takeaway: n.takeaway ?? s.takeaway, subtitle: n.subtitle ?? s.subtitle,
      ...(bound ? {} : { tiles: n.tiles, bars: n.bars, bridge: n.bridge, table: n.table, tableM: n.tableM }), items: s.auto === "next" ? n.items : s.items };
  });
  for (const p of PLAN) {
    if (deck.plan?.[p.key] === false || slides.some((s) => s.auto === p.key) || !p.rule(i, c).on) continue;
    const s = buildFor(p, i, deck.custom);
    if (s) slides = insertAt(slides, p.key, s);
  }
  return bindDeck({ ...deck, slides }, c);
}
