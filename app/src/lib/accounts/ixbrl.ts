// iXBRL generation from the structured accounts and a taxonomy mapping, plus the internal checks and the reconciliation of the tagged facts with the model.
//
// What this is: an inline XBRL (XHTML) writer that follows the Inline XBRL 1.1 structure (ix:header, ix:references with a link:schemaRef, ix:resources with
// xbrli:context and xbrli:unit, ix:nonFraction and ix:nonNumeric facts). What it is not: a taxonomy-aware validator. The checks below catch our own mistakes (broken
// references, contexts without facts, a figure that differs from the model); they do not replace validating against the taxonomy with an established XBRL
// engine and Companies House's own validator. Nothing is generated until the mapping is verified (see taxonomy.ts), so no filing can come from guessed concepts.
import { AccountsModel } from "./model";
import { Concept, ContextKind, STANDARD_NS, TaxonomyMapping, mappingProblems } from "./taxonomy";
import { XNode, XmlError, descendants, parseXml, resolveNs, textOf } from "./xml";
import type { Issue } from "./validate";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const penceText = (p: number) => `${p < 0 ? "-" : ""}${Math.floor(Math.abs(p) / 100)}.${String(Math.abs(p) % 100).padStart(2, "0")}`;

export type Period = { kind: "instant"; date: string } | { kind: "duration"; start: string; end: string };
export type Fact = { concept: string; field: string; period: Period; unit: string | null; value: string; type: Concept["type"] };
const pkey = (p: Period) => (p.kind === "instant" ? `i:${p.date}` : `d:${p.start}/${p.end}`);

/** Every fact the model supplies for a mapping, with its period and exact text. The single list both the document and the reconciliation use. */
export function expectedFacts(m: AccountsModel, map: TaxonomyMapping): Fact[] {
  const cur = m.current, pr = m.comparative;
  const period = (k: ContextKind): Period | null =>
    k === "instant-current" ? { kind: "instant", date: cur.asAt } : k === "instant-prior" ? (pr ? { kind: "instant", date: pr.asAt } : null) : k === "duration-current" ? { kind: "duration", start: m.period.start, end: m.period.end } : null;
  const amount = (f: string, c: typeof cur): number | undefined => ({ calledUpNotPaid: c.calledUpNotPaid, cash: c.cash, netAssets: c.netAssets, shareCapital: c.shareCapital, profitAndLoss: c.profitAndLoss, shareholdersFunds: c.shareholdersFunds } as Record<string, number>)[f];
  const text: Record<string, string> = {
    entityName: m.company.name, companyNumber: m.company.number, balanceSheetDate: cur.asAt, periodStart: m.period.start, periodEnd: m.period.end, dormantStatus: String(m.statements.dormantThroughout),
    averageEmployees: String(m.employees.average), dateAuthorisation: m.signing.date, directorSigning: m.signing.director,
    auditExemptStatement: "The company was entitled to exemption from audit under section 480 of the Companies Act 2006 relating to dormant companies.",
    membersNoAuditStatement: "The members have not required the company to obtain an audit of its accounts for the period in question in accordance with section 476.",
    directorsResponsibilitiesStatement: "The directors acknowledge their responsibilities for complying with the requirements of the Act with respect to accounting records and the preparation of accounts.",
    smallCompaniesRegimeStatement: "These accounts have been prepared in accordance with the provisions applicable to companies subject to the small companies regime.",
  };
  const out: Fact[] = [];
  for (const c of map.concepts) {
    if (!c.concept) continue;
    for (const k of c.type === "monetary" && c.context === "instant-current" ? (["instant-current", "instant-prior"] as ContextKind[]) : [c.context]) {
      const p = period(k); if (!p) continue;
      let value: string | undefined;
      if (c.type === "monetary") { const n = amount(c.field, k === "instant-prior" ? pr! : cur); if (n === undefined) continue; value = penceText(c.invert ? -n : n); }
      else value = text[c.field];
      if (value === undefined || value === "") continue;
      out.push({ concept: c.concept, field: c.field, period: p, unit: c.unit === "GBP" ? "GBP" : c.unit === "pure" ? "pure" : null, value, type: c.type });
    }
  }
  return out;
}

