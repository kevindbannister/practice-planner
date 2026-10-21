// Reading an Excel workbook (.xlsx): the sheets' cell values as Excel last saved them (formulas
// keep their cached results), plus the formula text, which the workbook importer uses to follow
// links between sheets. Plain regular expressions over the XML, so it runs in the browser and in tests.
import { unzip } from "./docx";

export type XCell = { v: string | number | boolean | undefined; f?: string };
export type XSheet = {
  name: string;
  /** The last row with anything in it (1-based). */
  maxRow: number;
  cell: (row: number, col: number) => XCell | undefined;
  /** The value as text ("" if empty); numbers as Excel stores them. */
  text: (row: number, col: number) => string;
  /** The value as a number (undefined if not a number). */
  num: (row: number, col: number) => number | undefined;
};
export type XBook = { names: string[]; sheet: (name: string) => XSheet | undefined };

const dec = new TextDecoder();
const unesc = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];

/** Column letters to a 1-based number ("A" → 1, "AB" → 28). */
export function colNumber(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** The text of a shared string or inline string: all its <t> runs. */
const runs = (xml: string) => [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unesc(m[1])).join("");

export async function readXlsx(bytes: Uint8Array): Promise<XBook> {
  const files = await unzip(bytes);
  const file = (path: string) => {
    const f = files.find((x) => x.name.replace(/^\//, "") === path);
    return f ? dec.decode(f.data) : "";
  };
  const shared = [...file("xl/sharedStrings.xml").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => runs(m[1]));
  const rels = new Map<string, string>();
  for (const m of file("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], "Id"), target = attr(m[0], "Target");
    if (id && target) rels.set(id, target.replace(/^\/?xl\//, "").replace(/^\//, ""));
  }
  const sheets: { name: string; path: string }[] = [];
  for (const m of file("xl/workbook.xml").matchAll(/<sheet\b[^>]*>/g)) {
    const name = unesc(attr(m[0], "name") || ""), id = attr(m[0], "r:id");
    const target = id && rels.get(id);
    if (name && target) sheets.push({ name, path: `xl/${target}` });
  }
  const cache = new Map<string, XSheet>();
  const load = (name: string, path: string): XSheet => {
    const cells = new Map<string, XCell>();
    let maxRow = 0;
    const xml = file(path);
    for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const head = m[1], body = m[2] || "";
      const ref = attr(head, "r");
      if (!ref) continue;
      const rc = /^([A-Z]+)(\d+)$/.exec(ref);
      if (!rc) continue;
      const row = Number(rc[2]), col = colNumber(rc[1]);
      const t = attr(head, "t");
      const fm = /<f\b[^>]*>([\s\S]*?)<\/f>/.exec(body);
      const vm = /<v>([\s\S]*?)<\/v>/.exec(body);
      let v: XCell["v"];
      if (t === "s") v = vm ? shared[Number(vm[1])] : undefined;
      else if (t === "inlineStr") v = runs(body);
      else if (t === "str" || t === "e") v = vm ? unesc(vm[1]) : undefined;
      else if (t === "b") v = vm ? vm[1] === "1" : undefined;
      else v = vm ? Number(vm[1]) : undefined;
      if (v === undefined && !fm) continue;
      cells.set(`${row},${col}`, { v, f: fm ? unesc(fm[1]) : undefined });
      if (row > maxRow) maxRow = row;
    }
    const cell = (r: number, c: number) => cells.get(`${r},${c}`);
    return {
      name, maxRow, cell,
      text: (r, c) => {
        const x = cell(r, c)?.v;
        return x === undefined || x === null ? "" : String(x).trim();
      },
      num: (r, c) => {
        const x = cell(r, c)?.v;
        return typeof x === "number" && Number.isFinite(x) ? x : undefined;
      },
    };
  };
  return {
    names: sheets.map((s) => s.name),
    sheet: (name) => {
      const s = sheets.find((x) => x.name === name) || sheets.find((x) => x.name.trim().toLowerCase() === name.trim().toLowerCase());
      if (!s) return undefined;
      if (!cache.has(s.name)) cache.set(s.name, load(s.name, s.path));
      return cache.get(s.name);
    },
  };
}

/** An Excel date serial to "yyyy-mm-dd". */
export function excelDate(serial: number): string {
  const ms = Math.round((serial - 25569) * 86400000);
  return new Date(ms).toISOString().slice(0, 10);
}
