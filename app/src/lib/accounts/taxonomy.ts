// The central mapping between the app's accounts fields and taxonomy concepts. Nothing else in the app contains a taxonomy concept name.
//
// RULE: a mapping may only be used to produce a filing document when it is `status: "verified"`, which means every concept, namespace and the entry
// point were read from the published FRC taxonomy / Companies House instructions and checked against the entry-point schema. A concept written down from
// a guide but not yet checked against the schema is "named" and still blocks filing. A field with `concept: null` has not been found yet.
// Until then `generate()` refuses and says exactly what is missing; it never guesses.
export type DataType = "monetary" | "date" | "string" | "integer" | "boolean";
export type ContextKind = "instant-current" | "instant-prior" | "duration-current" | "duration-prior";
export type ConceptStatus = "missing" | "named" | "verified";
export type Concept = {
  field: string;                 // internal accounts field id (see MODEL_FIELDS)
  concept: string | null;        // e.g. "core:ProfitLoss" (prefix must be in `namespaces`)
  type: DataType;
  context: ContextKind;
  unit: "GBP" | "pure" | null;   // monetary -> GBP, integer counts -> pure
  required: boolean;             // must be present for a dormant filing
  invert?: boolean;              // report with the opposite sign to the model
  status: ConceptStatus;
  source: string;                // where the concept came from
};
export type TaxonomyMapping = {
  id: string; version: string; accountsType: "dormant";
  entryPoint: string | null;     // schemaRef URL
  namespaces: Record<string, string | null>;   // prefix -> URI (null = not yet obtained)
  identifierScheme: string;
  concepts: Concept[];
  status: "draft" | "verified";
  note: string;
};

/** Namespaces defined by the XBRL and Inline XBRL standards themselves, safe to hard-code. */
export const STANDARD_NS = {
  xhtml: "http://www.w3.org/1999/xhtml", ix: "http://www.xbrl.org/2013/inlineXBRL", xbrli: "http://www.xbrl.org/2003/instance",
  link: "http://www.xbrl.org/2003/linkbase", xlink: "http://www.w3.org/1999/xlink", iso4217: "http://www.xbrl.org/2003/iso4217",
} as const;

/** The fields the dormant model can supply. A mapping lists a concept for each it files. */
export const MODEL_FIELDS = [
  "entityName", "companyNumber", "balanceSheetDate", "periodStart", "periodEnd", "dormantStatus",
  "calledUpNotPaid", "cash", "netAssets", "shareCapital", "profitAndLoss", "shareholdersFunds", "averageEmployees",
  "dateAuthorisation", "directorSigning", "auditExemptStatement", "membersNoAuditStatement", "directorsResponsibilitiesStatement", "smallCompaniesRegimeStatement",
] as const;
export type ModelField = (typeof MODEL_FIELDS)[number];

const GUIDE = "FRC UKSEF 2025 Tagging Guide v2.1 (frc.org.uk/docs/8115): named there, not yet checked against the entry-point schema";
const MISSING = "Not found yet: needs the FRC 2025 taxonomy (or the Companies House accounts TIS)";
const c = (field: ModelField, concept: string | null, type: DataType, context: ContextKind, unit: Concept["unit"], required: boolean, source = concept ? GUIDE : MISSING): Concept =>
  ({ field, concept, type, context, unit, required, status: concept ? "named" : "missing", source });

/** The production mapping for dormant accounts under the 2025 taxonomy suite. DRAFT: it cannot produce a filing until the gaps below are filled and verified. */
export const DORMANT_2025: TaxonomyMapping = {
  id: "dormant-frc-2025", version: "2025-01-01", accountsType: "dormant",
  entryPoint: null,   // The FRS 102 UKSEF pattern is xbrl.frc.org.uk/FRS-102/2025-01-01/UKSEF/..., but the dormant/small-company entry point has not been read from an official source.
  namespaces: { core: null, bus: null, ...STANDARD_NS },
  identifierScheme: "http://www.companieshouse.gov.uk/",   // named in the FRC UKSEF 2025 Tagging Guide for the UKFRS target
  status: "draft",
  note: "Draft. Missing: the entry point; the core and bus namespace URIs; concepts for every balance sheet line, the dormant status and the statements; Companies House's rules on which are mandatory.",
  concepts: [
    c("entityName", null, "string", "duration-current", null, true),
    c("companyNumber", "bus:UKCompaniesHouseRegisteredNumber", "string", "duration-current", null, true),
    c("balanceSheetDate", "bus:BalanceSheetDate", "date", "instant-current", null, true),
    c("periodStart", null, "date", "duration-current", null, true),
    c("periodEnd", null, "date", "duration-current", null, true),
    c("dormantStatus", null, "boolean", "duration-current", null, true),
    c("calledUpNotPaid", null, "monetary", "instant-current", "GBP", false),
    c("cash", null, "monetary", "instant-current", "GBP", false),
    c("netAssets", null, "monetary", "instant-current", "GBP", true),
    c("shareCapital", null, "monetary", "instant-current", "GBP", true),
    c("profitAndLoss", "core:ProfitLoss", "monetary", "duration-current", "GBP", false),
    c("shareholdersFunds", null, "monetary", "instant-current", "GBP", true),
    c("averageEmployees", "core:AverageNumberEmployeesDuringPeriod", "integer", "duration-current", "pure", true),
    c("dateAuthorisation", "core:DateAuthorisationFinancialStatementsForIssue", "date", "instant-current", null, true),
    c("directorSigning", "core:DirectorSigningFinancialStatements", "string", "instant-current", null, true),
    c("auditExemptStatement", null, "string", "duration-current", null, true),
    c("membersNoAuditStatement", null, "string", "duration-current", null, true),
    c("directorsResponsibilitiesStatement", null, "string", "duration-current", null, true),
    c("smallCompaniesRegimeStatement", null, "string", "duration-current", null, true),
  ],
};
export const MAPPINGS: Record<string, TaxonomyMapping> = { [DORMANT_2025.id]: DORMANT_2025 };

/** What stops a mapping being used to make a filing document. Empty means it can. */
export function mappingProblems(m: TaxonomyMapping): string[] {
  const out: string[] = [];
  if (m.status !== "verified") out.push(`The ${m.id} mapping is a draft: ${m.note}`);
  if (!m.entryPoint) out.push("The taxonomy entry point (schemaRef) hasn't been obtained.");
  for (const [p, u] of Object.entries(m.namespaces)) if (!u) out.push(`The namespace for "${p}" hasn't been obtained.`);
  for (const x of m.concepts.filter((x) => x.required)) {
    if (!x.concept) out.push(`No taxonomy concept for "${x.field}" yet.`);
    else if (x.status !== "verified") out.push(`${x.concept} ("${x.field}") is named but not yet checked against the taxonomy schema.`);
    else { const p = x.concept.split(":")[0]; if (!m.namespaces[p]) out.push(`${x.concept} uses the "${p}" namespace, which hasn't been obtained.`); }
  }
  return out;
}