export type Generated = { ok: boolean; problems: string[]; html?: string; facts: Fact[] };
/** Makes the iXBRL document, or says exactly why it can't. Refuses on an unverified mapping or a model that failed validation. */
export function generate(m: AccountsModel, map: TaxonomyMapping, modelIssues: Issue[] = []): Generated {
  const problems = [...modelIssues.filter((i) => i.severity === "error").map((i) => i.message), ...mappingProblems(map)];
  if (problems.length) return { ok: false, problems, facts: [] };
  const facts = expectedFacts(m, map);
  const present = new Set(facts.map((f) => f.field));
  for (const c of map.concepts.filter((x) => x.required)) if (!present.has(c.field)) problems.push(`The accounts have nothing to give for the required field "${c.field}".`);
  if (problems.length) return { ok: false, problems, facts };

  const ctxIds = new Map<string, string>();
  const ctxOf = (p: Period) => { const k = pkey(p); if (!ctxIds.has(k)) ctxIds.set(k, `c${ctxIds.size + 1}`); return ctxIds.get(k)!; };
  facts.forEach((f) => ctxOf(f.period));
  const units = [...new Set(facts.map((f) => f.unit).filter(Boolean))] as string[];
  const tag = (f: Fact, shown = f.value) => {
    const base = `name="${f.concept}" contextRef="${ctxOf(f.period)}"`;
    return f.type === "monetary" || f.type === "integer"
      ? `<ix:nonFraction ${base} unitRef="${f.unit}" decimals="${f.type === "monetary" ? 2 : 0}"${f.value.startsWith("-") ? ' sign="-"' : ""}>${esc(f.value.replace(/^-/, ""))}</ix:nonFraction>`
      : `<ix:nonNumeric ${base}>${esc(shown)}</ix:nonNumeric>`;
  };
  const get = (field: string, p?: Period) => facts.find((f) => f.field === field && (!p || pkey(f.period) === pkey(p)));
  const money = (field: string, prior: boolean) => { const f = facts.find((x) => x.field === field && (prior ? x.period.kind === "instant" && m.comparative && (x.period as { date: string }).date === m.comparative.asAt : (x.period.kind === "instant" ? (x.period as { date: string }).date === m.current.asAt : true))); return f ? tag(f) : ""; };
  const row = (label: string, field: string) => `<tr><td>${esc(label)}</td><td class="n">${money(field, false)}</td><td class="n">${m.comparative ? money(field, true) : ""}</td></tr>`;
  const nsDecl = Object.entries(map.namespaces).map(([p, u]) => ` xmlns:${p}="${esc(u!)}"`).join("");
  const ctx = [...ctxIds].map(([k, id]) => {
    const per = k.startsWith("i:") ? `<xbrli:instant>${k.slice(2)}</xbrli:instant>` : `<xbrli:startDate>${k.slice(2).split("/")[0]}</xbrli:startDate><xbrli:endDate>${k.slice(2).split("/")[1]}</xbrli:endDate>`;
    return `<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="${esc(map.identifierScheme)}">${esc(m.company.number)}</xbrli:identifier></xbrli:entity><xbrli:period>${per}</xbrli:period></xbrli:context>`;
  }).join("");
  const unitXml = units.map((u) => (u === "GBP" ? `<xbrli:unit id="GBP"><xbrli:measure>iso4217:GBP</xbrli:measure></xbrli:unit>` : `<xbrli:unit id="pure"><xbrli:measure>xbrli:pure</xbrli:measure></xbrli:unit>`)).join("");
  const stmt = (field: string) => { const f = get(field); return f ? `<p>${tag(f)}</p>` : ""; };
  const html = `<?xml version="1.0" encoding="UTF-8"?>\n<html xmlns="${STANDARD_NS.xhtml}" xmlns:ix="${STANDARD_NS.ix}" xmlns:xbrli="${STANDARD_NS.xbrli}" xmlns:link="${STANDARD_NS.link}" xmlns:xlink="${STANDARD_NS.xlink}" xmlns:iso4217="${STANDARD_NS.iso4217}"${nsDecl.replace(/ xmlns:(xhtml|ix|xbrli|link|xlink|iso4217)="[^"]*"/g, "")}>`
    + `<head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"/><title>${esc(m.company.name)} accounts for the period ended ${m.period.end}</title></head><body>`
    + `<div style="display:none"><ix:header><ix:references><link:schemaRef xlink:type="simple" xlink:href="${esc(map.entryPoint!)}"/></ix:references><ix:resources>${ctx}${unitXml}</ix:resources></ix:header></div>`
    + `<h1>${tag(get("entityName")!)}</h1><p>Company number ${tag(get("companyNumber")!)}</p><p>Period ${tag(get("periodStart")!)} to ${tag(get("periodEnd")!)}</p>`
    + `<h2>Balance sheet as at ${tag(get("balanceSheetDate")!)}</h2><table><thead><tr><th></th><th>${m.current.asAt}</th><th>${m.comparative ? m.comparative.asAt : ""}</th></tr></thead><tbody>`
    + row("Called up share capital not paid", "calledUpNotPaid") + row("Cash at bank and in hand", "cash") + row("Net assets", "netAssets")
    + row("Called up share capital", "shareCapital") + row("Profit and loss account", "profitAndLoss") + row("Shareholders' funds", "shareholdersFunds")
    + `</tbody></table><p>Dormant throughout the period: ${tag(get("dormantStatus")!)}</p>`
    + stmt("auditExemptStatement") + stmt("membersNoAuditStatement") + stmt("directorsResponsibilitiesStatement") + stmt("smallCompaniesRegimeStatement")
    + `<p>Average number of employees: ${tag(get("averageEmployees")!)}</p><p>Approved by the board on ${tag(get("dateAuthorisation")!)} and signed on its behalf by ${tag(get("directorSigning")!)}, Director.</p></body></html>`;
  return { ok: true, problems: [], html, facts };
}

