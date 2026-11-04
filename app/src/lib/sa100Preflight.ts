// What the planner can check about an SA100 return before it goes anywhere, and which parts of the SA100 pack it covers. These are the
// planner's own checks. They are NOT HMRC's schema or business-rule validation, which needs HMRC's official RIM artefacts for the year
// (not yet available here), so a return that passes these is not shown as validated against HMRC's rules.
import { TaxReturn } from "./tax";
import { Validation } from "./hmrcFiling";

const NINO = /^(?!BG|GB|KN|NK|NT|TN|ZZ)[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z]\d{6}[A-D]$/;
export const SCHEMA_LABEL = "Practice Planner checks (not HMRC's own validation)";

/** The checks that can be made from the return itself. Errors stop it being validated; warnings are shown but don't. */
export function preflight(r: TaxReturn, year: number, at: string, payloadHash: string, extra: { codivs?: number } = {}): Validation {
  const errors: string[] = [], warnings: string[] = [];
  const utr = String(r.front.utr || "").replace(/\s/g, "");
  if (!/^\d{10}$/.test(utr)) errors.push("The taxpayer's UTR must be 10 digits.");
  const nino = String(r.front.nino || "").replace(/\s/g, "").toUpperCase();
  if (!NINO.test(nino)) errors.push("The National Insurance number isn't in a valid form.");
  if (!r.front.dob || !/^\d{4}-\d{2}-\d{2}$/.test(r.front.dob)) errors.push("The date of birth is missing.");
  if (!(year >= 2020 && year <= 2100)) errors.push("The tax year isn't one the planner can file.");
  r.employments.forEach((e, i) => { if (!String(e.name || "").trim()) warnings.push(`Employment ${i + 1} has no employer name.`); });
  r.selfEmployments.forEach((s, i) => {
    const who = s.name || `Self-employment ${i + 1}`;
    if (!String(s.name || "").trim()) errors.push(`Self-employment ${i + 1} has no business name.`);
    if (!s.tradingAllowance && s.expenses > 0 && !(s.expenseItems || []).length) warnings.push(`${who}: the expenses aren't split across the SA103 boxes.`);
  });
  r.dividends.forEach((d, i) => { if (!String(d.company || "").trim() && d.amount) errors.push(`Dividend ${i + 1} has an amount but no company.`); });
  if (extra.codivs) warnings.push(`${extra.codivs} dividend${extra.codivs === 1 ? "" : "s"} from Company Secretarial haven't been brought into the return.`);
  return { at, payloadHash, schema: SCHEMA_LABEL, errors, warnings };
}

export type PageCover = { page: string; name: string; support: "modelled" | "partly" | "none"; used: boolean; note: string };
/** The SA100 pages against what the planner holds. "Used" is whether this return has anything that belongs on the page. Not checked against HMRC's RIM. */
export function coverage(r: TaxReturn): PageCover[] {
  const has = (...xs: unknown[]) => xs.some((x) => (Array.isArray(x) ? x.length > 0 : !!x));
  return [
    { page: "SA100", name: "Main return", support: "modelled", used: true, note: "Taxpayer details, interest, dividends, pensions, benefits, reliefs, allowances, student loan, Child Benefit charge, payments." },
    { page: "SA101", name: "Additional information", support: "none", used: false, note: "Not in the planner. Anything that belongs here has to be entered another way." },
    { page: "SA102", name: "Employment", support: "modelled", used: has(r.employments), note: "" },
    { page: "SA103", name: "Self-employment", support: "partly", used: has(r.selfEmployments), note: "One layout for the short and full forms; the SA103S and SA103F choice isn't made." },
    { page: "SA104", name: "Partnership", support: "partly", used: has(r.partnerships), note: "The partner's share is held. The partnership's own return (SA800) isn't in the planner yet." },
    { page: "SA105", name: "UK property", support: "modelled", used: has(r.property), note: "" },
    { page: "SA106", name: "Foreign", support: "partly", used: has(r.foreign), note: "" },
    { page: "SA107", name: "Trusts etc.", support: "none", used: false, note: "Not in the planner." },
    { page: "SA108", name: "Capital gains summary", support: "modelled", used: has(r.gains), note: "" },
    { page: "SA109", name: "Residence, remittance basis etc.", support: "none", used: false, note: "Not in the planner; the FIG regime and Overseas Workday Relief aren't worked out." },
    { page: "SA110", name: "Tax calculation summary", support: "modelled", used: true, note: "Worked out by the planner, not sent as a separate form." },
  ];
}

/**
 * The return as it is filed, written the same way every time (keys in order), for the version hash. The status, where it was brought
 * in from and the payments aren't part of what HMRC receives, so changing them doesn't change the version the client approved.
 */
export function payloadText(r: TaxReturn): string {
  const { status: _s, imported: _i, broughtForward: _b, payments: _p, ...rest } = r as TaxReturn & Record<string, unknown>;
  const sort = (v: unknown): unknown => Array.isArray(v) ? v.map(sort) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])])) : v;
  return JSON.stringify(sort(rest));
}
