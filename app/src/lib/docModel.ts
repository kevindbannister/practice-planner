// Documents: the content model. A document is a list of blocks (paragraphs, headings, lists, tables,
// images, page breaks) made of styled runs of text. Content is kept separate from branding (the look
// of the practice) and rendering (docPdf.ts), so the same content can be laid out again later: in a
// different brand, as a PDF, as HTML in the editor, or as the pages of an accounts pack.
//
// Anything typed or pasted into the editor comes back through parseHtml, which keeps only what this
// model can hold: unknown tags, scripts, styles, event handlers and links are dropped, colours and
// sizes are checked, and images must be PNG or JPEG data. That is the rich text sanitiser.

export type Align = "left" | "center" | "right" | "justify";
export type Run = { t: string; b?: boolean; i?: boolean; u?: boolean; color?: string; size?: number };
export type Cell = { runs: Run[]; align?: Align };
export type Block =
  | { type: "p"; runs: Run[]; align?: Align }
  | { type: "h"; level: 1 | 2 | 3; runs: Run[]; align?: Align }
  | { type: "list"; ordered: boolean; items: Run[][] }
  | { type: "table"; header: boolean; rows: Cell[][] }
  | { type: "img"; src: string; width: number; align?: Align }
  | { type: "break" };
export type DocContent = { blocks: Block[] };

/** Page layout for a document: margins in millimetres, header and footer text, page numbers. */
export type DocLayout = {
  margins: { top: number; right: number; bottom: number; left: number };
  header: string;
  footer: string;
  pageNumbers: boolean;
  showLogo: boolean;
  fontSize: number; // body text, points
};
export const DEFAULT_LAYOUT: DocLayout = { margins: { top: 25, right: 22, bottom: 22, left: 22 }, header: "", footer: "", pageNumbers: true, showLogo: true, fontSize: 10.5 };

export const emptyContent = (): DocContent => ({ blocks: [{ type: "p", runs: [] }] });

// ------------------------------------------------------------------ small helpers

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", pound: "£", euro: "€", ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", hellip: "…", bull: "•", copy: "©" };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const COLOUR = /^#[0-9a-f]{6}$/i;
/** A colour as #rrggbb, from #rgb, #rrggbb or rgb(r, g, b); undefined if it isn't one. */
export function cleanColour(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const s = v.trim().toLowerCase();
  if (COLOUR.test(s)) return s;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/.exec(s);
  if (rgb) return `#${[rgb[1], rgb[2], rgb[3]].map((x) => Math.min(255, Number(x)).toString(16).padStart(2, "0")).join("")}`;
  return undefined;
}
/** A font size in points from "12pt", "16px" or a number; undefined unless it is sensible (6 to 72). */
export function cleanSize(v: string | number | undefined): number | undefined {
  if (v === undefined) return undefined;
  const m = /^([\d.]+)\s*(pt|px)?$/.exec(String(v).trim().toLowerCase());
  if (!m) return undefined;
  const pt = m[2] === "px" ? Number(m[1]) * 0.75 : Number(m[1]);
  return pt >= 6 && pt <= 72 ? Math.round(pt * 2) / 2 : undefined;
}
const IMG = /^data:image\/(png|jpeg|jpg);base64,[A-Za-z0-9+/=\s]+$/;
export const isImageData = (s: string) => IMG.test(s);

const sameMarks = (a: Run, b: Run) => !!a.b === !!b.b && !!a.i === !!b.i && !!a.u === !!b.u && a.color === b.color && a.size === b.size;
/** Joins neighbouring runs that look the same; drops empty ones. */
export function tidyRuns(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const r of runs) {
    if (!r.t) continue;
    const last = out[out.length - 1];
    if (last && sameMarks(last, r)) last.t += r.t;
    else out.push({ ...r });
  }
  return out;
}

export const runsText = (runs: Run[]) => runs.map((r) => r.t).join("");

// ------------------------------------------------------------------ HTML to model (the sanitiser)

type Mark = Pick<Run, "b" | "i" | "u" | "color" | "size">;

