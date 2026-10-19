// Word letters. A .docx is a zip of XML files; the letter goes into Kevin's own letterhead
// (uploaded once in Settings), so its header, footer, logo, fonts and margins are kept.
// If the letterhead is an example letter (address, date, "Dear ...", body, "Yours ..." and a
// signature), the new letter takes the example's layout and the example's words are replaced.
// Otherwise the letter is put where the letterhead says {{LETTER}}, or at the end of the page
// body. Without a letterhead, a plain letter is made. Tables (from tab-separated rows) are kept.
import { Block, Run, parseText } from "./richText";
import { zip } from "./xlsx";

export type Letter = {
  date: string; // as printed, e.g. "12 October 2026"
  address: string[]; // lines
  reference?: string; // "Our ref: ..."
  salutation: string; // "Dear Tristan,"
  subject: string;
  body: string; // plain text, see richText
  signOff: string; // "Yours sincerely,"
  signName: string;
  signTitle?: string; // second line under the name, e.g. the practice
};

export const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const PLACEHOLDER = "{{LETTER}}";

const enc = new TextEncoder();
const dec = new TextDecoder();

// ------------------------------------------------------------------ reading a zip

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw" as CompressionFormat));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export class NotWordFile extends Error {}

/** The files in a zip (enough for Word files: stored or deflated, no ZIP64, no encryption). */
export async function unzip(bytes: Uint8Array): Promise<{ name: string; data: Uint8Array }[]> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new NotWordFile("That isn't a Word file.");
  const count = v.getUint16(end + 10, true);
  let at = v.getUint32(end + 16, true);
  const out: { name: string; data: Uint8Array }[] = [];
  for (let n = 0; n < count; n++) {
    if (v.getUint32(at, true) !== 0x02014b50) throw new NotWordFile("That Word file looks damaged.");
    const method = v.getUint16(at + 10, true);
    const size = v.getUint32(at + 20, true); // compressed size
    const nameLen = v.getUint16(at + 28, true);
    const extraLen = v.getUint16(at + 30, true);
    const commentLen = v.getUint16(at + 32, true);
    const local = v.getUint32(at + 42, true);
    const name = dec.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const body = bytes.subarray(start, start + size);
    let data: Uint8Array;
    if (method === 0) data = body.slice();
    else if (method === 8) data = await inflate(body);
    else throw new NotWordFile("That Word file uses compression this app can't read.");
    if (!name.endsWith("/")) out.push({ name, data });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// ------------------------------------------------------------------ letter XML

const esc = (s: string) =>
  s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

/** How text looks: the paragraph's settings (inside <w:pPr>) and the text's (inside <w:rPr>). */
type Look = { ppr: PPr; rpr: string };
/** The parts of a paragraph's settings that the letter uses, in the order Word expects them. */
type PPr = { style?: string; spacing?: string; ind?: string; jc?: string; mark?: string };

const pprXml = (p: PPr, extra: { tabs?: string; spacing?: string; ind?: string; jc?: string } = {}) => {
  const parts = [p.style, extra.tabs, extra.spacing ?? p.spacing, extra.ind ?? p.ind, extra.jc ?? p.jc, p.mark].filter(Boolean).join("");
  return parts ? `<w:pPr>${parts}</w:pPr>` : "";
};

/** Make text bold within a run's settings, keeping the settings' order valid. */
function boldRpr(rpr: string): string {
  const r = rpr.replace(/<w:b w:val="(0|false)"\/>/g, "").replace(/<w:bCs w:val="(0|false)"\/>/g, "");
  if (/<w:b\/>/.test(r)) return r;
  const after = r.match(/^(<w:rStyle [^>]*\/>)?(<w:rFonts [^>]*\/>)?/)?.[0] || "";
  return after + "<w:b/><w:bCs/>" + r.slice(after.length);
}

const runXml = (r: Run, look: Look, bold = false) => {
  const rpr = r.bold || bold ? boldRpr(look.rpr) : look.rpr;
  return `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ""}<w:t xml:space="preserve">${esc(r.text)}</w:t></w:r>`;
};
const brXml = (look: Look) => `<w:r>${look.rpr ? `<w:rPr>${look.rpr}</w:rPr>` : ""}<w:br/></w:r>`;
const para = (content: string, ppr: string) => `<w:p>${ppr}${content}</w:p>`;
/** Lines in one paragraph, broken with line breaks. */
const linesPara = (lines: Run[][], look: Look, extra?: Parameters<typeof pprXml>[1], bold = false) =>
  para(lines.map((l, i) => (i ? brXml(look) : "") + l.map((r) => runXml(r, look, bold)).join("")).join(""), pprXml(look.ppr, extra));

const twips = (ind: string | undefined, side: "left" | "right" | "start" | "end") => Number(ind?.match(new RegExp(`w:${side}="(-?\\d+)"`))?.[1] || 0);

function tableXml(b: Extract<Block, { type: "table" }>, look: Look): string {
  const left = twips(look.ppr.ind, "left") || twips(look.ppr.ind, "start");
  const cellLook: Look = { ppr: { mark: look.ppr.mark }, rpr: look.rpr };
  const border = '<w:top w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:left w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>' +
    '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:right w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>' +
    '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>';
  const cols = b.rows[0]?.length || 1;
  const grid = `<w:tblGrid>${Array.from({ length: cols }, () => '<w:gridCol w:w="2000"/>').join("")}</w:tblGrid>`;
  const rows = b.rows.map((r, i) => {
    const head = b.header && i === 0;
    const cells = r.map((c) =>
      `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/>${head ? '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>' : ""}</w:tcPr>` +
      para(c.runs.map((x) => runXml(x, cellLook, head)).join(""), pprXml(cellLook.ppr, { spacing: '<w:spacing w:before="40" w:after="40" w:line="240" w:lineRule="auto"/>', ind: "", jc: c.num ? '<w:jc w:val="right"/>' : "" })) +
      "</w:tc>").join("");
    return `<w:tr>${head ? "<w:trPr><w:tblHeader/></w:trPr>" : ""}${cells}</w:tr>`;
  }).join("");
  const tbl = `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>${left ? `<w:tblInd w:w="${left}" w:type="dxa"/>` : ""}<w:tblBorders>${border}</w:tblBorders>` +
    '<w:tblLayout w:type="autofit"/><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="04A0"/></w:tblPr>' +
    `${grid}${rows}</w:tbl>`;
  // a little space under the table, in the letter's own text settings
  return tbl + para("", pprXml(look.ppr, { spacing: '<w:spacing w:before="0" w:after="120"/>' }));
}

/** The letter body as Word paragraphs and tables. */
function bodyXml(body: string, look: Look, gap: string): string {
  const left = twips(look.ppr.ind, "left") || twips(look.ppr.ind, "start");
  const right = twips(look.ppr.ind, "right") || twips(look.ppr.ind, "end");
  const blocks = parseText(body);
  return blocks.map((b, i) => {
    if (b.type === "table") return tableXml(b, look);
    if (b.type === "li") {
      // a bullet drawn with a tab and hanging indent, so no numbering setup is needed in the letterhead
      const at = left + 567;
      const lastOfList = blocks[i + 1]?.type !== "li";
      return para(`${runXml({ text: "•" }, look)}<w:r>${look.rpr ? `<w:rPr>${look.rpr}</w:rPr>` : ""}<w:tab/></w:r>${b.runs.map((r) => runXml(r, look)).join("")}`,
        pprXml(look.ppr, {
          tabs: `<w:tabs><w:tab w:val="left" w:pos="${at}"/></w:tabs>`,
          spacing: `<w:spacing w:before="0" w:after="${lastOfList ? gap : "80"}"/>`,
          ind: `<w:ind w:left="${at}"${right ? ` w:right="${right}"` : ""} w:hanging="283"/>`,
        }));
    }
    return linesPara(b.lines, look);
  }).join("");
}

const plainLook = (spacing: string): Look => ({ ppr: { spacing }, rpr: "" });
const TIGHT = '<w:spacing w:before="0" w:after="0"/>';
const LOOSE = '<w:spacing w:before="0" w:after="200"/>';

/** The letter as Word paragraphs (the plain layout, used when the letterhead has no example letter). */
export function letterXml(l: Letter): string {
  const tight = plainLook(TIGHT), loose = plainLook(LOOSE);
  const line = (t: string, look = tight, bold = false) => linesPara([runs0(t)], look, undefined, bold);
  const out: string[] = [];
  out.push(line(l.date), line(""));
  for (const a of l.address.filter((x) => x.trim())) out.push(line(a.trim()));
  out.push(line(""));
  if (l.reference) out.push(line(l.reference), line(""));
  out.push(line(l.salutation, loose));
  const subject = subjectLines(l.subject);
  if (subject.length) out.push(linesPara(subject.map(runs0), loose, undefined, true));
  out.push(bodyXml(l.body, loose, "200"));
  out.push(line(l.signOff), line(""), line(""), line(""), line(l.signName));
  if (l.signTitle) out.push(line(l.signTitle));
  return out.join("");
}

const runs0 = (t: string): Run[] => [{ text: t }];
const subjectLines = (s: string) => s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);

