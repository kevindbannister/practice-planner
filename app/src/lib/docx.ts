// Word letters. A .docx is a zip of XML files; the letter goes into Kevin's own letterhead
// (uploaded once in Settings), so its header, footer, logo, fonts and margins are kept.
// The letter is put where the letterhead says {{LETTER}}, or else at the end of the page
// body, after anything already there. Without a letterhead, a plain letter is made.
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

const run = (r: Run) => `<w:r>${r.bold ? "<w:rPr><w:b/></w:rPr>" : ""}<w:t xml:space="preserve">${esc(r.text)}</w:t></w:r>`;
const para = (content: string, props = "") => `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ""}${content}</w:p>`;
const tight = '<w:spacing w:before="0" w:after="0"/>';
const loose = '<w:spacing w:before="0" w:after="200"/>';
const text = (s: string, props = tight, bold = false) => para(s ? run({ text: s, bold }) : "", props);

function blockXml(b: Block): string {
  if (b.type === "li") {
    // a bullet drawn with a tab and hanging indent, so no numbering setup is needed in the letterhead
    return para(`<w:r><w:t xml:space="preserve">•</w:t></w:r><w:r><w:tab/></w:r>${b.runs.map(run).join("")}`,
      `${'<w:spacing w:before="0" w:after="80"/>'}<w:ind w:left="567" w:hanging="283"/><w:tabs><w:tab w:val="left" w:pos="567"/></w:tabs>`);
  }
  return para(b.lines.map((l, i) => (i ? "<w:r><w:br/></w:r>" : "") + l.map(run).join("")).join(""), loose);
}

/** The letter as Word paragraphs. */
export function letterXml(l: Letter): string {
  const out: string[] = [];
  out.push(text(l.date));
  out.push(text(""));
  for (const line of l.address.filter((x) => x.trim())) out.push(text(line.trim()));
  out.push(text(""));
  if (l.reference) {
    out.push(text(l.reference));
    out.push(text(""));
  }
  out.push(text(l.salutation, loose));
  if (l.subject.trim()) out.push(text(l.subject.trim(), loose, true));
  const blocks = parseText(l.body);
  blocks.forEach((b, i) => {
    let xml = blockXml(b);
    // a little space after the last bullet of a list
    if (b.type === "li" && blocks[i + 1]?.type !== "li") xml = xml.replace('w:after="80"', 'w:after="200"');
    out.push(xml);
  });
  out.push(text(l.signOff));
  out.push(text(""), text(""), text(""));
  out.push(text(l.signName));
  if (l.signTitle) out.push(text(l.signTitle));
  return out.join("");
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
  main.data = enc.encode(fillDocument(dec.decode(main.data), body));
  // a Word template (.dotx) becomes an ordinary document
  const types = files.find((f) => f.name === "[Content_Types].xml");
  if (types) types.data = enc.encode(dec.decode(types.data).replace("wordprocessingml.template.main+xml", "wordprocessingml.document.main+xml"));
  return zip(files);
}

/** Checks an uploaded letterhead: a Word file with a page body. Says whether it has the {{LETTER}} marker. */
export async function checkLetterhead(bytes: Uint8Array): Promise<{ placeholder: boolean }> {
  const files = await unzip(bytes);
  const main = files.find((f) => f.name === "word/document.xml");
  if (!main) throw new NotWordFile("That doesn't look like a Word document. Save your letterhead as a .docx and try again.");
  const xml = dec.decode(main.data);
  if (!xml.includes("<w:body>")) throw new NotWordFile("That Word file has no page body.");
  return { placeholder: xml.includes(PLACEHOLDER) };
}

/** Letter text from the parts, for showing in a preview or saving in the log. */
export function letterPlain(l: Letter): string {
  return [l.date, "", ...l.address, "", l.salutation, "", l.subject, "", l.body, "", l.signOff, "", l.signName, l.signTitle || ""].join("\n").trim();
}