function styleOf(attrs: string): Record<string, string> {
  const m = /\bstyle\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs);
  const out: Record<string, string> = {};
  if (!m) return out;
  for (const part of (m[2] ?? m[3] ?? "").split(";")) {
    const i = part.indexOf(":");
    if (i > 0) out[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
  }
  return out;
}
const attr = (attrs: string, name: string): string | undefined => {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(attrs);
  return m ? decode(m[1] ?? m[2] ?? m[3] ?? "") : undefined;
};
const alignOf = (attrs: string): Align | undefined => {
  const a = (styleOf(attrs)["text-align"] || attr(attrs, "align") || "").toLowerCase();
  return a === "center" || a === "right" || a === "justify" ? a : undefined;
};
function marksOf(tag: string, attrs: string): Mark | undefined {
  const st = styleOf(attrs);
  const m: Mark = {};
  if (tag === "b" || tag === "strong") m.b = true;
  if (tag === "i" || tag === "em") m.i = true;
  if (tag === "u") m.u = true;
  if (tag === "span" || tag === "font" || tag === "p" || tag === "div" || tag === "td" || tag === "th" || tag === "h1" || tag === "h2" || tag === "h3" || tag === "li") {
    if (/^(bold|[6-9]00)$/.test(st["font-weight"] || "")) m.b = true;
    if (/italic/.test(st["font-style"] || "")) m.i = true;
    if (/underline/.test(st["text-decoration"] || st["text-decoration-line"] || "")) m.u = true;
    const c = cleanColour(st.color);
    if (c) m.color = c;
    const sz = cleanSize(st["font-size"]);
    if (sz) m.size = sz;
  }
  if (tag === "font") {
    const c = cleanColour(attr(attrs, "color"));
    if (c) m.color = c;
  }
  return Object.keys(m).length ? m : undefined;
}

const SKIP = new Set(["script", "style", "head", "title", "iframe", "object", "embed", "svg", "noscript", "template", "textarea", "select", "button"]);
const VOID = new Set(["br", "hr", "img", "meta", "link", "input", "wbr"]);
const TOKEN = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|[^<]+|</g;

/**
 * Reads HTML (from the editor, or pasted into it) as document content. Only what the model can hold
 * is kept: text with bold, italic, underline, colour and size; paragraphs, headings 1 to 3, lists,
 * tables, PNG or JPEG images and page breaks.
 */