// ------------------------------------------------------------------ an example letter in the letterhead
// Kevin's letterhead is a real letter: address, date, "Dear ...," with the subject in bold under it,
// the body, "Yours faithfully," and his signature. The new letter takes each part's look from the
// example and replaces its words; the signature (picture and name) stays exactly as it is.

const DATE_LINE = /^(?:(?:mon|tues|wednes|thurs|fri|satur|sun)day,?\s+)?\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+\d{4}$/i;
const GREETING = /^dear\b/i;
export const SIGN_OFF = /^(?:yours\s+(?:faithfully|sincerely|truly)|kind(?:est)?\s+regards|best\s+regards|warm\s+regards|regards|best\s+wishes|many\s+thanks|with\s+thanks)\b/i;

type Piece = { xml: string; text: string };

/** The top-level paragraphs and tables of a document body, with their text. */
function pieces(body: string): Piece[] {
  const out: Piece[] = [];
  const re = /<w:(p|tbl|sdt)\b[^>]*?(?:\/>|>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    if (m[0].endsWith("/>")) {
      out.push({ xml: m[0], text: "" });
      continue;
    }
    // find the matching close tag, allowing for nesting of the same element
    const tag = m[1];
    const open = new RegExp(`<w:${tag}(?=[\\s>/])[^>]*?(\\/)?>|</w:${tag}>`, "g");
    open.lastIndex = m.index + m[0].length;
    let depth = 1, end = -1, n: RegExpExecArray | null;
    while ((n = open.exec(body))) {
      if (n[0].startsWith("</")) depth--;
      else if (!n[1]) depth++;
      if (!depth) {
        end = n.index + n[0].length;
        break;
      }
    }
    if (end < 0) break;
    const xml = body.slice(m.index, end);
    out.push({ xml, text: (xml.match(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>/g) || []).map((t) => t.replace(/<[^>]+>/g, "")).join("").replace(/&amp;/g, "&").trim() });
    re.lastIndex = end;
  }
  return out;
}

