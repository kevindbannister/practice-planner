"use strict";
// Builds the SA800 (partnership return, 2025-26) body, IRenvelope, laid out to HMRC's published partnership schema
// (api/filing/rim/sa800-2025-26). It covers only what is in SUPPORTED. Anything else the partnership holds is returned in `unsupported`
// and the build is refused, so a partial return is never produced as complete.
// The GovTalk message class and keys are NOT in HMRC's RIM pack, so this is not registered as an adapter yet (see govtalk.js).

const NS = "http://www.govtalk.gov.uk/taxation/SA/SA800/25-26/1";
const SUPPORTED = ["Partnership details and nominated partner", "Trading income on the short route (turnover, expenses, net profit)", "Each partner's share of trade profit or loss, with UTR, NINO and dates", "Declaration"];
const TURNOVER_LIMIT = 90000;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const m = (n) => Number(n).toFixed(2);
const pos = (n) => (Number(n) > 0.004 ? Number(n) : 0);
const el = (name, v) => (v === undefined || v === null || v === "" ? "" : `<${name}>${esc(v)}</${name}>`);
const money = (name, v) => (pos(v) ? `<${name}>${m(v)}</${name}>` : "");
// HMRC allows only letters, digits, space and , . ) ( / & - ' in names and descriptions.
const NAME_OK = /^[A-Za-z0-9 ,.)(/&\-']*$/;

// HMRC rule 8205: the UTR check digit (weights 6,7,8,9,10,5,4,3,2 on digits 2-10; the remainder mod 11 looks up the first digit).
const utrOk = (v) => {
  if (!/^\d{10}$/.test(v) || /^([1-9])\1{9}$/.test(v)) return false;
  const w = [6, 7, 8, 9, 10, 5, 4, 3, 2];
  const tot = w.reduce((a, x, i) => a + x * Number(v[i + 1]), 0);
  return "21987654321"[tot % 11] === v[0];
};

/** What the partnership holds that this builder cannot yet put into the XML, and what is wrong with what it can. */
function problems(p) {
  const bad = [], un = [];
  const utr = String(p.utr || "").replace(/\s/g, "");
  // HMRC rule 6965: 10 digits, and not one digit repeated (1111111111 ... 9999999999).
  if (!utrOk(utr)) bad.push("The partnership UTR isn't valid (10 digits with a correct check digit).");
  if (!String(p.name || "").trim()) bad.push("The partnership has no name.");
  if (!p.periodEnd) bad.push("The accounting period end date is missing.");
  const partners = p.partners || [];
  if (partners.length < 2) bad.push("A partnership return needs at least two partners.");
  if (!String(p.nominatedPartner || "").trim()) bad.push("The nominated partner's name is missing.");
  for (const [i, x] of partners.entries()) {
    const who = x.name || `Partner ${i + 1}`;
    if (!String(x.name || "").trim()) bad.push(`Partner ${i + 1} has no name.`);
    else if (!NAME_OK.test(x.name)) bad.push(`${who}: the name has a character HMRC doesn't accept (only letters, digits, space and , . ) ( / & - ').`);
    if (!utrOk(String(x.utr || "").replace(/\s/g, ""))) bad.push(`${who}: the partner's UTR isn't valid (10 digits with a correct check digit).`);
  }
  const t = p.trade;
  if (t) {
    if (Number(t.turnover) > TURNOVER_LIMIT) un.push(`Trading turnover is over £${TURNOVER_LIMIT.toLocaleString("en-GB")}: needs the full income and expenses route`);
    const net = (Number(t.turnover) || 0) - (Number(t.expenses) || 0);
    const allocated = partners.reduce((a, x) => a + (Number(x.tradeProfit) || 0) - (Number(x.tradeLoss) || 0), 0);
    const taxable = net;
    // HMRC rules 6626/6627: on the short route the tax adjustments are not sent, and the taxable profit is the net profit.
    if (pos(t.capitalAllowances) || pos(t.balancingCharges)) un.push("Capital allowances and balancing charges (they need the full income and expenses route)");
    if (Math.abs(allocated - taxable) > 0.005) bad.push(`The partners' shares come to £${m(allocated)} but the partnership's taxable trade profit is £${m(taxable)}.`);
    if (t.name && !NAME_OK.test(t.name)) bad.push("The trade name has a character HMRC doesn't accept.");
  }
  const other = p.other || {};
  if (other.savings || other.property || other.foreign || other.chargeableAssets) un.push("Other partnership income (savings, UK/foreign property, chargeable assets: SA800 supplementary pages)");
  if (p.fullStatement) un.push("Full partnership statement (SA800PS)");
  if (p.attachments?.length) un.push("Attached files");
  if (p.amended) un.push("Amended returns");
  return { bad, un };
}

function build(p, ctx = {}) {
  const { bad, un } = problems(p);
  if (bad.length || un.length) return { xml: "", errors: bad, unsupported: un, supported: SUPPORTED };
  const t = p.trade;
  const partners = p.partners;
  const agent = ctx.sender === "Agent";
  const net = t ? (Number(t.turnover) || 0) - (Number(t.expenses) || 0) : 0;
  const taxable = net;
  const body =
    `<IRenvelope xmlns="${NS}"><IRheader><Keys><Key Type="UTR">${esc(String(p.utr).replace(/\s/g, ""))}</Key></Keys><PeriodEnd>${esc(p.periodEnd)}</PeriodEnd><DefaultCurrency>GBP</DefaultCurrency><Sender>${agent ? "Agent" : "Partnership"}</Sender></IRheader>` +
    `<SApartnership><PartnershipName>${esc(p.name)}</PartnershipName><Partnership>` +
    (t ? "<BusinessInvestmentIncome><Trade>yes</Trade></BusinessInvestmentIncome><TradingAndProfessionalIncomes><Income>" +
      el("NameOfBusiness", t.name || p.name) + el("Description", t.description || t.name || p.name) + el("AccountingPeriodStart", p.periodStart) + el("AccountingPeriodEnd", p.periodEnd) +
      `<DidThisPartnershipStart>${t.start ? "yes" : "no"}</DidThisPartnershipStart>` + (t.start ? el("DateOfCommencement", t.start) : "") +
      `<DidThisPartnershipCease>${t.end ? "yes" : "no"}</DidThisPartnershipCease>` + (t.end ? el("DateOfCessation", t.end) : "") +
      "<TurnoverBelowLimit>" + money("Turnover", t.turnover) + money("Expenses", t.expenses) + `<NetProfitOrLoss>${m(net)}</NetProfitOrLoss></TurnoverBelowLimit>` +
      "<AdjustmentsForTaxableProfitOrLoss>" + (taxable >= 0 ? money("NetProfit", taxable) : money("AllowableLoss", -taxable)) + "</AdjustmentsForTaxableProfitOrLoss>" +
      "</Income></TradingAndProfessionalIncomes>" : "") +
    "<PartnershipStatement><PartnershipInformation>" + el("PeriodStart", p.periodStart) + el("PeriodEnd", p.periodEnd) + el("NatureOfTrade", (p.nature || "").slice(0, 28)) +
      (taxable >= 0 ? money("TradeProfit", taxable) : money("TradeLoss", -taxable)) + "</PartnershipInformation>" +
    partners.map((x) => "<PartnerDetails>" + el("PartnerName", x.name) + el("PartnerUTR", String(x.utr).replace(/\s/g, "")) + el("PartnerNINO", x.nino) + el("DateAppointed", x.appointed) + el("DateCeased", x.ceased) + money("TradeProfit", x.tradeProfit) + money("TradeLoss", x.tradeLoss) + "</PartnerDetails>").join("") +
    "</PartnershipStatement>" +
    `<OtherInformation><NumberOfPartners>${partners.length}</NumberOfPartners>${el("NominatedPartner", p.nominatedPartner)}${el("Capacity", p.capacity)}<FullPartnershipStatement>yes</FullPartnershipStatement></OtherInformation>` +
    `</Partnership><Declaration>${agent ? "<AgentDeclaration>yes</AgentDeclaration>" : "<PartnershipDeclaration>yes</PartnershipDeclaration>"}</Declaration></SApartnership></IRenvelope>`;
  return { xml: body, errors: [], unsupported: [], supported: SUPPORTED };
}

module.exports = { build, problems, utrOk, NS, SUPPORTED, TURNOVER_LIMIT };