export function parseHtml(html: string): DocContent {
  const blocks: Block[] = [];
  // the paragraph being built
  let cur: { kind: "p" | "h"; level: 1 | 2 | 3; align?: Align; runs: Run[] } | undefined;
  let list: { ordered: boolean; items: Run[][] } | undefined;
  let item: Run[] | undefined;
  let table: { header: boolean; rows: Cell[][] } | undefined;
  let row: Cell[] | undefined;
  let cell: { runs: Run[]; align?: Align; th: boolean } | undefined;
  const marks: { tag: string; m?: Mark }[] = [];
  let skip: string | undefined;

  const marksNow = (): Mark => marks.reduce<Mark>((a, x) => ({ ...a, ...(x.m || {}) }), {});
  const sink = (): Run[] | undefined => (cell ? cell.runs : item ? item : cur ? cur.runs : undefined);
  const flushPara = () => {
    if (cur) {
      const runs = tidyRuns(trimRuns(cur.runs));
      blocks.push(cur.kind === "h" ? { type: "h", level: cur.level, runs, ...(cur.align ? { align: cur.align } : {}) } : { type: "p", runs, ...(cur.align ? { align: cur.align } : {}) });
      cur = undefined;
    }
  };
  const flushItem = () => {
    if (item && list) {
      const runs = tidyRuns(trimRuns(item));
      if (runs.length) list.items.push(runs);
    }
    item = undefined;
  };
  const endList = () => {
    flushItem();
    if (list && list.items.length) blocks.push({ type: "list", ordered: list.ordered, items: list.items });
    list = undefined;
  };
  const endCell = () => {
    if (cell && row) row.push({ runs: tidyRuns(trimRuns(cell.runs)), ...(cell.align ? { align: cell.align } : {}) });
    cell = undefined;
  };
  const endRow = () => {
    endCell();
    if (row && table && row.length) table.rows.push(row);
    row = undefined;
  };
  const endTable = () => {
    endRow();
    if (table && table.rows.length) blocks.push({ type: "table", header: table.header, rows: table.rows });
    table = undefined;
  };
  const startPara = (kind: "p" | "h", level: 1 | 2 | 3, attrs: string, tag: string) => {
    if (cell) {
      // a paragraph inside a table cell: a new line in the cell
      if (cell.runs.length) cell.runs.push({ t: "\n" });
      cell.align = cell.align || alignOf(attrs);
      return;
    }
    if (item) return;
    flushPara();
    cur = { kind, level, align: alignOf(attrs), runs: [] };
    const m = marksOf(tag, attrs);
    marks.push({ tag, m });
  };
  const addText = (raw: string) => {
    let text = decode(raw).replace(/\s+/g, " ");
    if (!text) return;
    if (!sink()) {
      if (!text.trim()) return;
      cur = { kind: "p", level: 1, runs: [] };
    }
    const target = sink()!;
    if (!target.length || target[target.length - 1].t.endsWith("\n")) text = text.replace(/^ /, "");
    if (text) target.push({ t: text, ...marksNow() });
  };

  for (const m of html.match(TOKEN) || []) {
    if (m.startsWith("<!--")) continue;
    const tm = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>$/.exec(m);
    if (!tm) {
      if (!skip && !m.startsWith("<")) addText(m);
      else if (!skip && m === "<") addText("<");
      continue;
    }
    const close = tm[1] === "/", tag = tm[2].toLowerCase(), attrs = tm[3] || "";
    if (skip) {
      if (close && tag === skip) skip = undefined;
      continue;
    }
    if (SKIP.has(tag) && !close) {
      if (!VOID.has(tag)) skip = tag;
      continue;
    }
    if (close) {
      switch (tag) {
        case "p": case "div": case "h1": case "h2": case "h3": {
          const i = marks.map((x) => x.tag).lastIndexOf(tag);
          if (i >= 0) marks.splice(i, 1);
          if (!cell && !item) flushPara();
          break;
        }
        case "li": flushItem(); break;
        case "ul": case "ol": endList(); break;
        case "td": case "th": endCell(); break;
        case "tr": endRow(); break;
        case "table": endTable(); break;
        case "b": case "strong": case "i": case "em": case "u": case "span": case "font": {
          const i = marks.map((x) => x.tag).lastIndexOf(tag);
          if (i >= 0) marks.splice(i, 1);
          break;
        }
        default: break;
      }
      continue;
    }
    switch (tag) {
      case "br": {
        const s = sink();
        if (s) s.push({ t: "\n" });
        else { flushPara(); blocks.push({ type: "p", runs: [] }); }
        break;
      }
      case "p": case "div": startPara("p", 1, attrs, tag); break;
      case "h1": case "h2": case "h3": startPara("h", Number(tag[1]) as 1 | 2 | 3, attrs, tag); break;
      case "ul": case "ol":
        flushPara();
        if (list) flushItem(); // a nested list joins the one around it
        else list = { ordered: tag === "ol", items: [] };
        break;
      case "li":
        if (!list) { flushPara(); list = { ordered: false, items: [] }; }
        flushItem();
        item = [];
        break;
      case "table": flushPara(); endList(); table = { header: false, rows: [] }; break;
      case "tr": if (table) { endRow(); row = []; } break;
      case "td": case "th":
        if (table) {
          if (!row) row = [];
          endCell();
          cell = { runs: [], align: alignOf(attrs), th: tag === "th" };
          if (tag === "th" && table.rows.length === 0) table.header = true;
        }
        break;
      case "img": {
        const src = (attr(attrs, "src") || "").trim();
        if (!isImageData(src)) break;
        if (!cell && !item) flushPara();
        const st = styleOf(attrs);
        const w = Number(/([\d.]+)/.exec(st.width || attr(attrs, "width") || "")?.[1]);
        const wmm = Number.isFinite(w) && w > 0 ? Math.round(Math.min(170, Math.max(5, w * 0.2646)) * 10) / 10 : 40;
        blocks.push({ type: "img", src: src.replace(/\s+/g, ""), width: wmm, ...(alignOf(attrs) ? { align: alignOf(attrs) } : {}) });
        break;
      }
      case "hr":
        if (/pagebreak|page-break/i.test(attrs)) { if (!cell && !item) flushPara(); blocks.push({ type: "break" }); }
        break;
      case "b": case "strong": case "i": case "em": case "u": case "span": case "font":
        marks.push({ tag, m: marksOf(tag, attrs) });
        break;
      default: break;
    }
  }
  flushPara();
  endTable();
  endList();
  return { blocks: blocks.length ? blocks : emptyContent().blocks };
}

function trimRuns(runs: Run[]): Run[] {
  const out = runs.map((r) => ({ ...r }));
  while (out.length && /^\s*$/.test(out[out.length - 1].t)) out.pop();
  if (out.length) out[out.length - 1].t = out[out.length - 1].t.replace(/[ \n]+$/, "");
  while (out.length && /^\s*$/.test(out[0].t)) out.shift();
  if (out.length) out[0].t = out[0].t.replace(/^ +/, "");
  return out;
}