const first = (xml: string, re: RegExp) => xml.match(re)?.[0];

function pprOf(p: string): PPr {
  const ppr = first(p, /<w:pPr>[\s\S]*?<\/w:pPr>/) || "";
  return {
    style: first(ppr, /<w:pStyle [^>]*\/>/),
    spacing: first(ppr, /<w:spacing [^>]*\/>/),
    ind: first(ppr, /<w:ind [^>]*\/>/),
    jc: first(ppr, /<w:jc [^>]*\/>/),
    mark: first(ppr, /<w:rPr>[\s\S]*?<\/w:rPr>/),
  };
}

/** The settings of the runs with words in them, in order. */
function textRprs(p: string): string[] {
  const out: string[] = [];
  for (const r of p.match(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g) || []) {
    if (!/<w:t[\s>]/.test(r)) continue;
    out.push((first(r, /<w:rPr>([\s\S]*?)<\/w:rPr>/) || "").replace(/^<w:rPr>|<\/w:rPr>$/g, ""));
  }
  return out;
}

const lookOf = (p: string, runIndex = 0): Look => ({ ppr: pprOf(p), rpr: (textRprs(p)[runIndex] ?? textRprs(p)[0] ?? "").replace(/<w:noProof\/>/g, "") });
/** Bookmarks would be left half-open once the example's words are gone. */
const noBookmarks = (xml: string) => xml.replace(/<w:bookmark(?:Start|End)\b[^>]*\/>/g, "");

