// Document design: how each kind of PDF looks, set once for the practice. There is one design per
// document type (proposal, engagement letter, disengagement letter, professional clearance letter,
// ad-hoc document). A design says whether there is a cover page and what is on it, the font and margins
// of the pages, and what goes in the left, middle and right of the header and the footer.
// Text in a design can use {fields}: {title} {reference} {client} {date} {firm} {address} {page} {pages}.
// Pure logic only; docPdf.ts draws it, and Settings > Document design edits it.
import { Branding, displayName } from "./docBranding";
import { DocLayout, DEFAULT_LAYOUT, cleanColour } from "./docModel";

export const DOC_TYPES = ["proposal", "engagement", "disengagement", "clearance", "accounts", "adhoc"] as const;
export type DocType = (typeof DOC_TYPES)[number];
export const DOC_TYPE_NAMES: Record<DocType, string> = {
  proposal: "Proposal", engagement: "Letters of engagement", disengagement: "Disengagement letter", clearance: "Professional clearance letter", accounts: "Statutory accounts", adhoc: "Ad-hoc PDF",
};

/** What one column holds: nothing, the logo, or text (which may use {fields}). */
export type Column = { kind: "empty" | "logo" | "text"; text: string };
export type Band = {
  enabled: boolean;
  background: string; // "" for none
  colour: string; // text colour
  bold: boolean;
  minHeight: number; // mm
  left: Column; middle: Column; right: Column;
  rule: boolean; // a fine line on the inner edge
};
export type PageNumbers = "none" | "page-of" | "number" | "slash" | "dashed";
export type Cover = {
  enabled: boolean;
  background: string; // page colour
  overlay: string; // colour laid over the page
  overlayOpacity: number; // 0 to 100
  logo: boolean;
  title: string;
  info: { label: string; value: string }[]; // up to 4 pieces under the title
  address: boolean; // the firm's address at the foot
  textColour: string;
};
export type Design = {
  font: "inherit" | "sans" | "serif" | "mono";
  fontSize: number;
  margins: { top: number; right: number; bottom: number; left: number };
  cover: Cover;
  header: Band;
  footer: Band;
  pageNumbers: PageNumbers;
};
export type Designs = Partial<Record<DocType, Design>>;
export const DESIGN_KEY = "docs.design";
export const MAX_INFO = 4;

const none: Column = { kind: "empty", text: "" };
export const defaultDesign = (type: DocType): Design => ({
  font: "inherit",
  fontSize: DEFAULT_LAYOUT.fontSize,
  margins: { ...DEFAULT_LAYOUT.margins },
  cover: {
    enabled: type === "proposal" || type === "accounts", background: "#ffffff", overlay: "#1f3a5f", overlayOpacity: 90, logo: true,
    title: "{title}", info: type === "accounts" ? [{ label: "Registered number", value: "{reference}" }, { label: "Prepared for", value: "{client}" }] : type === "proposal" ? [{ label: "Prepared for", value: "{client}" }, { label: "Reference", value: "{reference}" }, { label: "Date", value: "{date}" }] : [],
    address: true, textColour: "#ffffff",
  },
  header: { enabled: true, background: "", colour: "#1f3a5f", bold: true, minHeight: 15, left: { kind: "text", text: type === "accounts" ? "{client}" : "{firm}" }, middle: none, right: type === "accounts" ? { kind: "text", text: "Registered number: {reference}" } : { kind: "logo", text: "" }, rule: true },
  footer: { enabled: true, background: "", colour: "#666666", bold: false, minHeight: 10, left: { kind: "text", text: "{address}" }, middle: none, right: none, rule: true },
  pageNumbers: type === "accounts" ? "dashed" : "page-of",
});

const str = (v: unknown, max = 500) => (typeof v === "string" ? v.slice(0, max) : "");
const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const col = (v: unknown, d: string, blank = false) => (blank && v === "" ? "" : cleanColour(typeof v === "string" ? v : undefined) || d);
const column = (v: unknown, d: Column): Column => {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const kind = o.kind === "logo" || o.kind === "text" || o.kind === "empty" ? o.kind : d.kind;
  return { kind, text: kind === "text" ? str(o.text, 300) : "" };
};
const band = (v: unknown, d: Band): Band => {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return {
    enabled: typeof o.enabled === "boolean" ? o.enabled : d.enabled, background: col(o.background, d.background, true), colour: col(o.colour, d.colour), bold: typeof o.bold === "boolean" ? o.bold : d.bold,
    minHeight: num(o.minHeight, 5, 60, d.minHeight), left: column(o.left, d.left), middle: column(o.middle, d.middle), right: column(o.right, d.right), rule: typeof o.rule === "boolean" ? o.rule : d.rule,
  };
};

