"use strict";
// Builds the SA100 (2025-26) message body, IRenvelope, from the planner's return, laid out to HMRC's published MTR schema
// (api/filing/rim/sa100-2025-26). It covers only what is listed in SUPPORTED; anything else the return holds is reported in
// `unsupported` and the build is refused, so a partial return is never produced as if it were complete.
// The GovTalk message class and keys are NOT in HMRC's RIM pack, so this is not registered as an adapter yet (see govtalk.js).

const NS = "http://www.govtalk.gov.uk/taxation/SA/SA100/25-26/1";
const SUPPORTED = ["Personal details (DOB, NINO, UTR, region)", "Self-employment (SA103S: income, expense boxes 11-19, capital allowances, CIS, losses)", "SA110 totals from the planner's calculation"];
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const m = (n) => Number(n).toFixed(2);
const pos = (n) => (Number(n) > 0.004 ? Number(n) : 0);
const el = (name, v) => (v === undefined || v === null || v === "" ? "" : `<${name}>${esc(v)}</${name}>`);
const money = (name, v) => (pos(v) ? `<${name}>${m(v)}</${name}>` : "");
const SHORT_FORM_LIMIT = 90000;

/** Which parts of the return this builder cannot yet put into the XML. */
function unsupported(r) {
  const u = [];
  if (r.employments?.length) u.push("Employment (SA102)");
  if (r.partnerships?.length) u.push("Partnerships (SA104)");
  if (r.interest?.length || r.dividends?.length || r.otherDividends) u.push("Interest and dividends (SA100 Income pages)");
  if (r.property) u.push("UK property (SA105)");
  if (r.pensions || r.benefits || r.otherIncome) u.push("Pensions, benefits and other income");
  if (r.foreign) u.push("Foreign income (SA106)");
  if (r.gains?.length) u.push("Capital gains (SA108)");
  if (Object.values(r.reliefs || {}).some((v) => v)) u.push("Tax reliefs");
  if (r.studentLoan?.plans?.length || r.studentLoan?.postgrad) u.push("Student loan");
  if (r.childBenefit?.amount) u.push("High Income Child Benefit Charge");
  if (r.allowances?.marriage && r.allowances.marriage !== "none") u.push("Marriage Allowance");
  for (const s of r.selfEmployments || []) if (Number(s.turnover) > SHORT_FORM_LIMIT) u.push(`Self-employment "${s.name}" turnover is over £${SHORT_FORM_LIMIT.toLocaleString("en-GB")}: needs the full SA103F`);
  return u;
}

const BOX_TAG = { "11": "CostOfGoods", "12": "CarVanAndTravelExpenses", "13": "WagesSalariesAndStaffCosts", "14": "RentAndOtherPropertyCosts", "15": "RepairsAndMaintenanceCosts", "16": "AccountancyAndLegalFees", "17": "InterestAndFinanceCharges", "18": "PhoneAndOtherOfficeCosts", "19": "OtherAllowableBusinessExpenses" };