export type ExampleLayout = { address?: number; date: number; greeting: number; signOff: number; ordinal: boolean };

/** Where the parts of an example letter are, or undefined if the letterhead isn't one. */
export function findExample(list: Piece[]): ExampleLayout | undefined {
  const greeting = list.findIndex((p) => GREETING.test(p.text));
  if (greeting < 0) return undefined;
  const signOff = list.findIndex((p, i) => i > greeting && SIGN_OFF.test(p.text));
  const date = list.findIndex((p, i) => i < greeting && DATE_LINE.test(p.text));
  if (signOff < 0 || date < 0) return undefined;
  const address = list.findIndex((p, i) => i < greeting && i !== date && p.text && !p.xml.startsWith("<w:tbl"));
  return { address: address < 0 ? undefined : address, date, greeting, signOff, ordinal: /\d(st|nd|rd|th)\b/i.test(list[date].text) };
}

/** "28 July 2026" written the example's way ("28th July 2026"). */
export function ordinalDate(d: string): string {
  return d.replace(/^(\d{1,2})(?=\s)/, (n) => {
    const v = Number(n), t = v % 100;
    return n + (t >= 11 && t <= 13 ? "th" : ["th", "st", "nd", "rd"][v % 10] || "th");
  });
}

/** The letter in the example's layout, or undefined if the document isn't an example letter. */
export function fillExample(xml: string, l: Letter): string | undefined {
  const start = xml.indexOf("<w:body>");
  const end = xml.lastIndexOf("</w:body>");
  if (start < 0 || end < 0) return undefined;
  const bodyStart = start + "<w:body>".length;
  let inner = xml.slice(bodyStart, end);
  const sect = inner.lastIndexOf("<w:sectPr");
  const tail = sect >= 0 ? inner.slice(sect) : "";
  inner = sect >= 0 ? inner.slice(0, sect) : inner;
  const list = pieces(inner);
  const at = findExample(list);
  if (!at) return undefined;

  const g = list[at.greeting].xml;
  const greetLook = lookOf(g, 0);
  const greetRuns = textRprs(g);
  // the subject sits under the greeting in the same paragraph (after a line break), in its own look
  const subjectInGreeting = greetRuns.length > 1 && /<w:br\/>/.test(g);
  const subjectLook: Look = { ppr: greetLook.ppr, rpr: subjectInGreeting ? greetRuns[1] : boldRpr(greetLook.rpr) };
  const bodyPiece = list.slice(at.greeting + 1, at.signOff).find((p) => p.text && p.xml.startsWith("<w:p"));
  const bodyLook = bodyPiece ? lookOf(bodyPiece.xml) : greetLook;
  const gap = bodyLook.ppr.spacing?.match(/w:after="(\d+)"/)?.[1] || "160";

  const out: string[] = [];
  list.slice(0, at.greeting).forEach((p, i) => {
    if (i === at.date) out.push(linesPara([runs0(at.ordinal ? ordinalDate(l.date) : l.date)], lookOf(p.xml)));
    else if (i === at.address) {
      const lines = l.address.map((x) => x.trim()).filter(Boolean);
      out.push(linesPara((lines.length ? lines : [""]).map(runs0), lookOf(p.xml)));
      if (l.reference) out.push(linesPara([runs0(l.reference)], lookOf(p.xml)));
    } else if (!p.text) out.push(noBookmarks(p.xml)); // spacing and pictures stay
  });
  const subject = subjectLines(l.subject);
  const greet = runXml({ text: l.salutation }, greetLook);
  if (subjectInGreeting && subject.length) {
    out.push(para(greet + subject.map((s) => brXml(greetLook) + runXml({ text: s }, subjectLook)).join(""), pprXml(greetLook.ppr)));
  } else {
    out.push(para(greet, pprXml(greetLook.ppr)));
    if (subject.length) out.push(linesPara(subject.map(runs0), bodyLook, undefined, true));
  }
  out.push(bodyXml(l.body, bodyLook, gap));
  const so = list[at.signOff].xml;
  out.push(linesPara([runs0(l.signOff)], lookOf(so)));
  // the signature (picture, name and letters) is the example's own
  out.push(...list.slice(at.signOff + 1).map((p) => noBookmarks(p.xml)));
  return xml.slice(0, bodyStart) + out.join("") + tail + xml.slice(end);
}