/** A design read from saved settings: anything missing or wrong falls back to the default for that type. */
export function cleanDesign(v: unknown, type: DocType): Design {
  const d = defaultDesign(type);
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const c = (o.cover && typeof o.cover === "object" ? o.cover : {}) as Record<string, unknown>;
  const m = (o.margins && typeof o.margins === "object" ? o.margins : {}) as Record<string, unknown>;
  const info = Array.isArray(c.info) ? c.info.slice(0, MAX_INFO).map((x) => ({ label: str((x as Record<string, unknown>)?.label, 60), value: str((x as Record<string, unknown>)?.value, 200) })) : d.cover.info;
  return {
    font: o.font === "sans" || o.font === "serif" || o.font === "mono" || o.font === "inherit" ? o.font : d.font,
    fontSize: num(o.fontSize, 8, 14, d.fontSize),
    margins: { top: num(m.top, 10, 60, d.margins.top), right: num(m.right, 10, 40, d.margins.right), bottom: num(m.bottom, 10, 60, d.margins.bottom), left: num(m.left, 10, 40, d.margins.left) },
    cover: {
      enabled: typeof c.enabled === "boolean" ? c.enabled : d.cover.enabled, background: col(c.background, d.cover.background), overlay: col(c.overlay, d.cover.overlay), overlayOpacity: num(c.overlayOpacity, 0, 100, d.cover.overlayOpacity),
      logo: typeof c.logo === "boolean" ? c.logo : d.cover.logo, title: typeof c.title === "string" ? str(c.title, 200) : d.cover.title, info, address: typeof c.address === "boolean" ? c.address : d.cover.address, textColour: col(c.textColour, d.cover.textColour),
    },
    header: band(o.header, d.header), footer: band(o.footer, d.footer),
    pageNumbers: o.pageNumbers === "none" || o.pageNumbers === "number" || o.pageNumbers === "slash" || o.pageNumbers === "dashed" || o.pageNumbers === "page-of" ? o.pageNumbers : d.pageNumbers,
  };
}

export function readDesigns(settings: { Key?: unknown; Value?: unknown }[]): Designs {
  const row = settings.find((s) => String(s.Key) === DESIGN_KEY);
  let raw: Record<string, unknown> = {};
  try { raw = row ? JSON.parse(String(row.Value || "{}")) : {}; } catch { raw = {}; }
  const out: Designs = {};
  for (const t of DOC_TYPES) if (raw[t]) out[t] = cleanDesign(raw[t], t);
  return out;
}
export const designFor = (all: Designs, type: DocType): Design => all[type] || defaultDesign(type);
/** Copies one type's design onto another (the "copy design from" action). Returns the new set. */
export const copyDesign = (all: Designs, from: DocType, to: DocType): Designs => ({ ...all, [to]: cleanDesign(JSON.parse(JSON.stringify(designFor(all, from))), to) });

/** The template category a document belongs to, for choosing its design. */
export function typeForCategory(category: string): DocType {
  if (category === "Engagement letters") return "engagement";
  if (category === "Fee proposals") return "proposal";
  return "adhoc";
}

export type Vars = { title?: string; reference?: string; client?: string; date?: string; branding: Branding };
/** Fills {fields} in a design's text. {page} and {pages} are left for the renderer, page by page. */
export function fillVars(text: string, v: Vars): string {
  const address = (v.branding.correspondenceAddress || v.branding.registeredAddress || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean).join(", ");
  const map: Record<string, string> = { title: v.title || "", reference: v.reference || "", client: v.client || "", date: v.date || "", firm: displayName(v.branding) || "", address };
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in map ? map[k] : m));
}

/** Things that would make the design draw badly, as plain sentences. */
export function designProblems(d: Design): string[] {
  const p: string[] = [];
  if (d.header.enabled && d.header.minHeight + 4 > d.margins.top) p.push(`The header is ${d.header.minHeight} mm tall but the top margin is ${d.margins.top} mm. Make the margin at least ${d.header.minHeight + 4} mm or the header shorter.`);
  if (d.footer.enabled && d.footer.minHeight + 4 > d.margins.bottom) p.push(`The footer is ${d.footer.minHeight} mm tall but the bottom margin is ${d.margins.bottom} mm. Make the margin at least ${d.footer.minHeight + 4} mm or the footer shorter.`);
  if (d.cover.enabled && !d.cover.title.trim() && !d.cover.info.length) p.push("The cover page has no title or information on it.");
  return p;
}

/** The layout the body is drawn with under this design. */
export function layoutFor(d: Design, base?: Partial<DocLayout>): DocLayout {
  return { ...DEFAULT_LAYOUT, ...(base || {}), margins: { ...d.margins }, fontSize: d.fontSize, header: "", footer: "", showLogo: false, pageNumbers: d.pageNumbers !== "none" };
}
export const pageLabel = (style: PageNumbers, n: number, total: number): string => (style === "page-of" ? `Page ${n} of ${total}` : style === "number" ? String(n) : style === "slash" ? `${n} / ${total}` : style === "dashed" ? `- ${n} -` : "");