// ------------------------------------------------------------------ model to HTML

const TOKEN_RE = /\{\{\s*([a-z0-9_.]+)\s*\}\}/gi;

function runHtml(r: Run, chips: boolean): string {
  const style = [r.color ? `color:${r.color}` : "", r.size ? `font-size:${r.size}pt` : ""].filter(Boolean).join(";");
  let out = "";
  let last = 0;
  const text = r.t;
  const piece = (s: string) => esc(s).replace(/\n/g, "<br>");
  for (const m of text.matchAll(TOKEN_RE)) {
    out += piece(text.slice(last, m.index));
    const key = m[1].toLowerCase();
    out += chips ? `<span class="mf" contenteditable="false" data-field="${esc(key)}">{{${esc(key)}}}</span>` : piece(m[0]);
    last = (m.index ?? 0) + m[0].length;
  }
  out += piece(text.slice(last));
  if (style) out = `<span style="${style}">${out}</span>`;
  if (r.u) out = `<u>${out}</u>`;
  if (r.i) out = `<i>${out}</i>`;
  if (r.b) out = `<b>${out}</b>`;
  return out;
}
const runsHtml = (runs: Run[], chips: boolean) => runs.map((r) => runHtml(r, chips)).join("");
const alignAttr = (a?: Align) => (a && a !== "left" ? ` style="text-align:${a}"` : "");

/** The content as HTML for the editor (merge fields as chips) or the preview (chips off). */
export function toHtml(content: DocContent, chips = true): string {
  return content.blocks.map((b) => {
    switch (b.type) {
      case "p": return `<p${alignAttr(b.align)}>${runsHtml(b.runs, chips) || "<br>"}</p>`;
      case "h": return `<h${b.level}${alignAttr(b.align)}>${runsHtml(b.runs, chips) || "<br>"}</h${b.level}>`;
      case "list": return `<${b.ordered ? "ol" : "ul"}>${b.items.map((it) => `<li>${runsHtml(it, chips)}</li>`).join("")}</${b.ordered ? "ol" : "ul"}>`;
      case "table":
        return `<table>${b.rows.map((r, i) => `<tr>${r.map((c) => `<${b.header && i === 0 ? "th" : "td"}${alignAttr(c.align)}>${runsHtml(c.runs, chips) || "<br>"}</${b.header && i === 0 ? "th" : "td"}>`).join("")}</tr>`).join("")}</table>`;
      case "img": return `<p${alignAttr(b.align)}><img src="${b.src}" style="width:${Math.round(b.width / 0.2646)}px"></p>`;
      case "break": return `<hr class="pagebreak">`;
    }
  }).join("");
}

// ------------------------------------------------------------------ working with content

/** Every run in the content, in order (for finding merge fields and replacing them). */
export function mapRuns(content: DocContent, fn: (runs: Run[]) => Run[]): DocContent {
  return {
    blocks: content.blocks.map((b): Block => {
      switch (b.type) {
        case "p": case "h": return { ...b, runs: fn(b.runs) };
        case "list": return { ...b, items: b.items.map(fn) };
        case "table": return { ...b, rows: b.rows.map((r) => r.map((c) => ({ ...c, runs: fn(c.runs) }))) };
        default: return b;
      }
    }),
  };
}
export function allRuns(content: DocContent): Run[] {
  const out: Run[] = [];
  mapRuns(content, (r) => { out.push(...r); return r; });
  return out;
}
/** The plain text of the content (paragraphs on separate lines). */
export function plainText(content: DocContent): string {
  return content.blocks.map((b) => {
    switch (b.type) {
      case "p": case "h": return runsText(b.runs);
      case "list": return b.items.map((i) => `- ${runsText(i)}`).join("\n");
      case "table": return b.rows.map((r) => r.map((c) => runsText(c.runs)).join("\t")).join("\n");
      case "img": return "[image]";
      case "break": return "";
    }
  }).join("\n");
}
/** Whether stored JSON is usable document content (guards against anything odd in a saved row). */
export function readContent(json: unknown): DocContent {
  try {
    const o = typeof json === "string" ? JSON.parse(json) : json;
    if (o && typeof o === "object" && Array.isArray((o as DocContent).blocks)) {
      return parseHtml(toHtml(o as DocContent, false)); // through the sanitiser again
    }
  } catch {
    /* fall through */
  }
  return emptyContent();
}