function sa103s(s) {
  const boxes = {};
  for (const x of s.expenseItems || []) { const b = x.box || "19"; boxes[b] = (boxes[b] || 0) + (Number(x.amount) || 0) - (Number(x.disallowable) || 0); }
  if (!(s.expenseItems || []).length && pos(s.expenses)) boxes["19"] = Number(s.expenses) - (Number(s.disallowable) || 0);
  const total = Object.values(boxes).reduce((a, b) => a + b, 0);
  const net = (Number(s.turnover) || 0) + (Number(s.otherIncome) || 0) - total;
  const started = !!s.start, ceased = !!s.end;
  const profit = net - (Number(s.capitalAllowances) || 0) + (Number(s.balancingCharges) || 0) - (Number(s.lossesBf) || 0);
  return "<SA103S>" +
    "<BusinessDetails>" + el("BusinessDescription", (s.description || s.name || "").slice(0, 40)) + `<DidYourBusinessStart>${started ? "yes" : "no"}</DidYourBusinessStart>` + (started ? el("DateBusinessStarted", s.start) : "") +
    `<DidYourBusinessCease>${ceased ? "yes" : "no"}</DidYourBusinessCease>` + (ceased ? el("DateBusinessCeased", s.end) : "") + "</BusinessDetails>" +
    "<BusinessIncome>" + money("Turnover", s.turnover) + money("OtherBusinessIncome", s.otherIncome) + "</BusinessIncome>" +
    "<AllowableBusinessExpenses>" + Object.keys(BOX_TAG).map((b) => (boxes[b] ? `<${BOX_TAG[b]}>${m(boxes[b])}</${BOX_TAG[b]}>` : "")).join("") + (total ? `<TotalAllowableExpenses>${m(total)}</TotalAllowableExpenses>` : "") + "</AllowableBusinessExpenses>" +
    `<NetProfitOrLoss>${m(net)}</NetProfitOrLoss>` +
    (pos(s.capitalAllowances) || pos(s.balancingCharges) ? "<CapitalAllowances>" + money("OtherCapitalAllowances", s.capitalAllowances) + money("TotalBalancingCharges", s.balancingCharges) + "</CapitalAllowances>" : "") +
    "<TaxableProfits>" + money("NetBusinessProfitForTax", profit) + money("LossBroughtForward", s.lossesBf) + "</TaxableProfits>" +
    "<ProfitsLossesNICsAndCIS>" + (profit >= 0 ? `<TotalTaxableBusinessProfits>${m(profit)}</TotalTaxableBusinessProfits>` : `<NetBusinessLossForTax>${m(-profit)}</NetBusinessLossForTax>`) + money("SubContractorsTaxDeduction", s.cis) + "</ProfitsLossesNICsAndCIS>" +
    "</SA103S>";
}

/**
 * r: the planner's TaxReturn. ctx: { periodEnd "2026-04-05", sender "Individual"|"Agent", totals: { totalTaxEtcDue, class4, class2, cgt, studentLoan, postgrad } }
 * Returns { xml, unsupported:[..], supported:[..] }. xml is "" when anything is unsupported.
 */
function build(r, ctx) {
  const un = unsupported(r);
  if (un.length) return { xml: "", unsupported: un, supported: SUPPORTED };
  const f = r.front || {};
  const status = f.region === "scotland" ? "S" : f.region === "wales" ? "C" : "U";
  const t = ctx.totals || {};
  const agent = ctx.sender === "Agent";
  const body =
    `<IRenvelope xmlns="${NS}"><IRheader><Keys><Key Type="UTR">${esc(f.utr || "")}</Key></Keys><PeriodEnd>${esc(ctx.periodEnd)}</PeriodEnd><DefaultCurrency>GBP</DefaultCurrency><Sender>${agent ? "Agent" : "Individual"}</Sender></IRheader>` +
    "<MTR><SA100><YourPersonalDetails>" + el("DateOfBirth", f.dob) + el("NationalInsuranceNumber", f.nino) + `<TaxpayerStatus>${status}</TaxpayerStatus></YourPersonalDetails></SA100>` +
    (r.selfEmployments || []).map(sa103s).join("") +
    "<SA110><SelfAssessment>" + `<TotalTaxEtcDue>${m(t.totalTaxEtcDue || 0)}</TotalTaxEtcDue>` + money("Class4NICsDue", t.class4) + money("Class2NICsDue", t.class2) + "</SelfAssessment><UnderpaidTax/></SA110>" +
    `<Declaration>${agent ? "<AgentDeclaration>yes</AgentDeclaration>" : "<IndividualDeclaration>yes</IndividualDeclaration>"}</Declaration></MTR></IRenvelope>`;
  return { xml: body, unsupported: [], supported: SUPPORTED };
}

module.exports = { build, unsupported, NS, SUPPORTED, SHORT_FORM_LIMIT };
