import test from "node:test";
import assert from "node:assert/strict";
import * as D from "../src/lib/cosecDormant.ts";
import { buildDormantModel } from "../src/lib/accounts/model.ts";
import { validateModel } from "../src/lib/accounts/validate.ts";
import { DORMANT_2025, MODEL_FIELDS, STANDARD_NS, TaxonomyMapping, mappingProblems } from "../src/lib/accounts/taxonomy.ts";
import { checkDocument, generate, penceText, readDocument, reconcile } from "../src/lib/accounts/ixbrl.ts";
import { parseXml } from "../src/lib/accounts/xml.ts";
import { readEntry } from "../src/lib/shareLedger.ts";

// A mapping that exists ONLY to test the engine. Its concepts and namespace are invented and are not a real taxonomy; it can never be reached from the app.
const T: TaxonomyMapping = {
  id: "engine-test-only", version: "test", accountsType: "dormant", entryPoint: "urn:test-only:entry.xsd", namespaces: { t: "urn:test-only", ...STANDARD_NS }, identifierScheme: "urn:test-scheme", status: "verified", note: "",
  concepts: MODEL_FIELDS.map((f) => ({ field: f, concept: `t:${f}`, status: "verified" as const, source: "test", required: true,
    type: (["calledUpNotPaid", "cash", "netAssets", "shareCapital", "profitAndLoss", "shareholdersFunds"].includes(f) ? "monetary" : f === "averageEmployees" ? "integer" : ["balanceSheetDate", "periodStart", "periodEnd", "dateAuthorisation"].includes(f) ? "date" : f === "dormantStatus" ? "boolean" : "string") as any,
    context: (["periodStart", "periodEnd", "dormantStatus", "averageEmployees", "profitAndLoss", "entityName", "companyNumber"].includes(f) || f.endsWith("Statement") ? "duration-current" : "instant-current") as any,
    unit: (["calledUpNotPaid", "cash", "netAssets", "shareCapital", "profitAndLoss", "shareholdersFunds"].includes(f) ? "GBP" : f === "averageEmployees" ? "pure" : null) as any })),
};
const e = (o: any = {}) => readEntry({ Key: "1", ClientKey: "C1", Status: "active", Created: "1", Class: "Ordinary", Type: "allotment", EffectiveDate: "2024-03-10", Number: 100, Nominal: 1, PaidPerShare: 1, ...o });
const classes: any[] = [{ ClientKey: "C1", Name: "Ordinary", NominalValue: 1 }];
const fig = (asAt: string) => D.figuresAt([e()], "C1", asAt, classes);
const model = (o: any = {}) => buildDormantModel({ company: { name: "Test & Co Ltd", number: "01234567" }, period: { start: "2025-04-01", end: "2026-03-31", incorporated: "2024-03-10" }, fig: fig("2026-03-31"), prior: fig("2025-03-31"), director: "Ann Able", approvedOn: "2026-06-01", confirmedBy: "K", confirmedAll: true, ...o });
const make = (m = model()) => { const g = generate(m, T, validateModel(m)); assert.deepEqual(g.problems, []); return g.html!; };
const ids = (i: any[]) => i.map((x) => x.id);

test("the production mapping is a draft and refuses to generate, saying what is missing", () => {
  const p = mappingProblems(DORMANT_2025);
  assert.ok(p.some((x) => /entry point/.test(x))); assert.ok(p.some((x) => /namespace for "core"/.test(x))); assert.ok(p.some((x) => /No taxonomy concept for "netAssets"/.test(x)));
  const g = generate(model(), DORMANT_2025, validateModel(model())); assert.equal(g.ok, false); assert.equal(g.html, undefined); assert.ok(g.problems.length > 5);
  assert.ok(DORMANT_2025.concepts.filter((c) => c.concept).every((c) => c.status === "named"), "nothing is marked verified yet");
});
test("a model that fails validation produces no document", () => {
  const m = model(); m.current.cash += 1; const g = generate(m, T, validateModel(m)); assert.equal(g.ok, false); assert.ok(g.problems[0].includes("net assets"));
});
test("a generated document is well-formed, passes the internal checks and reconciles with the model", () => {
  const html = make(); const m = model();
  assert.deepEqual(checkDocument(html, T), []); assert.deepEqual(reconcile(html, m, T), []);
  const r = readDocument(html);
  assert.equal(r.schemaRefs[0], "urn:test-only:entry.xsd");
  assert.deepEqual([...r.units.values()].sort(), ["iso4217:GBP", "xbrli:pure"]);
  assert.ok(html.includes("Test &amp; Co Ltd"), "text is escaped");
});
test("contexts: current and comparative instants, one duration, entity identifier is the company number", () => {
  const r = readDocument(make());
  const ps = [...r.contexts.values()].map((p) => (p.kind === "instant" ? `i:${p.date}` : `d:${p.start}/${p.end}`)).sort();
  assert.deepEqual(ps, ["d:2025-04-01/2026-03-31", "i:2025-03-31", "i:2026-03-31"]);
  assert.ok([...r.entity.values()].every((x) => x.id === "01234567" && x.scheme === "urn:test-scheme"));
  const cash = r.facts.filter((f) => f.concept === "t:cash"); assert.deepEqual(cash.map((f) => f.value).sort(), ["100.00", "100.00"]);
});
test("a first period has no comparative context", () => {
  const m = model({ period: { start: "2024-03-10", end: "2025-03-31", incorporated: "2024-03-10" }, fig: fig("2025-03-31"), prior: null });
  const r = readDocument(make(m)); assert.equal(r.contexts.size, 2);
});
test("money is exact: pence to text", () => { assert.equal(penceText(5), "0.05"); assert.equal(penceText(123456789), "1234567.89"); assert.equal(penceText(-250), "-2.50"); });

