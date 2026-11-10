// A small, strict XML reader used to check the documents we generate (level 2: well-formed) and to read facts back from them for reconciliation.
// Deliberately narrow: it refuses a DOCTYPE, entity declarations, CDATA and processing instructions other than the XML declaration, so a document
// that could carry an external-entity attack is rejected, not interpreted. It is NOT a validating parser: it does not read schemas.
export type XNode = { name: string; prefix: string; local: string; attrs: Record<string, string>; ns: Record<string, string>; children: (XNode | string)[]; parent?: XNode };
const NAME = /^[A-Za-z_][\w.\-]*(:[A-Za-z_][\w.\-]*)?$/;
const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export function unescape(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);/g, (m, e: string) => {
    if (e[0] === "#") { const c = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); if (!Number.isFinite(c) || c < 9 || c > 0x10ffff) throw new Error(`Bad character reference ${m}`); return String.fromCodePoint(c); }
    if (!(e in ENT)) throw new Error(`Unknown entity ${m}`);
    return ENT[e];
  });
}
export class XmlError extends Error {}
export function parseXml(src: string): XNode {
  let i = 0; const fail = (m: string): never => { const line = src.slice(0, i).split("\n").length; throw new XmlError(`${m} (line ${line})`); };
  if (/<!DOCTYPE|<!ENTITY/i.test(src)) fail("DOCTYPE and entity declarations are not allowed");
  if (/<!\[CDATA\[/.test(src)) fail("CDATA is not used in these documents");
  const decl = /^\s*<\?xml\s[^>]*\?>/.exec(src); if (decl) i = decl[0].length;
  let root: XNode | undefined; let cur: XNode | undefined;
  const scope = (n: XNode | undefined): Record<string, string> => ({ ...(n?.parent ? scope(n.parent) : {}), ...(n?.ns || {}) });
  while (i < src.length) {
    if (src.startsWith("<!--", i)) { const e = src.indexOf("-->", i + 4); if (e < 0) fail("Unterminated comment"); i = e + 3; continue; }
    if (src.startsWith("<?", i)) fail("Processing instructions are not allowed");
    if (src[i] === "<") {
      if (src[i + 1] === "/") {
        const e = src.indexOf(">", i); if (e < 0) fail("Unterminated end tag");
        const nm = src.slice(i + 2, e).trim();
        if (!cur || cur.name !== nm) fail(`End tag </${nm}> doesn't match ${cur ? `<${cur.name}>` : "any open tag"}`);
        cur = cur!.parent; i = e + 1; continue;
      }
      const m = /^<([^\s/>]+)/.exec(src.slice(i)); if (!m || !NAME.test(m[1])) { fail("Bad tag name"); }
      const name = m![1]; i += m![0].length;
      const attrs: Record<string, string> = {}, ns: Record<string, string> = {};
      for (;;) {
        while (/\s/.test(src[i] || "")) i++;
        if (src[i] === ">" || src.startsWith("/>", i)) break;
        const a = /^([^\s=/>]+)\s*=\s*("([^"<]*)"|'([^'<]*)')/.exec(src.slice(i)); if (!a) fail(`Bad attribute in <${name}>`);
        const an = a![1]; if (!NAME.test(an) && an !== "xmlns") fail(`Bad attribute name ${an}`);
        if (an in attrs) fail(`Duplicate attribute ${an} in <${name}>`);
        const val = unescape(a![3] ?? a![4] ?? ""); attrs[an] = val;
        if (an === "xmlns") ns[""] = val; else if (an.startsWith("xmlns:")) ns[an.slice(6)] = val;
        i += a![0].length;
      }
      const [prefix, local] = name.includes(":") ? name.split(":") : ["", name];
      const node: XNode = { name, prefix, local, attrs, ns, children: [], parent: cur };
      if (prefix && prefix !== "xml" && !(prefix in scope(node))) fail(`Namespace prefix "${prefix}" is not declared`);
      for (const k of Object.keys(attrs)) { const p = k.includes(":") ? k.split(":")[0] : ""; if (p && p !== "xml" && p !== "xmlns" && !(p in scope(node))) fail(`Namespace prefix "${p}" is not declared`); }
      if (cur) cur.children.push(node); else if (root) fail("More than one root element"); else root = node;
      if (src.startsWith("/>", i)) i += 2; else { i += 1; cur = node; }
      continue;
    }
    const e = src.indexOf("<", i); const text = src.slice(i, e < 0 ? src.length : e); i = e < 0 ? src.length : e;
    if (text.includes("&")) try { var t = unescape(text); } catch (err) { fail((err as Error).message); } else t = text; // eslint-disable-line no-var
    if (cur) cur.children.push(t!); else if (text.trim()) fail("Text outside the root element");
  }
  if (cur) fail(`<${cur.name}> is never closed`);
  if (!root) fail("No root element");
  return root!;
}
export const resolveNs = (n: XNode, prefix: string): string | undefined => { for (let x: XNode | undefined = n; x; x = x.parent) if (prefix in x.ns) return x.ns[prefix]; return undefined; };
export const textOf = (n: XNode): string => n.children.map((c) => (typeof c === "string" ? c : textOf(c))).join("");
export function descendants(n: XNode, f: (x: XNode) => boolean, out: XNode[] = []): XNode[] { for (const c of n.children) if (typeof c !== "string") { if (f(c)) out.push(c); descendants(c, f, out); } return out; }
