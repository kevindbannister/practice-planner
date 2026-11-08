// Figures for ACCA's annual AML return that the planner can supply, shown beside each question so the person can check and use them.
// Only what the planner really holds is offered: nothing is guessed, and a figure the planner can't know (revenue, reports made to the
// NCA, clients in each risk sector) is left for the person. The return is completed on ACCA's own site.
import { position } from "./amlAssessment";
import { Answers } from "./amlBuilder";
import { Row } from "./schema";

export type Live = Record<string, { value: string | string[]; from: string }>;
export type LiveCtx = {
  clients: Row[]; clientServices: Row[]; services: Row[]; amlAssessments: Row[]; onboardings: Row[]; today: string;
  policy: Answers; policyVersions: number; fwraVersions: number; trainingTwoYears: string;
};
const s = (v: unknown) => (v === undefined || v === null ? "" : String(v));
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v ? [String(v)] : []);

export function returnLive(c: LiveCtx): Live {
  const out: Live = {};
  const set = (k: string, value: string | string[], from: string) => { if (Array.isArray(value) ? value.length : value !== "") out[k] = { value, from }; };
  const yearAgo = `${Number(c.today.slice(0, 4)) - 1}${c.today.slice(4)}`;
  const active = c.clients.filter((x) => !x.CeasedOn);
  const served = c.clients.filter((x) => !x.CeasedOn || s(x.CeasedOn) >= yearAgo);
  set("clients12", String(served.length), "clients in the planner, including any who left in the last 12 months");

  let high = 0, low = 0, rated = 0;
  for (const cl of active) { const r = position(cl, c.amlAssessments, c.onboardings, c.today).risk; if (r) rated++; if (r === "high") high++; if (r === "low") low++; }
  if (rated) {
    set("highPct", `${Math.round((high / rated) * 100)}%`, `${rated} of ${active.length} active clients have an approved risk rating`);
    set("lowPct", `${Math.round((low / rated) * 100)}%`, `${rated} of ${active.length} active clients have an approved risk rating`);
    set("categorise", "Yes", "clients have approved risk ratings");
  }

  const titleOf = (key: string) => s(c.services.find((x) => x.Key === key)?.Title).toLowerCase();
  const count = (re: RegExp) => new Set(c.clientServices.filter((x) => !x.EndedOn && !x.Off && re.test(titleOf(s(x.ServiceKey)))).map((x) => s(x.ClientKey))).size;
  const payroll = count(/payroll/), form = count(/formation|incorporat/), reg = count(/registered office/);
  set("payroll", String(payroll), "active payroll services in the planner (the return asks for the past two years)");
  set("formN", String(form), "active company formation services (the return asks for the past two years)");
  set("regN", String(reg), "active registered office services (the return asks for the past two years)");

  const svcs = arr(c.policy.services);
  if (svcs.length) {
    set("form", svcs.includes("formation") || form ? "Yes" : "No", "the services you chose in the policy builder");
    set("reg", svcs.includes("registered") || reg ? "Yes" : "No", "the services you chose in the policy builder");
  }
  const tcsp = arr(c.policy.tcspWhich);
  if (tcsp.length) {
    set("dir", tcsp.includes("director") ? "Yes" : "No", "company and trust services step in the policy builder");
    set("trustee", tcsp.includes("trustee") ? "Yes" : "No", "company and trust services step in the policy builder");
    set("trustf", tcsp.includes("trustee") ? "Yes" : "No", "company and trust services step in the policy builder");
  }
  if (c.policy.clientMoney === "some") set("money", "Yes", "your answer in the policy builder"); else if (c.policy.clientMoney === "none") set("money", "No", "your answer in the policy builder");

  const per = (n: number) => (n >= 2 ? "Yes, updated periodically" : n === 1 ? "Yes, conducted once" : "");
  set("fwra", per(c.fwraVersions), `${c.fwraVersions} saved version${c.fwraVersions === 1 ? "" : "s"} of the risk assessment`);
  set("pol", per(c.policyVersions), `${c.policyVersions} saved version${c.policyVersions === 1 ? "" : "s"} of the policy`);
  if (c.policy.portal === "yes") set("portal", "Yes", "your answer in the policy builder");
  if (c.policy.portal === "no") set("portal", "No", "your answer in the policy builder");
  if (c.trainingTwoYears === "Yes" || c.trainingTwoYears === "No") set("mlroTrain", c.trainingTwoYears, "the training record");
  if (c.policy.formWhere) set("reporting", "Yes", "the policy builder's suspicious activity step");

  const ob: string[] = [];
  const id = arr(c.policy.idDocs), ent = arr(c.policy.entity), edd = arr(c.policy.edd);
  if (id.length) ob.push("Proof of identification");
  if (arr(c.policy.address).length) ob.push("Proof of address");
  if (edd.includes("sof")) ob.push("Source of wealth and/or source of funds");
  if (ent.includes("owners")) ob.push("Company structure");
  if (ent.includes("psc")) ob.push("PSC Register check");
  if (id.includes("electronic")) ob.push("Electronic verification");
  if (id.length) ob.push("Adverse media checks");
  set("onboard", ob, "the due diligence step in the policy builder");

  if (c.policy.mHigh && c.policy.mMed) set("monitor", s(c.policy.mHigh) === s(c.policy.mMed) ? (Number(c.policy.mHigh) <= 12 ? "6-12 months" : "1-2 years") : "Varies by risk", `reviews every ${s(c.policy.mHigh)} months for high risk and every ${s(c.policy.mMed)} for medium`);
  if (c.policy.independent || c.policy.extraReview) set("independent", c.policy.independent || c.policy.extraReview === "yes" ? "Yes" : "No", "the MLRO report and independent review step in the policy builder");
  return out;
}