// ------------------------------------------------------------------ reading a document back

export type ReadFact = { concept: string; contextRef: string; unitRef: string; period: Period | null; value: string; unit: string | null; node: XNode };
export type Read = { root: XNode; facts: ReadFact[]; contexts: Map<string, Period>; units: Map<string, string>; schemaRefs: string[]; entity: Map<string, { scheme: string; id: string }> };
const isIx = (n: XNode, local: string) => n.local === local && resolveNs(n, n.prefix) === STANDARD_NS.ix;
const isX = (n: XNode, local: string) => n.local === local && resolveNs(n, n.prefix) === STANDARD_NS.xbrli;
export function readDocument(html: string): Read {
  const root = parseXml(html);
  const contexts = new Map<string, Period>(), units = new Map<string, string>(), entity = new Map<string, { scheme: string; id: string }>();
  for (const c of descendants(root, (n) => isX(n, "context"))) {
    const inst = descendants(c, (n) => isX(n, "instant"))[0], s = descendants(c, (n) => isX(n, "startDate"))[0], e = descendants(c, (n) => isX(n, "endDate"))[0], idn = descendants(c, (n) => isX(n, "identifier"))[0];
    if (inst) contexts.set(c.attrs.id, { kind: "instant", date: textOf(inst).trim() }); else if (s && e) contexts.set(c.attrs.id, { kind: "duration", start: textOf(s).trim(), end: textOf(e).trim() });
    if (idn) entity.set(c.attrs.id, { scheme: idn.attrs.scheme, id: textOf(idn).trim() });
  }
  for (const u of descendants(root, (n) => isX(n, "unit"))) units.set(u.attrs.id, descendants(u, (n) => isX(n, "measure")).map(textOf).join(",").trim());
  const schemaRefs = descendants(root, (n) => n.local === "schemaRef" && n.prefix === "link").map((n) => n.attrs["xlink:href"] || "");
  const facts: ReadFact[] = descendants(root, (n) => isIx(n, "nonFraction") || isIx(n, "nonNumeric")).map((n) => {
    const raw = textOf(n).trim();
    return { concept: n.attrs.name || "", contextRef: n.attrs.contextRef || "", unitRef: n.attrs.unitRef || "", period: contexts.get(n.attrs.contextRef) || null, value: (n.attrs.sign === "-" ? "-" : "") + raw, unit: n.attrs.unitRef ? units.get(n.attrs.unitRef) || null : null, node: n };
  });
  return { root, facts, contexts, units, schemaRefs, entity };
}

// ------------------------------------------------------------------ internal checks (levels 2 and 3, our own consistency; not taxonomy validation)

