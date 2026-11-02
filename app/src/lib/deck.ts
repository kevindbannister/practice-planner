// The client deck: the draft accounts as a presentation for the client. A deck is a list of slides (each one of a few types:
// headline tiles, bar chart, bridge, line, timeline, table, checklist...) with the client's branding. The standard slides are
// worked out from the accounts figures and can be refreshed from them; everything can be changed, hidden or added to.
import { AccountsFigures, Mapping } from "./tbMap";
import { DetailGroup } from "./accounts";
import { NEXT_STEPS, balanceItems, bridge, dateWords, draft, headline, spend } from "./clientReview";

export type SlideType = "cover" | "kpis" | "bars" | "bridge" | "line" | "timeline" | "table" | "checklist" | "callout" | "text" | "section";
export const SLIDE_TYPES: { type: SlideType; name: string; hint: string }[] = [
  { type: "kpis", name: "Key figures", hint: "Big numbers with the change from last year" },
  { type: "bars", name: "Bar chart", hint: "Compare amounts, this year with last" },
  { type: "bridge", name: "Bridge", hint: "From one total to another, step by step" },
  { type: "line", name: "Line chart", hint: "Months or years over time" },
  { type: "timeline", name: "Timeline", hint: "A few points along a line" },
  { type: "table", name: "Table", hint: "Rows and columns of figures or text" },
  { type: "checklist", name: "Checklist", hint: "Numbered points, with a closing band" },
  { type: "callout", name: "Big number", hint: "One figure and what it means" },
  { type: "text", name: "Text", hint: "A few bullet points" },
  { type: "section", name: "Section heading", hint: "A divider between parts" },
];

export type Tile = { label: string; value: string; change: string; sub: string; tone: "up" | "down" | "flat"; /** the figure it shows, kept up to date from the accounts (see deckFigures) */ m?: string };
/** A figure of the user's own: chosen trial balance accounts added together */
export type CustomMeasure = { key: string; label: string; accounts: string[]; flip?: boolean; unit?: "£" };
export type Slide = {
  id: string; type: SlideType; title: string; notes: string; hidden?: boolean;
  /** only for us: left out of the presentation, the PDF and the PowerPoint unless asked for */
  internal?: boolean;
  /** the standard slide it was made from, so it can be refreshed from the figures */
  auto?: string;
  subtitle?: string; takeaway?: string;
  tiles?: Tile[];
  bars?: { unit: string; horizontal: boolean; names: string[]; rows: { label: string; values: number[]; m?: string }[] };
  bridge?: { rows: { label: string; value: number; total?: boolean; m?: string; w?: "prior" | "now" | "change" }[] };
  /** for a table: the figure behind each row (this year in the second column, last year in the third) */
  tableM?: (string | undefined)[];
  line?: { categories: string[]; series: { name: string; values: number[] }[] };
  points?: { label: string; value: string; sub: string }[];
  table?: { head: string[]; rows: string[][] };
  items?: { title: string; text: string }[];
  band?: { left: string; right: string };
  big?: { value: string; caption: string };
  bullets?: string[];
};
export type DeckBrand = { clientName: string; logo: string; cover: string; primary: string; dark: string; background: string; serif: boolean; footer: string; firmLogo: boolean };
export type Deck = { v: 1; brand: DeckBrand; slides: Slide[]; custom?: CustomMeasure[]; /** slides switched on (true) or off (false) by hand, overriding the rule for this company */ plan?: Record<string, boolean> };

export const DEFAULT_BRAND: DeckBrand = { clientName: "", logo: "", cover: "", primary: "#e0680a", dark: "#141414", background: "#f6f4ee", serif: true, footer: "", firmLogo: true };

