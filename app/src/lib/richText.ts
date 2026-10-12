// The text of a letter or email as Kevin edits it: plain text where a blank line starts a new
// paragraph, lines starting "- " are bullet points, and **words** are bold. Turned into Word
// paragraphs for letters and HTML for emails.

export type Run = { text: string; bold?: boolean };
export type Block = { type: "p"; lines: Run[][] } | { type: "li"; runs: Run[] };

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

export function parseText(text: string): Block[] {
  const blocks: Block[] = [];
  const paras = text.replace(/\r\n?/g, "\n").split(/\n\s*\n/);
  for (const para of paras) {
    const lines = para.split("\n").map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim());
    if (!lines.length) continue;
    let plain: string[] = [];
    const flush = () => {
      if (plain.length) blocks.push({ type: "p", lines: plain.map(runs) });
      plain = [];
    };
    for (const l of lines) {
      if (BULLET.test(l)) {
        flush();
        blocks.push({ type: "li", runs: runs(l.replace(BULLET, "")) });
      } else {
        plain.push(l.trim());
      }
    }
    flush();
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
