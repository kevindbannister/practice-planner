// Documents: Word (.docx) export. The same content, layout and branding that make the PDF are written
// as a Word file, so a letter can be edited further in Word: styled text, headings, lists, tables
// (heading row repeats on each page), pictures, page breaks, a header with the logo, and a footer with
// "Page x of y". Lists are real indented paragraphs with a bullet or number typed in, which keeps the
// file simple and opens the same everywhere.
import { Branding, displayName } from "./docBranding";
import { Align, Block, Cell, DEFAULT_LAYOUT, DocContent, DocLayout, Run } from "./docModel";
import { zip } from "./xlsx";

const enc = new TextEncoder();
const X = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const tw = (mm: number) => Math.round(mm * 56.693);
const hex = (c: string) => c.replace("#", "").toUpperCase();
const FONT = { sans: "Arial", serif: "Times New Roman", mono: "Courier New" } as const;

function bytesOf(src: string): Uint8Array {
  const b = src.slice(src.indexOf(",") + 1);
  if (typeof atob === "function") return Uint8Array.from(atob(b), (ch) => ch.charCodeAt(0));
  return new Uint8Array((globalThis as unknown as { Buffer: { from(s: string, e: string): ArrayLike<number> } }).Buffer.from(b, "base64"));
}
/** Width and height of a PNG or JPEG, read from its header (undefined if it can't be). */
export function imageSize(d: Uint8Array): { w: number; h: number } | undefined {
  if (d[0] === 0x89 && d[1] === 0x50) return { w: ((d[16] << 24) | (d[17] << 16) | (d[18] << 8) | d[19]) >>> 0, h: ((d[20] << 24) | (d[21] << 16) | (d[22] << 8) | d[23]) >>> 0 };
  if (d[0] === 0xff && d[1] === 0xd8) {
    let i = 2;
    while (i + 9 < d.length) {
      if (d[i] !== 0xff) { i++; continue; }
      const m = d[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: (d[i + 5] << 8) | d[i + 6], w: (d[i + 7] << 8) | d[i + 8] };
      i += 2 + ((d[i + 2] << 8) | d[i + 3]);
    }
  }
  return undefined;
}

type Img = { id: string; name: string; data: Uint8Array; ext: "png" | "jpeg"; w: number; h: number };