const isoOk = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
export function checkDocument(html: string, map: TaxonomyMapping): Issue[] {
  const out: Issue[] = []; const add = (id: string, message: string) => out.push({ id, severity: "error", field: "ixbrl", message });
  let r: Read;
  try { r = readDocument(html); } catch (e) { return [{ id: "xml", severity: "error", field: "ixbrl", message: `The document isn't well-formed XML: ${e instanceof XmlError ? e.message : String(e)}.` }]; }
  if (resolveNs(r.root, r.root.prefix) !== STANDARD_NS.xhtml || r.root.local !== "html") add("root", "The root element must be an XHTML html element.");
  if (!r.schemaRefs.length) add("schemaref", "There is no taxonomy schema reference (link:schemaRef)."); else if (map.entryPoint && !r.schemaRefs.includes(map.entryPoint)) add("entrypoint", "The schema reference isn't the mapping's entry point.");
  const ids = new Set<string>();
  for (const c of descendants(r.root, (n) => isX(n, "context"))) { if (ids.has(c.attrs.id)) add("ctx-dup", `Context ${c.attrs.id} is defined twice.`); ids.add(c.attrs.id); }
  for (const [id, p] of r.contexts) {
    if (p.kind === "instant" ? !isoOk(p.date) : !isoOk(p.start) || !isoOk(p.end) || p.start > p.end) add("ctx-date", `Context ${id} has an invalid date.`);
    const e = r.entity.get(id); if (!e || e.scheme !== map.identifierScheme) add("ctx-entity", `Context ${id} doesn't use the Companies House identifier scheme.`);
  }
  const used = new Set<string>(), usedUnits = new Set<string>(); const seen = new Map<string, string>();
  for (const f of r.facts) {
    const prefix = f.concept.split(":")[0];
    if (!f.concept.includes(":") || !resolveNs(f.node, prefix)) add("fact-ns", `Fact ${f.concept || "(no name)"} uses an undeclared namespace.`);
    const def = map.concepts.find((c) => c.concept === f.concept);
    if (!def) add("fact-unmapped", `Fact ${f.concept} isn't in the mapping.`);
    if (!r.contexts.has(f.contextRef)) add("fact-ctx", `Fact ${f.concept} refers to a context (${f.contextRef}) that doesn't exist.`); else used.add(f.contextRef);
    if (def?.type === "monetary" || def?.type === "integer") {
      if (!f.unitRef || !r.units.has(f.unitRef)) add("fact-unit", `Fact ${f.concept} has no valid unit.`); else usedUnits.add(f.unitRef);
      if (def.type === "monetary" && f.unit !== "iso4217:GBP") add("fact-currency", `Fact ${f.concept} must be in GBP.`);
      if (!/^-?\d+(\.\d+)?$/.test(f.value)) add("fact-number", `Fact ${f.concept} isn't a plain number ("${f.value}").`);
      if (f.node.attrs.decimals === undefined) add("fact-decimals", `Fact ${f.concept} has no decimals attribute.`);
    }
    if (def && (def.context.startsWith("instant") ? f.period?.kind !== "instant" : f.period?.kind !== "duration")) add("fact-period", `Fact ${f.concept} is in the wrong kind of period.`);
    const k = `${f.concept}|${f.contextRef}`; if (seen.has(k) && seen.get(k) !== f.value) add("fact-conflict", `${f.concept} has two different values in the same context.`); seen.set(k, f.value);
  }
  for (const id of r.contexts.keys()) if (!used.has(id)) add("ctx-unused", `Context ${id} is not used by any fact.`);
  for (const u of r.units.keys()) if (!usedUnits.has(u)) add("unit-unused", `Unit ${u} is not used by any fact.`);
  for (const c of map.concepts.filter((x) => x.required && x.concept)) if (!r.facts.some((f) => f.concept === c.concept)) add("missing", `The required fact ${c.concept} is not in the document.`);
  return out;
}

// ------------------------------------------------------------------ reconciliation with the model

/** Every tagged fact must equal what the model says, every fact the model supplies must be tagged, and no amount may appear in the statements untagged. */
export function reconcile(html: string, m: AccountsModel, map: TaxonomyMapping): Issue[] {
  const out: Issue[] = []; const add = (id: string, message: string) => out.push({ id, severity: "error", field: "ixbrl", message });
  let r: Read; try { r = readDocument(html); } catch (e) { return [{ id: "xml", severity: "error", field: "ixbrl", message: `The document can't be read: ${String(e)}` }]; }
  const want = expectedFacts(m, map);
  const key = (concept: string, p: Period | null) => `${concept}|${p ? pkey(p) : "?"}`;
  const got = new Map(r.facts.map((f) => [key(f.concept, f.period), f.value]));
  for (const w of want) { const g = got.get(key(w.concept, w.period)); if (g === undefined) add("recon-missing", `${w.concept} for ${pkey(w.period)} is in the accounts but not tagged in the document.`); else if (g !== w.value) add("recon-diff", `${w.concept} for ${pkey(w.period)}: the document says ${g} but the accounts say ${w.value}.`); }
  const wantKeys = new Set(want.map((w) => key(w.concept, w.period)));
  for (const f of r.facts) if (!wantKeys.has(key(f.concept, f.period))) add("recon-extra", `${f.concept} is tagged in the document but isn't in the accounts.`);
  // untagged amounts in the body (outside the hidden header and outside any fact)
  const body = descendants(r.root, (n) => n.local === "body")[0];
  const scan = (n: XNode) => { for (const c of n.children) { if (typeof c === "string") { if (/\d+\.\d{2}\b/.test(c)) add("recon-untagged", `An amount ("${c.trim().slice(0, 20)}") appears in the document without being tagged.`); } else if (!isIx(c, "nonFraction") && !isIx(c, "nonNumeric") && !isIx(c, "header") && c.attrs.style !== "display:none") scan(c); } };
  if (body) scan(body);
  return out;
}