test("reconciliation catches a changed figure, a removed fact and an untagged amount", () => {
  const html = make(), m = model();
  assert.ok(ids(reconcile(html.replace(/(<ix:nonFraction name="t:netAssets"[^>]*>)100\.00/, "$199.99"), m, T)).includes("recon-diff"));
  assert.ok(ids(reconcile(html.replace(/<ix:nonFraction name="t:cash"[^>]*>100\.00<\/ix:nonFraction>/, ""), m, T)).includes("recon-missing"));
  assert.ok(ids(reconcile(html.replace("<h1>", "<p>Total 100.00</p><h1>"), m, T)).includes("recon-untagged"));
  assert.ok(ids(reconcile(html.replace("</tbody>", `<tr><td>x</td><td><ix:nonFraction name="t:cash" contextRef="c1" unitRef="GBP" decimals="2">5.00</ix:nonFraction></td></tr></tbody>`), m, T)).length > 0);
});
test("internal checks catch broken references, units, undeclared prefixes and unused resources", () => {
  const html = make();
  assert.ok(ids(checkDocument(html.replace(/contextRef="c1"/, 'contextRef="zz"'), T)).includes("fact-ctx"));
  assert.ok(ids(checkDocument(html.replace(/unitRef="GBP"/, 'unitRef="USD"'), T)).includes("fact-unit"));
  assert.ok(ids(checkDocument(html.replace(/<ix:nonNumeric name="t:/, '<ix:nonNumeric name="q:'), T)).includes("fact-ns"));
  assert.ok(ids(checkDocument(html.replace("</xbrli:unit>", "</xbrli:unit><xbrli:unit id=\"X\"><xbrli:measure>xbrli:pure</xbrli:measure></xbrli:unit>"), T)).includes("unit-unused"));
  assert.ok(ids(checkDocument(html.replace(/<link:schemaRef[^>]*\/>/, ""), T)).includes("schemaref"));
  assert.ok(ids(checkDocument(html.replace(/(<xbrli:instant>)2026-03-31/, "$12026-13-45"), T)).includes("ctx-date"));
  assert.ok(ids(checkDocument(html.replace('scheme="urn:test-scheme"', 'scheme="urn:other"'), T)).includes("ctx-entity"));
  assert.ok(ids(checkDocument(html.replace(/decimals="2"/, ""), T)).includes("fact-decimals"));
});
test("the XML reader rejects what could be dangerous or broken", () => {
  assert.throws(() => parseXml('<!DOCTYPE a [<!ENTITY x "y">]><a/>'), /DOCTYPE/);
  assert.throws(() => parseXml("<a><b></a>"), /doesn't match/);
  assert.throws(() => parseXml("<a><b/>"), /never closed/);
  assert.throws(() => parseXml("<a/><b/>"), /More than one root/);
  assert.throws(() => parseXml('<a x="1" x="2"/>'), /Duplicate attribute/);
  assert.throws(() => parseXml("<p:a/>"), /not declared/);
  assert.throws(() => parseXml("<a>&bogus;</a>"), /Unknown entity/);
  assert.equal(parseXml('<a xmlns:p="u"><p:b>1 &amp; 2</p:b></a>').children.length, 1);
  assert.deepEqual(ids(checkDocument("<html><body></html>", T)), ["xml"]);
});