class Builder {
  images: Img[] = [];
  constructor(private layout: DocLayout, private brand: Branding) {}
  private n = 0;
  image(src: string): Img | undefined {
    const data = bytesOf(src);
    const size = imageSize(data);
    if (!size || !size.w || !size.h) return undefined;
    const img: Img = { id: `rIdImg${++this.n}`, name: `image${this.n}.${/png/.test(src.slice(0, 20)) ? "png" : "jpeg"}`, data, ext: /png/.test(src.slice(0, 20)) ? "png" : "jpeg", ...size };
    this.images.push(img);
    return img;
  }
  drawing(img: Img, widthMm: number, n: number): string {
    const cx = Math.round(widthMm * 36000), cy = Math.round((cx * img.h) / img.w);
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="Picture ${n}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${n}" name="${X(img.name)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${img.id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  }
  run(r: Run, o: { bold?: boolean; color?: string; size?: number } = {}): string {
    const pr = [r.b || o.bold ? "<w:b/>" : "", r.i ? "<w:i/>" : "", r.u ? '<w:u w:val="single"/>' : "", r.color || o.color ? `<w:color w:val="${hex(r.color || o.color!)}"/>` : "", `<w:sz w:val="${Math.round((r.size || o.size || this.layout.fontSize) * 2)}"/>`].join("");
    return r.t.split("\n").map((line, i) => `<w:r><w:rPr>${pr}</w:rPr>${i ? "<w:br/>" : ""}<w:t xml:space="preserve">${X(line)}</w:t></w:r>`).join("");
  }
  runs(rs: Run[], o: { bold?: boolean; color?: string; size?: number } = {}) {
    return rs.map((r) => this.run(r, o)).join("");
  }
  jc(a?: Align) {
    return a && a !== "left" ? `<w:jc w:val="${a === "justify" ? "both" : a}"/>` : "";
  }
  para(rs: Run[], o: { align?: Align; before?: number; after?: number; bold?: boolean; color?: string; size?: number; indent?: string; keepNext?: boolean } = {}) {
    const sp = `<w:spacing w:before="${o.before ?? 0}" w:after="${o.after ?? Math.round(this.layout.fontSize * 0.55 * 20)}"/>`;
    return `<w:p><w:pPr>${o.keepNext ? "<w:keepNext/>" : ""}${sp}${o.indent || ""}${this.jc(o.align)}</w:pPr>${this.runs(rs, o)}</w:p>`;
  }
  table(b: Extract<Block, { type: "table" }>): string {
    const cols = Math.max(...b.rows.map((r) => r.length));
    const total = tw(210 - this.layout.margins.left - this.layout.margins.right);
    const col = Math.floor(total / cols);
    const line = (n: string) => `<w:${n} w:val="single" w:sz="4" w:space="0" w:color="C8CCD4"/>`;
    const cell = (c: Cell | undefined, head: boolean) =>
      `<w:tc><w:tcPr><w:tcW w:w="${col}" w:type="dxa"/>${head ? '<w:shd w:val="clear" w:color="auto" w:fill="E3EAF2"/>' : ""}</w:tcPr>${this.para(c?.runs || [], { after: 40, before: 40, align: c?.align, bold: head })}</w:tc>`;
    return `<w:tbl><w:tblPr><w:tblW w:w="${total}" w:type="dxa"/><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map(line).join("")}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${Array.from({ length: cols }, () => `<w:gridCol w:w="${col}"/>`).join("")}</w:tblGrid>${b.rows
      .map((r, i) => `<w:tr><w:trPr><w:cantSplit/>${b.header && i === 0 ? "<w:tblHeader/>" : ""}</w:trPr>${Array.from({ length: cols }, (_, k) => cell(r[k], !!b.header && i === 0)).join("")}</w:tr>`)
      .join("")}</w:tbl>${this.para([], { after: 120 })}`;
  }
  body(content: DocContent): string {
    let pic = 100;
    return content.blocks
      .map((b): string => {
        switch (b.type) {
          case "p": return this.para(b.runs, { align: b.align });
          case "h": return this.para(b.runs, { align: b.align, bold: true, color: this.brand.primary, size: [0, 18, 14, 11.5][b.level], before: [0, 200, 160, 120][b.level], after: [0, 120, 100, 80][b.level], keepNext: true });
          case "list": return b.items.map((it, i) => this.para([{ t: `${b.ordered ? `${i + 1}.` : "•"}\t` }, ...it], { indent: '<w:tabs><w:tab w:val="left" w:pos="360"/></w:tabs><w:ind w:left="360" w:hanging="360"/>', after: 40 })).join("") + this.para([], { after: 60 });
          case "table": return b.rows.length ? this.table(b) : "";
          case "img": {
            const img = this.image(b.src);
            return img ? `<w:p><w:pPr><w:spacing w:after="120"/>${this.jc(b.align)}</w:pPr>${this.drawing(img, Math.min(b.width, 210 - this.layout.margins.left - this.layout.margins.right), pic++)}</w:p>` : "";
          }
          case "break": return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
        }
      })
      .join("");
  }
}

/** The document as a Word file. */
export async function renderDocx(input: { content: DocContent; layout?: Partial<DocLayout>; branding: Branding; title?: string }): Promise<Uint8Array> {
  const layout: DocLayout = { ...DEFAULT_LAYOUT, ...(input.layout || {}), margins: { ...DEFAULT_LAYOUT.margins, ...(input.layout?.margins || {}) } };
  const brand = input.branding;
  const bld = new Builder(layout, brand);
  const body = bld.body(input.content);
  const bodyImages = [...bld.images];

  // header: logo at the right, header text in the main colour; footer: text and page numbers
  bld.images.length = 0;
  const headerText = (layout.header || brand.header || "").split("\n").filter(Boolean).slice(0, 3);
  const logo = layout.showLogo && brand.logo ? bld.image(brand.logo) : undefined;
  const headerImages = [...bld.images];
  const logoMm = logo ? Math.min(60, (Math.min(18, Math.max(8, layout.margins.top - 12)) * logo.w) / logo.h) : 0;
  const headerXml = `${HEAD}<w:hdr ${NS}>${logo ? `<w:p><w:pPr><w:spacing w:after="0"/><w:jc w:val="right"/></w:pPr>${bld.drawing(logo, logoMm, 900)}</w:p>` : ""}${(headerText.length ? headerText : [displayName(brand)].filter(Boolean)).slice(0, 3).map((t, i) => bld.para([{ t }], { after: 0, bold: i === 0, color: brand.primary, size: 9 })).join("")}<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="${hex(brand.secondary)}"/></w:pBdr><w:spacing w:after="0"/></w:pPr></w:p></w:hdr>`;
  const grey = "666B73";
  const field = (code: string) => `<w:r><w:rPr><w:color w:val="${grey}"/><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:rPr><w:color w:val="${grey}"/><w:sz w:val="16"/></w:rPr><w:instrText xml:space="preserve"> ${code} </w:instrText></w:r><w:r><w:rPr><w:color w:val="${grey}"/><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:color w:val="${grey}"/><w:sz w:val="16"/></w:rPr><w:t>1</w:t></w:r><w:r><w:rPr><w:color w:val="${grey}"/><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r>`;
  const small = (t: string) => `<w:r><w:rPr><w:color w:val="${grey}"/><w:sz w:val="16"/></w:rPr><w:t xml:space="preserve">${X(t)}</w:t></w:r>`;
  const footText = (layout.footer || brand.footer || "").split("\n").filter(Boolean).slice(0, 3);
  const footerXml = `${HEAD}<w:ftr ${NS}>${footText.map((t) => `<w:p><w:pPr><w:spacing w:after="0"/></w:pPr>${small(t)}</w:p>`).join("")}${layout.pageNumbers ? `<w:p><w:pPr><w:spacing w:after="0"/><w:jc w:val="right"/></w:pPr>${small("Page ")}${field("PAGE")}${small(" of ")}${field("NUMPAGES")}</w:p>` : ""}</w:ftr>`;

  const sect = `<w:sectPr><w:headerReference w:type="default" r:id="rIdHead"/><w:footerReference w:type="default" r:id="rIdFoot"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="${tw(layout.margins.top)}" w:right="${tw(layout.margins.right)}" w:bottom="${tw(layout.margins.bottom)}" w:left="${tw(layout.margins.left)}" w:header="${tw(8)}" w:footer="${tw(8)}" w:gutter="0"/></w:sectPr>`;
  const doc = `${HEAD}<w:document ${NS}><w:body>${body}${sect}</w:body></w:document>`;
  const font = FONT[brand.font];
  const styles = `${HEAD}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}"/><w:sz w:val="${Math.round(layout.fontSize * 2)}"/><w:szCs w:val="${Math.round(layout.fontSize * 2)}"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`;

  const rel = (id: string, type: string, target: string) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`;
  const rels = (items: string[]) => `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.join("")}</Relationships>`;
  const files: { name: string; data: Uint8Array }[] = [
    { name: "[Content_Types].xml", data: enc.encode(`${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`) },
    { name: "_rels/.rels", data: enc.encode(rels([rel("rId1", "officeDocument", "word/document.xml"), `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>`])) },
    { name: "docProps/core.xml", data: enc.encode(`${HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${X(input.title || "Document")}</dc:title><dc:creator>${X(displayName(brand) || "XProFlow")}</dc:creator></cp:coreProperties>`) },
    { name: "word/document.xml", data: enc.encode(doc) },
    { name: "word/styles.xml", data: enc.encode(styles) },
    { name: "word/header1.xml", data: enc.encode(headerXml) },
    { name: "word/footer1.xml", data: enc.encode(footerXml) },
    { name: "word/_rels/document.xml.rels", data: enc.encode(rels([rel("rIdStyles", "styles", "styles.xml"), rel("rIdHead", "header", "header1.xml"), rel("rIdFoot", "footer", "footer1.xml"), ...bodyImages.map((i) => rel(i.id, "image", `media/${i.name}`))])) },
    { name: "word/_rels/header1.xml.rels", data: enc.encode(rels(headerImages.map((i) => rel(i.id, "image", `media/h-${i.name}`)))) },
    ...bodyImages.map((i) => ({ name: `word/media/${i.name}`, data: i.data })),
    ...headerImages.map((i) => ({ name: `word/media/h-${i.name}`, data: i.data })),
  ];
  return zip(files);
}