let counter = 0;
export const slideId = () => `s${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

// ------------------------------------------------------------------ numbers and colours

const trim = (n: number, d: number) => String(Number(n.toFixed(d)));
/** £1.69m, £169.4k, £850: figures as they read on a slide. */
export function kfmt(n: number): string {
  const a = Math.abs(n), s = n < 0 ? "-" : "";
  if (a >= 1e6) return `${s}£${trim(a / 1e6, 2)}m`;
  if (a >= 1e4) return `${s}£${trim(a / 1e3, 1)}k`;
  if (a >= 1e3) return `${s}£${trim(a / 1e3, 1)}k`;
  return `${s}£${Math.round(a)}`;
}
export const signed = (n: number) => `${n >= 0 ? "+" : "-"}${kfmt(Math.abs(n))}`;

export const isHex = (s: string) => /^#[0-9a-f]{6}$/i.test(s);
export const hex6 = (s: string) => s.replace("#", "").toUpperCase();
const rgb = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const toHex = (c: number[]) => `#${c.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join("")}`;
export const mix = (a: string, b: string, t: number) => { const x = rgb(a), y = rgb(b); return toHex(x.map((v, i) => v + (y[i] - v) * t)); };
export const luminance = (h: string) => { const [r, g, b] = rgb(h).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
/** Black or white text, whichever reads on this colour. */
export const onColour = (h: string) => (luminance(h) > 0.4 ? "#141414" : "#ffffff");

/** The brand with every colour checked, so a slide never has an unreadable pair. */
export function themeOf(b: DeckBrand) {
  const primary = isHex(b.primary) ? b.primary : DEFAULT_BRAND.primary, dark = isHex(b.dark) ? b.dark : DEFAULT_BRAND.dark, bg = isHex(b.background) ? b.background : DEFAULT_BRAND.background;
  return { primary, dark, bg, ink: onColour(bg) === "#ffffff" ? "#ffffff" : "#1b1b1b", muted: mix(onColour(bg) === "#ffffff" ? "#ffffff" : "#1b1b1b", bg, 0.45), card: mix(bg, onColour(bg) === "#ffffff" ? "#ffffff" : "#ffffff", onColour(bg) === "#ffffff" ? 0.08 : 0.6),
    grey: mix(bg, "#7a7a7a", 0.5), up: "#14866d", down: "#c0432b", onPrimary: onColour(primary), onDark: onColour(dark) };
}

// ------------------------------------------------------------------ the standard slides

export type DeckInput = {
  clientName: string; period: string; f: AccountsFigures; p?: AccountsFigures;
  maps?: Mapping[]; priorMaps?: Mapping[];
  groups: { expenses: DetailGroup[]; costs: DetailGroup[] }; priorGroups?: { expenses: DetailGroup[]; costs: DetailGroup[] };
  queries: { question: string; answer: string }[];
};

export const yearLabel = (end: string) => { const y = Number(end.slice(0, 4)), m = Number(end.slice(5, 7)), d = Number(end.slice(8, 10)); return m === 12 && d === 31 ? String(y) : `${y - 1}/${String(y).slice(2)}`; };
const pc = (now: number, before?: number) => (before ? Math.round(((now - before) / Math.abs(before)) * 100) : undefined);
const tone = (n: number | undefined): Tile["tone"] => (n === undefined || n === 0 ? "flat" : n > 0 ? "up" : "down");
export const pcTile = (label: string, now: number, before?: number, m?: string): Tile => {
  const c = pc(now, before);
  return { m, label, value: kfmt(now), change: c === undefined ? "" : `${c >= 0 ? "+" : ""}${c}%`, sub: c === undefined ? "" : "year on year", tone: tone(c) };
};

/** The data fields of the standard slides, worked out from the figures. */
export function standard(i: DeckInput): Slide[] {
  const { f, p } = i, d = i.groups, pd = i.priorGroups;
  const note = (t: string) => `${t} Figures come from the draft accounts and may change before the accounts and corporation tax return are finalised.`;
  const margin = (x: AccountsFigures) => (x.turnover ? (x.grossProfit / x.turnover) * 100 : 0);
  const out: Slide[] = [];
  const pbtUp = p ? f.pbt >= p.pbt : undefined;
  out.push({ id: slideId(), type: "kpis", auto: "headline", title: p ? (pbtUp ? "A good year, with profit up" : "A harder year, with profit down") : "Your year at a glance",
    tiles: [pcTile("Turnover", f.turnover, p?.turnover, "turnover"),
      { m: "grossMargin", label: "Gross margin", value: `${margin(f).toFixed(1)}%`, change: p ? `${margin(f) - margin(p) >= 0 ? "+" : ""}${(margin(f) - margin(p)).toFixed(1)} pts` : "", sub: p ? "year on year" : "", tone: tone(p ? margin(f) - margin(p) : undefined) },
      pcTile("Profit before tax", f.pbt, p?.pbt, "pbt"),
      { m: "bank", label: "Cash at bank", value: kfmt(f.bank), change: p ? signed(f.bank - p.bank) : "", sub: p ? "vs last year" : "", tone: tone(p ? f.bank - p.bank : undefined) }],
    takeaway: draft("headline", f, p), notes: note(`Turnover ${kfmt(f.turnover)}${p ? ` (last year ${kfmt(p.turnover)})` : ""}; profit before tax ${kfmt(f.pbt)}${p ? ` (last year ${kfmt(p.pbt)})` : ""}.`) });
  if (p) {
    const rows = [{ m: "g:turnover", label: "Turnover", values: [pc(f.turnover, p.turnover) ?? 0] }, { m: "g:grossProfit", label: "Gross profit", values: [pc(f.grossProfit, p.grossProfit) ?? 0] }, { m: "g:pbt", label: "Profit before tax", values: [pc(f.pbt, p.pbt) ?? 0] }];
    out.push({ id: slideId(), type: "bars", auto: "growth", title: "Growth compared with last year", subtitle: "Change on last year", bars: { unit: "%", horizontal: true, names: ["Change"], rows },
      takeaway: `Gross margin ${margin(f) >= margin(p) ? "rose" : "fell"} from ${margin(p).toFixed(1)}% to ${margin(f).toFixed(1)}%`, notes: note("Percentage change on last year, rounded.") });
    const b = bridge(f, p, d.expenses, pd?.expenses);
    if (b) out.push({ id: slideId(), type: "bridge", auto: "movement", title: "What moved profit before tax", subtitle: `From ${kfmt(b.start)} to ${kfmt(b.end)}`,
      bridge: { rows: [{ label: "Last year", value: b.start, total: true }, ...b.steps.map((s) => ({ label: s.label, value: s.amount })), { label: "This year", value: b.end, total: true }] }, takeaway: draft("movement", f, p, d.expenses, pd?.expenses), notes: note("Each bar is the change in that line compared with last year.") });
  }
  const sp = spend(f, d.expenses, d.costs, pd?.expenses, pd?.costs);
  if (sp.length) out.push({ id: slideId(), type: "bars", auto: "spend", title: "Where the money went", subtitle: p ? "Costs, this year and last" : "Costs this year",
    bars: { unit: "£", horizontal: false, names: p ? ["Last year", "This year"] : ["This year"], rows: sp.slice(0, 7).map((x) => ({ label: x.title, values: p ? [Math.round(x.prior ?? 0), Math.round(x.now)] : [Math.round(x.now)] })) },
    takeaway: draft("spend", f, p, d.expenses, pd?.expenses, d.costs, pd?.costs), notes: note("Cost of sales and the groups of overheads, largest first.") });
  const bal = balanceItems(f, p);
  const BALKEY: Record<string, string> = { "Fixed assets": "fixed", Stock: "stock", "Debtors (owed to the company)": "debtors", "Cash at bank": "bank", "Creditors due within a year": "creditorsWithin", "Creditors due after a year": "creditorsAfter", Provisions: "provisions", "Net assets": "netAssets" };
  const balRows = [...bal.owns, ...bal.owes, { label: "Net assets", now: f.netAssets, prior: p?.netAssets }];
  out.push({ id: slideId(), type: "table", auto: "position", title: "What the company owns and owes", tableM: balRows.map((x) => BALKEY[x.label]), table: { head: ["", "This year", ...(p ? ["Last year"] : [])],
    rows: balRows.map((x) => [x.label, kfmt(x.now), ...(p ? [kfmt(x.prior ?? 0)] : [])]) },
    takeaway: draft("position", f, p), notes: note("The balance sheet in plain terms.") });
  out.push({ id: slideId(), type: "kpis", auto: "tax", title: "Tax and dividends", tiles: [pcTile("Profit before tax", f.pbt, p?.pbt, "pbt"), pcTile("Tax charge", f.tax, p?.tax, "tax"), pcTile("Profit after tax", f.pat, p?.pat, "pat"), pcTile("Kept in the company", f.retained, p?.retained, "retained")],
    takeaway: draft("tax", f, p, undefined, undefined, undefined, undefined, i.period), notes: note("The tax figure is an estimate until the corporation tax return is finalised.") });
  out.push({ id: slideId(), type: "table", auto: "questions", title: "Questions for you", table: { head: ["Question", "Your answer"], rows: i.queries.length ? i.queries.map((q) => [q.question, q.answer]) : [["", ""]] },
    takeaway: "Please confirm these before we finalise the accounts", notes: "Taken from the Queries paper when the deck was made. Edit here or refresh from the papers." });
  const steps = NEXT_STEPS(i.period);
  out.push({ id: slideId(), type: "checklist", auto: "next", title: "Next steps", items: steps.map((s) => ({ title: s.text, text: "" })), band: { left: `Year ended ${dateWords(i.period)}`, right: "" }, notes: "Dates are the standard deadlines for a small company; check them against the diary." });
  return out;
}

// ------------------------------------------------------------------ slides added by hand and moved about

export function blankSlide(type: SlideType): Slide {
  const base = { id: slideId(), type, title: SLIDE_TYPES.find((t) => t.type === type)?.name || "New slide", notes: "" };
  switch (type) {
    case "kpis": return { ...base, tiles: [0, 1, 2].map((k) => ({ label: `Figure ${k + 1}`, value: "£0", change: "", sub: "", tone: "flat" as const })), takeaway: "" };
    case "bars": return { ...base, subtitle: "", bars: { unit: "£", horizontal: true, names: ["Last year", "This year"], rows: [{ label: "First", values: [0, 0] }, { label: "Second", values: [0, 0] }] }, takeaway: "" };
    case "bridge": return { ...base, subtitle: "", bridge: { rows: [{ label: "Start", value: 0, total: true }, { label: "Change", value: 0 }, { label: "End", value: 0, total: true }] }, takeaway: "" };
    case "line": return { ...base, subtitle: "", line: { categories: ["Jan", "Feb", "Mar"], series: [{ name: "Last year", values: [0, 0, 0] }, { name: "This year", values: [0, 0, 0] }] }, takeaway: "" };
    case "timeline": return { ...base, points: [{ label: "Start", value: "£0", sub: "" }, { label: "Middle", value: "£0", sub: "" }, { label: "End", value: "£0", sub: "" }], takeaway: "" };
    case "table": return { ...base, table: { head: ["", "This year", "Last year"], rows: [["", "", ""]] }, takeaway: "" };
    case "checklist": return { ...base, items: [{ title: "First point", text: "" }, { title: "Second point", text: "" }], band: { left: "", right: "" } };
    case "callout": return { ...base, big: { value: "£0", caption: "What this is" }, takeaway: "" };
    case "text": return { ...base, bullets: ["First point", "Second point"] };
    case "section": return { ...base, subtitle: "" };
    default: return { ...base, subtitle: "" };
  }
}
export const moveSlide = (deck: Deck, id: string, by: -1 | 1): Deck => {
  const i = deck.slides.findIndex((s) => s.id === id), j = i + by;
  if (i < 0 || j < 0 || j >= deck.slides.length) return deck;
  const slides = [...deck.slides];
  [slides[i], slides[j]] = [slides[j], slides[i]];
  return { ...deck, slides };
};
export const duplicateSlide = (deck: Deck, id: string): Deck => {
  const i = deck.slides.findIndex((s) => s.id === id);
  if (i < 0) return deck;
  const copy: Slide = { ...JSON.parse(JSON.stringify(deck.slides[i])), id: slideId(), auto: undefined, title: `${deck.slides[i].title} (copy)` };
  return { ...deck, slides: [...deck.slides.slice(0, i + 1), copy, ...deck.slides.slice(i + 1)] };
};
export const presentable = (deck: Deck, includeInternal = false) => deck.slides.filter((s) => !s.hidden && (includeInternal || !s.internal));

/** A deck read from saved JSON, with what's missing filled in. */
export function readDeck(raw: unknown): Deck | undefined {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : undefined;
  if (!o || o.v !== 1 || !Array.isArray(o.slides)) return undefined;
  const b = (o.brand && typeof o.brand === "object" ? o.brand : {}) as Partial<DeckBrand>;
  return { v: 1, brand: { ...DEFAULT_BRAND, ...b }, slides: (o.slides as Slide[]).filter((s) => s && typeof s.id === "string" && typeof s.type === "string").map((s) => ({ ...s, title: typeof s.title === "string" ? s.title : "", notes: typeof s.notes === "string" ? s.notes : "" })) };
}