/** Put the letter into a letterhead's document.xml. */
export function fillDocument(xml: string, letter: string): string {
  const ph = xml.indexOf(PLACEHOLDER);
  if (ph >= 0) {
    const pStart = Math.max(xml.lastIndexOf("<w:p>", ph), xml.lastIndexOf("<w:p ", ph));
    const pEnd = xml.indexOf("</w:p>", ph);
    if (pStart >= 0 && pEnd > ph) return xml.slice(0, pStart) + letter + xml.slice(pEnd + "</w:p>".length);
  }
  const bodyEnd = xml.lastIndexOf("</w:body>");
  if (bodyEnd < 0) throw new NotWordFile("That Word file has no page body.");
  const sect = xml.lastIndexOf("<w:sectPr", bodyEnd);
  const bodyStart = xml.indexOf("<w:body>");
  // the page settings at the end of the body stay last
  const at = sect > bodyStart && xml.slice(sect, bodyEnd).includes("</w:sectPr>") ? sect : bodyEnd;
  return xml.slice(0, at) + letter + xml.slice(at);
}

// ------------------------------------------------------------------ files

const PLAIN_FILES = (documentXml: string): { name: string; data: Uint8Array }[] => [
  {
    name: "[Content_Types].xml",
    data: enc.encode(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        "</Types>",
    ),
  },
  {
    name: "_rels/.rels",
    data: enc.encode(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        "</Relationships>",
    ),
  },
  {
    name: "word/_rels/document.xml.rels",
    data: enc.encode(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        "</Relationships>",
    ),
  },
  {
    name: "word/styles.xml",
    data: enc.encode(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault>' +
        '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
        "</w:styles>",
    ),
  },
  { name: "word/document.xml", data: enc.encode(documentXml) },
];

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

/** A Word letter: in the letterhead when there is one, otherwise plain. */
export async function letterDocx(letter: Letter, letterhead?: Uint8Array | null): Promise<Uint8Array> {
  const body = letterXml(letter);
  if (!letterhead) {
    const doc =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W_NS}><w:body>${body}` +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1304" w:bottom="1440" w:left="1304" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr>' +
      "</w:body></w:document>";
    return zip(PLAIN_FILES(doc));
  }
  const files = await unzip(letterhead);
  const main = files.find((f) => f.name === "word/document.xml");
  if (!main) throw new NotWordFile("That doesn't look like a Word document.");
  const xml = dec.decode(main.data);
  // an example letter in the letterhead: its layout is used and its words replaced
  main.data = enc.encode((!xml.includes(PLACEHOLDER) && fillExample(xml, letter)) || fillDocument(xml, body));
  // a Word template (.dotx) becomes an ordinary document
  const types = files.find((f) => f.name === "[Content_Types].xml");
  if (types) types.data = enc.encode(dec.decode(types.data).replace("wordprocessingml.template.main+xml", "wordprocessingml.document.main+xml"));
  return zip(files);
}

/** Checks an uploaded letterhead: a Word file with a page body. Says whether it has the {{LETTER}} marker. */
export async function checkLetterhead(bytes: Uint8Array): Promise<{ placeholder: boolean; example: boolean }> {
  const files = await unzip(bytes);
  const main = files.find((f) => f.name === "word/document.xml");
  if (!main) throw new NotWordFile("That doesn't look like a Word document. Save your letterhead as a .docx and try again.");
  const xml = dec.decode(main.data);
  if (!xml.includes("<w:body>")) throw new NotWordFile("That Word file has no page body.");
  const placeholder = xml.includes(PLACEHOLDER);
  const b = xml.slice(xml.indexOf("<w:body>"), xml.lastIndexOf("</w:body>"));
  return { placeholder, example: !placeholder && !!findExample(pieces(b)) };
}

/** Letter text from the parts, for showing in a preview or saving in the log. */
export function letterPlain(l: Letter): string {
  return [l.date, "", ...l.address, "", l.salutation, "", ...subjectLines(l.subject), "", l.body, "", l.signOff, "", l.signName, l.signTitle || ""].join("\n").trim();
}
