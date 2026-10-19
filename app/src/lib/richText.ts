// The text of a letter or email as Kevin edits it: plain text where a blank line starts a new
// paragraph, lines starting "- " are bullet points, and **words** are bold. Turned into Word
// paragraphs for letters and HTML for emails. Rows with tabs between cells (as pasted from
// Excel or Word) or written "| a | b |" become a table.

export type Run = { text: string; bold?: boolean };
export type Cell = { runs: Run[]; num: boolean };
export type Block = { type: "p"; lines: Run[][] } | { type: "li"; runs: Run[] } | { type: "table"; rows: Cell[][]; header: boolean };

const BULLET = /^\s*(?:[-•*]|\d+[.)])\s+/;

/** Split **bold** markers into runs. An unmatched ** is left as typed. */
export function runs(line: string): Run[] {
  const out: Run[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let at = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (m.index > at) out.push({ text: line.slice(at, m.index) });
    out.push({ text: m[1], bold: true });
    at = m.index + m[0].length;
  }
  if (at < line.length) out.push({ text: line.slice(at) });
  return out.length ? out : [{ text: "" }];
}

const isRow = (l: string) => l.includes("\t") || /^\s*\|.*\|\s*$/.test(l);
const isRule = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
/** A money or number cell: "1,200.00", "£(50)", "-3", "12%". Lined up on the right. */
export const looksNumeric = (s: string) => /^[-(]?\s*[£$€]?\s*[-(]?\d[\d,]*(\.\d+)?\)?%?$/.test(s.replace(/\*\*/g, "").trim());

function cellsOf(l: string): string[] {
  if (l.includes("\t")) return l.split("\t").map((c) => c.trim());
  return l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

/** Table rows into a table block. The first row is a heading row when a "|---|" line follows it,
 *  or when it has no figures but the rows under it do. */
function tableBlock(lines: string[]): Block {
  const ruled = lines.length > 1 && isRule(lines[1]);
  const raw = lines.filter((l) => !isRule(l)).map(cellsOf);
  const width = Math.max(...raw.map((r) => r.length));
  const rows = raw.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? "").map((c) => ({ runs: runs(c), num: looksNumeric(c) })));
  // years ("2026", "2025") in the first row are column headings, not figures
  const headingLike = (c: Cell) => !c.num || /^(19|20)\d\d$/.test(c.runs.map((r) => r.text).join("").trim());
  const header = rows.length > 1 && (ruled || (rows[0].every(headingLike) && rows.slice(1).some((r) => r.some((c) => c.num && !headingLike(c)))));
  return { type: "table", rows, header };
}

export function parseText(text: string): Block[] {
  const blocks: Block[] = [];
  const paras = text.replace(/\r\n?/g, "\n").split(/\n\s*\n/);
  for (const para of paras) {
    // trailing tabs are kept: an empty last cell is still a cell
    const lines = para.split("\n").map((l) => l.replace(/[ \u00a0]+$/, "")).filter((l) => l.trim());
    if (!lines.length) continue;
    let plain: string[] = [];
    let table: string[] = [];
    const flush = () => {
      if (plain.length) blocks.push({ type: "p", lines: plain.map(runs) });
      plain = [];
    };
    const flushTable = () => {
      if (table.length) blocks.push(tableBlock(table));
      table = [];
    };
    for (const l of lines) {
      if (isRow(l) || (table.length && isRule(l))) {
        flush();
        table.push(l);
        continue;
      }
      flushTable();
      if (BULLET.test(l)) {
        flush();
        blocks.push({ type: "li", runs: runs(l.replace(BULLET, "")) });
      } else {
        plain.push(l.trim());
      }
    }
    flush();
    flushTable();
  }
  return blocks;
}

const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const runsHtml = (rs: Run[]) => rs.map((r) => (r.bold ? `<strong>${escHtml(r.text)}</strong>` : escHtml(r.text))).join("");

/** HTML for an email body (and an optional signature, as typed). */
export function toHtml(text: string, signature = ""): string {
  const blocks = parseText(text);
  const out: string[] = [];
  let list: string[] = [];
  const flushList = () => {
    if (list.length) out.push(`<ul style="margin:0 0 12px 0">${list.join("")}</ul>`);
    list = [];
  };
  for (const b of blocks) {
    if (b.type === "table") {
      flushList();
      const cell = (c: Cell, head: boolean) => {
        const tag = head ? "th" : "td";
        return `<${tag} style="border:1px solid #bbb;padding:4px 8px;text-align:${c.num ? "right" : "left"}${head ? ";background:#f2f2f2" : ""}">${runsHtml(c.runs)}</${tag}>`;
      };
      out.push(`<table style="border-collapse:collapse;margin:0 0 12px 0">${b.rows.map((r, i) => `<tr>${r.map((c) => cell(c, b.header && i === 0)).join("")}</tr>`).join("")}</table>`);
      continue;
    }
    if (b.type === "li") {
      list.push(`<li>${runsHtml(b.runs)}</li>`);
      continue;
    }
    flushList();
    out.push(`<p style="margin:0 0 12px 0">${b.lines.map(runsHtml).join("<br>")}</p>`);
  }
  flushList();
  if (signature.trim()) out.push(`<p style="margin:16px 0 0 0;color:#444">${signature.trim().split(/\r?\n/).map(escHtml).join("<br>")}</p>`);
  return `<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.4;color:#222">${out.join("")}</div>`;
}

/** Plain text with the bold markers taken out (for previews and logs). */
export function plainText(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, "$1");
}
